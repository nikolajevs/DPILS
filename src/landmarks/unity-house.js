import { lmBar, lmBlock, lmBoxL, lmBoxW, lmLathe, lmLit, lmOp, lmOpsFor, lmRow, lmWF, lmWall } from './helpers.js';
import { LMS, LMT } from './tiles.js';
import { LMF, LMWHITE, lmW } from './core.js';
import { COL } from '../world/data.js';
import { polyA } from '../core/geometry.js';
import { hb, sh } from '../core/util.js';

/* ---- Vienības nams ---- */
function lmUnityHouse(K) {
  const f = LMF.vn, ops = [];
  const WALL = hb('#aeaba3'), PLINTH = hb('#7d7871'), TRIM = hb('#a19e96'), STONE = hb('#a29f97'), STEP = hb('#8f8b84'), ROOF = hb('#5d5e5f'), IRON = hb('#33373a');
  const ash = { tex: 0, col: WALL }, ren = { tex: 1, col: WALL, plinth: 0.8, pcol: PLINTH };
  const winS = { d: 0.25, sill: TRIM };
  // portico façade: two pylons and the loggia between them, 3 m deep, under an 18 m cornice
  lmOp(ops, 0, 14.7, 18.3, 1.07, 14.6, null, { d: 3.0, noFloor: true });
  for (const v of [2.8, 26.6]) lmOp(ops, 0, v, 0.6, 16.45, 17.05, 'vnVent', { d: 0.12 });
  // shoulders and the sides of the portico block: small doors, a tall stair window
  lmOp(ops, 2.6, -1.8, 1.15, 0, 2.55, 'vnSideDoor', { d: 0.3 }); lmOp(ops, 2.9, 30.95, 1.15, 0, 2.55, 'vnSideDoor', { d: 0.3 });
  lmOp(ops, 13.6, -3.0, 1.5, 0, 2.9, 'vnSideDoor', { d: 0.3 }); lmOp(ops, 19.5, -3.0, 0.95, 1.6, 15.8, 'vnStrip', { d: 0.35, lit: lmLit(0.7) });
  lmOp(ops, 14.0, 31.2, 1.5, 0, 2.9, 'vnSideDoor', { d: 0.3 }); lmOp(ops, 19.8, 31.2, 0.95, 1.6, 15.8, 'vnStrip', { d: 0.35, lit: lmLit(0.7) });
  // floors of the wings
  const FW = [[1.35, 3.5], [4.85, 7.0], [8.35, 10.5], [11.85, 13.8]];
  // concert-hall wing: entrance with canopy and lettering, stair windows, three storeys
  lmOp(ops, 30, -7.2, 3.4, 0, 3.4, 'vnKonc', { d: 0.35, lit: true });
  lmOp(ops, 30, -13.3, 1.3, 1.0, 6.3, 'vnTall', { d: 0.3, lit: lmLit(0.6) }); lmOp(ops, 30, -13.3, 1.3, 7.3, 12.6, 'vnTall', { d: 0.3, lit: lmLit(0.6) });
  for (const v of [-10.3, -4.1]) lmOp(ops, 30, v, 1.45, FW[0][0], FW[0][1], 'vnWin', Object.assign({ lit: lmLit(0.4) }, winS));
  for (const [y0, y1] of FW.slice(1)) for (const v of [-10.3, -7.2, -4.1]) lmOp(ops, 30, v, 1.45, y0, Math.min(y1, 13.6), 'vnWin', Object.assign({ lit: lmLit(0.45) }, winS));
  for (const u of [32.5, 35.5, 42.5, 45.5]) lmOp(ops, u, -15, 1.1, 1.5, 2.6, 'vnPort', { d: 0.2, lit: lmLit(0.5) });
  lmOp(ops, 39.0, -15, 1.6, 0, 2.9, 'vnSideDoor', { d: 0.3 });
  lmRow(ops, 30, -15, 48.5, -15, 5, 1.6, 5.2, 8.1, 'vnWin', () => Object.assign({ lit: lmLit(0.5) }, winS));
  lmRow(ops, 30, -15, 48.5, -15, 5, 1.6, 9.3, 12.2, 'vnWin', () => Object.assign({ lit: lmLit(0.5) }, winS));
  // Rīgas iela: shops under the tall windows of the concert hall
  lmRow(ops, 48.5, -16.7, 86.7, -16.9, 9, 3.6, 0.35, 3.95, k => ['vnShopA', 'vnShopB', 'vnShopC'][k % 3], { d: 0.2, lit: true });
  lmRow(ops, 48.5, -16.7, 86.7, -16.9, 9, 1.7, 5.6, 13.4, 'vnTall', () => ({ d: 0.3, lit: lmLit(0.85) }));
  // Ģimnāzijas iela: shops, three floors of offices
  lmRow(ops, 86.7, -16.9, 86.7, -2.7, 4, 3.0, 0.35, 3.95, k => ['vnShopB', 'vnShopC', 'vnShopA', 'vnShopB'][k], { d: 0.2, lit: true });
  lmRow(ops, 87.8, -2.7, 87.8, 41.8, 12, 3.0, 0.35, 3.95, k => ['vnShopA', 'vnShopC', 'vnShopB'][k % 3], { d: 0.2, lit: true });
  for (const [y0, y1] of FW.slice(1)) { lmRow(ops, 86.7, -16.9, 86.7, -2.7, 4, 1.45, y0, y1, 'vnWin', () => Object.assign({ lit: lmLit(0.35) }, winS)); lmRow(ops, 87.8, -2.7, 87.8, 41.8, 12, 1.45, y0, y1, 'vnWin', () => Object.assign({ lit: lmLit(0.35) }, winS)); }
  // Saules iela: four floors, a stair window over the side entrance
  for (let k = 0; k < 13; k++) {
    const t = (k + 0.5) / 13, u = 84.4 + (39.5 - 84.4) * t, v = 45.2 + 0.1 * t;
    if (k === 3) { lmOp(ops, u, v, 1.1, 3.4, 14.3, 'vnStrip', { d: 0.3, lit: lmLit(0.7) }); lmOp(ops, u, v, 1.6, 0, 2.9, 'vnSideDoor', { d: 0.3 }); continue; }
    for (const [y0, y1] of FW) lmOp(ops, u, v, 1.45, y0, y1, 'vnWin', Object.assign({ lit: lmLit(0.35) }, winS));
  }
  // courtyard
  const court = [[58, 2.3, 74, 2.3, 4], [74, 2.3, 74, 30.4, 8], [74, 30.4, 58, 30.4, 4], [58, 30.4, 58, 2.3, 8]];
  for (const [a, b, c, d, n] of court) for (const [y0, y1] of FW) lmRow(ops, a, b, c, d, n, 1.45, y0, y1, 'vnWin', () => Object.assign({ lit: lmLit(0.3) }, winS));
  // south-west wing (was the Latvian Society's terrace) and its set-back top floor
  const FN = [[1.6, 3.6], [5.0, 7.2], [8.4, 11.0]];
  lmRow(ops, 26.2, 44.5, 26.2, 31.0, 5, 0.9, 0.3, 0.85, 'vnBase', { d: 0.15 });
  for (const [y0, y1] of FN) { lmRow(ops, 26.2, 44.5, 26.2, 31.0, 5, 1.45, y0, y1, 'vnWin', () => Object.assign({ lit: lmLit(0.4) }, winS)); lmRow(ops, 39.5, 44.5, 26.2, 44.5, 4, 1.45, y0, y1, 'vnWin', () => Object.assign({ lit: lmLit(0.4) }, winS)); }
  lmRow(ops, 39.5, 44.5, 26.2, 44.5, 4, 0.9, 0.3, 0.85, 'vnBase', { d: 0.15 });
  lmRow(ops, 39.5, 45.3, 39.5, 31.0, 4, 1.3, 13.0, 14.6, 'vnWin', () => ({ d: 0.2, lit: lmLit(0.4) }));
  for (const [a, b, c, d] of [[30.5, 42.5, 30.5, 33.5], [39.5, 42.5, 30.5, 42.5], [30.5, 33.5, 39.5, 33.5]]) lmRow(ops, a, b, c, d, 3, 1.2, 13.2, 14.8, 'vnWin', () => ({ d: 0.2, lit: lmLit(0.4) }));
  // stage tower: a row of small windows under the cornice
  for (const [a, b, c, d, n] of [[38, 2.3, 56, 2.3, 8], [56, 27.5, 38, 27.5, 8], [38, 27.5, 38, 2.3, 10], [56, 2.3, 56, 27.5, 10]]) lmRow(ops, a, b, c, d, n, 0.8, 22.0, 22.8, 'vnSmall', () => ({ d: 0.15, lit: lmLit(0.3) }));

  const blocks = [
    { poly: [[0, 0], [11.5, 0], [11.5, -3.0], [26.2, -3.0], [26.2, 31.2], [12.6, 31.2], [12.6, 29.4], [0, 29.4]], top: 17.3, st: ash, cornice: [[17.3, 17.55, 0.15, STONE], [17.55, 18.2, 0.75, STONE]], trim: K.stone, roof: ROOF, roofY: 18.2 },
    { poly: [[2.6, -3.6], [11.5, -3.6], [11.5, 0], [2.6, 0]], top: 15.75, st: ash, cornice: [[15.75, 15.95, 0.12, STONE], [15.95, 16.55, 0.6, STONE]], trim: K.stone, roof: ROOF, roofY: 16.55 },
    { poly: [[2.9, 29.4], [12.6, 29.4], [12.6, 32.5], [2.9, 32.5]], top: 15.75, st: ash, cornice: [[15.75, 15.95, 0.12, STONE], [15.95, 16.55, 0.6, STONE]], trim: K.stone, roof: ROOF, roofY: 16.55 },
    { poly: [[26.2, -3.0], [38, -3.0], [38, 31.0], [26.2, 31.0]], top: 15.3, st: ren, cornice: [[15.3, 16.0, 0.3, TRIM]], roof: ROOF, roofY: 16.0 },
    { poly: [[30, -15], [48.5, -15], [48.5, 2.3], [38, 2.3], [38, -3.0], [30, -3.0]], top: 14.2, st: ren, cornice: [[14.2, 15.0, 0.35, TRIM]], roof: ROOF, roofY: 15.0 },
    { poly: [[38, 2.3], [56, 2.3], [56, 27.5], [38, 27.5]], top: 23.3, st: ren, cornice: [[23.3, 24.0, 0.4, TRIM]], roof: ROOF, roofY: 24.0 },
    { poly: [[48.5, -16.7], [86.7, -16.9], [86.7, -2.7], [87.8, -2.7], [87.8, 41.8], [87.34, 43.5], [86.1, 44.74], [84.4, 45.2], [39.5, 45.3], [39.5, 31.0], [38, 31.0], [38, 27.5], [56, 27.5], [56, 2.3], [48.5, 2.3]],
      holes: [[[58, 2.3], [58, 30.4], [74, 30.4], [74, 2.3]]], top: 14.95, st: ren, cornice: [[14.95, 15.8, 0.35, TRIM]], roof: ROOF, roofY: 15.8 },
    { poly: [[26.2, 31.0], [39.5, 31.0], [39.5, 44.5], [26.2, 44.5]], top: 12.0, st: ren, cornice: [[12.0, 12.6, 0.3, TRIM]], roof: hb('#6a6b6b'), roofY: 12.6 },
    { poly: [[30.5, 33.5], [39.5, 33.5], [39.5, 42.5], [30.5, 42.5]], y0: 12.6, top: 15.2, st: { tex: 1, col: WALL } }
  ];
  for (const b of blocks) lmBlock(K, f, b, ops);

  const G = K.plain, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  // loggia: back wall with five bays of doors and windows, stylobate, soffit
  const back = [], bays = [8.21, 11.43, 14.65, 17.87, 21.09];
  bays.forEach((v, k) => {
    lmOp(back, 3.0, v, 1.62, 1.07, 5.15, k % 2 ? 'vnShopWin' : 'vnDoor', { d: 0.3, lit: true });
    lmOp(back, 3.0, v, 1.55, 7.2, 9.6, 'vnWinMid', { d: 0.3, lit: lmLit(0.85), sill: TRIM });
    lmOp(back, 3.0, v, 1.85, 11.55, 13.25, 'vnWinTop', { d: 0.3, lit: lmLit(0.7) });
  });
  const bP = lmW(f, 3.0, 23.85), bQ = lmW(f, 3.0, 5.55);
  lmWall(K, bP, bQ, 1.07, 14.6, lmOpsFor(f, back, [3.0, 23.85], [3.0, 5.55]), { tex: 1, col: WALL });   // plain render, left in shadow when the façade is floodlit
  const BF = lmWF(bP, bQ); lmBoxW(G, BF, 0, 18.3, 9.6, 9.72, -0.08, 0, TRIM); lmBoxW(G, BF, 0, 18.3, 11.3, 11.4, -0.06, 0, TRIM);
  // steps, granite
  const GS = K.stone;
  for (let k = 0; k < 7; k++) lmBoxL(GS, f, -2.8 + 0.4 * k, 0.02, -0.4, 29.8, k * 0.153, (k + 1) * 0.153, sh(STEP, 0.96 + (k % 2) * 0.05), false);
  lmBoxL(GS, f, 0, 3.0, 5.55, 23.85, 0, 1.071, STEP, false);
  // entablature over the columns
  lmBoxL(GS, f, -0.2, 0.5, 5.4, 24.0, 14.55, 14.98, STONE);
  // six columns with Corinthian capitals
  for (let k = 0; k < 6; k++) {
    const v = 6.6 + k * 3.22, [cx, cz] = lmW(f, 1.0, v);
    lmBoxL(GS, f, 0.25, 1.75, v - 0.75, v + 0.75, 1.07, 1.35, STONE, false);
    lmLathe(GS, cx, cz, 1.35, [[0.75, 0], [0.78, 0.08], [0.74, 0.18], [0.66, 0.24], [0.68, 0.3], [0.62, 0.36]], 20, STONE);
    lmLathe(GS, cx, cz, 1.71, [[0.62, 0], [0.625, 1.5], [0.61, 5.0], [0.58, 8.5], [0.555, 11.34]], 20, STONE);
    lmLathe(GS, cx, cz, 13.05, [[0.555, 0], [0.6, 0.05], [0.6, 0.12], [0.56, 0.16], [0.6, 0.5], [0.7, 0.95], [0.84, 1.25], [0.86, 1.35]], 20, STONE);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 8; i++) {   // acanthus leaves in two rows, tips curling out
      const a = (i + r * 0.5) / 8 * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a), ta = -sa, tb = ca, y0 = 13.2 + r * 0.38, y1 = y0 + 0.62, r0 = 0.6, r1 = 0.82, w0 = 0.16, w1 = 0.2;
      const p = (rr, y, w) => [cx + ca * rr + ta * w, y, cz + sa * rr + tb * w];
      polyA(GS, [p(r0, y0, -w0), p(r0, y0, w0), p(r1, y1, w1), p(r1, y1, -w1)], sh(STONE, 1.03), ca, -0.3, sa);
      polyA(GS, [p(r1, y1, -w1), p(r1, y1, w1), p(r1 + 0.12, y1 - 0.14, w1 * 0.6), p(r1 + 0.12, y1 - 0.14, -w1 * 0.6)], sh(STONE, 0.95), ca, 0.6, sa);
    }
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2 + Math.atan2(f[3], f[2]), [x, z] = [cx + Math.cos(a) * 0.86, cz + Math.sin(a) * 0.86]; lmLathe(GS, x, z, 14.06, [[0, 0], [0.14, 0.02], [0.17, 0.17], [0.14, 0.32], [0, 0.34]], 8, sh(STONE, 1.02)); }
    lmBoxL(GS, f, 1.0 - 0.95, 1.0 + 0.95, v - 0.95, v + 0.95, 14.4, 14.6, STONE);
  }
  // poster cases on the pylons
  for (const v of [2.75, 26.65]) {
    lmBoxL(G, f, -0.12, 0.0, v - 1.82, v + 1.82, 1.03, 3.62, hb('#2b2d2f'));
    const P = lmW(f, -0.125, v + 1.8), Q = lmW(f, -0.125, v - 1.8), F = lmWF(P, Q), t = LMT.vnPoster;
    K.det.q(F.at(0, 1.05, 0), F.at(3.6, 1.05, 0), F.at(3.6, 3.55, 0), F.at(0, 3.55, 0), [F.nx, 0, F.nz], [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, 1);
  }
  // "Info centrs" sign over the side door
  { const P = lmW(f, 14.85, 31.27), Q = lmW(f, 13.15, 31.27), F = lmWF(P, Q), t = LMT.vnInfo; K.det.q(F.at(0, 3.05, 0), F.at(1.7, 3.05, 0), F.at(1.7, 3.47, 0), F.at(0, 3.47, 0), [F.nx, 0, F.nz], [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, 1); }
  // lettering over the portico
  lmSign(K, f, [-0.03, 9.7], [-0.03, 19.6], 15.98, 16.62, 'vnName', 0);
  // concert-hall entrance canopy with its name
  lmBoxL(G, f, 28.3, 30.0, -9.3, -5.1, 3.55, 3.95, hb('#3c3f42'));
  lmSign(K, f, [28.27, -9.05], [28.27, -5.35], 3.6, 3.9, 'konc', 1);
  // shop canopies along Rīgas iela and Ģimnāzijas iela
  { const F1 = lmWF(lmW(f, 48.5, -16.7), lmW(f, 86.7, -16.9)); lmBoxW(G, F1, 0.4, F1.L - 0.4, 4.15, 4.35, -1.3, 0, hb('#3e4246')); }
  { const F2 = lmWF(lmW(f, 86.7, -16.9), lmW(f, 86.7, -2.7)); lmBoxW(G, F2, 0.3, F2.L, 4.15, 4.35, -1.3, 0, hb('#3e4246')); }
  { const F3 = lmWF(lmW(f, 87.8, -2.7), lmW(f, 87.8, 41.8)); lmBoxW(G, F3, 0, F3.L - 0.3, 4.15, 4.35, -1.3, 0, hb('#3e4246')); }
  // side entrance canopy on Saules iela
  { const u = 84.4 + (39.5 - 84.4) * (3.5 / 13), F4 = lmWF(lmW(f, 84.4, 45.2), lmW(f, 39.5, 45.3)), s = (84.4 - u); lmBoxW(G, F4, s - 1.3, s + 1.3, 3.0, 3.2, -1.1, 0, hb('#3e4246')); }
  // terrace railing on the south-west wing, hipped metal roof of its top floor
  for (const [u0, v0, u1, v1] of [[26.45, 31.3, 26.45, 44.25], [26.45, 44.25, 39.4, 44.25], [26.45, 31.3, 30.3, 31.3]]) {
    const A = lmW(f, u0, v0), B = lmW(f, u1, v1), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    lmBar(G, [A[0], 13.6, A[1]], [B[0], 13.6, B[1]], 0.06, IRON); lmBar(G, [A[0], 13.1, A[1]], [B[0], 13.1, B[1]], 0.03, IRON);
    for (let s = 0; s <= L + 0.01; s += L / Math.max(1, Math.round(L / 1.5))) { const x = A[0] + (B[0] - A[0]) * s / L, z = A[1] + (B[1] - A[1]) * s / L; lmBar(G, [x, 12.6, z], [x, 13.63, z], 0.05, IRON); }
  }
  { const M = hb('#b5babd'), e0 = 15.2, top = 16.9, a = at(30.2, 33.2, e0), b = at(39.8, 33.2, e0), c = at(39.8, 42.8, e0), d = at(30.2, 42.8, e0), apex = at(35, 38, top);
    polyA(G, [a, b, apex], M, f[3], 1, -f[2]); polyA(G, [b, c, apex], sh(M, 0.95), f[2], 1, f[3]); polyA(G, [c, d, apex], M, -f[3], 1, f[2]); polyA(G, [d, a, apex], sh(M, 0.9), -f[2], 1, -f[3]);
    polyA(G, [a, b, c, d], sh(WALL, 0.6), 0, -1, 0); }
  // flagpole with the Latvian flag on the stage tower
  { const [x, z] = lmW(f, 47, 4.0); lmBar(G, [x, 24, z], [x, 31.2, z], 0.09, hb('#d9d9d6')); lmLathe(G, x, z, 31.2, [[0, 0], [0.09, 0.05], [0.07, 0.15], [0, 0.2]], 8, hb('#c9a24a'));
    const CAR = hb('#9e3039'), WH = hb('#f3f1ec'), dir = [-f[3], f[2]], fl = (y0, y1, col) => {
      const A = [x, y0, z], B = [x + dir[0] * 2.1, y0 - 0.05, z + dir[1] * 2.1], Cc = [x + dir[0] * 2.1, y1 - 0.05, z + dir[1] * 2.1], D = [x, y1, z]; polyA(G, [A, B, Cc, D], col, f[2], 0, f[3]); polyA(G, [A, B, Cc, D], col, -f[2], 0, -f[3]); };
    fl(29.6, 30.02, CAR); fl(30.02, 30.23, WH); fl(30.23, 30.65, CAR); }
  // roof boxes
  lmBoxL(G, f, 64, 68, -12, -8, 15.8, 16.9, hb('#8d9091')); lmBoxL(G, f, 78, 81, 34, 38, 15.8, 16.6, hb('#8d9091')); lmBoxL(G, f, 30, 33, 5, 9, 16.0, 17.2, hb('#8d9091'));
  // collisions for the steps (the building itself collides through its cadastre outline)
  const s0 = lmW(f, -2.8, -0.4), s1 = lmW(f, -2.8, 29.8), s2 = lmW(f, 0, -0.4), s3 = lmW(f, 0, 29.8);
  COL.add(s0[0], s0[1], s1[0], s1[1], 0, 0); COL.add(s0[0], s0[1], s2[0], s2[1], 0, 0); COL.add(s1[0], s1[1], s3[0], s3[1], 0, 0);
}
// an upright sign between two local points, the first at the viewer's left; it faces that viewer
function lmSign(K, f, pl, pr, y0, y1, name, lit, B = K.txt, t = LMS[name]) {
  const F = lmWF(lmW(f, pr[0], pr[1]), lmW(f, pl[0], pl[1]));   // runs right to left, so its normal points at the viewer
  B.q(F.at(0, y0, 0), F.at(F.L, y0, 0), F.at(F.L, y1, 0), F.at(0, y1, 0), [F.nx, 0, F.nz], [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, lit);
}

export { lmSign, lmUnityHouse };
