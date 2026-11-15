import { C } from '../core/env.js';
import { dec } from '../core/util.js';
import { TERR, terrainH } from './terrain.js';

/* ---------- Latgales iela in its cutting ----------
   Between its two roundabouts Latgales iela runs about 900 m in a cutting some 7 m deep and passes under four bridges
   (the junction of 2009–2011, src/landmarks/junction.js). The terrain model (a 20 m grid) smooths a cutting that narrow
   to 3–4 m with a wavy floor: under the railway bridges there was 2–3 m between the road and the decks. Here the cutting
   has its own profile along the axis between the two carriageways:
   - never above the ground the model gives along the axis (smoothed over ±40 m), so it meets the roundabouts at their
     own height;
   - under every bridge low enough for 5 m between the road and the underside of the deck (the decks keep the height of
     the ground at their ends);
   - no steeper than 4.5 %, the corners rounded over ±25 m;
   and the grid takes it: the profile within 15 m of the axis, then slopes of 1 : 1.8 up to the ground. On the coarse
   grid the ground beside the road follows only roughly, so the road, its sidewalks, the walkers, vehicles and lamps on
   it take the profile itself (cutY), within 12.5 m of the axis, blending back to the ground by 16 m. */

// the bridges over the cutting (OpenStreetMap man_made=bridge ways 884947046–884947049): ends S and N, half width, kind
const JN = [
  { key: 'pk', S: [-830.1, -1286.9], N: [-798.4, -1360.1], hw: 6.7, kind: 'arch' },
  { key: 'r1', S: [-712.0, -1309.0], N: [-666.5, -1369.2], hw: 11.2, kind: 'rail' },
  { key: 'r2', S: [-594.2, -1312.6], N: [-582.4, -1368.5], hw: 8.6, kind: 'rail' },
  { key: 'fb', S: [-563.6, -1307.7], N: [-552.4, -1362.7], hw: 1.7, kind: 'foot' }
];
for (const J of JN) { const dx = J.N[0] - J.S[0], dz = J.N[1] - J.S[1]; J.L = Math.hypot(dx, dz); J.t = [dx / J.L, dz / J.L]; J.n = [-J.t[1], J.t[0]]; J.thick = J.kind === 'rail' ? 1.25 : J.kind === 'foot' ? 0.8 : 0.95; }
// the steel guard rails (OSM barrier=guard_rail): the one in the median (two ways on the same nodes, so beams on both
// sides) and those along the outer edges of the road; flat x, z
const RAILS = [
  { id: 133296819, both: true, p: [-334.7, -1201.8, -349.8, -1229.2, -361.3, -1245.4, -373.6, -1258.4, -384.4, -1267.6, -398.1, -1276.7, -412.3, -1283.9, -501.1, -1316.1, -532.8, -1326.1, -563.4, -1334.9, -577.4, -1336.9, -599.6, -1340.1, -602.9, -1340.3, -634.4, -1341.8, -647.1, -1341.7, -668, -1340.7, -677, -1339.9, -704.9, -1336.3, -710.9, -1334.9, -722, -1332.2, -917.9, -1302, -955.5, -1296.4, -1000.1, -1287.5, -1037.5, -1277.8, -1069.7, -1267.1] },
  { id: 886209614, p: [-1072.6, -1276.9, -1038.2, -1288.1, -1006.9, -1296.5, -983.2, -1301.8, -936.1, -1310, -794, -1331.6, -706.7, -1345.5, -693.7, -1347.1, -666.4, -1350.2, -662.2, -1350.7, -635.7, -1351.3, -605.4, -1350, -597.2, -1349, -576.1, -1346.5, -567.6, -1345.5, -545.4, -1341, -511.9, -1330.9, -412.3, -1296.2, -398.6, -1290.4, -382, -1279.8, -369.7, -1270.1, -359.3, -1260.2, -353.3, -1254, -343.1, -1239.9, -336.5, -1228.6, -325, -1206.8] },
  { id: 886209615, p: [-344.2, -1197.1, -360.3, -1224.9, -368.7, -1236.3, -377.6, -1246.9, -391.2, -1258.5, -401.7, -1265.8] },
  { id: 886209616, p: [-500.9, -1304.9, -515.2, -1309.7, -523.4, -1312.4, -556.6, -1320.8, -566.7, -1322.8, -578.6, -1324.9, -603.3, -1328.1, -610.3, -1328.7, -640.1, -1329.7, -663, -1329, -683.4, -1326.9, -686.4, -1326.5, -714.8, -1322.5, -726.3, -1320.8, -812.2, -1308.3, -843.1, -1303.3, -938.4, -1288.9, -965.5, -1284.4, -1002.5, -1276.7, -1039.4, -1266.7, -1056.2, -1261.4, -1066.5, -1256.6] },
];
// the retaining walls at the foot of the slopes by the bridges (OSM barrier=retaining_wall), 17–25 m off the axis
const WALLS = [
  { id: 886209617, p: [-871.4, -1332.4, -815.9, -1340.7] },
  { id: 886209618, p: [-748.2, -1352.4, -734.1, -1354.1, -686.3, -1361.6, -655.4, -1363.6, -632.1, -1363.6, -614.6, -1362.8, -595.3, -1360.9, -571.3, -1358.8, -561.8, -1358.5] },
  { id: 886209619, p: [-568.9, -1316, -580, -1317.4, -607, -1321, -650.4, -1322.1, -680.8, -1320.6, -741.6, -1311.2] },
];

