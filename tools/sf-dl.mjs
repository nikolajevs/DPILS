#!/usr/bin/env node
/* Download a model or animation from Sketchfab with the account token (sketchfab.token at the repo root,
   gitignored). The glTF of a model comes as a zip archive — unpack it next to the build script's sources.
     node tools/sf-dl.mjs <uid> <out-file> [glb|gltf|source]
   Examples:
     node tools/sf-dl.mjs 9e82fabf26194896b5ad4a364d864eab swat.zip gltf
     node tools/sf-dl.mjs d9ed346ee92c4606baca727b0ad6ed7b clips/rifle-idle.glb */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const token = readFileSync(fileURLToPath(new URL('../sketchfab.token', import.meta.url)), 'utf8').trim();
const [uid, out, kind = 'glb'] = process.argv.slice(2);
if (!uid || !out) { console.error('usage: node tools/sf-dl.mjs <uid> <out-file> [glb|gltf|source]'); process.exit(1); }
const r = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } });
if (!r.ok) { console.error('HTTP', r.status, await r.text()); process.exit(1); }
const j = await r.json();
const entry = j[kind]; if (!entry) { console.error('no ' + kind + ', have: ' + Object.keys(j)); process.exit(1); }
console.log('downloading', kind, (entry.size / 1048576).toFixed(1), 'MB ...');
const res = await fetch(entry.url);
if (!res.ok) { console.error('fetch HTTP', res.status); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
mkdirSync(out.slice(0, Math.max(0, out.lastIndexOf('/'))), { recursive: true });
writeFileSync(out, buf);
console.log('saved', out, buf.length, 'bytes');
