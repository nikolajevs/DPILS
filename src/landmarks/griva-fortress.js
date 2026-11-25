import { COL } from '../world/data.js';
import { STATE } from '../core/state.js';
import { TERR, terrainH } from '../world/terrain.js';
import { box, lathe, polyA } from '../core/geometry.js';
import { flatPlain } from '../buildings/walls.js';
import { lmBlock, lmRow, lmLit } from './helpers.js';
import { hb, sh, pip, rnd, dec } from '../core/util.js';
import { C } from '../core/env.js';

/* ---------- Daugavgrīva fortress (Grīva, left bank): the bridgehead fort of the Dinaburg fortress,
   now the Daugavgrīvas cietums prison. 55°52'47"N 26°29'29"E, Lielā iela 1.
   The star-shaped earthen rampart comes from OSM (two crest lines, citydata lines 690 and 13445):
   the ground is raised between and around them (gfCarve), the moats dug to the water polygons.
   Photographs (Mapillary, 2019–2025): the south face carries a concrete panel prison wall with a
   barbed-wire outrigger along the road; the east and west banks are grass and scrub; two watchtowers
   stand on the corners (OSM ways 1453360931/933); inside are a dirt football pitch with a running
   track, a brick water tower and a grass-covered bunker. ESRI World Imagery for the layout. */

// outer and inner rampart crests (closed), moat water rings, pitches, track — metres, city frame
const OUTER = [-3037, 572.1, -3331.2, 384.3, -3395.4, 304, -3321.6, 147.8, -3320, 148.7, -3299.6, 105.5, -3296.5, 107, -3286.4, 84.4, -3133.4, 139.9, -2852, 326.5, -2872.7, 355.4, -2868.1, 359.8, -2875.4, 371.9, -2876.7, 371, -2886, 382.5, -2939.2, 461.6, -2982.1, 520.4, -3017.9, 563.1, -3020.9, 564.2, -3026.3, 568.3];
const INNER = [-3287.5, 111.2, -3282, 98.1, -3139.3, 150, -2868, 330.5, -2890, 360.7, -2883.1, 366.2, -2944.3, 457, -3027.1, 561.1, -3034.9, 561.9, -3306.8, 388.1, -3379.2, 304.2, -3307.7, 154.5];
const MOAT_S = [-3177.6, 430.6, -3177.5, 441.7, -3175.1, 447.6, -3170.4, 454, -3163.9, 458.1, -3156.6, 460.4, -3149.4, 460.6, -3136.7, 456, -3111.2, 492.9, -3096.6, 510, -3040.1, 549.3, -3033.1, 551.2, -3028.1, 548.5, -3003.1, 519, -2946.2, 444.4, -2948.2, 441.8, -2967.5, 441, -2976.8, 442.2, -2981.8, 446.6, -2980.3, 465.3, -3038.5, 536.4, -3108.8, 450.5, -3103.4, 431.8, -3111.9, 430, -3117.8, 423.3, -3120.4, 417.8, -3125, 418.5, -3132.1, 430, -3133.8, 437.2, -3139, 442.8, -3138.6, 450.7, -3149.3, 454.3, -3155.2, 455, -3160.7, 453.2, -3169.3, 445.9, -3172.1, 439.3, -3173.2, 428.4, -3171.1, 422, -3166.9, 415.9, -3161.1, 410.9, -3157, 409.2, -3152.9, 403.8, -3140.7, 399.4, -3164, 384.4, -3184.7, 401.4, -3217.9, 393.1, -3221.2, 394.5, -3286.1, 375.7, -3288.4, 373.4, -3290.6, 373.8, -3289.7, 376, -3291.6, 381.5, -3286.2, 387.3, -3273.1, 397.3, -3265, 401.7, -3244.5, 410.7, -3202, 424.5, -3191.5, 423.8];
const MOAT_W = [-3294.2, 374.4, -3300.1, 373.8, -3305.8, 368.6, -3309.1, 360.9, -3308.4, 351.8, -3300.8, 336.1, -3279.4, 302.8, -3268.8, 288.5, -3261.4, 270, -3254, 258.4, -3246, 240.7, -3238.9, 232.2, -3212.6, 237.3, -3215.2, 277.3, -3249.1, 290.5, -3272.9, 337.1, -3288.4, 373.4];
const PITCH = [-3055.5, 295.5, -3017.9, 326.2, -3004.2, 309.4, -3041.8, 278.7];
const PITCH2 = [-3059.8, 292.4, -3048.1, 280.7, -3054.2, 274.7, -3065.8, 286.3];
const TRACK = [-2993.4, 313.3, -2992.2, 306.7, -2994.6, 297, -2998.6, 292.2, -3058.1, 269.5, -3064.5, 270.6, -3070, 276.3, -3071.1, 281.7, -3069.3, 287.3, -3019.8, 331.4, -3013.5, 333.6, -3004.8, 331.4, -2998.2, 323.4];
// the concrete prison wall along Lielā iela (Mapillary 2021-04-03): the south-west and south road lines
// (citydata 13614 and 1216) shifted 9.5 m into the site; on the south it stands at the foot of the rampart
const WALL_ROAD = [-3337.5, 388, -3224.9, 510.2, -3215.3, 519.9, -3206.8, 526.7, -3194.9, 534.1, -3181.9, 541.2, -3156, 548.7, -3125.7, 560.5, -3095.6, 571.6, -3074.9, 578, -3055.6, 580.4, -3035.2, 578, -3019.4, 572.8, -3003.9, 563.4, -2901.4, 482.6, -2867.5, 462.5];
const WALL_S = (() => { const o = []; for (let i = 0; i < WALL_ROAD.length; i += 2) { const x = WALL_ROAD[i], z = WALL_ROAD[i + 1], dx = -3120 - x, dz = 330 - z, l = Math.hypot(dx, dz) || 1; o.push(x + dx / l * 9.5, z + dz / l * 9.5); } return o; })();
// the crest path and the towers stand on the top of the rampart band, a few metres inside its outer edge
const inward = (p, d) => { const o = []; for (let i = 0; i < p.length; i += 2) { const x = p[i], z = p[i + 1], dx = -3120 - x, dz = 330 - z, l = Math.hypot(dx, dz) || 1; o.push(x + dx / l * d, z + dz / l * d); } return o; };
const CREST = inward(OUTER, 4.5);
const TOWERS = [inward([-3139.4, 150.2], 4.5), inward([-2945.8, 461.9], 4.5)];
const WTOWER = [-2968.5, 325.9];
const BUNKER = [-3143.8, 417.3];
const BB = [-3460, 30, -2780, 630];

