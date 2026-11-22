#!/usr/bin/env node
/* Build models/cargo.glb — the event supply drop: a crate on a pallet under a ram-air parachute.

   Source (Sketchfab, CC-BY-4.0, attribution in models/README.md):
     "Supply drop with parashute" by hatorya — uid 9d507612169a421db08833fa4646c72e.
     The scene is 627 voxel cubes in three materials: material_0 is the canopy and the suspension lines,
     material_1/2 the crate, its slats, the pallet and the stencil. The two groups become two named nodes,
     'crate' and 'chute', so the page can collapse the parachute onto the crate when it lands (src/game/cargo.js).

   Pipeline (the items.mjs one): world transforms baked, primitives merged per material, the crate re-centred
   (bottom at y=0, x/z centred on the crate itself — the canopy overhangs it) and scaled so the crate stands
   1.35 m tall; textures WebP 1024, geometry EXT_meshopt_compression. The MASK alpha of the voxel textures is kept.
   Run: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
        node tools/sf-dl.mjs 9d507612169a421db08833fa4646c72e .claude/cargo-src/hatorya.zip gltf
        Expand-Archive .claude/cargo-src/hatorya.zip .claude/cargo-src/hatorya   (scene.gltf at the top)
        node tools/cargo.mjs            (writes models/cargo.glb)
        SRC=<dir> node tools/cargo.mjs  (folder with the unpacked hatorya/ … scene.gltf inside)
   Sources default to <repo>/.claude/cargo-src (gitignored). COMPRESS=0 skips meshopt. */
import path from 'node:path';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = process.env.SRC || path.join(ROOT, '.claude', 'cargo-src');
const OUT = process.env.OUT || path.join(ROOT, 'models');
const CRATE_H = 1.35;   // the crate alone, metres; the canopy tops out at ~3 m

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const file = `${SRC}/hatorya/scene.gltf`;
const doc = await io.read(file), root = doc.getRoot();
for (const a of root.listAnimations()) a.dispose();
const meshNodes = root.listNodes().filter(n => n.getMesh());

// bake world transforms, merge per material; material_0 (the white canopy and lines) is the chute, the rest the crate
const groups = new Map();   // part → material → arrays
const boxOf = { crate: new THREE.Box3(), chute: new THREE.Box3() };
for (const n of meshNodes) {
  const M = new THREE.Matrix4().fromArray(n.getWorldMatrix());
  const N = new THREE.Matrix3().getNormalMatrix(M);
  for (const p of n.getMesh().listPrimitives()) {
    const mat = p.getMaterial(), name = mat?.getName() || 'none';
    const part = name === 'material_0' ? 'chute' : 'crate';
    const key = part + '/' + name;
    if (!groups.has(key)) groups.set(key, { part, mat, pos: [], nrm: [], uv: [], idx: [] });
    const g = groups.get(key), P = p.getAttribute('POSITION'), Nr = p.getAttribute('NORMAL'), Uv = p.getAttribute('TEXCOORD_0');
    const base = g.pos.length / 3, a = [0, 0, 0], v = new THREE.Vector3();
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, a); v.fromArray(a).applyMatrix4(M); g.pos.push(v.x, v.y, v.z); boxOf[part].expandByPoint(v);
      if (Nr) { Nr.getElement(i, a); v.fromArray(a).applyMatrix3(N).normalize(); g.nrm.push(v.x, v.y, v.z); }
      if (Uv) { Uv.getElement(i, a); g.uv.push(a[0], a[1]); }
    }
    const ia = p.getIndices();
    if (ia) { const arr = ia.getArray(); for (let k = 0; k < arr.length; k++) g.idx.push(arr[k] + base); }
    else for (let k = 0; k < P.getCount(); k++) g.idx.push(base + k);
  }
}
const cb = boxOf.crate, cs = cb.getSize(new THREE.Vector3()), cc = cb.getCenter(new THREE.Vector3());
const s = CRATE_H / cs.y;
console.log('crate raw', cs.toArray().map(v => +v.toFixed(3)), 'chute raw', boxOf.chute.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)), 'scale', s.toFixed(4));

const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('cargo');
const nodes = { crate: out.createNode('crate'), chute: out.createNode('chute') };
scene.addChild(nodes.crate).addChild(nodes.chute);
for (const [key, g] of groups) {
  const pos = new Float32Array(g.pos.length);
  for (let i = 0; i < g.pos.length; i += 3) { pos[i] = (g.pos[i] - cc.x) * s; pos[i + 1] = (g.pos[i + 1] - cb.min.y) * s; pos[i + 2] = (g.pos[i + 2] - cc.z) * s; }
  const acc = (type, arr) => out.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = out.createPrimitive().setAttribute('POSITION', acc('VEC3', pos)).setIndices(acc('SCALAR', new Uint32Array(g.idx)));
  if (g.nrm.length) prim.setAttribute('NORMAL', acc('VEC3', new Float32Array(g.nrm)));
  if (g.uv.length) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)));
  const om = out.createMaterial(key), sm = g.mat;
  if (sm) {
    const sg = sm.getExtension('KHR_materials_pbrSpecularGlossiness');
    if (sg) om.setBaseColorFactor(sg.getDiffuseFactor()).setMetallicFactor(0).setRoughnessFactor(1 - (sg.getGlossinessFactor() ?? 0.5));
    else om.setBaseColorFactor(sm.getBaseColorFactor()).setMetallicFactor(sm.getMetallicFactor()).setRoughnessFactor(sm.getRoughnessFactor());
    if (sm.getDoubleSided()) om.setDoubleSided(true);
    if (sm.getAlphaMode() === 'MASK') om.setAlphaMode('MASK').setAlphaCutoff(sm.getAlphaCutoff());
    const copyTex = async (t, slot) => {
      if (!t) return;
      const img = t.getImage(); if (!img) return;
      const meta = await sharp(img).metadata(); const w = Math.min(1024, meta.width || 1024);
      const buf = await sharp(img).resize({ width: w, height: w, fit: 'inside' }).webp({ quality: 82 }).toBuffer();
      const ot = out.createTexture(key + '_' + slot).setImage(buf).setMimeType('image/webp');
      if (slot === 'base') om.setBaseColorTexture(ot);
      if (slot === 'normal') om.setNormalTexture(ot);
    };
    await copyTex(sm.getBaseColorTexture() || (sg && sg.getDiffuseTexture()), 'base');
    await copyTex(sm.getNormalTexture(), 'normal');
  }
  prim.setMaterial(om);
  const mesh = out.createMesh(key).addPrimitive(prim);
  nodes[g.part].addChild(out.createNode(key).setMesh(mesh));
}
await out.transform(dedup(), prune({ keepExtras: true }), ...(process.env.COMPRESS === '0' ? [] : [meshopt({ encoder: MeshoptEncoder, level: 'medium' })]));
const dest = `${OUT}/cargo.glb`;
await io.write(dest, out);
let tris = 0; for (const m of out.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
console.log('wrote', dest, 'tris', tris);
