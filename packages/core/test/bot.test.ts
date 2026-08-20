import { describe, expect, it } from 'vitest';
import {
  Bot,
  IN_RESTART,
  LocalMatch,
  MAX_RISE,
  MODE_GAUNTLET,
  MODE_HAUL,
  REACH_BY_RISE,
  TILE,
  T_GOAL,
  analyseLevel,
  assembleLevel,
  buildCampaign,
  buildTower,
  planRoute,
  tileAt,
  type ChunkDef,
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

describe('route planning', () => {
  it('finds a route from the spawn to the goal of the campaign', () => {
    const plan = planRoute(buildCampaign());
    expect(plan.ok).toBe(true);
    expect(plan.cells.length).toBeGreaterThan(100);
  });

  it('only links cells the measured movement envelope can actually link', () => {
    const level = buildCampaign();
    const { route } = analyseLevel(level);
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1];
      const to = route[i];
      const rise = from.y - to.y;
      const run = Math.abs(to.x - from.x);
      if (rise <= 0) continue; // falling and walking are unbounded sideways
      expect(rise).toBeLessThanOrEqual(MAX_RISE);
      expect(run).toBeLessThanOrEqual(REACH_BY_RISE[rise]);
    }
  });

  it('ends within touching distance of a goal tile', () => {
    const level = buildCampaign();
    const { route } = analyseLevel(level);
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
    const match = new LocalMatch(MODE_HAUL, 7, 10);
    const bots = [new Bot(match.ctx.level), new Bot(match.ctx.level)];
    match.setBot(0, bots[0]);
    match.setBot(1, bots[1]);
    let grips = 0;
    let reels = 0;
    for (let t = 0; t < 120 * 60; t++) {
      match.update(1000 / 60, [0, 0]);
      for (const e of match.events) {
        if (e.kind === 9) grips++;
        if (e.kind === 17) reels++;
      }
      match.events.length = 0;
    }
    expect(grips).toBeGreaterThan(20);
    expect(reels).toBeGreaterThan(20);
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
