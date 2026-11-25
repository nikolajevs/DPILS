import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { WATER, inWater, onRoad, COL } from './data.js';
import { TERR, terrainH, waterLevel, densify } from './terrain.js';
import { vbLocal } from './bridge-vienibas.js';
import { LMM } from '../landmarks/index.js';
import { lmBar, lmLathe, lmWF, lmBoxW } from '../landmarks/helpers.js';
import { bench, bandAlong, groundMesh } from '../landmarks/school-grounds.js';
import { addLight } from './lamp-light.js';
import { groundMaterial, std } from '../render/materials.js';
import { detailTex } from '../render/textures.js';
import { GB, polyA } from '../core/geometry.js';
import { hb, sh, hash } from '../core/util.js';
import { scene } from '../render/renderer.js';
import { rest } from '../core/pause.js';
import { HX } from '../core/env.js';

/* ---------- the shore of the Daugava ----------
   The river used to meet a flat lawn: the water faded in over the grass and the bank stood bare. This gives the
   waterline a body — a sand and gravel shoal along the low banks, reed beds in the shallows and boulders at the
   edge — and lays the fortress promenade (the 2021 river-bank walk on the protection dam, visitdaugavpils.lv):
   a paved way from the old harbour by the railway bridge around the bend to the water outlet, with a railing to
   the water, lamps, benches, the harbour slipway and the fortress model, the renewed well and bicycle stands.
   Built after the fortress and before the depth grids (src/main.js), so the paving is carried by groundDepth.
   Heights: the ground meshes (shoal, paving) lie relative and the shader lifts them by terrainH; the furniture is
   built absolute with STATE.GBC cancelling that lift — ABS at the waterline, groundGBC level on the bank. */

const IRON = hb('#2b2e30'), WOOD = hb('#8a5a35'), GRANITE = hb('#9d9488'), GRANITE_D = hb('#5c5852'), BRONZE = hb('#4d5a4a'), STEEL = hb('#b9bec2');
const SAND_DRY = hb('#c8b489'), SAND_WET = hb('#8d7c5c'), REED = [hb('#3f5a26'), hb('#557030'), hb('#8a8c4c'), hb('#ab9f66')], PLUME = hb('#4a3426'), ROCK = hb('#7d7a72');
const WLEAF = [hb('#7d9166'), hb('#8fa377'), hb('#6b8054'), hb('#9aab82')], WSTEM = hb('#6e5a44'), DRIFT = [hb('#8a7a66'), hb('#77675a'), hb('#9a8a74')];
const PINK_ROCK = [hb('#a8786a'), hb('#b08878'), hb('#9a7064')], BOAT = hb('#7a5236'), BOAT_IN = hb('#9a7250');
const ABS = (X, y, Z) => -terrainH(X, Z);
const groundGBC = (x, z) => { const b = terrainH(x, z); return (X, y, Z) => b - terrainH(X, Z); };

function riverRing() {
  let best = null, ba = 0;
  for (const a of WATER) { const b = a.bb; if (b[0] < -HX + 200 && b[2] > HX - 200) { const ar = (b[2] - b[0]) * (b[3] - b[1]); if (ar > ba) { ba = ar; best = a; } } }
  return best ? best.rings[0] : null;
}
const onProm = (x, z) => x > -2870 && x < -1980 && z > -140 && z < 1640;
const nearBridge = (x, z) => { const [s, d] = vbLocal(x, z); if (s > -8 && s < 340 && Math.abs(d) < 22) return true; return x > -2800 && x < -2520 && z > 250 && z < 520; };
// a gentle shore carries a beach; a steep dam face is left to its bank wall (reeds and rocks still edge it)
const gentleShore = (x, z, nx, nz) => { const wy = waterLevel(x, z); return terrainH(x, z) - wy > -0.6 && terrainH(x + nx * 3.5, z + nz * 3.5) - wy < 1.3; };

let PLAIN = null, GLOBE = null, REEDG = null;

