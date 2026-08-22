import { describe, expect, it } from 'vitest';
import {
  Bot,
  DAILY_FLOORS,
  LocalMatch,
  MODE_GAUNTLET,
  MODE_HAUL,
  buildTower,
  dailyDay,
  dailyLabel,
  dailySeed,
  towerId,
} from '@haulmates/core';

/** A day far enough from any boundary that the test never straddles one. */
const DAY = dailyDay(Date.UTC(2026, 7, 21, 12, 0, 0));

describe('the daily haul', () => {
  it('gives everybody the same tower on the same day', () => {
    const day = dailyDay(Date.UTC(2026, 7, 21, 3, 0, 0));
    const a = buildTower(dailySeed(day), DAILY_FLOORS);
    const b = buildTower(dailySeed(day), DAILY_FLOORS);
    expect(a.h).toBe(b.h);
    expect(a.tiles).toEqual(b.tiles);
  });

  it('holds one tower for a whole UTC day and then changes it', () => {
    const dawn = dailyDay(Date.UTC(2026, 7, 21, 0, 0, 1));
    const dusk = dailyDay(Date.UTC(2026, 7, 21, 23, 59, 59));
    const tomorrow = dailyDay(Date.UTC(2026, 7, 22, 0, 0, 1));
    expect(dawn).toBe(dusk);
    expect(tomorrow).toBe(dawn + 1);
    expect(dailySeed(dawn)).not.toBe(dailySeed(tomorrow));
  });

  it('does not let consecutive days produce similar seeds', () => {
    // `day` increments by one, so a seed derived from it too directly would
    // walk through the generator's state in lockstep and hand out towers that
    // felt like yesterday's with one chunk moved.
    const base = dailyDay(Date.UTC(2026, 0, 1));
    const seeds = new Set<number>();
    for (let i = 0; i < 400; i++) seeds.add(dailySeed(base + i));
    expect(seeds.size).toBe(400);
    for (let i = 1; i < 400; i++) {
      expect(Math.abs(dailySeed(base + i) - dailySeed(base + i - 1))).toBeGreaterThan(1000);
    }
  });

  it('always produces a positive seed, including before 1970', () => {
    for (const day of [-20000, -1, 0, 1, 20000, 100000]) {
      expect(dailySeed(day)).toBeGreaterThanOrEqual(0);
    }
  });

  it('names the day in UTC', () => {
    expect(dailyLabel(dailyDay(Date.UTC(2026, 7, 21, 23, 30)))).toBe('21 August 2026');
  });
});

describe('playing it again', () => {
  it('names a tower by the seed and the height that made it', () => {
    // The id is how a run answers "am I still on today's tower" after a
    // restart, so it has to change with either half of what defines one.
    expect(buildTower(dailySeed(DAY), DAILY_FLOORS).id).toBe(towerId(dailySeed(DAY), DAILY_FLOORS));
    expect(towerId(dailySeed(DAY), DAILY_FLOORS)).not.toBe(towerId(dailySeed(DAY + 1), DAILY_FLOORS));
    expect(towerId(dailySeed(DAY), DAILY_FLOORS)).not.toBe(towerId(dailySeed(DAY), DAILY_FLOORS + 1));
  });

  it('is still today’s tower after a restart on its own seed', () => {
    const match = new LocalMatch(MODE_GAUNTLET, dailySeed(DAY), DAILY_FLOORS);
    const before = match.ctx.level;
    match.restart();
    expect(match.ctx.level).toBe(before);
    expect(match.ctx.level.id).toBe(towerId(dailySeed(DAY), DAILY_FLOORS));
    expect(match.world.tick).toBe(0);
  });

  it('assembles a different tower when a restart reseeds, not the same one twice', () => {
    const match = new LocalMatch(MODE_GAUNTLET, 1234, 8);
    const before = match.ctx.level;
    match.restart(5678);
    expect(match.ctx.seed).toBe(5678);
    expect(match.ctx.level.id).toBe(towerId(5678, 8));
    expect(match.ctx.level.tiles).not.toEqual(before.tiles);
  });

  it('leaves the campaign alone, because it is one tower on purpose', () => {
    const match = new LocalMatch(MODE_HAUL, 99, 10);
    const before = match.ctx.level;
    match.restart();
    expect(match.ctx.level).toBe(before);
  });

  it('re-plans a bot against the tower it now has to climb', () => {
    // The route is planned once, at construction, against the level handed
    // over. A bot left holding the old plan walks the previous tower's path
    // through the new one and gets nowhere.
    const match = new LocalMatch(MODE_GAUNTLET, 1234, 8);
    match.setBot(1, new Bot(match.ctx.level));
    match.restart(5678);
    expect(match.bots[1]).not.toBeNull();
    expect(match.bots[1]!.level).toBe(match.ctx.level);
    expect(match.bots[1]!.ready).toBe(true);
  });
});
