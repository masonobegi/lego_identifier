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
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
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
  world.cargo.y = cy + 16;
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

/** Can the pair get from one ledge to the next, with any reasonable input? */
export function canMakeStep(ctx, from, to) {
  const centre = (to.x0 + to.x1) / 2;

  for (const launch of launchColumns(from)) {
    const steerDir = centre > launch ? 1 : centre < launch ? -1 : 1;
    for (const dir of [steerDir, -steerDir]) {
      for (const delay of [0, 4, 8, 14, 20]) {
        for (const hold of [14, 22]) {
          for (const steerStart of [0, 6, 12]) {
            for (const steerLen of [12, 999]) {
              // A fresh world per attempt: a previous attempt that died,
              // tripped a checkpoint reset or touched the goal would otherwise
              // poison every attempt after it.
              const world = createWorld(ctx);
              placePair(world, launch, from.y);
              // Only a few ticks to let the rope and crate settle: crumbling
              // and conveyor footing does not wait around, and neither should
              // the check.
              for (let t = 0; t < 4; t++) {
                simStep(ctx, world, [0, 0]);
                world.events.length = 0;
              }
              for (let t = 0; t < 140; t++) {
                const jumping = t >= delay && t < delay + hold;
                const steering = t >= steerStart && t < steerStart + steerLen;
                const mask = (steering ? (dir > 0 ? IN_RIGHT : IN_LEFT) : 0) | (jumping ? IN_JUMP : 0);
                simStep(ctx, world, [mask, mask]);
                world.events.length = 0;
                if (world.restartTimer > 0) break;
                for (const p of world.players) {
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

export function verifyLevel(level, mode, seed, options = {}) {
  const result = analyse(level);
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
    if (!canMakeStep(ctx, s.from, s.to)) {
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
    console.log(`  ${r.reason ?? ''}`);
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
