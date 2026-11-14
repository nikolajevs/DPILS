import { ROUGH } from '../world/palette.js';
import { GB, lathe, polyA } from '../core/geometry.js';
import { edgeN, hb, triangulate } from '../core/util.js';
import { TILE } from '../core/env.js';

/* ---------- buildings ---------- */
const tiles = new Map();
function newSet() { return { fac: new GB(true), roof: new GB(true), plain: new GB(false), ser: new GB(true) }; }
function tileOf(x, z) { const i = Math.floor(x / TILE), j = Math.floor(z / TILE), k = (i + 100) * 1000 + j + 100; let t = tiles.get(k); if (!t) tiles.set(k, t = { x0: i * TILE, z0: j * TILE, m: newSet(), d: newSet(), meshes: [], det: [] }); return t; }
function wallQuad(b, x1, z1, x2, z2, y0, y1, nx, nz, tint, u0, u1, v0, v1, row, seed, fl) {
  const a = b.vert(x1, y0, z1, nx, 0, nz, tint, u0, v0, row, seed, fl), c = b.vert(x2, y0, z2, nx, 0, nz, tint, u1, v0, row, seed, fl);
  const d = b.vert(x2, y1, z2, nx, 0, nz, tint, u1, v1, row, seed, fl), e = b.vert(x1, y1, z1, nx, 0, nz, tint, u0, v1, row, seed, fl);
  b.tri(c, a, e); b.tri(c, e, d);
}
// textured roof face (planar polygon), uv in metres along the eave and up the slope
function roofFace(b, P, ex, ez, tint, mat, seed) {
  const [A, B] = P, D = P[P.length - 1];
  let nx = (B[1] - A[1]) * (D[2] - A[2]) - (B[2] - A[2]) * (D[1] - A[1]), ny = (B[2] - A[2]) * (D[0] - A[0]) - (B[0] - A[0]) * (D[2] - A[2]), nz = (B[0] - A[0]) * (D[1] - A[1]) - (B[1] - A[1]) * (D[0] - A[0]);
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; const flip = ny < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
  const ux = ex, uz = ez, y0 = Math.min(...P.map(p => p[1])), cos = Math.max(0.2, ny);
  const k = P.map(p => b.vert(p[0], p[1], p[2], nx, ny, nz, tint, (p[0] * ux + p[2] * uz) / 3, (p[1] - y0) / Math.sqrt(1 - cos * cos + 1e-6) / 3 * (1 - cos * cos > 1e-4 ? 1 : 0) + (1 - cos * cos > 1e-4 ? 0 : (-p[0] * uz + p[2] * ux) / 3), mat, seed, ROUGH[mat]));
  for (let i = 1; i < k.length - 1; i++) { if (flip) b.tri(k[0], k[i + 1], k[i]); else b.tri(k[0], k[i], k[i + 1]); }
}
function flatRoof(b, rings, y, tint, mat, seed) {
  const { flat, tris } = triangulate(rings), v = b.v; b.ensure(flat.length / 2);
  for (let i = 0; i < flat.length; i += 2) b.vert(flat[i], y, flat[i + 1], 0, 1, 0, tint, flat[i] / 3, flat[i + 1] / 3, mat, seed, ROUGH[mat]);
  for (let i = 0; i < tris.length; i += 3) b.triUp(v + tris[i], v + tris[i + 1], v + tris[i + 2]);
}
function flatPlain(b, rings, y, col, down) {
  const { flat, tris } = triangulate(rings), v = b.v; b.ensure(flat.length / 2);
  for (let i = 0; i < flat.length; i += 2) b.vert(flat[i], y, flat[i + 1], 0, down ? -1 : 1, 0, col);
  for (let i = 0; i < tris.length; i += 3) (down ? b.triDown : b.triUp).call(b, v + tris[i], v + tris[i + 1], v + tris[i + 2]);
}
// horizontal band between a ring and its offset (soffits, cornice undersides)
function band(b, r, q, y, col, down) {
  const n = r.length >> 1;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; const P = [[r[2 * i], y, r[2 * i + 1]], [r[2 * j], y, r[2 * j + 1]], [q[2 * j], y, q[2 * j + 1]], [q[2 * i], y, q[2 * i + 1]]]; polyA(b, P, col, 0, down ? -1 : 1, 0); }
}
function vband(b, q, y0, y1, col, outward = 1) { const n = q.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n, e = edgeN(q, i); if (e[2] < 0.02) continue; polyA(b, [[q[2 * i], y0, q[2 * i + 1]], [q[2 * j], y0, q[2 * j + 1]], [q[2 * j], y1, q[2 * j + 1]], [q[2 * i], y1, q[2 * i + 1]]], col, e[0] * outward, 0, e[1] * outward); } }

