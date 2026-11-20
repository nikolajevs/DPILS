import { sphereProf } from './culture-palace.js';
import { lmSign } from './unity-house.js';
import { lmBar, lmBlock, lmBoxL, lmLathe, lmLit, lmOp, lmOpsFor, lmRow, lmWF, lmWall } from './helpers.js';
import { LMT, lr } from './tiles.js';
import { LMF, LMWHITE, lmW } from './core.js';
import { flatPlain } from '../buildings/walls.js';
import { COL } from '../world/data.js';
import { walkSlab } from '../world/walkgrid.js';
import { polyA } from '../core/geometry.js';
import { area2, hb, pip, reversed, sh } from '../core/util.js';

/* ---------- Daugavpils University ---------- */
// a box along the wall a→b of a local frame: s along it, d outwards (away from the local point 'inside')
function lmEdgeBox(G, f, a, b, inside, s0, s1, y0, y1, d0, d1, col) {
  const A = lmW(f, a[0], a[1]), B = lmW(f, b[0], b[1]), L = Math.hypot(B[0] - A[0], B[1] - A[1]), tx = (B[0] - A[0]) / L, tz = (B[1] - A[1]) / L, I = lmW(f, inside[0], inside[1]);
  let nx = tz, nz = -tx; if (nx * (I[0] - A[0]) + nz * (I[1] - A[1]) > 0) { nx = -nx; nz = -nz; }
  const P = (s, y, d) => [A[0] + tx * s + nx * d, y, A[1] + tz * s + nz * d];
  polyA(G, [P(s0, y0, d1), P(s1, y0, d1), P(s1, y1, d1), P(s0, y1, d1)], col, nx, 0, nz);
  polyA(G, [P(s0, y1, d0), P(s1, y1, d0), P(s1, y1, d1), P(s0, y1, d1)], sh(col, 1.06), 0, 1, 0);
  polyA(G, [P(s0, y0, d0), P(s1, y0, d0), P(s1, y0, d1), P(s0, y0, d1)], sh(col, 0.72), 0, -1, 0);
  polyA(G, [P(s0, y0, d0), P(s0, y0, d1), P(s0, y1, d1), P(s0, y1, d0)], sh(col, 0.9), -tx, 0, -tz);
  polyA(G, [P(s1, y0, d0), P(s1, y0, d1), P(s1, y1, d1), P(s1, y1, d0)], sh(col, 0.9), tx, 0, tz);
}
const lmLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lmAlong = (a, b, s) => { const L = lmLen(a, b); return [a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L]; };
// adjacent openings of about 'unit' width filling s0..s1 along a→b
function lmStrip(ops, a, b, s0, s1, unit, y0, y1, tile, o) {
  const n = Math.max(1, Math.round((s1 - s0) / unit)), w = (s1 - s0) / n;
  for (let k = 0; k < n; k++) { const p = lmAlong(a, b, s0 + (k + 0.5) * w); lmOp(ops, p[0], p[1], w, y0, y1, typeof tile === 'function' ? tile(k) : tile, typeof o === 'function' ? o(k) : o); }
}
// ribbons of 'group' windows with brick piers between them, centred in s0..s1; returns the spans for the white sills
function lmRibbons(ops, a, b, s0, s1, y0, y1, tile, o, group = 5, unit = 1.5, gap = 1.6) {
  const gw = group * unit, m = Math.max(1, Math.floor((s1 - s0 + gap) / (gw + gap))), tot = m * gw + (m - 1) * gap, spans = [];
  if (tot > s1 - s0 + 0.01) return spans;
  for (let k = 0; k < m; k++) { const g0 = s0 + (s1 - s0 - tot) / 2 + k * (gw + gap); lmStrip(ops, a, b, g0, g0 + gw, unit, y0, y1, tile, o); spans.push([g0, g0 + gw]); }
  return spans;
}
const lmNear = (a, b) => Math.abs(a[0] - b[0]) < 0.06 && Math.abs(a[1] - b[1]) < 0.06;
// foot of the walls of a block: an edge p–q listed in rules starts at height y (y ≥ top drops the wall)
const lmFoot = rules => (a, b, y0) => { for (const [p, q, y] of rules) if ((lmNear(a, p) && lmNear(b, q)) || (lmNear(a, q) && lmNear(b, p))) return y; return y0; };
const lmIsect = (p1, p2, p3, p4) => { const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]), t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d; return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]; };
const lmPipL = (p, poly) => { const r = []; for (const q of poly) r.push(q[0], q[1]); return pip(p[0], p[1], r); };
// outward unit normal (local) of the edge a→b of a polygon
const lmOut = (poly, a, b) => { const L = lmLen(a, b), n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L], m = [(a[0] + b[0]) / 2 + n[0] * 0.3, (a[1] + b[1]) / 2 + n[1] * 0.3]; return lmPipL(m, poly) ? [-n[0], -n[1]] : n; };
const lmEdges = poly => poly.map((a, i) => [a, poly[(i + 1) % poly.length]]);
// a wall that faces the local point 'toward'
function lmWallTo(K, f, a, b, toward, y0, y1, ops, st) {
  let P = lmW(f, a[0], a[1]), Q = lmW(f, b[0], b[1]), pl = a, ql = b; const T = lmW(f, toward[0], toward[1]), tx = Q[0] - P[0], tz = Q[1] - P[1];
  if (tz * (T[0] - P[0]) - tx * (T[1] - P[1]) < 0) { [P, Q] = [Q, P]; [pl, ql] = [ql, pl]; }
  lmWall(K, P, Q, y0, y1, lmOpsFor(f, ops, pl, ql), st);
}
// a disc facing (nx, ny, nz) made of triangles
function lmDisc(G, c, r, ax, ay, col, n) { const N = 16; for (let k = 0; k < N; k++) { const a0 = k / N * 2 * Math.PI, a1 = (k + 1) / N * 2 * Math.PI, p = a => [c[0] + (ax[0] * Math.cos(a) + ay[0] * Math.sin(a)) * r, c[1] + (ax[1] * Math.cos(a) + ay[1] * Math.sin(a)) * r, c[2] + (ax[2] * Math.cos(a) + ay[2] * Math.sin(a)) * r]; polyA(G, [c, p(a0), p(a1)], col, n[0], n[1], n[2]); } }
// a Latvian flag on a pole at world (x, z), flying along the world direction dir
function lmFlag(G, x, z, y0, y1, dir, len = 2.1) {
  lmBar(G, [x, y0, z], [x, y1, z], 0.09, hb('#d9d9d6')); lmLathe(G, x, z, y1, [[0, 0], [0.09, 0.05], [0.07, 0.15], [0, 0.2]], 8, hb('#c9a24a'));
  const CAR = hb('#9e3039'), WH = hb('#f3f1ec'), h = len / 2, nx = -dir[1], nz = dir[0];
  const band = (a, b, col) => { const A = [x, a, z], B = [x + dir[0] * len, a - 0.05, z + dir[1] * len], Cc = [x + dir[0] * len, b - 0.05, z + dir[1] * len], D = [x, b, z]; polyA(G, [A, B, Cc, D], col, nx, 0, nz); polyA(G, [A, B, Cc, D], col, -nx, 0, -nz); };
  const t = y1 - 0.1; band(t - h, t - h * 0.6, CAR); band(t - h * 0.6, t - h * 0.4, WH); band(t - h * 0.4, t, CAR);
}

