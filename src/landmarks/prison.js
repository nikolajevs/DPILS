import { LM_KEYS, lmW } from './core.js';
import { lmBlock, lmBar, lmBoxL, lmBoxW, lmLathe, lmLit, lmOp, lmRow, lmWF, lmWall } from './helpers.js';
import { polyA } from '../core/geometry.js';
import { TERR, terrainH } from '../world/terrain.js';
import { STATE } from '../core/state.js';
import { hb, sh } from '../core/util.js';
import { rest } from '../core/pause.js';

/* ---------- Daugavgrīvas cietums, the «White Swan» (Baltais gulbis), 18. novembra iela 66A ----------
   The Daugavpils branch of Daugavgrīvas cietums, the prison built in 1863 on the town edge (its architect was its
   first inmate). First a red «Red House», now a whitewashed ostrog behind a blank wall with watchtowers at the
   corners and a white swan weathervane on the ridge — the only prison in Latvia whose towers carry no sentries
   (electronic surveillance). A local architectural monument. The main line to Indra passes under the 18. novembra
   overpass just to the north (src/world/overpass.js); the locomotive works and the Baltic International Academy
   stand by. The second branch (Grīvas nodaļa, Lielā iela 1) lies in the fortress and is drawn separately.
   Plan from the OSM perimeter (way 925376945) and the cadastre outlines; heights from the LGIA lidar: the main
   block eaves 13.8 m / ridge 16.7 m, the south wing 7.3 / 8.8 m, the north-east tower 13.4 m, the south-west 10.1 m,
   the wall 4 m. Facades follow Mapillary street photographs (2014–2025): weathered whitewash, barred windows, a
   grey metal fence along the street sidewalk, trees behind the wall. */
const MF = [-349.9, 1594.7, 0.924, -0.383];   // u east-north-east along the street façade, v into the yard (south)
const WHITE = hb('#ece8dd'), WHITE2 = hb('#e0dbcd'), PLINTH = hb('#9c978c'), COPING = hb('#b6b1a7');
const ROOF = hb('#585b5e'), ROOF2 = hb('#4c4f52'), STEEL = hb('#6a7073'), ASPH = hb('#6d6f6e'), PAVE = hb('#b3b1a9');
const pt = (u, v, y = 0) => { const p = lmW(MF, u, v); return [p[0], y, p[1]]; };

// the cadastre buildings this landmark replaces (their outlines stay in BLD for collision)
LM_KEYS.push(lmW(MF, 29, 6.5), lmW(MF, 42, 17), [-291, 1544], [-370, 1669], [-330, 1620]);

/* ---- the blank perimeter wall: whitewashed brick, a concrete coping and a darker plinth ---- */
const WALL_PTS = [[-370.5, 1671.8], [-372.4, 1667.5], [-408.0, 1584.9], [-394.8, 1581.0], [-394.3, 1582.3], [-393.7, 1583.6], [-392.6, 1586.2],
  [-383.3, 1582.2], [-332.8, 1560.4], [-328.0, 1558.4], [-324.4, 1556.8], [-326.0, 1552.7], [-315.8, 1548.5], [-314.8, 1550.9], [-314.2, 1552.4],
  [-301.3, 1546.9], [-296.7, 1544.9], [-291.2, 1542.5], [-289.8, 1541.9], [-283.4, 1541.7], [-275.6, 1559.5], [-258.4, 1599.1], [-252.4, 1613.0],
  [-253.5, 1623.0], [-262.8, 1627.1], [-263.3, 1625.9], [-367.6, 1670.5]];
function wallRun(K, H) {
  const st = { tex: 7, col: WHITE, plinth: 0.7, pcol: PLINTH };
  for (let i = 0; i < WALL_PTS.length; i++) {
    const P = WALL_PTS[i], Q = WALL_PTS[(i + 1) % WALL_PTS.length];
    const F = lmWF(P, Q); if (F.L < 0.05) continue;
    lmWall(K, P, Q, 0, H, [], st);            // street / outer face
    lmWall(K, Q, P, 0, H, [], st);            // yard face
    lmBoxW(K.plain, F, -0.05, F.L + 0.05, H, H + 0.16, -0.34, 0.34, COPING);   // coping
  }
}

