import { describe, expect, it } from 'vitest';
import {
  Bot,
  GRIP_MAX,
  IN_JUMP,
  IN_LEFT,
  IN_RESTART,
  IN_RIGHT,
  LocalMatch,
  MAX_RISE,
  MODE_GAUNTLET,
  MODE_HAUL,
  PLAYER_H,
  REACH_BY_RISE,
  RESET_DELAY,
  RESTART_HOLD,
  ROPE_NODES,
  TILE,
  T_GOAL,
  T_PLATE,
  T_SHUTTER,
  analyseLevel,
  assembleLevel,
  boosting,
  buildCampaign,
  buildTower,
  createWorld,
  ledgeSteps,
  planRoute,
  step,
  BOOST_RISE_TILES,
  tileAt,
  type ChunkDef,
  type Level,
  type World,
} from '@haulmates/core';

/** Climb with two bots and report what they managed. */
function botRun(mode: number, seed: number, seconds: number, length = 10) {
  const match = new LocalMatch(mode, seed, length);
  const bots = [new Bot(match.ctx.level), new Bot(match.ctx.level)];
  match.setBot(0, bots[0]);
  match.setBot(1, bots[1]);
  const startY = match.world.players[0].y;
  let bestY = startY;
  for (let t = 0; t < seconds * 60; t++) {
    match.update(1000 / 60, [0, 0]);
    match.events.length = 0;
    bestY = Math.min(bestY, match.world.players[0].y, match.world.players[1].y);
    if (match.world.finished) break;
  }
  return {
    world: match.world,
    bots,
    cursor: Math.max(bots[0].cursor, bots[1].cursor),
    climbedTiles: (startY - bestY) / TILE,
  };
}

/**
 * A corridor with a shutter across it and a plate on each side of the door.
 *
 * The plates sit six columns back from the door because that is the geometry
 * that makes the room a two-person problem. Put a plate a tile or two from its
 * door and a pair walking in convoy hold it for each other without meaning to —
 * half the rooms in the library can be crossed that way, and a bot crossing one
 * of those has demonstrated nothing except that it can walk. Nine columns plate
 * to plate is the other half of it: that is inside the rope, so the leapfrog is
 * available, and a hauler on one plate is not within reach of the other.
 */
function holdRoom(): Level {
  const w = 40;
  const h = 16;
  const floor = h - 3;
  const rows: string[] = [];
  for (let r = 0; r < h; r++) {
    let s = '';
    for (let c = 0; c < w; c++) {
      if (c < 2 || c >= w - 2) s += '#';
      else if (r === floor) s += c === 6 || c === 15 ? '_' : '#';
      else if (r > floor - 6 && r < floor && (c === 12 || c === 13)) s += 'H';
      else if (r <= 1) s += '#';
      else s += '.';
    }
    rows.push(s);
  }
  const put = (r: number, c: number, glyph: string): void => {
    rows[r] = rows[r].slice(0, c) + glyph + rows[r].slice(c + 1);
  };
  put(floor - 1, 3, 'S');
  put(floor - 1, 25, 'F');
  return assembleLevel('room', 'ROOM', [{ id: 'room', biome: 0, difficulty: 0, rows, tags: ['start'] }]);
}

/** Stand the pair on a row, with the rope and the crate laid out between them. */
function standPair(world: World, cols: number[], row: number): void {
  const y = (row + 1) * TILE - PLAYER_H / 2 - 1;
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = cols[i] * TILE + TILE / 2;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.grounded = 1;
    p.dead = 0;
    p.grip = GRIP_MAX;
  }
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
    world.ropeY[i] = y;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = y;
  }
  world.cargo.x = (world.players[0].x + world.players[1].x) / 2;
  world.cargo.y = y;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.hp = 100;
  world.restartTimer = 0;
}

/**
 * Every hold room the route goes through, read the way the level verifier reads
 * them: the fill hands back the cells it could only reach through a door, and
 * each one names its room and sits on the far side of it, which is where the
 * way through comes from.
 */
