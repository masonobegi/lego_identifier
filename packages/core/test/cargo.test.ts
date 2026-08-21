import { describe, expect, it } from 'vitest';
import {
  CARGO_H,
  CARGO_HP,
  CARGO_W,
  EV_CARGO_HIT,
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
    for (const [mode, seed] of [
      [MODE_HAUL, 7],
      [MODE_GAUNTLET, 33],
    ] as const) {
      const match = new LocalMatch(mode, seed, 10);
      match.setBot(0, new Bot(match.ctx.level));
      match.setBot(1, new Bot(match.ctx.level));

      const startPair = (match.world.players[0].y + match.world.players[1].y) / 2;
      let spell = 0;
      let worstSpell = 0;
      const ticks = 90 * 60;
      for (let t = 0; t < ticks; t++) {
        match.update(1000 / 60, [0, 0]);
        match.events.length = 0;
        // The longest *unbroken* spell the crate spends far behind, rather
        // than its average distance or its worst moment.
        //
        // Average is the wrong measure and this test learned it the hard way:
        // a crate hanging a full rope-length below a climbing pair is not
        // lagging, it is doing its job, and that alone puts the average near
        // ten rows. A single worst moment is wrong too — the crate swings.
        // What distinguishes hauling from abandonment is *duration*: coming
        // along behind you reads as seconds, being left behind reads as the
        // rest of the run.
        const w = match.world;
        const lag = (w.cargo.y - (w.players[0].y + w.players[1].y) / 2) / TILE;
        if (lag > 12) {
          spell++;
          if (spell > worstSpell) worstSpell = spell;
        } else {
          spell = 0;
        }
      }

      const climbed = (startPair - (match.world.players[0].y + match.world.players[1].y) / 2) / TILE;
      expect(climbed, `mode ${mode} seed ${seed}: rows climbed by the pair`).toBeGreaterThan(15);
      // Measured at 5.0s and 1.9s. It was 20.4s with the crate unable to
      // shuffle out from under a ledge, and the entire ninety seconds back
      // when the crate spawned buried in the floor and never moved at all.
      expect(
        worstSpell / 60,
        `mode ${mode} seed ${seed}: longest unbroken spell more than 12 rows behind, in seconds`,
      ).toBeLessThan(11);
    }
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

  /**
   * No single impact can destroy the crate outright.
   *
   * The crate had no terminal velocity — both haulers have had one since the
   * beginning, but nothing ever bounded the load. And the tether that keeps it
   * under the rope moves it by writing a position, in a Verlet integrator that
   * infers velocity from `x - px`; so a hundred-pixel correction when the rope
   * went taut read back as six thousand pixels a second on the following tick,
   * and the next surface it touched charged it for that. Measured: the crate
   * reached 5904 px/s, five times the haulers' own heavy-fall cap, and took
   * 312 points of impact damage against a hundred-point bar. It was not
   * falling. It was being thrown by its own leash.
   *
   * The property worth protecting is not the number, it is the shape: losing
   * the crate should always be an accumulation the pair can see coming, never
   * one frame of physics they had no way to read.
   */
  it('cannot be destroyed by a single impact', () => {
    for (const [mode, seed] of [
      [MODE_HAUL, 7],
      [MODE_GAUNTLET, 33],
      [MODE_GAUNTLET, 555],
    ] as const) {
      const match = new LocalMatch(mode, seed, 10);
      match.setBot(0, new Bot(match.ctx.level));
      match.setBot(1, new Bot(match.ctx.level));
      let worst = 0;
      for (let t = 0; t < 120 * 60; t++) {
        match.update(1000 / 60, [0, 0]);
        for (const e of match.events) if (e.kind === EV_CARGO_HIT && e.a > worst) worst = e.a;
        match.events.length = 0;
      }
      // Measured at 69.3 with the cap and 312.8 without it.
      expect(worst, `mode ${mode} seed ${seed}: worst single impact`).toBeLessThan(CARGO_HP);
    }
  });
});
