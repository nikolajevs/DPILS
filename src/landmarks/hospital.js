import { lmSign } from './unity-house.js';
import { LMF, lmW } from './core.js';
import { lmBlock, lmBar, lmBoxL, lmLathe, lmLit, lmOp, lmRow } from './helpers.js';
import { polyA } from '../core/geometry.js';
import { TERR, terrainH } from '../world/terrain.js';
import { STATE } from '../core/state.js';
import { hb } from '../core/util.js';

/* Daugavpils Regional Hospital, Vasarnīcu iela 20. The OSM footprint is only the central core, so the tower and
   connected low wings are reconstructed from Ministry, hospital and city photographs. Dimensions and unseen details
   remain approximate; the radio-therapy block follows its mapped outline and current extension. */
const HF = LMF.hosp;             // u east, v south
const RF = LMF.rt;
const PANEL = hb('#e0e2dd'), PANEL_DK = hb('#b7c2c3'), CEM = hb('#c5cbca');
const WHITE = hb('#edf0ed'), STEEL = hb('#536269'), ASPH = hb('#686d6d'), PAVE = hb('#b9b8b0');
const pt = (f, u, v, y = 0) => { const p = lmW(f, u, v); return [p[0], y, p[1]]; };

function rect(G, f, u0, u1, v0, v1, y, col) {
  polyA(G, [pt(f, u0, v0, y), pt(f, u1, v0, y), pt(f, u1, v1, y), pt(f, u0, v1, y)], col, 0, 1, 0);
}
function strip(G, f, local, half, y, col) {
  if (local.length < 2) return;
  const pts = local.map(([u, v]) => pt(f, u, v, y)), n = pts.length, start = G.v; G.ensure(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let dx = pts[b][0] - pts[a][0], dz = pts[b][2] - pts[a][2], l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    G.vert(pts[i][0] - nx * half, y, pts[i][2] - nz * half, 0, 1, 0, col); G.vert(pts[i][0] + nx * half, y, pts[i][2] + nz * half, 0, 1, 0, col);
  }
  for (let i = 0; i < n - 1; i++) { const k = start + 2 * i; G.triUp(k, k + 1, k + 3); G.triUp(k, k + 3, k + 2); }
}
function beam(G, f, a, b, w, col) { lmBar(G, pt(f, ...a), pt(f, ...b), w, col); }

function tower(K) {
  const ops = [], sill = hb('#aeb8ba'), plan = [[-27, -8.2], [27, -8.2], [27, 8.2], [-27, 8.2]];
  for (let floor = 0; floor < 12; floor++) {
    const y0 = 3.15 + floor * 2.92, y1 = y0 + 1.72;
    const tile = i => (floor + i) % 5 === 0 ? 'hsWinB' : 'hsWin';
    const win = () => ({ d: 0.24, sill, lit: lmLit(0.16), rcol: PANEL_DK });
    lmRow(ops, -25.7, -8.2, 25.7, -8.2, 18, 1.74, y0, y1, tile, win);
    lmRow(ops, -25.7, 8.2, 25.7, 8.2, 18, 1.74, y0, y1, tile, win);
    lmRow(ops, 27, -6.4, 27, 6.4, 4, 1.45, y0, y1, tile, win);
    // Deep, open balcony recesses on the west end are a distinctive feature in the photographs.
    lmRow(ops, -27, -6.6, -27, 6.6, 1, 12.4, y0 + 0.05, y0 + 1.82, 'hsLoggia', { d: 1.0, lit: false });
  }
  lmBlock(K, HF, { poly: plan, top: 40.2, st: { tex: 5, col: PANEL }, roof: hb('#777f80'), roofY: 40.2,
    cornice: [[39.85, 40.28, 0.32, WHITE]] }, ops);

  // Broad concrete floor bands and the unusually deep, repeated end balconies.
  for (let floor = 0; floor < 12; floor++) {
    const y = 3.0 + floor * 2.92, col = floor % 2 ? PANEL_DK : WHITE;
    for (const [v0, v1] of [[-8.33, -8.12], [8.12, 8.33]]) lmBoxL(K.plain, HF, -27, 27, v0, v1, y, y + 0.15, col);
    for (const v of [-6.3, 6.3]) {
      const ya = 3.2 + floor * 2.92;
      lmBoxL(K.plain, HF, -28.55, -26.9, v - 0.18, v + 0.18, ya, ya + 0.12, CEM);
    }
    if (floor < 11) {
      const ya = 3.25 + floor * 2.92;
      beam(K.plain, HF, [-28.45, -6.0, ya + 1.05], [-28.45, 6.0, ya + 1.05], 0.06, STEEL);
      beam(K.plain, HF, [-28.45, -6.0, ya + 0.12], [-28.45, 6.0, ya + 0.12], 0.045, STEEL);
      for (let v = -6; v <= 6.01; v += 1.2) beam(K.plain, HF, [-28.45, v, ya + 0.12], [-28.45, v, ya + 1.05], 0.04, STEEL);
    }
  }
  // Lift and stair overrun, roof access rail and small exhaust cowls.
  lmBlock(K, HF, { poly: [[-4.2, -2.6], [3.0, -2.6], [3.0, 2.6], [-4.2, 2.6]], y0: 40.2, top: 41.8,
    st: { tex: 5, col: PANEL_DK }, roof: hb('#858b8b'), roofY: 41.8 }, []);
  for (const [u, v, r, h] of [[-10, -5.3, 0.65, 0.95], [10, -5.2, 0.52, 0.8], [-12, 5.5, 0.48, 0.78], [12, 5.3, 0.58, 0.9]]) {
    const w = lmW(HF, u, v); lmLathe(K.plain, w[0], w[1], 40.24, [[r, 0], [r, h], [r * 0.82, h + 0.14]], 8, CEM);
  }
  for (let u = -26; u <= 26.01; u += 5.2) beam(K.plain, HF, [u, -8.05, 40.35], [u, 8.05, 40.35], 0.035, STEEL);
}

