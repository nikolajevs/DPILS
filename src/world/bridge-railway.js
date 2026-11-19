import { pip } from '../core/util.js';

/* ---------- Dzelzceļa tilts (the railway bridge) over the Daugava ----------
   The single-track line from the station towards the south-west crosses the river west of the fortress (Kerbedz,
   1858–62, three trusses; rebuilt 1949). OSM way 22376541: a 282 m bridge from (-2768, 484) to (-2548, 308).
   Frame: s from the south-west end along the axis, d across it (positive to the right of the way, towards the south-east).

   Measured (LGIA lidar tile 2443-52-12, 2017; OSM ways 9012384xx–9012385xx traced by one mapper; Mapillary 2016–2025):
   - the bridge is level: the rails at 100.4–100.5 m above sea level at both ends, the embankments 100.3 m;
   - three through trusses of 12.5 m from the rails to the top of the top chord, the planes of the trusses 6.2 m apart;
     bearings at s = 15.0 (the pier by Lielā iela), 92.7, 182.0 (the river piers) and 280.6 (the north-east abutment):
     spans of 77.7, 89.3 and 98.6 m in panels of about 11 m (7, 8, 9). In each panel the two diagonals cross at
     mid-height, so with the verticals they draw the rhombi seen on photographs; parallel chords, portals at the ends;
   - at the south-west end a steel girder span of 14 m over Lielā iela: the road 6.7 m under the rails, 4.8 m clear under
     the girders (the sign on the beam, OSM maxheight=4.8); the girders rest on an abutment of large rough blocks at s = 0
     (OSM retaining wall 901238504: d −10.4 … 3.9, a wing back to s = −5.6 at d = −10.4) and on the pier at s = 13.3 … 17.4
     (OSM pier 901238501: d −12.5 … 3.9) that carries the first truss too. A red and white sentry booth stands on the
     embankment behind the abutment (OSM building 837632387);
   - the river piers are ashlar with pointed cutwaters, 4.3 m thick and 19 m long, set towards the north-west side of the
     axis (OSM 901238496, 901238500): the bridge of 1862 carried a road beside the track;
   - at the north-east end the last truss rests on a U-shaped abutment (OSM retaining wall 901238515: the front at
     s = 282, d −10.6 … 2.2, wings back to s ≈ 293) at the head of the embankment, with a booth beside the track behind it
     (OSM building 837632388). No road passes under this end. */
const RB = (() => {
  const A = [-2768, 484], B = [-2548, 308], L = Math.hypot(B[0] - A[0], B[1] - A[1]), T = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
  return {
    A, B, L, T, N: [-T[1], T[0]],
    BEAR: [15.0, 92.7, 182.0, 280.6], PANELS: [7, 8, 9], TH: 12.5, TW: 3.1,   // bearings, panels per span, truss height, half the distance between the trusses
    GIRDER: [0.2, 14.2], DROP: 6.7, CLEAR: 4.8,                              // the girder span; the road under it below the rails, the clearance
    ABUT_SW: { s: 1.0, keep: 0.3, d0: -10.4, d1: 3.9, wing: -5.6 },   // the face 1 m before the OSM line: the 1 m patch keeps the embankment behind s = 0.3 and so shows no wedge of earth before it
    PIER_SW: { s0: 13.3, s1: 17.4, d0: -12.5, d1: 3.9 },
    PIERS: [{ s: 92.95, hs: 2.15, d0: -13.1, d1: 5.8 }, { s: 182.5, hs: 2.1, d0: -12.3, d1: 6.6 }],
    ABUT_NE: { s: 279.6, back: 282, d0: -10.6, d1: 2.2, wingL: 293.6, wingR: 292.6, d1w: 3.3 },
    BOOTHS: [{ s: -2.5, d: -7.15, ls: 2.2, ld: 2.1 }, { s: 297.25, d: -11.0, ls: 2.7, ld: 5.8 }],
    H: null   // the height of the rails over the reference: lmRailBridge and the patches (src/world/underpass-rail.js) read it
  };
})();
const rbLocal = (x, z) => { const dx = x - RB.A[0], dz = z - RB.A[1]; return [dx * RB.T[0] + dz * RB.T[1], dx * RB.N[0] + dz * RB.N[1]]; };
const rbWorld = (s, d) => [RB.A[0] + RB.T[0] * s + RB.N[0] * d, RB.A[1] + RB.T[1] * s + RB.N[1] * d];
// a line of the city data lying on the bridge axis (the rails and the walkers' line): lmRailBridge draws the structure
function rbOnLine(pts) { for (let i = 0; i < pts.length; i += 2) { const [s, d] = rbLocal(pts[i], pts[i + 1]); if (s < -1 || s > RB.L + 1 || Math.abs(d) > 2) return false; } return true; }
// the two sentry booths are drawn by lmRailBridge, not as generic buildings
function rbDrops(ring, bb) {
  for (const b of RB.BOOTHS) { const [x, z] = rbWorld(b.s, b.d); if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(x, z, ring)) return true; }
  return false;
}

export { RB, rbDrops, rbLocal, rbOnLine, rbWorld };
