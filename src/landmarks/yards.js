import { STATE } from '../core/state.js';
import { lmBar, lmLathe } from './helpers.js';
import { bench, groundsOf, playground } from './school-grounds.js';
import { bbq, picnic } from './parks.js';
import { SER_DOORS } from '../buildings/series.js';
import { COL, ROAD, inBuilding } from '../world/data.js';
import { box, polyA } from '../core/geometry.js';
import { hash, hb, obb, sh } from '../core/util.js';

/* ---- the yards of the blocks of flats (yards.js, from OpenStreetMap; so far Ķīmiķu ciemats) ----
   What the school grounds draw (groundsOf): the playgrounds with a swing, a slide and a sand pit, the pitches with
   their lines, goals and hoops, the fitness stations, the benches, waste baskets and bicycle stands, the fences. And:
   - the equipment mapped by itself: swings, slides, a roundabout, a seesaw, a climbing frame;
   - the sandpits: a frame of boards round the sand;
   - the picnic tables and barbecues of the parks;
   - the waste container sites: three containers (mixed waste, paper, packaging) on a concrete pad behind a low
     screen of corrugated sheet on three sides;
   - a bench by the door of the photographed blocks (series.js) about every second entrance, as on the photographs of
     Ķīmija, unless a mapped bench stands within 8 m. */
