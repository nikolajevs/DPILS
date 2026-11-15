import * as THREE from 'three';
import { FORT } from '../fortress/index.js';
import { AREAS, M_LAND, WATER, WMASK, matBank, waterMask } from './data.js';
import { SMALL_WATER, waterDeep, waterMat } from './water.js';
import { AREA_HEX, AREA_ORDER } from './palette.js';
import { groundMaterial } from '../render/materials.js';
import { detailTex } from '../render/textures.js';
import { PATCH, TERR, densify, inPatch, subTris, terrainH, waterLevel } from './terrain.js';
import { cutFloor } from './cutting.js';
import { scene } from '../render/renderer.js';
import { GB, polyA } from '../core/geometry.js';
import { bbox, dec, hb, rnd, sh, triangulate } from '../core/util.js';
import { C, HX, HY, WL } from '../core/env.js';

/* ---------- ground: land use, water in its bed ---------- */
/* The ground layers are drawn first without writing depth; a hill must still hide what lies behind it. A grid on the
   height grid, at least 0.5 m under the ground, writes depth first (and casts the shadows of the hills). It leaves out the
   water, which lies lower, and the fortress, which has its own ground and depth mask. */
function terrainDepth() {
  if (!WMASK) waterMask();
  // on every node of the height grid, each 0.5 m under the lowest of its neighbours: the plane of a triangle then never
  // rises above the ground drawn over it, which follows the bilinear heights (a grid one node in two did, on the edges
  // of embankments and cuttings, and hid the ground)
  const g = new GB(false), nx = TERR.nx, nz = TERR.nz, s = TERR.s, q = TERR.q, C0 = [0, 0, 0]; g.ensure(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let m = 1e9; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = Math.min(nx - 1, Math.max(0, i + di)), jj = Math.min(nz - 1, Math.max(0, j + dj)); m = Math.min(m, q[jj * nx + ii]); }
    m = Math.min(m, cutFloor(TERR.x0 + i * s, TERR.z0 + j * s) * 10);   // beside the retaining walls of the Latgales cutting
    g.vert(TERR.x0 + i * s, (m - q[j * nx + i]) * 0.1 - 0.5, TERR.z0 + j * s, 0, 1, 0, C0);
  }
  const wet = (x, z) => { const W = WMASK, i = Math.floor((x - W.X0) / W.S), j = Math.floor((z - W.Z0) / W.S); return i >= 0 && j >= 0 && i < W.NX && j < W.NZ && W.m[j * W.NX + i] !== 0; };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const x = TERR.x0 + i * s, z = TERR.z0 + j * s;
    if (FORT.ok && Math.abs(x + s / 2 - FORT.cx) < FORT.R + 60 && Math.abs(z + s / 2 - FORT.cz) < FORT.R + 60) continue;
    let w = false; for (let a = 0; a <= s && !w; a += s / 4) for (let b = 0; b <= s && !w; b += s / 4) w = wet(x + a, z + b); if (w) continue;
    if (inPatch(x, z, x + s, z + s)) continue;   // the fine patch has a depth grid of its own, below
    const k = j * nx + i; g.triUp(k, k + nx, k + 1); g.triUp(k + 1, k + nx, k + nx + 1);
  }
  /* over the fine patch (src/world/underpass.js) a 2 m grid, each node 0.5 m under the lowest ground around it, over
     the cells of the coarse grid it replaces; the water left out as there */
  if (PATCH.on) {
    const S = 2, X0 = TERR.x0 + Math.floor((PATCH.bb[0] - TERR.x0) / s) * s, Z0 = TERR.z0 + Math.floor((PATCH.bb[1] - TERR.z0) / s) * s;
    const X1 = TERR.x0 + Math.ceil((PATCH.bb[2] - TERR.x0) / s) * s, Z1 = TERR.z0 + Math.ceil((PATCH.bb[3] - TERR.z0) / s) * s, NX = Math.round((X1 - X0) / S) + 1, NZ = Math.round((Z1 - Z0) / S) + 1, v0 = g.v;
    g.ensure(NX * NZ);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const x = X0 + i * S, z = Z0 + j * S; let m = 1e9; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m = Math.min(m, terrainH(x + di * S, z + dj * S)); g.vert(x, m - terrainH(x, z) - 0.5, z, 0, 1, 0, C0); }
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const x = X0 + i * S, z = Z0 + j * S; if (wet(x, z) || wet(x + S, z) || wet(x, z + S) || wet(x + S, z + S)) continue; const k = v0 + j * NX + i; g.triUp(k, k + NX, k + 1); g.triUp(k + 1, k + NX, k + NX + 1); }
  }
  const m = g.mesh(new THREE.MeshBasicMaterial({ colorWrite: false })); if (!m) return; m.renderOrder = -60; m.frustumCulled = false; m.castShadow = true; scene.add(m);
}
function buildGround() {
  const bc = hb('#637048'), matBase = groundMaterial(detailTex(0), 1 / 9, 0.5, 'base');
  // far plane under everything, then a grid on the nodes of the height grid over the city
  const far = new GB(false), FN = 41; for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) far.vert(-30000 + i * 1500, -0.4, -30000 + j * 1500, 0, 1, 0, bc);
  for (let j = 0; j < FN - 1; j++) for (let i = 0; i < FN - 1; i++) { const k = j * FN + i; far.triUp(k, k + FN, k + 1); far.triUp(k + 1, k + FN, k + FN + 1); }
  const fm = far.mesh(matBase); fm.renderOrder = -51; fm.frustumCulled = false; fm.receiveShadow = true; scene.add(fm);
  // the base ground over the city: a grid of 400 m squares split where the terrain bends, like the other layers
  const base = new GB(false), BX = Math.ceil(2 * HX / 400), BZ = Math.ceil(2 * HY / 400), bf = [], bt = [];
  for (let j = 0; j <= BZ; j++) for (let i = 0; i <= BX; i++) bf.push(-HX + i * 2 * HX / BX, -HY + j * 2 * HY / BZ);
  for (let j = 0; j < BZ; j++) for (let i = 0; i < BX; i++) { const k = j * (BX + 1) + i; bt.push(k, k + BX + 1, k + 1, k + 1, k + BX + 1, k + BX + 2); }
  const bs = TERR.on ? subTris(bf, bt, 0.25) : { flat: bf, tris: bt };
  base.ensure(bs.flat.length / 2); for (let i = 0; i < bs.flat.length; i += 2) base.vert(bs.flat[i], 0, bs.flat[i + 1], 0, 1, 0, bc);
  for (let t = 0; t < bs.tris.length; t += 3) base.triUp(bs.tris[t], bs.tris[t + 1], bs.tris[t + 2]);
  const gm0 = base.mesh(matBase); gm0.renderOrder = -50; gm0.frustumCulled = false; gm0.receiveShadow = true; scene.add(gm0);
  for (const a of C.a) { const rings = a.slice(1).map(dec); const o = { cls: a[0], rings, bb: bbox(rings[0]) }; AREAS.push(o); if (o.cls === 0) WATER.push(o); }
  AREAS.sort((p, q) => AREA_ORDER.indexOf(p.cls) - AREA_ORDER.indexOf(q.cls));
  const colors = {}; for (const k in AREA_HEX) colors[k] = hb(AREA_HEX[k]);
  const land = new GB(false), wet = [[[], []], [[], []]], bank = new GB(false);   // the water: [positions, indices] with the field of src/world/water.js, then the small ponds
  AREAS.forEach((a, n) => {
    const tr0 = triangulate(a.rings), { flat, tris } = TERR.on ? subTris(tr0.flat, tr0.tris, a.cls === 0 ? 0.4 : 0.25) : tr0;
    if (a.cls === 0) {
      const [wp, wi] = wet[waterDeep(a) ? 0 : 1], v0 = wp.length / 3; for (let i = 0; i < flat.length; i += 2) wp.push(flat[i], TERR.on ? waterLevel(flat[i], flat[i + 1]) - 0.1 - terrainH(flat[i], flat[i + 1]) : WL, flat[i + 1]);
      for (let i = 0; i < tris.length; i += 3) { const A = v0 + tris[i], B = v0 + tris[i + 1], Cc = v0 + tris[i + 2]; const s = (wp[3 * B + 2] - wp[3 * A + 2]) * (wp[3 * Cc] - wp[3 * A]) - (wp[3 * B] - wp[3 * A]) * (wp[3 * Cc + 2] - wp[3 * A + 2]); if (s >= 0) wi.push(A, B, Cc); else wi.push(A, Cc, B); }
      /* the bank down to under the water where the ground stands more than 0.8 m over it; a lower bank is left out: the
         water fades in from it (src/world/water.js), and its wall only drew the straight outline of OSM as a dark line */
      const bcol = hb('#6d6553'), low = (x, z) => TERR.on ? waterLevel(x, z) - 0.5 - terrainH(x, z) : WL - 0.4;
      for (const r0 of a.rings) { const r = TERR.on ? densify(Array.from(r0).concat([r0[0], r0[1]]), 0.3) : r0, m = r.length >> 1; for (let i = 0; i < m; i++) { const j = (i + 1) % m; const x1 = r[2 * i], z1 = r[2 * i + 1], x2 = r[2 * j], z2 = r[2 * j + 1]; if (Math.hypot(x2 - x1, z2 - z1) < 0.05) continue;
        const b1 = low(x1, z1), b2 = low(x2, z2); if (TERR.on && Math.max(b1, b2) > -1.3) continue;
        polyA(bank, [[x1, 0, z1], [x2, 0, z2], [x2, b2, z2], [x1, b1, z1]], sh(bcol, 0.9 + rnd(n, i) * 0.2), 0, 0, 1); } }
      return;
    }
    const v0 = land.v, col = sh(colors[a.cls], 0.94 + rnd(n, 3) * 0.12);
    land.ensure(flat.length / 2);
    for (let i = 0; i < flat.length; i += 2) land.vert(flat[i], 0, flat[i + 1], 0, 1, 0, col);
    for (let i = 0; i < tris.length; i += 3) land.triUp(v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2]);
  });
  const lm = land.mesh(M_LAND); if (lm) { lm.renderOrder = -40; lm.frustumCulled = false; lm.receiveShadow = true; scene.add(lm); }
  if (TERR.on) terrainDepth();
  const bm = bank.mesh(matBank); if (bm) { bm.renderOrder = -39; bm.frustumCulled = false; scene.add(bm); }
  wet.forEach(([wp, wi], k) => {
    if (!wp.length) return;
    const water = new THREE.BufferGeometry(), uv = [], nrm = [];
    for (let i = 0; i < wp.length; i += 3) { uv.push(wp[i] / 24, wp[i + 2] / 24); nrm.push(0, 1, 0); }
    water.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); water.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); water.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    water.setIndex(wi); const wm = new THREE.Mesh(water, k ? waterMat(SMALL_WATER) : waterMat()); wm.renderOrder = -38; wm.frustumCulled = false; scene.add(wm);
  });
}

export { buildGround };
