import {
  C_COSMETIC,
  C_HELLO,
  C_LEAVE,
  C_PING,
  C_READY,
  C_REMATCH,
  C_RESYNC,
  ERROR_TEXT,
  PROTOCOL_VERSION,
  Reader,
  S_DESYNC,
  S_ERROR,
  S_INPUTS,
  S_PEER,
  S_PEER_LEFT,
  S_PONG,
  S_RESULT,
  S_SNAPSHOT,
  S_START,
  S_WELCOME,
  Writer,
  writeHello,
  writeInputs,
} from './protocol.js';
import { DT, SIM_VERSION, TICK_RATE } from './constants.js';
import { levelForMatch } from './modes.js';
import { cloneWorld, copyWorldInto, createWorld, hashWorld, readSnapshot } from './state.js';
import { step } from './sim.js';
import type { SimContext, SimEvent, World } from './types.js';

/** One tick in milliseconds. */
const TICK_MS = 1000 / TICK_RATE;
/** Input history ring, ~34 seconds. */
const RING = 2048;
/** Never resimulate more than this in one frame; beyond it we hard-resync. */
const MAX_ROLLBACK = 240;
/** Cap on catch-up steps per frame so a stall never freezes the renderer. */
const MAX_STEPS_PER_FRAME = 10;
/** Extra ticks of lead beyond half the round trip, to absorb jitter. */
const JITTER_TICKS = 2;

export type MatchPhase =
  | 'connecting'
  | 'lobby'
  | 'running'
  | 'paused'
  | 'ended'
  | 'error'
  | 'closed';

export interface PeerInfo {
  present: boolean;
  name: string;
  hat: number;
  colour: number;
  ready: boolean;
}

export interface MatchResult {
  finishTick: number;
  deaths: [number, number];
  cargoBreaks: number;
  betrayals: number;
  bonds: number;
  checkpoints: number;
}

/** Minimal transport contract, so the same client drives WebSockets, Steam
 *  peer-to-peer sockets, or an in-process pipe used by the test suite. */
export interface Transport {
  send(bytes: Uint8Array): void;
  close(): void;
  onOpen: (() => void) | null;
  onMessage: ((bytes: Uint8Array) => void) | null;
  onClose: ((reason: string) => void) | null;
}

export interface NetClientOptions {
  transport: Transport;
  name: string;
  intent: number;
  room?: string;
  mode?: number;
  towerLength?: number;
  seed?: number;
  hat?: number;
  colour?: number;
  /** Injectable clock, so tests can drive time deterministically. */
  now?: () => number;
}

/**
 * Rollback netcode client.
 *
 * The client simulates ahead of the server by roughly half the round trip,
 * predicting the partner's input as "whatever they did last". When the server
 * confirms what actually happened, any tick where the prediction was wrong
 * triggers a rollback: the confirmed world is copied forward and every tick
 * since is replayed. Because the simulation is deterministic and the state is
 * tiny, this costs well under a millisecond even at the worst rollback depth.
 */
export class NetClient {
  phase: MatchPhase = 'connecting';
  errorMessage = '';
  roomCode = '';
  localIndex = -1;
  seed = 0;
  mode = 0;
  towerLength = 10;
  peers: PeerInfo[] = [emptyPeer(), emptyPeer()];
  result: MatchResult | null = null;

  ctx: SimContext | null = null;
  /** The world the renderer draws: predicted, ahead of the server. */
  world: World | null = null;
  /** The same world one tick earlier, for render interpolation. */
  prev: World | null = null;
  /** The last fully authoritative world. Rollbacks restart from here, and
   *  its hash is what the server's periodic checksum is compared against. */
  confirmedWorld: World | null = null;

  localTick = 0;
  confirmedTick = 0;
  alpha = 0;
  events: SimEvent[] = [];

