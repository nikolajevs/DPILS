#!/usr/bin/env node
/* Builds lidar.js — the heights and roof shapes of the buildings of citydata.js — from the LGIA lidar point clouds
   (Digitālā augstuma modeļa pamatdati, CC0; LAS tiles of 1 × 1 km, 2013–2019, see docs/tools-and-sources.md).

   Usage: node tools/lidar.js lidar.js [--trees lidar-trees.js [--raw trees-raw.bin]] [tile …]
          node tools/lidar.js --from trees-raw.bin --trees lidar-trees.js
   --raw keeps every tree found with its measures (13 MB for the city), --from sorts them again into lidar-trees.js
   without reading the tiles: for tuning kindOf.
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
const { cityToLKS, lksToCity } = require('./lks92.js');
const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const treesFile = opt('--trees'), rawFile = opt('--raw'), fromFile = opt('--from');
const [outFile, ...only] = args;
if (fromFile ? !treesFile : !outFile) { console.error('usage: node tools/lidar.js lidar.js [--trees lidar-trees.js] [--raw trees-raw.bin] [tile …]\n       node tools/lidar.js --from trees-raw.bin --trees lidar-trees.js'); process.exit(1); }
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

// ---- a tile streamed through curl: the header, then 28-byte records of point format 1 (LAS 1.2). A stream cut off on
// the way (the server resets a long download now and then) goes on from the byte it reached, up to 5 times.
function readTile(name) {
  return new Promise((resolve, reject) => {
    const url = BASE + name.split('-')[0] + '/' + name + '.las'; let cp = null, tries = 0, dead = false;
    let head = null, need = 0, rest = Buffer.alloc(0), got = 0, nb = 0, ng = 0, total = 0, err = '', chm = null, vcnt = null, zsum = null, isum = null, vone = null, cx0 = 0, cy0 = 0;
    const onData = chunk => {
      if (dead) return; got += chunk.length;
      let b = rest.length ? Buffer.concat([rest, chunk]) : chunk, o = 0;
      if (!head) { if (b.length < 227) { rest = b; return; } const off = b.readUInt32LE(96), fmt = b[104] & 0x3f, rl = b.readUInt16LE(105);
        if (b.length < off) { rest = b; return; }
        head = { off, fmt, rl, sx: b.readDoubleLE(131), sy: b.readDoubleLE(139), sz: b.readDoubleLE(147), ox: b.readDoubleLE(155), oy: b.readDoubleLE(163), oz: b.readDoubleLE(171), n: b.readUInt32LE(107) };
        if (fmt > 5) { dead = true; cp.kill(); reject(new Error(name + ': point format ' + fmt)); return; }
        need = head.rl; o = off;
        if (treesFile) { cx0 = Math.floor(b.readDoubleLE(187)); cy0 = Math.floor(b.readDoubleLE(203)); chm = new Float32Array(CW * CW).fill(-1e9); vcnt = new Uint16Array(CW * CW); zsum = new Float32Array(CW * CW); isum = new Float32Array(CW * CW); vone = new Uint16Array(CW * CW); } }
      const { rl, sx, sy, sz, ox, oy, oz } = head;
      for (; o + rl <= b.length; o += rl) {
        const cls = b[o + 15] & 31; total++;
        if (chm && (cls === 4 || cls === 5)) { const i = Math.floor(b.readInt32LE(o) * sx + ox - cx0), j = Math.floor(b.readInt32LE(o + 4) * sy + oy - cy0); if (i >= 0 && j >= 0 && i < CW && j < CW) { const k = j * CW + i, z = b.readInt32LE(o + 8) * sz + oz; if (z > chm[k]) chm[k] = z; if (vcnt[k] < 65535) { vcnt[k]++; zsum[k] += z; isum[k] += b.readUInt16LE(o + 12); if ((b[o + 14] >> 3 & 7) === 1) vone[k]++; } } continue; }
        if (cls !== 6 && cls !== 2) continue;
        const E = b.readInt32LE(o) * sx + ox, N = b.readInt32LE(o + 4) * sy + oy, z = b.readInt32LE(o + 8) * sz + oz;
        if (cls === 2) { const i = Math.floor((E - gx0) / GC), j = Math.floor((N - gy0) / GC); if (i >= 0 && j >= 0 && i < GW && j < GH) { const k = j * GW + i; GSUM[k] += z; if (GCNT[k] < 65535) GCNT[k]++; } ng++; }
        else { addPoint(E, N, z); nb++; }
      }
      rest = Buffer.from(b.subarray(o));
    };
    const fetch = () => {
      err = ''; cp = spawn('curl', ['-sS', '--fail', '--retry', '3', ...(got ? ['-r', got + '-'] : []), url]);
      cp.stderr.on('data', d => { err += d; }); cp.stdout.on('data', onData);
      cp.on('close', code => {
        if (dead) return;
        if (code && !head) { reject(new Error(name + ': curl ' + code + ' ' + err.trim())); return; }
        if ((code || total < head.n) && tries < 5) { tries++; fetch(); return; }
        const nt = chm ? treesOf({ chm, vcnt, zsum, isum, vone }, cx0, cy0) : 0;
        resolve({ total, nb, ng, nt, mb: got / 1e6, tries, fail: code ? err.trim() : total < head.n ? `${head.n - total} points missing` : '' });
      });
    };
    fetch();
  });
}

// ---- trees (with --trees): the canopy of each tile on a 1 m grid — the highest point of the medium and high vegetation
// (classes 4 and 5) over the ground, the empty cells closed with the highest of their 3 × 3 (the survey was flown with
// the broadleaf trees bare, their crowns patchy) and lightly smoothed. A tree is a local maximum of 4 m or more, the
// highest within a window that grows with it (3 to 5 m), with at least 0.35 vegetation points a square metre round it
// (fewer is a pole, a wire or a bush); its crown reaches in 8 directions (up to 14 m) until the canopy falls under 55 %
// of its height or rises again into the next crown. Measured for its kind (kindOf below) in the middle of the crown:
// dn, the vegetation points a square metre round the top; mz, how high they lie on the whole (their mean over the
// ground, as a share of the height); mi, their mean intensity; fo, the share of them that are the only return of their
// pulse. No species is in the data; the flights were in spring (the centre on 13 May 2017).
const CW = 1000, TREES = [];
function groundAt(E, N) { const ci = Math.floor((E - gx0) / GC), cj = Math.floor((N - gy0) / GC); let s = 0, n = 0;
  for (let r = 0; r <= 3 && !n; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= GW || j >= GH) continue; const k = j * GW + i; if (GCNT[k]) { s += GSUM[k] / GCNT[k]; n++; } }
  return n ? s / n : NaN; }
function treesOf({ chm, vcnt, zsum, isum, vone }, x0, y0) {
  const W = CW, h0 = new Float32Array(W * W), h = new Float32Array(W * W), sm = new Float32Array(W * W); let gE = NaN, gN = NaN, g = NaN;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (chm[k] < -1e8) continue; const E = x0 + i + 0.5, N = y0 + j + 0.5;
    if (!(Math.abs(E - gE) < 4 && Math.abs(N - gN) < 4)) { g = groundAt(E, N); gE = E; gN = N; } if (Number.isFinite(g)) h0[k] = Math.max(0, chm[k] - g); }
  // the gaps closed: a cell with no vegetation point takes the highest of its 3 × 3 (a bare crown in spring is patchy)
  for (let j = 1; j < W - 1; j++) for (let i = 1; i < W - 1; i++) { const k = j * W + i; let m = h0[k]; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m = Math.max(m, h0[k + dj * W + di]); h[k] = m; }
  for (let j = 1; j < W - 1; j++) for (let i = 1; i < W - 1; i++) { const k = j * W + i; sm[k] = (4 * h[k] + 2 * (h[k - 1] + h[k + 1] + h[k - W] + h[k + W]) + h[k - W - 1] + h[k - W + 1] + h[k + W - 1] + h[k + W + 1]) / 16; }
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]; let n = 0;
  for (let j = 4; j < W - 4; j++) for (let i = 4; i < W - 4; i++) {
    const k = j * W + i, v = sm[k]; if (v < 4 || v > 45) continue; const w = v < 10 ? 3 : v < 20 ? 4 : 5; let top = true;
    for (let dj = -w; dj <= w && top; dj++) for (let di = -w; di <= w; di++) { if (!di && !dj || di * di + dj * dj > w * w + 1) continue; const q = sm[k + dj * W + di]; if (q > v || (q === v && (dj < 0 || (!dj && di < 0)))) { top = false; break; } }
    if (!top) continue;
    let hm = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) hm = Math.max(hm, h[k + dj * W + di]);
    let rs = 0; for (const [dx, dy] of DIRS) { const st = dx && dy ? Math.SQRT2 : 1; let d = 1, prev = v;
      for (; d <= 14; d++) { const ii = i + dx * d, jj = j + dy * d; if (ii < 0 || jj < 0 || ii >= W || jj >= W) break; const q = sm[jj * W + ii]; if (q < 0.55 * v || q > prev + 0.3) break; prev = q; }
      rs += (d - 0.5) * st; }
    let dn = 0, dc = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (di * di + dj * dj <= 5) { dn += vcnt[k + dj * W + di]; dc++; } dn /= dc;   // vegetation points a square metre round the top
    if (dn < 0.35) continue;   // a few stray points: a pole, a wire, a bush
    const r = Math.max(1, Math.min(12, rs / 8)), E = x0 + i + 0.5, N = y0 + j + 0.5, g = groundAt(E, N);
    // the middle of the crown (half its radius, 2 to 4 m): how high its points lie on the whole, how bright they come
    // back, and how many are the only return of their pulse
    const rc = Math.max(2, Math.min(4, r / 2)), R = Math.ceil(rc); let pc = 0, ps = 0, pi = 0, po = 0;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { if (di * di + dj * dj > rc * rc) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= W) continue; const q = jj * W + ii; pc += vcnt[q]; ps += zsum[q]; pi += isum[q]; po += vone[q]; }
    if (!pc || !Number.isFinite(g)) continue;
    TREES.push(E - SHEETS[2443][0], N - SHEETS[2443][1], hm, r, dn, Math.max(0, Math.min(1.2, (ps / pc - g) / hm)), pi / pc, po / pc); n++;
  }
  return n;
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

/* the trees: the same crown seen from two tiles (cut at their border) is kept once, the higher top within 2.5 m; then
   in the frame of the city, those in the woods of citydata.js (land class 1) left out, the page draws the woods itself.
   Written as base64 of 6 bytes a tree: x and z in 0.2 m from −6600 m, the height in 0.2 m, the crown radius in 0.8 m
   (high 4 bits, up to 12 m) and the kind (0 pine, 1 broadleaf, 2 birch, 3 spruce). */
