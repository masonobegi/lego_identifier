import { describe, expect, it } from 'vitest';
import {
  GRIP_MAX,
  IN_RIGHT,
  PLAYER_H,
  ROPE_MAX,
  ROPE_NODES,
  TILE,
  assembleLevel,
  createWorld,
  ropeContactCount,
  step,
  tautPathLength,
  type ChunkDef,
  type Level,
  type SimContext,
  type World,
} from '@haulmates/core';

/* ------------------------------------------------------------------ setup */

function build(rows: string[]): Level {
  const chunk: ChunkDef = { id: 'rope', biome: 0, difficulty: 0, rows, tags: ['start', 'goal'] };
  return assembleLevel('rope', 'ROPE', [chunk]);
}

function blank(height: number): string[] {
  const rows: string[] = [];
  for (let r = 0; r < height; r++) rows.push('##' + '.'.repeat(36) + '##');
  return rows;
}

function paint(rows: string[], row: number, col: number, text: string): void {
  rows[row] = rows[row].slice(0, col) + text + rows[row].slice(col + text.length);
}

function placePair(world: World, ax: number, ay: number, bx: number, by: number): void {
  const set = (p: World['players'][number], x: number, y: number): void => {
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.dead = 0;
    p.gripping = 0;
    p.grounded = 1;
    p.grip = GRIP_MAX;
  };
  set(world.players[0], ax, ay);
  set(world.players[1], bx, by);
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    world.ropeX[i] = ax + (bx - ax) * t;
    world.ropeY[i] = ay + (by - ay) * t;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = world.ropeY[i];
  }
  world.cargo.x = (ax + bx) / 2;
  world.cargo.y = (ay + by) / 2;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.hp = 1e9;
  world.restartTimer = 0;
}

/* ------------------------------------------------------------------ tests */

describe('rope length follows the rope, not the straight line', () => {
  it('measures a clear run as the straight distance, with no bends', () => {
    const rows = blank(20);
    paint(rows, 16, 2, '#'.repeat(36));
    paint(rows, 2, 19, 'F');
    paint(rows, 15, 19, 'S');
    const level = build(rows);
    const ctx: SimContext = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);

    const y = 16 * TILE - PLAYER_H / 2 - 1;
    placePair(world, 14 * TILE, y, 20 * TILE, y);
    step(ctx, world, [0, 0]);
    world.events.length = 0;

    const length = tautPathLength(world, level);
    expect(ropeContactCount()).toBe(0);
    expect(length).toBeCloseTo(6 * TILE, 0);
  });

  it('measures the long way round when the rope is hooked over a pillar', () => {
    const rows = blank(24);
    paint(rows, 20, 2, '#'.repeat(36));
    for (let r = 16; r < 20; r++) paint(rows, r, 18, '##');
    paint(rows, 2, 19, 'F');
    paint(rows, 19, 8, 'S');
    const level = build(rows);
    const ctx: SimContext = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);

    const y = 20 * TILE - PLAYER_H / 2 - 1;
    const ax = 16 * TILE;
    const bx = 22 * TILE;
    placePair(world, ax, y, bx, y);
    // Drape the rope over the pillar so it is resting on it.
    for (let i = 0; i < ROPE_NODES; i++) {
      const t = i / (ROPE_NODES - 1);
      world.ropeY[i] = y - 90 * (1 - Math.abs(2 * t - 1));
      world.ropePY[i] = world.ropeY[i];
    }
    step(ctx, world, [0, 0]);
    world.events.length = 0;

    const straight = Math.abs(bx - ax);
    const length = tautPathLength(world, level);
    expect(ropeContactCount()).toBeGreaterThan(0);
    // Going over the pillar is strictly further than going through it.
    expect(length).toBeGreaterThan(straight * 1.3);
  });
});

describe('the winch', () => {
  /**
   * The mechanic the whole co-op rests on: with the rope running over a lip,
   * one player walking away from it hauls the other up. Nothing a single body
   * can do, and it falls out of the physics rather than being scripted.
   */
  function winch(partnerWalks: boolean): { lifted: number; bends: number } {
    const height = 40;
    const ground = 14;
    const pitFloor = 22;
    const rows = blank(height);
    for (let r = ground; r < height; r++) paint(rows, r, 2, '#'.repeat(36));
    for (let r = ground; r < pitFloor; r++) paint(rows, r, 5, '.'.repeat(6));
    paint(rows, 2, 19, 'F');
    paint(rows, ground - 1, 20, 'S');
    const level = build(rows);
    const ctx: SimContext = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);

    placePair(
      world,
      8 * TILE + 12,
      pitFloor * TILE - PLAYER_H / 2 - 1,
      13 * TILE + 12,
      ground * TILE - PLAYER_H / 2 - 1,
    );

    const start = world.players[0].y;
    let highest = start;
    for (let t = 0; t < 400; t++) {
      step(ctx, world, [0, partnerWalks ? IN_RIGHT : 0]);
      world.events.length = 0;
      highest = Math.min(highest, world.players[0].y);
      if (world.restartTimer > 0) break;
    }
    tautPathLength(world, level);
    return { lifted: (start - highest) / TILE, bends: ropeContactCount() };
  }

  it('does nothing while the partner stands still', () => {
    expect(winch(false).lifted).toBeLessThan(0.5);
  });

  it('hauls a player several tiles up a pit when the partner walks away', () => {
    const result = winch(true);
    expect(result.bends).toBeGreaterThan(0);
    expect(result.lifted).toBeGreaterThan(3);
  });

  it('never exceeds the rope length by more than a correction step', () => {
    const rows = blank(24);
    paint(rows, 20, 2, '#'.repeat(36));
    for (let r = 14; r < 20; r++) paint(rows, r, 18, '##');
    paint(rows, 2, 19, 'F');
    paint(rows, 19, 8, 'S');
    const level = build(rows);
    const ctx: SimContext = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);
    const y = 20 * TILE - PLAYER_H / 2 - 1;
    placePair(world, 10 * TILE, y, 26 * TILE, y);
    let worst = 0;
    for (let t = 0; t < 300; t++) {
      step(ctx, world, [0, t % 60 < 30 ? IN_RIGHT : 0]);
      world.events.length = 0;
      worst = Math.max(worst, tautPathLength(world, level));
    }
    expect(worst).toBeLessThan(ROPE_MAX * 1.7);
  });
});
