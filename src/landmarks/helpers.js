import { LMT, LMWS, lr } from './tiles.js';
import { LMWHITE, lmW } from './core.js';
import { band, flatPlain, vband } from '../buildings/walls.js';
import { polyA } from '../core/geometry.js';
import { area2, offsetRing, reversed, sh } from '../core/util.js';

/* ---- geometry helpers ---- */
// frame of a straight wall from Pw to Qw (world xz); outward normal is (tz, -tx) as for cadastre outer rings
function lmWF(Pw, Qw) {
  const dx = Qw[0] - Pw[0], dz = Qw[1] - Pw[1], L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L, nx = tz, nz = -tx;
  return { P: Pw, L, tx, tz, nx, nz, at: (s, y, d) => [Pw[0] + tx * s - nx * d, y, Pw[1] + tz * s - nz * d] };
}
// box in wall coordinates: s along the wall, y up, d depth into the wall (negative = in front of it)
function lmBoxW(G, F, s0, s1, y0, y1, d0, d1, col, bottom = true) {
  const a = F.at, N = [F.nx, 0, F.nz];
  polyA(G, [a(s0, y0, d0), a(s1, y0, d0), a(s1, y1, d0), a(s0, y1, d0)], col, N[0], 0, N[2]);
  polyA(G, [a(s0, y1, d0), a(s1, y1, d0), a(s1, y1, d1), a(s0, y1, d1)], sh(col, 1.06), 0, 1, 0);
  if (bottom) polyA(G, [a(s0, y0, d0), a(s1, y0, d0), a(s1, y0, d1), a(s0, y0, d1)], sh(col, 0.72), 0, -1, 0);
  polyA(G, [a(s0, y0, d0), a(s0, y0, d1), a(s0, y1, d1), a(s0, y1, d0)], sh(col, 0.9), -F.tx, 0, -F.tz);
  polyA(G, [a(s1, y0, d0), a(s1, y0, d1), a(s1, y1, d1), a(s1, y1, d0)], sh(col, 0.9), F.tx, 0, F.tz);
}
// box in a local frame: u0..u1 × v0..v1 × y0..y1, all six faces unless told otherwise
function lmBoxL(G, f, u0, u1, v0, v1, y0, y1, col, bottom = true) {
  const p = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; }, ex = f[2], ez = f[3];
  polyA(G, [p(u0, v0, y0), p(u0, v1, y0), p(u0, v1, y1), p(u0, v0, y1)], sh(col, 0.95), -ex, 0, -ez);
  polyA(G, [p(u1, v0, y0), p(u1, v1, y0), p(u1, v1, y1), p(u1, v0, y1)], sh(col, 0.95), ex, 0, ez);
  polyA(G, [p(u0, v0, y0), p(u1, v0, y0), p(u1, v0, y1), p(u0, v0, y1)], col, ez, 0, -ex);
  polyA(G, [p(u0, v1, y0), p(u1, v1, y0), p(u1, v1, y1), p(u0, v1, y1)], col, -ez, 0, ex);
  polyA(G, [p(u0, v0, y1), p(u1, v0, y1), p(u1, v1, y1), p(u0, v1, y1)], sh(col, 1.06), 0, 1, 0);
  if (bottom) polyA(G, [p(u0, v0, y0), p(u1, v0, y0), p(u1, v1, y0), p(u0, v1, y0)], sh(col, 0.72), 0, -1, 0);
}
// thin bar between two 3D points (square section w)
function lmBar(G, A, B, w, col) {
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.hypot(dx, dy, dz); if (L < 1e-4) return;
  const d = [dx / L, dy / L, dz / L], up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
  const s1 = nm(cr(d, up)), s2 = cr(s1, d), h = w / 2;
  const off = (P, a, b) => [P[0] + (s1[0] * a + s2[0] * b) * h, P[1] + (s1[1] * a + s2[1] * b) * h, P[2] + (s1[2] * a + s2[2] * b) * h];
  for (const [a1, b1, a2, b2] of [[1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1], [-1, 1, 1, 1]]) {
    const n = [s1[0] * (a1 + a2) / 2 + s2[0] * (b1 + b2) / 2, s1[1] * (a1 + a2) / 2 + s2[1] * (b1 + b2) / 2, s1[2] * (a1 + a2) / 2 + s2[2] * (b1 + b2) / 2];
    polyA(G, [off(A, a1, b1), off(A, a2, b2), off(B, a2, b2), off(B, a1, b1)], col, n[0], n[1], n[2]);
  }
}
// lathe with normals smooth around the axis (columns, lamp posts, globes)
function lmLathe(G, cx, cz, y0, prof, seg, col) {
  for (let k = 0; k < prof.length - 1; k++) {
    const [r0, h0] = prof[k], [r1, h1] = prof[k + 1], dr = r1 - r0, dh = h1 - h0, l = Math.hypot(dr, dh) || 1, nr = dh / l, ny = -dr / l;
    for (let s = 0; s < seg; s++) {
      const a0 = s * 2 * Math.PI / seg, a1 = (s + 1) * 2 * Math.PI / seg, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const v = [G.vert(cx + r0 * c0, y0 + h0, cz + r0 * s0, nr * c0, ny, nr * s0, col), G.vert(cx + r0 * c1, y0 + h0, cz + r0 * s1, nr * c1, ny, nr * s1, col),
        G.vert(cx + r1 * c1, y0 + h1, cz + r1 * s1, nr * c1, ny, nr * s1, col), G.vert(cx + r1 * c0, y0 + h1, cz + r1 * s0, nr * c0, ny, nr * s0, col)];
      G.tri(v[0], v[2], v[1]); G.tri(v[0], v[3], v[2]);
    }
  }
}

