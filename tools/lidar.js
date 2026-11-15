#!/usr/bin/env node
/* Builds lidar.js — the heights and roof shapes of the buildings of citydata.js — from the LGIA lidar point clouds
   (Digitālā augstuma modeļa pamatdati, CC0; LAS tiles of 1 × 1 km, 2013–2019, see docs/tools-and-sources.md).

   Usage: node tools/lidar.js lidar.js [tile …]
   With no tiles named it takes every tile under a building of citydata.js (about 200, 250 MB each). The tiles are
   streamed through curl and read on the fly, several at once (LIDAR_JOBS, 4 by default); nothing is kept on disk. The
   points kept of a large roof are a random sample, so two runs can differ by a few centimetres.

   For each building:
   - the ground: the mean height of the ground points (class 2) in 4 m cells, 2–7 m outside its walls, the median;
   - its points: the building points (class 6) inside its outline (where outlines overlap, in the smallest), at most
     about 4 a square metre (1500 at most) kept at random;
   - the roof: four shapes fitted by least squares in the frame of the outline's oriented box (u along the long side,
     v across): flat; a gable with the ridge along u (height falls with |v|) or along v (with |u|); a hip (with
     max(|v|, |u| − a + b)); a roof round a flat middle (slopes from the eaves up to a flat top d metres inside the walls,
   d from 1.5 to 10 m, height falling with d − min(distance to the walls, d)). Outlines often take in a porch, an annex or a strip of yard, so the ridge is let off the
     middle by up to 60 % of the half width. A pitched shape is taken when it rises 1 m or more from the eaves to the ridge and fits
     at least 0.1 m better (RMS) than flat, or 0.7 m and 0.2 m better; an outline that fills less than 75 % of its box, or whose best fit is
     still off by more than 1.2 m, is kept as "complex" with its heights only;
   - the heights over the ground: the eaves (where the pitched shape meets the walls; for a flat roof the median of
     its points) and the top (the ridge or the flat top of the fitted shape: a percentile would take in the chimneys;
     the 97th percentile where no shape fits).
   Written per building: the eaves and the top in decimetres and the shape (0 no data, 1 flat, 2 gable along the long
   side, 3 gable across it, 4 hip, 5 round a flat middle or too irregular for the others), as base64 of 5 bytes each, with the number of buildings and a key of
   citydata.js so that the page can tell the two files apart if one is rebuilt without the other. */
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { cityToLKS } = require('./lks92.js');
const [, , outFile, ...only] = process.argv;
if (!outFile) { console.error('usage: node tools/lidar.js lidar.js [tile …]'); process.exit(1); }
const ROOT = path.join(__dirname, '..'), BASE = 'https://s3.storage.pub.lvdc.gov.lv/lgia-opendata/las/';
// the map sheets of 25 km over the city and their south-west corners (LKS-92 metres)
const SHEETS = { 2443: [650000, 175000], 3421: [650000, 200000] };

// ---- the buildings of citydata.js in LKS-92
global.window = {}; require(path.join(ROOT, 'citydata.js')); const C = window.CITY;
const dec = a => { const n = a.length >> 1, o = new Float64Array(n * 2); let x = 0, y = 0; for (let i = 0; i < n; i++) { x += a[2 * i]; y += a[2 * i + 1]; o[2 * i] = x / 10; o[2 * i + 1] = y / 10; } return o; };
const area2 = r => { let s = 0; const n = r.length >> 1; for (let i = 0, j = n - 1; i < n; j = i++) s += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1]; return s / 2; };
const NB = C.b.length, RING = new Array(NB), BB = new Float64Array(NB * 4), AREA = new Float64Array(NB);
let key = 0;
for (let id = 0; id < NB; id++) {
  const rec = C.b[id], rc = dec(rec[7]); key = (key + rec[7][0] * 7 + rec[7][1] * 13 + id) % 1000000007;
  const n = rc.length >> 1, r = new Float64Array(n * 2); let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
  for (let i = 0; i < n; i++) { const [E, N] = cityToLKS(rc[2 * i], rc[2 * i + 1]); r[2 * i] = E; r[2 * i + 1] = N; x0 = Math.min(x0, E); x1 = Math.max(x1, E); y0 = Math.min(y0, N); y1 = Math.max(y1, N); }
  RING[id] = r; BB.set([x0, y0, x1, y1], id * 4); AREA[id] = Math.abs(area2(r));
}
const GS = 25, GRID = new Map(), gk = (i, j) => i * 100000 + j;
for (let id = 0; id < NB; id++) { if (RING[id].length < 6) continue; const b = id * 4;
  for (let i = Math.floor(BB[b] / GS); i <= Math.floor(BB[b + 2] / GS); i++) for (let j = Math.floor(BB[b + 1] / GS); j <= Math.floor(BB[b + 3] / GS); j++) { const k = gk(i, j); let l = GRID.get(k); if (!l) GRID.set(k, l = []); l.push(id); } }
