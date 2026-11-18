import { STATE } from '../core/state.js';
import { lmBar, lmBlock, lmBoxL, lmLathe, lmOp, lmRow } from './helpers.js';
import { LMT } from './tiles.js';
import { LMF, LMWHITE, lmL, lmW } from './core.js';
import { lmRegisterOutline } from './tv-tower.js';
import { flatPlain } from '../buildings/walls.js';
import { polyA } from '../core/geometry.js';
import { area2, hb, offsetRing, pip, sh } from '../core/util.js';
import * as THREE from 'three';
import { glowTex } from '../render/textures.js';
import { scene } from '../render/renderer.js';

/* ---- Substation "Daugavpils" 330/110 kV and the transformer substations of Ķīmiķu ciemats ----
   The 330/110 kV substation "Daugavpils" (OSM way 115788081, ref 30, operator Augstsprieguma tīkls,
   voltage 330000;110000;20000;10000) stands on the north-east side of the chemical-workers' district,
   between Jātnieku iela and the 330 kV lines towards Līksna. Beside it, south along the same line
   corridor, is the industrial 110/10 kV substation "Daugavpils B" (way 1066909952, ref 36). The yard
   outline, the fences (ways 1075911507, 837198920, 968886497/498/508, gates 968886511, 968888838),
   the portal nodes (ref 131/132/631/632/133/136/137/290/291 and the 330 kV row), the transformer
   nodes, the service buildings and the line towers all come from OpenStreetMap; the perimeter fence is
   concrete panels (way 837198920 carries fence_type=concrete), the internal fences metal. The equipment
   itself (lattice portals, oil circuit breakers, disconnectors, current transformers, transformer banks with
   radiators and conservators, busbar tubes on post insulators, lightning masts) is drawn after typical
   Soviet 110/330 kV open switchyards: 110 kV portals ~12.5 m with 4 m phase spacing, 330 kV portals ~20 m,
   line towers ~26-29 m (У110-2+5 is 29.7 m in OSM) and ~36 m for the 330 kV lines. Reference street imagery:
   Mapillary drive 2020-05-23 along Jātnieku iela (frames 164296298876019, 198986131935733, 244101087468980,
   1102492393606776, 1238907256540166, 297033812015838) and 2021-09-06 along the south-west fence
   (160676465990769, 389192536245056, 580822476280298, 307758164279477).
   The 10/0.4 kV transformer substations of Sadales tīkls scattered through the district (building=service,
   power=substation) are drawn as brick or panel kiosks with a steel door, a ventilation grille and a
   yellow warning triangle. Frame ss: origin in the middle of the yard, u towards the 290/291 portals,
   v towards the 110 kV line-entry towers. Heights are relative to the ground; the terrain shader lifts
   every vertex, so the yard follows the DEM. */
// the two switchyard outlines in the local frame of LMF.ss; kept at module scope so the tree planter can
// test them without waiting for the landmark build (same lazy pattern as fuelNoTree / spwNoTree)
const SS_RING = [-116.4, -84.9, -134, -71.3, -137.3, -68.8, -35.6, 62.8, -32.1, 63.2, 78.1, -22.7, 78.3, -25.2, 67.4, -41.2, 106.9, -72, 108.5, -74.7, 107.3, -77.7, 91.4, -98.3, 180.1, -166.6, 183.6, -186.7, 112.7, -278.3, 63, -239.3, 75.6, -222.5, 21.8, -180.3, 12, -172.7, 5.8, -180.6, -27.5, -155.4, -113.9, -86.9];
const SS_RINGB = [493.6, -205.7, 484, -198.8, 481.3, -196.8, 473.3, -191, 492.2, -164.9, 504.8, -174, 512.5, -179.6];
let SS_RINGS = null;
let SS_POOLS = null;
function ssNoTree(x, z) {
  if (!SS_RINGS) { const f = LMF.ss, mk = r => { const w = []; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < r.length; i += 2) { const p = lmW(f, r[i], r[i + 1]); w.push(p[0], p[1]); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return { ring: w, bb: [x0, z0, x1, z1] }; }; SS_RINGS = [mk(SS_RING), mk(SS_RINGB)]; }
  for (const r of SS_RINGS) if (x >= r.bb[0] && x <= r.bb[2] && z >= r.bb[1] && z <= r.bb[3] && pip(x, z, r.ring)) return true;
  return false;
}

