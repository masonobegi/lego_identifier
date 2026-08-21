import {
  CODE_ALPHABET,
  CODE_LENGTH,
  DT,
  MODE_HAUL,
  S_DESYNC,
  S_INPUTS,
  S_PEER,
  S_PEER_LEFT,
  S_RESULT,
  S_SNAPSHOT,
  S_START,
  S_WELCOME,
  SIM_VERSION,
  Writer,
  createWorld,
  hashWorld,
  levelForMatch,
  step,
  writeInputFrames,
  writeSnapshot,
  type Level,
  type SimContext,
  type World,
} from '@haulmates/core';
import { config } from './config.js';
import { log } from './log.js';

/** Everything the room needs from a socket, so rooms can be tested headlessly. */
export interface Conn {
  readonly id: number;
  readonly ip: string;
  send(bytes: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface Slot {
  conn: Conn;
  name: string;
  hat: number;
  colour: number;
  ready: boolean;
  /** Highest tick we hold an input for from this player. */
  inputHorizon: number;
  joinedAt: number;
}

export type RoomState = 'lobby' | 'running' | 'paused' | 'ended';

/** Input ring buffer length in ticks (~68 seconds). */
const RING = 4096;

export class Room {
  readonly code: string;
  readonly mode: number;
  readonly seed: number;
  readonly towerLength: number;
  readonly level: Level;
  readonly ctx: SimContext;
  world: World;
  state: RoomState = 'lobby';
  slots: (Slot | null)[] = [null, null];
  /** Public rooms are eligible for quickplay matchmaking. */
  isPublic = false;

  private inputs = new Uint8Array(RING * 2);
  private known = new Uint8Array(RING * 2);
  private lastInput = new Uint8Array(2);
  private lastSentTick = 0;
  private pendingFrames: number[] = [];

  createdAt = Date.now();
  emptySince = 0;
  lastActivity = Date.now();

  constructor(code: string, mode: number, seed: number, towerLength: number) {
    this.code = code;
    this.mode = mode;
    this.seed = seed;
    this.towerLength = towerLength;
    this.level = levelForMatch(mode, seed, towerLength);
    this.ctx = { level: this.level, seed, mode };
    this.world = createWorld(this.ctx);
  }

  get tick(): number {
    return this.world.tick;
  }

  get playerCount(): number {
    return (this.slots[0] ? 1 : 0) + (this.slots[1] ? 1 : 0);
  }

  /** First free slot, or -1. */
  freeSlot(): number {
    if (!this.slots[0]) return 0;
    if (!this.slots[1]) return 1;
    return -1;
  }

  join(conn: Conn, name: string, hat: number, colour: number): number {
    const index = this.freeSlot();
    if (index < 0) return -1;
    this.slots[index] = {
      conn,
      name: name.slice(0, 20) || `HAULER ${index + 1}`,
      hat,
      colour,
      ready: false,
      inputHorizon: this.world.tick,
      joinedAt: Date.now(),
    };
    this.emptySince = 0;
    this.lastActivity = Date.now();

    this.sendWelcome(index);
    this.broadcastPeers();
    // A player joining a run in progress needs the whole world, not just inputs.
    if (this.state !== 'lobby') this.sendSnapshot(index);
    log.info(`room ${this.code}: player ${index} joined (${this.playerCount}/2)`);
    return index;
  }

  leave(index: number, reason: string): void {
    const slot = this.slots[index];
    if (!slot) return;
    this.slots[index] = null;
    if (this.playerCount === 0) this.emptySince = Date.now();
    if (this.state === 'running') this.state = 'paused';
    const other = this.slots[1 - index];
    if (other) {
      other.ready = false;
      const w = new Writer(64).u8(S_PEER_LEFT).u8(index).str(reason);
      other.conn.send(w.finish());
    }
    this.broadcastPeers();
    log.info(`room ${this.code}: player ${index} left (${reason})`);
  }

  indexOf(conn: Conn): number {
    if (this.slots[0]?.conn === conn) return 0;
    if (this.slots[1]?.conn === conn) return 1;
    return -1;
  }

  private sendWelcome(index: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    const w = new Writer(64)
      .u8(S_WELCOME)
      .u8(index)
      .str(this.code)
      .i32(this.seed)
      .u8(this.mode)
      .u8(this.towerLength)
      .u32(this.world.tick)
      .u8(SIM_VERSION);
    slot.conn.send(w.finish());
  }

  broadcastPeers(): void {
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i];
      const w = new Writer(64).u8(S_PEER).u8(i).u8(slot ? 1 : 0);
      if (slot) w.str(slot.name).u8(slot.hat).u8(slot.colour).u8(slot.ready ? 1 : 0);
      else w.str('').u8(0).u8(0).u8(0);
      this.broadcast(w.finish());
    }
  }

  broadcast(bytes: Uint8Array): void {
    for (const slot of this.slots) slot?.conn.send(bytes);
  }

  setReady(index: number, ready: boolean): void {
    const slot = this.slots[index];
    if (!slot) return;
    slot.ready = ready;
    this.lastActivity = Date.now();
    this.broadcastPeers();
    this.maybeStart();
  }

  setCosmetic(index: number, hat: number, colour: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    slot.hat = hat & 0xff;
    slot.colour = colour & 0xff;
    this.broadcastPeers();
  }

