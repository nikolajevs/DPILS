import * as THREE from 'three';
import { FORT } from '../fortress/index.js';
import { AREAS, M_LAND, M_MARK, WATER, WMASK, matBank, waterMask } from './data.js';
import { SMALL_WATER, prepShore, waterDeep, waterMat } from './water.js';
import { AREA_HEX, AREA_ORDER } from './palette.js';
import { groundMaterial } from '../render/materials.js';
import { detailTex } from '../render/textures.js';
import { PATCH, TERR, densify, inPatch, subTrisPaused, terrainH, waterLevel } from './terrain.js';
import { CUT, cutFloor, cutInward, cutTouches } from './cutting.js';
import { scene } from '../render/renderer.js';
import { due, pause, rest } from '../core/pause.js';
import { GB, polyA } from '../core/geometry.js';
import { bbox, dec, hb, rnd, sh, triangulate } from '../core/util.js';
import { C, HX, HY, WL } from '../core/env.js';

/* ---------- ground: land use, water in its bed ---------- */
/* The ground layers are drawn without writing depth, one over the other in their order; a hill must still hide what lies
   behind it. A grid on the height grid, DEEP under the ground, writes depth first (and casts the shadows of the hills); a
   second one, just under the ground, writes it after them for everything else. Both leave out the water, which lies
   lower, and the fortress, which has its own ground and depth mask. */
const DEEP = 0.5, DEEP_MARGIN = 0.1;
let DIP = null;   // per node of the height grid: how much deeper the deep grid goes (noteDips)
/* The ground layers lie within their tol of the ground (subTris: 0.35 m), so above a grid DEEP under it. A triangle
   that got as small as subTris cuts (12 m) can dip deeper under a sharp edge: the grid is lowered under it, on the nodes
   of the cells it touches, by what it dips deeper (dip: per node of the height grid, in metres). */
