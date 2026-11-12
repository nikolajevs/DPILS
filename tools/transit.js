// Builds transit.js (trams and city buses on their real timetable) from the official GTFS feed of
// Daugavpils satiksme: https://satiksme.daugavpils.lv/saraksti/GTFS.zip
// usage: node transit.js <gtfs dir> <citydata.js> <out transit.js>
const fs = require('fs'), path = require('path');
const [dir, cityFile, outFile] = process.argv.slice(2);

// same local projection as citydata.js
const head = fs.readFileSync(cityFile, 'utf8').slice(0, 400);
const num = k => +head.match(new RegExp('"' + k + '":(-?[0-9.e+-]+)'))[1];
const LAT0 = num('lat0'), LON0 = num('lon0'), KX = num('kx'), KY = num('ky');
const px = lon => (lon - LON0) * KX, pz = lat => -(lat - LAT0) * KY;

function csv(file) {
  const txt = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const h = rows.shift(); return rows.map(r => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] || '').trim()])));
}
const sec = t => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };
const DAY0 = Date.UTC(2026, 0, 1) / 864e5;
const dayNum = d => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 864e5 - DAY0;

const routesIn = csv('routes.txt'), stopsIn = csv('stops.txt'), tripsIn = csv('trips.txt'), timesIn = csv('stop_times.txt'), shapesIn = csv('shapes.txt');
const calIn = fs.existsSync(path.join(dir, 'calendar.txt')) ? csv('calendar.txt') : [], datesIn = fs.existsSync(path.join(dir, 'calendar_dates.txt')) ? csv('calendar_dates.txt') : [];
const feed = fs.existsSync(path.join(dir, 'feed_info.txt')) ? csv('feed_info.txt')[0] || {} : {};

// ---------- services: the set of days each service runs ----------
const svcDays = new Map();
for (const c of calIn) {
  const s = new Set(), a = dayNum(c.start_date), b = dayNum(c.end_date), W = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let d = a; d <= b; d++) { const wd = new Date((d + DAY0) * 864e5).getUTCDay(); if (c[W[wd]] === '1') s.add(d); }
  svcDays.set(c.service_id, s);
}
for (const r of datesIn) { let s = svcDays.get(r.service_id); if (!s) svcDays.set(r.service_id, s = new Set()); if (r.exception_type === '1') s.add(dayNum(r.date)); else s.delete(dayNum(r.date)); }

// ---------- shapes ----------
const shapePts = new Map();
for (const r of shapesIn) { let a = shapePts.get(r.shape_id); if (!a) shapePts.set(r.shape_id, a = []); a.push([+r.shape_pt_sequence, px(+r.shape_pt_lon), pz(+r.shape_pt_lat), r.shape_dist_traveled === '' ? NaN : +r.shape_dist_traveled]); }
const shapes = [], shapeIdx = new Map();
function shapeOf(id) {
  if (shapeIdx.has(id)) return shapeIdx.get(id);
  const a = (shapePts.get(id) || []).sort((p, q) => p[0] - q[0]);
  const pts = [], gd = [], cum = []; let L = 0;
  for (const p of a) {
    if (pts.length) { const dx = p[1] - pts[pts.length - 1][0], dz = p[2] - pts[pts.length - 1][1], d = Math.hypot(dx, dz); if (d < 0.3) continue; L += d; }
    pts.push([p[1], p[2]]); gd.push(p[3]); cum.push(L);
  }
  const o = { id: shapes.length, pts, gd, cum, len: L }; shapes.push(o); shapeIdx.set(id, o); return o;
}
// position (metres along our projected polyline) of a GTFS shape distance, or of the nearest point to a stop
function alongByDist(sh, d) {
  const g = sh.gd; if (!g.length || isNaN(g[0])) return null;
  if (d <= g[0]) return 0; if (d >= g[g.length - 1]) return sh.len;
  let lo = 0, hi = g.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g[m] <= d) lo = m; else hi = m; }
  const f = (d - g[lo]) / ((g[hi] - g[lo]) || 1); return sh.cum[lo] + (sh.cum[hi] - sh.cum[lo]) * f;
}
function alongByPoint(sh, x, z, from) {
  let best = 1e18, bs = from; const p = sh.pts;
  for (let i = 0; i < p.length - 1; i++) {
    if (sh.cum[i + 1] < from - 1) continue;
    const ax = p[i][0], az = p[i][1], dx = p[i + 1][0] - ax, dz = p[i + 1][1] - az, l2 = dx * dx + dz * dz;
    let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const d = (ax + t * dx - x) ** 2 + (az + t * dz - z) ** 2;
    if (d < best - 1e-6) { best = d; bs = sh.cum[i] + Math.sqrt(l2) * t; }
  }
  return bs;
}

