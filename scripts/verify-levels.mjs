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

/**
 * Try, hard, to get one hauler up a gate on their own.
 *
 * The build had a proof that the towers are climbable together and no proof at
 * all that they are unclimbable alone — the one claim the whole design rests
 * on. It was asserted against the reachability fill, which walks a grid using
 * MAX_RISE and knows nothing about what the physics will let you do, and the
 * physics let you do more: GRIP and JUMP on the same tick took a jump through
 * a branch that returns before the ordinary one, leaving `grounded` set, so the
 * next tick refilled the coyote window in mid-air and a second press cashed it.
 * 6.50 tiles against a plain jump's 4.50, on gates cut to six.
 *
 * Randomised scripts rather than a tidy sweep, because the sweep is what missed
 * it: the exploit needed three buttons in a particular order and no
 * hand-written cadence happened to contain it. GRIP is in the alphabet here for
 * the same reason. The partner is parked on the launch ledge and never presses
 * anything — present, so the rope and its weight are real, and useless, so
 * nothing here can be a boost. Any run that does register one is thrown away.
 */
function soloCanCross(ctx, from, to, tries) {
  let seed = 0x5eed | 0;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const BUDGET = 240;
  const script = new Uint8Array(BUDGET);

  /** Run one scripted attempt; the ledge reached, or null. */
  const attempt = (lx, mask) => {
    const world = createWorld(ctx);
    placePair(world, lx, from.y);
    for (let t = 0; t < 4; t++) {
      simStep(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    for (let t = 0; t < BUDGET; t++) {
      simStep(ctx, world, [mask(t), 0]);
      world.events.length = 0;
      if (world.restartTimer > 0 || world.boosts > 0) return null;
      const p = world.players[0];
      if (p.dead) return null;
      if (p.grounded !== 1) continue;
      const cy = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
      const cx = Math.floor(p.x / TILE);
      if (cy === to.y && cx >= to.x0 && cx <= to.x1) return { lx, tick: t };
    }
    return null;
  };

  // The shapes that are known to break this, swept exactly rather than left to
  // chance. A random script hits "press, release, re-press inside seven ticks"
  // so rarely that 1500 of them missed the double jump that was live in the
  // build: the targeted pass below finds it in the first dozen attempts. Run-up
  // first, because every one of these is worth more with speed behind it.
  for (let lx = from.x0; lx <= from.x1; lx++) {
    for (const run of [0, 10, 20, 34]) {
      const dir = to.x0 + to.x1 > from.x0 + from.x1 ? IN_RIGHT : IN_LEFT;
      for (const grip of [0, IN_GRIP]) {
        for (let gap = 0; gap <= 16; gap++) {
          for (const hold of [6, 14, 22, 30]) {
            const got = attempt(lx, (t) => {
              if (t < run) return dir;
              const k = t - run;
              let m = dir;
              if (k === 0) m |= IN_JUMP | grip;
              else if (k < hold && gap === 0) m |= IN_JUMP;
              else if (gap > 0 && k >= gap && k < gap + hold) m |= IN_JUMP;
              return m;
            });
            if (got) return got;
          }
        }
      }
    }
  }

  for (let n = 0; n < tries; n++) {
    for (let t = 0; t < BUDGET; ) {
      const seg = 2 + Math.floor(rand() * 20);
      let m = 0;
      const r = rand();
      if (r < 0.36) m |= IN_LEFT;
      else if (r < 0.72) m |= IN_RIGHT;
      if (rand() < 0.6) m |= IN_JUMP;
      if (rand() < 0.35) m |= IN_GRIP;
      for (let k = 0; k < seg && t < BUDGET; k++, t++) script[t] = m;
    }
    const lx = from.x0 + Math.floor(rand() * (from.x1 - from.x0 + 1));
    const got = attempt(lx, (t) => script[t]);
    if (got) return got;
  }
  return null;
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
    const where = `row ${s.from.y} cols ${s.from.x0}-${s.from.x1} -> row ${s.to.y} cols ${s.to.x0}-${s.to.x1}`;
    if (!(gate ? canGate(ctx, s.from, s.to) : canMakeStep(ctx, s.from, s.to))) {
      failures.push(where);
      if (failures.length >= 5) break;
    }
    // A gate one player can climb is not a gate, and the tower it is in does
    // not need two people however many of them it has.
    if (gate && options.solo !== false) {
      const got = soloCanCross(ctx, s.from, s.to, options.soloTries ?? 1500);
      if (got) {
        failures.push(`${where} — ONE PLAYER CLEARED IT from column ${got.lx}`);
        if (failures.length >= 5) break;
      }
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
