import {
  TILE,
  T_BOUNCE,
  T_CHECKPOINT,
  T_CONV_L,
  T_CONV_R,
  T_CRUMBLE,
  T_DECO,
  T_EMPTY,
  T_GOAL,
  T_GRIP,
  T_ICE,
  T_LAVA,
  T_PLATFORM,
  T_SOLID,
  T_SPIKE_D,
  T_SPIKE_L,
  T_SPIKE_R,
  T_SPIKE_U,
  T_WIND,
  type Level,
  type World,
} from '@haulmates/core';
import { biomeFor, tileHash, type BiomePalette } from './palette.js';
import { LOAD_MARKS, chevronPattern, fillChevron, stencilMark } from './stencil.js';

/** Rows of tiles baked into one cached canvas. */
const BLOCK_ROWS = 24;
/** How many baked blocks to keep. Six covers the tallest view plus scroll. */
const CACHE_SIZE = 10;

/** Tiles whose appearance changes at runtime are never baked. */
function isDynamic(t: number): boolean {
  return t === T_CRUMBLE || t === T_CHECKPOINT || t === T_GOAL || t === T_WIND;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

/**
 * Bakes the static parts of the tower into per-block canvases.
 *
 * A visible screen can hold well over three thousand tiles, each needing
 * several draw calls for its edges and texture. Baking turns that into one
 * `drawImage` per block and keeps the frame budget for things that move.
 */
/** Marks kept per block. Past this the wall turns to soup rather than history. */
const SCUFF_LIMIT = 96;

export class TileCache {
  private blocks = new Map<number, HTMLCanvasElement>();
  private order: number[] = [];
  private levelId = '';
  private paletteKey = '';
  /**
   * Where the rope has ground chalk into the paint, per block, as a flat
   * [x, y, r, ...] ring buffer in block-local pixels.
   *
   * Kept outside the baked canvases on purpose. The canvas cache is an LRU of
   * six blocks, so a player who climbs twenty floors and looks back down would
   * find the wall wiped clean if the marks lived only in the bitmap. Storing
   * them here and replaying them on every bake is what makes the tower
   * remember the route — including the three times you fell back down it.
   */
  private scuffs = new Map<number, number[]>();

  invalidate(): void {
    this.blocks.clear();
    this.order.length = 0;
  }

  /** Forget the tower's history. Called when a new level is assembled. */
  private forgetScuffs(): void {
    this.scuffs.clear();
  }

  /**
   * Record a rope scuff at a world position. Cheap enough to call for every
   * sliding rope node every frame; it dedupes onto a coarse grid itself.
   */
  addScuff(worldX: number, worldY: number, radius: number): void {
    const rows = BLOCK_ROWS * TILE;
    const index = Math.floor(worldY / rows);
    if (index < 0) return;
    let ring = this.scuffs.get(index);
    if (!ring) {
      ring = [];
      this.scuffs.set(index, ring);
    }
    const lx = worldX;
    const ly = worldY - index * rows;
    // Skip a mark that lands on top of the previous one, or the rope would
    // burn a hole rather than leave a trail.
    const n = ring.length;
    if (n >= 3 && Math.abs(ring[n - 3] - lx) < 5 && Math.abs(ring[n - 2] - ly) < 5) return;
    if (ring.length >= SCUFF_LIMIT * 3) ring.splice(0, 3);
    ring.push(lx, ly, radius);

    const canvas = this.blocks.get(index);
    const ctx = canvas?.getContext('2d');
    if (ctx) paintScuff(ctx, lx, ly, radius, this.scuffPaint, this.scuffAlpha);
  }

  private scuffPaint = '#FFFDF6';
  private scuffAlpha = 0.1;

  block(level: Level, index: number, highContrast: boolean): HTMLCanvasElement | null {
    const key = `${level.id}|${highContrast}`;
    if (key !== this.levelId + '|' + this.paletteKey) {
      this.invalidate();
      if (level.id !== this.levelId) this.forgetScuffs();
      this.levelId = level.id;
      this.paletteKey = String(highContrast);
    }
    const existing = this.blocks.get(index);
    if (existing) return existing;

    const rowStart = index * BLOCK_ROWS;
    if (rowStart >= level.h) return null;
    const rows = Math.min(BLOCK_ROWS, level.h - rowStart);
    const canvas = document.createElement('canvas');
    canvas.width = level.w * TILE;
    canvas.height = rows * TILE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Two passes over the same canvas, with the paint laid down between them.
    //
    // FIELD is surface: tile bodies and texture. READS is everything whose
    // shape communicates a rule — chevron caps, edges, spikes, rollers. The
    // stencil paint goes on after FIELD and before READS, so it is clipped to
    // real geometry by `source-atop` and can never end up on top of a surface
    // the player has to parse at speed. One canvas rather than two: the
    // ordering gives the same guarantee without doubling the per-frame blits.
    const sweep = (pass: TilePass): void => {
      for (let ry = 0; ry < rows; ry++) {
        const ty = rowStart + ry;
        const palette = biomeFor(level.biome[ty]);
        for (let tx = 0; tx < level.w; tx++) {
          const t = level.tiles[ty * level.w + tx];
          if (t === T_EMPTY || isDynamic(t)) continue;
          drawStaticTile(ctx, level, tx, ty, ry, t, palette, highContrast, pass, rowStart * TILE);
        }
      }
    };

    sweep('field');
    if (!highContrast) {
      const palette = biomeFor(level.biome[Math.min(level.h - 1, rowStart)]);
      paintLoadMarks(ctx, level, rowStart, rows, palette);
    }
    sweep('reads');

    // Replay everything the rope has ground into this block. On top of the
    // reads pass rather than under it, because a scuff is chalk sitting on the
    // paint — but at a low enough alpha that it can never hide an edge.
    const skin = biomeFor(level.biome[Math.min(level.h - 1, rowStart)]);
    this.scuffPaint = skin.chalk;
    this.scuffAlpha = highContrast ? 0 : skin.scuffAlpha;
    const ring = this.scuffs.get(index);
    if (ring && this.scuffAlpha > 0) {
      for (let i = 0; i < ring.length; i += 3) {
        paintScuff(ctx, ring[i], ring[i + 1], ring[i + 2], this.scuffPaint, this.scuffAlpha);
      }
    }

    this.blocks.set(index, canvas);
    this.order.push(index);
    while (this.order.length > CACHE_SIZE) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.blocks.delete(evicted);
    }
    return canvas;
  }

  static blockRows(): number {
    return BLOCK_ROWS;
  }
}

