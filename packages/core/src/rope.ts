import {
  DT,
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
  ROPE_YANK_SPEED,
  IN_REEL,
} from './constants.js';
import type { Level } from './level.js';
import { pointSolid } from './physics.js';
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
    const sx = i === 0 ? nx : -nx;
    const sy = i === 0 ? ny : -ny;
    const along = p.vx * sx + p.vy * sy;
    if (along < REEL_MAX_SPEED) {
      p.vx += sx * REEL_FORCE * DT;
      p.vy += sy * REEL_FORCE * DT;
    }
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
export function clampRopeLength(world: World): void {
  const a = world.players[0];
  const b = world.players[1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= ROPE_MAX || d < 0.0001) return;

  const nx = dx / d;
  const ny = dy / d;
  const overshoot = d - ROPE_MAX;

  const ma = mobility(world, 0);
  const mb = mobility(world, 1);
  const total = ma + mb;
  if (total <= 0) return;
  const wa = ma / total;
  const wb = mb / total;

  a.x += nx * overshoot * wa * ROPE_CORRECTION;
  a.y += ny * overshoot * wa * ROPE_CORRECTION;
  b.x -= nx * overshoot * wb * ROPE_CORRECTION;
  b.y -= ny * overshoot * wb * ROPE_CORRECTION;

  // Cancel the radial (separating) component of relative velocity, leaving the
  // tangential component intact so the pair swings instead of stopping dead.
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const radial = rvx * nx + rvy * ny;
  if (radial > 0) {
    const impulse = radial * (1 + ROPE_RESTITUTION);
    a.vx += nx * impulse * wa;
    a.vy += ny * impulse * wa;
    b.vx -= nx * impulse * wb;
    b.vy -= ny * impulse * wb;
    if (radial > ROPE_YANK_SPEED) {
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      pushEvent(world, EV_ROPE_YANK, mx, my, radial, 0);
      // Being ripped off solid ground by your partner is the signature failure
      // of this game, so it is counted and reported on the results screen.
      if ((a.grounded === 1) !== (b.grounded === 1)) world.betrayals++;
    }
  }
}

/** Index of the rope node the cargo hangs from. */
export const ROPE_MID = (ROPE_NODES - 1) >> 1;
