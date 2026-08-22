import { describe, expect, it } from 'vitest';
import {
  MODE_HAUL,
  ROPE_NODES,
  buildCampaign,
  createWorld,
  pointSolid,
  type Level,
  type World,
} from '@haulmates/core';
import { drawCargo, drawRope } from '../src/render/actors.js';

/**
 * A canvas that keeps the line instead of the picture.
 *
 * The rope is the one drawing in this game whose correctness is a fact about
 * the world rather than about taste — it is either lying on the tower or
 * inside it — so the rig keeps the points of every stroked path, grouped by
 * the colour they were laid down in, and nothing else.
 */
interface Stroked {
  style: string;
  points: [number, number][];
}

class LineRecorder {
  strokes: Stroked[] = [];
  fillStyle = '';
  strokeStyle = '';
  globalAlpha = 1;
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  private path: [number, number][] = [];

  beginPath(): void {
    this.path = [];
  }

  moveTo(x: number, y: number): void {
    this.path.push([x, y]);
  }

  lineTo(x: number, y: number): void {
    this.path.push([x, y]);
  }

  /** The control point is the rope node; the end point is a midpoint between two. */
  quadraticCurveTo(cx: number, cy: number): void {
    this.path.push([cx, cy]);
  }

  stroke(): void {
    this.strokes.push({ style: this.strokeStyle, points: [...this.path] });
  }

  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  clip(): void {}
  setLineDash(): void {}
  closePath(): void {}
  rect(): void {}
  arc(): void {}
  ellipse(): void {}
  fill(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  fillText(): void {}
  measureText(): { width: number } {
    return { width: 0 };
  }
}

function recorder(): { rec: LineRecorder; ctx: CanvasRenderingContext2D } {
  const rec = new LineRecorder();
  return { rec, ctx: rec as unknown as CanvasRenderingContext2D };
}

/** The campaign, standing where a run starts and where every reset puts you. */
function atSpawn(): { level: Level; world: World } {
  const level = buildCampaign();
  return { level, world: createWorld({ level, seed: 1, mode: MODE_HAUL }) };
}

/** The rope's own cast shadow, drawn three pixels low on purpose. */
const ROPE_SHADOW = 'rgba(46,38,28,0.18)';

function buriedNodes(level: Level, world: World): number {
  let n = 0;
  for (let i = 1; i < ROPE_NODES - 1; i++) {
    if (pointSolid(level, world, world.ropeX[i], world.ropeY[i])) n++;
  }
  return n;
}

describe('the rope', () => {
  /**
   * `placeAtSpawn` rests the rope in a slack arc forty-one pixels deep, which
   * is further than a hauler's middle is from their own feet — so the middle of
   * it starts under any floor the pair is ever put down on. And the solver
   * cannot get it back: a blocked node stays where it is, which stops a node
   * entering a wall but never walks one out of one.
   *
   * Stated as a fact about the simulation because that is where it lives, and
   * because the drawing correction below is only worth having for as long as it
   * stays true.
   */
  it('is left inside the tower by the simulation at every spawn', () => {
    const { level, world } = atSpawn();
    expect(buriedNodes(level, world), 'nodes underground on the first tick').toBeGreaterThan(8);
  });

  /**
   * Which is the single most-looked-at moment of a run: the first frame of it,
   * and the first frame after every checkpoint reset, with the rope sawn
   * through the ground and staying there for as long as the pair stood where
   * they were put.
   */
  it('is drawn lying on it anyway', () => {
    const { level, world } = atSpawn();
    const { rec, ctx } = recorder();
    drawRope(ctx, level, world, world, 1, 0);
    const drawn = rec.strokes.filter((s) => s.style !== ROPE_SHADOW);
    expect(drawn.length, 'the ink and the chalk core').toBe(2);
    for (const stroke of drawn) {
      // The two ends are pinned to the haulers' hands and are left there; every
      // node between them is the drawing's own business.
      for (const [x, y] of stroke.points.slice(1, -1)) {
        expect(pointSolid(level, world, x, y), `a node drawn at ${x.toFixed(0)},${y.toFixed(0)}`).toBe(false);
      }
    }
  });

  /**
   * The crate hangs off the middle node, which is the deepest point of the sag
   * and so the one most reliably underground. Drawn off the raw node it left
   * the tether rising out of the floor while the rope it hangs from lay on top
   * of it — two drawings of one knot.
   */
  it('hangs the crate off the same knot it drew', () => {
    const { level, world } = atSpawn();
    const { rec, ctx } = recorder();
    drawCargo(ctx, level, world, world, 1, 0, true);
    const [tether] = rec.strokes;
    const [start] = tether.points;
    expect(pointSolid(level, world, start[0], start[1]), 'the tether starts above ground').toBe(false);
  });
});