/* ---- Old building, Vienības iela 13 ----
   Built 1952–56 to a design by Aleksejs Bogačenkovs for the regional party committee and finished for the
   Pedagogical Institute; the university's main building since. Frame du: origin at the south corner of the main
   façade, u into the building, v north along the 76.7 m façade on the square with the fountain and the Rainis bust.
   Measured on photographs (Wikimedia Commons: Igors Jefimovs 2011, Dāvis Kļaviņš 2010 and others) against the
   cadastre outline: blank corner pavilions 8.4 m wide, eleven bays of 5.45 m between ten giant pilasters, paired
   windows on four floors 3.95 m apart, three oak doors in the middle bays, capitals level with the top windows,
   a 3 m frieze with the name in bronze letters and a cornice topping out at 21.5 m; three wings at the back. */
const DU = { v0: 8.4, bay: 59.9 / 11, sill: [2.27, 6.23, 10.18, 14.09], wh: 2.2, mid: 38.35 };
const duBay = k => DU.v0 + (k + 0.5) * DU.bay;
function lmDUMain(K) {
  const f = LMF.du, ops = [], G = K.plain, S = K.stone, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const WALL = hb('#b8a07d'), PIL = sh(WALL, 0.86), PLINTH = hb('#6e655c'), TRIM = sh(WALL, 0.9), ROOF = hb('#5e5f60'), GRAN = hb('#77706a'), STEP = hb('#8c857d');
  const st = { tex: 2, col: WALL, plinth: 1.1, pcol: PLINTH };
  const winO = () => ({ d: 0.32, sill: TRIM, lit: lmLit(0.5) }), wt = () => { const r = lr(); return r < 0.2 ? 'duWinB' : r < 0.42 ? 'duWinC' : 'duWin'; };
  // main façade: paired windows in eleven bays, oak doors in the middle three
  for (let k = 0; k < 11; k++) for (let fl = 0; fl < 4; fl++) {
    if (!fl && k >= 4 && k <= 6) { lmOp(ops, 0.4, duBay(k), 1.8, 1.1, 4.7, 'duDoor', { d: 0.5, lit: true }); continue; }
    for (const dv of [-0.88, 0.88]) lmOp(ops, 0.4, duBay(k) + dv, 1.1, DU.sill[fl], DU.sill[fl] + DU.wh, wt(), winO());
  }
  // ends on Lāčplēša iela (v = 0) and Saules iela (v = 76.7): four pairs of windows on each floor
  for (const v of [0, 76.7]) for (const uc of [4.6, 11.8, 22.6, 29.8]) for (let fl = 0; fl < 4; fl++) for (const du of [-0.88, 0.88]) lmOp(ops, uc + du, v, 1.1, DU.sill[fl], DU.sill[fl] + DU.wh, wt(), winO());
  // plan: the front block with three wings at the back; the bays between the pavilions are set back 0.4 m
  const M = [[0, 0], [34.5, 0], [34.5, 17.2], [28.7, 17.2], [28.7, 14.6], [16.4, 14.6], [16.4, 29.8], [34.0, 29.8], [34.0, 46.2], [17.5, 46.2], [17.5, 60.6], [28.8, 60.6], [28.8, 57.9], [35.0, 57.9], [35.0, 76.7], [0, 76.7]];
  const MF = M.concat([[0, 68.3], [0.4, 68.3], [0.4, 8.4], [0, 8.4]]);
  // courtyard and back walls: single windows every 3.3 m
  for (const [a, b] of lmEdges(M)) { const L = lmLen(a, b); if ((a[0] < 0.5 && b[0] < 0.5) || (Math.abs(a[1] - b[1]) < 0.01 && (a[1] < 0.01 || a[1] > 76.6)) || L < 3.3) continue;
    for (let fl = 0; fl < 4; fl++) lmRow(ops, a[0], a[1], b[0], b[1], Math.floor(L / 3.3), 1.1, DU.sill[fl], DU.sill[fl] + DU.wh, wt, winO); }
  lmBlock(K, f, { poly: MF, top: 16.9, st, trim: S, cornice: [[0, 1.1, 0.1, PLINTH], [1.1, 1.22, 0.14, PLINTH]] }, ops);
  // entablature: architrave, the frieze with the name, a deep cornice on modillions; a low attic over it
  lmBlock(K, f, { poly: M, y0: 16.9, top: 20.2, st: { tex: 2, col: WALL }, trim: S,
    cornice: [[16.9, 17.25, 0.08, TRIM], [17.25, 17.55, 0.14, TRIM], [20.2, 20.42, 0.22, TRIM], [20.42, 20.72, 0.45, TRIM], [20.72, 21.12, 1.05, TRIM], [21.12, 21.5, 1.3, sh(TRIM, 1.03)]] }, []);
  lmBlock(K, f, { poly: M, y0: 21.5, top: 22.1, st: { tex: 2, col: WALL }, roof: ROOF, roofY: 22.1 }, []);
  lmBoxL(S, f, 0, 0.42, 8.4, 68.3, 16.75, 16.9, TRIM);
  for (let v = 0.55; v < 76.3; v += 0.75) lmBoxL(S, f, -1.0, -0.45, v - 0.11, v + 0.11, 20.5, 20.72, TRIM);
  for (let u = 0.55; u < 34.2; u += 0.75) { lmBoxL(S, f, u - 0.11, u + 0.11, -1.0, -0.45, 20.5, 20.72, TRIM); lmBoxL(S, f, u - 0.11, u + 0.11, 77.15, 77.7, 20.5, 20.72, TRIM); }
  // giant pilasters with stylised Corinthian capitals
  for (let k = 1; k <= 10; k++) {
    const v = DU.v0 + k * DU.bay;
    lmBoxL(S, f, -0.12, 0.42, v - 0.86, v + 0.86, 1.1, 1.5, sh(PIL, 0.95), false);
    lmBoxL(S, f, 0, 0.42, v - 0.72, v + 0.72, 1.5, 15.05, PIL, false);
    lmBoxL(S, f, -0.05, 0.42, v - 0.77, v + 0.77, 15.05, 15.22, TRIM, false);
    lmBoxL(S, f, -0.01, 0.42, v - 0.72, v + 0.72, 15.22, 16.45, PIL, false);
    for (const [y0, vs, len] of [[15.24, [-0.46, 0, 0.46], 0.62], [15.62, [-0.24, 0.24], 0.7]]) for (const dv of vs) {   // acanthus leaves curling out
      const w0 = 0.17, w1 = 0.21, y1 = y0 + len;
      polyA(S, [at(-0.02, v + dv - w0, y0), at(-0.02, v + dv + w0, y0), at(-0.2, v + dv + w1, y1), at(-0.2, v + dv - w1, y1)], sh(TRIM, 1.04), -f[2], -0.4, -f[3]);
      polyA(S, [at(-0.2, v + dv - w1, y1), at(-0.2, v + dv + w1, y1), at(-0.32, v + dv + w1 * 0.6, y1 - 0.16), at(-0.32, v + dv - w1 * 0.6, y1 - 0.16)], sh(TRIM, 0.93), -f[2], 0.6, -f[3]);
    }
    for (const s of [-1, 1]) lmBoxL(S, f, -0.22, 0.2, v + s * 0.62 - 0.17, v + s * 0.62 + 0.17, 16.06, 16.45, sh(TRIM, 1.02));
    lmBoxL(S, f, -0.24, 0.42, v - 0.98, v + 0.98, 16.45, 16.9, TRIM);
  }
  // door cases, string courses under the windows, plaques by the doors
  for (let k = 0; k < 11; k++) {
    const v = duBay(k), a = v - DU.bay / 2 + 0.72, b = v + DU.bay / 2 - 0.72;
    for (const sl of DU.sill.slice(1)) lmBoxL(S, f, 0.3, 0.42, a, b, sl - 0.34, sl - 0.22, TRIM, false);
    if (k < 4 || k > 6) continue;
    lmBoxL(S, f, -0.14, 0.42, v - 1.22, v - 0.9, 1.1, 4.95, TRIM, false); lmBoxL(S, f, -0.14, 0.42, v + 0.9, v + 1.22, 1.1, 4.95, TRIM, false);
    lmBoxL(S, f, -0.2, 0.42, v - 1.32, v + 1.32, 4.95, 5.35, TRIM); lmBoxL(S, f, -0.32, 0.42, v - 1.45, v + 1.45, 5.35, 5.5, sh(TRIM, 1.04));
    const P = lmW(f, 0.37, v - 1.35), Q = lmW(f, 0.37, v - 1.95), F = lmWF(P, Q), t = LMT.duPlaque;
    K.det.q(F.at(0, 2.2, 0), F.at(0.6, 2.2, 0), F.at(0.6, 2.65, 0), F.at(0, 2.65, 0), [-f[2], 0, -f[3]], [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, 1);
  }
  lmSign(K, f, [-0.03, DU.mid - 9.35], [-0.03, DU.mid + 9.35], 18.27, 18.95, 'duName', 1);
  // the centrepiece of the attic: pedestal, scrolls, a medallion, the flag
  { const m = DU.mid, TR = sh(TRIM, 1.02);
    lmBoxL(S, f, 0.1, 2.6, m - 3.0, m + 3.0, 21.5, 22.5, TR); lmBoxL(S, f, 0.0, 2.7, m - 3.1, m + 3.1, 22.5, 22.62, TR);
    lmBoxL(S, f, 0.3, 2.0, m - 1.3, m + 1.3, 22.62, 23.6, TR); lmBoxL(S, f, 0.18, 2.12, m - 1.45, m + 1.45, 23.6, 23.82, TR);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const a = (i + 1) / 5 * Math.PI / 2, r = 1.25; lmBoxL(S, f, 0.4, 1.9, m + s * (1.3 + r * (1 - Math.sin(a))) - 0.13, m + s * (1.3 + r * (1 - Math.sin(a))) + 0.13, 22.62, 22.62 + r * (1 - Math.cos(a)) + 0.12, TR); }
    lmDisc(S, at(0.27, m, 23.1), 0.42, [-f[3], 0, f[2]], [0, 1, 0], sh(TRIM, 1.08), [-f[2], 0, -f[3]]);
    const [x, z] = lmW(f, 1.2, m); lmFlag(G, x, z, 23.82, 29.6, [-f[3], f[2]]); }
  for (const [u, v, w, h] of [[8, 20, 3, 1.2], [24, 6, 2.4, 1.6], [24, 70, 2.4, 1.6], [9, 60, 3.6, 1.0]]) lmBoxL(G, f, u - w / 2, u + w / 2, v - w / 2, v + w / 2, 22.1, 22.1 + h, hb('#8d9091'));
  // granite steps and landing in front of the three doors, cheek walls
  const GS = K.stone, v0 = 29.2, v1 = 47.5;
  const rect = (u0, u1, a, b) => Float32Array.from([lmW(f, u0, a), lmW(f, u1, a), lmW(f, u1, b), lmW(f, u0, b)].flat());
  lmBoxL(GS, f, -2.6, 0.4, v0, v1, 0, 1.08, STEP, false); walkSlab(rect(-2.6, 0.4, v0, v1), 1.08);   // the landing
  for (let k = 0; k < 6; k++) { lmBoxL(GS, f, -2.6 - 0.35 * (6 - k), -2.58, v0, v1, k * 0.18, (k + 1) * 0.18, sh(STEP, 0.96 + (k % 2) * 0.05), false); walkSlab(rect(-2.6 - 0.35 * (6 - k), -2.58, v0, v1), (k + 1) * 0.18); }   // each tread a step
  for (const [a, b] of [[v0 - 0.5, v0], [v1, v1 + 0.5]]) lmBoxL(GS, f, -4.9, 0.4, a, b, 0, 1.35, GRAN);
  { const s0 = lmW(f, -4.9, v0 - 0.5), s1 = lmW(f, -4.9, v1 + 0.5), s2 = lmW(f, 0, v0 - 0.5), s3 = lmW(f, 0, v1 + 0.5);
    COL.add(s0[0], s0[1], s1[0], s1[1], 0, 0); COL.add(s0[0], s0[1], s2[0], s2[1], 0, 0); COL.add(s1[0], s1[1], s3[0], s3[1], 0, 0); }
  // a row of columnar thujas along the façade
  for (let v = 1.6; v < 75.5; v += 2.72) { if (v > v0 - 1.4 && v < v1 + 1.4) continue; const [x, z] = lmW(f, -1.7, v), s = 0.85 + lr() * 0.3, c = sh(hb('#36572f'), 0.85 + lr() * 0.3);
    lmLathe(G, x, z, 0, [[0.06, 0], [0.4 * s, 0.25], [0.52 * s, 1.0 * s], [0.46 * s, 2.0 * s], [0.3 * s, 2.9 * s], [0.12 * s, 3.5 * s], [0, 3.85 * s]], 8, c); }
  // the bust of Rainis (1967) on a red granite pedestal
  { const [x, z] = lmW(f, -12, DU.mid), BRONZE = hb('#3c352b');
    lmBoxL(GS, f, -12.55, -11.45, DU.mid - 0.55, DU.mid + 0.55, 0, 0.3, GRAN); lmBoxL(GS, f, -12.4, -11.6, DU.mid - 0.4, DU.mid + 0.4, 0.3, 2.35, hb('#6a514a'));
    lmLathe(G, x, z, 2.35, [[0, 0], [0.36, 0.02], [0.42, 0.22], [0.32, 0.42], [0.13, 0.52], [0.1, 0.62]], 10, BRONZE); lmLathe(G, x, z, 2.86, sphereProf(0.17), 10, BRONZE);
    COL.add(...lmW(f, -12.6, DU.mid - 0.6), ...lmW(f, -11.4, DU.mid - 0.6), 0, 0); COL.add(...lmW(f, -11.4, DU.mid - 0.6), ...lmW(f, -11.4, DU.mid + 0.6), 0, 0); COL.add(...lmW(f, -11.4, DU.mid + 0.6), ...lmW(f, -12.6, DU.mid + 0.6), 0, 0); COL.add(...lmW(f, -12.6, DU.mid + 0.6), ...lmW(f, -12.6, DU.mid - 0.6), 0, 0); }
}

