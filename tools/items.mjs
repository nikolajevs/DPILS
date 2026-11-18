#!/usr/bin/env node
/* Build models/item_{ammo,nade,med}.glb — ready-made props replacing the procedural boxes of the map items.

   Sources (Sketchfab, CC-BY-4.0, attribution in models/README.md):
     ammo  "Soviet Weapons Ammo Crate Box Animated Low Poly" by lil_bentley — lid animation dropped, crate stays closed;
     nade  "M67" by Firewarden — the scene holds two copies (one with the spoon pulled out); the assembled one is kept;
     med   "Medical Kit" by tediuminteractive — white case with the red cross.

   Pipeline: kept primitives are baked into world space and merged per material, re-centred (bottom at y=0, x/z centred)
   and scaled to game size in metres; textures compressed to WebP (1024 px), geometry packed EXT_meshopt_compression.
   Run: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
        node tools/items.mjs            (writes the three glb into models/)
        SRC=<dir> node tools/items.mjs  (folder with ammo-soviet/, nade-m67/, med-tedium/ subfolders, each x/scene.gltf)
   Sources default to <repo>/.claude/items-src (gitignored): unpacked Sketchfab zips, uids in models/README.md;
   downloading needs a Sketchfab account token. COMPRESS=0 skips meshopt. */
import path from 'node:path';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.env.SRC || path.join(ROOT, '.claude', 'items-src');
const OUT = process.env.OUT || path.join(ROOT, 'models');
// target size in metres: the biggest bbox side (ammo: length, med/nade: height)
const JOBS = [
  { kind: 'ammo', dir: 'ammo-soviet', size: 0.55, axis: 'max' },
  { kind: 'nade', dir: 'nade-m67', size: 0.2, axis: 'y', pick: 'assembled' },
  { kind: 'med', dir: 'med-tedium', size: 0.26, axis: 'y' },
];

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const worldPos = n => new THREE.Vector3().fromArray(n.getWorldMatrix().slice(12, 15));
function worldBBox(nodes) {
  const box = new THREE.Box3();
  for (const n of nodes) for (const m of [n.getMesh()]) if (m) for (const p of m.listPrimitives()) {
    const P = p.getAttribute('POSITION'), M = new THREE.Matrix4().fromArray(n.getWorldMatrix());
    const a = [0, 0, 0], v = new THREE.Vector3();
    for (let i = 0; i < P.getCount(); i++) { P.getElement(i, a); box.expandByPoint(v.fromArray(a).applyMatrix4(M)); }
  }
  return box;
}

