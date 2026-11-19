#!/usr/bin/env node
/* Builds yards.js — what stands in the yards of the blocks of flats of a district, from OSM API map extracts.

   Usage: node tools/yards.js <citydata.js> yards.js --relation 5464161 [--relation …] [--box x0,z0,x1,z1 …] [--merge] map1.osm map2.osm …
   - --box: a district by a rectangle in the frame of citydata.js (metres); --merge: add to the yards.js already there
   - the districts are boundary relations of OpenStreetMap (5464161: Ķīmiķu ciemats), read from the maps (the OSM API
     squares of README.md, «Как обновить parking.js»);
   - left out is what lies on a school ground (schools.js) or in a park (parks.js), next to citydata.js: those draw
     their own.
   Kept, inside the districts:
   - the playgrounds (leisure=playground, areas and points) and their equipment (playground=swing, slide, seesaw,
     roundabout, structure, sandpit; the sandpits mapped as areas), the pitches and the fitness stations;
   - the benches, waste baskets, picnic tables, barbecues and bicycle stands;
   - the waste container sites (amenity=waste_disposal, amenity=recycling with containers);
   - the fences and walls.
   In the format of schools.js where the school grounds' drawing takes it (pitches, areas, fences, points), plus sand
   (the sandpits) and bins (the container sites). Metres in the frame of citydata.js, rounded to 0.1 m. */
