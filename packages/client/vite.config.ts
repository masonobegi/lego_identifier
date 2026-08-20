import { defineConfig } from 'vite';

/**
 * HAULMATES_SINGLE builds everything into one JavaScript file so
 * scripts/bundle-web.mjs can inline the whole game into a single HTML page —
 * useful for handing someone a playable copy with nothing to install.
 */
const single = process.env.HAULMATES_SINGLE === '1';

export default defineConfig({
  // Relative asset paths so the same build works from a web host and from
  // file:// inside the Electron shell.
  base: './',
  build: {
    target: 'es2022',
    outDir: single ? 'dist-web' : 'dist',
    assetsDir: 'assets',
    sourcemap: !single,
    rollupOptions: {
      output: single ? { inlineDynamicImports: true } : { manualChunks: { core: ['@haulmates/core'] } },
    },
  },
  server: { port: 5173, strictPort: false },
});
