#!/usr/bin/env node
import { startServer } from './index.js';
import { log } from './log.js';

/**
 * Command line entry point.
 *
 * Kept separate from the library so that `index.ts` can be bundled into the
 * desktop shell without dragging in `import.meta`, which has no meaning in the
 * CommonJS output that Electron's main process loads.
 */
async function main(): Promise<void> {
  const staticFlag = process.argv.indexOf('--static');
  const handle = await startServer({
    staticDir: staticFlag >= 0 ? process.argv[staticFlag + 1] : undefined,
  });
  const shutdown = async (): Promise<void> => {
    log.info('shutting down');
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((err) => {
  log.error('failed to start', err);
  process.exit(1);
});
