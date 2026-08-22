import { describe, expect, it } from 'vitest';
import {
  CHUNK_W,
  EV_SHUTTER_OPEN,
  EV_SHUTTER_SHUT,
  MODE_HAUL,
  PLAYER_H,
  TILE,
  assembleLevel,
  createWorld,
  drainEvents,
  placeAtSpawn,
  step,
  type Level,
  type SimEvent,
  type World,
} from '@haulmates/core';
import { drawDynamicTiles } from '../src/render/tiles.js';
import { biomeFor } from '../src/render/palette.js';
import { Sfx } from '../src/audio/sfx.js';
import type { AudioEngine } from '../src/audio/synth.js';

/**
 * A canvas that keeps the paint and where it landed.
 *
 * The hold is the one verb whose whole state lives in the picture and the
 * noise: a shutter is either a wall or a doorway, a plate is either held or
 * not, and neither of them is written anywhere a player can read. So what is
 * pinned here is the difference between the two states rather than the pixels
 * of either — that a shut door and an open one share almost no paint, that a
 * plate under weight sits lower than one beside it that is bare, and that the
 * two door sounds are opposites rather than variations.
 */
interface Paint {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

class Recorder {
  fills: Paint[] = [];
  globalAlpha = 1;
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  private stack: string[] = [];

  save(): void {
    this.stack.push(this.fillStyle);
  }

  restore(): void {
    const style = this.stack.pop();
    if (style !== undefined) this.fillStyle = style;
  }

  fill(): void {
    this.fills.push({ style: this.fillStyle, x: 0, y: 0, w: 0, h: 0 });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ style: this.fillStyle, x, y, w, h });
  }

  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: (): void => {} };
  }

  stroke(): void {}
  strokeRect(): void {}
  translate(): void {}
  clip(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  ellipse(): void {}
  quadraticCurveTo(): void {}
}

/** Columns of the room below, so a test can point at one. */
const NEAR_PLATE = 4;
const DOOR = 10;
const FAR_PLATE = 16;
const FLOOR_ROW = 2;

/**
 * A room with a plate on each side of its shutter, which is the only shape the
 * design allows: with one plate the holder can never get through themselves.
 */
function doorRoom(): Level {
  const floor = Array.from({ length: CHUNK_W }, () => '#');
  floor[NEAR_PLATE] = '_';
  floor[FAR_PLATE] = '_';
  const air = Array.from({ length: CHUNK_W }, () => '.');
  air[1] = 'S';
  air[DOOR] = 'H';
  const goal = Array.from({ length: CHUNK_W }, () => '.');
  goal[CHUNK_W - 3] = 'F';
  return assembleLevel('door', 'DOOR', [
    { id: 'door', biome: 0, difficulty: 0, rows: [goal.join(''), air.join(''), floor.join(''), '#'.repeat(CHUNK_W)] },
  ]);
}

/** Everything painted over one tile of the dynamic pass. */
function tilePaint(level: Level, world: World, tx: number, ty: number, highContrast = false): Paint[] {
  const rec = new Recorder();
  drawDynamicTiles(
    rec as unknown as CanvasRenderingContext2D,
    level,
    world,
    0.1,
    tx * TILE,
    ty * TILE,
    tx * TILE,
    ty * TILE,
    { highContrast, reducedFlash: false },
  );
  return rec.fills;
}

/** Stand a hauler on the given column, feet on the floor row. */
function standOn(world: World, index: number, column: number): void {
  const p = world.players[index];
  p.x = column * TILE + TILE / 2;
  p.y = FLOOR_ROW * TILE - PLAYER_H / 2 + 2;
  p.dead = 0;
}

describe('the shutter', () => {
  it('shares almost no paint between standing open and standing shut', () => {
    const level = doorRoom();
    const world = createWorld({ level, seed: 1, mode: MODE_HAUL });
    const shut = tilePaint(level, world, DOOR, 1);
    world.open[0] = 1;
    const open = tilePaint(level, world, DOOR, 1);

    expect(shut.length, 'a shut door is a slab of slats').toBeGreaterThan(open.length * 2);
    const tape = biomeFor(0).hazA;
    expect(shut.some((f) => f.style === tape), 'the leading edge is taped').toBe(true);
    expect(open.some((f) => f.style === tape), 'and there is no leading edge to tape').toBe(false);
  });

  it('keeps the doorway visible once the door is up', () => {
    const level = doorRoom();
    const world = createWorld({ level, seed: 1, mode: MODE_HAUL });
    world.open[0] = 1;
    const open = tilePaint(level, world, DOOR, 1);
    const ink = biomeFor(0).ink;
    // The rails, the housing and the sill. An opening that appeared out of
    // blank air would read as the level breaking rather than as a way through.
    expect(open.filter((f) => f.style === ink).length).toBeGreaterThan(2);
  });

  it('paints the door in colours High Contrast can reach', () => {
    const level = doorRoom();
    const world = createWorld({ level, seed: 1, mode: MODE_HAUL });
    const plain = new Set(tilePaint(level, world, DOOR, 1).map((f) => f.style));
    const flat = new Set(tilePaint(level, world, DOOR, 1, true).map((f) => f.style));
    expect(plain.size, 'the door should paint something').toBeGreaterThan(2);
    expect([...plain].filter((c) => flat.has(c)), 'colours that ignore the palette').toEqual([]);
  });
});

