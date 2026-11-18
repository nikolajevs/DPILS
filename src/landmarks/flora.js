import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PARK_RINGS, onPath, parkNoTree } from './parks.js';
import { area2, bbox, hash, pip } from '../core/util.js';
import { inBuilding, inWater, onRoad } from '../world/data.js';
import { scene } from '../render/renderer.js';

/* ---------- the grass and the flowers of the parks (ez-tree, MIT, models/ez-tree/) ----------
   Tufts of tall grass and three kinds of flowers, instanced over the lawn of every park: one InstancedMesh of grass per
   park (the frustum culls the far parks whole); the flowers are gathered by the quarter of the city they stand in, so
   the quarters behind the camera are culled whole as well. They keep off the footways,
   the beds, the playgrounds, the water and the roads. The grass of the file is two metres tall — it is scaled down to
   knee height; the flowers are in centimetres and are scaled by a hundredth. They stand at y = 0: the terrain lift of
   the page raises them after the instance matrix, so no height is baked in. The grass is alpha-tested, not blended:
   eight thousand tufts must not sort themselves against one another. */
let started = false;
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
function initFlora() {
  if (started || !PARK_RINGS.length) return; started = true;
  const L = new GLTFLoader(), grab = f => new Promise(r => L.load(f, g => r(g.scene), undefined, () => r(null)));
  Promise.all([grab('models/ez-tree/grass.glb'), grab('models/ez-tree/flower_blue.glb'), grab('models/ez-tree/flower_white.glb'), grab('models/ez-tree/flower_yellow.glb')])
    .then(([grass, ...flowers]) => { if (grass) build(grass, flowers.filter(Boolean)); });
}
// the places of a park where a tuft may stand: a jittered grid, kept off everything that is not lawn
function spots(r) {
  const bb = bbox(r), out = [], step = 1.7;
  for (let x = bb[0] + 0.5; x < bb[2]; x += step) for (let z = bb[1] + 0.5; z < bb[3]; z += step) {
    const px = x + (hash(x * 3.7 + z * 9.1) - 0.5) * step * 0.9, pz = z + (hash(x * 7.3 + z * 1.9) - 0.5) * step * 0.9;
    if (!pip(px, pz, r) || parkNoTree(px, pz) || onPath(px, pz, 0.4) || inWater(px, pz) || inBuilding(px, pz) || onRoad(px, pz, 0.6)) continue;
    if (hash(px * 13.7 + pz * 5.3) > 0.55) continue;
    out.push([px, pz]);
  }
  return out;
}
function build(grass, flowers) {
  let gm = null, gg = null;
  grass.traverse(o => { if (o.isMesh && !gm) { gm = o.material; gg = o.geometry; } });
  if (!gm) return;
  const gmat = gm.clone(); gmat.alphaTest = 0.45; gmat.transparent = false; gmat.depthWrite = true; gmat.side = THREE.DoubleSide; gmat.roughness = 1;
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
    const pts = spots(r), area = Math.abs(area2(r)) / 2;
    const cap = Math.min(pts.length, Math.max(40, Math.round(area * 0.05)));
    const keep = pts.filter((_, i) => hash(i * 7.7 + area) < cap / pts.length);
    if (keep.length) {
      const im = new THREE.InstancedMesh(gg, gmat, keep.length);
      keep.forEach(([x, z], i) => {
        const h1 = hash(x * 5.1 + z * 3.3), h2 = hash(x * 9.7 + z * 1.1), s = 0.13 + h1 * 0.15;
        Q.setFromAxisAngle(UP, h2 * Math.PI * 2); M.compose(V.set(x, 0, z), Q, S.set(s, s, s)); im.setMatrixAt(i, M);
        im.setColorAt(i, C.setRGB(0.8 + h1 * 0.4, 0.85 + h2 * 0.3, 0.7 + h1 * 0.25));
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); im.castShadow = false; im.receiveShadow = false; scene.add(im);
    }
    // a few flowers among the grass: every twelfth tuft's place, at most forty per park and five hundred in the city
    const fn = Math.min(40, Math.round(area * 0.004));
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
        im.computeBoundingSphere(); im.castShadow = false; im.receiveShadow = false; scene.add(im);
      }
    }
  }
}
export { initFlora };
