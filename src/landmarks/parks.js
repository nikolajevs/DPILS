import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { lmBar, lmBoxW, lmLathe, lmWF } from './helpers.js';
import { lmStd } from './index.js';
import { bandAlong, bench, fillPoly, groundMesh, groundsOf } from './school-grounds.js';
import { GB, box, polyA } from '../core/geometry.js';
import { area2, bbox, hash, hb, pip, reversed, sh, triangulate } from '../core/util.js';
import { groundMaterial } from '../render/materials.js';
import { detailTex, glowTex } from '../render/textures.js';
import { scene } from '../render/renderer.js';
import { TERR, subTris, terrainH } from '../world/terrain.js';
import { inBuilding, inWater, onRoad } from '../world/data.js';

/* ---------- the parks and squares ----------
   From parks.js (OpenStreetMap, built by tools/parks.js): 21 parks and squares of the city with what is mapped in them.
   Their look follows photographs on Wikimedia Commons (Dubrovin park 2013, its fountain at night, the memorial, the
   busts of Pumpurs and Rainis 2008, the Central park 2010, the fountains of Esplanāde 2023 and of the fortress 2009):
   - footways keep the paving the city draws; along the paved ones stand black park lamps with lantern heads every
     24 m on alternating sides (light falls round them at night), and the mapped lamps;
   - benches face the nearest footway, waste baskets, bicycle stands, picnic tables, barbecues, toilet cabins and
     drinking water taps where they are mapped; playgrounds, fitness stations, pitches and fences as at the schools;
     dog parks fenced in; BMX tracks of packed earth;
   - flower beds raised behind a granite kerb and planted in colours; clipped hedges; low walls;
   - rows of trees planted along the mapped tree rows; the trees the city scatters over the parks are denser now and
     keep off the beds, the playgrounds, the fountains and the monuments (parkNoTree);
   - fountains: the tall jet with a ring of small ones in the pond of Dubrovin park (lit at night), the nozzles of the
     square by the university, round basins of granite elsewhere: the girl with the lily in Pumpurs square, the bowl of
     Esplanāde, the stepped base with two cast-iron barrels in the fortress;
   - monuments: the busts of Andrejs Pumpurs and of Rainis on granite pedestals, the statue of Pāvels Dubrovin, the
     memorial of dark granite steles in Dubrovin park, the stele to those fallen in Afghanistan, memorial stones and
     plaques; sculptures (metal discs, rings, abstract bronzes), the Tree of Love in the Central park, the sundial of
     black marble of 1910. */
const PD = window.PARKS || null;
const PARK_TREES = [];   // [x, z, type, scale] for buildTrees
const NOTREE = [], NOTREE_POLY = [];
let PARK_POOLS = null, PARK_JETS = null;
// no scattered tree on a bed, a playground, a pitch, by a fountain or a monument
function parkNoTree(x, z) {
  for (const [cx, cz, r] of NOTREE) if (Math.abs(x - cx) < r && Math.abs(z - cz) < r && Math.hypot(x - cx, z - cz) < r) return true;
  for (const p of NOTREE_POLY) if (x >= p.bb[0] && x <= p.bb[2] && z >= p.bb[1] && z <= p.bb[3] && pip(x, z, p.r)) return true;
  return false;
}
// the ground level under a free-standing thing, as GBC: it stands upright and level
const levelAt = (x, z) => { if (!TERR.on) return null; const b = terrainH(x, z); return (X, y, Z) => { const t = terrainH(X, Z); return y <= 0.05 ? Math.min(b, t) - 0.3 - t - y : b - t; }; };
// the outlines of the parks as OSM has them: the city data has cut some of them (the pond of Dubrovin park lies in grass)
const ring = a => { let r = new Float32Array(a); if (r.length > 4 && r[0] === r[r.length - 2] && r[1] === r[r.length - 1]) r = r.slice(0, -2); if (area2(r) < 0) r = reversed(r); return r; };
const P2 = (a, i) => [a[2 * i], a[2 * i + 1]];
const PARK_RINGS = PD ? PD.parks.map(([, , pts]) => ring(pts)) : [];
// a frame at (x, z) turned by the angle a: u along (cos a, sin a)
const fr = (x, z, a) => [x, z, Math.cos(a), Math.sin(a)];
const at = (f, u, v, y) => [f[0] + u * f[2] - v * f[3], y, f[1] + u * f[3] + v * f[2]];