// ---------- stops ----------
const stops = [], stopIdx = new Map();
for (const s of stopsIn) { if (s.location_type && s.location_type !== '0') continue; stopIdx.set(s.stop_id, stops.length); stops.push([s.stop_name, Math.round(px(+s.stop_lon) * 10), Math.round(pz(+s.stop_lat) * 10)]); }

// ---------- routes ----------
const routes = [], routeIdx = new Map();
for (const r of routesIn) { routeIdx.set(r.route_id, routes.length); routes.push([r.route_short_name, r.route_long_name, +r.route_type === 0 ? 0 : 3]); }

// ---------- trips grouped into patterns (same shape, stops and relative times) ----------
const byTrip = new Map();
for (const r of timesIn) { let a = byTrip.get(r.trip_id); if (!a) byTrip.set(r.trip_id, a = []); a.push(r); }
const heads = [], headIdx = new Map(); const hd = s => { if (!headIdx.has(s)) { headIdx.set(s, heads.length); heads.push(s); } return headIdx.get(s); };
const services = [], svcIdx = new Map(); const sv = id => { if (!svcIdx.has(id)) { svcIdx.set(id, services.length); services.push(id); } return svcIdx.get(id); };
const patterns = [], patIdx = new Map(), trips = []; let skipped = 0;
for (const t of tripsIn) {
  const st = (byTrip.get(t.trip_id) || []).sort((a, b) => +a.stop_sequence - +b.stop_sequence);
  if (st.length < 2 || !routeIdx.has(t.route_id) || !(svcDays.get(t.service_id) || new Set()).size) { skipped++; continue; }
  const sh = shapeOf(t.shape_id); if (sh.pts.length < 2) { skipped++; continue; }
  // fill in missing times by distance
  const arr = st.map(r => r.arrival_time ? sec(r.arrival_time) : NaN), dep = st.map((r, i) => r.departure_time ? sec(r.departure_time) : arr[i]);
  let from = 0; const along = st.map(r => { const s = stops[stopIdx.get(r.stop_id)]; let a = r.shape_dist_traveled !== '' ? alongByDist(sh, +r.shape_dist_traveled) : null; if (a == null) a = alongByPoint(sh, s[1] / 10, s[2] / 10, from); from = a; return a; });
  for (let i = 0; i < st.length; i++) if (isNaN(arr[i])) { let a = i - 1, b = i + 1; while (b < st.length && isNaN(arr[b])) b++; const f = (along[i] - along[a]) / ((along[b] - along[a]) || 1); arr[i] = dep[i] = Math.round(dep[a] + (arr[b] - dep[a]) * f); }
  const start = dep[0];
  const key = [t.route_id, t.shape_id, t.trip_headsign, st.map(r => r.stop_id).join('.'), arr.map(x => x - start).join('.'), dep.map(x => x - start).join('.')].join('|');
  let p = patIdx.get(key);
  if (p == null) {
    p = patterns.length; patIdx.set(key, p);
    patterns.push([routeIdx.get(t.route_id), sh.id, hd(t.trip_headsign || routes[routeIdx.get(t.route_id)][1]), st.map(r => stopIdx.get(r.stop_id)), along.map(a => Math.round(a * 10)), arr.map(x => x - start), dep.map(x => x - start)]);
  }
  trips.push([p, start, sv(t.service_id)]);
}
trips.sort((a, b) => a[1] - b[1]);

const encLine = pts => { const o = []; let lx = 0, lz = 0; for (const [x, z] of pts) { const X = Math.round(x * 10), Z = Math.round(z * 10); o.push(X - lx, Z - lz); lx = X; lz = Z; } return o; };
const out = {
  feed: { name: feed.feed_publisher_name || 'Daugavpils satiksme', version: feed.feed_version || '', start: feed.feed_start_date || '', end: feed.feed_end_date || '' },
  day0: '2026-01-01', routes, stops, heads,
  shapes: shapes.map(s => encLine(s.pts)),
  services: services.map(id => [...svcDays.get(id)].sort((a, b) => a - b)),
  patterns, trips
};
const js = 'window.TRANSIT=' + JSON.stringify(out) + ';';
fs.writeFileSync(outFile, js);
const tram = trips.filter(t => routes[patterns[t[0]][0]][2] === 0).length;
console.log('routes', routes.length, 'stops', stops.length, 'shapes', shapes.length, 'patterns', patterns.length, 'trips', trips.length, '(trams', tram + ', skipped', skipped + ')', 'size KB', (js.length / 1024).toFixed(0));