/* One wall from Pw to Qw between y0 and y1, with openings cut into it. An opening is {s0, s1, y0, y1, d (depth),
   tile, lit, sill, kind}; the wall around it is split into rectangles, the reveals and the window or door at the
   bottom of the recess are added. s grows to the viewer's left, so tiles are laid in mirrored. */
function lmWall(K, Pw, Qw, y0, y1, ops, st) {
  const F = lmWF(Pw, Qw), L = F.L; if (L < 0.02 || y1 <= y0 + 0.01) return;
  const W = K.walls[st.tex], S = LMWS[st.tex], so =Pw[0] * F.tx + Pw[1] * F.tz, N = [F.nx, 0, F.nz], at = F.at;
  const colAt = y => (st.plinth && y < st.plinth) ? st.pcol : st.col;
  const uvR = (sa, sb, ya, yb) => [(so + sa) / S, ya / S, (so + sb) / S, ya / S, (so + sb) / S, yb / S, (so + sa) / S, yb / S];
  const piece = (sa, sb, ya, yb) => { if (sb - sa > 0.004) W.q(at(sa, ya, 0), at(sb, ya, 0), at(sb, yb, 0), at(sa, yb, 0), N, uvR(sa, sb, ya, yb), colAt((ya + yb) / 2)); };
  const ys = [y0, y1]; if (st.plinth > y0 && st.plinth < y1) ys.push(st.plinth);
  for (const o of ops) for (const y of [o.y0, o.y1]) if (y > y0 && y < y1) ys.push(y);
  ys.sort((a, b) => a - b); const yu = ys.filter((y, k) => !k || y - ys[k - 1] > 1e-3);
  for (let k = 0; k < yu.length - 1; k++) {
    const ya = yu[k], yb = yu[k + 1], cov = ops.filter(o => o.y0 <= ya + 1e-3 && o.y1 >= yb - 1e-3).sort((a, b) => a.s0 - b.s0);
    let s = 0; for (const o of cov) { if (o.s0 > s) piece(s, o.s0, ya, yb); s = Math.max(s, o.s1); } if (s < L) piece(s, L, ya, yb);
  }
  for (const o of ops) {
    const ya = Math.max(y0, o.y0), yb = Math.min(y1, o.y1); if (yb <= ya + 1e-3) continue;
    const d = o.d || 0, rc = sh(o.rcol || st.col, 0.84), ud = d / S;
    if (d > 0.04) {
      W.q(at(o.s0, ya, 0), at(o.s0, ya, d), at(o.s0, yb, d), at(o.s0, yb, 0), [F.tx, 0, F.tz], [0, ya / S, ud, ya / S, ud, yb / S, 0, yb / S], rc);
      W.q(at(o.s1, ya, d), at(o.s1, ya, 0), at(o.s1, yb, 0), at(o.s1, yb, d), [-F.tx, 0, -F.tz], [0, ya / S, ud, ya / S, ud, yb / S, 0, yb / S], rc);
      if (yb < y1 - 1e-3) W.q(at(o.s0, yb, 0), at(o.s1, yb, 0), at(o.s1, yb, d), at(o.s0, yb, d), [0, -1, 0], uvR(o.s0, o.s1, 0, d), sh(rc, 0.85));
      if (ya > y0 + 1e-3 && !o.noFloor) W.q(at(o.s0, ya, d), at(o.s1, ya, d), at(o.s1, ya, 0), at(o.s0, ya, 0), [0, 1, 0], uvR(o.s0, o.s1, 0, d), rc);
    }
    if (o.tile) {
      const t = LMT[o.tile], f0 = (ya - o.y0) / (o.y1 - o.y0), f1 = (yb - o.y0) / (o.y1 - o.y0), va = t.v0 + (t.v1 - t.v0) * f0, vb = t.v0 + (t.v1 - t.v0) * f1;
      K.det.q(at(o.s0, ya, d), at(o.s1, ya, d), at(o.s1, yb, d), at(o.s0, yb, d), N, [t.u1, va, t.u0, va, t.u0, vb, t.u1, vb], LMWHITE, o.lit ? 1 : 0);
    }
    if (o.sill && ya > y0 + 0.1) lmBoxW(K.plain, F, o.s0 - 0.06, o.s1 + 0.06, ya - 0.07, ya, -0.1, d, o.sill);
  }
}
/* Openings are given in the building's local frame by the point on the wall line where they are centred; each
   wall picks up the ones that lie on it. */
