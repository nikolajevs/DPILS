import { FTS, FTT } from './textures.js';
import { FS, fortPoint, fortWingTop } from './ground-height.js';
import { FH, fortGates } from './index.js';
import { lmBar } from '../landmarks/helpers.js';
import { LMWS } from '../landmarks/tiles.js';
import { LMWHITE, lmL, lmW } from '../landmarks/core.js';
import { COL } from '../world/data.js';
import { polyA } from '../core/geometry.js';
import { hb, sh } from '../core/util.js';

/* ---- gates ---- */
// top of an opening at v: rect, round (elliptic if its rise differs from its half width) or pointed (two arcs)
function fortArchY(h, v) {
  const dv = Math.abs(v - h.vc); if (dv >= h.w || h.sh === 'rect') return h.ys;
  const H = h.ya - h.ys;
  if (h.sh === 'round') return h.ys + H * Math.sqrt(Math.max(0, 1 - (dv / h.w) * (dv / h.w)));
  const R = (h.w * h.w + H * H) / (2 * h.w); return h.ys + Math.sqrt(Math.max(0, R * R - (h.w - R - dv) * (h.w - R - dv)));
}
const fortP = (f, u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
// a flat wall in the plane u = up (facing out = ±1 along u) from v0 to v1, y0 to y1, with openings cut out
function fortWallPlane(B, f, up, out, v0, v1, y0, y1, holes, S, col) {
  const N = [f[2] * out, 0, f[3] * out], q = (P, Q, R2, T) => B.q(fortP(f, up, P[0], P[1]), fortP(f, up, Q[0], Q[1]), fortP(f, up, R2[0], R2[1]), fortP(f, up, T[0], T[1]), N,
    [P[0] / S, P[1] / S, Q[0] / S, Q[1] / S, R2[0] / S, R2[1] / S, T[0] / S, T[1] / S], col);
  let v = v0;
  for (const h of holes.slice().sort((a, b) => a.vc - b.vc)) {
    const a = h.vc - h.w, b = h.vc + h.w;
    if (a > v) q([v, y0], [a, y0], [a, y1], [v, y1]);
    if (h.yb > y0) { const t = Math.min(h.yb, y1); q([a, y0], [b, y0], [b, t], [a, t]); }
    const n = h.sh === 'rect' ? 1 : 14, lo = Math.max(y0, h.yb);
    if (h.yb < y1) for (let k = 0; k < n; k++) { const va = a + (b - a) * k / n, vb = a + (b - a) * (k + 1) / n, ya = Math.max(lo, fortArchY(h, va)), yb = Math.max(lo, fortArchY(h, vb)); if (ya < y1 || yb < y1) q([va, Math.min(ya, y1)], [vb, Math.min(yb, y1)], [vb, y1], [va, y1]); }
    v = b;
  }
  if (v1 > v) q([v, y0], [v1, y0], [v1, y1], [v, y1]);
}
// an arch ring between two curves, from the plane uf (front, out of the wall by out) back to ub
function fortArchRing(B, f, uf, ub, out, hin, hout, S, col, n = 16) {
  const at = (h, t) => { const v = h.vc - h.w + 2 * h.w * t; return [v, fortArchY(h, v)]; }, N = [f[2] * out, 0, f[3] * out];
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n, i0 = at(hin, t0), i1 = at(hin, t1), o0 = at(hout, t0), o1 = at(hout, t1);
    B.q(fortP(f, uf, i0[0], i0[1]), fortP(f, uf, i1[0], i1[1]), fortP(f, uf, o1[0], o1[1]), fortP(f, uf, o0[0], o0[1]), N, [i0[0] / S, i0[1] / S, i1[0] / S, i1[1] / S, o1[0] / S, o1[1] / S, o0[0] / S, o0[1] / S], col);
    // intrados, facing down and in
    const mx = (i0[0] + i1[0]) / 2 - hin.vc, ny = -1, cn = [-mx, ny]; const l = Math.hypot(cn[0], cn[1]) || 1, w0 = lmW(f, 0, 0), wv = lmW(f, 0, 1), ev = [wv[0] - w0[0], wv[1] - w0[1]];
    B.q(fortP(f, uf, i0[0], i0[1]), fortP(f, ub, i0[0], i0[1]), fortP(f, ub, i1[0], i1[1]), fortP(f, uf, i1[0], i1[1]), [ev[0] * cn[0] / l, cn[1] / l, ev[1] * cn[0] / l], [0, i0[1] / S, (ub - uf) / S, i0[1] / S, (ub - uf) / S, i1[1] / S, 0, i1[1] / S], sh(col, 0.85));
    const ox = (o0[0] + o1[0]) / 2 - hout.vc, on = [ox, 1], ol = Math.hypot(on[0], on[1]);
    B.q(fortP(f, uf, o0[0], o0[1]), fortP(f, uf, o1[0], o1[1]), fortP(f, ub, o1[0], o1[1]), fortP(f, ub, o0[0], o0[1]), [ev[0] * on[0] / ol, on[1] / ol, ev[1] * on[0] / ol], [0, o0[1] / S, (ub - uf) / S, o0[1] / S, (ub - uf) / S, o1[1] / S, 0, o1[1] / S], sh(col, 0.95));
  }
}
// box in the gate frame with a texture on its faces
function fortTBox(B, f, u0, u1, v0, v1, y0, y1, S, col, faces = 'nsewt') {
  const P = (u, v, y) => fortP(f, u, v, y), ex = f[2], ez = f[3], uv = (a, b, c, d) => [a / S, b / S, c / S, b / S, c / S, d / S, a / S, d / S];
  if (faces.includes('w')) B.q(P(u0, v0, y0), P(u0, v1, y0), P(u0, v1, y1), P(u0, v0, y1), [-ex, 0, -ez], uv(v0, y0, v1, y1), col);
  if (faces.includes('e')) B.q(P(u1, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u1, v0, y1), [ex, 0, ez], uv(v0, y0, v1, y1), col);
  if (faces.includes('n')) B.q(P(u0, v0, y0), P(u1, v0, y0), P(u1, v0, y1), P(u0, v0, y1), [ez, 0, -ex], uv(u0, y0, u1, y1), sh(col, 0.92));
  if (faces.includes('s')) B.q(P(u0, v1, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v1, y1), [-ez, 0, ex], uv(u0, y0, u1, y1), sh(col, 0.92));
  if (faces.includes('t')) B.q(P(u0, v0, y1), P(u1, v0, y1), P(u1, v1, y1), P(u0, v1, y1), [0, 1, 0], uv(u0, v0, u1, v1), sh(col, 1.05));
  if (faces.includes('b')) B.q(P(u0, v0, y0), P(u1, v0, y0), P(u1, v1, y0), P(u0, v1, y0), [0, -1, 0], uv(u0, v0, u1, v1), sh(col, 0.7));
}
// a flat sprite or tile on the plane u = up facing out; left/right as seen by the viewer
function fortTile(B, f, up, out, vA, vB, y0, y1, t, lit = 0, col = LMWHITE) {
  const vl = out < 0 ? Math.min(vA, vB) : Math.max(vA, vB), vr = out < 0 ? Math.max(vA, vB) : Math.min(vA, vB), N = [f[2] * out, 0, f[3] * out];
  B.q(fortP(f, up, vl, y0), fortP(f, up, vr, y0), fortP(f, up, vr, y1), fortP(f, up, vl, y1), N, [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], col, lit);
}
// the vaulted passage through a gate block
function fortPassage(K, g, pw, ys, wallB, S, vaultB = K.brk, VS = LMWS[3]) {
  const f = g.f, a = g.a, a2 = g.a2, P = (u, v, y) => fortP(f, u, v, y), ex = f[2], ez = f[3];
  for (const s of [-1, 1]) wallB.q(P(-a, s * pw, FH.floor), P(a2, s * pw, FH.floor), P(a2, s * pw, ys), P(-a, s * pw, ys), [-s * -ez, 0, -s * ex], [-a / S, 0, a2 / S, 0, a2 / S, ys / S, -a / S, ys / S], [214, 208, 200]);
  const n = 14, rise = pw;
  for (let k = 0; k < n; k++) {
    const t0 = Math.PI * k / n, t1 = Math.PI * (k + 1) / n, v0 = -pw * Math.cos(t0), v1 = -pw * Math.cos(t1), y0 = ys + rise * Math.sin(t0), y1 = ys + rise * Math.sin(t1), tm = (t0 + t1) / 2;
    const nv = Math.cos(tm), ny = -Math.sin(tm);   // towards the axis of the vault
    const L0 = k * Math.PI * pw / n, L1 = (k + 1) * Math.PI * pw / n;
    vaultB.q(P(-a, v0, y0), P(a2, v0, y0), P(a2, v1, y1), P(-a, v1, y1), [-ez * nv, ny, ex * nv], [-a / VS, L0 / VS, a2 / VS, L0 / VS, a2 / VS, L1 / VS, -a / VS, L1 / VS], [200, 192, 186]);
  }
  polyA(K.cap, [P(-a, -pw, FH.floor), P(a2, -pw, FH.floor), P(a2, pw, FH.floor), P(-a, pw, FH.floor)], hb('#6f6a63'), 0, 1, 0);
  for (const s of [-1, 1]) COL.add(...lmW(f, -a, s * (pw - 0.05)), ...lmW(f, a2, s * (pw - 0.05)), 0.1, 0);
}
// the block over a passage: earth on top, fieldstone sides, end walls set back behind the façades (ins: [outer, inner])
function fortBlock(K, g, top, pw, ys, ins) {
  const f = g.f, a = g.a, a2 = g.a2, b = g.b;
  fortTBox(K.rub, f, -a, a2, -b - 0.6, b + 0.6, -0.5, top, FTS[0], [190, 186, 180], 'ns');
  for (const s of [-1, 1]) fortWallPlane(K.rub, f, s < 0 ? -a + ins[0] : a2 - ins[1], s, -b - 0.6, b + 0.6, -0.5, top, [{ vc: 0, w: pw, ys, ya: ys + pw, sh: 'round', yb: -0.5 }], FTS[0], [190, 186, 180]);
  const P = (u, v, y) => fortP(f, u, v, y); polyA(K.cap, [P(-a - 0.2, -b - 1.6, top), P(a2 + 0.2, -b - 1.6, top), P(a2 + 0.2, b + 1.6, top), P(-a - 0.2, b + 1.6, top)], hb('#6f8a48'), 0, 1, 0);
}
// a lictor's axe in steel: two crescent blades on a staff
function fortAxe(G, f, u, v, y0, out) {
  const STEEL = hb('#b9bcbe'), A = fortP(f, u + out * 0.12, v, y0), B2 = fortP(f, u + out * 0.12, v, y0 + 2.3); lmBar(G, A, B2, 0.11, STEEL); lmBar(G, B2, fortP(f, u + out * 0.12, v, y0 + 2.55), 0.06, STEEL);
  for (const s of [-1, 1]) { const c = fortP(f, u + out * 0.12, v + s * 0.32, y0 + 2.0); lmBar(G, fortP(f, u + out * 0.12, v + s * 0.06, y0 + 2.0), c, 0.22, STEEL); lmBar(G, fortP(f, u + out * 0.12, v + s * 0.4, y0 + 1.72), fortP(f, u + out * 0.12, v + s * 0.4, y0 + 2.28), 0.1, STEEL); }
}