const fss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const clamp01 = t => Math.max(0, Math.min(1, t));
function dPoly(x, z, p, closed = true) {
  const n = p.length >> 1; let best = 1e9;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n, x1 = p[2 * i], z1 = p[2 * i + 1], dx = p[2 * j] - x1, dz = p[2 * j + 1] - z1;
    const l2 = dx * dx + dz * dz || 1, t = clamp01(((x - x1) * dx + (z - z1) * dz) / l2);
    best = Math.min(best, Math.hypot(x - x1 - dx * t, z - z1 - dz * t));
  }
  return best;
}

/* ---- terrain: raise the rampart band and dig the moats in the height grid; roads and rails keep their level.
   The fine patches of the railway bridge (src/world/underpass-rail.js) are computed against this grid afterwards,
   so the road cutting by Lielā iela compensates the lift; the south-east still fades out towards it. ---- */
function gfCarve(T, q) {
  const roads = [];
  for (const l of C.l) {
    if (l[0] > 5 && l[0] !== 8) continue;
    const p = dec(l[2]); let inZ = false;
    for (let i = 0; i < p.length; i += 2) if (p[i] > BB[0] && p[i] < BB[2] && p[i + 1] > BB[1] && p[i + 1] < BB[3]) { inZ = true; break; }
    if (inZ) roads.push([p, l[0] === 8 ? 5 : l[0] <= 1 ? 6 : l[0] <= 3 ? 4.5 : 3]);
  }
  const nx = T.nx, nz = T.nz, s = T.step;
  const i0 = Math.max(0, Math.floor((BB[0] - T.x0) / s)), i1 = Math.min(nx - 1, Math.ceil((BB[2] - T.x0) / s));
  const j0 = Math.max(0, Math.floor((BB[1] - T.z0) / s)), j1 = Math.min(nz - 1, Math.ceil((BB[3] - T.z0) / s));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = T.x0 + i * s, z = T.z0 + j * s;
    const inO = pip(x, z, OUTER), inI = pip(x, z, INNER);
    const dO = dPoly(x, z, OUTER), dI = dPoly(x, z, INNER);
    let h;
    if (inO && !inI) h = 3 * fss(clamp01(Math.min(dO, dI) / 4));          // the rampart band: crest 3 m
    else if (!inO) h = 3 * (1 - fss(dO / 14));                            // outer slope, 14 m run
    else h = 3 * (1 - fss(dI / 12));                                      // inner slope into the yard
    for (const M of [MOAT_S, MOAT_W]) {
      const d = dPoly(x, z, M);
      if (pip(x, z, M)) h = Math.min(h, -1.6 * fss(clamp01(d / 3)));
      else if (d < 5) h = Math.min(h, -0.9 * (1 - fss(d / 5)));
    }
    for (const [p, w] of roads) { const d = dPoly(x, z, p, false); if (d < w + 5) h *= fss(clamp01((d - w - 0.5) / 4.5)); }
    if (z > 340) h *= 1 - fss(clamp01((x + 2920) / 40));   // fade towards the railway-bridge cutting
    if (Math.abs(h) > 0.02) q[j * nx + i] += Math.round(h * 10);
  }
}
/* the generic 2 m walls on the two crests and the embankment ridges by the moats are replaced by the earthworks */
function gfSkipLine(cls, pts) {
  if (cls === 12) { for (let i = 0; i < pts.length; i += 2) if (dPoly(pts[i], pts[i + 1], OUTER) < 2.5 || dPoly(pts[i], pts[i + 1], INNER) < 2.5) return true; return false; }
  if (cls === 14) { for (let i = 0; i < pts.length; i += 2) { const x = pts[i], z = pts[i + 1]; if (x > BB[0] && x < BB[2] && z > BB[1] && z < BB[3] && (dPoly(x, z, MOAT_S) < 14 || dPoly(x, z, MOAT_W) < 14 || dPoly(x, z, OUTER) < 16)) return true; } return false; }
  return false;
}

