import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';

// The city data stay plain scripts that set window.CITY, window.TRANSIT, window.FORTRESS and window.TERRAIN (written
// by the tools in tools/; src/boot.js downloads them with a progress bar); they are copied next to the bundle as they
// are, with the old address of the page.
const STATIC = ['citydata.js', 'transit.js', 'fortress.js', 'terrain.js', 'daugavpils.html'];

export default defineConfig({
  base: './',
  publicDir: false,
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 1500 },
  plugins: [{ name: 'city-data', apply: 'build', closeBundle() { for (const f of STATIC) cpSync(f, 'dist/' + f); } }],
});