function fortNicholas(K, g) {
  const f = g.f, a = g.a, pw = 2.25, G = K.cap, GR = [172, 171, 166], BR = [238, 210, 202], WH = hb('#ebe3d6');
  fortPassage(K, g, pw, 3.6, K.brk, LMWS[3]); fortBlock(K, g, 6.4, pw, 3.6, [0.65, 0.45]);
  // outer façade (towards the moat and the bridge), u = -a, facing -u
  const uo = -a, O = -1;
  fortWallPlane(K.rub, f, uo, O, -13, 13, -4.6, 0, [], FTS[0], [196, 192, 186]);
  fortWallPlane(K.brk, f, uo, O, -11.3, 11.3, 0, 8.6, [{ vc: 0, w: 2.8, ys: 4.4, ya: 7.6, sh: 'pointed', yb: 0 }, { vc: -8.45, w: 1.05, ys: 5.0, ya: 6.3, sh: 'pointed', yb: 4.45 }, { vc: 8.45, w: 1.05, ys: 5.0, ya: 6.3, sh: 'pointed', yb: 4.45 }], LMWS[3], BR);
  // recessed brick round the door, with the door opening and its pointed head
  fortWallPlane(K.brk, f, uo + 0.35, O, -2.8, 2.8, 0, 7.7, [{ vc: 0, w: pw, ys: 3.6, ya: 5.9, sh: 'pointed', yb: 0 }], LMWS[3], [230, 226, 222]);
  for (const s of [-1, 1]) fortTBox(K.brk, f, uo, uo + 0.35, s > 0 ? 2.8 : -2.8, s > 0 ? 2.8 : -2.8, 0, 4.4, LMWS[3], BR, s > 0 ? 's' : 'n');
  fortArchRing(K.gra, f, uo - 0.1, uo + 0.35, O, { vc: 0, w: 2.8, ys: 4.4, ya: 7.6, sh: 'pointed' }, { vc: 0, w: 4.1, ys: 4.4, ya: 8.75, sh: 'pointed' }, FTS[1], GR);
  fortArchRing(K.gra, f, uo + 0.35, uo + 0.6, O, { vc: 0, w: pw, ys: 3.6, ya: 5.9, sh: 'pointed' }, { vc: 0, w: 2.8, ys: 3.6, ya: 6.4, sh: 'pointed' }, FTS[1], [176, 120, 100]);
  for (const s of [-1, 1]) {
    fortTBox(K.gra, f, uo - 0.1, uo, s * 2.8, s * 5.6, 0, 4.4, FTS[1], GR, 'wt');                         // granite piers either side of the arch
    fortTBox(K.gra, f, uo - 0.12, uo + 1.2, s > 0 ? 11.3 : -13, s > 0 ? 13 : -11.3, 0, 8.6, FTS[1], GR, s > 0 ? 'ws' : 'wn');   // corner piers
    fortTBox(K.gra, f, uo - 0.18, uo, s > 0 ? 4.1 : -13, s > 0 ? 13 : -4.1, 4.4, 4.62, FTS[1], GR, 'wtb');                    // string course
    const vc = s * 8.45;
    fortArchRing(K.gra, f, uo - 0.08, uo + 0.3, O, { vc, w: 1.05, ys: 5.0, ya: 6.3, sh: 'pointed' }, { vc, w: 1.95, ys: 5.0, ya: 7.35, sh: 'pointed' }, FTS[1], GR);
    fortTile(K.det, f, uo + 0.3, O, vc - 1.05, vc + 1.05, 4.45, 6.35, FTT.grille);
    fortTBox(K.gra, f, uo - 0.1, uo, vc - 1.2, vc + 1.2, 2.1, 4.0, FTS[1], GR, 'wt');                      // embrasure frame
    polyA(G, [fortP(f, uo - 0.11, vc - 0.6, 2.45), fortP(f, uo - 0.11, vc + 0.6, 2.45), fortP(f, uo - 0.11, vc + 0.6, 3.15), fortP(f, uo - 0.11, vc - 0.6, 3.15)], hb('#26292b'), -f[2], 0, -f[3]);
    for (const dv of [-2.05, 2.05]) polyA(G, [fortP(f, uo - 0.02, vc + dv - 0.32, 2.15), fortP(f, uo - 0.02, vc + dv + 0.32, 2.15), fortP(f, uo - 0.02, vc + dv + 0.32, 3.45), fortP(f, uo - 0.02, vc + dv - 0.32, 3.45)], hb('#2b2c2c'), -f[2], 0, -f[3]);
    fortTBox(K.gra, f, uo - 0.06, uo + 1.0, s > 0 ? 6.3 : -13, s > 0 ? 13 : -6.3, 8.6, 10.0, FTS[1], GR, 'wte');            // side parapets
    for (let k = 0; k <= 4; k++) { const vv = s * (6.6 + k * 1.6); lmBar(G, fortP(f, uo + 0.4, vv, 10.0), fortP(f, uo + 0.4, vv, 10.95), 0.05, hb('#3a3d40')); }
    lmBar(G, fortP(f, uo + 0.4, s * 6.6, 10.9), fortP(f, uo + 0.4, s * 13, 10.9), 0.05, hb('#3a3d40'));
    fortTile(K.cut, f, uo - 0.06, O, s * 4.0, s * 5.0, 5.4, 7.9, FTT.halberd);
  }
  // frieze with the name, corbel arcade, cornice, attic, eagle
  fortTBox(K.gra, f, uo - 0.15, uo + 1.0, -6.3, 6.3, 8.6, 9.3, FTS[1], GR, 'wnsb');
  fortTile(K.cut, f, uo - 0.16, O, -3.0, 3.0, 8.72, 9.18, FTT.nikname);
  fortTBox(K.gra, f, uo - 0.25, uo + 1.0, -6.3, 6.3, 9.3, 10.0, FTS[1], GR, 'nsb');
  fortTile(K.det, f, uo - 0.26, O, -6.3, 6.3, 9.3, 10.0, FTT.arcade);
  fortTBox(K.gra, f, uo - 0.45, uo + 1.3, -6.6, 6.6, 10.0, 10.3, FTS[1], GR);
  fortTBox(K.gra, f, uo - 0.1, uo + 1.0, -5.9, 5.9, 10.3, 11.0, FTS[1], GR, 'wnset');
  fortTBox(K.gra, f, uo - 0.05, uo + 0.9, -2.75, 2.75, 11.0, 11.7, FTS[1], GR, 'wnset');
  fortTile(K.cut, f, uo + 0.3, O, -2.6, 2.6, 11.55, 12.9, FTT.eagle); fortTile(K.cut, f, uo + 0.32, 1, -2.6, 2.6, 11.55, 12.9, FTT.eagle);
  fortTBox(K.brk, f, uo, uo + 1.2, -11.3, 11.3, 6.4, 8.6, LMWS[3], [220, 214, 210], 'e');                    // back of the façade above the block
  COL.add(...lmW(f, uo - 0.2, -13), ...lmW(f, uo - 0.2, -pw), 0.2, 0); COL.add(...lmW(f, uo - 0.2, pw), ...lmW(f, uo - 0.2, 13), 0.2, 0);

  // inner façade (towards the town), u = +a: salmon render, white stone, a Tudor arch with oak doors standing open
  const ui = g.a2, I = 1;
  fortWallPlane(K.brk, f, ui, I, -10, 10, 0, 6.5, [{ vc: 0, w: 2.75, ys: 3.2, ya: 5.2, sh: 'pointed', yb: 0 }], LMWS[3], BR);
  fortArchRing(K.ren, f, ui + 0.06, ui - 0.4, I, { vc: 0, w: 2.75, ys: 3.2, ya: 5.2, sh: 'pointed' }, { vc: 0, w: 3.1, ys: 3.2, ya: 5.6, sh: 'pointed' }, 2, WH);
  for (const s of [-1, 1]) {
    fortTile(K.det, f, ui + 0.02, I, s * 3.4, s * 9.0, 0, 6.0, FTT.bay, 0, BR);
    fortTile(K.det, f, ui + 0.02, I, s * 3.1, s * 7.1, 6.0, 6.5, FTT.corbels, 0, BR); fortTile(K.det, f, ui + 0.02, I, s * 7.1, s * 10, 6.0, 6.5, FTT.corbels, 0, BR);
    polyA(K.cap2, [fortP(f, ui + 0.03, s * 3.1, 3.12), fortP(f, ui + 0.03, s * 3.4, 3.12), fortP(f, ui + 0.03, s * 3.4, 3.3), fortP(f, ui + 0.03, s * 3.1, 3.3)], WH, f[2], 0, f[3]);
    // a door leaf folded back against the passage wall
    const vd = s * (pw - 0.06);
    const dl = (u0, u1) => { const A = fortP(f, u0, vd, FH.floor), B2 = fortP(f, u1, vd, FH.floor), C2 = fortP(f, u1, vd, 3.6), D2 = fortP(f, u0, vd, 3.6), t = FTT.door, nn = [-s * -f[3], 0, -s * f[2]];
      K.det.q(A, B2, C2, D2, nn, [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, 0); K.det.q(B2, A, D2, C2, [-nn[0], 0, -nn[2]], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, 0); };
    dl(ui - 0.4, ui - 3.0);
  }
  fortTBox(K.ren, f, ui, ui + 0.05, -10, 10, 0, 0.35, 2, hb('#7a7873'), 'et');
  fortTBox(K.ren, f, ui - 0.3, ui + 0.35, -10.3, 10.3, 6.5, 6.75, 2, WH);
  fortTBox(K.gra, f, ui - 0.6, ui + 0.05, -10, 10, 6.75, 7.25, FTS[1], GR, 'enswt');
  fortTBox(K.gra, f, ui - 0.6, ui + 0.05, -4.6, 4.6, 7.25, 7.75, FTS[1], GR, 'enswt');
  fortTile(K.cut, f, ui - 0.3, I, -2.4, 2.4, 7.4, 8.65, FTT.eagle); fortTile(K.cut, f, ui - 0.32, -1, -2.4, 2.4, 7.4, 8.65, FTT.eagle);
  fortTBox(K.brk, f, ui - 1.0, ui, -10, 10, 6.4, 6.5, LMWS[3], BR, 'w');
  COL.add(...lmW(f, ui + 0.2, -10), ...lmW(f, ui + 0.2, -pw), 0.2, 0); COL.add(...lmW(f, ui + 0.2, pw), ...lmW(f, ui + 0.2, 10), 0.2, 0);
  fortBridge(K, g);
}
// the wooden bridge across the moat, on trestles, with brick piers and eagles at the far end
function fortBridge(K, g) {
  const f = g.f; let uFar = -g.a - 50;
  if (FS.bridge) { uFar = 0; for (let i = 0; i < FS.bridge.length; i += 2) uFar = Math.min(uFar, lmL(f, FS.bridge[i], FS.bridge[i + 1])[0]); }
  const u0 = -g.a, u1 = uFar, G = K.cap, WOOD = [206, 196, 184], DARK = hb('#6e5640'), WOODC = hb('#9a805f'), hw = 3.7, rw = 2.25;
  const deck = (v0, v1, y) => { fortTBox(K.wood, f, u1, u0, v0, v1, y - 0.3, y, FTS[3], WOOD, 'tnsw'); };
  deck(-rw, rw, FH.floor); deck(-hw, -rw, FH.floor + 0.2); deck(rw, hw, FH.floor + 0.2);
  for (const v of [-3.2, -1.2, 1.2, 3.2]) lmBar(G, fortP(f, u0, v, FH.floor - 0.45), fortP(f, u1, v, FH.floor - 0.45), 0.3, DARK);
  for (let u = u0 - 2.5; u > u1 + 1.5; u -= 5.5) {
    const w = lmW(f, u, 0), hg = fortPoint(w[0], w[1]).h; if (hg > -0.8) continue;
    lmBar(G, fortP(f, u, -3.9, FH.floor - 0.75), fortP(f, u, 3.9, FH.floor - 0.75), 0.3, DARK);
    const posts = [-3.2, -1.2, 1.2, 3.2];
    for (const v of posts) { fortTBox(K.cnc, f, u - 0.5, u + 0.5, v - 0.5, v + 0.5, hg - 0.1, hg + 0.4, 2, [214, 212, 206], 'wensbt'); lmBar(G, fortP(f, u, v, hg + 0.4), fortP(f, u, v, FH.floor - 0.6), 0.28, WOODC); }
    lmBar(G, fortP(f, u, -3.2, hg + 0.6), fortP(f, u, -1.2, FH.floor - 1.0), 0.14, WOODC); lmBar(G, fortP(f, u, 3.2, hg + 0.6), fortP(f, u, 1.2, FH.floor - 1.0), 0.14, WOODC);
    lmBar(G, fortP(f, u, -1.2, hg + 0.6), fortP(f, u, 1.2, FH.floor - 1.0), 0.14, WOODC);
  }
  for (const s of [-1, 1]) {
    const v = s * (hw - 0.08), y0 = FH.floor + 0.2;
    for (let u = u0; u >= u1; u -= 2) { lmBar(G, fortP(f, u, v, y0), fortP(f, u, v, y0 + 1.15), 0.12, WOODC); if (u - 2 >= u1) lmBar(G, fortP(f, u, v, y0 + 0.1), fortP(f, u - 2, v, y0 + 0.95), 0.08, WOODC); }
    lmBar(G, fortP(f, u0, v, y0 + 1.12), fortP(f, u1, v, y0 + 1.12), 0.12, WOODC); lmBar(G, fortP(f, u0, v, y0 + 0.62), fortP(f, u1, v, y0 + 0.62), 0.08, WOODC);
    COL.add(...lmW(f, u0, s * hw), ...lmW(f, u1, s * hw), 0.15, 0);
    // brick piers with granite caps and eagles at the counterscarp
    const vp = s * (hw + 0.9), up = u1 - 0.2;
    fortTBox(K.brk, f, up - 0.65, up + 0.65, vp - 0.65, vp + 0.65, -0.2, 3.3, LMWS[3], [255, 255, 255], 'wensb');
    fortTBox(K.gra, f, up - 0.8, up + 0.8, vp - 0.8, vp + 0.8, 3.3, 3.6, FTS[1], [205, 204, 198]);
    fortTile(K.cut, f, up, -1, vp - 0.75, vp + 0.75, 3.6, 4.4, FTT.eagle); fortTile(K.cut, f, up, 1, vp - 0.75, vp + 0.75, 3.6, 4.4, FTT.eagle);
  }
}
// granite portal with an Egyptian cavetto cornice and lictors' axes (the Michael gate), facing out at u = up
function fortEgyptPortal(K, g, up, out, wings) {
  const f = g.f, pw = 2.3, GR = [206, 205, 200], G = K.cap, D = up - out * 1.0;
  fortWallPlane(K.gra, f, up, out, -5, 5, 0, 7.8, [{ vc: 0, w: pw, ys: 6.1, ya: 6.1, sh: 'rect', yb: 0 }], FTS[1], GR);
  fortTBox(K.gra, f, Math.min(up, D), Math.max(up, D), pw, pw, 0, 6.1, FTS[1], sh(GR, 0.9), 'n'); fortTBox(K.gra, f, Math.min(up, D), Math.max(up, D), -pw, -pw, 0, 6.1, FTS[1], sh(GR, 0.9), 's');
  fortTBox(K.gra, f, Math.min(up, D), Math.max(up, D), -pw, pw, 6.1, 6.1, FTS[1], sh(GR, 0.8), 'b');
  for (const s of [-1, 1]) fortTBox(K.gra, f, up + (out < 0 ? 0 : -1.0), up + (out < 0 ? 1.0 : 0), s > 0 ? 5 : -5.0, s > 0 ? 5.0 : -5, 0, 7.8, FTS[1], GR, s > 0 ? 's' : 'n');
  const o = out, U = d => up + o * d;   // d: distance out of the wall plane
  fortTBox(K.gra, f, Math.min(U(0), U(0.2)), Math.max(U(0), U(0.2)), -5.15, 5.15, 7.8, 8.1, FTS[1], GR, 'wenstb');
  // cavetto: six slices flaring out and sideways
  const prof = [[0.2, 8.1, 5.15], [0.24, 8.5, 5.2], [0.32, 8.9, 5.3], [0.45, 9.25, 5.42], [0.63, 9.55, 5.57], [0.85, 9.8, 5.72], [1.0, 9.9, 5.8]];
  for (let k = 0; k < prof.length - 1; k++) {
    const [d0, y0, w0] = prof[k], [d1, y1, w1] = prof[k + 1], nu = y1 - y0, ny = -(d1 - d0), l = Math.hypot(ny, nu);   // the gorge faces out and down
    K.gra.q(fortP(f, U(d0), -w0, y0), fortP(f, U(d0), w0, y0), fortP(f, U(d1), w1, y1), fortP(f, U(d1), -w1, y1), [f[2] * o * nu / l, ny / l, f[3] * o * nu / l], [-w0 / 2, y0 / 2, w0 / 2, y0 / 2, w1 / 2, y1 / 2, -w1 / 2, y1 / 2], sh(GR, 0.9 + k * 0.03));
    for (const s of [-1, 1]) K.gra.q(fortP(f, U(0), s * w0, y0), fortP(f, U(d0), s * w0, y0), fortP(f, U(d1), s * w1, y1), fortP(f, U(0), s * w1, y1), [-f[3] * s, 0, f[2] * s], [0, y0 / 2, d0 / 2, y0 / 2, d1 / 2, y1 / 2, 0, y1 / 2], sh(GR, 0.85));
  }
  fortTile(K.det, f, U(0.205), o, -2.2, 2.2, 8.15, 9.0, FTT.winged);
  fortTBox(K.gra, f, Math.min(U(-1.2), U(1.05)), Math.max(U(-1.2), U(1.05)), -5.9, 5.9, 9.9, 10.3, FTS[1], GR);
  fortTBox(K.gra, f, Math.min(U(-1.2), U(0)), Math.max(U(-1.2), U(0)), -5.0, 5.0, 7.8, 9.9, FTS[1], GR, o < 0 ? 'e' : 'w');
  for (const s of [-1, 1]) fortAxe(G, f, up, s * 3.65, 3.1, o);
  COL.add(...lmW(f, up, -5), ...lmW(f, up, -pw), 0.2, 0); COL.add(...lmW(f, up, pw), ...lmW(f, up, 5), 0.2, 0);
  if (!wings) return;
  // curved wing walls of dressed sandstone, their tops falling with the slope of the rampart
  for (const s of [-1, 1]) {
    const n = 14, SND = [222, 214, 196];
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, v0 = s * (5 + 14 * t0), v1 = s * (5 + 14 * t1), h0 = fortWingTop(t0), h1 = fortWingTop(t1);
      K.snd.q(fortP(f, up, v0, -0.2), fortP(f, up, v1, -0.2), fortP(f, up, v1, h1), fortP(f, up, v0, h0), [f[2] * o, 0, f[3] * o], [v0 / FTS[2], 0, v1 / FTS[2], 0, v1 / FTS[2], h1 / FTS[2], v0 / FTS[2], h0 / FTS[2]], SND);
      polyA(G, [fortP(f, U(0.08), v0, h0), fortP(f, U(0.08), v1, h1), fortP(f, U(-0.7), v1, h1), fortP(f, U(-0.7), v0, h0)], hb('#a8a296'), 0, 1, 0);
      COL.add(...lmW(f, U(0.15), v0), ...lmW(f, U(0.15), v1), 0.2, 0);
    }
  }
}
// brick portal with a round arch, granite dressings and a meander frieze (the Alexander gate, the posterns)
function fortBrickPortal(K, g, up, out, W, pw, ys, top, frieze) {
  const f = g.f, GR = [205, 204, 198], U = d => up + out * d;
  fortWallPlane(K.brk, f, up, out, -W, W, 0, top, [{ vc: 0, w: pw, ys, ya: ys + pw, sh: 'round', yb: 0 }], LMWS[3], [236, 226, 220]);
  fortArchRing(K.gra, f, U(0.08), U(-0.5), out, { vc: 0, w: pw, ys, ya: ys + pw, sh: 'round' }, { vc: 0, w: pw + 0.45, ys, ya: ys + pw + 0.45, sh: 'round' }, FTS[1], GR);
  for (const s of [-1, 1]) { fortTBox(K.gra, f, Math.min(U(0), U(0.1)), Math.max(U(0), U(0.1)), s > 0 ? pw : -pw - 0.55, s > 0 ? pw + 0.55 : -pw, ys - 0.3, ys, FTS[1], GR, 'wenst'); fortTBox(K.gra, f, Math.min(U(0), U(0.08)), Math.max(U(0), U(0.08)), s > 0 ? W - 0.6 : -W, s > 0 ? W : -W + 0.6, 0, top, FTS[1], GR, 'wenst'); }
  if (frieze) { fortTBox(K.ren, f, Math.min(U(0), U(0.05)), Math.max(U(0), U(0.05)), -W + 0.6, W - 0.6, top - 0.95, top - 0.35, LMWS[1], hb('#d9d2c6'), 'we'); fortTile(K.det, f, U(0.06), out, -W + 0.6, W - 0.6, top - 0.95, top - 0.35, FTT.meander); }
  fortTBox(K.gra, f, Math.min(U(-1.0), U(0.3)), Math.max(U(-1.0), U(0.3)), -W - 0.2, W + 0.2, top - 0.3, top, FTS[1], GR);
  COL.add(...lmW(f, up, -W), ...lmW(f, up, -pw), 0.2, 0); COL.add(...lmW(f, up, pw), ...lmW(f, up, W), 0.2, 0);
}
function fortGateModels(K) {
  for (const g of fortGates()) {
    if (g.kind === 'nik') fortNicholas(K, g);
    else if (g.kind === 'mih') { fortPassage(K, g, 2.0, 2.9, K.gra, FTS[1], K.gra, FTS[1]); fortBlock(K, g, 6.0, 2.0, 2.9, [1.0, 1.0]); fortEgyptPortal(K, g, -g.a, -1, false); fortEgyptPortal(K, g, g.a, 1, true); }
    else if (g.kind === 'ale') { fortPassage(K, g, 2.1, 3.0, K.brk, LMWS[3]); fortBlock(K, g, 6.5, 2.1, 3.0, [0.5, 0.5]); fortBrickPortal(K, g, -g.a, -1, g.W, 2.1, 3.0, 6.5, true); fortBrickPortal(K, g, g.a, 1, g.W, 2.1, 3.0, 6.5, true); }
    else { fortPassage(K, g, 1.5, 2.4, K.brk, LMWS[3]); fortBlock(K, g, 4.8, 1.5, 2.4, [0.5, 0.5]); fortBrickPortal(K, g, -g.a, -1, g.W, 1.5, 2.4, 4.8, false); fortBrickPortal(K, g, g.a, 1, g.W, 1.5, 2.4, 4.8, false); }
  }
}

export { fortArchRing, fortGateModels, fortP, fortTBox, fortTile, fortWallPlane };
