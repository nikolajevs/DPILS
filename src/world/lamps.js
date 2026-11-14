import * as THREE from 'three';
import { LAMPS } from './streets.js';
import { COL, inBuilding, inWater, matPlain } from './data.js';
import { glowTex } from '../render/textures.js';
import { bridgeY } from './terrain.js';
import { hook, scene } from '../render/renderer.js';
import { GB, box, lathe } from '../core/geometry.js';
import { hb, lin } from '../core/util.js';

/* ---------- street lamps ---------- */
let lampHeads, lampPools, matHeadDay, matHeadNight;

function buildLamps() {
  const n = LAMPS.length / 3, ok = [];
  for (let i = 0; i < n; i++) { const x = LAMPS[3 * i], z = LAMPS[3 * i + 1]; if (!inBuilding(x, z) && !inWater(x, z)) ok.push(i); }
  const pole = new GB(false), PC = hb('#55595c');
  lathe(pole, 0, 0, 0, [[0.11, 0], [0.08, 7.6], [0.06, 8.2]], 6, 0, PC); box(pole, 0.7, 0, 1, 0, 0.75, 0.04, 8.05, 8.15, PC);
  const pg = pole.mesh(matPlain).geometry;
  const head = new THREE.BoxGeometry(0.7, 0.16, 0.32); head.translate(1.35, 7.98, 0);
  const pool = new THREE.PlaneGeometry(1, 1); pool.rotateX(-Math.PI / 2);
  const poles = new THREE.InstancedMesh(pg, matPlain, ok.length);
  matHeadDay = hook(new THREE.MeshStandardMaterial({ color: lin('#c9cccd'), roughness: 0.4 }));
  matHeadNight = hook(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.55).multiplyScalar(6) }));
  lampHeads = new THREE.InstancedMesh(head, matHeadDay, ok.length);
  lampPools = new THREE.InstancedMesh(pool, new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(1.0, 0.72, 0.4), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), ok.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), S1 = new THREE.Vector3(1, 1, 1);
  ok.forEach((i, k) => {
    const x = LAMPS[3 * i], z = LAMPS[3 * i + 1], a = LAMPS[3 * i + 2]; q.setFromAxisAngle(up, a);
    const ld = [Math.cos(a), -Math.sin(a)], by = bridgeY(x, z, ld[0], ld[1]); M.compose(new THREE.Vector3(x, by, z), q, S1); poles.setMatrixAt(k, M); lampHeads.setMatrixAt(k, M);
    const hx = x + Math.cos(-a) * 1.35, hz = z + Math.sin(-a) * 1.35;
    M.compose(new THREE.Vector3(hx, 0.06 + bridgeY(hx, hz, ld[0], ld[1]), hz), q, new THREE.Vector3(22, 1, 22)); lampPools.setMatrixAt(k, M);
    COL.add(x, z, x + 0.01, z, 0.15, 0);
  });
  poles.castShadow = true; scene.add(poles, lampHeads, lampPools); lampPools.visible = false; lampPools.renderOrder = 5;
  return ok.length;
}

export { buildLamps, lampHeads, lampPools, matHeadDay, matHeadNight };
