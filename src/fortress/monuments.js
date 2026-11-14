import { fortP, fortTBox } from './gates.js';
import { FTS } from './textures.js';
import { FT } from './index.js';
import { lmBar, lmBoxL, lmLathe } from '../landmarks/helpers.js';
import { lmW } from '../landmarks/core.js';
import { BLD } from '../world/data.js';
import { polyA } from '../core/geometry.js';
import { hash, hb, sh } from '../core/util.js';

/* ---- monuments of the fortress ----
   The fountain in the fortress garden: four cast-iron barrels standing on their square breeches and leaning
   together, on a granite block with the name ДИНАБУРГЪ and lions' heads, on a stepped base in a round basin with a
   curb of rounded granite blocks (photographs: Wikimedia Commons, "Fountain in Daugavpils Fortress Garden"). The
   historic guns mapped in OSM stand on garrison carriages; the one named Mortīra is a mortar on its bed. */
const FORT_FOUNTAIN = [-2815.6, -442.5];
// a lathe around any axis: prof is [radius, distance along the axis]
function fortLatheAx(G, O, D, prof, seg, col) {
  const up = Math.abs(D[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let A = cr(D, up); const la = Math.hypot(...A); A = A.map(v => v / la); const B = cr(D, A);
  for (let k = 0; k < prof.length - 1; k++) {
    const [r0, h0] = prof[k], [r1, h1] = prof[k + 1], dr = r1 - r0, dh = h1 - h0, l = Math.hypot(dr, dh) || 1, nr = dh / l, nd = -dr / l;
    for (let s = 0; s < seg; s++) {
      const vs = [];
      for (const [t, r, hh] of [[s, r0, h0], [s + 1, r0, h0], [s + 1, r1, h1], [s, r1, h1]]) {
        const a = t * 2 * Math.PI / seg, c = Math.cos(a), sn = Math.sin(a), rd = [A[0] * c + B[0] * sn, A[1] * c + B[1] * sn, A[2] * c + B[2] * sn];
        vs.push(G.vert(O[0] + D[0] * hh + rd[0] * r, O[1] + D[1] * hh + rd[1] * r, O[2] + D[2] * hh + rd[2] * r, nr * rd[0] + nd * D[0], nr * rd[1] + nd * D[1], nr * rd[2] + nd * D[2], col));
      }
      G.tri(vs[0], vs[1], vs[2]); G.tri(vs[0], vs[2], vs[3]);
    }
  }
}
function fortFountain(K) {
  const [cx, cz] = FORT_FOUNTAIN, f = [cx, cz, 1, 0], GR = [146, 142, 136], IRON = hb('#2b2d30'), P = (u, v, y) => fortP(f, u, v, y);
  // basin: a ring of rounded granite blocks and a floor of dark stone
  const N = 22, R0 = 3.0, R1 = 3.6;
  for (let k = 0; k < N; k++) {
    const a0 = k / N * 2 * Math.PI + 0.01, a1 = (k + 1) / N * 2 * Math.PI - 0.01, am = (a0 + a1) / 2, col = sh(GR, 0.88 + hash(k * 31) * 0.2);
    const p = (r, a, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    polyA(K.cap, [p(R1, a0, 0), p(R1, a1, 0), p(R1, a1, 0.38), p(R1, a0, 0.38)], col, Math.cos(am), 0, Math.sin(am));
    polyA(K.cap, [p(R0, a0, -0.3), p(R0, a1, -0.3), p(R0, a1, 0.38), p(R0, a0, 0.38)], sh(col, 0.85), -Math.cos(am), 0, -Math.sin(am));
    polyA(K.cap, [p(R0, a0, 0.38), p(R0, a1, 0.38), p(R1 - 0.08, a1, 0.46), p(R1 - 0.08, a0, 0.46)], sh(col, 1.06), 0, 1, 0);
    polyA(K.cap, [p(R1 - 0.08, a0, 0.46), p(R1 - 0.08, a1, 0.46), p(R1, a1, 0.38), p(R1, a0, 0.38)], sh(col, 1.0), Math.cos(am), 1, Math.sin(am));
    polyA(K.cap, [[cx, -0.3, cz], p(R0, a0, -0.3), p(R0, a1, -0.3)], hb('#55524c'), 0, 1, 0);
  }
  // stepped granite base, the block with the plaque and the lions' heads
  fortTBox(K.gra, f, -1.35, 1.35, -1.35, 1.35, -0.3, 0.25, FTS[1], GR);
  fortTBox(K.gra, f, -1.05, 1.05, -1.05, 1.05, 0.25, 0.5, FTS[1], sh(GR, 1.04));
  fortTBox(K.gra, f, -0.9, 0.9, -0.9, 0.9, 0.5, 1.25, FTS[1], [176, 150, 132]);
  fortTBox(K.gra, f, -0.98, 0.98, -0.98, 0.98, 1.25, 1.36, FTS[1], [176, 150, 132]);
  for (const [u, v, nu, nv] of [[0, -0.905, 0, -1], [0, 0.905, 0, 1], [-0.905, 0, -1, 0], [0.905, 0, 1, 0]]) {
    const A = P(u - nv * 0.55, v + nu * 0.55, 0.68), Bq = P(u + nv * 0.55, v - nu * 0.55, 0.68), Cq = P(u + nv * 0.55, v - nu * 0.55, 1.02), D = P(u - nv * 0.55, v + nu * 0.55, 1.02);
    polyA(K.cap, [A, Bq, Cq, D], hb('#6e4a35'), nu, 0, nv);   // bronze plaque
  }
  for (const [u, v] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]]) lmLathe(K.cap, ...lmW(f, u, v), 0.75, [[0, 0], [0.2, 0.05], [0.22, 0.2], [0.14, 0.36], [0, 0.4]], 8, hb('#8f8a82'));
  // four barrels on square breeches, leaning in so that their muzzles meet
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const bx = su * 0.56, bv = sv * 0.56, base = P(bx, bv, 1.92), top = P(su * 0.19, sv * 0.19, 6.0), D = [top[0] - base[0], top[1] - base[1], top[2] - base[2]], L = Math.hypot(...D);
    const d = D.map(x => x / L);
    lmBoxL(K.cap, f, bx - 0.28, bx + 0.28, bv - 0.28, bv + 0.28, 1.36, 1.92, IRON);
    fortLatheAx(K.cap, base, d, [[0.27, 0], [0.27, 1.1], [0.245, 1.15], [0.245, 2.1], [0.215, 2.15], [0.18, L - 0.3], [0.2, L - 0.25], [0.2, L - 0.1], [0.11, L - 0.1], [0, L - 0.25]], 12, IRON);
    // trunnions with hooks on the outer sides
    for (const [du, dv] of [[su, 0], [0, sv]]) { const c = P(bx + du * 0.25, bv + dv * 0.25, 3.0); lmBar(K.cap, c, [c[0] + du * 0.16, c[1], c[2] + dv * 0.16], 0.14, IRON); }
  }
  // low iron posts with chains round the lawn
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * 2 * Math.PI, a1 = (k + 1) / 10 * 2 * Math.PI, R = 7.5, x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R, x1 = cx + Math.cos(a1) * R, z1 = cz + Math.sin(a1) * R;
    lmBoxL(K.cap, [x, z, 1, 0], -0.12, 0.12, -0.12, 0.12, 0, 0.5, IRON);
    const n = 6; for (let s = 0; s < n; s++) { const t0 = s / n, t1 = (s + 1) / n, y = t => 0.42 - Math.sin(t * Math.PI) * 0.15;
      lmBar(K.cap, [x + (x1 - x) * t0, y(t0), z + (z1 - z) * t0], [x + (x1 - x) * t1, y(t1), z + (z1 - z) * t1], 0.018, IRON); }
  }
}
// a cast-iron gun on a garrison carriage pointing along (dx, dz), or a mortar on its bed
function fortGun(K, x, z, dx, dz, mortar) {
  const f = [x, z, dx, dz], IRON = hb('#2e3033'), WOOD = hb('#5b4a3a'), P = (u, v, y) => fortP(f, u, v, y);
  if (mortar) {
    lmBoxL(K.cap, f, -0.8, 0.8, -0.55, 0.55, 0, 0.45, WOOD);
    const d = [dx * 0.7071, 0.7071, dz * 0.7071]; fortLatheAx(K.cap, P(-0.2, 0, 0.45), d, [[0, -0.25], [0.38, -0.2], [0.42, 0.2], [0.36, 0.8], [0.4, 0.95], [0.4, 1.05], [0.28, 1.05], [0.2, 0.9]], 12, IRON);
    return;
  }
  for (const s of [-1, 1]) { lmBoxL(K.cap, f, -1.0, 0.7, s * 0.28 - 0.07, s * 0.28 + 0.07, 0.25, 0.85, WOOD); fortLatheAx(K.cap, P(0.35, s * 0.36, 0.42), [-dz * s, 0, dx * s], [[0, 0], [0.42, 0], [0.42, 0.1], [0, 0.1]], 14, WOOD); }
  lmBar(K.cap, P(0.35, -0.45, 0.42), P(0.35, 0.45, 0.42), 0.12, IRON); lmBoxL(K.cap, f, -1.1, -0.85, -0.3, 0.3, 0, 0.35, WOOD);
  const d = [dx * 0.995, 0.1, dz * 0.995]; fortLatheAx(K.cap, P(-0.95, 0, 0.92), d, [[0, -0.15], [0.12, -0.12], [0.24, 0], [0.26, 0.6], [0.23, 0.65], [0.21, 1.5], [0.17, 2.6], [0.2, 2.7], [0.2, 2.8], [0.1, 2.8], [0.1, 2.5]], 12, IRON);
  lmBar(K.cap, P(0.15, -0.3, 0.98), P(0.15, 0.3, 0.98), 0.14, IRON);
}
function fortMonuments(K) {
  fortFountain(K);
  for (const [name, x, z] of FT.guns || []) {
    // point away from the nearest building
    let best = 1e9, bx = 0, bz = 1; for (const b of BLD) { const cx = (b.bb[0] + b.bb[2]) / 2, cz = (b.bb[1] + b.bb[3]) / 2, d = Math.hypot(cx - x, cz - z); if (d < best) { best = d; bx = x - cx; bz = z - cz; } }
    const l = Math.hypot(bx, bz) || 1; fortGun(K, x, z, bx / l, bz / l, /mort/i.test(name));
  }
}

export { FORT_FOUNTAIN, fortLatheAx, fortMonuments };
