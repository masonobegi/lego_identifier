import { CHUNK_W, TILE } from './constants.js';
import { dcos } from './math.js';
import { Rng } from './rng.js';

/* ------------------------------------------------------------------ tiles */

export const T_EMPTY = 0;
export const T_SOLID = 1;
export const T_PLATFORM = 2;
export const T_SPIKE_U = 3;
export const T_SPIKE_D = 4;
export const T_SPIKE_L = 5;
export const T_SPIKE_R = 6;
export const T_LAVA = 7;
export const T_GRIP = 8;
export const T_BOUNCE = 9;
export const T_CRUMBLE = 10;
export const T_ICE = 11;
export const T_CONV_R = 12;
export const T_CONV_L = 13;
export const T_WIND = 14;
export const T_CHECKPOINT = 15;
export const T_GOAL = 16;
export const T_DECO = 17;

/** Characters used when authoring chunks as ASCII art. */
export const TILE_CHARS: Record<string, number> = {
  '.': T_EMPTY,
  '#': T_SOLID,
  '=': T_PLATFORM,
  '^': T_SPIKE_U,
  'v': T_SPIKE_D,
  '<': T_SPIKE_L,
  '>': T_SPIKE_R,
  '~': T_LAVA,
  '*': T_GRIP,
  'o': T_BOUNCE,
  'x': T_CRUMBLE,
  'i': T_ICE,
  'c': T_CONV_R,
  'C': T_CONV_L,
  'W': T_WIND,
  '!': T_CHECKPOINT,
  'F': T_GOAL,
  ':': T_DECO,
  'S': T_EMPTY,
};

/** Tiles that block movement from every direction. */
export function isSolidTile(t: number): boolean {
  return t === T_SOLID || t === T_GRIP || t === T_ICE || t === T_CONV_R || t === T_CONV_L || t === T_BOUNCE;
}

/** Tiles that kill on contact. */
export function isDeadlyTile(t: number): boolean {
  return t === T_SPIKE_U || t === T_SPIKE_D || t === T_SPIKE_L || t === T_SPIKE_R || t === T_LAVA;
}

/** Tiles you can cling to with GRIP. */
export function isGrippyTile(t: number): boolean {
  return t === T_GRIP;
}

/* --------------------------------------------------------------- entities */

/** An oscillating rectangle. Position is a pure function of the tick, so it
 *  costs nothing to snapshot and can never desync. */
export interface Mover {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
  period: number;
  phase: number;
  solid: number;
  deadly: number;
  smooth: number;
}

/** A deadly circle that slides along a line. */
export interface Saw {
  x: number;
  y: number;
  r: number;
  ax: number;
  ay: number;
  period: number;
  phase: number;
  spin: number;
}

/** Triangle or cosine wave in [0,1], evaluated deterministically from the tick. */
export function oscillate(tick: number, period: number, phase: number, smooth: number): number {
  if (period <= 0) return 0;
  let t = (tick + phase) / period;
  t = t - Math.floor(t);
  if (smooth) return 0.5 - 0.5 * dcos(t * 6.283185307179586);
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

export function moverX(m: Mover, tick: number): number {
  return m.x + m.ax * oscillate(tick, m.period, m.phase, m.smooth);
}

export function moverY(m: Mover, tick: number): number {
  return m.y + m.ay * oscillate(tick, m.period, m.phase, m.smooth);
}

export function sawX(s: Saw, tick: number): number {
  return s.x + s.ax * oscillate(tick, s.period, s.phase, 1);
}

export function sawY(s: Saw, tick: number): number {
  return s.y + s.ay * oscillate(tick, s.period, s.phase, 1);
}

/* ------------------------------------------------------------------ chunk */

export interface EntityDef {
  type: 'mover' | 'saw' | 'crusher';
  /** Tile coordinates within the chunk. */
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Travel in tiles. */
  ax?: number;
  ay?: number;
  period?: number;
  phase?: number;
  r?: number;
  smooth?: number;
  solid?: boolean;
  deadly?: boolean;
}

export interface ChunkDef {
  id: string;
  biome: number;
  /** 0 = gentle, 3 = cruel. Used when assembling the endless tower. */
  difficulty: number;
  /** Rows top-to-bottom, each exactly CHUNK_W characters. */
  rows: string[];
  entities?: EntityDef[];
  /** Chunks tagged 'start' or 'goal' are only used as the first/last chunk. */
  tags?: string[];
}

export interface Checkpoint {
  x: number;
  y: number;
}

export interface Level {
  id: string;
  name: string;
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Per-tile biome index, so the renderer can theme the tower as it climbs. */
  biome: Uint8Array;
  movers: Mover[];
  saws: Saw[];
  spawnX: number;
  spawnY: number;
  goalX: number;
  goalY: number;
  checkpoints: Checkpoint[];
  /** For each tile index, its crumble slot, or -1. */
  crumbleSlot: Int32Array;
  /** For each crumble slot, its tile index. */
  crumbleTile: Int32Array;
  widthPx: number;
  heightPx: number;
  chunkIds: string[];
}

export function tileAt(level: Level, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) {
    // Outside the shaft is solid wall; above the top and below the bottom is open
    // so a launched player arcs back down instead of sticking to the ceiling.
    return ty < 0 || ty >= level.h ? T_EMPTY : T_SOLID;
  }
  return level.tiles[ty * level.w + tx];
}