const pip = (x, y, r) => { let c = false; const n = r.length >> 1; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

// ---- the tiles under the buildings
const tileName = (E, N) => { for (const [s, [e0, n0]] of Object.entries(SHEETS)) if (E >= e0 && E < e0 + 25000 && N >= n0 && N < n0 + 25000) { const de = E - e0, dn = N - n0; return `${s}-${Math.floor(dn / 5000) + 1}${Math.floor(de / 5000) + 1}-${Math.floor(dn % 5000 / 1000) + 1}${Math.floor(de % 5000 / 1000) + 1}`; } return null; };
let tiles = only;
if (!tiles.length) { const set = new Set(); for (let id = 0; id < NB; id++) { const b = id * 4; for (let E = Math.floor(BB[b] / 1000) * 1000; E <= BB[b + 2]; E += 1000) for (let N = Math.floor(BB[b + 1] / 1000) * 1000; N <= BB[b + 3]; N += 1000) { const t = tileName(E, N); if (t) set.add(t); } } tiles = [...set].sort(); }

// ---- the ground: mean heights of ground points in 4 m cells over the extent of the buildings
let gx0 = 1e18, gy0 = 1e18, gx1 = -1e18, gy1 = -1e18; for (let id = 0; id < NB; id++) { const b = id * 4; if (!RING[id].length) continue; gx0 = Math.min(gx0, BB[b]); gy0 = Math.min(gy0, BB[b + 1]); gx1 = Math.max(gx1, BB[b + 2]); gy1 = Math.max(gy1, BB[b + 3]); }
const GC = 4; gx0 = Math.floor(gx0 / GC) * GC - 40; gy0 = Math.floor(gy0 / GC) * GC - 40; const GW = Math.ceil((gx1 + 40 - gx0) / GC), GH = Math.ceil((gy1 + 40 - gy0) / GC);
const GSUM = new Float32Array(GW * GH), GCNT = new Uint16Array(GW * GH);
// ---- the building points: up to about 4 a square metre and 1500 per building, kept at random (reservoir sampling),
// as E and N from the corner of the outline's box, and z
const PTS = new Array(NB), SEEN = new Uint32Array(NB), capOf = id => Math.min(1500, Math.max(64, Math.ceil(AREA[id] * 4)));
let rng = 12345; const rand = () => (rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296;
function addPoint(E, N, z) {
  const l = GRID.get(gk(Math.floor(E / GS), Math.floor(N / GS))); if (!l) return; let best = -1;
  for (const id of l) { const b = id * 4; if (E < BB[b] || E > BB[b + 2] || N < BB[b + 1] || N > BB[b + 3]) continue; if ((best < 0 || AREA[id] < AREA[best]) && pip(E, N, RING[id])) best = id; }
  if (best < 0) return; const k = SEEN[best]++, cap = capOf(best); let p = PTS[best]; if (!p) PTS[best] = p = new Float32Array(cap * 3);
  const s = k < cap ? k : Math.floor(rand() * (k + 1)); if (s < cap) { p[3 * s] = E - BB[best * 4]; p[3 * s + 1] = N - BB[best * 4 + 1]; p[3 * s + 2] = z; }
}

// ---- a tile streamed through curl: the header, then 28-byte records of point format 1 (LAS 1.2)
function readTile(name) {
  return new Promise((resolve, reject) => {
    const sheet = name.split('-')[0], cp = spawn('curl', ['-sS', '--fail', '--retry', '3', BASE + sheet + '/' + name + '.las']);
    let head = null, need = 0, rest = Buffer.alloc(0), got = 0, nb = 0, ng = 0, total = 0, err = '';
    cp.stderr.on('data', d => { err += d; });
    cp.stdout.on('data', chunk => {
      let b = rest.length ? Buffer.concat([rest, chunk]) : chunk, o = 0;
      if (!head) { if (b.length < 227) { rest = b; return; } const off = b.readUInt32LE(96), fmt = b[104] & 0x3f, rl = b.readUInt16LE(105);
        if (b.length < off) { rest = b; return; }
        head = { off, fmt, rl, sx: b.readDoubleLE(131), sy: b.readDoubleLE(139), sz: b.readDoubleLE(147), ox: b.readDoubleLE(155), oy: b.readDoubleLE(163), oz: b.readDoubleLE(171), n: b.readUInt32LE(107) };
        if (fmt > 5) { cp.kill(); reject(new Error(name + ': point format ' + fmt)); return; }
        need = head.rl; o = off; }
      const { rl, sx, sy, sz, ox, oy, oz } = head;
      for (; o + rl <= b.length; o += rl) {
        const cls = b[o + 15] & 31; total++;
        if (cls !== 6 && cls !== 2) continue;
        const E = b.readInt32LE(o) * sx + ox, N = b.readInt32LE(o + 4) * sy + oy, z = b.readInt32LE(o + 8) * sz + oz;
        if (cls === 2) { const i = Math.floor((E - gx0) / GC), j = Math.floor((N - gy0) / GC); if (i >= 0 && j >= 0 && i < GW && j < GH) { const k = j * GW + i; GSUM[k] += z; if (GCNT[k] < 65535) GCNT[k]++; } ng++; }
        else { addPoint(E, N, z); nb++; }
      }
      rest = Buffer.from(b.subarray(o)); got += chunk.length;
    });
    cp.on('close', code => { if (code && !head) reject(new Error(name + ': curl ' + code + ' ' + err.trim())); else resolve({ total, nb, ng, mb: got / 1e6, fail: code ? err.trim() : '' }); });
  });
}

// ---- the oriented box of an outline (as obb in src/core/util.js)
function obb(r) {
  const n = r.length >> 1; let best = null;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; let dx = r[2 * j] - r[2 * i], dz = r[2 * j + 1] - r[2 * i + 1]; const l = Math.hypot(dx, dz); if (l < 0.4) continue; dx /= l; dz /= l;
    let u0 = 1e18, u1 = -1e18, v0 = 1e18, v1 = -1e18;
    for (let k = 0; k < n; k++) { const u = r[2 * k] * dx + r[2 * k + 1] * dz, v = -r[2 * k] * dz + r[2 * k + 1] * dx; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0); if (!best || A < best.A) best = { A, dx, dz, u0, u1, v0, v1 }; }
  if (!best) return null; const { dx, dz, u0, u1, v0, v1 } = best, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  let a = (u1 - u0) / 2, b = (v1 - v0) / 2, ux = dx, uz = dz; if (b > a) { const t = a; a = b; b = t; ux = -dz; uz = dx; }
  return { cx: cu * dx - cv * dz, cz: cu * dz + cv * dx, ux, uz, a, b, fill: Math.abs(area2(r)) / best.A };
}
const segD = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); return Math.hypot(x - ax - dx * t, y - ay - dy * t); };
const edgeD = (x, y, r) => { let d = 1e18; const n = r.length >> 1; for (let i = 0, j = n - 1; i < n; j = i++) d = Math.min(d, segD(x, y, r[2 * j], r[2 * j + 1], r[2 * i], r[2 * i + 1])); return d; };
const median = a => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const pct = (a, q) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// the ground round a building: 4 m cells 2–7 m outside its walls
function groundOf(id) {
  const r = RING[id], n = r.length >> 1, vals = [], ccw = area2(r) > 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = r[2 * i], ay = r[2 * i + 1], bx = r[2 * j], by = r[2 * j + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.5) continue;
    const nx = (by - ay) / L * (ccw ? 1 : -1), ny = -(bx - ax) / L * (ccw ? 1 : -1);   // outwards
    for (let t = 0.5; t < L; t += 3) for (const d of [3, 6]) { const x = ax + (bx - ax) * t / L + nx * d, y = ay + (by - ay) * t / L + ny * d;
      if (pip(x, y, r)) continue; const ci = Math.floor((x - gx0) / GC), cj = Math.floor((y - gy0) / GC); if (ci < 0 || cj < 0 || ci >= GW || cj >= GH) continue; const k = cj * GW + ci; if (GCNT[k]) vals.push(GSUM[k] / GCNT[k]); } }
  return vals.length >= 3 ? median(vals) : NaN;
}

