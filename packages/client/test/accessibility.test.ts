import { describe, expect, it } from 'vitest';
import {
  CARGO_HP,
  CHUNK_W,
  TILE,
  assembleLevel,
  createWorld,
  type Level,
  type World,
} from '@haulmates/core';
import { drawCargo, drawMovers, drawSaws } from '../src/render/actors.js';
import { drawDynamicTiles } from '../src/render/tiles.js';
import { CARGO_COLOURS, applyHighContrast, biomeFor } from '../src/render/palette.js';

/**
 * A canvas that keeps the paint instead of the picture.
 *
 * Two things about the drawing code are safety properties rather than taste —
 * that nothing repeating blinks inside the photosensitive band once Reduce
 * flashing is on, and that nothing lethal is painted a colour High Contrast
 * cannot reach — and both are statements about the fill style and the alpha at
 * the moment of each call. Recording those is the whole test rig; the pixels
 * are nobody's business.
 */
interface Paint {
  style: string;
  alpha: number;
}

class Recorder {
  fills: Paint[] = [];
  strokes: Paint[] = [];
  globalAlpha = 1;
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  private stack: Paint[] = [];

  save(): void {
    this.stack.push({ style: this.fillStyle, alpha: this.globalAlpha });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.fillStyle = s.style;
    this.globalAlpha = s.alpha;
  }

  fill(): void {
    this.fills.push({ style: this.fillStyle, alpha: this.globalAlpha });
  }

  fillRect(): void {
    this.fill();
  }

  stroke(): void {
    this.strokes.push({ style: this.strokeStyle, alpha: this.globalAlpha });
  }

  strokeRect(): void {
    this.stroke();
  }

  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: (): void => {} };
  }

  translate(): void {}
  rotate(): void {}
  scale(): void {}
  clip(): void {}
  setLineDash(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  ellipse(): void {}
  quadraticCurveTo(): void {}
}

function recorder(): { rec: Recorder; ctx: CanvasRenderingContext2D } {
  const rec = new Recorder();
  return { rec, ctx: rec as unknown as CanvasRenderingContext2D };
}

/** The smallest level that holds a crumbling tile, a spawn and a goal. */
function crumbleLevel(): Level {
  const blank = '.'.repeat(CHUNK_W);
  const rows = [
    `${blank.slice(0, 4)}F${blank.slice(5)}`,
    `${blank.slice(0, 2)}x${blank.slice(3)}`,
    `${blank.slice(0, 2)}S${blank.slice(3)}`,
    '#'.repeat(CHUNK_W),
  ];
  return assembleLevel('acc', 'ACC', [{ id: 'acc', biome: 0, difficulty: 0, rows }]);
}

function crumblingWorld(): { level: Level; world: World } {
  const level = crumbleLevel();
  const world = createWorld({ level, seed: 1, mode: 0 });
  const index = level.tiles.indexOf(10);
  // A tile counting down: this is the state the warning wash is drawn in.
  world.crumble[level.crumbleSlot[index]] = 1;
  return { level, world };
}

/** Alpha of the hazard wash over a crumbling tile, sampled across a second. */
function crumbleAlphas(reducedFlash: boolean): number[] {
  const { level, world } = crumblingWorld();
  const hazard = biomeFor(0).hazard;
  const out: number[] = [];
  for (const time of [0, 0.05, 0.1, 0.15, 0.2, 0.25]) {
    const { rec, ctx } = recorder();
    drawDynamicTiles(ctx, level, world, time, 0, 0, level.widthPx, level.heightPx, {
      highContrast: false,
      reducedFlash,
    });
    const wash = rec.fills.filter((f) => f.style === hazard);
    expect(wash.length, 'the crumbling tile should paint its warning').toBe(1);
    out.push(wash[0].alpha);
  }
  return out;
}

