import * as THREE from 'three';
import { scene } from './renderer.js';
import { sky } from '../world/terrain.js';
import { due, pause } from '../core/pause.js';

/* ---------- the still city in few draw calls ----------
   After the city is built (and its big meshes cut into tiles, src/render/chunks.js) it is a few thousand meshes that
   never move, most of them pieces of one material: the facades, roofs and plain parts of 800 m tiles of houses (and
   their detail, shown near), the ground layers and the street surfaces in tiles of 1.5 km. Each piece in view was a
   draw call of its own — three.js binds its program, its uniforms and its buffers again for every one — and they were
   most of the ~500–650 calls of a frame at eye level, where the frame waits for the processor, not the video card.

   batchStatic puts the pieces of one material (and one set of draw settings) into one THREE.BatchedMesh: one buffer of
   all their vertices, drawn by one multiDrawElements call (WEBGL_multi_draw) that lists the ranges of the pieces in
   view. Every piece is still culled on its own, by the same sphere as before (with the terrain margin of src/main.js),
   for each camera — the screen, the cascades of the sun, the lamp maps, the city cubes. Where the browser lacks
   WEBGL_multi_draw, three draws the ranges one by one, as before.

   The meshes stay in the scene as stand-ins: not drawn any more (no layers, an empty geometry), but code that keeps
   them to show or hide them still works — the detail of far tiles (updateLod in src/render/post.js), what the city
   cubes hide (userData.noProbe). Before each render the batches take the visibility of their stand-ins (with their
   parents), so every pass sees what it saw before.

   Which meshes: what the build of the city added to the scene (not the pools of the game made before it: spoons,
   flashes, arms), plain meshes that stand still in the frame of the city (identity world matrix — every piece of the
   tiles is built in world coordinates), with one material of three's own kind (not a ShaderMaterial), indexed static
   geometry without groups, morphs or draw ranges, no callbacks of their own. Pieces painted over each other without
   depth (transparent, or not writing depth) keep their order: such a material is batched only if no other object of
   that kind shares its renderOrder, so the batch is drawn where its pieces were.
   A stand-in that is moved after all (the safety net of src/render/static-world.js finds it) gets its geometry back
   from the batch and is drawn on its own again: unbatch.

   No matrix texture. A batch reads each piece's matrix from a texture in its vertex shader; the facades and the
   landmark details already use all 16 texture units of a shader, and every piece here has the identity matrix anyway.
   The batching chunks therefore give the identity: no texture is read, none is uploaded. Every BatchedMesh of this
   page is one of these (they are all made here, and only of identity pieces). */
{
  const pars = THREE.ShaderChunk.batching_pars_vertex, k = pars.indexOf('#ifdef USE_BATCHING_COLOR');
  if (k < 0 || !THREE.ShaderChunk.batching_vertex.includes('getBatchingMatrix')) console.warn('three.js: the batching chunks changed; src/render/batch.js keeps them as they are');
  else { THREE.ShaderChunk.batching_pars_vertex = pars.slice(k); THREE.ShaderChunk.batching_vertex = '#ifdef USE_BATCHING\n\tconst mat4 batchingMatrix = mat4( 1.0 );\n#endif\n'; }
}

const STAT = { batches: 0, pieces: 0, geometries: 0, left: 0, given: 0, ms: 0 };
const BATCHES = [];   // { bm, px: the stand-ins, vis: the visibility each instance has now (null: given back) }
const PROXY = new WeakMap();   // stand-in → [its batch, its instance, where its geometry lies in the batch]
const IDENT = new THREE.Matrix4(), EMPTY = new THREE.BufferGeometry(); EMPTY.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); EMPTY.setIndex([]);
const O3 = THREE.Object3D.prototype;
const moving = o => o === sky || o.isLight || o.isCamera || o.userData.moves || o.userData.moverR !== undefined;   // as src/render/static-world.js
const layered = m => m.transparent || !m.depthWrite || !m.depthTest;
// the attributes a piece brings: a batch takes those of its first piece, the others must have the same
const sig = g => Object.keys(g.attributes).sort().map(n => { const a = g.attributes[n]; return n + ':' + a.itemSize + (a.normalized ? 'n' : '') + a.array.constructor.name; }).join(',');

function fits(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh || PROXY.has(o)) return false;
  const m = o.material, g = o.geometry;
  if (!m || Array.isArray(m) || m.isShaderMaterial || m.wireframe || !g || !g.index || !g.index.count || !g.attributes.position) return false;
  if (g.groups.length || g.morphAttributes.position || g.morphAttributes.normal || g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  for (const n in g.attributes) { const a = g.attributes[n]; if (a.isInterleavedBufferAttribute || a.usage !== THREE.StaticDrawUsage) return false; }
  if (o.onBeforeRender !== O3.onBeforeRender || o.onAfterRender !== O3.onAfterRender || o.onBeforeShadow !== O3.onBeforeShadow || o.onAfterShadow !== O3.onAfterShadow) return false;
  if (o.layers.mask !== 1) return false;
  return o.matrixWorld.equals(IDENT);
}

