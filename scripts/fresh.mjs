/**
 * Refuse to test, or photograph, yesterday's build.
 *
 * Two scripts here read a bundle off disk and never build one, so a source edit
 * since the last build means they are reporting on code that is not in the
 * tree. Neither fails in a way that says so. `e2e` with a bumped
 * PROTOCOL_VERSION died with "Your game version does not match your friend's"
 * and a timeout waiting for a room code, which reads as a netcode bug and is a
 * stale directory. `shots` is worse: it silently renders the previous build,
 * and its output is what goes on the store page.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** When the most recently written file anywhere under `dir` was written. */
function newest(dir) {
  if (!existsSync(dir)) return 0;
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const at = statSync(join(entry.parentPath ?? entry.path, entry.name)).mtimeMs;
    if (at > latest) latest = at;
  }
  return latest;
}

/**
 * When each package's build last ran — not when its output last changed.
 *
 * An incremental tsc that finds nothing to do rewrites no .js at all, so the
 * newest file in `dist` can be days older than a build that ran a second ago,
 * and comparing against it condemns a perfectly current tree forever. The
 * buildinfo is rewritten on every invocation, which is the question actually
 * being asked. Vite has no equivalent and rewrites its output every time, so
 * for the bundles the output is the marker.
 */
const MARKERS = {
  core: 'packages/core/tsconfig.tsbuildinfo',
  server: 'packages/server/tsconfig.tsbuildinfo',
  client: 'packages/client/dist/index.html',
  web: 'dist/haulmates.html',
};

/** A package is stale if anything it is built from was touched after it. */
const BUILT_FROM = {
  core: ['core'],
  server: ['core', 'server'],
  client: ['core', 'client'],
  web: ['core', 'client'],
};

function stamp(path) {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

/**
 * Exit unless every named build is newer than the sources it was built from.
 *
 * Each build is checked against its own inputs rather than against every source
 * in the repo: editing a menu does not make the simulation's build stale, and
 * saying it does trains people to ignore the check.
 */
export function requireFreshBuild(names, remedy) {
  for (const name of names) {
    const marker = MARKERS[name];
    const built = stamp(marker);
    if (!built) {
      console.error(`No ${name} build (${marker} is missing). Run: ${remedy}`);
      process.exit(1);
    }
    for (const from of BUILT_FROM[name]) {
      const edited = newest(`packages/${from}/src`);
      if (edited > built) {
        console.error(`The ${name} build predates packages/${from}/src. Run: ${remedy}`);
        process.exit(1);
      }
    }
  }
}