export function tileAtPx(level: Level, x: number, y: number): number {
  return tileAt(level, Math.floor(x / TILE), Math.floor(y / TILE));
}

export function biomeAtPx(level: Level, y: number): number {
  const ty = Math.floor(y / TILE);
  if (ty < 0) return level.biome[0];
  if (ty >= level.h) return level.biome[(level.h - 1) * 1];
  return level.biome[ty];
}

/* --------------------------------------------------------------- assembly */

class LevelBuilder {
  rows: number[][] = [];
  biomeRows: number[] = [];
  movers: Mover[] = [];
  saws: Saw[] = [];
  spawn: { x: number; y: number } | null = null;
  goal: { x: number; y: number } | null = null;
  checkpoints: Checkpoint[] = [];
  chunkIds: string[] = [];
}

function parseChunk(chunk: ChunkDef, builder: LevelBuilder, topRow: number): void {
  for (let r = 0; r < chunk.rows.length; r++) {
    const row = chunk.rows[r];
    const out: number[] = new Array(CHUNK_W).fill(T_EMPTY);
    for (let c = 0; c < CHUNK_W; c++) {
      const ch = c < row.length ? row[c] : '.';
      const t = TILE_CHARS[ch];
      if (t === undefined) {
        throw new Error(`chunk ${chunk.id}: unknown tile character '${ch}' at row ${r} col ${c}`);
      }
      out[c] = t;
      const worldX = c * TILE + TILE / 2;
      const worldY = (topRow + r) * TILE + TILE / 2;
      if (ch === 'S') builder.spawn = { x: worldX, y: worldY };
      if (t === T_GOAL && !builder.goal) builder.goal = { x: worldX, y: worldY };
      if (t === T_CHECKPOINT) builder.checkpoints.push({ x: worldX, y: worldY });
    }
    builder.rows[topRow + r] = out;
    builder.biomeRows[topRow + r] = chunk.biome;
  }

  for (const e of chunk.entities ?? []) {
    const px = e.x * TILE;
    const py = (topRow + e.y) * TILE;
    if (e.type === 'saw') {
      builder.saws.push({
        x: px,
        y: py,
        r: (e.r ?? 1) * TILE,
        ax: (e.ax ?? 0) * TILE,
        ay: (e.ay ?? 0) * TILE,
        period: e.period ?? 180,
        phase: e.phase ?? 0,
        spin: 1,
      });
    } else {
      builder.movers.push({
        x: px,
        y: py,
        w: (e.w ?? 3) * TILE,
        h: (e.h ?? 1) * TILE,
        ax: (e.ax ?? 0) * TILE,
        ay: (e.ay ?? 0) * TILE,
        period: e.period ?? 200,
        phase: e.phase ?? 0,
        solid: e.solid === false ? 0 : 1,
        deadly: e.type === 'crusher' || e.deadly ? 1 : 0,
        smooth: e.smooth ?? 1,
      });
    }
  }
}

