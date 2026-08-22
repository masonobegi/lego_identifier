import {
  EV_BOUNCE,
  EV_CARGO_BREAK,
  EV_CARGO_HIT,
  EV_CHECKPOINT,
  EV_CRUMBLE,
  EV_DEATH,
  EV_FINISH,
  EV_GRIP,
  EV_JUMP,
  EV_LAND,
  EV_RESPAWN,
  EV_BOOST,
  EV_ROPE_YANK,
  EV_SHUTTER_SHUT,
  EV_STEP,
  TILE,
  pointSolid,
  type Level,
  type SimEvent,
  type World,
} from '@haulmates/core';
import { Camera } from './camera.js';
import { Background } from './background.js';
import { TileCache, drawDynamicTiles } from './tiles.js';

/** Chalk marks written per frame. A cap, so a thrashing rope cannot stall a frame. */
const SCUFFS_PER_FRAME = 6;
/** Pixels a rope node must travel in a frame to count as sliding rather than resting. */
const SCUFF_MIN_SLIDE = 1.2;
/** Depth of the chevron cap band, in pixels. Kept clear of chalk. */
const CAP_BAND = 10;

/** Is this point on the painted top edge of a ledge? */
function onLedgeCap(level: Level, world: World, x: number, y: number): boolean {
  const ty = Math.floor(y / TILE);
  for (let probe = 0; probe <= 1; probe++) {
    const row = ty + probe;
    if (y - row * TILE > CAP_BAND || y < row * TILE) continue;
    if (pointSolid(level, world, x, row * TILE + TILE * 0.5) && !pointSolid(level, world, x, row * TILE - 2)) {
      return true;
    }
  }
  return false;
}

/** Where to look for a wall, given the solver keeps nodes just clear of one. */
const SCUFF_PROBES: [number, number][] = [
  [-5, 0],
  [5, 0],
  [0, -5],
  [0, 5],
];
import { drawFloorMarks } from './stencil.js';
import { P_CHUNK, P_DUST, P_RING, P_SMOKE, P_SPARK, Particles } from './particles.js';
import { stencilMark } from './stencil.js';
import { applyHighContrast, biomeFor, PLAYER_COLOURS } from './palette.js';
import { analyseLevel } from '@haulmates/core';
import { drawCargo, drawMovers, drawPlayer, drawRope, drawSaws } from './actors.js';
import { drawHud, drawPlayerTags, type HudState } from './hud.js';

export interface RenderOptions {
  highContrast: boolean;
  shake: number;
  reducedFlash: boolean;
  showGhostTrail: boolean;
}

export interface RenderInput {
  world: World;
  prev: World;
  alpha: number;
  level: Level;
  hud: HudState;
  hats: [number, number];
  colours: [number, number];
  options: RenderOptions;
}

interface Trail {
  x: number;
  y: number;
  age: number;
}

