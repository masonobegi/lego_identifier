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
  /**
   * True once the player has typed their own server in. Until they do, the
   * address follows whatever the build was packaged against rather than
   * whatever it happened to be the first time this copy was launched — without
   * this, a player who ran the game once before a server existed keeps
   * ws://127.0.0.1:8787 saved forever and can never reach the public one.
   */
  serverPinned: boolean;
  /**
   * Whether the second hauler is the Autohauler.
   *
   * Persisted because it is reachable from two places now: the couch screen,
   * where it is chosen, and the daily haul on the title screen, which starts a
   * run without passing through it. A solo player who picked the bot last night
   * and taps today's haul this morning should not get a second hauler who does
   * not move.
   */
  botPartner: boolean;
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
  serverPinned: false,
  botPartner: false,
};

export const PROFILE_STATS_KEY = 'stats';

/**
 * What you did on the daily tower, every day for a fortnight.
 *
 * This kept one day and argued for it: a history is a leaderboard with nobody
 * else on it, and the point of the daily is the tower you and your friend are
 * both on tonight rather than a museum of the ones you already did. What that
 * argument missed is that one day of memory cannot show a run of days. Three
 * separate reviews got as far as a fourth evening and all three wrote down the
 * same thing: day seven is day one with the platforms in a different order and
 * a personal best clock. The tower changes, and nothing else in the save can
 * tell you that you have been here every night since Tuesday. The museum was
 * never the point. The run of days is, and it is the one thing here that gets
 * better by coming back.
 *
 * Fourteen because a fortnight is how people talk about showing up, and
 * because fourteen boxes fit across a phone and across a chat window without
 * folding.
 */
export interface DailyRecord {
  /** UTC day number the rest of this record is about. */
  day: number;
  /** Best finish time in ticks, or 0 if it has not been finished. */
  bestTicks: number;
  /** Furthest checkpoint count reached today, finished or not. */
  bestCheckpoints: number;
  attempts: number;
  /** Consecutive days with at least one attempt. */
  streak: number;
  /** The days before this one, oldest first. At most `DAILY_HISTORY` of them. */
  history: DailyDay[];
}

/** One closed day of the daily, and how far up that day's tower you got. */
export interface DailyDay {
  day: number;
  /** Finish time in ticks, or 0 for a day that was climbed and not delivered. */
  ticks: number;
  checkpoints: number;
  attempts: number;
}

/** How many days of the daily a profile keeps. */
export const DAILY_HISTORY = 14;

/**
 * File the day that is open, and open today's.
 *
 * Only starting a run rolls the record over, so the day being filed can be any
 * age: somebody who hauled on Tuesday and comes back on Sunday files Tuesday,
 * not five blanks. The days in between are absent from the history and the
 * strip draws them as absent, which is the only reading of a day nobody
 * played that cannot be wrong.
 */
export function openDaily(d: DailyRecord, day: number): DailyRecord {
  if (d.day === day) return d;
  const history = d.history.filter((e) => e.day !== d.day && e.day < day && e.day > day - DAILY_HISTORY);
  if (d.attempts > 0 && d.day < day && d.day > day - DAILY_HISTORY) {
    history.push({ day: d.day, ticks: d.bestTicks, checkpoints: d.bestCheckpoints, attempts: d.attempts });
  }
  history.sort((a, b) => a.day - b.day);
  return {
    day,
    bestTicks: 0,
    bestCheckpoints: 0,
    attempts: 0,
    // A streak survives one missed day being yesterday and nothing more.
    streak: d.day === day - 1 ? d.streak + 1 : 1,
    history: history.slice(-DAILY_HISTORY),
  };
}

/**
 * What you and one particular person have done together.
 *
 * Everything else the profile remembers is about you: your runs, your deaths,
 * your best time. None of it is a reason to open the game on night four with
 * the same friend, which is the only night that matters for a co-op game with
 * no matchmaking population — and the whole product is a two-player game whose
 * store page says so. A crew record is the smallest thing that makes the
 * fourth evening different from the first: a number the two of you own, that
 * only goes up when both of you are here.
 */
export interface Crew {
  /** Their hauler name, as it appeared on the rope. */
  name: string;
  /** Hauls started together. */
  runs: number;
  /** ...and finished. */
  finishes: number;
  /** Best campaign time together, in ticks. Zero until you finish one. */
  bestTicks: number;
  /** Tallest Gauntlet the two of you have topped out. */
  bestFloors: number;
  /** Times one of you stood on the other. The number that needs both of you. */
  boosts: number;
  /** Crates lost, because a crew record that only flatters is not a record. */
  crates: number;
  /** When you last hauled together, as a day number. */
  lastDay: number;
}

