import {
  DT,
  GRIP_REGEN_DELAY,
  REEL_DRAIN,
  REEL_FORCE,
  REEL_MAX_SPEED,
  ROPE_CORRECTION,
  ROPE_GRAVITY,
  ROPE_ITERATIONS,
  ROPE_MAX,
  ROPE_NODES,
  ROPE_NODE_DRAG,
  ROPE_REST,
  ROPE_RESTITUTION,
  ROPE_SPRING,
  GROUND_HAUL_RESISTANCE,
  PLAYER_H,
  PLAYER_HALF_W,
  ROPE_YANK_SPEED,
  IN_REEL,
} from './constants.js';
import type { Level } from './level.js';
import { collider, moveCollider, pointSolid } from './physics.js';
import { EV_REEL, EV_ROPE_YANK, type World } from './types.js';
import { pushEvent } from './events.js';

const SEG_MAX = ROPE_MAX / (ROPE_NODES - 1);
const ROPE_G_STEP = ROPE_GRAVITY * DT * DT;

/** Where the rope is tied to a player — chest height, not the feet. */
export function anchorX(world: World, i: number): number {
  return world.players[i].x;
}

export function anchorY(world: World, i: number): number {
  return world.players[i].y - 5;
}

/**
 * How much of a rope correction each player absorbs. A player who is gripping a
 * surface, dead, or stunned is immovable, so their partner takes the whole
 * correction — which is exactly how you turn your friend into a wrecking ball.
 */
function mobility(world: World, i: number): number {
  const p = world.players[i];
  // A corpse is dead weight, not an anchor: it gets dragged around at full
  // strength. Only a gripping player is immovable.
  if (p.gripping && !p.dead) return 0;
  return 1;
}

/**
 * How readily the rope can haul this player, given which way it is pulling.
 *
 * Feet on solid ground resist a sideways or downward haul — that is what makes
 * one of you an anchor without gripping. Nothing resists being lifted straight
 * up, which is the whole reason a rope over a ledge can winch your partner out
 * of a pit while you simply walk away from it.
 */
function haulMobility(world: World, i: number, dirY: number): number {
  const p = world.players[i];
  if (p.gripping && !p.dead) return 0;
  if (p.dead) return 1;
  if (p.grounded !== 1) return 1;
  return dirY < -0.55 ? 1 : GROUND_HAUL_RESISTANCE;
}

/**
 * Forces the rope applies to the players before they move: a soft spring once
 * the rope passes its rest length, plus the REEL input which drags you toward
 * your partner along the rope.
 */
export function applyRopeForces(world: World, inputs: number[]): void {
  const a = world.players[0];
  const b = world.players[1];
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.0001) {
    dx = 0;
    dy = 1;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;

  if (d > ROPE_REST) {
    const excess = d - ROPE_REST;
    const accel = ROPE_SPRING * excess;
    const ma = mobility(world, 0);
    const mb = mobility(world, 1);
    const total = ma + mb;
    if (total > 0) {
      // A pinned partner means the whole spring lands on the free player.
      const wa = ma === 0 ? 0 : mb === 0 ? 1 : 0.5;
      const wb = mb === 0 ? 0 : ma === 0 ? 1 : 0.5;
      a.vx += nx * accel * wa * DT;
      a.vy += ny * accel * wa * DT;
      b.vx -= nx * accel * wb * DT;
      b.vy -= ny * accel * wb * DT;
    }
  }

  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    if (p.dead || p.gripping || p.stunned > 0) continue;
    if ((inputs[i] & IN_REEL) === 0) continue;
    // Hauling on a slack rope does nothing — there is nothing to pull against.
    if (d < ROPE_REST * 0.55) continue;
    if (p.grip <= 0) continue;
    const sx = i === 0 ? nx : -nx;
    const sy = i === 0 ? ny : -ny;
    const along = p.vx * sx + p.vy * sy;
    if (along < REEL_MAX_SPEED) {
      p.vx += sx * REEL_FORCE * DT;
      p.vy += sy * REEL_FORCE * DT;
    }
    p.grip = Math.max(0, p.grip - REEL_DRAIN * DT);
    p.gripCooldown = GRIP_REGEN_DELAY;
    if (world.tick % 9 === 0) pushEvent(world, EV_REEL, p.x, p.y, i, 0);
  }
}