  /* diagnostics surfaced in the HUD and used by the tests */
  rtt = 0;
  rollbacks = 0;
  worstRollback = 0;
  desyncs = 0;
  /** Snapshots applied in total, including the one that starts every match. */
  snapshots = 0;
  /** Snapshots applied *while already running* — i.e. genuine corrections. */
  resyncs = 0;
  /** The most recent tick whose checksum was verified against the server. */
  lastCheckedTick = -1;
  /** The hash this client computed at `lastCheckedTick`. */
  lastCheckedHash = 0;
  predictionMisses = 0;
  serverTickEstimate = 0;

  onPhase: ((phase: MatchPhase) => void) | null = null;
  onResult: ((result: MatchResult) => void) | null = null;
  onPeers: ((peers: PeerInfo[]) => void) | null = null;

  private transport: Transport;
  private now: () => number;
  private options: NetClientOptions;

  private localMask = new Uint8Array(RING);
  private auth = new Uint8Array(RING * 2);
  private authKnown = new Uint8Array(RING);
  private used = new Uint8Array(RING * 2);

  private accumulatorMs = 0;
  private started = false;
  private highestSimulated = -1;
  private sentThrough = -1;
  private lastPingAt = 0;
  private bestRtt = Number.POSITIVE_INFINITY;
  private syncServerTick = 0;
  private syncAtMs = 0;
  private hasSync = false;
  private serverHashes = new Map<number, number>();
  private lastResyncRequest = 0;
  private cosmetic = { hat: 0, colour: 0 };

  constructor(options: NetClientOptions) {
    this.options = options;
    this.transport = options.transport;
    this.now = options.now ?? (() => Date.now());
    this.cosmetic.hat = options.hat ?? 0;
    this.cosmetic.colour = options.colour ?? 0;

    this.transport.onOpen = () => this.sendHello();
    this.transport.onMessage = (bytes) => this.receive(bytes);
    this.transport.onClose = (reason) => {
      if (this.phase !== 'error') this.setPhase('closed');
      this.errorMessage = this.errorMessage || reason;
    };
  }

  private setPhase(phase: MatchPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.onPhase?.(phase);
  }

  private sendHello(): void {
    const o = this.options;
    this.transport.send(
      writeHello({
        simVersion: SIM_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        name: o.name,
        intent: o.intent,
        room: o.room ?? '',
        mode: o.mode ?? 0,
        towerLength: o.towerLength ?? 10,
        seed: o.seed ?? 0,
        hat: this.cosmetic.hat,
        colour: this.cosmetic.colour,
      }),
    );
  }

  /* ------------------------------------------------------------- outbound */

  ready(value: boolean): void {
    this.transport.send(new Writer(4).u8(C_READY).u8(value ? 1 : 0).finish());
  }

  setCosmetic(hat: number, colour: number): void {
    this.cosmetic.hat = hat;
    this.cosmetic.colour = colour;
    this.transport.send(new Writer(4).u8(C_COSMETIC).u8(hat).u8(colour).finish());
  }

  rematch(): void {
    this.transport.send(new Writer(2).u8(C_REMATCH).finish());
  }

  leave(): void {
    this.transport.send(new Writer(2).u8(C_LEAVE).finish());
    this.transport.close();
  }

  dispose(): void {
    this.transport.onMessage = null;
    this.transport.onClose = null;
    this.transport.close();
  }

  /* -------------------------------------------------------------- inbound */