function podium(K) {
  const ops = [], sill = hb('#b6bdbb'), plan = [[-66, -14], [-46, -14], [-46, 4], [51, 4], [51, 32], [-66, 32]];
  const rows = [[0.58, 2.2], [3.48, 5.15], [6.38, 8.08]];
  for (const [y0, y1] of rows) {
    // Long public-facing wing. Ground-floor gaps are reserved for the lobby and ambulance bays.
    for (const [a, b, n] of (y0 < 5.2 ? [[-63, 14, 16], [28.5, 34.2, 2]] : [[-63, 14, 16], [28.5, 34.2, 2], [35, 50, 4]]))
      lmRow(ops, a, 32, b, 32, n, 1.75, y0, y1, 'hsWin', { d: 0.2, sill, lit: lmLit(0.2) });
    lmRow(ops, -43, 4, 48, 4, 20, 1.65, y0, y1, 'hsWin', { d: 0.18, sill, lit: lmLit(0.16) });
    lmRow(ops, -66, -11, -66, 28, 9, 1.65, y0, y1, 'hsWin', { d: 0.18, sill, lit: lmLit(0.18) });
    lmRow(ops, 51, 5, 51, 31, 5, 1.55, y0, y1, 'hsWin', { d: 0.18, sill, lit: lmLit(0.18) });
    lmRow(ops, -46, -12, -46, 2, 4, 1.45, y0, y1, 'hsWin', { d: 0.18, sill, lit: lmLit(0.15) });
  }
  // Entrance doors and two recessed ambulance bays share the south elevation.
  lmOp(ops, 21.3, 32, 6.4, 0.28, 3.7, 'hsEntry', { d: 0.32, lit: true });
  lmOp(ops, 39.4, 32, 5.8, 0.22, 4.65, 'hsBay', { d: 0.45, lit: true });
  lmOp(ops, 46.1, 32, 5.8, 0.22, 4.65, 'hsBay', { d: 0.45, lit: true });
  // Thin horizontal clerestory strip beneath the roof parapet.
  lmRow(ops, -62, 32, 49, 32, 33, 2.1, 9.25, 10.05, 'hsSlot', { d: 0.14, lit: lmLit(0.08) });
  lmRow(ops, -43, 4, 48, 4, 28, 1.65, 9.25, 10.05, 'hsSlot', { d: 0.14, lit: lmLit(0.08) });
  const wall = hb('#bfc8c6'), roof = hb('#677375');
  lmBlock(K, HF, { poly: plan, top: 10.55, st: { tex: 5, col: wall }, roof, roofY: 10.55,
    cornice: [[10.25, 10.65, 0.42, hb('#aeb9b8')]] }, ops);

  // Roof plant and parapet details seen on the lower wings.
  for (const [u0, u1, v0, v1, h] of [[-42, -37, 11, 15, 1.15], [-28, -23, 11, 15, 0.9], [0, 5, 13, 17, 1.05], [9, 14, 13, 17, 0.75]])
    lmBoxL(K.plain, HF, u0, u1, v0, v1, 10.58, 10.58 + h, hb('#838d8e'));
  for (let u = -64; u <= 50.01; u += 5) beam(K.plain, HF, [u, 31.9, 10.76], [u + 2.1, 31.9, 10.76], 0.035, STEEL);
}

