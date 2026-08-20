import { describe, expect, it } from 'vitest';
import {
  CARGO_H,
  CARGO_W,
  GRIP_MAX,
  MODE_GAUNTLET,
  MODE_HAUL,
  ROPE_NODES,
  TILE,
  Bot,
  LocalMatch,
  isSolidTile,
  step,
} from '../src/index.js';
import type { CargoState, Level } from '../src/index.js';

/**
 * Is any part of the crate inside a solid tile?
 *
 * Inset by two pixels on each side so that a crate resting exactly on a floor,
 * or pressed flat against a wall, does not read as buried. Anything deeper than
 * that genuinely is inside the geometry.
 */
function buried(level: Level, c: CargoState): boolean {
  const hw = CARGO_W / 2 - 2;
  const hh = CARGO_H / 2 - 2;
  for (const [ox, oy] of [
    [-hw, -hh],
    [hw, -hh],
    [-hw, hh],
    [hw, hh],
    [0, 0],
  ]) {
    const tx = Math.floor((c.x + ox) / TILE);
    const ty = Math.floor((c.y + oy) / TILE);
    if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) continue;
    if (isSolidTile(level.tiles[ty * level.w + tx])) return true;
  }
  return false;
}

describe('the crate', () => {
  /**
   * The bug this catches was silent, total, and had been there the whole time.
   *
   * The crate was placed twenty-two pixels below the rope's *sagging* mid node,
   * and the rope rests in a slack arc, so in the campaign the crate spawned two
   * rows into the floor: rows 648, 649 and 650 all solid, crate at 649.5. A
   * body inside geometry cannot be swept anywhere — every direction is blocked
   * — so it never moved again. The tether hauled at it for the entire run with
   * nothing to show for it, the rope stretched to seven times its own length
   * trying, and the pair happily climbed forty-four rows and left it behind.
   *
   * Nothing failed. No test went red, no assertion fired, the crate rendered
   * perfectly well sitting in the rock. The game named after hauling a crate
   * had simply never hauled one.
   */
  it('does not spawn inside the level', () => {
    for (const [mode, seeds] of [
      [MODE_HAUL, [7]],
      [MODE_GAUNTLET, [11, 33, 101, 2024, 555]],
    ] as const) {
      for (const seed of seeds) {
        const match = new LocalMatch(mode, seed, 10);
        expect(buried(match.ctx.level, match.world.cargo), `mode ${mode} seed ${seed}`).toBe(false);
      }
    }
  });

  it('is never swept into the geometry while it is being hauled', () => {
    const match = new LocalMatch(MODE_HAUL, 7, 10);
    match.setBot(0, new Bot(match.ctx.level));
    match.setBot(1, new Bot(match.ctx.level));
    let stuck = 0;
    for (let t = 0; t < 60 * 60; t++) {
      match.update(1000 / 60, [0, 0]);
      match.events.length = 0;
      if (buried(match.ctx.level, match.world.cargo)) stuck++;
    }
    expect(stuck, 'ticks with the crate inside solid tiles').toBe(0);
  });

  it('is hauled up the tower rather than left at the bottom of it', () => {
    const match = new LocalMatch(MODE_HAUL, 7, 10);
    match.setBot(0, new Bot(match.ctx.level));
    match.setBot(1, new Bot(match.ctx.level));

    const startPair = (match.world.players[0].y + match.world.players[1].y) / 2;
    let sum = 0;
    let worst = 0;
    const ticks = 90 * 60;
    for (let t = 0; t < ticks; t++) {
      match.update(1000 / 60, [0, 0]);
      match.events.length = 0;
      // How far below the pair the crate is trailing, in rows. Measured as a
      // gap rather than as distance climbed on purpose: a checkpoint reset
      // teleports the crate up the tower with everything else, so "the crate
      // ended up higher than it started" is satisfied by a crate that was
      // never hauled an inch.
      const w = match.world;
      const lag = (w.cargo.y - (w.players[0].y + w.players[1].y) / 2) / TILE;
      sum += lag;
      if (lag > worst) worst = lag;
    }

    const climbed = (startPair - (match.world.players[0].y + match.world.players[1].y) / 2) / TILE;
    expect(climbed, 'rows climbed by the pair').toBeGreaterThan(15);
    // Measured on this run: 3.7 average and 16.0 worst with the crate placed
    // on the ground; 8.8 and 42.3 with it buried in the floor, and that only
    // because the rope had already been stopped from stretching to infinity.
    expect(sum / ticks, 'average rows the crate trails the pair by').toBeLessThan(6);
    expect(worst, 'worst rows the crate trails the pair by').toBeLessThan(28);
  });

  /**
   * The rule that makes the crate the point of the game rather than scenery.
   *
   * Finishing used to ask only that both haulers were touching the goal tile.
   * In a game named after hauling a crate up a tower, the crate was not part of
   * finishing one — so nothing anywhere in the game ever required a player to
   * care where it was, and measurably, nobody did.
   */
  it('is required at the goal before a run counts as finished', () => {
    for (const [mode, seed] of [
      [MODE_HAUL, 7],
      [MODE_GAUNTLET, 33],
    ] as const) {
      for (const bringIt of [true, false]) {
        const match = new LocalMatch(mode, seed, 10);
        const { level } = match.ctx;
        const world = match.world;

        // Both haulers on the goal, rope slack between them.
        for (let i = 0; i < 2; i++) {
          const p = world.players[i];
          p.x = level.goalX + (i === 0 ? -20 : 20);
          p.y = level.goalY;
          p.vx = 0;
          p.vy = 0;
          p.grounded = 1;
          p.dead = 0;
          p.grip = GRIP_MAX;
        }
        for (let i = 0; i < ROPE_NODES; i++) {
          const t = i / (ROPE_NODES - 1);
          world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
          world.ropeY[i] = level.goalY;
          world.ropePX[i] = world.ropeX[i];
          world.ropePY[i] = level.goalY;
        }
        // Either up here with them, or twelve rows down the shaft.
        world.cargo.x = level.goalX;
        world.cargo.y = level.goalY + (bringIt ? 0 : 12 * TILE);
        world.cargo.px = world.cargo.x;
        world.cargo.py = world.cargo.y;
        world.cargo.hp = 100;

        for (let t = 0; t < 240; t++) {
          step(match.ctx, world, [0, 0]);
          world.events.length = 0;
        }
        expect(world.finished === 1, `mode ${mode} seed ${seed} crate brought: ${bringIt}`).toBe(bringIt);
      }
    }
  });
});