async function noteDips(flat, tris, dip) {
  const nx = TERR.nx, nz = TERR.nz, s = TERR.s, n = 8;
  for (let t = 0; t < tris.length; t += 3) {
    if ((t & 4095) === 0 && due()) await pause();
    const a = tris[t], b = tris[t + 1], c = tris[t + 2], ax = flat[2 * a], az = flat[2 * a + 1], bx = flat[2 * b], bz = flat[2 * b + 1], cx = flat[2 * c], cz = flat[2 * c + 1];
    if (Math.max(Math.hypot(bx - ax, bz - az), Math.hypot(cx - bx, cz - bz), Math.hypot(ax - cx, az - cz)) > 12.01) continue;
    const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz); if (inPatch(x0, z0, x1, z1)) continue;
    const ha = terrainH(ax, az), hb = terrainH(bx, bz), hc = terrainH(cx, cz); let e = 0;
    for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) { const u = i / n, v = j / n; e = Math.max(e, terrainH(ax + (bx - ax) * u + (cx - ax) * v, az + (bz - az) * u + (cz - az) * v) - ha - (hb - ha) * u - (hc - ha) * v); }
    const d = e + DEEP_MARGIN - DEEP; if (d <= 0) continue;
    for (let j = Math.max(0, Math.floor((z0 - TERR.z0) / s)), j1 = Math.min(nz - 1, Math.ceil((z1 - TERR.z0) / s)); j <= j1; j++)
      for (let i = Math.max(0, Math.floor((x0 - TERR.x0) / s)), i1 = Math.min(nx - 1, Math.ceil((x1 - TERR.x0) / s)); i <= i1; i++) if (dip[j * nx + i] < d) dip[j * nx + i] = d;
  }
}
async function terrainDepth(dip) {
  if (!WMASK) waterMask();
  /* On every node DEEP under the ground, each cell cut along the diagonal that keeps both its triangles under the
     bilinear heights (along the other one the twist of the cell would lift a plane over the ground). It used to lie
     0.5 m under the lowest of the neighbours of a node: on a slope metres down, so the streets and the land use behind a
     hummock, drawn after the ground in front of it, showed through its foot (18. novembra iela by the overpass). Beside
     the Latgales cutting it still does, and under the floor of the cutting: the road there runs under the ground. */
  const g = new GB(false), nx = TERR.nx, nz = TERR.nz, s = TERR.s, q = TERR.q, C0 = [0, 0, 0]; g.ensure(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = TERR.x0 + i * s, z = TERR.z0 + j * s, k = j * nx + i;
    let y = -DEEP - dip[k];
    if (cutTouches([x - s, z - s, x + s, z + s]) && cutInward(x, z)[2] < CUT.BLEND + 2 * s) {
      let m = 1e9; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = Math.min(nx - 1, Math.max(0, i + di)), jj = Math.min(nz - 1, Math.max(0, j + dj)); m = Math.min(m, q[jj * nx + ii]); }
      y = Math.min(y, (Math.min(m, cutFloor(x, z) * 10) - q[k]) * 0.1 - 0.5);
    }
    g.vert(x, y, z, 0, 1, 0, C0);
  }
  /* The deep grid still lets what stands just behind a crest show through it (most of all looking up a slope, and a
     player on a hilltop through the hill). Once the ground layers are drawn a second grid writes depth closer under
     them, TOP_GAP under the ground, cut like the deep one. Only what is drawn after the ground meets it, never the ground
     itself. It leaves out what the deep grid leaves out, and the road of the Latgales cutting, which runs under the grid
     (cutY). */
  await rest(); const TOP_GAP = 0.25, top = new GB(false); top.ensure(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) top.vert(TERR.x0 + i * s, -TOP_GAP, TERR.z0 + j * s, 0, 1, 0, C0);
  const wet = (x, z) => { const W = WMASK, i = Math.floor((x - W.X0) / W.S), j = Math.floor((z - W.Z0) / W.S); return i >= 0 && j >= 0 && i < W.NX && j < W.NZ && W.m[j * W.NX + i] !== 0; };
  /* the cells water touches: the water lies lower, and their grid would hide it. Only those: a cell any part of the 4 m
     margin of the water raster touched was left out, up to 25 m from the water, and through their ground the river
     showed, drawn after everything as it is transparent (over the sidewalk of Daugavas iela on its dam) */
  const touchesWater = (x0, z0, x1, z1) => { const W = WMASK;
    for (let j = Math.max(0, Math.floor((z0 - W.Z0) / W.S)), j1 = Math.min(W.NZ - 1, Math.floor((z1 - W.Z0) / W.S)); j <= j1; j++)
      for (let i = Math.max(0, Math.floor((x0 - W.X0) / W.S)), i1 = Math.min(W.NX - 1, Math.floor((x1 - W.X0) / W.S)); i <= i1; i++) if (W.o[j * W.NX + i]) return true;
    return false; };
  await rest(); const cell = (b, k, tw) => { if (tw) { b.triUp(k, k + 1, k + nx); b.triUp(k + 1, k + nx + 1, k + nx); } else { b.triUp(k, k + 1, k + nx + 1); b.triUp(k, k + nx + 1, k + nx); } };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const x = TERR.x0 + i * s, z = TERR.z0 + j * s;
    if (FORT.ok && Math.abs(x + s / 2 - FORT.cx) < FORT.R + 60 && Math.abs(z + s / 2 - FORT.cz) < FORT.R + 60) continue;
    if (touchesWater(x, z, x + s, z + s)) continue;
    if (inPatch(x, z, x + s, z + s)) continue;   // the fine patch has a depth grid of its own, below
    const k = j * nx + i, tw = q[k] - q[k + 1] - q[k + nx] + q[k + nx + 1] > 0; cell(g, k, tw);
    if (cutTouches([x, z, x + s, z + s]) && cutInward(x + s / 2, z + s / 2)[2] < CUT.BLEND + s) continue;
    cell(top, k, tw);
  }
  await rest(); const tm = top.mesh(new THREE.MeshBasicMaterial({ colorWrite: false })); if (tm) { tm.renderOrder = -29; tm.frustumCulled = false; scene.add(tm); }   // after every ground layer (the last at -30)
  /* over the fine patch (src/world/underpass.js) a 2 m grid, each node 0.5 m under the lowest ground around it, over
     the cells of the coarse grid it replaces; the water left out as there */
  if (PATCH.on) {
    const S = 2, X0 = TERR.x0 + Math.floor((PATCH.bb[0] - TERR.x0) / s) * s, Z0 = TERR.z0 + Math.floor((PATCH.bb[1] - TERR.z0) / s) * s;
    const X1 = TERR.x0 + Math.ceil((PATCH.bb[2] - TERR.x0) / s) * s, Z1 = TERR.z0 + Math.ceil((PATCH.bb[3] - TERR.z0) / s) * s, NX = Math.round((X1 - X0) / S) + 1, NZ = Math.round((Z1 - Z0) / S) + 1, v0 = g.v;
    g.ensure(NX * NZ);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const x = X0 + i * S, z = Z0 + j * S; let m = 1e9; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m = Math.min(m, terrainH(x + di * S, z + dj * S)); g.vert(x, m - terrainH(x, z) - 0.5, z, 0, 1, 0, C0); }
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const x = X0 + i * S, z = Z0 + j * S; if (wet(x, z) || wet(x + S, z) || wet(x, z + S) || wet(x + S, z + S)) continue; const k = v0 + j * NX + i; g.triUp(k, k + NX, k + 1); g.triUp(k + 1, k + NX, k + NX + 1); }
  }
  await rest(); const m = g.mesh(new THREE.MeshBasicMaterial({ colorWrite: false })); if (!m) return; m.renderOrder = -60; m.frustumCulled = false; m.castShadow = true; scene.add(m);
}
async function buildGround() {
  const bc = hb('#637048'), matBase = groundMaterial(detailTex(0), 1 / 9, 0.5, 'base');
  // far plane under everything, then a grid on the nodes of the height grid over the city
  const far = new GB(false), FN = 41; for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) far.vert(-30000 + i * 1500, -0.4, -30000 + j * 1500, 0, 1, 0, bc);
  for (let j = 0; j < FN - 1; j++) for (let i = 0; i < FN - 1; i++) { const k = j * FN + i; far.triUp(k, k + FN, k + 1); far.triUp(k + 1, k + FN, k + FN + 1); }
  const fm = far.mesh(matBase); fm.renderOrder = -51; fm.frustumCulled = false; fm.receiveShadow = true; scene.add(fm);
  /* the base ground over the city: a grid of 400 m squares split where the terrain bends, like the other layers. The base
     ground and the land use lie on the ground to within 0.35 m (the test of subTris is exact: about as many triangles as
     the midpoints of the sides gave at 0.25 m, which let them run metres off it), the water to within 0.4 m */
  const base = new GB(false), BX = Math.ceil(2 * HX / 400), BZ = Math.ceil(2 * HY / 400), bf = [], bt = [];
  for (let j = 0; j <= BZ; j++) for (let i = 0; i <= BX; i++) bf.push(-HX + i * 2 * HX / BX, -HY + j * 2 * HY / BZ);
  for (let j = 0; j < BZ; j++) for (let i = 0; i < BX; i++) { const k = j * (BX + 1) + i; bt.push(k, k + BX + 1, k + 1, k + 1, k + BX + 1, k + BX + 2); }
  const bs = TERR.on ? await subTrisPaused(bf, bt, 0.35) : { flat: bf, tris: bt };
  base.ensure(bs.flat.length / 2); for (let i = 0; i < bs.flat.length; i += 2) base.vert(bs.flat[i], 0, bs.flat[i + 1], 0, 1, 0, bc);
  for (let t = 0; t < bs.tris.length; t += 3) base.triUp(bs.tris[t], bs.tris[t + 1], bs.tris[t + 2]);
  const gm0 = base.mesh(matBase); gm0.renderOrder = -50; gm0.frustumCulled = false; gm0.receiveShadow = true; scene.add(gm0);
  if (TERR.on) { DIP = new Float32Array(TERR.nx * TERR.nz); await noteDips(bs.flat, bs.tris, DIP); }
  for (const a of C.a) { const rings = a.slice(1).map(dec); const o = { cls: a[0], rings, bb: bbox(rings[0]) }; AREAS.push(o); if (o.cls === 0) WATER.push(o); }
  AREAS.sort((p, q) => AREA_ORDER.indexOf(p.cls) - AREA_ORDER.indexOf(q.cls));
  await prepShore();   // the distance from the banks that waterDeep and the water read, in parts (src/world/water.js)
  const colors = {}; for (const k in AREA_HEX) colors[k] = hb(AREA_HEX[k]);
  const land = new GB(false), wet = [[[], []], [[], []]], bank = new GB(false);   // the water: [positions, indices] with the field of src/world/water.js, then the small ponds
  for (let n = 0; n < AREAS.length; n++) {
    if (due()) await pause();
    const a = AREAS[n], tr0 = triangulate(a.rings), { flat, tris } = TERR.on ? await subTrisPaused(tr0.flat, tr0.tris, a.cls === 0 ? 0.4 : 0.35) : tr0;
    if (a.cls === 0) {
      const [wp, wi] = wet[waterDeep(a) ? 0 : 1], v0 = wp.length / 3; for (let i = 0; i < flat.length; i += 2) { if ((i & 4095) === 0 && due()) await pause(); wp.push(flat[i], TERR.on ? waterLevel(flat[i], flat[i + 1]) - 0.1 - terrainH(flat[i], flat[i + 1]) : WL, flat[i + 1]); }
      for (let i = 0; i < tris.length; i += 3) { const A = v0 + tris[i], B = v0 + tris[i + 1], Cc = v0 + tris[i + 2]; const s = (wp[3 * B + 2] - wp[3 * A + 2]) * (wp[3 * Cc] - wp[3 * A]) - (wp[3 * B] - wp[3 * A]) * (wp[3 * Cc + 2] - wp[3 * A + 2]); if (s >= 0) wi.push(A, B, Cc); else wi.push(A, Cc, B); }
      /* the bank down to under the water where the ground stands more than 0.8 m over it; a lower bank is left out: the
         water fades in from it (src/world/water.js), and its wall only drew the straight outline of OSM as a dark line */
      const bcol = hb('#6d6553'), low = (x, z) => TERR.on ? waterLevel(x, z) - 0.5 - terrainH(x, z) : WL - 0.4;
      for (const r0 of a.rings) { const r = TERR.on ? densify(Array.from(r0).concat([r0[0], r0[1]]), 0.3) : r0, m = r.length >> 1; for (let i = 0; i < m; i++) { if ((i & 1023) === 0 && due()) await pause(); const j = (i + 1) % m; const x1 = r[2 * i], z1 = r[2 * i + 1], x2 = r[2 * j], z2 = r[2 * j + 1]; if (Math.hypot(x2 - x1, z2 - z1) < 0.05) continue;
        const b1 = low(x1, z1), b2 = low(x2, z2); if (TERR.on && Math.max(b1, b2) > -1.3) continue;
        polyA(bank, [[x1, 0, z1], [x2, 0, z2], [x2, b2, z2], [x1, b1, z1]], sh(bcol, 0.9 + rnd(n, i) * 0.2), 0, 0, 1); } }
      continue;
    }
    if (TERR.on) await noteDips(flat, tris, DIP);
    const v0 = land.v, col = sh(colors[a.cls], 0.94 + rnd(n, 3) * 0.12);
    land.ensure(flat.length / 2);
    for (let i = 0; i < flat.length; i += 2) land.vert(flat[i], 0, flat[i + 1], 0, 1, 0, col);
    for (let i = 0; i < tris.length; i += 3) land.triUp(v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2]);
  }
  await rest(); const lm = land.mesh(M_LAND); if (lm) { lm.renderOrder = -40; lm.frustumCulled = false; lm.receiveShadow = true; scene.add(lm); }
  const bm = bank.mesh(matBank); if (bm) { bm.renderOrder = -39; bm.frustumCulled = false; scene.add(bm); }
  wet.forEach(([wp, wi], k) => {
    if (!wp.length) return;
    const water = new THREE.BufferGeometry(), uv = [], nrm = [];
    for (let i = 0; i < wp.length; i += 3) { uv.push(wp[i] / 24, wp[i + 2] / 24); nrm.push(0, 1, 0); }
    water.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); water.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); water.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    water.setIndex(wi); const wm = new THREE.Mesh(water, k ? waterMat(SMALL_WATER) : waterMat()); wm.renderOrder = -38; wm.frustumCulled = false; scene.add(wm);
  });
}