/** One chalk smear. Soft-edged, so a trail reads as wear rather than as dots. */
function paintScuff(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour: string,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function neighbour(level: Level, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) return T_SOLID;
  return level.tiles[ty * level.w + tx];
}

/**
 * Does the tile next door continue the plank?
 *
 * `isFilled` is about occlusion and deliberately says a platform is not filled,
 * which is right for the solid-tile edging that uses it and wrong here: it made
 * every tile of a sixteen-tile plank believe it was a one-tile plank, so each
 * drew its own pair of end brackets and its own hazard tape. Ice and conveyors
 * count, because `restyle()` paints them along a plank run.
 */
function plankEnd(t: number): boolean {
  return t !== T_PLATFORM && t !== T_ICE && t !== T_CONV_L && t !== T_CONV_R;
}

function isFilled(t: number): boolean {
  return t === T_SOLID || t === T_GRIP || t === T_ICE || t === T_CONV_L || t === T_CONV_R || t === T_BOUNCE || t === T_CRUMBLE;
}

type TilePass = 'field' | 'reads';

/**
 * Small load markings on the flats. One tile in fourteen, chosen by the same
 * hash that drives every other bit of texture so the wall is stable.
 */
function paintLoadMarks(
  ctx: CanvasRenderingContext2D,
  level: Level,
  rowStart: number,
  rows: number,
  p: BiomePalette,
): void {
  if (p.paintAlpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = p.paintAlpha * 0.8;
  for (let ry = 2; ry < rows - 2; ry++) {
    const ty = rowStart + ry;
    for (let tx = 2; tx < level.w - 2; tx++) {
      const h = tileHash(tx, ty);
      if (h < 0.965) continue;
      if (!isFilled(level.tiles[ty * level.w + tx])) continue;
      const mark = stencilMark(LOAD_MARKS[Math.floor(h * 1000) % LOAD_MARKS.length], 9, p.stencil);
      if (mark) ctx.drawImage(mark, tx * TILE - TILE, ry * TILE + 6);
    }
  }
  ctx.restore();
}

function drawStaticTile(
  ctx: CanvasRenderingContext2D,
  level: Level,
  tx: number,
  ty: number,
  localRow: number,
  t: number,
  p: BiomePalette,
  highContrast: boolean,
  pass: TilePass,
  blockWorldY: number,
): void {
  const x = tx * TILE;
  const y = localRow * TILE;
  const above = neighbour(level, tx, ty - 1);
  const below = neighbour(level, tx, ty + 1);
  const left = neighbour(level, tx - 1, ty);
  const right = neighbour(level, tx + 1, ty);
  const openAbove = !isFilled(above);
  const rnd = tileHash(tx, ty);

  // T_SOLID splits itself across both passes. Everything else belongs to
  // exactly one: if its shape states a rule it goes over the paint, otherwise
  // it is surface and goes under. Drawing a tile in both passes would draw it
  // twice, which is wasted work and doubles every alpha blend in it.
  if (t !== T_SOLID) {
    const statesARule =
      t === T_SPIKE_U ||
      t === T_SPIKE_D ||
      t === T_SPIKE_L ||
      t === T_SPIKE_R ||
      t === T_PLATFORM ||
      t === T_BOUNCE ||
      t === T_LAVA;
    if (statesARule !== (pass === 'reads')) return;
  }

  switch (t) {
    case T_SOLID: {
      if (pass === 'field') {
        ctx.fillStyle = p.tileBody;
        ctx.fillRect(x, y, TILE, TILE);
        // Texture: a couple of stable blotches so flat walls do not read as gaps.
        if (!highContrast) {
          ctx.fillStyle = p.tileDetail;
          ctx.fillRect(x + 2 + rnd * 9, y + 3 + tileHash(ty, tx) * 12, 5 + rnd * 5, 3);
          ctx.fillRect(x + TILE - 9 - rnd * 6, y + TILE - 8 - rnd * 6, 4, 4);
        }
        return;
      }

      // Every standable top gets the hazard band, boxed by ink above and below.
      // The boxing is load-bearing rather than decorative: in the Freezer the
      // light half of the chevron is nearly the colour of the sky, and without
      // a rule under it the ledge cap would dissolve into the background.
      if (openAbove) {
        const chevron = highContrast ? null : chevronPattern(ctx, p);
        if (chevron) {
          fillChevron(ctx, chevron, blockWorldY + y, x, y, TILE, 6);
        } else {
          ctx.fillStyle = p.ink;
          ctx.fillRect(x, y, TILE, 6);
        }
        ctx.fillStyle = p.ink;
        ctx.fillRect(x, y, TILE, 1);
        ctx.fillRect(x, y + 6, TILE, 2);
      }
      ctx.fillStyle = p.tileEdge;
      if (!isFilled(left)) ctx.fillRect(x, y, 2, TILE);
      if (!isFilled(right)) ctx.fillRect(x + TILE - 2, y, 2, TILE);
      if (!isFilled(below)) ctx.fillRect(x, y + TILE - 3, TILE, 3);
      return;
    }
    case T_ICE: {
      // An icy plank where it is part of a plank run, an ice block where it is
      // not. `restyle()` gives the outer columns of a route foothold to ice, so
      // most ice in the game is now a strip along a board rather than a slab.
      if (!plankEnd(left) || !plankEnd(right)) {
        drawPlank(ctx, x, y, plankEnd(left), plankEnd(right), '#3b6a8c', '#d6f2ff', '#1d3448', '#8fd4f0', rnd, null);
        return;
      }
      ctx.fillStyle = '#3b6a8c';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#69a8cc';
      ctx.fillRect(x, y, TILE, openAbove ? 5 : 2);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#e8f8ff';
      ctx.beginPath();
      ctx.moveTo(x + 4 + rnd * 8, y + TILE);
      ctx.lineTo(x + 10 + rnd * 8, y);
      ctx.lineTo(x + 14 + rnd * 8, y);
      ctx.lineTo(x + 8 + rnd * 8, y + TILE);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      if (openAbove) {
        ctx.fillStyle = '#d6f2ff';
        ctx.fillRect(x, y, TILE, 3);
      }
      return;
    }
    case T_GRIP: {
      ctx.fillStyle = shade(p.tileBody, -18);
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#c9a24a';
      ctx.fillRect(x + 4, y, 4, TILE);
      ctx.fillRect(x + TILE - 8, y, 4, TILE);
      ctx.fillStyle = '#8a6c2c';
      for (let i = 0; i < 2; i++) ctx.fillRect(x + 4, y + 5 + i * 11, TILE - 8, 3);
      return;
    }
    case T_CONV_L:
    case T_CONV_R: {
      // Same shape as the plank it is bolted into; the belt itself is the
      // animated overlay drawn in the `reads` pass.
      if (!plankEnd(left) || !plankEnd(right)) {
        drawPlank(ctx, x, y, plankEnd(left), plankEnd(right), '#2b3040', '#5b6480', '#1d212c', '#8b95b5', rnd, null);
        return;
      }
      ctx.fillStyle = '#2b3040';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#454d66';
      ctx.fillRect(x, y, TILE, 7);
      ctx.fillStyle = '#1d212c';
      ctx.fillRect(x, y + 7, TILE, 2);
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.fillStyle = '#5b6480';
        ctx.arc(x + 7 + i * 11, y + 15, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case T_BOUNCE: {
      ctx.fillStyle = shade(p.tileBody, -10);
      ctx.fillRect(x, y + 8, TILE, TILE - 8);
      ctx.fillStyle = '#59e08a';
      ctx.beginPath();
      ctx.moveTo(x, y + 10);
      ctx.quadraticCurveTo(x + TILE / 2, y - 4, x + TILE, y + 10);
      ctx.lineTo(x + TILE, y + 14);
      ctx.quadraticCurveTo(x + TILE / 2, y + 2, x, y + 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#9ff5bd';
      ctx.fillRect(x + 3, y + 11, TILE - 6, 2);
      return;
    }
    case T_PLATFORM: {
      // A scaffold plank, and the most important tile in the game.
      //
      // Every foothold in the tower is one of these now — the whole climb is
      // built out of them — and it used to be drawn as a seven-pixel band in a
      // *lightened* body colour with two small stubs hanging off it. One of
      // those on its own reads fine. Six hundred rows of them read as a field
      // of pale dashes: nothing in the frame looked like something you could
      // stand on, and the tower had no weight at all.
      //
      // Hazard tape goes on the ends of a plank and plain ink along the middle
      // of it, which is where a yard actually puts the tape: on the edge you
      // can walk off. Taping the whole board was the first attempt and it
      // turned the screen into ten copies of the loudest thing in the palette.
      // A warning that is everywhere is not a warning, it is a texture.
      const capL = plankEnd(left);
      const capR = plankEnd(right);
      const tape =
        highContrast || !(capL || capR)
          ? null
          : () => {
              const chevron = chevronPattern(ctx, p);
              if (chevron) fillChevron(ctx, chevron, blockWorldY + y, x, y + 1, TILE, 4);
              else {
                ctx.fillStyle = p.ink;
                ctx.fillRect(x, y + 1, TILE, 4);
              }
            };
      drawPlank(ctx, x, y, capL, capR, p.tileBody, tape ? null : p.ink, p.ink, p.tileEdge, rnd, tape);
      return;
    }
    case T_LAVA: {
      const grad = ctx.createLinearGradient(x, y, x, y + TILE);
      grad.addColorStop(0, '#ffcf5c');
      grad.addColorStop(0.25, '#ff7a1f');
      grad.addColorStop(1, '#b8260b');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, TILE, TILE);
      return;
    }
    case T_SPIKE_U:
    case T_SPIKE_D:
    case T_SPIKE_L:
    case T_SPIKE_R: {
      drawSpikes(ctx, x, y, t, p);
      return;
    }
    case T_DECO: {
      ctx.fillStyle = shade(p.tileBody, -34);
      ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      return;
    }
    default:
      return;
  }
}

/**
 * The scaffold plank the whole tower is built from.
 *
 * Factored out because a route foothold is not always a plain one-way platform:
 * `restyle()` gives parts of one to ice or a conveyor, and those were drawn as
 * full-height blocks — so a strip of ice in the middle of a plank read as a
 * different kind of object dropped on top of the level, twice the thickness of
 * the boards either side of it. Same silhouette, different surface, is what a
 * material change should look like.
 *
 * `nose` is the walking surface, `body` the board, `bolt` the fixings. Passing
 * a null nose means "tape it", which only the ends of a run ask for.
 */
export function drawPlank(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  capL: boolean,
  capR: boolean,
  body: string,
  nose: string | null,
  ink: string,
  bolt: string,
  rnd: number,
  tape: (() => void) | null,
): void {
  ctx.fillStyle = 'rgba(30,26,20,0.16)';
  ctx.fillRect(x, y + 10, TILE, 3);

  ctx.fillStyle = body;
  ctx.fillRect(x, y + 1, TILE, 9);

  if (nose === null && tape) tape();
  else {
    ctx.fillStyle = nose ?? ink;
    ctx.fillRect(x, y + 1, TILE, 4);
  }

  ctx.fillStyle = ink;
  ctx.fillRect(x, y, TILE, 1);
  ctx.fillRect(x, y + 5, TILE, 1);
  ctx.fillRect(x, y + 9, TILE, 2);

  ctx.fillStyle = bolt;
  ctx.fillRect(x + 4 + Math.floor(rnd * 12), y + 6, 2, 2);

  ctx.fillStyle = ink;
  if (capL) {
    ctx.fillRect(x, y, 2, 11);
    ctx.fillRect(x + 1, y + 11, 4, 2);
  }
  if (capR) {
    ctx.fillRect(x + TILE - 2, y, 2, 11);
    ctx.fillRect(x + TILE - 5, y + 11, 4, 2);
  }
}

function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, p: BiomePalette): void {
  const count = 3;
  const w = TILE / count;
  // Solid ink. Pale steel spikes vanished against a bone-white ground, which
  // is the one place in the game where being hard to see is fatal.
  ctx.fillStyle = p.ink;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    if (t === T_SPIKE_U) {
      ctx.moveTo(x + i * w, y + TILE);
      ctx.lineTo(x + i * w + w / 2, y + 3);
      ctx.lineTo(x + (i + 1) * w, y + TILE);
    } else if (t === T_SPIKE_D) {
      ctx.moveTo(x + i * w, y);
      ctx.lineTo(x + i * w + w / 2, y + TILE - 3);
      ctx.lineTo(x + (i + 1) * w, y);
    } else if (t === T_SPIKE_L) {
      ctx.moveTo(x + TILE, y + i * w);
      ctx.lineTo(x + 3, y + i * w + w / 2);
      ctx.lineTo(x + TILE, y + (i + 1) * w);
    } else {
      ctx.moveTo(x, y + i * w);
      ctx.lineTo(x + TILE - 3, y + i * w + w / 2);
      ctx.lineTo(x, y + (i + 1) * w);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = p.ink;
  if (t === T_SPIKE_U) ctx.fillRect(x, y + TILE - 4, TILE, 4);
  else if (t === T_SPIKE_D) ctx.fillRect(x, y, TILE, 4);
  else if (t === T_SPIKE_L) ctx.fillRect(x + TILE - 4, y, 4, TILE);
  else ctx.fillRect(x, y, 4, TILE);
}

/** Tiles that animate, drawn fresh every frame over the baked blocks. */
export function drawDynamicTiles(
  ctx: CanvasRenderingContext2D,
  level: Level,
  world: World,
  time: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const tx0 = Math.max(0, Math.floor(x0 / TILE));
  const tx1 = Math.min(level.w - 1, Math.floor(x1 / TILE));
  const ty0 = Math.max(0, Math.floor(y0 / TILE));
  const ty1 = Math.min(level.h - 1, Math.floor(y1 / TILE));

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = level.tiles[ty * level.w + tx];
      const x = tx * TILE;
      const y = ty * TILE;
      switch (t) {
        case T_CRUMBLE: {
          const slot = level.crumbleSlot[ty * level.w + tx];
          const state = slot >= 0 ? world.crumble[slot] : 0;
          if (state < 0) {
            // Broken: a faint ghost showing where it will come back.
            ctx.globalAlpha = 0.16;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
            ctx.globalAlpha = 1;
            break;
          }
          const wobble = state > 0 ? Math.sin(time * 60 + tx) * Math.min(2.4, state * 0.16) : 0;
          ctx.save();
          ctx.translate(x + wobble, y);
          ctx.fillStyle = state > 0 ? '#a2713d' : '#8a6237';
          ctx.fillRect(0, 0, TILE, TILE);
          ctx.fillStyle = '#6b4a29';
          ctx.fillRect(0, 0, TILE, 3);
          ctx.fillRect(0, TILE - 3, TILE, 3);
          ctx.strokeStyle = 'rgba(40,24,12,0.85)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(4, 4);
          ctx.lineTo(TILE - 7, TILE - 5);
          ctx.moveTo(TILE - 5, 6);
          ctx.lineTo(9, TILE - 4);
          ctx.stroke();
          if (state > 0) {
            ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 40);
            ctx.fillStyle = '#ff6b4d';
            ctx.fillRect(0, 0, TILE, TILE);
            ctx.globalAlpha = 1;
          }
          ctx.restore();
          break;
        }
        case T_CHECKPOINT: {
          const reached = y / TILE <= Math.floor(world.spawnY / TILE) + 0.5;
          const pulse = 0.5 + 0.5 * Math.sin(time * 4 + tx);
          ctx.save();
          ctx.translate(x + TILE / 2, y + TILE);
          ctx.fillStyle = reached ? '#ffd166' : '#59657f';
          ctx.fillRect(-2, -TILE - 6, 4, TILE + 6);
          ctx.fillStyle = reached ? `rgba(255,209,102,${0.65 + pulse * 0.35})` : 'rgba(120,132,160,0.5)';
          ctx.beginPath();
          ctx.moveTo(2, -TILE - 4);
          ctx.lineTo(16 + (reached ? Math.sin(time * 6) * 3 : 0), -TILE + 2);
          ctx.lineTo(2, -TILE + 8);
          ctx.closePath();
          ctx.fill();
          if (reached) {
            ctx.globalAlpha = 0.14 + pulse * 0.1;
            ctx.fillStyle = '#ffd166';
            ctx.beginPath();
            ctx.arc(0, -TILE / 2, 34, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.restore();
          break;
        }
        case T_GOAL: {
          const pulse = 0.5 + 0.5 * Math.sin(time * 3 + tx * 0.4);
          ctx.fillStyle = `rgba(110,231,135,${0.25 + pulse * 0.3})`;
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = '#6ee787';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
          ctx.globalAlpha = 0.1 + pulse * 0.1;
          ctx.fillStyle = '#6ee787';
          ctx.fillRect(x - 12, y - 40, TILE + 24, TILE + 60);
          ctx.globalAlpha = 1;
          break;
        }
        case T_LAVA: {
          const openAbove = ty === 0 || level.tiles[(ty - 1) * level.w + tx] !== T_LAVA;
          if (!openAbove) break;
          ctx.fillStyle = '#ffd98a';
          const bob = Math.sin(time * 3 + tx * 0.7) * 1.6;
          ctx.fillRect(x, y + bob, TILE, 3);
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = '#ff8a3c';
          ctx.fillRect(x - 6, y - 30, TILE + 12, 34);
          ctx.globalAlpha = 1;
          break;
        }
        case T_CONV_R:
        case T_CONV_L: {
          const dir = t === T_CONV_R ? 1 : -1;
          const offset = ((time * 90 * dir) % TILE + TILE) % TILE;
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          for (let i = -1; i < 2; i++) {
            const ax = x + offset + i * TILE;
            if (ax < x - TILE || ax > x + TILE) continue;
            ctx.beginPath();
            ctx.moveTo(ax + (dir > 0 ? 0 : 8), y + 1);
            ctx.lineTo(ax + (dir > 0 ? 8 : 0), y + 3.5);
            ctx.lineTo(ax + (dir > 0 ? 0 : 8), y + 6);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }
        case T_WIND: {
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = '#cfe8f7';
          for (let i = 0; i < 3; i++) {
            const phase = ((time * 300 + i * 90 + tx * 37) % 240) / 240;
            const wy = y + TILE - phase * TILE * 2;
            ctx.fillRect(x + 5 + i * 6, wy, 2, 14);
          }
          ctx.globalAlpha = 1;
          break;
        }
        default:
          break;
      }
    }
  }
}
