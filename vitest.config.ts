import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@haulmates/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'node',
    env: { HAULMATES_LOG: 'error' },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
