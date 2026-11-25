import * as THREE from 'three';
import { STATE } from './state.js';
import { sh } from './util.js';

/* ---------- geometry builder on growable typed arrays ---------- */
// tex builders (facade/roof) carry aUv + aInfo and a tint in aTint; plain builders carry vertex colours.
// All colours are sRGB bytes; shaders convert them to linear.
class GB {
  constructor(tex) { this.tex = tex; this.v = 0; this.cap = 0; this.ni = 0; this.idx = new Uint32Array(6144); this.ensure(2048); }
  ensure(n) {
    if (this.v + n <= this.cap) return;
    const cap = Math.max(this.v + n, this.cap * 2), v = this.v;
    const g = (old, Ctor, k) => { const a = new Ctor(cap * k); if (old) a.set(old.subarray(0, v * k)); return a; };
    this.pos = g(this.pos, Float32Array, 3); this.nrm = g(this.nrm, Int8Array, 3); this.col = g(this.col, Uint8Array, 3);
    if (this.tex) { this.uv = g(this.uv, Float32Array, 2); this.inf = g(this.inf, Uint8Array, 3); }
    this.cap = cap;
  }
  vert(x, y, z, nx, ny, nz, c, u, v, i0, i1, i2) {
    // mesh() nulls the buffers once a builder has been turned into a mesh (finishBuildings does this to the tile
    // builders before the landmarks run). A late draw into such a builder must not crash the whole city: start a
    // fresh buffer instead. Correct code never hits this; it is a guard against stale cached modules and regressions.
    if (this.pos === null) { this.v = 0; this.ni = 0; this.cap = 0; this.idx = new Uint32Array(6144); this.ensure(2048); }
    if (STATE.GBC) y += STATE.GBC(x, y, z);
    if (this.v >= this.cap) this.ensure(1);
    const k = this.v, k3 = k * 3;
    this.pos[k3] = x; this.pos[k3 + 1] = y; this.pos[k3 + 2] = z;
    this.nrm[k3] = Math.round(nx * 127); this.nrm[k3 + 1] = Math.round(ny * 127); this.nrm[k3 + 2] = Math.round(nz * 127);
    this.col[k3] = c[0]; this.col[k3 + 1] = c[1]; this.col[k3 + 2] = c[2];
    if (this.tex) { this.uv[2 * k] = u; this.uv[2 * k + 1] = v; this.inf[k3] = i0; this.inf[k3 + 1] = i1; this.inf[k3 + 2] = i2; }
    return this.v++;
  }
  tri(a, b, c) { if (this.ni + 3 > this.idx.length) { const n = new Uint32Array(this.idx.length * 2); n.set(this.idx); this.idx = n; } this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  triUp(a, b, c) { const p = this.pos; const ax = p[3 * a], az = p[3 * a + 2]; const s = (p[3 * b + 2] - az) * (p[3 * c] - ax) - (p[3 * b] - ax) * (p[3 * c + 2] - az); if (s >= 0) this.tri(a, b, c); else this.tri(a, c, b); }
  triDown(a, b, c) { const p = this.pos; const ax = p[3 * a], az = p[3 * a + 2]; const s = (p[3 * b + 2] - az) * (p[3 * c] - ax) - (p[3 * b] - ax) * (p[3 * c + 2] - az); if (s >= 0) this.tri(a, c, b); else this.tri(a, b, c); }
  // a coloured quad with the LMB.q signature (A, B, C, D, normal, uv, colour, lit). On a plain builder the uv and
  // lit are unused — it is just polyA — so landmark code can draw simple quads into a GB without switching buffers.
  q(A, B, Cc, D, n, uv, c) { polyA(this, [A, B, Cc, D], c, n[0], n[1], n[2]); }
  mesh(mat) {
    if (!this.v || !this.ni) return null;
    const v = this.v, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, v * 3), 3, true));
    if (this.tex) {
      g.setAttribute('aTint', new THREE.BufferAttribute(this.col.slice(0, v * 3), 3, true));
      g.setAttribute('aUv', new THREE.BufferAttribute(this.uv.slice(0, v * 2), 2));
      g.setAttribute('aInfo', new THREE.BufferAttribute(this.inf.slice(0, v * 3), 3));
    } else g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, v * 3), 3, true));
    g.setIndex(new THREE.BufferAttribute(this.idx.slice(0, this.ni), 1));
    this.pos = this.nrm = this.col = this.uv = this.inf = this.idx = null;
    return new THREE.Mesh(g, mat);
  }
}
// polygon (3 or 4 points) with automatic normal, turned to face direction d
function polyA(b, P, col, dx, dy, dz) {
  const [A, B] = P, D = P[P.length - 1];
  let nx = (B[1] - A[1]) * (D[2] - A[2]) - (B[2] - A[2]) * (D[1] - A[1]);
  let ny = (B[2] - A[2]) * (D[0] - A[0]) - (B[0] - A[0]) * (D[2] - A[2]);
  let nz = (B[0] - A[0]) * (D[1] - A[1]) - (B[1] - A[1]) * (D[0] - A[0]);
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const flip = nx * dx + ny * dy + nz * dz < 0; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
  const k = P.map(p => b.vert(p[0], p[1], p[2], nx, ny, nz, col));
  if (flip) { b.tri(k[0], k[2], k[1]); if (k.length === 4) b.tri(k[0], k[3], k[2]); }
  else { b.tri(k[0], k[1], k[2]); if (k.length === 4) b.tri(k[0], k[2], k[3]); }
}
// axis-aligned-in-plan box given centre, along-axis (ux,uz), half sizes
function box(b, cx, cz, ux, uz, ha, hb2, y0, y1, col, top = true) {
  const vx = -uz, vz = ux, P = (su, sv, y) => [cx + ux * su * ha + vx * sv * hb2, y, cz + uz * su * ha + vz * sv * hb2];
  polyA(b, [P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1)], col, -vx, 0, -vz);
  polyA(b, [P(-1, 1, y0), P(1, 1, y0), P(1, 1, y1), P(-1, 1, y1)], col, vx, 0, vz);
  polyA(b, [P(-1, -1, y0), P(-1, 1, y0), P(-1, 1, y1), P(-1, -1, y1)], sh(col, 0.92), -ux, 0, -uz);
  polyA(b, [P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1)], sh(col, 0.92), ux, 0, uz);
  if (top) polyA(b, [P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1)], sh(col, 1.06), 0, 1, 0);
}
function lathe(b, cx, cz, y0, prof, seg, rot, col) {
  for (let k = 0; k < prof.length - 1; k++) {
    const [r0, h0] = prof[k], [r1, h1] = prof[k + 1];
    for (let s = 0; s < seg; s++) {
      const a0 = rot + s * 2 * Math.PI / seg, a1 = rot + (s + 1) * 2 * Math.PI / seg, am = (a0 + a1) / 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const P = [[cx + r0 * c0, y0 + h0, cz + r0 * s0], [cx + r0 * c1, y0 + h0, cz + r0 * s1]];
      if (r1 > 0.001) P.push([cx + r1 * c1, y0 + h1, cz + r1 * s1], [cx + r1 * c0, y0 + h1, cz + r1 * s0]); else P.push([cx, y0 + h1, cz]);
      if (r0 < 0.001) P.splice(0, 2, [cx, y0 + h0, cz]);
      if (P.length >= 3) polyA(b, P, col, Math.cos(am), (r0 - r1) * 0.5, Math.sin(am));
    }
  }
}

