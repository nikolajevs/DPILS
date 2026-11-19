#!/usr/bin/env node
/* Builds the game's four gun models from Sketchfab downloads (all CC BY 4.0, credits in models/README.md):
     models/fp_shotgun.glb  Remington 870 by Andrei Milin
       https://sketchfab.com/3d-models/none-6db0ad4764d14eee8f063eea3600071b
     models/fp_sniper.glb   SVD Dragunov by WillyG99
       https://sketchfab.com/3d-models/none-d4a9412275aa4974b146ad8ce9dc5fc2
     models/fp_pistol.glb   Makarov PM by Martin Trafas
       https://sketchfab.com/3d-models/none-dbf03ce95c834cb7b07edba799dcd46a
     models/fp_mg.glb       LMG (FN Minimi) by DJMaesen
       https://sketchfab.com/3d-models/none-8c24d7374ea64bdab1c30f49c69d5ed8
   The download needs a Sketchfab account (the API's /v3/models/<uid>/download with its token, see sketchfab.token):
   each zip holds scene.gltf + scene.bin + textures/. Unzip them into one directory, then:
     npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
     node tools/fp-weapons.mjs all <unzipped-dir>
   Every gun leaves here in the game's convention (src/game/avatar.js): metres, the muzzle along +z, the top along +y,
   the grip at the origin. The transform is baked into the vertices while the file's node tree is still whole (disposing
   nodes first corrupts the cached world matrices), and only then the tree is rebuilt around the guns alone. The SVD
   arrives rigged: its vertices are authored in the bind pose the viewer shows, so the skin is stripped, not baked.
   The Makarov arrives on a display floor with a stand, a loose bullet and a suppressor: those go, the pistol stays
   plain. It leaves here tilted as it lay on the stand (rolled 35°, the barrel 30° down and aside): the game levels it
   when it loads it (MODEL.gunAxes in src/game/avatar.js), so a rebuild that levels it here must drop that entry. Textures become WebP (the SVD keeps 2048 px, the rest 1024), geometry is packed with EXT_meshopt_compression. */
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [which, srcDir] = process.argv.slice(2);
if (!which || !srcDir) { console.error('usage: node tools/fp-weapons.mjs <shotgun|sniper|pistol|mg|all> <unzipped-dir>'); process.exit(1); }
const CFG = {
  // grip: the point of the model that becomes the origin; rotY: turns the barrel onto +z; k: scale to metres
  shotgun: { file: 'shotgun/scene.gltf', out: 'models/fp_shotgun.glb', rotY: -Math.PI / 2, grip: [-0.20, 0.045, 0], k: 1, tex: 1024 },
  sniper: { file: 'sniper/scene.gltf', out: 'models/fp_sniper.glb', rotY: 0, grip: [-0.13, 3.19, 0.576], k: 1.225 / 4.207, tex: 2048, stripSkin: true },
  pistol: { file: 'pistol/scene.gltf', out: 'models/fp_pistol.glb', rotY: 0, grip: [0, 0.045, 0.005], k: 1, tex: 1024, drop: ['Floor', 'Stand', 'Makarov_bullet', 'Makarov_suppressor'] },
  mg: { file: 'mg/scene.gltf', out: 'models/fp_mg.glb', rotY: 0, grip: [0, 0.01, 0.047], k: 1, tex: 1024 },
};
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const rotY = t => [Math.cos(t), 0, -Math.sin(t), 0, 0, 1, 0, 0, Math.sin(t), 0, Math.cos(t), 0, 0, 0, 0, 1];
const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