/* ---- geometry laid on the carved ground ---- */
function ribbonY(b, p, hw, col, lift, closed = true) {
  const n = p.length >> 1, m = closed ? n : n - 1, v0 = b.v;
  const P = [];
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n, x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * j], z2 = p[2 * j + 1];
    const L = Math.hypot(x2 - x1, z2 - z1), steps = Math.max(1, Math.round(L / 4));
    for (let k = 0; k < steps; k++) { const t = k / steps; P.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t]); }
  }
  if (!closed) P.push([p[2 * n - 2], p[2 * n - 1]]);
  const cnt = P.length; b.ensure(cnt * 2);
  for (let i = 0; i < cnt; i++) {
    const a = Math.max(0, i - 1), c = Math.min(cnt - 1, i + 1);
    let tx = P[c][0] - P[a][0], tz = P[c][1] - P[a][1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx, x = P[i][0], z = P[i][1], y = terrainH(x, z) + lift;
    b.vert(x - nx * hw, y, z - nz * hw, 0, 1, 0, col); b.vert(x + nx * hw, y, z + nz * hw, 0, 1, 0, col);
  }
  const last = closed ? cnt : cnt - 1;
  for (let i = 0; i < last; i++) { const k = v0 + 2 * i, q2 = v0 + 2 * ((i + 1) % cnt); b.triUp(k, k + 1, q2 + 1); b.triUp(k, q2 + 1, q2); }
}
function wallQuadY(b, x1, z1, x2, z2, y0, y1, col, nx, nz) {
  polyA(b, [[x1, y0, z1], [x2, y0, z2], [x2, y1, z2], [x1, y1, z1]], col, nx, 0, nz);
}
function lmGriva(K) {
  const old = STATE.GBC;
  STATE.GBC = TERR.on ? (x, y, z) => -terrainH(x, z) : null;   // absolute heights laid on the local ground (the shader lifts them back)
  try {
  const G = K.plain, dirt = hb('#9a8f7a'), dirt2 = hb('#8b8168'), conc = hb('#b4b0a8'), concD = hb('#98948c'), wire = hb('#4c4c4a'), white = hb('#e8e6df'), grass = hb('#5d7a3a'), brick = hb('#7a4a3a'), steel = hb('#aeb4b8'), dark = hb('#2a3438');
  // the dirt walk along the top of the rampart
  ribbonY(G, CREST, 1.6, dirt, 0.06);
  // the concrete panel wall with barbed wire on the south face
  for (let i = 0; i < WALL_S.length - 2; i += 2) {
    const x1 = WALL_S[i], z1 = WALL_S[i + 1], x2 = WALL_S[i + 2], z2 = WALL_S[i + 3];
    const L = Math.hypot(x2 - x1, z2 - z1), tx = (x2 - x1) / L, tz = (z2 - z1) / L, nx = -tz, nz = tx;
    const h = 2.7, np = Math.max(1, Math.round(L / 3));
    // panels in 3 m pieces, each on its own ground level: the bank falls along the wall
    for (let k = 0; k < np; k++) {
      const ta = k / np, tb = (k + 1) / np;
      const ax = x1 + (x2 - x1) * ta, az = z1 + (z2 - z1) * ta, bx = x1 + (x2 - x1) * tb, bz = z1 + (z2 - z1) * tb;
      const ya = terrainH(ax, az), yb = terrainH(bx, bz);
      wallQuadY(G, ax + nx * 0.12, az + nz * 0.12, bx + nx * 0.12, bz + nz * 0.12, ya - 0.15, ya + h, sh(conc, 1 + 0.05 * rnd(i + k, 1)), nx, nz);
      wallQuadY(G, ax - nx * 0.12, az - nz * 0.12, bx - nx * 0.12, bz - nz * 0.12, yb - 0.15, yb + h, sh(concD, 1 + 0.05 * rnd(i + k, 2)), -nx, -nz);
      polyA(G, [[ax + nx * 0.12, ya + h, az + nz * 0.12], [bx + nx * 0.12, yb + h, bz + nz * 0.12], [bx - nx * 0.12, yb + h, bz - nz * 0.12], [ax - nx * 0.12, ya + h, az - nz * 0.12]], sh(conc, 1.1), 0, 1, 0);
    }
    // panel joints and posts
    for (let k = 0; k <= np; k++) {
      const t = k / np, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t, y = terrainH(x, z);
      box(G, x, z, tx, tz, 0.06, 0.2, y, y + h + 0.12, concD);
      // barbed-wire outrigger, leaning out over the road side
      const ox = nx * 0.45, oz = nz * 0.45;
      polyA(G, [[x, y + h, z], [x + ox, y + h + 0.55, z + oz], [x + ox + tx * 0.03, y + h + 0.55, z + oz + tz * 0.03], [x + tx * 0.03, y + h, z + tz * 0.03]], wire, -nx, 0.6, -nz);
    }
    for (const [oo, hh] of [[0.15, 0.18], [0.3, 0.36], [0.45, 0.55]]) {
      const a = [x1 + nx * oo, z1 + nz * oo], b2 = [x2 + nx * oo, z2 + nz * oo];
      ribbonY(G, [a[0], a[1], b2[0], b2[1]], 0.015, wire, h + hh, false);
    }
    COL.add(x1, z1, x2, z2, 0.25, 0);
  }
  // watchtowers on the corners: concrete shaft, a wider glazed cabin with barred windows, a low hip roof
  for (const [x, z] of TOWERS) {
    const B = terrainH(x, z), f = [x, z, 1, 0], sq = w => [[-w, -w], [w, -w], [w, w], [-w, w]];
    lmBlock(K, f, { poly: sq(1.3), y0: B - 0.3, top: B + 5.4, st: { tex: 1, col: concD, plinth: B + 0.6, pcol: sh(concD, 0.8) } }, []);
    const ops = [];
    for (const [a, b] of [[[-1.8, -1.8], [1.8, -1.8]], [[1.8, -1.8], [1.8, 1.8]], [[1.8, 1.8], [-1.8, 1.8]], [[-1.8, 1.8], [-1.8, -1.8]]])
      lmRow(ops, a[0], a[1], b[0], b[1], 3, 0.9, B + 5.75, B + 6.9, 'prWin', { d: 0.18, lit: lmLit(0.6) });
    lmBlock(K, f, { poly: sq(1.8), y0: B + 5.4, top: B + 7.2, st: { tex: 1, col: conc }, cornice: [[B + 7.02, B + 7.2, 0.12, sh(conc, 1.1)]] }, ops);
    const e = 1.98, yE = B + 7.2, yT = B + 8.5;
    for (const [a, b, c, d2, nx, nz] of [[-1, -1, 1, -1, 0, -1], [1, -1, 1, 1, 1, 0], [1, 1, -1, 1, 0, 1], [-1, 1, -1, -1, -1, 0]])
      polyA(G, [[x + a * e, yE, z + b * e], [x + c * e, yE, z + d2 * e], [x, yT, z]], hb('#6b6f72'), nx, 0.5, nz);
    for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) COL.add(x + ux * 1.3 - uz * 1.3, z + uz * 1.3 + ux * 1.3, x + ux * 1.3 + uz * 1.3, z + uz * 1.3 - ux * 1.3, 0.1, 0);
  }
  // the brick water tower with a steel tank
  {
    const [x, z] = WTOWER, y = terrainH(x, z);
    lathe(G, x, z, y - 0.2, [[1.8, 0], [1.8, 7], [2.1, 7], [2.1, 7.3]], 12, 0, brick);
    lathe(G, x, z, y + 7.3, [[2.4, 0], [2.4, 2.6], [2.2, 2.9], [0, 3.3]], 12, 0, steel);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, b2 = (k + 1) * Math.PI / 4; COL.add(x + Math.cos(a) * 1.8, z + Math.sin(a) * 1.8, x + Math.cos(b2) * 1.8, z + Math.sin(b2) * 1.8, 0.1, 0); }
  }
  // the grass-covered bunker by the south-west rampart
  {
    const [x, z] = BUNKER, y = terrainH(x, z);
    lathe(G, x, z, y - 0.2, [[6, 0], [5, 1.1], [3, 1.7], [0, 1.85]], 10, 0.3, grass);
    box(G, x, z, 0.9, 0.4, 1.6, 1.1, y + 1.5, y + 1.9, concD);
    polyA(G, [[x - 0.9, y + 0.2, z + 1.55], [x + 0.9, y + 0.2, z + 1.55], [x + 0.9, y + 1.3, z + 1.55], [x - 0.9, y + 1.3, z + 1.55]], dark, 0, 0, 1);
  }
  // the dirt football pitch: surface, lines, goals
  {
    const y = terrainH((PITCH[0] + PITCH[4]) / 2, (PITCH[1] + PITCH[5]) / 2);
    flatPlain(G, [PITCH], y + 0.08, hb('#8f9a6a'), false);
    ribbonY(G, PITCH, 0.06, white, 0.12);
    const mx = (PITCH[0] + PITCH[2]) / 2, mz = (PITCH[1] + PITCH[3]) / 2, nx2 = (PITCH[4] + PITCH[6]) / 2, nz2 = (PITCH[5] + PITCH[7]) / 2;
    ribbonY(G, [mx, mz, nx2, nz2], 0.05, white, 0.12, false);
    const circ = []; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; circ.push([(mx + nx2) / 2 + Math.cos(a) * 4, (mz + nz2) / 2 + Math.sin(a) * 4]); }
    ribbonY(G, circ, 0.05, white, 0.12);
    // goals at the short ends
    for (const [e0, e1] of [[0, 3], [1, 2]]) {
      const ax = (PITCH[2 * e0] + PITCH[2 * e1]) / 2, az = (PITCH[2 * e0 + 1] + PITCH[2 * e1 + 1]) / 2;
      let dx = PITCH[2 * e1] - PITCH[2 * e0], dz = PITCH[2 * e1 + 1] - PITCH[2 * e0 + 1]; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const gy = terrainH(ax, az);
      for (const s of [-1, 1]) box(G, ax + dx * 2.5 * s, az + dz * 2.5 * s, dx, dz, 0.05, 0.05, gy, gy + 2.2, white);
      box(G, ax, az, dx, dz, 2.5, 0.05, gy + 2.1, gy + 2.2, white);
    }
    ribbonY(G, PITCH2, 0.05, white, 0.1);
  }
  // the running track around the pitch
  ribbonY(G, TRACK, 1.9, hb('#9a5f43'), 0.07);
  ribbonY(G, TRACK, 0.05, sh(white, 0.9), 0.1);
  // scrub on the overgrown banks (east and south outer slopes, the crests)
  let seed = 7;
  const scrub = (p, closed, off0, off1, step) => {
    const n = p.length >> 1, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n, x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * j], z2 = p[2 * j + 1];
      const L = Math.hypot(x2 - x1, z2 - z1), tx = (x2 - x1) / L, tz = (z2 - z1) / L, nx = -tz, nz = tx;
      for (let d = 2; d < L; d += step) {
        seed++;
        const t = d / L, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t, o = off0 + rnd(seed, 1) * (off1 - off0);
        const sx = x + nx * o, sz = z + nz * o, sy = terrainH(sx, sz), h = 0.9 + rnd(seed, 2) * 1.3, r = 0.7 + rnd(seed, 3) * 0.9;
        lathe(G, sx, sz, sy - 0.1, [[r, 0], [r * 0.9, h * 0.6], [r * 0.4, h], [0, h * 1.1]], 6, rnd(seed, 4) * 3, sh(grass, 0.8 + rnd(seed, 5) * 0.5));
      }
    }
  };
  scrub(OUTER.slice(18).concat(OUTER.slice(0, 2)), false, 3, 9, 5);   // east + south-east bank
  scrub(OUTER.slice(2, 10), false, -8, -3, 6);                          // south-west bank inner side
  scrub(INNER.slice(2, 8), false, 2, 6, 7);                             // inner crest east
  } finally { STATE.GBC = old; }
}

export { gfCarve, gfSkipLine, lmGriva };