/** Verlet-integrate the rope, pin it to both players, then relax the segments. */
export function solveRope(world: World, level: Level): void {
  const rx = world.ropeX;
  const ry = world.ropeY;
  const px = world.ropePX;
  const py = world.ropePY;

  for (let i = 0; i < ROPE_NODES; i++) {
    const vx = (rx[i] - px[i]) * ROPE_NODE_DRAG;
    const vy = (ry[i] - py[i]) * ROPE_NODE_DRAG;
    px[i] = rx[i];
    py[i] = ry[i];
    let nx = rx[i] + vx;
    let ny = ry[i] + vy + ROPE_G_STEP;
    // Rope never enters geometry; blocked nodes simply stay put, which makes
    // the rope drape over ledges and catch on corners.
    if (pointSolid(level, world, nx, ny)) {
      if (!pointSolid(level, world, nx, ry[i])) {
        ny = ry[i];
      } else if (!pointSolid(level, world, rx[i], ny)) {
        nx = rx[i];
      } else {
        nx = rx[i];
        ny = ry[i];
      }
    }
    rx[i] = nx;
    ry[i] = ny;
  }

  const ax = anchorX(world, 0);
  const ay = anchorY(world, 0);
  const bx = anchorX(world, 1);
  const by = anchorY(world, 1);

  for (let iter = 0; iter < ROPE_ITERATIONS; iter++) {
    rx[0] = ax;
    ry[0] = ay;
    rx[ROPE_NODES - 1] = bx;
    ry[ROPE_NODES - 1] = by;
    for (let i = 0; i < ROPE_NODES - 1; i++) {
      const dx = rx[i + 1] - rx[i];
      const dy = ry[i + 1] - ry[i];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= SEG_MAX || d < 0.0001) continue;
      const scale = (d - SEG_MAX) / d * 0.5;
      const ox = dx * scale;
      const oy = dy * scale;
      if (i !== 0) {
        rx[i] += ox;
        ry[i] += oy;
      }
      if (i + 1 !== ROPE_NODES - 1) {
        rx[i + 1] -= ox;
        ry[i + 1] -= oy;
      }
    }
  }
  rx[0] = ax;
  ry[0] = ay;
  rx[ROPE_NODES - 1] = bx;
  ry[ROPE_NODES - 1] = by;
}

/**
 * The hard length limit. Once the players are further apart than the rope can
 * physically stretch, both are pulled back in and the separating part of their
 * relative velocity is cancelled — turning a fall into a pendulum swing, and a
 * sprint into your partner being ripped off a ledge.
 */
const pullA = { x: 0, y: 0 };
const pullB = { x: 0, y: 0 };

function haul(world: World, level: Level, index: number, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const p = world.players[index];
  // Match the body the player's own update uses, or a corpse — which lies in a
  // squashed box — snags on the floor the moment anyone tries to drag it.
  const halfHeight = p.dead ? (PLAYER_H / 2) * 0.7 : PLAYER_H / 2;
  collider.set(p.x, p.y, PLAYER_HALF_W, halfHeight);
  collider.dropThrough = true;
  moveCollider(level, world, collider, dx, dy);
  p.x = collider.x;
  p.y = collider.y;
  if (collider.hitY === 1) p.grounded = 1;
}

export function clampRopeLength(world: World, level: Level): void {
  const a = world.players[0];
  const b = world.players[1];

  const length = tautPathLength(world, level);
  if (length <= ROPE_MAX || length < 0.0001) return;
  const overshoot = length - ROPE_MAX;

  // Each player is pulled along their own end of the rope, toward the first
  // thing it bends around — not toward their partner. With a clear run between
  // them those are the same direction; with a beam in between they are not, and
  // that difference is the pulley.
  const anchorAX = anchorX(world, 0);
  const anchorAY = anchorY(world, 0);
  const anchorBX = anchorX(world, 1);
  const anchorBY = anchorY(world, 1);
  ropePullTarget(0, anchorAX, anchorAY, pullA);
  ropePullTarget(1, anchorBX, anchorBY, pullB);
  let ax = pullA.x - anchorAX;
  let ay = pullA.y - anchorAY;
  let bx = pullB.x - anchorBX;
  let by = pullB.y - anchorBY;
  const da = Math.sqrt(ax * ax + ay * ay);
  const db = Math.sqrt(bx * bx + by * by);
  if (da < 0.0001 || db < 0.0001) return;
  ax /= da;
  ay /= da;
  bx /= db;
  by /= db;

  const ma = haulMobility(world, 0, ay);
  const mb = haulMobility(world, 1, by);
  const total = ma + mb;
  if (total <= 0) return;
  const wa = ma / total;
  const wb = mb / total;

  // Haul through collision rather than teleporting. Sliding a hauled player
  // along a wall is the difference between being winched up out of a pit and
  // being shoved into its side, where every subsequent lift just re-collides.
  haul(world, level, 0, ax * overshoot * wa * ROPE_CORRECTION, ay * overshoot * wa * ROPE_CORRECTION);
  haul(world, level, 1, bx * overshoot * wb * ROPE_CORRECTION, by * overshoot * wb * ROPE_CORRECTION);

  // Cancel the part of their motion that is paying out more rope, leaving
  // everything sideways intact so the pair swings instead of stopping dead.
  const paying = -(a.vx * ax + a.vy * ay) - (b.vx * bx + b.vy * by);
  if (paying > 0) {
    const impulse = paying * (1 + ROPE_RESTITUTION);
    a.vx += ax * impulse * wa;
    a.vy += ay * impulse * wa;
    b.vx += bx * impulse * wb;
    b.vy += by * impulse * wb;
    if (paying > ROPE_YANK_SPEED) {
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      pushEvent(world, EV_ROPE_YANK, mx, my, paying, 0);
      // Being ripped off solid ground by your partner is the signature failure
      // of this game, so it is counted and reported on the results screen.
      if ((a.grounded === 1) !== (b.grounded === 1)) world.betrayals++;
    }
  }
}