export interface Profile {
  runs: number;
  finishes: number;
  bestCampaignTicks: number;
  bestGauntletHeight: number;
  deaths: number;
  cargoBreaks: number;
  betrayals: number;
  /** Lifetime boosts given and taken — the only co-op-only number here. */
  boosts: number;
  bonds: number;
  metres: number;
  unlockedHats: number[];
  seenTutorial: boolean;
  daily: DailyRecord;
  /** Keyed by hauler name, newest kept — see `Crew`. */
  crews: Crew[];
}

export const DEFAULT_PROFILE: Profile = {
  runs: 0,
  finishes: 0,
  bestCampaignTicks: 0,
  bestGauntletHeight: 0,
  deaths: 0,
  cargoBreaks: 0,
  betrayals: 0,
  boosts: 0,
  bonds: 0,
  metres: 0,
  unlockedHats: [0],
  seenTutorial: false,
  daily: { day: 0, bestTicks: 0, bestCheckpoints: 0, attempts: 0, streak: 0, history: [] },
  crews: [],
};

/**
 * Whether the machine has already been told that motion is a problem.
 *
 * A photosensitive player sets this once, in the OS, and every well-behaved
 * piece of software on it obeys without being asked again. Shipping the
 * accessibility switches off by default made them opt-in twice: once from the
 * player's own settings screen and once from ours, buried three taps into a
 * menu they have no reason to open before the first crumbling ledge strobes
 * at them.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * What a machine nobody has played on yet should start with: the shipped
 * defaults, with the two motion settings deferring to the OS preference.
 */
export function defaultSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (prefersReducedMotion()) {
    s.reducedFlash = true;
    s.shake = 0;
  }
  return s;
}

export function loadSettings(): Settings {
  // Merged over the defaults rather than loaded on top of them, which also
  // keeps `load` from handing back DEFAULT_SETTINGS itself for the clamps
  // below to write through. Anything the save holds outranks what the OS was
  // asked, because "off" is a legitimate answer and a preference the player
  // set by hand has to survive the one we inferred.
  const saved = load<Partial<Settings>>('settings', {});
  const s: Settings = { ...defaultSettings(), ...saved };
  s.master = clamp01(s.master);
  s.sfx = clamp01(s.sfx);
  s.music = clamp01(s.music);
  s.shake = clamp01(s.shake);
  if (!s.serverPinned || !s.serverUrl) s.serverUrl = DEFAULT_SERVER;
  return s;
}

export function saveSettings(s: Settings): void {
  save('settings', s);
}

export function loadProfile(): Profile {
  // Merged over the defaults, so a save written before a field existed does not
  // hand back an object missing it. `crews` arrived this way.
  const saved = load<Partial<Profile>>(PROFILE_STATS_KEY, {});
  const p: Profile = { ...DEFAULT_PROFILE, ...saved };
  if (!Array.isArray(p.unlockedHats) || p.unlockedHats.length === 0) p.unlockedHats = [0];
  if (!Array.isArray(p.crews)) p.crews = [];
  // That merge is one level deep, so a saved `daily` arrives whole, and a save
  // older than the history arrives without one — a strip drawn from
  // `undefined` is a crash on the title screen. The array is rebuilt rather
  // than carried over by the spread, which would hand every such profile the
  // one array `DEFAULT_PROFILE` holds and file the first day into the
  // defaults.
  p.daily = { ...DEFAULT_PROFILE.daily, ...saved.daily };
  p.daily.history = Array.isArray(saved.daily?.history) ? saved.daily.history.slice(-DAILY_HISTORY) : [];
  return p;
}

/** How many crews a profile keeps. Beyond this the least recent is dropped. */
const CREW_LIMIT = 12;

/**
 * Find or start the record for the person on the other end of the rope.
 *
 * Keyed by name because that is the only identity this game has: there are no
 * accounts, and a room code is a room, not a person. Two different friends who
 * both left the name generator alone and both landed on RUSTY BRICK will share
 * a record, which is a smaller wrong answer than having no record at all.
 */
export function crewFor(p: Profile, name: string, day: number): Crew {
  const key = name.trim().toUpperCase();
  let crew = p.crews.find((c) => c.name === key);
  if (!crew) {
    crew = { name: key, runs: 0, finishes: 0, bestTicks: 0, bestFloors: 0, boosts: 0, crates: 0, lastDay: day };
    p.crews.push(crew);
  }
  crew.lastDay = day;
  if (p.crews.length > CREW_LIMIT) {
    p.crews.sort((a, b) => b.lastDay - a.lastDay);
    p.crews.length = CREW_LIMIT;
  }
  return crew;
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