function reedTuft(x, z, y, i) {
  const face = (P, col, nx, nz) => { polyA(REEDG, P, col, nx, 0, nz); polyA(REEDG, P, col, -nx, 0, -nz); };
  const H = 1.4 + hash(x * 3.3 + z * 9.1 + i) * 1.1, tone = 0.92 + hash(x * 5 + z * 11) * 0.14;
  let top = null;
  for (let b = 0; b < 3; b++) {
    const q = k => hash(x * (17 + k) + z * (29 + 3 * k) + b * 7.7 + i), h = H * (0.7 + q(1) * 0.35), a = q(2) * Math.PI, w = 0.07 + q(3) * 0.04;
    const ux = Math.cos(a) * w, uz = Math.sin(a) * w, bx = x + (q(4) - 0.5) * 0.3, bz = z + (q(5) - 0.5) * 0.3, lx = (q(6) - 0.5) * h * 0.4, lz = (q(7) - 0.5) * h * 0.4;
    const at = (t, s) => [bx + lx * t * t + ux * s, y + h * t - 0.35 * (1 - t), bz + lz * t * t + uz * s];
    const P0 = at(0, -1), P1 = at(0, 1), Q1 = at(0.55, 0.7), Q0 = at(0.55, -0.7), T = at(1, 0.05), T0 = at(1, -0.05);
    face([P0, P1, Q1, Q0], sh(REED[b & 1], tone), -uz, ux);
    face([Q0, Q1, T, T0], sh(REED[2 + (b >> 1)], tone), -uz, ux);
    if (!b) top = at(1, 0);
  }
  if (hash(x * 13 + z * 17 + i) < 0.33) lmBar(REEDG, [top[0], top[1] - 0.25, top[2]], [top[0], top[1] + 0.05, top[2]], 0.06, PLUME);
}
function boulder(x, z, y, r, i) {
  const seg = 7, rings = [];
  for (let j = 0; j <= 3; j++) { const ph = j / 3 * Math.PI, row = []; for (let k = 0; k < seg; k++) { const th = k / seg * Math.PI * 2, rr = r * (0.78 + hash(x + k * 3.1 + z + j * 7.7 + i) * 0.4); row.push([x + Math.sin(ph) * Math.cos(th) * rr, y + Math.cos(ph) * r * 0.7, z + Math.sin(ph) * Math.sin(th) * rr]); } rings.push(row); }
  for (let j = 0; j < 3; j++) for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg, A = rings[j][k], B = rings[j][k2], Cc = rings[j + 1][k2], D = rings[j + 1][k];
    const nx = (A[0] + Cc[0]) / 2 - x, nz = (A[2] + Cc[2]) / 2 - z, l = Math.hypot(nx, nz) || 1;
    polyA(PLAIN, [A, B, Cc, D], sh(ROCK, 0.85 + hash(x + k + j * 3 + i) * 0.3), nx / l, 0.5, nz / l); }
}

function shoal(ring) {
  const sand = new GB(false), n = ring.length >> 1, N = [];
  for (let i = 0; i < n; i++) {
    const x = ring[2 * i], z = ring[2 * i + 1], ni = (i + 1) % n, pi = (i + n - 1) % n;
    const dx = ring[2 * ni] - ring[2 * pi], dz = ring[2 * ni + 1] - ring[2 * pi + 1], L = Math.hypot(dx, dz);
    let nx, nz;
    if (L < 1e-6) { const p = N[N.length - 1] || [0, 0]; nx = p[0]; nz = p[1]; }
    else { nx = dz / L; nz = -dx / L; if (inWater(x + nx * 4, z + nz * 4)) { nx = -nx; nz = -nz; } }
    N.push([nx, nz]);
  }
  STATE.GBC = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x = ring[2 * i], z = ring[2 * i + 1], x2 = ring[2 * j], z2 = ring[2 * j + 1];
    if (Math.hypot(x2 - x, z2 - z) < 0.05) continue;
    const [nx, nz] = N[i], [nx2, nz2] = N[j];
    if (!gentleShore(x, z, nx, nz) || nearBridge(x, z) || onRoad(x, z, 1.5)) continue;
    const iw = 2.4, ow = 4.0;
    const ix = x - nx * iw, iz = z - nz * iw, ox = x + nx * ow, oz = z + nz * ow;
    const ix2 = x2 - nx2 * iw, iz2 = z2 - nz2 * iw, ox2 = x2 + nx2 * ow, oz2 = z2 + nz2 * ow;
    const wy = waterLevel(x, z), yIn = wy - 0.32, yOut = Math.min(terrainH(ox, oz) + 0.09, wy + 1.0);
    const yIn2 = waterLevel(x2, z2) - 0.32, yOut2 = Math.min(terrainH(ox2, oz2) + 0.09, waterLevel(x2, z2) + 1.0);
    const v0 = sand.v, t = hash(x * 1.7 + z * 2.3) * 0.12, cIn = sh(SAND_WET, 0.95 + t), cOut = sh(SAND_DRY, 0.95 + t);
    sand.vert(ix, yIn - terrainH(ix, iz), iz, 0, 1, 0, cIn);
    sand.vert(ix2, yIn2 - terrainH(ix2, iz2), iz2, 0, 1, 0, cIn);
    sand.vert(ox2, yOut2 - terrainH(ox2, oz2), oz2, 0, 1, 0, cOut);
    sand.vert(ox, yOut - terrainH(ox, oz), oz, 0, 1, 0, cOut);
    sand.triUp(v0, v0 + 1, v0 + 2); sand.triUp(v0, v0 + 2, v0 + 3);
  }
  groundMesh(sand, groundMaterial(detailTex(3), 1 / 2.2, 0.55, 'shore-sand'), -39);
  return N;
}

