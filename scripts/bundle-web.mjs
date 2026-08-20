/**
 * Bundle the whole game into one HTML file.
 *
 * HAULMATES ships with no runtime assets — the art is canvas paths, the audio
 * is synthesised, the levels are ASCII compiled into the bundle — so the entire
 * game fits in a single self-contained page with no network access of any kind.
 * That makes it trivial to hand someone a playable copy: one file, double-click,
 * no install, no server. The page flags itself as an offline build so the menu
 * says online play is unavailable rather than offering it and then failing to
 * connect; local play and the bot partner need nothing.
 *
 * Pass --fragment to emit body content only (no <!doctype>, <html> or <body>),
 * which is what an embedded host that supplies its own page skeleton wants.
 * Pass --no-check to skip actually opening the result in a browser.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { findChromium } from './chromium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'packages', 'client');
const outDir = join(client, 'dist-web');

const fragment = process.argv.includes('--fragment');
const target = process.argv.find((a) => a.startsWith('--out='))?.slice(6)
  ?? join(root, 'dist', 'haulmates.html');

console.log('building a single-file bundle…');
execFileSync('npx', ['vite', 'build'], {
  cwd: client,
  stdio: 'inherit',
  env: { ...process.env, HAULMATES_SINGLE: '1' },
});

const assets = readdirSync(join(outDir, 'assets'));
const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
if (!jsName || !cssName) throw new Error('the single-file build produced no js/css pair');
const scripts = assets.filter((f) => f.endsWith('.js'));
if (scripts.length !== 1) {
  throw new Error(`expected exactly one script, got ${scripts.length}: ${scripts.join(', ')}`);
}

const js = readFileSync(join(outDir, 'assets', jsName), 'utf8');
const css = readFileSync(join(outDir, 'assets', cssName), 'utf8');

// </script> inside a string literal would close the tag we are writing it into.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const body = `<title>HAULMATES</title>
<style>
${css}
</style>
<div id="app">
  <canvas id="stage"></canvas>
  <div id="overlay"></div>
  <div id="toast" role="status" aria-live="polite"></div>
</div>
<script>window.HAULMATES_OFFLINE = true;</script>
<script type="module">
${safeJs}
</script>
`;

const html = fragment
  ? body
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="description" content="A two-player co-op physics disaster about a rope, a crate, and the end of a friendship." />
${body}</head>
<body></body>
</html>
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, html);
const kb = (html.length / 1024).toFixed(0);
console.log(`wrote ${target} (${kb} KB${fragment ? ', body fragment' : ''})`);

/* ------------------------------------------------------- prove it still runs */

if (!process.argv.includes('--no-check')) {
  // A single-file bundle that does not boot is worse than no bundle at all,
  // because it looks finished. Open it and play a few seconds with the bot.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // A fragment is only ever seen inside somebody else's page skeleton, so
  // check it inside one rather than checking something nobody will load.
  let openUrl = pathToFileURL(target).href;
  let scratch = '';
  if (fragment) {
    scratch = join(dirname(target), '.fragment-check.html');
    writeFileSync(scratch, `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${body}</body></html>\n`);
    openUrl = pathToFileURL(scratch).href;
  }
  await page.goto(openUrl);
  await page.waitForFunction(() => Boolean(window.HAULMATES), null, { timeout: 20000 });

  const click = async (label) => {
    const btn = page.locator('button.btn', { hasText: label }).first();
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.click();
  };
  await click('Play on this machine');
  await click('A bot');
  await click('Start');
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => window.HAULMATES.local.world.players[1].y);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1100);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(800);
  }
  const state = await page.evaluate(() => ({
    tick: window.HAULMATES.local.localTick,
    y: window.HAULMATES.local.world.players[1].y,
    cursor: window.HAULMATES.local.bots[1].cursor,
  }));
  await browser.close();
  if (scratch) rmSync(scratch, { force: true });

  const problems = [];
  if (errors.length) problems.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  if (state.tick < 200) problems.push(`simulation barely advanced (${state.tick} ticks)`);
  // Route position, not displacement: the tower is a serpentine, so a bot two
  // ledges up can be standing almost exactly above where it started.
  if (state.cursor < 2) problems.push(`the bot did not set off (route cell ${state.cursor})`);
  if (problems.length) {
    console.error(`the single-file bundle does not work:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    `checked: boots from file://, ${state.tick} ticks simulated, ` +
      `bot reached route cell ${state.cursor} and climbed ${Math.round(before - state.y)}px`,
  );
}
