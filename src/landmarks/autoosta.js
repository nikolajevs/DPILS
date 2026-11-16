import { lmWF } from './helpers.js';
import { LMS } from './tiles.js';
import { LMWHITE } from './core.js';
import { band, flatPlain, vband } from '../buildings/walls.js';
import { COL } from '../world/data.js';
import { box, lathe, polyA } from '../core/geometry.js';
import { area2, hb, offsetRing, reversed } from '../core/util.js';

/* ---- Daugavpils autoosta, the bus station, Viestura iela 10 ----
   OpenStreetMap maps the station building (way 1157522900) and, along its east side, the platform canopy (amenity=shelter,
   way 835547039), which the data build took for a five-storey house (it is dropped: LM_DROP_BIG in core.js). East of the
   canopy, 9.7 m off its edge, runs the buses' own driveway (service, access=no) from Lāčplēša iela to Viestura iela, which
   the buses take southwards, the platform on their right. There is room for three buses along the platform, end to end.
   No street photographs of it could be had (none on Mapillary there, Commons would not answer the cloud), so the canopy
   is drawn as a plain modern one: a raised paved platform with a yellow edge, a flat roof on steel posts reaching 0.8 m
   past the platform over the buses, AUTOOSTA on its fascia, the bay numbers hanging at the front of each bay, benches
   along the building, bins; the strip between the platform and the driveway is asphalt with the three bays marked. */