// ---- the footways: the nearest one to a point, the paved ones for lamps
let SEGS = null;
function segs() {
  if (SEGS) return SEGS; SEGS = [];
  for (const [, hw, surf, pts] of PD.paths) { const n = pts.length >> 1; for (let i = 0; i < n - 1; i++) SEGS.push([pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, surf]); }
  return SEGS;
}
function nearestPath(x, z, r) {
  let best = null, bd = r;
  for (const [ax, az, bx, bz] of segs()) { if (Math.min(ax, bx) > x + r || Math.max(ax, bx) < x - r || Math.min(az, bz) > z + r || Math.max(az, bz) < z - r) continue;
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; const L = Math.sqrt(l2); best = { d, px, pz, tx: dx / L, tz: dz / L }; } }
  return best;
}
const PAVED = /^(paving_stones|asphalt|sett|concrete|concrete:plates|fine_gravel|compacted|wood|)$/;

// ---- park furniture
const IRON = hb('#26292b'), GRANITE = hb('#a59b8e'), GRANITE_D = hb('#3a3b3d'), BRONZE = hb('#4a5148'), STEEL = hb('#c3c8cb');
function lamp(K, x, z, pools) {   // a black cast post with a lantern head; the glass glows at night
  STATE.GBC = levelAt(x, z); const G = K.plain;
  lmLathe(G, x, z, 0, [[0.17, 0], [0.17, 0.12], [0.11, 0.2], [0.11, 0.55], [0.075, 0.7], [0.06, 3.35], [0.09, 3.42], [0.09, 3.48]], 8, IRON);
  lmLathe(K.globe, x, z, 3.48, [[0.09, 0], [0.2, 0.36], [0.18, 0.42]], 8, hb('#f3ead8'));
  lmLathe(G, x, z, 3.9, [[0.18, 0], [0.26, 0.05], [0.24, 0.1], [0.06, 0.3], [0.03, 0.42], [0.06, 0.48], [0.01, 0.56]], 8, IRON);
  STATE.GBC = null; pools.push(x, z);
}
function binAt(G, x, z) { STATE.GBC = levelAt(x, z); lmLathe(G, x, z, 0, [[0.2, 0], [0.22, 0.7], [0.24, 0.74], [0.02, 0.74]], 10, hb('#3b3f3d')); STATE.GBC = null; }
function benchFacing(G, x, z) {   // its seat towards the nearest footway
  const p = nearestPath(x, z, 8); let a = ((x * 7.3 + z * 3.1) % 6.283);
  if (p) { a = Math.atan2(p.tz, p.tx); const vx = -Math.sin(a), vz = Math.cos(a); if (vx * (p.px - x) + vz * (p.pz - z) > 0) a += Math.PI; }
  STATE.GBC = levelAt(x, z); bench(G, x, z, a); STATE.GBC = null;
}
function picnic(G, x, z, a) {
  const f = fr(x, z, a), W = hb('#8a5a35'); STATE.GBC = levelAt(x, z);
  for (const u of [-0.7, 0.7]) { lmBar(G, at(f, u, -0.6, 0), at(f, u, 0.6, 0.75), 0.07, W); lmBar(G, at(f, u, 0.6, 0), at(f, u, -0.6, 0.75), 0.07, W); }
  for (const v of [-0.3, 0, 0.3]) lmBar(G, at(f, -1, v, 0.76), at(f, 1, v, 0.76), 0.24, W);
  for (const s of [-1, 1]) for (const v of [-0.06, 0.06]) lmBar(G, at(f, -1, s * 0.75 + v, 0.45), at(f, 1, s * 0.75 + v, 0.45), 0.12, W);
  STATE.GBC = null;
}
function bbq(G, x, z) { STATE.GBC = levelAt(x, z); for (const [u, v] of [[-0.3, -0.2], [0.3, -0.2], [0.3, 0.2], [-0.3, 0.2]]) lmBar(G, [x + u, 0, z + v], [x + u, 0.7, z + v], 0.05, IRON); box(G, x, z, 1, 0, 0.4, 0.25, 0.7, 0.95, IRON); STATE.GBC = null; }
function toilet(G, x, z, a) { STATE.GBC = levelAt(x, z); box(G, x, z, Math.cos(a), Math.sin(a), 0.6, 0.6, 0, 2.3, hb('#2f6db3')); box(G, x, z, Math.cos(a), Math.sin(a), 0.65, 0.65, 2.3, 2.42, hb('#e8e8e4')); STATE.GBC = null; }
function tap(G, x, z) { STATE.GBC = levelAt(x, z); lmLathe(G, x, z, 0, [[0.16, 0], [0.13, 0.15], [0.11, 0.95], [0.14, 1.0], [0.02, 1.05]], 10, hb('#5d6366')); STATE.GBC = null; }

