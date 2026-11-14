#!/usr/bin/env node
/* Builds parks.js — the parks and squares of Daugavpils with what lies in them — from OpenStreetMap extracts.

   Usage: node tools/parks.js parks.js map1.osm map2.osm …
   where each map is the OSM API answer around one park, e.g.
   https://api.openstreetmap.org/api/0.6/map?bbox=26.5047,55.8686,26.5168,55.8710
   (the parks can be listed with Nominatim: search?q=[park]&viewbox=26.44,55.94,26.64,55.825&bounded=1).

   Kept for every park (leisure=park inside the city): its outline and name; the footways in it with their surface;
   the pitches, tracks, playgrounds, fitness stations and dog parks in it or within 20 m of it; the fences, walls and
   hedges; the flower beds and the rows of trees; benches, waste baskets, street lamps, bicycle stands, picnic tables,
   barbecues, toilets, drinking water taps; fountains, memorials (with their kind and name), artworks and sundials.
   Coordinates are metres in the frame of citydata.js (x east, z south), rounded to 0.1 m. */
'use strict';
const fs = require('fs');
const [, , outFile, ...inFiles] = process.argv;
if (!outFile || !inFiles.length) { console.error('usage: node tools/parks.js parks.js map.osm …'); process.exit(1); }
const LAT0 = 55.8825, LON0 = 26.54, KX = 62438.48464324681, KY = 111292.731, HX = 6244, HY = 6399;   // same frame as citydata.js
const attr = (s, k) => { const m = s.match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : null; };
const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tagsOf = body => { const t = {}; for (const m of (body || '').matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[unesc(m[1])] = unesc(m[2]); return t; };

const nodes = new Map(), nodeTags = new Map(), ways = new Map();
for (const f of inFiles) {
  const xml = fs.readFileSync(f, 'utf8');
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const id = attr(m[1], 'id'); if (nodes.has(id)) continue;
    nodes.set(id, [Math.round((+attr(m[1], 'lon') - LON0) * KX * 10) / 10, Math.round((LAT0 - +attr(m[1], 'lat')) * KY * 10) / 10]);
    if (m[3]) { const t = tagsOf(m[3]); if (Object.keys(t).length) nodeTags.set(id, t); }
  }
  for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const id = attr(m[1], 'id'); if (ways.has(id)) continue;
    ways.set(id, { refs: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map(r => r[1]), tags: tagsOf(m[2]) });
  }
}
const ptsOf = refs => refs.every(r => nodes.has(r)) ? refs.map(r => nodes.get(r)) : null;
const closed = refs => refs.length > 3 && refs[0] === refs[refs.length - 1];
const flat = pts => { const o = []; for (const [x, z] of pts) o.push(x, z); return o; };
const pip = ([x, z], pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segD = ([x, z], [ax, az], [bx, bz]) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
const ringD = (p, ring) => { let d = 1e9; for (let i = 0; i < ring.length - 1; i++) d = Math.min(d, segD(p, ring[i], ring[i + 1])); return d; };
const centre = pts => { const n = pts.length - 1; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += pts[i][0]; z += pts[i][1]; } return [x / n, z / n]; };
const r1 = v => Math.round(v * 10) / 10;
const enc = pts => flat(pts).map(r1);

// ---- the parks
const parks = [];
for (const [id, w] of ways) if (w.tags.leisure === 'park' && closed(w.refs)) {
  const p = ptsOf(w.refs); if (!p) continue; const c = centre(p);
  if (Math.abs(c[0]) < HX && Math.abs(c[1]) < HY) parks.push({ id: 'w' + id, t: w.tags, ring: p });
}
parks.sort((a, b) => (a.t.name || '~').localeCompare(b.t.name || '~') || a.id.localeCompare(b.id));
const which = (p, near = 0) => parks.findIndex(g => pip(p, g.ring) || (near && ringD(p, g.ring) < near));
const anyIn = (pts, near = 0) => { for (const p of pts) { const k = which(p, near); if (k >= 0) return k; } return -1; };

