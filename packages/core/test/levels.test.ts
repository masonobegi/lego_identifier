import { describe, expect, it } from 'vitest';
import {
  CHUNKS,
  TILE,
  buildCampaign,
  buildTower,
  MAX_RISE,
  isDeadlyTile,
  isSolidTile,
  levelFloors,
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

  it('overlaps the two landings so a seam can be jumped straight up', () => {
    // This used to assert the opposite — that the landings were *offset*,
    // because you cannot rise through rock and so had to stand clear of the
    // thing you were climbing onto. Footholds are one-way platforms now, and
    // the overlap is the point: the columns where the two landings sit above
    // one another are the columns a seam can be crossed from without any
    // sideways component at all, which is the most forgiving move in the game.
    const overlap = Math.min(TOP.c1, BOTTOM.c1) - Math.max(TOP.c0, BOTTOM.c0) + 1;
    expect(overlap).toBeGreaterThanOrEqual(3);
  });

  it('makes every seam landing a platform you can pass up through', () => {
    for (const chunk of CHUNKS) {
      const top = chunk.rows[1];
      const bottom = chunk.rows[chunk.rows.length - 2];
      const goal = GOAL_CHUNK(chunk);
      const start = START_CHUNK(chunk);
      for (let x = Math.max(TOP.c0, BOTTOM.c0); x <= Math.min(TOP.c1, BOTTOM.c1); x++) {
        // The goal chunk caps the tower and the start chunk sits on the
        // ground, so each is missing the landing nobody climbs through.
        if (!goal) expect(top[x]).toBe('=');
        if (!start) expect(bottom[x]).toBe('=');
      }
    }
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

  it('counts its floors off the stack, not off the height that was asked for', () => {
    // The Gauntlet achievements are a claim about a tower somebody climbed.
    // The requested height is a request: clamped here, overruled by whoever
    // hosts, and still sitting on the menu slider long after the run it
    // described ended.
    for (const floors of [3, 10, 20]) expect(levelFloors(buildTower(31337, floors))).toBe(floors);
    expect(levelFloors(buildTower(31337, 400))).toBe(60);
    expect(levelFloors(buildCampaign())).toBe(CHUNKS.length - 2);
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
describe('danger', () => {
  it('puts hazards where the climb actually goes', () => {
    // The tower was 92.7% plain concrete and every hazard in it was painted by
    // a helper that refuses to touch the route, so you could climb the entire
    // campaign without passing within a tile of anything that could hurt you.
    // The level gate could not see that: a level with no hazards at all passes
    // "is it climbable" perfectly. So the danger is measured here instead.
    const level = buildCampaign();
    const r = analyse(level, { coop: true });
    const steps = ledgeSteps(level, r.route, r.standable);
    let hot = 0;
    for (const step of steps) {
      let danger = false;
      for (let x = step.from.x0 - 1; x <= step.from.x1 + 1 && !danger; x++) {
        for (let dy = -1; dy <= 2; dy++) {
          if (isDeadlyTile(tileAt(level, x, step.from.y + dy))) danger = true;
        }
      }
      if (danger) hot++;
    }
    expect(hot / steps.length).toBeGreaterThan(0.15);
  });
});

describe('climbability', () => {
  it('lets a pair reach the goal of the campaign', () => {
    const level: Level = buildCampaign();
    const result = analyse(level, { coop: true });
    expect(result.ok).toBe(true);
    // Effectively every foothold in the tower should be part of the climb.
    expect(result.reached / result.total).toBeGreaterThan(0.98);
  });

  it('replays every climbing step of the campaign in the real simulation', () => {
    const level = buildCampaign();
    const result = analyse(level, { coop: true });
    const steps = ledgeSteps(level, result.route, result.standable);
    expect(steps.length).toBeGreaterThan(100);
    const ctx = { level, seed: 1, mode: 0 };
    // Gates are two-person moves and have their own replay in verifyLevel;
    // this one is about the ordinary jumps between them.
    const unmakeable = steps
      .filter((s) => s.from.y - s.to.y <= MAX_RISE)
      .filter((s) => !canMakeStep(ctx, s.from, s.to));
    expect(
      unmakeable.map((s) => `row ${s.from.y} [${s.from.x0}-${s.from.x1}] -> row ${s.to.y} [${s.to.x0}-${s.to.x1}]`),
    ).toEqual([]);
  }, 240_000);

  it('lets a pair reach the goal of every randomly generated tower, and nobody alone', () => {
    for (let i = 0; i < 25; i++) {
      const seed = (i + 1) * 104729;
      const level = buildTower(seed, 4 + (i % 12));
      const result = analyse(level, { coop: true });
      expect(result.ok, `tower ${seed} is not climbable`).toBe(true);
      expect(analyse(level).ok, `tower ${seed} is climbable alone`).toBe(false);
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

  it('disagrees with the solo fill, because the campaign now needs two people', () => {
    // This test used to assert the opposite, and said so cheerfully: "the
    // campaign contains no geometry that needs a rope, and this test will start
    // failing the moment it does". It was the most useful line in the suite. A
    // game called "a two-player co-op disaster about a rope" had a passing test
    // recording that one player could climb all of it, and nobody had gone back
    // to update the test because nobody had made it false.
    //
    // It is false now. See BOOST_SCALE and gate() for what had to change, and
    // *The second player was cargo with opinions* in docs/DESIGN.md for the
    // measurement that showed a rope alone can never do it.
    const level = buildCampaign();
    const solo = analyse(level);
    const coop = analyse(level, { coop: true });
    expect(solo.ok, 'one player finishes the campaign').toBe(false);
    expect(coop.ok, 'two players finish the campaign').toBe(true);
    expect(coop.reached).toBeGreaterThan(solo.reached * 2);
  });
});

describe('structural variety', () => {
  it('gives every chunk its own silhouette', () => {
    // Six of the twenty chunks were once byte-identical geometry wearing
    // different decorations, because every one of them called climb() with the
    // same width and step and only the direction varied. A player climbing the
    // campaign saw the same room a third of the time.
    const shape = (c: ChunkDef): string =>
      c.rows.map((r) => r.replace(/[^#=]/g, '.').replace(/[#=]/g, '#')).join('|');
    const seen = new Map<string, string[]>();
    for (const c of CHUNKS) {
      const key = shape(c);
      const ids = seen.get(key);
      if (ids) ids.push(c.id);
      else seen.set(key, [c.id]);
    }
    const duplicates = [...seen.values()].filter((ids) => ids.length > 1);
    expect(duplicates, `identical geometry: ${JSON.stringify(duplicates)}`).toEqual([]);
    expect(seen.size).toBe(CHUNKS.length);
  });

  it('varies platform width across the library', () => {
    // The lever that produces the variety. If someone flattens these back to a
    // single width the shapes collapse again, and this catches it.
    const widths = new Set<number>();
    for (const c of CHUNKS) {
      for (const row of c.rows) {
        for (const run of row.split(/[^#=]+/)) if (run.length > 3 && run.length < 20) widths.add(run.length);
      }
    }
    expect(widths.size).toBeGreaterThanOrEqual(4);
  });
});
