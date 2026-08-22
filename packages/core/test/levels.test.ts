import { describe, expect, it } from 'vitest';
import {
  CHUNKS,
  ROPE_MAX,
  TILE,
  T_PLATE,
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
import { analyse, canHaulCrate, canMakeStep, crateFinishes, ledgeSteps, verifyLevel } from '../../../scripts/verify-levels.mjs';

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
  /**
   * The campaign must not be the whole library.
   *
   * It was: `buildCampaign` was handed `CHUNKS` and the two were byte-identical
   * in the same order, so finishing The Long Haul once showed a player 100% of
   * the rooms in the game, and the Gauntlet and the daily could never afterwards
   * put a floor in front of them they had not already climbed. Every reason to
   * open the game a second evening rested on rooms that did not exist.
   */
  it('keeps rooms back that the campaign never opens', () => {
    const played = new Set(buildCampaign().chunkIds);
    const held = CHUNKS.filter((c) => !played.has(c.id));
    expect(held.length, 'rooms the Gauntlet can show that the campaign cannot').toBeGreaterThanOrEqual(12);
    // And they have to be reachable from the mode that is supposed to show
    // them: held back from the campaign, not held back from the game.
    const seen = new Set<string>();
    for (let i = 1; i <= 400; i++) for (const id of buildTower(i * 7919, 10).chunkIds) seen.add(id);
    const orphans = held.filter((c) => !seen.has(c.id));
    expect(orphans.map((c) => c.id), 'rooms no mode can ever draw').toEqual([]);
  });

  it('builds the campaign with a spawn, a goal and a checkpoint per chunk', () => {
    const level = buildCampaign();
    expect(level.w).toBe(40);
    expect(level.h).toBeGreaterThan(500);
    expect(level.checkpoints.length).toBeGreaterThanOrEqual(level.chunkIds.length - 1);
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
    const campaign = buildCampaign();
    expect(levelFloors(campaign)).toBe(campaign.chunkIds.length - 2);
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

  /**
   * The replay, but not the solo search that runs beside it in the build gate.
   *
   * `soloCanCross` throws five and a half thousand scripted attempts and
   * fifteen hundred random ones at every gate, in the real simulation, and the
   * library is built around seventy-one two-person moments now where it had
   * seven. It is the single most valuable check in the repo and it does not
   * belong in a unit test: three towers of it ran for over an hour here, on one
   * core, inside a runner that cannot interrupt a synchronous body however
   * generous the timeout — so the suite stopped being runnable and a suite
   * nobody runs catches nothing.
   *
   * It runs in `npm run verify:levels`, on the campaign and twelve towers
   * rather than three, spread across every core. This keeps the half that is
   * cheap: that every step of a generated tower can actually be climbed by a
   * pair and the crate brought up after them.
   */
  it('replays every climbing step of a sample of towers', () => {
    for (let i = 0; i < 3; i++) {
      const seed = (i + 1) * 31337;
      const level = buildTower(seed, 6);
      const outcome = verifyLevel(level, 1, seed, { solo: false });
      expect(outcome.failures ?? [], `tower ${seed}`).toEqual([]);
      expect(outcome.ok).toBe(true);
    }
  }, 240_000);
});

/**
 * The other half of a climbable tower, and the half nothing used to look at.
 *
 * Every check above judges a step by where a hauler's feet end up. The run does
 * not end at anybody's feet: it ends when the crate reaches the goal. A tower
 * whose route a pair can climb but whose load cannot follow them is a tower
 * that passes every gate in the repo and cannot be finished.
 */
describe('hauling the crate', () => {
  it('brings the crate up every climbing step of the campaign', () => {
    const level = buildCampaign();
    const result = analyse(level, { coop: true });
    const steps = ledgeSteps(level, result.route, result.standable);
    const ctx = { level, seed: 1, mode: 0 };
    const stranded = steps
      .filter((s) => !canHaulCrate(ctx, s.from, s.to))
      .map((s) => `row ${s.from.y} -> row ${s.to.y}`);
    expect(stranded).toEqual([]);
  }, 120_000);

  /**
   * A ceiling with a hole in it exactly one column wide.
   *
   * Twenty-six pixels of crate in a twenty-four pixel tile: the pair go up
   * through it and their load does not, which is the same arithmetic that
   * decides how wide a shutter has to be. One column is the failing case and
   * two is the passing one, so this pins the check to the geometry rather than
   * to whether the search happened to find a way.
   */
  const pinched = (holeCols: number): Level => {
    const rows: string[] = [];
    for (let r = 0; r < 18; r++) {
      let s = '';
      for (let c = 0; c < 40; c++) {
        if (c < 2 || c >= 38) s += '#';
        else if (r === 13) s += '#';
        else if (r === 10) s += c >= 20 && c < 20 + holeCols ? '.' : '#';
        else if (r <= 1) s += '#';
        else s += '.';
      }
      rows.push(s);
    }
    const put = (r: number, c: number, glyph: string): void => {
      rows[r] = rows[r].slice(0, c) + glyph + rows[r].slice(c + 1);
    };
    put(12, 5, 'S');
    put(9, 30, 'F');
    return assembleLevel('pinch', 'PINCH', [{ id: 'pinch', biome: 0, difficulty: 0, rows, tags: ['start'] }]);
  };

  it('reports a step the crate cannot fit through, and passes the one it can', () => {
    const from = { y: 12, x0: 2, x1: 37 };
    const to = { y: 9, x0: 2, x1: 37 };
    expect(canHaulCrate({ level: pinched(1), seed: 1, mode: 0 }, from, to), 'a one-column hole').toBe(false);
    expect(canHaulCrate({ level: pinched(2), seed: 1, mode: 0 }, from, to), 'a two-column hole').toBe(true);
  }, 60_000);

  it('ends the run when the pair arrive at the goal with the crate', () => {
    for (const level of [buildCampaign(), buildTower(104729, 6), buildTower(31337, 8)]) {
      const result = analyse(level, { coop: true });
      expect(crateFinishes({ level, seed: 1, mode: 0 }, level, result), level.id).toBe(null);
    }
  }, 60_000);

  /**
   * A goal band wider than the crate's leash.
   *
   * `pairAtGoal` asks whether each hauler is touching any goal tile;
   * `cargoAtGoal` asks how far the crate is from `level.goalX`, which is the
   * first goal tile the builder saw. The crate is tethered to the middle of a
   * rope that cannot exceed its own length, so on a wide enough band a pair
   * can stand on the finish, with their load at their feet, and the run does
   * not end and never will. Twelve columns is enough; the shipped goal is six
   * and leaves 35 px of the allowance spare at its far end.
   */
  it('reports a goal the crate cannot be brought across', () => {
    const rows: string[] = [];
    for (let r = 0; r < 10; r++) {
      let s = '';
      for (let c = 0; c < 40; c++) {
        if (c < 2 || c >= 38) s += '#';
        else if (r === 6) s += '#';
        else if (r === 4 && c >= 10 && c < 22) s += 'F';
        else if (r <= 1) s += '#';
        else s += '.';
      }
      rows.push(s);
    }
    rows[5] = `${rows[5].slice(0, 5)}S${rows[5].slice(6)}`;
    const level = assembleLevel('wide', 'WIDE', [{ id: 'wide', biome: 0, difficulty: 0, rows, tags: ['start'] }]);
    const result = analyse(level, { coop: true });
    expect(result.ok).toBe(true);
    expect(crateFinishes({ level, seed: 1, mode: 0 }, level, result)).toMatch(/does not end/);
  });
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

/**
 * The rooms built around the second co-op verb.
 *
 * A hold is two plates with a shutter between them, and every part of that is
 * load-bearing. A door narrower than the crate is one the pair cannot take
 * their cargo through, and the crate hangs off the middle of the rope, so
 * leaving it behind is not on offer. A door shorter than a jump is scenery. A
 * door with one plate is a wall, because whoever holds it can never be the one
 * who goes through.
 *
 * None of that is visible to anything else in this file: the route past a shut
 * door is still a legal staircase of three row steps, so the generator, the
 * fill and the replay all walk it happily. These are the checks that the rooms
 * are rooms.
 */
describe('the hold rooms', () => {
  const HOLD = (c: ChunkDef): boolean => c.tags?.includes('hold') ?? false;
  const SPARE = (c: ChunkDef): boolean => c.tags?.includes('spare') ?? false;
  const FOOTING = '#=icC_';

  /** Where a chunk's shutter stands, and where its plates are. */
  const holdOf = (c: ChunkDef) => {
    const shutter: { r: number; x: number }[] = [];
    const plates: { r: number; x: number }[] = [];
    c.rows.forEach((row, r) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 'H') shutter.push({ r, x });
        if (row[x] === '_') plates.push({ r, x });
      }
    });
    const cols = [...new Set(shutter.map((t) => t.x))].sort((a, b) => a - b);
    const rows = shutter.map((t) => t.r);
    return { plates, cols, top: Math.min(...rows), bottom: Math.max(...rows) };
  };

  const rooms = CHUNKS.filter(HOLD);

  it('puts one in every biome, and in both the campaign and the Gauntlet', () => {
    expect(new Set(rooms.map((c) => c.biome))).toEqual(new Set([0, 1, 2, 3]));
    expect(rooms.filter((c) => !SPARE(c)).length).toBeGreaterThanOrEqual(3);
    expect(rooms.filter(SPARE).length).toBeGreaterThanOrEqual(3);
  });

  it('makes every doorway wide enough for the crate and taller than a jump', () => {
    for (const c of rooms) {
      const { cols, top, bottom } = holdOf(c);
      // 26px of crate in a 24px tile, so one column is a door the pair fit
      // through and their cargo does not.
      expect(cols.length, `${c.id}: doorway columns`).toBeGreaterThanOrEqual(2);
      expect(cols[cols.length - 1] - cols[0], `${c.id}: doorway is in one piece`).toBe(cols.length - 1);
      // A plain jump rises 4.50 tiles. Four tiles of door is one somebody
      // eventually hops; five is not.
      expect(bottom - top + 1, `${c.id}: doorway height`).toBeGreaterThanOrEqual(5);
      for (const x of cols) {
        expect(FOOTING, `${c.id}: the doorway has no floor under it at column ${x}`).toContain(
          c.rows[bottom + 1][x],
        );
        for (let r = top; r <= bottom; r++) {
          expect(c.rows[r][x], `${c.id}: a hole in the door at row ${r}`).toBe('H');
        }
      }
    }
  });

  it('puts a plate on each side of every shutter, within a rope of each other', () => {
    for (const c of rooms) {
      const { plates, cols } = holdOf(c);
      const near = plates.filter((p) => p.x < cols[0]);
      const far = plates.filter((p) => p.x > cols[cols.length - 1]);
      expect(near.length, `${c.id}: no plate on the near side`).toBeGreaterThan(0);
      expect(far.length, `${c.id}: no plate on the far side`).toBeGreaterThan(0);
      // One hauler holds the near plate at the moment the other reaches the far
      // one, and the rope between them is fixed. Further apart than that and the
      // door opens once and never lets the second one through.
      const reach = Math.min(
        ...near.map((a) => Math.min(...far.map((b) => Math.hypot(a.x - b.x, a.r - b.r)))),
      );
      expect(reach * TILE, `${c.id}: the two plates are ${reach.toFixed(1)} tiles apart`).toBeLessThan(
        ROPE_MAX,
      );
    }
  });

  /**
   * Both plates on the floor the door is in, which is not a stylistic choice.
   *
   * The leapfrog is a walk: one hauler stands on a plate and the other walks
   * through a door that would otherwise be a wall. Put the near plate on the
   * foothold below the door instead and the hauler holding it has to jump to
   * follow their partner through, which is not a walk and not something the
   * pair can do in the order the room asks for. Worse, the crate hangs a rope's
   * length under the pair, so a plate one step below the door is exactly where
   * it comes to rest: one hauler alone then strolls through a door the crate is
   * holding open for them.
   */
  it('stands both plates on the floor the door is in', () => {
    for (const c of rooms) {
      const { plates, bottom } = holdOf(c);
      for (const p of plates) {
        expect(p.r, `${c.id}: the plate at column ${p.x} is not on the door's own floor`).toBe(
          bottom + 1,
        );
      }
    }
  });

  it('leaves every plate somewhere a hauler can stand', () => {
    for (const c of rooms) {
      for (const p of holdOf(c).plates) {
        // A hauler is 32px tall in a 24px tile, so both tiles above a plate are
        // body. A plate under a spike is a plate nobody holds.
        for (const r of [p.r - 1, p.r - 2]) {
          expect(c.rows[r][p.x], `${c.id}: plate at ${p.x},${p.r} has ${c.rows[r][p.x]} over it`).toMatch(
            /[.:]/,
          );
        }
      }
    }
  });

  it('gives every room its own door, however the tower is stacked', () => {
    const level = buildCampaign();
    const used = level.chunkIds.filter((id) => HOLD(CHUNKS.find((c) => c.id === id) as ChunkDef));
    expect(used.length).toBeGreaterThan(0);
    expect(level.holdGroups, 'one hold group per room that has one').toBe(used.length);
    for (let g = 0; g < level.holdGroups; g++) {
      const plates: number[] = [];
      const shutters: number[] = [];
      for (let i = 0; i < level.holdGroup.length; i++) {
        if (level.holdGroup[i] !== g) continue;
        (level.tiles[i] === T_PLATE ? plates : shutters).push(i % level.w);
      }
      expect(Math.min(...plates), `group ${g} has no plate on the near side`).toBeLessThan(
        Math.min(...shutters),
      );
      expect(Math.max(...plates), `group ${g} has no plate on the far side`).toBeGreaterThan(
        Math.max(...shutters),
      );
    }
  });
});
