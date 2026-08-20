/**
 * Painted industrial signage, drawn rather than typeset.
 *
 * Two devices carry the art direction, and both are cheap because they are
 * baked into the tile blocks once rather than drawn per frame:
 *
 * **Hazard chevrons.** Every ledge you can stand on wears a yellow-and-black
 * chevron band, boxed top and bottom by a hard ink rule. The band is a repeating
 * canvas pattern, and its phase is offset by the block's world position so one
 * painter appears to have walked the entire climb. The boxing rules are not
 * decoration: in the Freezer the light half of the chevron is nearly paper, and
 * without an ink rule under it a ledge cap would dissolve into the sky.
 *
 * **Stencilled marks.** Floor numbers three tiles tall painted flat onto the
 * tower's face, plus small load markings on the flats. Real stencils have
 * bridges — the little gaps that stop the middle of an O falling out — so the
 * glyphs are built on their own canvas with the bridges punched through as
 * genuine holes, which is also what stops them reading as ordinary text.
 *
 * Everything here is deterministic: placement comes from `tileHash`, never from
 * a clock or a random, so a wall never rearranges itself between frames.
 */
import { TILE } from '@haulmates/core';
import type { BiomePalette } from './palette.js';

/** Side of the repeating chevron tile, in pixels. */
const CHEVRON_SIZE = 16;

const chevronCache = new Map<string, CanvasPattern>();

/**
 * A diagonal hazard-stripe pattern. Cached per colour pair, because building
 * one allocates a canvas and every solid ledge in the tower wants the same one.
 */
export function chevronPattern(ctx: CanvasRenderingContext2D, p: BiomePalette): CanvasPattern | null {
  const key = `${p.hazA}|${p.hazB}`;
  const hit = chevronCache.get(key);
  if (hit) return hit;

  const tile = document.createElement('canvas');
  tile.width = CHEVRON_SIZE;
  tile.height = CHEVRON_SIZE;
  const c = tile.getContext('2d');
  if (!c) return null;

  c.fillStyle = p.hazA;
  c.fillRect(0, 0, CHEVRON_SIZE, CHEVRON_SIZE);
  c.fillStyle = p.hazB;
  // Two bars rather than one, so the stripe survives wrapping at the tile edge.
  c.beginPath();
  c.moveTo(0, CHEVRON_SIZE);
  c.lineTo(CHEVRON_SIZE / 2, CHEVRON_SIZE);
  c.lineTo(CHEVRON_SIZE, CHEVRON_SIZE / 2);
  c.lineTo(CHEVRON_SIZE, 0);
  c.closePath();
  c.fill();
  c.beginPath();
  c.moveTo(0, CHEVRON_SIZE / 2);
  c.lineTo(CHEVRON_SIZE / 2, 0);
  c.lineTo(0, 0);
  c.closePath();
  c.fill();

  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return null;
  chevronCache.set(key, pattern);
  return pattern;
}

/**
 * Fill a rect with hazard chevrons, phase-locked to world position.
 *
 * `worldY` is the row offset of the block being baked. Without it every block
 * would start its stripes at zero and the chevrons would visibly restart every
 * twenty-four rows, which is precisely the seam the direction cannot have.
 */
export function fillChevron(
  ctx: CanvasRenderingContext2D,
  pattern: CanvasPattern,
  worldY: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const phase = ((worldY % CHEVRON_SIZE) + CHEVRON_SIZE) % CHEVRON_SIZE;
  pattern.setTransform(new DOMMatrix().translate(0, -phase));
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
}

/** Rough advance width of a stencil string, for placement. */
export function stencilWidth(text: string, size: number): number {
  return text.length * size * 0.62;
}

/**
 * Build one stencil mark on its own canvas, with bridges punched through.
 *
 * It has to be a separate canvas because the bridges are cut with
 * `destination-out`: they are holes in the paint, not paper-coloured bars
 * painted over it. Painting the bridges would put sky-coloured marks onto the
 * tower, which is both wrong and very obvious.
 */
export function stencilMark(text: string, size: number, colour: string): HTMLCanvasElement | null {
  const w = Math.ceil(stencilWidth(text, size)) + 8;
  const h = Math.ceil(size * 1.25);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const c = canvas.getContext('2d');
  if (!c) return null;

  c.fillStyle = colour;
  c.font = `900 ${size}px ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillText(text, 4, size * 0.06);

  // The bridges. Two horizontal breaks at the thirds is what the eye reads as
  // "cut from a plate" rather than "set in a font".
  c.globalCompositeOperation = 'destination-out';
  const bridge = Math.max(1.5, size * 0.055);
  c.fillRect(0, h * 0.34, w, bridge);
  c.fillRect(0, h * 0.63, w, bridge);
  c.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * Load markings for the flats. Every one of these states something true about
 * the game — a working load, a surface you should not stand on, which way is
 * up. Invented industrial flavour text turns the whole device into noise the
 * first time a player reads one and finds it means nothing.
 */
export const LOAD_MARKS = ['SWL 2.5t', 'NO STEP', 'TARE 340', 'THIS WAY UP', 'DO NOT DROP'];

/** Rows of tower per painted floor number. Matches the tile cache's block size. */
const FLOOR_ROWS = 24;

const numeralCache = new Map<string, HTMLCanvasElement>();

/**
 * Paint the floor numbers onto the back wall of the shaft, in world space.
 *
 * The original plan clipped these to the baked tile geometry with
 * `source-atop`, which is a lovely trick and completely wrong for these levels:
 * the towers are a thin shaft of platforms with almost no solid face to paint
 * on, so the numeral was cut away to nothing. Drawing them into the world
 * *behind* the tiles gets the intended image — a three-metre numeral half
 * swallowed by every girder that crosses it — because the ledges then occlude
 * it for real rather than by masking.
 */
export function drawFloorMarks(
  ctx: CanvasRenderingContext2D,
  p: BiomePalette,
  levelWidthPx: number,
  levelHeightPx: number,
  view: { y0: number; y1: number },
): void {
  if (p.paintAlpha <= 0) return;
  const band = FLOOR_ROWS * TILE;
  const total = Math.ceil(levelHeightPx / band);
  const first = Math.max(0, Math.floor(view.y0 / band));
  const last = Math.min(total - 1, Math.floor(view.y1 / band));

  ctx.save();
  ctx.globalAlpha = p.paintAlpha;
  for (let i = first; i <= last; i++) {
    const floor = total - i;
    const text = String(floor);
    let mark = numeralCache.get(`${text}|${p.stencil}`);
    if (!mark) {
      const built = stencilMark(text, TILE * 7, p.stencil);
      if (!built) continue;
      mark = built;
      numeralCache.set(`${text}|${p.stencil}`, mark);
    }
    const jitter = tileHashLike(i);
    const usable = Math.max(0, levelWidthPx - mark.width - TILE * 4);
    ctx.drawImage(mark, TILE * 2 + jitter * usable, i * band + TILE * 3);
  }
  ctx.restore();
}

/** Stable per-floor jitter, so a numeral never wanders between frames. */
function tileHashLike(i: number): number {
  let h = (i * 374761393) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
