import * as THREE from 'three';

/* ---------- small helpers ---------- */
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }
const rnd = (i, k) => hash(i * 7919 + k * 104729 + 13);
const pick = (arr, i, k) => arr[Math.floor(rnd(i, k) * arr.length) % arr.length];
const hb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PB = arr => arr.map(hb);
const sh = (c, f) => [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))];
const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
function dec(a) { const n = a.length >> 1, o = new Float32Array(n * 2); let x = 0, y = 0; for (let i = 0; i < n; i++) { x += a[2 * i]; y += a[2 * i + 1]; o[2 * i] = x / 10; o[2 * i + 1] = y / 10; } return o; }
function area2(r) { let s = 0; const n = r.length >> 1; for (let i = 0, j = n - 1; i < n; j = i++) s += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1]; return s / 2; }
function reversed(r) { const n = r.length >> 1, o = new Float32Array(r.length); for (let i = 0; i < n; i++) { o[2 * i] = r[2 * (n - 1 - i)]; o[2 * i + 1] = r[2 * (n - 1 - i) + 1]; } return o; }
function bbox(r) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < r.length; i += 2) { const x = r[i], z = r[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } return [x0, z0, x1, z1]; }
function pip(x, z, r) { let c = false; const n = r.length >> 1; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = r[2 * i], zi = r[2 * i + 1], xj = r[2 * j], zj = r[2 * j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
function obb(r) {
  const n = r.length >> 1; let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; let dx = r[2 * j] - r[2 * i], dz = r[2 * j + 1] - r[2 * i + 1]; const l = Math.hypot(dx, dz); if (l < 0.4) continue; dx /= l; dz /= l;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let k = 0; k < n; k++) { const u = r[2 * k] * dx + r[2 * k + 1] * dz, v = -r[2 * k] * dz + r[2 * k + 1] * dx; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, dx, dz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { dx, dz, u0, u1, v0, v1 } = best; const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  let a = (u1 - u0) / 2, b = (v1 - v0) / 2, ux = dx, uz = dz;
  if (b > a) { const t = a; a = b; b = t; ux = -dz; uz = dx; }
  return { cx: cu * dx - cv * dz, cz: cu * dz + cv * dx, ux, uz, a, b, fill: Math.abs(area2(r)) / best.A };
}
function triangulate(rings) {
  let total = 0; for (const r of rings) total += r.length;
  const flat = new Array(total), holes = []; let o = 0;
  rings.forEach((r, k) => { if (k) holes.push(o / 2); for (let i = 0; i < r.length; i++) flat[o++] = r[i]; });
  let tris;
  if (THREE.Earcut) tris = THREE.Earcut.triangulate(flat, holes, 2);
  else { const v = r => { const a = []; for (let i = 0; i < r.length; i += 2) a.push(new THREE.Vector2(r[i], r[i + 1])); return a; }; tris = [].concat(...THREE.ShapeUtils.triangulateShape(v(rings[0]), rings.slice(1).map(v))); }
  return { flat, tris };
}
// edge normals that point out of the building for our ring orientation
function edgeN(r, i) { const n = r.length >> 1, j = (i + 1) % n; const dx = r[2 * j] - r[2 * i], dz = r[2 * j + 1] - r[2 * i + 1]; const L = Math.hypot(dx, dz) || 1; return [dz / L, -dx / L, L]; }
// mitred offset of a ring; d > 0 grows the outline
function offsetRing(r, d) {
  const n = r.length >> 1, o = new Float32Array(r.length);
  for (let i = 0; i < n; i++) {
    const a = edgeN(r, (i - 1 + n) % n), b = edgeN(r, i);
    const den = Math.max(0.35, 1 + a[0] * b[0] + a[1] * b[1]);
    o[2 * i] = r[2 * i] + (a[0] + b[0]) * d / den; o[2 * i + 1] = r[2 * i + 1] + (a[1] + b[1]) * d / den;
  }
  return o;
}
function insetOk(r, q) {
  const n = r.length >> 1; if (Math.abs(area2(q)) < 2 || Math.sign(area2(q)) !== Math.sign(area2(r))) return false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const ax = r[2 * j] - r[2 * i], az = r[2 * j + 1] - r[2 * i + 1], bx = q[2 * j] - q[2 * i], bz = q[2 * j + 1] - q[2 * i + 1];
    if (ax * bx + az * bz <= 0.02 * Math.hypot(ax, az) * Math.hypot(ax, az)) return false;
    if (!pip(q[2 * i], q[2 * i + 1], r)) return false;
  }
  return true;
}

export { PB, area2, bbox, dec, edgeN, hash, hb, insetOk, lin, obb, offsetRing, pick, pip, reversed, rnd, sh, triangulate };
