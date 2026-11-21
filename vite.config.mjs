import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

// The city data stay plain scripts that set window.CITY, window.TRANSIT, window.FORTRESS, window.TERRAIN, window.SCHOOLS, window.PARKS, window.LIDAR and window.LIDAR_TREES (written
// by the tools in tools/; src/boot.js downloads them with a progress bar); they are copied next to the bundle as they
// are, with the old address of the page and the textures the page loads at run time.
const STATIC = ['citydata.js', 'transit.js', 'fortress.js', 'terrain.js', 'schools.js', 'parks.js', 'lidar.js', 'lidar-trees.js', 'trains.js', 'intercity.js', 'parking.js', 'yards.js', 'models', 'sounds', 'daugavpils.html', 'textures/water_normal.webp', 'textures/ground_grass.webp', 'textures/ground_dirt.webp', 'textures/detail_grass.webp', 'textures/detail_asph.webp', 'textures/detail_pave.webp', 'textures/detail_gravel.webp', 'textures/brick_red.webp', 'textures/brick_white.webp', 'textures/bark_birch.webp', 'textures/bark_pine.webp', 'textures/bark_spruce.webp'];

// Incremental copy: the static city data and models weigh ~25 MB, and most builds change only src/. A file is
// copied only when the destination is missing, differs in size, or the source was modified after the last copy
// (a fresh copy is always newer than its source, so an unchanged file is skipped on every next build).
let copied = 0;
function syncStatic(src, dest) {
  const s = statSync(src);
  if (s.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const e of readdirSync(src)) syncStatic(src + '/' + e, dest + '/' + e);
    return;
  }
  let d = null; try { d = statSync(dest); } catch (e) { /* not copied yet */ }
  if (!d || d.size !== s.size || s.mtimeMs > d.mtimeMs) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(src, dest); copied++; }
}

export default defineConfig({
  base: './',
  publicDir: false,
  // emptyOutDir off keeps the copied static data between builds; only the hashed bundle in dist/assets is cleared
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 1500, emptyOutDir: false },
  plugins: [{ name: 'city-data', apply: 'build',
    buildStart() { rmSync('dist/assets', { recursive: true, force: true }); },
    closeBundle() { copied = 0; for (const f of STATIC) syncStatic(f, 'dist/' + f); console.log(`city-data: ${copied} changed static file(s) copied`); } }],
});
