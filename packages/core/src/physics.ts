import { CARGO_H, CARGO_W, PLAYER_H, PLAYER_HALF_W, TILE } from './constants.js';
import {
  T_CONV_L,
  T_CONV_R,
  T_CRUMBLE,
  T_EMPTY,
  T_ICE,
  T_PLATFORM,
  isSolidTile,
  T_SHUTTER,
  T_PLATE,
  type Level,
  type Mover,
  moverX,
  moverY,
  tileAt,
} from './level.js';
import {
  GROUND_CONVEYOR_L,
  GROUND_CONVEYOR_R,
  GROUND_CRUMBLE,
  GROUND_ICE,
  GROUND_MOVER,
  GROUND_NONE,
  GROUND_PLATFORM,
  GROUND_SOLID,
  type World,
} from './types.js';

const EPS = 0.001;
/** Never advance more than half a tile per collision sub-step. */
const MAX_STEP = TILE * 0.5;

/** Is this crumble tile currently standing? */
export function crumbleSolid(level: Level, world: World, index: number): boolean {
  const slot = level.crumbleSlot[index];
  if (slot < 0) return true;
  return world.crumble[slot] >= 0;
}

function tileBlocks(level: Level, world: World, tx: number, ty: number): boolean {
  const t = tileAt(level, tx, ty);
  if (t === T_CRUMBLE) return crumbleSolid(level, world, ty * level.w + tx);
  if (t === T_SHUTTER) return !shutterOpen(level, world, tx, ty);
  return isSolidTile(t);
}

/** Is the shutter covering this tile standing open? */
export function shutterOpen(level: Level, world: World, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) return false;
  const g = level.holdGroup[ty * level.w + tx];
  return g >= 0 && world.open[g] === 1;
}

/** Every tile the box from (l,t) to (r,b) touches, as a callback. */
function overTiles(level: Level, l: number, t: number, r: number, b: number, fn: (i: number) => void): void {
  const x0 = Math.max(0, Math.floor(l / TILE));
  const x1 = Math.min(level.w - 1, Math.floor(r / TILE));
  const y0 = Math.max(0, Math.floor(t / TILE));
  const y1 = Math.min(level.h - 1, Math.floor(b / TILE));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) fn(ty * level.w + tx);
}

/**
 * Work out which shutters are open, from where everybody is standing.
 *
 * Called at the top of the tick, before anything moves, so every peer computes
 * it from the same positions and nothing has to be sent or snapshotted.
 *
 * Two ways a shutter is open. Somebody is holding its plate — a hauler stood on
 * it, or the crate parked on it, which is the answer to a pair who have fumbled
 * a room and would otherwise be stuck outside it. Or somebody is inside the
 * shutter itself, in which case it stays open whatever the plate says: a door
 * that closes on the person walking through it is not a puzzle, it is a
 * player embedded in a wall with no way out.
 */
export function updateHolds(level: Level, world: World): void {
  if (level.holdGroups === 0) return;
  world.open.fill(0);
  const mark = (i: number, want: number): void => {
    const g = level.holdGroup[i];
    if (g >= 0 && level.tiles[i] === want) world.open[g] = 1;
  };
  const box = (x: number, y: number, hw: number, hh: number, want: number): void => {
    overTiles(level, x - hw, y - hh, x + hw, y + hh, (i) => mark(i, want));
  };
  for (const p of world.players) {
    if (p.dead) continue;
    // Standing on a plate: the feet, a hair below them.
    box(p.x, p.y + PLAYER_H / 2 + 2, PLAYER_HALF_W, 2, T_PLATE);
    box(p.x, p.y, PLAYER_HALF_W, PLAYER_H / 2, T_SHUTTER);
  }
  const c = world.cargo;
  if (c.hp > 0) {
    box(c.x, c.y + CARGO_H / 2 + 2, CARGO_W / 2, 2, T_PLATE);
    box(c.x, c.y, CARGO_W / 2, CARGO_H / 2, T_SHUTTER);
  }
}

/** Any full-solid tile overlapping the given AABB? */
export function rectHitsTiles(
  level: Level,
  world: World,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  const x0 = Math.floor(left / TILE);
  const x1 = Math.floor((right - EPS) / TILE);
  const y0 = Math.floor(top / TILE);
  const y1 = Math.floor((bottom - EPS) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tileBlocks(level, world, tx, ty)) return true;
    }
  }
  return false;
}

/** Index of a solid mover overlapping the AABB, or -1. */
export function rectHitsMover(level: Level, tick: number, left: number, top: number, right: number, bottom: number): number {
  for (let i = 0; i < level.movers.length; i++) {
    const m = level.movers[i];
    if (!m.solid) continue;
    const mx = moverX(m, tick);
    const my = moverY(m, tick);
    if (left < mx + m.w && right > mx && top < my + m.h && bottom > my) return i;
  }
  return -1;
}

/** One-way platform tops overlapping the AABB, when falling onto them. */
function platformTopBelow(
  level: Level,
  left: number,
  right: number,
  prevBottom: number,
  bottom: number,
): number {
  if (bottom <= prevBottom) return -1;
  const x0 = Math.floor(left / TILE);
  const x1 = Math.floor((right - EPS) / TILE);
  const y0 = Math.floor(prevBottom / TILE);
  const y1 = Math.floor((bottom - EPS) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    const top = ty * TILE;
    if (prevBottom > top + EPS) continue;
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(level, tx, ty) === T_PLATFORM) return top;
    }
  }
  return -1;
}

/**
 * A reusable AABB mover. The simulation is single-threaded and never re-enters
 * this, so keeping one instance avoids allocating during rollback resimulation
 * (which can replay a dozen ticks inside a single frame).
 */
