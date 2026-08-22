import { describe, expect, it } from 'vitest';
import {
  BOOST_COST,
  BRACE_REGEN_SHARE,
  CHUNKS,
  DT,
  GRIP_MAX,
  GRIP_REGEN,
  IN_GRIP,
  IN_JUMP,
  IN_RIGHT,
  LocalMatch,
  MODE_HAUL,
  MAX_RISE,
  PLAYER_H,
  ROPE_NODES,
  TILE,
  analyseLevel,
  assembleLevel,
  boosting,
  buildCampaign,
  buildTower,
  createWorld,
  step,
  type Level,
  type World,
} from '../src/index.js';

/** A floor with one shelf `rise` rows above it, and nothing else. */
function shelf(rise: number): { level: Level; floor: number } {
  const W = 40;
  const H = 30;
  const floor = H - 4;
  const rows: string[] = [];
  for (let r = 0; r < H; r++) {
    let s = '';
    for (let c = 0; c < W; c++) {
      if (c < 2 || c >= W - 2) s += '#';
      else if (r === floor) s += '#';
      else if (r === floor - rise && c >= 20 && c <= 34) s += '=';
      else if (r <= 1) s += '#';
      else s += '.';
    }
    rows.push(s);
  }
  rows[floor - 1] = `${rows[floor - 1].slice(0, 5)}S${rows[floor - 1].slice(6)}`;
  rows[3] = `${rows[3].slice(0, 30)}F${rows[3].slice(31)}`;
  return {
    level: assembleLevel('t', 'T', [{ id: 't', biome: 0, difficulty: 0, rows, tags: ['start'] }]),
    floor,
  };
}

function place(world: World, col: number, row: number, mateCol: number): void {
  const y = (row + 1) * TILE - PLAYER_H / 2 - 1;
  const cols = [col, mateCol];
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = cols[i] * TILE + TILE / 2;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.grounded = 1;
    p.dead = 0;
    p.grip = GRIP_MAX;
    p.gripping = 0;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.jumpHeld = 0;
  }
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
    world.ropeY[i] = y;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = y;
  }
  world.cargo.x = world.ropeX[(ROPE_NODES - 1) >> 1];
  world.cargo.y = y + 20;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.hp = 100;
  world.restartTimer = 0;
}

/** Does the climber ever reach the shelf, over a sweep of plausible inputs? */
function reaches(rise: number, braced: boolean): boolean {
  const { level, floor } = shelf(rise);
  const ctx = { level, seed: 1, mode: 0 };
  const target = floor - rise - 1;
  for (const launch of [20, 22, 24, 26]) {
    for (const jumpAt of [2, 6]) {
      for (const hold of [10, 18, 26, 30]) {
        const world = createWorld(ctx);
        // Braced: right beside you. Otherwise: well out of reach, so the rope
        // is the only thing connecting you.
        place(world, launch, floor - 1, braced ? launch - 1 : launch + 6);
        const mate = braced ? IN_GRIP : 0;
        for (let t = 0; t < 8; t++) {
          step(ctx, world, [0, mate]);
          world.events.length = 0;
        }
        for (let t = 0; t < 180; t++) {
          step(ctx, world, [t >= jumpAt && t < jumpAt + hold ? IN_JUMP : 0, mate]);
          world.events.length = 0;
          const p = world.players[0];
          if (p.dead || world.restartTimer > 0) break;
          if (p.grounded !== 1) continue;
          const py = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
          const px = Math.floor(p.x / TILE);
          if (py === target && px >= 20 && px <= 34) return true;
        }
      }
    }
  }
  return false;
}