describe('the plate', () => {
  /** How far down the tile the plate's steel lid is sitting. */
  function lidY(level: Level, world: World, column: number): number {
    const face = biomeFor(0).tileTop;
    const lid = tilePaint(level, world, column, FLOOR_ROW).filter((f) => f.style === face);
    expect(lid.length, 'the plate should have exactly one lid').toBe(1);
    return lid[0].y - FLOOR_ROW * TILE;
  }

  it('presses down under a hauler', () => {
    const level = doorRoom();
    const world = createWorld({ level, seed: 1, mode: MODE_HAUL });
    const bare = lidY(level, world, NEAR_PLATE);
    standOn(world, 0, NEAR_PLATE);
    expect(lidY(level, world, NEAR_PLATE), 'weight moves the lid one way').toBeGreaterThan(bare);
  });

  /**
   * The simulation keeps one byte per room, so both plates in a room read as
   * held the moment either of them is. Drawing it that way would show a plate
   * pressing itself down with nobody on it — and the leapfrog is only legible
   * if you can watch your partner step off the near plate while the door,
   * which somebody else is now holding, stays up.
   */
  it('presses only the plate that has somebody on it', () => {
    const level = doorRoom();
    const world = createWorld({ level, seed: 1, mode: MODE_HAUL });
    const bare = lidY(level, world, FAR_PLATE);
    standOn(world, 0, NEAR_PLATE);
    world.open[0] = 1;
    expect(lidY(level, world, NEAR_PLATE), 'the one being stood on').toBeGreaterThan(bare);
    expect(lidY(level, world, FAR_PLATE), 'the one across the room').toBe(bare);
  });
});

describe('a door that moved', () => {
  /** Run the room for a while, collecting everything it had to say. */
  function play(world: World, level: Level, ticks: number): SimEvent[] {
    const ctx = { level, seed: 1, mode: MODE_HAUL };
    const out: SimEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      step(ctx, world, [0, 0]);
      out.push(...drainEvents(world));
    }
    return out;
  }

  it('says so once, not once a tick', () => {
    const level = doorRoom();
    const world = createWorld({ level, seed: 1, mode: MODE_HAUL });
    standOn(world, 0, NEAR_PLATE);
    standOn(world, 1, NEAR_PLATE);
    const held = play(world, level, 40);
    expect(held.filter((e) => e.kind === EV_SHUTTER_OPEN).length, 'one door, one report').toBe(1);
    expect(held.filter((e) => e.kind === EV_SHUTTER_SHUT).length).toBe(0);

    // Moved with the rope and the crate rather than by hand: a hauler picked up
    // and put down across the room is still tied to a rope whose nodes are all
    // back at the plate, and it hauls them onto it and off it again for as long
    // as it takes to settle — which is a door chattering open and shut, and a
    // fair impression of one player dragging another through a shutter.
    placeAtSpawn(level, world, (FAR_PLATE + 8) * TILE, FLOOR_ROW * TILE - PLAYER_H / 2 - 1);
    const letGo = play(world, level, 40);
    expect(letGo.filter((e) => e.kind === EV_SHUTTER_SHUT).length, 'and one when it comes down').toBe(1);
  });

  it('comes from the door rather than from the plate that moved it', () => {
    const level = doorRoom();
    const world = createWorld({ level, seed: 1, mode: MODE_HAUL });
    standOn(world, 0, NEAR_PLATE);
    standOn(world, 1, NEAR_PLATE);
    const opened = play(world, level, 10).find((e) => e.kind === EV_SHUTTER_OPEN);
    expect(opened, 'the door should have opened').toBeDefined();
    expect(opened?.x).toBeCloseTo(DOOR * TILE + TILE / 2);
    expect(opened?.a, 'the hold group, so a room can be told from its neighbour').toBe(0);
  });
});

/** Records what each cue is made of without building any of it. */
class FakeEngine {
  ready = true;
  now = 0;
  voices: { freq: number; to: number }[] = [];

  panBus(): null {
    return null;
  }

  tone(o: { freq: number; to?: number }): void {
    this.voices.push({ freq: o.freq, to: o.to ?? o.freq });
  }

  noise(o: { freq?: number; to?: number }): void {
    this.voices.push({ freq: o.freq ?? 0, to: o.to ?? o.freq ?? 0 });
  }
}

describe('the door sounds', () => {
  function cue(kind: number): { freq: number; to: number }[] {
    const engine = new FakeEngine();
    const sfx = new Sfx(engine as unknown as AudioEngine);
    sfx.play({ kind, x: 0, y: 0, a: 0, b: 0 }, 0, 1);
    return engine.voices;
  }

  /**
   * A hauler on a plate can be most of a rope away from the shutter it moves,
   * so for them the sound is the entire report of what they just did. Told
   * apart by direction rather than by timbre: which way the door went is the
   * only part of the news that matters.
   */
  it('go opposite ways', () => {
    const up = cue(EV_SHUTTER_OPEN);
    const down = cue(EV_SHUTTER_SHUT);
    expect(up.length, 'the door should make a noise').toBeGreaterThan(1);
    expect(down.length).toBeGreaterThan(1);
    expect(up.every((v) => v.to >= v.freq), 'opening climbs').toBe(true);
    expect(down.every((v) => v.to <= v.freq), 'closing falls').toBe(true);
  });
});