export class Collider {
  x = 0;
  y = 0;
  hw = 0;
  hh = 0;
  /** -1 blocked moving left, 1 blocked moving right, 0 free. */
  hitX = 0;
  /** -1 blocked moving up, 1 blocked moving down (i.e. landed), 0 free. */
  hitY = 0;
  groundKind = GROUND_NONE;
  ride = -1;
  dropThrough = false;
  /** Crumble slots the body was standing on this move, for triggering breaks. */
  steppedCrumble = -1;

  set(x: number, y: number, hw: number, hh: number): void {
    this.x = x;
    this.y = y;
    this.hw = hw;
    this.hh = hh;
    this.hitX = 0;
    this.hitY = 0;
    this.groundKind = GROUND_NONE;
    this.ride = -1;
    this.steppedCrumble = -1;
  }
}

export const collider = new Collider();

function resolveX(level: Level, world: World, c: Collider, dx: number): void {
  c.x += dx;
  const left = c.x - c.hw;
  const right = c.x + c.hw;
  const top = c.y - c.hh;
  const bottom = c.y + c.hh;
  if (rectHitsTiles(level, world, left, top, right, bottom)) {
    if (dx > 0) {
      c.x = Math.floor(right / TILE) * TILE - c.hw - EPS;
      c.hitX = 1;
    } else if (dx < 0) {
      c.x = (Math.floor(left / TILE) + 1) * TILE + c.hw + EPS;
      c.hitX = -1;
    }
    return;
  }
  const mi = rectHitsMover(level, world.tick, left, top, right, bottom);
  if (mi >= 0) {
    const m = level.movers[mi];
    const mx = moverX(m, world.tick);
    if (dx > 0) {
      c.x = mx - c.hw - EPS;
      c.hitX = 1;
    } else if (dx < 0) {
      c.x = mx + m.w + c.hw + EPS;
      c.hitX = -1;
    }
  }
}

function resolveY(level: Level, world: World, c: Collider, dy: number): void {
  const prevBottom = c.y + c.hh;
  c.y += dy;
  const left = c.x - c.hw;
  const right = c.x + c.hw;
  let top = c.y - c.hh;
  let bottom = c.y + c.hh;

  if (rectHitsTiles(level, world, left, top, right, bottom)) {
    if (dy > 0) {
      c.y = Math.floor(bottom / TILE) * TILE - c.hh - EPS;
      c.hitY = 1;
    } else if (dy < 0) {
      c.y = (Math.floor(top / TILE) + 1) * TILE + c.hh + EPS;
      c.hitY = -1;
    }
    return;
  }

  const mi = rectHitsMover(level, world.tick, left, top, right, bottom);
  if (mi >= 0) {
    const m = level.movers[mi];
    const my = moverY(m, world.tick);
    if (dy > 0) {
      c.y = my - c.hh - EPS;
      c.hitY = 1;
      c.ride = mi;
    } else if (dy < 0) {
      c.y = my + m.h + c.hh + EPS;
      c.hitY = -1;
    }
    return;
  }

  if (dy > 0 && !c.dropThrough) {
    bottom = c.y + c.hh;
    const platTop = platformTopBelow(level, left, right, prevBottom, bottom);
    if (platTop >= 0) {
      c.y = platTop - c.hh - EPS;
      c.hitY = 1;
    }
  }
}

/** Move the collider by (dx, dy), resolving against tiles and solid movers. */
export function moveCollider(level: Level, world: World, c: Collider, dx: number, dy: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_STEP));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0) {
      const before = c.hitX;
      resolveX(level, world, c, sx);
      if (c.hitX !== 0 && before === 0) {
        // Keep pushing on the other axis but stop accumulating on this one.
      }
    }
    if (sy !== 0) resolveY(level, world, c, sy);
  }
}

/** Sample the surface directly under the collider to classify the ground. */
export function probeGround(level: Level, world: World, c: Collider): number {
  const left = c.x - c.hw + 2;
  const right = c.x + c.hw - 2;
  const y = c.y + c.hh + 2;

  const mi = rectHitsMover(level, world.tick, left, c.y + c.hh - 1, right, y);
  if (mi >= 0) {
    c.ride = mi;
    return GROUND_MOVER;
  }

  const ty = Math.floor(y / TILE);
  const x0 = Math.floor(left / TILE);
  const x1 = Math.floor(right / TILE);
  let best = GROUND_NONE;
  for (let tx = x0; tx <= x1; tx++) {
    const t = tileAt(level, tx, ty);
    if (t === T_CRUMBLE) {
      if (crumbleSolid(level, world, ty * level.w + tx)) {
        c.steppedCrumble = level.crumbleSlot[ty * level.w + tx];
        best = GROUND_CRUMBLE;
      }
      continue;
    }
    if (t === T_ICE) return GROUND_ICE;
    if (t === T_CONV_R) return GROUND_CONVEYOR_R;
    if (t === T_CONV_L) return GROUND_CONVEYOR_L;
    if (t === T_PLATFORM && best === GROUND_NONE) best = GROUND_PLATFORM;
    if (isSolidTile(t) && best !== GROUND_CRUMBLE) best = GROUND_SOLID;
  }
  return best;
}

/** How far a rider standing on mover `i` moved between the previous and current tick. */
export function moverDelta(m: Mover, tick: number, out: { dx: number; dy: number }): void {
  out.dx = moverX(m, tick) - moverX(m, tick - 1);
  out.dy = moverY(m, tick) - moverY(m, tick - 1);
}

/** True if the point is inside a solid tile — used to keep rope nodes outside walls. */
export function pointSolid(level: Level, world: World, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  return tileBlocks(level, world, tx, ty);
}

export function tileIsEmpty(level: Level, tx: number, ty: number): boolean {
  return tileAt(level, tx, ty) === T_EMPTY;
}