describe('the leg up', () => {
  /**
   * The measurement the whole mechanic exists because of.
   *
   * Before it, a hauler with a partner braced beside them reached exactly as
   * high, and crossed exactly as far, as a hauler on their own — so nothing in
   * the game required two people, and the coop reachability fill agreed:
   * 2787 cells solo, 2787 together, on a campaign named after co-operation.
   */
  it('gets you somewhere you cannot go alone', () => {
    // No run-ups in this sweep, so the solo ceiling it measures is four rows.
    // With a run-up in the search it is five, which is what the six-row gates
    // are cut against — see BOOST_SCALE. Either way the gap is the point: what
    // one hauler cannot do at any hold, a braced pair does comfortably.
    expect(reaches(4, false), 'four rows alone').toBe(true);
    expect(reaches(6, false), 'six rows alone').toBe(false);
    expect(reaches(6, true), 'six rows off a brace').toBe(true);
    expect(reaches(9, true), 'nine rows off a brace').toBe(true);
  });

  it('needs a partner who is braced, grounded and beside you', () => {
    const { level, floor } = shelf(6);
    const ctx = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);

    place(world, 24, floor - 1, 23);
    for (let t = 0; t < 8; t++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    expect(boosting(world, 0), 'partner beside you but not gripping').toBe(false);

    for (let t = 0; t < 8; t++) {
      step(ctx, world, [0, IN_GRIP]);
      world.events.length = 0;
    }
    expect(boosting(world, 0), 'partner beside you and gripping').toBe(true);

    // Too far away is not a boost, however hard they are holding on.
    place(world, 24, floor - 1, 30);
    for (let t = 0; t < 8; t++) {
      step(ctx, world, [0, IN_GRIP]);
      world.events.length = 0;
    }
    expect(boosting(world, 0), 'partner six tiles away').toBe(false);
  });

  it('costs the brace real grip, so it is a resource', () => {
    const { level, floor } = shelf(6);
    const ctx = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);
    place(world, 24, floor - 1, 23);
    for (let t = 0; t < 8; t++) {
      step(ctx, world, [0, IN_GRIP]);
      world.events.length = 0;
    }
    const before = world.players[1].grip;
    for (let t = 0; t < 4; t++) {
      step(ctx, world, [IN_JUMP, IN_GRIP]);
      world.events.length = 0;
    }
    expect(world.boosts).toBe(1);
    // Not an equality: a brace standing on solid ground gets grip back while it
    // holds, which is what stops a pair being stranded under a gate they have
    // fumbled five times. So the bar drops by the cost and then starts climbing
    // again, and what this asserts is that the cost was real and large.
    const spent = before - world.players[1].grip;
    expect(spent).toBeGreaterThan(BOOST_COST * 0.85);
    expect(spent).toBeLessThanOrEqual(BOOST_COST);
  });

  /**
   * The same pair, the same ledge, the two of you swapped over.
   *
   * `step` updates slot 0 before slot 1, so a boost that asked about its
   * partner mid-tick got last tick's answer in one seat and this tick's in the
   * other. It was worth roughly a pixel of height, which is nothing until it
   * is the pixel between catching the lip of a gate and not, and the player it
   * happens to has no way to know their seat is the reason.
   */
  it('lifts you the same however the two of you are seated', () => {
    const peak = (climber: number): number => {
      const { level, floor } = shelf(9);
      const ctx = { level, seed: 1, mode: 0 };
      const world = createWorld(ctx);
      const cols = [24, 23];
      place(world, cols[climber], floor - 1, cols[1 - climber]);
      const mate = 1 - climber;
      const brace = [0, 0];
      brace[mate] = IN_GRIP;
      for (let t = 0; t < 8; t++) {
        step(ctx, world, brace);
        world.events.length = 0;
      }
      const start = world.players[climber].y;
      let high = start;
      for (let t = 0; t < 60; t++) {
        const in0 = [...brace];
        if (t < 26) in0[climber] |= IN_JUMP;
        step(ctx, world, in0);
        world.events.length = 0;
        high = Math.min(high, world.players[climber].y);
      }
      return start - high;
    };
    const a = peak(0);
    const b = peak(1);
    expect(a, 'a boost happened at all').toBeGreaterThan(TILE * 5);
    // Not bit-identical: slot 0 still moves before slot 1, so the rope solver
    // sees a marginally different pair of endpoints and the two runs land a
    // few thousandths of a pixel apart. What must not differ is the decision,
    // and a decision that went the other way is worth a hundred pixels.
    expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(0.05);
  });

  /**
   * The seat used to decide the answer whenever the brace was on a threshold.
   *
   * A grounded brace regenerates grip, so a bar sitting a hair under the cost
   * of a boost is over it again one tick later. Slot 0 asked before its
   * partner had moved and was refused; slot 1 asked after and was lifted. Two
   * players doing the identical thing at the identical moment, one of them
   * denied the only move in the game that gains height, for a reason neither
   * of them could see.
   */
  it('refuses a brace who cannot afford it, in either seat', () => {
    const tick = GRIP_REGEN * BRACE_REGEN_SHARE * DT;
    const boosted = (climber: number): boolean => {
      const { level, floor } = shelf(6);
      const ctx = { level, seed: 1, mode: 0 };
      const world = createWorld(ctx);
      const cols = [24, 23];
      place(world, cols[climber], floor - 1, cols[1 - climber]);
      const brace = [0, 0];
      brace[1 - climber] = IN_GRIP;
      for (let t = 0; t < 8; t++) {
        step(ctx, world, brace);
        world.events.length = 0;
      }
      // Straddling: short of the cost now, past it after one tick of regen.
      world.players[1 - climber].grip = BOOST_COST - tick / 2;
      const jump = [...brace];
      jump[climber] |= IN_JUMP;
      step(ctx, world, jump);
      return world.boosts > 0;
    };
    expect(boosted(0), 'climber in slot 0').toBe(false);
    expect(boosted(1), 'climber in slot 1').toBe(false);
  });

  /**
   * Nobody is a platform on the tick they shove off themselves.
   *
   * Deciding both boosts from the same pre-tick world makes a mutual boost
   * expressible for the first time: two people braced on one ledge, both
   * jumping on the same frame, each launching off the other. That clears a
   * gate in a single move and skips the haul the gate exists to ask for.
   */
  it('gives nobody a leg up when both of you jump at once', () => {
    const { level, floor } = shelf(6);
    const ctx = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);
    place(world, 24, floor - 1, 23);
    for (let t = 0; t < 8; t++) {
      step(ctx, world, [IN_GRIP, IN_GRIP]);
      world.events.length = 0;
    }
    for (let t = 0; t < 6; t++) {
      step(ctx, world, [IN_GRIP | IN_JUMP, IN_GRIP | IN_JUMP]);
      world.events.length = 0;
    }
    expect(world.boosts).toBe(0);
  });
});

