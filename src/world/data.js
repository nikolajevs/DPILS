import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { seriesAtlas, seriesMaterial } from '../buildings/series.js';
import { facadeMaterial, groundMaterial, roofMaterial, std } from '../render/materials.js';
import { detailTex, facadeAtlas, roofAtlas, waterNormalTex } from '../render/textures.js';
import { hook } from '../render/renderer.js';
import { SegGrid } from '../core/geometry.js';
import { lin, pip } from '../core/util.js';
import { HX, HY } from '../core/env.js';

/* ---------- world data kept for map, collisions and lookups ---------- */
const AREAS = [], LINES = [], BLD = [], WATER = [];
const ROAD = new SegGrid(40), COL = new SegGrid(20), BGRID = new Map(), STREAM = new SegGrid(20);
const TRAMLINES = [];
function inBuilding(x, z) {
  const l = BGRID.get((Math.floor(x / 60) + 2000) * 4096 + Math.floor(z / 60) + 2000); if (!l) return false;
  for (const id of l) { const b = BLD[id], bb = b.bb; if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(x, z, b.ring)) return true; }
  return false;
}
function inWater(x, z) {
  for (const a of WATER) { const bb = a.bb; if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue; if (!pip(x, z, a.rings[0])) continue; let hole = false; for (let k = 1; k < a.rings.length; k++) if (pip(x, z, a.rings[k])) { hole = true; break; } if (!hole) return true; }
  return false;
}
/* trees must not stand in water: a 4 m raster of the water polygons (0 land, 1 water, 2 by a shore) settles most
   points at once; by a shore the polygons are tested exactly with a metre of margin, streams by their drawn width */
let WMASK = null;
function waterMask() {
  const S = 4, X0 = -HX - 8, Z0 = -HY - 8, NX = Math.ceil((2 * HX + 16) / S), NZ = Math.ceil((2 * HY + 16) / S), m = new Uint8Array(NX * NZ);
  for (const a of WATER) {
    const bb = a.bb, j0 = Math.max(0, Math.floor((bb[1] - Z0) / S)), j1 = Math.min(NZ - 1, Math.floor((bb[3] - Z0) / S));
    for (let j = j0; j <= j1; j++) {
      const z = Z0 + (j + 0.5) * S, xs = [];
      for (const r of a.rings) { const n = r.length >> 1; for (let i = 0, k = n - 1; i < n; k = i++) { const zi = r[2 * i + 1], zk = r[2 * k + 1]; if ((zi > z) !== (zk > z)) xs.push(r[2 * i] + (r[2 * k] - r[2 * i]) * (z - zi) / (zk - zi)); } }
      xs.sort((p, q) => p - q);
      for (let q = 0; q + 1 < xs.length; q += 2) { const i0 = Math.max(0, Math.ceil((xs[q] - X0) / S - 0.5)), i1 = Math.min(NX - 1, Math.floor((xs[q + 1] - X0) / S - 0.5)); for (let i = i0; i <= i1; i++) m[j * NX + i] = 1; }
    }
  }
  for (const a of WATER) for (const r of a.rings) { const n = r.length >> 1; for (let i = 0, k = n - 1; i < n; k = i++) {
    const x1 = r[2 * k], z1 = r[2 * k + 1], x2 = r[2 * i], z2 = r[2 * i + 1], steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 1.5));
    for (let s = 0; s <= steps; s++) { const ci = Math.floor((x1 + (x2 - x1) * s / steps - X0) / S), cj = Math.floor((z1 + (z2 - z1) * s / steps - Z0) / S);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = ci + di, jj = cj + dj; if (ii >= 0 && jj >= 0 && ii < NX && jj < NZ) m[jj * NX + ii] = 2; } } } }
  WMASK = { m, S, X0, Z0, NX, NZ };
}
function wetTree(x, z) {
  if (!WMASK) waterMask();
  const W = WMASK, i = Math.floor((x - W.X0) / W.S), j = Math.floor((z - W.Z0) / W.S), v = i >= 0 && j >= 0 && i < W.NX && j < W.NZ ? W.m[j * W.NX + i] : 0;
  if (v === 1) return true;
  if (v === 2 && (inWater(x, z) || inWater(x + 1.2, z) || inWater(x - 1.2, z) || inWater(x, z + 1.2) || inWater(x, z - 1.2))) return true;
  let wet = false; STREAM.near(x, z, 6, (id, d) => { if (d < STREAM.s[id * 6 + 4] + 1.0) wet = true; }); return wet;
}
function onRoad(x, z, margin) { let ok = false; ROAD.near(x, z, 14, (id, d) => { if (d < ROAD.s[id * 6 + 4] + margin) ok = true; }); return ok; }

let matFac, matRoof, matPlain, matGold, matBank, matWater, M_LAND, M_PAVE, M_DIRT, M_BALLAST, M_ASPH, M_MARK, waterNormal;
function makeMaterials() {
  [STATE.facTex, STATE.facMask] = facadeAtlas(); STATE.roofTex = roofAtlas(); waterNormal = waterNormalTex();
  const dGrass = detailTex(0), dAsph = detailTex(1), dPave = detailTex(2), dGravel = detailTex(3);
  matFac = facadeMaterial(); matRoof = roofMaterial(); [STATE.serTex, STATE.serMask] = seriesAtlas(); STATE.matSer = seriesMaterial();
  matPlain = std({ vertexColors: true, roughness: 0.85, metalness: 0 }, 'plain');
  matGold = hook(new THREE.MeshStandardMaterial({ color: lin('#e0b048'), metalness: 1, roughness: 0.25 }));
  matBank = std({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }, 'bank');
  waterNormal.repeat.set(1, 1);
  matWater = hook(new THREE.MeshStandardMaterial({ color: lin('#30474e'), roughness: 0.05, metalness: 0, normalMap: waterNormal, normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 1.1 }));
  M_LAND = groundMaterial(dGrass, 1 / 7, 0.55, 'land'); M_PAVE = groundMaterial(dPave, 1 / 4, 0.5, 'pave'); M_DIRT = groundMaterial(dGrass, 1 / 3, 0.7, 'dirt');
  M_BALLAST = groundMaterial(dGravel, 1 / 2, 0.6, 'ballast'); M_ASPH = groundMaterial(dAsph, 1 / 5, 0.45, 'asph');
  M_MARK = std({ vertexColors: true, roughness: 0.8, metalness: 0, depthWrite: false }, 'mark');
}

export { AREAS, BGRID, BLD, COL, LINES, M_ASPH, M_BALLAST, M_DIRT, M_LAND, M_MARK, M_PAVE, ROAD, STREAM, TRAMLINES, WATER, WMASK, inBuilding, inWater, makeMaterials, matBank, matFac, matGold, matPlain, matRoof, matWater, onRoad, waterMask, waterNormal, wetTree };
