import { STATE } from '../core/state.js';
import { sphereProf } from './culture-palace.js';
import { lmHip, lmRegisterOutline } from './tv-tower.js';
import { lmEdgeBox, lmFoot } from './university.js';
import { lmBar, lmBlock, lmBoxL, lmLathe, lmLit, lmOp } from './helpers.js';
import { LMT } from './tiles.js';
import { LMF, LMWHITE, lmW } from './core.js';
import { TERR, terrainH } from '../world/terrain.js';
import { hb, sh } from '../core/util.js';

/* ---- Heat plant No. 1 (siltumcentrāle Nr. 1), 18. novembra iela 2 ----
   The city's first power station, "Elektriskā spēkstacija", built by a Berlin electricity company and switched on at
   the end of 1911; blown up in August 1944 and rebuilt in 1945, a district power station until its turbines were taken
   out in 1980, since 1992 heat plant No. 1 of Daugavpils siltumtīkli, whose office is next door at No. 4; an
   architectural monument. OpenStreetMap gives the outline (way 173318931) and the 100 m chimney (node 1435408094);
   massing and façades follow Google Street View and satellite views (2024) and LSM photographs: red brick with white
   bands, steel multi-pane windows in bays between pilasters; a four-storey range on the street with a low annex of
   light brick and two bricked-up arches in a recess of its front, the boiler hall behind it with three roof lanterns
   and solar panels, a seven-storey tower with framed windows at the hall's south-west corner, the old hall with tall
   round-arched windows under a hipped roof on the west side, lower wings to the east and south; the chimney just south
   of the tower with two galleries, antennas and red and white bands. Frame sc: origin at the
   north-west corner on 18. novembra iela, u east along the street, v south towards the river. */
