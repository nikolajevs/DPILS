#!/usr/bin/env node
/* Build models/item_{sight,optic}.glb — the two pick-up scope attachments (red dot + 8x optic).

   Sources (Sketchfab, CC-BY-4.0, attribution in models/README.md):
     sight  "FPS Red Dot Sight (Game Model)" by Michael Makivic — hooded reflex sight, transparent lens;
     optic  "Scope 8x" by ErhanMatur — tactical scope with turrets, rings and flip-up caps.

   Same pipeline as tools/items.mjs: kept primitives baked into world space (with a rotY turn onto the game's
   convention: look direction +z, top +y, mount bottom at y=0, x/z centred), merged per material, scaled to game
   size in metres; textures WebP (1024 px), geometry EXT_meshopt_compression. The same glb serves as the ground
   item and as the attachment mounted on a weapon (real size).
   Run: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
        SRC=<dir> node tools/sights.mjs   (folder with reddot-a/, scope-b/ subfolders, each scene.gltf + textures/)
   COMPRESS=0 skips meshopt. */
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.env.SRC || path.join(ROOT, '.claude', 'sights-src');
const OUT = process.env.OUT || path.join(ROOT, 'models');
// size: longest bbox side in metres (sight ~16 cm, optic ~36 cm); rotY turns the objective lens onto +z
const JOBS = [
  { kind: 'sight', dir: 'reddot-a', size: 0.16, rotY: Math.PI },
  { kind: 'optic', dir: 'scope-b', size: 0.36, rotY: Math.PI / 2 },
];

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

for (const job of JOBS) {
  const doc = await io.read(`${SRC}/${job.dir}/scene.gltf`), root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  const R = new THREE.Matrix4().makeRotationY(job.rotY);
  // bake world transforms (turned onto +z), merge per material
  const groups = new Map();
  const vb = new THREE.Box3();
  for (const n of root.listNodes()) {
    const m = n.getMesh(); if (!m) continue;
    const M = R.clone().multiply(new THREE.Matrix4().fromArray(n.getWorldMatrix()));
    const N = new THREE.Matrix3().getNormalMatrix(M);
    for (const p of m.listPrimitives()) {
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
  const s = job.size / Math.max(size.x, size.y, size.z);
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
    const om = out.createMaterial(name);
    const sm = g.mat;
    if (sm) {
      om.setBaseColorFactor(sm.getBaseColorFactor()).setMetallicFactor(sm.getMetallicFactor()).setRoughnessFactor(sm.getRoughnessFactor());
      om.setAlphaMode(sm.getAlphaMode());   // the reflex lens arrives BLEND — keep it transparent
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
  const tx = [dedup(), prune({ keepExtras: true })];
  if (process.env.COMPRESS !== '0') tx.push(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await out.transform(...tx);
  const file = `${OUT}/item_${job.kind}.glb`;
  await io.write(file, out);
  let tris = 0; for (const m of out.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  console.log('wrote', file, (fs.statSync(file).size / 1024).toFixed(0) + 'KB', 'tris', tris);
}