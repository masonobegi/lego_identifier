import { CARGO_HP, ROPE_NODES, ROPE_REST } from './constants.js';
import type { Level } from './level.js';
import type { CargoState, PlayerState, SimContext, World } from './types.js';

/**
 * Field lists are the single source of truth for cloning, snapshotting and
 * hashing. Adding a field to `PlayerState` without adding it here is a compile
 * error, which rules out the most common cause of rollback desyncs: state that
 * gets simulated but not copied.
 */
export const PLAYER_KEYS = [
  'x', 'y', 'vx', 'vy', 'facing', 'grounded', 'groundKind', 'coyote', 'jumpBuffer',
  'jumpHeld', 'wallDir', 'gripping', 'gripX', 'gripY', 'grip', 'gripCooldown',
  'stunned', 'dead', 'respawn', 'emote', 'emoteTimer', 'anim', 'ridePlatform',
  'deaths', 'restartHeld', 'prevInput',
] as const satisfies readonly (keyof PlayerState)[];

export const CARGO_KEYS = [
  'x', 'y', 'px', 'py', 'rot', 'rotV', 'hp', 'shake', 'grounded',
] as const satisfies readonly (keyof CargoState)[];

export const WORLD_KEYS = [
  'tick', 'rng', 'checkpoint', 'spawnX', 'spawnY', 'best', 'finished',
  'finishTick', 'restartTimer', 'bonds', 'betrayals', 'cargoBreaks',
] as const satisfies readonly (keyof World)[];

type PlayerKey = (typeof PLAYER_KEYS)[number];
type CargoKey = (typeof CARGO_KEYS)[number];
type WorldKey = (typeof WORLD_KEYS)[number];

function emptyPlayer(): PlayerState {
  return {
    x: 0, y: 0, vx: 0, vy: 0, facing: 1, grounded: 0, groundKind: 0, coyote: 0,
    jumpBuffer: 0, jumpHeld: 0, wallDir: 0, gripping: 0, gripX: 0, gripY: 0,
    grip: 0, gripCooldown: 0, stunned: 0, dead: 0, respawn: 0, emote: 0,
    emoteTimer: 0, anim: 0, ridePlatform: -1, deaths: 0, restartHeld: 0, prevInput: 0,
  };
}

/** Place both players and the whole rope at a spawn point. */
export function placeAtSpawn(world: World, x: number, y: number): void {
  const half = ROPE_REST * 0.36;
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    const sx = x + (i === 0 ? -half : half);
    p.x = sx;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.facing = i === 0 ? 1 : -1;
    p.grounded = 0;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.jumpHeld = 0;
    p.wallDir = 0;
    p.gripping = 0;
    p.grip = 1;
    p.gripCooldown = 0;
    p.stunned = 0;
    p.dead = 0;
    p.respawn = 0;
    p.ridePlatform = -1;
  }

  const ax = world.players[0].x;
  const ay = world.players[0].y;
  const bx = world.players[1].x;
  const by = world.players[1].y;
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    const nx = ax + (bx - ax) * t;
    // Rest the rope in a slack arc so it reads as a rope, not a stick.
    const ny = ay + (by - ay) * t + 4 * t * (1 - t) * ROPE_REST * 0.35;
    world.ropeX[i] = nx;
    world.ropeY[i] = ny;
    world.ropePX[i] = nx;
    world.ropePY[i] = ny;
  }

  const mid = (ROPE_NODES - 1) >> 1;
  world.cargo.x = world.ropeX[mid];
  world.cargo.y = world.ropeY[mid] + 22;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.rot = 0;
  world.cargo.rotV = 0;
  world.cargo.shake = 0;
  world.cargo.grounded = 0;
}

export function createWorld(ctx: SimContext): World {
  const level: Level = ctx.level;
  const world: World = {
    tick: 0,
    rng: ctx.seed | 0 || 0x1a2b3c4d,
    players: [emptyPlayer(), emptyPlayer()],
    ropeX: new Float64Array(ROPE_NODES),
    ropeY: new Float64Array(ROPE_NODES),
    ropePX: new Float64Array(ROPE_NODES),
    ropePY: new Float64Array(ROPE_NODES),
    cargo: { x: 0, y: 0, px: 0, py: 0, rot: 0, rotV: 0, hp: CARGO_HP, shake: 0, grounded: 0 },
    crumble: new Int32Array(level.crumbleTile.length),
    checkpoint: -1,
    spawnX: level.spawnX,
    spawnY: level.spawnY,
    best: level.spawnY,
    finished: 0,
    finishTick: 0,
    restartTimer: 0,
    bonds: 0,
    betrayals: 0,
    cargoBreaks: 0,
    events: [],
  };
  placeAtSpawn(world, level.spawnX, level.spawnY);
  return world;
}

export function cloneWorld(src: World): World {
  const players: PlayerState[] = [emptyPlayer(), emptyPlayer()];
  for (let i = 0; i < 2; i++) {
    const s = src.players[i];
    const d = players[i];
    for (const k of PLAYER_KEYS) d[k as PlayerKey] = s[k as PlayerKey];
  }
  const cargo = {} as CargoState;
  for (const k of CARGO_KEYS) cargo[k as CargoKey] = src.cargo[k as CargoKey];

  const out: World = {
    tick: src.tick,
    rng: src.rng,
    players,
    ropeX: Float64Array.from(src.ropeX),
    ropeY: Float64Array.from(src.ropeY),
    ropePX: Float64Array.from(src.ropePX),
    ropePY: Float64Array.from(src.ropePY),
    cargo,
    crumble: Int32Array.from(src.crumble),
    checkpoint: src.checkpoint,
    spawnX: src.spawnX,
    spawnY: src.spawnY,
    best: src.best,
    finished: src.finished,
    finishTick: src.finishTick,
    restartTimer: src.restartTimer,
    bonds: src.bonds,
    betrayals: src.betrayals,
    cargoBreaks: src.cargoBreaks,
    events: [],
  };
  return out;
}

