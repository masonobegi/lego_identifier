/**
 * Boot the packaged Electron shell headlessly and confirm the game runs inside
 * it — window opens, renderer bundle loads, preload bridge answers, save data
 * round-trips to disk. On Linux this runs under Xvfb.
 */
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const shot = join(process.cwd(), 'test-results', 'desktop-selftest.png');
const renderer = join('packages', 'desktop', 'renderer', 'index.html');
if (!existsSync(renderer)) {
  console.error('Run: node scripts/package-desktop.mjs --skip-installer');
  process.exit(1);
}

const hasXvfb = process.platform === 'linux' && spawnSync('which', ['xvfb-run']).status === 0;
const electron = join('node_modules', '.bin', 'electron');
const args = ['packages/desktop', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
const command = hasXvfb ? 'xvfb-run' : electron;
const commandArgs = hasXvfb ? ['-a', '--server-args=-screen 0 1280x800x24', electron, ...args] : args;

console.log(`> ${command} ${commandArgs.join(' ')}\n`);
const child = spawn(command, commandArgs, {
  env: {
    ...process.env,
    HAULMATES_SELFTEST: '1',
    HAULMATES_SELFTEST_SHOT: shot,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (d) => {
  output += d.toString();
  process.stdout.write(d);
});
child.stderr.on('data', (d) => process.stderr.write(d));

const timer = setTimeout(() => {
  console.error('\nDesktop self test timed out.');
  child.kill('SIGKILL');
  process.exit(1);
}, 90_000);

child.on('exit', (code) => {
  clearTimeout(timer);
  const passed = /SELFTEST PASS/.test(output);
  if (passed && code === 0) {
    console.log(`\nDesktop self test passed. Screenshot: ${shot}`);
    process.exit(0);
  }
  console.error(`\nDesktop self test failed (exit ${code}).`);
  process.exit(1);
});
