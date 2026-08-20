/**
 * Where the climb actually goes.
 *
 * A flood fill over every standable tile, using a movement envelope measured
 * from the simulation itself (scripts/calibrate-jump.mjs), plus the path it
 * found from the spawn to the goal.
 *
 * This lives in the core package rather than in the verification script
 * because two very different things need the same answer and must never
 * disagree: the build gate that proves a tower is climbable, and the bot
 * partner that has to climb it. Earlier bots guessed at footholds and stalled
 * nine metres up a six-hundred-tile tower; this one walks the route the
 * verifier already proved.
 *
 * Nothing here is part of the simulation — it reads a level, never a world —
 * so it is free to be slow. It is not: a full campaign fill is ~30 ms.
 */
import { PLAYER_H, TILE } from './constants.js';
import { T_CRUMBLE, T_GOAL, T_PLATFORM, isDeadlyTile, isSolidTile, tileAt, type Level } from './level.js';

/** One standable cell: the tile a player's body occupies while standing. */
export interface RouteCell {
  x: number;
  y: number;
}

/** A run of adjacent standable cells on one row. */
export interface Ledge {
  y: number;
  x0: number;
  x1: number;
}

export interface LevelAnalysis {
  ok: boolean;
  reason?: string;
  /** Topmost row the fill reached. Lower numbers are higher up the tower. */
  highest: number;
  reached: number;
  total: number;
  /** Cell-by-cell path from the spawn to a cell touching the goal. */
  route: RouteCell[];
  start: RouteCell | null;
  standable: Uint8Array;
  /** Flood-fill parent index per cell, or -1 if never reached. */
  seen: Int32Array;
}

/**
 * Movement envelope, in tiles, measured from the simulation and then reduced
 * by one column so the analysis never claims a jump that needs perfect timing.
 */
export const MAX_RISE = 3;
/** Cell distances a jump covers per row risen, from scripts/calibrate-jump.mjs. */
export const REACH_BY_RISE = [4, 3, 3, 3];
export const FALL_DRIFT = 7;
/**
 * How far a hauler can be reeled up a wall by a partner standing on top of it.
 *
 * Measured against the simulation: a pit ten tiles deep is escapable, and the
 * limit in practice is the rope's own length rather than the climb. Kept below
 * that so the analysis never claims a climb that only just works.
 */
export const REEL_CLIMB_TILES = 8;

/** Options for the fill. Solo is the default and is the stricter of the two. */
export interface AnalyseOptions {
  /**
   * Allow climbs that need a second person: reeling up a wall with a partner
   * braced on the lip. Off by default, so the plain fill still answers the
   * question "could one player do this", which is what makes a rope gate
   * detectable — a gate is exactly a cell the coop fill reaches and the solo
   * fill does not.
   */
  coop?: boolean;
}

/** Every cell a player could stand in: solid footing, clear body, clear head. */
export function standableGrid(level: Level): Uint8Array {
  const { w, h } = level;
  const grid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const here = tileAt(level, x, y);
      const below = tileAt(level, x, y + 1);
      const head = tileAt(level, x, y - 1);
      if (isSolidTile(here) || isDeadlyTile(here)) continue;
      if (isSolidTile(head) || isDeadlyTile(head)) continue;
      if (!(isSolidTile(below) || below === T_PLATFORM || below === T_CRUMBLE)) continue;
      grid[y * w + x] = 1;
    }
  }
  return grid;
}

function findStart(level: Level, standable: Uint8Array): RouteCell | null {
  const sx = Math.floor(level.spawnX / TILE);
  const sy = Math.floor(level.spawnY / TILE);
  for (let dy = 0; dy < 8; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) continue;
      if (standable[y * level.w + x]) return { x, y };
    }
  }
  return null;
}