// ---- fountains
function jet(J, x, z, y, h, r) { lmLathe(J, x, z, y, [[r * 0.6, 0], [r, h * 0.15], [r * 0.8, h * 0.6], [r * 0.5, h * 0.9], [r * 1.6, h], [r * 2.2, h * 0.94], [0.02, h * 0.9]], 10, hb('#eef6fb')); }
function basin(G, x, z, R, h = 0.5) {   // a round rim of granite with water in it
  lmLathe(G, x, z, 0, [[R, 0], [R + 0.05, h * 0.7], [R, h], [R - 0.4, h], [R - 0.4, h * 0.65]], 32, GRANITE);
  lmLathe(G, x, z, h * 0.62, [[R - 0.4, 0], [0.02, 0]], 32, hb('#4d6a74'));
}
function fountain(K, J, x, z, name, detail, park) {
  const G = K.plain; STATE.GBC = levelAt(x, z);
  if (inWater(x, z)) {   // in a pond: the jets only (the pond of Dubrovin park: a tall one with a ring of small ones)
    if (detail === 'nozzle') jet(J, x, z, 0, 2.2, 0.08);
    else { jet(J, x, z, 0, 7.5, 0.38); jet(J, x, z, 0, 5.2, 0.6); for (let k = 0; k < 10; k++) { const t = k / 10 * Math.PI * 2; jet(J, x + Math.cos(t) * 2.4, z + Math.sin(t) * 2.4, 0, 1.6, 0.06); } NOTREE.push([x, z, 6]); }
  } else if (/lilij/i.test(name)) {   // the girl with the lily: a shallow round plate of a basin, a slender bronze girl on a pedestal
    basin(G, x, z, 5.2, 0.45); lmLathe(G, x, z, 0, [[0.9, 0], [0.8, 0.9], [0.55, 1.0]], 16, GRANITE);
    lmLathe(G, x, z, 1.0, [[0.16, 0], [0.22, 0.5], [0.2, 0.9], [0.27, 1.25], [0.18, 1.45], [0.07, 1.55], [0.1, 1.62], [0.11, 1.75], [0.08, 1.86], [0.01, 1.88]], 12, BRONZE);
    lmBar(G, [x + 0.15, 2.3, z], [x + 0.32, 3.05, z + 0.05], 0.05, BRONZE); lmLathe(G, x + 0.33, z + 0.05, 3.0, [[0.02, 0], [0.13, 0.12], [0.02, 0.18]], 6, hb('#e8e2d4'));
    jet(J, x + 0.33, z + 0.05, 3.15, 0.9, 0.05); for (let k = 0; k < 8; k++) { const t = k / 8 * Math.PI * 2; jet(J, x + Math.cos(t) * 3.4, z + Math.sin(t) * 3.4, 0.3, 1.1, 0.05); }
    NOTREE.push([x, z, 7.5]);
  } else if (park === 0) {   // the fortress: a round stone basin, a stepped base, two cast-iron barrels standing up
    basin(G, x, z, 3.3, 0.55);
    for (const [r, y0, y1] of [[1.1, 0, 0.35], [0.85, 0.35, 0.7], [0.62, 0.7, 1.05]]) lmLathe(G, x, z, y0, [[r, 0], [r, y1 - y0], [0.02, y1 - y0]], 4, GRANITE);
    for (const s of [-0.22, 0.22]) lmLathe(G, x + s, z, 1.05, [[0.2, 0], [0.2, 0.25], [0.16, 0.3], [0.13, 3.2], [0.15, 3.3], [0.15, 3.4], [0.09, 3.4]], 12, IRON);
    NOTREE.push([x, z, 5.5]);
  } else {   // a round basin with a dark bowl and its jets (Esplanāde)
    basin(G, x, z, 3.6, 0.5); lmLathe(G, x, z, 0, [[0.35, 0], [0.3, 0.6], [1.1, 0.9], [1.15, 1.05], [0.9, 1.05]], 16, GRANITE_D);
    jet(J, x, z, 1.0, 2.6, 0.12); for (let k = 0; k < 6; k++) { const t = k / 6 * Math.PI * 2; jet(J, x + Math.cos(t) * 2.2, z + Math.sin(t) * 2.2, 0.3, 1.2, 0.05); }
    NOTREE.push([x, z, 6]);
  }
  STATE.GBC = null;
}