function entrance(K) {
  const sign = hb('#314a52'), pale = hb('#e0e2dc');
  // Small wall sign above the main glazed door, rather than a large freestanding billboard.
  lmSign(K, HF, [18.3, 32.12], [24.1, 32.12], 4.02, 4.82, 'hospital', 1);
  // Narrow blue-grey canopy, glazed soffit and square steel supports.
  rect(K.plain, HF, 16.5, 27.8, 32.2, 38.7, 5.35, hb('#60757c'));
  lmBoxL(K.plain, HF, 16.5, 27.8, 38.25, 38.75, 4.85, 5.45, sign);
  for (const u of [16.7, 27.6]) for (const v of [32.5, 38.1]) lmBoxL(K.plain, HF, u, u + 0.18, v, v + 0.18, 0.05, 5.15, STEEL);

  // Two covered ambulance bays integrated into the right-hand end of the lower wing.
  rect(K.plain, HF, 34, 51, 32.15, 41.0, 5.1, hb('#55717b'));
  lmBoxL(K.plain, HF, 34, 51, 40.5, 41.05, 4.7, 5.35, sign);
  for (const u of [34.25, 50.7]) for (const v of [32.35, 40.2]) lmBoxL(K.plain, HF, u, u + 0.24, v, v + 0.24, 0.05, 4.9, CEM);

  // Shallow entrance steps, a broad wheelchair ramp, rails, tactile paving and bollards.
  for (let k = 0; k < 5; k++) {
    const v0 = 32.7 + k * 0.82, v1 = v0 + 0.78, h = 0.14 + k * 0.12;
    lmBoxL(K.plain, HF, 17.9, 24.7, v0, v1, 0.04, h, hb('#c5c6c1'));
  }
  polyA(K.plain, [pt(HF, 27.2, 32.7, 0.72), pt(HF, 31.2, 32.7, 0.72), pt(HF, 31.2, 38.0, 0.08), pt(HF, 27.2, 38.0, 0.08)], hb('#c4c6c2'), 0, 1, 0);
  for (const u of [27.2, 31.2]) {
    beam(K.plain, HF, [u, 32.7, 1.55], [u, 38.0, 0.92], 0.055, STEEL);
    for (let v = 33; v < 38; v += 1.05) { const t = (v - 32.7) / 5.3; beam(K.plain, HF, [u, v, 0.72 - t * 0.64], [u, v, 1.5 - t * 0.64], 0.035, STEEL); }
  }
  rect(K.plain, HF, 17.0, 25.6, 38.1, 39.0, 0.08, PAVE);
  for (let u = 18; u < 25.6; u += 1.1) lmBoxL(K.plain, HF, u, u + 0.16, 38.0, 38.22, 0.08, 0.13, hb('#c8bb9c'));
  for (const u of [15.5, 33, 52]) lmBoxL(K.plain, HF, u, u + 0.2, 36.4, 36.6, 0.05, 0.85, hb('#858b87'));

  // A white ambulance idling below the canopy; the body, wheels, red belt and warning lamps are separate pieces.
  const u = 42.6, v = 36.1, white = hb('#e5e8e3'), glass = hb('#627981'), red = hb('#c44a44');
  lmBoxL(K.plain, HF, u - 1.15, u + 1.15, v - 3.25, v + 3.25, 0.18, 1.48, white);
  lmBoxL(K.plain, HF, u - 0.95, u + 0.95, v - 2.35, v + 2.85, 1.42, 2.45, hb('#d6dcd9'));
  lmBoxL(K.plain, HF, u - 0.98, u + 0.98, v - 3.2, v - 2.75, 0.72, 1.08, red);
  lmBoxL(K.plain, HF, u - 0.98, u + 0.98, v + 2.8, v + 3.2, 0.72, 1.08, red);
  lmBoxL(K.plain, HF, u - 0.82, u + 0.82, v - 3.28, v - 2.45, 1.52, 2.25, glass);
  lmBoxL(K.plain, HF, u - 0.9, u + 0.9, v + 2.25, v + 2.95, 1.5, 2.25, glass);
  lmBoxL(K.plain, HF, u - 0.55, u + 0.55, v - 0.25, v + 0.25, 2.48, 2.64, hb('#d1b54d'));
  for (const du of [-1.12, 1.12]) for (const dv of [-2.25, 2.25]) {
    const p = lmW(HF, u + du, v + dv); lmLathe(K.plain, p[0], p[1], 0.25, [[0.27, 0], [0.27, 0.16]], 10, hb('#313839'));
  }
}

