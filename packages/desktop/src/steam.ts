/**
 * Steamworks wrapper.
 *
 * `steamworks.js` is an optional native dependency: if it is missing, fails to
 * load, or Steam is not running, the game must still start and be fully
 * playable. Nothing in here throws, and every call reports whether Steam
 * actually took it rather than assuming it did.
 *
 * The binding surface is declared by hand below instead of imported. Two
 * reasons, both of which have teeth:
 *
 *  - `steamworks.js` is an *optional* dependency, so npm leaves it out
 *    entirely on a platform it has no prebuilt binary for. Importing its types
 *    would turn that into a typecheck failure in the shell rather than the
 *    graceful standalone fallback the whole file exists to provide.
 *  - Declaring only the calls we make turns a call the binding does not have
 *    into a compile error here instead of a silent no-op in front of a
 *    customer. That is not hypothetical: `friends.setRichPresence` and
 *    `friends.activateGameOverlayInviteDialogConnectString` are ISteamFriends
 *    entry points that 0.4.x does not expose at all, so rich presence goes
 *    through `localplayer` and the invite dialog belongs to a lobby.
 */

interface PlayerSteamId {
  steamId64: bigint;
  steamId32: string;
  accountId: number;
}

interface SteamLobby {
  id: bigint;
  leave(): void;
  openInviteDialog(): void;
  getData(key: string): string | null;
  setData(key: string, value: string): boolean;
}

interface LobbyJoinRequest {
  lobby_steam_id: bigint;
  friend_steam_id: bigint;
}

interface SteamClient {
  achievement: {
    activate(name: string): boolean;
    clear(name: string): boolean;
    isActivated(name: string): boolean;
  };
  callback: {
    register(id: number, handler: (value: LobbyJoinRequest) => void): { disconnect(): void };
  };
  cloud: {
    isEnabledForAccount(): boolean;
    isEnabledForApp(): boolean;
    fileExists(name: string): boolean;
    readFile(name: string): string;
    writeFile(name: string, content: string): boolean;
    deleteFile(name: string): boolean;
  };
  localplayer: {
    getSteamId(): PlayerSteamId;
    getName(): string;
    setRichPresence(key: string, value?: string | null): void;
  };
  matchmaking: {
    createLobby(lobbyType: number, maxMembers: number): Promise<SteamLobby>;
    joinLobby(lobbyId: bigint): Promise<SteamLobby>;
  };
  stats: {
    getInt(name: string): number | null;
    setInt(name: string, value: number): boolean;
    store(): boolean;
  };
  utils: {
    getAppId(): number;
  };
}

interface SteamworksModule {
  /** Throws when Steam is not running or the app id is not owned. */
  init(appId?: number): SteamClient;
  electronEnableSteamOverlay(disableEachFrameInvalidation?: boolean): void;
  SteamCallback: Record<string, number | undefined>;
}

export interface SteamStatus {
  available: boolean;
  steamId: string;
  playerName: string;
  reason: string;
}

/** `matchmaking.LobbyType.FriendsOnly`, spelled out: the enum is a `const enum`
 * in the binding's declarations and has no runtime member to read. */
const LOBBY_FRIENDS_ONLY = 1;

/** Where the room code rides on the Steam lobby. Whoever accepts the invite
 * reads it back out; the match itself never touches Steam matchmaking. */
const LOBBY_CODE_KEY = 'haulmates_code';

/**
 * Steam's rate limit on StoreStats is per-call, not per-stat, and a stats push
 * writes six counters in a row at the end of every run. Batching them into one
 * store keeps that to a single round trip.
 */
const STATS_FLUSH_MS = 1000;

let client: SteamClient | null = null;
let status: SteamStatus = { available: false, steamId: '', playerName: '', reason: 'not initialised' };
let joinHandler: ((code: string) => void) | null = null;
let lobby: SteamLobby | null = null;
let lobbyCode = '';
let lobbyPending: Promise<SteamLobby | null> | null = null;
let statsFlush: NodeJS.Timeout | null = null;

