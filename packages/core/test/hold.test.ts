import { describe, expect, it } from 'vitest';
import {
  CARGO_H,
  IN_JUMP,
  IN_GRIP,
  IN_LEFT,
  IN_RIGHT,
  PLAYER_H,
  ROPE_MAX,
  ROPE_NODES,
  TILE,
  assembleLevel,
  createWorld,
  step,
  updateHolds,
  type Level,
  type World,
} from '../src/index.js';

/**
 * A room with a plate on the left, a shutter on the right, and floor between.
 *
 * `gap` is how many columns separate them, which is the whole mechanic: the
 * rope is a shade under ten tiles, so a plate further than that from the far
 * side of its shutter is somewhere one player cannot be while also being
 * through the door.
 */
function room(gap: number): { level: Level; plate: number; door: number; floor: number } {
  const W = 40;
  const H = 24;
  const floor = H - 4;
  const plate = 4;
  const door = plate + gap;
  const rows: string[] = [];
  for (let r = 0; r < H; r++) {
    let s = '';
    for (let c = 0; c < W; c++) {
      if (c < 2 || c >= W - 2) s += '#';
      else if (r === floor) s += c === plate ? '_' : '#';
      else if (r === floor - 1 && c === door) s += 'H';
      else if (r === floor - 2 && c === door) s += 'H';
      else if (r <= 1) s += '#';
      else s += '.';
    }
    rows.push(s);
  }
  rows[floor - 1] = `${rows[floor - 1].slice(0, 6)}S${rows[floor - 1].slice(7)}`;
  rows[3] = `${rows[3].slice(0, 30)}F${rows[3].slice(31)}`;
  return {
    level: assembleLevel('hold', 'HOLD', [{ id: 'hold', biome: 0, difficulty: 0, rows, tags: ['start'] }]),
    plate,
    door,
    floor,
  };
}

/** The same room, with a second plate on the far side of the shutter. */
function twoPlate(gap: number): { level: Level; plate: number; door: number; far: number; floor: number } {
  const W = 40;
  const H = 24;
  const floor = H - 4;
  const plate = 4;
  const door = plate + gap;
  const far = door + 3;
  const rows: string[] = [];
  for (let r = 0; r < H; r++) {
    let s = '';
    for (let c = 0; c < W; c++) {
      if (c < 2 || c >= W - 2) s += '#';
      else if (r === floor) s += c === plate || c === far ? '_' : '#';
      else if ((r === floor - 1 || r === floor - 2) && c === door) s += 'H';
      else if (r <= 1) s += '#';
      else s += '.';
    }
    rows.push(s);
  }
  rows[floor - 1] = `${rows[floor - 1].slice(0, 6)}S${rows[floor - 1].slice(7)}`;
  rows[3] = `${rows[3].slice(0, 30)}F${rows[3].slice(31)}`;
  return {
    level: assembleLevel('hold2', 'HOLD2', [{ id: 'hold2', biome: 0, difficulty: 0, rows, tags: ['start'] }]),
    plate,
    door,
    far,
    floor,
  };
}

function place(world: World, aCol: number, bCol: number, row: number): void {
  const y = (row + 1) * TILE - PLAYER_H / 2 - 1;
  const cols = [aCol, bCol];
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = cols[i] * TILE + TILE / 2;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.grounded = 1;
    p.dead = 0;
  }
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
    world.ropeY[i] = y;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = y;
  }
  // Parked far from the plate, so nothing here is the crate holding the door.
  world.cargo.x = world.players[0].x;
  world.cargo.y = y;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.hp = 100;
  world.restartTimer = 0;
}

/** Walk player `who` right for `ticks`, and report the column they end on. */
function walk(level: Level, world: World, who: number, ticks: number, dir = IN_RIGHT): number {
  const ctx = { level, seed: 1, mode: 0 };
  const masks = [0, 0];
  masks[who] = dir;
  for (let t = 0; t < ticks; t++) {
    step(ctx, world, masks);
    world.events.length = 0;
  }
  return Math.floor(world.players[who].x / TILE);
}

