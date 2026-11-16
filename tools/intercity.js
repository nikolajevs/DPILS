#!/usr/bin/env node
/* Builds intercity.js — the regional and intercity buses on the map, on their real timetable — from the GTFS feed of
   VSIA Autotransporta direkcija (all the regional buses of Latvia): https://www.atd.lv/sites/default/files/GTFS/gtfs-latvia-lv.zip
   (from a cloud machine the site may not answer; the Mobility Database keeps a copy:
   https://storage.googleapis.com/storage/v1/b/mdb-latest/o/lv-riga-valsts-sia-autotransporta-direkcija-atd-gtfs-992.zip?alt=media).

   Usage: node tools/intercity.js <gtfs dir> <citydata.js> intercity.js

   Kept: every trip that stops on the map (Daugavpils autoosta, the city stops the regional buses serve), as far as it
   runs on the map. Where its shape crosses the edge of the map (6.2 km from the centre each way) the trip gets a stop
   there with no name, its time interpolated by the distance between the stops on either side of the edge, so the bus
   drives in from the edge and out to it. The shapes are cut to that run and thinned (4 m: the page lays them on its streets anyway). The file has the format of
   transit.js (routes, stops, heads, shapes, services, patterns, trips; times relative to the start of a trip), and the
   page runs the buses with the same engine as the city's. The head of a pattern is where the whole trip ends (the
   feed's headsign is only the name of the route), so a bus leaving the city says where it goes. */
'use strict';
const fs = require('fs'), path = require('path'), readline = require('readline');
const [dir, cityFile, outFile] = process.argv.slice(2);
if (!outFile) { console.error('usage: node tools/intercity.js <gtfs dir> <citydata.js> intercity.js'); process.exit(1); }
const head = fs.readFileSync(cityFile, 'utf8').slice(0, 400), num = k => +head.match(new RegExp('"' + k + '":(-?[0-9.e+-]+)'))[1];
const LAT0 = num('lat0'), LON0 = num('lon0'), KX = num('kx'), KY = num('ky'), EDGE = 6200;
const px = lon => (lon - LON0) * KX, pz = lat => -(lat - LAT0) * KY, inMap = (x, z) => Math.abs(x) < EDGE && Math.abs(z) < EDGE;

// a line of CSV: fields split at commas outside quotes, trimmed (the feed writes ", " between fields)
function fields(line) { const o = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { o.push(cur.trim()); cur = ''; } else cur += c; } o.push(cur.trim()); return o; }
function csv(file) { const lines = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean), h = fields(lines.shift()); return lines.map(l => { const f = fields(l); return Object.fromEntries(h.map((k, i) => [k, f[i] || ''])); }); }
const sec = t => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };
const DAY0 = Date.UTC(2026, 0, 1) / 864e5, dayNum = d => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 864e5 - DAY0;

