import { LMWS } from '../landmarks/tiles.js';
import { lmLathe } from '../landmarks/helpers.js';
import { COL } from '../world/data.js';
import { polyA } from '../core/geometry.js';
import { area2, hash, hb, offsetRing, sh, triangulate } from '../core/util.js';

/* ---- the reduits of the lunettes ----
   Casemated keeps of red brick standing in the dry moats of the outer works (OSM: defensive_works=reduit, named
   "2. reduīte", "5. reduīte", "6. reduīte"; "1. redulīte" is mapped as ruins). From Mapillary photographs (2020, 2024):
   walls of weathered red brick with a row of small loopholes, quoins of pale stone at the corners, a round-arched
   gateway, and earth on the flat vaulted roof, grown over with grass and bushes; of the first only broken walls and a
   brick vault are left. Outlines from citydata.js (OSM), the heights of the walls and of the earth on them from the LGIA
   lidar (src/buildings/lidar.js); the gateway is put in the longest straight wall, the gorge. */
const FORT_RED = [
  { key: 'r2', H: 5.3, top: 6.7, r: [-3119.4, -754.9, -3117.4, -751.9, -3108.9, -739.4, -3092.7, -750.5, -3099, -759.8, -3103.2, -765.9, -3092.3, -773.4, -3094.7, -775.9, -3097.3, -777.5, -3100.3, -778.4, -3103.6, -778.5, -3107.2, -777.9, -3111.4, -776.5, -3115.7, -774.3, -3120.5, -771.3, -3125.2, -767.8, -3128.9, -764.5, -3131.7, -761.2, -3133.5, -758.1, -3134.5, -755.1, -3134.6, -752.1, -3133.7, -749.2, -3131.9, -746.3] },
  { key: 'r5', H: 5.7, top: 6.9, r: [-2306.1, -278.9, -2306.4, -259.5, -2291, -258.3, -2292.2, -243.8, -2285.3, -245, -2279.4, -251.4, -2274.6, -259.5, -2273.4, -273.7, -2274.2, -283.1, -2278.7, -289.5, -2285.1, -294.5, -2290.5, -295.7, -2291, -278.6] },
  { key: 'r6', H: 5.9, top: 7.4, r: [-2474.7, -24.8, -2468, -12.5, -2481.5, -4.1, -2477.5, 1.5, -2463.2, 4.6, -2448.8, -1.3, -2437.7, -8.9, -2433.3, -16.5, -2434.9, -26, -2445.3, -19.2, -2454.8, -34.8] },
  { key: 'r1', H: 3.2, ruin: 1, r: [-3255.2, -446.9, -3258.5, -468.7, -3266.4, -468.7, -3274.3, -478.6, -3281.9, -475.1, -3283.2, -465.9, -3281.1, -451.7, -3276.8, -440.3, -3271, -434.5, -3263.1, -437, -3262.6, -445.1] }
].map(B => {
  const r = area2(B.r) < 0 ? reverseRing(B.r) : B.r.slice(), outline = [];   // outer rings run with a positive area
  for (let i = 0; i < r.length; i += 2) outline.push([r[i], r[i + 1]]);
  return Object.assign(B, { r, f: [0, 0, 1, 0], outline, wings: [] });       // f and outline: a hull for fortBldHulls
});
// the broken top of a ruined wall at a distance t along it: smooth noise, now and then a breach
function fortRuinH(H, t) {
  const n = (u, s) => { const i = Math.floor(u), f = u - i, w = f * f * (3 - 2 * f); return hash(i * 53 + s) * (1 - w) + hash((i + 1) * 53 + s) * w; };
  const v = 0.55 * n(t / 4.5, 7) + 0.3 * n(t / 1.6, 19) + 0.15 * n(t / 0.7, 31);
  return H * Math.max(0.15, 0.25 + 0.85 * v - (n(t / 9, 43) > 0.82 ? 0.45 : 0));
}
function reverseRing(r) { const o = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; }
const RED_BRK = [222, 182, 166], RED_STONE = [212, 206, 194], RED_TURF = hb('#4e6a32'), RED_DARK = hb('#1e1d1c');

