#!/usr/bin/env node
/* Builds parking.js — every car park of Daugavpils mapped in OpenStreetMap — from OSM API map extracts.

   Usage: node tools/parking.js <citydata.js> parking.js map1.osm map2.osm …
   where the maps cover the city frame in squares the OSM API will give (0.03° × 0.02°, a few MB each), e.g.
   https://api.openstreetmap.org/api/0.6/map?bbox=26.505,55.865,26.535,55.885 (Overpass does not answer from the cloud;
   the loop that fetches the squares is in README.md, «Как обновить parking.js»).

   Kept, within the frame of citydata.js:
   - every car park (amenity=parking; ways and multipolygons with their holes): its kind (parking=surface, street_side,
     lane, layby, multi-storey, underground, rooftop), surface, capacity, access, fee;
   - the aisles (service=parking_aisle), each with the car park it lies in;
   - the mapped parking spaces (amenity=parking_space areas);
   - the lift gates and gates on the ways into car parks.
   And for each car park, whose cars stand in it through the day (the page fills it by the hour):
     0 yard — among blocks of flats, or private / for residents;
     1 shop — for customers, by a supermarket or a shopping street;
     2 work — on industrial ground, by a hospital, school, college or offices;
     3 other.
   Coordinates are metres in the frame of citydata.js (x east, z south), rounded to 0.1 m. */