/** Stack chunks bottom-up into a single tower. `chunks[0]` is the ground floor. */
export function assembleLevel(id: string, name: string, chunks: ChunkDef[]): Level {
  if (chunks.length === 0) throw new Error(`level ${id} has no chunks`);
  let totalH = 0;
  for (const c of chunks) totalH += c.rows.length;

  const builder = new LevelBuilder();
  let cursor = totalH;
  for (const c of chunks) {
    cursor -= c.rows.length;
    parseChunk(c, builder, cursor);
    builder.chunkIds.push(c.id);
  }

  const w = CHUNK_W;
  const h = totalH;
  const tiles = new Uint8Array(w * h);
  const biome = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    const row = builder.rows[y];
    biome[y] = builder.biomeRows[y] ?? 0;
    for (let x = 0; x < w; x++) tiles[y * w + x] = row ? row[x] : T_EMPTY;
  }

  const crumbleSlot = new Int32Array(w * h).fill(-1);
  const crumbleList: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === T_CRUMBLE) {
      crumbleSlot[i] = crumbleList.length;
      crumbleList.push(i);
    }
  }

  if (!builder.spawn) throw new Error(`level ${id} has no spawn marker 'S'`);
  if (!builder.goal) throw new Error(`level ${id} has no goal tile 'F'`);

  // Checkpoints are ordered by height so progress can only ever move upward.
  builder.checkpoints.sort((a, b) => b.y - a.y);

  return {
    id,
    name,
    w,
    h,
    tiles,
    biome,
    movers: builder.movers,
    saws: builder.saws,
    spawnX: builder.spawn.x,
    spawnY: builder.spawn.y,
    goalX: builder.goal.x,
    goalY: builder.goal.y,
    checkpoints: builder.checkpoints,
    crumbleSlot,
    crumbleTile: Int32Array.from(crumbleList),
    widthPx: w * TILE,
    heightPx: h * TILE,
    chunkIds: builder.chunkIds,
  };
}

/**
 * Endless mode. Picks a start chunk, then an escalating run of body chunks
 * drawn from the pool by difficulty, then the goal chunk. Purely a function of
 * the seed, so both players generate the same tower without sending it.
 */
export function generateTower(seed: number, pool: ChunkDef[], length: number): ChunkDef[] {
  const rng = new Rng(seed);
  const starts = pool.filter((c) => c.tags?.includes('start'));
  const goals = pool.filter((c) => c.tags?.includes('goal'));
  const body = pool.filter((c) => !c.tags?.includes('start') && !c.tags?.includes('goal'));
  if (starts.length === 0 || goals.length === 0 || body.length === 0) {
    throw new Error('tower pool needs at least one start, one goal and one body chunk');
  }

  const out: ChunkDef[] = [rng.pick(starts)];
  let lastId = '';
  for (let i = 0; i < length; i++) {
    // Difficulty ramps from 0 to 3 across the run.
    const target = Math.min(3, Math.floor((i / Math.max(1, length - 1)) * 3.999));
    let candidates = body.filter((c) => c.difficulty <= target && c.id !== lastId);
    if (candidates.length === 0) candidates = body.filter((c) => c.id !== lastId);
    if (candidates.length === 0) candidates = body;
    // Prefer chunks at exactly the target difficulty when any exist.
    const exact = candidates.filter((c) => c.difficulty === target);
    const chosen = rng.pick(exact.length > 0 && rng.nextFloat() < 0.72 ? exact : candidates);
    out.push(chosen);
    lastId = chosen.id;
  }

  // Every tower needs at least one two-person step in it.
  //
  // Only some chunks carry a gate, so a short run could pick none of them and
  // hand out a tower a single player could climb — six of twenty-five seeded
  // towers did, which makes the Gauntlet a mode where whether you need your
  // friend depends on the seed. If the run came out without one, swap a gated
  // chunk in over the middle of it, where the difficulty ramp is already
  // heading somewhere and a sudden two-person move is not the first thing that
  // happens to you.
  const gated = body.filter((c) => c.tags?.includes('gate'));
  if (gated.length > 0 && !out.some((c) => c.tags?.includes('gate'))) {
    const at = 1 + Math.floor((out.length - 1) / 2);
    out[Math.min(at, out.length - 1)] = rng.pick(gated);
  }

  out.push(rng.pick(goals));
  return out;
}