/* ---- New building, Parādes iela 1 (1980s), by the Dubrovin park ----
   Frame p1: u along the north-east wing, v along the south-west wing towards Parādes iela. The plan follows the
   cadastre outline and the floor plans on the university's signboard (du.lv): five-storey corridor wings, one of them
   at 45°, clad in beige ceramic-tile panels under a low asbestos-cement roof, with red-brick stair towers; inside the
   angle two-storey red-brick blocks (lobby, library, concert hall, gym) with white-framed ribbon windows, a brick
   lattice, a colonnade and the entrance under the steel letters; a one-storey block of raked lecture halls on the
   outer corner. Photographs: Wikimedia Commons (panoramio), du.lv. */
const P1 = {
  slab: [[13.5, 94], [13.5, 53.5], [49.5, 17.5], [90, 17.5], [90, 33.4], [75.7, 33.4], [56.2, 33.4], [29.5, 60.1], [29.5, 73.8], [29.5, 94]],
  endV: [[13.5, 94], [29.5, 94], [29.5, 111.5], [26.2, 114.7], [13.5, 102]],
  endH: [[90, 17.5], [96.1, 17.5], [110.2, 31.6], [108.4, 33.4], [90, 33.4]],
  stA: [[55.5, 30], [61.5, 30], [61.5, 37], [55.5, 37]], stB: [[26, 59.5], [33, 59.5], [33, 65.5], [26, 65.5]],
  lobby: [[29.5, 60.1], [56.2, 33.4], [75.7, 33.4], [75.7, 41.5], [78.7, 44.2], [78.7, 68.8], [76.0, 71.2], [61.3, 73.7], [29.5, 73.8]],
  lib: [[61.3, 73.7], [76.0, 71.2], [89.6, 84.6], [78.3, 90.5]],
  ent: [[78.3, 90.5], [89.6, 84.6], [103.6, 84.4], [103.7, 95.2], [103.7, 96.9], [92.3, 96.9], [85.6, 90.7]],
  gym: [[103.5, 43.9], [116.2, 43.7], [116.4, 85.0], [114.2, 84.8], [103.7, 95.2], [103.6, 84.4]],
  halls: [[13.8, 52.9], [6.4, 44.9], [6.4, 41.4], [8.8, 38.8], [5.1, 35.6], [5.5, 30.9], [11.8, 24.5], [11.6, 21.1], [16.2, 15.8], [20.3, 16.0], [26.4, 9.7], [31.0, 9.5], [34.7, 12.8], [36.6, 11.0], [40.0, 10.3], [48.4, 18.6]],
  concert: [[56, 40], [73, 40], [73, 58], [56, 58]],
  H: { slab: 16.8, tower: 18.8, low: 8.2, ent: 10.8, gym: 10.2, halls: 6.6, concert: 11.8 }
};
function lmDUParades(K) {
  const f = LMF.p1, ops = [], G = K.plain, H = P1.H;
  const BEIGE = hb('#cfbd95'), BRICK = [246, 240, 234], WHITE = hb('#e9e7e1'), BASE = hb('#9d9a94'), ROOFC = hb('#8a8d8f'), FLAT = hb('#57595c');
  const slabSt = { tex: 4, col: BEIGE, plinth: 0.55, pcol: BASE }, brick = { tex: 3, col: BRICK };
  const ribT = () => lr() < 0.25 ? 'p1WinB' : 'p1Win', ribO = () => ({ d: 0.14, lit: lmLit(0.45) });
  const brickTrim = top => [[0, 0.35, 0.04, BASE], [top - 0.22, top, 0.06, WHITE]];
  // the corridor wings: a window every 3 m on each of five floors, only above the low blocks where these adjoin
  const slabFoot = lmFoot([[[13.5, 53.5], [49.5, 17.5], H.halls], [[75.7, 33.4], [56.2, 33.4], H.low], [[56.2, 33.4], [29.5, 60.1], H.low], [[29.5, 60.1], [29.5, 73.8], H.low],
    [[29.5, 94], [13.5, 94], 99], [[90, 17.5], [90, 33.4], 99]]);
  for (const [a, b] of lmEdges(P1.slab)) {
    const L = lmLen(a, b), y0 = slabFoot(a, b, 0); if (y0 > 50 || L < 3) continue;
    for (let fl = 0; fl < 5; fl++) { const sl = 0.95 + 3.3 * fl; if (sl < y0 + 0.4) continue; lmRow(ops, a[0], a[1], b[0], b[1], Math.floor(L / 3), 1.8, sl, sl + 1.45, () => lr() < 0.2 ? 'p1SlabB' : 'p1Slab', () => ({ d: 0.2, sill: WHITE, lit: lmLit(0.4) })); }
  }
  lmBlock(K, f, { poly: P1.slab, top: H.slab, st: slabSt, wy0: slabFoot, cornice: [[H.slab - 0.32, H.slab, 0.45, hb('#d6d4ce')]] }, ops);
  // roof: one low-pitched surface over the bent corridor, mitred at the bends, gables against the end towers
  { const C = [[21.5, 94], [21.5, 56.8], [52.85, 25.45], [90, 25.45]], hw = 8.45, yE = H.slab, yR = H.slab + 1.25, n = [], off = [];
    for (let i = 0; i < C.length - 1; i++) { const L = lmLen(C[i], C[i + 1]); n.push([(C[i + 1][1] - C[i][1]) / L, -(C[i + 1][0] - C[i][0]) / L]); }
    C.forEach((p, i) => { const a = n[Math.max(0, i - 1)], b = n[Math.min(n.length - 1, i)], m = [a[0] + b[0], a[1] + b[1]], ml = Math.hypot(...m), k = hw / ((m[0] / ml) * a[0] + (m[1] / ml) * a[1]);
      off.push([[p[0] + m[0] / ml * k, p[1] + m[1] / ml * k], [p[0] - m[0] / ml * k, p[1] - m[1] / ml * k]]); });
    const W = (q, y) => { const w = lmW(f, q[0], q[1]); return [w[0], y, w[1]]; };
    for (let i = 0; i < C.length - 1; i++) for (const sdx of [0, 1]) polyA(G, [W(off[i][sdx], yE), W(off[i + 1][sdx], yE), W(C[i + 1], yR), W(C[i], yR)], sh(ROOFC, sdx ? 0.97 : 1.02), 0, 1, 0);
    for (const i of [0, C.length - 1]) polyA(G, [W(off[i][0], yE), W(off[i][1], yE), W(C[i], yR)], BEIGE, 0, 0, 1), polyA(G, [W(off[i][0], yE), W(off[i][1], yE), W(C[i], yR)], BEIGE, 0, 0, -1);
    // a satellite dish behind the stair tower
    const d = W([64, 20.6], 17.35); lmBar(G, d, [d[0], d[1] + 1.4, d[2]], 0.08, hb('#9a9c9e'));
    const vv = [-f[3], f[2]], dn = [vv[0] * 0.7, 0.7, vv[1] * 0.7]; lmDisc(G, [d[0], d[1] + 1.6, d[2]], 1.25, [f[2], 0, f[3]], [vv[0] * 0.7, -0.7, vv[1] * 0.7], hb('#eceeee'), dn); }
  // red-brick towers: stairs at both ends of the wings and in the inner corners of the bend
  const endFoot = lmFoot([[[13.5, 94], [29.5, 94], H.slab], [[90, 17.5], [90, 33.4], H.slab]]);
  for (const [poly, cut, inner] of [[P1.endV, [[13.5, 102], [26.2, 114.7]], [[29.5, 94], [29.5, 111.5]]], [P1.endH, [[96.1, 17.5], [110.2, 31.6]], [[108.4, 33.4], [90, 33.4]]]]) {
    const o = [];
    for (let fl = 1; fl < 5; fl++) { const p = lmAlong(cut[0], cut[1], lmLen(cut[0], cut[1]) * 0.72); lmOp(o, p[0], p[1], 0.9, 1.5 + 3.3 * fl, 2.4 + 3.3 * fl, 'p1Small', { d: 0.2, lit: lmLit(0.3) }); }
    for (let fl = 0; fl < 5; fl++) { const p = lmAlong(inner[0], inner[1], lmLen(inner[0], inner[1]) / 2); lmOp(o, p[0], p[1], 1.3, 1.9 + 3.3 * fl, 4.6 + 3.3 * fl, 'p1Tall', { d: 0.2, lit: lmLit(0.6) }); }
    lmBlock(K, f, { poly, top: H.tower, st: brick, wy0: endFoot, cornice: brickTrim(H.tower), roof: FLAT, roofY: H.tower }, o);
  }
  { const o = []; for (const y of [9.6, 13.0]) { lmOp(o, 58.5, 37, 1.3, y, y + 2.7, 'p1Tall', { d: 0.2, lit: lmLit(0.6) }); lmOp(o, 33, 62.5, 1.3, y, y + 2.7, 'p1Tall', { d: 0.2, lit: lmLit(0.6) }); }
    for (const poly of [P1.stA, P1.stB]) lmBlock(K, f, { poly, y0: H.low, top: H.tower, st: brick, cornice: brickTrim(H.tower), roof: FLAT, roofY: H.tower }, o); }
  { const [x, z] = lmW(f, 20, 108); lmBar(G, [x, H.tower, z], [x, H.tower + 4.5, z], 0.1, hb('#b9bcbe')); lmBar(G, [x - 0.6, H.tower + 3.6, z], [x + 0.6, H.tower + 3.6, z], 0.05, hb('#b9bcbe')); }
  // lobby block on the inside of the bend: the ribbon façade with the brick lattice towards Parādes iela
  const low = [];
  const sills = (a, b, inside, spans, y) => { for (const [s0, s1] of spans) lmEdgeBox(G, f, a, b, inside, s0 - 0.1, s1 + 0.1, y - 0.24, y, -0.1, 0.07, WHITE); };
  { const a = [29.5, 73.8], b = [61.3, 73.7], c = [50, 60];
    lmOp(low, 31.7, 73.793, 3.6, 1.5, 5.7, 'p1Lat', { d: 0.16, lit: lmLit(0.3) });
    for (const y of [1.0, 4.55]) sills(a, b, c, lmRibbons(low, a, b, 5.3, 31.2, y, y + 1.45, ribT, ribO), y);
    const a2 = [78.7, 44.2], b2 = [78.7, 68.8]; for (const y of [1.0, 4.55]) sills(a2, b2, c, lmRibbons(low, a2, b2, 1.0, 23.6, y, y + 1.45, ribT, ribO), y); }
  lmBlock(K, f, { poly: P1.lobby, top: H.low, st: brick, roof: FLAT, roofY: H.low, cornice: brickTrim(H.low),
    wy0: lmFoot([[[29.5, 60.1], [56.2, 33.4], 99], [[56.2, 33.4], [75.7, 33.4], 99], [[29.5, 73.8], [29.5, 60.1], 99], [[76.0, 71.2], [61.3, 73.7], 99]]) }, low);
  lmBlock(K, f, { poly: P1.concert, y0: H.low, top: H.concert, st: brick, roof: FLAT, roofY: H.concert, cornice: [[H.concert - 0.22, H.concert, 0.06, WHITE]] }, []);
  // library wing: the upper floor carried over a colonnade on its south-west side
  { const [A, B, Cc, D] = P1.lib, L = lmLen(D, A), t = [(D[0] - A[0]) / L, (D[1] - A[1]) / L], nIn = [t[1], -t[0]], A2 = [A[0] + nIn[0] * 2.6, A[1] + nIn[1] * 2.6], D2 = [D[0] + nIn[0] * 2.6, D[1] + nIn[1] * 2.6];
    const pA = lmIsect(A2, D2, A, B), pD = lmIsect(A2, D2, D, Cc), lib = [];
    for (const y of [1.0, 4.55]) sills(B, Cc, A, lmRibbons(lib, B, Cc, 0.8, lmLen(B, Cc) - 0.8, y, y + 1.45, ribT, ribO), y);
    sills(D, A, B, lmRibbons(lib, D, A, 1.0, L - 1.0, 4.55, 6.0, ribT, ribO), 4.55);
    lmRibbons(lib, pD, pA, 1.0, lmLen(pD, pA) - 4.0, 1.0, 2.45, ribT, ribO);
    { const p = lmAlong(pD, pA, lmLen(pD, pA) - 2.2); lmOp(lib, p[0], p[1], 3.0, 0, 3.0, 'p1Door', { d: 0.15, lit: true }); }
    const libFoot = lmFoot([[A, B, 99], [Cc, D, 99]]);
    lmBlock(K, f, { poly: [pA, B, Cc, pD], top: 3.6, st: brick, wy0: libFoot, cornice: [[0, 0.35, 0.04, BASE]] }, lib);
    lmBlock(K, f, { poly: P1.lib, y0: 3.6, top: H.low, st: brick, wy0: libFoot, roof: FLAT, roofY: H.low, cornice: [[H.low - 0.22, H.low, 0.06, WHITE]] }, lib);
    flatPlain(G, [[...lmW(f, A[0], A[1]), ...lmW(f, pA[0], pA[1]), ...lmW(f, pD[0], pD[1]), ...lmW(f, D[0], D[1])]].map(r => { const q = new Float32Array(r); return area2(q) > 0 ? q : reversed(q); }), 3.6, sh(WHITE, 0.9), true);
    lmEdgeBox(G, f, D, A, B, 0, L, 3.3, 3.75, -0.4, 0.07, WHITE);
    lmWallTo(K, f, A, pA, D, 0, 3.6, [], brick); lmWallTo(K, f, D, pD, A, 0, 3.6, [], brick);   // close the ends of the colonnade
    for (let s = 0.4; s < L - 0.2; s += (L - 0.8) / 7) { const c = lmAlong(D, A, s), q = (du, dv) => [c[0] + t[0] * du + nIn[0] * dv, c[1] + t[1] * du + nIn[1] * dv];
      lmBlock(K, f, { poly: [q(-0.3, 0.05), q(0.3, 0.05), q(0.3, 0.65), q(-0.3, 0.65)], top: 3.3, st: brick }, []); } }
  // the entrance block: a deep porch under the steel letters, glazed doors at its back and on the angled side
  { const ent = [], a = [92.3, 96.9], b = [103.7, 96.9], c = [95, 88];
    lmOp(ent, 98.0, 96.9, 9.6, 0, 3.6, null, { d: 3.4, noFloor: true });
    { const p = lmAlong([85.6, 90.7], [92.3, 96.9], 4.55); lmOp(ent, p[0], p[1], 3.0, 0, 3.0, 'p1Door', { d: 0.2, lit: true }); }
    sills([85.6, 90.7], [92.3, 96.9], c, lmRibbons(ent, [85.6, 90.7], [92.3, 96.9], 0.5, 8.6, 4.55, 6.0, ribT, ribO, 4), 4.55);
    for (const y of [1.0, 4.55]) sills([78.3, 90.5], [85.6, 90.7], c, lmRibbons(ent, [78.3, 90.5], [85.6, 90.7], 0.4, 6.9, y, y + 1.45, ribT, ribO, 4), y);
    lmBlock(K, f, { poly: P1.ent, top: H.ent, st: brick, roof: FLAT, roofY: H.ent, cornice: brickTrim(H.ent), wy0: lmFoot([[[78.3, 90.5], [89.6, 84.6], H.low], [[103.6, 84.4], [103.7, 95.2], H.gym]]) }, ent);
    const back = []; for (const u of [96.3, 99.7]) lmOp(back, u, 93.5, 3.0, 0, 3.0, 'p1Door', { d: 0.15, lit: true });
    lmWallTo(K, f, [93.2, 93.5], [102.8, 93.5], [98, 99], 0, 3.6, back, brick);
    lmEdgeBox(G, f, a, b, c, 0.75, 10.65, 3.6, 4.15, -0.3, 0.07, WHITE);
    for (const u of [95.4, 100.6]) lmBlock(K, f, { poly: [[u - 0.3, 94.9], [u + 0.3, 94.9], [u + 0.3, 95.5], [u - 0.3, 95.5]], top: 3.6, st: brick }, []);
    lmSign(K, f, [93.3, 96.93], [102.7, 96.93], 6.3, 8.88, 'p1Name', 1);
    for (const u of [94.5, 98, 101.5]) { lmEdgeBox(G, f, a, b, c, u - 92.3 - 0.08, u - 92.3 + 0.08, 9.2, 9.32, -0.05, 0.55, hb('#3a3d40')); lmEdgeBox(G, f, a, b, c, u - 92.3 - 0.12, u - 92.3 + 0.12, 9.08, 9.32, 0.5, 0.7, hb('#2c2f32')); } }
  // gym and lecture halls: blank brick
  lmBlock(K, f, { poly: P1.gym, top: H.gym, st: brick, roof: FLAT, roofY: H.gym, cornice: brickTrim(H.gym), wy0: lmFoot([[[103.6, 84.4], [103.7, 95.2], 99]]) }, []);
  { const o = []; for (const [a, b] of lmEdges(P1.halls)) { const L = lmLen(a, b); if (L > 6 && !(lmNear(a, [48.4, 18.6]) && lmNear(b, [13.8, 52.9]))) lmRibbons(o, a, b, 1.0, L - 1.0, 3.9, 5.35, ribT, ribO, 3); }
    lmBlock(K, f, { poly: P1.halls, top: H.halls, st: brick, roof: FLAT, roofY: H.halls, cornice: brickTrim(H.halls), wy0: lmFoot([[[48.4, 18.6], [13.8, 52.9], 99]]) }, o); }
  // the flag over the lobby roof
  { const [x, z] = lmW(f, 70, 63); lmFlag(G, x, z, H.low, 24.5, [f[2], f[3]], 2.4); }
}

