import { C } from '../core/env.js';
import { dec } from '../core/util.js';
import { RB, rbLocal } from './bridge-railway.js';
import { terrainH } from './terrain.js';   // a cycle: used at run time only

/* ---------- Lielā iela under the first span of the railway bridge ----------
   The first 12 m of Dzelzceļa tilts are a concrete beam over a service road (OSM: Lielā iela, a way that crosses the
   axis of the bridge near s = 7 m, almost at a right angle). Mapillary shows 4.5–5 m between the road and the soffit.
   The terrain model (20 m grid) cannot draw a cutting 7–10 m wide, so the road lay at 3.1–3.6 m with the deck at
   3.5–3.9 m, inside the beam. Here the second fine patch of the terrain (src/world/terrain.js) cuts it:
   - the road level under the bridge is the deck line (as lmRailBridge draws it) less 1.3 m of the beam less 4.5 m of
     clearance; away from it the road climbs at 7 % (the knee rounded over 12 m) until it meets the ground the model
     gives along the road, so the cutting dies out by itself some 90 m off;
   - across it the road level holds for 4 m each side of the axis of the way (carriageway and sidewalks), then slopes
     of 1 : 1.5 rise to the ground.
   The patch is built as soon as the grid is final; the abutment of the first span is drawn clear of the road
   (src/landmarks/railway-bridge.js). */
const RP = { ok: false };
const HALF = 4.0, SLOPE = 1.5, GRADE = 0.07, KNEE = 12, FLAT = 12, RMAX = 100, CLEAR = 4.5, BEAM = 1.3;
const WALL = 0.5;   // s of the retaining wall under the start of the beam, towards the embankment
const BEAM_S = 12;   // the length of the concrete beam (EDGE in src/landmarks/railway-bridge.js)

function rbPatch() {
  // the road: a way of class 0 that crosses the axis of the bridge within the beam
  let name = -1, cx = 0, cz = 0, sc = 0;
  for (const l of C.l) { if (l[0] !== 0 || l[3]) continue; const p = dec(l[2]), n = p.length >> 1;
    for (let i = 0; i < n - 1; i++) { const [s1, d1] = rbLocal(p[2 * i], p[2 * i + 1]), [s2, d2] = rbLocal(p[2 * i + 2], p[2 * i + 3]);
      if (Math.sign(d1) === Math.sign(d2) || d1 === d2) continue; const t = d1 / (d1 - d2), s = s1 + (s2 - s1) * t;
      if (s > 0 && s < BEAM_S) { name = l[1]; sc = s; cx = p[2 * i] + (p[2 * i + 2] - p[2 * i]) * t; cz = p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * t; } } }
  if (name < 0) return null;
  // the segments of that road (and of the ways that continue it) within reach of the crossing
  const seg = [];
  for (const l of C.l) { if (l[0] !== 0 || l[1] !== name || l[3]) continue; const p = dec(l[2]), n = p.length >> 1;
    for (let i = 0; i < n - 1; i++) { const x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * i + 2], z2 = p[2 * i + 3];
      if (Math.min(Math.hypot(x1 - cx, z1 - cz), Math.hypot(x2 - cx, z2 - cz)) < RMAX + 40 || Math.hypot((x1 + x2) / 2 - cx, (z1 + z2) / 2 - cz) < RMAX + 40) seg.push(x1, z1, x2, z2); } }
  // the nearest point of the road: its distance, the point
  const near = (x, z) => { let bd = 1e9, bx = 0, bz = 0;
    for (let i = 0; i < seg.length; i += 4) { const x1 = seg[i], z1 = seg[i + 1], dx = seg[i + 2] - x1, dz = seg[i + 3] - z1, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; bx = px; bz = pz; } }
    return [bd, bx, bz]; };
  const h0 = terrainH(RB.A[0], RB.A[1]), h1 = terrainH(RB.B[0], RB.B[1]), Rb = h0 + (h1 - h0) * sc / RB.L - BEAM - CLEAR;
  const knee = u => u <= 0 ? 0 : u < KNEE ? u * u / (2 * KNEE) : u - KNEE / 2;
  // the box: the road within RMAX of the crossing, and the slopes beside it
  let x0 = cx, x1 = cx, z0 = cz, z1 = cz; for (let i = 0; i < seg.length; i += 2) { if (Math.hypot(seg[i] - cx, seg[i + 1] - cz) > RMAX + 20) continue; x0 = Math.min(x0, seg[i]); x1 = Math.max(x1, seg[i]); z0 = Math.min(z0, seg[i + 1]); z1 = Math.max(z1, seg[i + 1]); }
  x0 = Math.floor(Math.max(x0, cx - RMAX) - 20); z0 = Math.floor(Math.max(z0, cz - RMAX) - 20); x1 = Math.ceil(Math.min(x1, cx + RMAX) + 20); z1 = Math.ceil(Math.min(z1, cz + RMAX) + 20);
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1, d = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i, z = z0 + j, [dist, px, pz] = near(x, z), r = Math.hypot(px - cx, pz - cz), H = terrainH(x, z), Hc = terrainH(px, pz);
    const rl = Math.min(Hc, Rb + GRADE * knee(r - FLAT));   // the level of the road at the nearest point
    const e = Math.max(0, dist - HALF), t = Math.min(H, rl + e / SLOPE);
    // the ground at the end of the bridge keeps its height (the deck line reads it, lmRailBridge and bridgeOf): the cut stops
    // at a wall under the start of the beam
    d[j * nx + i] = rbLocal(x, z)[0] < WALL ? 0 : Math.min(0, t - H);
  }
  RP.ok = true; RP.level = Rb; RP.cross = [cx, cz, sc];
  return { x0, z0, s: 1, nx, nz, d };
}

export { RP, rbPatch };