function radiotherapy(K) {
  const oldOps = [], newOps = [], sill = hb('#c8cfcd');
  // Existing bunker: its polygon follows the city building outline in the local frame.
  const oldPlan = [[-11.0, -9.1], [0.6, -9.1], [0.6, -13.1], [15.5, -13.1], [15.5, 12.3], [7.8, 12.3], [7.8, 9.6], [-11.4, 9.6], [-12.7, 8.2], [-12.5, -7.2]];
  lmRow(oldOps, -10.3, 9.6, 7.2, 9.6, 5, 1.05, 1.05, 2.3, 'rtWin', { d: 0.15, sill, lit: lmLit(0.12) });
  lmBlock(K, RF, { poly: oldPlan, top: 4.55, st: { tex: 5, col: hb('#cbd1cf') }, roof: hb('#6d7778'), roofY: 4.55,
    cornice: [[4.3, 4.58, 0.18, WHITE]] }, oldOps);

  // New shielded accelerator wing attached to the east end of the mapped bunker; the treatment rooms stay opaque.
  const plan = [[15.35, -13.0], [35.5, -13.0], [35.5, 11.2], [15.35, 11.2]];
  lmRow(newOps, 35.5, -9.0, 35.5, 7.5, 4, 1.35, 0.75, 2.35, 'hsWin', { d: 0.2, sill, lit: lmLit(0.2) });
  lmRow(newOps, 18.0, 11.2, 32.8, 11.2, 6, 1.55, 4.15, 5.65, 'hsWin', { d: 0.18, sill, lit: lmLit(0.18) });
  lmOp(newOps, 35.5, -0.25, 2.7, 0.24, 3.25, 'hsEntry', { d: 0.25, lit: true });
  lmBlock(K, RF, { poly: plan, top: 7.15, st: { tex: 5, col: hb('#dce1df') }, roof: hb('#667274'), roofY: 7.15,
    cornice: [[6.9, 7.2, 0.25, hb('#95bbc3')]] }, newOps);
  lmSign(K, RF, [35.55, 2.75], [35.55, -2.75], 5.6, 6.45, 'radiotherapy', 1);
  for (const [u0, u1, v0, v1, h] of [[18, 21, -10.8, -7.8, 0.95], [24, 28, -10.8, -7.8, 1.35], [30, 33, -10.8, -7.8, 0.85]])
    lmBoxL(K.plain, RF, u0, u1, v0, v1, 7.18, 7.18 + h, CEM);
  lmBoxL(K.plain, RF, 16.5, 20.0, -13.7, -13.1, 0.05, 2.7, STEEL);

  // Patient drop-off and short parking apron at the treatment block.
  rect(K.plain, RF, 12, 39, 12, 23, 0.05, ASPH);
  strip(K.plain, RF, [[24, 31], [22, 27], [20, 23], [19, 18], [19, 12]], 2.2, 0.08, ASPH);
  for (let u = 15; u < 39; u += 3.1) beam(K.plain, RF, [u, 14, 0.12], [u, 19, 0.12], 0.04, WHITE);
}