const DARK = hb('#2c3134'), WOOD = hb('#9a6a3d'), BLUE = hb('#2f7fbf'), RED = hb('#c8432f'), YEL = hb('#f0c23a'), GREEN = hb('#3f8a4a');
const fr = (x, z, a) => { const ux = Math.cos(a), uz = Math.sin(a); return (u, v, y) => [x + ux * u - uz * v, y, z + uz * u + ux * v]; };
function swing(G, x, z, a) {   // an A-frame at each end, the beam, two seats on chains
  const P = fr(x, z, a);
  for (const u of [-1.4, 1.4]) { lmBar(G, P(u, -0.8, 0), P(u, 0, 2.3), 0.08, BLUE); lmBar(G, P(u, 0.8, 0), P(u, 0, 2.3), 0.08, BLUE); }
  lmBar(G, P(-1.4, 0, 2.3), P(1.4, 0, 2.3), 0.08, BLUE);
  for (const u of [-0.6, 0.6]) { for (const s of [-0.2, 0.2]) lmBar(G, P(u + s, 0, 2.3), P(u + s, 0, 0.5), 0.015, DARK); lmBar(G, P(u - 0.24, 0, 0.47), P(u + 0.24, 0, 0.47), 0.1, RED); }
}
function slide(G, x, z, a) {   // a platform on four posts, a ladder, the chute
  const P = fr(x, z, a);
  for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) lmBar(G, P(u, v, 0), P(u, v, 2.2), 0.08, WOOD);
  polyA(G, [P(-0.5, -0.5, 1.2), P(0.5, -0.5, 1.2), P(0.5, 0.5, 1.2), P(-0.5, 0.5, 1.2)], WOOD, 0, 1, 0);
  for (const v of [-0.3, 0.3]) lmBar(G, P(-0.5, v, 1.2), P(-1.6, v, 0), 0.05, DARK); for (let k = 1; k < 5; k++) lmBar(G, P(-0.5 - k * 0.22, -0.3, 1.2 - k * 0.24), P(-0.5 - k * 0.22, 0.3, 1.2 - k * 0.24), 0.04, DARK);
  polyA(G, [P(0.5, -0.3, 1.2), P(2.6, -0.3, 0.15), P(2.6, 0.3, 0.15), P(0.5, 0.3, 1.2)], YEL, 0.45, 0.9, 0);
  for (const v of [-0.32, 0.32]) lmBar(G, P(0.5, v, 1.32), P(2.6, v, 0.27), 0.04, YEL);
}
function roundabout(G, x, z) { lmLathe(G, x, z, 0, [[0.12, 0], [0.12, 0.3], [1.0, 0.3], [1.0, 0.36], [0, 0.38]], 16, BLUE); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; lmBar(G, [x + Math.cos(a) * 0.85, 0.36, z + Math.sin(a) * 0.85], [x + Math.cos(a) * 0.2, 0.95, z + Math.sin(a) * 0.2], 0.04, RED); } }
function seesaw(G, x, z, a) { const P = fr(x, z, a); box(G, x, z, Math.cos(a), Math.sin(a), 0.15, 0.2, 0, 0.5, DARK); lmBar(G, P(-1.6, 0, 0.32), P(1.6, 0, 0.68), 0.12, RED); for (const u of [-1.4, 1.4]) lmBar(G, P(u, -0.2, u < 0 ? 0.6 : 0.95), P(u, 0.2, u < 0 ? 0.6 : 0.95), 0.03, DARK); }
function climber(G, x, z, a) {   // a frame of bars 2 × 2 × 2 m
  const P = fr(x, z, a);
  for (const u of [-1, 1]) for (const v of [-1, 1]) lmBar(G, P(u, v, 0), P(u, v, 2), 0.05, GREEN);
  for (const y of [0.7, 1.35, 2]) for (const [u0, v0, u1, v1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) lmBar(G, P(u0, v0, y), P(u1, v1, y), 0.035, y === 2 ? YEL : GREEN);
}
function sandpit(G, r) {   // boards round the sand
  const o = obb(r); if (!o) return; const P = fr(o.cx, o.cz, Math.atan2(o.uz, o.ux)), A = o.a, B = o.b;
  polyA(G, [P(-A, -B, 0.12), P(A, -B, 0.12), P(A, B, 0.12), P(-A, B, 0.12)], hb('#d8c49a'), 0, 1, 0);
  for (const [u0, v0, u1, v1] of [[-A, -B, A, -B], [A, -B, A, B], [A, B, -A, B], [-A, B, -A, -B]]) lmBar(G, P(u0, v0, 0.12), P(u1, v1, 0.12), 0.2, WOOD);
}
function containers(G, x, z, a) {   // three on a pad, screened on three sides
  const ux = Math.cos(a), uz = Math.sin(a), P = fr(x, z, a), SHEET = hb('#7d8a8a');
  box(G, x, z, ux, uz, 2.6, 1.5, 0, 0.12, hb('#9c9a94'));
  [hb('#3b4a3f'), hb('#2f5a9a'), hb('#c9a22e')].forEach((c, k) => { const [cx, , cz] = P(-1.6 + k * 1.6, 0.25, 0); box(G, cx, cz, ux, uz, 0.65, 0.55, 0.12, 1.35, c); box(G, cx, cz, ux, uz, 0.68, 0.58, 1.35, 1.42, sh(c, 0.8)); });
  for (const [u0, v0, u1, v1] of [[-2.6, 1.5, 2.6, 1.5], [-2.6, -1.4, -2.6, 1.5], [2.6, -1.4, 2.6, 1.5]]) { const A = P(u0, v0, 0), B = P(u1, v1, 0), L = Math.hypot(B[0] - A[0], B[2] - A[2]), dx = (B[0] - A[0]) / L, dz = (B[2] - A[2]) / L;
    box(G, (A[0] + B[0]) / 2, (A[2] + B[2]) / 2, dx, dz, L / 2, 0.03, 0.12, 1.6, SHEET); COL.add(A[0], A[2], B[0], B[2], 0.05, 0); }
}
function lmYards(K) {
  const Y = window.YARDS; if (!Y) return;
  const G = K.plain, pick = k => Y.points.filter(p => p[1] === k);
  STATE.GBC = null;
  groundsOf(G, { pitches: Y.pitches, tracks: Y.tracks, areas: Y.areas, fences: Y.fences, points: Y.points.filter(p => /^(bench|waste_basket|bicycle_parking|fitness_station|playground)$/.test(p[1])).concat(pick('pg:horizontal_bar').map(p => [0, 'fitness_station', p[2], p[3]])) });
  const ang = (x, z) => (x * 7.3 + z * 3.1) % 6.283;
  for (const [, k, x, z] of Y.points) {
    if (k === 'pg:swing') swing(G, x, z, ang(x, z)); else if (k === 'pg:slide') slide(G, x, z, ang(x, z)); else if (k === 'pg:roundabout') roundabout(G, x, z);
    else if (k === 'pg:seesaw') seesaw(G, x, z, ang(x, z)); else if (k === 'pg:structure' || k === 'pg:climbingframe') climber(G, x, z, ang(x, z)); else if (k === 'pg:sandpit') sandpit(G, [x - 1.5, z - 1.5, x + 1.5, z - 1.5, x + 1.5, z + 1.5, x - 1.5, z + 1.5]);
    else if (k === 'picnic_table') picnic(G, x, z, ang(x, z)); else if (k === 'bbq') bbq(G, x, z);
  }
  for (const r of Y.sand) sandpit(G, r.slice(0, -2));
  // the container sites, their open side towards the nearest drive or path
  for (const [x, z] of Y.bins) { let best = null, bd = 30; ROAD.near(x, z, 30, (id, d, px, pz) => { if (d < bd) { bd = d; best = [px, pz]; } });
    const a = best ? Math.atan2(best[0] - x, -(best[1] - z)) : 0; containers(G, x, z, a); }
  // a bench by about every second door of the photographed blocks, beside the door with its back to the wall
  const benches = pick('bench');
  for (let i = 0; i < SER_DOORS.length; i += 4) {
    const dx = SER_DOORS[i], dz = SER_DOORS[i + 1], nx = SER_DOORS[i + 2], nz = SER_DOORS[i + 3]; if (hash(Math.round(dx * 7) * 131 + Math.round(dz * 3)) < 0.5) continue;
    if (benches.some(b => Math.hypot(b[2] - dx, b[3] - dz) < 8)) continue;
    const s = hash(Math.round(dx) * 17 + Math.round(dz)) < 0.5 ? -1 : 1, x = dx + nz * s * 2.3 + nx * 0.9, z = dz - nx * s * 2.3 + nz * 0.9;
    if (inBuilding(x, z)) continue;
    bench(G, x, z, Math.atan2(nx, -nz));
  }
}

export { lmYards };