function lmOpsFor(f, ops, Pl, Ql) {
  const P = lmW(f, Pl[0], Pl[1]), Q = lmW(f, Ql[0], Ql[1]), dx = Q[0] - P[0], dz = Q[1] - P[1], L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L, out = [];
  for (const o of ops) {
    const A = lmW(f, o.a[0], o.a[1]), s = (A[0] - P[0]) * tx + (A[1] - P[1]) * tz, dist = Math.abs((A[0] - P[0]) * tz - (A[1] - P[1]) * tx);
    if (dist < 0.06 && s > 0.01 && s < L - 0.01) out.push(Object.assign({}, o, { s0: Math.max(0, s - o.w / 2), s1: Math.min(L, s + o.w / 2) }));
  }
  return out;
}
/* A block: plan polygon in the local frame (holes allowed), walls from y0 to top with their style, flat roof,
   cornices [y0, y1, projection, colour]. Polygons are re-oriented to the cadastre convention (outer ring area > 0). */
function lmBlock(K, f, blk, ops) {
  const rings = [blk.poly, ...(blk.holes || [])].map((pl, k) => {
    let r = []; for (const [u, v] of pl) r.push(...lmW(f, u, v)); let loc = pl.slice();
    if ((k === 0) !== (area2(r) > 0)) { r = Array.from(reversed(r)); loc = loc.reverse(); }
    return { r, loc };
  });
  const y0 = blk.y0 || 0;
  for (const { r, loc } of rings) {
    const n = loc.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, Pw = [r[2 * i], r[2 * i + 1]], Qw = [r[2 * j], r[2 * j + 1]];
      const st = typeof blk.st === 'function' ? blk.st(loc[i], loc[j]) : blk.st;
      const wy = blk.wy0 ? Math.max(y0, blk.wy0(loc[i], loc[j], y0)) : y0;   // a lower neighbour hides the foot of this wall
      if (wy < blk.top - 0.01) lmWall(K, Pw, Qw, wy, blk.top, lmOpsFor(f, ops, loc[i], loc[j]), st);
    }
  }
  const R = rings.map(x => x.r);
  const TG = blk.trim || K.plain;
  for (const [ya, yb, pj, col] of blk.cornice || []) for (const r of R) { const q = offsetRing(r, pj); vband(TG, q, ya, yb, col); band(TG, r, q, ya, sh(col, 0.75), true); band(TG, r, q, yb, sh(col, 1.04), false); }
  if (blk.roof) flatPlain(K.plain, R, blk.roofY != null ? blk.roofY : blk.top, blk.roof, false);
  return R;
}
const lmOp = (ops, u, v, w, y0, y1, tile, o) => ops.push(Object.assign({ a: [u, v], w, y0, y1, tile, d: 0.25 }, o || {}));
// n openings centred in n equal bays along the line from (u1, v1) to (u2, v2); o may depend on the bay index
const lmRow = (ops, u1, v1, u2, v2, n, w, y0, y1, tile, o) => { for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; lmOp(ops, u1 + (u2 - u1) * t, v1 + (v2 - v1) * t, w, y0, y1, typeof tile === 'function' ? tile(k) : tile, typeof o === 'function' ? o(k) : o); } };
const lmLit = p => lr() < p;

export { lmBar, lmBlock, lmBoxL, lmBoxW, lmLathe, lmLit, lmOp, lmOpsFor, lmRow, lmWF, lmWall };
