import { C } from '../core/env.js';
import { dec } from '../core/util.js';
import { RB, rbLocal, rbOnLine } from './bridge-railway.js';
import { terrainH, waterLevel } from './terrain.js';   // a cycle: used at run time only

/* ---------- the ground at both ends of the railway bridge ----------
   The bridge is level (src/world/bridge-railway.js). The terrain model (20 m grid) put its south-west end at 3.9 m, its
   north-east end at 0.1 m: the embankment there is too narrow for the grid. The deck takes the height of the south-west
   end (RB.H: the rails at both ends; that end of the embankment the grid does draw), and two fine patches of the terrain
   (src/world/terrain.js) shape the ground at the ends:

   - Lielā iela under the south-west end (OSM: a way that crosses the axis near s = 7 m, almost at a right angle). The
     road lies 6.7 m under the rails, 4.8 m clear under the girders, as the sign on the beam says. Away from the bridge it
     climbs at 7 % (the knee rounded over 12 m) until it meets the ground the model gives along the road, so the cutting
     dies out by itself some 80 m off. Across it the road level holds for 4.2 m each side of the axis of the way
     (carriageway of 6.4 m and shoulders), then the ground rises 1 : 1.5 to the terrain; between the abutment and the
     pier, under the girders, only 1 : 4 (grass verges up to the walls). Behind the abutment (s < 0, d −10.4 … 3.9) the
     embankment keeps its height; past the ends of the abutment it runs down to the road 1 : 1.5.
   - The embankment at the north-east end: the rails leave the bridge at RB.H, hold it past the wings of the abutment
     and fall at 4 % (the knee rounded over 15 m) to the profile the model gives them, before the bridge over Daugavas
     iela 117 m on. A crest of 3.2 m each side of the track, the fill between the wings of the abutment (s 282 … 293.6,
     d −10.6 … 3.3) and the platform beside the track behind it where the booth stands (OSM embankment 1165130417:
     d down to −18 for s 293.6 … 326) are raised to that profile, with slopes of 1 : 1.5 down to the ground. In front of
     the face of the abutment the bank falls to the river 1 : 1.1 (12 m from the rails to the water in the lidar; the
     model had a gentle bank there, 4 m under the rails, with a wall of earth at the water). This patch has a step of 0.5 m, so the fill keeps behind the back wall and still lifts the end of the rails
     (a node of the grid) exactly to RB.H. */
const RP = { ok: false };
const SW = { HALF: 4.2, SLOPE: 1.5, UNDER: 4, GRADE: 0.07, KNEE: 12, FLAT: 12, RMAX: 100, EMB: 0.3 };
const NE = { BANK: [250, -17, 14], FALL: 1.1, W: 3.2, SLOPE: 1.5, T0: 14, GRADE: 0.04, KNEE: 15, LEN: 117, PLAT: [293.6, 326, -18, 0], FILL: [281.5, 293.6, -10.6, 3.3], STEP: 0.5 };
const knee = (u, k) => u <= 0 ? 0 : u < k ? u * u / (2 * k) : u - k / 2;
// distance from (s, d) to a rectangle [s0, s1] × [d0, d1] of the bridge frame
const rectDist = (s, d, [s0, s1, d0, d1]) => Math.hypot(Math.max(0, s0 - s, s - s1), Math.max(0, d0 - d, d - d1));

/* Called by terrainInit once the grid is final: the patches (none, one or two). */
function rbPatches() {
  RB.H = terrainH(RB.A[0], RB.A[1]);
  const out = [], a = swPatch(), b = nePatch();
  if (a) out.push(a); if (b) out.push(b);
  RP.ok = true;
  return out;
}