// ---- monuments
function pedestal(G, x, z, a, w, h) { const ux = Math.cos(a), uz = Math.sin(a); box(G, x, z, ux, uz, w * 0.85, w * 0.85, 0, 0.25, GRANITE); box(G, x, z, ux, uz, w / 2, w / 2 * 0.9, 0.25, h, GRANITE); box(G, x, z, ux, uz, w / 2 + 0.05, w / 2 * 0.9 + 0.05, h - 0.08, h, sh(GRANITE, 1.05)); }
function bust(G, x, z, a, name) {   // a bronze bust (chest, shoulders and a large head) on a tall granite pedestal: Pumpurs with his beard, Rainis with his moustache
  pedestal(G, x, z, a, 0.75, 2.0); const f = fr(x, z, a), ux = f[2], uz = f[3], beard = /Pumpur/.test(name), y = 2.32;
  box(G, x, z, ux, uz, 0.15, 0.3, 2.0, 2.2, BRONZE); box(G, x, z, ux, uz, 0.13, 0.24, 2.2, 2.27, BRONZE);   // the chest and the shoulders
  lmLathe(G, x, z, 2.27, [[0.12, 0], [0.1, 0.05], [0.11, 0.07]], 10, BRONZE);   // the neck
  lmLathe(G, x, z, y, [[0.11, 0], [0.19, 0.08], [0.22, 0.24], [0.21, 0.4], [0.17, 0.51], [0.09, 0.57], [0.02, 0.6]], 14, BRONZE);
  lmBar(G, at(f, 0.21, 0, y + 0.34), at(f, 0.25, 0, y + 0.22), 0.08, BRONZE);   // the nose
  lmBar(G, at(f, 0.2, -0.1, y + 0.38), at(f, 0.2, 0.1, y + 0.38), 0.05, BRONZE);   // the brows
  if (beard) lmLathe(G, ...at(f, 0.1, 0, 0).filter((_, k) => k !== 1), y - 0.02, [[0.04, 0], [0.16, 0.08], [0.18, 0.2], [0.12, 0.3]], 10, BRONZE);
  else lmBar(G, at(f, 0.22, -0.09, y + 0.17), at(f, 0.22, 0.09, y + 0.17), 0.05, BRONZE);   // the moustache
}
function statue(G, x, z, a) {   // a standing man in a frock coat on a pedestal
  const f = fr(x, z, a); pedestal(G, x, z, a, 1.2, 1.9); const y = 1.9;
  for (const s of [-0.13, 0.13]) { const [px, , pz] = at(f, 0, s, 0); lmLathe(G, px, pz, y, [[0.09, 0], [0.08, 0.6], [0.1, 0.8]], 8, BRONZE); }
  lmLathe(G, x, z, y + 0.75, [[0.3, 0], [0.26, 0.3], [0.24, 0.75], [0.27, 1.05], [0.22, 1.15], [0.08, 1.2]], 12, BRONZE);
  for (const s of [-0.3, 0.3]) lmBar(G, at(f, 0.02, s, y + 1.8), at(f, s > 0 ? 0.18 : 0, s * 1.1, y + 1.15), 0.12, BRONZE);
  lmLathe(G, x, z, y + 1.95, [[0.07, 0], [0.12, 0.06], [0.13, 0.2], [0.1, 0.3], [0.02, 0.33]], 10, BRONZE);
}
function stele(G, f, u, v, w, d, h1, h2, col) {   // a block of w × d with its top sloping from h1 (at -w/2) to h2 (at +w/2)
  const A = [at(f, u - d / 2, v - w / 2, 0), at(f, u + d / 2, v - w / 2, 0), at(f, u + d / 2, v + w / 2, 0), at(f, u - d / 2, v + w / 2, 0)], T = [h1, h1, h2, h2];
  for (let k = 0; k < 4; k++) { const j = (k + 1) % 4, nx = (A[j][2] - A[k][2]), nz = -(A[j][0] - A[k][0]); polyA(G, [A[k], A[j], [A[j][0], T[j], A[j][2]], [A[k][0], T[k], A[k][2]]], col, nx, 0, nz); }
  polyA(G, A.map((p, k) => [p[0], T[k], p[2]]), sh(col, 1.1), 0, 1, 0);
}
function warMemorial(G, x, z, a, big) {
  const f = fr(x, z, a);
  if (big) {   // Dubrovin park: a platform with steps, dark granite steles in two groups round a gap, the tallest at the ends
    box(G, x, z, f[2], f[3], 7, 5, 0, 0.35, GRANITE); box(G, x, z, f[2], f[3], 7.6, 5.6, 0, 0.17, sh(GRANITE, 0.95));
    for (const [v, w, h1, h2] of [[-3.9, 1.3, 6.4, 5.4], [-2.6, 1.0, 5.2, 4.6], [-1.2, 0.8, 4.4, 4.9], [1.2, 0.8, 4.9, 4.4], [2.6, 1.0, 4.6, 5.2], [3.9, 1.3, 5.4, 6.4]]) stele(G, f, -2.5 + Math.abs(v) * 0.35, v, w, 0.55, h1, h2, GRANITE_D);
    NOTREE.push([x, z, 9]);
  } else { box(G, x, z, f[2], f[3], 1.0, 1.4, 0, 0.3, GRANITE); stele(G, f, 0, 0, 1.6, 0.4, 2.3, 2.7, GRANITE_D); NOTREE.push([x, z, 4]); }
}
function stone(G, x, z, plaque) {
  if (plaque) { box(G, x, z, 1, 0, 0.5, 0.25, 0, 0.9, GRANITE); }
  else lmLathe(G, x, z, 0, [[0.7, 0], [0.85, 0.3], [0.75, 0.75], [0.45, 1.05], [0.05, 1.15]], 7, hb('#8e8a84'));
  NOTREE.push([x, z, 3]);
}
function artwork(K, x, z, name, i) {
  const G = K.plain, h = hash(i * 31 + 7), a = h * 6.283;
  if (/Mīlestības/.test(name)) {   // the Tree of Love: a trunk and branches of steel with red hearts
    lmLathe(G, x, z, 0, [[0.18, 0], [0.12, 2.0], [0.08, 2.6]], 8, STEEL);
    for (let k = 0; k < 7; k++) { const t = k / 7 * 6.283, y = 1.8 + (k % 3) * 0.35, L = 1.1 + (k % 2) * 0.4, e = [x + Math.cos(t) * L, y + 0.8, z + Math.sin(t) * L];
      lmBar(G, [x, y, z], e, 0.06, STEEL); box(G, e[0], e[2], Math.cos(t), Math.sin(t), 0.14, 0.05, e[1] - 0.12, e[1] + 0.12, hb('#c8262c')); }
  } else if (h < 0.4) {   // a polished disc on a post
    lmLathe(G, x, z, 0, [[0.06, 0], [0.06, 1.6]], 8, STEEL); const f = fr(x, z, a);
    for (let k = 0; k < 16; k++) { const t0 = k / 16 * 6.283, t1 = (k + 1) / 16 * 6.283; polyA(G, [at(f, 0, 0, 2.2), at(f, 0, Math.cos(t0) * 0.75, 2.2 + Math.sin(t0) * 0.75), at(f, 0, Math.cos(t1) * 0.75, 2.2 + Math.sin(t1) * 0.75)], STEEL, f[2], 0, f[3]); polyA(G, [at(f, -0.01, 0, 2.2), at(f, -0.01, Math.cos(t1) * 0.75, 2.2 + Math.sin(t1) * 0.75), at(f, -0.01, Math.cos(t0) * 0.75, 2.2 + Math.sin(t0) * 0.75)], STEEL, -f[2], 0, -f[3]); }
  } else if (h < 0.7) {   // a bronze ring on a block
    box(G, x, z, Math.cos(a), Math.sin(a), 0.5, 0.4, 0, 0.6, GRANITE); const f = fr(x, z, a);
    for (let k = 0; k < 14; k++) { const t0 = k / 14 * 6.283, t1 = (k + 1) / 14 * 6.283; lmBar(G, at(f, 0, Math.cos(t0) * 0.7, 1.4 + Math.sin(t0) * 0.7), at(f, 0, Math.cos(t1) * 0.7, 1.4 + Math.sin(t1) * 0.7), 0.16, BRONZE); }
  } else {   // an abstract bronze on a plinth
    box(G, x, z, Math.cos(a), Math.sin(a), 0.45, 0.45, 0, 0.8, GRANITE);
    lmLathe(G, x, z, 0.8, [[0.28, 0], [0.18, 0.4], [0.32, 0.9], [0.14, 1.3], [0.22, 1.6], [0.02, 1.75]], 9, BRONZE);
  }
  NOTREE.push([x, z, 2.5]);
}
function sundial(G, x, z) { lmLathe(G, x, z, 0, [[0.55, 0], [0.55, 0.15], [0.32, 0.25], [0.28, 0.95], [0.5, 1.05], [0.5, 1.12], [0.02, 1.12]], 12, hb('#1c1d1f')); polyA(G, [[x - 0.3, 1.12, z], [x + 0.3, 1.12, z], [x - 0.3, 1.5, z]], hb('#8a8478'), 0, 0, 1); NOTREE.push([x, z, 2.5]); }

