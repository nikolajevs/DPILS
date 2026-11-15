import { fortLatheAx } from './monuments.js';
import { fortArchRing, fortP, fortTBox, fortTile, fortWallPlane } from './gates.js';
import { FTS, FTT } from './textures.js';
import { inBB } from './ground-height.js';
import { FORT } from './index.js';
import { FORT_MAG } from './magazines.js';
import { lmFlag } from '../landmarks/university.js';
import { lmBar, lmBoxL, lmLathe } from '../landmarks/helpers.js';
import { LMWS } from '../landmarks/tiles.js';
import { lmW } from '../landmarks/core.js';
import { COL } from '../world/data.js';
import { polyA } from '../core/geometry.js';
import { bbox, hash, hb, pip, sh } from '../core/util.js';

/* ---- buildings of the fortress: the arsenals ----
   Both arsenals share one order: a ground floor scored into rustication with groups of three tall windows between
   white pilasters, a white frieze of dentils above them, and over each group a lunette under a broad white
   archivolt with a keystone; between the groups, plain rusticated piers; a white cornice and a low hipped roof of
   standing-seam steel with small round dormers. Measured on photographs (Wikimedia Commons, categories "Artillery
   arsenal (Daugavpils fortress)" and "Engineering Arsenal (Daugavpils Fortress)") against the OSM outlines.
   Each building is given in a local frame (u, v) as rectangular wings, the sides that show with their number of
   bays, and extras (ramps, annexes, the entrance canopy). */