/**
 * The claim the whole design rests on, asked of the simulation rather than of a
 * model of it.
 *
 * Solo-impossibility was only ever asserted against the reachability fill,
 * which walks a grid using MAX_RISE and knows nothing about what the physics
 * will actually let you do. It was wrong: pressing GRIP and JUMP on the same
 * tick took a jump through a branch that returns before the ordinary one, so
 * the tick after still read as grounded, refilled the coyote window in mid-air,
 * and a second press cashed it. 6.50 tiles against a plain jump's 4.50, on a
 * tower whose gates are six. One player could climb the whole thing.
 *
 * So this sweeps the buttons instead of trusting the map. It is deliberately
 * not a tidy unit test: the point is to be the thing that would have caught it.
 */
describe('one player, every button', () => {
  /** The highest a lone hauler gets off a flat ledge, over a sweep of inputs. */
  function soloCeiling(): number {
    const { level, floor } = shelf(12);
    const ctx = { level, seed: 1, mode: 0 };
    let best = 0;
    for (const run of [0, 12, 24]) {
      for (const grip of [0, 1, 2, 3, 5, 8]) {
        for (const again of [0, 3, 4, 5, 6, 7, 8, 10, 14]) {
          for (const hold of [8, 16, 24, 30]) {
            const world = createWorld(ctx);
            place(world, 24, floor - 1, 6);
            for (let t = 0; t < 8; t++) {
              step(ctx, world, [0, 0]);
              world.events.length = 0;
            }
            const y0 = world.players[0].y;
            let high = y0;
            for (let t = 0; t < 150; t++) {
              let m = 0;
              if (t < run) m |= IN_RIGHT;
              else {
                const s = t - run;
                if (s === 0 && grip > 0) m |= IN_GRIP;
                if (s > 0 && s < grip) m |= IN_GRIP;
                if (s < hold) m |= IN_JUMP;
                if (again > 0 && s >= again && s < again + hold) m |= IN_JUMP;
                if (again > 0 && s === again - 1) m &= ~IN_JUMP;
              }
              step(ctx, world, [m, 0]);
              world.events.length = 0;
              if (world.players[0].dead) break;
              high = Math.min(high, world.players[0].y);
            }
            best = Math.max(best, (y0 - high) / TILE);
          }
        }
      }
    }
    return best;
  }

  it('cannot out-jump a gate whatever it presses', () => {
    const ceiling = soloCeiling();
    // Six rows is what the gates are cut to. The margin is the whole mechanic,
    // so this asserts the number, not just the inequality: a change that lifts
    // the solo ceiling towards six should fail here and not in a review.
    expect(ceiling, 'solo ceiling in tiles').toBeLessThan(5.5);
    expect(ceiling, 'and a normal jump still works').toBeGreaterThan(4);
  });
});

