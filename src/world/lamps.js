import * as THREE from 'three';
import { LAMPS } from './streets.js';
import { COL, inBuilding, inWater, matPlain } from './data.js';
import { glowTex } from '../render/textures.js';
import { bridgeY, terrainH } from './terrain.js';
import { upNoLamp } from './underpass.js';
import { hook, scene } from '../render/renderer.js';
import { GB, box, lathe } from '../core/geometry.js';
import { hb, lin } from '../core/util.js';

/* ---------- street lamps ----------
   The poles, the heads and the pools of light under them are instanced meshes, one set per square kilometre: a single
   mesh for the whole city could not be culled and drew all its 17 000 lamps (and their shadows) in every frame. */
const LTILE = 1000;
let lampHeads = null, lampPools = null, matHeadDay, matHeadNight;   // the heads and the pools of all tiles (arrays)

function buildLamps() {
  const n = LAMPS.length / 3, ok = [];
  for (let i = 0; i < n; i++) { const x = LAMPS[3 * i], z = LAMPS[3 * i + 1]; if (!inBuilding(x, z) && !inWater(x, z) && !upNoLamp(x, z)) ok.push(i); }
  const pole = new GB(false), PC = hb('#55595c');
  lathe(pole, 0, 0, 0, [[0.11, 0], [0.08, 7.6], [0.06, 8.2]], 6, 0, PC); box(pole, 0.7, 0, 1, 0, 0.75, 0.04, 8.05, 8.15, PC);
  const pg = pole.mesh(matPlain).geometry;
  const head = new THREE.BoxGeometry(0.7, 0.16, 0.32); head.translate(1.35, 7.98, 0);
  const pool = new THREE.PlaneGeometry(1, 1); pool.rotateX(-Math.PI / 2);
  matHeadDay = hook(new THREE.MeshStandardMaterial({ color: lin('#c9cccd'), roughness: 0.4 }));
  matHeadNight = hook(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.55).multiplyScalar(6) }));
  const matPool = new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(1.0, 0.72, 0.4), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const tiles = new Map();
  for (const i of ok) { const k = Math.floor(LAMPS[3 * i] / LTILE) * 1000 + Math.floor(LAMPS[3 * i + 1] / LTILE); let t = tiles.get(k); if (!t) tiles.set(k, t = []); t.push(i); }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), S1 = new THREE.Vector3(1, 1, 1), bx = new THREE.Box3(), bp = new THREE.Vector3();
  lampHeads = []; lampPools = [];
  for (const list of tiles.values()) {
    let cx = 0, cz = 0; for (const i of list) { cx += LAMPS[3 * i]; cz += LAMPS[3 * i + 1]; } cx /= list.length; cz /= list.length;
    const poles = new THREE.InstancedMesh(pg, matPlain, list.length), heads = new THREE.InstancedMesh(head, matHeadDay, list.length), pools = new THREE.InstancedMesh(pool, matPool, list.length);
    bx.makeEmpty();
    list.forEach((i, k) => {
      const x = LAMPS[3 * i], z = LAMPS[3 * i + 1], a = LAMPS[3 * i + 2]; q.setFromAxisAngle(up, a);
      const ld = [Math.cos(a), -Math.sin(a)], by = bridgeY(x, z, ld[0], ld[1]); M.compose(bp.set(x - cx, by, z - cz), q, S1); poles.setMatrixAt(k, M); heads.setMatrixAt(k, M);
      const hx = x + Math.cos(-a) * 1.35, hz = z + Math.sin(-a) * 1.35;
      M.compose(bp.set(hx - cx, 0.06 + bridgeY(hx, hz, ld[0], ld[1]), hz - cz), q, new THREE.Vector3(22, 1, 22)); pools.setMatrixAt(k, M);
      // the culling sphere of the tile: the pools reach 11 m round the head, the poles 8.2 m up; the shaders lift all by the terrain
      const y = by + terrainH(x, z); bx.expandByPoint(bp.set(x - cx - 13, y - 1, z - cz - 13)); bx.expandByPoint(bp.set(x - cx + 13, y + 9, z - cz + 13));
      COL.add(x, z, x + 0.01, z, 0.15, 0);
    });
    const sphere = bx.getBoundingSphere(new THREE.Sphere());
    for (const m of [poles, heads, pools]) { m.position.set(cx, 0, cz); m.boundingSphere = sphere; m.instanceMatrix.needsUpdate = true; scene.add(m); }
    poles.castShadow = true; pools.visible = false; pools.renderOrder = 5;
    lampHeads.push(heads); lampPools.push(pools);
  }
  return ok.length;
}
// the heads glow and the pools of light show at night (and in the evening)
function lampsOn(on) { if (!lampHeads) return; for (const m of lampHeads) m.material = on ? matHeadNight : matHeadDay; for (const m of lampPools) m.visible = on; }

export { buildLamps, lampsOn };