  private receive(bytes: Uint8Array): void {
    const r = new Reader(bytes);
    const type = r.u8();
    switch (type) {
      case S_WELCOME: {
        this.localIndex = r.u8();
        this.roomCode = r.str();
        this.seed = r.i32();
        this.mode = r.u8();
        this.towerLength = r.u8();
        const tick = r.u32();
        const simVersion = r.u8();
        if (simVersion !== SIM_VERSION) {
          this.fail(`Version mismatch: server runs sim ${simVersion}, this build is ${SIM_VERSION}.`);
          return;
        }
        this.buildMatch(tick);
        this.setPhase('lobby');
        return;
      }
      case S_PEER: {
        const index = r.u8();
        const present = r.u8() !== 0;
        const name = r.str();
        const hat = r.u8();
        const colour = r.u8();
        const ready = r.u8() !== 0;
        this.peers[index] = { present, name, hat, colour, ready };
        this.onPeers?.(this.peers);
        return;
      }
      case S_PEER_LEFT: {
        r.u8();
        this.setPhase('paused');
        return;
      }
      case S_SNAPSHOT: {
        const tick = r.u32();
        const length = r.u32();
        this.applySnapshot(tick, r.bytes(length));
        return;
      }
      case S_START: {
        const startTick = r.u32();
        r.f64();
        this.beginRunning(startTick);
        return;
      }
      case S_INPUTS: {
        const startTick = r.u32();
        const count = r.u16();
        this.applyInputFrames(startTick, count, r.bytes(count * 2));
        return;
      }
      case S_PONG: {
        const clientTime = r.f64();
        const serverTime = r.f64();
        const serverTick = r.u32();
        this.applyPong(clientTime, serverTime, serverTick);
        return;
      }
      case S_DESYNC: {
        const tick = r.u32();
        const hash = r.u32();
        this.serverHashes.set(tick, hash);
        this.checkHashes();
        return;
      }
      case S_RESULT: {
        this.result = {
          finishTick: r.u32(),
          deaths: [r.u32(), r.u32()],
          cargoBreaks: r.u32(),
          betrayals: r.u32(),
          bonds: r.u32(),
          checkpoints: r.u32(),
        };
        this.setPhase('ended');
        this.onResult?.(this.result);
        return;
      }
      case S_ERROR: {
        const code = r.u8();
        const message = r.str();
        this.fail(ERROR_TEXT[code] ?? message);
        return;
      }
      default:
        return;
    }
  }

  private fail(message: string): void {
    this.errorMessage = message;
    this.setPhase('error');
  }

  private buildMatch(tick: number): void {
    const level = levelForMatch(this.mode, this.seed, this.towerLength);
    this.ctx = { level, seed: this.seed, mode: this.mode };
    this.confirmedWorld = createWorld(this.ctx);
    this.world = cloneWorld(this.confirmedWorld);
    this.prev = cloneWorld(this.confirmedWorld);
    this.confirmedTick = tick;
    this.localTick = tick;
    this.highestSimulated = tick;
    this.sentThrough = tick;
    this.started = false;
    this.localMask.fill(0);
    this.auth.fill(0);
    this.authKnown.fill(0);
    this.used.fill(0);
  }

  private applySnapshot(tick: number, blob: Uint8Array): void {
    if (!this.confirmedWorld || !this.world || !this.prev) return;
    readSnapshot(this.confirmedWorld, blob);
    this.confirmedTick = this.confirmedWorld.tick;
    this.serverHashes.clear();
    // Anything we predicted before the snapshot is void.
    for (let t = this.confirmedTick; t <= this.confirmedTick + 4; t++) this.authKnown[t % RING] = 0;
    if (this.localTick < this.confirmedTick) {
      this.localTick = this.confirmedTick;
      this.highestSimulated = this.confirmedTick;
      this.sentThrough = this.confirmedTick;
    }
    this.resimulate();
    copyWorldInto(this.prev, this.world);
    this.snapshots++;
    // Every match opens with a snapshot; only one that lands mid-run is a
    // correction, and only those should look alarming in the diagnostics.
    if (this.started) this.resyncs++;
  }

  private beginRunning(startTick: number): void {
    this.localTick = Math.max(this.localTick, startTick);
    this.confirmedTick = startTick;
    this.highestSimulated = this.localTick;
    this.sentThrough = startTick;
    this.accumulatorMs = 0;
    this.started = true;
    this.setPhase('running');
  }

