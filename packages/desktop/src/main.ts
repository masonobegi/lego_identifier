import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as steam from './steam.js';

/**
 * The Steam App ID this build identifies itself as.
 *
 * Same trap as the matchmaking server: reading the environment here reads the
 * *player's* environment at launch, not the one the release was built in, so
 * "set HAULMATES_APP_ID in the build environment" silently did nothing and the
 * shipped app initialised against 480 — Spacewar. Every Steamworks call is
 * wrapped and degrades to a no-op, so achievements, stats, rich presence and
 * friend invites would all just quietly not happen. It is baked at package
 * time now, into the same file as the server address.
 */
const SPACEWAR_APP_ID = 480;

function bakedConfig(): { server?: string; appId?: number } {
  try {
    const file = join(__dirname, '..', 'build-config.json');
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, 'utf8')) as { server?: string; appId?: number };
  } catch {
    return {};
  }
}

const BAKED = bakedConfig();
const STEAM_APP_ID = Number(process.env.HAULMATES_APP_ID ?? BAKED.appId ?? SPACEWAR_APP_ID);

/**
 * Where the public matchmaking server lives for release builds.
 *
 * Order matters, and getting it wrong is not a small bug: with nothing set the
 * client falls back to `ws://127.0.0.1:8787`, so a customer who installs the
 * game and presses "Play online" is quietly pointed at a matchmaking server on
 * their own machine that nobody started. The env var wins so a self-hoster can
 * redirect an installed copy; `build-config.json`, baked in at package time by
 * scripts/package-desktop.mjs, is what makes a shipped build work at all.
 */
const DEFAULT_SERVER = process.env.HAULMATES_SERVER || BAKED.server || '';

/**
 * The renderer is an ES-module bundle, and Chromium refuses to load module
 * scripts over `file://` (opaque origin, CORS-blocked). Serving it from a
 * registered standard scheme fixes that and gives the page a secure context,
 * which the clipboard and gamepad APIs also require.
 */
const APP_SCHEME = 'haulmates';
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

let window: BrowserWindow | null = null;
let pendingJoinCode = '';
let localServer: { close(): Promise<void>; port: number } | null = null;

/* ------------------------------------------------------------ save data */

