import { lmSign } from './unity-house.js';
import { LMF, lmW } from './core.js';
import { lmBlock, lmBar, lmBoxL, lmLathe, lmLit, lmOp, lmRow } from './helpers.js';
import { polyA } from '../core/geometry.js';
import { TERR, terrainH } from '../world/terrain.js';
import { STATE } from '../core/state.js';
import { hash, hb } from '../core/util.js';
import { addStaticCar } from '../world/cars.js';

/* Daugavpils Regional Hospital, Vasarnīcu iela 20. LGIA's 1:2,000 topographic plan and 7th-cycle orthophoto fix the
   tower axis, entry court, parking and therapy-wing position. Ministry, hospital and city photographs guide facades. */
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
  const ops = [], sill = hb('#aeb8ba'), plan = [[-12.5, -42], [12.5, -42], [12.5, 42], [-12.5, 42]];
  for (let floor = 0; floor < 12; floor++) {
    const y0 = 3.15 + floor * 2.92, y1 = y0 + 1.72;
    const tile = i => (floor + i) % 5 === 0 ? 'hsWinB' : 'hsWin';
    const win = () => ({ d: 0.24, sill, lit: lmLit(0.16), rcol: PANEL_DK });
    lmRow(ops, -12.5, -40, -12.5, 40, 28, 1.74, y0, y1, tile, win);
    lmRow(ops, 12.5, -40, 12.5, 40, 28, 1.74, y0, y1, tile, win);
    lmRow(ops, -10.8, -42, 10.8, -42, 7, 1.45, y0, y1, tile, win);
    // Recessed open loggias repeat along the south end, visible in the frontal photographs.
    lmRow(ops, -6.2, 42, 6.2, 42, 1, 12.4, y0 + 0.05, y0 + 1.82, 'hsLoggia', { d: 1.0, lit: false });
  }
  lmBlock(K, HF, { poly: plan, top: 40.2, st: { tex: 5, col: PANEL }, roof: hb('#777f80'), roofY: 40.2,
    cornice: [[39.85, 40.28, 0.32, WHITE]] }, ops);

  // Broad concrete floor bands and the unusually deep, repeated end balconies.
  for (let floor = 0; floor < 12; floor++) {
    const y = 3.0 + floor * 2.92, col = floor % 2 ? PANEL_DK : WHITE;
    for (const [u0, u1] of [[-12.72, -12.5], [12.5, 12.72]]) lmBoxL(K.plain, HF, u0, u1, -42, 42, y, y + 0.15, col);
    for (const u of [-6.3, 6.3]) {
      const ya = 3.2 + floor * 2.92;
      lmBoxL(K.plain, HF, u - 0.18, u + 0.18, 41.9, 43.55, ya, ya + 0.12, CEM);
    }
    if (floor < 11) {
      const ya = 3.25 + floor * 2.92;
      beam(K.plain, HF, [-6.0, 43.45, ya + 1.05], [6.0, 43.45, ya + 1.05], 0.06, STEEL);
      beam(K.plain, HF, [-6.0, 43.45, ya + 0.12], [6.0, 43.45, ya + 0.12], 0.045, STEEL);
      for (let u = -6; u <= 6.01; u += 1.2) beam(K.plain, HF, [u, 43.45, ya + 0.12], [u, 43.45, ya + 1.05], 0.04, STEEL);
    }
  }
  // Lift and stair overrun, roof access rail and small exhaust cowls.
  lmBlock(K, HF, { poly: [[-4.2, -2.6], [3.0, -2.6], [3.0, 2.6], [-4.2, 2.6]], y0: 40.2, top: 41.8,
    st: { tex: 5, col: PANEL_DK }, roof: hb('#858b8b'), roofY: 41.8 }, []);
  for (const [u, v, r, h] of [[-8, -34, 0.65, 0.95], [8, -31, 0.52, 0.8], [-8, 33, 0.48, 0.78], [8, 35, 0.58, 0.9]]) {
    const w = lmW(HF, u, v); lmLathe(K.plain, w[0], w[1], 40.24, [[r, 0], [r, h], [r * 0.82, h + 0.14]], 8, CEM);
  }
  for (let v = -40; v <= 40.01; v += 5.2) beam(K.plain, HF, [-11.5, v, 40.35], [11.5, v, 40.35], 0.035, STEEL);
}

