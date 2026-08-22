import { describe, expect, it } from 'vitest';
import {
  Bot,
  IN_LEFT,
  IN_RESTART,
  IN_RIGHT,
  LocalMatch,
  MAX_RISE,
  MODE_GAUNTLET,
  MODE_HAUL,
  REACH_BY_RISE,
  RESET_DELAY,
  RESTART_HOLD,
  TILE,
  T_GOAL,
  analyseLevel,
  assembleLevel,
  buildCampaign,
  buildTower,
  planRoute,
  BOOST_RISE_TILES,
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
