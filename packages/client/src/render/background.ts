import type { BiomePalette } from './palette.js';

/**
 * Parallax backdrop.
 *
 * Each layer is baked once into a tiling canvas and then blitted with a
 * pattern transform, so an arbitrarily tall tower costs the same as a single
 * screen. Shapes are generated from a seeded hash, giving every biome a
 * recognisable silhouette without any art assets.
 */

const TILE_W = 512;
const TILE_H = 512;

interface LayerSet {
  key: string;
  far: CanvasPattern | null;
  mid: CanvasPattern | null;
  near: CanvasPattern | null;
}

function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s |= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s |= 0;
    return (s >>> 0) / 4294967296;
  };
}

function bakeLayer(biome: number, layer: number, colour: string, ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;
  const c = canvas.getContext('2d');
  if (!c) return null;
  const r = rng(biome * 7919 + layer * 104729 + 13);
  c.fillStyle = colour;

  if (biome === 0) {
    // Scaffolding: uprights with cross-braces.
    for (let i = 0; i < 7; i++) {
      const x = r() * TILE_W;
      const w = 8 + r() * 16;
      c.fillRect(x, 0, w, TILE_H);
      for (let j = 0; j < 6; j++) {
        const y = (j / 6) * TILE_H + r() * 30;
        c.fillRect(x - 34, y, 90, 5 + r() * 4);
      }
    }
  } else if (biome === 1) {
    // Pipework and furnace stacks.
    for (let i = 0; i < 6; i++) {
      const x = r() * TILE_W;
      const w = 26 + r() * 54;
      const y = r() * TILE_H;
      const h = 90 + r() * 260;
      c.fillRect(x, y, w, h);
      c.beginPath();
      c.arc(x + w / 2, y, w / 2, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 5; i++) {
      const y = r() * TILE_H;
      c.fillRect(0, y, TILE_W, 9 + r() * 8);
    }
  } else if (biome === 2) {
    // Ice shards and hanging spires.
    for (let i = 0; i < 16; i++) {
      const x = r() * TILE_W;
      const y = r() * TILE_H;
      const w = 20 + r() * 46;
      const h = 70 + r() * 200;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + w, y + 18);
      c.lineTo(x + w * 0.55, y + h);
      c.closePath();
      c.fill();
    }
  } else {
    // Cathedral buttresses and windows.
    for (let i = 0; i < 6; i++) {
      const x = r() * TILE_W;
      const w = 30 + r() * 46;
      c.fillRect(x, 0, w, TILE_H);
      for (let j = 0; j < 5; j++) {
        const y = j * (TILE_H / 5) + 26;
        c.clearRect(x + w * 0.25, y, w * 0.5, 44);
      }
    }
  }

  return ctx.createPattern(canvas, 'repeat');
}

export class Background {
  private layers: LayerSet | null = null;
  private ambientSeed = rng(20260819);

  private ensure(ctx: CanvasRenderingContext2D, biome: number, p: BiomePalette): LayerSet {
    const key = `${biome}|${p.far}`;
    if (this.layers && this.layers.key === key) return this.layers;
    this.layers = {
      key,
      far: bakeLayer(biome, 0, p.far, ctx),
      mid: bakeLayer(biome, 1, p.mid, ctx),
      near: bakeLayer(biome, 2, p.near, ctx),
    };
    return this.layers;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    camX: number,
    camY: number,
    scale: number,
    biome: number,
    p: BiomePalette,
    time: number,
  ): void {
    // Flat, not a gradient. A vertical ramp reads as atmosphere and softness;
    // this world is painted signage under a blown-out sky, and the flat fill is
    // what makes the tower read as a thing standing in front of it rather than
    // a thing lit by it.
    ctx.fillStyle = p.paper;
    ctx.fillRect(0, 0, w, h);

    const set = this.ensure(ctx, biome, p);
    const depths = [
      { pattern: set.far, factor: 0.08, alpha: 0.55, zoom: 0.55 },
      { pattern: set.mid, factor: 0.2, alpha: 0.6, zoom: 0.75 },
      { pattern: set.near, factor: 0.42, alpha: 0.55, zoom: 1 },
    ];

    for (const d of depths) {
      if (!d.pattern) continue;
      ctx.save();
      ctx.globalAlpha = d.alpha;
      const z = scale * d.zoom;
      ctx.translate(w / 2, h / 2);
      ctx.scale(z, z);
      ctx.translate((-camX * d.factor) / d.zoom, (-camY * d.factor) / d.zoom);
      ctx.fillStyle = d.pattern;
      const spanW = w / z + TILE_W * 2;
      const spanH = h / z + TILE_H * 2;
      const ox = Math.floor(((camX * d.factor) / d.zoom - spanW / 2) / TILE_W) * TILE_W;
      const oy = Math.floor(((camY * d.factor) / d.zoom - spanH / 2) / TILE_H) * TILE_H;
      ctx.fillRect(ox, oy, spanW + TILE_W, spanH + TILE_H);
      ctx.restore();
    }

    // Distance washes toward paper rather than toward black, so the far side
    // of the shaft fades out into the sky instead of into a void.
    ctx.fillStyle = p.hazeVeil;
    ctx.fillRect(0, 0, w, h);
    void time;
  }

  /** Ambient motes appropriate to the biome, emitted into the particle pool. */
  ambientColour(biome: number): string {
    return ['#9aa6cc', '#ff9a4d', '#dff3ff', '#d3bdf5'][biome] ?? '#ffffff';
  }

  random(): number {
    return this.ambientSeed();
  }
}