(async () => {
  const stopsIn = csv('stops.txt'), routesIn = csv('routes.txt'), tripsIn = csv('trips.txt');
  const S = new Map(stopsIn.map(s => [s.stop_id, { name: s.stop_name, x: px(+s.stop_lon), z: pz(+s.stop_lat) }]));
  const byTrip = new Map(); for (const r of csv('stop_times.txt')) { let a = byTrip.get(r.trip_id); if (!a) byTrip.set(r.trip_id, a = []); a.push(r); }
  // services
  const svcDays = new Map();
  for (const c of csv('calendar.txt')) { const s = new Set(), a = dayNum(c.start_date), b = dayNum(c.end_date), W = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let d = a; d <= b; d++) { const wd = new Date((d + DAY0) * 864e5).getUTCDay(); if (c[W[wd]] === '1') s.add(d); } svcDays.set(c.service_id, s); }
  for (const r of csv('calendar_dates.txt')) { let s = svcDays.get(r.service_id); if (!s) svcDays.set(r.service_id, s = new Set()); if (r.exception_type === '1') s.add(dayNum(r.date)); else s.delete(dayNum(r.date)); }
  // the trips with a stop on the map that run on some day
  const want = tripsIn.filter(t => (svcDays.get(t.service_id) || new Set()).size && (byTrip.get(t.trip_id) || []).some(r => { const s = S.get(r.stop_id); return s && inMap(s.x, s.z); }));
  const needShapes = new Set(want.map(t => t.shape_id).filter(Boolean));
  // shapes, streamed (the file is large): only those wanted
  const shp = new Map(); let h = null;
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, 'shapes.txt'), 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) { if (!line) continue; const f = fields(line.replace(/^﻿/, '')); if (!h) { h = f; continue; } const r = Object.fromEntries(h.map((k, i) => [k, f[i] || ''])); if (!needShapes.has(r.shape_id)) continue;
    let a = shp.get(r.shape_id); if (!a) shp.set(r.shape_id, a = []); a.push([+r.shape_pt_sequence, px(+r.shape_pt_lon), pz(+r.shape_pt_lat)]); }
  const shapeOf = new Map();
  const getShape = id => { if (shapeOf.has(id)) return shapeOf.get(id); const a = (shp.get(id) || []).sort((p, q) => p[0] - q[0]), pts = [], cum = []; let L = 0;
    for (const p of a) { if (pts.length) { const d = Math.hypot(p[1] - pts[pts.length - 1][0], p[2] - pts[pts.length - 1][1]); if (d < 0.3) continue; L += d; } pts.push([p[1], p[2]]); cum.push(L); }
    const o = { pts, cum, len: L }; shapeOf.set(id, o); return o; };
  const alongPoint = (sh, x, z, from) => { let best = 1e18, bs = from; const p = sh.pts; for (let i = 0; i < p.length - 1; i++) { if (sh.cum[i + 1] < from - 1) continue; const ax = p[i][0], az = p[i][1], dx = p[i + 1][0] - ax, dz = p[i + 1][1] - az, l2 = dx * dx + dz * dz; let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); const d = (ax + t * dx - x) ** 2 + (az + t * dz - z) ** 2; if (d < best - 1e-6) { best = d; bs = sh.cum[i] + Math.sqrt(l2) * t; } } return bs; };
  const pointAt = (sh, s) => { let i = 0; while (i < sh.pts.length - 2 && sh.cum[i + 1] < s) i++; const f = Math.max(0, Math.min(1, (s - sh.cum[i]) / ((sh.cum[i + 1] - sh.cum[i]) || 1))); return [sh.pts[i][0] + (sh.pts[i + 1][0] - sh.pts[i][0]) * f, sh.pts[i][1] + (sh.pts[i + 1][1] - sh.pts[i][1]) * f]; };
  // where a shape crosses the edge of the map between two distances along it (bisection on "in the map")
  const edgeBetween = (sh, a, b) => { const inA = inMap(...pointAt(sh, a)); for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (inMap(...pointAt(sh, m)) === inA) a = m; else b = m; } return (a + b) / 2; };
  // the run of a shape between two distances, thinned to 4 m (Douglas–Peucker)
  // the stops on the run stay vertices of it (the page lays the vertices on its streets: a stop must be on the right one)
  const cut = (sh, a, b, at = []) => { const o = [pointAt(sh, a)], fix = [0]; const marks = at.filter(s => s > a && s < b).sort((p, q) => p - q); let mi = 0;
    for (let i = 0; i < sh.pts.length; i++) { while (mi < marks.length && marks[mi] <= sh.cum[i]) { if (marks[mi] > a) { fix.push(o.length); o.push(pointAt(sh, marks[mi])); } mi++; } if (sh.cum[i] > a && sh.cum[i] < b) o.push(sh.pts[i]); }
    while (mi < marks.length) { fix.push(o.length); o.push(pointAt(sh, marks[mi++])); } o.push(pointAt(sh, b));
    const keep = new Uint8Array(o.length); keep[0] = keep[o.length - 1] = 1; for (const k of fix) keep[k] = 1; const st = [[0, o.length - 1]];
    while (st.length) { const [i, j] = st.pop(); let md = 0, mk = -1; const [ax, az] = o[i], [bx, bz] = o[j], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1e-9; for (let k = i + 1; k < j; k++) { const d = Math.abs((o[k][0] - ax) * dz - (o[k][1] - az) * dx) / l; if (d > md) { md = d; mk = k; } } if (md > 4 && mk > 0) { keep[mk] = 1; st.push([i, mk], [mk, j]); } }
    return o.filter((_, k) => keep[k]); };

  const stops = [], stopIdx = new Map(), stopOf = (name, x, z, id) => { const k = id || name + '@' + Math.round(x) + ',' + Math.round(z); if (!stopIdx.has(k)) { stopIdx.set(k, stops.length); stops.push([name, Math.round(x * 10), Math.round(z * 10)]); } return stopIdx.get(k); };
  const routes = [], routeIdx = new Map(); const rt = id => { if (!routeIdx.has(id)) { const r = routesIn.find(q => q.route_id === id) || {}; routeIdx.set(id, routes.length); routes.push([r.route_short_name || '', r.route_long_name || '', 3, 1]); } return routeIdx.get(id); };
  const heads = [], headIdx = new Map(), hd = s => { if (!headIdx.has(s)) { headIdx.set(s, heads.length); heads.push(s); } return headIdx.get(s); };
  const services = [], svcIdx = new Map(), sv = id => { if (!svcIdx.has(id)) { svcIdx.set(id, services.length); services.push(id); } return svcIdx.get(id); };
  const shapes = [], shapeKey = new Map(), patterns = [], patIdx = new Map(), trips = []; let skipped = 0;
  for (const t of want) {
    const st = byTrip.get(t.trip_id).sort((a, b) => +a.stop_sequence - +b.stop_sequence), sh = t.shape_id ? getShape(t.shape_id) : null;
    if (!sh || sh.pts.length < 2) { skipped++; continue; }
    const arr = st.map(r => sec(r.arrival_time || r.departure_time)), dep = st.map((r, i) => r.departure_time ? sec(r.departure_time) : arr[i]);
    let from = 0; const al = st.map(r => { const s = S.get(r.stop_id); const a = alongPoint(sh, s.x, s.z, from); from = a; return a; });
    const on = st.map(r => { const s = S.get(r.stop_id); return inMap(s.x, s.z); }), i0 = on.indexOf(true), i1 = on.lastIndexOf(true);
    // the run on the map: in from the edge before the first stop on it, out to the edge after the last one
    const P = [];   // [stop, along, arr, dep]
    let a0 = al[i0], a1 = al[i1];
    if (i0 > 0) { const e = edgeBetween(sh, al[i0 - 1], al[i0]), f = (e - al[i0 - 1]) / ((al[i0] - al[i0 - 1]) || 1), tt = Math.round(dep[i0 - 1] + (arr[i0] - dep[i0 - 1]) * f), [x, z] = pointAt(sh, e); a0 = e; P.push([stopOf('', x, z), e, tt, tt]); }
    for (let i = i0; i <= i1; i++) if (on[i]) P.push([stopOf(S.get(st[i].stop_id).name, S.get(st[i].stop_id).x, S.get(st[i].stop_id).z, st[i].stop_id), al[i], arr[i], dep[i]]);
    if (i1 < st.length - 1) { const e = edgeBetween(sh, al[i1], al[i1 + 1]), f = (e - al[i1]) / ((al[i1 + 1] - al[i1]) || 1), tt = Math.round(dep[i1] + (arr[i1 + 1] - dep[i1]) * f), [x, z] = pointAt(sh, e); a1 = e; P.push([stopOf('', x, z), e, tt, tt]); }
    if (P.length < 2 || a1 - a0 < 20) { skipped++; continue; }
    // the same run on the map under another shape of the feed is kept once: keyed by its points every 25 m, to 3 m
    const c = cut(sh, a0, a1, P.map(p => p[1])), sk = Array.from({ length: Math.ceil((a1 - a0) / 25) + 1 }, (_, k) => pointAt(sh, Math.min(a1, a0 + k * 25)).map(v => Math.round(v / 3)).join(',')).join(';');
    let si = shapeKey.get(sk); if (si == null) { si = shapes.length; shapeKey.set(sk, si); shapes.push(c); }
    const start = P[0][3], ri = rt(t.route_id), dest = S.get(st[st.length - 1].stop_id).name, key = [ri, si, dest, P.map(p => p[0]).join('.'), P.map(p => p[2] - start).join('.'), P.map(p => p[3] - start).join('.')].join('|');
    let pi = patIdx.get(key);
    if (pi == null) { pi = patterns.length; patIdx.set(key, pi); patterns.push([ri, si, hd(dest), P.map(p => p[0]), P.map(p => Math.round((p[1] - a0) * 10)), P.map(p => p[2] - start), P.map(p => p[3] - start)]); }
    trips.push([pi, start, sv(t.service_id)]);
  }
  trips.sort((a, b) => a[1] - b[1]);
  const encLine = pts => { const o = []; let lx = 0, lz = 0; for (const [x, z] of pts) { const X = Math.round(x * 10), Z = Math.round(z * 10); o.push(X - lx, Z - lz); lx = X; lz = Z; } return o; };
  const out = { feed: { name: 'VSIA Autotransporta direkcija' }, day0: '2026-01-01', routes, stops, heads, shapes: shapes.map(encLine), services: services.map(id => [...svcDays.get(id)].sort((a, b) => a - b)), patterns, trips };
  const js = '/* Regional and intercity buses on the map (GTFS of VSIA Autotransporta direkcija, data.gov.lv), built by tools/intercity.js */\nwindow.INTERCITY=' + JSON.stringify(out) + ';\n';
  fs.writeFileSync(outFile, js);
  console.log('routes', routes.length, 'stops', stops.length, '(at the edge', stops.filter(s => !s[0]).length + ')', 'shapes', shapes.length, 'patterns', patterns.length, 'trips', trips.length, 'skipped', skipped, 'size KB', (js.length / 1024).toFixed(0));
})();