'use strict';
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), rels = [], files = [], boxes = []; let merge = false;
for (let i = 2; i < args.length; i++) { if (args[i] === '--relation') rels.push(args[++i]); else if (args[i] === '--box') boxes.push(args[++i].split(',').map(Number)); else if (args[i] === '--merge') merge = true; else files.push(args[i]); }
const [cityFile, outFile] = args;
if (!cityFile || !outFile || !(rels.length || boxes.length) || !files.length) { console.error('usage: node tools/yards.js <citydata.js> yards.js --relation <id> map.osm …'); process.exit(1); }
const city = fs.readFileSync(cityFile, 'utf8'), num = k => +city.slice(0, 400).match(new RegExp('"' + k + '":(-?[0-9.e+-]+)'))[1];
const LAT0 = num('lat0'), LON0 = num('lon0'), KX = num('kx'), KY = num('ky');
const attr = (s, k) => { const m = s.match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : null; };
const tagsOf = body => { const t = {}; for (const m of (body || '').matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[m[1]] = m[2]; return t; };
const nodes = new Map(), nodeTags = new Map(), ways = new Map(), relations = new Map();
for (const f of files) {
  const xml = fs.readFileSync(f, 'utf8');
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) { const id = attr(m[1], 'id'); if (nodes.has(id)) continue;
    nodes.set(id, [Math.round((+attr(m[1], 'lon') - LON0) * KX * 10) / 10, Math.round((LAT0 - +attr(m[1], 'lat')) * KY * 10) / 10]);
    if (m[3]) { const t = tagsOf(m[3]); if (Object.keys(t).length) nodeTags.set(id, t); } }
  for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) { const id = attr(m[1], 'id'); if (!ways.has(id)) ways.set(id, { refs: [...m[2].matchAll(/<nd ref="(\d+)"/g)].map(r => r[1]), tags: tagsOf(m[2]) }); }
  for (const m of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)) { const id = attr(m[1], 'id'); if (!relations.has(id)) relations.set(id, [...m[2].matchAll(/<member type="way" ref="(\d+)" role="(outer|)"/g)].map(r => r[1])); }
}
const ptsOf = refs => refs.every(r => nodes.has(r)) ? refs.map(r => nodes.get(r)) : null;
const closed = refs => refs.length > 3 && refs[0] === refs[refs.length - 1];
const pip = ([x, z], pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const centre = pts => { const n = pts.length - 1; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += pts[i][0]; z += pts[i][1]; } return [x / n, z / n]; };
const r1 = v => Math.round(v * 10) / 10, enc = pts => pts.flat().map(r1);
// the districts
const districts = boxes.map(([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]).concat(rels.map(id => {
  const members = relations.get(id); if (!members) { console.error('relation', id, 'is not in the maps'); process.exit(1); }
  const segs = members.map(w => ways.get(w)).filter(Boolean).map(w => w.refs.slice()); let cur = segs.shift();
  while (segs.length) { const k = segs.findIndex(s => s[0] === cur[cur.length - 1] || s[s.length - 1] === cur[cur.length - 1]); if (k < 0) break; const s = segs.splice(k, 1)[0]; cur = cur.concat(s[0] === cur[cur.length - 1] ? s.slice(1) : s.slice().reverse().slice(1)); }
  return cur.map(n => nodes.get(n)).filter(Boolean);
}));
// what the schools and the parks draw
const others = [], load = (file, key) => { const f = path.join(path.dirname(cityFile), file); if (!fs.existsSync(f)) return null; const w = {}; new Function('window', fs.readFileSync(f, 'utf8'))(w); return w[key]; };
const S = load('schools.js', 'SCHOOLS'), P = load('parks.js', 'PARKS');
const ringPts = a => { const o = []; for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
if (S) for (const s of S.schools) for (const r of s[2]) others.push(ringPts(r));
if (P) for (const p of P.parks) others.push(ringPts(p[2]));
const keep = p => districts.some(d => pip(p, d)) && !others.some(r => pip(p, r));

const out = { pitches: [], tracks: [], areas: [], fences: [], points: [], sand: [], bins: [] }, drop = { other: 0 };
for (const [id, w] of ways) {
  const t = w.tags, p = ptsOf(w.refs); if (!p || p.length < 2) continue;
  const isArea = closed(w.refs), at = isArea ? centre(p) : p[Math.floor(p.length / 2)];
  if (!districts.some(d => pip(at, d))) continue;
  if (!keep(at)) { if (t.leisure || t.playground || t.barrier) drop.other++; continue; }
  if (isArea && t.leisure === 'pitch') out.pitches.push([0, t.sport || '', t.surface || '', +(t.hoops || 0), '', enc(p)]);
  else if (isArea && (t.leisure === 'playground' || t.leisure === 'fitness_station')) out.areas.push([0, t.leisure, enc(p)]);
  else if (isArea && t.playground === 'sandpit') out.sand.push(enc(p));
  else if (isArea && (t.amenity === 'waste_disposal' || (t.amenity === 'recycling' && t.recycling_type !== 'centre'))) out.bins.push([...centre(p).map(r1), 0]);
  else if (t.barrier === 'fence' || t.barrier === 'wall') out.fences.push([t.barrier === 'wall' ? 'wall' : (t.fence_type || t.material || ''), +(t.height || 0), enc(p)]);
}
const KIND = t => t.amenity === 'bench' ? 'bench' : t.amenity === 'waste_basket' ? 'waste_basket' : t.amenity === 'bicycle_parking' ? 'bicycle_parking' : t.leisure === 'fitness_station' ? 'fitness_station'
  : t.leisure === 'picnic_table' ? 'picnic_table' : t.amenity === 'bbq' ? 'bbq' : t.playground ? 'pg:' + t.playground : t.leisure === 'playground' ? 'playground' : null;
for (const [id, t] of nodeTags) {
  const p = nodes.get(id); if (!districts.some(d => pip(p, d))) continue;
  if (t.amenity === 'waste_disposal' || (t.amenity === 'recycling' && t.recycling_type !== 'centre')) { if (keep(p)) out.bins.push([...p.map(r1), 0]); continue; }
  const k = KIND(t); if (!k) continue; if (!keep(p)) { drop.other++; continue; }
  out.points.push([0, k, ...p.map(r1)]);
}
if (merge && fs.existsSync(outFile)) {   // add to what the file already holds (another district), without doubles
  const old = {}; new Function('window', fs.readFileSync(outFile, 'utf8'))(old); const Y = old.YARDS;
  for (const k of Object.keys(out)) { const seen = new Set((Y[k] || []).map(e => JSON.stringify(e))); out[k] = (Y[k] || []).concat(out[k].filter(e => !seen.has(JSON.stringify(e)))); }
}
fs.writeFileSync(outFile, '/* The yards of the blocks of flats from OpenStreetMap (© OpenStreetMap contributors, ODbL), built by tools/yards.js */\nwindow.YARDS = ' + JSON.stringify(out) + ';\n');
const kinds = {}; for (const p of out.points) kinds[p[1]] = (kinds[p[1]] || 0) + 1;
console.log(`${out.areas.length} playgrounds and fitness areas, ${out.pitches.length} pitches, ${out.sand.length} sandpits, ${out.bins.length} container sites, ${out.fences.length} fences; points ${JSON.stringify(kinds)}; ${drop.other} left to the schools and parks; ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
