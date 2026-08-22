/**
 * Steamworks bridge.
 *
 * The renderer never talks to Steam directly — the Electron preload exposes a
 * narrow surface on `window.haulmates`. Every call here is a no-op when the
 * game is running in a browser, so the same build works on the web, in a
 * playtest link, and inside the Steam client.
 *
 * The surface is synchronous except where Steam itself is not: opening the
 * invite dialog needs a lobby to exist first, and the answer to "did that
 * work" is the only thing standing between the player and a toast that lies
 * to them.
 */

export interface BridgeInfo {
  steam: boolean;
  steamId: string;
  playerName: string;
  version: string;
  defaultServer: string;
}

export interface SteamBridge {
  available?: boolean;
  /** A method, not a property: contextBridge does not carry accessors across. */
  info?(): BridgeInfo;
  onReady?(handler: () => void): void;
  unlockAchievement?(id: string): void;
  clearAchievement?(id: string): void;
  setStat?(name: string, value: number): void;
  setRichPresence?(key: string, value: string): void;
  /** Ask Steam to show the friend invite dialog for the current lobby. */
  inviteFriend?(roomCode: string): Promise<boolean> | boolean;
  /** Registers the handler the shell calls when a friend clicks Join on Steam. */
  setJoinHandler?(handler: (roomCode: string) => void): void;
  openUrl?(url: string): void;
  quit?(): void;
  toggleFullscreen?(): void;
  /** Start the bundled server in-process so a player can host from home. */
  hostLocalServer?(): Promise<{ url: string; port: number }> | { url: string; port: number };
  stopLocalServer?(): void;
  version?: string;
}

function bridge(): SteamBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window.haulmates as SteamBridge | undefined);
}

/**
 * True only once the shell has had a real answer out of Steam.
 *
 * This is what puts the STEAM badge on the title screen, so it has to mean
 * "achievements and invites will work", not "this build was compiled with the
 * Steam bits in it". A badge that lights up on optimism hides the one failure
 * — Steam present but not talking to us — that it exists to make visible.
 */
export function steamAvailable(): boolean {
  return bridge()?.info?.().steam === true;
}

export function desktopAvailable(): boolean {
  return bridge() !== undefined;
}

export function steamName(): string {
  return bridge()?.info?.().playerName ?? '';
}

/** Runs once the desktop shell has finished starting up. No-op in a browser. */
export function onHostReady(handler: () => void): void {
  bridge()?.onReady?.(handler);
}

export function unlockAchievement(id: string): void {
  bridge()?.unlockAchievement?.(id);
}

export function setStat(name: string, value: number): void {
  bridge()?.setStat?.(name, value);
}

export function setRichPresence(status: string, roomCode: string): void {
  const b = bridge();
  if (!b?.setRichPresence) return;
  b.setRichPresence('steam_display', '#Status_Generic');
  b.setRichPresence('status', status);
  if (roomCode) {
    b.setRichPresence('connect', `+haulmates_join ${roomCode}`);
    b.setRichPresence('steam_player_group', roomCode);
  } else {
    // Both keys, or the friends list keeps offering a joinable haul and keeps
    // the pair grouped under a room that has already been torn down.
    b.setRichPresence('connect', '');
    b.setRichPresence('steam_player_group', '');
  }
}

export async function inviteFriend(roomCode: string): Promise<boolean> {
  const b = bridge();
  if (!b?.inviteFriend) return false;
  try {
    return (await b.inviteFriend(roomCode)) === true;
  } catch {
    return false;
  }
}

export function onSteamJoinRequest(handler: (roomCode: string) => void): void {
  bridge()?.setJoinHandler?.(handler);
}

export function openExternal(url: string): void {
  const b = bridge();
  if (b?.openUrl) b.openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

export function quitGame(): void {
  bridge()?.quit?.();
}

export function toggleFullscreen(): void {
  const b = bridge();
  if (b?.toggleFullscreen) {
    b.toggleFullscreen();
    return;
  }
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

export async function hostLocalServer(): Promise<{ url: string; port: number } | null> {
  const b = bridge();
  if (!b?.hostLocalServer) return null;
  try {
    return await b.hostLocalServer();
  } catch {
    return null;
  }
}

export function stopLocalServer(): void {
  bridge()?.stopLocalServer?.();
}
