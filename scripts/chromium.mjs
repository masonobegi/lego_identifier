/**
 * Find the Chromium this machine already has.
 *
 * CI images and dev containers pre-install browsers under
 * PLAYWRIGHT_BROWSERS_PATH and set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, so asking
 * Playwright to fetch its own copy both wastes a download and fails on hosts
 * with no outbound access. Returning undefined lets Playwright fall back to
 * whatever it manages itself.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium')) continue;
    candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
    candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
  }
  if (existsSync(join(root, 'chromium'))) candidates.push(join(root, 'chromium'));
  return candidates.find((p) => existsSync(p));
}