function church(b, gold, kind, o, h, r, wallCol, name) {
  const s = o.ux > 0 ? -1 : 1, sq = Math.PI / 4 + Math.atan2(o.uz, o.ux);
  const at = (du, dv) => [o.cx + o.ux * du - o.uz * dv, o.cz + o.uz * du + o.ux * dv];
  const CROSS = hb('#e8c860');
  const onion = (x, z, y, R, g) => { lathe(g, x, z, y, [[R * 0.8, 0], [R, R * 0.35], [R * 0.86, R * 0.75], [R * 0.45, R * 1.15], [R * 0.12, R * 1.6], [0, R * 2]], 14, 0, CROSS); lathe(g, x, z, y + R * 2, [[0.09, 0], [0.09, R * 0.9]], 4, 0, CROSS); lathe(g, x, z, y + R * 2.5, [[R * 0.3, 0], [R * 0.3, 0.14]], 4, sq, CROSS); };
  if (kind === 8) {
    const R0 = Math.max(1.6, o.b * 0.45), top = h + r * 0.5;
    lathe(b, o.cx, o.cz, top, [[R0 * 0.78, 0], [R0 * 0.78, R0 * 1.5], [R0 * 0.86, R0 * 1.5], [R0 * 0.86, R0 * 1.62]], 12, 0, wallCol); onion(o.cx, o.cz, top + R0 * 1.62, R0, gold);
    const w = Math.max(1.6, o.b * 0.42), [tx, tz] = at(s * (o.a - w), 0), th = h * 1.75;
    lathe(b, tx, tz, 0, [[w * 1.414, 0], [w * 1.414, th], [w * 1.5, th], [w * 1.5, th + 0.4]], 4, sq, wallCol); onion(tx, tz, th + 0.4, w * 0.85, gold);
    if (/Собор|katedr/i.test(name)) for (const [du, dv] of [[0.45, 0.55], [0.45, -0.55], [-0.2, 0.55], [-0.2, -0.55]]) { const [x, z] = at(du * o.a, dv * o.b); lathe(b, x, z, h, [[R0 * 0.4, 0], [R0 * 0.4, R0 * 1.1]], 10, 0, wallCol); onion(x, z, h + R0 * 1.1, R0 * 0.52, gold); }
  } else if (kind === 9) {
    const w = Math.max(1.8, o.b * 0.36), th = h * 2.1;
    for (const sv of [-1, 1]) { const [x, z] = at(s * (o.a - w), sv * (o.b - w)); lathe(b, x, z, 0, [[w * 1.414, 0], [w * 1.414, th], [w * 1.2, th], [w * 1.2, th + w], [0, th + w * 3.4]], 4, sq, wallCol); lathe(b, x, z, th + w * 3.4, [[0.1, 0], [0.1, 1.6]], 4, 0, CROSS); }
  } else if (kind === 10) {
    const w = Math.max(2, o.b * 0.5), th = h * 2.3, [x, z] = at(s * (o.a - w), 0);
    lathe(b, x, z, 0, [[w * 1.414, 0], [w * 1.414, th]], 4, sq, wallCol); lathe(b, x, z, th, [[w * 1.5, 0], [0, w * 4.5]], 4, sq, hb('#4f7a66'));
  } else { const w = Math.max(1.2, o.b * 0.3); lathe(b, o.cx, o.cz, h + r * 0.6, [[w, 0], [w, 2], [0, 2 + w * 1.6]], 6, 0, wallCol); }
}

export { band, church, flatPlain, flatRoof, roofFace, tileOf, tiles, vband, wallQuad };
