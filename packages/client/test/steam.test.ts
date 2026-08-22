import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAT_DEFS } from '@haulmates/core';

/**
 * What the game is allowed to believe about Steam.
 *
 * Everything here is a claim the player can see: the STEAM badge on the title
 * screen, the toast after pressing Invite on Steam, and the counters on the
 * profile page Steam draws from the stats API. Each of them was capable of
 * being confidently wrong — the badge lit up because the shell had been
 * compiled with the Steam bits in it rather than because Steam had answered,
 * the toast fired before the overlay had been asked, and a configured stat
 * nobody writes reads zero for everybody forever.
 */
interface Bridge {
  info(): { steam: boolean; steamId: string; playerName: string; version: string; defaultServer: string };
  setRichPresence(key: string, value: string): void;
  inviteFriend(code: string): Promise<boolean>;
  setStat(name: string, value: number): void;
  readSave(key: string): string | null;
  writeSave(key: string, value: string): void;
}

let presence: Record<string, string>;
let stats: Record<string, number>;
let invites: string[];
let inviteResult: boolean | Promise<boolean>;
let steam: boolean;

function install(bridge: Partial<Bridge> | undefined): void {
  (globalThis as { window?: unknown }).window = {
    HAULMATES_SERVER: 'ws://test',
    matchMedia: () => ({ matches: false }),
    haulmates: bridge,
  };
}

function fullBridge(): Bridge {
  return {
    info: () => ({ steam, steamId: '7656', playerName: 'Hauler', version: '1.0.0', defaultServer: '' }),
    setRichPresence: (key, value) => {
      presence[key] = value;
    },
    inviteFriend: async (code) => {
      invites.push(code);
      return inviteResult;
    },
    setStat: (name, value) => {
      stats[name] = value;
    },
    readSave: () => null,
    writeSave: () => undefined,
  };
}

beforeEach(() => {
  presence = {};
  stats = {};
  invites = [];
  inviteResult = true;
  steam = true;
  install(fullBridge());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

async function loadSteam(): Promise<typeof import('../src/steam.js')> {
  return import('../src/steam.js');
}

describe('the STEAM badge', () => {
  it('is off in a browser', async () => {
    install(undefined);
    const s = await loadSteam();
    expect(s.steamAvailable()).toBe(false);
    expect(s.desktopAvailable()).toBe(false);
  });

  it('is off in a desktop build that Steam never answered', async () => {
    steam = false;
    const s = await loadSteam();
    expect(s.desktopAvailable()).toBe(true);
    expect(s.steamAvailable()).toBe(false);
  });

  it('is on once the shell reports a live Steam', async () => {
    const s = await loadSteam();
    expect(s.steamAvailable()).toBe(true);
  });
});

describe('rich presence', () => {
  it('advertises a joinable haul while in a room', async () => {
    const s = await loadSteam();
    s.setRichPresence('In a lobby', 'AKJ47');
    expect(presence.connect).toBe('+haulmates_join AKJ47');
    expect(presence.steam_player_group).toBe('AKJ47');
    expect(presence.status).toBe('In a lobby');
  });

  it('withdraws both join keys on the way back to the menus', async () => {
    const s = await loadSteam();
    s.setRichPresence('In a lobby', 'AKJ47');
    s.setRichPresence('In the menus', '');
    expect(presence.connect).toBe('');
    expect(presence.steam_player_group).toBe('');
  });
});

describe('the invite toast', () => {
  it('reports what Steam actually did', async () => {
    const s = await loadSteam();
    expect(await s.inviteFriend('AKJ47')).toBe(true);
    inviteResult = false;
    expect(await s.inviteFriend('AKJ47')).toBe(false);
    expect(invites).toEqual(['AKJ47', 'AKJ47']);
  });

  it('reports failure rather than throwing when the shell rejects', async () => {
    const s = await loadSteam();
    inviteResult = Promise.reject(new Error('no overlay'));
    expect(await s.inviteFriend('AKJ47')).toBe(false);
  });

  it('reports failure in a browser, where there is nothing to open', async () => {
    install(undefined);
    const s = await loadSteam();
    expect(await s.inviteFriend('AKJ47')).toBe(false);
  });
});

describe('stats', () => {
  it('writes every stat configured on the partner site', async () => {
    const { Achievements } = await import('../src/achievements.js');
    const { DEFAULT_PROFILE } = await import('../src/settings.js');
    new Achievements(() => undefined).pushStats({
      ...DEFAULT_PROFILE,
      runs: 3,
      deaths: 9,
      metres: 120.6,
      cargoBreaks: 2,
      betrayals: 4,
      boosts: 7,
    });
    expect(Object.keys(stats).sort()).toEqual(STAT_DEFS.map((s) => s.id).sort());
    expect(stats.boosts).toBe(7);
    expect(stats.total_metres).toBe(121);
  });
});
