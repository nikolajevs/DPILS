import { lmDisc } from './university.js';
import { lmBar, lmBoxL } from './helpers.js';
import { LMT } from './tiles.js';
import { LMF, LMWHITE, lmW } from './core.js';
import { BGRID, BLD, COL } from '../world/data.js';
import { polyA } from '../core/geometry.js';
import { area2, bbox, hb, reversed, sh } from '../core/util.js';

/* ---- Radio and TV tower, Drujas iela (LVRTC, 1957) ----
   A free-standing steel lattice tower, 205 m to the tip (OSM way 778910828: height, lattice, steel; LSM gives 204 m),
   on a 20 m square base. Four tubular legs taper to a slender shaft near 150 m; above it the antenna mast. Painted in
   seven red and white bands from the ground, as on the photographs (Wikimedia Commons, category "Daugavpils Radio and
   TV Tower"): X-braced panels, a dark cable shaft up the middle, galleries with railings, an outrigger frame half way
   up, dish and panel antennas on the upper half, red obstruction lights that come on at night. Frame tv: centred on
   the base, u and v along its sides. */
function lmTVTower(K) {
  const f = LMF.tv, G = K.plain, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const RED = hb('#c4362d'), WHITE = hb('#e9e8e3'), DARK = hb('#2a2c2e'), GREY = hb('#8d9093'), TOP = 205, LAT = 180;
  const band = y => (Math.min(6, Math.floor(y / (LAT / 7))) % 2 ? WHITE : RED);
  const hw = y => y < 150 ? 9 - (9 - 1.0) * y / 150 : 1.0 - 0.15 * (y - 150) / 30;        // half width of the lattice at height y
  const lw = y => 0.55 - 0.33 * Math.min(1, y / 150);                                        // leg size
  const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]], leg = (k, y) => at(C[k][0] * hw(y), C[k][1] * hw(y), y);
  // panels: horizontal struts and X bracing on each face, legs in between; each member takes the colour of its band
  const ys = [0]; while (ys[ys.length - 1] < LAT) { const y = ys[ys.length - 1]; ys.push(Math.min(LAT, y + Math.max(2.2, 1.35 * hw(y)))); }
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i], y1 = ys[i + 1], col = band((y0 + y1) / 2), t = Math.max(0.08, lw(y0) * 0.4);
    for (let k = 0; k < 4; k++) { const j = (k + 1) % 4;
      lmBar(G, leg(k, y0), leg(k, y1), lw(y0), col);
      lmBar(G, leg(k, y1), leg(j, y1), t, col);
      lmBar(G, leg(k, y0), leg(j, y1), t * 0.8, col); lmBar(G, leg(j, y0), leg(k, y1), t * 0.8, col);
      if (i % 3 === 1 && hw(y0) > 3) { const m = a => at((C[k][0] + C[j][0]) / 2 * hw(a), (C[k][1] + C[j][1]) / 2 * hw(a), a); lmBar(G, m(y0), m(y1), t * 0.6, col); }
    }
  }
  // the cable and ladder shaft up the middle, foundations of the legs
  lmBar(G, at(0, 0, 0), at(0, 0, LAT), 0.8, DARK);
  for (let k = 0; k < 4; k++) lmBoxL(K.stone, f, C[k][0] * 9 - 1.3, C[k][0] * 9 + 1.3, C[k][1] * 9 - 1.3, C[k][1] * 9 + 1.3, 0, 0.8, hb('#9a9893'));
  // galleries with railings, the outrigger frame
  for (const y of [31, 62, 98, 128, 150, 172]) {
    const w = hw(y) + 0.35, PL = hb('#c9cccd');   // grating walkway round the legs (a full deck where the tower is narrow), a deck round the shaft
    if (w < 3.2) lmBoxL(G, f, -w, w, -w, w, y - 0.08, y, PL);
    else { for (const [a, b, c, d] of [[-w, w, w - 1.1, w], [-w, w, -w, -w + 1.1], [w - 1.1, w, -w + 1.1, w - 1.1], [-w, -w + 1.1, -w + 1.1, w - 1.1]]) lmBoxL(G, f, a, b, c, d, y - 0.08, y, PL); lmBoxL(G, f, -1.4, 1.4, -1.4, 1.4, y - 0.08, y, PL); }
    for (let k = 0; k < 4; k++) { const j = (k + 1) % 4, A = at(C[k][0] * w, C[k][1] * w, y + 1.1), B = at(C[j][0] * w, C[j][1] * w, y + 1.1); lmBar(G, A, B, 0.06, band(y + 1)); lmBar(G, at(C[k][0] * w, C[k][1] * w, y), A, 0.06, band(y + 1)); }
  }
  { const y = 98, w = hw(y); for (const s of [-1, 1]) { lmBar(G, at(w, s * 1.6, y), at(w + 4.5, s * 1.6, y), 0.35, RED); lmBar(G, at(w + 4.5, s * 1.6, y), at(w + 4.5, s * 1.6, y + 3.2), 0.35, RED); lmBar(G, at(w, s * 1.6, y + 3.2), at(w + 4.5, s * 1.6, y + 3.2), 0.35, RED); }
    lmBar(G, at(w + 4.5, -1.6, y + 3.2), at(w + 4.5, 1.6, y + 3.2), 0.3, RED); lmBoxL(G, f, w, w + 4.5, -1.6, 1.6, y - 0.08, y, hb('#c9cccd')); }
  // dish antennas on the upper half, panel antennas for mobile phones near the top of the lattice
  for (const [y, side, s, r] of [[112, 0, 0.3, 0.9], [118, 1, -0.4, 0.7], [126, 2, 0.2, 1.1], [134, 3, 0.5, 0.6], [141, 0, -0.5, 0.8], [146, 2, 0.4, 0.7], [104, 3, -0.2, 1.2]]) {
    const n = [[1, 0], [0, 1], [-1, 0], [0, -1]][side], w = hw(y) + 0.5, c = at(n[0] * w + (1 - Math.abs(n[0])) * s * hw(y), n[1] * w + (1 - Math.abs(n[1])) * s * hw(y), y);
    const nw = [n[0] * f[2] - n[1] * f[3], n[0] * f[3] + n[1] * f[2]], ax = [-nw[1], 0, nw[0]];
    lmDisc(G, c, r, ax, [0, 1, 0], hb('#f2f2ef'), [nw[0], 0, nw[1]]); lmDisc(G, c, r, ax, [0, 1, 0], hb('#c9cbcc'), [-nw[0], 0, -nw[1]]);
  }
  for (const y of [158, 166]) for (let k = 0; k < 4; k++) for (const s of [-0.5, 0.5]) { const n = [[1, 0], [0, 1], [-1, 0], [0, -1]][k], w = hw(y) + 0.25;
    lmBoxL(G, f, n[0] * w - 0.12 + (n[1] ? s : 0), n[0] * w + 0.12 + (n[1] ? s : 0), n[1] * w - 0.12 + (n[0] ? s : 0), n[1] * w + 0.12 + (n[0] ? s : 0), y, y + 2.2, hb('#f0f0ec')); }
  // the antenna mast: segments in red and white, a small platform, the lightning rod
  for (let y = LAT, k = 0; y < TOP - 1.5; y += 3.5, k++) lmBar(G, at(0, 0, y), at(0, 0, Math.min(TOP - 1.5, y + 3.5)), 0.75 - 0.4 * (y - LAT) / (TOP - LAT), k % 2 ? WHITE : RED);
  lmBoxL(G, f, -1.0, 1.0, -1.0, 1.0, 193.8, 194, GREY); lmBar(G, at(0, 0, TOP - 1.5), at(0, 0, TOP), 0.08, DARK);
  // obstruction lights
  const t = LMT.tvRed, light = (P, s) => { for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) K.det.q([P[0] - dz * s, P[1] - s, P[2] + dx * s], [P[0] + dz * s, P[1] - s, P[2] - dx * s], [P[0] + dz * s, P[1] + s, P[2] - dx * s], [P[0] - dz * s, P[1] + s, P[2] + dx * s], [dx, 0, dz], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, 1);
    K.det.q([P[0] - s, P[1] + s, P[2] - s], [P[0] + s, P[1] + s, P[2] - s], [P[0] + s, P[1] + s, P[2] + s], [P[0] - s, P[1] + s, P[2] + s], [0, 1, 0], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, 1); };
  light(at(0, 0, TOP + 0.5), 0.8);   // drawn larger than life so they read from across the city, like their glare
  for (const y of [194.5, LAT, 150, 98, 50]) for (let k = 0; k < 4; k++) light(at(C[k][0] * (hw(y) + 0.5), C[k][1] * (hw(y) + 0.5), y + 0.5), 0.55);
}