// a straight line z = R − s f by least squares: [R, s, rms]
function fitLine(F, Z) { let n = F.length, sf = 0, sz = 0, sff = 0, sfz = 0; for (let i = 0; i < n; i++) { sf += F[i]; sz += Z[i]; sff += F[i] * F[i]; sfz += F[i] * Z[i]; }
  const den = n * sff - sf * sf; let s = 0, R = sz / n; if (Math.abs(den) > 1e-9) { const k = (n * sfz - sf * sz) / den; s = -k; R = (sz - k * sf) / n; }
  let e = 0; for (let i = 0; i < n; i++) { const d = Z[i] - (R - s * F[i]); e += d * d; } return [R, s, Math.sqrt(e / n)]; }

function analyse(id) {
  const p = PTS[id], m = Math.min(SEEN[id], capOf(id)); if (!p || SEEN[id] < Math.max(12, AREA[id] * 0.25)) return null;
  const z0 = groundOf(id); if (!Number.isFinite(z0)) return null;
  const r = RING[id], o = obb(r); if (!o) return null;
  const U = [], V = [], Z = [], DE = [];
  for (let k = 0; k < m; k++) { const E = BB[id * 4] + p[3 * k], N = BB[id * 4 + 1] + p[3 * k + 1], z = p[3 * k + 2] - z0, de = edgeD(E, N, r); if (z < 1.5 || de < 0.4) continue; U.push((E - o.cx) * o.ux + (N - o.cz) * o.uz); V.push(-(E - o.cx) * o.uz + (N - o.cz) * o.ux); Z.push(z); DE.push(de); }
  if (Z.length < 10) return null;
  const top = pct(Z, 0.97), flat = fitLine(Z.map(() => 0), Z);
  // the ridge may lie off the middle of the outline (an outline taking in a porch, an annex or a strip of yard): each
  // shape is fitted with its ridge moved across (and a hip also along) by up to 60 % of the half width, in 0.25 m steps
  const offs = w => { const o2 = []; for (let d = -0.6 * w; d <= 0.6 * w + 1e-9; d += 0.25) o2.push(d); return o2; };
  const models = [];
  for (const dv of offs(o.b)) models.push(['gableL', V.map(v => Math.abs(v - dv)), o.b]);
  for (const du of offs(o.a)) models.push(['gableS', U.map(u => Math.abs(u - du)), o.a]);
  for (const dv of offs(o.b).filter((_, k) => k % 2 === 0)) for (const du of offs(Math.max(0, o.a - o.b)).filter((_, k) => k % 2 === 0)) models.push(['hip', U.map((u, i) => Math.max(Math.abs(V[i] - dv), Math.abs(u - du) - (o.a - o.b))), o.b]);
  // a roof round a flat middle: slopes from the eaves up to a flat top d metres inside the walls (large blocks)
  for (const d of [1.5, 2.5, 4, 6, 8, 10]) if (d < o.b * 0.9) models.push(['inset', DE.map(x => d - Math.min(x, d)), d]);
  let best = null; for (const [name, F, w] of models) { const [R, s, e] = fitLine(F, Z); const rise = s * w; if (s > 0 && (!best || e < best.e)) best = { name, R, s, e, rise, eave: R - s * w }; }
  const pitched = best && ((best.rise >= 1.0 && best.e <= flat[2] - 0.1) || (best.rise >= 0.7 && best.e <= flat[2] - 0.2));
  let type, eave, ridge = top;
  if (pitched && best.name !== 'inset' && o.fill >= 0.75 && best.e <= 1.2) { type = best.name === 'gableL' ? 2 : best.name === 'gableS' ? 3 : 4; eave = Math.max(1.5, best.eave); ridge = best.R; }
  else if (pitched && best.name === 'inset' && best.e <= 1.2) { type = 5; eave = Math.max(1.5, best.eave); ridge = best.R; }
  else if (pitched) { type = 5; eave = Math.max(1.5, pct(Z, 0.2)); }
  else { type = 1; eave = median(Z); }
  return { eave, top: Math.max(eave, ridge), type };
}

