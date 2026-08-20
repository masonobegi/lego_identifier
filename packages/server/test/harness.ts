import {
  INTENT_CREATE,
  INTENT_JOIN,
  NetClient,
  type Transport,
} from '@haulmates/core';
import { Gateway } from '../src/net.js';
import { Lobby } from '../src/lobby.js';
import type { Conn, Room } from '../src/room.js';

/** A virtual clock every part of the harness reads, so runs are reproducible. */
export interface Clock {
  now: number;
}

interface Packet {
  at: number;
  bytes: Uint8Array;
}

let nextId = 1;

/**
 * A bidirectional link with configurable one-way delay. Messages are queued
 * with a delivery time and released by `pump`, which lets a test replay hours
 * of network conditions in milliseconds without touching a real socket.
 */
export class Link {
  readonly conn: Conn;
  readonly transport: Transport;
  private toServer: Packet[] = [];
  private toClient: Packet[] = [];
  /** Set to a future time to simulate a total stall (a laptop lid closing). */
  stalledUntil = 0;

  constructor(
    private clock: Clock,
    private gateway: Gateway,
    private delayMs: () => number,
  ) {
    const self = this;
    this.conn = {
      id: nextId++,
      ip: '127.0.0.1',
      send(bytes) {
        self.toClient.push({ at: self.clock.now + self.delayMs(), bytes: bytes.slice() });
      },
      close() {
        self.gateway.close(self.conn, 'closed');
      },
    };
    this.transport = {
      onOpen: null,
      onMessage: null,
      onClose: null,
      send(bytes) {
        self.toServer.push({ at: self.clock.now + self.delayMs(), bytes: bytes.slice() });
      },
      close() {
        self.gateway.close(self.conn, 'closed');
      },
    };
  }

  open(): void {
    this.gateway.open(this.conn);
    this.transport.onOpen?.();
  }

  pump(): void {
    const now = this.clock.now;
    if (now < this.stalledUntil) return;
    // Delivery is time-ordered, matching a reliable ordered transport.
    while (this.toServer.length > 0 && this.toServer[0].at <= now) {
      const p = this.toServer.shift()!;
      this.gateway.message(this.conn, p.bytes);
    }
    while (this.toClient.length > 0 && this.toClient[0].at <= now) {
      const p = this.toClient.shift()!;
      this.transport.onMessage?.(p.bytes);
    }
  }

  get pendingToServer(): number {
    return this.toServer.length;
  }
}

export interface Harness {
  clock: Clock;
  lobby: Lobby;
  gateway: Gateway;
  clients: NetClient[];
  links: Link[];
  room(): Room;
  /** Advance the whole world by `ms`, in `frameMs` render steps. */
  run(ms: number, inputs: (tick: number, player: number) => number, frameMs?: number): void;
}

export interface HarnessOptions {
  /** One-way latency in milliseconds, per message. */
  latency?: (player: number) => number;
  mode?: number;
  seed?: number;
  towerLength?: number;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const clock: Clock = { now: 1_000_000 };
  const lobby = new Lobby();
  const gateway = new Gateway(lobby, () => clock.now);
  const latency = options.latency ?? (() => 25);

  const links: Link[] = [];
  const clients: NetClient[] = [];
  const now = () => clock.now;

  const linkA = new Link(clock, gateway, () => latency(0));
  links.push(linkA);
  const clientA = new NetClient({
    transport: linkA.transport,
    name: 'ALPHA',
    intent: INTENT_CREATE,
    mode: options.mode ?? 0,
    seed: options.seed ?? 20260819,
    towerLength: options.towerLength ?? 6,
    now,
  });
  clients.push(clientA);
  linkA.open();

  let serverAccum = 0;
  let lastNow = clock.now;

  const pumpAll = (): void => {
    for (const link of links) link.pump();
  };

  const advance = (ms: number, frameMs: number, inputs: (tick: number, player: number) => number): void => {
    const frames = Math.max(1, Math.round(ms / frameMs));
    for (let f = 0; f < frames; f++) {
      clock.now += frameMs;
      pumpAll();
      serverAccum += clock.now - lastNow;
      lastNow = clock.now;
      while (serverAccum >= 1000 / 60) {
        serverAccum -= 1000 / 60;
        for (const room of lobby.rooms.values()) room.tickOnce();
      }
      pumpAll();
      for (let i = 0; i < clients.length; i++) {
        const c = clients[i];
        const masks = [0, 0];
        if (c.localIndex >= 0) masks[c.localIndex] = inputs(c.localTick + 1, c.localIndex);
        c.update(frameMs, masks);
      }
      pumpAll();
    }
  };

  // Settle the create, then join with the code the server handed out.
  advance(300, 16, () => 0);
  const code = clientA.roomCode;
  if (!code) throw new Error('harness: room was never created');

  const linkB = new Link(clock, gateway, () => latency(1));
  links.push(linkB);
  const clientB = new NetClient({
    transport: linkB.transport,
    name: 'BRAVO',
    intent: INTENT_JOIN,
    room: code,
    now,
  });
  clients.push(clientB);
  linkB.open();
  advance(300, 16, () => 0);

  clientA.ready(true);
  clientB.ready(true);
  advance(600, 16, () => 0);

  return {
    clock,
    lobby,
    gateway,
    clients,
    links,
    room: () => lobby.rooms.get(code)!,
    run: (ms, inputs, frameMs = 16) => advance(ms, frameMs, inputs),
  };
}

export { INTENT_CREATE, INTENT_JOIN };