function savePath(): string {
  const dir = join(app.getPath('userData'), 'save');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function saveFile(key: string): string {
  return join(savePath(), saveName(key));
}

function saveName(key: string): string {
  return `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`;
}

/**
 * Read a save, preferring Steam Cloud.
 *
 * Steam syncs the cloud copy down before the process starts, so when it holds
 * the key it is the newest thing anywhere and the local file is a mirror one
 * machine behind. The local file is still what answers on a machine with no
 * Steam, with cloud saves switched off in the player's Steam settings, or on
 * the first launch after cloud was enabled — the one case where the mirror is
 * ahead of an empty cloud.
 */
function readSave(key: string): string | null {
  const cloud = steam.cloudRead(saveName(key));
  if (cloud !== null && cloud !== '') return cloud;
  try {
    return readFileSync(saveFile(key), 'utf8');
  } catch {
    return null;
  }
}

/** Write both copies. The local file is what a standalone launch reads back. */
function writeSave(key: string, value: string): boolean {
  steam.cloudWrite(saveName(key), value);
  try {
    writeFileSync(saveFile(key), value, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- window */

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 860,
    minHeight: 520,
    backgroundColor: '#05070f',
    show: false,
    autoHideMenuBar: true,
    title: 'HAULMATES',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  window.once('ready-to-show', () => {
    window?.show();
    if (process.env.HAULMATES_FULLSCREEN === '1') window?.setFullScreen(true);
  });

  // External links open in the player's browser, never inside the game window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const index = join(rendererRoot(), 'index.html');
  if (existsSync(index)) void window.loadURL(`${APP_SCHEME}://game/index.html`);
  else void window.loadURL(process.env.HAULMATES_DEV_URL ?? 'http://localhost:5173');

  window.on('closed', () => {
    window = null;
  });

  if (process.env.HAULMATES_SELFTEST === '1') runSelfTest(window);
}

/**
 * Headless smoke test for the packaged shell.
 *
 * Run with HAULMATES_SELFTEST=1 (under a virtual display on Linux) to confirm
 * that the window opens, the renderer bundle loads, the preload bridge is
 * reachable, and save data round-trips through the file system. It writes a
 * screenshot and exits non-zero on failure, so it can gate a release build.
 */
function runSelfTest(target: BrowserWindow): void {
  const shot = process.env.HAULMATES_SELFTEST_SHOT ?? join(app.getPath('temp'), 'haulmates-selftest.png');
  const finish = (ok: boolean, detail: unknown): void => {
    console.log(`SELFTEST ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(detail)}`);
    setTimeout(() => app.exit(ok ? 0 : 1), 150);
  };

  // Surface anything the renderer complains about; a silent failure here is
  // exactly the kind of thing that ships broken.
  target.webContents.on('console-message', (_event, level, message, line, source) => {
    console.log(`RENDERER[${level}] ${message} (${source}:${line})`);
  });
  target.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.log(`LOAD FAIL ${code} ${description} ${url}`);
  });
  target.webContents.on('preload-error', (_event, path, error) => {
    console.log(`PRELOAD ERROR ${path}: ${error}`);
  });

  target.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      target.webContents
        .executeJavaScript(
          `(() => {
             const app = window.HAULMATES;
             const bridge = window.haulmates;
             if (bridge && bridge.writeSave) bridge.writeSave('selftest', JSON.stringify({ ok: 1 }));
             return {
               booted: Boolean(app),
               screen: app ? app.screen : null,
               bridge: Boolean(bridge && bridge.available),
               saveRoundTrip: bridge ? bridge.readSave('selftest') : null,
               attractTick: app && app.attractTick ? app.attractTick : 0,
               // What the shipped build will actually try to connect to. A
               // release whose matchmaking server silently resolves to
               // localhost is the single most expensive thing to ship here.
               injectedServer: window.HAULMATES_SERVER || null,
               serverUrl: app && app.settings ? app.settings.serverUrl : null,
               version: app ? app.version : null,
             };
           })()`,
          true,
        )
        .then(async (result: Record<string, unknown>) => {
          try {
            const image = await target.webContents.capturePage();
            writeFileSync(shot, image.toPNG());
          } catch {
            /* a screenshot failure is not a product failure */
          }
          const ok = result.booted === true && result.bridge === true && result.saveRoundTrip !== null;
          finish(ok, { ...result, screenshot: shot });
        })
        .catch((err: unknown) => finish(false, { error: String(err) }));
    }, 5000);
  });

  setTimeout(() => finish(false, { error: 'self test timed out' }), 40_000);
}

/* -------------------------------------------------------------- lifecycle */

