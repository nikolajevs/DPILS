import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PARK_RINGS, onPath, parkNoTree } from './parks.js';
import { due, pause } from '../core/pause.js';
import { area2, bbox, hash, pip } from '../core/util.js';
import { inBuilding, inWater, onRoad } from '../world/data.js';
import { scene } from '../render/renderer.js';

/* ---------- the flowers of the parks (ez-tree, MIT, models/ez-tree/) ----------
   Three kinds of flowers instanced over the lawn of every park, gathered by the quarter of the city they stand in, so
   the quarters behind the camera are culled whole. They keep off the footways, the beds, the playgrounds, the water
   and the roads. The flowers of the file are in centimetres and are scaled by a hundredth. They stand at y = 0: the
   terrain lift of the page raises them after the instance matrix, so no height is baked in. */
let models = null;   // the flowers of the files, once loaded (null: not asked for)
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
/* The files are asked for early (while the landmarks are built); the flowers are planted by plantFlora, a step of its
   own in the build (src/main.js), so that the work is on the loading bar and never falls into another step, nor after
   the city is ready. */
function initFlora() {
  if (models || !PARK_RINGS.length) return;
  const L = new GLTFLoader(), grab = f => new Promise(r => L.load(f, g => r(g.scene), undefined, () => r(null)));
  models = Promise.all([grab('models/ez-tree/flower_blue.glb'), grab('models/ez-tree/flower_white.glb'), grab('models/ez-tree/flower_yellow.glb')]);
}
async function plantFlora() { if (models) await build((await models).filter(Boolean)); }
// the places of a park where a flower may stand: a jittered grid, kept off everything that is not lawn; the first
// `need` of them are enough (the flowers take the places of the grid in its order, see build)
async function spots(r, need) {
  const bb = bbox(r), out = [], step = 1.7;
  for (let x = bb[0] + 0.5; x < bb[2]; x += step) {
    if (due()) await pause();
    for (let z = bb[1] + 0.5; z < bb[3]; z += step) {
      const px = x + (hash(x * 3.7 + z * 9.1) - 0.5) * step * 0.9, pz = z + (hash(x * 7.3 + z * 1.9) - 0.5) * step * 0.9;
      if (!pip(px, pz, r) || parkNoTree(px, pz) || onPath(px, pz, 0.4) || inWater(px, pz) || inBuilding(px, pz) || onRoad(px, pz, 0.6)) continue;
      if (hash(px * 13.7 + pz * 5.3) > 0.55) continue;
      out.push([px, pz]); if (out.length >= need) return out;
    }
  }
  return out;
}
async function build(flowers) {
  // a flower of the file is several meshes (petals, leaves, the stem — one material each): every part becomes its own
  // InstancedMesh, and all the parts of a kind share one buffer of matrices, so the whole flower stands together
  const fsets = flowers.map(f => {
    f.updateMatrixWorld(true);
    const parts = [];
    f.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: o.material }); });
    return parts.length ? { parts, list: [] } : null;
  }).filter(Boolean);
  let flowerN = 0;
  for (const r of PARK_RINGS) {
    if (flowerN >= 500 || !fsets.length) break;
    // a few flowers on the lawn: every twelfth place of the grid, at most forty per park and five hundred in the city.
    // Only the places they take are looked for: the first 12·(n − 1) + 6 of the grid (the same as from the whole grid)
    const area = Math.abs(area2(r)) / 2, fn = Math.min(40, Math.round(area * 0.004)); if (!fn) continue;
    const pts = await spots(r, 12 * (fn - 1) + 6);
    for (let i = 0; i < fn && flowerN < 500 && fsets.length; i++) {
      const p = pts[(i * 12 + 5) % pts.length]; if (!p) break;
      const set = fsets[i % fsets.length], h = hash(p[0] * 3.1 + p[1] * 7.7), s = 0.007 + h * 0.004;
      Q.setFromAxisAngle(UP, h * Math.PI * 2); M.compose(V.set(p[0], 0, p[1]), Q, S.set(s, s, s));
      set.list.push(M.clone()); flowerN++;
    }
  }
  for (const set of fsets) {
    if (!set.list.length) continue;
    const buckets = [[], [], [], []];   // the four quarters of the city: each is culled whole when it is behind the camera
    for (const m of set.list) buckets[(m.elements[12] < 0 ? 0 : 1) + (m.elements[14] < 0 ? 0 : 2)].push(m);
    for (const list of buckets) {
      if (!list.length) continue;
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16);
      list.forEach((m, i) => attr.array.set(m.elements, i * 16));
      attr.needsUpdate = true;
      for (const p of set.parts) {
        const im = new THREE.InstancedMesh(p.geo, p.mat, list.length);
        im.instanceMatrix = attr;
        im.computeBoundingSphere(); im.castShadow = false; im.receiveShadow = false; im.userData.noProbe = true; scene.add(im);
      }
    }
  }
}
export { initFlora, plantFlora };
