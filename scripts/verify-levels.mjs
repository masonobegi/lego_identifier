/**
 * Prove the towers can actually be climbed.
 *
 * Two independent checks, because a level that looks fine and a level that
 * plays fine are different claims:
 *
 *  1. **Reachability.** A flood fill over every standable tile using a
 *     movement envelope measured from the simulation itself
 *     (scripts/calibrate-jump.mjs). Catches sealed rooms, unreachable goals
 *     and hazards dropped into the only route.
 *
 *  2. **Route replay.** The flood fill hands back an actual path from the
 *     spawn to the goal. Every step of that path is then re-attempted in the
 *     real simulation — both players, the rope, the crate, moving hazards —
 *     by searching a small space of plausible inputs. A step no input script
 *     can make is a level bug, not a player skill issue.
 */
import {
  analyseLevel,
  buildCampaign,
  buildTower,
  createWorld,
  ledgeSteps,
  step as simStep,
  TILE,
  IN_GRIP,
  IN_JUMP,
  IN_REEL,
  MAX_RISE,
  IN_LEFT,
  IN_RIGHT,
  CARGO_H,
  GRIP_MAX,
  PLAYER_H,
  ROPE_NODES,
} from '../packages/core/dist/index.js';

/**
 * The reachability fill itself lives in the core package (packages/core/src/route.ts)
 * because the bot partner has to walk exactly the route this gate proves, and two
 * copies of a movement envelope are two chances to disagree about what the game
 * can do.
 */
export const analyse = analyseLevel;
export { ledgeSteps };

/* ------------------------------------------------------------ route replay */

function placePair(world, x, y) {
  const cx = x * TILE + TILE / 2;
  const cy = (y + 1) * TILE - PLAYER_H / 2 - 1;
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = cx + (i === 0 ? -12 : 12);
    p.y = cy;
    p.vx = 0;
    p.vy = 0;
    p.grounded = 1;
    p.dead = 0;
    p.gripping = 0;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.jumpHeld = 0;
    p.grip = GRIP_MAX;
  }
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
    world.ropeY[i] = cy;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = cy;
  }
  world.cargo.x = cx;
  // On the ground at their feet, not half sunk into it. `cy + 16` put the
  // crate's centre level with the haulers' boots, which is twelve pixels of it
  // inside the floor — and a body inside geometry cannot be swept anywhere, so
  // it sat there weightless for the whole attempt. That made this gate easier
  // than the game it is gating.
  world.cargo.y = cy + (PLAYER_H - CARGO_H) / 2;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.hp = 100;
  world.cargo.calm = 0;
  world.restartTimer = 0;
}

/** Sample launch columns across a ledge, always including both ends. */
function launchColumns(ledge, limit = 6) {
  const width = ledge.x1 - ledge.x0 + 1;
  if (width <= limit) {
    const all = [];
    for (let x = ledge.x0; x <= ledge.x1; x++) all.push(x);
    return all;
  }
  const cols = [ledge.x0, ledge.x1];
  for (let i = 1; i < limit - 1; i++) {
    cols.push(ledge.x0 + Math.round((width - 1) * (i / (limit - 1))));
  }
  return [...new Set(cols)];
}

/**
 * Can *one named hauler* get from this ledge to the next while the other braces?
 *
 * The braced partner is the point. Both haulers driven by the same inputs is
 * not how this game is played and not what it asks for: they have separate
 * controllers, they take turns, and holding GRIP so your partner can climb off
 * you is the co-operative verb the whole thing is built around. Driving them in
 * lockstep also fails steps that are obviously fine — a target ledge sitting
 * almost directly above its source has exactly one clear launch column, and two
 * haulers standing twenty-four pixels apart cannot both be in it.
 *
 * Bracing is also the *harder* of the two things a partner can realistically
 * do, which makes this gate conservative rather than generous. That is not
 * obvious and it is worth writing down: `scripts/calibrate-jump.mjs` measures
 * both, and a hauler jumping past a braced partner clears one empty column at
 * rise 1-3 where one dragging an idle partner clears two. A braced partner is
 * an immovable anchor and the rope pulls you back to it; an idle one gets
 * dragged along and pays out slack. So a step this gate passes is a step a pair
 * can make with the partner doing either thing.
 */
