import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only surface the game has onto the desktop shell.
 *
 * Two constraints shape this file:
 *
 *  - `contextBridge` copies the exposed object by value and drops accessors,
 *    so everything dynamic has to be a *method*, never a getter or a setter.
 *  - The game reads its settings during construction, which happens as soon as
 *    the bundle parses. Bootstrap therefore uses synchronous IPC: an
 *    asynchronous read would hand the game empty defaults and silently discard
 *    every saved setting on launch.
 */
type JoinHandler = ((code: string) => void) | null;

export interface Bootstrap {
  steam: boolean;
  steamId: string;
  playerName: string;
  version: string;
  defaultServer: string;
  joinCode: string;
  saves: Record<string, string>;
}

const fallback: Bootstrap = {
  steam: false,
  steamId: '',
  playerName: '',
  version: '1.0.0',
  defaultServer: '',
  joinCode: '',
  saves: {},
};

let boot: Bootstrap = fallback;
try {
  boot = (ipcRenderer.sendSync('haulmates:bootstrap-sync') as Bootstrap) ?? fallback;
} catch {
  boot = fallback;
}

const saveCache = new Map<string, string>(Object.entries(boot.saves ?? {}));
let joinHandler: JoinHandler = null;
let readyHandler: (() => void) | null = null;
let pendingJoin = boot.joinCode;

const api = {
  available: true,

  info(): Omit<Bootstrap, 'saves' | 'joinCode'> {
    return {
      steam: boot.steam,
      steamId: boot.steamId,
      playerName: boot.playerName,
      version: boot.version,
      defaultServer: boot.defaultServer,
    };
  },

  unlockAchievement(id: string): void {
    ipcRenderer.send('haulmates:achievement', id);
  },
  clearAchievement(id: string): void {
    ipcRenderer.send('haulmates:clear-achievement', id);
  },
  setStat(name: string, value: number): void {
    ipcRenderer.send('haulmates:stat', name, value);
  },
  setRichPresence(key: string, value: string): void {
    ipcRenderer.send('haulmates:presence', key, value);
  },
  /**
   * Resolves to whether Steam actually opened the dialog. The game says so out
   * loud, and it can only be honest about it if the answer comes back.
   */
  inviteFriend(code: string): Promise<boolean> {
    return ipcRenderer.invoke('haulmates:invite', code) as Promise<boolean>;
  },
  openUrl(url: string): void {
    ipcRenderer.send('haulmates:open-url', url);
  },
  quit(): void {
    ipcRenderer.send('haulmates:quit');
  },
  toggleFullscreen(): void {
    ipcRenderer.send('haulmates:fullscreen');
  },
  hostLocalServer(): Promise<{ url: string; port: number }> {
    return ipcRenderer.invoke('haulmates:host-server');
  },
  stopLocalServer(): void {
    void ipcRenderer.invoke('haulmates:stop-server');
  },

  readSave(key: string): string | null {
    return saveCache.get(key) ?? null;
  },
  writeSave(key: string, value: string): void {
    saveCache.set(key, value);
    void ipcRenderer.invoke('haulmates:write-save', key, value);
  },
  clearSave(key: string): void {
    saveCache.delete(key);
    void ipcRenderer.invoke('haulmates:write-save', key, 'null');
  },

  setJoinHandler(handler: JoinHandler): void {
    joinHandler = handler;
    if (handler && pendingJoin) {
      const code = pendingJoin;
      pendingJoin = '';
      // Give the game a beat to finish booting before yanking it into a lobby.
      setTimeout(() => handler(code), 400);
    }
  },

  onReady(handler: () => void): void {
    readyHandler = handler;
    handler();
  },
};

ipcRenderer.on('haulmates:join', (_event, code: string) => joinHandler?.(code));
ipcRenderer.on('haulmates:refresh', () => readyHandler?.());

contextBridge.exposeInMainWorld('haulmates', api);
if (boot.defaultServer) contextBridge.exposeInMainWorld('HAULMATES_SERVER', boot.defaultServer);