// the south-west end: Lielā iela under the girder span
function swPatch() {
  // the road: a way of class 0 that crosses the axis of the bridge under the girders
  let name = -1, cx = 0, cz = 0;
  for (const l of C.l) { if (l[0] !== 0 || l[3]) continue; const p = dec(l[2]), n = p.length >> 1;
    for (let i = 0; i < n - 1; i++) { const [s1, d1] = rbLocal(p[2 * i], p[2 * i + 1]), [s2, d2] = rbLocal(p[2 * i + 2], p[2 * i + 3]);
      if (Math.sign(d1) === Math.sign(d2) || d1 === d2) continue; const t = d1 / (d1 - d2), s = s1 + (s2 - s1) * t;
      if (s > RB.GIRDER[0] && s < RB.GIRDER[1]) { name = l[1]; cx = p[2 * i] + (p[2 * i + 2] - p[2 * i]) * t; cz = p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * t; } } }
  if (name < 0) return null;
  // the segments of that road (and of the ways that continue it) within reach of the crossing
  const seg = [];
  for (const l of C.l) { if (l[0] !== 0 || l[1] !== name || l[3]) continue; const p = dec(l[2]), n = p.length >> 1;
    for (let i = 0; i < n - 1; i++) { const x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * i + 2], z2 = p[2 * i + 3];
      if (Math.min(Math.hypot(x1 - cx, z1 - cz), Math.hypot(x2 - cx, z2 - cz), Math.hypot((x1 + x2) / 2 - cx, (z1 + z2) / 2 - cz)) < SW.RMAX + 40) seg.push(x1, z1, x2, z2); } }
  // the nearest point of the road: its distance, the point
  const near = (x, z) => { let bd = 1e9, bx = 0, bz = 0;
    for (let i = 0; i < seg.length; i += 4) { const x1 = seg[i], z1 = seg[i + 1], dx = seg[i + 2] - x1, dz = seg[i + 3] - z1, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; bx = px; bz = pz; } }
    return [bd, bx, bz]; };
  const Rb = RB.H - RB.DROP, Ab = RB.ABUT_SW, Pi = RB.PIER_SW, Hemb = RB.H - SW.EMB;
  // the box: the road within RMAX of the crossing, and the slopes beside it
  let x0 = cx, x1 = cx, z0 = cz, z1 = cz; for (let i = 0; i < seg.length; i += 2) { if (Math.hypot(seg[i] - cx, seg[i + 1] - cz) > SW.RMAX + 20) continue; x0 = Math.min(x0, seg[i]); x1 = Math.max(x1, seg[i]); z0 = Math.min(z0, seg[i + 1]); z1 = Math.max(z1, seg[i + 1]); }
  x0 = Math.floor(Math.max(x0, cx - SW.RMAX) - 20); z0 = Math.floor(Math.max(z0, cz - SW.RMAX) - 20); x1 = Math.ceil(Math.min(x1, cx + SW.RMAX) + 20); z1 = Math.ceil(Math.min(z1, cz + SW.RMAX) + 20);
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1, d = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i, z = z0 + j, [s, db] = rbLocal(x, z);
    if (s < Ab.keep && db >= Ab.d0 + 0.7 && db <= Ab.d1 - 0.7) continue;   // behind the abutment and its wing: the embankment as it is
    const [dist, px, pz] = near(x, z), r = Math.hypot(px - cx, pz - cz), H = terrainH(x, z), Hc = terrainH(px, pz);
    const rl = Math.min(Hc, Rb + SW.GRADE * knee(r - SW.FLAT, SW.KNEE));   // the level of the road at the nearest point
    const under = s >= Ab.keep && s <= Pi.s0 && db >= Pi.d0 && db <= Ab.d1;   // between the abutment and the pier
    let t = Math.min(H, rl + Math.max(0, dist - SW.HALF) / (under ? SW.UNDER : SW.SLOPE));
    // past the ends of the abutment the embankment runs down to the road (round the end of the front wall on the
    // south-east side; along the open side beyond the wing on the north-west)
    const e1 = Ab.d1 - 0.7, de = db > e1 ? Math.hypot(db - e1, Math.max(0, s - Ab.keep)) : db < Ab.d0 && s < Ab.wing ? Ab.d0 - db : 1e9;
    if (de < 1e8) t = Math.max(t, Math.min(H, Hemb - de / SW.SLOPE));
    d[j * nx + i] = Math.min(0, t - H);
  }
  RP.sw = { level: Rb, cross: [cx, cz] };
  return { x0, z0, s: 1, nx, nz, d };
}

