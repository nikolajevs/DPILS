import { lmSign } from './unity-house.js';
import { lmBar, lmBlock, lmBoxL, lmBoxW, lmLit, lmOp, lmRow, lmWF } from './helpers.js';
import { LMT } from './tiles.js';
import { LMF, LMWHITE, lmW } from './core.js';
import { polyA } from '../core/geometry.js';
import { hb } from '../core/util.js';

/* ---- Park Hotel Latgola (hotel "Latvija", 1975–85, reconstructed in the 2000s) and the Latgola shopping centre ---- */
const LAT_FL = f => 4.2 + (f - 2) * 2.9;                     // floors 2..10 above a 4.2 m ground floor
const latWave = v => { const t = Math.max(0, Math.min(1, (v - 7.2) / 44.2)); return 33.7 + 0.9 * t + 2.3 * Math.sin(Math.PI * Math.pow(t, 0.85)); };
function lmLatgola(K) {
  const f = LMF.lat, ops = [], G = K.plain, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const GREY = hb('#b3b7b5'), BEIGE = hb('#ead6a8'), BACK = hb('#d8d2c2'), YEL = hb('#f2d15a'), CAP = hb('#e4e5e2'), STEEL = hb('#8e9396'), FRAME = hb('#8f989e');
  const grey = { tex: 1, col: GREY }, beige = { tex: 1, col: BEIGE }, back = { tex: 1, col: BACK }, yel = { tex: 1, col: YEL, plinth: 0.4, pcol: hb('#8d8f90') };
  const byFace = (a, b) => Math.abs(b[1] - a[1]) < 0.01 && a[1] > 51 ? beige : Math.abs(b[0] - a[0]) < 0.01 && a[0] > 19 ? back : grey;
  // ground floor: shop windows, slatted bays, the hotel entrance
  for (let k = 0; k < 16; k++) lmOp(ops, 0, (k + 0.5) * 3.6625, 3.6625, 0.05, 4.15, k === 7 || k === 8 ? 'latDoor' : k % 4 === 3 ? 'latSlat' : 'latStore', { d: 0.3, lit: true });
  for (let fl = 2; fl <= 10; fl++) {
    const y = LAT_FL(fl);
    lmOp(ops, 0, 3.6, 1.25, y + 0.85, y + 2.1, 'latSq', { d: 0.12, lit: lmLit(0.5) });           // stair window in the north-west end
    lmOp(ops, 5.1, -1.75, 1.0, y + 1.0, y + 2.0, 'latSq', { d: 0.12, lit: lmLit(0.4) });
    lmOp(ops, 12.25, -3.5, 1.0, y + 1.0, y + 2.0, 'latSq', { d: 0.12, lit: lmLit(0.4) });
    for (let g = 0; g < 6; g++) for (let k = 0; k < 3; k++) {                                     // rooms: six groups of three windows
      if ((g === 3 || g === 4) && (fl === 7 || fl === 8)) continue;
      lmOp(ops, 0, 7.2 + g * 7.367 + (k + 0.5) * 2.4557, 2.4557, y, y + 2.9, 'lat' + (fl % 2 ? 'A' : 'B') + 'LMR'[k], { d: 0.03, lit: lmLit(0.42) });
    }
    for (let c = 0; c < 6; c++) lmOp(ops, 0, 51.4 + (c + 0.5) * 1.2, 1.2, y, y + 2.9, 'latCurt', { d: 0.03, lit: true });   // glazed stair and lift hall
    if (fl >= 4) { lmOp(ops, 9.6, 58.6, 1.4, y, y + 2.9, 'latStripO', { d: 0.05, lit: lmLit(0.5) }); lmRow(ops, 19.4, 57, 19.4, -2, 20, 1.9, y + 0.75, y + 2.25, 'latBackW', () => ({ d: 0.15, lit: lmLit(0.4) })); }
  }
  lmOp(ops, 0, 36.68, 14.74, 18.7, 24.5, 'latFrameGl', { d: 0.4, lit: lmLit(0.8) });               // the framed two-storey window
  lmOp(ops, 3.1, 58.6, 3.2, 0.05, 4.15, 'latStore', { d: 0.3, lit: true });
  lmOp(ops, 0, 3.6, 1.25, 31.0, 32.25, 'latSq', { d: 0.12, lit: lmLit(0.5) });
  for (let c = 0; c < 6; c++) for (const [y0, y1] of [[30.3, 33.2], [33.2, 36.1]]) lmOp(ops, 0, 51.4 + (c + 0.5) * 1.2, 1.2, y0, y1, 'latCurt', { d: 0.03, lit: true });
  lmOp(ops, 9.6, 58.6, 1.4, 30.3, 33.2, 'latStripO', { d: 0.05, lit: lmLit(0.5) });
  // annex with the PLAZA entrance and its glass vestibule
  for (const [v, w, tile] of [[60.35, 1.7, 'mallGlass'], [62.05, 1.7, 'mallGlass'], [64.65, 3.5, 'mallDoor'], [67.25, 1.7, 'mallGlass'], [68.95, 1.7, 'mallGlass']]) lmOp(ops, -0.5, v, w, 0, 3.3, tile, { d: 0.03, lit: true });
  lmRow(ops, -0.5, 69.8, 6.35, 69.8, 4, 1.71, 0, 3.3, 'mallGlass', { d: 0.03, lit: true }); lmRow(ops, 6.35, 59.5, -0.5, 59.5, 4, 1.71, 0, 3.3, 'mallGlass', { d: 0.03, lit: true });
  // shopping centre
  const MALL = [[19.4, -3.5], [84.2, -3.2], [87.4, -3.2], [86.4, 61.6], [82.7, 65.7], [79.1, 69.6], [23.4, 68.8], [19.3, 68.8]];
  const seg = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], se = u => seg([23.4, 68.8], [79.1, 69.6], (u - 23.4) / 55.7);
  for (let c = 0; c < 10; c++) for (const [y0, y1] of [[0, 2.45], [2.45, 4.9], [4.9, 7.35], [7.35, 9.8]]) { const p = se(33 + (c + 0.5) * 1.4); lmOp(ops, p[0], p[1], 1.4, y0, y1, 'mallGlass', { d: 0.03, lit: true }); }
  { const p = se(52); lmOp(ops, p[0], p[1], 4.0, 0, 3.6, 'mallDoor', { d: 0.4, lit: true }); }
  for (const u of [63, 67, 71, 75]) { const p = se(u); lmOp(ops, p[0], p[1], 3.6, 0.3, 3.9, 'mallStore', { d: 0.25, lit: true }); }
  { const p = seg(MALL[3], MALL[4], 0.5); lmOp(ops, p[0], p[1], 3.6, 0.3, 3.9, 'mallStore', { d: 0.25, lit: true }); const q = seg(MALL[4], MALL[5], 0.5); lmOp(ops, q[0], q[1], 4.0, 0, 3.6, 'mallDoor', { d: 0.4, lit: true }); }
  { const a = seg(MALL[2], MALL[3], 0.08), b = seg(MALL[2], MALL[3], 0.92); lmRow(ops, a[0], a[1], b[0], b[1], 8, 3.6, 0.3, 3.9, 'mallStore', { d: 0.25, lit: true }); }
  { const a = seg(MALL[0], MALL[1], 0.1), b = seg(MALL[0], MALL[1], 0.75); lmRow(ops, a[0], a[1], b[0], b[1], 6, 3.6, 0.3, 3.9, 'mallStore', { d: 0.25, lit: true }); const c = seg(MALL[0], MALL[1], 0.88); lmOp(ops, c[0], c[1], 3.0, 0, 3.2, 'mallService', { d: 0.2 }); }

  const blocks = [
    { poly: [[0, 0], [0, 58.6], [19.4, 58.6], [19.4, -3.5], [5.1, -3.5], [5.1, 0]], top: 30.3, st: byFace, roof: hb('#9b9d9c') },
    { poly: [[0, 0], [0, 7.2], [19.4, 7.2], [19.4, -3.5], [5.1, -3.5], [5.1, 0]], y0: 30.3, top: 33.7, st: grey },
    { poly: [[0, 51.4], [0, 58.6], [19.4, 58.6], [19.4, 51.4]], y0: 30.3, top: 35.4, st: byFace },
    { poly: [[2, 52.4], [2, 57.6], [11, 57.6], [11, 52.4]], y0: 36.0, top: 38.2, st: { tex: 1, col: hb('#dcdcd6') } },
    { poly: [[6.3, 58.6], [6.4, 69.0], [19.3, 68.8], [19.3, 58.6]], top: 8.4, st: yel, cornice: [[8.4, 9.0, 0.12, hb('#b9bcbd')]], roof: hb('#77797a'), roofY: 9.0 },
    { poly: [[-0.5, 59.5], [-0.5, 69.8], [6.35, 69.8], [6.35, 59.5]], top: 3.3, st: yel },
    { poly: MALL, top: 9.8, st: yel, cornice: [[9.8, 10.5, 0.15, hb('#a9adb0')]], roof: hb('#6f7173'), roofY: 10.5 }
  ];
  for (const b of blocks) lmBlock(K, f, b, ops);
  // frame around the two-storey window
  lmBoxL(G, f, -0.35, 0.02, 28.5, 44.85, 24.5, 25.3, FRAME); lmBoxL(G, f, -0.35, 0.02, 28.5, 44.85, 17.9, 18.7, FRAME);
  lmBoxL(G, f, -0.35, 0.02, 28.5, 29.31, 18.7, 24.5, FRAME, false); lmBoxL(G, f, -0.35, 0.02, 44.05, 44.85, 18.7, 24.5, FRAME, false);
  // canopy over the ground floor
  lmBoxL(G, f, -1.7, 0.02, 0, 58.6, 4.15, 4.45, CAP);
  // glazed top floor under the wave
  for (let m = 0; m < 18; m++) {
    const v0 = 7.2 + m * 2.4557, v1 = v0 + 2.4557, t = LMT.latTop, lit = lmLit(0.85) ? 1 : 0;
    K.det.q(at(1.2, v0, 30.3), at(1.2, v1, 30.3), at(1.2, v1, latWave(v1)), at(1.2, v0, latWave(v0)), [-f[2], 0, -f[3]], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, lit);
    K.det.q(at(19.4, v1, 30.3), at(19.4, v0, 30.3), at(19.4, v0, latWave(v0)), at(19.4, v1, latWave(v1)), [f[2], 0, f[3]], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, lit);
    const r = LMT.latRail; K.det.q(at(0.08, v0, 30.3), at(0.08, v1, 30.3), at(0.08, v1, 31.4), at(0.08, v0, 31.4), [-f[2], 0, -f[3]], [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1], LMWHITE, 0);
    const l = LMT.latLight, vm = (v0 + v1) / 2, yl = latWave(vm) - 0.03;
    K.det.q(at(-1.05, vm - 0.17, yl), at(-0.7, vm - 0.17, yl), at(-0.7, vm + 0.17, yl), at(-1.05, vm + 0.17, yl), [0, -1, 0], [l.u0, l.v0, l.u1, l.v0, l.u1, l.v1, l.u0, l.v1], LMWHITE, 1);
  }
  { const A = at(0.08, 7.2, 31.42), B = at(0.08, 51.4, 31.42); lmBar(G, A, B, 0.07, STEEL); }
  // the wave: a thin roof over the top floor, flat over the north-west stair block
  const vs = [-0.6, 7.2]; for (let k = 1; k <= 44; k++) vs.push(7.2 + 44.2 * k / 44);
  const hc = v => v <= 7.2 ? 33.7 : latWave(v), TH = 0.5;
  for (let k = 0; k < vs.length - 1; k++) {
    const va = vs[k], vb = vs[k + 1], ya = hc(va), yb = hc(vb);
    polyA(G, [at(-1.6, va, ya), at(20.6, va, ya), at(20.6, vb, yb), at(-1.6, vb, yb)], hb('#cfd1cf'), 0, -1, 0);
    polyA(G, [at(-1.6, va, ya + TH), at(20.6, va, ya + TH), at(20.6, vb, yb + TH), at(-1.6, vb, yb + TH)], hb('#c9cbca'), 0, 1, 0);
    polyA(G, [at(-1.6, va, ya), at(-1.6, vb, yb), at(-1.6, vb, yb + TH), at(-1.6, va, ya + TH)], CAP, -f[2], 0, -f[3]);
    polyA(G, [at(20.6, va, ya), at(20.6, vb, yb), at(20.6, vb, yb + TH), at(20.6, va, ya + TH)], CAP, f[2], 0, f[3]);
  }
  polyA(G, [at(-1.6, -0.6, 33.7), at(20.6, -0.6, 33.7), at(20.6, -0.6, 34.2), at(-1.6, -0.6, 34.2)], CAP, f[3], 0, -f[2]);
  // caps of the south-east block and of the machine room, the clock
  lmBoxL(G, f, -1.0, 20.4, 50.4, 59.6, 35.4, 36.0, CAP); lmBoxL(G, f, 1.4, 11.6, 51.8, 58.2, 38.2, 38.55, CAP);
  lmSign(K, f, [1.97, 53.1], [1.97, 56.9], 36.45, 37.85, null, 0, K.clk, { u0: 0, u1: 1, v0: 0, v1: 1 });
  lmBoxL(G, f, 1.97, 2.02, 52.95, 57.05, 36.3, 38.0, hb('#2a2c2e'));
  // lettering: HOTEL on the roof, PLAZA over the side entrance, the Latgola sign of the shopping centre
  lmSign(K, f, [-0.3, -0.4], [-0.3, 6.6], 34.3, 36.1, 'hotel', 1);
  { const [x, z] = lmW(f, 0.1, -0.2), [x2, z2] = lmW(f, 0.1, 6.4); lmBar(G, [x, 34.2, z], [x2, 34.2, z2], 0.08, STEEL); }
  lmSign(K, f, [6.265, 61.2], [6.315, 66.4], 4.6, 6.2, 'plaza', 1);
  lmBoxL(G, f, -1.1, 6.35, 59.0, 70.3, 3.3, 3.55, CAP);
  { const pl = se(22.4), pr = se(31.6); lmSign(K, f, [pl[0], pl[1] + 0.06], [pr[0], pr[1] + 0.06], 4.4, 8.6, 'latgola', 1); }
  { const p = se(57.5), t = LMT.mallSigns; lmBoxL(G, f, p[0] - 1.05, p[0] + 1.05, p[1], p[1] + 0.15, 1.4, 8.6, hb('#2e3134')); lmSign(K, f, [p[0] - 1.0, p[1] + 0.16], [p[0] + 1.0, p[1] + 0.16], 1.5, 8.5, null, 1, K.det, t); }
  { const F = lmWF(lmW(f, 79.1, 69.6), lmW(f, 23.4, 68.8)), s = 79.1 - 52; lmBoxW(G, F, s - 2.4, s + 2.4, 3.75, 3.95, -1.6, 0, hb('#5a5f63')); }
  // roof plant on the shopping centre
  for (const [u0, u1, v0, v1, h] of [[40, 44, 20, 23, 1.6], [60, 65, 35, 38, 1.3], [55, 58, 10, 12, 1.1], [70, 74, 50, 54, 1.5], [30, 33, 45, 49, 1.2]]) lmBoxL(G, f, u0, u1, v0, v1, 10.5, 10.5 + h, hb('#9da1a3'), false);
}

export { lmLatgola };