// ---- flower beds, hedges, low walls
const FLOWERS = ['#c8263a', '#e8b52a', '#f0eee6', '#8a4fb0', '#e8722a', '#d05c8a', '#c8263a', '#f2d14a'];
function bed(G, r, i) {
  const n = r.length >> 1, K = hb('#9c958a');
  for (let k = 0; k < n; k++) { const A = P2(r, k), B = P2(r, (k + 1) % n), Fw = lmWF(A, B); if (Fw.L > 0.05) lmBoxW(G, Fw, 0, Fw.L, 0, 0.25, -0.06, 0.12, K); }
  const t0 = triangulate([r]), { flat, tris } = TERR.on ? subTris(t0.flat, t0.tris, 0.25) : t0, v0 = G.v; G.ensure(flat.length / 2);
  for (let k = 0; k < flat.length; k += 2) G.vert(flat[k], 0.2, flat[k + 1], 0, 1, 0, hb('#4a3a2b')); for (let k = 0; k < tris.length; k += 3) G.triUp(v0 + tris[k], v0 + tris[k + 1], v0 + tris[k + 2]);
  const bb = bbox(r); let c = 0; const col = (u, v) => FLOWERS[Math.floor(hash(i * 13 + Math.floor(u / 1.6) * 7 + Math.floor(v / 1.6) * 3) * FLOWERS.length)];
  for (let x = bb[0] + 0.3; x < bb[2] && c < 900; x += 0.45) for (let z = bb[1] + 0.3; z < bb[3] && c < 900; z += 0.45) {
    if (!pip(x, z, r)) continue; c++; const j = hash(x * 13.1 + z * 7.7) * 0.2, cl = hb(hash(x * 3 + z * 5) < 0.18 ? '#4f7a36' : col(x - bb[0], z - bb[1]));
    polyA(G, [[x - 0.17 + j, 0.42, z - 0.17], [x + 0.17 + j, 0.42, z - 0.17], [x + 0.17 + j, 0.42, z + 0.17], [x - 0.17 + j, 0.42, z + 0.17]], cl, 0, 1, 0);
  }
  NOTREE_POLY.push({ r, bb: [bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1] });
}
function hedge(G, pts, i) {
  const n = pts.length >> 1, C = sh(hb('#3e6a2e'), 0.92 + hash(i) * 0.16);
  for (let k = 0; k < n - 1; k++) { const Fw = lmWF(P2(pts, k), P2(pts, k + 1)); if (Fw.L < 0.05) continue; lmBoxW(G, Fw, -0.3, Fw.L + 0.3, 0, 1.05, -0.4, 0.4, C); }
}
function lowWall(G, pts) { const n = pts.length >> 1; for (let k = 0; k < n - 1; k++) { const Fw = lmWF(P2(pts, k), P2(pts, k + 1)); if (Fw.L > 0.05) lmBoxW(G, Fw, -0.15, Fw.L + 0.15, 0, 0.6, -0.2, 0.2, hb('#8f8a80')); } }

