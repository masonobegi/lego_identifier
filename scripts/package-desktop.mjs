/**
 * Assemble the desktop build.
 *
 * Builds every workspace, copies the web renderer into the Electron shell, and
 * (unless --skip-installer) runs electron-builder for the requested platform.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

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

/* ------------------------------------------------------------ macOS signing */

/**
 * Whether this build has a Developer ID to sign with.
 *
 * `CSC_LINK` is a certificate electron-builder imports, `CSC_NAME` an identity
 * already in the keychain; either is enough. With neither, the mac path is
 * asked for an unsigned bundle explicitly rather than left to guess from
 * whatever happens to be in the local keychain, which is how a build machine
 * silently signs with somebody's personal certificate.
 */
function macSigningIdentity() {
  return (process.env.CSC_NAME ?? process.env.CSC_LINK ?? '').trim();
}

/**
 * Credentials for `notarytool`, in either of the two forms Apple accepts.
 *
 * An App Store Connect API key is the one to use in CI — it does not expire
 * with a person's password and it is not tied to their 2FA. The Apple ID form
 * is here because it is what somebody signing a build on their own laptop
 * already has.
 */
function notaryCredentials() {
  const env = process.env;
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return ['--key', env.APPLE_API_KEY, '--key-id', env.APPLE_API_KEY_ID, '--issuer', env.APPLE_API_ISSUER];
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID];
  }
  return null;
}

function macBundle() {
  const releases = join('packages', 'desktop', 'release');
  if (!existsSync(releases)) return '';
  // electron-builder names the folder after the architecture it built, so a
  // universal build lands in mac-universal and an arch-specific one does not.
  for (const entry of readdirSync(releases)) {
    const bundle = join(releases, entry, 'HAULMATES.app');
    if (existsSync(bundle)) return bundle;
  }
  return '';
}

/**
 * Notarize and staple, which is the part electron-builder will not do for a
 * `dir` target — it notarizes installers, and Steam ships the bundle itself.
 *
 * Skipping any of this is a warning rather than an error: a developer building
 * on their own machine to try something needs the bundle, and only a build
 * that goes to a customer needs Apple's signature on it. What is not allowed
 * is being quiet about which one just came out.
 */
function signAndNotarizeMac() {
  const bundle = macBundle();
  if (!bundle) {
    console.warn('\nWARNING: no HAULMATES.app in packages/desktop/release — nothing to notarize.');
    return;
  }
  if (!macSigningIdentity()) {
    console.warn(`\nWARNING: ${bundle} is UNSIGNED and NOT NOTARIZED.`);
    console.warn('  Current macOS refuses to launch it: a customer gets "the app is damaged".');
    console.warn('  Set CSC_LINK (a .p12, base64 or a path) and CSC_KEY_PASSWORD, or CSC_NAME,');
    console.warn('  plus APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER for notarization.');
    return;
  }
  if (process.platform !== 'darwin') {
    console.warn(`\nWARNING: ${bundle} was signed off a Mac and cannot be notarized here.`);
    console.warn('  notarytool and stapler ship with Xcode. Re-run this on macOS before uploading.');
    return;
  }
  const credentials = notaryCredentials();
  if (!credentials) {
    console.warn(`\nWARNING: ${bundle} is signed but NOT NOTARIZED — Gatekeeper still blocks it.`);
    console.warn('  Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER (or APPLE_ID,');
    console.warn('  APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID) and build again.');
    return;
  }

  // notarytool takes an archive, never a bundle directory, and ditto is the
  // only zip that preserves the symlinks and extended attributes inside a
  // .app. A zip made any other way is rejected as an invalid bundle.
  const archive = join(dirname(bundle), 'HAULMATES-notarize.zip');
  rmSync(archive, { force: true });
  run('ditto', ['-c', '-k', '--keepParent', bundle, archive]);
  run('xcrun', ['notarytool', 'submit', archive, ...credentials, '--wait']);
  // Stapling writes the ticket into the bundle so it launches on a machine
  // that cannot reach Apple — which, for a game, is most of them at least once.
  run('xcrun', ['stapler', 'staple', bundle]);
  rmSync(archive, { force: true });
  const assess = spawnSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle], { encoding: 'utf8' });
  console.log(`Gatekeeper: ${(assess.stderr || assess.stdout || '').trim() || 'no answer from spctl'}`);
  console.log(`Signed, notarized and stapled: ${bundle}`);
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
const builderArgs = [
  platform,
  // The config is discovered inside the project directory; passing a path
  // here would be resolved relative to it and double up the prefix.
  '--project',
  join('packages', 'desktop'),
  `--config.electronVersion=${electronVersion}`,
];
// Say "do not sign" out loud when there is nothing to sign with. Left to
// itself electron-builder picks whatever Developer ID it finds in the local
// keychain, so a build on somebody's laptop goes out under their name.
if (platform === '--mac' && !macSigningIdentity()) builderArgs.push('--config.mac.identity=null');
run(builder, builderArgs, {
  env: { ...process.env, ELECTRON_BUILDER_CACHE: join(process.cwd(), '.cache', 'electron-builder') },
});
console.log('\nBuild complete. See packages/desktop/release/');
if (platform === '--mac') signAndNotarizeMac();
