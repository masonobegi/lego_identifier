import { describe, expect, it } from 'vitest';
import { CARGO_HP, CHUNK_W, TILE, assembleLevel, createWorld, type Level, type World } from '@haulmates/core';
import { drawHud, type HudState } from '../src/render/hud.js';

/**
 * A canvas that keeps the boxes instead of the picture.
 *
 * The HUD is eight panels placed by hand at eight sets of literal offsets, and
 * the only thing that has ever gone wrong with it is two of them landing on the
 * same pixels — which is a statement about rectangles and nothing at all about
 * colour. So this rig collects the outline of every panel and throws the rest
 * away. Panels are found by their border: `panel()` is the one thing in the
 * file that strokes a rounded box in that particular near-transparent white,
 * and a bar or a marker drawn without one is not a panel.
 */
const PANEL_BORDER = 'rgba(255,255,255,0.09)';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

class BoxRecorder {
  panels: Box[] = [];
  labels: string[] = [];
  fillStyle = '';
  strokeStyle = '';
  globalAlpha = 1;
  lineWidth = 1;
  private path: Box | null = null;

  private at(x: number, y: number): void {
    if (!this.path) this.path = { x0: x, y0: y, x1: x, y1: y };
    else {
      this.path.x0 = Math.min(this.path.x0, x);
      this.path.y0 = Math.min(this.path.y0, y);
      this.path.x1 = Math.max(this.path.x1, x);
      this.path.y1 = Math.max(this.path.y1, y);
    }
  }

  beginPath(): void {
    this.path = null;
  }

  moveTo(x: number, y: number): void {
    this.at(x, y);
  }

  lineTo(x: number, y: number): void {
    this.at(x, y);
  }

  arcTo(x1: number, y1: number): void {
    this.at(x1, y1);
  }

  arc(x: number, y: number, r: number): void {
    this.at(x - r, y - r);
    this.at(x + r, y + r);
  }

  stroke(): void {
    if (this.path && this.strokeStyle === PANEL_BORDER) this.panels.push({ ...this.path });
  }

  fillText(text: string): void {
    this.labels.push(text);
  }

  measureText(text: string): { width: number } {
    return { width: text.length * 7 };
  }

  fill(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  closePath(): void {}
  save(): void {}
  restore(): void {}
  scale(): void {}
  translate(): void {}
  ellipse(): void {}
  quadraticCurveTo(): void {}
}

function recorder(): { rec: BoxRecorder; ctx: CanvasRenderingContext2D } {
  const rec = new BoxRecorder();
  return { rec, ctx: rec as unknown as CanvasRenderingContext2D };
}

/** Two floors in two biomes, so a hauler on each is in a different one. */
function twoBiomeLevel(): Level {
  const blank = '.'.repeat(CHUNK_W);
  const floor = (biome: number): { id: string; biome: number; difficulty: number; rows: string[] } => ({
    id: `hud${biome}`,
    biome,
    difficulty: 0,
    rows: [
      `${blank.slice(0, 4)}F${blank.slice(5)}`,
      blank,
      `${blank.slice(0, 2)}S${blank.slice(3)}`,
      '#'.repeat(CHUNK_W),
    ],
  });
  return assembleLevel('hud', 'HUD', [floor(0), floor(1)]);
}

/** A run in trouble: a hint on screen and a crate that has been dropped once. */
function hudState(over: Partial<HudState> = {}): { state: HudState; level: Level; world: World } {
  const level = twoBiomeLevel();
  const world = createWorld({ level, seed: 1, mode: 0 });
  world.cargo.hp = CARGO_HP * 0.5;
  return {
    level,
    world,
    state: {
      world,
      level,
      mode: 0,
      modeName: 'THE LONG HAUL',
      localIndex: -1,
      names: ['BRAVE MARGE', 'AUTOHAULER'],
      colours: ['#FF6A00', '#1F5FA8'],
      elapsedSeconds: 61.5,
      showNetgraph: false,
      soloRestart: false,
      waitingFor: 0,
      hint: 'Hold GRIP to hang off a wall.',
      hintStrength: 1,
      ...over,
    },
  };
}

function overlap(a: Box, b: Box): number {
  return Math.min(
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0),
    Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0),
  );
}

describe('the HUD', () => {
  /**
   * The hint's box ran to 92 pixels above the bottom edge and the crate bar's
   * started at 96, so the two of them drew a border through each other by four
   * pixels whenever both were up — which is not a rare pair, since the hints
   * that fire late in a run are the ones about the crate. Asserted over every
   * panel rather than over those two, because the offsets are all literals and
   * the next collision will be between a different two of them.
   */
  it('never lands two panels on the same pixels', () => {
    const { rec, ctx } = recorder();
    const { state } = hudState();
    drawHud(ctx, 1920, 1080, state);
    expect(rec.panels.length, 'a run in trouble puts up several').toBeGreaterThan(2);
    for (let i = 0; i < rec.panels.length; i++) {
      for (let j = i + 1; j < rec.panels.length; j++) {
        expect(overlap(rec.panels[i], rec.panels[j]), `panels ${i} and ${j}`).toBeLessThan(0);
      }
    }
  });

  it('leaves the same gap at every window shape it is drawn at', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [1366, 768]]) {
      const { rec, ctx } = recorder();
      drawHud(ctx, w, h, hudState().state);
      for (let i = 0; i < rec.panels.length; i++) {
        for (let j = i + 1; j < rec.panels.length; j++) {
          expect(overlap(rec.panels[i], rec.panels[j]), `${w}x${h}, panels ${i} and ${j}`).toBeLessThan(0);
        }
      }
    }
  });

  /**
   * The caption is the only thing on screen that names where you are, and it
   * read player one's row whoever you were: the second hauler could climb into
   * a new biome under a bar still naming the one their partner was standing in.
   */
  it('names the biome the local hauler is standing in', () => {
    const { state, level, world } = hudState({ localIndex: 1 });
    // Player one on the ground floor, player two a floor above them.
    world.players[0].y = (level.h - 2) * TILE;
    world.players[1].y = TILE;
    const { rec, ctx } = recorder();
    drawHud(ctx, 1920, 1080, state);
    expect(rec.labels).toContain('THE FOUNDRY');
    expect(rec.labels, 'and not their partner s').not.toContain('THE YARD');
  });

  /**
   * Couch co-op has no local index at all — one screen, one pair of eyes — and
   * has to keep naming player one's biome rather than reading a -1 off the end
   * of the array.
   */
  it('falls back to player one when there is no local hauler', () => {
    const { state, level, world } = hudState({ localIndex: -1 });
    world.players[0].y = (level.h - 2) * TILE;
    world.players[1].y = TILE;
    const { rec, ctx } = recorder();
    drawHud(ctx, 1920, 1080, state);
    expect(rec.labels).toContain('THE YARD');
  });
});