/* Draws what is in the parks. */
function lmParks(K) {
  if (!PD) return;
  const G = K.plain, surf = new GB(false), pools = [];
  PARK_JETS = new GB(false);
  // what the school grounds draw: pitches, tracks, playgrounds, fitness stations, fences, bins, bicycle stands
  const dogs = PD.areas.filter(a => a[1] === 'dog_park'), bmx = PD.tracks.filter(t => /bmx/.test(t[4]));
  groundsOf(G, { pitches: PD.pitches, tracks: PD.tracks.filter(t => !/bmx/.test(t[4])), areas: PD.areas.filter(a => a[1] !== 'dog_park'),
    fences: PD.fences.filter(f => f[0] !== 'hedge' && f[0] !== 'wall').concat(dogs.map(d => ['chain', 1.2, d[2]])),
    points: PD.points.filter(p => /^(waste_basket|bicycle_parking|playground|fitness_station)$/.test(p[1])) });
  for (const [, , , , , pts] of PD.pitches) { const r = ring(pts), bb = bbox(r); NOTREE_POLY.push({ r, bb }); }
  for (const [, , pts] of PD.areas) { const r = ring(pts), bb = bbox(r); NOTREE_POLY.push({ r, bb: [bb[0] - 1.5, bb[1] - 1.5, bb[2] + 1.5, bb[3] + 1.5] }); }
  for (const d of dogs) fillPoly(surf, [ring(d[2])], hb('#bfae86'));
  for (const t of bmx) { const pts = t[5], closed = pts.length > 6 && Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 0.5; bandAlong(surf, closed ? pts.slice(0, -2) : pts, closed, 1.4, hb('#7a6146'), null); }
  groundMesh(surf, groundMaterial(detailTex(3), 1 / 3, 0.2, 'park-ground'), -32.6);
  // beds, hedges, walls, rows of trees
  PD.beds.forEach(([, pts], i) => bed(G, ring(pts), i));
  PD.fences.forEach(([kind, , pts], i) => { if (kind === 'hedge') hedge(G, pts, i); else if (kind === 'wall') lowWall(G, pts); });
  for (const [, needle, pts] of PD.rows) { const n = pts.length >> 1; let acc = 3;
    for (let k = 0; k < n - 1; k++) { const [ax, az] = P2(pts, k), [bx, bz] = P2(pts, k + 1), L = Math.hypot(bx - ax, bz - az);
      for (; acc < L; acc += 7) { const x = ax + (bx - ax) * acc / L, z = az + (bz - az) * acc / L; if (!inBuilding(x, z) && !inWater(x, z)) PARK_TREES.push([x, z, needle ? 3 : 1, 0.95 + hash(x * 3.1 + z) * 0.35]); }
      acc -= L; } }
  // fountains, monuments, sculptures and the rest of the points
  PD.points.forEach(([park, kind, x, z, name, detail], i) => {
    STATE.GBC = levelAt(x, z);
    const pth = nearestPath(x, z, 30), a = pth ? Math.atan2(pth.pz - z, pth.px - x) : 0;   // facing the nearest footway
    if (kind === 'fountain') fountain(K, PARK_JETS, x, z, name, detail, park);
    else if (kind === 'memorial') { if (detail === 'bust') { bust(G, x, z, a, name); NOTREE.push([x, z, 3]); } else if (detail === 'statue') { statue(G, x, z, a); NOTREE.push([x, z, 3.5]); } else if (detail === 'war_memorial') warMemorial(G, x, z, a, park === 13); else stone(G, x, z, detail === 'plaque'); }
    else if (kind === 'artwork') artwork(K, x, z, name, i);
    else if (kind === 'sundial') sundial(G, x, z);
    else if (kind === 'bench') benchFacing(G, x, z);
    else if (kind === 'picnic_table') { picnic(G, x, z, a); NOTREE.push([x, z, 2]); }
    else if (kind === 'bbq') bbq(G, x, z);
    else if (kind === 'toilets') { toilet(G, x, z, a); NOTREE.push([x, z, 2]); }
    else if (kind === 'drinking_water') tap(G, x, z);
    else if (kind === 'lamp') lamp(K, x, z, pools);
    STATE.GBC = null;
  });
  // lamps along the paved footways every 24 m on alternating sides, away from the mapped ones
  const have = new Set(); for (let k = 0; k < pools.length; k += 2) have.add(Math.round(pools[k] / 10) + ':' + Math.round(pools[k + 1] / 10));
  for (const [, hw, surfc, pts] of PD.paths) {
    if (hw === 'steps' || !PAVED.test(surfc)) continue;
    const n = pts.length >> 1; let acc = 8, side = 1;
    for (let k = 0; k < n - 1; k++) { const [ax, az] = P2(pts, k), [bx, bz] = P2(pts, k + 1), L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
      for (; acc < L; acc += 24) { const tx = (bx - ax) / L, tz = (bz - az) / L, off = (hw === 'pedestrian' ? 3.2 : 1.7) * side, x = ax + tx * acc - tz * off, z = az + tz * acc + tx * off; side = -side;
        const key = Math.round(x / 10) + ':' + Math.round(z / 10); if (have.has(key) || inBuilding(x, z) || inWater(x, z) || parkNoTree(x, z) || onRoad(x, z, 0.35)) continue; have.add(key); lamp(K, x, z, pools); }
      acc -= L; } }
  // the pools of light under the lamps at night
  const pool = new THREE.PlaneGeometry(1, 1); pool.rotateX(-Math.PI / 2); const np = pools.length >> 1;
  PARK_POOLS = new THREE.InstancedMesh(pool, new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(1.0, 0.78, 0.5), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), np);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), S = new THREE.Vector3(13, 1, 13);
  for (let k = 0; k < np; k++) { M.compose(new THREE.Vector3(pools[2 * k], 0.07, pools[2 * k + 1]), q, S); PARK_POOLS.setMatrixAt(k, M); }
  PARK_POOLS.visible = false; PARK_POOLS.renderOrder = 5; scene.add(PARK_POOLS);
  // the water of the jets: white and half clear, lit at night
  const jm = lmStd({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, roughness: 0.15, metalness: 0, emissive: new THREE.Color(0.85, 0.95, 1), emissiveIntensity: 0 }, 'park-jets');
  const mj = PARK_JETS.mesh(jm); if (mj) { mj.renderOrder = 6; scene.add(mj); PARK_JETS = jm; } else PARK_JETS = null;
}
// at night: the light under the lamps and the lit jets
function parksNight(n) { if (PARK_POOLS) PARK_POOLS.visible = n > 0.5; if (PARK_JETS) PARK_JETS.emissiveIntensity = n * 0.9; }

export { PARK_RINGS, PARK_TREES, lmParks, parkNoTree, parksNight };