function holdRooms(level: Level): { door: number[]; plates: { x: number; y: number }[]; exit: number }[] {
  const { w } = level;
  const out: { group: number; door: number[]; plates: { x: number; y: number }[]; exit: number }[] = [];
  for (const hold of analyseLevel(level, { coop: true }).holds) {
    if (out.some((r) => r.group === hold.group)) continue;
    const room = { group: hold.group, door: [w, -1], plates: [] as { x: number; y: number }[], exit: 1 };
    for (let i = 0; i < level.tiles.length; i++) {
      if (level.holdGroup[i] !== hold.group) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (level.tiles[i] === T_SHUTTER) {
        room.door[0] = Math.min(room.door[0], x);
        room.door[1] = Math.max(room.door[1], x);
      } else if (level.tiles[i] === T_PLATE) {
        room.plates.push({ x, y: y - 1 });
      }
    }
    room.exit = hold.x > room.door[1] ? 1 : -1;
    out.push(room);
  }
  return out;
}

/** The steps on the route with the middle foothold taken out. */
function gatesOf(level: Level): { from: { y: number; x0: number; x1: number }; to: { y: number; x0: number; x1: number } }[] {
  const { route, standable } = analyseLevel(level, { coop: true });
  return ledgeSteps(level, route, standable).filter((s) => s.from.y - s.to.y > MAX_RISE);
}

/**
 * A gate is the one place in the game where two identical haulers cannot both
 * do the right thing.
 *
 * `resolveBoosts` refuses to make a platform of anybody shoving off themselves
 * on the same tick, so a pair who both take the offer both get an ordinary
 * jump and both land back where they started — and two bots reading the same
 * world reach that state together. Measured over twenty seconds under each of
 * the 92 gates on the campaign and two towers: 1084 ticks in which each of them
 * was standing on the other's braced shoulders, and both of them pressed JUMP
 * on all 1084, for 86 boosts and a lot of standing about.
 *
 * The six gates below scored 143 of 143 wasted, and the pair got up four of
 * the six inside forty seconds apiece. They get up all six now.
 */
describe('two bots at a gate', () => {
  it('never spends both haulers on the same boost', () => {
    const level = buildCampaign();
    // A handful, not all of them: the standoff is the same shape at every gate
    // and each one costs forty seconds of simulation to fail.
    const gates = gatesOf(level).slice(0, 6);
    expect(gates.length, 'gates on the campaign route').toBeGreaterThanOrEqual(4);
    const ctx = { level, seed: 1, mode: MODE_HAUL };
    let braced = 0;
    let wasted = 0;
    let crossed = 0;
    for (const gate of gates) {
      const world = createWorld(ctx);
      const bots = [new Bot(level), new Bot(level)];
      const col = Math.min(gate.from.x1, Math.max(gate.from.x0, Math.round((gate.to.x0 + gate.to.x1) / 2)));
      standPair(world, [col, Math.min(gate.from.x1, col + 1)], gate.from.y);
      for (let t = 0; t < 40 * 60; t++) {
        const masks = [bots[0].think(world, 0), bots[1].think(world, 1)];
        if (boosting(world, 0) && boosting(world, 1)) {
          braced++;
          if ((masks[0] & IN_JUMP) !== 0 && (masks[1] & IN_JUMP) !== 0) wasted++;
        }
        step(ctx, world, masks);
        world.events.length = 0;
        const up = world.players.every(
          (p) => !p.dead && p.grounded === 1 && Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1 <= gate.to.y,
        );
        if (up) {
          crossed++;
          break;
        }
      }
    }
    // The pair have to actually get into the standoff for the count to mean
    // anything: zero wasted boosts out of zero offers is what the broken build
    // would score if the bots never lined up at all.
    expect(braced, 'ticks with each hauler braced beside the other').toBeGreaterThan(0);
    expect(wasted, 'ticks both of them took the same boost').toBe(0);
    expect(crossed, 'gates a bot pair got up').toBeGreaterThanOrEqual(gates.length - 2);
  }, 120_000);
});