  private maybeStart(): void {
    if (this.state === 'ended') return;
    if (this.playerCount < 2) return;
    if (!this.slots[0]?.ready || !this.slots[1]?.ready) return;
    const resuming = this.state === 'paused';
    this.state = 'running';
    this.lastSentTick = this.world.tick;
    this.pendingFrames.length = 0;
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i];
      if (slot) slot.inputHorizon = this.world.tick;
    }
    this.lastInput[0] = 0;
    this.lastInput[1] = 0;
    // Everyone restarts from the same authoritative state, whether this is a
    // fresh match or a resume after somebody's wifi died.
    for (let i = 0; i < 2; i++) if (this.slots[i]) this.sendSnapshot(i);
    const w = new Writer(24).u8(S_START).u32(this.world.tick).f64(Date.now());
    this.broadcast(w.finish());
    log.info(`room ${this.code}: ${resuming ? 'resumed' : 'started'} at tick ${this.world.tick}`);
  }

  /** Restart the match at tick 0 with a fresh world (a rematch). */
  rematch(seedOverride?: number): void {
    const seed = seedOverride ?? this.seed;
    this.world = createWorld({ ...this.ctx, seed });
    this.inputs.fill(0);
    this.known.fill(0);
    this.lastInput.fill(0);
    this.lastSentTick = 0;
    this.pendingFrames.length = 0;
    this.state = 'lobby';
    for (const slot of this.slots) if (slot) slot.ready = false;
    this.broadcastPeers();
  }

  sendSnapshot(index: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    const blob = writeSnapshot(this.world);
    const w = new Writer(blob.length + 16).u8(S_SNAPSHOT).u32(this.world.tick).u32(blob.length).bytes(blob);
    slot.conn.send(w.finish());
  }

  /** Record inputs a client claims for future ticks. */
  receiveInputs(index: number, startTick: number, masks: Uint8Array): void {
    const slot = this.slots[index];
    if (!slot) return;
    this.lastActivity = Date.now();
    const horizonCap = this.world.tick + config.maxInputLead;
    for (let i = 0; i < masks.length; i++) {
      const t = startTick + i;
      // Ticks already simulated are history; ticks too far ahead are either a
      // clock-sync bug or someone trying to flood the buffer.
      if (t <= this.world.tick || t > horizonCap) continue;
      const slotIndex = (t % RING) * 2 + index;
      this.inputs[slotIndex] = masks[i];
      this.known[slotIndex] = 1;
      if (t > slot.inputHorizon) slot.inputHorizon = t;
    }
  }

  /** Advance the authoritative world by one tick and queue the frame. */
  tickOnce(): void {
    if (this.state !== 'running') return;
    const t = this.world.tick + 1;
    const base = (t % RING) * 2;
    const masks = [0, 0];
    for (let i = 0; i < 2; i++) {
      // A missing input is predicted as "same as last tick" — the same
      // prediction the clients make, so this rarely causes a correction.
      const mask = this.known[base + i] ? this.inputs[base + i] : this.lastInput[i];
      masks[i] = mask;
      this.lastInput[i] = mask;
      this.inputs[base + i] = mask;
      this.known[base + i] = 1;
    }

    step(this.ctx, this.world, masks);
    this.world.events.length = 0;
    this.pendingFrames.push(masks[0], masks[1]);

    if (this.world.tick - this.lastSentTick >= config.frameBatchTicks) this.flushFrames();
    if (this.world.tick % config.hashIntervalTicks === 0) {
      this.flushFrames();
      const w = new Writer(12).u8(S_DESYNC).u32(this.world.tick).u32(hashWorld(this.world));
      this.broadcast(w.finish());
    }

    if (this.world.finished && this.state === 'running') this.finish();
  }

  private flushFrames(): void {
    if (this.pendingFrames.length === 0) return;
    const bytes = Uint8Array.from(this.pendingFrames);
    this.broadcast(writeInputFrames(this.lastSentTick + 1, bytes));
    this.lastSentTick += this.pendingFrames.length >> 1;
    this.pendingFrames.length = 0;
  }

  private finish(): void {
    this.flushFrames();
    this.state = 'ended';
    const w = this.world;
    const msg = new Writer(64)
      .u8(S_RESULT)
      .u32(w.finishTick)
      .u32(w.players[0].deaths)
      .u32(w.players[1].deaths)
      .u32(w.cargoBreaks)
      .u32(w.betrayals)
      .u32(w.bonds)
      .u32(w.checkpoint + 1);
    this.broadcast(msg.finish());
    log.info(`room ${this.code}: finished in ${(w.finishTick * DT).toFixed(1)}s`);
  }

  /** Ticks this room should have simulated by `now`, capped to avoid spirals. */
  catchUp(now: number, lastRun: number): number {
    const elapsed = now - lastRun;
    return Math.min(8, Math.floor(elapsed / (DT * 1000)));
  }

  summary(): Record<string, unknown> {
    return {
      code: this.code,
      state: this.state,
      players: this.playerCount,
      tick: this.world.tick,
      mode: this.mode === MODE_HAUL ? 'haul' : 'gauntlet',
      ageSeconds: Math.round((Date.now() - this.createdAt) / 1000),
    };
  }
}

/** Room codes are drawn from an alphabet with no lookalike characters. */
export function makeRoomCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 5000; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!taken(code)) return code;
  }
  throw new Error('exhausted room code space');
}
