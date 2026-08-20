import { describe, expect, it } from 'vitest';
import {
  CHUNKS,
  TILE,
  buildCampaign,
  buildTower,
  isSolidTile,
  tileAt,
  type ChunkDef,
  type Level,
  assembleLevel,
} from '@haulmates/core';
import { analyse, ledgeSteps, canMakeStep, verifyLevel } from '../../../scripts/verify-levels.mjs';

const GOAL_CHUNK = (c: ChunkDef): boolean => c.tags?.includes('goal') ?? false;
const START_CHUNK = (c: ChunkDef): boolean => c.tags?.includes('start') ?? false;

/** The shared landings every chunk must carry so any chunk stacks on any other. */
const TOP = { c0: 10, c1: 21 };
const BOTTOM = { c0: 18, c1: 29 };

describe('chunk library', () => {
  it('has a start chunk and a goal chunk', () => {
    expect(CHUNKS.filter(START_CHUNK)).toHaveLength(1);
    expect(CHUNKS.filter(GOAL_CHUNK)).toHaveLength(1);
  });

  it('gives every chunk a unique id', () => {
    const ids = new Set(CHUNKS.map((c) => c.id));
    expect(ids.size).toBe(CHUNKS.length);
  });

  it('makes every chunk exactly forty tiles wide with solid walls', () => {
    for (const chunk of CHUNKS) {
      for (const row of chunk.rows) {
        expect(row).toHaveLength(40);
        expect(row.slice(0, 2)).toBe('##');
        expect(row.slice(38)).toBe('##');
      }
    }
  });

  it('carries the shared landings that make chunks stackable', () => {
    for (const chunk of CHUNKS) {
      const h = chunk.rows.length;
      if (!GOAL_CHUNK(chunk)) {
        for (let c = TOP.c0; c <= TOP.c1; c++) expect(chunk.rows[1][c]).not.toBe('.');
        // The rows either side of a landing must be clear, or a player cannot
        // stand on it.
        for (const r of [0, 2]) {
          for (let c = 2; c < 38; c++) expect('.!:').toContain(chunk.rows[r][c]);
        }
      }
      if (!START_CHUNK(chunk)) {
        for (let c = BOTTOM.c0; c <= BOTTOM.c1; c++) expect(chunk.rows[h - 2][c]).not.toBe('.');
        for (const r of [h - 1, h - 3]) {
          for (let c = 2; c < 38; c++) expect('.!:').toContain(chunk.rows[r][c]);
        }
      }
    }
  });

  it('offsets the two landings so a seam can actually be climbed', () => {
    // A player cannot rise through a platform, so the landing above must not
    // sit directly over the one below.
    const launches: number[] = [];
    for (let x = TOP.c0; x <= TOP.c1; x++) {
      if ((x >= BOTTOM.c0 - 2 && x <= BOTTOM.c0 - 1) || (x >= BOTTOM.c1 + 1 && x <= BOTTOM.c1 + 2)) launches.push(x);
    }
    expect(launches.length).toBeGreaterThan(0);
  });
});

describe('assembled towers', () => {
  it('builds the campaign with a spawn, a goal and a checkpoint per chunk', () => {
    const level = buildCampaign();
    expect(level.w).toBe(40);
    expect(level.h).toBeGreaterThan(500);
    expect(level.checkpoints.length).toBeGreaterThanOrEqual(CHUNKS.length - 1);
    expect(level.goalY).toBeLessThan(level.spawnY);
    expect(level.chunkIds[0]).toBe('yard_start');
  });

  it('generates identical towers from identical seeds', () => {
    const a = buildTower(4242, 12);
    const b = buildTower(4242, 12);
    expect(a.id).toBe(b.id);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });

  it('generates different towers from different seeds', () => {
    expect(buildTower(1, 12).chunkIds).not.toEqual(buildTower(2, 12).chunkIds);
  });

  it('always begins with a start chunk and ends with a goal chunk', () => {
    for (let seed = 0; seed < 60; seed++) {
      const level = buildTower(seed * 7919 + 3, 10);
      expect(CHUNKS.find((c) => c.id === level.chunkIds[0])!.tags).toContain('start');
      expect(CHUNKS.find((c) => c.id === level.chunkIds[level.chunkIds.length - 1])!.tags).toContain('goal');
    }
  });

  it('never repeats the same chunk back to back', () => {
    for (let seed = 0; seed < 40; seed++) {
      const level = buildTower(seed * 104729 + 11, 16);
      for (let i = 1; i < level.chunkIds.length; i++) {
        expect(level.chunkIds[i]).not.toBe(level.chunkIds[i - 1]);
      }
    }
  });

  it('never places a hazard where the spawn is', () => {
    const level = buildCampaign();
    const tx = Math.floor(level.spawnX / TILE);
    const ty = Math.floor(level.spawnY / TILE);
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = tileAt(level, tx + dx, ty + dy);
        expect([3, 4, 5, 6, 7]).not.toContain(t);
        expect(isSolidTile(t)).toBe(false);
      }
    }
  });
});