// Before anything asks Electron for a window: the overlay is switched on with
// command-line switches, and Chromium has stopped reading those by the time
// the app is ready.
steam.prepareOverlay();

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // A friend clicked "Join game" while we were already running.
    const code = steam.parseJoinArgument(argv);
    if (code) deliverJoin(code);
    else takeLobbyArgument(argv);
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(() => {
    registerRendererProtocol();
    // The binding pumps Steam's callbacks on its own 30 Hz timer from the
    // moment init returns, so the overlay, invites and achievement toasts need
    // no pump of ours.
    const status = steam.init(STEAM_APP_ID);
    if (status.available) {
      console.log(`Steam ready for ${status.playerName} (${status.steamId})`);
      if (status.reason) console.log(`Steam warning: ${status.reason}`);
    } else {
      console.log(`Steam unavailable (${status.reason}) — running standalone`);
    }
    steam.onJoinRequest(deliverJoin);
    pendingJoinCode = steam.parseJoinArgument(process.argv);
    if (!pendingJoinCode) takeLobbyArgument(process.argv);
    createWindow();
  });

  app.on('window-all-closed', () => {
    void shutdownLocalServer().finally(() => app.quit());
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function rendererRoot(): string {
  return join(__dirname, '..', 'renderer');
}

function registerRendererProtocol(): void {
  const root = normalize(rendererRoot());
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '' || rel === '/') rel = '/index.html';
    const target = normalize(join(root, rel));
    // Never serve anything outside the bundled renderer directory.
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 });
    }
    if (!existsSync(target)) {
      return net.fetch(pathToFileURL(join(root, 'index.html')).toString());
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

/**
 * Accepting a Steam invite launches us with a lobby id rather than a room
 * code, and the code has to be fetched off the lobby. That round trip lands
 * after the window exists, so it arrives by the same event a warm join does.
 */
function takeLobbyArgument(argv: string[]): void {
  const id = steam.parseLobbyArgument(argv);
  if (id !== null) steam.joinLobbyById(id);
}

function deliverJoin(code: string): void {
  pendingJoinCode = code;
  window?.webContents.send('haulmates:join', code);
}

async function shutdownLocalServer(): Promise<void> {
  if (!localServer) return;
  try {
    await localServer.close();
  } catch {
    /* shutting down anyway */
  }
  localServer = null;
}

/* -------------------------------------------------------------------- ipc */

const SAVE_KEYS = ['settings', 'stats', 'achievements', 'hints', 'bindings'];

/**
 * Synchronous because the renderer needs its settings before the first frame.
 * One blocking round trip at startup is cheaper than the alternative, which is
 * the game reading empty defaults and then overwriting the player's real save.
 */
ipcMain.on('haulmates:bootstrap-sync', (event) => {
  const status = steam.getStatus();
  const code = pendingJoinCode;
  pendingJoinCode = '';
  const saves: Record<string, string> = {};
  for (const key of SAVE_KEYS) {
    const raw = readSave(key);
    // Absent means first launch, or a save we have never written.
    if (raw !== null) saves[key] = raw;
  }
  event.returnValue = {
    steam: status.available,
    steamId: status.steamId,
    playerName: status.playerName,
    version: app.getVersion(),
    defaultServer: DEFAULT_SERVER,
    joinCode: code,
    saves,
  };
});

ipcMain.on('haulmates:achievement', (_event, id: string) => steam.unlockAchievement(String(id)));
ipcMain.on('haulmates:clear-achievement', (_event, id: string) => steam.clearAchievement(String(id)));
ipcMain.on('haulmates:stat', (_event, name: string, value: number) => steam.setStat(String(name), Number(value) || 0));
ipcMain.on('haulmates:presence', (_event, key: string, value: string) => steam.setRichPresence(String(key), String(value)));
// An invoke, not a send: the game tells the player whether the overlay opened,
// and it can only do that if the answer comes back.
ipcMain.handle('haulmates:invite', (_event, code: string) => steam.inviteFriend(String(code)));
ipcMain.on('haulmates:open-url', (_event, url: string) => {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
});
ipcMain.on('haulmates:quit', () => app.quit());
ipcMain.on('haulmates:fullscreen', () => window?.setFullScreen(!window.isFullScreen()));

ipcMain.handle('haulmates:read-save', (_event, key: string) => readSave(key));

ipcMain.handle('haulmates:write-save', (_event, key: string, value: string) => writeSave(key, String(value)));

/**
 * Host a match from this machine. Useful on a LAN, at a LAN party, or when the
 * public server is unreachable — the player's friend connects to their address.
 */
ipcMain.handle('haulmates:host-server', async () => {
  if (localServer) return { url: `ws://127.0.0.1:${localServer.port}`, port: localServer.port };
  // The matchmaking server is bundled into a single file at package time, so
  // hosting from the player's own machine needs no node_modules at runtime.
  const bundle = join(__dirname, 'server.cjs');
  if (!existsSync(bundle)) throw new Error('local server bundle is missing from this build');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(bundle) as {
    startServer(options: { port: number; host: string }): Promise<{ port: number; close(): Promise<void> }>;
  };
  const handle = await mod.startServer({ port: Number(process.env.HAULMATES_HOST_PORT ?? 0), host: '0.0.0.0' });
  localServer = handle;
  return { url: `ws://127.0.0.1:${handle.port}`, port: handle.port };
});

ipcMain.handle('haulmates:stop-server', async () => {
  await shutdownLocalServer();
  return true;
});