'use strict';
const fs = require('fs');
const [, , cityFile, outFile, ...inFiles] = process.argv;
if (!cityFile || !outFile || !inFiles.length) { console.error('usage: node tools/parking.js <citydata.js> parking.js map.osm …'); process.exit(1); }
const city = fs.readFileSync(cityFile, 'utf8'), num = k => +city.slice(0, 400).match(new RegExp('"' + k + '":(-?[0-9.e+-]+)'))[1];
const LAT0 = num('lat0'), LON0 = num('lon0'), KX = num('kx'), KY = num('ky'), HX = num('hx'), HY = num('hy');
const attr = (s, k) => { const m = s.match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : null; };
const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tagsOf = body => { const t = {}; for (const m of (body || '').matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[unesc(m[1])] = unesc(m[2]); return t; };

// ---- the maps (the squares overlap at their edges: each element once)
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
const area = pts => { let s = 0; for (let i = 0; i < pts.length - 1; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return Math.abs(s / 2); };
const pip = ([x, z], pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segD = ([x, z], [ax, az], [bx, bz]) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
const ringD = (p, ring) => { let d = 1e9; for (let i = 0; i < ring.length - 1; i++) d = Math.min(d, segD(p, ring[i], ring[i + 1])); return d; };
const centre = pts => { const n = pts.length - 1; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += pts[i][0]; z += pts[i][1]; } return [x / n, z / n]; };
const inFrame = ([x, z]) => Math.abs(x) < HX - 20 && Math.abs(z) < HY - 20;
function joinRings(memberWays) {   // member ways of a multipolygon joined into closed rings
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
const enc = pts => { const o = []; for (const [x, z] of pts.slice(0, -1)) o.push(r1(x), r1(z)); return o; };   // open ring / line, flat

// ---- the car parks
const KIND = { surface: 0, street_side: 1, lane: 2, layby: 3, 'multi-storey': 4, underground: 5, rooftop: 6, carports: 0, sheds: 0 };
const SURF = s => !s || /^(asphalt|paved)$/.test(s) ? 0 : /^(paving_stones|sett|concrete:plates|unhewn_cobblestone|cobblestone|concrete:lanes)$/.test(s) ? 1
  : /^(gravel|fine_gravel|compacted|unpaved|ground|dirt|earth|sand|pebblestone|mud)$/.test(s) ? 2 : s === 'grass_paver' ? 3 : s === 'concrete' ? 4 : s === 'grass' ? 2 : 0;
const ACC = a => !a || /^(yes|public|permissive|destination)$/.test(a) ? 0 : a === 'customers' ? 1 : /^(private|permit|residents|no|delivery)$/.test(a) ? 2 : 0;
const lots = [];
for (const [id, w] of ways) if (w.tags.amenity === 'parking' && closed(w.refs)) { const p = ptsOf(w.refs); if (p) lots.push({ id: +id, t: w.tags, rings: [p] }); }
for (const [id, r] of rels) if (r.tags.amenity === 'parking' && r.tags.type === 'multipolygon') {
  const outer = joinRings(r.members.filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '')).map(m => m.ref)), inner = joinRings(r.members.filter(m => m.type === 'way' && m.role === 'inner').map(m => m.ref));
  for (const o of outer) lots.push({ id: -id, t: r.tags, rings: [o, ...inner.filter(h => pip(h[0], o))] });
}
const drop = { frame: 0, small: 0 };
const LOTS = lots.filter(L => { const c = centre(L.rings[0]); if (!inFrame(c)) { drop.frame++; return false; } if (area(L.rings[0]) < 20) { drop.small++; return false; } L.c = c; L.A = area(L.rings[0]) - L.rings.slice(1).reduce((s, h) => s + area(h), 0); return true; });
LOTS.sort((a, b) => a.c[1] - b.c[1] || a.c[0] - b.c[0]);
const lotOf = (p, m = 0) => { let best = -1, bd = 1e9; LOTS.forEach((L, k) => { if (pip(p, L.rings[0]) && !L.rings.slice(1).some(h => pip(p, h))) { if (L.A < bd) { bd = L.A; best = k; } } }); if (best < 0 && m) LOTS.forEach((L, k) => { const d = ringD(p, L.rings[0]); if (d < m && d < bd) { bd = d; best = k; } }); return best; };

// ---- the aisles: each with the car park most of it lies in (aisles out of every car park are the city's service roads)
const aisles = [];
for (const [id, w] of ways) if (w.tags.highway === 'service' && w.tags.service === 'parking_aisle') {
  const p = ptsOf(w.refs); if (!p || p.length < 2) continue;
  const votes = new Map(); for (let i = 0; i + 1 < p.length; i++) for (let k = 0; k <= 4; k++) { const q = [p[i][0] + (p[i + 1][0] - p[i][0]) * k / 4, p[i][1] + (p[i + 1][1] - p[i][1]) * k / 4], l = lotOf(q, 2.5); if (l >= 0) votes.set(l, (votes.get(l) || 0) + 1); }
  let lot = -1, n = 0; for (const [l, v] of votes) if (v > n) { n = v; lot = l; }
  if (lot >= 0) aisles.push([lot, ...enc(p.concat([p[p.length - 1]]))]);
}
// ---- the mapped spaces
const spaces = [];
for (const [, w] of ways) if (w.tags.amenity === 'parking_space' && closed(w.refs)) { const p = ptsOf(w.refs); if (!p) continue; const A = area(p); if (A < 6 || A > 60) continue; const l = lotOf(centre(p), 1.5); if (l >= 0) spaces.push([l, ...enc(p)]); }
// ---- gates on the ways into car parks
const gates = [];
for (const [id, t] of nodeTags) if (t.barrier === 'lift_gate' || t.barrier === 'gate' && t.access !== 'no') { const p = nodes.get(id), l = lotOf(p, 12); if (l < 0) continue;
  // which way the road runs through it: the way it lies on
  let dir = null; for (const [, w] of ways) { if (!w.tags.highway) continue; const i = w.refs.indexOf(id); if (i < 0) continue; const a = nodes.get(w.refs[Math.max(0, i - 1)]), b = nodes.get(w.refs[Math.min(w.refs.length - 1, i + 1)]); if (a && b) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > 0.1) dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } break; }
  if (dir && t.barrier === 'lift_gate') gates.push([l, r1(p[0]), r1(p[1]), Math.round(dir[0] * 100) / 100, Math.round(dir[1] * 100) / 100]);
}

