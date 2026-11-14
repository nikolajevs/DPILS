#!/usr/bin/env node
/* Builds terrain.js — the height of the ground over the city — in the frame of citydata.js.

   Usage: node tools/terrain.js citydata.js terrain.js --lgia DTM_Latvija_20m.txt
          node tools/terrain.js citydata.js terrain.js --tiles tile-cache-dir

   --lgia (the source used): the digital terrain model of the Latvian Geospatial Information Agency, bare ground from
   airborne laser scanning 2013–2019, 20 m grid in LKS-92 TM, heights in LAS-2000,5 (open data:
   https://data.gov.lv/dati/lv/dataset/digitlais-reljefa-modelis-ar-tkla-soli-20m, the file
   https://s3.storage.pub.lvdc.gov.lv/lgia-opendata/citi/dtm/DTM_Latvija_20m.7z unpacked; lines "E N Z").
   --tiles: the public AWS Terrain Tiles (Terrarium PNG; EU-DEM over Latvia, 25 m, a surface model with some of the
   forest and roofs in it), downloaded into the cache directory; smoothed over about 35 m.

   Heights are stored on a 20 m grid in decimetres above the lowest point, little-endian Int16 in base64. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), https = require('https'), readline = require('readline');
const [, , cityFile, outFile, mode, src] = process.argv;
if (!cityFile || !outFile || !['--lgia', '--tiles'].includes(mode) || !src) { console.error('usage: node tools/terrain.js citydata.js terrain.js --lgia DTM.txt | --tiles cache-dir'); process.exit(1); }
global.window = {}; eval(fs.readFileSync(cityFile, 'utf8')); const C = window.CITY;
const { lat0, lon0, kx, ky, hx, hy } = C, Z = 13, STEP = 20;
// LKS-92 / Latvia TM (EPSG:3059): GRS80, central meridian 24°, k0 0.9996, false easting 500000, northing -6000000
function lks92(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, n = f / (2 - f), k0 = 0.9996, A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
  const al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
  const p = lat * Math.PI / 180, l = (lon - 24) * Math.PI / 180, c = 2 * Math.sqrt(n) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(p)) - c * Math.atanh(c * Math.sin(p))), xi = Math.atan2(t, Math.cos(l)), eta = Math.atanh(Math.sin(l) / Math.sqrt(1 + t * t));
  let E = eta, N = xi; for (let j = 1; j <= 3; j++) { E += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); N += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
  return [500000 + k0 * A * E, -6000000 + k0 * A * N];
}
const nx = Math.ceil(2 * hx / STEP) + 1, nz = Math.ceil(2 * hy / STEP) + 1, H = new Float64Array(nx * nz);
const nodeLL = (i, j) => { const x = -hx + i * STEP, z = -hy + j * STEP; return [lat0 - z / ky, lon0 + x / kx]; };
// the LGIA grid: read only the lines inside the city's box in LKS-92, then sample it bilinearly at the nodes. The
// listed coordinates are one cell off: fitted against OpenStreetMap (the fortress ditches, the streams, the water along
// the river banks, the cutting of Latgales iela), the ground lines up when every node reads the grid 20 m east and
// 20 m south of its own position (the three fits give 18–20 m east, 20–22 m south)
const LGIA_SHIFT = [20, -20];
async function fromLgia(file) {
  let e0 = 1e12, e1 = -1e12, n0 = 1e12, n1 = -1e12;
  for (const [la, lo] of [nodeLL(0, 0), nodeLL(nx - 1, 0), nodeLL(0, nz - 1), nodeLL(nx - 1, nz - 1)]) { const [e, n] = lks92(la, lo); e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
  e0 += LGIA_SHIFT[0] - 100; n0 += LGIA_SHIFT[1] - 100; e1 += LGIA_SHIFT[0] + 100; n1 += LGIA_SHIFT[1] + 100;
  const G = new Map(); let ge = 1e12, gn = 1e12;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) { const s = line.trim().split(/\s+/), e = +s[0]; if (!(e >= e0 && e <= e1)) continue; const n = +s[1]; if (!(n >= n0 && n <= n1)) continue; G.set(Math.round(e) + ',' + Math.round(n), +s[2]); ge = Math.min(ge, e); gn = Math.min(gn, n); }
  if (!G.size) throw new Error('no LGIA points inside the city');
  const R = 20, oe = ge % R, on = gn % R, z = (e, n) => G.get(Math.round(e) + ',' + Math.round(n));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const [e0, n0] = lks92(...nodeLL(i, j)), e = e0 + LGIA_SHIFT[0], n = n0 + LGIA_SHIFT[1], fe = (e - oe) / R, fn = (n - on) / R, ie = Math.floor(fe), jn = Math.floor(fn), u = fe - ie, v = fn - jn;
    const a = z(ie * R + oe, jn * R + on), b = z((ie + 1) * R + oe, jn * R + on), c = z(ie * R + oe, (jn + 1) * R + on), d = z((ie + 1) * R + oe, (jn + 1) * R + on);
    H[j * nx + i] = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  return 'the LGIA digital terrain model (airborne laser scanning 2013–2019, 20 m; read 20 m east and south of the listed coordinates)';
}

// minimal PNG reader: 8-bit RGB or RGBA, non-interlaced
function readPng(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('unsupported PNG'); }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * bpp), stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = out.subarray(y * stride, (y + 1) * stride), prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}
const get = url => new Promise((res, rej) => https.get(url, r => { if (r.statusCode !== 200) { rej(new Error(r.statusCode + ' ' + url)); r.resume(); return; } const b = []; r.on('data', d => b.push(d)); r.on('end', () => res(Buffer.concat(b))); }).on('error', rej));
const tileX = lon => (lon + 180) / 360 * 2 ** Z, tileY = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z; };

async function fromTiles(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const lonW = lon0 - hx / kx, lonE = lon0 + hx / kx, latN = lat0 + hy / ky, latS = lat0 - hy / ky;
  const tx0 = Math.floor(tileX(lonW)), tx1 = Math.floor(tileX(lonE)), ty0 = Math.floor(tileY(latN)), ty1 = Math.floor(tileY(latS));
  const tiles = new Map();
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const f = path.join(cacheDir, `${Z}_${tx}_${ty}.png`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`));
    tiles.set(tx + ',' + ty, readPng(fs.readFileSync(f)));
  }
  // height at a fractional global pixel position, bilinear
  const at = (gx, gy) => { const x = Math.floor(gx), y = Math.floor(gy); let s = 0;
    for (const [dx, dy, wt] of [[0, 0, (1 - (gx - x)) * (1 - (gy - y))], [1, 0, (gx - x) * (1 - (gy - y))], [0, 1, (1 - (gx - x)) * (gy - y)], [1, 1, (gx - x) * (gy - y)]]) {
      const X = x + dx, Y = y + dy, t = tiles.get(Math.floor(X / 256) + ',' + Math.floor(Y / 256)), i = ((Y & 255) * 256 + (X & 255)) * t.bpp;
      s += wt * (t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768); }
    return s; };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = -hx + i * STEP, z = -hy + j * STEP, lon = lon0 + x / kx, lat = lat0 - z / ky;
    H[j * nx + i] = at(tileX(lon) * 256 - 0.5, tileY(lat) * 256 - 0.5);
  }
  // EU-DEM carries some of the forest and the roofs: two passes of a 5 × 5 binomial blur (σ ≈ 35 m) leave the lie of
  // the land and take out the bumps
  const K5 = [1, 4, 6, 4, 1];
  for (let pass = 0; pass < 2; pass++) for (const dir of [[1, 0], [0, 1]]) {
    const T = Float64Array.from(H);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let s = 0, w = 0;
      for (let k = -2; k <= 2; k++) { const ii = i + dir[0] * k, jj = j + dir[1] * k; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; s += T[jj * nx + ii] * K5[k + 2]; w += K5[k + 2]; }
      H[j * nx + i] = s / w; }
  }
  return 'AWS Terrain Tiles (EU-DEM), smoothed';
}
(async () => {
  const what = mode === '--lgia' ? await fromLgia(src) : await fromTiles(src);
  if (H.some(v => !Number.isFinite(v))) throw new Error('holes in the grid');
  let lo = 1e9, hi = -1e9; for (const v of H) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const base = Math.floor(lo), q = new Int16Array(nx * nz); for (let k = 0; k < q.length; k++) q[k] = Math.round((H[k] - base) * 10);
  const b64 = Buffer.from(q.buffer).toString('base64');
  fs.writeFileSync(outFile, `/* Ground heights over Daugavpils, ${STEP} m grid, decimetres above ${base} m, from ${what} (built by tools/terrain.js) */\nwindow.TERRAIN = ${JSON.stringify({ x0: -hx, z0: -hy, step: STEP, nx, nz, base })};\nwindow.TERRAIN.h = '${b64}';\n`);
  console.log(`${nx} × ${nz} heights, ${base}–${hi.toFixed(1)} m, ${(b64.length / 1024).toFixed(0)} KB`);
})().catch(e => { console.error(e); process.exit(1); });