function wildShore(ring, N) {
  const n = ring.length >> 1; STATE.GBC = ABS;
  for (let i = 0; i < n; i += 2) {
    const x = ring[2 * i], z = ring[2 * i + 1];
    if (nearBridge(x, z) || onRoad(x, z, 1)) continue;
    const [nx, nz] = N[i], wy = waterLevel(x, z);
    if (hash(x * 2.7 + z * 4.1) < 0.6) { const d = 0.8 + hash(x * 5.3 + z) * 3.4; reedTuft(x - nx * d, z - nz * d, wy - 0.2, i); }
    if (i % 3 === 0 && hash(x * 3.9 + z * 6.7) < 0.5) { const d = hash(x + z * 2) * 2.2 - 0.5; boulder(x - nx * d, z - nz * d, wy + 0.05, 0.5 + hash(x * 9 + z) * 0.9, i); }
    // willow thickets on the floodplain, a little inland from the water (not on the promenades)
    const gentle = terrainH(x, z) - wy > -0.5 && terrainH(x + nx * 9, z + nz * 9) - wy < 1.6;
    if (gentle && !onProm(x, z) && i % 3 === 0 && hash(x * 1.9 + z * 3.7) < 0.72) {
      const d = 4 + hash(x * 4.4 + z * 1.1) * 9, wx = x + nx * d, wz = z + nz * d;
      if (!onRoad(wx, wz, 1.5)) { willow(wx, wz, terrainH(wx, wz), i); if (hash(x * 8.8 + z * 3.3) < 0.4) willow(wx + nx * 2.5 - nz * 2, wz + nz * 2.5 + nx * 2, terrainH(wx + nx * 2.5 - nz * 2, wz + nz * 2.5 + nx * 2), i + 7); }
    }
    // driftwood scattered on the natural banks
    if (!onProm(x, z) && i % 5 === 0 && hash(x * 6.1 + z * 2.9) < 0.4) { const d = 1 + hash(x * 2.2 + z) * 4; driftLog(x + nx * d, z + nz * d, terrainH(x + nx * d, z + nz * d) + 0.05, i); }
  }
  // a few fishing spots with a moored rowboat, on the natural banks away from the promenades and bridges
  const spots = [[-3530, -20], [-2900, 250], [-4560, -1600], [600, 2330], [2600, 2300], [-1900, 2050]];
  for (let s = 0; s < spots.length; s++) {
    const [sx, sz] = spots[s]; let bi = -1, bd = 1e9;
    for (let i = 0; i < n; i++) { const d = Math.hypot(ring[2 * i] - sx, ring[2 * i + 1] - sz); if (d < bd) { bd = d; bi = i; } }
    if (bi < 0 || bd > 60) continue;
    const [nx, nz] = N[bi]; if (!Number.isFinite(nx)) continue;
    fishSpot(ring[2 * bi], ring[2 * bi + 1], nx, nz, s);
  }
  STATE.GBC = null;
}

