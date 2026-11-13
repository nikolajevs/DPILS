#!/usr/bin/env node
/* Builds fortress.js — the earthworks and gates of the Daugavpils fortress — from an OpenStreetMap extract.

   Usage: node tools/fortress.js map.osm fortress.js
   where map.osm is the OSM API answer for the fortress, e.g.
   https://api.openstreetmap.org/api/0.6/map?bbox=26.4807,55.8789,26.5096,55.8933

   OSM draws retaining walls and embankments with the lower side on the right of the way, so a closed retaining
   wall is the outline of a raised work (bastion, lunette, counterguard …) and an open one has its high side on the
   left. Coordinates are metres in the frame of citydata.js (x east, z south). */
'use strict';
const fs = require('fs');
const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('usage: node tools/fortress.js map.osm fortress.js'); process.exit(1); }
const LAT0 = 55.8825, LON0 = 26.54, KX = 62438.48464324681, KY = 111292.731;   // same frame as citydata.js
const xml = fs.readFileSync(inFile, 'utf8');
const attr = (s, k) => { const m = s.match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : null; };
const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tagsOf = body => { const t = {}; for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[unesc(m[1])] = unesc(m[2]); return t; };

const nodes = new Map(), nodeTags = [];
for (const m of xml.matchAll(/<node\b([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
  const id = attr(m[1], 'id'), lat = +attr(m[1], 'lat'), lon = +attr(m[1], 'lon');
  const p = [Math.round((lon - LON0) * KX * 10) / 10, Math.round((LAT0 - lat) * KY * 10) / 10];
  nodes.set(id, p);
  if (m[3]) nodeTags.push([tagsOf(m[3]), p]);
}
const ways = [];
for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
  const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map(r => r[1]).filter(r => nodes.has(r));
  ways.push({ id: attr(m[1], 'id'), pts: refs.map(r => nodes.get(r)), closed: refs.length > 3 && refs[0] === refs[refs.length - 1], tags: tagsOf(m[2]) });
}
const flat = pts => { const o = []; for (const [x, z] of pts) o.push(x, z); return o; };
const len = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
const area = pts => { let s = 0; for (let i = 0; i < pts.length - 1; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return s / 2; };

const F = { rings: [], walls: [], banks: [], moats: [], ditches: [], tunnels: [], bridges: [], ports: [], main: [] };
const openWalls = [];
for (const w of ways) {
  const t = w.tags;
  if (t.barrier === 'retaining_wall') {
    if (w.closed) {
      // keep the rampart on the left: in x-east / z-south a counter-clockwise ring (as seen on a north-up map)
      // has negative signed area here
      let pts = w.pts; if (area(pts) > 0) pts = pts.slice().reverse();
      F.rings.push([t.defensive_works || 'work', t.name || '', flat(pts)]);
    } else openWalls.push(w);
  } else if (t.man_made === 'embankment' && !w.closed) F.banks.push([t.defensive_works || '', flat(w.pts)]);
  else if (t.defensive_works === 'moat' || t.water === 'moat') F.moats.push([t.natural === 'water' ? 2 : 1, flat(w.pts)]);
  else if ((t.waterway === 'ditch' || t.waterway === 'canal' || t.waterway === 'drain') && !t.tunnel) F.ditches.push(flat(w.pts));
  else if (t.man_made === 'tunnel' && w.closed) F.tunnels.push([t.name || '', flat(w.pts)]);
  else if (t.man_made === 'bridge' && w.closed) F.bridges.push([t.material || '', flat(w.pts)]);
}
for (const [t, p] of nodeTags) if (t.barrier === 'sally_port' || t.barrier === 'city_gate') F.ports.push([t.name || '', p[0], p[1]]);
F.guns = []; for (const [t, p] of nodeTags) if (t.historic === 'cannon') F.guns.push([t.name || '', p[0], p[1]]);

// The escarp of the inner rampart is mapped as a few long open walls; chain them end to end (the high side stays on
// the left) and keep the rest as separate walls.
const used = new Set(); let chain = null;
const main = openWalls.filter(w => len(w.pts) > 300).sort((a, b) => len(b.pts) - len(a.pts));
if (main.length) {
  chain = main[0].pts.slice(); used.add(main[0].id);
  for (let guard = 0; guard < 20; guard++) {
    const end = chain[chain.length - 1]; let best = null, bd = 80;
    for (const w of openWalls) { if (used.has(w.id) || len(w.pts) < 100) continue; const d = Math.hypot(w.pts[0][0] - end[0], w.pts[0][1] - end[1]); if (d < bd) { bd = d; best = w; } }
    if (!best) break; used.add(best.id); chain.push(...best.pts.slice(bd < 0.5 ? 1 : 0));
  }
  F.main = flat(chain);
}
for (const w of openWalls) if (!used.has(w.id)) F.walls.push(flat(w.pts));

const round = a => a.map(v => Math.round(v * 10) / 10);
const out = { rings: F.rings.map(([k, n, p]) => [k, n, round(p)]), main: round(F.main), walls: F.walls.map(round), banks: F.banks.map(([k, p]) => [k, round(p)]),
  moats: F.moats.map(([k, p]) => [k, round(p)]), ditches: F.ditches.map(round), tunnels: F.tunnels.map(([n, p]) => [n, round(p)]), bridges: F.bridges.map(([m, p]) => [m, round(p)]), ports: F.ports, guns: F.guns };
fs.writeFileSync(outFile, '/* Daugavpils fortress from OpenStreetMap (© OpenStreetMap contributors, ODbL), built by tools/fortress.js */\nwindow.FORTRESS = ' + JSON.stringify(out) + ';\n');
console.log(`rings ${out.rings.length}, main escarp ${out.main.length / 2} points, walls ${out.walls.length}, embankments ${out.banks.length}, moats ${out.moats.length}, ditches ${out.ditches.length}, tunnels ${out.tunnels.length}, bridges ${out.bridges.length}, gates ${out.ports.length}, guns ${out.guns.length}`);