  private applyInputFrames(startTick: number, count: number, data: Uint8Array): void {
    for (let i = 0; i < count; i++) {
      const t = startTick + i;
      if (t <= this.confirmedTick) continue;
      const slot = t % RING;
      this.auth[slot * 2] = data[i * 2];
      this.auth[slot * 2 + 1] = data[i * 2 + 1];
      this.authKnown[slot] = 1;
    }
    this.advanceConfirmed();
  }

  /** Fold every contiguous confirmed tick into the authoritative world. */
  private advanceConfirmed(): void {
    if (!this.ctx || !this.confirmedWorld) return;
    let mismatch = false;
    let advanced = 0;
    while (advanced < MAX_ROLLBACK) {
      const t = this.confirmedTick + 1;
      const slot = t % RING;
      if (!this.authKnown[slot]) break;
      const a0 = this.auth[slot * 2];
      const a1 = this.auth[slot * 2 + 1];
      if (t <= this.highestSimulated && (this.used[slot * 2] !== a0 || this.used[slot * 2 + 1] !== a1)) {
        mismatch = true;
        this.predictionMisses++;
      }
      step(this.ctx, this.confirmedWorld, [a0, a1]);
      this.confirmedWorld.events.length = 0;
      this.used[slot * 2] = a0;
      this.used[slot * 2 + 1] = a1;
      this.confirmedTick = t;
      advanced++;
    }
    if (advanced > 0) this.checkHashes();
    if (mismatch) {
      this.rollbacks++;
      const depth = this.localTick - this.confirmedTick;
      if (depth > this.worstRollback) this.worstRollback = depth;
      this.resimulate();
    } else if (this.world && this.confirmedTick > this.localTick) {
      // The server got ahead of us (a long stall). Snap forward.
      copyWorldInto(this.world, this.confirmedWorld);
      this.localTick = this.confirmedTick;
      this.highestSimulated = this.confirmedTick;
    }
  }

  /** Replay every predicted tick on top of the confirmed world. */
  private resimulate(): void {
    if (!this.ctx || !this.confirmedWorld || !this.world) return;
    copyWorldInto(this.world, this.confirmedWorld);
    const remote = 1 - this.localIndex;
    const lastRemote = this.auth[(this.confirmedTick % RING) * 2 + remote];
    for (let t = this.confirmedTick + 1; t <= this.localTick; t++) {
      const slot = t % RING;
      const masks: number[] = [0, 0];
      masks[this.localIndex] = this.localMask[slot];
      masks[remote] = this.authKnown[slot] ? this.auth[slot * 2 + remote] : lastRemote;
      this.used[slot * 2] = masks[0];
      this.used[slot * 2 + 1] = masks[1];
      step(this.ctx, this.world, masks);
      // Rollback replays ticks that already happened; replaying their sounds and
      // particles would stutter, so presentation events are dropped here.
      this.world.events.length = 0;
    }
  }

  private applyPong(clientTime: number, _serverTime: number, serverTick: number): void {
    const now = this.now();
    const rtt = now - clientTime;
    if (rtt < 0 || rtt > 5000) return;
    this.rtt = this.rtt === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
    // Prefer the least-delayed sample: it carries the least clock uncertainty.
    if (!this.hasSync || rtt <= this.bestRtt * 1.25) {
      this.bestRtt = Math.min(this.bestRtt === Number.POSITIVE_INFINITY ? rtt : this.bestRtt * 1.02, rtt);
      this.syncServerTick = serverTick;
      this.syncAtMs = now - rtt / 2;
      this.hasSync = true;
    }
  }

  private estimateServerTick(now: number): number {
    if (!this.hasSync) return this.confirmedTick;
    return this.syncServerTick + (now - this.syncAtMs) / TICK_MS;
  }

  private checkHashes(): void {
    if (!this.confirmedWorld) return;
    for (const [tick, hash] of this.serverHashes) {
      if (tick > this.confirmedTick) continue;
      if (tick === this.confirmedTick) {
        const local = hashWorld(this.confirmedWorld);
        // Recorded so that two peers can be compared at a tick they have both
        // verified, rather than at whatever tick each happens to be on now.
        this.lastCheckedTick = tick;
        this.lastCheckedHash = local;
        if (local !== hash) this.onDesync();
      }
      this.serverHashes.delete(tick);
    }
  }