/* ---- the fortress promenade ---- */
function lampPost(x, z) {
  STATE.GBC = groundGBC(x, z);
  lmLathe(PLAIN, x, z, 0, [[0.16, 0], [0.16, 0.12], [0.1, 0.2], [0.1, 0.55], [0.07, 0.7], [0.055, 3.3], [0.085, 3.38], [0.085, 3.44]], 8, IRON);
  lmLathe(GLOBE, x, z, 3.44, [[0.085, 0], [0.19, 0.34], [0.17, 0.4]], 8, hb('#f3ead8'));
  lmLathe(PLAIN, x, z, 3.84, [[0.17, 0], [0.24, 0.05], [0.22, 0.1], [0.05, 0.3], [0.02, 0.42], [0.05, 0.48], [0.01, 0.55]], 8, IRON);
  addLight(x, 3.64, z, 1);
  STATE.GBC = null;
}
function railing(pts) {
  const n = pts.length >> 1; STATE.GBC = ABS;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[2 * i], az = pts[2 * i + 1], bx = pts[2 * i + 2], bz = pts[2 * i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    for (let s = 0; s < L; s += 2.2) { const x = ax + tx * s, z = az + tz * s, b = terrainH(x, z); lmBar(PLAIN, [x, b, z], [x, b + 1.05, z], 0.06, IRON); }
    const ba = terrainH(ax, az), bb = terrainH(bx, bz);
    for (const h of [0.55, 1.02]) lmBar(PLAIN, [ax, ba + h, az], [bx, bb + h, bz], 0.05, IRON);
    COL.add(ax, az, bx, bz, 0.06, 0);
  }
  STATE.GBC = null;
}
function steps(x, z, nx, nz) {
  const tx = -nz, tz = nx; STATE.GBC = ABS;
  for (let k = 0; k < 5; k++) { const d = k * 0.9, y = waterLevel(x, z) + 0.9 - k * 0.22, cx = x - nx * d, cz = z - nz * d, b = terrainH(cx, cz);
    lmBoxW(PLAIN, lmWF([cx - tx * 1.6, cz - tz * 1.6], [cx + tx * 1.6, cz + tz * 1.6]), 0, 3.2, Math.min(b, y) - 0.3, y, -0.45, 0.45, sh(GRANITE, 0.95 + k * 0.02)); }
  STATE.GBC = null;
}
function harbour(x, z, nx, nz) {
  const tx = -nz, tz = nx, F = lmWF([x - tx * 4, z - tz * 4], [x + tx * 4, z + tz * 4]); STATE.GBC = ABS;
  for (let k = 0; k < 7; k++) { const d = k * 1.4, y = waterLevel(x, z) + 0.8 - k * 0.18; lmBoxW(PLAIN, F, 0, 8, y - 0.35, y, -d - 1.4, -d, sh(GRANITE_D, 0.95 + k * 0.02)); }
  for (const s of [1, 7]) for (const dd of [-1, -9]) { const cx = x + tx * (s - 4) - nx * dd, cz = z + tz * (s - 4) - nz * dd, b = terrainH(cx, cz); lmLathe(PLAIN, cx, cz, b, [[0.18, 0], [0.16, 0.5], [0.22, 0.55], [0.2, 0.62]], 8, IRON); }
  const mx = x + tx * 4 + nx * 4, mz = z + tz * 4 + nz * 4, b = terrainH(mx, mz);
  lmBoxW(PLAIN, lmWF([mx - 1, mz - 1], [mx + 1, mz - 1]), -0.2, 2.2, b, b + 0.9, -1, 1, GRANITE);
  lmBoxW(PLAIN, lmWF([mx - 0.8, mz - 0.8], [mx + 0.8, mz - 0.8]), 0, 1.6, b + 0.9, b + 1.05, -0.8, 0.8, BRONZE);
  for (const [du, dv, w] of [[-0.5, -0.4, 0.5], [0.4, -0.3, 0.6], [-0.2, 0.4, 0.7], [0.5, 0.4, 0.4]]) lmBoxW(PLAIN, lmWF([mx + du - w / 2, mz + dv], [mx + du + w / 2, mz + dv]), 0, w, b + 1.05, b + 1.22, -0.25, 0.25, sh(BRONZE, 1.1));
  STATE.GBC = null;
}
function well(x, z) {
  STATE.GBC = groundGBC(x, z);
  lmLathe(PLAIN, x, z, 0, [[0.7, 0], [0.72, 0.7], [0.62, 0.75], [0.55, 0.75], [0.55, 0.6]], 14, GRANITE);
  for (const s of [-1, 1]) lmBar(PLAIN, [x + s * 0.6, 0.7, z], [x + s * 0.6, 2.0, z], 0.08, WOOD);
  lmBar(PLAIN, [x - 0.7, 2.0, z], [x + 0.7, 2.0, z], 0.1, WOOD);
  lmBoxW(PLAIN, lmWF([x - 0.8, z - 0.5], [x + 0.8, z - 0.5]), 0, 1.6, 2.0, 2.12, -0.55, 0.55, sh(WOOD, 0.8));
  lmBar(PLAIN, [x, 0.75, z], [x, 1.3, z], 0.06, IRON); lmBar(PLAIN, [x, 1.3, z], [x + 0.35, 1.15, z], 0.05, IRON);
  STATE.GBC = null;
}
function bikeStand(x, z, a) {
  const ux = Math.cos(a), uz = Math.sin(a); STATE.GBC = groundGBC(x, z);
  for (let k = 0; k < 4; k++) { const px = x + ux * (k - 1.5) * 0.8, pz = z + uz * (k - 1.5) * 0.8;
    for (let q = 0; q < 6; q++) { const t0 = q / 6 * Math.PI, t1 = (q + 1) / 6 * Math.PI; lmBar(PLAIN, [px - uz * Math.cos(t0) * 0.4, 0.05 + Math.sin(t0) * 0.75, pz + ux * Math.cos(t0) * 0.4], [px - uz * Math.cos(t1) * 0.4, 0.05 + Math.sin(t1) * 0.75, pz + ux * Math.cos(t1) * 0.4], 0.05, STEEL); } }
  STATE.GBC = null;
}