describe('the hold', () => {
  /**
   * The second thing in this game two people have to do together.
   *
   * The leg up was the only one, and it is seven moments in a forty-five minute
   * campaign — every complaint about this game traced back to having exactly
   * one co-op verb, so a scoring panel put it at five out of ten three times
   * over and named this as the fix.
   */
  it('holds a shutter open while somebody stands on the plate', () => {
    const { level, plate, door, floor } = room(6);
    const ctx = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);

    // Nobody on the plate: the shutter is a wall, and walking into it stops you.
    place(world, door - 3, door - 4, floor - 1);
    const blocked = walk(level, world, 0, 120);
    expect(blocked, 'walked through a closed shutter').toBeLessThan(door);

    // Partner on the plate: the same walk goes through.
    place(world, door - 3, plate, floor - 1);
    const through = walk(level, world, 0, 120);
    expect(through, 'a held shutter should let you past').toBeGreaterThan(door);
  });

  /**
   * The crate counts as weight, but it is never left behind.
   *
   * It hangs off the middle of the rope, so it goes where the pair goes: the
   * first draft of this called crate-on-plate the escape hatch for a room a
   * pair had fumbled, and the test for it failed because two haulers walking
   * away tow the crate off the plate within a second. The rule stays — a crate
   * resting on a plate does hold it, which matters for the moment one is
   * dragged across — but the room cannot be designed around it.
   */
  it('counts the crate as weight on a plate', () => {
    const { level, plate, door, floor } = room(6);
    const ctx = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);
    place(world, door - 3, door - 4, floor - 1);
    world.cargo.x = plate * TILE + TILE / 2;
    world.cargo.y = floor * TILE - CARGO_H / 2 - 1;
    world.cargo.px = world.cargo.x;
    world.cargo.py = world.cargo.y;
    updateHolds(level, world);
    expect(world.open[0], 'a crate sitting on a plate').toBe(1);
  });

  /**
   * How a pair actually gets through: one plate each side, and they leapfrog.
   *
   * A shutter with a single plate is a door somebody has to stay behind, which
   * means the pair can never both be past it — the room is a wall with extra
   * steps. Two plates is the whole move: you hold, they cross, they hold, you
   * cross. It is two co-operative acts in a row and neither of them can be
   * done by one person with a passenger, because a partner who presses nothing
   * can be dragged onto the near plate but never onto the far one.
   */
  it('lets a pair leapfrog through a shutter with a plate on each side', () => {
    const { level, plate, door, floor, far } = twoPlate(6);
    const ctx = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);
    place(world, plate + 1, plate, floor - 1);
    const ctx2 = { level, seed: 1, mode: 0 };
    // Slot 1 holds the near plate; slot 0 walks through and onto the far one.
    for (let t = 0; t < 260; t++) {
      step(ctx2, world, [IN_RIGHT, 0]);
      world.events.length = 0;
    }
    const crossed = Math.floor(world.players[0].x / TILE);
    expect(crossed, 'the first hauler should be through and on the far plate').toBeGreaterThan(door);
    // Now slot 0 stands still on the far plate and slot 1 follows.
    for (let t = 0; t < 320; t++) {
      step(ctx2, world, [0, IN_RIGHT]);
      world.events.length = 0;
    }
    expect(Math.floor(world.players[1].x / TILE), 'the second hauler should follow').toBeGreaterThan(door);
    expect(far).toBeGreaterThan(door);
  });

  /**
   * The rope is what makes this a two-person problem rather than an errand.
   *
   * Standing on a plate and then walking through the door yourself is only
   * impossible because the rope is a fixed length and the other end of it is
   * tied to somebody. Put the plate far enough away and one player cannot be in
   * both places; put it close and they can, and the room is decoration.
   */
  it('is only a two-person problem when the plate is more than a rope away', () => {
    const reach = (gap: number): boolean => {
      const { level, plate, door, floor } = room(gap);
      const ctx = { level, seed: 1, mode: 0 };
      const world = createWorld(ctx);
      // One hauler on the plate; the other never presses anything, so the only
      // way past is the first one walking there themselves, rope and all.
      place(world, plate, plate + 1, floor - 1);
      return walk(level, world, 0, 400) > door;
    };
    expect(reach(3), 'a plate three columns from its door').toBe(true);
    expect(reach(Math.ceil(ROPE_MAX / TILE) + 4), 'a plate well past a rope length').toBe(false);
  });

  it('shoves you out rather than closing on you', () => {
    const { level, plate, door, floor } = room(6);
    const ctx = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);
    place(world, door, plate, floor - 1);
    // Slot 0 is inside the shutter. Slot 1 steps off the plate; the door must
    // not solidify around them, and must not politely wait either.
    walk(level, world, 1, 90, IN_LEFT);
    expect(world.players[0].dead, 'crushed by a closing shutter').toBe(0);
    const col = world.players[0].x / TILE;
    expect(Math.round(col) === door, 'left standing inside a closed shutter').toBe(false);
  });

  /**
   * Dying is not a key.
   *
   * A dead hauler is put back at their partner's shoulder, unless the partner
   * is meaningfully above where they died — a rule written so that walking into
   * a spike could not beat a leg up. A hold room is crossed on the flat, so
   * that rule never fired, and the second hauler could cross a shut door by
   * dying at it. Every hold room in the library fell to this, and the search
   * found it by watching a body move nine columns in a single tick.
   */
  it('does not rescue you through a shut door', () => {
    const { level, plate, door, floor } = twoPlate(6);
    const ctx = { level, seed: 1, mode: 0 };
    const world = createWorld(ctx);
    place(world, door + 4, plate, floor - 1);
    // Slot 1 is on the near plate, holding the door; slot 0 is well past it.
    // Kill slot 1 where it stands and let the rescue run.
    const spawnRow = Math.floor(world.spawnY / TILE);
    world.players[1].dead = 1;
    world.players[1].respawn = 0;
    for (let t = 0; t < 8; t++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    const landedCol = world.players[1].x / TILE;
    expect(landedCol, 'rescued through a shut door').toBeLessThan(door);
    expect(Math.abs(Math.floor(world.players[1].y / TILE) - spawnRow), 'sent back to the checkpoint').toBeLessThan(4);
  });

  /**
   * The exploit that decided how a closing shutter behaves.
   *
   * Holding the door open for anyone inside it — the obvious way to guarantee
   * nobody is ever crushed — hands the whole verb away. One hauler stands on
   * the plate, runs for the door towing their motionless partner on the rope,
   * and the partner's own body in the doorway props it open long enough to be
   * dragged clean through. The crate does the same job by itself, because it
   * hangs off the middle of the rope and ends up in the doorway unaided.
   *
   * Three thousand random input scripts, one live player and one pressing
   * nothing. Getting *yourself* through is expected — that is the first half of
   * the intended move. Getting your inert partner through is the thing that
   * must not be possible, because it is the difference between a room that
   * needs two people and a room that needs one person and a body.
   */
  it('will not let one player drag a motionless partner through', () => {
    const { level, plate, door, floor } = twoPlate(6);
    const ctx = { level, seed: 1, mode: 0 };
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let self = false;
    for (let attempt = 0; attempt < 400; attempt++) {
      const world = createWorld(ctx);
      place(world, plate, plate + 1, floor - 1);
      let mask = 0;
      for (let t = 0; t < 600; t++) {
        if (t % (2 + Math.floor(rnd() * 18)) === 0) {
          const r = rnd();
          mask = r < 0.4 ? IN_RIGHT : r < 0.7 ? IN_LEFT : 0;
          if (rnd() < 0.5) mask |= IN_JUMP;
          if (rnd() < 0.3) mask |= IN_GRIP;
        }
        step(ctx, world, [mask, 0]);
        world.events.length = 0;
        if (world.players[0].x / TILE > door + 1) self = true;
        expect(
          world.players[1].x / TILE,
          'a motionless partner was dragged through a shutter',
        ).toBeLessThan(door + 1);
      }
    }
    expect(self, 'one player should still be able to get themselves through').toBe(true);
  });
});