describe('rope gates', () => {
  it('makes the campaign impossible on your own and possible together', () => {
    const level = buildCampaign();
    const solo = analyseLevel(level);
    const pair = analyseLevel(level, { coop: true });
    expect(solo.ok, 'one player can finish the campaign').toBe(false);
    expect(pair.ok, 'two players can finish the campaign').toBe(true);
    expect(pair.gates.length, 'gates on the route').toBeGreaterThanOrEqual(3);
  });

  it('gates every seeded tower too, not just the authored one', () => {
    for (const seed of [7, 33, 104729]) {
      const level = buildTower(seed, 10);
      expect(analyseLevel(level).ok, `tower ${seed} alone`).toBe(false);
      expect(analyseLevel(level, { coop: true }).ok, `tower ${seed} together`).toBe(true);
    }
  });

  it('finds the two-person moments that were painted, and no others', () => {
    // A breadth-first fill takes the shortest path in edges, and a boost skips
    // a whole foothold — so the moment boosting became an edge the route used
    // one wherever it could, and 98 of the campaign's steps came back as
    // two-person moves when four had been authored.
    //
    // This was a ceiling on the count for a while, which stopped meaning
    // anything the day the library was built around co-op rather than dotted
    // with it: sixty-two gates is now the design, not a bug. So hold the fill
    // to the design instead. Every room writes down how many leg-ups and
    // shutters it was painted with, and the two numbers have to agree.
    //
    // More found than painted is the fill helping itself. Fewer is worse: it
    // means a room the author built around two people has an ordinary way up
    // it, and the build gate will never look at the gate that was skipped.
    const used = CHUNKS.filter((c) => !c.tags?.includes('spare'));
    const painted = {
      gates: used.reduce((n, c) => n + (c.gates ?? 0), 0),
      holds: used.reduce((n, c) => n + (c.holds ?? 0), 0),
    };
    const pair = analyseLevel(buildCampaign(), { coop: true });
    // Counted without the doorways: a shutter crossing is a gate as well, and a
    // room built around one is not the fill helping itself to a boost.
    expect(pair.gates.length - pair.holds.length, 'leg-ups').toBe(painted.gates);
    expect(pair.holds.length, 'shutters').toBe(painted.holds);
  });

  it('spaces them out instead of counting one ledge many times', () => {
    // One leg up opens one ledge. If a whole landing row came back as eight
    // gates the count would look like density and play like one moment, so no
    // two of them may sit inside the same jump of each other.
    const pair = analyseLevel(buildCampaign(), { coop: true });
    const doors = new Set(pair.holds.map((h) => `${h.x},${h.y}`));
    const rows = pair.gates
      .filter((g) => !doors.has(`${g.x},${g.y}`))
      .map((g) => g.y)
      .sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i] - rows[i - 1], `two gates at rows ${rows[i - 1]} and ${rows[i]}`).toBeGreaterThan(
        MAX_RISE,
      );
    }
  });
});

describe('dying', () => {
  /**
   * Coming back next to your partner is a rescue. It must not be a lift.
   *
   * Unconditional partner-side respawn quietly beat every co-operative verb in
   * the game: reeling moves you 430 px/s along a 232px rope and drains your
   * grip, a boost costs the brace a fifth of their bar and needs both of you
   * lined up — and dying is instant, unlimited, free, and goes as far as your
   * partner has got. At a gate the fastest way for the second hauler to follow
   * the first was to walk into a spike, which would have made every gate in the
   * tower decoration within an hour of somebody noticing.
   */
  it('does not carry you up to a partner who has climbed above you', () => {
    const m = new LocalMatch(MODE_HAUL, 1, 6);
    const w = m.world;
    const base = w.players[0].y;
    w.players[1].x = w.players[0].x;
    w.players[1].y = base - 8 * TILE;
    w.players[0].dead = 1;
    w.players[0].respawn = 0;
    for (let t = 0; t < 6; t++) {
      step(m.ctx, w, [0, 0]);
      w.events.length = 0;
    }
    expect((base - w.players[0].y) / TILE).toBeLessThan(MAX_RISE);
  });

  it('still puts you back beside a partner who is level with you', () => {
    const m = new LocalMatch(MODE_HAUL, 1, 6);
    const w = m.world;
    const y0 = w.players[0].y;
    w.players[1].x = w.players[0].x + 60;
    w.players[0].dead = 1;
    w.players[0].respawn = 0;
    for (let t = 0; t < 6; t++) {
      step(m.ctx, w, [0, 0]);
      w.events.length = 0;
    }
    expect(Math.abs(w.players[0].x - w.players[1].x)).toBeLessThan(90);
    expect(Math.abs(w.players[0].y - y0)).toBeLessThan(TILE * 2);
  });
});
