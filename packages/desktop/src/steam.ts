/**
 * Steamworks wrapper.
 *
 * `steamworks.js` is an optional native dependency: if it is missing, fails to
 * load, or Steam is not running, the game must still start and be fully
 * playable. Every call below is therefore defensive — a missing API on a
 * future version of the binding degrades to a no-op rather than a crash on
 * somebody's launch day.
 */

type SteamClient = Record<string, any>;

export interface SteamStatus {
  available: boolean;
  steamId: string;
  playerName: string;
  reason: string;
}

let client: SteamClient | null = null;
let status: SteamStatus = { available: false, steamId: '', playerName: '', reason: 'not initialised' };
let joinHandler: ((code: string) => void) | null = null;

/** Parse the connect string Steam hands us when a friend clicks "Join game". */
export function parseJoinArgument(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '+haulmates_join' && argv[i + 1]) return sanitise(argv[i + 1]);
    if (arg.startsWith('+haulmates_join=')) return sanitise(arg.slice('+haulmates_join='.length));
    if (arg.startsWith('haulmates://join/')) return sanitise(arg.slice('haulmates://join/'.length));
    const connect = arg.match(/^\+connect_lobby\s*(.*)$/);
    if (connect && connect[1]) return sanitise(connect[1]);
  }
  return '';
}

function sanitise(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export function init(appId: number): SteamStatus {
  if (client) return status;
  try {
    // Required by the Steam client so the overlay and achievements attach.
    process.env.SteamAppId = String(appId);
    process.env.SteamGameId = String(appId);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const steamworks = require('steamworks.js');
    client = steamworks.init(appId);
    const steamId = safe(() => String(client!.localplayer.getSteamId().steamId64), '');
    const playerName = safe(() => String(client!.localplayer.getName()), '');
    status = { available: true, steamId, playerName, reason: '' };
    wireCallbacks(steamworks);
  } catch (err) {
    client = null;
    status = { available: false, steamId: '', playerName: '', reason: String(err) };
  }
  return status;
}

function wireCallbacks(steamworks: any): void {
  // A friend clicking "Join game" arrives either as a rich-presence join
  // callback or, on a cold start, as a command-line argument.
  safe(() => {
    const callback = steamworks.callback;
    const handle = callback?.register?.(callback?.SteamCallback?.GameRichPresenceJoinRequested, (data: any) => {
      const code = sanitise(String(data?.connect ?? ''));
      if (code && joinHandler) joinHandler(code);
    });
    return handle;
  }, null);
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

export function unlockAchievement(id: string): void {
  if (!client) return;
  safe(() => {
    client!.achievement.activate(id);
    return true;
  }, false);
}

export function clearAchievement(id: string): void {
  if (!client) return;
  safe(() => {
    client!.achievement.clear(id);
    return true;
  }, false);
}

export function setStat(name: string, value: number): void {
  if (!client) return;
  safe(() => {
    if (client!.stats?.setInt) client!.stats.setInt(name, Math.round(value));
    if (client!.stats?.store) client!.stats.store();
    return true;
  }, false);
}

export function setRichPresence(key: string, value: string): void {
  if (!client) return;
  safe(() => {
    client!.friends?.setRichPresence?.(key, value);
    return true;
  }, false);
}

/** Open the Steam overlay invite dialog carrying our room code. */
export function inviteFriend(roomCode: string): void {
  if (!client) return;
  const connect = `+haulmates_join ${roomCode}`;
  safe(() => {
    const friends = client!.friends;
    if (friends?.activateGameOverlayInviteDialogConnectString) {
      friends.activateGameOverlayInviteDialogConnectString(connect);
      return true;
    }
    if (friends?.activateGameOverlay) {
      friends.activateGameOverlay('friends');
      return true;
    }
    return false;
  }, false);
}

export function runCallbacks(): void {
  if (!client) return;
  safe(() => {
    client!.runCallbacks?.();
    return true;
  }, false);
}