describe('the hold', () => {
  /**
   * The second thing in this game two people have to do together, played by
   * two bots.
   *
   * Nothing about this room is optional for the bot: a shutter is the only wall
   * in the game that opens because somebody is standing somewhere else, so a
   * bot that treats it as scenery walks into it and stays there. Measured
   * before the bot knew the verb: the pair spent the minute shuffling either
   * side of the door and finished nine columns behind where they started.
   */
  it('leapfrogs a shutter neither hauler could cross alone', () => {
    const level = holdRoom();
    const ctx = { level, seed: 1, mode: MODE_HAUL };
    const world = createWorld(ctx);
    const bots = [new Bot(level), new Bot(level)];
    let finished = -1;
    for (let t = 0; t < 60 * 60 && finished < 0; t++) {
      step(ctx, world, [bots[0].think(world, 0), bots[1].think(world, 1)]);
      world.events.length = 0;
      if (world.finished) finished = t;
    }
    // Measured at 624 ticks of the 3600 allowed. The bar is the whole minute
    // because the crossing is two co-operative acts either of which can be
    // fumbled and retried, and a tight bound would be measuring the retry.
    expect(finished, 'the pair should hold the door for each other and reach the goal').toBeGreaterThan(0);
  });

  /**
   * A shutter is a wall to one hauler, and the bot has to be the half of the
   * pair that knows it.
   *
   * Nobody presses anything in slot zero here. The bot cannot cross — that is
   * the design of the room — so the useful thing it can do is take the plate
   * and hold the door open, which is what a person on the other end of the
   * controller needs it to do.
   */
  it('takes the plate and holds the door for a partner who is not helping', () => {
    const level = holdRoom();
    const ctx = { level, seed: 1, mode: MODE_HAUL };
    const world = createWorld(ctx);
    const bot = new Bot(level);
    // The bot's own weight on the plate, not the door being open: the crate
    // hangs off the middle of the rope and ends up parked on a plate all by
    // itself, which opens the door and proves nothing about the bot.
    let onPlate = 0;
    for (let t = 0; t < 30 * 60; t++) {
      step(ctx, world, [0, bot.think(world, 1)]);
      world.events.length = 0;
      const p = world.players[1];
      if (Math.floor(p.x / TILE) === 6 && p.grounded === 1) onPlate++;
    }
    // Most of the run, and deliberately not all of it: every wait in this bot
    // is bounded, and this one most of all. A hold with no timeout is a
    // deadlock waiting for a partner who never obliges, and a hauler stood on a
    // plate looks exactly like one doing the right thing — so it lets go every
    // ten seconds, plays the route for two, and comes back to the plate.
    expect(onPlate / (30 * 60), 'fraction of the run spent standing on the plate').toBeGreaterThan(0.5);
    expect(onPlate, 'a hold that never lets go is a deadlock').toBeLessThan(30 * 60);
    expect(world.cargo.hp, 'and it does not wreck the crate while it waits').toBeGreaterThan(90);
  });

  /**
   * The same thing on the rooms that ship, in both directions.
   *
   * The library builds them either way round — the tower is a serpentine, so
   * half of its doors are crossed leftwards — and a bot that had quietly
   * assumed the exit was to its right would pass every hand-made test in here
   * and stand still in front of two of the campaign's four rooms.
   */
  it('crosses every hold room in the campaign', () => {
    const level = buildCampaign();
    const ctx = { level, seed: 7, mode: MODE_HAUL };
    const rooms = holdRooms(level);
    expect(rooms.length, 'hold rooms on the campaign route').toBeGreaterThan(0);
    for (const room of rooms) {
      const world = createWorld(ctx);
      const bots = [new Bot(level), new Bot(level)];
      // Both haulers on the near side, a body clear of the plate so that
      // arriving already standing on it is not what proves the crossing.
      const near = room.plates
        .filter((p) => (room.exit > 0 ? p.x < room.door[0] : p.x > room.door[1]))
        .sort((a, b) => (room.exit > 0 ? b.x - a.x : a.x - b.x))[0];
      standPair(world, [near.x - room.exit * 2, near.x - room.exit * 4], near.y);
      let through = -1;
      for (let t = 0; t < 60 * 60 && through < 0; t++) {
        step(ctx, world, [bots[0].think(world, 0), bots[1].think(world, 1)]);
        world.events.length = 0;
        const past = world.players.filter(
          (p) => (room.exit > 0 ? p.x > (room.door[1] + 1) * TILE : p.x < room.door[0] * TILE),
        );
        if (past.length === 2) through = t;
      }
      // Measured between 1.2 and 4.0 seconds a room.
      expect(through, `both haulers through the door at cols ${room.door.join('-')}`).toBeGreaterThan(0);
    }
  });
});

