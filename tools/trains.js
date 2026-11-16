#!/usr/bin/env node
/* Builds trains.js — the passenger trains through Daugavpils on their real timetable, and what the railway station
   has round its tracks — from the GTFS feed of the domestic trains (Vivi, published by VSIA Autotransporta direkcija on
   data.gov.lv: https://vivi.lv/uploads/GTFS.zip) and an OpenStreetMap extract round the station.

   Usage: node tools/trains.js <gtfs dir> <citydata.js> <station.osm> trains.js
   where station.osm is the OSM API answer for the station and its yard:
   https://api.openstreetmap.org/api/0.6/map?bbox=26.52158,55.87172,26.53279,55.87756

   Trains: every trip that stops at Daugavpils. Only the station lies on the map, so a trip is kept as its run in from the
   stop before (its departure there, the distance along the line) and out to the stop after, and the time it stands at
   Daugavpils. The lines out of the station, as far as the edge of the map, are "legs" (the Riga line to the north-west,
   the Krāslava line to the east), taken from the shapes of the feed; a trip with no shape takes them from a trip with one
   between the same stops. The page lays each leg on the drawn tracks.
   Station: the platforms (but the main one, drawn with the station building by lmStation), the footbridge over the
   tracks with its steps, the pedestrian crossings over the tracks, the level crossings, the signals (main or shunting,
   which way they face and on which side of the track), the buffer stops, and the stop position of the trains. */
'use strict';
const fs = require('fs'), path = require('path');
const [dir, cityFile, osmFile, outFile] = process.argv.slice(2);
if (!outFile) { console.error('usage: node tools/trains.js <gtfs dir> <citydata.js> <station.osm> trains.js'); process.exit(1); }
const head = fs.readFileSync(cityFile, 'utf8').slice(0, 400), num = k => +head.match(new RegExp('"' + k + '":(-?[0-9.e+-]+)'))[1];
const LAT0 = num('lat0'), LON0 = num('lon0'), KX = num('kx'), KY = num('ky'), EDGE = 6400;
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
const r1 = v => Math.round(v * 10) / 10;

// ---------- the timetable ----------
const stops = new Map(csv('stops.txt').map(s => [s.stop_id, { name: s.stop_name, x: px(+s.stop_lon), z: pz(+s.stop_lat) }]));
const routes = new Map(csv('routes.txt').map(r => [r.route_id, r.route_long_name]));
const trips = csv('trips.txt'), times = new Map();
for (const r of csv('stop_times.txt')) { let l = times.get(r.trip_id); if (!l) times.set(r.trip_id, l = []); l.push(r); }
const calIn = fs.existsSync(path.join(dir, 'calendar.txt')) ? csv('calendar.txt') : [], datesIn = fs.existsSync(path.join(dir, 'calendar_dates.txt')) ? csv('calendar_dates.txt') : [];
const svcDays = new Map();
for (const c of calIn) {
  const s = new Set(), a = dayNum(c.start_date), b = dayNum(c.end_date), W = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let d = a; d <= b; d++) { const wd = new Date((d + DAY0) * 864e5).getUTCDay(); if (c[W[wd]] === '1') s.add(d); }
  svcDays.set(c.service_id, s);
}
for (const r of datesIn) { let s = svcDays.get(r.service_id); if (!s) svcDays.set(r.service_id, s = new Set()); if (r.exception_type === '1') s.add(dayNum(r.date)); else s.delete(dayNum(r.date)); }

// shapes in the frame of the city, with the distance along them
const shapes = new Map();
for (const r of csv('shapes.txt')) { let l = shapes.get(r.shape_id); if (!l) shapes.set(r.shape_id, l = []); l.push([+r.shape_pt_sequence, px(+r.shape_pt_lon), pz(+r.shape_pt_lat)]); }
for (const [id, l] of shapes) { l.sort((a, b) => a[0] - b[0]); const pts = l.map(p => [p[1], p[2]]), cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); shapes.set(id, { pts, cum }); }
// where a stop lies along a shape (the nearest point, from `from` on): [distance along, how far off]
function along(sh, x, z, from = 0) {
  let best = [0, Infinity];
  for (let i = 0; i + 1 < sh.pts.length; i++) { if (sh.cum[i + 1] < from) continue; const [ax, az] = sh.pts[i], [bx, bz] = sh.pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * t - x, az + dz * t - z); if (d < best[1]) best = [sh.cum[i] + Math.sqrt(l2) * t, d]; }
  return best;
}
const pointAt = (sh, s) => { let i = 0; while (i < sh.pts.length - 2 && sh.cum[i + 1] < s) i++; const f = Math.max(0, Math.min(1, (s - sh.cum[i]) / ((sh.cum[i + 1] - sh.cum[i]) || 1))); return [sh.pts[i][0] + (sh.pts[i + 1][0] - sh.pts[i][0]) * f, sh.pts[i][1] + (sh.pts[i + 1][1] - sh.pts[i][1]) * f]; };