async function build(name) {
  const cfg = CFG[name], doc = await io.read(srcDir + '/' + cfg.file), root = doc.getRoot();
  // the game's frame: metres, muzzle +z, top +y, grip at the origin
  const R = rotY(cfg.rotY), g = cfg.grip, rg = apply(R, g[0], g[1], g[2]);
  const M = [...R]; for (let i = 0; i < 12; i++) M[i] *= cfg.k; M[12] = -cfg.k * rg[0]; M[13] = -cfg.k * rg[1]; M[14] = -cfg.k * rg[2];
  const dropped = n => { for (let p = n; p; p = p.getParentNode()) if ((cfg.drop || []).some(x => (p.getName() || '').startsWith(x))) return true; return false; };
  // bake the frame into the vertices while the tree is whole; remember the gun nodes, leave the display pieces behind
  const scene = root.getDefaultScene() || root.listScenes()[0], keep = [], mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], done = new Set();
  for (const n of root.listNodes()) {
    const mesh = n.getMesh(); if (!mesh || dropped(n)) continue;
    const W = mul(M, n.getWorldMatrix());
    for (const p of mesh.listPrimitives()) {
      for (const attr of ['POSITION', 'NORMAL', 'TANGENT']) {
        const A = p.getAttribute(attr); if (!A || done.has(A)) continue; done.add(A);
        const a = A.getArray(), size = attr === 'TANGENT' ? 4 : 3;
        for (let i = 0; i < A.getCount(); i++) {
          const x = a[i * size], y = a[i * size + 1], z = a[i * size + 2];
          const tx = W[0] * x + W[4] * y + W[8] * z + (attr === 'POSITION' ? W[12] : 0);
          const ty = W[1] * x + W[5] * y + W[9] * z + (attr === 'POSITION' ? W[13] : 0);
          const tz = W[2] * x + W[6] * y + W[10] * z + (attr === 'POSITION' ? W[14] : 0);
          if (attr !== 'POSITION') { const l = Math.hypot(tx, ty, tz) || 1; a[i * size] = tx / l; a[i * size + 1] = ty / l; a[i * size + 2] = tz / l; }
          else { a[i * size] = tx; a[i * size + 1] = ty; a[i * size + 2] = tz;
            mn[0] = Math.min(mn[0], tx); mn[1] = Math.min(mn[1], ty); mn[2] = Math.min(mn[2], tz);
            mx[0] = Math.max(mx[0], tx); mx[1] = Math.max(mx[1], ty); mx[2] = Math.max(mx[2], tz); }
        }
        A.setArray(a);   // the writer recomputes the accessor's min/max from the array, so the bounds follow the vertices
      }
    }
    keep.push(n);
  }
  // the SVD's skin: the vertices already sit in the bind pose the viewer shows (the rest pose of the file is ten times
  // smaller, its OriginalPos clip restores the bind one) — strip the joints and weights, keep the shape
  if (cfg.stripSkin) for (const n of keep) {
    if (!n.getSkin()) continue;
    for (const p of n.getMesh().listPrimitives()) { p.setAttribute('JOINTS_0', null); p.setAttribute('WEIGHTS_0', null); }
    n.setSkin(null);
  }
  // rebuild the scene around the guns alone; the old tree (rig, floor, stand, bullet, suppressor) goes
  const fresh = doc.createScene('gun');
  for (const n of keep) { fresh.addChild(n); n.setMatrix(I4); }
  root.setDefaultScene(fresh); scene.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const a of root.listAnimations()) a.dispose();
  for (const m of root.listMaterials()) for (const e of m.listExtensions()) if (e.extensionName === 'KHR_materials_specular') m.setExtension(e.extensionName, null);
  for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_materials_specular') e.dispose();
  // textures: named after their material and slot, then WebP (the colour and normal maps big, the metal/rough small)
  for (const m of root.listMaterials()) for (const [slot, t] of [['base', m.getBaseColorTexture()], ['normal', m.getNormalTexture()], ['mr', m.getMetallicRoughnessTexture()], ['emissive', m.getEmissiveTexture()]]) if (t) t.setName(m.getName() + '_' + slot);
  const T = cfg.tex;
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [T, T], pattern: /_(base|normal)$/, quality: 85 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [T / 2, T / 2], pattern: /_(mr|emissive)$/, quality: 85 }),
    prune({ keepLeaves: false }), dedup(),
  );
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(cfg.out, doc);
  let tris = 0; for (const n of fresh.listChildren()) for (const p of n.getMesh().listPrimitives()) tris += (p.getIndices()?.getCount() || 0) / 3;
  const r3 = v => v.map(x => +x.toFixed(3));
  console.log(`${name}: ${cfg.out} ${(fs.statSync(cfg.out).size / 1048576).toFixed(2)} MB, ${tris} tris, box mn=${r3(mn)} mx=${r3(mx)}`);
}
for (const name of which === 'all' ? Object.keys(CFG) : [which]) await build(name);
