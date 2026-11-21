import { sphereProf } from './culture-palace.js';
import { lmEdgeBox, lmFoot, lmLen, lmNear, lmStrip } from './university.js';
import { lmSign } from './unity-house.js';
import { lmBar, lmBlock, lmBoxL, lmLathe, lmLit, lmOp, lmRow, lmWF } from './helpers.js';
import { LMT, lr } from './tiles.js';
import { LMF, LMWHITE, lmW } from './core.js';
import { flatPlain } from '../buildings/walls.js';
import { polyA } from '../core/geometry.js';
import { area2, hb, reversed, sh } from '../core/util.js';
import { addLight } from '../world/lamp-light.js';

/* ---- Gastrobar "Vēsma", Rīgas iela 49 ----
   A one-storey pavilion on the north side of the pedestrian street (place and photographs: visitdaugavpils.lv). The
   cadastre outline (43 × 12 m) includes the roofed summer terrace: the glazed front stands 3.8 m behind it, in line
   with the recessed entrance of the west wing. A deep fascia of dark green boards runs round the top with the name in
   white italic letters outlined in turquoise, a turquoise and white stripe, "BĀRS ⓥ BISTRO" and the feather; above it a
   roof terrace with a steel railing and globe lamps. In front, the summer terrace: dark green steel posts, a thin dark
   roof with a cream awning underneath, a tinted glass fence with Aldaris banners, a wooden deck, hanging baskets,
   rattan chairs. Frame ves: u from the street into the building, v east along Rīgas iela. */