/** Parse the connect string Steam hands us when a friend clicks "Join game". */
export function parseJoinArgument(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '+haulmates_join' && argv[i + 1]) return sanitise(argv[i + 1]);
    if (arg.startsWith('+haulmates_join=')) return sanitise(arg.slice('+haulmates_join='.length));
    if (arg.startsWith('haulmates://join/')) return sanitise(arg.slice('haulmates://join/'.length));
  }
  return '';
}

/**
 * The other cold-start form: accepting a lobby invite launches us with
 * `+connect_lobby <64-bit id>`.
 *
 * That id is a lobby, not a room code — running it through the room-code
 * sanitiser yields the first five digits of a Steam id and sends the player
 * to a haul that does not exist. The code has to be fetched from the lobby.
 */
export function parseLobbyArgument(argv: string[]): bigint | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let raw = '';
    if (arg === '+connect_lobby' && argv[i + 1]) raw = argv[i + 1];
    else if (arg.startsWith('+connect_lobby')) raw = arg.slice('+connect_lobby'.length).replace(/^[=\s]+/, '');
    if (!/^\d+$/.test(raw.trim())) continue;
    try {
      return BigInt(raw.trim());
    } catch {
      return null;
    }
  }
  return null;
}

function sanitise(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

/**
 * Turn on the Steam overlay, before the Electron app is ready.
 *
 * The overlay hooks the GPU process, so `steamworks.js` turns it on by
 * appending `--in-process-gpu` and `--disable-direct-composition` to the
 * command line — switches Chromium only reads during startup, which is why
 * this cannot wait for `init` inside `whenReady`. Those switches cost real
 * rendering performance, so they only go on when the Steam client is the thing
 * that launched us: it sets `SteamClientLaunch` in the environment, and it is
 * also the only case where an overlay can attach at all.
 */
export function prepareOverlay(): void {
  if (!process.env.SteamClientLaunch && !process.env.SteamEnv) return;
  safe(() => {
    load()?.electronEnableSteamOverlay();
    return true;
  }, false);
}

export function init(appId: number): SteamStatus {
  if (client) return status;
  // Required by the Steam client so the overlay and achievements attach.
  process.env.SteamAppId = String(appId);
  process.env.SteamGameId = String(appId);
  const steamworks = load();
  if (!steamworks) return status;
  let started: SteamClient;
  try {
    started = steamworks.init(appId);
  } catch (err) {
    status = { available: false, steamId: '', playerName: '', reason: String(err) };
    return status;
  }
  // `init` resolving is not proof of a working connection — the identity call
  // is. Until something has actually come back from Steam the shell reports
  // itself unavailable, because the badge the game shows is read from here and
  // a badge that lights up optimistically hides exactly the failure it is
  // there to make visible.
  const steamId = safe(() => String(started.localplayer.getSteamId().steamId64), '');
  if (!steamId || steamId === '0') {
    status = { available: false, steamId: '', playerName: '', reason: 'Steam returned no user' };
    return status;
  }
  client = started;
  const playerName = safe(() => String(started.localplayer.getName()), '');
  const running = safe(() => started.utils.getAppId(), appId);
  status = {
    available: true,
    steamId,
    playerName,
    // A mismatch means Steam attached us to a different app than the one this
    // build was packaged for, and every achievement would land on that app.
    reason: running === appId ? '' : `Steam attached app ${running}, not ${appId}`,
  };
  wireLobbyJoin(steamworks);
  return status;
}

function load(): SteamworksModule | null {
  return safe<SteamworksModule | null>(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('steamworks.js') as SteamworksModule;
  }, null);
}

/**
 * A friend accepting an invite while we are already running.
 *
 * `GameLobbyJoinRequested` is the only join callback the binding surfaces —
 * there is no `GameRichPresenceJoinRequested` in its enum — so an invite
 * accepted mid-session arrives as a lobby to join, and the room code is read
 * back off that lobby. The rich-presence route lands on the command line
 * instead, via a second instance, and is handled by the shell.
 */
