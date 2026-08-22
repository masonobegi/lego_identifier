import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyLabel, dailyRef } from '@haulmates/core';
import type { DailyRecord } from '../src/settings.js';

/**
 * The save file as the storage layer sees it. settings.ts reads its default
 * server address at import time, so the stub goes up before the module is
 * pulled in — the same reason `settings.test.ts` loads it the same way.
 */
let saved: Record<string, string>;

beforeEach(() => {
  saved = {};
  (globalThis as { window?: unknown }).window = {
    HAULMATES_SERVER: 'ws://test',
    matchMedia: () => ({ matches: false }),
    haulmates: {
      readSave: (key: string): string | null => saved[key] ?? null,
      writeSave: (key: string, value: string): void => {
        saved[key] = value;
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

async function settings(): Promise<typeof import('../src/settings.js')> {
  return import('../src/settings.js');
}

async function docket(): Promise<typeof import('../src/docket.js')> {
  return import('../src/docket.js');
}

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return { day: 0, bestTicks: 0, bestCheckpoints: 0, attempts: 0, streak: 0, history: [], ...over };
}

/** A day number far enough from the epoch to read like a real one. */
const TODAY = 20686;

/**
 * The fourth evening is the one that decides whether this was worth buying,
 * and one day of memory cannot tell it apart from the first. These are the
 * days themselves: what gets filed, what gets dropped, and what a save written
 * before any of it existed gets handed back.
 */
describe('the daily history', () => {
  it('files the open day and opens a clean one', async () => {
    const { openDaily } = await settings();
    const d = openDaily(record({ day: TODAY - 1, bestTicks: 900, bestCheckpoints: 7, attempts: 3 }), TODAY);
    expect(d.day).toBe(TODAY);
    expect(d.attempts, 'today has not been tried yet').toBe(0);
    expect(d.bestTicks).toBe(0);
    expect(d.history).toEqual([{ day: TODAY - 1, ticks: 900, checkpoints: 7, attempts: 3 }]);
  });

  it('leaves the day alone when it is already open', async () => {
    const { openDaily } = await settings();
    const open = record({ day: TODAY, bestCheckpoints: 4, attempts: 2 });
    expect(openDaily(open, TODAY), 'rolling over twice would wipe the evening').toBe(open);
  });

  it('does not file an evening nobody played', async () => {
    const { openDaily } = await settings();
    const d = openDaily(record({ day: TODAY - 1, attempts: 0 }), TODAY);
    expect(d.history).toEqual([]);
  });

  it('keeps a fortnight and drops what falls off the back', async () => {
    const { DAILY_HISTORY, openDaily } = await settings();
    let d = record({ day: TODAY - 40, attempts: 1, bestCheckpoints: 1 });
    for (let day = TODAY - 39; day <= TODAY; day++) {
      d = openDaily(d, day);
      d.attempts++;
      d.bestCheckpoints = 2;
    }
    expect(d.history).toHaveLength(DAILY_HISTORY - 1);
    expect(d.history[0].day, 'oldest first').toBe(TODAY - DAILY_HISTORY + 1);
    expect(d.history[d.history.length - 1].day).toBe(TODAY - 1);
  });

  it('counts days running, and stops counting after a gap', async () => {
    const { openDaily } = await settings();
    let d = record({ day: TODAY - 3, attempts: 1, streak: 1 });
    d = openDaily(d, TODAY - 2);
    d.attempts++;
    expect(d.streak).toBe(2);
    d = openDaily(d, TODAY);
    d.attempts++;
    expect(d.streak, 'the missed day ends it').toBe(1);
  });

  /**
   * Saves already exist in the wild, written by a build whose daily record was
   * one day wide. A strip drawn from `undefined` is a crash on the title
   * screen, which is the first thing such a player would see.
   */
  it('survives a save written before the history existed', async () => {
    const { DEFAULT_PROFILE, PROFILE_STATS_KEY, loadProfile } = await settings();
    const stored = {
      ...DEFAULT_PROFILE,
      daily: { day: TODAY - 1, bestTicks: 1200, bestCheckpoints: 9, attempts: 4, streak: 6 },
    };
    saved[PROFILE_STATS_KEY] = JSON.stringify(stored);
    const p = loadProfile();
    expect(p.daily.history).toEqual([]);
    expect(p.daily.streak, 'what the old save did know is kept').toBe(6);
    expect(p.daily.bestTicks).toBe(1200);
  });

  it('never hands a profile the array the defaults are holding', async () => {
    const { DEFAULT_PROFILE, loadProfile } = await settings();
    const p = loadProfile();
    p.daily.history.push({ day: TODAY, ticks: 0, checkpoints: 1, attempts: 1 });
    expect(DEFAULT_PROFILE.daily.history, 'the first day filed would land in the defaults').toEqual([]);
    expect(loadProfile().daily.history).toEqual([]);
  });
});

/**
 * The picture. Its whole worth is that it is small, honest and yours, so what
 * it must never do is show a day that did not happen or hide one that did.
 */
describe('the strip', () => {
  it('is a fortnight long and ends tonight', async () => {
    const { DAILY_HISTORY } = await settings();
    const { dailyStrip } = await docket();
    const boxes = dailyStrip(record({ day: TODAY }), TODAY);
    expect(boxes).toHaveLength(DAILY_HISTORY);
    expect(boxes[boxes.length - 1].day).toBe(TODAY);
    expect(boxes[0].day).toBe(TODAY - DAILY_HISTORY + 1);
  });

  it('draws tonight before anything has filed it', async () => {
    const { dailyStrip } = await docket();
    const open = record({ day: TODAY, bestCheckpoints: 5, attempts: 2 });
    expect(dailyStrip(open, TODAY).at(-1)).toMatchObject({ mark: 'climbed', checkpoints: 5, attempts: 2 });
    open.bestTicks = 3600;
    expect(dailyStrip(open, TODAY).at(-1)).toMatchObject({ mark: 'delivered', ticks: 3600 });
  });

  it('marks a day nobody played as missed, and says so out loud', async () => {
    const { boxLabel, dailyStrip } = await docket();
    const boxes = dailyStrip(record({ day: TODAY }), TODAY);
    expect(boxes.every((b) => b.mark === 'missed')).toBe(true);
    expect(boxLabel(boxes[0])).toBe(`${dailyLabel(TODAY - 13)} — not attempted`);
  });

  it('is fourteen characters of ink when it is pasted', async () => {
    const { dailyStrip, stripLine } = await docket();
    const d = record({
      day: TODAY,
      bestTicks: 600,
      attempts: 1,
      history: [
        { day: TODAY - 2, ticks: 0, checkpoints: 3, attempts: 2 },
        { day: TODAY - 1, ticks: 900, checkpoints: 9, attempts: 1 },
      ],
    });
    const line = stripLine(dailyStrip(d, TODAY));
    expect(line).toHaveLength(14);
    expect(line).toBe('...........+##');
    expect(line, 'no emoji anywhere near this').toMatch(/^[#+.]+$/);
  });

  it('keeps counting the run of days while tonight is still young', async () => {
    const { dailyStrip, stripTally } = await docket();
    const history = [
      { day: TODAY - 3, ticks: 0, checkpoints: 2, attempts: 1 },
      { day: TODAY - 2, ticks: 700, checkpoints: 9, attempts: 1 },
      { day: TODAY - 1, ticks: 800, checkpoints: 9, attempts: 1 },
    ];
    const waiting = stripTally(dailyStrip(record({ day: TODAY, history }), TODAY));
    expect(waiting.running, 'not played today, and not yet broken').toBe(3);
    expect(waiting.delivered).toBe(2);
    expect(waiting.climbed).toBe(1);

    const played = stripTally(dailyStrip(record({ day: TODAY, attempts: 1, history }), TODAY));
    expect(played.running).toBe(4);

    const stale = stripTally(dailyStrip(record({ day: TODAY - 2, history: history.slice(0, 2) }), TODAY));
    expect(stale.running, 'a day older than yesterday is a streak already broken').toBe(0);
  });
});

/**
 * The line that leaves the machine. Everything on it has to be checkable
 * against the strip printed underneath it by somebody who was not there.
 */
describe('the docket', () => {
  const run = { delivered: true, ticks: 11550, checkpoints: 12, crates: 2, falls: 11, mate: 'RUSTY BRICK' };

  async function text(over: Partial<typeof run> = {}, d: DailyRecord = record({ day: TODAY, attempts: 1, bestTicks: 11550 })): Promise<string> {
    const { docketText } = await docket();
    return docketText({ ...run, ...over }, d, TODAY);
  }

  it('names the day, the tower and who you climbed it with', async () => {
    const t = await text();
    expect(t).toContain(dailyLabel(TODAY));
    expect(t, 'the seed is the only proof two people climbed the same thing').toContain(dailyRef(TODAY));
    expect(t).toContain('With RUSTY BRICK');
    expect(t).toContain('Delivered in');
  });

  it('names nobody when there was nobody', async () => {
    const t = await text({ mate: '' });
    expect(t).not.toContain('With');
  });

  it('never says delivered about a run that was walked away from', async () => {
    const t = await text({ delivered: false, checkpoints: 5 }, record({ day: TODAY, attempts: 3, bestCheckpoints: 5 }));
    expect(t).not.toContain('Delivered');
    expect(t).toContain('Gave up at checkpoint 5');
    expect(t).toContain('0 delivered');
  });

  it('counts the run of days off the strip and not off the profile', async () => {
    const t = await text({}, record({ day: TODAY, attempts: 1, bestTicks: 11550, streak: 99 }));
    expect(t, 'a number the reader cannot check against the picture').not.toContain('99');
  });

  it('pluralises the damage, because 1 crates lost is the old joke', async () => {
    const t = await text({ crates: 1, falls: 1 });
    expect(t).toContain('1 crate lost');
    expect(t).toContain('1 fall');
    expect(t).not.toContain('1 falls');
  });

  it('fits in a chat window without folding', async () => {
    const full = record({
      day: TODAY,
      attempts: 4,
      bestTicks: 44700,
      history: Array.from({ length: 13 }, (_, i) => ({ day: TODAY - 13 + i, ticks: 44700, checkpoints: 12, attempts: 2 })),
    });
    const t = await text({ ticks: 44700, crates: 12, falls: 128, mate: 'CONSTANTINOPLE' }, full);
    for (const line of t.split('\n')) expect(line.length, line).toBeLessThanOrEqual(60);
    expect(t.split('\n')).toHaveLength(4);
    expect(t).toContain('14 delivered, 14 running');
  });
});