const CUT = { ok: false, ax: null, cum: null, h: null, L: 0, bb: null, FLAT: 15, SLOPE: 1 / 1.8, OUT: 40, ROAD: 12.5, BLEND: 16 };
// the nearest point of the axis: s along it, d off it, and the point itself
function cutLocal(x, z) {
  const a = CUT.ax, n = a.length >> 1; let bd = 1e9, bs = 0, bx = x, bz = z;
  for (let i = 0; i < n - 1; i++) { const x1 = a[2 * i], z1 = a[2 * i + 1], dx = a[2 * i + 2] - x1, dz = a[2 * i + 3] - z1, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), d = Math.hypot(x - x1 - dx * t, z - z1 - dz * t);
    if (d < bd) { bd = d; bs = CUT.cum[i] + t * Math.sqrt(l2); bx = x1 + dx * t; bz = z1 + dz * t; } }
  return [bs, bd, bx, bz];
}
/* a point against the retaining walls: null if no wall stands on its side of the axis within 35 m, else the wall's
   distance off the axis there (wd), whether the point lies behind it, and how far past the wall's end it lies (over, 0
   alongside the wall; up to WTAPER = 20 m, over which the wall's level bottom tapers back to the plain cutting). The
   nearest point of the whole wall: past a bend the next stretch takes over, so a point in front of a bend still counts. */
const WTAPER = 20;
function wallSide(x, z, d, ax, az) {
  let best = null, bd = 35;
  for (const W of WALLS) { const p = W.p, n = p.length >> 1; let e = 1e9, bi = 0, bt = 0, raw = 0, wx = 0, wz = 0;
    for (let i = 0; i < n - 1; i++) { const x1 = p[2 * i], z1 = p[2 * i + 1], dx = p[2 * i + 2] - x1, dz = p[2 * i + 3] - z1, l2 = dx * dx + dz * dz || 1e-9, r = ((x - x1) * dx + (z - z1) * dz) / l2, t = Math.max(0, Math.min(1, r));
      const px = x1 + dx * t, pz = z1 + dz * t, ee = Math.hypot(x - px, z - pz); if (ee < e) { e = ee; bi = i; bt = t; raw = r; wx = px; wz = pz; } }
    if (e >= bd || (wx - ax) * (x - ax) + (wz - az) * (z - az) <= 0) continue;   // the wall on the other side of the axis
    const l = Math.hypot(p[2 * bi + 2] - p[2 * bi], p[2 * bi + 3] - p[2 * bi + 1]), over = bi === 0 && raw < 0 ? -raw * l : bi === n - 2 && raw > 1 ? (raw - 1) * l : 0;
    if (over >= WTAPER) continue;
    const wd = W.d[bi] + (W.d[bi + 1] - W.d[bi]) * bt; bd = e; best = { wd, behind: d > wd, over }; }
  return best;
}
const cutH = s => { const k = Math.max(0, Math.min(CUT.h.length - 1.001, s / 5)), i = Math.floor(k), f = k - i; return CUT.h[i] + (CUT.h[Math.min(CUT.h.length - 1, i + 1)] - CUT.h[i]) * f; };   // absolute metres