const FORT_BLD = [
  { // Artillery arsenal (1830s), since 2013 the Mark Rothko Art Centre: a U open to the north with ramps to the upper floor
    key: 'art', f: [-2595.3, -131.3, -0.8713, -0.4907], H: 9.0, col: [252, 198, 92],
    wings: [[0, 119, -21.3, 0], [0, 18.8, -42.4, 0], [100.3, 118.9, -42.5, 0]],
    sides: [[0, 0, 119, 0, 15], [18.8, -21.3, 100.3, -21.3, 11, 5], [0, -42.4, 0, 0, 6], [18.8, -42.4, 18.8, -21.3, 3], [0, -42.4, 18.8, -42.4, 2],
      [100.3, -42.5, 100.3, -21.3, 3], [118.9, -42.5, 118.9, 0, 6], [100.3, -42.5, 118.9, -42.5, 2]],
    annex: [[0.7, 17.0, -46.7, -42.4], [101.2, 117.7, -47.4, -42.4]],
    ramps: [[33.1, 17.0, -46.75, -41.1], [84.8, 101.2, -47.35, -41.0]],
    canopy: [56.9, 62.1, -27.2, -21.3], planters: [[46.4, 56.4, -27.5, -25.4], [62.3, 72.2, -27.3, -25.1]],
    flags: [[30, -34], [36, -34.5], [42, -35], [48, -35.5], [54, -36]]
  },
  { // Engineering arsenal (1830s, restored 2023, now a centre of technology and design): two wings in a V meeting in a
    // head block on Aleksandra iela; the street fronts in yellow render, the fronts to the courtyard in red brick.
    // Frame: origin at the north corner, u along the wing on Imperatora iela, v towards the courtyard (negative)
    key: 'eng', f: [-2514.2, -428.6, -0.6176, 0.7865], H: 9.5, col: [252, 214, 124],
    outline: [[18.9, -43.0], [18.5, -18.7], [129.2, -18.1], [129.1, 0], [0, 0], [0, -0.9], [-4.7, -0.9], [-4.7, -1.8], [0, -1.8], [0.3, -53.8], [81.1, -100.1], [90.1, -84.7]],
    brick: [[18.9, -43.0], [18.5, -18.7], [129.2, -18.1], [90.1, -84.7]],   // first corners of the courtyard sides
    entrance: [[129.1, 0], [0, 0], 13],   // side and bay of the main door, counted from its first corner
    wings: [[0, 129.2, -18.5, 0], [0, 18.7, -53.8, -18.5]],
    roofs: [[null, 0, 129.2, -18.5, 0, 1], [null, 0, 18.7, -53.8, -18.5, 0], [[-2472.1, -395.1, -0.1440, 0.9896], 0, 93.1, 0, 18, 1]]
  }
];
let FB_HULLS = null;   // world outlines of the wings and annexes, for dropping cadastre buildings, trees and terrain cuts
function fortBldHulls() {
  if (FB_HULLS) return FB_HULLS; FB_HULLS = [];
  for (const B of [...FORT_BLD, ...FORT_CLASSIC, ...FORT_MAG]) {
    if (B.outline) { const r = []; for (const [u, v] of B.outline) r.push(...lmW(B.f, u, v)); FB_HULLS.push({ r, bb: bbox(r) }); continue; }
    for (const [u0, u1, v0, v1] of [...B.wings, ...(B.annex || []), ...(B.ramps || []).map(r => [Math.min(r[0], r[1]), Math.max(r[0], r[1]), r[2], r[3]])]) {
      const r = []; for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) r.push(...lmW(B.f, u, v)); FB_HULLS.push({ r, bb: bbox(r) });
    }
  }
  return FB_HULLS;
}
const fortInBld = (x, z) => FORT.ok && fortBldHulls().some(h => inBB(h.bb, x, z) && pip(x, z, h.r));
function fortNearBld(x, z, m) {
  for (const h of fortBldHulls()) {
    if (x < h.bb[0] - m || x > h.bb[2] + m || z < h.bb[1] - m || z > h.bb[3] + m) continue; if (pip(x, z, h.r)) return true;
    const r = h.r, n = r.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n, x1 = r[2 * i], z1 = r[2 * i + 1], dx = r[2 * j] - x1, dz = r[2 * j + 1] - z1, l2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2));
      if (Math.hypot(x - x1 - t * dx, z - z1 - t * dz) < m) return true; }
  }
  return false;
}
// a frame for one side of a building: u out of the wall, v along it from 0 to L
function fortSideFrame(f, A, B, inside) {
  let P = lmW(f, A[0], A[1]), Q = lmW(f, B[0], B[1]); const C = lmW(f, inside[0], inside[1]);
  let L = Math.hypot(Q[0] - P[0], Q[1] - P[1]), tx = (Q[0] - P[0]) / L, tz = (Q[1] - P[1]) / L, nx = tz, nz = -tx;
  if (nx * (C[0] - P[0]) + nz * (C[1] - P[1]) > 0) { const T = P; P = Q; Q = T; tx = -tx; tz = -tz; nx = -nx; nz = -nz; }
  return { g: [P[0], P[1], nx, nz], L };
}
// one façade of the arsenal order with n bays (bay e is the entrance)
function fortArsenalSide(K, B, side, inside) {
  const [ua, va, ub, vb, n, ent0, opt = {}] = side, { g, L } = fortSideFrame(B.f, [ua, va], [ub, vb], inside), H = B.H, WH = [244, 241, 233], R = 2.15, YS = 5.3, GZ = 4.45;
  // the entrance bay is counted from the side's first corner; the frame may run the other way
  let ent = ent0; if (opt.fromA && ent0 >= 0) { const PA = lmW(B.f, ua, va); if (Math.hypot(g[0] - PA[0], g[1] - PA[1]) > 0.01) ent = n - 1 - ent0; }
  const brick = !!opt.brick, Y = brick ? [236, 214, 206] : B.col, WG = brick ? K.brk : K.rus, WU = brick ? K.brk : K.ren, SG = brick ? LMWS[3] : FTS[5], SU = brick ? LMWS[3] : LMWS[1];
  const bay = L / n, holesG = [], holesU = [], P = (u, v, y) => fortP(g, u, v, y);
  for (let k = 0; k < n; k++) {
    const c = (k + 0.5) * bay;
    if (k === ent) holesG.push({ vc: c, w: 1.3, ys: 3.6, ya: 3.6, sh: 'rect', yb: 0.15 });
    else for (const d of [-1.5, 0, 1.5]) holesG.push({ vc: c + d, w: 0.45, ys: 3.75, ya: 3.75, sh: 'rect', yb: 0.65 });
    holesU.push({ vc: c, w: R, ys: YS, ya: YS + R, sh: 'round', yb: YS });
  }
  fortWallPlane(WG, g, 0, 1, -0.02, L + 0.02, -0.3, GZ, holesG, SG, Y);
  fortWallPlane(WU, g, 0, 1, -0.02, L + 0.02, GZ, H, holesU, SU, Y);
  fortTBox(K.gra, g, 0, 0.12, -0.05, L + 0.05, -0.3, 0.3, FTS[1], [176, 172, 166], 'et');                       // granite socle
  for (let k = 0; k < n; k++) {
    const c = (k + 0.5) * bay;
    // ground floor: three windows (or the door) in reveals, pilasters between them, the dentil frieze over the group
    if (k === ent) { fortTBox(K.ren, g, -0.3, 0, c - 1.3, c + 1.3, 3.6, 3.6, LMWS[1], sh(Y, 0.8), 'b'); for (const s of [-1, 1]) fortTBox(K.ren, g, -0.3, 0, s * 1.3 + c, s * 1.3 + c, 0.15, 3.6, LMWS[1], sh(Y, 0.85), s < 0 ? 's' : 'n');
      if (opt.oak) {   // oak double door in a white surround under a plaque with the name, as restored in 2023
        fortTile(K.det, g, -0.3, 1, c - 1.3, c, 0.15, 3.6, FTT.door); fortTile(K.det, g, -0.3, 1, c, c + 1.3, 0.15, 3.6, FTT.door);
        for (const s of [-1, 1]) fortTBox(K.ren, g, 0, 0.16, c + s * 1.3 - 0.25, c + s * 1.3 + 0.25, 0.15, 3.9, LMWS[1], WH, 'enst');
        fortTBox(K.ren, g, 0, 0.2, c - 1.7, c + 1.7, 3.9, 4.15, LMWS[1], WH, 'enstb'); fortTile(K.det, g, 0.06, 1, c - 1.4, c + 1.4, 4.2, 4.42, FTT.engsign);
      } else fortTile(K.det, g, -0.3, 1, c - 1.3, c + 1.3, 0.15, 3.6, FTT.adoor); }
    else for (const d of [-1.5, 0, 1.5]) {
      const v = c + d; fortTile(K.det, g, -0.22, 1, v - 0.45, v + 0.45, 0.65, 3.75, FTT.awin);
      fortTBox(K.ren, g, -0.22, 0, v + 0.45, v + 0.45, 0.65, 3.75, LMWS[1], sh(Y, 0.85), 'n'); fortTBox(K.ren, g, -0.22, 0, v - 0.45, v - 0.45, 0.65, 3.75, LMWS[1], sh(Y, 0.85), 's');
      fortTBox(K.ren, g, -0.22, 0, v - 0.45, v + 0.45, 3.75, 3.75, LMWS[1], sh(Y, 0.8), 'b'); fortTBox(K.ren, g, 0, 0.1, v - 0.5, v + 0.5, 0.57, 0.65, LMWS[1], WH, 'etb');
    }
    if (k !== ent) for (const d of [-2.25, -0.75, 0.75, 2.25]) fortTBox(K.ren, g, 0, 0.14, c + d - 0.27, c + d + 0.27, 0.3, GZ, LMWS[1], WH, 'ensw');
    fortTBox(K.ren, g, 0, 0.18, c - 2.6, c + 2.6, GZ, GZ + 0.62, LMWS[1], WH, 'ensbw'); fortTile(K.det, g, 0.185, 1, c - 2.6, c + 2.6, GZ, GZ + 0.62, FTT.dent);
    // the lunette: glazing set back, the archivolt and the keystone
    fortTile(K.cut, g, -0.25, 1, c - R, c + R, YS, YS + R, FTT.lunette);
    fortArchRing(K.ren, g, 0, -0.25, 1, { vc: c, w: R, ys: YS, ya: YS + R, sh: 'round' }, { vc: c, w: R, ys: YS, ya: YS + R, sh: 'round' }, LMWS[1], sh(Y, 0.85), 14);
    fortTBox(K.ren, g, -0.25, 0, c - R, c + R, YS, YS, LMWS[1], sh(WH, 0.9), 't');
    fortArchRing(K.ren, g, 0.14, 0, 1, { vc: c, w: R, ys: YS, ya: YS + R, sh: 'round' }, { vc: c, w: R + 0.5, ys: YS, ya: YS + R + 0.5, sh: 'round' }, LMWS[1], WH, 16);
    fortTBox(K.ren, g, 0, 0.2, c - 0.32, c + 0.32, YS + R - 0.15, YS + R + 0.75, LMWS[1], WH, 'enswt');
  }
  // string course at the springing of the lunettes, frieze and cornice, a white strip at each corner
  fortTBox(K.ren, g, 0, 0.12, -0.05, L + 0.05, GZ + 0.62, GZ + 0.8, LMWS[1], WH, 'enswt');
  fortTBox(K.ren, g, 0, 0.1, -0.05, L + 0.05, H - 0.55, H - 0.4, LMWS[1], WH, 'ensbw');
  fortTBox(K.ren, g, 0, 0.45, -0.45, L + 0.45, H - 0.4, H, LMWS[1], WH, 'enswb');
  for (const v of [0.35, L - 0.35]) fortTBox(K.ren, g, 0, 0.06, v - 0.35, v + 0.35, -0.3, H - 0.55, LMWS[1], sh(Y, 1.03), 'ensw');
  // downpipes at every second pier
  for (let k = 1; k < n; k += 2) lmBar(K.cap, P(0.22, k * bay, 0.2), P(0.22, k * bay, H - 0.1), 0.12, hb('#8d9296'));
  COL.add(...lmW(g, 0.15, 0), ...lmW(g, 0.15, L), 0.2, 0);
}
// a hipped roof over a rectangle of the local frame, eaves at y, ridge along the longer side
function fortHipRoof(K, f, u0, u1, v0, v1, y, pitch, ov = 0.5) {
  u0 -= ov; u1 += ov; v0 -= ov; v1 += ov;
  const du = u1 - u0, dv = v1 - v0, along = du >= dv, half = (along ? dv : du) / 2, rise = half * pitch, P = (u, v, yy) => { const w = lmW(f, u, v); return [w[0], yy, w[1]]; };
  const S = FTS[4], RF = [208, 210, 212];
  const q = (A, B2, C2, D, n) => K.roof.q(A, B2, C2, D, n, [0, 0, 1, 0, 1, 1, 0, 1].map((t, i) => i % 2 ? t * Math.hypot(C2[0] - B2[0], C2[1] - B2[1], C2[2] - B2[2]) / S : t * Math.hypot(B2[0] - A[0], B2[2] - A[2]) / S), RF);
  const tri = (A, B2, C2, n) => q(A, B2, C2, C2, n);
  const nrm = (a, b) => { const l = Math.hypot(a, 1, b); return [a / l, 1 / l, b / l]; }, ex = f[2], ez = f[3], vx = -ez, vz = ex;
  if (along) {
    const r0 = u0 + half, r1 = u1 - half, vm = (v0 + v1) / 2;
    q(P(u0, v0, y), P(u1, v0, y), P(r1, vm, y + rise), P(r0, vm, y + rise), nrm(-vx * pitch, -vz * pitch));
    q(P(u1, v1, y), P(u0, v1, y), P(r0, vm, y + rise), P(r1, vm, y + rise), nrm(vx * pitch, vz * pitch));
    tri(P(u0, v1, y), P(u0, v0, y), P(r0, vm, y + rise), nrm(-ex * pitch, -ez * pitch)); tri(P(u1, v0, y), P(u1, v1, y), P(r1, vm, y + rise), nrm(ex * pitch, ez * pitch));
  } else {
    const r0 = v0 + half, r1 = v1 - half, um = (u0 + u1) / 2;
    q(P(u0, v1, y), P(u0, v0, y), P(um, r0, y + rise), P(um, r1, y + rise), nrm(-ex * pitch, -ez * pitch));
    q(P(u1, v0, y), P(u1, v1, y), P(um, r1, y + rise), P(um, r0, y + rise), nrm(ex * pitch, ez * pitch));
    tri(P(u0, v0, y), P(u1, v0, y), P(um, r0, y + rise), nrm(-vx * pitch, -vz * pitch)); tri(P(u1, v1, y), P(u0, v1, y), P(um, r1, y + rise), nrm(vx * pitch, vz * pitch));
  }
  polyA(K.cap, [P(u0, v0, y - 0.02), P(u1, v0, y - 0.02), P(u1, v1, y - 0.02), P(u0, v1, y - 0.02)], hb('#d6d2c8'), 0, -1, 0);   // soffit
  return rise;
}
// a ramp to the upper floor along the end of a wing: from (ulow) at the ground to (uhigh) at y1, between v0 and v1
function fortRamp(K, B, ulow, uhigh, v0, v1, y1) {
  const f = B.f, Y = B.col, WH = [244, 241, 233], P = (u, v, y) => fortP(f, u, v, y), s = Math.sign(uhigh - ulow), L = Math.abs(uhigh - ulow);
  const yAt = u => Math.max(0, Math.min(y1, (u - ulow) * s / L * y1));
  const n = 8;
  for (let k = 0; k < n; k++) {
    const ua = ulow + (uhigh - ulow) * k / n, ub = ulow + (uhigh - ulow) * (k + 1) / n, ya = yAt(ua), yb = yAt(ub);
    for (const [v, nv] of [[v0, -1], [v1, 1]]) {
      const nn = [-f[3] * nv, 0, f[2] * nv];
      K.ren.q(P(ua, v, 0), P(ub, v, 0), P(ub, v, yb + 0.9), P(ua, v, ya + 0.9), nn, [ua / LMWS[1], 0, ub / LMWS[1], 0, ub / LMWS[1], (yb + 0.9) / LMWS[1], ua / LMWS[1], (ya + 0.9) / LMWS[1]], Y);
      polyA(K.cap, [P(ua, v - 0.15, ya + 0.9), P(ub, v - 0.15, yb + 0.9), P(ub, v + 0.15, yb + 0.9), P(ua, v + 0.15, ya + 0.9)], hb('#efece4'), 0, 1, 0);   // white coping
    }
    polyA(K.cap, [P(ua, v0 + 0.15, ya + 0.02), P(ub, v0 + 0.15, yb + 0.02), P(ub, v1 - 0.15, yb + 0.02), P(ua, v1 - 0.15, ya + 0.02)], hb('#8f8a82'), 0, 1, 0);   // paving
  }
  // the arched passage under the higher half, on the side away from the building: in the frame g that side is the
  // plane u' = |outV| and v' runs along u (reversed when the side faces +v)
  const ua = ulow + (uhigh - ulow) * 0.62, outV = Math.abs(v0) > Math.abs(v1) ? v0 : v1, out = Math.sign(outV), g = [f[0], f[1], -f[3] * out, f[2] * out];
  const cv = -out * ua, A = { vc: cv, w: 1.5, ys: 0.6, ya: 2.1, sh: 'round', yb: 0 }, up = Math.abs(outV);
  fortTile(K.det, g, up + 0.02, 1, cv - 1.5, cv + 1.5, 0, 2.1, FTT.ramparch);
  fortArchRing(K.ren, g, up + 0.08, up, 1, A, { vc: cv, w: 1.85, ys: 0.6, ya: 2.45, sh: 'round' }, LMWS[1], WH, 14);
  for (const v of [v0, v1]) COL.add(...lmW(f, ulow, v), ...lmW(f, uhigh, v), 0.2, 0);
}
function fortArsenal(K, B) {
  const f = B.f, Y = B.col, WH = [244, 241, 233], P = (u, v, y) => fortP(f, u, v, y);
  const cu = B.wings.reduce((s, w) => s + (w[0] + w[1]) / 2, 0) / B.wings.length;
  if (B.outline) {
    const O = B.outline, flat = []; for (const [u, v] of O) flat.push(u, v);
    O.forEach((A, i) => {
      const Bq = O[(i + 1) % O.length], L = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]), tx = (Bq[0] - A[0]) / L, tv = (Bq[1] - A[1]) / L, m = [(A[0] + Bq[0]) / 2, (A[1] + Bq[1]) / 2];
      const inside = pip(m[0] + tv * 0.5, m[1] - tx * 0.5, flat) ? [m[0] + tv * 3, m[1] - tx * 3] : [m[0] - tv * 3, m[1] + tx * 3];
      const ent = B.entrance && Math.hypot(B.entrance[0][0] - A[0], B.entrance[0][1] - A[1]) < 0.1 ? B.entrance[2] : -1;
      const opt = { brick: (B.brick || []).some(p => Math.hypot(p[0] - A[0], p[1] - A[1]) < 0.1), oak: ent >= 0, fromA: true };
      const n = L < 6 ? 0 : Math.max(1, Math.round(L / 7.4));
      fortArsenalSide(K, B, [A[0], A[1], Bq[0], Bq[1], n, ent >= 0 ? ent : -1, opt], inside);
    });
  }
  for (const side of B.sides || []) {
    // the inside of a side is the centre of the wing it belongs to
    const w = B.wings.find(w => Math.min(side[0], side[2]) >= w[0] - 0.01 && Math.max(side[0], side[2]) <= w[1] + 0.01 && Math.min(side[1], side[3]) >= w[2] - 0.01 && Math.max(side[1], side[3]) <= w[3] + 0.01);
    fortArsenalSide(K, B, side, w ? [(w[0] + w[1]) / 2, (w[2] + w[3]) / 2] : [cu, -10]);
  }
  if (B.roofs) {
    for (const [rf, u0, u1, v0, v1, chim] of B.roofs) {
      const F = rf || f; fortHipRoof(K, F, u0, u1, v0, v1, B.H, 0.42);
      // brick chimneys along the street side of the roof
      if (chim) { const vv = Math.abs(v0) < Math.abs(v1) ? v0 + 5.5 : v1 - 5.5, y = B.H + 6 * 0.42;
        for (let u = u0 + 7; u < u1 - 6; u += 9.5) { lmBoxL(K.cap, F, u - 0.45, u + 0.45, vv - 0.3, vv + 0.3, y - 1.2, y + 1.6, hb('#a4553f')); lmBoxL(K.cap, F, u - 0.55, u + 0.55, vv - 0.4, vv + 0.4, y + 1.6, y + 1.75, hb('#8a8681')); } }
    }
  } else {
  // roofs: the long wing with a lower pitch, so that its ridge meets the ridges of the cross wings
  const [m, ...cross] = B.wings, pc = 0.42;
  for (const w of cross) { fortHipRoof(K, f, w[0], w[1], w[2], w[3], B.H, pc); }
  const dm = Math.min(m[1] - m[0], m[3] - m[2]), dc = Math.min(...cross.map(w => Math.min(w[1] - w[0], w[3] - w[2])));
  fortHipRoof(K, f, m[0], m[1], m[2], m[3], B.H, pc * (dc + 1) / (dm + 1));
  // small round vents on the long roof, 3.4 m in from the eaves
  const pm = pc * (dc + 1) / (dm + 1);
  for (let u = 26; u < m[1] - 25; u += 16) for (const vv of [m[2] + 3.4, m[3] - 3.4]) lmLathe(K.cap, ...lmW(f, u, vv), B.H + 3.9 * pm - 0.25, [[0, 0], [0.42, 0], [0.42, 0.3], [0.3, 0.55], [0, 0.65]], 10, hb('#a7acb0'));
  }
  // annexes at the ends of the cross wings: one storey, their roofs the landings of the ramps
  for (const [u0, u1, v0, v1] of B.annex || []) {
    const st = { tex: 1, col: Y }, ring = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 4; i++) { const A = ring[i], Bq = ring[(i + 1) % 4]; if (Math.abs(A[1] - Bq[1]) < 0.01 && Math.abs(A[1] - Math.max(v0, v1)) < 0.01) continue;
      const { g, L } = fortSideFrame(f, A, Bq, [(u0 + u1) / 2, (v0 + v1) / 2]), outer = Math.abs(A[1] - Bq[1]) < 0.01;
      const holes = outer ? [{ vc: L / 2, w: 1.0, ys: 2.6, ya: 2.6, sh: 'rect', yb: 0.15 }, { vc: L / 2 - 4, w: 0.5, ys: 3.2, ya: 3.2, sh: 'rect', yb: 1.0 }, { vc: L / 2 + 4, w: 0.5, ys: 3.2, ya: 3.2, sh: 'rect', yb: 1.0 }] : [];
      fortWallPlane(K.rus, g, 0, 1, 0, L, -0.3, 5.0, holes, FTS[5], Y);
      for (const hl of holes) { fortTile(K.det, g, -0.2, 1, hl.vc - hl.w, hl.vc + hl.w, hl.yb, hl.ys, hl.w > 0.8 ? FTT.adoor : FTT.awin); fortTBox(K.ren, g, -0.2, 0, hl.vc - hl.w, hl.vc + hl.w, hl.ys, hl.ys, LMWS[1], sh(Y, 0.8), 'b');
        for (const s of [-1, 1]) fortTBox(K.ren, g, -0.2, 0, hl.vc + s * hl.w, hl.vc + s * hl.w, hl.yb, hl.ys, LMWS[1], sh(Y, 0.85), s < 0 ? 's' : 'n'); }
      if (outer) { fortTBox(K.cap2b, g, 0, 1.0, L / 2 - 1.5, L / 2 + 1.5, 2.85, 2.95, 1, [70, 98, 84]); }   // a small green canopy over the door
      fortTBox(K.ren, g, 0, 0.3, -0.3, L + 0.3, 4.6, 5.0, LMWS[1], WH, 'enswb');
      COL.add(...lmW(g, 0.15, 0), ...lmW(g, 0.15, L), 0.2, 0);
    }
    polyA(K.cap, [P(u0, v0, 5.0), P(u1, v0, 5.0), P(u1, v1, 5.0), P(u0, v1, 5.0)], hb('#8f8a82'), 0, 1, 0);
    for (const [a, b] of [[[u0, v0], [u1, v0]], [[u1, v0], [u1, v1]], [[u0, v1], [u1, v1]], [[u0, v0], [u0, v1]]]) {
      if (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[1] - Math.max(v0, v1)) < 0.01) continue;
      const A3 = P(a[0], a[1], 5.0), B3 = P(b[0], b[1], 5.0); lmBar(K.cap, [A3[0], 6.0, A3[2]], [B3[0], 6.0, B3[2]], 0.06, hb('#3d4145'));
      const Lr = Math.hypot(B3[0] - A3[0], B3[2] - A3[2]); for (let t = 0; t <= Lr; t += 1.6) { const x = A3[0] + (B3[0] - A3[0]) * t / Lr, z = A3[2] + (B3[2] - A3[2]) * t / Lr; lmBar(K.cap, [x, 5.0, z], [x, 6.0, z], 0.04, hb('#3d4145')); }
    }
  }
  for (const [ulow, uhigh, v0, v1] of B.ramps || []) fortRamp(K, B, ulow, uhigh, v0, v1, 5.0);
  // entrance canopy: a dark steel plate on slender posts, glazed at the sides
  if (B.canopy) {
    const [u0, u1, v0, v1] = B.canopy, DK = hb('#3a3633');
    fortTBox(K.cap2b, f, u0 - 0.3, u1 + 0.3, v0 - 0.3, v1, 3.7, 4.05, 1, [62, 58, 54]);
    for (const u of [u0, u1]) lmBar(K.cap, P(u, v0, 0), P(u, v0, 3.7), 0.14, DK);
  }
  for (const [u0, u1, v0, v1] of B.planters || []) { fortTBox(K.gra, f, u0, u1, v0, v1, 0, 0.6, FTS[1], [170, 166, 160]); polyA(K.cap, [P(u0 + 0.2, v0 + 0.2, 0.62), P(u1 - 0.2, v0 + 0.2, 0.62), P(u1 - 0.2, v1 - 0.2, 0.62), P(u0 + 0.2, v1 - 0.2, 0.62)], hb('#55703a'), 0, 1, 0);
    for (let u = u0 + 0.8; u < u1 - 0.5; u += 1.4) lmLathe(K.cap, ...lmW(f, u, (v0 + v1) / 2), 0.6, [[0, 0], [0.45, 0.15], [0.4, 0.45], [0, 0.6]], 7, hb('#47662f')); }
  for (const [u, v] of B.flags || []) { const w = lmW(f, u, v); lmFlag(K.cap, w[0], w[1], 0, 9.5, [f[2], f[3]], 1.8); }
}
/* The Commandant's house (Komandanta iela 7): two storeys, 107 m long, with a three-storey centre that steps forward;
   pale khaki render, the ground floor scored into rustication with white keystones over the windows, the upper
   windows in white surrounds under small cornices, an arcade of five round arches in the centre with the door in the
   middle one and a gun on each side of the steps (photographs: Wikimedia Commons, "Commandant's House (Daugavpils
   Fortress)"). Frame: origin at the east front corner, u along the front to the west, v out of the front. */
