import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The city data stay plain scripts that set window.CITY, window.TRANSIT, window.FORTRESS, window.TERRAIN, window.SCHOOLS, window.PARKS, window.LIDAR and window.LIDAR_TREES (written
// by the tools in tools/; src/boot.js downloads them with a progress bar); they are copied next to the bundle as they
// are, with the old address of the page and the textures the page loads at run time.
const STATIC = ['citydata.js', 'transit.js', 'fortress.js', 'terrain.js', 'schools.js', 'parks.js', 'lidar.js', 'lidar-trees.js', 'trains.js', 'intercity.js', 'parking.js', 'yards.js', 'servers.json', 'models', 'daugavpils.html', 'textures/water_normal.webp'];

export default defineConfig({
  base: './',
  publicDir: false,
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 1500 },
  plugins: [{ name: 'city-data', apply: 'build', closeBundle() { for (const f of STATIC) { mkdirSync(dirname('dist/' + f), { recursive: true }); cpSync(f, 'dist/' + f, { recursive: true }); } } }],
});