  private onDesync(): void {
    this.desyncs++;
    const now = this.now();
    if (now - this.lastResyncRequest < 2000) return;
    this.lastResyncRequest = now;
    this.transport.send(new Writer(2).u8(C_RESYNC).finish());
  }

  /* ---------------------------------------------------------------- frame */

  /**
   * Advance the client by one rendered frame.
   *
   * `inputs[localIndex]` is this player's intent for the next tick; the other
   * entry is ignored, because the partner's input only ever arrives from the
   * server.
   */
  update(dtMs: number, inputs: number[]): void {
    const now = this.now();
    // Never send gameplay traffic before the handshake has completed: the
    // server rejects anything that arrives ahead of the hello.
    if (this.localIndex >= 0 && now - this.lastPingAt > 500) {
      this.lastPingAt = now;
      this.transport.send(new Writer(16).u8(C_PING).f64(now).finish());
    }

    if (!this.started || !this.ctx || !this.world || !this.prev) {
      this.alpha = 0;
      return;
    }

    this.accumulatorMs += Math.min(dtMs, 250);
    this.serverTickEstimate = this.estimateServerTick(now);

    // Run far enough ahead that our input lands before the server needs it.
    const lead = Math.ceil(this.rtt / 2 / TICK_MS) + JITTER_TICKS;
    const target = Math.floor(this.serverTickEstimate + lead);

    let steps = 0;
    while (this.accumulatorMs >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      if (this.localTick >= target + 3) break;
      this.accumulatorMs -= TICK_MS;
      this.advanceOneTick(inputs);
      steps++;
    }
    // Falling behind the server means our lead is gone: burn extra ticks
    // without consuming render time, so inputs stop arriving late.
    while (this.localTick < target - 1 && steps < MAX_STEPS_PER_FRAME) {
      this.advanceOneTick(inputs);
      steps++;
    }

    this.alpha = Math.max(0, Math.min(1, this.accumulatorMs / TICK_MS));
    this.flushInputs();
  }

  private advanceOneTick(inputs: number[]): void {
    if (!this.ctx || !this.world || !this.prev) return;
    const t = this.localTick + 1;
    const slot = t % RING;
    const remote = 1 - this.localIndex;
    const mine = inputs[this.localIndex] & 0xff;
    this.localMask[slot] = mine;

    const lastRemote = this.auth[(this.confirmedTick % RING) * 2 + remote];
    const masks: number[] = [0, 0];
    masks[this.localIndex] = mine;
    masks[remote] = this.authKnown[slot] ? this.auth[slot * 2 + remote] : lastRemote;
    this.used[slot * 2] = masks[0];
    this.used[slot * 2 + 1] = masks[1];

    copyWorldInto(this.prev, this.world);
    step(this.ctx, this.world, masks);
    this.localTick = t;
    if (t > this.highestSimulated) {
      this.highestSimulated = t;
      for (const e of this.world.events) this.events.push(e);
    }
    this.world.events.length = 0;
  }

  private flushInputs(): void {
    if (this.sentThrough >= this.localTick) return;
    const from = Math.max(this.sentThrough + 1, this.localTick - 15);
    const count = this.localTick - from + 1;
    if (count <= 0) return;
    const masks = new Uint8Array(count);
    for (let i = 0; i < count; i++) masks[i] = this.localMask[(from + i) % RING];
    this.transport.send(writeInputs(from, masks));
    this.sentThrough = this.localTick;
  }

  /** Drain presentation events accumulated since the last call. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  get elapsedSeconds(): number {
    return this.localTick * DT;
  }
}

function emptyPeer(): PeerInfo {
  return { present: false, name: '', hat: 0, colour: 0, ready: false };
}