const FORT_CLASSIC = [
  { key: 'kom', f: [-2804.8, -352.4, -0.8720, -0.4895], H: 9.2, col: [220, 204, 146],
    wings: [[0, 106.7, -17.3, 0], [44.9, 67.4, -17.3, 0.9]],
    sides: [[0, 0, 44.9, 0, 11], [67.4, 0, 106.7, 0, 10], [44.9, 0.9, 67.4, 0.9, 5, { H: 13.2, floors: 3, arcade: 2 }],
      [44.9, 0, 44.9, 0.9, 0, { H: 13.2 }], [67.4, 0, 67.4, 0.9, 0, { H: 13.2 }],
      [0, -17.3, 44.9, -17.3, 11], [67.4, -17.3, 106.7, -17.3, 10], [44.9, -17.3, 67.4, -17.3, 5, { H: 13.2, floors: 3 }],
      [0, -17.3, 0, 0, 4], [106.7, -17.3, 106.7, 0, 4], [44.9, -17.3, 44.9, 0, 0, { H: 13.2, y0: 9.2 }], [67.4, -17.3, 67.4, 0, 0, { H: 13.2, y0: 9.2 }]],
    roofs: [[0, 106.7, -17.3, 0, 9.2], [44.9, 67.4, -17.3, 0.9, 13.2]], steps: [53.1, 59.2, 0.9, 3.2] }
];
function fortClassicSide(K, B, side, inside) {
  const [ua, va, ub, vb, n, opt = {}] = side, { g, L } = fortSideFrame(B.f, [ua, va], [ub, vb], inside), H = opt.H || B.H, y0 = opt.y0 || 0, fl = opt.floors || 2;
  const Y = B.col, WH = [242, 238, 228], GZ = 4.4, P = (u, v, y) => fortP(g, u, v, y), bay = L / Math.max(1, n), hG = [], hU = [], wins = [];
  const floorY = f => f === 0 ? 0 : GZ + 0.25 + (f - 1) * 4.0;
  for (let k = 0; k < n; k++) {
    const c = (k + 0.5) * bay;
    if (y0 < GZ) {
      if (opt.arcade != null) { const door = k === opt.arcade; hG.push({ vc: c, w: 1.3, ys: 2.7, ya: 4.0, sh: 'round', yb: door ? 0.35 : 0.9, door, arch: 1 }); }
      else hG.push({ vc: c, w: 0.62, ys: 3.05, ya: 3.05, sh: 'rect', yb: 1.0 });
    }
    for (let f = 1; f < fl; f++) { const yb = floorY(f) + 0.95; if (yb > y0) hU.push({ vc: c, w: 0.6, ys: yb + (f === 2 ? 1.9 : 2.2), ya: yb + (f === 2 ? 1.9 : 2.2), sh: 'rect', yb, f }); }
  }
  if (y0 < GZ) fortWallPlane(K.rus, g, 0, 1, -0.02, L + 0.02, -0.3, GZ, hG, FTS[5], Y);
  // one band of wall per storey: fortWallPlane cuts one row of openings at a time
  const cuts = [Math.max(GZ, y0)]; for (let f = 2; f < fl; f++) if (floorY(f) > cuts[cuts.length - 1]) cuts.push(floorY(f)); cuts.push(H);
  for (let i = 0; i < cuts.length - 1; i++) fortWallPlane(K.ren, g, 0, 1, -0.02, L + 0.02, cuts[i], cuts[i + 1], hU.filter(o => o.yb >= cuts[i] && o.ys <= cuts[i + 1]), LMWS[1], Y);
  for (const o of [...hG, ...hU]) {
    const a = o.vc - o.w, b = o.vc + o.w, top = o.ys;
    if (o.arch) {
      // arcade: reveals, the arch soffit, a white archivolt and impost blocks; glazing or the door set back
      fortArchRing(K.ren, g, 0, -0.45, 1, o, o, LMWS[1], sh(Y, 0.85), 14);
      for (const s of [-1, 1]) fortTBox(K.ren, g, -0.45, 0, o.vc + s * o.w, o.vc + s * o.w, o.yb, o.ys, LMWS[1], sh(Y, 0.85), s < 0 ? 's' : 'n');
      fortTBox(K.ren, g, -0.45, 0, a, b, o.yb, o.yb, LMWS[1], sh(Y, 0.95), 't'); fortTBox(K.ren, g, -0.46, -0.45, a, b, o.yb, o.ya, LMWS[1], sh(Y, 0.92), 'e');   // sill, back of the recess
      fortArchRing(K.ren, g, 0.1, 0, 1, o, { vc: o.vc, w: o.w + 0.3, ys: o.ys, ya: o.ya + 0.3, sh: 'round' }, LMWS[1], WH, 14);
      for (const s of [-1, 1]) fortTBox(K.ren, g, 0, 0.14, o.vc + s * (o.w + 0.15) - 0.25, o.vc + s * (o.w + 0.15) + 0.25, o.ys - 0.25, o.ys, LMWS[1], WH, 'enst');
      fortTile(K.det, g, -0.44, 1, a + 0.15, b - 0.15, o.yb, o.ys, o.door ? FTT.door : FTT.cwin);
      continue;
    }
    fortTile(K.det, g, -0.2, 1, a, b, o.yb, top, FTT.cwin);
    for (const s of [-1, 1]) fortTBox(K.ren, g, -0.2, 0, o.vc + s * o.w, o.vc + s * o.w, o.yb, top, LMWS[1], sh(Y, 0.85), s < 0 ? 's' : 'n');
    fortTBox(K.ren, g, -0.2, 0, a, b, top, top, LMWS[1], sh(Y, 0.8), 'b');
    fortTBox(K.ren, g, 0, 0.12, a - 0.08, b + 0.08, o.yb - 0.1, o.yb, LMWS[1], WH, 'etb');                     // sill
    if (!o.f) fortTBox(K.ren, g, 0, 0.12, o.vc - 0.2, o.vc + 0.2, top, top + 0.55, LMWS[1], WH, 'enst');       // keystone in the rustication
    else {                                                                                                   // white surround and a small cornice
      for (const s of [-1, 1]) fortTBox(K.ren, g, 0, 0.08, o.vc + s * (o.w + 0.09) - 0.09, o.vc + s * (o.w + 0.09) + 0.09, o.yb, top + 0.15, LMWS[1], WH, 'ens');
      fortTBox(K.ren, g, 0, 0.08, a - 0.18, b + 0.18, top, top + 0.15, LMWS[1], WH, 'ens');
      if (o.f === 1) fortTBox(K.ren, g, 0, 0.2, a - 0.3, b + 0.3, top + 0.32, top + 0.48, LMWS[1], WH, 'enstb');
    }
  }
  if (y0 < GZ) fortTBox(K.ren, g, 0, 0.12, -0.05, L + 0.05, GZ, GZ + 0.25, LMWS[1], WH, 'enstb');
  if (fl === 3) fortTBox(K.ren, g, 0, 0.08, -0.05, L + 0.05, floorY(2) - 0.05, floorY(2) + 0.15, LMWS[1], WH, 'enstb');
  fortTBox(K.ren, g, 0, 0.08, -0.05, L + 0.05, H - 0.75, H - 0.6, LMWS[1], WH, 'ensb');
  fortTBox(K.ren, g, 0, 0.42, -0.4, L + 0.4, H - 0.6, H, LMWS[1], WH, 'enswb');
  if (y0 === 0) { fortTBox(K.gra, g, 0, 0.1, -0.05, L + 0.05, -0.3, 0.35, FTS[1], [150, 146, 140], 'et'); COL.add(...lmW(g, 0.15, 0), ...lmW(g, 0.15, L), 0.2, 0); }
}
function fortClassic(K, B) {
  const f = B.f, cu = B.wings[0];
  for (const side of B.sides) {
    const w = B.wings.slice().reverse().find(w => Math.min(side[0], side[2]) >= w[0] - 0.01 && Math.max(side[0], side[2]) <= w[1] + 0.01 && Math.min(side[1], side[3]) >= w[2] - 0.01 && Math.max(side[1], side[3]) <= w[3] + 0.01) || cu;
    // the inside of the short return faces of the risalit is behind them, towards the main block
    const ins = side[0] === side[2] && Math.abs(side[1] - side[3]) < 2 ? [side[0] + (side[0] < (w[0] + w[1]) / 2 ? 1 : -1), -2] : [(w[0] + w[1]) / 2, (w[2] + w[3]) / 2];
    fortClassicSide(K, B, side, ins);
  }
  for (const [u0, u1, v0, v1, y] of B.roofs) {
    const rise = fortHipRoof(K, f, u0, u1, v0, v1, y, 0.45, 0.45);
    // white chimneys on the ridge
    const vm = (v0 + v1) / 2, long = u1 - u0 > v1 - v0;
    if (long) for (let u = u0 + 9; u < u1 - 8; u += 12.5) { lmBoxL(K.cap, f, u - 0.45, u + 0.45, vm - 0.4, vm + 0.4, y + rise - 0.6, y + rise + 1.1, hb('#ece8de')); lmBoxL(K.cap, f, u - 0.6, u + 0.6, vm - 0.55, vm + 0.55, y + rise + 1.1, y + rise + 1.25, hb('#cfcac0')); }
  }
  if (B.steps) { const [u0, u1, v0, v1] = B.steps; for (let k = 0; k < 3; k++) fortTBox(K.gra, f, u0 - k * 0.3, u1 + k * 0.3, v0, v1 - k * 0.6, 0, 0.45 - k * 0.15, FTS[1], [160, 156, 150]); }
}
/* Since its restoration the Commandant's house is the Latgale regional administration of the State Police (OSM:
   amenity=police at Komandanta iela 7): metal letters VALSTS POLICIJA over the arcade, a plate by the door, flags on
   the lawn, the railing along the front with its gap at the path to the door, and the police car park behind the
   house (OSM amenity=parking, 110 × 34 m) with service and private cars. Frame as FORT_CLASSIC 'kom'. */