function lmSC(K) {
  const f = LMF.sc, G = K.plain, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const BR = { tex: 3, col: [224, 212, 202] }, CREAM = { tex: 1, col: hb('#dccfb2'), plinth: 0.5, pcol: hb('#a39a88') }, SIL = { tex: 1, col: hb('#c6c2b8'), plinth: 0.5, pcol: hb('#9c978e') };
  const WH = hb('#d8d2c4'), ROOF = hb('#55575a'), RUST = hb('#6e5446'), STEEL = hb('#55595d'), PIL = hb('#7a3b2b'), LANT = hb('#c9cccd');
  const OUT = [[21.3, 55.2], [33.6, 55.2], [33.6, 39.6], [20.5, 39.6], [20.4, 44.9], [9, 44.8], [8.9, 39], [-11, 39], [-11, 41], [-17.8, 41], [-17.8, 31.1], [-22.4, 32.3], [-26.3, 24.2], [-16.4, 20.5], [-13.9, 27.9], [-13.9, 9.9], [0, 9.9], [0, 0], [42.7, 0], [42.7, 33.6], [47.4, 33.5], [47.5, 69.2], [33.5, 69.2], [33.5, 65.6], [21.3, 65.6]];
  if (TERR.on) { let lo = 1e9, hi = -1e9; for (const [u, v] of OUT) { const [x, z] = lmW(f, u, v), t = terrainH(x, z); lo = Math.min(lo, t); hi = Math.max(hi, t); }
    const base = Math.min(hi - 0.15, lo + 2.5); STATE.GBC = (x, y, z) => { const t = terrainH(x, z); return y <= 0.05 ? Math.min(base, t) - 0.25 - t - y : base - t; }; }
  const win = (o) => Object.assign({ d: 0.3, sill: WH, lit: lmLit(0.3) }, o || {});
  // brick pilasters on a wall a→b (local), the inside point telling which way is out
  const pil = (a, b, inside, ss, y0, y1, w = 0.7) => { for (const s of ss) lmEdgeBox(G, f, a, b, inside, s - w / 2, s + w / 2, y0, y1, 0, 0.3, PIL); };
  // tower at the south-west corner of the boiler hall, in front of the chimney: a tall window in a projecting frame on
  // every floor of its west front above the arched hall, the top floor a blind panel
  { const o = [], a = [0, 27.6], b = [0, 39.6], Y = fl => 1.2 + fl * 3.75;
    for (let fl = 2; fl < 6; fl++) lmOp(o, 0, 33.6, 3.0, Y(fl), Y(fl) + 2.9, 'scTall', win());
    lmOp(o, 0, 33.6, 3.2, 23.0, 25.3, null, { d: 0.25 });
    for (let fl = 1; fl < 7; fl++) lmOp(o, 4, 39.6, 2.2, Y(fl) + 0.2, Y(fl) + 2.6, 'scWinB', win()); lmOp(o, 4, 39.6, 2.4, 0, 3.0, 'scDoor', { d: 0.15 });
    for (const fl of [5, 6]) { for (const u of [3, 9]) lmOp(o, u, 27.6, 2.0, Y(fl) + 0.2, Y(fl) + 2.6, 'scWinB', win()); for (const v of [30.5, 36.5]) lmOp(o, 12, v, 2.0, Y(fl) + 0.2, Y(fl) + 2.6, 'scWinB', win()); }
    lmBlock(K, f, { poly: [[0, 27.6], [12, 27.6], [12, 39.6], [0, 39.6]], top: 26.5, st: BR, cornice: [[15.8, 16.2, 0.12, WH], [26.1, 26.5, 0.15, WH]], roof: ROOF, roofY: 26.5 }, o);
    pil(a, b, [6, 33.6], [4.15, 7.85], 7.0, 25.6, 0.5); lmEdgeBox(G, f, a, b, [6, 33.6], 4.4, 7.6, 22.75, 23.0, 0, 0.3, PIL);
    lmEdgeBox(G, f, a, b, [6, 33.6], 4.4, 7.6, 23.0, 25.3, -0.3, -0.25, hb('#8a4634')); }
  // the four-storey range on the street: steel windows in bays between pilasters, a white band; the annex of light
  // brick stands in a recess of its front
  { const o = [], rows = [[1.6, 6.0, 'scWin'], [8.2, 12.6, 'scWin'], [13.6, 16.2, 'scWinB']];
    for (const u of [3.5, 9.5, 33.5]) for (const [y0, y1, t] of rows) lmOp(o, u, 0, 2.6, y0, y1, t, win());
    for (const u of [16, 22, 28]) for (const [y0, y1, t] of rows.slice(1)) lmOp(o, u, 5, 2.6, y0, y1, t, win());
    for (const [y0, y1, t] of rows) lmOp(o, 0, 4.5, 2.6, y0, y1, t, win()); for (const [y0, y1, t] of rows.slice(1)) lmOp(o, 0, 11.8, 2.6, y0, y1, t, win());
    lmOp(o, 36, 9.5, 2.6, 9.8, 14.2, 'scWin', win());
    lmBlock(K, f, { poly: [[0, 0], [13, 0], [13, 5], [31, 5], [31, 0], [36, 0], [36, 14], [0, 14]], top: 17, st: BR, cornice: [[12.9, 13.3, 0.1, WH], [16.6, 17, 0.14, WH]], roof: ROOF, roofY: 17,
      wy0: lmFoot([[[13, 0], [13, 5], 7.5], [[13, 5], [31, 5], 7.5], [[31, 5], [31, 0], 7.5], [[36, 14], [0, 14], 99]]) }, o);
    pil([0, 0], [13, 0], [6, 7], [0.35, 6.5, 12.65], 0, 16.6); pil([13, 5], [31, 5], [20, 10], [0.35, 6, 12, 17.65], 7.5, 16.6); pil([31, 0], [36, 0], [33, 7], [0.35, 4.65], 0, 16.6); }
  // the annex of light brick in front: two arches bricked up in red, small windows, a door
  { const o = []; for (const u of [20.5, 24.5]) lmOp(o, u, 0, 3.0, 1.6, 5.4, 'scArch', { d: 0.15 });
    for (const u of [15.2, 17.4]) lmOp(o, u, 0, 1.4, 2.2, 4.0, 'scSmall', win({ d: 0.2 })); lmOp(o, 28.5, 0, 2.4, 0, 3.0, 'scDoor', { d: 0.15 });
    lmBlock(K, f, { poly: [[13, 0], [31, 0], [31, 5], [13, 5]], top: 7.5, st: SIL, cornice: [[7.1, 7.5, 0.1, hb('#b9b4a8')]], roof: ROOF, roofY: 7.5, wy0: lmFoot([[[13, 5], [31, 5], 99]]) }, o); }
  // the boiler hall: tall steel windows in bays on its free sides, three lanterns and solar panels on the roof
  { const o = [], bay = 5.6, rows = [[2.0, 6.4, 'scWin'], [8.6, 13.0, 'scWin'], [14.4, 17.0, 'scWinB']];
    for (const u of [14.8, 20.4, 26.0, 31.4]) for (const [y0, y1, t] of rows) if (y0 > 8 || u - 1.3 > 20.4) lmOp(o, u, 39.6, 2.6, y0, y1, t, win());
    for (const v of [17.4, 23.2]) for (const [y0, y1, t] of rows.slice(1)) lmOp(o, 0, v, 2.6, y0, y1, t, win());
    for (const v of [17, 22.6, 28.2]) for (const [y0, y1, t] of rows.slice(1)) lmOp(o, 36, v, 2.6, y0, y1, t, win());
    lmBlock(K, f, { poly: [[0, 14], [36, 14], [36, 33.6], [33.6, 33.6], [33.6, 39.6], [12, 39.6], [12, 27.6], [0, 27.6]], top: 18, st: BR, cornice: [[13.5, 13.9, 0.1, WH], [17.6, 18, 0.14, WH]], roof: ROOF, roofY: 18,
      wy0: lmFoot([[[0, 14], [36, 14], 17], [[12, 39.6], [12, 27.6], 99], [[12, 27.6], [0, 27.6], 99]]) }, o);
    pil([12, 39.6], [33.6, 39.6], [20, 30], [0.35, 5.6, 11.2, 16.8, 21.25], 0, 17.6);
    for (const [u0, u1, v0, v1] of [[10.5, 13.5, 18, 26], [18.5, 21.5, 17, 25], [30.5, 33.5, 15.5, 23.5]]) { lmBoxL(G, f, u0, u1, v0, v1, 18, 18.8, LANT, false); lmHip(G, f, u0, u1, v0, v1, 18.8, 1.1, sh(LANT, 0.92), 0.15); }
    const t = LMT.scPV, ev = [-f[3], f[2]], k = Math.sin(0.36), n = [ev[0] * k, Math.cos(0.36), ev[1] * k], free = (u0, u1, v0, v1) => ![[10.5, 13.5, 18, 26], [18.5, 21.5, 17, 25], [30.5, 33.5, 15.5, 23.5]].some(([a, b, c, d]) => u0 < b + 0.5 && u1 > a - 0.5 && v0 < d + 0.5 && v1 > c - 0.5);
    for (const v of [15.2, 18.4, 21.6, 24.8, 28.0, 31.2, 34.4, 37.0]) for (let u = v + 1.6 > 27.6 ? 12.5 : 1; u + 6 <= (v > 33 ? 33.2 : 35.2); u += 6.3) { if (!free(u, u + 6, v, v + 1.6)) continue;
      K.det.q(at(u, v + 1.6, 18.25), at(u + 6, v + 1.6, 18.25), at(u + 6, v, 18.85), at(u, v, 18.85), n, [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, 0);
      lmBoxL(G, f, u, u + 6, v + 0.2, v + 1.4, 18, 18.25, STEEL, false); } }
  // the narrow east block under a rusty roof, the south-east wing, the small block by the chimney, the low west annex
  { const o = []; for (let k = 0; k < 7; k++) { const v = 2.5 + k * 4.6; for (const y of [1.4, 5.4]) lmOp(o, 42.7, v, 2.2, y, y + 2.4, 'scWinB', win()); }
    lmOp(o, 39.3, 0, 2.4, 0, 3.0, 'scDoor', { d: 0.15 }); lmOp(o, 39.3, 0, 2.2, 5.4, 7.8, 'scWinB', win());
    lmBlock(K, f, { poly: [[36, 0], [42.7, 0], [42.7, 33.6], [36, 33.6], [36, 5]], top: 9, st: CREAM, cornice: [[8.6, 9, 0.12, WH]], roof: RUST, roofY: 9, wy0: lmFoot([[[36, 33.6], [36, 5], 99]]) }, o); }
  { const o = []; for (let k = 0; k < 8; k++) { const v = 37 + k * 4.2; for (const y of [1.2, 4.8]) lmOp(o, 47.5, v, 2.0, y, y + 2.2, 'scSmall', win()); }
    for (let k = 0; k < 3; k++) for (const y of [1.2, 4.8]) lmOp(o, 37 + k * 3.8, 69.2, 2.0, y, y + 2.2, 'scSmall', win());
    for (let k = 0; k < 3; k++) lmOp(o, 33.6, 43 + k * 4, 2.0, 4.8, 7.0, 'scSmall', win()); lmOp(o, 33.6, 51.5, 2.4, 0, 3.0, 'scDoor', { d: 0.15 });
    lmBlock(K, f, { poly: [[33.6, 33.6], [47.5, 33.6], [47.5, 69.2], [33.5, 69.2], [33.5, 65.6], [21.3, 65.6], [21.3, 55.2], [33.6, 55.2]], top: 8.5, st: CREAM, cornice: [[8.1, 8.5, 0.1, WH]], roof: ROOF, roofY: 8.5 }, o); }
  { const o = []; for (const u of [11.5, 17.5]) lmOp(o, u, 44.9, 2.2, 4.4, 6.8, 'scWinB', win()); lmOp(o, 14.5, 44.9, 2.4, 0, 3.0, 'scDoor', { d: 0.15 });
    lmBlock(K, f, { poly: [[8.9, 39.6], [20.4, 39.6], [20.4, 44.9], [8.9, 44.9]], top: 8, st: BR, cornice: [[7.6, 8, 0.1, WH]], roof: ROOF, roofY: 8, wy0: lmFoot([[[8.9, 39.6], [20.4, 39.6], 99]]) }, o); }
  // the old hall on the west side: tall round-arched windows in white surrounds, a white frieze, a hipped roof
  { const o = [], arch = () => ({ d: 0.25, lit: lmLit(0.3) });
    for (const v of [12.2, 15.2, 18.2, 21.2, 24.2]) lmOp(o, -13.9, v, 1.6, 1.4, 5.4, 'scArchWin', arch());
    for (const u of [-11.2, -8.2, -5.2, -2.2]) lmOp(o, u, 9.9, 1.6, 1.4, 5.4, 'scArchWin', arch());
    for (const u of [-9, -3]) lmOp(o, u, 39, 1.6, 1.4, 5.4, 'scArchWin', arch()); lmOp(o, -6, 39, 2.4, 0, 3.0, 'scDoor', { d: 0.15 }); lmOp(o, -21, 22.22, 2.4, 0, 3.0, 'scDoor', { d: 0.15 });
    lmBlock(K, f, { poly: [[0, 9.9], [0, 39], [-11, 39], [-11, 41], [-17.8, 41], [-17.8, 31.1], [-22.4, 32.3], [-26.3, 24.2], [-16.4, 20.5], [-13.9, 27.9], [-13.9, 9.9]], top: 7, st: BR, cornice: [[0, 0.55, 0.06, WH], [6.3, 7, 0.12, WH]], roof: ROOF, roofY: 7,
      wy0: lmFoot([[[0, 9.9], [0, 39], 99]]) }, o);
    lmHip(G, f, -13.9, 0, 9.9, 39, 7, 3.0, hb('#6f6b66'), 0.35); }
  // the chimney, 100 m: weathered concrete, red and white bands of 9 m above 46 m, two galleries with antennas,
  // a ladder up the side towards the street
  { const [cx, cz] = lmW(f, 8.7, 52), r = h => 4.3 - 0.018 * h, sec = (h0, h1, col) => lmLathe(G, cx, cz, h0, [[r(h0), 0], [r(h1), h1 - h0]], 24, col);
    const CON = [hb('#a59d90'), hb('#9b9386'), hb('#aaa294')];
    for (let k = 0; k < 4; k++) sec(k * 11.5, (k + 1) * 11.5, CON[k % 3]);
    for (let k = 0; k < 6; k++) sec(46 + k * 9, 46 + (k + 1) * 9, k % 2 ? hb('#8a5446') : hb('#c9c2b6'));
    lmLathe(G, cx, cz, 100, [[r(100), 0], [r(100) + 0.15, 0], [r(100) + 0.15, 0.6], [r(100) - 0.3, 0.6], [r(100) - 0.3, 0.1], [0, 0.1]], 24, STEEL);
    for (const h of [62, 87]) { const R0 = r(h);
      lmLathe(G, cx, cz, h, [[R0, 0], [R0 + 1.2, 0], [R0 + 1.2, 0.2], [R0, 0.2]], 24, STEEL);
      lmLathe(G, cx, cz, h + 1.05, [[R0 + 1.15, 0], [R0 + 1.22, 0], [R0 + 1.22, 0.07], [R0 + 1.15, 0.07]], 24, STEEL);
      for (let k = 0; k < 12; k++) { const a = k / 12 * 2 * Math.PI, x = cx + Math.cos(a) * (R0 + 1.18), z = cz + Math.sin(a) * (R0 + 1.18); lmBar(G, [x, h + 0.2, z], [x, h + 1.1, z], 0.05, STEEL); }
      if (h < 70) for (let k = 0; k < 3; k++) { const a = 0.4 + k * 2.1, x = cx + Math.cos(a) * (R0 + 0.8), z = cz + Math.sin(a) * (R0 + 0.8); lmBar(G, [x, h + 0.4, z], [x, h + 2.6, z], 0.32, hb('#e4e4e0')); } }
    const nv = [f[3], -f[2]], L0 = [cx + nv[0] * (r(0) + 0.3), 0, cz + nv[1] * (r(0) + 0.3)], L1 = [cx + nv[0] * (r(100) + 0.3), 100, cz + nv[1] * (r(100) + 0.3)];
    lmBar(G, L0, L1, 0.14, hb('#4a4d50')); }
  lmRegisterOutline(f, OUT);
  STATE.GBC = null;
}

function lmCandelabrum(G, Gl, x, z, y0, rot) {
  const IRON = hb('#262b2f'), GLOBE = hb('#f4f1e8');
  lmLathe(G, x, z, y0, [[0.36, 0], [0.36, 0.1], [0.3, 0.16], [0.3, 0.5], [0.24, 0.62], [0.26, 0.7], [0.17, 0.86], [0.14, 1.0]], 12, IRON);
  lmLathe(G, x, z, y0 + 1.0, [[0.14, 0], [0.12, 2.2], [0.16, 2.28], [0.16, 2.36], [0.1, 2.42], [0.08, 2.5], [0.07, 3.6]], 12, IRON);
  for (let k = 0; k < 4; k++) {
    const a = rot + Math.PI / 4 + k * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), Pt = (r, y) => [x + c * r, y0 + y, z + s * r];
    lmBar(G, Pt(0.07, 2.75), Pt(0.35, 2.95), 0.05, IRON); lmBar(G, Pt(0.35, 2.95), Pt(0.62, 3.0), 0.05, IRON); lmBar(G, Pt(0.62, 3.0), Pt(0.72, 3.12), 0.05, IRON); lmBar(G, Pt(0.08, 2.55), Pt(0.35, 2.95), 0.035, IRON);
    const [gx, , gz] = Pt(0.72, 0);
    lmLathe(G, gx, gz, y0 + 3.1, [[0.04, 0], [0.1, 0.06], [0.12, 0.12]], 10, IRON); lmLathe(Gl, gx, gz, y0 + 3.13, sphereProf(0.2), 12, GLOBE);
  }
  lmLathe(G, x, z, y0 + 3.6, [[0.07, 0], [0.13, 0.08], [0.14, 0.14]], 10, IRON); lmLathe(Gl, x, z, y0 + 3.63, sphereProf(0.23), 12, GLOBE);
}
// bench with its seat along v; the sitter looks towards +u (face 1) or -u (face -1)
function lmBench(G, f, u, v, face) {
  const WOODC = hb('#8a5a36'), IRONC = hb('#2b2f33');
  for (const dv of [-0.75, 0.75]) { lmBoxL(G, f, u - 0.24, u + 0.24, v + dv - 0.035, v + dv + 0.035, 0, 0.43, IRONC, false); const ub = u - face * 0.25; lmBoxL(G, f, ub - 0.03, ub + 0.03, v + dv - 0.035, v + dv + 0.035, 0.43, 0.88, IRONC, false); }
  for (let k = 0; k < 3; k++) { const uu = u - 0.16 + k * 0.16; lmBoxL(G, f, uu - 0.065, uu + 0.065, v - 0.9, v + 0.9, 0.43, 0.47, WOODC); }
  for (let k = 0; k < 2; k++) { const ub = u - face * 0.27; lmBoxL(G, f, ub - 0.025, ub + 0.025, v - 0.9, v + 0.9, 0.55 + k * 0.16, 0.66 + k * 0.16, WOODC); }
}

export { lmBench, lmCandelabrum, lmSC };
