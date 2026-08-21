import { describe, expect, it } from 'vitest';
import { DAILY_FLOORS, buildTower, dailyDay, dailyLabel, dailySeed } from '@haulmates/core';

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
