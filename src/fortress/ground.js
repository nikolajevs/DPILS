import * as THREE from 'three';
import { FTS } from './textures.js';
import { FS, fortPoint } from './ground-height.js';
import { FH, FORT, FT, fortGates, fortIn } from './index.js';
import { LM_SAFE } from '../landmarks/index.js';
import { lmL } from '../landmarks/core.js';
import { COL, WMASK, inWater, waterMask } from '../world/data.js';
import { waterMat } from '../world/water.js';
import { std } from '../render/materials.js';
import { detailTex } from '../render/textures.js';
import { TERR } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { polyA } from '../core/geometry.js';
import { hash, hb } from '../core/util.js';

/* ---- the ground: a 2 m height field over the fortress, walls in fieldstone, ditches, a depth mask around ---- */
function fortTerrainMaterial(tex) {
  return std({ vertexColors: true, roughness: 0.96, metalness: 0 }, 'fort-ground', s => {
    LM_SAFE(s); s.uniforms.uDetail = { value: tex };
    s.vertexShader = 'varying vec2 vWxz;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz;');
    s.fragmentShader = 'uniform sampler2D uDetail; varying vec2 vWxz;\n' + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float dt = texture2D(uDetail, vWxz * 0.1429).r * 2.0, dt2 = texture2D(uDetail, vWxz * 0.0196 + 0.37).r * 2.0;
      diffuseColor.rgb *= mix(1.0, dt, 0.5) * mix(1.0, dt2, 0.3);`);
  });
}
function fortField(K) {
  const c = 2, R = FORT.R + 40, X0 = FORT.cx - R, Z0 = FORT.cz - R, N = Math.ceil(2 * R / c) + 1, NN = N * N;
  const H = new Float32Array(NN), B = new Uint8Array(NN), WET = new Uint8Array(NN);
  if (!WMASK) waterMask();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = X0 + i * c, z = Z0 + j * c, k = j * N + i;
    const wm = WMASK.m[Math.floor((z - WMASK.Z0) / WMASK.S) * WMASK.NX + Math.floor((x - WMASK.X0) / WMASK.S)];
    if (wm === 1 || (wm === 2 && inWater(x, z))) { WET[k] = 1; continue; }
    const p = fortPoint(x, z); H[k] = p.h; B[k] = p.b;
  }
  // under a gate block a vertex takes the highest height of its neighbours outside, so that the cells on the edge
  // of the block run on into it (where its walls hide them) instead of leaving notches along a diagonal edge
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i; if (!(B[k] & 8)) continue; let m = -1e9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const q = k + dj * N + di; if (!(B[q] & 24) && !WET[q] && H[q] > m) m = H[q]; }
    if (m > -1e9) { H[k] = m; B[k] |= 64; }
  }
  // terrain cells: anything that is not flat town or field; flat cells only write depth
  const vid = new Int32Array(NN).fill(-1), pos = [], nrm = [], col = [], idx = [], occ = [];
  const flat = k => Math.abs(H[k]) < 0.03 && !(B[k] & 3) && !(B[k] & 8);
  const GRASS = [94, 124, 60], LUSH = [74, 104, 46], DRY = [132, 134, 82], MARSH = [72, 86, 44], BERM = [104, 112, 72];
  const vert = k => {
    if (vid[k] >= 0) return vid[k];
    const i = k % N, j = (k / N) | 0, x = X0 + i * c, z = Z0 + j * c, h = H[k];
    const hx = (H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)]) / (2 * c), hz = (H[Math.min(N - 1, j + 1) * N + i] - H[Math.max(0, j - 1) * N + i]) / (2 * c);
    const l = Math.hypot(hx, 1, hz); pos.push(x, h, z); nrm.push(-hx / l, 1 / l, -hz / l);
    const slope = Math.hypot(hx, hz), n = hash(i * 7919 + j * 104729) * 0.16 - 0.08 + (valueNoiseAt(x, z) - 0.5) * 0.12;
    let cc = h < -2.5 ? ((B[k] & 4) ? MARSH : LUSH) : GRASS; if (slope > 0.6) cc = cc.map((v, q) => v + (DRY[q] - v) * Math.min(1, (slope - 0.6) * 0.6)); if (B[k] & 16) cc = BERM;
    col.push(cc[0] / 255 * (1 + n), cc[1] / 255 * (1 + n), cc[2] / 255 * (1 + n));
    return (vid[k] = pos.length / 3 - 1);
  };
  for (let j = 0; j < N - 1; j++) {
    let run = -1;
    for (let i = 0; i < N; i++) {
      let mode = 0;   // 0 nothing, 1 terrain, 2 depth only
      if (i < N - 1) {
        const k = j * N + i, ks = [k, k + 1, k + N, k + N + 1];
        if (ks.some(q => WET[q])) mode = 0;
        else if (ks.every(q => B[q] & 8) || ks.some(q => (B[q] & 8) && !(B[q] & 64)) || (ks.some(q => B[q] & 64) && ks.some(q => (B[q] & 16) && !(B[q] & 8)))) mode = 0;
        else if (ks.every(flat)) mode = 2; else mode = 1;
        if (mode === 1) { const [a, b2, d, e] = ks.map(vert); idx.push(a, d, b2, b2, d, e); }
      }
      if (run >= 0 && (mode !== 2 || i - run >= 20)) { occ.push(X0 + run * c, Z0 + j * c, X0 + i * c, Z0 + (j + 1) * c); run = -1; }   // strips of at most 40 m: they bend only at their corners
      if (mode === 2 && run < 0) run = i;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, fortTerrainMaterial(detailTex(0))); m.castShadow = m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
  // depth mask: flat town and field around the earthworks write depth just below the ground, so nothing dug into
  // the moats shows through the ground in front of them
  // (with the relief on, the depth grid of the whole city does this outside the fortress: its long strips would cut
  // through the slopes there)
  const S = 8, R2 = TERR.on ? R : R + 420, OX = FORT.cx - R2, OZ = FORT.cz - R2, M = Math.ceil(2 * R2 / S);
  for (let j = 0; j < M; j++) { let run = -1; const z = OZ + (j + 0.5) * S;
    for (let i = 0; i <= M; i++) { const x = OX + (i + 0.5) * S;
      const inner = x > X0 && x < X0 + (N - 1) * c && z > Z0 && z < Z0 + (N - 1) * c, wm = i < M ? WMASK.m[Math.floor((z - WMASK.Z0) / WMASK.S) * WMASK.NX + Math.floor((x - WMASK.X0) / WMASK.S)] : 1;
      const ok = i < M && !inner && wm === 0;
      if (ok && run < 0) run = i; if (!ok && run >= 0) { occ.push(OX + run * S, OZ + j * S, OX + i * S, OZ + (j + 1) * S); run = -1; } } }
  const op = [], oi = []; for (let q = 0; q < occ.length; q += 4) { const v = op.length / 3; op.push(occ[q], -0.05, occ[q + 1], occ[q + 2], -0.05, occ[q + 1], occ[q + 2], -0.05, occ[q + 3], occ[q], -0.05, occ[q + 3]); oi.push(v, v + 2, v + 1, v, v + 3, v + 2); }
  const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.Float32BufferAttribute(op, 3)); og.setIndex(oi);
  const om = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })); om.renderOrder = -30; om.frustumCulled = false; scene.add(om);
  FORT.grid = { H, B, WET, N, X0, Z0, c };
}
function valueNoiseAt(x, z) { const i = Math.floor(x / 9), j = Math.floor(z / 9), fx = x / 9 - i, fz = z / 9 - j, h = (a, b) => hash(a * 73856093 ^ b * 19349663);
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz); return (h(i, j) * (1 - sx) + h(i + 1, j) * sx) * (1 - sz) + (h(i, j + 1) * (1 - sx) + h(i + 1, j + 1) * sx) * sz; }
// fieldstone retaining walls with a coping that covers the berm behind them; they also stop the walker
function fortWalls(K) {
  // walls stop at the gate façades: near a gate the pieces are 1 m long and dropped inside the façade's width
  const W = K.rub, G = K.cap, gates = fortGates(), near = (x, z) => { for (const g of gates) { const [u, v] = lmL(g.f, x, z); if (u > -g.a - 40 && u < (g.kind === 'nik' ? -g.a + 3 : g.a2 + 2) && Math.abs(v) < Math.max(g.W, g.b + 0.6) - 0.3) return true; } return false; },
    byGate = (x, z) => gates.some(g => Math.hypot(x - g.f[0], z - g.f[1]) < 70);
  let s0 = 0;
  for (const [x1, z1, x2, z2, kind] of FS.segs) {
    if (kind !== 0) continue;
    const L = Math.hypot(x2 - x1, z2 - z1), tx = (x2 - x1) / L, tz = (z2 - z1) / L, lx = tz, lz = -tx;   // (lx, lz) points to the high side
    const pieces = Math.max(1, Math.ceil(L / (byGate(x1, z1) || byGate(x2, z2) ? 1 : 4)));
    for (let k = 0; k < pieces; k++) {
      const a = k * L / pieces, b = (k + 1) * L / pieces, mx = x1 + tx * (a + b) / 2, mz = z1 + tz * (a + b) / 2;
      const lo = fortPoint(mx - lx * 1.3, mz - lz * 1.3), hi = fortPoint(mx + lx * 1.3, mz + lz * 1.3), tr = (hi.b & 16) !== 0;
      if (near(mx, mz) || (!tr && (!(hi.b & 1) || (lo.b & 1) || (lo.b & 32) || (hi.b & 32)))) continue;
      const y0 = Math.min(lo.h, lo.w, hi.h) - 0.4, y1 = FH.cap + 0.25; if (!tr && y1 - y0 < 1.2) continue;
      const P = [x1 + tx * a, z1 + tz * a], Q = [x1 + tx * b, z1 + tz * b], S = FTS[0];
      // wall face towards the low side: n = (-lx, -lz)
      W.q([P[0], y0, P[1]], [Q[0], y0, Q[1]], [Q[0], y1, Q[1]], [P[0], y1, P[1]], [-lx, 0, -lz], [(s0 + a) / S, y0 / S, (s0 + b) / S, y0 / S, (s0 + b) / S, y1 / S, (s0 + a) / S, y1 / S], [196, 192, 186]);
      // coping slab and the berm under it
      const dIn = FH.berm + 0.15, c0 = [P[0] + lx * dIn, P[1] + lz * dIn], c1 = [Q[0] + lx * dIn, Q[1] + lz * dIn];
      polyA(G, [[P[0] - lx * 0.12, y1, P[1] - lz * 0.12], [Q[0] - lx * 0.12, y1, Q[1] - lz * 0.12], [c1[0], y1, c1[1]], [c0[0], y1, c0[1]]], hb('#7d8a5a'), 0, 1, 0);
      polyA(G, [[P[0] - lx * 0.12, y1 - 0.3, P[1] - lz * 0.12], [Q[0] - lx * 0.12, y1 - 0.3, Q[1] - lz * 0.12], [Q[0] - lx * 0.12, y1, Q[1] - lz * 0.12], [P[0] - lx * 0.12, y1, P[1] - lz * 0.12]], hb('#9a958c'), -lx, 0, -lz);
      if (y1 - lo.w > 1.4) COL.add(P[0] - lx * 0.1, P[1] - lz * 0.1, Q[0] - lx * 0.1, Q[1] - lz * 0.1, 0.25, 0);
    }
    s0 += L;
  }
}
// water in the ditches at the bottom of the moats
function fortDitches() {
  const pos = [], uv = [], idx = [];
  for (const p of FT.ditches) { const n = p.length >> 1;
    for (let i = 0; i < n - 1; i++) {
      const x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * i + 2], z2 = p[2 * i + 3], L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.5 || !fortIn(x1, z1)) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L, steps = Math.ceil(L / 3);
      for (let s = 0; s < steps; s++) {
        const a = s * L / steps, b = (s + 1) * L / steps, A = [x1 + tx * a, z1 + tz * a], Bq = [x1 + tx * b, z1 + tz * b], ha = fortPoint(A[0], A[1]).h, hb2 = fortPoint(Bq[0], Bq[1]).h;
        if (ha > -2.5 || hb2 > -2.5) continue;
        const v = pos.length / 3, w = 0.8;
        for (const [Pp, hh] of [[A, ha], [Bq, hb2]]) { pos.push(Pp[0] - tz * w, hh + 0.05, Pp[1] + tx * w, Pp[0] + tz * w, hh + 0.05, Pp[1] - tx * w); uv.push((Pp[0] - tz * w) / 24, (Pp[1] + tx * w) / 24, (Pp[0] + tz * w) / 24, (Pp[1] - tx * w) / 24); }
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    } }
  if (!idx.length) return;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => k % 3 === 1 ? 1 : 0), 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, waterMat(6)); m.frustumCulled = false; scene.add(m);   // the water of the city, 6 m from the bank (not in the water mask)
}

export { fortDitches, fortField, fortWalls };