/* ---- a corner watchtower: white shaft, a wider glazed cabin over a corbel, a low hip roof ---- */
function tower(K, cx, cz, shaftW, cabW, shaftH, cabH, topH) {
  const f = [cx, cz, 1, 0], hw = shaftW / 2, cw = cabW / 2;
  const sq = w => [[-w, -w], [w, -w], [w, w], [-w, w]];
  lmBlock(K, f, { poly: sq(hw), top: shaftH, st: { tex: 1, col: WHITE, plinth: 0.7, pcol: PLINTH }, roof: ROOF, roofY: shaftH }, []);
  // corbel band the cabin sits on
  lmBlock(K, f, { poly: sq(cw), y0: shaftH - 0.35, top: shaftH, st: { tex: 1, col: WHITE2 } }, []);
  // glazed cabin: a band of windows on each face
  const ops = [];
  for (const [a, b] of [[[-cw, -cw], [cw, -cw]], [[cw, -cw], [cw, cw]], [[cw, cw], [-cw, cw]], [[-cw, cw], [-cw, -cw]]]) {
    const n = Math.max(2, Math.round(cabW / 1.3));
    lmRow(ops, a[0], a[1], b[0], b[1], n, 0.95, shaftH + 0.35, shaftH + 0.35 + 1.25, 'prTowerWin', { d: 0.18, lit: lmLit(0.5) });
  }
  lmBlock(K, f, { poly: sq(cw), y0: shaftH, top: cabH, st: { tex: 1, col: WHITE }, cornice: [[cabH - 0.18, cabH, 0.12, WHITE2]] }, ops);
  // low hip roof to a point
  const e = cw + 0.18, yE = cabH, yT = topH;
  const P = (su, sv, y) => [cx + su * e, y, cz + sv * e];
  for (const [a, b, c, d, nx, nz] of [[-1, -1, 1, -1, 0, -1], [1, -1, 1, 1, 1, 0], [1, 1, -1, 1, 0, 1], [-1, 1, -1, -1, -1, 0]]) {
    polyA(K.plain, [P(a, b, yE), P(c, d, yE), [cx, yT, cz]], ROOF2, nx, 0.5, nz);
  }
  lmBar(K.plain, [cx, yT, cz], [cx, yT + 0.5, cz], 0.05, STEEL);   // finial
}

/* ---- a gable roof over a local-frame rectangle, ridge along u ---- */
function gable(K, u0, u1, v0, v1, yE, yR, col, ov = 0.3) {
  const vm = (v0 + v1) / 2, a = u0 - ov, b = u1 + ov, c = v0 - ov, d = v1 + ov;
  polyA(K.plain, [pt(a, c, yE), pt(b, c, yE), pt(b, vm, yR), pt(a, vm, yR)], col, 0, 0.6, -0.8);
  polyA(K.plain, [pt(a, vm, yR), pt(b, vm, yR), pt(b, d, yE), pt(a, d, yE)], col, 0, 0.6, 0.8);
  for (const u of [u0, u1]) { const s = u === u0 ? -1 : 1; polyA(K.plain, [pt(u, v0, yE), pt(u, v1, yE), pt(u, vm, yR)], sh(col, 0.7), s, 0, 0); }
  lmBar(K.plain, pt(u0 - ov, vm, yR), pt(u1 + ov, vm, yR), 0.1, sh(col, 1.1));   // ridge
}