export class Renderer {
  readonly camera = new Camera();
  readonly particles = new Particles();
  /** Cached per level, because the fill is ~30ms and the level does not move. */
  /** Public so `npm run shots` can stage a picture at one. */
  gates: { x: number; y: number }[] = [];
  private gatesFor: Level | null = null;
  private readonly gateMark = new Map<string, HTMLCanvasElement>();
  private background = new Background();
  private tiles = new TileCache();
  private ctx: CanvasRenderingContext2D;
  private flash = 0;
  private flashColour = '#ffffff';
  private time = 0;
  private trails: Trail[][] = [[], []];
  private ambientTimer = 0;
  width = 0;
  height = 0;
  dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('HAULMATES needs a 2D canvas to run.');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    // Cap the device pixel ratio: a 4K display at dpr 3 costs a lot of fill for
    // a game whose art is deliberately chunky.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(240, this.canvas.clientHeight || window.innerHeight);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.width = pw;
    this.height = ph;
    this.dpr = dpr;
  }

  reset(world: World): void {
    this.camera.calm = false;
    this.particles.clear();
    this.trails = [[], []];
    this.flash = 0;
    this.camera.snapTo(world);
    this.tiles.invalidate();
  }

  /** Turn one tick's simulation events into particles, shake and flashes. */
  consume(events: SimEvent[], options: RenderOptions): void {
    for (const e of events) {
      switch (e.kind) {
        case EV_JUMP:
          this.particles.burst(4, { x: e.x, y: e.y + 14, colour: '#b9c3e0', size: 2, life: 0.3, gravity: 260 }, 1, 60);
          break;
        case EV_BOOST:
          // The only move in the game two people can make and one cannot, and
          // the only one a player has to be *told* about — so it gets the
          // biggest tell: a ring, a shower off the brace's shoulders, and a
          // kick. If a pair does this by accident once, they should know
          // immediately that it was a thing and want to do it again.
          this.particles.emit({ x: e.x, y: e.y + 10, colour: '#ffd23d', size: 10, life: 0.4, gravity: 0, kind: P_RING });
          this.particles.burst(14, { x: e.x, y: e.y + 14, colour: '#ffd23d', size: 2.4, life: 0.45, gravity: 320, vy: -60, kind: P_SPARK }, 2.4, 190);
          this.camera.kick(6);
          break;
        case EV_LAND: {
          const force = Math.min(1, Math.abs(e.b) / 900);
          this.particles.burst(
            4 + Math.round(force * 10),
            { x: e.x, y: e.y, colour: '#c4cde8', size: 2.4, life: 0.45, gravity: 420, vy: -40 },
            2.2,
            70 + force * 140,
          );
          this.camera.kick(force * 7);
          break;
        }
        case EV_STEP:
          this.particles.emit({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 30, vy: -20, colour: '#9aa6cc', size: 1.5, life: 0.25, gravity: 150 });
          break;
        case EV_GRIP:
          this.particles.burst(5, { x: e.x, y: e.y, colour: e.b === 1 ? '#ffd166' : '#dfe6ff', size: 1.6, life: 0.35, gravity: 200, kind: P_SPARK }, 1.5, 90);
          break;
        case EV_ROPE_YANK: {
          const force = Math.min(1, Math.abs(e.a) / 900);
          this.particles.burst(6 + Math.round(force * 10), { x: e.x, y: e.y, colour: '#ffd9a0', size: 2, life: 0.3, gravity: 60, kind: P_SPARK }, 2.5, 200 + force * 300);
          this.particles.emit({ x: e.x, y: e.y, colour: '#ffb03a', size: 8, life: 0.35, gravity: 0, kind: P_RING });
          this.camera.kick(4 + force * 10);
          break;
        }
        case EV_BOUNCE:
          this.particles.emit({ x: e.x, y: e.y, colour: '#59e08a', size: 9, life: 0.4, gravity: 0, kind: P_RING });
          this.particles.burst(10, { x: e.x, y: e.y, colour: '#9ff5bd', size: 2, life: 0.4, gravity: 300 }, 2, 160);
          this.camera.kick(5);
          break;
        case EV_CARGO_HIT: {
          const force = Math.min(1, e.a / 30);
          this.particles.burst(3 + Math.round(force * 8), { x: e.x, y: e.y, colour: '#c08a3e', size: 2.2, life: 0.5, gravity: 700, kind: P_CHUNK }, 2, 120 + force * 180);
          this.camera.kick(2 + force * 6);
          break;
        }
        case EV_CARGO_BREAK:
          this.particles.burst(46, { x: e.x, y: e.y, colour: '#c08a3e', size: 3.4, life: 1.2, gravity: 1100, kind: P_CHUNK }, 2.4, 420);
          this.particles.burst(16, { x: e.x, y: e.y, colour: '#ffd9a0', size: 3, life: 0.6, gravity: 200, kind: P_SPARK }, 2.4, 500);
          this.particles.emit({ x: e.x, y: e.y, colour: '#ffb03a', size: 26, life: 0.6, gravity: 0, kind: P_RING });
          this.camera.kick(24);
          this.setFlash('#ffb26b', 0.55, options);
          break;
        case EV_CRUMBLE:
          this.particles.burst(12, { x: e.x, y: e.y, colour: '#8a6237', size: 2.6, life: 0.8, gravity: 1000, kind: P_CHUNK }, 1.6, 130);
          break;
        case EV_SHUTTER_SHUT:
          // Dust knocked off the frame, and no camera kick: a door coming down
          // three rooms away is news, not an impact, and shaking the screen for
          // one would put the same weight on it as a crate exploding.
          this.particles.burst(8, { x: e.x, y: e.y, colour: '#c9bfa6', size: 2, life: 0.45, gravity: 300 }, 2.6, 90);
          break;
        case EV_DEATH:
          this.particles.burst(26, { x: e.x, y: e.y, colour: '#ff4d6d', size: 2.8, life: 0.9, gravity: 900, kind: P_CHUNK }, 2.2, 330);
          this.particles.emit({ x: e.x, y: e.y, colour: '#ff4d6d', size: 20, life: 0.5, gravity: 0, kind: P_RING });
          this.camera.kick(16);
          this.setFlash('#ff4d6d', 0.4, options);
          break;
        case EV_RESPAWN:
          this.particles.emit({ x: e.x, y: e.y, colour: '#6ee787', size: 18, life: 0.5, gravity: 0, kind: P_RING });
          this.particles.burst(14, { x: e.x, y: e.y, colour: '#a5f0f6', size: 2, life: 0.5, gravity: -120 }, 1.8, 140);
          break;
        case EV_CHECKPOINT:
          for (let i = 0; i < 3; i++) {
            this.particles.emit({ x: e.x, y: e.y, colour: '#ffd166', size: 14 + i * 8, life: 0.7 + i * 0.14, gravity: 0, kind: P_RING });
          }
          this.particles.burst(26, { x: e.x, y: e.y, colour: '#ffd166', size: 2.4, life: 1, gravity: -60, kind: P_SPARK }, 2, 200);
          this.setFlash('#ffd166', 0.22, options);
          break;
        case EV_FINISH:
          for (let i = 0; i < 90; i++) {
            this.particles.emit({
              x: e.x + (Math.random() - 0.5) * 500,
              y: e.y - 200 - Math.random() * 300,
              vx: (Math.random() - 0.5) * 160,
              vy: Math.random() * 90,
              colour: ['#ff7a4d', '#4fd6e0', '#ffd23d', '#6ee787', '#ff6fae'][i % 5],
              size: 3.4,
              life: 3.4,
              gravity: 220,
              drag: 0.985,
              kind: P_CHUNK,
            });
          }
          this.camera.kick(10);
          break;
        default:
          break;
      }
    }
  }

  private setFlash(colour: string, strength: number, options: RenderOptions): void {
    if (options.reducedFlash) return;
    this.flashColour = colour;
    this.flash = Math.max(this.flash, strength);
  }

  render(dt: number, input: RenderInput): void {
    this.resize();
    this.time += dt;
    const { ctx } = this;
    const { world, prev, alpha, level, options } = input;

    this.camera.shakeScale = options.shake;
    this.camera.update(dt, world, level, this.width / this.height);
    this.particles.update(dt);
    this.updateTrails(dt, world, options);
    this.emitAmbient(dt, level, world);

    const biomeIndex = level.biome[clampRow(level, world.players[0].y)];
    const palette = options.highContrast ? applyHighContrast(biomeFor(biomeIndex)) : biomeFor(biomeIndex);

    const scale = this.camera.scaleFor(this.height);
    this.background.draw(ctx, this.width, this.height, this.camera.x, this.camera.y, scale, biomeIndex, palette, this.time);

    ctx.save();
    this.camera.apply(ctx, this.width, this.height);
    const view = this.camera.bounds(this.width, this.height, 96);

    this.recordScuffs(level, world, prev, options);
    drawFloorMarks(ctx, palette, level.widthPx, level.heightPx, view);
    this.drawGateMarks(ctx, level, palette, view);
    this.drawTiles(ctx, level, world, view, options);
    this.drawOutOfBounds(ctx, level, view, palette);
    drawDynamicTiles(ctx, level, world, this.time, view.x0, view.y0, view.x1, view.y1, options);
    drawMovers(ctx, level, world.tick, alpha, palette);
    drawSaws(ctx, level, world.tick, alpha, this.time, palette);

    if (options.showGhostTrail) this.drawTrails(ctx, input);

    drawRope(ctx, level, world, prev, alpha, this.time);
    drawCargo(ctx, level, world, prev, alpha, this.time, options.reducedFlash);
    for (let i = 0; i < 2; i++) {
      const colour = PLAYER_COLOURS[input.colours[i] % PLAYER_COLOURS.length];
      drawPlayer(ctx, world, prev, i, alpha, colour, input.hats[i], this.time);
    }
    this.particles.draw(ctx, view.x0, view.y0, view.x1, view.y1);
    drawPlayerTags(ctx, input.hud, scale);
    ctx.restore();

    this.postProcess(ctx, dt, options);
    drawHud(ctx, this.width, this.height, input.hud);
  }

  /**
   * Grind chalk into the paint wherever the rope is dragging along a wall.
   *
   * Two conditions, both necessary. *Touching*, or the rope would paint the
   * open air it swings through. *Sliding*, or a rope resting against a corner
   * while the players stand still would burn a hole in one spot. What survives
   * is a record of the route the pair actually took, which is the point: at the
   * top of a long climb the wall below you is the story of getting there.
   */
  /**
   * Paint the two-person steps so a pair can see one coming.
   *
   * A gate is a foothold that simply is not there, and from below that looks
   * exactly like a level that has run out. Without a mark, the first thing a
   * pair does at one is spend five minutes proving to themselves that the jump
   * is impossible, which it is, and then quit — the move that clears it is the
   * one move in the game they have not been shown and cannot stumble into,
   * because it needs both of them standing still in the right place at once.
   *
   * The mark is a stencil in the yard's own language rather than a tutorial
   * pop-up, and it is painted on the wall behind the gap where the missing
   * foothold would have been, which is exactly where you are looking when you
   * are wondering what went wrong.
   */
  private drawGateMarks(
    ctx: CanvasRenderingContext2D,
    level: Level,
    p: { stencil: string },
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    if (this.gatesFor !== level) {
      this.gatesFor = level;
      this.gates = analyseLevel(level, { coop: true }).gates;
    }
    for (const g of this.gates) {
      const y = (g.y + 2) * TILE;
      if (y < view.y0 - TILE * 4 || y > view.y1 + TILE * 4) continue;
      const x = g.x * TILE + TILE / 2;
      const key = `gate|${p.stencil}`;
      let mark = this.gateMark.get(key);
      if (!mark) {
        const built = stencilMark('2 PERSON LIFT', TILE * 1.15, p.stencil);
        if (!built) continue;
        mark = built;
        this.gateMark.set(key, mark);
      }
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(mark, x - mark.width / 2, y);
      // A bracket under it, pointing at the gap the mark is about.
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = p.stencil;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - TILE * 1.4, y + mark.height + 8);
      ctx.lineTo(x, y + mark.height + 2);
      ctx.lineTo(x + TILE * 1.4, y + mark.height + 8);
      ctx.stroke();
      ctx.restore();
    }
  }

  private recordScuffs(level: Level, world: World, prev: World, options: RenderOptions): void {
    if (options.highContrast) return;
    let written = 0;
    for (let i = 0; i < world.ropeX.length && written < SCUFFS_PER_FRAME; i++) {
      const x = world.ropeX[i];
      const y = world.ropeY[i];
      const moved = Math.abs(x - prev.ropeX[i]) + Math.abs(y - prev.ropeY[i]);
      if (moved < SCUFF_MIN_SLIDE) continue;
      // Probe around the node rather than at it: a rope node is kept just
      // outside geometry by the solver, so testing the point itself never hits.
      let hit = false;
      for (const [ox, oy] of SCUFF_PROBES) {
        if (pointSolid(level, world, x + ox, y + oy)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      // Never chalk the top of a ledge. The cap band is the single most
      // important thing on screen to read at speed, and wear laid over it
      // mutes the chevron into the concrete. Walls and undersides take the
      // marks instead, which is where a rope drags hardest anyway.
      if (onLedgeCap(level, world, x, y)) continue;
      this.tiles.addScuff(x, y, 3 + Math.min(3, moved * 0.25));
      written++;
    }
  }

  private drawTiles(
    ctx: CanvasRenderingContext2D,
    level: Level,
    world: World,
    view: { x0: number; y0: number; x1: number; y1: number },
    options: RenderOptions,
  ): void {
    const rows = TileCache.blockRows();
    const first = Math.max(0, Math.floor(view.y0 / TILE / rows));
    const last = Math.min(Math.ceil(level.h / rows) - 1, Math.floor(view.y1 / TILE / rows));
    for (let b = first; b <= last; b++) {
      const canvas = this.tiles.block(level, b, options.highContrast);
      if (canvas) ctx.drawImage(canvas, 0, b * rows * TILE);
    }
    void world;
  }

  /**
   * Fill everything outside the shaft with rock.
   *
   * The camera zooms out to keep both players framed, which regularly shows
   * space beyond the level bounds. Left empty it reads as a rendering bug;
   * filled, the tower reads as carved out of solid ground.
   */
  private drawOutOfBounds(
    ctx: CanvasRenderingContext2D,
    level: Level,
    view: { x0: number; y0: number; x1: number; y1: number },
    palette: { voidFill: string; ink: string; tileTop: string },
  ): void {
    // Deliberately not ink. A black mass at the edge of a bone-white world
    // reads as a hole punched in the page and drags the whole frame dark,
    // which is the one thing this direction cannot afford.
    ctx.fillStyle = palette.voidFill;
    if (view.x0 < 0) ctx.fillRect(view.x0, view.y0, -view.x0, view.y1 - view.y0);
    if (view.x1 > level.widthPx) ctx.fillRect(level.widthPx, view.y0, view.x1 - level.widthPx, view.y1 - view.y0);
    if (view.y1 > level.heightPx) {
      const top = Math.max(view.y0, level.heightPx);
      ctx.fillRect(view.x0, top, view.x1 - view.x0, view.y1 - top);
      // The tower's base plate. In ink, so it reads as the bottom of the
      // structure rather than as a stray rule drawn across the frame.
      //
      // There are deliberately no matching uprights, though the silhouette
      // would seem to want them. The level's boundary is two columns of solid
      // wall outside the face you can see, so a rule drawn there lands in the
      // middle of a flat tan field with nothing on either side of it to
      // separate — it reads as a line ruled round the picture, which is worse
      // than the soft edge it was meant to fix.
      ctx.fillStyle = palette.ink;
      ctx.fillRect(view.x0, level.heightPx, view.x1 - view.x0, 5);
    }
  }

  private updateTrails(dt: number, world: World, options: RenderOptions): void {
    if (!options.showGhostTrail) return;
    for (let i = 0; i < 2; i++) {
      const p = world.players[i];
      const speed = Math.hypot(p.vx, p.vy);
      const list = this.trails[i];
      // Only leave afterimages when genuinely moving fast — otherwise the
      // trail reads as smear rather than speed.
      if (speed > 640) list.push({ x: p.x, y: p.y, age: 0 });
      for (const t of list) t.age += dt;
      while (list.length > 0 && (list[0].age > 0.22 || list.length > 10)) list.shift();
    }
  }

  private drawTrails(ctx: CanvasRenderingContext2D, input: RenderInput): void {
    for (let i = 0; i < 2; i++) {
      const colour = PLAYER_COLOURS[input.colours[i] % PLAYER_COLOURS.length];
      for (const t of this.trails[i]) {
        const k = 1 - t.age / 0.22;
        if (k <= 0) continue;
        ctx.globalAlpha = k * 0.28;
        ctx.fillStyle = colour.main;
        ctx.beginPath();
        ctx.ellipse(t.x, t.y - 2, 8 * k + 2, 13 * k + 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private emitAmbient(dt: number, level: Level, world: World): void {
    this.ambientTimer += dt;
    if (this.ambientTimer < 0.05) return;
    this.ambientTimer = 0;
    const biome = level.biome[clampRow(level, world.players[0].y)];
    const cx = this.camera.x;
    const cy = this.camera.y;
    const spread = this.camera.viewH;
    const rx = cx + (this.background.random() - 0.5) * spread * 1.8;
    const ry = cy + (this.background.random() - 0.5) * spread;
    switch (biome) {
      case 1:
        this.particles.emit({ x: rx, y: cy + spread * 0.6, vy: -60 - Math.random() * 90, vx: (Math.random() - 0.5) * 24, colour: '#ff9a4d', size: 1.7, life: 2.4, gravity: -14, drag: 0.995 });
        break;
      case 2:
        this.particles.emit({ x: rx, y: cy - spread * 0.6, vy: 40 + Math.random() * 40, vx: (Math.random() - 0.5) * 50, colour: '#dff3ff', size: 1.9, life: 3.4, gravity: 8, drag: 0.996 });
        break;
      case 3:
        this.particles.emit({ x: rx, y: ry, vy: -18, vx: 0, colour: '#d3bdf5', size: 1.5, life: 2.2, gravity: -6, drag: 0.99, kind: P_SMOKE });
        break;
      default:
        this.particles.emit({ x: rx, y: ry, vy: -10, vx: (Math.random() - 0.5) * 18, colour: '#9aa6cc', size: 1.3, life: 2.6, gravity: -4, drag: 0.995, kind: P_DUST });
        break;
    }
  }

  private postProcess(ctx: CanvasRenderingContext2D, dt: number, options: RenderOptions): void {
    if (this.flash > 0.002) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.7, this.flash);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = this.flashColour;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
      this.flash *= Math.pow(0.0009, dt);
    } else {
      this.flash = 0;
    }

    // Sun burn rather than a vignette. Darkening the corners of a bone-white
    // world just makes it look grubby; blowing the edges out toward white
    // reads as glare and pushes the eye to the middle for the same reason.
    const grad = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.34,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.74,
    );
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, options.highContrast ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.30)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  /** Draws the idle backdrop behind the menus. */
  renderAttract(dt: number, level: Level, world: World, prev: World, options: RenderOptions): void {
    this.resize();
    this.time += dt;
    const biomeIndex = level.biome[clampRow(level, world.players[0].y)];
    const palette = options.highContrast ? applyHighContrast(biomeFor(biomeIndex)) : biomeFor(biomeIndex);
    // No shake and no hunting behind the menus: the only thing that should be
    // asking for your eye on this screen is the menu.
    this.camera.shakeScale = 0;
    this.camera.calm = true;
    this.camera.update(dt, world, level, this.width / this.height);
    this.particles.update(dt);
    this.emitAmbient(dt, level, world);
    const scale = this.camera.scaleFor(this.height);
    this.background.draw(this.ctx, this.width, this.height, this.camera.x, this.camera.y, scale, biomeIndex, palette, this.time);
    this.ctx.save();
    this.camera.apply(this.ctx, this.width, this.height);
    const view = this.camera.bounds(this.width, this.height, 96);
    this.drawTiles(this.ctx, level, world, view, options);
    this.drawOutOfBounds(this.ctx, level, view, palette);
    drawDynamicTiles(this.ctx, level, world, this.time, view.x0, view.y0, view.x1, view.y1, options);
    drawMovers(this.ctx, level, world.tick, 0, palette);
    drawSaws(this.ctx, level, world.tick, 0, this.time, palette);
    drawRope(this.ctx, level, world, prev, 0, this.time);
    drawCargo(this.ctx, level, world, prev, 0, this.time, options.reducedFlash);
    for (let i = 0; i < 2; i++) {
      drawPlayer(this.ctx, world, prev, i, 0, PLAYER_COLOURS[i], i === 0 ? 1 : 0, this.time);
    }
    this.particles.draw(this.ctx, view.x0, view.y0, view.x1, view.y1);
    this.ctx.restore();
    this.postProcess(this.ctx, dt, options);
  }
}

function clampRow(level: Level, y: number): number {
  return Math.max(0, Math.min(level.h - 1, Math.floor(y / TILE)));
}

export { PLAYER_COLOURS };
export type { HudState };
