import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the same build works from a web host and from
  // file:// inside the Electron shell.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: { core: ['@haulmates/core'] },
      },
    },
  },
  server: { port: 5173, strictPort: false },
});