// the north-east end: the embankment at the head of the bridge
function nePatch() {
  // the track that leaves the bridge at its north-east end
  let line = null;
  for (const l of C.l) { if (l[0] !== 8 || l[3]) continue; const p = dec(l[2]), n = p.length >> 1; if (rbOnLine(p)) continue;
    if (Math.hypot(p[0] - RB.B[0], p[1] - RB.B[1]) < 1.5) line = Array.from(p);
    else if (Math.hypot(p[2 * n - 2] - RB.B[0], p[2 * n - 1] - RB.B[1]) < 1.5) { line = []; for (let i = n - 1; i >= 0; i--) line.push(p[2 * i], p[2 * i + 1]); } }
  if (!line) return null;
  const n = line.length >> 1, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(line[2 * i] - line[2 * i - 2], line[2 * i + 1] - line[2 * i - 1]));
  const LEN = Math.min(NE.LEN, cum[n - 1]);
  const at = t => { let i = 0; while (i < n - 2 && cum[i + 1] < t) i++; const f = Math.max(0, Math.min(1, (t - cum[i]) / (cum[i + 1] - cum[i]))); return [line[2 * i] + (line[2 * i + 2] - line[2 * i]) * f, line[2 * i + 1] + (line[2 * i + 3] - line[2 * i + 1]) * f]; };
  // the profile of the rails: level at RB.H past the abutment, then down to the profile of the model
  const M = Math.ceil(LEN), R = new Float32Array(M + 1);
  for (let k = 0; k <= M; k++) { const [x, z] = at(Math.min(k, LEN)); R[k] = Math.max(terrainH(x, z), RB.H - NE.GRADE * knee(k - NE.T0, NE.KNEE)); }
  const Rt = t => { const k = Math.max(0, Math.min(M - 0.001, t)), i = Math.floor(k), f = k - i; return R[i] + (R[i + 1] - R[i]) * f; };
  // the nearest point of the track within LEN: distance, t along it
  const near = (x, z) => { let bd = 1e9, bt = 0;
    for (let i = 0; i < n - 1 && cum[i] < LEN; i++) { const x1 = line[2 * i], z1 = line[2 * i + 1], dx = line[2 * i + 2] - x1, dz = line[2 * i + 3] - z1, l2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), dd = Math.hypot(x - x1 - dx * u, z - z1 - dz * u);
      if (dd < bd) { bd = dd; bt = Math.min(LEN, cum[i] + u * Math.sqrt(l2)); } }
    return [bd, bt]; };
  // the box: the track to LEN, the fill and the platform, the slopes round them
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (let t = 0; t <= LEN; t += 2) grow(...at(t));
  const FRONT = [NE.BANK[0], RB.ABUT_NE.s, NE.BANK[1], NE.BANK[2]];
  for (const [s0, s1, d0, d1] of [NE.FILL, NE.PLAT, FRONT]) for (const s of [s0, s1]) for (const dd of [d0, d1]) grow(RB.A[0] + RB.T[0] * s + RB.N[0] * dd, RB.A[1] + RB.T[1] * s + RB.N[1] * dd);
  const M2 = 14, St = NE.STEP; x0 = Math.floor(x0 - M2); z0 = Math.floor(z0 - M2); x1 = Math.ceil(x1 + M2); z1 = Math.ceil(z1 + M2);
  const nx = Math.round((x1 - x0) / St) + 1, nz = Math.round((z1 - z0) / St) + 1, d = new Float32Array(nx * nz), Ab = RB.ABUT_NE;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * St, z = z0 + j * St, [s, db] = rbLocal(x, z);
    const H = terrainH(x, z), wall = db >= Ab.d0 && db <= Ab.d1w;
    // in front of the face of the abutment the bank falls to the river 1 : 1.1 from under its seat, to 0.7 m over the
    // water, and rises 1 : 1.5 to the ground beside it (the model had a gentle bank there and the abutment stood in it)
    if (s < Ab.s && s > FRONT[0] - 20) {
      const lvl = Math.max(waterLevel(x, z) + 0.7, RB.H - 2.8 - (Ab.s - s) * NE.FALL), side = Math.max(0, FRONT[2] - db, db - FRONT[3]);
      const c = Math.min(0, lvl + side / NE.SLOPE + Math.max(0, FRONT[0] - s) / NE.SLOPE - H);
      if (c < 0 || wall) { d[j * nx + i] = c; continue; }
    }
    if (s < NE.FILL[0] && wall) continue;   // the seat and the back wall (s = 280.8): the fill starts 0.7 m behind it, the 0.5 m grid shows no earth before it
    const [dist, t] = near(x, z);
    const e = Math.min(Math.max(0, dist - NE.W), rectDist(s, db, NE.FILL), rectDist(s, db, NE.PLAT));
    const top = Rt(s >= NE.FILL[0] && Math.abs(db) < 30 ? Math.min(t, Math.max(0, s - RB.L)) : t);   // the fill and the platform by their s, the track by its own
    d[j * nx + i] = Math.max(0, top - e / NE.SLOPE - H);
  }
  RP.ne = { line, len: LEN };
  return { x0, z0, s: St, nx, nz, d };
}

export { RP, rbPatches };