/* ---- Laboratory building, Parādes iela 1A ----
   Dabaszinātņu un inženierzinātņu laboratoriju korpuss by SIA "Nams", opened in August 2014 (archidea.lv,
   Gada labākā būve Latvijā 2014): 3568 m² footprint, two storeys, 28 573 m³. White three-layer precast panels with a
   high ribbon window below, a Schüco FW50+ curtain wall above with dark horizontal louvres on the sunny sides, a
   white entrance volume cantilevered over the door, a glass atrium, plant on the roof; a glazed bridge to the old
   corner of Parādes iela 1. Same frame p1. */
const LAB = [[33.7, -4.0], [16.9, 0.3], [14.8, -8.8], [28.7, -12.3], [-40.9, -33.1], [-37.0, -45.9], [25.1, -26.9], [17.2, -38.9], [26.3, -45.1], [39.8, -24.5], [40.7, -43.7], [52.3, -42.9], [51.8, -27.3], [112.0, -25.3], [111.4, -11.7], [102.0, -11.8], [103.3, -6.9], [98.9, 7.6], [97.5, 8.8], [62.8, -2.3], [44.4, 2.5], [39.6, -5.4]];
function lmDULab(K) {
  const f = LMF.p1, ops = [], G = K.plain, WH = hb('#eceeed'), DARK = hb('#3b4044'), LOUV = hb('#33383c');
  const white = { tex: 5, col: WH, plinth: 0.3, pcol: hb('#7d8083') };
  const cw = () => lr() < 0.18 ? 'labCWo' : 'labCW', cwO = () => ({ d: 0.03, lit: lmLit(0.55) });
  const E1 = [-40.9, -33.1], E2 = [-37.0, -45.9], ta = [0.9582, 0.2863], out = (p, d) => [p[0] - ta[0] * d, p[1] - ta[1] * d];
  for (const [a, b] of lmEdges(LAB)) {
    const L = lmLen(a, b); if (L < 2.5 || (lmNear(a, E1) && lmNear(b, E2))) continue;
    if (L > 4.4) lmStrip(ops, a, b, 1.0, L - 1.0, 1.5, 2.35, 3.4, 'labRib', () => ({ d: 0.12, lit: lmLit(0.6) }));
    lmStrip(ops, a, b, 0, L, 1.4, 4.4, 8.1, cw, cwO);
    // louvres on the faces the sun reaches (south and west)
    const n = lmOut(LAB, a, b), nw = [n[0] * f[2] - n[1] * f[3], n[0] * f[3] + n[1] * f[2]];
    if (L > 6 && (nw[1] > 0.3 || nw[0] < -0.6)) { const ins = [(a[0] + b[0]) / 2 - n[0], (a[1] + b[1]) / 2 - n[1]];
      for (let y = 4.75; y < 7.95; y += 0.32) lmEdgeBox(G, f, a, b, ins, 0.35, L - 0.35, y, y + 0.05, 0.42, 0.72, LOUV);
      for (let s = 0.35; s <= L - 0.3; s += (L - 0.7) / Math.max(1, Math.round((L - 0.7) / 2.8))) lmEdgeBox(G, f, a, b, ins, s - 0.03, s + 0.03, 4.45, 8.05, 0.03, 0.74, LOUV); }
  }
  lmBlock(K, f, { poly: LAB, top: 8.4, st: white, roof: hb('#6a6d70'), roofY: 8.4, cornice: [[4.1, 4.4, 0.06, DARK], [8.1, 8.4, 0.1, DARK]], wy0: lmFoot([[E1, E2, 99]]) }, ops);
  // the white entrance volume at the end of the west wing, cantilevered 4.5 m over the doors
  { const F1 = out(E1, 9), F2 = out(E2, 9), G1 = out(E1, 4.5), G2 = out(E2, 4.5), o = [];
    for (const [a, b] of [[E2, F2], [F1, E1]]) { const p = lmAlong(a, b, 5.2); lmOp(o, p[0], p[1], 6.0, 5.8, 7.2, 'labBox', { d: 0.25, lit: lmLit(0.6) }); }
    { const p = lmAlong(G1, G2, lmLen(G1, G2) / 2); lmOp(o, p[0], p[1], 2.4, 0, 3.0, 'labDoor', { d: 0.15, lit: true }); }
    lmBlock(K, f, { poly: [E1, E2, G2, G1], top: 3.6, st: white, wy0: lmFoot([[E1, E2, 99]]) }, o);
    lmBlock(K, f, { poly: [E1, E2, F2, F1], y0: 3.6, top: 10.4, st: { tex: 5, col: WH }, roof: hb('#6a6d70'), roofY: 10.4, cornice: [[10.15, 10.4, 0.05, hb('#d9dbdb')]], wy0: lmFoot([[E1, E2, 8.4]]) }, o);
    flatPlain(G, [new Float32Array([...lmW(f, ...G1), ...lmW(f, ...G2), ...lmW(f, ...F2), ...lmW(f, ...F1)])].map(q => area2(q) > 0 ? q : reversed(q)), 3.6, sh(WH, 0.86), true); }
  // glass atrium over the junction of the wings, plant on the roof with its ladder
  { const at = [[24, -24], [34, -24], [34, -14], [24, -14]], o = []; for (const [a, b] of lmEdges(at)) lmStrip(o, a, b, 0, 10, 1.4, 8.45, 10.75, 'labGl', { d: 0.03, lit: lmLit(0.5) });
    lmBlock(K, f, { poly: at, y0: 8.4, top: 10.8, st: white, roof: hb('#c9cccd'), roofY: 10.8, cornice: [[10.6, 10.8, 0.06, DARK]] }, o); }
  { const pb = [[72, -20], [81, -20], [81, -14], [72, -14]]; lmBlock(K, f, { poly: pb, y0: 8.4, top: 10.9, st: { tex: 5, col: hb('#5b5f63') }, roof: hb('#4c5054'), roofY: 10.9 }, []);
    const L1 = lmW(f, 78.6, -13.9), L2 = lmW(f, 79.4, -13.9); for (const p of [L1, L2]) lmBar(G, [p[0], 8.4, p[1]], [p[0], 11.6, p[1]], 0.05, hb('#c8cacb'));
    for (let y = 8.7; y < 11.5; y += 0.3) lmBar(G, [L1[0], y, L1[1]], [L2[0], y, L2[1]], 0.03, hb('#c8cacb')); }
  // glazed bridge to the lecture-hall corner of Parādes iela 1
  { const br = [[36.6, 11.0], [35.3, 4.4], [33.7, -4.0], [37.1, -4.8], [38.7, 3.9], [40.0, 10.3]], o = [];
    for (const [a, b] of [[br[0], br[1]], [br[1], br[2]], [br[3], br[4]], [br[4], br[5]]]) for (const [y0, y1] of [[0.45, 3.5], [3.85, 6.95]]) lmStrip(o, a, b, 0, lmLen(a, b), 1.4, y0, y1, 'labGl', { d: 0.03, lit: lmLit(0.5) });
    lmBlock(K, f, { poly: br, top: 7.4, st: { tex: 5, col: WH }, roof: hb('#6a6d70'), roofY: 7.4, cornice: [[3.5, 3.85, 0.04, DARK], [7.0, 7.4, 0.08, DARK]], wy0: lmFoot([[br[5], br[0], 99], [br[2], br[3], 99]]) }, o); }
}

export { lmAlong, lmDULab, lmDUMain, lmDUParades, lmDisc, lmEdgeBox, lmFlag, lmFoot, lmLen, lmNear, lmPipL, lmStrip, lmWallTo };
