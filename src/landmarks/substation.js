import { STATE } from '../core/state.js';
import { lmBar, lmBlock, lmBoxL, lmLathe, lmOp, lmRow } from './helpers.js';
import { LMT } from './tiles.js';
import { LMF, LMWHITE, lmL, lmW } from './core.js';
import { lmRegisterOutline } from './tv-tower.js';
import { polyA } from '../core/geometry.js';
import { area2, hash, hb, offsetRing, pip, sh, triangulate } from '../core/util.js';
import { subTris } from '../world/terrain.js';
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
   line towers 29.7 m (У110-2+5 in OSM) and 40.6 m (У220-2+9) for the 330 kV lines, three phases plus an
   earth wire on every span, bundled conductors on 330 kV. Reference street imagery:
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
    ROOF = hb('#55575a'), BRK = hb('#b0846a'), PAN = hb('#c9c6bd'), YEL = hb('#e8c832'),
    GRN = hb('#3f9b4f'), RED = hb('#c8402e');
  const PH = [YEL, GRN, RED];   // phase marking A/B/C: yellow, green, red
  STATE.GBC = null;
  // a box in world coordinates
  const box2 = (x, z, y0, y1, ha, col) => { const P = [[x - ha, y0, z - ha], [x + ha, y0, z - ha], [x + ha, y0, z + ha], [x - ha, y0, z + ha]];
    polyA(G, [P[0], P[1], [x + ha, y1, z - ha], [x - ha, y1, z - ha]], sh(col, 0.9), 0, 0, -1);
    polyA(G, [P[1], P[2], [x + ha, y1, z + ha], [x + ha, y1, z - ha]], sh(col, 0.95), 1, 0, 0);
    polyA(G, [P[2], P[3], [x - ha, y1, z + ha], [x + ha, y1, z + ha]], sh(col, 0.9), 0, 0, 1);
    polyA(G, [P[3], P[0], [x - ha, y1, z - ha], [x - ha, y1, z + ha]], sh(col, 0.85), -1, 0, 0);
    polyA(G, [[x - ha, y1, z - ha], [x + ha, y1, z - ha], [x + ha, y1, z + ha], [x - ha, y1, z + ha]], sh(col, 1.06), 0, 1, 0); };
  // a yellow warning triangle with a black lightning bolt, mounted on a face with normal (nx,nz)
  const warn = (cx, cz, y, tx, tz, nx, nz, s = 0.3) => { const x = cx + nx * 0.03, z = cz + nz * 0.03;
    polyA(G, [[x - tx * s, y, z - tz * s], [x + tx * s, y, z + tz * s], [x, y + s * 1.6, z]], YEL, nx, 0, nz);
    polyA(G, [[x - tx * s * 0.45, y + 0.06, z - tz * s * 0.45], [x + tx * s * 0.2, y + 0.06, z + tz * s * 0.2], [x - tx * s * 0.05, y + 0.06 + s * 0.7, z - tz * s * 0.05]], hb('#222222'), nx, 0, nz); };
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
        if ((i / 2 + k) % 8 === 0) warn((p0[0] + p1[0]) / 2, (p0[2] + p1[2]) / 2, h * 0.55, tx, tz, nx, nz);
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
    // a white warning board with the lightning triangle on both faces of the gate
    const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
    for (const sgn of [1, -1]) polyA(G, [[mx - tx * 0.7, 1.3, mz - tz * 0.7], [mx + tx * 0.7, 1.3, mz + tz * 0.7], [mx + tx * 0.7, 2.1, mz + tz * 0.7], [mx - tx * 0.7, 2.1, mz - tz * 0.7]], LMWHITE, nx * sgn, 0, nz * sgn);
    warn(mx, mz, 1.45, tx, tz, nx, nz, 0.26); warn(mx, mz, 1.45, tx, tz, -nx, -nz, 0.26);
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
    [-sp * 0.7, 0, sp * 0.7].forEach((s, i) => {
      const ix = u + du * s, iv = v + dv * s, p = at(ix, iv, beamY);
      lmLathe(G, p[0], p[2], beamY, [[0.1, 0], [0.1, len]], 6, PORC);
      for (let k = 0; k < 4; k++) lmLathe(G, p[0], p[2], beamY - len * (k + 0.5) / 4, [[0.24, 0], [0.24, 0.05]], 8, PORC);
      pts.push(at(ix, iv, beamY - len));
      lmLathe(G, p[0], p[2], beamY - len - 0.14, [[0.13, 0], [0.13, 0.12]], 8, PH[i]);
    });
    return pts;
  };
  // post insulator stack: porcelain core, sheds, steel cap
  const ins = (x, z, y0, h, col = PORC) => { lmLathe(G, x, z, y0, [[0.085, 0], [0.085, h]], 6, col);
    const n = Math.max(2, Math.round(h / 0.4)); for (let k = 0; k < n; k++) lmLathe(G, x, z, y0 + h * (k + 0.5) / n - 0.02, [[0.19, 0], [0.19, 0.05], [0.085, 0.07]], 8, col);
    lmLathe(G, x, z, y0 + h, [[0.11, 0], [0.11, 0.1]], 6, STEEL); };
  // shedded bushing, brown porcelain; r grows with voltage
  const bush = (x, z, y0, h, r, ph = -1) => { lmLathe(G, x, z, y0, [[r * 0.45, 0], [r * 0.45, h]], 6, PORC);
    const n = Math.max(3, Math.round(h / 0.26)); for (let k = 0; k < n; k++) lmLathe(G, x, z, y0 + h * (k + 0.5) / n - 0.025, [[r, 0], [r, 0.045], [r * 0.45, 0.065]], 8, PORC);
    lmLathe(G, x, z, y0 + h, [[r * 0.5, 0], [r * 0.5, 0.12]], 6, STEEL);
    if (ph >= 0) lmLathe(G, x, z, y0 + h + 0.02, [[r * 0.55, 0], [r * 0.55, 0.1]], 8, PH[ph]); };
  // oil circuit breaker: concrete raft, steel frame, control cabinet, three domed tanks with paired bushings
  const breaker = (u, v, ang, k = 1) => {
    const ff = fr(u, v, ang), bh = 1.2 * k;
    lmBoxL(G, ff, -2.2, 2.2, -1.1, 1.1, 0, 0.22, CON, false);
    lmBoxL(G, ff, -2.0, 2.0, -0.9, 0.9, 0.22, 1.0, STEEL_D, false);
    lmBoxL(G, ff, 1.4, 2.1, -0.8, 0.8, 1.0, 1.95, sh(STEEL, 0.92), false);
    lmBoxL(G, ff, 1.55, 1.95, -0.82, -0.78, 1.15, 1.75, sh(CON, 0.8), false);
    const line = [], bus = [], ty = 1.0 + 1.66 * k + bh + 0.12;
    [-1.4, 0, 1.4].forEach((s, i) => { const w = lmW(ff, s, 0);
      lmLathe(G, w[0], w[1], 1.0, [[0.46, 0], [0.5, 0.12], [0.5, 1.55 * k], [0.34, 1.68 * k], [0.14, 1.72 * k]], 10, TR);
      const b1 = lmW(ff, s, -0.26), b2 = lmW(ff, s, 0.26);
      bush(b1[0], b1[1], 1.0 + 1.66 * k, bh, 0.16 * k, i); bush(b2[0], b2[1], 1.0 + 1.66 * k, bh, 0.16 * k, i);
      // a jumper per phase between its own two bushings — never a bar across the three phases
      lmBar(G, [b1[0], ty, b1[1]], [b2[0], ty, b2[1]], 0.06, STEEL);
      line.push([b2[0], ty, b2[1]]); bus.push([b1[0], ty, b1[1]]); });
    return { line, bus };
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
    const hv = [];
    [-L / 3, 0, L / 3].forEach((s, i) => { const p = P(s, -W / 4, 0.66 + H); bush(p[0], p[2], p[1], big ? 2.1 : 1.3, big ? 0.2 : 0.14, i);
      hv.push([p[0], p[1] + (big ? 2.1 : 1.3) + 0.12, p[2]]); });
    [-L / 3, 0, L / 3].forEach((s, i) => { const p = P(s, W / 4, 0.66 + H); bush(p[0], p[2], p[1], big ? 0.85 : 0.6, 0.12, i); });
    const tc = P(L / 2 + 0.32, 0, 0);
    lmLathe(G, tc[0], tc[2], 0.5 + H * 0.35, [[0.3, 0], [0.3, H * 0.5]], 8, sh(TR, 0.9));
    lmBoxL(G, ff, -0.3, 0.3, -W / 2 - 0.03, -W / 2, 1.3, 1.7, LMWHITE, false);
    return { hv };
  };
  // three phase tubes on a shared support frame; returns per-phase tap functions along the run
  const busbar = (u0, v0, u1, v1, y, sp = 1.6) => {
    const dx = u1 - u0, dv = v1 - v0, L = Math.hypot(dx, dv) || 1, px = -dv / L, pv = dx / L, taps = [];
    const n = Math.max(2, Math.round(L / 7));
    for (let k = 0; k <= n; k++) { const t = k / n, cu = u0 + dx * t, cv = v0 + dv * t, c = at(cu, cv, 0);
      lmBar(G, [c[0], 0.2, c[2]], [c[0], y - 0.75, c[2]], 0.14, STEEL_D);
      lmBar(G, at(cu - px * sp, cv - pv * sp, y - 0.75), at(cu + px * sp, cv + pv * sp, y - 0.75), 0.08, STEEL_D);
      for (let i = 0; i < 3; i++) { const o = (i - 1) * sp, w = at(cu + px * o, cv + pv * o, 0); ins(w[0], w[1], y - 0.75, 0.55); } }
    for (let i = 0; i < 3; i++) { const o = (i - 1) * sp;
      lmBar(G, at(u0 + px * o, v0 + pv * o, y), at(u1 + px * o, v1 + pv * o, y), 0.14, STEEL);
      for (let k = 0; k <= n; k++) { const t = k / n, w = at(u0 + dx * t + px * o, v0 + dv * t + pv * o, y);
        lmLathe(G, w[0], w[1], y - 0.08, [[0.17, 0], [0.17, 0.16]], 8, PH[i]); }
      taps.push(t => at(u0 + dx * t + px * o, v0 + dv * t + pv * o, y)); }
    taps.u0 = u0; taps.v0 = v0; taps.dx = dx; taps.dv = dv; taps.L2 = dx * dx + dv * dv;
    return taps;
  };
  // the parameter of the local point (u,v) on a busbar run, clamped to the run
  const busT = (taps, u, v) => Math.max(0, Math.min(1, ((u - taps.u0) * taps.dx + (v - taps.v0) * taps.dv) / taps.L2));
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
  // a sagging wire between two points; short jumpers hang almost straight, spans sag like a real catenary
  const wire = (a, b, col = 0.1, bundle = 0) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz) || 1;
    const sag = len < 30 ? 0.1 + len * 0.012 : 0.6 + len * 0.012, n = Math.max(2, Math.round(len / 25));
    const px = -dz / len, pz = dx / len;   // 330 kV phases run as a twin bundle, spaced across the span
    for (const o of bundle ? [-bundle, bundle] : [0]) {
      let prev = [a[0] + px * o, a[1], a[2] + pz * o];
      for (let k = 1; k <= n; k++) { const t = k / n, p = [a[0] + dx * t + px * o, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + dz * t + pz * o];
        lmBar(G, prev, p, col, hb('#3a3d40')); prev = p; }
    }
  };
  // three phases from a tower's left arm set to a portal's three strings, ordered along the portal's
  // phase axis so the spans never cross in plan
  const link3 = (tp, pp, ang, col = 0.12, bundle = 0, side = [0, 2, 4]) => {
    const du = Math.cos(ang), dv = Math.sin(ang);
    const s = side.map(k => tp[k]).sort((a, b) => (a[0] * du + a[2] * dv) - (b[0] * du + b[2] * dv));
    for (let i = 0; i < 3; i++) wire(s[i], pp[i], col, bundle);
  };
  // a chain of towers with wires and a ground wire; returns the last attachment points
  // ph selects the conductors: all six for a double-circuit tower, the left three for a single circuit
  const chain = (list, heights, arms, col, bundle = 0, ph = [0, 1, 2, 3, 4, 5]) => {
    let prev = null, prevTop = null, first = null, firstTop = null;
    for (let i = 0; i < list.length; i++) {
      const [x, z] = list[i], h = typeof heights === 'function' ? heights(i) : heights;
      const nxt = list[i + 1] || list[i - 1], ang = Math.atan2(nxt[1] - z, nxt[0] - x) + Math.PI / 2;
      const pts = tower(x, z, h, arms, col, ang), top = [x, h + 0.8, z];
      if (!first) { first = pts; firstTop = top; }
      if (prev) { for (const k of ph) wire(prev[k], pts[k], 0.12, bundle); wire(prevTop, top, 0.07); }
      prev = pts; prevTop = top;
    }
    return { first, firstTop, last: prev, lastTop: prevTop };
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
    const n = Math.max(1, Math.round(L / 8));   // short pieces, so the strip rides the terrain lift
    for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n;
      const P = [[u0 + dx * t0 + nx, v0 + dv * t0 + nv], [u0 + dx * t1 + nx, v0 + dv * t1 + nv], [u0 + dx * t1 - nx, v0 + dv * t1 - nv], [u0 + dx * t0 - nx, v0 + dv * t0 - nv]].map(p => { const q = lmW(f, p[0], p[1]); return [q[0], 0.12, q[1]]; });
      polyA(G, P, sh(CON, 0.9), 0, 1, 0); } };
  // a cable trench with concrete cover slabs along a local line
  const trench = (u0, v0, u1, v1) => {
    const dx = u1 - u0, dv = v1 - v0, L = Math.hypot(dx, dv) || 1, nx = -dv / L * 0.32, nv = dx / L * 0.32;
    const m = Math.max(1, Math.round(L / 8));
    for (let k = 0; k < m; k++) { const t0 = k / m, t1 = (k + 1) / m;
      const P = [[u0 + dx * t0 + nx, v0 + dv * t0 + nv], [u0 + dx * t1 + nx, v0 + dv * t1 + nv], [u0 + dx * t1 - nx, v0 + dv * t1 - nv], [u0 + dx * t0 - nx, v0 + dv * t0 - nv]].map(p => { const q = lmW(f, p[0], p[1]); return [q[0], 0.16, q[1]]; });
      polyA(G, P, sh(CON, 1.06), 0, 1, 0); }
    const n = Math.max(1, Math.round(L / 1.2));
    for (let k = 1; k < n; k++) { const t = k / n, cx = u0 + dx * t, cz = v0 + dv * t, a = lmW(f, cx + nx, cz + nv), b = lmW(f, cx - nx, cz - nv);
      lmBar(G, [a[0], 0.17, a[1]], [b[0], 0.17, b[1]], 0.03, sh(CON, 0.78)); } };
  // a concrete fire wall between transformer bays, with end pilasters
  const fireWall = (u, v, ang, len, h) => { const ff = fr(u, v, ang);
    lmBoxL(G, ff, -len / 2, len / 2, -0.18, 0.18, 0, h, CON, false);
    lmBoxL(G, ff, -len / 2, len / 2, -0.24, 0.24, h, h + 0.14, sh(CON, 1.05), false);
    for (const s of [-len / 2, len / 2]) { const w = lmW(ff, s, 0); box2(w[0], w[1], 0, h + 0.3, 0.3, sh(CON, 0.95)); } };
  // dry-type air-core shunt reactor: raft, four post insulators, ducted coil, corona rings, top bushing
  const reactor = (u, v) => { const w = lmW(f, u, v);
    box2(w[0], w[1], 0, 0.25, 1.6, CON);
    for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]]) ins(w[0] + dx, w[1] + dz, 0.25, 1.1);
    lmLathe(G, w[0], w[1], 1.35, [[1.25, 0], [1.25, 1.5], [1.15, 1.55]], 14, sh(CON, 0.92));
    for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, cx = w[0] + Math.cos(a) * 1.26, cz = w[1] + Math.sin(a) * 1.26;
      lmBar(G, [cx, 1.4, cz], [cx, 2.8, cz], 0.05, sh(CON, 0.78)); }
    lmLathe(G, w[0], w[1], 2.86, [[1.15, 0], [1.32, 0.04], [1.15, 0.08]], 14, STEEL);
    lmLathe(G, w[0], w[1], 1.32, [[1.15, 0], [1.32, 0.04], [1.15, 0.08]], 14, STEEL);
    bush(w[0], w[1], 2.95, 0.5, 0.12); };
  // one bay, phase by phase: portal strings -> breaker line bushings, breaker bus bushings -> the near
  // disconnector post, the far post (blade tip) -> the matching busbar tube
  const bayWires = (pp, br, bu, bv, du, dv, ang, taps) => {
    const ff = fr(du, dv, ang), ux = Math.cos(ang), uz = Math.sin(ang);
    const near = (bu - du) * ux + (bv - dv) * uz > 0 ? 0.45 : -0.45;
    for (let i = 0; i < 3; i++) {
      wire(pp[i], br.line[i], 0.08);
      const s = (i - 1) * 1.6, a = lmW(ff, s + near, 0), b = lmW(ff, s - near, 0);
      wire(br.bus[i], [a[0], 2.72, a[1]], 0.07);
      wire([b[0], 3.05, b[1]], taps[i](busT(taps, du + (s - near) * ux, dv + (s - near) * uz)), 0.07);
    }
  };

  /* ---- the yard ---- */
  const ring = SS_RING;
  const ringPts = []; for (let i = 0; i < ring.length; i += 2) ringPts.push([ring[i], ring[i + 1]]);
  // the gravel plain draws in WORLD xz, so the local outline must be carried through the frame first
  const toWorld = r => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(...lmW(f, r[i], r[i + 1])); return o; };
  const ringW = toWorld(ring);
  // the ground mesh is split to follow the DEM, so one flat slab of gravel would let grass poke through
  // in blobs; split the plain the same way (subTris) and every vertex rides the terrain lift
  const gravelPlain = (r, y, col) => { const t = triangulate([r]), s = subTris(t.flat, t.tris, 0.04);
    const v = G.v; G.ensure(s.flat.length / 2);
    for (let i = 0; i < s.flat.length; i += 2) G.vert(s.flat[i], y, s.flat[i + 1], 0, 1, 0, col);
    for (let i = 0; i < s.tris.length; i += 3) G.triUp(v + s.tris[i], v + s.tris[i + 1], v + s.tris[i + 2]); };
  gravelPlain(ringW, 0.08, GRAVEL);
  gravelPlain(toWorld(offsetRing(ring, -3)), 0.09, sh(GRAVEL, 1.05));   // a slightly lighter gravel heart
  // gravel read: scattered patches of lighter and darker stone so the yard is not a flat slab
  const speckle = (r, step = 3.2) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
    for (let gx = x0; gx < x1; gx += step) for (let gz = z0; gz < z1; gz += step) {
      const h1 = hash(gx * 73856093 ^ gz * 19349663), h2 = hash(gx * 83492791 ^ gz * 2971215073);
      if (h1 > 0.55) continue; const u = gx + (h2 - 0.5) * step, v = gz + (hash(gx * 19 + gz * 7) - 0.5) * step;
      if (!pip(u, v, r)) continue; const w = lmW(f, u, v), s = 0.3 + h2 * 0.9;
      polyA(G, [[w[0] - s, 0.095, w[1] - s], [w[0] + s, 0.095, w[1] - s], [w[0] + s, 0.095, w[1] + s], [w[0] - s, 0.095, w[1] + s]], sh(GRAVEL, 0.78 + h1 * 0.6), 0, 1, 0); } };
  speckle(ring); speckle(SS_RINGB, 2.4);
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
  // the busbar systems run behind the breaker row, on the disconnector side
  const bb110 = busbar(-30, -6, 84, -92, 6.5, 1.6); busbar(-34, -11, 80, -97, 6.5, 1.6);
  for (const [u, v, pp] of [[-18.3, 12.2, p131], [-5.7, 2.4, p631], [19.6, -17.1, p632], [44.9, -36.6, p137], [70.2, -56.2, p291]]) {
    const br = breaker(u - 4, v - 8, 0.9); disco(u - 8, v - 12, 0.9); ct(u - 1, v - 11); cvt(u + 2, v - 12); arrester(u + 4, v - 7);
    bayWires(pp, br, u - 4, v - 8, u - 8, v - 12, 0.9, bb110); }
  // cable trenches along the bay rows and service roads behind the portal lines
  trench(-26, 2, 78, -64); trench(-26, -2, 78, -68);
  road(-30, 16, 92, -72, 3.4); road(-44, -22, 82, -104, 3.4);
  // a 110 kV dry reactor bank, one phase per unit, tapped off the first busbar system
  for (let i = 0; i < 3; i++) { const u = 64 + i * 6; reactor(u, -88);
    wire(bb110[i](busT(bb110, u, -88)), at(u, -88, 3.6), 0.08); }
  /* ---- transformers ---- */
  trafo(0.3, -95.3, 0.9, true); trafo(-34, -94.4, 0.9, true); trafo(-66.7, -105.4, 0.9, true);
  trafo(-85.3, -91.1, 0.9, false); trafo(-27.5, -155.4, 0.9, true); trafo(28.5, -134.7, 0.9, true);
  const t330b = trafo(54.7, -126, 0.9, true); trafo(-55.4, -231.5, 0.9, false);
  // concrete fire walls between the adjacent oil-filled transformers
  for (const [a, b] of [[[0.3, -95.3], [-34, -94.4]], [[-34, -94.4], [-66.7, -105.4]], [[-66.7, -105.4], [-85.3, -91.1]], [[-27.5, -155.4], [28.5, -134.7]], [[28.5, -134.7], [54.7, -126]]]) {
    fireWall((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2, 9, 5.6); }
  road(-90, -80, 60, -150, 3.6); trench(-70, -88, 40, -140);
  /* ---- 330 kV portal row ---- */
  const p313 = portal(85.3, -237.9, 0.95, 20, 6.5), p314 = portal(128.6, -182.4, 0.95, 20, 6.5),
    p315 = portal(106.3, -144.8, 0.95, 20, 6.5);
  const g316 = portal(97.4, -222.4, 0.95, 20, 6.5), g317 = portal(68.1, -193.5, 0.95, 20, 6.5),
    g318 = portal(84.8, -170.2, 0.95, 20, 6.5), g319 = portal(138.6, -169.5, 0.95, 20, 6.5),
    g320 = portal(118, -197.1, 0.95, 20, 6.5);
  portal(-17.4, -285.3, 0.33, 20, 6.5);
  // working bus behind the breaker row, reserve bus on the line side, transfer bus by the 315 bay
  const bb330 = busbar(70, -280.2, 150, -177.6, 11, 4.2), bb330b = busbar(60, -243, 145, -158, 11, 4.2);
  const bb330c = busbar(96, -170, 134, -132, 11, 4.2);
  for (const [u, v, pp, taps] of [[85.3, -237.9, p313, bb330], [128.6, -182.4, p314, bb330], [106.3, -144.8, p315, bb330c]]) {
    const br = breaker(u - 6, v - 10, 2.5, 1.6); disco(u - 12, v - 16, 2.5); ct(u - 2, v - 14); cvt(u + 3, v - 15); arrester(u + 6, v - 9);
    bayWires(pp, br, u - 6, v - 10, u - 12, v - 16, 2.5, taps); }
  // the remaining gantries tap the reserve bus; the two far ones tie across to the next gantry
  for (const [pp, u, v] of [[g316, 97.4, -222.4], [g320, 118, -197.1], [g319, 138.6, -169.5], [g318, 84.8, -170.2]])
    for (let i = 0; i < 3; i++) wire(pp[i], (u < 96 ? bb330c : bb330b)[i](busT(u < 96 ? bb330c : bb330b, u, v)), 0.09, 0.22);
  // OSM ways 1353105352/354/353: gantry ties, and the 330 kV transformer bay onto portal 315
  for (let i = 0; i < 3; i++) { wire(g317[i], g316[i], 0.09, 0.22); wire(g320[i], g318[i], 0.09, 0.22); wire(g319[i], p315[i], 0.09, 0.22); wire(p315[i], t330b.hv[i], 0.09, 0.22); }
  trench(60, -240, 145, -156); road(50, -256, 152, -150, 3.6);
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
  // У110-2+5: 29.7 m to the peak. OSM ways 173944046 (131;132) and 643576917 (631;632) are
  // double-circuit: one tower carries both circuits, three phases per side; 133/290/291 are single.
  const A110 = [[8, 19], [10, 22.5], [8, 26]], C110 = [[7, 27.5], [9, 24], [7, 20.5]], L3 = [0, 2, 4], R3 = [1, 3, 5];
  const t13 = tower(934.3, -1010.7, 29.7, A110, STEEL, angTo(934.3, -1010.7, 887.5, -1014.3));
  const t63 = tower(926.5, -1034.3, 29.7, A110, STEEL, angTo(926.5, -1034.3, 882.4, -1029.4));
  const t133 = tower(916.4, -1060.5, 29.7, A110, STEEL, angTo(916.4, -1060.5, 864.4, -1082.4));
  const t136 = tower(927.7, -1117.1, 29.7, A110, STEEL, angTo(927.7, -1117.1, 861.9, -1089.9));
  const t290 = tower(769.1, -1256.8, 29.7, A110, STEEL, angTo(769.1, -1256.8, 844, -1142.9));
  const t291 = tower(868, -1127, 29.7, A110, STEEL, angTo(868, -1127, 851.6, -1120.2));
  link3(t13, p131, -0.25); link3(t13, p132, -0.11, 0.12, 0, R3);
  link3(t63, p631, -0.44); link3(t63, p632, 0.11, 0.12, 0, R3);
  link3(t133, p133, 0.07); link3(t136, p136, -0.5); link3(t136, p137, -0.72, 0.12, 0, R3);
  link3(t290, p290, 0.66); link3(t291, p291, 0.78);
  // the earth wire continues from each terminal tower peak onto the portal gantry top chord
  for (const [tx, tz, pu, pv] of [[934.3, -1010.7, -18.3, 12.2], [934.3, -1010.7, -12, 7.2], [926.5, -1034.3, -5.7, 2.4], [926.5, -1034.3, 19.6, -17.1], [916.4, -1060.5, 38.6, -31.8], [927.7, -1117.1, 57.6, -46.3], [927.7, -1117.1, 44.9, -36.6], [769.1, -1256.8, 89.2, -70.7], [868, -1127, 70.2, -56.2]])
    wire([tx, 30.5, tz], at(pu, pv, 11.4), 0.06);
  light(934.3, -1010.7, 30.5); light(927.7, -1117.1, 30.5);
  // line corridors after the OSM ways; each chain starts at the first tower beyond the terminal one
  const cA = chain([[1062.8, -919.5], [1191.3, -828.4], [1339.2, -791], [1487.2, -753.6], [1644, -595.7], [1800.9, -437.9]], 29.7, C110, STEEL);
  const cB = chain([[1060.2, -938.5], [1193.8, -842.7], [1350.5, -802.5], [1507.2, -762.2], [1636.1, -656.2], [1765, -550.2]], 29.7, C110, STEEL);
  const c133 = chain([[1039.7, -971.1], [1163, -881.6], [1320.7, -841.6], [1496.7, -796], [1600.3, -711.3], [1764.2, -579.4]], 29.7, C110, STEEL, 0, L3);
  const c136 = chain([[971.3, -1195.2], [926.05, -1350.65], [880.8, -1506.1]], 29.7, C110, STEEL);
  const c290 = chain([[703, -1346.9], [636.8, -1436.9], [580.4, -1630], [516, -1850.4], [445.6, -2091.4]], 29.7, C110, STEEL, 0, L3);
  const c291 = chain([[763.05, -1284.7], [658.1, -1442.4], [591.7, -1667.4], [523.2, -1899.3], [429.5, -2216.7]], 29.7, C110, STEEL, 0, L3);
  for (const [t, c, ph] of [[t13, cA, [0, 1, 2, 3, 4, 5]], [t63, cB, [0, 1, 2, 3, 4, 5]], [t136, c136, [0, 1, 2, 3, 4, 5]], [t133, c133, L3], [t290, c290, L3], [t291, c291, L3]]) {
    for (const k of ph) wire(t[k], c.first[k], 0.12);
    wire([t[0], 30.5, t[2]], c.firstTop, 0.06);
  }

  /* ---- 330 kV lines towards Līksna (ways 141554665 ref 313, 172286301 ref 314) ---- */
  // У220-2+9: 40.6 m to the peak, twin-bundle phases
  const c313 = chain([[600.2, -1418.6], [515.7, -1643.7], [382.4, -2101.7], [249, -2559.7], [343.6, -2867.3]], 40.6, [[11, 32.5], [14, 27], [11, 21.5]], STEEL, 0.22, L3);
  const c314 = chain([[737, -1254.9], [715.1, -1281.1], [611.2, -1425.9], [534.4, -1682], [456.3, -1949.5], [401, -2138.1]], 40.6, [[11, 32.5], [14, 27], [11, 21.5]], STEEL, 0.22, L3);
  link3(c313.first, p313, 0.95, 0.12, 0.22); link3(c314.first, p314, 0.95, 0.12, 0.22);
  wire(c313.firstTop, at(85.3, -237.9, 18.9), 0.07); wire(c314.firstTop, at(128.6, -182.4, 18.9), 0.07);

  /* ---- substation "Daugavpils B" 110/10 kV (way 1066909952) ---- */
  const ringB = SS_RINGB;
  const ringBPts = []; for (let i = 0; i < ringB.length; i += 2) ringBPts.push([ringB[i], ringB[i + 1]]);
  gravelPlain(toWorld(ringB), 0.08, GRAVEL);
  lmRegisterOutline(f, ringBPts, 6, false);
  fenceLine(ringB, 2.2);
  gate(481.3, -196.8, 484, -198.8, 2.2);
  const pB = portal(481.3, -184.5, 0.88, 12.5, 4.2);
  trafo(494.6, -194.3, 2.4, false); trafo(500.9, -184.4, 2.4, false);
  // line 136 continues south past the last tower and drops into the B yard portal
  link3(c136.last, pB, 0.88);
  wire(c136.lastTop, at(481.3, -184.5, 11.4), 0.06);
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