/* Called by terrainInit on the raw grid (decimetres) before it becomes the height texture. */
function cutCarve(T, q) {
  const nx = T.nx, nz = T.nz, st = T.step, hm = (x, z) => { const gx = Math.max(0, Math.min(nx - 1.001, (x - T.x0) / st)), gz = Math.max(0, Math.min(nz - 1.001, (z - T.z0) / st)), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * nx + i;
    return ((q[k] * (1 - fx) + q[k + 1] * fx) * (1 - fz) + (q[k + nx] * (1 - fx) + q[k + nx + 1] * fx) * fz) * 0.1; };
  // the two carriageways (one-way lines named Latgales iela) and the axis midway between them, every 5 m
  const L2 = C.l.filter(l => l[0] <= 3 && C.names[l[1]] === 'Latgales iela').map(l => dec(l[2])); if (L2.length !== 2) return;
  const [A, B] = L2, near = (p, x, z) => { let bd = 1e9, bx = x, bz = z; for (let i = 0; i < p.length - 2; i += 2) { const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / l2)), px = p[i] + dx * t, pz = p[i + 1] + dz * t, d = Math.hypot(x - px, z - pz); if (d < bd) { bd = d; bx = px; bz = pz; } } return [bx, bz, bd]; };
  const ax = [];
  for (let i = 0; i < A.length - 2; i += 2) { const l = Math.hypot(A[i + 2] - A[i], A[i + 3] - A[i + 1]); for (let s = 0; s < l; s += 5) { const t = s / l, x = A[i] + (A[i + 2] - A[i]) * t, z = A[i + 1] + (A[i + 3] - A[i + 1]) * t, [bx, bz, d] = near(B, x, z); if (d < 30) ax.push((x + bx) / 2, (z + bz) / 2); } }
  // resampled every 5 m along the axis
  const raw = ax, cum0 = [0]; for (let i = 2; i < raw.length; i += 2) cum0.push(cum0[cum0.length - 1] + Math.hypot(raw[i] - raw[i - 2], raw[i + 1] - raw[i - 1]));
  const Ltot = cum0[cum0.length - 1], M = Math.floor(Ltot / 5) + 1, P = [], cum = [];
  for (let k = 0; k < M; k++) { const sv = Math.min(Ltot, k * 5); let i = 0; while (i < cum0.length - 2 && cum0[i + 1] < sv) i++; const t = (sv - cum0[i]) / ((cum0[i + 1] - cum0[i]) || 1); P.push(raw[2 * i] + (raw[2 * i + 2] - raw[2 * i]) * t, raw[2 * i + 1] + (raw[2 * i + 3] - raw[2 * i + 1]) * t); cum.push(sv); }
  CUT.ax = P; CUT.cum = cum; CUT.L = cum[M - 1];
  // the bridge decks keep the height of the ground at their ends, read before the cutting is dug
  for (const J of JN) { J.h0 = hm(J.S[0], J.S[1]); J.h1 = hm(J.N[0], J.N[1]); }
  // upper bounds every 5 m: the smoothed ground along the axis, and under each bridge 5 m of clearance
  const g0 = P.map((_, k) => k % 2 ? 0 : hm(P[k], P[k + 1])).filter((_, k) => k % 2 === 0);
  const med = g0.map((_, k) => { const w = Math.min(8, k, M - 1 - k), a = g0.slice(k - w, k + w + 1).sort((u, v) => u - v); return a[w]; });
  const U = med.map((_, k) => { const w = Math.min(8, k, M - 1 - k); let t = 0; for (let j = -w; j <= w; j++) t += med[k + j]; return t / (2 * w + 1); });
  for (const J of JN) for (let k = 0; k < M; k++) {
    const x = P[2 * k], z = P[2 * k + 1], s = (x - J.S[0]) * J.t[0] + (z - J.S[1]) * J.t[1], v = (x - J.S[0]) * J.n[0] + (z - J.S[1]) * J.n[1];
    if (s < 0 || s > J.L || Math.abs(v) > J.hw + 3) continue;
    U[k] = Math.min(U[k], J.h0 + (J.h1 - J.h0) * s / J.L - J.thick - 5.0);
  }
  // the highest profile under those bounds no steeper than 4.5 %, then its corners rounded, still under the bounds
  const G = 0.045 * 5; let h = U.map((_, k) => { let m = 1e9; for (let j = 0; j < M; j++) m = Math.min(m, U[j] + G * Math.abs(k - j)); return m; });
  h = h.map((_, k) => { const w = Math.min(5, k, M - 1 - k); let t = 0; for (let j = -w; j <= w; j++) t += h[k + j]; return Math.min(U[k], t / (2 * w + 1)); });
  CUT.h = h;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let k = 0; k < M; k++) { x0 = Math.min(x0, P[2 * k]); x1 = Math.max(x1, P[2 * k]); z0 = Math.min(z0, P[2 * k + 1]); z1 = Math.max(z1, P[2 * k + 1]); }
  CUT.bb = [x0 - CUT.OUT, z0 - CUT.OUT, x1 + CUT.OUT, z1 + CUT.OUT];
  /* dig: the profile within 15 m of the axis, slopes up to the ground beyond. Not under the ends of the bridges: within
     22 m of an end the ground keeps its height more than 9 m off the axis (behind the guard rails at the edges of the
     road, which takes the profile itself through cutY), so the abutments and the tracks and the road leading onto a
     deck meet it. Dug there too, the slope reached under the ends on the 20 m grid and left the decks up to 3 m in
     the air. */
  const i0 = Math.max(0, Math.floor((CUT.bb[0] - T.x0) / st)), i1 = Math.min(nx - 1, Math.ceil((CUT.bb[2] - T.x0) / st)), j0 = Math.max(0, Math.floor((CUT.bb[1] - T.z0) / st)), j1 = Math.min(nz - 1, Math.ceil((CUT.bb[3] - T.z0) / st));
  const ENDS = JN.flatMap(J => [J.S, J.N]);
  /* the retaining walls (17–25 m off the axis, the sidewalks at the bottom run just before them): the grid on their
     side is not dug past 15 m, the ground there keeps its height and the wall takes the step. The 20 m grid can't stand a
     wall, so the ground in front of it still rises towards it: a level verge covers that and the sidewalks there take
     the profile (cutY), the wall itself reaches up to the ground behind it (src/landmarks/junction.js). Past each end of
     a wall the level bottom narrows back to 15 m over 20 m, the slope behind it wrapping round the end, so the sidewalks
     there climb out of the cutting instead of stepping up at the end. */
  for (const W of WALLS) { const p = W.p, n = p.length >> 1; W.d = []; for (let i = 0; i < n; i++) W.d.push(cutLocal(p[2 * i], p[2 * i + 1])[1]); }
  CUT.ok = true;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = T.x0 + i * st, z = T.z0 + j * st, [s, d, ax, az] = cutLocal(x, z); if (d > CUT.OUT || s <= 0 || s >= CUT.L) continue;
    if (d > 9 && ENDS.some(e => Math.hypot(x - e[0], z - e[1]) < 22)) continue;
    const ws = d > CUT.FLAT ? wallSide(x, z, d, ax, az) : null; if (ws && !ws.over) continue;
    const flat = ws ? CUT.FLAT + Math.max(0, ws.wd - CUT.FLAT) * (1 - ws.over / WTAPER) : CUT.FLAT;
    const lim = cutH(s) + Math.max(0, d - flat) * CUT.SLOPE, k = j * nx + i; if (q[k] * 0.1 > lim) q[k] = Math.round(lim * 10); }
}
// how far the profile of the cutting is from the ground at a point on its road (negative: lower), 0 off it; in front of
// a retaining wall all the way to the wall, behind it 0; past a wall's end the level bottom narrows back over 20 m
function cutY(x, z) {
  if (!CUT.ok || x < CUT.bb[0] || x > CUT.bb[2] || z < CUT.bb[1] || z > CUT.bb[3]) return 0;
  const [s, d, ax, az] = cutLocal(x, z); if (s <= 0 || s >= CUT.L) return 0;
  let w = 1;
  if (d > CUT.ROAD) { const R = CUT.BLEND - CUT.ROAD, ws = d < 30 ? wallSide(x, z, d, ax, az) : null;
    w = d >= CUT.BLEND ? 0 : (CUT.BLEND - d) / R;
    if (ws && !ws.over) w = ws.behind ? 0 : 1;
    else if (ws) { const bw = CUT.ROAD + Math.max(0, ws.wd - CUT.ROAD) * (1 - ws.over / WTAPER); w = Math.max(w, Math.min(1, (bw + R - d) / R)); }
    if (w <= 0) return 0; }
  return w * (cutH(s) - TERR.ref - terrainH(x, z));
}
// past the ends of a retaining wall: the outer edge of the level bottom (off the axis) at (x, z), or 0 off that taper
function cutBottom(x, z) {
  if (!CUT.ok) return 0; const [s, d, ax, az] = cutLocal(x, z); if (s <= 0 || s >= CUT.L) return 0;
  const ws = wallSide(x, z, Math.max(d, CUT.FLAT + 0.01), ax, az); return ws ? CUT.ROAD + Math.max(0, ws.wd - CUT.ROAD) * (1 - ws.over / WTAPER) : 0;
}
/* for the depth grid of the ground (src/world/ground.js): beside a retaining wall the ground drawn there lies on the
   profile in front of the wall while the grid rises to the ground behind it; there the depth grid keeps under the
   profile (absolute metres), elsewhere Infinity */
