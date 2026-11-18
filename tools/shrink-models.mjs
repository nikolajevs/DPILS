#!/usr/bin/env node
/* Re-encode the textures inside the ready models/*.glb to smaller WebP — the geometry is already packed with
   EXT_meshopt_compression, the remaining weight of fp_ak47.glb & co is the 2048×2048 texture images.

   Run: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
        node tools/shrink-models.mjs                 (all models/*.glb; a file is rewritten only if it got >5% smaller)
        node tools/shrink-models.mjs fp_ak47.glb …   (only the named files)
   Q=80    WebP quality (default 80; the sources were encoded near-lossless, 80 keeps the look at close range)
   MAX=0   optional cap on the texture side in px (0 = keep the resolution; e.g. MAX=1024 also downscales 2048²)
   An image is replaced only when the new bytes are <80% of the old ones, so already-tight textures stay intact.
   Animations, skins and materials round-trip through gltf-transform unchanged; meshopt is re-applied on write. */
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'models');
const Q = +(process.env.Q || 80), MAX = +(process.env.MAX || 0);
const names = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(DIR).filter(f => f.endsWith('.glb'));

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const kb = n => (n / 1024).toFixed(0) + 'KB';

for (const name of names) {
  const file = path.join(DIR, name);
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  let saved = 0, touched = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img || !img.length) continue;
    let pipe = sharp(img);
    const m = await pipe.metadata();
    if (MAX && Math.max(m.width, m.height) > MAX) pipe = pipe.resize({ width: MAX, height: MAX, fit: 'inside' });
    const out = await pipe.webp({ quality: Q, effort: 6 }).toBuffer();
    if (out.length < img.length * 0.8) { tex.setImage(out).setMimeType('image/webp'); saved += img.length - out.length; touched++; }
  }
  if (!touched) { console.log(`${name}: textures already tight (${kb(before)}), skipped`); continue; }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = await io.writeBinary(doc);
  if (glb.length < before * 0.95) {
    fs.writeFileSync(file, glb);
    console.log(`${name}: ${kb(before)} -> ${kb(glb.length)} (${touched} texture(s) re-encoded, -${kb(before - glb.length)})`);
  } else {
    console.log(`${name}: re-encoding saved too little (${kb(before)} -> ${kb(glb.length)}), kept as is`);
  }
}