/* spatial hash of line segments */
class SegGrid {
  constructor(cell) { this.cell = cell; this.m = new Map(); this.s = []; }
  add(x1, z1, x2, z2, a, b) {
    const id = this.s.length / 6; this.s.push(x1, z1, x2, z2, a, b); const c = this.cell;
    const i0 = Math.floor(Math.min(x1, x2) / c), i1 = Math.floor(Math.max(x1, x2) / c), j0 = Math.floor(Math.min(z1, z2) / c), j1 = Math.floor(Math.max(z1, z2) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = (i + 2000) * 4096 + (j + 2000); let l = this.m.get(k); if (!l) this.m.set(k, l = []); l.push(id); }
  }
  near(x, z, r, fn) {
    const c = this.cell, s = this.s;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.m.get((i + 2000) * 4096 + (j + 2000)); if (!l) continue;
      for (let q = 0; q < l.length; q++) {
        const o = l[q] * 6, x1 = s[o], z1 = s[o + 1], dx = s[o + 2] - x1, dz = s[o + 3] - z1, l2 = dx * dx + dz * dz;
        let t = l2 ? ((x - x1) * dx + (z - z1) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = x1 + t * dx, pz = z1 + t * dz, d = Math.hypot(x - px, z - pz);
        if (d <= r) fn(l[q], d, px, pz);
      }
    }
  }
}

export { GB, SegGrid, box, lathe, polyA };