describe('route planning', () => {
  it('finds a route from the spawn to the goal of the campaign', () => {
    const plan = planRoute(buildCampaign());
    expect(plan.ok).toBe(true);
    expect(plan.cells.length).toBeGreaterThan(100);
  });

  it('only links cells the measured movement envelope can actually link', () => {
    const level = buildCampaign();
    const { route, gates } = analyseLevel(level, { coop: true });
    const gated = new Set(gates.map((g) => `${g.x},${g.y}`));
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1];
      const to = route[i];
      const rise = from.y - to.y;
      const run = Math.abs(to.x - from.x);
      if (rise <= 0) continue; // falling and walking are unbounded sideways
      // A gate is a two-person move and is deliberately outside one hauler's
      // envelope; that is the whole point of it.
      if (gated.has(`${to.x},${to.y}`)) {
        expect(rise).toBeLessThanOrEqual(BOOST_RISE_TILES);
        continue;
      }
      expect(rise).toBeLessThanOrEqual(MAX_RISE);
      expect(run).toBeLessThanOrEqual(REACH_BY_RISE[rise]);
    }
  });

  it('ends within touching distance of a goal tile', () => {
    const level = buildCampaign();
    const { route } = analyseLevel(level, { coop: true });
    const last = route[route.length - 1];
    let touching = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (tileAt(level, last.x + dx, last.y + dy) === T_GOAL) touching = true;
      }
    }
    expect(touching).toBe(true);
  });

  it('indexes every route cell for the follower to locate itself by', () => {
    const level = buildTower(4242, 5);
    const plan = planRoute(level);
    for (let i = 0; i < plan.cells.length; i++) {
      const c = plan.cells[i];
      expect(plan.indexAt[c.y * plan.w + c.x]).toBe(i);
    }
  });
});