/* ---- the main three-storey block ---- */
function mainBlock(K) {
  const ops = [], sill = hb('#c9c4b8');
  const rows = [[1.5, 3.5], [5.5, 7.5], [9.5, 11.5]];
  for (const [y0, y1] of rows) {
    const tile = k => (k % 4 === 1 ? 'prWinB' : 'prWin');
    const win = { d: 0.24, sill, lit: lmLit(0.28), rcol: WHITE2 };
    lmRow(ops, 2, 0, 56, 0, 18, 1.1, y0, y1, tile, win);          // street (north) façade
    lmRow(ops, 2, 13, 56, 13, 18, 1.1, y0, y1, tile, win);        // yard (south) façade
    lmRow(ops, 0, 2, 0, 11, 3, 1.1, y0, y1, tile, win);           // west end
  }
  lmBlock(K, MF, { poly: [[0, 0], [58, 0], [58, 13], [0, 13]], top: 13.8,
    st: { tex: 1, col: WHITE, plinth: 0.8, pcol: PLINTH }, cornice: [[13.35, 13.8, 0.3, WHITE2]] }, ops);
  gable(K, 0, 58, 0, 13, 13.8, 16.7, ROOF);
  // a shallow stair bay on the street façade and the rounded east stair tower
  lmBlock(K, MF, { poly: [[44, -1.4], [49, -1.4], [49, 0], [44, 0]], top: 13.8, st: { tex: 1, col: WHITE2 }, roof: ROOF, roofY: 13.8 }, []);
  eastTower(K);
  // the short two-storey west wing turning into the yard
  const wops = [];
  for (const [y0, y1] of [[1.3, 3.1], [4.6, 6.4]]) lmRow(wops, 0, 23, 9, 23, 3, 1.0, y0, y1, 'prWin', { d: 0.2, sill, lit: lmLit(0.25) });
  lmBlock(K, MF, { poly: [[0, 13], [10, 13], [10, 23], [0, 23]], top: 7.3, st: { tex: 1, col: WHITE, plinth: 0.7, pcol: PLINTH }, cornice: [[7.0, 7.3, 0.22, WHITE2]] }, wops);
  gable(K, 0, 10, 13, 23, 7.3, 8.8, ROOF);
}
function eastTower(K) {
  const c = lmW(MF, 58, 6.5), cx = c[0], cz = c[1], r = 4.2, seg = 8;
  // octagonal shaft with narrow windows, a conical roof
  const ops = [];
  lmBlock(K, [cx, cz, 1, 0], { poly: Array.from({ length: seg }, (_, k) => { const a = (k + 0.5) * 2 * Math.PI / seg; return [Math.cos(a) * r, Math.sin(a) * r]; }),
    top: 13.8, st: { tex: 1, col: WHITE, plinth: 0.8, pcol: PLINTH }, cornice: [[13.35, 13.8, 0.25, WHITE2]] }, ops);
  for (let k = 0; k < seg; k++) {
    const a = (k + 0.5) * 2 * Math.PI / seg, nx = Math.cos(a), nz = Math.sin(a);
    for (const [y0, y1] of [[2, 3.8], [6, 7.8], [10, 11.8]]) {
      const w = 0.9, px = cx + nx * (r - 0.02), pz = cz + nz * (r - 0.02);
      const F = lmWF([px - nz * w / 2, pz + nx * w / 2], [px + nz * w / 2, pz - nx * w / 2]);
      lmWall(K, F.P, [F.P[0] + F.tx * F.L, F.P[1] + F.tz * F.L], y0, y1, [{ s0: 0, s1: F.L, y0, y1, d: 0.2, tile: 'prWin', lit: lmLit(0.3) }], { tex: 1, col: WHITE });
    }
  }
  const yT = 17.2;
  for (let k = 0; k < seg; k++) {
    const a0 = (k + 0.5) * 2 * Math.PI / seg, a1 = (k + 1.5) * 2 * Math.PI / seg, am = (a0 + a1) / 2;
    polyA(K.plain, [[cx + Math.cos(a0) * (r + 0.25), 13.8, cz + Math.sin(a0) * (r + 0.25)], [cx + Math.cos(a1) * (r + 0.25), 13.8, cz + Math.sin(a1) * (r + 0.25)], [cx, yT, cz]], ROOF2, Math.cos(am), 0.5, Math.sin(am));
  }
  lmBar(K.plain, [cx, yT, cz], [cx, yT + 0.6, cz], 0.05, STEEL);
}