function cutFloor(x, z) {
  if (!CUT.ok || x < CUT.bb[0] || x > CUT.bb[2] || z < CUT.bb[1] || z > CUT.bb[3]) return Infinity;
  const [s, d, ax, az] = cutLocal(x, z); if (s <= 0 || s >= CUT.L || d <= CUT.FLAT - 5) return Infinity;
  return wallSide(x, z, d, ax, az) ? cutH(s) : Infinity;
}
const cutComp = (x, y, z) => cutY(x, z);   // GBC for what lies on the road in the cutting
const cutTouches = bb => CUT.ok && bb[2] >= CUT.bb[0] && bb[0] <= CUT.bb[2] && bb[3] >= CUT.bb[1] && bb[1] <= CUT.bb[3];
// the height of a junction bridge's deck at s along it (above the reference, like terrainH)
const jnDeck = (J, s) => { const f = Math.max(0, Math.min(1, s / J.L)); return J.h0 === undefined ? terrainH(J.S[0], J.S[1]) + (terrainH(J.N[0], J.N[1]) - terrainH(J.S[0], J.S[1])) * f : J.h0 + (J.h1 - J.h0) * f - TERR.ref; };

// the height of the profile of the cutting at the axis point nearest (x, z), above the reference like terrainH
function cutProfile(x, z) { return cutH(cutLocal(x, z)[0]) - TERR.ref; }
// the unit vector from (x, z) towards the axis, and the distance to it
function cutInward(x, z) { const [, d, ax, az] = cutLocal(x, z); return d > 1e-6 ? [(ax - x) / d, (az - z) / d, d] : [0, 0, 0]; }

export { CUT, JN, RAILS, WALLS, WTAPER, cutBottom, cutCarve, cutComp, cutFloor, cutInward, cutProfile, cutTouches, cutY, jnDeck };