const NF = 8;   // a tree in TREES and in the raw file: E and N from the corner of sheet 2443, height, crown radius, dn, mz, mi, fo
/* The kind of a tree from its measures (0 pine, 1 broadleaf, 2 birch, 3 spruce), or −1 for what is no tree. Measured on
   trees whose kind is known: the old broadleaf trees of Dubrovina parks, the spruces by Vienības laukums, the pine woods
   by the Stropi lakes. In May the broadleaf crowns are bare or coming into leaf: their points come back dim (intensity
   about 20–28) and few are the only return of their pulse (fo under 0.12). Needles come back brighter (30–55) and more
   often alone (0.12–0.45); a spruce, its crown reaching down to the ground, has its points lower (mz under 0.66) than a
   pine. A broadleaf crown in between (brighter or more single returns, already in leaf) and not wide is taken for a
   birch, the first to leaf; poplars and willows will be among them. Brighter still (60 and more) or nearly all single
   returns, mostly with few points round the top, are the edges of roofs, balconies and walls the classification took
   for vegetation: within a metre or two of the walls, and left out. */
function kindOf(h, r, dn, mz, mi, fo) {
  if (fo >= 0.6 || mi >= 60 || (dn < 2 && (fo >= 0.3 || mi >= 40))) return -1;
  if (dn >= 2 && mi >= 30 && fo >= 0.12 && r / h < 0.5) return mz < 0.66 ? 3 : 0;
  return (fo >= 0.12 || mi >= 30) && r / h < 0.45 ? 2 : 1;
}
function writeTrees(file) {
  const T = TREES, n = T.length / NF, ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => T[NF * b + 2] - T[NF * a + 2]), kept = new Map(), out = [];
  const woods = []; for (const a of C.a) if (a[0] === 1) { const rings = a.slice(1).map(dec); const r = rings[0]; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); } woods.push({ rings, bb: [x0, z0, x1, z1] }); }
  const inWoods = (x, z) => woods.some(w => x >= w.bb[0] && x <= w.bb[2] && z >= w.bb[1] && z <= w.bb[3] && pip(x, z, w.rings[0]) && !w.rings.some((h, k) => k && pip(x, z, h)));
  let dup = 0, wood = 0, outside = 0;
  for (const i of ord) { const E = T[NF * i], N = T[NF * i + 1], ck = Math.floor(E / 5) * 100000 + Math.floor(N / 5); let near = false;
    for (let a = -1; a <= 1 && !near; a++) for (let b = -1; b <= 1 && !near; b++) for (const q of kept.get(ck + a * 100000 + b) || []) if (Math.hypot(T[NF * q] - E, T[NF * q + 1] - N) < 2.5) { near = true; break; }
    if (near) { dup++; continue; } let l = kept.get(ck); if (!l) kept.set(ck, l = []); l.push(i);
    const [x, z] = lksToCity(E + SHEETS[2443][0], N + SHEETS[2443][1]); if (Math.abs(x) > 6500 || Math.abs(z) > 6500) { outside++; continue; } if (inWoods(x, z)) { wood++; continue; } out.push(i, x, z); }
  // the intensity is not on the same scale in every tile (other flights, other years): it is scaled per tile so that its
  // bare broadleaf crowns (dense, with hardly a single return: fo under 0.08) come back at 24 on the whole
  const tileOf = i => Math.floor(T[NF * i] / 1000) * 1000 + Math.floor(T[NF * i + 1] / 1000), bare = new Map(), scale = new Map();
  for (let i = 0; i < n; i++) if (T[NF * i + 4] >= 4 && T[NF * i + 7] < 0.08) { const k = tileOf(i); let l = bare.get(k); if (!l) bare.set(k, l = []); l.push(T[NF * i + 6]); }
  for (const [k, l] of bare) if (l.length >= 30) scale.set(k, 24 / median(l));
  const kinds = [0, 0, 0, 0], kept2 = []; let none = 0;
  for (let k = 0; k < out.length; k += 3) { const i = out[k], mi = T[NF * i + 6] * (scale.get(tileOf(i)) || 1), t = kindOf(T[NF * i + 2], T[NF * i + 3], T[NF * i + 4], T[NF * i + 5], mi, T[NF * i + 7]); if (t < 0) { none++; continue; } kinds[t]++; kept2.push(i, out[k + 1], out[k + 2], t); }
  const m = kept2.length / 4, bin = Buffer.alloc(m * 6);
  for (let k = 0; k < m; k++) { const i = kept2[4 * k], x = kept2[4 * k + 1], z = kept2[4 * k + 2], t = kept2[4 * k + 3], f = T.slice(NF * i, NF * i + NF);
    bin.writeUInt16LE(Math.round((x + 6600) * 5), 6 * k); bin.writeUInt16LE(Math.round((z + 6600) * 5), 6 * k + 2); bin[6 * k + 4] = Math.min(255, Math.round(f[2] * 5)); bin[6 * k + 5] = Math.min(15, Math.round(f[3] / 0.8)) << 4 | t; }
  fs.writeFileSync(file, '/* Trees outside the woods from the LGIA lidar point clouds (Digitālā augstuma modeļa pamatdati, CC0), built by tools/lidar.js --trees */\nwindow.LIDAR_TREES = ' + JSON.stringify({ n: m, d: bin.toString('base64') }) + ';\n');
  console.log(`trees: ${n} found, ${dup} twice at tile borders, ${wood} in the woods, ${outside} outside the city, ${none} no trees; written ${m}: pine ${kinds[0]}, broadleaf ${kinds[1]}, birch ${kinds[2]}, spruce ${kinds[3]}`);
}