function fortCar(G, x, z, dx, dz, col, police, seed) {
  const f = [x, z, dx, dz], GL = hb('#26303a'), TY = hb('#1c1c1c');
  lmBoxL(G, f, -2.25, 2.25, -0.88, 0.88, 0.32, 0.92, col);
  lmBoxL(G, f, -2.3, -1.9, -0.86, 0.86, 0.45, 0.8, sh(col, 0.9)); lmBoxL(G, f, 1.9, 2.3, -0.86, 0.86, 0.45, 0.8, sh(col, 0.9));
  lmBoxL(G, f, -1.25, 0.95, -0.78, 0.78, 0.92, 1.4, GL);
  lmBoxL(G, f, -1.2, 0.85, -0.8, 0.8, 1.4, 1.47, col);
  for (const su of [-1.4, 1.45]) for (const sv of [-1, 1]) fortLatheAx(G, fortP(f, su, sv * 0.78, 0.32), [-dz * sv, 0, dx * sv], [[0, 0], [0.32, 0], [0.32, 0.2], [0, 0.2]], 10, TY);
  if (police) {
    lmBoxL(G, f, -2.27, 2.27, -0.9, 0.9, 0.55, 0.72, hb('#1f4ea0'));
    lmBoxL(G, f, -0.35, 0.35, -0.6, 0.6, 1.47, 1.6, hb('#2a5bd0')); lmBoxL(G, f, -0.12, 0.12, -0.6, 0.6, 1.47, 1.61, hb('#c9cdd1'));
  }
}
function fortPolice(K) {
  const B = FORT_CLASSIC.find(b => b.key === 'kom'); if (!B) return; const f = B.f, P = (u, v, y) => fortP(f, u, v, y);
  // letters and the plate on the front of the centre (the front of the risalit is the plane v = 0.9, facing +v)
  const g = [...lmW(f, 0, 0.9), -f[3], f[2]];   // u' = v - 0.9 out of the wall, v' = -u along it
  fortTile(K.cut, g, 0.06, 1, -61.6, -50.7, 4.74, 5.32, FTT.policija);
  fortTile(K.det, g, 0.03, 1, -54.2, -53.6, 1.3, 2.1, FTT.polplate);   // on the pier left of the door
  for (const u of [47.5, 64.8]) { const w = lmW(f, u, 10.5); lmFlag(K.cap, w[0], w[1], 0, 8.5, [f[2], f[3]], 1.9); }
  // railing along the front, open opposite the door
  const BLK = hb('#24272a');
  for (const [u0, u1] of [[3.4, 51.7], [58.5, 108.6]]) {
    const v = 18; lmBar(K.cap, P(u0, v, 1.15), P(u1, v, 1.15), 0.05, BLK); lmBar(K.cap, P(u0, v, 0.15), P(u1, v, 0.15), 0.05, BLK);
    for (let u = u0; u <= u1 + 0.01; u += 0.18) { const post = Math.abs((u - u0) % 2.52) < 0.09; lmBar(K.cap, P(u, v, 0), P(u, v, post ? 1.3 : 1.15), post ? 0.09 : 0.025, BLK); }
    COL.add(...lmW(f, u0, v), ...lmW(f, u1, v), 0.1, 0);
  }
  // the car park behind: asphalt with white bays, rows of cars nose to the kerb, every third a police car
  const AS = hb('#55575a'), LN = hb('#d9d9d4');
  polyA(K.cap, [P(-1.5, -32.2, 0.03), P(108.4, -32.2, 0.03), P(108.4, -66.7, 0.03), P(-1.5, -66.7, 0.03)], AS, 0, 1, 0);
  for (const [v0, v1] of [[-32.6, -38.4], [-41.4, -47.2], [-52.5, -58.3], [-60.6, -66.4]]) for (let u = 1.125; u < 105; u += 2.75)
    polyA(K.cap, [P(u - 0.06, v0, 0.04), P(u + 0.06, v0, 0.04), P(u + 0.06, v1, 0.04), P(u - 0.06, v1, 0.04)], LN, 0, 1, 0);
  const COLS = ['#2f3338', '#8d9196', '#c9ccd0', '#5b1f22', '#203a5c', '#e9e9e6', '#3d4a3a', '#6b6f73'];
  let n = 0;
  for (const [vRow, face] of [[-35.5, 1], [-44.3, -1], [-55.4, 1], [-63.4, -1]]) for (let u = 2.5; u < 104; u += 2.75) {
    const r = hash(Math.round(u * 10) * 31 + Math.round(-vRow * 10)); if (r < 0.5) continue;
    const w = lmW(f, u, vRow), d = [-f[3] * face, f[2] * face], police = r > 0.8 || (n % 3 === 0 && r > 0.55);
    fortCar(K.cap, w[0], w[1], d[0], d[1], police ? hb('#f2f2ef') : hb(COLS[Math.floor(r * 97) % COLS.length]), police); n++;
  }
}
function fortBuildings(K) { for (const B of FORT_BLD) fortArsenal(K, B); for (const B of FORT_CLASSIC) fortClassic(K, B); fortPolice(K); }

export { fortBldHulls, fortBuildings, fortCar, fortNearBld };
