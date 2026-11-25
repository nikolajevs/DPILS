import { box } from '../core/geometry.js';
import { hb, offsetRing, pick, sh } from '../core/util.js';
import { band, flatPlain, vband } from '../buildings/walls.js';

/* ---------- the garage row of Kandavas iela 4E, in the yard of the block ----------
   OSM maps a 30.6 × 7.6 m garage block (building=garages, addr:housenumber 4E) between the house Kandavas iela 4 and
   the yard with the basketball court; the cadastre gives it 2.7 m of wall. The generic builder draws it as a shed
   with a pitched roof and window bays; here it is what it is: a flat-roofed row of ten metal doors, each 2.5 m wide
   and 2.2 m high, corrugated and painted in the muted colours of Latvian garage cooperatives, in concrete frames
   over a concrete apron. The blank back wall faces the house, with its downpipes; a window in the end wall.
   The frame: u along the row from its west end (0.862 east, 0.506 north), v across it towards the yard (the doors). */
const GX = -1537.6, GZ = 1020.4, UX = 0.86235, UZ = -0.50631, VX = 0.50631, VZ = 0.86235, L = 30.62, DP = 7.62, H = 2.7;
const W = (u, v) => [GX + UX * u + VX * v, GZ + UZ * u + VZ * v];
const DOORS = ['#5b6d7a', '#7a6a55', '#6d7a6a', '#8a8a86', '#5f5a52', '#7d5f4f', '#4f6b5f', '#6a5a6a'];

function lmCourtyardNorth(K) {
  const G = K.plain;
  const WALL = hb('#b6b2a6'), PLINTH = hb('#8f8c86'), CAP = hb('#8e8b85'), ROOF = hb('#6c6a66'), CONC = hb('#9c9a94');
  const ring = new Float32Array([W(0, 0), W(L, 0), W(L, DP), W(0, DP)].flat());
  // the walls on their plinth, the parapet and the gravel roof
  vband(G, ring, 0.45, H, WALL);
  vband(G, ring, 0, 0.45, PLINTH);
  const q = offsetRing(ring, -0.25);
  vband(G, q, H, H + 0.35, sh(WALL, 0.9));
  band(G, ring, q, H + 0.35, CAP, false);
  flatPlain(G, [q], H + 0.02, ROOF, false);
  for (const u of [8, 22]) { const [x, z] = W(u, DP / 2); box(G, x, z, UX, UZ, 0.25, 0.2, H, H + 0.7, sh(WALL, 0.8)); }   // vent stacks
  // the ten doors: a leaf, its corrugation, a handle, a concrete frame
  const bay = L / 10;
  for (let k = 0; k < 10; k++) {
    const u = (k + 0.5) * bay, col = hb(pick(DOORS, k * 7 + 3, 1));
    const [cx, cz] = W(u, DP - 0.06);
    box(G, cx, cz, UX, UZ, 1.25, 0.05, 0.05, 2.25, col);
    for (let r = -2; r <= 2; r++) { const [x, z] = W(u + r * 0.5, DP - 0.005); box(G, x, z, UX, UZ, 0.03, 0.025, 0.05, 2.25, sh(col, 0.85)); }
    const [hx, hz] = W(u + 0.9, DP + 0.01); box(G, hx, hz, UX, UZ, 0.02, 0.02, 1.0, 1.15, hb('#2c3134'));
    for (const s of [-1, 1]) { const [x, z] = W(u + s * 1.32, DP + 0.02); box(G, x, z, UX, UZ, 0.07, 0.05, 0, 2.35, CONC); }
    const [lx, lz] = W(u, DP + 0.02); box(G, lx, lz, UX, UZ, 1.39, 0.05, 2.35, 2.5, CONC);
  }
  // the apron before the doors, the window of the end wall, the downpipes of the blank back
  const [ax, az] = W(L / 2, DP + 1.3); box(G, ax, az, UX, UZ, L / 2, 1.3, 0, 0.06, CONC);
  const [wx, wz] = W(-0.02, DP / 2); box(G, wx, wz, VX, VZ, 0.45, 0.03, 1.4, 2.1, hb('#3a4550'));
  for (const u of [10.2, 20.4]) { const [x, z] = W(u, -0.04); box(G, x, z, UX, UZ, 0.03, 0.03, 0.3, H, hb('#8d9093')); }
}

export { lmCourtyardNorth };