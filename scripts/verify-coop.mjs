/**
 * Prove that a gap needs two people.
 *
 * The existing gate (scripts/verify-levels.mjs) proves every tower CAN be
 * climbed with nothing but walking and jumping. That is a good property for a
 * tower to have and a terrible one for this game to have everywhere, because
 * it means the rope — the winch, the taut path, the whole reason this is not
 * just another co-op platformer — is decoration. Measured: the campaign's
 * walk+jump flood fill reaches 2126 of 2126 footholds.
 *
 * This is the opposite gate. A rope gate is a piece of geometry where:
 *
 *   1. the walk+jump flood fill CANNOT reach the far side, and
 *   2. a roped pair provably can, by simulation, with real inputs.
 *
 * Both halves matter. Without (1) the gate is decoration again. Without (2) it
 * is an impossible level, which is worse.
 *
 * On why the gate has to be a gap rather than a height: both haulers have
 * identical abilities, so any ledge one can climb to, the other can too — a
 * tall shelf is never a co-op puzzle, it is just a wall. What neither of them
 * can do alone is cross open air wider than a jump. One grips, the other runs
 * off the edge and swings across on the rope. That is the only shape of
 * problem where two people are genuinely required, and it happens to be the
 * exact mechanic the rope was built for.
 */
import {
  GRIP_MAX,
  IN_GRIP,
  IN_JUMP,
  IN_LEFT,
  IN_REEL,
  IN_RIGHT,
  PLAYER_H,
  ROPE_NODES,
  TILE,
  analyseLevel,
  createWorld,
  step as simStep,
} from '../packages/core/dist/index.js';

/** Put both haulers on one ledge, rope slack between them, crate settled. */
function placePair(world, ax, bx, y) {
  const cy = (y + 1) * TILE - PLAYER_H / 2 - 1;
  const cols = [ax, bx];
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = cols[i] * TILE + TILE / 2;
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
  world.cargo.x = (world.players[0].x + world.players[1].x) / 2;
  world.cargo.y = cy + 16;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.hp = 100;
  world.cargo.calm = 0;
  world.restartTimer = 0;
}

/** Which cell is this player standing in, or null if airborne or dead. */
function standingCell(p) {
  if (p.dead || p.grounded !== 1) return null;
  return {
    x: Math.floor(p.x / TILE),
    y: Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1,
  };
}

function onLedge(p, ledge) {
  const cell = standingCell(p);
  return cell !== null && cell.y === ledge.y && cell.x >= ledge.x0 && cell.x <= ledge.x1;
}

/** Evenly spaced sample columns across a ledge, always including both ends. */
function columns(ledge, limit) {
  const width = ledge.x1 - ledge.x0 + 1;
  if (width <= limit) {
    const all = [];
    for (let x = ledge.x0; x <= ledge.x1; x++) all.push(x);
    return all;
  }
  const cols = [ledge.x0, ledge.x1];
  for (let i = 1; i < limit - 1; i++) cols.push(ledge.x0 + Math.round((width - 1) * (i / (limit - 1))));
  return [...new Set(cols)].sort((a, b) => a - b);
}

/**
 * One swing attempt, played through the real simulation.
 *
 * The anchor holds GRIP for the whole first phase, which pins them exactly in
 * place and turns the rope into a pendulum. The runner sprints off the edge
 * toward the far ledge and rides the arc. After `release` the anchor lets go
 * and follows, reeling if the rope is taut — which is how the second hauler
 * gets across, and why the manoeuvre needs the rope in both directions.
 *
 * Returns the tick both haulers were standing on the far ledge, or -1.
 */
function attemptSwing(ctx, plan, budget = 320) {
  const { from, to, anchorIndex, anchorCol, runCol, jumpAt, hold, release } = plan;
  const runner = 1 - anchorIndex;
  const toward = (to.x0 + to.x1) / 2 > runCol ? IN_RIGHT : IN_LEFT;

  const world = createWorld(ctx);
  placePair(world, anchorIndex === 0 ? anchorCol : runCol, anchorIndex === 0 ? runCol : anchorCol, from.y);
  // Let the rope and crate settle before anybody moves.
  for (let t = 0; t < 6; t++) {
    simStep(ctx, world, [0, 0]);
    world.events.length = 0;
  }

  const masks = [0, 0];
  for (let t = 0; t < budget; t++) {
    const jumping = t >= jumpAt && t < jumpAt + hold;
    masks[runner] = toward | (jumping ? IN_JUMP : 0);
    if (t < release) {
      masks[anchorIndex] = IN_GRIP;
    } else {
      // They swap. Whoever is across becomes the anchor, and the one still
      // behind runs off and swings from them. Without the swap the second
      // hauler is jumping into a gap with a slack rope tied to nothing, which
      // is just a fall — and was why the first version of this prover said
      // every gap in the game was impossible.
      masks[anchorIndex] = toward | (t % 4 === 0 ? IN_JUMP : 0) | IN_REEL;
      masks[runner] = IN_GRIP;
    }
    simStep(ctx, world, masks);
    world.events.length = 0;
    if (world.restartTimer > 0) return -1;
    if (world.players.every((p) => onLedge(p, to))) return t;
  }
  return -1;
}

/**
 * Can a roped pair cross from one ledge to another?
 *
 * Searches a small, deliberately shaped space rather than brute-forcing every
 * input: who anchors, where each of them stands, when the runner jumps, and
 * when the anchor lets go. Anything that needs finer timing than this is
 * something two humans will not land either.
 */
export function provePairCross(ctx, from, to) {
  for (const anchorIndex of [0, 1]) {
    for (const anchorCol of columns(from, 3)) {
      for (const runCol of columns(from, 4)) {
        for (const jumpAt of [0, 5, 10]) {
          for (const hold of [12, 22]) {
            for (const release of [55, 80, 110, 150]) {
              const at = attemptSwing(ctx, { from, to, anchorIndex, anchorCol, runCol, jumpAt, hold, release });
              if (at >= 0) return { ok: true, anchorIndex, anchorCol, runCol, jumpAt, hold, release, ticks: at };
            }
          }
        }
      }
    }
  }
  return { ok: false };
}

/**
 * Find the rope gates in a level: places the walk+jump fill cannot reach.
 *
 * Returns the standable cells that are cut off, grouped into ledges. An empty
 * result means the level has no rope gate at all — which is exactly the state
 * the campaign was in, and the thing this script exists to catch.
 */
export function findGates(level) {
  const { standable, seen } = analyseLevel(level);
  const gates = [];
  for (let y = 0; y < level.h; y++) {
    let run = null;
    for (let x = 0; x < level.w; x++) {
      const i = y * level.w + x;
      const cut = standable[i] === 1 && seen[i] === -1;
      if (cut) {
        if (run === null) run = { y, x0: x, x1: x };
        else run.x1 = x;
      } else if (run !== null) {
        gates.push(run);
        run = null;
      }
    }
    if (run !== null) gates.push(run);
  }
  return gates;
}

/** The contiguous standable run containing a cell. */
export function ledgeAt(level, standable, x, y) {
  let x0 = x;
  let x1 = x;
  while (x0 > 0 && standable[y * level.w + (x0 - 1)]) x0--;
  while (x1 < level.w - 1 && standable[y * level.w + (x1 + 1)]) x1++;
  return { y, x0, x1 };
}
