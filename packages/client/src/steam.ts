/**
 * Steamworks bridge.
 *
 * The renderer never talks to Steam directly — the Electron preload exposes a
 * narrow, promise-free surface on `window.haulmates`. Every call here is a
 * no-op when the game is running in a browser, so the same build works on the
 * web, in a playtest link, and inside the Steam client.
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
  inviteFriend?(roomCode: string): void;
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
    b.setRichPresence('connect', '');
  }
}

export function inviteFriend(roomCode: string): boolean {
  const b = bridge();
  if (!b?.inviteFriend) return false;
  b.inviteFriend(roomCode);
  return true;
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
