import { TILE } from './constants.js';
import {
  T_LAVA,
  T_SPIKE_D,
  T_SPIKE_L,
  T_SPIKE_R,
  T_SPIKE_U,
  type Level,
  moverX,
  moverY,
  sawX,
  sawY,
  tileAt,
} from './level.js';
import type { World } from './types.js';

/**
 * Deadly tiles are smaller than their cell so that brushing past a spike tip
 * doesn't kill you. Generosity here is the difference between "hard" and
 * "unfair", and this game is already testing a friendship.
 */
function deadlyTileRect(t: number, tx: number, ty: number, out: number[]): boolean {
  const x = tx * TILE;
  const y = ty * TILE;
  switch (t) {
    case T_SPIKE_U:
      out[0] = x + 4; out[1] = y + 9; out[2] = TILE - 8; out[3] = TILE - 9;
      return true;
    case T_SPIKE_D:
      out[0] = x + 4; out[1] = y; out[2] = TILE - 8; out[3] = TILE - 9;
      return true;
    case T_SPIKE_L:
      out[0] = x; out[1] = y + 4; out[2] = TILE - 9; out[3] = TILE - 8;
      return true;
    case T_SPIKE_R:
      out[0] = x + 9; out[1] = y + 4; out[2] = TILE - 9; out[3] = TILE - 8;
      return true;
    case T_LAVA:
      out[0] = x; out[1] = y + 5; out[2] = TILE; out[3] = TILE - 5;
      return true;
    default:
      return false;
  }
}

const rectScratch = [0, 0, 0, 0];

/** Does this AABB touch anything lethal? */
export function hazardAt(
  level: Level,
  world: World,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  const x0 = Math.floor(left / TILE);
  const x1 = Math.floor((right - 0.001) / TILE);
  const y0 = Math.floor(top / TILE);
  const y1 = Math.floor((bottom - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(level, tx, ty);
      if (!deadlyTileRect(t, tx, ty, rectScratch)) continue;
      const rx = rectScratch[0];
      const ry = rectScratch[1];
      if (left < rx + rectScratch[2] && right > rx && top < ry + rectScratch[3] && bottom > ry) return true;
    }
  }

  for (let i = 0; i < level.saws.length; i++) {
    const s = level.saws[i];
    const cx = sawX(s, world.tick);
    const cy = sawY(s, world.tick);
    // Closest point on the AABB to the saw centre.
    const px = cx < left ? left : cx > right ? right : cx;
    const py = cy < top ? top : cy > bottom ? bottom : cy;
    const dx = cx - px;
    const dy = cy - py;
    if (dx * dx + dy * dy < s.r * s.r) return true;
  }

  for (let i = 0; i < level.movers.length; i++) {
    const m = level.movers[i];
    if (!m.deadly) continue;
    const mx = moverX(m, world.tick);
    const my = moverY(m, world.tick);
    if (left < mx + m.w && right > mx && top < my + m.h && bottom > my) return true;
  }

  return false;
}
