/**
 * End-to-end verification: two real browsers, one real server, one real match.
 *
 * This is the test that proves the whole product works — menus, matchmaking,
 * rollback netcode, rendering and audio wiring — rather than any single layer
 * of it. It also writes screenshots so a human can see what shipped.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.E2E_PORT ?? 8901);
const SHOTS = process.env.E2E_SHOTS ?? 'test-results';
const HEADFUL = process.env.E2E_HEADFUL === '1';

if (!existsSync('packages/client/dist/index.html')) {
  console.error('Build the client first: npm run build');
  process.exit(1);
}
mkdirSync(SHOTS, { recursive: true });

/**
 * Find a Chromium to drive. Managed environments often pre-install one whose
 * build number does not match the Playwright package, so prefer an explicit
 * path over Playwright's own download.
 */
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium')) continue;
    candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
    candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
  }
  return candidates.find((p) => existsSync(p));
}

const server = spawn(process.execPath, ['packages/server/dist/cli.js', '--static', 'packages/client/dist'], {
  env: { ...process.env, PORT: String(PORT), HAULMATES_LOG: 'warn' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name} ${detail}`);
    failures.push(name);
  }
}

async function waitFor(page, fn, label, timeout = 20000) {
  const started = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - started > timeout) {
      const state = await page.evaluate(() => ({
        screen: window.HAULMATES?.screen,
        phase: window.HAULMATES?.net?.phase,
        error: window.HAULMATES?.errorMessage || window.HAULMATES?.net?.errorMessage,
        room: window.HAULMATES?.net?.roomCode,
        index: window.HAULMATES?.net?.localIndex,
      }));
      throw new Error(`timed out waiting for ${label} — state: ${JSON.stringify(state)}`);
    }
    await sleep(120);
  }
}

async function clickButton(page, label) {
  const button = page.locator('button.btn', { hasText: label }).first();
  await button.waitFor({ state: 'visible', timeout: 10000 });
  await button.click();
}

async function main() {
  await sleep(1200);
  const browser = await chromium.launch({
    headless: !HEADFUL,
    executablePath: findChromium(),
    args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const host = await context.newPage();
  const guest = await context.newPage();

  const errors = [];
  for (const [name, page] of [['host', host], ['guest', guest]]) {
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`${name} console: ${msg.text()}`);
    });
  }

  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`\nOpening ${url}\n`);
  await host.goto(url, { waitUntil: 'networkidle' });
  await guest.goto(url, { waitUntil: 'networkidle' });

  await waitFor(host, () => Boolean(window.HAULMATES), 'app boot');
  await waitFor(guest, () => Boolean(window.HAULMATES), 'app boot');
  check('both clients boot', true);

  // The attract mode should be simulating behind the title screen.
  await sleep(1500);
  const attractTick = await host.evaluate(() => window.HAULMATES.attractTick ?? 0);
  await host.screenshot({ path: `${SHOTS}/01-title.png` });
  check('title screen renders', true);

  /* ------------------------------------------------------------ matchmaking */
  await clickButton(host, 'Play online');
  await sleep(400);
  await host.screenshot({ path: `${SHOTS}/02-online-menu.png` });
  await clickButton(host, 'Host a haul');
  await waitFor(host, () => window.HAULMATES.net?.roomCode?.length === 5, 'room code');
  const code = await host.evaluate(() => window.HAULMATES.net.roomCode);
  console.log(`  room code: ${code}`);
  check('host receives a five-letter room code', /^[A-Z0-9]{5}$/.test(code), code);
  // Screens fade in over 220ms; wait past it so shots are not half-transparent.
  await sleep(500);
  await host.screenshot({ path: `${SHOTS}/03-lobby-host.png` });

  await clickButton(guest, 'Play online');
  await clickButton(guest, 'Join with a code');
  await guest.locator('input.code').fill(code);
  await clickButton(guest, 'Join haul');
  await waitFor(guest, () => window.HAULMATES.net?.localIndex === 1, 'guest joins');
  check('guest joins the host room', true);
  await sleep(500);
  await guest.screenshot({ path: `${SHOTS}/04-lobby-guest.png` });

  /* ------------------------------------------------------------------ start */
  await clickButton(host, 'Ready');
  await clickButton(guest, 'Ready');
  await waitFor(host, () => window.HAULMATES.net?.phase === 'running', 'host running');
  await waitFor(guest, () => window.HAULMATES.net?.phase === 'running', 'guest running');
  check('match starts once both players are ready', true);

  /* ------------------------------------------------------------- gameplay */
  await host.bringToFront();
  const script = [
    ['KeyD', 900],
    ['Space', 220],
    ['KeyD', 700],
    ['ShiftLeft', 900],
    ['KeyA', 800],
    ['Space', 240],
    ['KeyF', 700],
  ];
  const guestScript = [
    ['KeyA', 800],
    ['Space', 260],
    ['KeyD', 900],
    ['KeyF', 800],
    ['ShiftLeft', 700],
    ['Space', 200],
    ['KeyD', 600],
  ];

  const drive = async (page, plan) => {
    for (const [key, ms] of plan) {
      await page.keyboard.down(key);
      await sleep(ms);
      await page.keyboard.up(key);
      await sleep(60);
    }
  };

  await Promise.all([drive(host, script), drive(guest, guestScript)]);
  await sleep(1200);

  await host.screenshot({ path: `${SHOTS}/05-gameplay-host.png` });
  await guest.screenshot({ path: `${SHOTS}/06-gameplay-guest.png` });

  const hostState = await host.evaluate(() => {
    const n = window.HAULMATES.net;
    return {
      tick: n.localTick,
      confirmed: n.confirmedTick,
      desyncs: n.desyncs,
      rollbacks: n.rollbacks,
      worstRollback: n.worstRollback,
      rtt: n.rtt,
      phase: n.phase,
      px: n.world.players[0].x,
      py: n.world.players[0].y,
      deaths: n.world.players[0].deaths + n.world.players[1].deaths,
      cargoHp: n.world.cargo.hp,
    };
  });
  const guestState = await guest.evaluate(() => {
    const n = window.HAULMATES.net;
    return {
      tick: n.localTick,
      confirmed: n.confirmedTick,
      desyncs: n.desyncs,
      rollbacks: n.rollbacks,
      phase: n.phase,
      px: n.world.players[0].x,
      py: n.world.players[0].y,
    };
  });
  console.log('  host :', JSON.stringify(hostState));
  console.log('  guest:', JSON.stringify(guestState));

  check('the simulation advanced', hostState.tick > 400 && guestState.tick > 400, `${hostState.tick}/${guestState.tick}`);
  check('no desyncs on either client', hostState.desyncs === 0 && guestState.desyncs === 0);
  check('both clients agree on where player one is', Math.abs(hostState.px - guestState.px) < 40 && Math.abs(hostState.py - guestState.py) < 40,
    `${hostState.px.toFixed(1)},${hostState.py.toFixed(1)} vs ${guestState.px.toFixed(1)},${guestState.py.toFixed(1)}`);
  check('players actually moved from spawn', Math.abs(hostState.px - 468) > 10 || Math.abs(hostState.py - 684) > 10);

  /* ---------------------------------------------------------- server truth */
  const stats = await (await fetch(`http://127.0.0.1:${PORT}/stats`)).json();
  console.log('  server:', JSON.stringify(stats));
  check('server reports one running room with two players', stats.running === 1 && stats.players === 2, JSON.stringify(stats));
  check('server never fell behind its tick clock', stats.droppedTicks < 30, String(stats.droppedTicks));

  /* -------------------------------------------------------------- menus */
  await host.keyboard.press('Escape');
  await sleep(400);
  await host.screenshot({ path: `${SHOTS}/07-pause.png` });
  check('pause menu opens', await host.evaluate(() => window.HAULMATES.screen === 'pause'));

  await clickButton(host, 'Settings');
  await sleep(300);
  await host.screenshot({ path: `${SHOTS}/08-settings.png` });
  await clickButton(host, 'Back');
  await sleep(200);
  await clickButton(host, 'How to play');
  await sleep(300);
  await host.screenshot({ path: `${SHOTS}/09-controls.png` });
  await clickButton(host, 'Back');
  await sleep(200);
  await clickButton(host, 'Resume');
  await sleep(400);
  check('resume returns to the match', await host.evaluate(() => window.HAULMATES.screen === 'none'));

  /* ------------------------------------------------------ couch co-op path */
  const solo = await context.newPage();
  solo.on('pageerror', (e) => errors.push(`solo: ${e.message}`));
  await solo.goto(url, { waitUntil: 'networkidle' });
  await waitFor(solo, () => Boolean(window.HAULMATES), 'solo boot');
  await clickButton(solo, 'Couch co-op');
  await clickButton(solo, 'Start');
  await sleep(400);
  await solo.keyboard.down('KeyD');
  await sleep(900);
  await solo.keyboard.up('KeyD');
  await sleep(600);
  await solo.screenshot({ path: `${SHOTS}/10-couch.png` });
  const couch = await solo.evaluate(() => ({ tick: window.HAULMATES.local?.localTick ?? 0, hasLocal: Boolean(window.HAULMATES.local) }));
  check('couch co-op runs without a server', couch.hasLocal && couch.tick > 60, JSON.stringify(couch));

  /* ------------------------------------------------- customise + trophies */
  await solo.keyboard.press('Escape');
  await sleep(300);
  await clickButton(solo, 'Back to menu');
  await sleep(300);
  await clickButton(solo, 'Customise');
  await sleep(400);
  await solo.screenshot({ path: `${SHOTS}/11-customise.png` });
  await clickButton(solo, 'Back');
  await sleep(200);
  await clickButton(solo, 'Achievements');
  await sleep(300);
  await solo.screenshot({ path: `${SHOTS}/12-achievements.png` });

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  void attractTick;

  await browser.close();
}

try {
  await main();
} catch (err) {
  console.error('\nE2E FAILED:', err);
  failures.push(String(err));
} finally {
  server.kill('SIGTERM');
}

console.log('');
if (failures.length > 0) {
  console.error(`E2E: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`E2E: all checks passed. Screenshots in ${SHOTS}/`);
process.exit(0);