function promenade(ring, N) {
  const n = ring.length >> 1, idx = [];
  for (let i = 0; i < n; i++) if (onProm(ring[2 * i], ring[2 * i + 1]) && !nearBridge(ring[2 * i], ring[2 * i + 1]) && Number.isFinite(N[i][0]) && (N[i][0] || N[i][1])) idx.push(i);
  if (idx.length < 4) return;
  const pave = [], rail = [];
  for (const i of idx) { const x = ring[2 * i], z = ring[2 * i + 1], [nx, nz] = N[i]; pave.push(x + nx * 6.5, z + nz * 6.5); rail.push(x + nx * 3.6, z + nz * 3.6); }
  STATE.GBC = null;
  const surf = new GB(false);
  bandAlong(surf, pave, false, 2.1, hb('#b3a795'), null);
  groundMesh(surf, groundMaterial(detailTex(2), 1 / 3.5, 0.5, 'shore-pave'), -33);
  railing(rail);
  let acc = 12, bacc = 30;
  for (let k = 0; k + 1 < idx.length; k++) {
    const i = idx[k], ax = pave[2 * k], az = pave[2 * k + 1], bx = pave[2 * k + 2], bz = pave[2 * k + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, [nx, nz] = N[i];
    for (; acc < L; acc += 30) { const x = ax + tx * acc + nx * 2.6, z = az + tz * acc + nz * 2.6; if (!onRoad(x, z, 1)) lampPost(x, z); }
    for (; bacc < L; bacc += 70) { const x = ax + tx * bacc + nx * 2.4, z = az + tz * bacc + nz * 2.4; STATE.GBC = groundGBC(x, z); bench(PLAIN, x, z, Math.atan2(-nz, -nx));
      lmLathe(PLAIN, x - tx * 1.4, z - tz * 1.4, 0, [[0.2, 0], [0.22, 0.7], [0.24, 0.74], [0.02, 0.74]], 10, hb('#3b3f3d')); STATE.GBC = null; }
    acc -= L; bacc -= L;
  }
  const i0 = idx[0], im = idx[idx.length >> 1], i1 = idx[idx.length - 1];
  harbour(ring[2 * i0] + N[i0][0] * 6, ring[2 * i0 + 1] + N[i0][1] * 6, N[i0][0], N[i0][1]);
  well(ring[2 * im] + N[im][0] * 14, ring[2 * im + 1] + N[im][1] * 14);
  for (const q of [0.3, 0.7]) { const i = idx[Math.floor(idx.length * q)]; steps(ring[2 * i] + N[i][0] * 8, ring[2 * i + 1] + N[i][1] * 8, N[i][0], N[i][1]); }
  bikeStand(ring[2 * i0] + N[i0][0] * 15, ring[2 * i0 + 1] + N[i0][1] * 15, 0.6);
  bikeStand(ring[2 * i1] + N[i1][0] * 15, ring[2 * i1 + 1] + N[i1][1] * 15, 2.2);
}

/* ---- the living bank: willows, driftwood, fishing spots (Mapillary, Nov 2026) ---- */
// a low foliage clump: three latitude rings of a lumpy ellipsoid, cheap (30 tris)
function blob(x, y, z, r, h, col, i) {
  const seg = 5, rows = [];
  for (const ph of [0.7, 1.5, 2.3]) { const row = []; for (let k = 0; k < seg; k++) { const th = k / seg * 2 * Math.PI + hash(i + k * 1.3) * 0.4, rr = r * (0.82 + hash(x + k * 3.1 + z + ph * 7 + i) * 0.36); row.push([x + Math.sin(ph) * Math.cos(th) * rr, y + Math.cos(ph) * h, z + Math.sin(ph) * Math.sin(th) * rr]); } rows.push(row); }
  const top = [x, y + h, z], bot = [x, y - h * 0.6, z];
  for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg, th = (k + 0.5) / seg * 2 * Math.PI, nx = Math.cos(th), nz = Math.sin(th);
    polyA(PLAIN, [top, rows[0][k], rows[0][k2]], sh(col, 1.06), nx * 0.4, 0.9, nz * 0.4);
    polyA(PLAIN, [rows[0][k], rows[1][k], rows[1][k2], rows[0][k2]], col, nx, 0.25, nz);
    polyA(PLAIN, [rows[1][k], rows[2][k], rows[2][k2], rows[1][k2]], sh(col, 0.92), nx, -0.1, nz);
    polyA(PLAIN, [rows[2][k], bot, rows[2][k2]], sh(col, 0.8), nx * 0.4, -0.9, nz * 0.4); }
}
// a willow bush: 2-3 leaning stems each crowned by a silver-green clump (the floodplain thickets of the photographs)
function willow(x, z, y, i) {
  const q = k => hash(x * (13.7 + k) + z * (23.3 + 3 * k) + i * 5.1);
  const stems = 2 + Math.floor(q(0) * 2);
  for (let s = 0; s < stems; s++) {
    const a = q(s + 1) * Math.PI * 2, lean = 0.2 + q(s + 4) * 0.45, h = 1.2 + q(s + 7) * 1.3;
    const tx = x + Math.cos(a) * lean * h, tz = z + Math.sin(a) * lean * h, ty = y + h;
    lmBar(PLAIN, [x, y - 0.1, z], [tx, ty, tz], 0.07, WSTEM);
    blob(tx, ty + 0.35, tz, 0.65 + q(s + 10) * 0.55, 0.8 + q(s + 13) * 0.5, WLEAF[Math.floor(q(s + 16) * WLEAF.length) % WLEAF.length], i + s * 3);
  }
}
// a weathered log lying on the bank, with a couple of broken branches
function driftLog(x, z, y, i) {
  const q = k => hash(x * (7.1 + k) + z * (11.7 + 2 * k) + i * 3.3);
  const a = q(0) * Math.PI * 2, L = 1.6 + q(1) * 2.6, r = 0.12 + q(2) * 0.14, dx = Math.cos(a), dz = Math.sin(a);
  const col = DRIFT[Math.floor(q(3) * DRIFT.length) % DRIFT.length], seg = 6;
  const ring = (t, rr) => { const row = []; for (let k = 0; k < seg; k++) { const th = k / seg * 2 * Math.PI; row.push([x + dx * L * t - dz * Math.cos(th) * rr, y + Math.sin(th) * rr + r * 0.4, z + dz * L * t + dx * Math.cos(th) * rr]); } return row; };
  const A = ring(0, r), B = ring(1, r * 0.8);
  for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg, th = (k + 0.5) / seg * 2 * Math.PI;
    polyA(PLAIN, [A[k], B[k], B[k2], A[k2]], sh(col, 0.85 + 0.3 * Math.sin(th)), -dz * Math.cos(th), Math.sin(th), dx * Math.cos(th)); }
  polyA(PLAIN, A, sh(col, 0.7), -dx, 0, -dz); polyA(PLAIN, B, sh(col, 0.75), dx, 0, dz);
  if (q(4) < 0.6) lmBar(PLAIN, [x + dx * L * 0.4, y + r, z + dz * L * 0.4], [x + dx * L * 0.4 - dz * 0.7, y + r + 0.35, z + dz * L * 0.4 + dx * 0.7], 0.05, sh(col, 0.9));
}
// a fishing platform on posts over the water, with a moored rowboat beside it
function fishSpot(x, z, nx, nz, i) {
  const tx = -nz, tz = nx, wy = waterLevel(x, z);
  const F = lmWF([x - tx * 1.3, z - tz * 1.3], [x + tx * 1.3, z + tz * 1.3]);
  lmBoxW(PLAIN, F, 0, 2.6, wy + 0.42, wy + 0.54, -3.4, 0.2, sh(WOOD, 0.95));   // the deck reaching out over the water
  for (const s of [0.3, 2.3]) for (const d of [-3.1, -0.1]) { const px = x + tx * (s - 1.3) - nx * d, pz = z + tz * (s - 1.3) - nz * d; lmBar(PLAIN, [px, wy - 0.8, pz], [px, wy + 0.5, pz], 0.1, sh(WOOD, 0.8)); }
  for (let k = 0; k < 5; k++) lmBar(PLAIN, [x + tx * (k * 0.55 - 1.1) - nx * 0.2, wy + 0.54, z + tz * (k * 0.55 - 1.1) - nz * 0.2], [x + tx * (k * 0.55 - 1.1) - nx * 3.3, wy + 0.54, z + tz * (k * 0.55 - 1.1) - nz * 3.3], 0.02, sh(WOOD, 1.1));   // plank seams
  // the rowboat: a hull of five U-stations, moored along the bank
  const bx = x + tx * 3.2 - nx * 1.6, bz = z + tz * 3.2 - nz * 1.6, by = wy + 0.06;
  const ux = tx, uz = tz, vx = -nx, vz = -nz, stations = [-1.5, -0.8, 0, 0.8, 1.5], half = [0.12, 0.42, 0.5, 0.42, 0.12];
  const st = stations.map((s, k) => { const hw = half[k]; return { b: [bx + ux * s, by, bz + uz * s], l: [bx + ux * s - vx * hw, by + 0.34, bz + uz * s - vz * hw], r: [bx + ux * s + vx * hw, by + 0.34, bz + uz * s + vz * hw] }; });
  for (let k = 0; k + 1 < st.length; k++) { const A = st[k], B = st[k + 1];
    polyA(PLAIN, [A.b, B.b, B.l, A.l], sh(BOAT, 0.95), -vx, 0.3, -vz);
    polyA(PLAIN, [A.b, A.r, B.r, B.b], sh(BOAT, 0.9), vx, 0.3, vz);
    polyA(PLAIN, [A.l, B.l, B.r, A.r], BOAT_IN, 0, 1, 0); }
  lmBar(PLAIN, [bx - vx * 0.4, by + 0.3, bz - vz * 0.4], [bx + vx * 0.4, by + 0.3, bz + vz * 0.4], 0.06, sh(WOOD, 1.05));   // a thwart
}

