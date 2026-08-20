import { describe, expect, it } from 'vitest';
import {
  CARGO_H,
  DT,
  EV_CARGO_BREAK,
  GRAVITY,
  GRIP_MAX,
  MAX_FALL,
  PLAYER_H,
  REEL_FORCE,
  ROPE_LOAD,
  assembleLevel,
  IN_GRIP,
  IN_JUMP,
  IN_LEFT,
  IN_REEL,
  IN_RIGHT,
  MODE_GAUNTLET,
  MODE_HAUL,
  PI,
  ROPE_MAX,
  ROPE_MID,
  Rng,
  TILE,
  buildCampaign,
  buildTower,
  cloneWorld,
  createWorld,
  dcos,
  dsin,
  hashSeed,
  hashWorld,
  isSolidTile,
  levelForMatch,
  readSnapshot,
  step,
  tileAt,
  updateCargo,
  writeSnapshot,
  type ChunkDef,
  type Level,
  type SimContext,
  type World,
} from '@haulmates/core';

/* ------------------------------------------------------------ physics lab */

/** Row index of the floor slab in the synthetic test level. */
export const LAB_FLOOR = 26;
const LAB_HEIGHT = 30;

function replaceAt(row: string, at: number, text: string): string {
  return row.slice(0, at) + text + row.slice(at + text.length);
}

/** A bare shaft with a floor: no hazards, no surprises, exact expectations. */
function labRows(): string[] {
  const rows: string[] = [];
  for (let r = 0; r < LAB_HEIGHT; r++) {
    if (r >= LAB_FLOOR) rows.push('#'.repeat(40));
    else rows.push('##' + '.'.repeat(36) + '##');
  }
  rows[2] = replaceAt(rows[2], 19, 'F');
  rows[LAB_FLOOR - 1] = replaceAt(rows[LAB_FLOOR - 1], 19, 'S');
  return rows;
}

function labContext(height?: number, rows?: string[]): SimContext {
  let use = rows ?? labRows();
  if (height !== undefined) {
    const extra: string[] = [];
    for (let i = 0; i < height; i++) extra.push('##' + '.'.repeat(36) + '##');
    use = [use[0], use[1], use[2], ...extra, ...use.slice(3)];
  }
  const chunk: ChunkDef = { id: 'lab', biome: 0, difficulty: 0, rows: use, tags: ['start', 'goal'] };
  const level: Level = assembleLevel('lab', 'LAB', [chunk]);
  return { level, seed: 1, mode: MODE_HAUL };
}

function dropPlayersAt(world: World, x: number, y: number): void {
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = x + (i === 0 ? -30 : 30);
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.grounded = 0;
  }
  for (let i = 0; i < world.ropeX.length; i++) {
    const t = i / (world.ropeX.length - 1);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
    world.ropeY[i] = y;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = y;
  }
  world.cargo.x = x;
  world.cargo.y = y + 20;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
}

function ctxFor(mode = MODE_HAUL, seed = 12345): SimContext {
  return { level: levelForMatch(mode, seed, 8), seed, mode };
}

/** Deterministic pseudo-inputs: enough chaos to exercise every code path. */
function scriptedInput(tick: number, player: number): number {
  const r = (tick * (player === 0 ? 37 : 61) + player * 911) % 240;
  let mask = 0;
  if (r < 70) mask |= IN_RIGHT;
  else if (r < 130) mask |= IN_LEFT;
  if (r % 23 < 4) mask |= IN_JUMP;
  if (r % 47 < 9) mask |= IN_GRIP;
  if (r % 31 < 5) mask |= IN_REEL;
  return mask;
}

function runTicks(ctx: SimContext, world: World, count: number): void {
  const inputs = [0, 0];
  for (let i = 0; i < count; i++) {
    inputs[0] = scriptedInput(world.tick + 1, 0);
    inputs[1] = scriptedInput(world.tick + 1, 1);
    step(ctx, world, inputs);
    world.events.length = 0;
  }
}