/* ---- the two-storey south wing ---- */
function southWing(K) {
  const ops = [], sill = hb('#c9c4b8');
  for (const [y0, y1] of [[1.3, 3.1], [4.6, 6.4]]) {
    lmRow(ops, 29, 22, 55, 22, 9, 1.0, y0, y1, 'prWin', { d: 0.2, sill, lit: lmLit(0.25) });
    lmRow(ops, 29, 13, 55, 13, 9, 1.0, y0, y1, 'prWin', { d: 0.2, sill, lit: lmLit(0.2) });
  }
  lmBlock(K, MF, { poly: [[28, 13], [56, 13], [56, 22], [28, 22]], top: 7.3, st: { tex: 1, col: WHITE, plinth: 0.7, pcol: PLINTH }, cornice: [[7.0, 7.3, 0.22, WHITE2]] }, ops);
  gable(K, 28, 56, 13, 22, 7.3, 8.8, ROOF);
}

/* ---- the white swan weathervane on the ridge ---- */
function swan(K) {
  const c = lmW(MF, 29, 6.5), x = c[0], z = c[1], y = 16.7;
  const W = hb('#f6f4ee');
  lmBar(K.plain, [x, y, z], [x, y + 1.5, z], 0.05, STEEL);          // pole
  // directional cross
  lmBar(K.plain, [x - 0.5, y + 1.0, z], [x + 0.5, y + 1.0, z], 0.03, STEEL);
  lmBar(K.plain, [x, y + 1.0, z - 0.5], [x, y + 1.0, z + 0.5], 0.03, STEEL);
  // body: a small ellipsoid, neck curving up, head and beak — a swan silhouette in white metal
  const by = y + 1.55;
  lmLathe(K.plain, x, z, by, [[0.001, 0], [0.32, 0.12], [0.36, 0.28], [0.22, 0.42], [0.001, 0.46]], 10, W);
  const neck = [[0.18, 0.4], [0.3, 0.62], [0.28, 0.85], [0.12, 1.0]];
  for (let k = 0; k < neck.length - 1; k++) lmBar(K.plain, [x + neck[k][0], by + neck[k][1], z], [x + neck[k + 1][0], by + neck[k + 1][1], z], 0.09 - k * 0.015, W);
  lmLathe(K.plain, x + 0.12, z, by + 0.98, [[0.001, 0], [0.1, 0.05], [0.09, 0.13], [0.001, 0.16]], 8, W);   // head
  lmBar(K.plain, [x + 0.2, by + 1.05, z], [x + 0.34, by + 1.0, z], 0.04, hb('#d9a441'));   // beak
  // tail feathers sweeping back
  polyA(K.plain, [[x - 0.3, by + 0.3, z], [x - 0.62, by + 0.62, z], [x - 0.34, by + 0.18, z]], W, 0, 0, 1);
}