/** Index of the rope node the cargo hangs from. */
export const ROPE_MID = (ROPE_NODES - 1) >> 1;

/* ---------------------------------------------------------------- wrapping */

/**
 * The taut path the rope actually takes between the two players.
 *
 * The rope already drapes over ledges — its nodes cannot enter geometry — but
 * until now the length limit was measured along the straight line between the
 * players, so a rope that visibly hooked over a beam still behaved as though it
 * passed straight through it.
 *
 * Pulling the rope tight around the obstacles it is resting on changes that,
 * and it is where the game's mechanics come from. Hook the rope over a beam and
 * the leash is measured the long way round, so wrapping it costs you slack; and
 * because each player is pulled along their own end of the rope rather than
 * toward their partner, a partner falling down the far side of a beam hauls you
 * *up* it. A pulley, out of geometry the level designer already had.
 */
const MAX_CONTACTS = 8;
const pathX = new Float64Array(MAX_CONTACTS + 2);
const pathY = new Float64Array(MAX_CONTACTS + 2);
let pathCount = 0;

/** Sampled line-of-sight test. Deterministic: integer steps, no transcendentals. */
function segmentClear(level: Level, world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.0001) return true;
  const steps = Math.ceil(dist / 6);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointSolid(level, world, x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

/**
 * Pull the rope taut around whatever it is resting on, and return its length.
 *
 * Classic string pulling over the rope's own nodes: walk forward, and from each
 * contact point jump as far along the rope as still has clear line of sight.
 * With nothing in the way this collapses to the straight line between the two
 * players, which is exactly the old behaviour.
 */
export function tautPathLength(world: World, level: Level): number {
  const ax = anchorX(world, 0);
  const ay = anchorY(world, 0);
  const bx = anchorX(world, 1);
  const by = anchorY(world, 1);

  pathCount = 0;
  pathX[pathCount] = ax;
  pathY[pathCount] = ay;
  pathCount++;

  // Candidate bend points: the rope's own interior nodes, then the far anchor.
  let cursor = -1;
  let guard = 0;
  while (guard++ < MAX_CONTACTS) {
    const fromX = pathX[pathCount - 1];
    const fromY = pathY[pathCount - 1];
    if (segmentClear(level, world, fromX, fromY, bx, by)) break;

    let next = -1;
    for (let i = ROPE_NODES - 2; i > cursor; i--) {
      if (segmentClear(level, world, fromX, fromY, world.ropeX[i], world.ropeY[i])) {
        next = i;
        break;
      }
    }
    // Nothing visible ahead: the rope is buried in geometry, so fall back to
    // the straight line rather than inventing a path.
    if (next < 0 || next <= cursor) break;
    cursor = next;
    if (pathCount >= MAX_CONTACTS + 1) break;
    pathX[pathCount] = world.ropeX[next];
    pathY[pathCount] = world.ropeY[next];
    pathCount++;
  }

  pathX[pathCount] = bx;
  pathY[pathCount] = by;
  pathCount++;

  let length = 0;
  for (let i = 0; i < pathCount - 1; i++) {
    const dx = pathX[i + 1] - pathX[i];
    const dy = pathY[i + 1] - pathY[i];
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

/** How many bends the rope currently has. Zero means a clear straight run. */
export function ropeContactCount(): number {
  return Math.max(0, pathCount - 2);
}

/**
 * The point a player's end of the rope pulls toward.
 *
 * Contacts that the player has climbed right up to are skipped: a bend you are
 * standing on is a bend the rope has already come off, and using it would leave
 * the pull direction undefined — which previously switched the whole constraint
 * off the moment somebody reached the corner they were being hauled toward.
 */
const MIN_PULL_DISTANCE_SQ = 64;

export function ropePullTarget(index: number, ax: number, ay: number, out: { x: number; y: number }): void {
  if (index === 0) {
    for (let i = 1; i < pathCount; i++) {
      const dx = pathX[i] - ax;
      const dy = pathY[i] - ay;
      if (dx * dx + dy * dy > MIN_PULL_DISTANCE_SQ) {
        out.x = pathX[i];
        out.y = pathY[i];
        return;
      }
    }
    out.x = pathX[pathCount - 1];
    out.y = pathY[pathCount - 1];
    return;
  }
  for (let i = pathCount - 2; i >= 0; i--) {
    const dx = pathX[i] - ax;
    const dy = pathY[i] - ay;
    if (dx * dx + dy * dy > MIN_PULL_DISTANCE_SQ) {
      out.x = pathX[i];
      out.y = pathY[i];
      return;
    }
  }
  out.x = pathX[0];
  out.y = pathY[0];
}