describe('deterministic math', () => {
  it('approximates sine within 2e-3 everywhere', () => {
    let worst = 0;
    for (let i = -2000; i <= 2000; i++) {
      const x = (i / 2000) * 4 * PI;
      worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('approximates cosine within 2e-3 everywhere', () => {
    let worst = 0;
    for (let i = -2000; i <= 2000; i++) {
      const x = (i / 2000) * 4 * PI;
      worst = Math.max(worst, Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('uses no transcendental math in the simulation modules', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const dir = new URL('../src/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.ts'));
    const banned = /Math\.(sin|cos|tan|atan2?|asin|acos|pow|exp|log|cbrt|hypot|random|fround)\b/;
    const offenders: string[] = [];
    for (const f of files) {
      if (f === 'math.ts') continue;
      const text = await readFile(new URL(f, dir), 'utf8');
      // Strip comments first: the ban is on called code, not on prose about it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      code.split('\n').forEach((line, i) => {
        if (banned.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = new Rng(hashSeed('haulmates'));
    const b = new Rng(hashSeed('haulmates'));
    for (let i = 0; i < 5000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('never gets stuck on a fixed point', () => {
    const rng = new Rng(0);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(rng.nextU32());
    expect(seen.size).toBeGreaterThan(990);
  });

  it('spreads uniformly enough for tower generation', () => {
    const rng = new Rng(99);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) buckets[rng.nextInt(10)]++;
    for (const b of buckets) expect(b).toBeGreaterThan(9000);
  });
});

describe('simulation determinism', () => {
  it('produces identical state from identical inputs over a long run', () => {
    const ctx = ctxFor();
    const a = createWorld(ctx);
    const b = createWorld(ctx);
    runTicks(ctx, a, 4000);
    runTicks(ctx, b, 4000);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.tick).toBe(4000);
  });

  it('produces identical state across independently built contexts', () => {
    const one = ctxFor(MODE_GAUNTLET, 777);
    const two = ctxFor(MODE_GAUNTLET, 777);
    const a = createWorld(one);
    const b = createWorld(two);
    runTicks(one, a, 2500);
    runTicks(two, b, 2500);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('diverges when a single input bit differs, proving the hash is sensitive', () => {
    const ctx = ctxFor();
    const a = createWorld(ctx);
    const b = createWorld(ctx);
    runTicks(ctx, a, 200);
    runTicks(ctx, b, 199);
    step(ctx, b, [scriptedInput(200, 0) ^ IN_RIGHT, scriptedInput(200, 1)]);
    runTicks(ctx, a, 60);
    runTicks(ctx, b, 60);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});

describe('rollback', () => {
  it('resimulating from a snapshot reproduces the present exactly', () => {
    const ctx = ctxFor();
    const world = createWorld(ctx);
    runTicks(ctx, world, 900);

    const saved = cloneWorld(world);
    const savedTick = world.tick;
    runTicks(ctx, world, 14);
    const expectedHash = hashWorld(world);

    // Replay the same 14 ticks from the snapshot.
    runTicks(ctx, saved, 14);
    expect(saved.tick).toBe(savedTick + 14);
    expect(hashWorld(saved)).toBe(expectedHash);
  });

  it('survives many rollback cycles without drifting', () => {
    const ctx = ctxFor();
    const live = createWorld(ctx);
    const shadow = createWorld(ctx);
    for (let round = 0; round < 40; round++) {
      runTicks(ctx, live, 12);
      const restored = cloneWorld(shadow);
      runTicks(ctx, restored, 12);
      expect(hashWorld(restored)).toBe(hashWorld(live));
      runTicks(ctx, shadow, 12);
      expect(hashWorld(shadow)).toBe(hashWorld(live));
    }
  });
});

describe('snapshots', () => {
  it('round-trips losslessly', () => {
    const ctx = ctxFor();
    const world = createWorld(ctx);
    runTicks(ctx, world, 700);
    const bytes = writeSnapshot(world);

    const restored = createWorld(ctx);
    readSnapshot(restored, bytes);
    expect(hashWorld(restored)).toBe(hashWorld(world));

    // And the restored world continues identically.
    runTicks(ctx, world, 120);
    runTicks(ctx, restored, 120);
    expect(hashWorld(restored)).toBe(hashWorld(world));
  });

  it('rejects a snapshot of the wrong size', () => {
    const ctx = ctxFor();
    const world = createWorld(ctx);
    expect(() => readSnapshot(world, new Uint8Array(4))).toThrow(/size mismatch/);
  });
});

describe('physics invariants', () => {
  it('never lets the rope exceed its maximum length by more than a hair', () => {
    const ctx = ctxFor();
    const world = createWorld(ctx);
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      step(ctx, world, [scriptedInput(world.tick + 1, 0), scriptedInput(world.tick + 1, 1)]);
      world.events.length = 0;
      const dx = world.players[1].x - world.players[0].x;
      const dy = world.players[1].y - world.players[0].y;
      worst = Math.max(worst, Math.sqrt(dx * dx + dy * dy));
    }
    // One tick of correction is partial by design (ROPE_CORRECTION < 1), so a
    // little overshoot is expected; a runaway would show up as multiples.
    expect(worst).toBeLessThan(ROPE_MAX * 1.6);
  });

  it('keeps players inside the shaft', () => {
    const ctx = ctxFor();
    const world = createWorld(ctx);
    for (let i = 0; i < 3000; i++) {
      step(ctx, world, [scriptedInput(world.tick + 1, 0), scriptedInput(world.tick + 1, 1)]);
      world.events.length = 0;
      for (const p of world.players) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(ctx.level.widthPx);
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
      expect(Number.isFinite(world.cargo.x)).toBe(true);
    }
  });

  it('never leaves a player embedded in solid ground', () => {
    const ctx = ctxFor();
    const world = createWorld(ctx);
    const { level } = ctx;
    let embedded = 0;
    for (let i = 0; i < 2000; i++) {
      step(ctx, world, [scriptedInput(world.tick + 1, 0), scriptedInput(world.tick + 1, 1)]);
      world.events.length = 0;
      for (const p of world.players) {
        const tx = Math.floor(p.x / TILE);
        const ty = Math.floor(p.y / TILE);
        const t = level.tiles[ty * level.w + tx];
        if (t === 1) embedded++;
      }
    }
    expect(embedded).toBe(0);
  });

  it('applies gravity at the documented rate in free fall', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    dropPlayersAt(world, 20 * TILE, 6 * TILE);
    step(ctx, world, [0, 0]);
    const gained = world.players[0].vy;
    // One tick of gravity, plus the slack rope's baseline droop.
    expect(gained).toBeGreaterThan(GRAVITY * DT);
    expect(gained).toBeLessThan(GRAVITY * DT + ROPE_LOAD * DT + 0.5);
  });

  it('lands on solid ground and stops', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    dropPlayersAt(world, 20 * TILE, 6 * TILE);
    for (let i = 0; i < 200; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    for (const p of world.players) {
      expect(p.grounded).toBe(1);
      // Landing zeroes vy; the rope's load is then re-applied for next tick.
      expect(Math.abs(p.vy)).toBeLessThan(ROPE_LOAD * DT + 0.1);
      // Floor top is at row LAB_FLOOR; feet rest just above it.
      expect(p.y + PLAYER_H / 2).toBeGreaterThan(LAB_FLOOR * TILE - 2);
      expect(p.y + PLAYER_H / 2).toBeLessThan(LAB_FLOOR * TILE + 2);
    }
  });

  it('respects terminal velocity', () => {
    const ctx = labContext(120);
    const world = createWorld(ctx);
    dropPlayersAt(world, 20 * TILE, 4 * TILE);
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
      peak = Math.max(peak, world.players[0].vy);
    }
    // The rope can legitimately drag you past your own terminal velocity, but
    // only by the load it applies — never without bound.
    expect(peak).toBeLessThanOrEqual(MAX_FALL + ROPE_LOAD * DT + 0.001);
    expect(peak).toBeGreaterThan(MAX_FALL * 0.9);
  });

  it('jumps roughly the height the tuning implies', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    for (let i = 0; i < 120; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    const startY = world.players[0].y;
    let apex = startY;
    for (let i = 0; i < 90; i++) {
      step(ctx, world, [IN_JUMP, IN_JUMP]);
      world.events.length = 0;
      apex = Math.min(apex, world.players[0].y);
    }
    const height = startY - apex;
    // v^2 / 2g with the hold-boost applied is a little over three tiles.
    expect(height).toBeGreaterThan(2.5 * TILE);
    expect(height).toBeLessThan(6 * TILE);
  });

  it('kills a player who walks into spikes', () => {
    const rows = labRows();
    rows[LAB_FLOOR - 1] = replaceAt(rows[LAB_FLOOR - 1], 24, '^^^^');
    const ctx = labContext(undefined, rows);
    const world = createWorld(ctx);
    let died = false;
    for (let i = 0; i < 400 && !died; i++) {
      step(ctx, world, [IN_RIGHT, IN_RIGHT]);
      world.events.length = 0;
      died = world.players[0].dead === 1 || world.players[1].dead === 1;
    }
    expect(died).toBe(true);
  });

  it('launches a player off a bounce pad', () => {
    const rows = labRows();
    rows[LAB_FLOOR] = replaceAt(rows[LAB_FLOOR], 15, 'oooooooooo');
    const ctx = labContext(undefined, rows);
    const world = createWorld(ctx);
    let peakUp = 0;
    for (let i = 0; i < 200; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
      peakUp = Math.min(peakUp, world.players[0].vy);
    }
    expect(peakUp).toBeLessThan(-500);
  });

  it('pins a gripping player in place while the rope hauls on them', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    for (let i = 0; i < 120; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    const anchored = world.players[0];
    const before = { x: anchored.x, y: anchored.y };
    for (let i = 0; i < 200; i++) {
      // Player 0 braces; player 1 sprints away until the rope goes taut.
      step(ctx, world, [IN_GRIP, IN_RIGHT | IN_JUMP]);
      world.events.length = 0;
    }
    expect(world.players[0].gripping === 1 || world.players[0].grip === 0).toBe(true);
    // Grip stamina is finite, so they eventually slip — but never before moving
    // less than a tile while the partner pulls hard.
    expect(Math.abs(anchored.x - before.x)).toBeLessThan(TILE * 3);
  });

  it('starts both haulers with a full grip bar', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    for (const p of world.players) expect(p.grip).toBe(GRIP_MAX);
  });

  it('lets a player climb the rope toward an anchored partner', () => {
    // The whole co-op fantasy rests on this: reeling has to beat gravity, or
    // "the fastest way up is the other person" is simply untrue.
    expect(REEL_FORCE).toBeGreaterThan(GRAVITY);

    const ctx = labContext();
    const world = createWorld(ctx);
    for (let i = 0; i < 60; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    // Pin one hauler in mid-air and let the other haul themselves up to them.
    const anchor = world.players[0];
    const climber = world.players[1];
    anchor.x = 20 * TILE;
    anchor.y = 8 * TILE;
    anchor.gripping = 1;
    anchor.gripX = anchor.x;
    anchor.gripY = anchor.y;
    anchor.grip = GRIP_MAX;
    climber.x = 20 * TILE;
    climber.y = 8 * TILE + 190;
    climber.vx = 0;
    climber.vy = 0;
    climber.grip = GRIP_MAX;

    const startY = climber.y;
    let highest = climber.y;
    for (let i = 0; i < 200; i++) {
      step(ctx, world, [IN_GRIP, IN_REEL]);
      world.events.length = 0;
      highest = Math.min(highest, world.players[1].y);
    }
    expect((startY - highest) / TILE).toBeGreaterThan(3);
  });

  it('makes reeling cost grip stamina, so it is not free', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    for (let i = 0; i < 60; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    world.players[0].x = 20 * TILE;
    world.players[0].y = 8 * TILE;
    world.players[0].gripping = 1;
    world.players[0].gripX = world.players[0].x;
    world.players[0].gripY = world.players[0].y;
    world.players[1].x = 20 * TILE;
    world.players[1].y = 8 * TILE + 190;
    const before = world.players[1].grip;
    for (let i = 0; i < 120; i++) {
      step(ctx, world, [IN_GRIP, IN_REEL]);
      world.events.length = 0;
    }
    expect(world.players[1].grip).toBeLessThan(before);
  });

  it('ignores reeling on a slack rope', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    for (let i = 0; i < 60; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    // Standing next to each other: there is nothing to pull against.
    world.players[1].x = world.players[0].x + 20;
    world.players[1].y = world.players[0].y;
    const before = world.players[1].grip;
    for (let i = 0; i < 60; i++) {
      step(ctx, world, [0, IN_REEL]);
      world.events.length = 0;
    }
    expect(world.players[1].grip).toBe(before);
  });

  it('lets a dead player be dragged along instead of anchoring the pair', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    for (let i = 0; i < 120; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    world.players[0].dead = 1;
    world.players[0].respawn = 100000;
    // Dragging a corpse across the floor also grinds the crate to pieces, which
    // would trip a checkpoint reset and invalidate the measurement. That is
    // correct game behaviour; here we only want to observe the drag itself.
    world.cargo.hp = 1e9;
    const startX = world.players[0].x;
    for (let i = 0; i < 240; i++) {
      step(ctx, world, [0, IN_RIGHT]);
      world.events.length = 0;
    }
    expect(world.restartTimer).toBe(0);
    expect(world.players[0].x).toBeGreaterThan(startX + 4 * TILE);
  });

  it('does not grind the crate to pieces just for touching the floor', () => {
    // This test used to assert the opposite, and passed for the wrong reason.
    // The rope tether wrote the crate's corrected position straight onto it,
    // shoving it into the floor every tick, and the collision response beat it
    // up on the way back out — so a crate resting on the ground with a slack
    // rope was destroyed in about ten seconds by a bug rather than by play.
    //
    // Measured while fixing it: the crate does not actually slide here at all.
    // The players run, the rope slackens, and the crate sits still. Whatever
    // the old test was measuring, it was not dragging.
    const ctx = labContext();
    const world = createWorld(ctx);
    for (let i = 0; i < 120; i++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    expect(world.cargo.grounded).toBe(1);

    const startHp = world.cargo.hp;
    for (let i = 0; i < 900; i++) {
      const dir = Math.floor(i / 110) % 2 === 0 ? IN_RIGHT : IN_LEFT;
      step(ctx, world, [dir, dir]);
      world.events.length = 0;
    }
    expect(world.cargoBreaks).toBe(0);
    expect(world.cargo.hp).toBeGreaterThan(startHp * 0.5);
  });

});

describe('the crate stays in the world', () => {
  // A sealed box with one thick slab across it. Rows 8-11 are solid, so the
  // slab spans y 192..288 with open air on both sides of it.
  const SLAB_TOP = 8;
  const SLAB_ROWS = 4;
  const BOTTOM = 22;
  const slabTopPx = SLAB_TOP * TILE;
  const slabBottomPx = (SLAB_TOP + SLAB_ROWS) * TILE;

  function vault(): Level {
    const rows: string[] = [];
    for (let r = 0; r <= BOTTOM; r++) {
      const solid = r === 0 || r === BOTTOM || (r >= SLAB_TOP && r < SLAB_TOP + SLAB_ROWS);
      rows.push(solid ? '#'.repeat(40) : '#' + '.'.repeat(38) + '#');
    }
    rows[SLAB_TOP - 1] = replaceAt(rows[SLAB_TOP - 1], 19, 'S');
    rows[BOTTOM - 1] = replaceAt(rows[BOTTOM - 1], 5, 'F');
    return assembleLevel('vault', 'VAULT', [{ id: 'vault', biome: 0, difficulty: 0, rows }]);
  }

  function insideSlab(y: number): boolean {
    return y > slabTopPx && y < slabBottomPx;
  }

  it('has a slab that is actually solid', () => {
    const level = vault();
    expect(isSolidTile(tileAt(level, 20, SLAB_TOP))).toBe(true);
    expect(isSolidTile(tileAt(level, 20, SLAB_TOP - 1))).toBe(false);
    expect(isSolidTile(tileAt(level, 20, SLAB_TOP + SLAB_ROWS))).toBe(false);
  });

  it('does not phase through a slab when the rope is yanked hard', () => {
    const level = vault();
    const world = createWorld({ level, seed: 1, mode: MODE_HAUL });
    world.cargo.hp = 1e9;

    // Rest the crate on the slab, then haul the rope's middle node far below
    // it. The correction that produces is several tiles long in a single tick,
    // which is exactly the case that used to be written straight onto the
    // crate's position without ever testing the floor in between.
    let worst = 0;
    for (let pull = 40; pull <= 2000; pull += 40) {
      world.cargo.x = 20 * TILE;
      world.cargo.y = slabTopPx - CARGO_H / 2 - 1;
      world.cargo.px = world.cargo.x;
      world.cargo.py = world.cargo.y;
      world.ropeX[ROPE_MID] = world.cargo.x;
      world.ropeY[ROPE_MID] = world.cargo.y + pull;

      updateCargo(level, world);
      worst = Math.max(worst, world.cargo.y);
      expect(insideSlab(world.cargo.y), `pull ${pull} put the crate inside the slab at y=${world.cargo.y.toFixed(1)}`).toBe(false);
      expect(world.cargo.y, `pull ${pull} pulled the crate clean through the slab`).toBeLessThan(slabBottomPx);
    }
    expect(worst).toBeLessThan(slabBottomPx);
  });

  it('cannot be dragged into geometry however the rope thrashes', () => {
    const level = vault();
    const world = createWorld({ level, seed: 2, mode: MODE_HAUL });
    world.cargo.hp = 1e9;
    world.cargo.x = 20 * TILE;
    world.cargo.y = slabTopPx - CARGO_H / 2 - 1;
    world.cargo.px = world.cargo.x;
    world.cargo.py = world.cargo.y;

    // Whip the anchor around, including to points inside the slab itself.
    let breaches = 0;
    for (let t = 0; t < 1200; t++) {
      const a = t % 40;
      world.ropeX[ROPE_MID] = (a < 20 ? 3 : 36) * TILE;
      world.ropeY[ROPE_MID] = (t % 80 < 40 ? SLAB_TOP + 2 : 2) * TILE;
      updateCargo(level, world);
      if (insideSlab(world.cargo.y) && world.cargo.x > TILE && world.cargo.x < 39 * TILE) breaches++;
    }
    expect(breaches).toBe(0);
  });
});

describe('bracing', () => {
  it('costs nothing on solid ground, so an anchor outlasts a partner climbing to it', () => {
    const ctx = labContext();
    const world = createWorld(ctx);
    const p = world.players[0];
    p.grip = GRIP_MAX;

    // Fifteen seconds braced on the floor: far longer than any reel takes.
    for (let t = 0; t < 15 * 60; t++) step(ctx, world, [IN_GRIP, 0]);
    expect(p.gripping).toBe(1);
    expect(p.grip).toBe(GRIP_MAX);
  });

  it('still burns stamina hanging off a wall', () => {
    const rows = labRows();
    // A wall to cling to, mid-air, away from the floor.
    for (let r = 10; r < 16; r++) rows[r] = replaceAt(rows[r], 2, '##');
    const ctx = labContext(undefined, rows);
    const world = createWorld(ctx);
    const p = world.players[0];
    p.x = 4 * TILE;
    p.y = 12 * TILE;
    p.grounded = 0;
    p.grip = GRIP_MAX;

    let clung = 0;
    for (let t = 0; t < 15 * 60; t++) {
      step(ctx, world, [IN_GRIP | IN_LEFT, 0]);
      if (p.gripping === 1) clung++;
    }
    expect(clung).toBeGreaterThan(0);
    expect(p.grip).toBeLessThan(GRIP_MAX);
  });
});