function wireLobbyJoin(steamworks: SteamworksModule): void {
  const id = steamworks.SteamCallback?.GameLobbyJoinRequested;
  if (typeof id !== 'number') return;
  safe(() => client!.callback.register(id, (data) => joinLobbyById(data.lobby_steam_id)), null);
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function getStatus(): SteamStatus {
  return status;
}

export function onJoinRequest(handler: (code: string) => void): void {
  joinHandler = handler;
}

/** Join a Steam lobby purely to read the room code off it, then let it go. */
export function joinLobbyById(id: bigint): void {
  const live = client;
  if (!live) return;
  void (async () => {
    try {
      const joined = await live.matchmaking.joinLobby(id);
      const code = sanitise(String(joined.getData(LOBBY_CODE_KEY) ?? ''));
      safe(() => {
        joined.leave();
        return true;
      }, false);
      if (code && joinHandler) joinHandler(code);
    } catch {
      /* the lobby went away between the invite and the click */
    }
  })();
}

export function unlockAchievement(id: string): boolean {
  if (!client) return false;
  return safe(() => client!.achievement.activate(id), false);
}

export function clearAchievement(id: string): boolean {
  if (!client) return false;
  return safe(() => client!.achievement.clear(id), false);
}

export function setStat(name: string, value: number): boolean {
  if (!client) return false;
  const ok = safe(() => client!.stats.setInt(name, Math.round(value)), false);
  if (ok && !statsFlush) {
    statsFlush = setTimeout(() => {
      statsFlush = null;
      safe(() => client?.stats.store(), false);
    }, STATS_FLUSH_MS);
    // The stats push must never be the reason the process stays alive.
    statsFlush.unref?.();
  }
  return ok;
}

export function setRichPresence(key: string, value: string): boolean {
  if (!client) return false;
  // Clearing `connect` is the game telling us it is no longer in a room, which
  // is also the moment the Steam lobby behind the invite dialog stops meaning
  // anything. Left alone it would sit in the friends list advertising a haul
  // that has already ended.
  if (key === 'connect' && !value) dropLobby();
  return safe(() => {
    client!.localplayer.setRichPresence(key, value || null);
    return true;
  }, false);
}

/**
 * Open the Steam overlay invite dialog carrying our room code.
 *
 * The dialog belongs to a lobby — there is no connect-string form of it in the
 * binding — so hosting an invite means holding a two-seat friends-only lobby
 * whose only payload is the room code. Steam then delivers the accepting
 * friend to us as a lobby join, cold or warm, and the code comes back out the
 * same way it went in.
 */
export async function inviteFriend(roomCode: string): Promise<boolean> {
  const code = sanitise(roomCode);
  const live = client;
  if (!live || !code) return false;
  const open = await ensureLobby(live, code);
  if (!open) return false;
  return safe(() => {
    open.openInviteDialog();
    return true;
  }, false);
}

async function ensureLobby(live: SteamClient, code: string): Promise<SteamLobby | null> {
  if (lobby && lobbyCode === code) return lobby;
  // Two quick presses of Invite must not leave a second lobby behind.
  if (lobbyPending) return lobbyPending;
  dropLobby();
  lobbyPending = (async () => {
    try {
      const created = await live.matchmaking.createLobby(LOBBY_FRIENDS_ONLY, 2);
      created.setData(LOBBY_CODE_KEY, code);
      lobby = created;
      lobbyCode = code;
      return created;
    } catch {
      return null;
    } finally {
      lobbyPending = null;
    }
  })();
  return lobbyPending;
}

function dropLobby(): void {
  if (!lobby) return;
  const leaving = lobby;
  lobby = null;
  lobbyCode = '';
  safe(() => {
    leaving.leave();
    return true;
  }, false);
}

/* ------------------------------------------------------------------ cloud */

/**
 * Steam Cloud, which is only usable when the player *and* the app have it
 * switched on — a player who turned cloud saves off in their Steam settings
 * must keep playing off the local file rather than losing their unlocks.
 */
export function cloudAvailable(): boolean {
  if (!client) return false;
  return safe(() => client!.cloud.isEnabledForAccount() && client!.cloud.isEnabledForApp(), false);
}

export function cloudRead(name: string): string | null {
  if (!cloudAvailable()) return null;
  return safe(() => (client!.cloud.fileExists(name) ? client!.cloud.readFile(name) : null), null);
}

export function cloudWrite(name: string, content: string): boolean {
  if (!cloudAvailable()) return false;
  return safe(() => client!.cloud.writeFile(name, content), false);
}
