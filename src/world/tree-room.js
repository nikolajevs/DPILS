import { AREAS, BGRID, BLD, ROAD, inBuilding } from './data.js';
import { SHOP_LOTS } from '../landmarks/shops.js';
import { bbox, pip } from '../core/util.js';

/* ---------- room for a lidar tree ----------
   The lidar finds a tree by the top of its crown, and the model's streets, paths and pitches are drawn wider or a little
   off where they really are, its outlines of the houses a little off too, and its crowns are round where a real one
   grows away from a wall. So a lidar tree is set where the model has room for it:
   - its trunk not in a house, nor on a street or its sidewalks, a path, a track or a rail (0.6 m off their edge), nor on
     a pitch, a playground or the car park of a store (half its crown off their edge, so no more than half of it hangs
     over them): pushed out of each the shortest way, at most 2.5 to 5 m (60 % of its crown) in all from where the lidar
     saw it, else left out;
   - its crown out of the walls (the trunk 0.85 of the radius off the nearest wall): moved away within the same reach, and
     what is still too close makes the crown narrower, down to half of what was measured; narrower than that, the tree is
     left out (it stands right against a house or between two). */
const CELL = 60, FREE = 0.6, WALL = 0.85;
let OB = null, stamp = null, stampN = 0;
function obstacles() {
  OB = new Map(); const put = (r, bb) => { for (let i = Math.floor(bb[0] / 50); i <= Math.floor(bb[2] / 50); i++) for (let j = Math.floor(bb[1] / 50); j <= Math.floor(bb[3] / 50); j++) { const k = i * 100000 + j; let l = OB.get(k); if (!l) OB.set(k, l = []); l.push({ r, bb }); } };
  for (const a of AREAS) if (a.cls === 10 || a.cls === 13) put(a.rings[0], a.bb);   // pitches, playgrounds
  for (const p of SHOP_LOTS) { const r = p.flat(); put(r, bbox(r)); }   // the car parks of the stores
  stamp = new Int32Array(BLD.length + 16);
}
// the nearest point on the edges of a ring
function edgeNear(x, z, r, best) {
  const n = r.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = r[2 * j], az = r[2 * j + 1], dx = r[2 * i] - ax, dz = r[2 * i + 1] - az, l2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) { best.d = d; best.px = px; best.pz = pz; best.nx = -dz; best.nz = dx; }
  }
  return best;
}
// the nearest wall within R: { d, px, pz } or null
function wallNear(x, z, R) {
  if (stamp.length < BLD.length) stamp = new Int32Array(BLD.length + 16);
  stampN++; const best = { d: R, px: 0, pz: 0, nx: 0, nz: 0 }; let hit = false;
  for (let i = Math.floor((x - R) / CELL); i <= Math.floor((x + R) / CELL); i++) for (let j = Math.floor((z - R) / CELL); j <= Math.floor((z + R) / CELL); j++) {
    const l = BGRID.get((i + 2000) * 4096 + j + 2000); if (!l) continue;
    for (const id of l) { if (stamp[id] === stampN) continue; stamp[id] = stampN; const b = BLD[id], bb = b.bb;
      if (x < bb[0] - R || x > bb[2] + R || z < bb[1] - R || z > bb[3] + R) continue; const d0 = best.d; edgeNear(x, z, b.ring, best); if (best.d < d0) hit = true; }
  }
  return hit ? best : null;
}
// away from a nearest point (px, pz) by s metres beyond it; on the line itself along the normal (nx, nz)
function away(x, z, q, s) { const dx = x - q.px, dz = z - q.pz, d = Math.hypot(dx, dz); if (d > 1e-3) return [dx / d * s, dz / d * s]; const l = Math.hypot(q.nx, q.nz) || 1; return [q.nx / l * s, q.nz / l * s]; }
// what the trunk at (x, z) stands in, as the shortest step out of it, or null where it stands free
function stepOut(x, z, r) {
  if (inBuilding(x, z)) { const w = wallNear(x, z, 40); if (!w) return [1e3, 0]; const dx = w.px - x, dz = w.pz - z, d = Math.hypot(dx, dz) || 1e-3; return [dx / d * (d + FREE), dz / d * (d + FREE)]; }
  let worst = 0, q = null; const s = ROAD.s;
  ROAD.near(x, z, 14, (id, d, px, pz) => { const o = id * 6, v = s[o + 4] + FREE - d; if (v > worst) { worst = v; q = { px, pz, nx: -(s[o + 3] - s[o + 1]), nz: s[o + 2] - s[o] }; } });
  if (q) return away(x, z, q, worst + 0.05);
  // a pitch, a playground or a car park: the trunk out of it by half the crown at least, so that no more than half of it
  // hangs over the edge
  const c = Math.max(FREE, 0.5 * r); stampN++;
  for (let i = Math.floor((x - c) / 50); i <= Math.floor((x + c) / 50); i++) for (let j = Math.floor((z - c) / 50); j <= Math.floor((z + c) / 50); j++) for (const o of OB.get(i * 100000 + j) || []) {
    if (o.seen === stampN || x < o.bb[0] - c || x > o.bb[2] + c || z < o.bb[1] - c || z > o.bb[3] + c) continue; o.seen = stampN;
    const e = edgeNear(x, z, o.r, { d: 1e9 }), dx = e.px - x, dz = e.pz - z, d = Math.hypot(dx, dz) || 1e-3;
    if (pip(x, z, o.r)) return [dx / d * (d + c), dz / d * (d + c)];
    if (d < c) return [-dx / d * (c - d + 0.05), -dz / d * (c - d + 0.05)];
  }
  return null;
}
// where a lidar tree seen at (x0, z0) with a crown of radius r0 can stand: { x, z, r, moved }, or null
function treeRoom(x0, z0, r0) {
  if (!OB) obstacles();
  const reach = Math.max(2.5, Math.min(5, 0.6 * r0)), far = (x, z) => Math.hypot(x - x0, z - z0) > reach;
  let x = x0, z = z0;
  for (let it = 0; ; it++) { const s = stepOut(x, z, r0); if (!s) break; if (it === 6) return null; x += s[0]; z += s[1]; if (far(x, z)) return null; }
  let r = r0;
  for (let it = 0; it < 4; it++) {
    const need = Math.max(1, WALL * r), w = wallNear(x, z, need); if (!w) return { x, z, r, moved: x !== x0 || z !== z0 };
    const [dx, dz] = away(x, z, w, need - w.d + 0.05), nx = x + dx, nz = z + dz; if (far(nx, nz) || stepOut(nx, nz, r0)) break; x = nx; z = nz;
  }
  const w = wallNear(x, z, Math.max(1, WALL * r));
  if (w) { r = w.d / WALL; if (r < Math.max(1.2, 0.5 * r0)) return null; }
  return { x, z, r, moved: x !== x0 || z !== z0 };
}

export { treeRoom };