/** Flood fill the level from the spawn and hand back the route to the goal. */
export function analyseLevel(level: Level, options: AnalyseOptions = {}): LevelAnalysis {
  const { w, h } = level;
  const standable = standableGrid(level);
  const seen = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];

  const start = findStart(level, standable);
  if (!start) {
    return {
      ok: false,
      reason: 'the spawn point has nothing to stand on',
      highest: 0,
      reached: 0,
      total: 0,
      route: [],
      start: null,
      standable,
      seen,
    };
  }
  const startIndex = start.y * w + start.x;
  seen[startIndex] = startIndex;
  queue.push(startIndex);

  const visit = (from: number, x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (!standable[i] || seen[i] !== -1) return;
    seen[i] = from;
    queue.push(i);
  };

  let highest = start.y;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % w;
    const y = (i - x) / w;
    if (y < highest) highest = y;

    visit(i, x - 1, y);
    visit(i, x + 1, y);

    // Deliberately models only walking, an ordinary jump, and falling.
    // Bounce pads and climbable grip walls make far more of the level
    // reachable, but they are shortcuts — proving the route works without them
    // proves it works for a player who never finds them.
    for (let dy = 0; dy <= MAX_RISE; dy++) {
      const span = REACH_BY_RISE[dy];
      for (let dx = -span; dx <= span; dx++) visit(i, x + dx, y - dy);
    }
    for (let ny = y + 1; ny < h; ny++) {
      for (let dx = -FALL_DRIFT; dx <= FALL_DRIFT; dx++) visit(i, x + dx, ny);
    }

    // The rope climb. Stand beside a wall with a partner braced on top of it,
    // haul on the rope, walk your feet up, and mantle over the lip. This is the
    // only edge in the fill that needs two people, which is what makes it
    // useful: a cell reachable only through one of these is a cell the game
    // cannot be finished without a partner.
    if (options.coop) {
      for (const side of [-1, 1]) {
        if (!isSolidTile(tileAt(level, x + side, y))) continue;
        for (let up = 1; up <= REEL_CLIMB_TILES; up++) {
          // A ceiling on your own side stops the climb dead.
          const overhead = tileAt(level, x, y - up);
          if (isSolidTile(overhead) || isDeadlyTile(overhead)) break;
          if (isSolidTile(tileAt(level, x + side, y - up))) continue;
          // The wall ended here: this is the lip you mantle onto.
          visit(i, x + side, y - up);
          break;
        }
      }
    }
  }

  // The finish rule, copied from checkGoal: any goal tile within one of yours.
  let goalCell = -1;
  for (let y = 0; y < h && goalCell < 0; y++) {
    for (let x = 0; x < w && goalCell < 0; x++) {
      if (seen[y * w + x] === -1) continue;
      for (let dy = -1; dy <= 1 && goalCell < 0; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (tileAt(level, x + dx, y + dy) === T_GOAL) {
            goalCell = y * w + x;
            break;
          }
        }
      }
    }
  }

  let total = 0;
  let reached = 0;
  for (let i = 0; i < standable.length; i++) {
    if (!standable[i]) continue;
    total++;
    if (seen[i] !== -1) reached++;
  }

  const route: RouteCell[] = [];
  if (goalCell >= 0) {
    let cursor = goalCell;
    while (cursor !== startIndex) {
      route.push({ x: cursor % w, y: (cursor - (cursor % w)) / w });
      cursor = seen[cursor];
    }
    route.push({ x: start.x, y: start.y });
    route.reverse();
  }

  return { ok: goalCell >= 0, highest, reached, total, route, start, standable, seen };
}

/**
 * Group a cell path into the ledges it crosses.
 *
 * The flood fill hands back one cell per step, but a player does not launch
 * from wherever the search happened to walk — they walk along the ledge and
 * pick a spot. Testing ledge to ledge, with the launch column as part of the
 * search, is what the game actually asks of them.
 */
export function ledgeSteps(
  level: Level,
  route: RouteCell[],
  standable: Uint8Array,
): { from: Ledge; to: Ledge }[] {
  const { w } = level;
  const ledgeAt = (cell: RouteCell): Ledge => {
    let x0 = cell.x;
    let x1 = cell.x;
    while (x0 > 0 && standable[cell.y * w + (x0 - 1)]) x0--;
    while (x1 < w - 1 && standable[cell.y * w + (x1 + 1)]) x1++;
    return { y: cell.y, x0, x1 };
  };

  const ledges: Ledge[] = [];
  for (const cell of route) {
    const l = ledgeAt(cell);
    const last = ledges[ledges.length - 1];
    if (last && last.y === l.y && last.x0 === l.x0 && last.x1 === l.x1) continue;
    ledges.push(l);
  }
  const steps: { from: Ledge; to: Ledge }[] = [];
  for (let i = 1; i < ledges.length; i++) {
    if (ledges[i].y < ledges[i - 1].y) steps.push({ from: ledges[i - 1], to: ledges[i] });
  }
  return steps;
}

/**
 * A route, plus the lookup a follower needs: given the cell it is standing in,
 * how far along the route is it?
 */
export interface RoutePlan {
  ok: boolean;
  cells: RouteCell[];
  /** Route index per level cell, or -1. */
  indexAt: Int32Array;
  standable: Uint8Array;
  w: number;
  h: number;
}

export function planRoute(level: Level): RoutePlan {
  const result = analyseLevel(level);
  const indexAt = new Int32Array(level.w * level.h).fill(-1);
  for (let i = 0; i < result.route.length; i++) {
    const c = result.route[i];
    indexAt[c.y * level.w + c.x] = i;
  }
  return {
    ok: result.ok,
    cells: result.route,
    indexAt,
    standable: result.standable,
    w: level.w,
    h: level.h,
  };
}

/** The cell a standing body occupies, given its centre. */
export function bodyCell(x: number, y: number): RouteCell {
  return { x: Math.floor(x / TILE), y: Math.floor((y + PLAYER_H / 2 + 1) / TILE) - 1 };
}

/** Centre of a cell, in world pixels, where a standing body's centre would be. */
export function cellCentreX(cx: number): number {
  return cx * TILE + TILE / 2;
}

export function cellCentreY(cy: number): number {
  return (cy + 1) * TILE - PLAYER_H / 2 - 1;
}