function lmSubstation(K) {
  const f = LMF.ss, G = K.plain, Gl = K.globe;
  // a sub-frame of the yard frame, centred at local (u,v) and turned by ang (for rotated equipment boxes)
  const fr = (u, v, ang) => { const w = lmW(f, u, v), c = Math.cos(ang), s = Math.sin(ang); return [w[0], w[1], f[2] * c - f[3] * s, f[3] * c + f[2] * s]; };
  const at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const pools = [];   // floodlight spill on the gravel, shown at night
  const STEEL = hb('#9aa2a6'), STEEL_D = hb('#7c8488'), CON = hb('#a8a6a0'), PORC = hb('#6b5d4f'),
    TR = hb('#7d8471'), GRAVEL = hb('#7c7a72'), FENCE = hb('#b5b2aa'), WALL = hb('#e8e6e0'),
    ROOF = hb('#55575a'), BRK = hb('#b0846a'), PAN = hb('#c9c6bd'), YEL = hb('#e8c832');
  STATE.GBC = null;
  // a box in world coordinates
  const box2 = (x, z, y0, y1, ha, col) => { const P = [[x - ha, y0, z - ha], [x + ha, y0, z - ha], [x + ha, y0, z + ha], [x - ha, y0, z + ha]];
    polyA(G, [P[0], P[1], [x + ha, y1, z - ha], [x - ha, y1, z - ha]], sh(col, 0.9), 0, 0, -1);
    polyA(G, [P[1], P[2], [x + ha, y1, z + ha], [x + ha, y1, z - ha]], sh(col, 0.95), 1, 0, 0);
    polyA(G, [P[2], P[3], [x - ha, y1, z + ha], [x + ha, y1, z + ha]], sh(col, 0.9), 0, 0, 1);
    polyA(G, [P[3], P[0], [x - ha, y1, z - ha], [x - ha, y1, z + ha]], sh(col, 0.85), -1, 0, 0);
    polyA(G, [[x - ha, y1, z - ha], [x + ha, y1, z - ha], [x + ha, y1, z + ha], [x - ha, y1, z + ha]], sh(col, 1.06), 0, 1, 0); };
  // concrete-panel fence along a local polyline, posts every 3 m
  const fenceLine = (pts, h = 2.5) => {
    for (let i = 0; i < pts.length - 2; i += 2) {
      const a = at(pts[i], pts[i + 1], 0), b = at(pts[i + 2], pts[i + 3], 0);
      const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz); if (len < 1e-3) continue;
      const tx = dx / len, tz = dz / len, nx = tz, nz = -tx, n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < n; k++) {
        const s0 = len * k / n, s1 = len * (k + 1) / n;
        const p0 = [a[0] + tx * s0, 0, a[2] + tz * s0], p1 = [a[0] + tx * s1, 0, a[2] + tz * s1];
        for (const sgn of [1, -1]) polyA(G, [[p0[0], 0.15, p0[2]], [p1[0], 0.15, p1[2]], [p1[0], h, p1[2]], [p0[0], h, p0[2]]], FENCE, nx * sgn, 0, nz * sgn);
        polyA(G, [[p0[0], h, p0[2]], [p1[0], h, p1[2]], [p1[0] + nx * 0.06, h, p1[2] + nz * 0.06], [p0[0] + nx * 0.06, h, p0[2] + nz * 0.06]], sh(FENCE, 1.05), 0, 1, 0);
        lmBar(G, [p0[0], 0, p0[2]], [p0[0], h + 0.15, p0[2]], 0.14, sh(FENCE, 0.9));
      }
      lmBar(G, [b[0], 0, b[2]], [b[0], h + 0.15, b[2]], 0.14, sh(FENCE, 0.9));
    }
  };
  // a sliding gate between two local points
  const gate = (u0, v0, u1, v1, h = 2.5) => {
    const a = at(u0, v0, 0), b = at(u1, v1, 0), dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz) || 1;
    const tx = dx / len, tz = dz / len, nx = tz, nz = -tx;
    for (const sgn of [1, -1]) polyA(G, [[a[0], 0.1, a[2]], [b[0], 0.1, b[2]], [b[0], h - 0.2, b[2]], [a[0], h - 0.2, a[2]]], sh(STEEL, 0.9), nx * sgn, 0, nz * sgn);
    for (let s = 0; s <= len; s += 0.5) lmBar(G, [a[0] + tx * s, 0.1, a[2] + tz * s], [a[0] + tx * s, h - 0.2, a[2] + tz * s], 0.05, STEEL_D);
    lmBar(G, [a[0], h - 0.2, a[2]], [b[0], h - 0.2, b[2]], 0.08, STEEL_D);
    lmBar(G, [a[0], 0.1, a[2]], [b[0], 0.1, b[2]], 0.08, STEEL_D);
    lmBar(G, [a[0], 0, a[2]], [a[0], h + 0.3, a[2]], 0.16, STEEL_D); lmBar(G, [b[0], 0, b[2]], [b[0], h + 0.3, b[2]], 0.16, STEEL_D);
  };
  // a lattice portal: two legs, a beam across the line, three post insulators with strings;
  // returns the three wire attachment points at the foot of the strings
  const portal = (u, v, ang, h = 12.5, sp = 4.2) => {
    const du = Math.cos(ang), dv = Math.sin(ang), hw = sp * 1.9, beamY = h - 1.6, pts = [];
    for (const s of [-1, 1]) {
      const lx = u + du * hw * s, lv = v + dv * hw * s;
      const b0 = at(lx - du * 0.5, lv - dv * 0.5, 0), b1 = at(lx + du * 0.5, lv + dv * 0.5, 0), t0 = at(lx, lv, beamY);
      box2(...lmW(f, lx, lv), 0, 0.5, 0.9, CON);
      lmBar(G, [b0[0], 0.5, b0[2]], t0, 0.22, STEEL); lmBar(G, [b1[0], 0.5, b1[2]], t0, 0.22, STEEL);
      for (let k = 1; k <= 3; k++) { const y0 = 0.5 + (beamY - 0.5) * (k - 1) / 3, y1 = 0.5 + (beamY - 0.5) * k / 3;
        lmBar(G, at(lx - du * 0.5 * (1 - k / 4), lv - dv * 0.5 * (1 - k / 4), y0), at(lx + du * 0.5 * (1 - k / 4), lv + dv * 0.5 * (1 - k / 4), y1), 0.07, STEEL); }
    }
    const e0 = at(u - du * hw, v - dv * hw, beamY), e1 = at(u + du * hw, v + dv * hw, beamY);
    lmBar(G, e0, e1, 0.3, STEEL); lmBar(G, [e0[0], beamY + 0.5, e0[2]], [e1[0], beamY + 0.5, e1[2]], 0.12, STEEL);
    for (let k = 0; k <= 6; k++) { const s = -hw + 2 * hw * k / 6;
      lmBar(G, at(u + du * s, v + dv * s, beamY), at(u + du * (s + hw / 6), v + dv * (s + hw / 6), beamY + 0.5), 0.06, STEEL); }
    const len = h - beamY + 1.0;
    for (const s of [-sp * 0.7, 0, sp * 0.7]) {
      const ix = u + du * s, iv = v + dv * s, p = at(ix, iv, beamY);
      lmLathe(G, p[0], p[2], beamY, [[0.1, 0], [0.1, len]], 6, PORC);
      for (let k = 0; k < 4; k++) lmLathe(G, p[0], p[2], beamY - len * (k + 0.5) / 4, [[0.24, 0], [0.24, 0.05]], 8, PORC);
      pts.push(at(ix, iv, beamY - len));
    }
    return pts;
  };
  // post insulator stack: porcelain core, sheds, steel cap
  const ins = (x, z, y0, h, col = PORC) => { lmLathe(G, x, z, y0, [[0.085, 0], [0.085, h]], 6, col);
    const n = Math.max(2, Math.round(h / 0.4)); for (let k = 0; k < n; k++) lmLathe(G, x, z, y0 + h * (k + 0.5) / n - 0.02, [[0.19, 0], [0.19, 0.05], [0.085, 0.07]], 8, col);
    lmLathe(G, x, z, y0 + h, [[0.11, 0], [0.11, 0.1]], 6, STEEL); };
  // shedded bushing, brown porcelain; r grows with voltage
  const bush = (x, z, y0, h, r) => { lmLathe(G, x, z, y0, [[r * 0.45, 0], [r * 0.45, h]], 6, PORC);
    const n = Math.max(3, Math.round(h / 0.26)); for (let k = 0; k < n; k++) lmLathe(G, x, z, y0 + h * (k + 0.5) / n - 0.025, [[r, 0], [r, 0.045], [r * 0.45, 0.065]], 8, PORC);
    lmLathe(G, x, z, y0 + h, [[r * 0.5, 0], [r * 0.5, 0.12]], 6, STEEL); };
  // oil circuit breaker: concrete raft, steel frame, control cabinet, three domed tanks with paired bushings
  const breaker = (u, v, ang, k = 1) => {
    const ff = fr(u, v, ang), bh = 1.2 * k;
    lmBoxL(G, ff, -2.2, 2.2, -1.1, 1.1, 0, 0.22, CON, false);
    lmBoxL(G, ff, -2.0, 2.0, -0.9, 0.9, 0.22, 1.0, STEEL_D, false);
    lmBoxL(G, ff, 1.4, 2.1, -0.8, 0.8, 1.0, 1.95, sh(STEEL, 0.92), false);
    lmBoxL(G, ff, 1.55, 1.95, -0.82, -0.78, 1.15, 1.75, sh(CON, 0.8), false);
    for (const s of [-1.4, 0, 1.4]) { const w = lmW(ff, s, 0);
      lmLathe(G, w[0], w[1], 1.0, [[0.46, 0], [0.5, 0.12], [0.5, 1.55 * k], [0.34, 1.68 * k], [0.14, 1.72 * k]], 10, TR);
      const b1 = lmW(ff, s, -0.26), b2 = lmW(ff, s, 0.26);
      bush(b1[0], b1[1], 1.0 + 1.66 * k, bh, 0.16 * k); bush(b2[0], b2[1], 1.0 + 1.66 * k, bh, 0.16 * k); }
    const t0 = lmW(ff, -1.4, 0), t1 = lmW(ff, 1.4, 0), ty = 1.0 + 1.72 * k + 0.1;
    lmBar(G, [t0[0], ty, t0[1]], [t1[0], ty, t1[1]], 0.07, STEEL);
  };
  // disconnector: concrete base, three phases of twin posts with blades, operating mechanism and rods
  const disco = (u, v, ang) => {
    const ff = fr(u, v, ang);
    lmBoxL(G, ff, -2.5, 2.5, -0.6, 0.6, 0, 0.2, CON, false);
    lmBoxL(G, ff, -2.4, 2.4, -0.14, 0.14, 0.2, 0.5, STEEL_D, false);
    lmBoxL(G, ff, -0.35, 0.35, -0.5, 0.5, 0.2, 1.05, sh(STEEL, 0.9), false);
    for (const s of [-1.6, 0, 1.6]) { const a = lmW(ff, s - 0.45, 0), b = lmW(ff, s + 0.45, 0);
      ins(a[0], a[1], 0.5, 2.1); ins(b[0], b[1], 0.5, 2.1);
      lmBar(G, [a[0], 2.72, a[1]], [b[0], 2.72, b[1]], 0.06, STEEL);
      lmBar(G, [b[0], 2.72, b[1]], [b[0], 3.05, b[1]], 0.05, STEEL);
      const m = lmW(ff, s, 0); lmBar(G, [m[0], 0.5, m[1]], [m[0], 2.6, m[1]], 0.04, STEEL_D); }
  };
  // current transformer: tall insulator, finned tank, top bushing, secondary terminal box
  const ct = (u, v) => { const w = lmW(f, u, v);
    box2(w[0], w[1], 0, 0.25, 0.5, CON);
    ins(w[0], w[1], 0.25, 2.3);
    lmLathe(G, w[0], w[1], 2.55, [[0.34, 0], [0.36, 0.1], [0.36, 0.6], [0.22, 0.72]], 10, TR);
    for (let k = 0; k < 4; k++) lmBar(G, [w[0] + 0.36, 2.65 + k * 0.13, w[1] - 0.2], [w[0] + 0.36, 2.65 + k * 0.13, w[1] + 0.2], 0.03, sh(TR, 0.85));
    bush(w[0], w[1], 3.27, 0.5, 0.12);
    box2(w[0] + 0.45, w[1], 0.25, 0.8, 0.16, sh(STEEL, 0.9)); lmBar(G, [w[0] + 0.45, 0.25, w[1]], [w[0] + 0.45, 0.02, w[1]], 0.04, STEEL_D); };
  // capacitor voltage transformer: insulator base, stacked capacitor cans, electromagnetic unit
  const cvt = (u, v) => { const w = lmW(f, u, v);
    box2(w[0], w[1], 0, 0.25, 0.45, CON); ins(w[0], w[1], 0.25, 1.4);
    let y = 1.65; for (let k = 0; k < 3; k++) { lmLathe(G, w[0], w[1], y, [[0.24, 0], [0.24, 0.55], [0.2, 0.6]], 8, sh(PORC, 1.06)); y += 0.62; }
    lmLathe(G, w[0], w[1], y, [[0.3, 0], [0.3, 0.4]], 8, TR); bush(w[0], w[1], y + 0.4, 0.45, 0.12);
    box2(w[0] + 0.38, w[1], 0.25, 0.7, 0.15, sh(STEEL, 0.9)); };
  // surge arrester: insulator base, shedded porcelain housing, earth lead and counter
  const arrester = (u, v) => { const w = lmW(f, u, v);
    box2(w[0], w[1], 0, 0.2, 0.3, CON); ins(w[0], w[1], 0.2, 0.9);
    lmLathe(G, w[0], w[1], 1.1, [[0.16, 0], [0.16, 1.7]], 6, sh(PORC, 0.95));
    for (let k = 0; k < 7; k++) lmLathe(G, w[0], w[1], 1.1 + 1.7 * (k + 0.5) / 7 - 0.025, [[0.22, 0], [0.22, 0.045], [0.16, 0.065]], 8, sh(PORC, 0.95));
    lmLathe(G, w[0], w[1], 2.8, [[0.1, 0], [0.1, 0.15]], 6, STEEL); lmBar(G, [w[0], 2.95, w[1]], [w[0], 3.15, w[1]], 0.04, STEEL);
    lmBar(G, [w[0] + 0.16, 1.2, w[1]], [w[0] + 0.32, 0.05, w[1]], 0.03, STEEL_D); box2(w[0] + 0.32, w[1], 0, 0.3, 0.1, sh(STEEL, 0.8)); };
  // power transformer: oil pit, rails, tank, radiator banks, conservator, HV/LV bushings, tap changer, nameplate
  const trafo = (u, v, ang, big = true) => {
    const ff = fr(u, v, ang), L = big ? 5.0 : 3.4, W = big ? 2.8 : 2.1, H = big ? 3.4 : 2.5;
    const P = (s, t, y) => at(u + Math.cos(ang) * s - Math.sin(ang) * t, v + Math.sin(ang) * s + Math.cos(ang) * t, y);
    lmBoxL(G, ff, -L / 2 - 1.1, L / 2 + 1.1, -W / 2 - 1.1, W / 2 + 1.1, 0, 0.1, sh(GRAVEL, 0.88), false);
    for (const [a, b, c, d] of [[-L / 2 - 1.1, L / 2 + 1.1, -W / 2 - 1.1, -W / 2 - 0.8], [-L / 2 - 1.1, L / 2 + 1.1, W / 2 + 0.8, W / 2 + 1.1], [-L / 2 - 1.1, -L / 2 - 0.8, -W / 2 - 1.1, W / 2 + 1.1], [L / 2 + 0.8, L / 2 + 1.1, -W / 2 - 1.1, W / 2 + 1.1]])
      lmBoxL(G, ff, a, b, c, d, 0.1, 0.5, CON, false);
    lmBoxL(G, ff, -L / 2, L / 2, -W / 2 + 0.25, -W / 2 + 0.45, 0.1, 0.22, sh(STEEL, 0.7), false);
    lmBoxL(G, ff, -L / 2, L / 2, W / 2 - 0.45, W / 2 - 0.25, 0.1, 0.22, sh(STEEL, 0.7), false);
    lmBoxL(G, ff, -L / 2, L / 2, -W / 2, W / 2, 0.35, 0.5, CON, false);
    lmBoxL(G, ff, -L / 2, L / 2, -W / 2, W / 2, 0.5, 0.5 + H, TR, false);
    lmBoxL(G, ff, -L / 2, L / 2, -W / 2, W / 2, 0.5 + H, 0.66 + H, sh(TR, 1.08), false);
    const nr = big ? 8 : 5;
    for (let k = 0; k < nr; k++) { const s = -L / 2 + 0.45 + k * (L - 0.9) / (nr - 1);
      lmBoxL(G, ff, s - 0.11, s + 0.11, -W / 2 - 0.5, -W / 2 - 0.04, 0.8, 0.45 + H, sh(TR, 0.82), false);
      lmBoxL(G, ff, s - 0.11, s + 0.11, W / 2 + 0.04, W / 2 + 0.5, 0.8, 0.45 + H, sh(TR, 0.82), false); }
    const cy = 0.66 + H + 0.62, ca = P(-L / 2 + 0.7, 0, cy), cb = P(L / 2 - 1.5, 0, cy);
    lmBar(G, ca, cb, 0.62, sh(TR, 1.05));
    lmLathe(G, ca[0], ca[2], cy - 0.31, [[0.31, 0], [0.31, 0.62]], 8, sh(TR, 1.05));
    lmBoxL(G, ff, -L / 2 + 0.6, -L / 2 + 0.8, -0.08, 0.08, 0.66 + H, cy - 0.28, STEEL_D, false);
    lmBoxL(G, ff, L / 2 - 1.6, L / 2 - 1.4, -0.08, 0.08, 0.66 + H, cy - 0.28, STEEL_D, false);
    for (const s of [-L / 3, 0, L / 3]) { const p = P(s, -W / 4, 0.66 + H); bush(p[0], p[2], p[1], big ? 2.1 : 1.3, big ? 0.2 : 0.14); }
    for (const s of [-L / 3, 0, L / 3]) { const p = P(s, W / 4, 0.66 + H); bush(p[0], p[2], p[1], big ? 0.85 : 0.6, 0.12); }
    const tc = P(L / 2 + 0.32, 0, 0);
    lmLathe(G, tc[0], tc[2], 0.5 + H * 0.35, [[0.3, 0], [0.3, H * 0.5]], 8, sh(TR, 0.9));
    lmBoxL(G, ff, -0.3, 0.3, -W / 2 - 0.03, -W / 2, 1.3, 1.7, LMWHITE, false);
  };
  // busbar tubes on post insulators behind the portal row
  const busbar = (u0, v0, u1, v1, y) => {
    const a = at(u0, v0, y), b = at(u1, v1, y), len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    lmBar(G, a, b, 0.14, STEEL);
    const n = Math.max(2, Math.round(len / 7));
    for (let k = 0; k <= n; k++) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
      ins(x, z, 0.2, y - 0.4); }
  };
  // lattice line tower; arms run across the line at angle ang, returns the attachment points
  const tower = (x, z, h, arms, col, ang = 0) => {
    const ca = Math.cos(ang), sa = Math.sin(ang), top = h - 1.2, pts = [];
    box2(x, z, 0, 1.4, 0, col);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      lmBar(G, [x + sx * 1.05, 0.35, z + sz * 1.05], [x + sx * 0.3, top, z + sz * 0.3], 0.16, col);
      for (let k = 1; k <= 4; k++) { const y0 = 0.35 + (top - 0.35) * (k - 1) / 4, y1 = 0.35 + (top - 0.35) * k / 4,
        w0 = 1.05 + (0.3 - 1.05) * (k - 1) / 4, w1 = 1.05 + (0.3 - 1.05) * k / 4;
        lmBar(G, [x + sx * w0, y0, z + sz * w0], [x + sx * w1, y1, z - sz * w1], 0.06, col);
        lmBar(G, [x + sx * w0, y0, z + sz * w0], [x - sx * w1, y1, z + sz * w1], 0.06, col); }
    }
    for (const [aw, ay] of arms) {
      lmBar(G, [x - ca * aw, ay, z - sa * aw], [x + ca * aw, ay, z + sa * aw], 0.18, col);
      lmBar(G, [x - ca * aw * 0.55, ay + 1.6, z - sa * aw * 0.55], [x + ca * aw * 0.55, ay + 1.6, z + sa * aw * 0.55], 0.1, col);
      for (const s of [-1, 1]) { const ax = x + ca * aw * s, az = z + sa * aw * s;
        lmBar(G, [ax, ay - 1.2, az], [ax, ay, az], 0.12, PORC); pts.push([ax, ay - 1.2, az]); }
    }
    lmBar(G, [x, top, z], [x, h + 0.8, z], 0.1, col);
    return pts;
  };
  // a sagging wire between two points
  const wire = (a, b, col = 0.1) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz), sag = len * 0.012 + 0.6, n = Math.max(2, Math.round(len / 25));
    let prev = a;
    for (let k = 1; k <= n; k++) { const t = k / n, p = [a[0] + dx * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + dz * t];
      lmBar(G, prev, p, col, hb('#3a3d40')); prev = p; }
  };
  // a chain of towers with wires and a ground wire; returns the last attachment points
  const chain = (list, heights, arms, col) => {
    let prev = null, prevTop = null;
    for (let i = 0; i < list.length; i++) {
      const [x, z] = list[i], h = typeof heights === 'function' ? heights(i) : heights;
      const nxt = list[i + 1] || list[i - 1], ang = Math.atan2(nxt[1] - z, nxt[0] - x) + Math.PI / 2;
      const pts = tower(x, z, h, arms, col, ang), top = [x, h + 0.8, z];
      if (prev) { for (let k = 0; k < Math.min(prev.length, pts.length); k++) wire(prev[k], pts[k], 0.12); wire(prevTop, top, 0.07); }
      prev = pts; prevTop = top;
    }
    return prev;
  };
  // aviation light on a tall tower (glows at night through LMM.det)
  const light = (x, z, y) => { const t = LMT.tvRed; K.det.q([x - 0.2, y, z], [x + 0.2, y, z], [x + 0.2, y + 0.4, z], [x - 0.2, y + 0.4, z], [0, 0, 1], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, 1); };
  // floodlight mast: concrete foot, tapered pole, braced crossarm, four heads with glowing lenses
  const mast = (u, v, h = 24) => { const w = lmW(f, u, v), x = w[0], z = w[1]; pools.push([x, z, 16]);
    box2(x, z, 0, 0.4, 0.55, CON);
    lmLathe(G, x, z, 0.4, [[0.3, 0], [0.13, h]], 8, STEEL);
    lmBar(G, [x - 0.95, h + 0.3, z], [x + 0.95, h + 0.3, z], 0.1, STEEL_D);
    lmBar(G, [x, h - 1.2, z], [x - 0.95, h + 0.3, z], 0.06, STEEL_D); lmBar(G, [x, h - 1.2, z], [x + 0.95, h + 0.3, z], 0.06, STEEL_D);
    for (const dx of [-0.8, -0.28, 0.28, 0.8]) { const hx = x + dx;
      lmLathe(G, hx, z, h + 0.02, [[0.15, 0], [0.19, 0.26], [0.15, 0.3]], 6, sh(STEEL, 0.82));
      polyA(Gl, [[hx - 0.15, h + 0.04, z - 0.15], [hx + 0.15, h + 0.04, z - 0.15], [hx + 0.15, h + 0.04, z + 0.15], [hx - 0.15, h + 0.04, z + 0.15]], LMWHITE, 0, -1, 0); }
    light(x, z, h + 0.5); };
  // a concrete service road strip along a local line
  const road = (u0, v0, u1, v1, w = 3.2) => {
    const dx = u1 - u0, dv = v1 - v0, L = Math.hypot(dx, dv) || 1, nx = -dv / L * w / 2, nv = dx / L * w / 2;
    const P = [[u0 + nx, v0 + nv], [u1 + nx, v1 + nv], [u1 - nx, v1 - nv], [u0 - nx, v0 - nv]].map(p => { const q = lmW(f, p[0], p[1]); return [q[0], 0.12, q[1]]; });
    polyA(G, P, sh(CON, 0.9), 0, 1, 0); };
  // a cable trench with concrete cover slabs along a local line
  const trench = (u0, v0, u1, v1) => {
    const dx = u1 - u0, dv = v1 - v0, L = Math.hypot(dx, dv) || 1, nx = -dv / L * 0.32, nv = dx / L * 0.32;
    const P = [[u0 + nx, v0 + nv], [u1 + nx, v1 + nv], [u1 - nx, v1 - nv], [u0 - nx, v0 - nv]].map(p => { const q = lmW(f, p[0], p[1]); return [q[0], 0.16, q[1]]; });
    polyA(G, P, sh(CON, 1.06), 0, 1, 0);
    const n = Math.max(1, Math.round(L / 1.2));
    for (let k = 1; k < n; k++) { const t = k / n, cx = u0 + dx * t, cz = v0 + dv * t, a = lmW(f, cx + nx, cz + nv), b = lmW(f, cx - nx, cz - nv);
      lmBar(G, [a[0], 0.17, a[1]], [b[0], 0.17, b[1]], 0.03, sh(CON, 0.78)); } };
  // a concrete fire wall between transformers
  const fireWall = (u, v, ang, len, h) => { const ff = fr(u, v, ang);
    lmBoxL(G, ff, -len / 2, len / 2, -0.18, 0.18, 0, h, CON, false);
    lmBoxL(G, ff, -len / 2, len / 2, -0.24, 0.24, h, h + 0.14, sh(CON, 1.05), false); };
  // jumper drops from a portal's three string feet down to the bay breaker bushings
  const drops = (pts, bu, bv, ang, k = 1) => { if (!pts) return; const ff = fr(bu, bv, ang), ty = 1.0 + 1.66 * k + 1.2 * k + 0.12;
    for (let i = 0; i < Math.min(3, pts.length); i++) { const w = lmW(ff, (i - 1) * 1.4, 0); wire(pts[i], [w[0], ty, w[1]], 0.08); } };

  /* ---- the yard ---- */
  const ring = SS_RING;
  const ringPts = []; for (let i = 0; i < ring.length; i += 2) ringPts.push([ring[i], ring[i + 1]]);
  // flatPlain draws in WORLD xz, so the local outline must be carried through the frame first
  const toWorld = r => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(...lmW(f, r[i], r[i + 1])); return o; };
  const ringW = toWorld(ring);
  flatPlain(G, [ringW], 0.08, GRAVEL);
  flatPlain(G, [toWorld(offsetRing(ring, -3))], 0.09, sh(GRAVEL, 1.05));   // a slightly lighter gravel heart
  lmRegisterOutline(f, ringPts, 6, false);
  fenceLine(ring);
  // the outer fence along the south-west side (way 837198920)
  fenceLine([-114, -187, -57.8, -229.7, -55.5, -231.5, -47.6, -227.7, 41.2, -287.8, 82.6, -315.1, 86.1, -313.6, 88.3, -310.8, 112.7, -278.3]);
  // the internal fence between the 110 kV and 330 kV zones (968886508) with its gate (968886511)
  fenceLine([-57.8, -229.7, -47.9, -216.1, 27.5, -121.3]);
  gate(27.5, -121.3, 18.8, -114.8);
  // the north-west internal fence and wall (968886497, 968886498)
  fenceLine([-119.1, -97.5, -122.7, -102.3, -130.2, -111.8, -94.8, -139.5, -102.1, -148.8]);

  /* ---- 110 kV portal row ---- */
  const p131 = portal(-18.3, 12.2, -0.25), p132 = portal(-12, 7.2, -0.11), p631 = portal(-5.7, 2.4, -0.44),
    p632 = portal(19.6, -17.1, 0.11), p133 = portal(38.6, -31.8, 0.07), p137 = portal(44.9, -36.6, -0.72),
    p136 = portal(57.6, -46.3, -0.5), p291 = portal(70.2, -56.2, 0.78), p290 = portal(89.2, -70.7, 0.66);
  busbar(-22, 8.5, 92, -76.5, 6.5); busbar(-22, 5.5, 92, -79.5, 6.5);
  for (const [u, v] of [[-18.3, 12.2], [-5.7, 2.4], [19.6, -17.1], [44.9, -36.6], [70.2, -56.2]]) {
    breaker(u - 4, v - 8, 0.9); disco(u - 8, v - 12, 0.9); ct(u - 1, v - 11); cvt(u + 2, v - 12); arrester(u + 4, v - 7); }
  // cable trenches along the bay rows and service roads behind the portal lines
  trench(-26, 2, 78, -64); trench(-26, -2, 78, -68);
  road(-30, 16, 92, -72, 3.4); road(-44, -22, 82, -104, 3.4);
  drops(p131, -22.3, 4.2, 0.9); drops(p631, -9.7, -5.6, 0.9); drops(p632, 15.6, -25.1, 0.9); drops(p137, 40.9, -44.6, 0.9); drops(p291, 66.2, -64.2, 0.9);
  /* ---- transformers ---- */
  trafo(0.3, -95.3, 0.9, true); trafo(-34, -94.4, 0.9, true); trafo(-66.7, -105.4, 0.9, true);
  trafo(-85.3, -91.1, 0.9, false); trafo(-27.5, -155.4, 0.9, true); trafo(28.5, -134.7, 0.9, true);
  trafo(54.7, -126, 0.9, false); trafo(-55.4, -231.5, 0.9, false);
  // concrete fire walls between the adjacent oil-filled transformers
  for (const [a, b] of [[[0.3, -95.3], [-34, -94.4]], [[-34, -94.4], [-66.7, -105.4]], [[-27.5, -155.4], [28.5, -134.7]]]) {
    fireWall((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2, 6.5, 4.6); }
  road(-90, -80, 60, -150, 3.6); trench(-70, -88, 40, -140);
  /* ---- 330 kV portal row ---- */
  const p313 = portal(85.3, -237.9, 0.95, 20, 6.5), p314 = portal(128.6, -182.4, 0.95, 20, 6.5);
  portal(97.4, -222.4, 0.95, 20, 6.5); portal(68.1, -193.5, 0.95, 20, 6.5);
  portal(84.8, -170.2, 0.95, 20, 6.5); portal(106.3, -144.8, 0.95, 20, 6.5);
  portal(138.6, -169.5, 0.95, 20, 6.5); portal(118, -197.1, 0.95, 20, 6.5);
  portal(-17.4, -285.3, 0.33, 20, 6.5);
  busbar(60, -245, 145, -160, 11); busbar(60, -249, 145, -164, 11);
  for (const [u, v] of [[85.3, -237.9], [128.6, -182.4], [106.3, -144.8]]) { breaker(u - 6, v - 10, 2.5, 1.6); disco(u - 12, v - 16, 2.5); ct(u - 2, v - 14); cvt(u + 3, v - 15); arrester(u + 6, v - 9); }
  trench(60, -240, 145, -156); road(50, -256, 152, -150, 3.6);
  drops(p313, 79.3, -247.9, 2.5, 1.6); drops(p314, 122.6, -192.4, 2.5, 1.6);
  mast(-40, -60); mast(60, -120); mast(120, -200); mast(-100, -200);
  mast(20, -30, 20); mast(-70, -150, 22); mast(100, -262, 22); mast(-112, -120, 20);

  /* ---- service buildings (heights from the cadastre) ---- */
  const bld = (poly, top, rows, lit = 1) => {
    const ops = [], n = poly.length;
    for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 7) continue; const cnt = Math.max(1, Math.floor((len - 3) / 4.5));
      for (const [ry, dy, hh] of rows) { const fl = dy > 0 ? Math.max(1, Math.floor((top - 0.3 - ry - hh) / dy) + 1) : 1;
        for (let k = 0; k < fl; k++) lmRow(ops, a[0], a[1], b[0], b[1], cnt, 2.2, ry + dy * k, ry + dy * k + hh, 'scSmall', { d: 0.22, lit }); } }
    lmOp(ops, (poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[1][1]) / 2, 2.4, 0, 3.0, 'scDoor', { d: 0.15 });
    lmBlock(K, f, { poly, top, st: { tex: 7, col: WALL, plinth: 0.45, pcol: hb('#9c978e') }, cornice: [[top - 0.25, top + 0.15, 0.12, WALL]], roof: ROOF, roofY: top + 0.15 }, ops);
    lmRegisterOutline(f, poly, 2);
  };
  bld([[-14.4, -135.6], [-3.5, -144], [18.8, -114.8], [23.6, -108.6], [12.6, -100.3]], 7.2, [[2.0, 0, 4.2]]);          // ЗРУ 10 кВ hall
  bld([[-10.8, -229.5], [-1.3, -237.2], [20.9, -209.8], [11.4, -202.1]], 10.2, [[1.4, 4.6, 2.6]]);
  bld([[-21.2, -208.2], [-17.7, -203.8], [-26.1, -197.1], [-29.7, -201.5]], 3.6, [[1.1, 0, 1.5]], 0);
  bld([[-65.3, -124.2], [-59.8, -128.5], [-36.8, -99.9], [-42.2, -95.5]], 4.6, [[1.2, 0, 1.9]]);
  bld([[-79.9, -123.1], [-75.8, -117.7], [-97.2, -101.4], [-95.6, -99.2], [-112.3, -86.5], [-120.1, -96.7], [-119.1, -97.5], [-103.3, -109.5], [-101.3, -106.8]], 3.6, [[1.1, 0, 1.5]], 0);
  bld([[0.3, -95.3], [17.8, -72.5], [22.8, -76.3], [5.3, -99.1]], 3.6, [[1.1, 0, 1.5]]);                              // Jātnieku 95B
  bld([[-102.1, -148.8], [-125, -178.5], [-113.9, -187], [-91.1, -157.3]], 10.2, [[1.4, 4.6, 2.6]]);
  bld([[-116.6, -220.8], [-125.6, -233.6], [-69.1, -273], [-52.4, -276.5], [-47.5, -271.3]], 15.1, [[1.4, 2.9, 1.8]]); // main control building

  /* ---- line-entry towers and the 110 kV lines ---- */
  const angTo = (ax, az, bx, bz) => Math.atan2(bz - az, bx - ax) + Math.PI / 2;
  const t131 = tower(934.3, -1010.7, 26, [[8, 16], [10, 19.5], [8, 23]], STEEL, angTo(934.3, -1010.7, 887.5, -1014.3));
  const t132 = tower(948.6, -1025.5, 26, [[8, 16], [10, 19.5], [8, 23]], STEEL, angTo(948.6, -1025.5, 892.9, -1021.4));
  const t631 = tower(922.5, -1047.3, 26, [[8, 16], [10, 19.5], [8, 23]], STEEL, angTo(922.5, -1047.3, 898.4, -1028.4));
  const t632 = tower(936.9, -1062.1, 26, [[8, 16], [10, 19.5], [8, 23]], STEEL, angTo(936.9, -1062.1, 919.1, -1052.5));
  const t133 = tower(916.4, -1060.5, 27, [[8, 17], [10, 20.5], [8, 24]], STEEL, angTo(916.4, -1060.5, 864.4, -1082.4));
  const t136 = tower(927.7, -1117.1, 28, [[8, 17.5], [10, 21], [8, 24.5]], STEEL, angTo(927.7, -1117.1, 859.4, -1100.7));
  for (const k of [0, 2, 4]) { wire(t131[k], p131[k / 2], 0.12); wire(t132[k], p132[k / 2], 0.12); wire(t631[k], p631[k / 2], 0.12); wire(t632[k], p632[k / 2], 0.12); wire(t133[k], p133[k / 2], 0.12); wire(t136[k], p136[k / 2], 0.12); }
  light(934.3, -1010.7, 26.8); light(927.7, -1117.1, 28.8);
  chain([[934.3, -1010.7], [1012.4, -985.2], [1105.1, -954.6], [1197.8, -924.1], [1290.6, -893.5], [1383.3, -862.9]], i => i === 4 ? 29 : 26, [[7, 24], [9, 20.5], [7, 17]], STEEL);
  chain([[948.6, -1025.5], [1026.7, -1000.1], [1119.4, -969.5], [1212.1, -938.9], [1304.9, -908.4], [1397.6, -877.8]], i => i === 4 ? 29 : 26, [[7, 24], [9, 20.5], [7, 17]], STEEL);
  chain([[922.5, -1047.3], [990.2, -1092.4], [1058, -1137.5], [1125.7, -1182.6], [1193.5, -1227.7]], 26, [[7, 24], [9, 20.5], [7, 17]], STEEL);
  chain([[936.9, -1062.1], [1004.6, -1107.2], [1072.4, -1152.3], [1140.1, -1197.4], [1207.9, -1242.5]], 26, [[7, 24], [9, 20.5], [7, 17]], STEEL);
  chain([[916.4, -1060.5], [990.2, -1092.4], [1064.1, -1124.3], [1137.9, -1156.2], [1211.8, -1188.1], [1285.6, -1220]], i => i === 4 ? 29 : 26, [[7, 24], [9, 20.5], [7, 17]], STEEL);
  const last136 = chain([[927.7, -1117.1], [971.3, -1195.2], [927.1, -1345.2], [880.8, -1506.1]], 28, [[7.5, 24], [9.5, 20.5], [7.5, 17]], STEEL);
  const t290 = tower(769.1, -1256.8, 27, [[8, 17], [10, 20.5], [8, 24]], STEEL, angTo(769.1, -1256.8, 844, -1142.9));
  const t291 = tower(777.9, -1269.7, 27, [[8, 17], [10, 20.5], [8, 24]], STEEL, angTo(777.9, -1269.7, 851.5, -1157.4));
  for (const k of [0, 2, 4]) { wire(t290[k], p290[k / 2], 0.12); wire(t291[k], p291[k / 2], 0.12); }
  chain([[769.1, -1256.8], [705.4, -1330.2], [641.7, -1403.6], [578, -1477], [514.3, -1550.4]], 27, [[7, 24], [9, 20.5], [7, 17]], STEEL);
  chain([[777.9, -1269.7], [714.2, -1343.1], [650.5, -1416.5], [586.8, -1489.9], [523.1, -1563.3]], 27, [[7, 24], [9, 20.5], [7, 17]], STEEL);

  /* ---- 330 kV lines towards Līksna (ways 141554665 ref 313, 172286301 ref 314) ---- */
  const c313 = chain([[673.1, -1233.1], [657.4, -1260.5], [581.1, -1419.6], [498.2, -1566.2], [412, -1717.6], [329.6, -1862.3], [246.9, -2007.5]], 36, [[11, 28], [14, 22.5], [11, 17]], STEEL);
  const c314 = chain([[737, -1254.9], [715.1, -1281.1], [611.2, -1425.9], [523.3, -1557.2], [437.7, -1685], [352.9, -1811.7], [268.2, -1938.2]], 36, [[11, 28], [14, 22.5], [11, 17]], STEEL);
  for (const k of [0, 2, 4]) { wire(p313[k / 2], c313[k], 0.14); wire(p314[k / 2], c314[k], 0.14); }

  /* ---- substation "Daugavpils B" 110/10 kV (way 1066909952) ---- */
  const ringB = SS_RINGB;
  const ringBPts = []; for (let i = 0; i < ringB.length; i += 2) ringBPts.push([ringB[i], ringB[i + 1]]);
  flatPlain(G, [toWorld(ringB)], 0.08, GRAVEL);
  lmRegisterOutline(f, ringBPts, 6, false);
  fenceLine(ringB, 2.2);
  gate(481.3, -196.8, 484, -198.8, 2.2);
  portal(481.3, -184.5, 0.88, 12.5, 4.2);
  trafo(494.6, -194.3, 2.4, false); trafo(500.9, -184.4, 2.4, false);
  for (const k of [0, 2, 4]) wire(last136[k], at(481.3, -184.5, 8.3), 0.12);
  bld([[529.9, -192.6], [511.5, -218.4], [498.3, -209.1], [516.9, -182.9]], 3.5, [[1.1, 0, 1.5]], 0);
  // the outer fences of the industrial 110 kV yard north of it (ways 955814695, 875583893-896)
  fenceLine([473.2, -90.8, 471, -94.1, 462.3, -105.9, 445.9, -128.4, 444.2, -130.7, 492.2, -164.9, 504.8, -174], 2.2);
  fenceLine([370, -53.6, 339.9, -96.1, 344.7, -99.5], 2.2);
  fenceLine([352, -105, 358.7, -109.8, 390.1, -109, 401.4, -105.9, 409.4, -96.3], 2.2);
  fenceLine([388.8, -26.6, 427.2, -53.1, 424.1, -57.5], 2.2);
  fenceLine([433.1, -79.1, 440.3, -84.3, 453.6, -65.9, 439, -55.4, 425.9, -73.9, 430.2, -77], 2.2);

  /* ---- 10/0.4 kV transformer substations of the district ---- */
  const tp = (pts, mat = BRK, h = 2.6) => {
    let poly = pts.map(([x, z]) => [x, z]);
    if (area2(poly.flat()) < 0) poly = poly.slice().reverse();
    const flat = poly.flat(), ops = [];
    let bi = 0, bl = 0; const n = poly.length;
    for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; bi = i; } }
    const a = poly[bi], b = poly[(bi + 1) % n], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const tx = (b[0] - a[0]) / bl, tz = (b[1] - a[1]) / bl, nx = tz, nz = -tx;
    const [du0, dv0] = lmL(f, mx - tx * 0.7, mz - tz * 0.7), [du1, dv1] = lmL(f, mx + tx * 0.8, mz + tz * 0.8);
    lmOp(ops, du0, dv0, 1.1, 0.05, 2.2, 'kpSteel', { d: 0.12 });
    lmOp(ops, du1, dv1, 0.8, 1.5, 2.1, 'vkGrille', { d: 0.1 });
    lmBlock(K, f, { poly: poly.map(([x, z]) => lmL(f, x, z)), top: h, st: { tex: mat === BRK ? 6 : 5, col: mat, plinth: 0.3, pcol: sh(mat, 0.8) }, cornice: [[h - 0.12, h + 0.1, 0.08, sh(mat, 1.05)]], roof: ROOF, roofY: h + 0.1 }, ops);
    // yellow warning triangle with a lightning bolt on the door side
    const sx = mx + nx * 0.03, sz = mz + nz * 0.03, s = 0.28;
    polyA(G, [[sx - tx * s, 1.9, sz - tz * s], [sx + tx * s, 1.9, sz + tz * s], [sx, 1.9 + s * 1.6, sz]], YEL, nx, 0, nz);
    polyA(G, [[sx - tx * s * 0.45, 1.95, sz - tz * s * 0.45], [sx + tx * s * 0.2, 1.95, sz + tz * s * 0.2], [sx - tx * s * 0.05, 1.95 + s * 0.7, sz - tz * s * 0.05]], hb('#222222'), nx, 0, nz);
    lmRegisterOutline(f, poly.map(([x, z]) => lmL(f, x, z)), 2);
  };
  tp([[403.5, -914.6], [410.2, -915], [410.6, -907.8], [403.9, -907.4]]);                       // Šaurā 23A
  tp([[476, -1280.1], [477.1, -1272.5], [470.6, -1271.7], [469.6, -1279.2]]);                   // Šaurā 28A
  tp([[384, -1184.9], [390.6, -1185.5], [391.3, -1177.7], [384.6, -1177.1]], PAN);              // Šaurā 29B
  tp([[591.3, -922], [595, -925.3], [596.9, -923.2], [593.2, -919.9]], BRK, 2.7);               // Jātnieku 91A
  tp([[1485.3, -1551.4], [1476, -1535], [1459.3, -1544.5], [1468.7, -1560.9]]);                // Jātnieku 90, traction
  tp([[1769.6, -915.4], [1773.6, -921.2], [1779, -917.5], [1775, -911.7]], PAN);                // Zeļinska 25A
  tp([[1436, -1285.5], [1440.1, -1280.2], [1435.3, -1276.5], [1431.2, -1281.7]]);               // Arhitektu 19
  tp([[14.9, -981.2], [14.5, -985.6], [18, -985.9], [18.4, -981.4]], PAN, 2.7);
  tp([[1267.9, -1669.4], [1267.2, -1671.8], [1273.8, -1673.8], [1274.5, -1671.3]], PAN, 2.7);
  tp([[-253.6, -2468.9], [-257.8, -2462.6], [-263, -2466.1], [-258.7, -2472.4]]);               // Piekrastes 47B
  tp([[-60.1, -1289.5], [-45.7, -1277.6], [-49.5, -1273.2], [-63.6, -1285.4]], PAN, 3.6);

  /* ---- pools of floodlight on the gravel, lit only at night (same recipe as the fuel stations) ---- */
  { const pos = [], uv = [], idx = [];
    for (const [x, z, h] of pools) { const k = pos.length / 3; pos.push(x - h, 0.14, z - h, x + h, 0.14, z - h, x + h, 0.14, z + h, x - h, 0.14, z + h); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(k, k + 2, k + 1, k, k + 3, k + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(0.82, 0.88, 1.0), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.renderOrder = 5; m.frustumCulled = false; m.visible = false; scene.add(m); SS_POOLS = m; }
}

export { lmSubstation, ssNoTree, SS_POOLS };