describe('the bot partner', () => {
  it('climbs the campaign rather than milling around the first ledge', () => {
    const run = botRun(MODE_HAUL, 7, 60);
    // Measured around 39 tiles and route cell 15 at the time of writing. The
    // bar is set low enough to survive tuning and high enough that any of the
    // failure modes this bot was built to fix — jumping from a standstill,
    // treating a stroll as a leap, bonking on the ledge it is climbing —
    // would trip it. Those all left it inside three tiles of the spawn.
    expect(run.climbedTiles).toBeGreaterThan(22);
    expect(run.cursor).toBeGreaterThan(9);
  });

  it('reaches a checkpoint unattended', () => {
    const run = botRun(MODE_HAUL, 7, 90);
    expect(run.world.checkpoint).toBeGreaterThanOrEqual(0);
  });

  it('climbs a generated tower it has never seen', () => {
    for (const seed of [11, 33]) {
      const run = botRun(MODE_GAUNTLET, seed, 120, 6);
      expect(run.climbedTiles).toBeGreaterThan(22);
    }
  });

  it('uses the rope verbs rather than only walking and jumping', () => {
    // Counted across several towers, not one.
    //
    // Reeling is situational — it only happens when the bot is genuinely
    // stranded below its partner on a taut rope — and how often a level puts
    // it in that position varies wildly with the level's shape. Measured over
    // two minutes each: 107 reels on two of these towers and 2 on the other
    // three, from the same bot with the same logic. A bar on any single level
    // is measuring that level; a bar on the sum is measuring the bot.
    let grips = 0;
    let reels = 0;
    for (const [mode, seed] of [
      [MODE_HAUL, 7],
      [MODE_GAUNTLET, 33],
      [MODE_GAUNTLET, 101],
      [MODE_GAUNTLET, 555],
      [MODE_GAUNTLET, 11],
    ] as const) {
      const match = new LocalMatch(mode, seed, 10);
      match.setBot(0, new Bot(match.ctx.level));
      match.setBot(1, new Bot(match.ctx.level));
      // Two minutes each, not one: reeling is back-loaded — it needs the pair
      // to have got themselves into trouble first. Halving the run took the
      // count from 220 to 14.
      for (let t = 0; t < 120 * 60; t++) {
        match.update(1000 / 60, [0, 0]);
        for (const e of match.events) {
          if (e.kind === 9) grips++;
          if (e.kind === 17) reels++;
        }
        match.events.length = 0;
      }
    }
    // Bracing is constant; reeling is rare and clustered. Both bars are set
    // well below what was measured, because a tight one measures the physics
    // tuning rather than the bot — a single collision fix once moved the reel
    // count from 113 to 19 without touching a line of the bot's own logic.
    // Measured at 398 and 220.
    expect(grips, 'grips across five towers').toBeGreaterThan(120);
    expect(reels, 'reels across five towers').toBeGreaterThan(50);
  });

  it('does not vibrate on the spot', () => {
    // The route cursor used to be re-derived from the body cell on every
    // grounded tick. Standing between two route cells, a pixel of drift
    // flipped which one was nearest; the two had launch columns on opposite
    // sides; and the bot alternated LEFT and RIGHT twenty-nine times a second
    // without ever falling over or getting anywhere. It never failed a test —
    // it just looked broken to anyone watching it for five seconds.
    const match = new LocalMatch(MODE_HAUL, 12345, 10);
    const bots = [new Bot(match.ctx.level), new Bot(match.ctx.level)];
    match.setBot(0, bots[0]);
    match.setBot(1, bots[1]);

    const last = [0, 0];
    const reversals = [0, 0];
    for (const i of [0, 1]) {
      const think = bots[i].think.bind(bots[i]);
      bots[i].think = (world, index): number => {
        const mask = think(world, index);
        const dir = mask & IN_LEFT ? -1 : mask & IN_RIGHT ? 1 : 0;
        if (dir !== 0 && last[index] !== 0 && dir !== last[index]) reversals[index]++;
        if (dir !== 0) last[index] = dir;
        return mask;
      };
    }

    const seconds = 90;
    for (let t = 0; t < seconds * 60; t++) {
      match.update(1000 / 60, [0, 0]);
      match.events.length = 0;
    }
    // Measured on this exact run: 13.6 and 23.3 reversals per second before
    // the cursor was made monotonic, 2.8 and 10.8 after. The bar sits between
    // them with margin on both sides, because the system is chaotic enough
    // that a tight bar would be a flaky test rather than a strict one.
    //
    // Note what this does not claim: the bot still fidgets while it waits, at
    // roughly ten direction changes a second. That is a visible twitch, not a
    // deadlock, and two attempts at widening the idle deadzone to remove it
    // each halved how far the pair climbed — so it stands, measured and known,
    // rather than traded for progress.
    for (const i of [0, 1]) {
      expect(reversals[i] / seconds, `bot ${i} reversals per second`).toBeLessThan(18);
    }
  });

  it('waits for a partner who is not moving instead of dragging them', () => {
    const match = new LocalMatch(MODE_HAUL, 3, 10);
    match.setBot(1, new Bot(match.ctx.level));
    const startX = match.world.players[0].x;
    const startY = match.world.players[0].y;
    for (let t = 0; t < 60 * 60; t++) {
      match.update(1000 / 60, [0, 0]);
      match.events.length = 0;
    }
    const idle = match.world.players[0];
    expect(Math.abs(idle.x - startX) / TILE).toBeLessThan(3);
    expect(Math.abs(idle.y - startY) / TILE).toBeLessThan(2);
    // And it does not wreck the crate out of boredom.
    expect(match.world.cargo.hp).toBeGreaterThan(90);
    expect(match.world.cargoBreaks).toBe(0);
  });

  it('never presses restart, and never emits an input the protocol cannot carry', () => {
    const match = new LocalMatch(MODE_HAUL, 5, 10);
    const bot = new Bot(match.ctx.level);
    match.setBot(1, bot);
    const think = bot.think.bind(bot);
    let restarts = 0;
    let malformed = 0;
    bot.think = (world, index): number => {
      const mask = think(world, index);
      if (mask & IN_RESTART) restarts++;
      if (!Number.isInteger(mask) || mask < 0 || mask > 255) malformed++;
      return mask;
    };
    for (let t = 0; t < 60 * 60; t++) {
      match.update(1000 / 60, [0, 0]);
      match.events.length = 0;
    }
    expect(restarts).toBe(0);
    expect(malformed).toBe(0);
  });

  /**
   * The bot abstaining from the restart vote is the same thing as blocking it,
   * unless its slot echoes the person holding the key. Without the echo the
   * HUD asked a solo player to hold a key that could never be enough, and a
   * wedged crate meant abandoning the run.
   */
  it('lets a solo player restart at the checkpoint on their own', () => {
    const match = new LocalMatch(MODE_HAUL, 7, 10);
    match.setBot(1, new Bot(match.ctx.level));
    // Get off the spawn tile first, or arriving back at it proves nothing.
    for (let t = 0; t < 120; t++) match.update(1000 / 60, [IN_RIGHT, 0]);
    match.events.length = 0;
    expect(Math.abs(match.world.players[0].x - match.world.spawnX) / TILE).toBeGreaterThan(1);

    for (let t = 0; t < RESTART_HOLD; t++) match.update(1000 / 60, [IN_RESTART, 0]);
    expect(match.world.restartTimer).toBeGreaterThan(0);

    for (let t = 0; t < RESET_DELAY + 1; t++) match.update(1000 / 60, [0, 0]);
    for (const p of match.world.players) {
      expect(Math.abs(p.x - match.world.spawnX) / TILE).toBeLessThan(2);
      expect(Math.abs(p.y - match.world.spawnY) / TILE).toBeLessThan(2);
    }
  });

  it('never lets one person on the sofa cast the other one’s restart vote', () => {
    const match = new LocalMatch(MODE_HAUL, 7, 10);
    for (let t = 0; t < RESTART_HOLD * 2; t++) match.update(1000 / 60, [IN_RESTART, 0]);
    expect(match.world.restartTimer).toBe(0);
    expect(match.world.players[1].restartHeld).toBe(0);
  });

  it('restarts at the checkpoint when the pause menu asks, without a key held', () => {
    const match = new LocalMatch(MODE_HAUL, 7, 10);
    match.setBot(1, new Bot(match.ctx.level));
    for (let t = 0; t < 120; t++) match.update(1000 / 60, [IN_RIGHT, 0]);
    match.resetToCheckpoint();
    for (let t = 0; t < RESTART_HOLD + RESET_DELAY + 1; t++) match.update(1000 / 60, [0, 0]);
    for (const p of match.world.players) {
      expect(Math.abs(p.x - match.world.spawnX) / TILE).toBeLessThan(2);
      expect(Math.abs(p.y - match.world.spawnY) / TILE).toBeLessThan(2);
    }
  });

  it('does not throw on a level whose goal cannot be reached', () => {
    // A perfectly good floor to stand on, and a goal entombed in the rock
    // beneath it. Nothing the flood fill can reach is next to the finish.
    const rows = [
      '########################################',
      '#......................................#',
      '#.S....................................#',
      '########################################',
      '###################F####################',
      '########################################',
    ];
    const chunk: ChunkDef = { id: 'sealed', biome: 0, difficulty: 0, rows };
    const level = assembleLevel('sealed', 'SEALED', [chunk]);
    expect(planRoute(level).ok).toBe(false);
    const bot = new Bot(level);
    expect(bot.ready).toBe(false);

    // It still has to produce sane input rather than crash the frame loop.
    const match = new LocalMatch(MODE_HAUL, 1, 1);
    for (let t = 0; t < 240; t++) {
      const mask = bot.think(match.world, 1);
      expect(Number.isInteger(mask)).toBe(true);
      expect(mask).toBeGreaterThanOrEqual(0);
      expect(mask).toBeLessThanOrEqual(255);
    }
  });
});
