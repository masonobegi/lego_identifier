/**
 * Assemble the desktop build.
 *
 * Builds every workspace, copies the web renderer into the Electron shell, and
 * (unless --skip-installer) runs electron-builder for the requested platform.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