function podium(K) {
  const ops = [], sill = hb('#b6bdbb'), plan = [[-66, -14], [-46, -14], [-46, 4], [51, 4], [51, 32], [-66, 32]];
  const rows = [[0.58, 2.2], [3.48, 5.15], [6.38, 8.08]];
  for (const [y0, y1] of rows) {
    // The patient lobby and two ambulance portals sit at the southwest drop-off, below a shared canopy.
    for (const [a, b, n] of (y0 < 5.2 ? [[-63, -54, 3], [-46, -39, 2], [-18, 50, 24]] : [[-63, 50, 40]]))
      lmRow(ops, a, 32, b, 32, n, 1.75, y0, y1, 'hsWin', { d: 0.2, sill, lit: lmLit(0.2) });
    lmRow(ops, -43, 4, 48, 4, 20, 1.65, y0, y1, 'hsWin', { d: 0.18, sill, lit: lmLit(0.16) });
    lmRow(ops, -66, -11, -66, 28, 9, 1.65, y0, y1, 'hsWin', { d: 0.18, sill, lit: lmLit(0.18) });
    lmRow(ops, 51, 5, 51, 31, 5, 1.55, y0, y1, 'hsWin', { d: 0.18, sill, lit: lmLit(0.18) });
    lmRow(ops, -46, -12, -46, 2, 4, 1.45, y0, y1, 'hsWin', { d: 0.18, sill, lit: lmLit(0.15) });
  }
  // Patient doors are west of the two ambulance garages on the southwest-facing arrival court.
  lmOp(ops, -51.5, 32, 6.0, 0.28, 3.7, 'hsEntry', { d: 0.32, lit: true });
  lmOp(ops, -35.0, 32, 5.8, 0.22, 4.65, 'hsBay', { d: 0.45, lit: true });
  lmOp(ops, -26.0, 32, 5.8, 0.22, 4.65, 'hsBay', { d: 0.45, lit: true });
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
  const sign = hb('#314a52');
  // The main glazed entry and ambulance portals share the broad blue-grey southwest canopy.
  lmSign(K, HF, [-54.4, 32.12], [-48.6, 32.12], 4.02, 4.82, 'hospital', 1);
  rect(K.plain, HF, -59.5, -17.5, 32.2, 40.8, 5.35, hb('#60757c'));
  lmBoxL(K.plain, HF, -59.5, -17.5, 40.2, 40.8, 4.85, 5.45, sign);
  for (const u of [-59.2, -38.8, -17.8]) for (const v of [32.5, 40.1]) lmBoxL(K.plain, HF, u, u + 0.18, v, v + 0.18, 0.05, 5.15, STEEL);

  // Shallow entrance steps, a broad wheelchair ramp, rails, tactile paving and bollards.
  for (let k = 0; k < 5; k++) {
    const v0 = 32.7 + k * 0.82, v1 = v0 + 0.78, h = 0.14 + k * 0.12;
    lmBoxL(K.plain, HF, -55.0, -48.0, v0, v1, 0.04, h, hb('#c5c6c1'));
  }
  polyA(K.plain, [pt(HF, -46.5, 32.7, 0.72), pt(HF, -42.5, 32.7, 0.72), pt(HF, -42.5, 38.0, 0.08), pt(HF, -46.5, 38.0, 0.08)], hb('#c4c6c2'), 0, 1, 0);
  for (const u of [-46.5, -42.5]) {
    beam(K.plain, HF, [u, 32.7, 1.55], [u, 38.0, 0.92], 0.055, STEEL);
    for (let v = 33; v < 38; v += 1.05) { const t = (v - 32.7) / 5.3; beam(K.plain, HF, [u, v, 0.72 - t * 0.64], [u, v, 1.5 - t * 0.64], 0.035, STEEL); }
  }
  rect(K.plain, HF, -57.0, -47.0, 38.1, 39.0, 0.08, PAVE);
  for (let u = -56; u < -47; u += 1.1) lmBoxL(K.plain, HF, u, u + 0.16, 38.0, 38.22, 0.08, 0.13, hb('#c8bb9c'));
  for (const u of [-61.0, -42.0, -16.5]) lmBoxL(K.plain, HF, u, u + 0.2, 36.4, 36.6, 0.05, 0.85, hb('#858b87'));

  // A white ambulance waiting in the eastern portal; body, wheels and warning lamps are separate pieces.
  const u = -26.0, v = 36.1, white = hb('#e5e8e3'), glass = hb('#627981'), red = hb('#c44a44');
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
  // The vehicle route comes from the west and turns into the covered southwest drop-off.
  strip(K.plain, HF, [[-126, 112], [-111, 91], [-96, 73], [-83, 58], [-72, 50], [-64, 50]], 3.45, 0.06, road);
  strip(K.plain, HF, [[-129.4, 113], [-114, 92], [-99, 74], [-86, 59], [-75, 51], [-67, 51]], 0.085, 0.15, curb);
  strip(K.plain, HF, [[-122.8, 111], [-108, 90], [-93, 72], [-80, 57], [-69, 49]], 0.085, 0.15, curb);
  const loop = [[-68, 44], [-76, 48], [-80, 55], [-78, 62], [-71, 68], [-61, 70], [-51, 68], [-43, 62], [-41, 55], [-46, 49], [-56, 45], [-68, 44]];
  strip(K.plain, HF, loop, 3.25, 0.07, road);
  strip(K.plain, HF, loop.map(([u, v]) => [u - 2.8, v - 1.9]), 0.085, 0.16, curb);
  rect(K.plain, HF, -63, -16, 31, 44, 0.08, road);
  // A narrow access lane follows the western side of the hospital to the northwest car park.
  strip(K.plain, HF, [[-77, 52], [-83, 34], [-88, 14], [-93, -9], [-100, -33], [-111, -55], [-122, -78], [-124, -109]], 3.25, 0.06, road);
  strip(K.plain, HF, [[-80.2, 52], [-86.2, 34], [-91.2, 14], [-96.2, -9], [-103.2, -33], [-114.2, -55], [-125.2, -78], [-127.2, -109]], 0.08, 0.15, curb);
  // Paved entrance apron, pedestrian crossing and direct accessible path to the lobby doors.
  rect(K.plain, HF, -61, -17, 32, 43, 0.09, PAVE);
  strip(K.plain, HF, [[-52, 55], [-52, 49], [-52, 43], [-52, 34]], 1.4, 0.11, hb('#c2c1b9'));
  for (let u = -62; u <= -16.99; u += 1.05) rect(K.plain, HF, u, u + 0.42, 43.6, 44.3, 0.12, mark);

  // Main patient and staff parking sits northwest of the tower, reached from the west-side lane.
  rect(K.plain, HF, -172, -74, -145, -109, 0.055, road);
  for (let u = -169; u <= -75.01; u += 2.8) {
    for (const [v0, v1] of [[-143, -137], [-128, -122], [-115, -109]])
      beam(K.plain, HF, [u, v0, 0.1], [u, v1, 0.1], 0.04, mark);
  }
  for (const v of [-143, -137, -128, -122, -115, -109])
    beam(K.plain, HF, [-171.2, v, 0.1], [-74.8, v, 0.1], 0.04, mark);
  const car = (u, v, color) => {
    // a ready BMW (src/world/cars.js): nose along +v of the hospital frame, paint tinted per instance (col is already
    // sRGB bytes from hb). The campus is flattened to its own base by STATE.GBC, so the car stands on that platform
    const p = lmW(HF, u, v), dx = -HF[3], dz = HF[2];
    const y = 0.06 + (STATE.GBC ? STATE.GBC(p[0], 0.06, p[1]) : 0);
    addStaticCar(p[0], p[1], Math.atan2(-dz, dx), Math.floor(hash(u * 3.1 + v * 7.7) * 3), color, false, y);
  };
  for (const [u, v, color] of [[-164, -140, '#7d8886'], [-154, -125, '#d6d8d2'], [-143, -112, '#596b73'], [-132, -140, '#84756d'], [-121, -125, '#79837e'], [-110, -112, '#656f73'], [-99, -140, '#8a786e'], [-88, -125, '#66797b'], [-78, -112, '#737e78']]) car(u, v, hb(color));

  // A sheltered pedestrian link follows the southeast side of the site to the separate therapy block.
  strip(K.plain, HF, [[-25, 42], [-5, 48], [18, 55], [43, 63], [67, 72], [88, 79]], 1.45, 0.08, hb('#c7c4bb'));
  for (const [u, v] of [[8, 53], [43, 63], [72, 74]]) {
    lmBoxL(K.plain, HF, u, u + 3, v, v + 0.65, 0.52, 0.7, hb('#806f5c'));
    lmBoxL(K.plain, HF, u, u + 0.18, v, v + 0.62, 0.08, 0.52, STEEL);
  }
  // Tree belts stay on the forest edge and open lawn around the campus.
  const pine = (u, v, h) => {
    const p = lmW(HF, u, v); lmLathe(K.plain, p[0], p[1], 0.06, [[0.12, 0], [0.09, h * 0.55]], 7, trunk);
    for (let i = 0; i < 3; i++) { const y = h * (0.22 + i * 0.22), r = h * (0.19 - i * 0.035); lmLathe(K.plain, p[0], p[1], y, [[r, 0], [r * 0.66, h * 0.31], [0.015, h * 0.55]], 9, green); }
  };
  for (const [u, v, h] of [[-168, -73, 4.8], [-165, -30, 4.4], [-151, 28, 4.5], [-151, 74, 4.7], [95, -55, 4.8], [119, -34, 4.4], [129, 4, 4.3], [139, 41, 4.8], [118, 111, 4.5]]) pine(u, v, h);
  for (const [u, v] of [[-62, 40], [-42, 40], [-18, 40], [24, 59], [60, 71]]) {
    const p = lmW(HF, u, v); lmLathe(K.plain, p[0], p[1], 0.05, [[0.12, 0], [0.1, 3.7]], 8, STEEL);
    lmBoxL(K.plain, HF, u - 0.2, u + 0.2, v - 0.2, v + 0.2, 3.65, 3.85, hb('#eee6cf'));
  }
  for (const [u, v] of [[-63.0, 30.1], [-40.0, 30.1], [-17.0, 30.1]]) lmBoxL(K.plain, HF, u, u + 0.24, v, v + 0.24, 0.06, 0.95, hb('#687a7c'));
}

function lmHospital(K) {
  const old = STATE.GBC, base = terrainH(HF[0], HF[1]);
  if (TERR.on) STATE.GBC = (x, y, z) => base - terrainH(x, z);
  try {
    podium(K); tower(K); entrance(K); radiotherapy(K); grounds(K);
  } finally { STATE.GBC = old; }
}

export { HF, RF, lmHospital };