/** Copy `src` into `dst` in place, reusing the existing arrays. */
export function copyWorldInto(dst: World, src: World): void {
  for (const k of WORLD_KEYS) (dst as unknown as Record<string, number>)[k] = src[k as WorldKey] as number;
  for (let i = 0; i < 2; i++) {
    const s = src.players[i];
    const d = dst.players[i];
    for (const k of PLAYER_KEYS) d[k as PlayerKey] = s[k as PlayerKey];
  }
  for (const k of CARGO_KEYS) dst.cargo[k as CargoKey] = src.cargo[k as CargoKey];
  dst.ropeX.set(src.ropeX);
  dst.ropeY.set(src.ropeY);
  dst.ropePX.set(src.ropePX);
  dst.ropePY.set(src.ropePY);
  dst.crumble.set(src.crumble);
  dst.events.length = 0;
}

/* ----------------------------------------------------------------- hashing */

const hashScratch = new DataView(new ArrayBuffer(8));

function mixFloat(h: number, v: number): number {
  // Quantise before hashing: a 1/1024 world-pixel difference is far below
  // anything gameplay can express, but any genuine divergence blows past it
  // within a handful of ticks.
  const q = Math.round(v * 1024);
  hashScratch.setFloat64(0, q);
  let x = h;
  x ^= hashScratch.getUint32(0);
  x = Math.imul(x, 0x01000193);
  x ^= hashScratch.getUint32(4);
  x = Math.imul(x, 0x01000193);
  return x | 0;
}

/** Deterministic fingerprint of the simulated state, used for desync detection. */
export function hashWorld(world: World): number {
  let h = 0x811c9dc5;
  h = mixFloat(h, world.tick);
  h = mixFloat(h, world.rng);
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    for (const k of PLAYER_KEYS) h = mixFloat(h, p[k as PlayerKey]);
  }
  for (const k of CARGO_KEYS) h = mixFloat(h, world.cargo[k as CargoKey]);
  for (let i = 0; i < world.ropeX.length; i++) {
    h = mixFloat(h, world.ropeX[i]);
    h = mixFloat(h, world.ropeY[i]);
    h = mixFloat(h, world.ropePX[i]);
    h = mixFloat(h, world.ropePY[i]);
  }
  for (let i = 0; i < world.crumble.length; i++) h = mixFloat(h, world.crumble[i]);
  h = mixFloat(h, world.checkpoint);
  h = mixFloat(h, world.spawnX);
  h = mixFloat(h, world.spawnY);
  h = mixFloat(h, world.finished);
  h = mixFloat(h, world.cargoBreaks);
  return h >>> 0;
}

/* ----------------------------------------------------------- serialisation */

/** Byte size of a full snapshot for a world with `crumbleCount` crumble tiles. */
export function snapshotSize(crumbleCount: number): number {
  const floats = WORLD_KEYS.length + PLAYER_KEYS.length * 2 + CARGO_KEYS.length + ROPE_NODES * 4;
  return floats * 8 + crumbleCount * 4;
}

/** Lossless snapshot. Both sides resume from bit-identical state after a resync. */
export function writeSnapshot(world: World): Uint8Array {
  const buf = new ArrayBuffer(snapshotSize(world.crumble.length));
  const view = new DataView(buf);
  let o = 0;
  for (const k of WORLD_KEYS) {
    view.setFloat64(o, world[k as WorldKey] as number);
    o += 8;
  }
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    for (const k of PLAYER_KEYS) {
      view.setFloat64(o, p[k as PlayerKey]);
      o += 8;
    }
  }
  for (const k of CARGO_KEYS) {
    view.setFloat64(o, world.cargo[k as CargoKey]);
    o += 8;
  }
  for (let i = 0; i < ROPE_NODES; i++) {
    view.setFloat64(o, world.ropeX[i]); o += 8;
    view.setFloat64(o, world.ropeY[i]); o += 8;
    view.setFloat64(o, world.ropePX[i]); o += 8;
    view.setFloat64(o, world.ropePY[i]); o += 8;
  }
  for (let i = 0; i < world.crumble.length; i++) {
    view.setInt32(o, world.crumble[i]);
    o += 4;
  }
  return new Uint8Array(buf);
}

export function readSnapshot(world: World, bytes: Uint8Array): void {
  const expected = snapshotSize(world.crumble.length);
  if (bytes.byteLength !== expected) {
    throw new Error(`snapshot size mismatch: got ${bytes.byteLength}, expected ${expected}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  for (const k of WORLD_KEYS) {
    (world as unknown as Record<string, number>)[k] = view.getFloat64(o);
    o += 8;
  }
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    for (const k of PLAYER_KEYS) {
      p[k as PlayerKey] = view.getFloat64(o);
      o += 8;
    }
  }
  for (const k of CARGO_KEYS) {
    world.cargo[k as CargoKey] = view.getFloat64(o);
    o += 8;
  }
  for (let i = 0; i < ROPE_NODES; i++) {
    world.ropeX[i] = view.getFloat64(o); o += 8;
    world.ropeY[i] = view.getFloat64(o); o += 8;
    world.ropePX[i] = view.getFloat64(o); o += 8;
    world.ropePY[i] = view.getFloat64(o); o += 8;
  }
  for (let i = 0; i < world.crumble.length; i++) {
    world.crumble[i] = view.getInt32(o);
    o += 4;
  }
  world.events.length = 0;
}