function canCross(ctx, from, to, mover) {
  const other = 1 - mover;
  const centre = (to.x0 + to.x1) / 2;

  for (const launch of launchColumns(from)) {
    const steerDir = centre > launch ? 1 : centre < launch ? -1 : 1;
    for (const dir of [steerDir, -steerDir]) {
      // Ticks spent walking *away* from the target before jumping at it.
      //
      // Without this the gate could only test a standing jump, and a standing
      // jump is not what anybody plays: you back off and take a run at it. The
      // chunk seam — the wide landing at the bottom of one chunk up to the
      // first serpentine shelf of the next — is makeable only with a run-up,
      // and the gate called all thirteen levels broken for want of trying one.
      // Zero comes first so the common case still returns on the first attempt.
      for (const runup of [0, 20]) {
        for (const delay of [0, 4, 8, 14, 20]) {
          for (const hold of [14, 22, 26]) {
            for (const steerStart of [0, 6, 12]) {
              for (const steerLen of [8, 12, 999]) {
                // A fresh world per attempt: a previous attempt that died,
                // tripped a checkpoint reset or touched the goal would
                // otherwise poison every attempt after it.
                const world = createWorld(ctx);
                placePair(world, launch, from.y);
                // Only a few ticks to let the rope and crate settle: crumbling
                // and conveyor footing does not wait around, and neither
                // should the check.
                for (let t = 0; t < 4; t++) {
                  simStep(ctx, world, [0, 0]);
                  world.events.length = 0;
                }
                const masks = [0, 0];
                for (let t = 0; t < 160; t++) {
                  const running = t < runup;
                  const at = t - runup;
                  const jumping = !running && at >= delay && at < delay + hold;
                  const steering = !running && at >= steerStart && at < steerStart + steerLen;
                  const walk = running
                    ? dir > 0
                      ? IN_LEFT
                      : IN_RIGHT
                    : steering
                      ? dir > 0
                        ? IN_RIGHT
                        : IN_LEFT
                      : 0;
                  masks[mover] = walk | (jumping ? IN_JUMP : 0);
                  masks[other] = IN_GRIP;
                  simStep(ctx, world, masks);
                  world.events.length = 0;
                  if (world.restartTimer > 0) break;
                  const p = world.players[mover];
                  if (p.dead || p.grounded !== 1) continue;
                  const px = Math.floor(p.x / TILE);
                  const py = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
                  if (py === to.y && px >= to.x0 && px <= to.x1) return true;
                }
              }
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Can the pair get up a gate — the six-row step with no foothold in the middle?
 *
 * Nothing about this is symmetric, which is why it needs its own replay. One
 * hauler braces; the other goes up off their shoulders, which is the only move
 * in the game that gains height two people have and one does not. Then the
 * roles swap: whoever is up top braces on the lip and the one still down there
 * hauls themselves up the rope. Both co-op verbs, in that order, and the gate
 * checks that a pair can actually do it rather than trusting the fill.
 *
 * Measured before the boost existed: a lone hauler reached the same five-row
 * shelf and crossed the same six-tile chasm as a pair with one of them braced,
 * from every launch column, run-up, hold and reel the search could try. Six
 * rows is one past what anybody manages alone and four inside what a boost
 * does, so this is neither a lie nor a frame-perfect move.
 */
function canGate(ctx, from, to) {
  const on = (p, ledge) => {
    const px = Math.floor(p.x / TILE);
    const py = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
    return py === ledge.y && px >= ledge.x0 && px <= ledge.x1;
  };
  // Launch from under the target, not from anywhere on the ledge. A boosted
  // jump is nearly vertical, so the only columns that can work are the ones the
  // far side is actually above — and on a wide near-side ledge those are a
  // couple out of a dozen, which a general sample of six across the whole ledge
  // will miss more often than not.
  const lo = Math.max(from.x0, to.x0 - 1);
  const hi = Math.min(from.x1, to.x1 + 1);
  const under = [];
  for (let x = lo; x <= hi; x++) under.push(x);
  const columns = under.length > 0 ? under : launchColumns(from);

  for (const climber of [0, 1]) {
    const brace = 1 - climber;
    let cleared = false;
    outer:
    for (const launch of columns) {
      for (const jumpAt of [2, 6, 12]) {
        // Short holds as well as long ones. A boost at full power goes ten rows
        // and a gate is six, so holding the button all the way sails straight
        // past the ledge you were aiming at and lands you back where you
        // started — which is a thing a player has to learn too.
        for (const hold of [8, 12, 16, 22, 30]) {
          for (const haulWalk of [0, IN_LEFT, IN_RIGHT]) {
            const world = createWorld(ctx);
            placePair(world, launch, from.y);
            for (let t = 0; t < 6; t++) {
              simStep(ctx, world, [0, 0]);
              world.events.length = 0;
            }
            let phase = 1;
            let k = 0;
            for (let t = 0; t < 900; t++) {
              const masks = [0, 0];
              if (phase === 1) {
                masks[brace] = IN_GRIP;
                if (t >= jumpAt && t < jumpAt + hold) masks[climber] = IN_JUMP;
                if (on(world.players[climber], to) && world.players[climber].grounded === 1) {
                  phase = 2;
                  k = 0;
                }
              } else {
                masks[climber] = IN_GRIP;
                masks[brace] = IN_REEL | haulWalk;
                if (k < 22) masks[brace] |= IN_JUMP;
                k++;
              }
              simStep(ctx, world, masks);
              world.events.length = 0;
              if (world.restartTimer > 0) break;
              if (world.players[0].dead || world.players[1].dead) break;
              if (on(world.players[0], to) && on(world.players[1], to)) {
                cleared = true;
                break outer;
              }
            }
          }
        }
      }
    }
    if (!cleared) return false;
  }
  return true;
}

/**
 * Can the pair get from one ledge to the next?
 *
 * Both of them, taking turns — not either of them. The old gate returned on the
 * first hauler to touch down, which proves a step one of them can make while
 * the other is still hanging off the rope below it. The game asks for both at
 * the goal, so the gate has to ask for both on every ledge in between.
 */
export function canMakeStep(ctx, from, to) {
  return canCross(ctx, from, to, 0) && canCross(ctx, from, to, 1);
}

export function verifyLevel(level, mode, seed, options = {}) {
  // The coop fill, because the levels have gates in them now: steps with the
  // middle foothold taken out, which one player cannot climb and is not
  // supposed to be able to. Verifying against the solo fill would report the
  // campaign as broken, which is exactly what it did the first time.
  const result = analyse(level, { coop: true });
  if (!result.ok) {
    return { ok: false, level: level.id, reason: result.reason ?? 'goal unreachable', highest: result.highest, reached: result.reached, total: result.total };
  }
  if (options.replay === false) {
    return { ok: true, level: level.id, reached: result.reached, total: result.total, steps: 0 };
  }
  const ctx = { level, seed, mode };
  const steps = ledgeSteps(level, result.route, result.standable);
  const failures = [];
  for (const s of steps) {
    // A step taller than any one hauler can jump is a gate, and gates are
    // replayed as the two-person move they are.
    const gate = s.from.y - s.to.y > MAX_RISE;
    if (!(gate ? canGate(ctx, s.from, s.to) : canMakeStep(ctx, s.from, s.to))) {
      failures.push(
        `row ${s.from.y} cols ${s.from.x0}-${s.from.x1} -> row ${s.to.y} cols ${s.to.x0}-${s.to.x1}`,
      );
      if (failures.length >= 5) break;
    }
  }
  return {
    ok: failures.length === 0,
    level: level.id,
    reached: result.reached,
    total: result.total,
    steps: steps.length,
    failures,
  };
}

/* ------------------------------------------------------------------- main */

if (process.argv[1] && process.argv[1].endsWith('verify-levels.mjs')) {
  let bad = 0;
  const campaign = buildCampaign();
  const r = verifyLevel(campaign, 0, 1);
  console.log(`campaign        ${r.ok ? 'OK  ' : 'FAIL'}  ${r.reached}/${r.total} footholds reachable, ${r.steps} climbing steps replayed`);
  if (!r.ok) {
    bad++;
    if (r.reason) console.log(`  ${r.reason}`);
    for (const f of r.failures ?? []) console.log(`  unmakeable step: ${f}`);
  }

  const towers = Number(process.env.TOWER_SAMPLES ?? 12);
  for (let i = 0; i < towers; i++) {
    const seed = (i + 1) * 104729;
    const level = buildTower(seed, 6 + (i % 10));
    const t = verifyLevel(level, 1, seed);
    const label = `tower ${String(seed).padStart(7)}`;
    console.log(`${label}  ${t.ok ? 'OK  ' : 'FAIL'}  ${t.reached}/${t.total} footholds reachable, ${t.steps} climbing steps replayed`);
    if (!t.ok) {
      bad++;
      for (const f of t.failures ?? []) console.log(`  unmakeable step: ${f}`);
      if (t.reason) console.log(`  ${t.reason}`);
    }
  }

  if (bad > 0) {
    console.error(`\n${bad} level(s) cannot be climbed.`);
    process.exit(1);
  }
  console.log('\nEvery tower is climbable.');
}