function fortReduit(K, B) {
  const r = B.r, n = r.length >> 1, S = LMWS[3], H = B.H;
  // the gorge: the longest wall
  let gi = 0, gl = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(r[2 * j] - r[2 * i], r[2 * j + 1] - r[2 * i + 1]); if (l > gl) { gl = l; gi = i; } }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x1 = r[2 * i], z1 = r[2 * i + 1], x2 = r[2 * j], z2 = r[2 * j + 1], L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.2) continue;
    const tx = (x2 - x1) / L, tz = (z2 - z1) / L, nx = tz, nz = -tx, N = [nx, 0, nz];                       // (nx, nz) points out
    const P = (t, y, d = 0) => [x1 + tx * t + nx * d, y, z1 + tz * t + nz * d];
    // the wall in pieces; a ruin's pieces stop at broken heights
    const m = Math.max(1, Math.ceil(L / (B.ruin ? 1.4 : 6)));
    for (let k = 0; k < m; k++) {
      const a = L * k / m, b = L * (k + 1) / m, ya = B.ruin ? fortRuinH(H, acc + a) : H, yb = B.ruin ? fortRuinH(H, acc + b) : H;
      K.brk.q(P(a, -0.4), P(b, -0.4), P(b, yb), P(a, ya), N, [(acc + a) / S, -0.4 / S, (acc + b) / S, -0.4 / S, (acc + b) / S, yb / S, (acc + a) / S, ya / S], sh(RED_BRK, 0.92 + 0.12 * hash(i * 31 + k)));
      if (B.ruin) {   // the broken top and the inner face
        K.brk.q(P(a, ya, 0), P(b, yb, 0), P(b, yb, -0.9), P(a, ya, -0.9), [0, 1, 0], [0, 0, (b - a) / S, 0, (b - a) / S, 0.9 / S, 0, 0.9 / S], sh(RED_BRK, 0.8));
        K.brk.q(P(a, -0.4, -0.9), P(b, -0.4, -0.9), P(b, yb, -0.9), P(a, ya, -0.9), [-nx, 0, -nz], [(acc + a) / S, 0, (acc + b) / S, 0, (acc + b) / S, yb / S, (acc + a) / S, ya / S], sh(RED_BRK, 0.75));
      }
    }
    // the gateway in the gorge, loopholes elsewhere (and beside the gateway)
    const gate = i === gi && !B.ruin ? L / 2 : -99;
    if (gate > 0) {
      const w = 1.6, ys = 2.3, seg = 12, C = P(gate, ys, 0.02);
      polyA(K.cap, [P(gate - w, 0, 0.02), P(gate + w, 0, 0.02), P(gate + w, ys, 0.02), P(gate - w, ys, 0.02)], RED_DARK, nx, 0, nz);   // the dark opening
      for (let k = 0; k < seg; k++) { const t0 = Math.PI * k / seg, t1 = Math.PI * (k + 1) / seg;
        polyA(K.cap, [C, P(gate - w * Math.cos(t0), ys + w * Math.sin(t0), 0.02), P(gate - w * Math.cos(t1), ys + w * Math.sin(t1), 0.02)], RED_DARK, nx, 0, nz); }
      for (let k = 0; k < seg; k++) {                                                                  // the brick arch ring
        const t0 = Math.PI * k / seg, t1 = Math.PI * (k + 1) / seg, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        K.brk.q(P(gate - w * c0, ys + w * s0, 0.06), P(gate - w * c1, ys + w * s1, 0.06), P(gate - (w + 0.45) * c1, ys + (w + 0.45) * s1, 0.06), P(gate - (w + 0.45) * c0, ys + (w + 0.45) * s0, 0.06), N, [0, 0, 0.2, 0, 0.2, 0.2, 0, 0.2], sh(RED_BRK, 1.12));
      }
    }
    if (!B.ruin) for (let t = 1.6; t < L - 1.4; t += 2.1) {
      if (gate > 0 && Math.abs(t - gate) < 2.6) continue;
      polyA(K.cap, [P(t - 0.17, 1.75, 0.02), P(t + 0.17, 1.75, 0.02), P(t + 0.17, 2.3, 0.02), P(t - 0.17, 2.3, 0.02)], RED_DARK, nx, 0, nz);
    }
    // pale stone quoins where the wall turns
    const pi = (i - 1 + n) % n, px = x1 - r[2 * pi], pz = z1 - r[2 * pi + 1], pl = Math.hypot(px, pz) || 1;
    if (Math.abs(px / pl * tz - pz / pl * tx) > 0.35 && L > 2) {
      const top = B.ruin ? H * 0.5 : H;
      for (let y = 0, k = 0; y < top - 0.3; y += 0.5, k++) { const w = k % 2 ? 0.45 : 0.8; K.ren.q(P(0, y + 0.03, 0.05), P(w, y + 0.03, 0.05), P(w, y + 0.47, 0.05), P(0, y + 0.47, 0.05), N, [0, 0, 0.3, 0, 0.3, 0.2, 0, 0.2], RED_STONE); }
    }
    COL.add(x1 + nx * 0.15, z1 + nz * 0.15, x2 + nx * 0.15, z2 + nz * 0.15, 0.2, 0);
    acc += L;
  }
  if (B.ruin) return;
  // the earth on the roof: turf from the top of the walls up to a flat crown, and bushes on it
  const inner = offsetRing(r, -1.3), { tris } = triangulate([Array.from(inner)]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    polyA(K.cap, [[r[2 * i], H, r[2 * i + 1]], [r[2 * j], H, r[2 * j + 1]], [inner[2 * j], B.top, inner[2 * j + 1]], [inner[2 * i], B.top, inner[2 * i + 1]]], sh(RED_TURF, 1.05), 0, 1, 0);
  }
  for (let k = 0; k < tris.length; k += 3) polyA(K.cap, [tris[k], tris[k + 1], tris[k + 2]].map(q => [inner[2 * q], B.top, inner[2 * q + 1]]), RED_TURF, 0, 1, 0);
  for (let k = 0; k < 14; k++) {   // bushes on the earth, at random points of the crown's triangles
    const t = 3 * Math.floor(hash(k * 7 + B.r.length) * tris.length / 3), a = hash(k * 11 + 3), b = hash(k * 13 + 5), [p, q] = a + b > 1 ? [1 - a, 1 - b] : [a, b];
    const I = tris[t], J = tris[t + 1], L = tris[t + 2], x = inner[2 * I] + (inner[2 * J] - inner[2 * I]) * p + (inner[2 * L] - inner[2 * I]) * q, z = inner[2 * I + 1] + (inner[2 * J + 1] - inner[2 * I + 1]) * p + (inner[2 * L + 1] - inner[2 * I + 1]) * q, sc = 0.6 + 1.0 * hash(k * 5 + 1);
    lmLathe(K.cap, x, z, B.top - 0.1, [[0, 0], [0.9 * sc, 0.2 * sc], [1.15 * sc, 0.75 * sc], [0.85 * sc, 1.35 * sc], [0, 1.6 * sc]], 8, hb(k % 2 ? '#4d6b30' : '#5a7a36'));
  }
}
function fortReduits(K) { for (const B of FORT_RED) fortReduit(K, B); }

export { FORT_RED, fortReduits };
