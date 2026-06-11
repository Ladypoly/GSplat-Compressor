import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// Fully client-side static app. No backend: all compression runs in the browser
// via @playcanvas/splat-transform, files never leave the machine.
export default defineConfig({
  root: path.join(here, 'web'),
  // Relative base so it works from a GitHub Pages project subpath (/<repo>/).
  base: './',
  // Don't pre-bundle splat-transform: served from its real lib/ dir so the
  // emscripten WebP module's `new URL('webp.wasm', import.meta.url)` resolves
  // (needed for SOG output) in both dev and the production build.
  optimizeDeps: { exclude: ['@playcanvas/splat-transform'] },
  assetsInclude: ['**/*.wasm'],
  server: { port: 5173 },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // The WebP emscripten module loads its wasm via
        // `new URL('webp.wasm', import.meta.url)`, which Vite leaves unhashed.
        // Keep .wasm filenames unhashed so that runtime reference resolves.
        assetFileNames: (info) => {
          const name = info.name || (info.names && info.names[0]) || '';
          if (name.endsWith('.wasm')) return 'assets/[name][extname]';
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
});
