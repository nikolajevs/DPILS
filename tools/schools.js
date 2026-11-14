#!/usr/bin/env node
/* Builds schools.js — the school grounds of Daugavpils with what lies on them — from OpenStreetMap extracts.

   Usage: node tools/schools.js schools.js map1.osm map2.osm …
   where each map is the OSM API answer around one school, e.g.
   https://api.openstreetmap.org/api/0.6/map?bbox=26.5296,55.8689,26.5357,55.8706
   (the schools themselves can be listed with Nominatim: search?q=[school]&viewbox=26.44,55.94,26.64,55.825&bounded=1,
   and the same for [college]).

   Kept: every school and college ground (amenity=school|college, ways and multipolygons), the buildings on it with
   their entrances, the pitches (sport, surface, hoops), running tracks (lanes; an area or a line), playgrounds and
   fitness stations on it or within 40 m of it, the fences, and the flagpoles, benches and bicycle stands on it.
   Coordinates are metres in the frame of citydata.js (x east, z south), rounded to 0.1 m. */
'use strict';
const fs = require('fs');
const [, , outFile, ...inFiles] = process.argv;
if (!outFile || !inFiles.length) { console.error('usage: node tools/schools.js schools.js map.osm …'); process.exit(1); }
const LAT0 = 55.8825, LON0 = 26.54, KX = 62438.48464324681, KY = 111292.731;   // same frame as citydata.js
const attr = (s, k) => { const m = s.match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : null; };
const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tagsOf = body => { const t = {}; for (const m of (body || '').matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[unesc(m[1])] = unesc(m[2]); return t; };

const nodes = new Map(), nodeTags = new Map(), ways = new Map(), rels = new Map();
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
  for (const m of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)) {
    const id = attr(m[1], 'id'); if (rels.has(id)) continue;
    rels.set(id, { members: [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\s*\/>/g)].map(r => ({ type: r[1], ref: r[2], role: r[3] })), tags: tagsOf(m[2]) });
  }
}
const ptsOf = refs => refs.every(r => nodes.has(r)) ? refs.map(r => nodes.get(r)) : null;
const closed = refs => refs.length > 3 && refs[0] === refs[refs.length - 1];
const flat = pts => { const o = []; for (const [x, z] of pts) o.push(x, z); return o; };
const area = pts => { let s = 0; for (let i = 0; i < pts.length - 1; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return Math.abs(s / 2); };
const pip = ([x, z], pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segD = ([x, z], [ax, az], [bx, bz]) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
const ringD = (p, ring) => { let d = 1e9; for (let i = 0; i < ring.length - 1; i++) d = Math.min(d, segD(p, ring[i], ring[i + 1])); return d; };
const centre = pts => { const n = closed2(pts) ? pts.length - 1 : pts.length; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += pts[i][0]; z += pts[i][1]; } return [x / n, z / n]; };
function closed2(pts) { return pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]; }
// a point surely inside a ring: the centre if it is, else the middle of the widest run of a horizontal line through it
function inside(ring) {
  const c = centre(ring); if (pip(c, ring)) return c;
  const xs = []; for (let i = 0; i < ring.length - 1; i++) { const [ax, az] = ring[i], [bx, bz] = ring[i + 1]; if ((az > c[1]) !== (bz > c[1])) xs.push(ax + (bx - ax) * (c[1] - az) / (bz - az)); }
  xs.sort((a, b) => a - b); let best = c, w = 0; for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > w) { w = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, c[1]]; }
  return best;
}
function joinRings(memberWays) {   // outer ways of a multipolygon joined into closed rings
  const segs = memberWays.map(id => ways.get(id)).filter(Boolean).map(w => w.refs.slice()), out = [];
  while (segs.length) {
    let cur = segs.shift();
    for (let guard = 0; cur[0] !== cur[cur.length - 1] && guard < 1000; guard++) {
      const k = segs.findIndex(s => s[0] === cur[cur.length - 1] || s[s.length - 1] === cur[cur.length - 1]); if (k < 0) break;
      const s = segs.splice(k, 1)[0]; cur = cur.concat(s[0] === cur[cur.length - 1] ? s.slice(1) : s.slice().reverse().slice(1));
    }
    const p = ptsOf(cur); if (p && closed(cur)) out.push(p);
  }
  return out;
}
const r1 = v => Math.round(v * 10) / 10;
const enc = pts => flat(pts).map(r1);