function lmVesma(K) {
  const f = LMF.ves, G = K.plain, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; }, U = [f[2], f[3]];
  const WHITE = [240, 240, 236], GREEN = hb('#264b3c'), POST = hb('#2d4a3c'), ROOFC = hb('#3a3f3d'), AWN = hb('#ddd3bc'), DECK = hb('#6b4f3a'), TEAL = hb('#3cc3c4'), STEEL = hb('#c3c7ca');
  const FA = 3.7, FB = 5.6, UF = 3.8, V0 = -9.7, V1 = 34;
  const body = [[UF, V0], [UF, V1], [11.8, V1], [11.4, -9.3], [10.5, -14.4], [6.1, -14.0]];
  // the pavilion: glazed front behind the terrace, the entrance in the west wing, white rendered back
  { const o = [], a = [UF, V0], b = [UF, V1];
    lmStrip(o, a, b, 0.6, 5.4, 2.4, 0.3, 3.55, 'vsFront', () => ({ d: 0.12, lit: true })); lmOp(o, UF, -2.6, 2.4, 0.3, 3.55, 'vsDoor', { d: 0.15, lit: true });
    lmStrip(o, a, b, 10.0, 43.4, 2.0, 0.3, 3.55, 'vsFront', () => ({ d: 0.12, lit: lmLit(0.9) }));
    for (const [p, q] of [[[11.8, V1], [11.4, -9.3]]]) lmRow(o, p[0], p[1], q[0], q[1], 6, 1.2, 1.2, 2.6, 'stWin', () => ({ d: 0.15, lit: lmLit(0.3) }));
    lmBlock(K, f, { poly: body, top: FA, st: { tex: 1, col: WHITE, plinth: 0.3, pcol: [150, 148, 142] }, wy0: lmFoot([[[UF, V1], [11.8, V1], 99]]) }, o); }
  // fascia of green boards round the top, the stripes and the lettering on the front
  for (let i = 0; i < body.length; i++) { const a = body[i], b = body[(i + 1) % body.length]; if (lmNear(a, [UF, V1]) && lmNear(b, [11.8, V1])) continue; lmEdgeBox(G, f, a, b, [8, 10], -0.05, lmLen(a, b) + 0.05, FA, FB, -0.25, 0.2, GREEN); }
  { const t = LMT.vsBoard, u = UF - 0.205; for (let v = V0; v < V1 - 0.01; v += 4) { const v2 = Math.min(V1, v + 4), P = lmW(f, u, v2), Q = lmW(f, u, v), F = lmWF(P, Q), du = (t.u1 - t.u0) * (v2 - v) / 4;
      K.det.q(F.at(0, FA, 0), F.at(F.L, FA, 0), F.at(F.L, FB, 0), F.at(0, FB, 0), [-U[0], 0, -U[1]], [t.u0 + du, t.v0, t.u0, t.v0, t.u0, t.v1, t.u0 + du, t.v1], LMWHITE, 0); }
    lmBoxL(G, f, UF - 0.24, UF - 0.2, V0, V1, 4.06, 4.18, TEAL); lmBoxL(G, f, UF - 0.24, UF - 0.2, V0, V1, 4.24, 4.3, hb('#eef6f4'));
    lmSign(K, f, [UF - 0.25, -8.6], [UF - 0.25, -1.4], 3.86, 5.52, 'vesma', 1); lmSign(K, f, [UF - 0.25, 3.8], [UF - 0.25, 9.6], 4.36, 5.06, 'vesmaBB', 1); lmSign(K, f, [UF - 0.25, 13.0], [UF - 0.25, 14.4], 3.8, 5.55, 'vesmaLogo', 1); }
  flatPlain(G, [new Float32Array(body.flatMap(([u, v]) => lmW(f, u, v)))].map(q => area2(q) > 0 ? q : reversed(q)), FB, hb('#9a9c9c'), false);
  // roof terrace: railing and globe lamps
  { const R = (a, b) => { const A = lmW(f, a[0], a[1]), B = lmW(f, b[0], b[1]), L = Math.hypot(B[0] - A[0], B[1] - A[1]); for (const h of [0.5, 1.05]) lmBar(G, [A[0], FB + h, A[1]], [B[0], FB + h, B[1]], h > 1 ? 0.05 : 0.03, STEEL);
      for (let s = 0; s <= L + 0.01; s += L / Math.max(1, Math.round(L / 1.6))) lmBar(G, [A[0] + (B[0] - A[0]) * s / L, FB, A[1] + (B[1] - A[1]) * s / L], [A[0] + (B[0] - A[0]) * s / L, FB + 1.05, A[1] + (B[1] - A[1]) * s / L], 0.04, STEEL); };
    R([4.3, -9.2], [4.3, 33.6]); R([4.3, -9.2], [10.6, -9.2]); R([4.3, 33.6], [11.3, 33.6]);
    for (const v of [-8.6, -1.6, 5.4, 12.4, 19.4, 26.4, 33.0]) { const [x, z] = lmW(f, 4.45, v); lmBar(G, [x, FB, z], [x, FB + 1.6, z], 0.07, hb('#2b2e30')); lmLathe(G, x, z, FB + 1.6, [[0, 0], [0.07, 0.03], [0.05, 0.08]], 8, hb('#2b2e30')); lmLathe(K.globe, x, z, FB + 1.66, sphereProf(0.17), 10, hb('#f6f3ea')); addLight(x, FB + 1.83, z, 2, 0, 2.0); } }
  // the summer terrace
  { const D = DECK, vs = []; for (let k = 0; k <= 10; k++) vs.push(0.5 + k * (V1 - 1) / 10);
    lmBoxL(G, f, 0, UF, 0.3, V1 - 0.3, 0, 0.15, D, false);
    for (const v of vs) lmBoxL(G, f, 0.05, 0.25, v - 0.1, v + 0.1, 0.15, 3.15, POST);
    lmBoxL(G, f, 0.0, 0.3, 0.3, V1 - 0.3, 2.95, 3.2, POST);
    const r0 = -0.35, y0 = 3.18, y1 = FA - 0.02;
    polyA(G, [at(r0, 0.2, y0 + 0.08), at(UF, 0.2, y1 + 0.08), at(UF, V1 - 0.2, y1 + 0.08), at(r0, V1 - 0.2, y0 + 0.08)], ROOFC, 0, 1, 0);
    polyA(G, [at(r0, 0.2, y0), at(UF, 0.2, y1), at(UF, V1 - 0.2, y1), at(r0, V1 - 0.2, y0)], AWN, 0, -1, 0);
    polyA(G, [at(r0, 0.2, y0), at(r0, V1 - 0.2, y0), at(r0, V1 - 0.2, y0 + 0.08), at(r0, 0.2, y0 + 0.08)], ROOFC, -U[0], 0, -U[1]);
    // tinted glass fence between the posts, an Aldaris banner on every other panel; the ends of the terrace
    const fence = (a, b, k) => { const P = lmW(f, a[0], a[1]), Q = lmW(f, b[0], b[1]), F = lmWF(Q, P), t = LMT[k % 2 ? 'vsFenceA' : 'vsFence'];
      for (const [Fx, nr] of [[F, 1], [lmWF(P, Q), -1]]) K.det.q(Fx.at(0, 0.15, 0), Fx.at(Fx.L, 0.15, 0), Fx.at(Fx.L, 1.15, 0), Fx.at(0, 1.15, 0), [Fx.nx, 0, Fx.nz], [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, 0); };
    for (let k = 0; k < vs.length - 1; k++) fence([0.15, vs[k] + 0.1], [0.15, vs[k + 1] - 0.1], k);
    fence([UF, 0.35], [0.25, 0.35], 0); fence([0.25, V1 - 0.35], [UF, V1 - 0.35], 0);
    // hanging baskets, tables and rattan chairs
    for (const v of vs) { const [x, z] = lmW(f, 0.15, v); lmBar(G, [x, 3.0, z], [x, 2.55, z], 0.02, hb('#222')); lmLathe(G, x, z, 2.2, [[0, 0], [0.22, 0.05], [0.28, 0.22], [0.26, 0.34]], 8, hb('#3f6a2e')); lmLathe(G, x, z, 2.5, sphereProf(0.2), 8, hb(['#d23a5a', '#e8e6e0', '#c8202a'][Math.floor(lr() * 3)])); }
    for (let k = 0; k < vs.length - 1; k++) { const v = (vs[k] + vs[k + 1]) / 2, [x, z] = lmW(f, 1.9, v);
      lmLathe(G, x, z, 0.15, [[0.25, 0], [0.04, 0.04], [0.04, 0.72], [0.4, 0.74], [0.4, 0.78], [0, 0.78]], 10, hb('#4a4c4e'));
      for (const dv of [-0.85, 0.85]) { const c = hb('#9a7448'); lmBoxL(G, f, 1.65, 2.15, v + dv - 0.25, v + dv + 0.25, 0.15, 0.6, c); const bk = dv < 0 ? v + dv - 0.25 : v + dv + 0.19; lmBoxL(G, f, 1.65, 2.15, bk, bk + 0.06, 0.6, 1.05, sh(c, 0.92)); } }
    // the small Vēsma board at the east end of the terrace roof
    lmSign(K, f, [r0 - 0.02, V1 - 4.4], [r0 - 0.02, V1 - 0.6], y0 + 0.1, y0 + 0.95, 'vesma', 1); }
  // the entrance: two stone steps, a white column at the corner of the west wing
  lmBoxL(K.stone, f, 1.7, UF, -4.4, -0.8, 0, 0.15, hb('#8c8984'), false); lmBoxL(K.stone, f, 2.6, UF, -4.0, -1.2, 0.15, 0.3, hb('#94918b'), false);
  lmBoxL(G, f, UF - 0.4, UF + 0.1, V0 + 0.05, V0 + 0.55, 0, FA, WHITE);
  // junipers in front of the west wing
  for (const [u, v, r, h] of [[1.2, -10.8, 1.1, 1.5], [2.6, -12.6, 0.9, 1.2], [0.4, -13.4, 1.0, 1.4], [2.2, -8.6, 0.7, 1.0]]) { const [x, z] = lmW(f, u, v), c = sh(hb('#2f5232'), 0.85 + lr() * 0.25); lmLathe(G, x, z, 0, [[r * 0.6, 0], [r, h * 0.3], [r * 0.9, h * 0.7], [r * 0.45, h * 0.95], [0, h]], 9, c); }
}

export { lmVesma };