/* a landmark missing from citydata.js registers its own outline (local points): collisions, the map, no trees inside */
function lmRegisterOutline(f, pts, kind = 2, col = true) {   // col: false when the caller sets its own collisions
  let ring = []; for (const [u, v] of pts) ring.push(...lmW(f, u, v)); ring = new Float32Array(ring); if (area2(ring) < 0) ring = reversed(ring);
  const bb = bbox(ring); BLD.push({ ring, bb, kind }); const bid = BLD.length - 1;
  for (let i = Math.floor(bb[0] / 60); i <= Math.floor(bb[2] / 60); i++) for (let j = Math.floor(bb[1] / 60); j <= Math.floor(bb[3] / 60); j++) { const k = (i + 2000) * 4096 + j + 2000; let l = BGRID.get(k); if (!l) BGRID.set(k, l = []); l.push(bid); }
  if (col) { const n = ring.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n; COL.add(ring[2 * i], ring[2 * i + 1], ring[2 * j], ring[2 * j + 1], 0, 0); } }
}
// hipped roof over a rectangle of the local frame, ridge along its longer side
function lmHip(G, f, u0, u1, v0, v1, y, rise, col, ov = 0.4) {
  u0 -= ov; u1 += ov; v0 -= ov; v1 += ov;
  const at = (u, v, h) => { const w = lmW(f, u, v); return [w[0], h, w[1]]; }, du = u1 - u0, dv = v1 - v0, um = (u0 + u1) / 2, vm = (v0 + v1) / 2, Y = y + rise;
  const ex = [f[2], 0, f[3]], ev = [-f[3], 0, f[2]];
  if (du >= dv) { const h = dv / 2, r0 = at(u0 + h, vm, Y), r1 = at(u1 - h, vm, Y);
    polyA(G, [at(u0, v0, y), at(u1, v0, y), r1, r0], sh(col, 0.95), -ev[0], 1, -ev[2]); polyA(G, [at(u1, v1, y), at(u0, v1, y), r0, r1], sh(col, 1.02), ev[0], 1, ev[2]);
    polyA(G, [at(u0, v1, y), at(u0, v0, y), r0], sh(col, 0.9), -ex[0], 1, -ex[2]); polyA(G, [at(u1, v0, y), at(u1, v1, y), r1], sh(col, 1.05), ex[0], 1, ex[2]); }
  else { const h = du / 2, r0 = at(um, v0 + h, Y), r1 = at(um, v1 - h, Y);
    polyA(G, [at(u0, v1, y), at(u0, v0, y), r0, r1], sh(col, 0.9), -ex[0], 1, -ex[2]); polyA(G, [at(u1, v0, y), at(u1, v1, y), r1, r0], sh(col, 1.05), ex[0], 1, ex[2]);
    polyA(G, [at(u0, v0, y), at(u1, v0, y), r0], sh(col, 0.95), -ev[0], 1, -ev[2]); polyA(G, [at(u1, v1, y), at(u0, v1, y), r1], sh(col, 1.02), ev[0], 1, ev[2]); }
}

export { lmHip, lmRegisterOutline, lmTVTower };
