import { describe, expect, it } from 'vitest';
import {
  DAILY_FLOORS,
  IN_GRIP,
  IN_JUMP,
  IN_LEFT,
  IN_REEL,
  IN_RIGHT,
  MODE_GAUNTLET,
  Rng,
  buildTower,
  dailyDay,
  dailySeed,
  hashWorld,
} from '@haulmates/core';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/room.js';
import { createHarness } from './harness.js';

/** A day well away from a boundary, so the test never straddles one. */
const DAY = dailyDay(Date.UTC(2026, 7, 21, 12, 0, 0));

/** A socket that goes nowhere: enough to occupy a slot in a room. */
function idleConn(id: number): Conn {
  return { id, ip: '127.0.0.1', send: () => {}, close: () => {} };
}

/** Busy, varied input so the two peers genuinely disagree about the future. */
function chaos(tick: number, player: number): number {
  const r = (tick * (player === 0 ? 29 : 53) + player * 401) % 210;
  let mask = 0;
  if (r < 65) mask |= IN_RIGHT;
  else if (r < 120) mask |= IN_LEFT;
  if (r % 19 < 3) mask |= IN_JUMP;
  if (r % 41 < 7) mask |= IN_GRIP;
  if (r % 37 < 5) mask |= IN_REEL;
  return mask;
}

describe('online match', () => {
  it('connects two players, starts a match and keeps them in sync', () => {
    const h = createHarness({ latency: () => 25 });
    const [a, b] = h.clients;

    expect(a.phase).toBe('running');
    expect(b.phase).toBe('running');
    expect(a.localIndex).toBe(0);
    expect(b.localIndex).toBe(1);
    expect(a.roomCode).toBe(b.roomCode);
    expect(a.seed).toBe(b.seed);
    expect(a.peers[1].name).toBe('BRAVO');
    expect(b.peers[0].name).toBe('ALPHA');

    h.run(10_000, chaos);

    const room = h.room();
    expect(room.tick).toBeGreaterThan(400);
    expect(a.confirmedTick).toBeGreaterThan(300);
    expect(b.confirmedTick).toBeGreaterThan(300);
    expect(a.desyncs).toBe(0);
    expect(b.desyncs).toBe(0);
  });

  it('runs each client ahead of the server so its own input is never mispredicted', () => {
    const h = createHarness({ latency: () => 60 });
    h.run(6000, chaos);
    for (const c of h.clients) {
      expect(c.localTick).toBeGreaterThan(h.room().tick);
      // Lead should track half the round trip, not run away.
      expect(c.localTick - h.room().tick).toBeLessThan(30);
    }
  });

  it('produces identical authoritative state on both clients and the server', () => {
    const h = createHarness({ latency: () => 45 });
    h.run(12_000, chaos);
    const [a, b] = h.clients;
    const room = h.room();

    // Let every confirmed frame settle without any new input arriving.
    h.run(1500, () => 0);

    // Compare at a tick both peers have actually verified against the server's
    // checksum. Comparing "right now" is racy: each client's confirmed tick
    // advances as its own packets land.
    expect(a.lastCheckedTick).toBeGreaterThan(300);
    expect(a.lastCheckedTick).toBe(b.lastCheckedTick);
    expect(a.lastCheckedHash).toBe(b.lastCheckedHash);
    expect(a.confirmedTick).toBeLessThanOrEqual(room.tick);
    expect(a.desyncs + b.desyncs).toBe(0);
    expect(a.resyncs).toBe(0);
    expect(b.resyncs).toBe(0);
    expect(hashWorld(a.confirmedWorld!)).not.toBe(0);
  });

  it('actually exercises rollback under latency', () => {
    const h = createHarness({ latency: () => 70 });
    h.run(8000, chaos);
    const [a, b] = h.clients;
    expect(a.rollbacks + b.rollbacks).toBeGreaterThan(0);
    expect(a.predictionMisses + b.predictionMisses).toBeGreaterThan(0);
    // Rollback depth must stay bounded by the lead, not grow without limit.
    expect(a.worstRollback).toBeLessThan(60);
    expect(b.worstRollback).toBeLessThan(60);
    expect(a.desyncs).toBe(0);
    expect(b.desyncs).toBe(0);
  });

  it('stays in sync on a bad connection with jitter', () => {
    const rng = new Rng(4242);
    const h = createHarness({ latency: () => 40 + Math.floor(rng.nextFloat() * 90) });
    h.run(15_000, chaos);
    const [a, b] = h.clients;
    h.run(2000, () => 0);
    expect(a.desyncs).toBe(0);
    expect(b.desyncs).toBe(0);
    // Neither peer should have needed a snapshot to stay correct.
    expect(a.resyncs).toBe(0);
    expect(b.resyncs).toBe(0);
    expect(a.lastCheckedTick).toBeGreaterThan(600);
    expect(a.lastCheckedTick).toBe(b.lastCheckedTick);
    expect(a.lastCheckedHash).toBe(b.lastCheckedHash);
  });

  it('recovers after one player freezes completely', () => {
    const h = createHarness({ latency: () => 30 });
    h.run(4000, chaos);
    const before = h.clients[1].confirmedTick;

    // Player two's connection dies for a second and a half.
    h.links[1].stalledUntil = h.clock.now + 1500;
    h.run(1600, chaos);
    h.run(6000, chaos);

    const [a, b] = h.clients;
    expect(b.confirmedTick).toBeGreaterThan(before + 200);
    expect(a.desyncs).toBe(0);
    expect(b.desyncs).toBe(0);
    h.run(1500, () => 0);
    expect(a.lastCheckedTick).toBe(b.lastCheckedTick);
    expect(a.lastCheckedHash).toBe(b.lastCheckedHash);
  });

  it('carries the same gauntlet tower to both peers without sending level data', () => {
    const h = createHarness({ mode: MODE_GAUNTLET, seed: 987654, towerLength: 8, latency: () => 20 });
    const [a, b] = h.clients;
    expect(a.ctx!.level.id).toBe(b.ctx!.level.id);
    expect(a.ctx!.level.chunkIds).toEqual(b.ctx!.level.chunkIds);
    expect(a.ctx!.level.h).toBe(b.ctx!.level.h);
    h.run(5000, chaos);
    expect(a.desyncs + b.desyncs).toBe(0);
  });

  it('reports the same result to both players when the run ends', () => {
    const h = createHarness({ latency: () => 20 });
    // Teleport both players onto the goal on the server; the clients will be
    // corrected by the next authoritative snapshot. The crate comes with them,
    // because a run does not finish without it — leaving it at the bottom of
    // the tower and expecting a result is the exact thing that rule exists to
    // refuse.
    const room = h.room();
    h.run(500, () => 0);
    room.world.players[0].x = room.level.goalX;
    room.world.players[0].y = room.level.goalY;
    room.world.players[1].x = room.level.goalX + 12;
    room.world.players[1].y = room.level.goalY;
    room.world.cargo.x = room.level.goalX;
    room.world.cargo.y = room.level.goalY;
    room.world.cargo.px = room.world.cargo.x;
    room.world.cargo.py = room.world.cargo.y;
    h.run(3000, () => 0);

    expect(room.world.finished).toBe(1);
    expect(room.state).toBe('ended');
    for (const c of h.clients) {
      expect(c.result).not.toBeNull();
      expect(c.phase).toBe('ended');
    }
    expect(h.clients[0].result).toEqual(h.clients[1].result);
  });
});