const DAU = [...stops].find(([, s]) => s.name === 'Daugavpils')[0];
// the line between two stops, from the shape of any trip that runs between them: { dist, out: the points from Daugavpils on }
const pairs = new Map();
function pairLine(a, b) {
  const key = a + '>' + b; if (pairs.has(key)) return pairs.get(key);
  let res = null;
  for (const t of trips) { const sh = shapes.get(t.shape_id); if (!sh) continue; const st = times.get(t.trip_id).map(r => r.stop_id); const i = st.indexOf(a), j = st.indexOf(b); if (i < 0 || j !== i + 1) continue;
    const A = stops.get(a), B = stops.get(b), [sa, da] = along(sh, A.x, A.z), [sb, db] = along(sh, B.x, B.z, sa); if (da > 300 || db > 300 || sb <= sa) continue;
    // the run out of Daugavpils (forwards when it starts there, backwards when it ends there), as far as the map goes
    const fromD = a === DAU, s0 = fromD ? sa : sb, s1 = fromD ? sb : sa, out = [];
    for (let s = s0; fromD ? s <= s1 : s >= s1; s += fromD ? 10 : -10) { const p = pointAt(sh, s); out.push(p); if (Math.abs(p[0]) > EDGE || Math.abs(p[1]) > EDGE) break; }
    res = { dist: sb - sa, out }; break; }
  pairs.set(key, res); return res;
}

// ---------- the legs and the trips through Daugavpils ----------
const legs = [], legOf = out => {   // the same leg for the runs whose points 1.5 km out lie within 150 m of each other
  const k = Math.min(out.length - 1, 150), p = out[k];
  let i = legs.findIndex(L => Math.hypot(L.probe[0] - p[0], L.probe[1] - p[1]) < 150 && L.k === k);
  if (i < 0) { i = legs.length; legs.push({ out, probe: p, k }); } else if (out.length > legs[i].out.length) legs[i].out = out;
  return i;
};
const services = [], svcIdx = new Map(), sv = id => { if (!svcIdx.has(id)) { svcIdx.set(id, services.length); services.push(id); } return svcIdx.get(id); };
const out = []; let skipped = 0;
for (const t of trips) {
  const st = (times.get(t.trip_id) || []).sort((a, b) => +a.stop_sequence - +b.stop_sequence), k = st.findIndex(r => r.stop_id === DAU); if (k < 0) continue;
  const prev = st[k - 1], next = st[k + 1], here = st[k];
  const pin = prev ? pairLine(prev.stop_id, DAU) : null, pout = next ? pairLine(DAU, next.stop_id) : null;
  if ((prev && !pin) || (next && !pout)) { skipped++; continue; }
  const name = routes.get(t.route_id), last = st[st.length - 1];
  out.push([name, stops.get(last.stop_id).name, sv(t.service_id),
    pin ? legOf(pin.out) : -1, prev ? stops.get(prev.stop_id).name : '', prev ? sec(prev.departure_time) : 0, pin ? Math.round(pin.dist) : 0,
    sec(here.arrival_time), sec(here.departure_time),
    pout ? legOf(pout.out) : -1, next ? stops.get(next.stop_id).name : '', next ? sec(next.arrival_time) : 0, pout ? Math.round(pout.dist) : 0]);
}
out.sort((a, b) => a[7] - b[7]);