const CANOPY = [[-906.5, 1218.7], [-901.5, 1220.0], [-916.6, 1276.8], [-925.9, 1274.4], [-920.8, 1255.3], [-920.0, 1255.5], [-914.9, 1236.4], [-915.8, 1236.1], [-911.5, 1220.1], [-907.1, 1221.3]];
const EDGE = [[-901.5, 1220.0], [-916.6, 1276.8]];   // the platform edge, along the buses
// the buses' driveway along the platform (south is the way they go) and how far right of it they stand: at the platform
const AO = { lane: [[-894.3, 1230.7], [-913.7, 1308.1]], laneOff: 7.6, stop: 'Daugavpils AO', stopXZ: [-901.0, 1257.4], bays: [-12.5, 0, 12.5] };
function signW(K, pr, pl, y0, y1, name, lit) {   // a sign between two points (right, left as seen by the viewer)
  const F = lmWF(pr, pl), t = LMS[name]; if (!t) return;
  K.txt.q(F.at(0, y0, 0), F.at(F.L, y0, 0), F.at(F.L, y1, 0), F.at(0, y1, 0), [F.nx, 0, F.nz], [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, lit);
}
function lmAutoosta(K) {
  const G = K.plain, PAVE = hb('#9b9893'), KERB = hb('#8c8a86'), YEL = hb('#e2c13c'), ROOF = hb('#d9dcde'), SOFF = hb('#b8bcbf'), STEEL = hb('#5c6266'), ASPH = hb('#6e7072'), WHITE = hb('#e8e6df'), WOOD = hb('#7a5a40');
  let r = Float32Array.from(CANOPY.flat()); if (area2(r) < 0) r = reversed(r);
  const [[ax, az], [bx, bz]] = EDGE, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, ox = uz, oz = -ux;   // along the edge (south); out of the platform (east)
  const at = (s, d) => [ax + ux * s + ox * d, az + uz * s + oz * d];
  // the apron between the platform and the driveway: asphalt, the bays marked in white
  { const P = [at(-2, 0), at(L + 2, 0), at(L + 2, 9.0), at(-2, 9.0)]; let q = Float32Array.from(P.flat()); if (area2(q) < 0) q = reversed(q); flatPlain(G, [q], 0.04, ASPH, false); }
  // where the bays lie along the edge: the buses stand with their fronts at the stop (the driveway's point by it) plus the bay's shift
  const stopS = s => { const [lx, lz] = AO.lane[0], [mx, mz] = AO.lane[1], ll = Math.hypot(mx - lx, mz - lz), vx = (mx - lx) / ll, vz = (mz - lz) / ll, [sx, sz] = AO.stopXZ; const a = (sx - lx) * vx + (sz - lz) * vz + s, px = lx + vx * a, pz = lz + vz * a; return (px - ax) * ux + (pz - az) * uz; };
  AO.bays.forEach((b, k) => { const front = stopS(b), back = front - 12.6;
    for (const s of [back, front + 0.4]) box(G, ...at(s, 1.7), ox, oz, 1.5, 0.06, 0.04, 0.06, WHITE, true);     // the bay ends
    box(G, ...at((front + back) / 2, 3.25), ux, uz, 6.5, 0.06, 0.04, 0.06, WHITE, true);                       // its outer line
    // the number, hanging under the roof at the front of the bay, facing the driveway and the platform
    const [cx, cz] = at(front - 1.5, -0.6); signW(K, [cx - ux * 0.3, cz - uz * 0.3], [cx + ux * 0.3, cz + uz * 0.3], 2.95, 3.55, 'aoBay' + (k + 1), 1);
    signW(K, [cx + ux * 0.3 - ox * 0.02, cz + uz * 0.3 - oz * 0.02], [cx - ux * 0.3 - ox * 0.02, cz - uz * 0.3 - oz * 0.02], 2.95, 3.55, 'aoBay' + (k + 1), 1);
    lmRod(G, cx, cz, 3.55, 3.7, STEEL); });
  // the platform: raised, paved, the yellow edge along the buses
  flatPlain(G, [r], 0.16, PAVE, false); vband(G, r, 0, 0.16, KERB);
  box(G, ...at(L / 2, -0.25), ux, uz, L / 2, 0.25, 0.16, 0.17, YEL, true);
  // the roof: flat, 0.35 m deep, out 0.8 m over the buses
  const roof = offsetRing(r, 0.8) || r;
  flatPlain(G, [roof], 3.95, ROOF, false); flatPlain(G, [roof], 3.6, SOFF, true); vband(G, roof, 3.6, 3.95, hb('#1d5ca6'));
  // AUTOOSTA on the fascia over the middle, facing the driveway
  { const [cx, cz] = at(L / 2, 0.82); signW(K, [cx - ux * 5, cz - uz * 5], [cx + ux * 5, cz + uz * 5], 3.62, 3.93, 'aoName', 1); }
  // the posts, 0.5 m in from the edge every 7 m
  for (let s = 2; s <= L - 1; s += 7.2) { const [x, z] = at(s, -0.5); lathe(G, x, z, 0.16, [[0.12, 0], [0.12, 3.44]], 8, 0, STEEL); COL.add(x, z, x + 0.01, z, 0.14, 0); }
  // benches along the building side and bins by the posts
  for (let s = 6; s <= L - 4; s += 9) { const [x, z] = at(s, -4.2); box(G, x, z, ux, uz, 1.0, 0.22, 0.6, 0.66, WOOD); box(G, x - ox * 0.22, z - oz * 0.22, ux, uz, 1.0, 0.04, 0.66, 1.05, WOOD);
    for (const e of [-0.85, 0.85]) box(G, x + ux * e, z + uz * e, ux, uz, 0.04, 0.2, 0.16, 0.6, STEEL);
    const [bx2, bz2] = at(s + 3.5, -1.0); lathe(G, bx2, bz2, 0.16, [[0.2, 0], [0.22, 0.85], [0.18, 0.9]], 10, 0, hb('#3d4a40')); }
  COL.add(...at(0, -0.1), ...at(L, -0.1), 0.05, 0);   // the platform edge (a step)
}
// a short rod down from the roof
function lmRod(G, x, z, y0, y1, col) { box(G, x, z, 1, 0, 0.03, 0.03, y0, y1, col); }

export { AO, lmAutoosta };