/** Alpha of the damage wash over a nearly-broken crate, sampled across a second. */
function cargoAlphas(reducedFlash: boolean): number[] {
  const { level } = crumblingWorld();
  const world = createWorld({ level, seed: 1, mode: 0 });
  world.cargo.hp = CARGO_HP * 0.1;
  const out: number[] = [];
  for (const time of [0, 0.05, 0.1, 0.15, 0.2, 0.25]) {
    const { rec, ctx } = recorder();
    drawCargo(ctx, world, world, 1, time, reducedFlash);
    const wash = rec.fills.filter((f) => f.style === CARGO_COLOURS.stencil && f.alpha < 0.99);
    expect(wash.length, 'a crate this hurt should paint its warning').toBe(1);
    out.push(wash[0].alpha);
  }
  return out;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe('reduce flashing', () => {
  /**
   * Both of these sit in the 3-30 Hz band that provokes photosensitive
   * seizures — 6.4 Hz for a crumbling ledge, up to 5.4 Hz for a crate near
   * death — and neither of them is a one-off: a crumbling ledge is a run of
   * eight tiles blinking in unison, and a crate that has dropped below a third
   * of its health almost never climbs back, so its pulse runs for the rest of
   * the haul. The setting reached exactly one place, the full-screen impact
   * tint, which is the shortest-lived flash of the three.
   */
  it('holds the crumbling-ledge warning steady instead of strobing it', () => {
    expect(spread(crumbleAlphas(false)), 'the warning pulses when it may').toBeGreaterThan(0.3);
    expect(spread(crumbleAlphas(true)), 'and never when it may not').toBe(0);
  });

  it('holds the failing-crate warning steady instead of strobing it', () => {
    expect(spread(cargoAlphas(false)), 'the warning pulses when it may').toBeGreaterThan(0.2);
    expect(spread(cargoAlphas(true)), 'and never when it may not').toBe(0);
  });

  it('leaves both warnings visible enough to read', () => {
    for (const alpha of [...crumbleAlphas(true), ...cargoAlphas(true)]) {
      expect(alpha).toBeGreaterThan(0.25);
      expect(alpha).toBeLessThan(0.8);
    }
  });
});

/** Everything lethal the level file can hold, put in one place to be drawn. */
function hazardLevel(): Level {
  const blank = '.'.repeat(CHUNK_W);
  // The goal sits on the top row and is drawn out of shot below: it is the one
  // thing in the dynamic pass that is neither lethal nor palette-driven, and
  // it is green for a reason.
  const rows = [
    `${blank.slice(0, 4)}F${blank.slice(5)}`,
    `${blank.slice(0, 2)}~~~${blank.slice(5)}`,
    `${blank.slice(0, 2)}S${blank.slice(3)}`,
    '#'.repeat(CHUNK_W),
  ];
  const level = assembleLevel('haz', 'HAZ', [{ id: 'haz', biome: 0, difficulty: 0, rows }]);
  level.movers.push({ x: 60, y: 40, w: 96, h: 24, ax: 0, ay: 64, period: 120, phase: 0, solid: 1, deadly: 1, smooth: 1 });
  level.saws.push({ x: 200, y: 80, r: 22, ax: 96, ay: 0, period: 180, phase: 0, spin: 1 });
  return level;
}

/** Every colour a lethal thing is painted in, at one palette. */
function hazardPaint(highContrast: boolean): Set<string> {
  const level = hazardLevel();
  const world = createWorld({ level, seed: 1, mode: 0 });
  const palette = highContrast ? applyHighContrast(biomeFor(0)) : biomeFor(0);
  const { rec, ctx } = recorder();
  drawDynamicTiles(ctx, level, world, 0.1, 0, TILE, level.widthPx, level.heightPx, {
    highContrast,
    reducedFlash: false,
  });
  drawMovers(ctx, level, 30, 0, palette);
  drawSaws(ctx, level, 30, 0, 0.1, palette);
  const out = new Set<string>();
  for (const paint of [...rec.fills, ...rec.strokes]) out.add(paint.style);
  return out;
}

describe('high contrast', () => {
  /**
   * The setting is advertised as maximum readability and it used to change the
   * sky, the parallax and nothing else that mattered: the spikes, the lava,
   * the saws and the crushers were drawn in fixed colours, and the baked tile
   * blocks were handed the raw biome palette rather than the flattened one, so
   * a low-vision player got a recoloured backdrop behind an unchanged tower.
   *
   * Asserted as an absence of shared colours rather than as a list of expected
   * hexes, because the failure mode is a literal left behind in the drawing
   * code, and a literal is exactly what survives a change of palette.
   */
  it('changes every colour a lethal thing is painted in', () => {
    const plain = hazardPaint(false);
    const flat = hazardPaint(true);
    expect(plain.size, 'the hazards should paint something').toBeGreaterThan(3);
    expect([...plain].filter((c) => flat.has(c)), 'colours that ignore the palette').toEqual([]);
  });

  it('keeps the hazard hue off the surfaces you are invited to stand on', () => {
    for (const biome of [0, 1, 2, 3]) {
      for (const p of [biomeFor(biome), applyHighContrast(biomeFor(biome))]) {
        expect(p.hazard, `${p.name}: hazard reads as tape`).not.toBe(p.hazA);
        expect(p.hazard, `${p.name}: hazard reads as concrete`).not.toBe(p.tileBody);
        expect(p.hazard, `${p.name}: hazard reads as an outline`).not.toBe(p.ink);
      }
    }
  });
});