(async () => {
  if (fromFile) { const b = fs.readFileSync(fromFile), f = new Float32Array(b.buffer, b.byteOffset, b.length / 4); for (let i = 0; i < f.length; i++) TREES.push(f[i]); writeTrees(treesFile); return; }
  // several tiles at once (LIDAR_JOBS, 4 by default): one download runs at a few MB/s and the reading takes little
  const t0 = Date.now(), JOBS = Math.max(1, +process.env.LIDAR_JOBS || 4); console.log(`${NB} buildings, ${tiles.length} tiles, ${JOBS} at a time`);
  let next = 0, done = 0;
  const worker = async () => { while (next < tiles.length) { const t = tiles[next++];
    try { const s = await readTile(t); done++; console.log(`${done}/${tiles.length} ${t}: ${s.total} points, ${s.nb} building, ${s.ng} ground${treesFile ? ', ' + s.nt + ' trees' : ''}, ${s.mb.toFixed(0)} MB${s.tries ? `, resumed ${s.tries}×` : ''}${s.fail ? ' (' + s.fail + ')' : ''} — ${((Date.now() - t0) / 1000).toFixed(0)} s`); }
    catch (e) { done++; console.log(`${done}/${tiles.length} ${t}: skipped (${e.message})`); } } };
  await Promise.all(Array.from({ length: JOBS }, worker));
  const out = Buffer.alloc(NB * 5); const cnt = [0, 0, 0, 0, 0, 0];
  for (let id = 0; id < NB; id++) { const a = analyse(id); if (!a) { cnt[0]++; continue; } cnt[a.type]++;
    out.writeUInt16LE(Math.min(65535, Math.round(a.eave * 10)), id * 5); out.writeUInt16LE(Math.min(65535, Math.round(a.top * 10)), id * 5 + 2); out[id * 5 + 4] = a.type; }
  const head = '/* Heights and roof shapes of the buildings of citydata.js from the LGIA lidar point clouds (Digitālā augstuma modeļa pamatdati, CC0), built by tools/lidar.js */\n';
  fs.writeFileSync(outFile, head + 'window.LIDAR = ' + JSON.stringify({ n: NB, key, d: out.toString('base64') }) + ';\n');
  if (rawFile) fs.writeFileSync(rawFile, Buffer.from(Float32Array.from(TREES).buffer));
  if (treesFile) writeTrees(treesFile);
  console.log(`no data ${cnt[0]}, flat ${cnt[1]}, gable along ${cnt[2]}, gable across ${cnt[3]}, hip ${cnt[4]}, complex ${cnt[5]} — ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})();