/* After the streets, sidewalks, rails and paved grounds (src/world/streets.js, src/landmarks/), the depth grids. Across
   a street its ribbon is straight while the ground may arch under it (up to 1.5 m on a crowned dam): the deep grid is
   lowered there too, so that it does not hide the street. A look at the midpoints of the sides and the middle of each
   of their triangles, and where those come within 0.15 m of what would dip under the grid, the lattice of noteDips. */
async function groundDepth() {
  if (!TERR.on) return;
  const nx = TERR.nx, nz = TERR.nz, s = TERR.s, H = terrainH, n = 8, list = [];
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    const mt = o.material; if (!o.isMesh || !(o.renderOrder > -50 && o.renderOrder < -29.5) || o.renderOrder === -40 || !o.geometry.index || !mt || Array.isArray(mt) || mt.colorWrite === false || mt.transparent || mt === M_MARK) return;   // the markings lie on the asphalt and the sidewalks, which have lowered the grid under them
    list.push(o);
  });
  for (const o of list) {
    const A = o.geometry.attributes.position.array, I = o.geometry.index.array, e = o.matrixWorld.elements, ox = e[12], oy = e[13], oz = e[14];
    for (let t = 0; t < I.length; t += 3) {
      if ((t & 1023) === 0 && due()) await pause();
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2], ax = A[a] + ox, az = A[a + 2] + oz, bx = A[b] + ox, bz = A[b + 2] + oz, cx = A[c] + ox, cz = A[c + 2] + oz;
      const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz); if (inPatch(x0, z0, x1, z1)) continue;
      const ya = A[a + 1] + oy + H(ax, az), yb = A[b + 1] + oy + H(bx, bz), yc = A[c + 1] + oy + H(cx, cz);
      const gap = (u, v) => H(ax + (bx - ax) * u + (cx - ax) * v, az + (bz - az) * u + (cz - az) * v) - ya - (yb - ya) * u - (yc - ya) * v;
      if (Math.max(gap(0.5, 0), gap(0.5, 0.5), gap(0, 0.5), gap(1 / 3, 1 / 3)) < DEEP - DEEP_MARGIN - 0.15) continue;
      let d = 0; for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) d = Math.max(d, gap(i / n, j / n));
      d += DEEP_MARGIN - DEEP; if (d <= 0) continue;
      for (let j = Math.max(0, Math.floor((z0 - TERR.z0) / s)), j1 = Math.min(nz - 1, Math.ceil((z1 - TERR.z0) / s)); j <= j1; j++)
        for (let i = Math.max(0, Math.floor((x0 - TERR.x0) / s)), i1 = Math.min(nx - 1, Math.ceil((x1 - TERR.x0) / s)); i <= i1; i++) if (DIP[j * nx + i] < d) DIP[j * nx + i] = d;
    }
  }
  await rest(); await terrainDepth(DIP);
}

export { buildGround, groundDepth };
