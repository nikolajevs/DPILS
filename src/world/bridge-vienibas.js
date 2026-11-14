/* ---------- Vienības tilts (Unity Bridge) over the Daugava ----------
   Built 1931–35 by a German firm, the first steel bridge of its kind in the Baltics; blown up in 1941 and 1944, rebuilt,
   reconstructed in 1989 (lv.wikipedia). 328 m on three stone piers, four spans of about 82 m; OSM outline (way
   901241407: man_made=bridge, cantilever, beam) 326 × 14.5 m. On the photographs (Wikimedia Commons, category "Vienības
   Bridge"): continuous light grey steel plate girders with longitudinal and vertical stiffeners and bolted splices,
   a concrete cornice with panel joints, a railing of vertical bars, tall lamp posts with an openwork ornament, piers of
   rough granite ashlar with pointed cutwaters, concrete abutments with paved slopes. The city is flat and the river lies
   only 1.7 m below it, so the deck rises in a crest curve to 6 m over the middle, the approaches on the banks become
   paved embankments, and one walks and drives on the deck at its height. Frame: s from the Grīva end along the axis,
   d across it (positive upstream, to the east). */
const VB = (() => { const A = [-1799.1, 2015.6], B = [-1685.05, 1710.45], L = Math.hypot(B[0] - A[0], B[1] - A[1]), T = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
  return { A, L, T, N: [-T[1], T[0]], H: 6.0, HW: 7.25, SW: [38, 288], PIERS: [L / 4, L / 2, 3 * L / 4] }; })();
const vbY = s => s <= 0 || s >= VB.L ? 0 : VB.H * (1 - (2 * s / VB.L - 1) ** 2);
const vbLocal = (x, z) => { const dx = x - VB.A[0], dz = z - VB.A[1]; return [dx * VB.T[0] + dz * VB.T[1], dx * VB.N[0] + dz * VB.N[1]]; };
const vbP = (s, d, y) => [VB.A[0] + VB.T[0] * s + VB.N[0] * d, y, VB.A[1] + VB.T[1] * s + VB.N[1] * d];
// the height to stand on (0 off the bridge), the sidewalks 0.18 m up
function vbGround(x, z) { const [s, d] = vbLocal(x, z); if (s < 0 || s > VB.L || Math.abs(d) > VB.HW) return 0; return vbY(s) + (Math.abs(d) > 5.3 ? 0.18 : 0); }
// a line drawn by lmVienibas instead of buildLines: every point on the deck
function vbOnLine(pts) { for (let i = 0; i < pts.length; i += 2) { const [s, d] = vbLocal(pts[i], pts[i + 1]); if (s < -1 || s > VB.L + 1 || Math.abs(d) > 8) return false; } return true; }
const vbEmb = s => Math.max(0, vbY(s) - 0.8) * 1.5;   // how far an embankment slope reaches beyond the deck edge
function vbNoTree(x, z) { const [s, d] = vbLocal(x, z); return s > -3 && s < VB.L + 3 && Math.abs(d) < VB.HW + vbEmb(Math.max(0, Math.min(VB.L, s))) + 3; }

export { VB, vbEmb, vbGround, vbLocal, vbNoTree, vbOnLine, vbP, vbY };
