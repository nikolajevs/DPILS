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

const CUT = { ok: false, ax: null, cum: null, h: null, L: 0, bb: null, FLAT: 15, SLOPE: 1 / 1.8, OUT: 40, ROAD: 12.5, BLEND: 16 };
// the nearest point of the axis: s along it, d off it
function cutLocal(x, z) {
  const a = CUT.ax, n = a.length >> 1; let bd = 1e9, bs = 0;
  for (let i = 0; i < n - 1; i++) { const x1 = a[2 * i], z1 = a[2 * i + 1], dx = a[2 * i + 2] - x1, dz = a[2 * i + 3] - z1, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), d = Math.hypot(x - x1 - dx * t, z - z1 - dz * t);
    if (d < bd) { bd = d; bs = CUT.cum[i] + t * Math.sqrt(l2); } }
  return [bs, bd];
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
  // dig: the profile within 15 m of the axis, slopes up to the ground beyond
  const i0 = Math.max(0, Math.floor((CUT.bb[0] - T.x0) / st)), i1 = Math.min(nx - 1, Math.ceil((CUT.bb[2] - T.x0) / st)), j0 = Math.max(0, Math.floor((CUT.bb[1] - T.z0) / st)), j1 = Math.min(nz - 1, Math.ceil((CUT.bb[3] - T.z0) / st));
  CUT.ok = true;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = T.x0 + i * st, z = T.z0 + j * st, [s, d] = cutLocal(x, z); if (d > CUT.OUT || s <= 0 || s >= CUT.L) continue;
    const lim = cutH(s) + Math.max(0, d - CUT.FLAT) * CUT.SLOPE, k = j * nx + i; if (q[k] * 0.1 > lim) q[k] = Math.round(lim * 10); }
}
// how far the profile of the cutting is from the ground at a point on its road (negative: lower), 0 off it
function cutY(x, z) {
  if (!CUT.ok || x < CUT.bb[0] || x > CUT.bb[2] || z < CUT.bb[1] || z > CUT.bb[3]) return 0;
  const [s, d] = cutLocal(x, z); if (d >= CUT.BLEND || s <= 0 || s >= CUT.L) return 0;
  const w = d <= CUT.ROAD ? 1 : (CUT.BLEND - d) / (CUT.BLEND - CUT.ROAD);
  return w * (cutH(s) - TERR.ref - terrainH(x, z));
}
const cutComp = (x, y, z) => cutY(x, z);   // GBC for what lies on the road in the cutting
const cutTouches = bb => CUT.ok && bb[2] >= CUT.bb[0] && bb[0] <= CUT.bb[2] && bb[3] >= CUT.bb[1] && bb[1] <= CUT.bb[3];
// the height of a junction bridge's deck at s along it (above the reference, like terrainH)
const jnDeck = (J, s) => { const f = Math.max(0, Math.min(1, s / J.L)); return J.h0 === undefined ? terrainH(J.S[0], J.S[1]) + (terrainH(J.N[0], J.N[1]) - terrainH(J.S[0], J.S[1])) * f : J.h0 + (J.h1 - J.h0) * f - TERR.ref; };

export { CUT, JN, cutCarve, cutComp, cutTouches, cutY, jnDeck };