(async () => {
  // several tiles at once (LIDAR_JOBS, 4 by default): one download runs at a few MB/s and the reading takes little
  const t0 = Date.now(), JOBS = Math.max(1, +process.env.LIDAR_JOBS || 4); console.log(`${NB} buildings, ${tiles.length} tiles, ${JOBS} at a time`);
  let next = 0, done = 0;
  const worker = async () => { while (next < tiles.length) { const t = tiles[next++];
    try { const s = await readTile(t); done++; console.log(`${done}/${tiles.length} ${t}: ${s.total} points, ${s.nb} building, ${s.ng} ground, ${s.mb.toFixed(0)} MB${s.fail ? ' (' + s.fail + ')' : ''} — ${((Date.now() - t0) / 1000).toFixed(0)} s`); }
    catch (e) { done++; console.log(`${done}/${tiles.length} ${t}: skipped (${e.message})`); } } };
  await Promise.all(Array.from({ length: JOBS }, worker));
  const out = Buffer.alloc(NB * 5); const cnt = [0, 0, 0, 0, 0, 0];
  for (let id = 0; id < NB; id++) { const a = analyse(id); if (!a) { cnt[0]++; continue; } cnt[a.type]++;
    out.writeUInt16LE(Math.min(65535, Math.round(a.eave * 10)), id * 5); out.writeUInt16LE(Math.min(65535, Math.round(a.top * 10)), id * 5 + 2); out[id * 5 + 4] = a.type; }
  const head = '/* Heights and roof shapes of the buildings of citydata.js from the LGIA lidar point clouds (Digitālā augstuma modeļa pamatdati, CC0), built by tools/lidar.js */\n';
  fs.writeFileSync(outFile, head + 'window.LIDAR = ' + JSON.stringify({ n: NB, key, d: out.toString('base64') }) + ';\n');
  console.log(`no data ${cnt[0]}, flat ${cnt[1]}, gable along ${cnt[2]}, gable across ${cnt[3]}, hip ${cnt[4]}, complex ${cnt[5]} — ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})();
