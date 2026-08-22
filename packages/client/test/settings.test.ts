import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The save file, as the storage layer sees it, plus the one media query the
 * accessibility defaults are read from. Both live on `window`, and settings.ts
 * reads its default server address at import time, so the stub goes up before
 * the module is pulled in.
 */
let saved: Record<string, string>;
let reduceMotion: boolean;

beforeEach(() => {
  saved = {};
  reduceMotion = false;
  (globalThis as { window?: unknown }).window = {
    HAULMATES_SERVER: 'ws://test',
    matchMedia: (query: string) => ({ matches: query.includes('reduce') && reduceMotion }),
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

async function loadSettings(): Promise<import('../src/settings.js').Settings> {
  const module = await import('../src/settings.js');
  return module.loadSettings();
}

describe('accessibility defaults', () => {
  /**
   * Reduce flashing and Screen shake shipped off and at full, and nothing
   * consulted prefers-reduced-motion — so a photosensitive player who had
   * already told their operating system about it was shown a strobing
   * crumbling ledge before they ever reached a menu. The OS preference is the
   * answer to this question; the game only has to stop asking it again.
   */
  it('follows the operating system when the player has said nothing', async () => {
    reduceMotion = true;
    const s = await loadSettings();
    expect(s.reducedFlash, 'reduce flashing').toBe(true);
    expect(s.shake, 'screen shake').toBe(0);
  });

  it('leaves the defaults alone when the machine has no preference', async () => {
    const s = await loadSettings();
    expect(s.reducedFlash).toBe(false);
    expect(s.shake).toBe(1);
  });

  /**
   * The half that stops this being a nuisance: a player who turned the setting
   * off keeps it off, however loudly the OS disagrees. Keyed on the field being
   * absent from the save rather than on its value, because "off" is a real
   * answer and inferring over the top of it is how a setting stops working.
   */
  it('never overrides an answer the player has already given', async () => {
    reduceMotion = true;
    saved.settings = JSON.stringify({ reducedFlash: false, shake: 0.5 });
    const s = await loadSettings();
    expect(s.reducedFlash).toBe(false);
    expect(s.shake).toBe(0.5);
  });

  it('still fills in the fields an older save has never heard of', async () => {
    reduceMotion = true;
    saved.settings = JSON.stringify({ master: 0.4 });
    const s = await loadSettings();
    expect(s.master, 'what the save did hold').toBe(0.4);
    expect(s.reducedFlash, 'what it did not').toBe(true);
  });
});

/**
 * The record that makes night four different from night one.
 *
 * Everything else the profile keeps is about one player. For a two-player game
 * with no matchmaking population, the number that decides whether it was worth
 * buying is the one you and one particular friend own together.
 */
describe('crews', () => {
  async function mod(): Promise<typeof import('../src/settings.js')> {
    return import('../src/settings.js');
  }

  it('starts a record the first time and finds it again after', async () => {
    const { DEFAULT_PROFILE, crewFor } = await mod();
    const p = { ...DEFAULT_PROFILE, crews: [] };
    const a = crewFor(p, 'Rusty Brick', 10);
    a.runs = 3;
    const b = crewFor(p, 'RUSTY BRICK', 11);
    expect(b, 'the same person typed differently').toBe(a);
    expect(b.runs).toBe(3);
    expect(b.lastDay).toBe(11);
    expect(p.crews).toHaveLength(1);
  });

  it('keeps the people you played with most recently', async () => {
    const { DEFAULT_PROFILE, crewFor } = await mod();
    const p = { ...DEFAULT_PROFILE, crews: [] };
    for (let i = 0; i < 20; i++) crewFor(p, `HAULER ${i}`, i);
    expect(p.crews.length).toBeLessThanOrEqual(12);
    expect(p.crews.some((c) => c.name === 'HAULER 19')).toBe(true);
    expect(p.crews.some((c) => c.name === 'HAULER 0')).toBe(false);
  });

  it('survives a save written before crews existed', async () => {
    const { DEFAULT_PROFILE, PROFILE_STATS_KEY, loadProfile } = await mod();
    const stored = { ...DEFAULT_PROFILE } as Record<string, unknown>;
    delete stored.crews;
    saved[PROFILE_STATS_KEY] = JSON.stringify(stored);
    expect(loadProfile().crews).toEqual([]);
  });
});