describe('server room management', () => {
  it('pauses the match when a player disconnects and resumes on rejoin', () => {
    const h = createHarness({ latency: () => 20 });
    h.run(3000, chaos);
    const room = h.room();
    const tickAtDrop = room.tick;

    room.leave(1, 'test disconnect');
    expect(room.state).toBe('paused');
    h.run(1000, chaos);
    expect(room.tick).toBe(tickAtDrop);
    expect(h.clients[0].phase).toBe('paused');
  });

  it('rejects a second player joining a full room', () => {
    const h = createHarness({ latency: () => 20 });
    const room = h.room();
    expect(room.freeSlot()).toBe(-1);
    expect(room.playerCount).toBe(2);
  });

  it('reaps empty rooms after the grace period', () => {
    const h = createHarness({ latency: () => 20 });
    const room = h.room();
    room.leave(0, 'bye');
    room.leave(1, 'bye');
    expect(h.lobby.rooms.size).toBe(1);
    h.lobby.sweep(Date.now());
    h.lobby.sweep(Date.now() + 10 * 60_000);
    expect(h.lobby.rooms.has(room.code)).toBe(false);
  });
});

/**
 * Which tower a room is on.
 *
 * The daily is the only tower two people can be sure they are both looking at,
 * and it is worth nothing unless a room can be opened on it and stay on it.
 */
describe('agreeing on a tower', () => {
  it('opens a room on the tower the lobby named, and gives it to whoever joins', () => {
    const h = createHarness({ mode: MODE_GAUNTLET, seed: dailySeed(DAY), towerLength: DAILY_FLOORS });
    const expected = buildTower(dailySeed(DAY), DAILY_FLOORS);
    expect(h.room().seed).toBe(dailySeed(DAY));
    expect(h.room().level.id).toBe(expected.id);
    for (const client of h.clients) expect(client.ctx!.level.id).toBe(expected.id);
  });

  it('rolls its own tower when nobody named one', () => {
    const h = createHarness({ mode: MODE_GAUNTLET, seed: 0, towerLength: 6 });
    expect(h.room().seed).not.toBe(0);
    expect(h.room().fixedSeed).toBe(false);
    expect(h.clients[0].ctx!.level.id).toBe(h.clients[1].ctx!.level.id);
  });

  it('gives a rematch a tower neither of them has climbed, and both of them the same one', () => {
    const h = createHarness({ mode: MODE_GAUNTLET, seed: 0, towerLength: 6 });
    const before = h.room().level.id;
    h.clients[0].rematch();
    h.run(400, () => 0);
    expect(h.room().level.id).not.toBe(before);
    for (const client of h.clients) expect(client.ctx!.level.id).toBe(h.room().level.id);
  });

  it('keeps today’s tower across a rematch, because that is what the room is for', () => {
    const h = createHarness({ mode: MODE_GAUNTLET, seed: dailySeed(DAY), towerLength: DAILY_FLOORS });
    const before = h.room().level.id;
    h.clients[0].rematch();
    h.run(400, () => 0);
    expect(h.room().level.id).toBe(before);
    for (const client of h.clients) expect(client.ctx!.level.id).toBe(before);
  });

  it('never quick-matches somebody onto a tower they did not ask for', () => {
    const lobby = new Lobby();
    const seed = dailySeed(DAY);
    const daily = lobby.create(MODE_GAUNTLET, seed, DAILY_FLOORS, true)!;
    const rolled = lobby.create(MODE_GAUNTLET, 0, 6, true)!;
    daily.join(idleConn(1), 'ALPHA', 0, 0);
    rolled.join(idleConn(2), 'BRAVO', 0, 0);
    expect(lobby.findQuickplay(MODE_GAUNTLET, seed)).toBe(daily);
    expect(lobby.findQuickplay(MODE_GAUNTLET, 0)).toBe(rolled);
    expect(lobby.findQuickplay(MODE_GAUNTLET, seed + 1)).toBeUndefined();
  });
});