/**
 * The load-bearing test in this file. A tower that cannot be climbed is not a
 * level, and neither eyeballing the ASCII art nor playing the first minute
 * will tell you. See scripts/verify-levels.mjs.
 */
describe('climbability', () => {
  it('lets a player reach the goal of the campaign', () => {
    const level: Level = buildCampaign();
    const result = analyse(level);
    expect(result.ok).toBe(true);
    // Effectively every foothold in the tower should be part of the climb.
    expect(result.reached / result.total).toBeGreaterThan(0.98);
  });

  it('replays every climbing step of the campaign in the real simulation', () => {
    const level = buildCampaign();
    const result = analyse(level);
    const steps = ledgeSteps(level, result.route, result.standable);
    expect(steps.length).toBeGreaterThan(100);
    const ctx = { level, seed: 1, mode: 0 };
    const unmakeable = steps.filter((s) => !canMakeStep(ctx, s.from, s.to));
    expect(
      unmakeable.map((s) => `row ${s.from.y} [${s.from.x0}-${s.from.x1}] -> row ${s.to.y} [${s.to.x0}-${s.to.x1}]`),
    ).toEqual([]);
  }, 240_000);

  it('lets a player reach the goal of every randomly generated tower', () => {
    for (let i = 0; i < 25; i++) {
      const seed = (i + 1) * 104729;
      const level = buildTower(seed, 4 + (i % 12));
      const result = analyse(level);
      expect(result.ok, `tower ${seed} is not climbable`).toBe(true);
      expect(result.reached / result.total).toBeGreaterThan(0.98);
    }
  }, 120_000);

  it('replays every climbing step of a sample of towers', () => {
    for (let i = 0; i < 3; i++) {
      const seed = (i + 1) * 31337;
      const level = buildTower(seed, 6);
      const outcome = verifyLevel(level, 1, seed);
      expect(outcome.failures ?? [], `tower ${seed}`).toEqual([]);
      expect(outcome.ok).toBe(true);
    }
  }, 240_000);
});

describe('the co-op reachability fill', () => {
  it('opens a pit that the solo fill cannot escape', () => {
    // An open-topped pit thirteen wide and six deep, with the spawn on one side
    // and the goal on the other. Too wide to jump, too deep to climb out of.
    const W = 40;
    const pitL = 14;
    const pitR = 26;
    const depth = 6;
    const ledgeRow = 6;
    const rows: string[] = [];
    for (let r = 0; r < ledgeRow + depth + 3; r++) {
      const a = new Array(W).fill('.');
      a[0] = '#';
      a[1] = '#';
      a[W - 2] = '#';
      a[W - 1] = '#';
      if (r >= ledgeRow && r < ledgeRow + depth) {
        for (let x = 2; x < W - 2; x++) if (x < pitL || x > pitR) a[x] = '#';
      } else if (r >= ledgeRow + depth) {
        a.fill('#');
      }
      rows.push(a.join(''));
    }
    const put = (r: number, c: number, ch: string): void => {
      const a = rows[r].split('');
      a[c] = ch;
      rows[r] = a.join('');
    };
    put(ledgeRow - 1, 5, 'S');
    put(ledgeRow - 1, 33, 'F');

    const level = assembleLevel('gate', 'GATE', [{ id: 'gate', biome: 0, difficulty: 1, rows }]);
    const solo = analyse(level);
    const coop = analyse(level, { coop: true });

    expect(solo.ok, 'one player alone should be stuck in the pit').toBe(false);
    expect(coop.ok, 'the rope climb should open it').toBe(true);

    let ropeOnly = 0;
    for (let i = 0; i < solo.seen.length; i++) {
      if (coop.seen[i] !== -1 && solo.seen[i] === -1) ropeOnly++;
    }
    expect(ropeOnly).toBeGreaterThan(0);
  });

  it('agrees with the solo fill on the shipped campaign, which uses no rope', () => {
    // Documented rather than aspirational: the campaign contains no geometry
    // that needs a rope, and this test will start failing the moment it does —
    // which is the point at which someone should come and update it.
    const level = buildCampaign();
    const solo = analyse(level);
    const coop = analyse(level, { coop: true });
    expect(solo.ok).toBe(true);
    expect(coop.reached).toBe(solo.reached);
  });
});