// ---- grounds
const grounds = [];
for (const [id, w] of ways) if ((w.tags.amenity === 'school' || w.tags.amenity === 'college') && closed(w.refs)) { const p = ptsOf(w.refs); if (p) grounds.push({ id: 'w' + id, t: w.tags, rings: [p] }); }
for (const [id, r] of rels) if (r.tags.amenity === 'school' || r.tags.amenity === 'college') grounds.push({ id: 'r' + id, t: r.tags, rings: joinRings(r.members.filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '')).map(m => m.ref)) });
// a named school building outside every ground is a school of its own (Vienības pamatskola in the old gymnasium)
for (const [id, w] of ways) if ((w.tags.building === 'school' || w.tags.building === 'college') && w.tags.name && closed(w.refs)) {
  const p = ptsOf(w.refs); if (p && !grounds.some(g => g.rings.some(r => pip(inside(p), r)))) grounds.push({ id: 'w' + id, t: Object.assign({ amenity: w.tags.building }, w.tags), rings: [p] });
}
grounds.sort((a, b) => (a.t.name || '').localeCompare(b.t.name || ''));
const which = (p, near = 0) => grounds.findIndex(g => g.rings.some(r => pip(p, r) || (near && ringD(p, r) < near)));

const out = { schools: [], buildings: [], entrances: [], pitches: [], tracks: [], areas: [], fences: [], points: [] };
grounds.forEach(g => out.schools.push([g.t.name || '', g.t.amenity, g.rings.map(enc)]));
const bldNodes = new Map();
const addBuilding = (id, t, p, refs) => {
  const s = which(inside(p)); if (s < 0) return;
  out.buildings.push([s, id, t.building, +(t['building:levels'] || 0), [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '), enc(p)]);
  for (const r of refs) bldNodes.set(r, out.buildings.length - 1);
};
for (const [id, r] of rels) if (r.tags.building && r.tags.type === 'multipolygon') {   // a building drawn as a multipolygon: its outer ring
  const ways2 = r.members.filter(m => m.type === 'way' && m.role === 'outer').map(m => m.ref), rings = joinRings(ways2);
  if (rings.length && area(rings[0]) > 40) addBuilding('r' + id, r.tags, rings[0], ways2.flatMap(w => ways.get(w) ? ways.get(w).refs : []));
}
for (const [id, w] of ways) {
  const t = w.tags, p = ptsOf(w.refs); if (!p) continue;
  if (t.building && closed(w.refs) && area(p) > 40) addBuilding('w' + id, t, p, w.refs);
  else if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'playground' || t.leisure === 'fitness_station') {
    const isArea = closed(w.refs) && (t.leisure !== 'track' || t.area === 'yes');
    const s = which(isArea ? inside(p) : p[Math.floor(p.length / 2)], 40); if (s < 0) continue;
    if (t.leisure === 'pitch') out.pitches.push([s, t.sport || '', t.surface || '', +(t.hoops || 0), t.athletics || '', enc(p)]);
    else if (t.leisure === 'track') out.tracks.push([s, +(t.lanes || 0), isArea ? 1 : 0, t.surface || '', t.athletics || '', enc(p)]);
    else out.areas.push([s, t.leisure, enc(p)]);
  } else if (t.barrier === 'fence' || t.barrier === 'wall') {
    if (which(p[0], 15) < 0 && which(p[p.length - 1], 15) < 0) continue;
    out.fences.push([t.barrier === 'wall' ? 'wall' : (t.fence_type || t.material || ''), +(t.height || 0), enc(p)]);
  }
}
const KINDS = { flagpole: t => t.man_made === 'flagpole', bench: t => t.amenity === 'bench', bicycle_parking: t => t.amenity === 'bicycle_parking',
  fitness_station: t => t.leisure === 'fitness_station', playground: t => !!t.playground, waste_basket: t => t.amenity === 'waste_basket' };
for (const [id, t] of nodeTags) {
  const p = nodes.get(id);
  if (t.entrance && bldNodes.has(id)) { out.entrances.push([bldNodes.get(id), t.entrance, p.map(r1)]); continue; }
  const k = Object.keys(KINDS).find(k => KINDS[k](t)); if (!k) continue;
  const s = which(p, k === 'fitness_station' || k === 'playground' ? 40 : 0); if (s < 0) continue;
  out.points.push([s, k, ...p.map(r1)]);
}
const head = '/* School grounds of Daugavpils from OpenStreetMap (© OpenStreetMap contributors, ODbL), built by tools/schools.js */\n';
fs.writeFileSync(outFile, head + 'window.SCHOOLS = ' + JSON.stringify(out) + ';\n');
console.log(`${out.schools.length} grounds, ${out.buildings.length} buildings, ${out.entrances.length} entrances, ${out.pitches.length} pitches, ${out.tracks.length} tracks, ${out.areas.length} playgrounds and fitness areas, ${out.fences.length} fences, ${out.points.length} points → ${outFile}`);