// ---------- the station from OSM ----------
const xml = fs.readFileSync(osmFile, 'utf8'), attr = (s, k) => { const m = s.match(new RegExp('\\b' + k + '="([^"]*)"')); return m ? m[1] : null; };
const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tagsOf = body => { const t = {}; for (const m of (body || '').matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[unesc(m[1])] = unesc(m[2]); return t; };
const N = new Map(), NT = new Map(), W = [];
for (const m of xml.matchAll(/<node\b([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) { const id = attr(m[1], 'id'); N.set(id, [r1(px(+attr(m[1], 'lon'))), r1(pz(+attr(m[1], 'lat')))]); if (m[3]) NT.set(id, tagsOf(m[3])); }
for (const m of xml.matchAll(/<way\b([^>]*?)>([\s\S]*?)<\/way>/g)) W.push({ id: attr(m[1], 'id'), nds: [...m[2].matchAll(/<nd ref="([^"]*)"/g)].map(x => x[1]), t: tagsOf(m[2]) });
const ptsOf = w => w.nds.map(i => N.get(i)).filter(Boolean), flat = p => p.flat();
const rails = W.filter(w => w.t.railway === 'rail'), trams = W.filter(w => w.t.railway === 'tram');
const nearLine = (ws, x, z) => { let d = Infinity; for (const w of ws) { const p = ptsOf(w); for (let i = 0; i + 1 < p.length; i++) { const [ax, az] = p[i], [bx, bz] = p[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z)); } } return d; };
// the direction of the rail way through a node (along the way), and the way's index of it
const railAt = id => { for (const w of rails) { const k = w.nds.indexOf(id); if (k < 0) continue; const p = ptsOf(w), a = p[Math.max(0, k - 1)], b = p[Math.min(p.length - 1, k + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return { dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l, k, n: w.nds.length }; } return null; };
const MAIN_PLATFORM = '367785278';   // drawn with the station building (lmStation)
const S = { stop: null, platforms: [], plines: [], bridges: [], steps: [], crossings: [], level: [], signals: [], buffers: [] };
for (const w of W) {
  const t = w.t, p = ptsOf(w);
  if (t.railway === 'platform' && w.id !== MAIN_PLATFORM) {
    const c = p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]); if (nearLine(trams, c[0], c[1]) < 8) continue;   // a tram stop
    if (w.nds[0] === w.nds[w.nds.length - 1]) S.platforms.push(flat(p.slice(0, -1))); else S.plines.push(flat(p));
  }
  if (t.bridge === 'yes' && (t.highway === 'footway' || t.highway === 'steps') && nearLine(rails, ...p[Math.floor(p.length / 2)]) < 25) (t.highway === 'steps' ? S.steps : S.bridges).push(flat(p));
}
for (const [id, t] of NT) {
  const p = N.get(id);
  if (t.railway === 'stop' && t.name === 'Daugavpils') S.stop = p;
  else if (t.railway === 'crossing' || t.railway === 'level_crossing') { const r = railAt(id); if (r) (t.railway === 'crossing' ? S.crossings : S.level).push([...p, r1(r.dx * 100) / 100, r1(r.dz * 100) / 100]); }
  else if (t.railway === 'signal') { const r = railAt(id); if (!r) continue; const back = t['railway:signal:direction'] === 'backward' ? -1 : 1, side = t['railway:signal:position'] === 'left' ? -1 : 1;
    S.signals.push([...p, r1(r.dx * back * 100) / 100, r1(r.dz * back * 100) / 100, side, t['railway:signal:main'] ? 0 : 1]); }
  else if (t.railway === 'buffer_stop') { const r = railAt(id); if (!r) continue; const end = r.k === 0 ? -1 : 1;   // pointing out of the track at its end
    S.buffers.push([...p, r1(r.dx * end * 100) / 100, r1(r.dz * end * 100) / 100]); }
}
// steps: from their foot to the deck of the bridge they meet
for (const s of S.steps) { const a = [s[0], s[1]], b = [s[s.length - 2], s[s.length - 1]], onDeck = q => S.bridges.some(d => { for (let i = 0; i < d.length; i += 2) if (Math.hypot(d[i] - q[0], d[i + 1] - q[1]) < 0.5) return true; return false; }); if (onDeck(a) && !onDeck(b)) { s.splice(0, s.length, ...b, ...a); } }

const enc = pts => { const o = []; let x = 0, z = 0; for (const [a, b] of pts) { const X = Math.round(a * 10), Z = Math.round(b * 10); o.push(X - x, Z - z); x = X; z = Z; } return o; };
const feedDate = fs.statSync(path.join(dir, 'stop_times.txt')).mtime.toISOString().slice(0, 10);
const data = {
  feed: 'Vivi GTFS ' + feedDate, station: stops.get(DAU).name,
  legs: legs.map(L => enc(L.out.filter(([x, z]) => Math.abs(x) <= EDGE + 50 && Math.abs(z) <= EDGE + 50))),
  trips: out, services: services.map(id => [...(svcDays.get(id) || [])].sort((a, b) => a - b)), S
};
const js = '/* Passenger trains through Daugavpils (Vivi GTFS, VSIA Autotransporta direkcija, data.gov.lv) and the railway station from OpenStreetMap (© OpenStreetMap contributors, ODbL), built by tools/trains.js */\nwindow.TRAINS = ' + JSON.stringify(data) + ';\n';
fs.writeFileSync(outFile, js);
console.log(`trips ${out.length} (skipped ${skipped}), legs ${legs.length} (${legs.map(L => L.out.length * 10 + ' m').join(', ')}), platforms ${S.platforms.length}+${S.plines.length}, bridges ${S.bridges.length}, steps ${S.steps.length}, crossings ${S.crossings.length}, level ${S.level.length}, signals ${S.signals.length}, buffers ${S.buffers.length}, stop ${S.stop}; ${(js.length / 1024).toFixed(0)} KB`);
