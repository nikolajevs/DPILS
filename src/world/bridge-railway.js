/* ---------- Dzelzceļa tilts (the railway bridge) over the Daugava ----------
   The single-track line from the station towards the south-west crosses the river west of the fortress on a steel
   through-truss bridge (Structurae: "Daugavpils rail bridge", through truss, 55.8789 N 26.4976 E). OSM way: a 282 m
   bridge segment from (-2768, 484) to (-2548, 308) plus a 28 m beam span over the flood plain further on. Photographs
   (Mapillary, the road under the south-west abutment): light grey riveted trusses with a Warren web and verticals,
   a footway with a railing along the outside of the trusses, the first span over a service road on a concrete beam
   between abutments of rough ashlar. Span lengths and the pier positions are not documented: estimated from the
   outline. Frame: s from the south-west end along the axis, d across it (positive to the right of the way). */
const RB = (() => { const A = [-2768, 484], B = [-2548, 308], L = Math.hypot(B[0] - A[0], B[1] - A[1]), T = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
  return { A, B, L, T, N: [-T[1], T[0]] }; })();
const rbLocal = (x, z) => { const dx = x - RB.A[0], dz = z - RB.A[1]; return [dx * RB.T[0] + dz * RB.T[1], dx * RB.N[0] + dz * RB.N[1]]; };
// a line of the city data lying on the bridge axis (the rails and the walkers' line): lmRailBridge draws the structure
function rbOnLine(pts) { for (let i = 0; i < pts.length; i += 2) { const [s, d] = rbLocal(pts[i], pts[i + 1]); if (s < -1 || s > RB.L + 1 || Math.abs(d) > 2) return false; } return true; }

export { RB, rbLocal, rbOnLine };
