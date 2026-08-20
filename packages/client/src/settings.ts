import { load, save } from './storage.js';

export interface Settings {
  master: number;
  sfx: number;
  music: number;
  shake: number;
  highContrast: boolean;
  reducedFlash: boolean;
  showNetgraph: boolean;
  showGhostTrail: boolean;
  playerName: string;
  hat: number;
  colour: number;
  serverUrl: string;
}

/** Where the public matchmaking server lives. Overridable in settings so a
 *  community can self-host, and so the desktop build can point at localhost
 *  when the player is hosting from their own machine. */
export const DEFAULT_SERVER = inferDefaultServer();

/**
 * Builds that ship as one self-contained file (scripts/bundle-web.mjs) have no
 * matchmaking server behind them and no way to reach one — the page may not
 * even be allowed to open a socket. Saying so up front beats offering online
 * play and then failing to connect.
 */
export function offlineBuild(): boolean {
  return typeof window !== 'undefined' && (window as { HAULMATES_OFFLINE?: boolean }).HAULMATES_OFFLINE === true;
}

function inferDefaultServer(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:8787';
  const injected = (window as { HAULMATES_SERVER?: string }).HAULMATES_SERVER;
  if (injected) return injected;
  const { protocol, host } = window.location;
  // Served over http(s): the matchmaking server is the same origin. Anything
  // else (the desktop shell's own scheme, a file:// preview) has no server of
  // its own, so fall back to a locally hosted one.
  if (protocol !== 'http:' && protocol !== 'https:') return 'ws://127.0.0.1:8787';
  if (!host) return 'ws://127.0.0.1:8787';
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.55,
  shake: 1,
  highContrast: false,
  reducedFlash: false,
  showNetgraph: false,
  showGhostTrail: true,
  playerName: '',
  hat: 0,
  colour: 0,
  serverUrl: DEFAULT_SERVER,
};

export const PROFILE_STATS_KEY = 'stats';

export interface Profile {
  runs: number;
  finishes: number;
  bestCampaignTicks: number;
  bestGauntletHeight: number;
  deaths: number;
  cargoBreaks: number;
  betrayals: number;
  bonds: number;
  metres: number;
  unlockedHats: number[];
  seenTutorial: boolean;
}

export const DEFAULT_PROFILE: Profile = {
  runs: 0,
  finishes: 0,
  bestCampaignTicks: 0,
  bestGauntletHeight: 0,
  deaths: 0,
  cargoBreaks: 0,
  betrayals: 0,
  bonds: 0,
  metres: 0,
  unlockedHats: [0],
  seenTutorial: false,
};

export function loadSettings(): Settings {
  const s = load<Settings>('settings', DEFAULT_SETTINGS);
  s.master = clamp01(s.master);
  s.sfx = clamp01(s.sfx);
  s.music = clamp01(s.music);
  s.shake = clamp01(s.shake);
  if (!s.serverUrl) s.serverUrl = DEFAULT_SERVER;
  return s;
}

export function saveSettings(s: Settings): void {
  save('settings', s);
}

export function loadProfile(): Profile {
  const p = load<Profile>(PROFILE_STATS_KEY, DEFAULT_PROFILE);
  if (!Array.isArray(p.unlockedHats) || p.unlockedHats.length === 0) p.unlockedHats = [0];
  return p;
}

export function saveProfile(p: Profile): void {
  save(PROFILE_STATS_KEY, p);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
}

/** A default handle so nobody has to type one before they can play. */
export function randomName(): string {
  const first = ['RUSTY', 'BIG', 'LITTLE', 'HONEST', 'LUCKY', 'SLOW', 'FAST', 'BRAVE', 'MOIST', 'TALL'];
  const last = ['DAVE', 'PETE', 'MARGE', 'BRICK', 'SANDWICH', 'PIGEON', 'KEVIN', 'TUESDAY', 'BUCKET', 'NORM'];
  const pick = (list: string[]): string => list[Math.floor(Math.random() * list.length)];
  return `${pick(first)} ${pick(last)}`;
}
