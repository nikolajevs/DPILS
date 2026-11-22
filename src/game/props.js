/* Готовые 3D-модели предметов (ящик патронов, граната, аптечка) — одни шаблоны на предметы на карте и на летящую гранату.
   Модели собраны tools/items.mjs со Sketchfab (CC-BY, атрибуция в models/README.md), ужаты meshopt — декодер как у солдата.
   Пока модель не приехала (или не приедет вовсе), вызывающий рисует свой примитив-фолбэк; onProps дозывает замену. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { worldSpace } from '../render/world-space.js';

const FILES = { ammo: 'models/item_ammo.glb', nade: 'models/item_nade.glb', smoke: 'models/item_smoke.glb', napalm: 'models/item_napalm.glb', med: 'models/item_med.glb', sight: 'models/item_sight.glb', optic: 'models/item_optic.glb' };
const templates = {};
const waiters = [];
let left = Object.keys(FILES).length;
const done = () => { if (--left <= 0) for (const w of waiters.splice(0)) w(); };

import('three/addons/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => {
  const L = new GLTFLoader();
  L.setMeshoptDecoder(MeshoptDecoder);
  for (const [kind, f] of Object.entries(FILES)) L.load(f, g => {
    // геометрия и материалы общие на все клоны: пометка, чтобы чистка предметов их не диспоузила
    g.scene.traverse(o => { if (o.isMesh) { worldSpace(o.material); o.userData.shared = true; } });
    templates[kind] = g.scene;
    done();
  }, undefined, done);
}).catch(() => { left = 1; done(); });

/* клон шаблона или null, если модель ещё/не загрузилась */
function prop(kind) { return templates[kind] ? templates[kind].clone(true) : null; }
/* The grenade taken apart for the hand that throws it (viewmodel.js): the body (with the spoon and the clip) and the pull
   ring with its pin, which the other hand pulls out. The model is one mesh; its parts are the islands of its triangles
   (vertices at the same place joined): the biggest is the body, the ring is the island farthest out to the side (+x), the
   pin the long thin one across the top. Two geometries share the attributes of the model, so nothing is copied but the
   indices; they are made once. null until the model has come; pin null if the islands are not as expected. */
let split = null;
function splitNade() {
  const src = templates.nade; if (!src) return null;
  let mesh = null; src.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
  if (!mesh) return null;
  if (!split) {
    const g = mesh.geometry, P = g.attributes.position, I = g.index ? g.index.array : null, n = P.count;
    if (!I) split = { body: g, pin: null };
    else {
      const par = new Int32Array(n).map((_, i) => i), f = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; }, u = (a, b) => { a = f(a); b = f(b); if (a !== b) par[a] = b; };
      for (let k = 0; k < I.length; k += 3) { u(I[k], I[k + 1]); u(I[k], I[k + 2]); }
      const at = new Map();
      for (let i = 0; i < n; i++) { const key = Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4); const j = at.get(key); if (j === undefined) at.set(key, i); else u(i, j); }
      const box = new Map();
      for (let i = 0; i < n; i++) {
        const r = f(i); let b = box.get(r); if (!b) box.set(r, b = { n: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
        b.n++; const v = [P.getX(i), P.getY(i), P.getZ(i)]; for (let a = 0; a < 3; a++) { if (v[a] < b.min[a]) b.min[a] = v[a]; if (v[a] > b.max[a]) b.max[a] = v[a]; }
      }
      const isl = [...box.entries()].sort((a, b) => b[1].n - a[1].n), body = isl[0];
      const size = b => [0, 1, 2].map(a => b.max[a] - b.min[a]), W = size(body[1])[0];
      const ring = isl.slice(1).filter(([, b]) => (b.min[0] + b.max[0]) / 2 > W * 0.15).sort((a, b) => b[1].max[0] - a[1].max[0])[0];
      const pin = isl.slice(1).find(([, b]) => { const s = size(b); return s[0] > W * 0.35 && s[1] < W * 0.2 && s[2] < W * 0.2; });
      if (!ring || !pin) split = { body: g, pin: null };
      else {
        const out = new Set([ring[0], pin[0]]), bi = [], pi = [];
        for (let k = 0; k < I.length; k += 3) (out.has(f(I[k])) ? pi : bi).push(I[k], I[k + 1], I[k + 2]);
        const part = ix => { const q = new THREE.BufferGeometry(); for (const k in g.attributes) q.setAttribute(k, g.attributes[k]); q.setIndex(ix); q.computeBoundingBox(); q.computeBoundingSphere(); return q; };
        split = { body: part(bi), pin: part(pi) };
      }
    }
  }
  // each part keeps the node of the model above it (its packed scale and place): a clone of the prop with the mesh's geometry swapped
  const make = geo => { const c = src.clone(true); c.traverse(o => { if (o.isMesh) o.geometry = geo; }); return c; };
  return { body: make(split.body), pin: split.pin ? make(split.pin) : null };
}
/* когда все три попытки загрузки закончены (успехом или нет) — заменить фолбэки */
function onProps(cb) { if (left <= 0) cb(); else waiters.push(cb); }

export { prop, onProps, splitNade };