for (const job of JOBS) {
  const doc = await io.read(`${SRC}/${job.dir}/x/scene.gltf`), root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  let meshNodes = root.listNodes().filter(n => n.getMesh());
  if (job.pick === 'assembled') {
    // two copies of the grenade: parts named X and X.001; keep the copy whose spoon sits on its base
    const sets = ['', '.001'];
    let best = null, bestD = 1e9;
    for (const s of sets) {
      const base = meshNodes.find(n => n.getName().startsWith('m67_base' + s + '_')), spoon = meshNodes.find(n => n.getName().startsWith('m67_spoon' + s + '_'));
      if (!base || !spoon) continue;
      const d = worldBBox([spoon]).getCenter(new THREE.Vector3()).distanceTo(worldBBox([base]).getCenter(new THREE.Vector3()));
      console.log(job.kind, 'set', JSON.stringify(s), 'spoon-base distance', d.toFixed(3));
      if (d < bestD) { bestD = d; best = s; }
    }
    meshNodes = meshNodes.filter(n => n.getName().includes('.001') === (best === '.001'));
  }
  // bake world transforms, merge per material
  const groups = new Map();
  const vb = new THREE.Box3();
  for (const n of meshNodes) {
    const M = new THREE.Matrix4().fromArray(n.getWorldMatrix()), N = new THREE.Matrix3().getNormalMatrix(M);
    for (const p of n.getMesh().listPrimitives()) {
      const key = p.getMaterial()?.getName() || 'none';
      if (!groups.has(key)) groups.set(key, { mat: p.getMaterial(), pos: [], nrm: [], uv: [], idx: [] });
      const g = groups.get(key), P = p.getAttribute('POSITION'), Nr = p.getAttribute('NORMAL'), Uv = p.getAttribute('TEXCOORD_0');
      const base = g.pos.length / 3, a = [0, 0, 0], v = new THREE.Vector3();
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, a); v.fromArray(a).applyMatrix4(M); g.pos.push(v.x, v.y, v.z); vb.expandByPoint(v);
        if (Nr) { Nr.getElement(i, a); v.fromArray(a).applyMatrix3(N).normalize(); g.nrm.push(v.x, v.y, v.z); }
        if (Uv) { Uv.getElement(i, a); g.uv.push(a[0], a[1]); }
      }
      const ia = p.getIndices();
      if (ia) { const arr = ia.getArray(); for (let k = 0; k < arr.length; k++) g.idx.push(arr[k] + base); }
      else for (let k = 0; k < P.getCount(); k++) g.idx.push(base + k);
    }
  }
  const size = vb.getSize(new THREE.Vector3());
  const dim = job.axis === 'y' ? size.y : Math.max(size.x, size.y, size.z);
  const s = job.size / dim;
  const c = vb.getCenter(new THREE.Vector3());
  console.log(job.kind, 'raw size', size.toArray().map(v => +v.toFixed(3)), 'scale', s.toFixed(4), 'groups', groups.size);

  const out = new Document();
  const buffer = out.createBuffer();
  const scene = out.createScene('item');
  for (const [name, g] of groups) {
    const pos = new Float32Array(g.pos.length);
    for (let i = 0; i < g.pos.length; i += 3) { pos[i] = (g.pos[i] - c.x) * s; pos[i + 1] = (g.pos[i + 1] - vb.min.y) * s; pos[i + 2] = (g.pos[i + 2] - c.z) * s; }
    const acc = (type, arr) => out.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const prim = out.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', pos))
      .setIndices(acc('SCALAR', new Uint32Array(g.idx)));
    if (g.nrm.length) prim.setAttribute('NORMAL', acc('VEC3', new Float32Array(g.nrm)));
    if (g.uv.length) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)));
    // material + textures copied across documents, images squeezed to WebP
    const om = out.createMaterial(name);
    const sm = g.mat;
    if (sm) {
      om.setBaseColorFactor(sm.getBaseColorFactor()).setMetallicFactor(sm.getMetallicFactor()).setRoughnessFactor(sm.getRoughnessFactor());
      if (sm.getDoubleSided()) om.setDoubleSided(true);
      const copyTex = async (t, slot) => {
        if (!t) return;
        const img = t.getImage(); if (!img) return;
        const meta = await sharp(img).metadata(); const w = Math.min(1024, meta.width || 1024);
        const buf = await sharp(img).resize({ width: w, height: w, fit: 'inside' }).webp({ quality: 82 }).toBuffer();
        const ot = out.createTexture(name + '_' + slot).setImage(buf).setMimeType('image/webp');
        if (slot === 'base') om.setBaseColorTexture(ot);
        if (slot === 'normal') om.setNormalTexture(ot);
        if (slot === 'mr') om.setMetallicRoughnessTexture(ot);
      };
      await copyTex(sm.getBaseColorTexture(), 'base');
      await copyTex(sm.getNormalTexture(), 'normal');
      await copyTex(sm.getMetallicRoughnessTexture(), 'mr');
    }
    prim.setMaterial(om);
    const mesh = out.createMesh(name).addPrimitive(prim);
    scene.addChild(out.createNode(name).setMesh(mesh));
  }
  await out.transform(dedup(), prune({ keepExtras: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = `${OUT}/item_${job.kind}.glb`;
  await io.write(file, out);
  let tris = 0; for (const m of out.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  console.log('wrote', file, 'tris', tris);
}
