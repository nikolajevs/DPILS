#!/usr/bin/env node
/* Builds models/fp_ak47.glb, the AK-47 of the game, from the Sketchfab model "FPS Character Animation Pack Ak-47" by
   Cristian David Duque Camacho (DuqueCD7), CC BY 4.0:
   https://sketchfab.com/3d-models/fps-character-animation-pack-ak-47-b95778a564094fc3a49d1d6a3b6a30ab
   The download (glTF, 117 MB) has the arms of a soldier in gloves and a camouflage shirt holding the rifle, rigged, with
   eleven clips, and textures of 4096 px. Here it becomes a file the page can afford:
   - six clips are kept and renamed: idle, walk, run, fire, reload, equip (the aimed ones and the rest pose go);
   - the keys that change nothing are dropped (resample), the textures are scaled down (the rifle's colour and normal
     maps to 2048 px, the rest to 1024) and stored as WebP, the geometry is packed with EXT_meshopt_compression;
   - a node "AK47_static" is added: the rifle alone, baked in its rest pose and simplified to a third of its triangles,
     for the soldiers seen from the side (src/game/avatar.js); the arms and the animated rifle are the view from the eyes
     (src/game/viewmodel.js).
   The download needs a Sketchfab account (the API's /v3/models/<uid>/download with its token). Then:
     npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
     node tools/fp-ak.mjs <unzipped>/scene.gltf models/fp_ak47.glb */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node tools/fp-ak.mjs <scene.gltf> <out.glb>'); process.exit(1); }
const KEEP = { RIG_UE5_Comando_AK_Idle: 'idle', RIG_UE5_Comando_AK_Walk: 'walk', RIG_UE5_Comando_AK__Run: 'run', RIG_UE5_Comando_AK_Fire: 'fire', RIG_UE5_Comando_AK_Reload: 'reload', RIG_UE5_Comando_AK_Equip: 'equip' };
const GUN = /^Material\.00[07]/;   // the materials of the rifle (the wood and the metal)

await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src), root = doc.getRoot();

for (const a of root.listAnimations()) { const k = KEEP[a.getName()]; if (k) a.setName(k); else a.dispose(); }
for (const n of root.listNodes()) if (n.getName() === 'Camera') n.dispose();
for (const m of root.listMaterials()) for (const e of m.listExtensions()) if (e.extensionName === 'KHR_materials_specular') m.setExtension(e.extensionName, null);
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_materials_specular') e.dispose();
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) { const c = p.getAttribute('COLOR_0'); if (c) { p.setAttribute('COLOR_0', null); } }   // near white, only greys the rifle

/* the rifle alone, in its rest pose: every vertex through its joints (rest world matrix × inverse bind matrix) */
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const scene = root.listScenes()[0], gunNode = doc.createNode('AK47_static'), gunMesh = doc.createMesh('AK47_static');
for (const n of root.listNodes()) {
  const skin = n.getSkin(), mesh = n.getMesh(); if (!skin || !mesh) continue;
  if (!mesh.listPrimitives().every(p => GUN.test(p.getMaterial()?.getName() || ''))) continue;
  const ibm = skin.getInverseBindMatrices(), joints = skin.listJoints(), M = joints.map((j, i) => mul(j.getWorldMatrix(), ibm.getElement(i, [])));
  for (const p of mesh.listPrimitives()) {
    const q = doc.createPrimitive().setMaterial(p.getMaterial()).setIndices(p.getIndices().clone());
    const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0');
    const pos = new Float32Array(P.getCount() * 3), nor = new Float32Array(P.getCount() * 3), v = [], nv = [], jj = [], ww = [];
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, v); N.getElement(i, nv); J.getElement(i, jj); W.getElement(i, ww);
      let x = 0, y = 0, z = 0, a = 0, b = 0, c = 0;
      for (let k = 0; k < 4; k++) { const w = ww[k]; if (!w) continue; const m = M[jj[k]];
        x += w * (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]); y += w * (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]); z += w * (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
        a += w * (m[0] * nv[0] + m[4] * nv[1] + m[8] * nv[2]); b += w * (m[1] * nv[0] + m[5] * nv[1] + m[9] * nv[2]); c += w * (m[2] * nv[0] + m[6] * nv[1] + m[10] * nv[2]); }
      const l = Math.hypot(a, b, c) || 1; pos.set([x, y, z], i * 3); nor.set([a / l, b / l, c / l], i * 3);
    }
    q.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(P.getBuffer()));
    q.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(P.getBuffer()));
    q.setAttribute('TEXCOORD_0', p.getAttribute('TEXCOORD_0').clone());
    // simplified to about a third (the skinned rifle keeps every triangle: it is seen from 30 cm)
    const n = q.getIndices().getCount(), [res] = MeshoptSimplifier.simplify(Uint32Array.from(q.getIndices().getArray()), pos, 3, Math.floor(n * 0.35 / 3) * 3, 0.003, []);
    q.getIndices().setArray(P.getCount() > 65535 ? res : Uint16Array.from(res));
    gunMesh.addPrimitive(q);
  }
}
gunNode.setMesh(gunMesh); scene.addChild(gunNode);

// the textures of the file have no names: each is named after its material and slot, so the patterns below can choose
for (const m of root.listMaterials()) for (const [slot, t] of [['base', m.getBaseColorTexture()], ['normal', m.getNormalTexture()], ['mr', m.getMetallicRoughnessTexture()]]) if (t) t.setName(m.getName() + '_' + slot);
await doc.transform(
  resample({ tolerance: 1e-4 }),
  prune({ keepLeaves: false }), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], pattern: /^Material\.00[07]_(base|normal)$/, quality: 88 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], pattern: /^(Material\.00[07]_mr|M_.+)$/, quality: 88 }),
);
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
const tris = m => m.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
for (const m of doc.getRoot().listMeshes()) console.log(m.getName() || '(mesh)', tris(m), 'triangles');
console.log('clips', doc.getRoot().listAnimations().map(a => a.getName()).join(', '));
