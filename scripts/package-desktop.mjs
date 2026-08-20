/**
 * Assemble the desktop build.
 *
 * Builds every workspace, copies the web renderer into the Electron shell, and
 * (unless --skip-installer) runs electron-builder for the requested platform.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const platform = args.find((a) => ['--win', '--linux', '--mac'].includes(a)) ?? '--linux';
const skipInstaller = args.includes('--skip-installer');

function run(command, commandArgs, options = {}) {
  console.log(`> ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) {
    console.error(`\nFailed: ${command} ${commandArgs.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

run('npm', ['run', 'build']);
run('npm', ['run', 'build', '-w', '@haulmates/desktop']);

const rendererSource = join('packages', 'client', 'dist');
const rendererTarget = join('packages', 'desktop', 'renderer');
if (!existsSync(join(rendererSource, 'index.html'))) {
  console.error('The client build is missing. Run npm run build first.');
  process.exit(1);
}
rmSync(rendererTarget, { recursive: true, force: true });
mkdirSync(rendererTarget, { recursive: true });
cpSync(rendererSource, rendererTarget, { recursive: true });
console.log(`Copied renderer -> ${rendererTarget}`);

/* ------------------------------------------------------- baked build config */

// Two identities have to survive into the shipped app, and both used to be
// read from the environment inside the Electron main process — which reads the
// *player's* environment at launch, not the one the release was built in. So
// both were silently ignored: the game pointed every buyer at their own
// localhost, and identified itself to Steam as Spacewar.
const serverUrl = (process.env.HAULMATES_SERVER ?? '').trim();
const appId = Number(process.env.HAULMATES_APP_ID ?? '0');
const configFile = join('packages', 'desktop', 'build-config.json');
const release = !skipInstaller;
const problems = [];

if (serverUrl) {
  if (!/^wss?:\/\//.test(serverUrl)) {
    console.error(`HAULMATES_SERVER must be a ws:// or wss:// URL, got: ${serverUrl}`);
    process.exit(1);
  }
  if (serverUrl.startsWith('ws://') && !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(serverUrl)) {
    console.warn(`WARNING: ${serverUrl} is unencrypted. Browsers refuse ws:// from an https:// page; ship wss://.`);
  }
} else {
  problems.push(
    'No HAULMATES_SERVER. "Play online" fails for everyone who installs this — they\n' +
      '  get pointed at their own localhost. Couch co-op, the bot and "Host from this\n' +
      '  machine" still work.  HAULMATES_SERVER=wss://play.example.com',
  );
}

if (!appId || appId === 480) {
  problems.push(
    'No HAULMATES_APP_ID (or still 480, which is Spacewar). Steamworks calls are all\n' +
      '  wrapped, so achievements, stats, rich presence and friend invites would fail\n' +
      '  silently rather than crash.  HAULMATES_APP_ID=<your id>',
  );
}

const config = {};
if (serverUrl) config.server = serverUrl;
if (appId && appId !== 480) config.appId = appId;

if (Object.keys(config).length > 0) {
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Baked build config -> ${JSON.stringify(config)}`);
} else {
  rmSync(configFile, { force: true });
}

if (problems.length > 0) {
  const text = problems.map((p) => `- ${p}`).join('\n');
  if (release) {
    // An installer is a thing somebody ships to a customer. Refuse to produce
    // one that cannot do what the store page says it does.
    console.error(`\nRefusing to build a release installer:\n${text}\n\nPass --skip-installer to build the payload anyway.`);
    process.exit(1);
  }
  console.warn(`\nWARNING — payload build only:\n${text}\n`);
}

// "Host from my machine" runs the matchmaking server inside the Electron main
// process. Bundling it to a single file means the packaged app carries no
// node_modules and no workspace symlinks for the installer to resolve.
run('npx', [
  'esbuild',
  join('packages', 'server', 'src', 'index.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node20',
  '--external:electron',
  '--legal-comments=none',
  `--outfile=${join('packages', 'desktop', 'dist', 'server.cjs')}`,
]);

if (skipInstaller) {
  console.log('\nDesktop payload ready (installer skipped).');
  process.exit(0);
}

// npm workspaces hoist electron to the repository root, where electron-builder
// does not look. Detect the installed version and pass it explicitly.
const electronVersion = JSON.parse(readFileSync(join('node_modules', 'electron', 'package.json'), 'utf8')).version;
console.log(`Using electron ${electronVersion}`);
// Call the binary directly rather than through npx: in a workspace the root
// bin directory is not always on the resolved path.
const builder = join('node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
run(
  builder,
  [
    platform,
    // The config is discovered inside the project directory; passing a path
    // here would be resolved relative to it and double up the prefix.
    '--project',
    join('packages', 'desktop'),
    `--config.electronVersion=${electronVersion}`,
  ],
  { env: { ...process.env, ELECTRON_BUILDER_CACHE: join(process.cwd(), '.cache', 'electron-builder') } },
);
console.log('\nBuild complete. See packages/desktop/release/');
