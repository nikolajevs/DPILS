#!/usr/bin/env node
/* Builds terrain.js — the height of the ground over the city — from the public elevation tiles of the AWS Terrain
   Tiles dataset (Terrarium PNG; over Latvia the source is EU-DEM, 25 m), in the frame of citydata.js.

   Usage: node tools/terrain.js citydata.js terrain.js [tile-cache-dir]
   Tiles are downloaded from https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png (or read from
   the cache directory when they are there). Heights are stored every 25 m, in decimetres above the lowest point,
   as little-endian Int16 in base64, smoothed over about 35 m. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), https = require('https');
const [, , cityFile, outFile, cacheDir = 'terrain-tiles'] = process.argv;
if (!cityFile || !outFile) { console.error('usage: node tools/terrain.js citydata.js terrain.js [tile-cache-dir]'); process.exit(1); }
global.window = {}; eval(fs.readFileSync(cityFile, 'utf8')); const C = window.CITY;
const { lat0, lon0, kx, ky, hx, hy } = C, Z = 13, STEP = 25;

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

(async () => {
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
  const nx = Math.ceil(2 * hx / STEP) + 1, nz = Math.ceil(2 * hy / STEP) + 1, H = new Float64Array(nx * nz);
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
  let lo = 1e9, hi = -1e9; for (const v of H) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const base = Math.floor(lo), q = new Int16Array(nx * nz); for (let k = 0; k < q.length; k++) q[k] = Math.round((H[k] - base) * 10);
  const b64 = Buffer.from(q.buffer).toString('base64');
  fs.writeFileSync(outFile, `/* Ground heights over Daugavpils, ${STEP} m grid, decimetres above ${base} m, from AWS Terrain Tiles (EU-DEM; built by tools/terrain.js) */\nwindow.TERRAIN = ${JSON.stringify({ x0: -hx, z0: -hy, step: STEP, nx, nz, base })};\nwindow.TERRAIN.h = '${b64}';\n`);
  console.log(`${nx} × ${nz} heights, ${base}–${hi.toFixed(1)} m, ${(b64.length / 1024).toFixed(0)} KB`);
})().catch(e => { console.error(e); process.exit(1); });