function grounds(K) {
  const road = hb('#5d6261'), curb = hb('#d2c355'), mark = hb('#eeeeea'), green = hb('#557455'), trunk = hb('#725c45');
  // Curving uphill driveway, yellow edge paint and a clear turning court below the ambulance bays.
  strip(K.plain, HF, [[72, 103], [70, 88], [64, 72], [57, 58], [51, 47], [46, 39]], 3.55, 0.06, road);
  strip(K.plain, HF, [[75.6, 103], [73.6, 88], [67.4, 72], [60.3, 58], [54.5, 47], [49.5, 39]], 0.085, 0.15, curb);
  strip(K.plain, HF, [[68.4, 103], [66.4, 88], [60.6, 72], [53.7, 58], [47.5, 47], [42.5, 39]], 0.085, 0.15, curb);
  rect(K.plain, HF, 31, 53, 30, 43, 0.08, road);
  // Entrance forecourt and patient path.
  rect(K.plain, HF, 16, 32, 32, 40, 0.09, PAVE);
  strip(K.plain, HF, [[21, 43], [21, 40], [21, 37], [21, 33]], 1.4, 0.11, hb('#c2c1b9'));
  for (let u = 14; u <= 33.01; u += 1.0) rect(K.plain, HF, u, u + 0.4, 39.8, 40.55, 0.12, mark);
  // One side parking court, with marked bays and only a few parked cars.
  rect(K.plain, HF, 56, 84, 4, 29, 0.055, road);
  for (let u = 58; u <= 82.01; u += 2.8) {
    beam(K.plain, HF, [u, 4.6, 0.1], [u, 10.5, 0.1], 0.04, mark);
    beam(K.plain, HF, [u, 16, 0.1], [u, 21.9, 0.1], 0.04, mark);
  }
  beam(K.plain, HF, [56.2, 10.5, 0.1], [83.8, 10.5, 0.1], 0.04, mark);
  beam(K.plain, HF, [56.2, 16, 0.1], [83.8, 16, 0.1], 0.04, mark);
  beam(K.plain, HF, [56.2, 21.9, 0.1], [83.8, 21.9, 0.1], 0.04, mark);
  const car = (u, v, color) => {
    lmBoxL(K.plain, HF, u - 0.92, u + 0.92, v - 2.2, v + 2.2, 0.1, 0.72, color);
    lmBoxL(K.plain, HF, u - 0.72, u + 0.72, v - 1.25, v + 1.4, 0.68, 1.23, hb('#46575c'));
    for (const du of [-0.91, 0.91]) for (const dv of [-1.45, 1.45]) { const p = lmW(HF, u + du, v + dv); lmLathe(K.plain, p[0], p[1], 0.15, [[0.22, 0], [0.22, 0.12]], 10, hb('#343839')); }
  };
  car(61, 7.5, hb('#7d8886')); car(69, 18.7, hb('#d6d8d2')); car(77, 7.5, hb('#596b73')); car(80, 18.7, hb('#84756d'));

  // Quiet, accessible path to the therapy block, benches and low garden lamps.
  strip(K.plain, HF, [[43, 8], [48, -13], [50, -35], [44, -57], [38, -78], [32, -94]], 1.35, 0.08, hb('#c7c4bb'));
  for (const v of [-28, -55, -80]) {
    lmBoxL(K.plain, HF, 49, 52, v, v + 0.65, 0.52, 0.7, hb('#806f5c'));
    lmBoxL(K.plain, HF, 49, 49.18, v, v + 0.62, 0.08, 0.52, STEEL);
  }
  // A small number of pines, shrubs and bollards preserve the open lawn visible between the hospital wings.
  const pine = (u, v, h) => {
    const p = lmW(HF, u, v); lmLathe(K.plain, p[0], p[1], 0.06, [[0.12, 0], [0.09, h * 0.55]], 7, trunk);
    for (let i = 0; i < 3; i++) { const y = h * (0.22 + i * 0.22), r = h * (0.19 - i * 0.035); lmLathe(K.plain, p[0], p[1], y, [[r, 0], [r * 0.66, h * 0.31], [0.015, h * 0.55]], 9, green); }
  };
  for (const [u, v, h] of [[-74, -7, 4.8], [-73, 20, 4.4], [58, 36, 4.2], [86, 29, 4.8], [88, 0, 4.3], [27, -48, 4.9], [31, -75, 4.5]]) pine(u, v, h);
  for (const [u, v] of [[14.5, 39], [32.5, 39], [53, 38], [56, 30]]) {
    const p = lmW(HF, u, v); lmLathe(K.plain, p[0], p[1], 0.05, [[0.12, 0], [0.1, 3.7]], 8, STEEL);
    lmBoxL(K.plain, HF, u - 0.2, u + 0.2, v - 0.2, v + 0.2, 3.65, 3.85, hb('#eee6cf'));
  }
  for (const [u, v] of [[15.3, 30.1], [31.8, 30.1], [52.2, 30.1]]) lmBoxL(K.plain, HF, u, u + 0.24, v, v + 0.24, 0.06, 0.95, hb('#687a7c'));
}

function lmHospital(K) {
  const old = STATE.GBC, base = terrainH(HF[0], HF[1]);
  if (TERR.on) STATE.GBC = (x, y, z) => base - terrainH(x, z);
  try {
    podium(K); tower(K); entrance(K); radiotherapy(K); grounds(K);
  } finally { STATE.GBC = old; }
}

export { HF, RF, lmHospital };