const out = { parks: [], paths: [], pitches: [], tracks: [], areas: [], fences: [], beds: [], rows: [], points: [] };
parks.forEach(g => out.parks.push([g.t.name || '', g.id, enc(g.ring)]));
for (const [, w] of ways) {
  const t = w.tags, p = ptsOf(w.refs); if (!p) continue;
  const isArea = closed(w.refs);
  if (t.highway && /^(footway|path|pedestrian|cycleway|steps)$/.test(t.highway)) {
    const s = anyIn(p); if (s >= 0) out.paths.push([s, t.highway, t.surface || '', enc(p)]);
  } else if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'playground' || t.leisure === 'fitness_station' || t.leisure === 'dog_park') {
    const a = isArea && (t.leisure !== 'track' || t.area === 'yes'), s = a ? which(centre(p), 20) : anyIn(p, 20); if (s < 0) continue;
    if (t.leisure === 'pitch') out.pitches.push([s, t.sport || '', t.surface || '', +(t.hoops || 0), t.athletics || '', enc(p)]);
    else if (t.leisure === 'track') out.tracks.push([s, +(t.lanes || 0), a ? 1 : 0, t.surface || '', t.athletics || t.sport || '', enc(p)]);
    else if (a) out.areas.push([s, t.leisure, enc(p)]);
  } else if (t.barrier === 'fence' || t.barrier === 'wall' || t.barrier === 'hedge' || t.barrier === 'retaining_wall') {
    const s = anyIn(p, 5); if (s < 0) continue;
    out.fences.push([t.barrier === 'hedge' ? 'hedge' : t.barrier === 'fence' ? (t.fence_type || t.material || '') : 'wall', +(t.height || 0), enc(p)]);
  } else if (t.landuse === 'flowerbed' && isArea) { const s = which(centre(p)); if (s >= 0) out.beds.push([s, enc(p)]); }
  else if (t.natural === 'tree_row') { const s = anyIn(p, 5); if (s >= 0) out.rows.push([s, t.leaf_type === 'needleleaved' ? 1 : 0, enc(p)]); }
}
// things on the ground: [park, kind, x, z, name, detail]
const KINDS = [
  ['bench', t => t.amenity === 'bench'], ['waste_basket', t => t.amenity === 'waste_basket'], ['lamp', t => t.highway === 'street_lamp'],
  ['bicycle_parking', t => t.amenity === 'bicycle_parking'], ['picnic_table', t => t.leisure === 'picnic_table'], ['bbq', t => t.amenity === 'bbq'],
  ['toilets', t => t.amenity === 'toilets'], ['drinking_water', t => t.amenity === 'drinking_water'], ['fountain', t => t.amenity === 'fountain'],
  ['sundial', t => t.amenity === 'clock' && t.display === 'sundial'], ['memorial', t => t.historic === 'memorial' || t.historic === 'monument'],
  ['artwork', t => t.tourism === 'artwork'], ['playground', t => !!t.playground], ['fitness_station', t => t.leisure === 'fitness_station']];
for (const [id, t] of nodeTags) {
  const k = KINDS.find(([, f]) => f(t)); if (!k) continue;
  const p = nodes.get(id), s = which(p, k[0] === 'memorial' || k[0] === 'fountain' ? 3 : 0); if (s < 0) continue;
  out.points.push([s, k[0], ...p.map(r1), t.name || '', t.memorial || t.artwork_type || t.fountain || '']);
}
const head = '/* Parks and squares of Daugavpils from OpenStreetMap (© OpenStreetMap contributors, ODbL), built by tools/parks.js */\n';
fs.writeFileSync(outFile, head + 'window.PARKS = ' + JSON.stringify(out) + ';\n');
const cnt = {}; for (const p of out.points) cnt[p[1]] = (cnt[p[1]] || 0) + 1;
console.log(`${out.parks.length} parks, ${out.paths.length} paths, ${out.pitches.length} pitches, ${out.tracks.length} tracks, ${out.areas.length} areas, ${out.fences.length} fences and hedges, ${out.beds.length} flower beds, ${out.rows.length} rows of trees; points ${JSON.stringify(cnt)}`);