/* ---- the Esplanade reach: a paved way at the foot of the flood dam (Mapillary) ----
   The photographs show a light paved path along the foot of the grassy dam, big rounded granite boulders at the
   slope, and concrete steps with a railing climbing to the street on the crest. The floodplain meadow with willow
   thickets lies between the path and the water. The foot is found by walking inland from the waterline to where the
   ground starts to climb the dam. */
function damFoot(x, z, nx, nz) {
  const wy = waterLevel(x, z);
  for (let d = 8; d < 110; d += 2) { const h = terrainH(x + nx * d, z + nz * d) - wy; if (h > 2.1) return d - 3.5; }
  return -1;
}
function damSteps(x, z, nx, nz) {
  const tx = -nz, tz = nx, wy = waterLevel(x, z);
  const top = damFoot(x, z, nx, nz) + 3.5;   // where the slope begins
  let rise = 0, span = 10;
  for (let d = top; d < top + 60; d += 1) { const h = terrainH(x + nx * d, z + nz * d) - wy; if (h > rise) rise = h; span = d - top; if (h > 4.6) break; }
  if (rise < 1.5) return;
  const n = Math.max(5, Math.round(rise / 0.17)), tread = Math.max(0.3, span / n);
  for (let k = 0; k < n; k++) { const d = top + k * tread, cx = x + nx * d, cz = z + nz * d, b = terrainH(cx, cz);
    lmBoxW(PLAIN, lmWF([cx - tx * 1.2, cz - tz * 1.2], [cx + tx * 1.2, cz + tz * 1.2]), 0, 2.4, b - 0.2, b + 0.02, -tread * 0.5, tread * 0.5, sh(GRANITE, 0.98)); }
  for (const s of [-1.25, 1.25]) { const ax = x + tx * s + nx * top, az = z + tz * s + nz * top, bx2 = x + tx * s + nx * (top + span), bz2 = z + tz * s + nz * (top + span);
    lmBar(PLAIN, [ax, terrainH(ax, az) + 0.9, az], [bx2, terrainH(bx2, bz2) + 0.9, bz2], 0.05, IRON);
    for (let k = 0; k <= n; k += 3) { const px = x + tx * s + nx * (top + k * tread), pz = z + tz * s + nz * (top + k * tread); lmBar(PLAIN, [px, terrainH(px, pz), pz], [px, terrainH(px, pz) + 0.9, pz], 0.04, IRON); } }
}
function esplanade(ring, N) {
  const n = ring.length >> 1, pts = [], feet = [];
  for (let i = 0; i < n; i++) {
    const x = ring[2 * i], z = ring[2 * i + 1];
    if (!(x > -1560 && x < 4200 && z > 1850)) continue;   // the city bank east of Vienības tilts
    if (nearBridge(x, z) || onRoad(x, z, 1)) continue;
    const [nx, nz] = N[i]; if (!Number.isFinite(nx) || (!nx && !nz)) continue;
    const f = damFoot(x, z, nx, nz); if (f < 12 || f > 95) continue;
    pts.push(x + nx * f, z + nz * f); feet.push([x + nx * (f + 1.5), z + nz * (f + 1.5), i]);
  }
  if (pts.length < 6) return;
  STATE.GBC = null;
  const surf = new GB(false);
  bandAlong(surf, pts, false, 1.6, hb('#b8b2a6'), null);
  groundMesh(surf, groundMaterial(detailTex(2), 1 / 3.2, 0.45, 'shore-esplanade'), -33);
  // boulders at the foot of the slope, beside the path
  STATE.GBC = ABS;
  for (let k = 0; k < feet.length; k += 2) { const [fx, fz, i] = feet[k]; if (hash(fx * 1.3 + fz * 2.7) < 0.55) { const r = 0.5 + hash(fx + fz) * 0.7; boulder2(fx, fz, terrainH(fx, fz) + r * 0.25, r, i, PINK_ROCK[Math.floor(hash(fx * 3 + fz) * PINK_ROCK.length) % PINK_ROCK.length]); } }
  // steps up the dam about every 180 m (absolute heights, GBC stays ABS)
  let acc = 90;
  for (let k = 0; k + 1 < feet.length; k++) { const ax = pts[2 * k], az = pts[2 * k + 1], bx = pts[2 * k + 2], bz = pts[2 * k + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    for (; acc < L; acc += 180) { const i = feet[k][2], x = ring[2 * i], z = ring[2 * i + 1], [nx, nz] = N[i]; damSteps(x, z, nx, nz); }
    acc -= L; }
  STATE.GBC = null;
}
// a boulder in a given colour (the pink granite of the Esplanade slope)
function boulder2(x, z, y, r, i, col) {
  const seg = 7, rings = [];
  for (let j = 0; j <= 3; j++) { const ph = j / 3 * Math.PI, row = []; for (let k = 0; k < seg; k++) { const th = k / seg * Math.PI * 2, rr = r * (0.78 + hash(x + k * 3.1 + z + j * 7.7 + i) * 0.4); row.push([x + Math.sin(ph) * Math.cos(th) * rr, y + Math.cos(ph) * r * 0.7, z + Math.sin(ph) * Math.sin(th) * rr]); } rings.push(row); }
  for (let j = 0; j < 3; j++) for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg, A = rings[j][k], B = rings[j][k2], Cc = rings[j + 1][k2], D = rings[j + 1][k];
    const nx = (A[0] + Cc[0]) / 2 - x, nz = (A[2] + Cc[2]) / 2 - z, l = Math.hypot(nx, nz) || 1;
    polyA(PLAIN, [A, B, Cc, D], sh(col, 0.85 + hash(x + k + j * 3 + i) * 0.3), nx / l, 0.5, nz / l); }
}

async function buildShore() {
  const r0 = riverRing(); if (!r0 || !TERR.on) return;
  PLAIN = new GB(false); GLOBE = new GB(false); REEDG = new GB(false);
  const ring = densify(Array.from(r0).concat([r0[0], r0[1]]), 3);
  await rest();
  const N = shoal(ring);
  await rest();
  wildShore(ring, N);
  await rest();
  promenade(ring, N);
  await rest();
  esplanade(ring, N);
  await rest();
  const pm = PLAIN.mesh(LMM.plain); if (pm) { pm.castShadow = pm.receiveShadow = true; scene.add(pm); }
  const gm = GLOBE.mesh(LMM.globe); if (gm) { gm.receiveShadow = true; scene.add(gm); }
  const rm = REEDG.mesh(std({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }, 'shore-reed')); if (rm) { rm.receiveShadow = true; scene.add(rm); }
}

export { buildShore };