// before: the objects that were in the scene before the city was built (src/main.js). localStorage 'dpils-nobatch'
// set to 1 leaves every piece on its own (to compare)
async function batchStatic(before) {
  try { if (localStorage.getItem('dpils-nobatch') === '1') return 0; } catch (e) {}
  const t0 = performance.now(); let seg = t0, work = 0;
  scene.updateMatrixWorld(true);
  // what stands still, by material and draw settings; and the renderOrders of what is painted without depth
  const groups = new Map(), orders = new Map(), keep = new Set();
  const walk = o => {
    if (moving(o)) return;   // and what hangs on it
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (fits(o)) {
        const m = o.material, k = [m.id, o.renderOrder, o.castShadow, o.receiveShadow, o.frustumCulled, o.customDepthMaterial ? o.customDepthMaterial.id : 0, o.customDistanceMaterial ? o.customDistanceMaterial.id : 0, sig(o.geometry)].join('|');
        let G = groups.get(k); if (!G) groups.set(k, G = { k, list: [] }); G.list.push(o);
        if (layered(m)) { const s = orders.get(o.renderOrder) || new Set(); s.add(k); orders.set(o.renderOrder, s); }
      } else if (o.layers.mask) {   // (a mesh cut into tiles is not drawn itself: src/render/chunks.js)
        if (o.geometry) keep.add(o.geometry);   // drawn as it is: its geometry stays
        if (ms.some(layered)) { const s = orders.get(o.renderOrder) || new Set(); s.add(o); orders.set(o.renderOrder, s); }
      }
    }
    for (const c of o.children) walk(c);
  };
  for (const o of scene.children) if (!before.has(o)) walk(o);
  for (const G of groups.values()) {
    if (G.list.length < 2) continue;
    const m = G.list[0].material, o0 = G.list[0];
    if (layered(m) && orders.get(o0.renderOrder).size > 1) { STAT.left += G.list.length; continue; }   // shares its place in the painting order
    // the geometries in the order they are added: each lies after the previous one in the buffers of the batch
    const geos = new Map(); let nv = 0, ni = 0;
    for (const o of G.list) { const g = o.geometry; if (geos.has(g)) continue; if (!g.boundingSphere) g.computeBoundingSphere(); geos.set(g, { id: -1, v0: nv, vn: g.attributes.position.count, i0: ni, in: g.index.count, sphere: g.boundingSphere.clone() }); nv += g.attributes.position.count; ni += g.index.count; }
    const bm = new THREE.BatchedMesh(G.list.length, nv, ni, m);
    bm.name = 'batch ' + (m.name || m.type) + ' ×' + G.list.length;
    bm.renderOrder = o0.renderOrder; bm.castShadow = o0.castShadow; bm.receiveShadow = o0.receiveShadow;
    bm.frustumCulled = bm.perObjectFrustumCulled = o0.frustumCulled;
    bm.customDepthMaterial = o0.customDepthMaterial; bm.customDistanceMaterial = o0.customDistanceMaterial;
    const B = { bm, px: [], vis: [] };
    for (const o of G.list) {
      if (due()) { work += performance.now() - seg; await pause(); seg = performance.now(); }
      const g = o.geometry, at = geos.get(g);
      if (at.id < 0) { at.id = bm.addGeometry(g); STAT.geometries++; }   // the piece's sphere, the terrain margin included, is the batch's for it
      const id = bm.addInstance(at.id); B.px.push(o); B.vis.push(true);
      if (id !== B.px.length - 1) throw new Error('batch: unexpected instance id');
      PROXY.set(o, [B, id, at]); o.layers.disableAll();
    }
    for (const n in bm.geometry.attributes) bm.geometry.attributes[n].clearUpdateRanges();   // uploaded whole on the first draw
    if (bm.geometry.index) bm.geometry.index.clearUpdateRanges();
    for (const g of geos.keys()) if (!keep.has(g)) g.dispose();
    for (const o of G.list) o.geometry = EMPTY;
    bm.computeBoundingSphere(); bm.computeBoundingBox();
    scene.add(bm); BATCHES.push(B);
    STAT.batches++; STAT.pieces += G.list.length;
  }
  sync();
  STAT.ms = Math.round(work + performance.now() - seg); STAT.wall = Math.round(performance.now() - t0);
  return STAT.batches;
}

// the batches take the visibility of their stand-ins and of the stand-ins' parents (one out of the scene is hidden)
function sync() {
  for (const B of BATCHES) {
    const px = B.px, vis = B.vis;
    for (let i = 0; i < px.length; i++) {
      if (vis[i] === null) continue;
      let o = px[i]; while (o && o !== scene && o.visible) o = o.parent;
      const v = o === scene;
      if (vis[i] !== v) { vis[i] = v; B.bm.setVisibleAt(i, v); }
    }
  }
}
{ const prev = scene.onBeforeRender; scene.onBeforeRender = function (...a) { sync(); return prev.apply(this, a); }; }

// a stand-in drawn on its own again (and the stand-ins under it, which move with it): its geometry copied back out
// of the batch, its instance hidden for good
function unbatch(root) { root.traverse(giveBack); }
function giveBack(o) {
  const r = PROXY.get(o); if (!r) return; PROXY.delete(o);
  const [B, i, at] = r, src = B.bm.geometry, g = new THREE.BufferGeometry();
  for (const n in src.attributes) { const a = src.attributes[n], s = a.itemSize; g.setAttribute(n, new THREE.BufferAttribute(a.array.slice(at.v0 * s, (at.v0 + at.vn) * s), s, a.normalized)); }
  const ix = src.index.array.slice(at.i0, at.i0 + at.in); for (let k = 0; k < ix.length; k++) ix[k] -= at.v0;
  g.setIndex(new THREE.BufferAttribute(ix, 1)); g.boundingSphere = at.sphere.clone();
  o.geometry = g; o.layers.set(0); B.vis[i] = null; B.bm.setVisibleAt(i, false); STAT.given++;
}
const isStandIn = o => PROXY.has(o);

export { STAT as BATCH, batchStatic, isStandIn, unbatch };
