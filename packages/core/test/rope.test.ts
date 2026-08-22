import { describe, expect, it } from 'vitest';
import {
  BRACED_LOAD_SHARE,
  Bot,
  EV_GRIP,
  EV_GRIP_FAIL,
  EV_REEL,
  GRIP_MAX,
  LocalMatch,
  MODE_GAUNTLET,
  IN_RIGHT,
  PLAYER_H,
  PLAYER_HALF_W,
  ROPE_MAX,
  ROPE_NODES,
  ROPE_REST,
  TILE,
  applyRopeLoad,
  assembleLevel,
  buildCampaign,
  createWorld,
  ropeContactCount,
  step,
  tautPathLength,
  type ChunkDef,
  type Level,
  type SimContext,
  type World,
  MODE_HAUL,
  IN_GRIP,
  IN_REEL,
  cloneWorld,
  IN_LEFT,
  REEL_MAX_SPEED,
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

describe('climbing out of a pit', () => {
  /**
   * A ledge on the left, a shaft on the right with a real wall and a floor.
   * Walking right off the ledge drops you in; the drop is deeper than a jump,
   * so the only way out is the rope and the person holding it.
   */
  function pitLevel(depth: number): Level {
    const W = 40;
    const LIP = 8;
    const FLOOR = LIP + depth;
    const rows: string[] = [];
    for (let r = 0; r <= FLOOR; r++) {
      const a = new Array(W).fill('.');
      a[0] = '#';
      a[W - 1] = '#';
      if (r >= LIP) for (let x = 1; x <= 13; x++) a[x] = '#';
      if (r === FLOOR) a.fill('#');
      rows.push(a.join(''));
    }
    const put = (r: number, c: number, ch: string): void => {
      const a = rows[r].split('');
      a[c] = ch;
      rows[r] = a.join('');
    };
    put(LIP - 1, 4, 'S');
    put(1, 20, 'F');
    return assembleLevel('pit', 'PIT', [{ id: 'pit', biome: 0, difficulty: 0, rows }]);
  }

  function dropOneIn(ctx: SimContext): { world: World; lipY: number } {
    const world = createWorld(ctx);
    const lipY = 8 * TILE - PLAYER_H / 2 - 1;
    world.players[0].x = 11 * TILE + 12;
    world.players[1].x = 13 * TILE + 12;
    for (const p of world.players) {
      p.y = lipY;
      p.vx = 0;
      p.vy = 0;
      p.grounded = 1;
      p.grip = GRIP_MAX;
    }
    for (let i = 0; i < ROPE_NODES; i++) {
      const t = i / (ROPE_NODES - 1);
      world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
      world.ropeY[i] = lipY;
      world.ropePX[i] = world.ropeX[i];
      world.ropePY[i] = lipY;
    }
    // One of them walks off the edge; the rope drapes over the lip on the way.
    for (let t = 0; t < 120; t++) step(ctx, world, [IN_GRIP, IN_RIGHT]);
    for (let t = 0; t < 40; t++) step(ctx, world, [IN_GRIP, 0]);
    return { world, lipY };
  }

  for (const depth of [5, 7, 10]) {
    it(`is impossible alone and possible together, ${depth} tiles deep`, () => {
      const level = pitLevel(depth);
      const ctx: SimContext = { level, seed: 1, mode: MODE_HAUL };

      const { world, lipY } = dropOneIn(ctx);
      expect(world.players[1].y, 'the hauler should be down the pit').toBeGreaterThan(lipY + 3 * TILE);

      // Both in the hole: nothing above to haul against, so nobody gets out.
      // A partner merely *standing* up top is enough to reel against — GRIP
      // only makes them immovable — so the rule the geometry enforces is not
      // "one of you must brace", it is "do not both go in".
      const sunk = cloneWorld(world);
      for (let t = 0; t < 90; t++) step(ctx, sunk, [IN_RIGHT, 0]);
      expect(sunk.players[0].y, 'both should be down the pit').toBeGreaterThan(lipY + 3 * TILE);
      for (let t = 0; t < 600; t++) step(ctx, sunk, [IN_REEL | IN_LEFT, IN_REEL | IN_LEFT]);
      for (const p of sunk.players) {
        expect(p.y, 'neither should climb out with nobody up top').toBeGreaterThan(lipY + TILE);
      }

      // Together: one braces on the lip, the other reels up the wall and over.
      let escapedAt = -1;
      for (let t = 0; t < 600 && escapedAt < 0; t++) {
        step(ctx, world, [IN_GRIP, IN_REEL | IN_LEFT]);
        const p = world.players[1];
        if (p.grounded === 1 && p.y < lipY + 6) escapedAt = t;
      }
      expect(escapedAt, 'the pair should get them out').toBeGreaterThanOrEqual(0);
      expect(escapedAt, 'and it should not take all day').toBeLessThan(400);
    });
  }

  /**
   * Reeling is one of the four verbs and it made no sound, which left the
   * longest manoeuvre in the game — a partner hauling themselves out of a pit
   * over several seconds — with nothing to say it was working. The event
   * carries the speed the rope is actually coming in at, because a haul that
   * is barely moving and a haul that is flying are the two things the player
   * most needs told apart.
   */
  it('reports the winch running, and how fast', () => {
    const level = pitLevel(7);
    const ctx: SimContext = { level, seed: 1, mode: MODE_HAUL };
    const { world } = dropOneIn(ctx);

    let reels = 0;
    let fastest = 0;
    for (let t = 0; t < 300; t++) {
      world.events.length = 0;
      step(ctx, world, [IN_GRIP, IN_REEL | IN_LEFT]);
      for (const e of world.events) {
        if (e.kind !== EV_REEL) continue;
        reels++;
        expect(e.a, 'the hauler doing the hauling').toBe(1);
        fastest = Math.max(fastest, Math.abs(e.b));
      }
    }
    expect(reels, 'a rescue this long should keep saying so').toBeGreaterThan(10);
    expect(fastest, 'and should say how fast it is going').toBeGreaterThan(20);
    expect(fastest, 'within the speed the winch can reach').toBeLessThanOrEqual(REEL_MAX_SPEED * 1.5);
  });
})

describe('the rope holds its own length', () => {
  /**
   * The crate used to stretch it to seven times its maximum.
   *
   * `updateCargo` runs after `solveRope` and hauls the middle node seventy per
   * cent of the way toward the crate every tick. With the crate unable to move
   * — it was buried in the floor — the middle walked toward it a little
   * further every tick, for ever. Measured: a 232-pixel rope reached 1727,
   * while `tautPathLength` reported a comfortable 165, because that function
   * string-pulls between the two haulers and never sees the sag. The crate was
   * forty-six tiles below a pair who had not noticed.
   *
   * Nothing caught it. The rope is drawn from its own nodes, so it looked like
   * a rope; the length constraint is measured hauler-to-hauler, so it read as
   * slack; and the one number that would have shown it was the one nobody
   * computed.
   *
   * A Verlet rope solved with a handful of Gauss-Seidel passes always sits a
   * little over its constraint, so the bar is a ratio rather than the limit
   * itself. Measured at 1.17 and 1.36 across four levels of two-minute bot
   * runs; 1.6 sits clear of both, and nowhere near the failure it is here to
   * catch.
   */
  it('does not stretch without limit when the crate cannot follow', () => {
    for (const [mode, seed] of [
      [MODE_HAUL, 7],
      [MODE_GAUNTLET, 33],
      [MODE_GAUNTLET, 555],
    ] as const) {
      const match = new LocalMatch(mode, seed, 10);
      match.setBot(0, new Bot(match.ctx.level));
      match.setBot(1, new Bot(match.ctx.level));
      const w = match.world;
      let worst = 0;
      for (let t = 0; t < 90 * 60; t++) {
        match.update(1000 / 60, [0, 0]);
        match.events.length = 0;
        let poly = 0;
        for (let i = 1; i < ROPE_NODES; i++) {
          const dx = w.ropeX[i] - w.ropeX[i - 1];
          const dy = w.ropeY[i] - w.ropeY[i - 1];
          poly += Math.sqrt(dx * dx + dy * dy);
        }
        if (poly > worst) worst = poly;
      }
      expect(worst / ROPE_MAX, `mode ${mode} seed ${seed}: worst rope length`).toBeLessThan(1.6);
    }
  });
});


/**
 * A brace that gives out is the moment a rescue fails, and it used to happen
 * in complete silence: the stamina ring simply stopped being drawn. It is
 * presentation, so it is an event — `pushEvent` only, never state, so a
 * rollback that drops it cannot desync anything.
 */
describe('the hands going', () => {
  /** One hauler clinging to a wall by their fingertips with an empty bar. */
  function clinging(grip: number): { ctx: SimContext; world: World } {
    const rows = blank(24);
    paint(rows, 20, 2, '#'.repeat(36));
    paint(rows, 2, 19, 'F');
    paint(rows, 19, 8, 'S');
    const level = build(rows);
    const ctx: SimContext = { level, seed: 1, mode: MODE_HAUL };
    const world = createWorld(ctx);
    const floor = 20 * TILE - PLAYER_H / 2 - 1;
    // Shoulder against the left wall, feet in mid-air: the one anchor that
    // costs full stamina, so the bar empties in a handful of ticks.
    placePair(world, 2 * TILE + PLAYER_HALF_W + 1, 10 * TILE, 10 * TILE, floor);
    world.players[0].grounded = 0;
    world.players[0].grip = grip;
    return { ctx, world };
  }

  it('is announced once, when the bar runs out', () => {
    const { ctx, world } = clinging(4);
    let failures = 0;
    // Short of GRIP_REGEN_DELAY after the fall, so what is being counted is
    // one brace ending rather than the player grabbing on again.
    for (let t = 0; t < 30; t++) {
      world.events.length = 0;
      step(ctx, world, [IN_GRIP, 0]);
      failures += world.events.filter((e) => e.kind === EV_GRIP_FAIL).length;
    }
    expect(world.players[0].gripping, 'the brace should be gone').toBe(0);
    expect(failures, 'and said so exactly once').toBe(1);
  });

  it('stays quiet when a hauler lets go on purpose', () => {
    const { ctx, world } = clinging(GRIP_MAX);
    let failures = 0;
    let grabs = 0;
    for (let t = 0; t < 30; t++) {
      world.events.length = 0;
      step(ctx, world, [t < 15 ? IN_GRIP : 0, 0]);
      failures += world.events.filter((e) => e.kind === EV_GRIP_FAIL).length;
      grabs += world.events.filter((e) => e.kind === EV_GRIP).length;
    }
    expect(grabs, 'they did grab on').toBe(1);
    expect(world.players[0].gripping, 'and did let go').toBe(0);
    expect(failures, 'nobody failed at anything').toBe(0);
  });
});

describe('an anchor holds the line', () => {
  /**
   * What a brace is for, from the other end of the rope.
   *
   * The elastic haul used to be applied at full strength whether the far end
   * was dug in or being towed along the floor, so asking your partner to hold
   * on did nothing for the person doing the asking. Sixteen simulated pairs
   * given three minutes of the campaign each measured the reflex the game
   * teaches as costing 20 rows and most of a checkpoint against never bracing
   * at all.
   */
  it('pulls a runner back less hard than a partner who is being dragged', () => {
    const pull = (braced: boolean): number => {
      const level = buildCampaign();
      const ctx = { level, seed: 1, mode: MODE_HAUL };
      const world = createWorld(ctx);
      const [a, b] = world.players;
      // Far enough apart that the rope is genuinely loaded, and level, so the
      // only thing separating the two runs is whether the far end is anchored.
      a.x = b.x + ROPE_REST * 1.4;
      a.y = b.y;
      for (let i = 0; i < ROPE_NODES; i++) {
        const t = i / (ROPE_NODES - 1);
        world.ropeX[i] = b.x + (a.x - b.x) * t;
        world.ropeY[i] = a.y;
        world.ropePX[i] = world.ropeX[i];
        world.ropePY[i] = world.ropeY[i];
      }
      b.gripping = braced ? 1 : 0;
      b.grounded = 1;
      a.vx = 0;
      applyRopeLoad(world);
      return -a.vx;
    };
    const towed = pull(false);
    const anchored = pull(true);
    expect(towed, 'a loaded rope hauls on you').toBeGreaterThan(0);
    expect(anchored / towed).toBeCloseTo(BRACED_LOAD_SHARE, 5);
  });
});