// ---- whose cars: from the land use, the shops and the buildings round each car park
const decR = a => { const o = []; let x = 0, z = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; z += a[i + 1]; o.push([x / 10, z / 10]); } return o; };
const C = JSON.parse(city.slice(city.indexOf('{'), city.lastIndexOf('}') + 1));
const bld = C.b.map(r => { const p = decR(r[7]); if (p.length < 3) return null; p.push(p[0]); return { c: centre(p), A: area(p), style: r[0], flags: r[6], floors: r[5] }; }).filter(Boolean);
const G = new Map(), gk = (x, z) => Math.floor(x / 100) * 1000 + Math.floor(z / 100);
bld.forEach(b => { const k = gk(...b.c); if (!G.has(k)) G.set(k, []); G.get(k).push(b); });
const bldNear = (c, r) => { const o = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of G.get(gk(c[0] + i * 100, c[1] + j * 100)) || []) if (Math.hypot(b.c[0] - c[0], b.c[1] - c[1]) < r) o.push(b); return o; };
const areasOf = pred => { const o = []; for (const [, w] of ways) if (closed(w.refs) && pred(w.tags)) { const p = ptsOf(w.refs); if (p) o.push({ p, t: w.tags }); }
  for (const [, r] of rels) if (r.tags.type === 'multipolygon' && pred(r.tags)) for (const p of joinRings(r.members.filter(m => m.type === 'way' && m.role !== 'inner').map(m => m.ref))) o.push({ p, t: r.tags }); return o; };
const RETAIL = areasOf(t => /^(retail|commercial)$/.test(t.landuse) || t.shop === 'mall'), WORK = areasOf(t => /^(industrial|railway|construction)$/.test(t.landuse) || /^(hospital|clinic|school|college|university|kindergarten|police|fire_station|townhall)$/.test(t.amenity) || t.office || t.building === 'industrial' || t.building === 'office');
const RESID = areasOf(t => t.landuse === 'residential');
const SHOPS = []; for (const [id, t] of nodeTags) if (t.shop) SHOPS.push({ c: nodes.get(id), big: /^(supermarket|mall|department_store|doityourself|hardware|wholesale|car|furniture)$/.test(t.shop) });
for (const [, w] of ways) if (w.tags.shop && closed(w.refs)) { const p = ptsOf(w.refs); if (p) SHOPS.push({ c: centre(p), big: /^(supermarket|mall|department_store|doityourself|hardware|wholesale|car|furniture)$/.test(w.tags.shop) || area(p) > 1500 }); }
const within = (c, list, m = 0) => list.some(a => pip(c, a.p) || (m && ringD(c, a.p) < m));
const PROF = [0, 0, 0, 0];
for (const L of LOTS) {
  const c = L.c, t = L.t, acc = ACC(t.access), near = bldNear(c, 80);
  const flats = near.filter(b => b.flags & 2).reduce((s, b) => s + b.A * Math.max(1, b.floors), 0), shopsB = near.filter(b => b.flags & 1).length, indus = near.filter(b => b.style === 6).reduce((s, b) => s + b.A, 0);
  const shopN = SHOPS.filter(s => Math.hypot(s.c[0] - c[0], s.c[1] - c[1]) < (s.big ? 90 : 45));
  let p;
  if (acc === 1 || shopN.some(s => s.big) || within(c, RETAIL, 10)) p = 1;
  else if (within(c, WORK, 15) || indus > 2000) p = 2;
  else if (acc === 2 || flats > 4000 || (within(c, RESID) && !shopN.length)) p = 0;
  else if (shopN.length >= 2 || shopsB >= 2) p = 1;
  else p = 3;
  L.prof = p; PROF[p]++;
}

// ---- out
const out = { lots: LOTS.map(L => [L.id, KIND[L.t.parking] ?? 0, SURF(L.t.surface), +L.t.capacity || 0, ACC(L.t.access), L.t.fee === 'yes' ? 1 : 0, L.prof, ...L.rings.map(enc)]), aisles, spaces, gates };
fs.writeFileSync(outFile, '/* Car parks of Daugavpils from OpenStreetMap (© OpenStreetMap contributors, ODbL), built by tools/parking.js */\nwindow.PARKING = ' + JSON.stringify(out) + ';\n');
const kinds = {}; for (const L of LOTS) { const k = L.t.parking || '-'; kinds[k] = (kinds[k] || 0) + 1; }
console.log(`${LOTS.length} car parks (${Object.entries(kinds).map(e => e.join(' ')).join(', ')}), profiles yard/shop/work/other ${PROF.join('/')}`);
console.log(`${aisles.length} aisles, ${spaces.length} spaces, ${gates.length} lift gates; dropped: ${drop.frame} out of the frame, ${drop.small} under 20 m²`);
console.log(`${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