/* ---- gates, the street fence, the yard ---- */
function gates(K) {
  // the vehicle gate at the north-west corner where the service road ends
  const gf = lmWF([-394.8, 1581.0], [-392.6, 1586.2]);
  lmBoxW(K.plain, gf, -0.4, 0.0, 0, 4.6, -0.4, 0.4, WHITE2);       // gate posts
  lmBoxW(K.plain, gf, gf.L, gf.L + 0.4, 0, 4.6, -0.4, 0.4, WHITE2);
  const gF = lmWF([-394.6, 1581.4], [-392.8, 1585.8]);
  lmWall(K, gF.P, [gF.P[0] + gF.tx * gF.L, gF.P[1] + gF.tz * gF.L], 0.1, 3.7, [{ s0: 0, s1: gF.L, y0: 0.1, y1: 3.7, d: 0.1, tile: 'prGate', lit: false }], { tex: 1, col: STEEL });
  // the pedestrian gate on the street side at the brick bastion, with the name plaque
  const pf = lmWF([-324.4, 1556.8], [-315.8, 1548.5]);
  const mid = 0.5;
  lmWall(K, pf.P, [pf.P[0] + pf.tx * pf.L, pf.P[1] + pf.tz * pf.L], 0, 4.2,
    [{ s0: mid - 0.8, s1: mid + 0.8, y0: 0.1, y1: 2.7, d: 0.15, tile: 'prDoor', lit: lmLit(0.4) }], { tex: 7, col: WHITE, plinth: 0.7, pcol: PLINTH });
  const pl = lmW(MF, 0, 0);   // plaque near the street gate, on the wall face
  const qf = lmWF([-322.0, 1554.6], [-318.5, 1551.2]);
  lmWall(K, qf.P, [qf.P[0] + qf.tx * qf.L, qf.P[1] + qf.tz * qf.L], 2.9, 3.4, [{ s0: 0.2, s1: qf.L - 0.2, y0: 2.9, y1: 3.4, d: 0.06, tile: 'prPlate', lit: true }], { tex: 7, col: WHITE });
}
function streetFence(K) {
  // a grey metal railing on the sidewalk in front of the street-side wall (photographs)
  const A = [-392.0, 1578.0], B = [-285.0, 1539.5];
  const F = lmWF(A, B), n = Math.round(F.L / 2.4);
  for (let k = 0; k <= n; k++) { const s = F.L * k / n, p = F.at(s, 0, -1.6); lmBar(K.plain, [p[0], 0, p[2]], [p[0], 1.1, p[2]], 0.06, STEEL); }
  for (const y of [0.35, 0.75, 1.05]) { const a = F.at(0, y, -1.6), b = F.at(F.L, y, -1.6); lmBar(K.plain, a, b, 0.045, STEEL); }
}
function yard(K) {
  // a paved yard inside the wall, a few trees along the walls and lamps at the gate
  const inner = [[-388, 1586], [-300, 1550], [-284, 1548], [-262, 1600], [-266, 1622], [-360, 1662], [-396, 1592]];
  polyA(K.plain, inner.map(p => [p[0], 0.06, p[1]]), ASPH, 0, 1, 0);
  const tree = (x, z, h) => {
    lmLathe(K.plain, x, z, 0.06, [[0.14, 0], [0.1, h * 0.5]], 7, hb('#6e5a44'));
    for (let i = 0; i < 3; i++) { const y = h * (0.4 + i * 0.2), r = h * (0.26 - i * 0.05); lmLathe(K.plain, x, z, y, [[r, 0], [r * 0.6, h * 0.22], [0.02, h * 0.34]], 8, hb(i % 2 ? '#5c7444' : '#67804c')); }
  };
  for (const [x, z, h] of [[-380, 1600, 7], [-372, 1630, 8], [-300, 1560, 7.5], [-272, 1580, 7], [-270, 1610, 8], [-330, 1655, 7], [-350, 1640, 6.5]]) tree(x, z, h);
  for (const [x, z] of [[-390, 1583], [-320, 1551]]) { lmLathe(K.plain, x, z, 0.06, [[0.07, 0], [0.06, 3.6]], 8, STEEL); lmLathe(K.globe, x, z, 3.6, [[0.16, 0], [0.16, 0.2]], 8, hb('#fff2cf')); }
}

async function lmPrison(K) {
  const old = STATE.GBC, base = TERR.on ? terrainH(-320, 1590) : 0;
  if (TERR.on) STATE.GBC = (x, y, z) => base - terrainH(x, z);
  try {
    wallRun(K, 4.2); await rest();
    tower(K, -291, 1544, 3.6, 4.8, 10.8, 12.9, 13.9);
    tower(K, -370, 1669, 3.2, 4.2, 7.6, 9.3, 10.3); await rest();
    mainBlock(K); await rest();
    southWing(K); swan(K); await rest();
    gates(K); streetFence(K); yard(K);
  } finally { STATE.GBC = old; }
}

export { lmPrison };
