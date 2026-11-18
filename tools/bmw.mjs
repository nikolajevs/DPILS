#!/usr/bin/env node
/* Bakes the city's BMW cars from Sketchfab downloads (all CC BY 4.0, credits in models/README.md) into single-material,
   vertex-coloured GLBs that instance like the procedural cars they replace (src/world/cars.js, src/landmarks/parking.js):
     models/bmw_sedan.glb   BMW M3 G80      by SharkyStudios
     models/bmw_hatch.glb   BMW M140i F20   by Ddiaz Design
     models/bmw_suv.glb     BMW X6M F96     by SharkyStudios
     models/bmw_police.glb  the G80 in Latvian police livery (white, blue band, light bar)
   The download needs a Sketchfab account (API /v3/models/<uid>/download with its token, see sketchfab.token); each zip
   holds scene.gltf + scene.bin + textures/. Unzip them into one directory, then:
     npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
     node tools/bmw.mjs <unzipped-dir> [target-tris]
   Every car leaves here in the city's convention: metres, the nose along +x, the top along +y, the wheels on y = 0 and
   the centre of the footprint at the origin. The paint is baked pure white so a per-instance colour tints only the body
   (src/render/materials.js gates instanceColor on near-white vertices); glass, tyres, chrome, lamps and plates keep
   their own colour. Interior and invisible SketchUp edges are dropped, the rest is decimated with meshoptimizer and
   packed with EXT_meshopt_compression. No runtime textures: the colour of every part is sampled into the vertices. */
import fs from 'node:fs';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const srcDir = process.argv[2] || 'tools/tmp-cars';
const TARGET = +(process.argv[3] || 4000);   // triangles per car after decimation
// clean game-style meshes (a few thousand triangles each) that decimate well; the body skin is the dominant panel,
// the windows are a separate dark material, tyres / chrome / lamps keep their own colour
const CFG = {
  sedan: { dir: 'sedan-g80', out: 'models/bmw_sedan.glb', len: 4.78, rotY: Math.PI / 2, drop: /^none$/, glass: /Material\.020/, paint: /Material\.01[56]/ },
  hatch: { dir: 'hatch-m140', out: 'models/bmw_hatch.glb', len: 4.32, rotY: Math.PI / 2, drop: /interior/i, glass: /iGlass/i, paint: /^iBody1$|iMirror/i },
  suv: { dir: 'suv-x6m', out: 'models/bmw_suv.glb', len: 4.94, rotY: Math.PI, drop: /^none$/, glass: /Material\.002/, paint: /^Material$|Material\.001$/ },
};
const GLASS = [43, 51, 59], WHITE = [255, 255, 255], BAND = [31, 78, 160], BAR = [42, 91, 208], BARW = [201, 205, 209];
const clampByte = v => Math.max(0, Math.min(240, Math.round(v)));   // non-paint stays below the 0.95 paint mask
const srgb = f => Math.round(255 * Math.pow(Math.max(0, Math.min(1, f)), 1 / 2.2));
const rotY = t => [Math.cos(t), 0, -Math.sin(t), 0, 0, 1, 0, 0, Math.sin(t), 0, Math.cos(t), 0, 0, 0, 0, 1];
const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const applyN = (m, x, y, z) => { const a = m[0] * x + m[4] * y + m[8] * z, b = m[1] * x + m[5] * y + m[9] * z, c = m[2] * x + m[6] * y + m[10] * z, l = Math.hypot(a, b, c) || 1; return [a / l, b / l, c / l]; };

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function matInfo(m) {
  const f = m.getBaseColorFactor(), tex = m.getBaseColorTexture();
  let img = null, avg = [f[0], f[1], f[2]];
  if (tex) {
    const buf = Buffer.from(tex.getImage());
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    img = { data, w: info.width, h: info.height, ch: info.channels };
    const a = await sharp(buf).resize(1, 1, { fit: 'fill' }).raw().toBuffer();
    avg = [f[0] * a[0] / 255, f[1] * a[1] / 255, f[2] * a[2] / 255];
  }
  return { name: m.getName() || '', f, alpha: f[3], img, avg, area: 0, cls: null };
}
function sample(img, u, v) {
  const cx = Math.max(0, Math.min(img.w - 1, Math.floor(u * img.w))), cy = Math.max(0, Math.min(img.h - 1, Math.floor(v * img.h)));
  const o = (cy * img.w + cx) * img.ch; return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

async function build(name, police = false) {
  const cfg = { ...CFG[name], out: police ? 'models/bmw_police.glb' : CFG[name].out }, doc = await io.read(`${srcDir}/${cfg.dir}/scene.gltf`), root = doc.getRoot();
  const infos = new Map(), prims = [];
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  // pass A: world-space vertices per primitive, area per material
  for (const n of root.listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue;
    const W = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4) continue;   // triangles only (the SketchUp edges are lines)
      const m = p.getMaterial(); if (!infos.has(m)) infos.set(m, await matInfo(m));
      const info = infos.get(m);
      const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), T = p.getAttribute('TEXCOORD_0'), I = p.getIndices();
      if (!P || !I) continue;
      const pa = P.getArray(), na = N ? N.getArray() : null, ta = T ? T.getArray() : null, ia = I.getArray();
      const cnt = P.getCount(), pos = new Float32Array(cnt * 3), nrm = new Float32Array(cnt * 3), uv = ta ? new Float32Array(cnt * 2) : null;
      for (let i = 0; i < cnt; i++) {
        const w = apply(W, pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
        pos[i * 3] = w[0]; pos[i * 3 + 1] = w[1]; pos[i * 3 + 2] = w[2];
        const nn = na ? applyN(W, na[i * 3], na[i * 3 + 1], na[i * 3 + 2]) : [0, 1, 0];
        nrm[i * 3] = nn[0]; nrm[i * 3 + 1] = nn[1]; nrm[i * 3 + 2] = nn[2];
        if (uv) { uv[i * 2] = ta[i * 2]; uv[i * 2 + 1] = ta[i * 2 + 1]; }
      }
      const idx = Uint32Array.from(ia);
      // area + bounds from kept (non-drop) primitives
      const drop = cfg.drop.test(info.name) || info.alpha < 0.05;
      if (!drop) for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
        info.area += 0.5 * Math.hypot(cx, cy, cz);
        for (const j of [a, b, c]) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[j + k]); mx[k] = Math.max(mx[k], pos[j + k]); }
      }
      prims.push({ pos, nrm, uv, idx, info, drop });
    }
  }
  // classify materials: drop the cabin / inner shells, tint the glass, mark the one body skin as paint, keep the rest
  const list = [...infos.values()];
  for (const info of list) {
    const blackBig = cfg.dropBlackBig && Math.max(...info.f) < 0.06 && info.area > cfg.dropBlackBig;
    if (cfg.drop.test(info.name) || info.alpha < 0.05 || blackBig) { info.cls = 'drop'; continue; }
    const greenish = info.f[1] > 0.8 && info.f[1] > info.f[0] * 1.2 && info.f[1] > info.f[2] * 1.05;
    if (cfg.glass.test(info.name) || greenish || (info.alpha < 0.95 && Math.max(...info.avg) - Math.min(...info.avg) < 0.12)) { info.cls = 'glass'; continue; }
    if (cfg.paint.test(info.name)) { info.cls = 'paint'; continue; }
    info.cls = 'part';
  }
  console.log(`\n== ${name}${police ? ' (police)' : ''} ==  source box ${mn.map(v => +v.toFixed(2))} .. ${mx.map(v => +v.toFixed(2))}`);
  for (const i of list.filter(i => i.cls !== 'drop').sort((a, b) => b.area - a.area)) console.log(`  ${i.cls.padEnd(6)} area=${i.area.toFixed(0).padStart(8)} avg=${i.avg.map(v => +v.toFixed(2))} ${i.name}`);

  // the city frame: centre the footprint, wheels on y = 0, nose on +x, scale to the real length
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2, gy = mn[1];
  const srcLen = Math.max(mx[0] - mn[0], mx[2] - mn[2]), k = cfg.len / srcLen, R = rotY(cfg.rotY);
  const roofH = (mx[1] - gy) * k;
  const pos = [], nrm = [], col = [], idx = []; let voff = 0, srcTris = 0;
  const vert = (x, y, z, nx, ny, nz, c) => { pos.push(x, y, z); nrm.push(nx, ny, nz); col.push(c[0], c[1], c[2]); return voff++; };
  for (const pr of prims) {
    if (pr.drop || pr.info.cls === 'drop') continue;
    const { info } = pr, base = voff;
    for (let i = 0; i < pr.pos.length / 3; i++) {
      const p1x = pr.pos[i * 3] - cx, p1y = pr.pos[i * 3 + 1] - gy, p1z = pr.pos[i * 3 + 2] - cz;
      const p2 = apply(R, p1x, p1y, p1z), x = p2[0] * k, y = p2[1] * k, z = p2[2] * k;
      const n = applyN(R, pr.nrm[i * 3], pr.nrm[i * 3 + 1], pr.nrm[i * 3 + 2]);
      let c;
      if (info.cls === 'paint') c = WHITE;
      else if (info.cls === 'glass') c = GLASS;
      else if (info.img && pr.uv) { const s = sample(info.img, pr.uv[i * 2], pr.uv[i * 2 + 1]); c = [clampByte(s[0] * info.f[0]), clampByte(s[1] * info.f[1]), clampByte(s[2] * info.f[2])]; }
      else c = [clampByte(srgb(info.f[0])), clampByte(srgb(info.f[1])), clampByte(srgb(info.f[2]))];
      vert(x, y, z, n[0], n[1], n[2], c);
    }
    for (let i = 0; i < pr.idx.length; i++) idx.push(base + pr.idx[i]);
    srcTris += pr.idx.length / 3;
  }
  // police light bar on the roof
  if (police) {
    const y0 = roofH - 0.02, y1 = roofH + 0.12, x0 = -0.5, x1 = 0.2, z0 = -0.52, z1 = 0.52;
    const box = (x0, x1, z0, z1, y0, y1, c) => {
      const q = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      const faces = [[0, 1, 2, 3, 0, -1, 0], [4, 7, 6, 5, 0, 1, 0], [0, 4, 5, 1, 0, 0, -1], [2, 6, 7, 3, 0, 0, 1], [1, 5, 6, 2, 1, 0, 0], [3, 7, 4, 0, -1, 0, 0]];
      for (const [a, b, cc, d, nx, ny, nz] of faces) { const i0 = vert(...q[a], nx, ny, nz, c), i1 = vert(...q[b], nx, ny, nz, c), i2 = vert(...q[cc], nx, ny, nz, c), i3 = vert(...q[d], nx, ny, nz, c); idx.push(i0, i1, i2, i0, i2, i3); }
    };
    box(x0, x1, z0, z1, y0, y1, BAR); box(-0.12, 0.12, z0, z1, y0, y1 + 0.01, BARW);
  }

  // weld vertices that share a position and a colour (the SketchUp files export every flat face with its own corners,
  // so without this meshoptimizer has no shared edge to collapse); normals are averaged, the colour stays exact so the
  // paint mask is untouched. Then decimate: surviving vertices keep their colour, the mask stays clean.
  let P = Float32Array.from(pos), N = Float32Array.from(nrm), C = Uint8Array.from(col), I = Uint32Array.from(idx);
  {
    const wm = new Map(), wp = [], wn = [], wc = [], wi = [];
    for (let i = 0; i < I.length; i++) { const o = I[i];
      const key = Math.round(P[o * 3] * 1000) + ',' + Math.round(P[o * 3 + 1] * 1000) + ',' + Math.round(P[o * 3 + 2] * 1000) + '|' + C[o * 3] + ',' + C[o * 3 + 1] + ',' + C[o * 3 + 2];
      let j = wm.get(key);
      if (j === undefined) { j = wp.length / 3; wm.set(key, j); wp.push(P[o * 3], P[o * 3 + 1], P[o * 3 + 2]); wn.push(N[o * 3], N[o * 3 + 1], N[o * 3 + 2]); wc.push(C[o * 3], C[o * 3 + 1], C[o * 3 + 2]); }
      else { wn[j * 3] += N[o * 3]; wn[j * 3 + 1] += N[o * 3 + 1]; wn[j * 3 + 2] += N[o * 3 + 2]; }
      wi.push(j);
    }
    for (let j = 0; j < wn.length / 3; j++) { const l = Math.hypot(wn[j * 3], wn[j * 3 + 1], wn[j * 3 + 2]) || 1; wn[j * 3] /= l; wn[j * 3 + 1] /= l; wn[j * 3 + 2] /= l; }
    P = Float32Array.from(wp); N = Float32Array.from(wn); C = Uint8Array.from(wc); I = Uint32Array.from(wi);
  }
  const target = Math.min(I.length, Math.floor(TARGET * 3 / 3) * 3);
  if (I.length > target) {
    const [res] = MeshoptSimplifier.simplify(I, P, 3, target, 0.03, []);
    const used = new Map(), np = [], nn = [], nc = [], ni = [];
    for (const o of res) { let j = used.get(o); if (j === undefined) { j = np.length / 3; used.set(o, j); np.push(P[o * 3], P[o * 3 + 1], P[o * 3 + 2]); nn.push(N[o * 3], N[o * 3 + 1], N[o * 3 + 2]); nc.push(C[o * 3], C[o * 3 + 1], C[o * 3 + 2]); } ni.push(j); }
    P = Float32Array.from(np); N = Float32Array.from(nn); C = Uint8Array.from(nc); I = Uint32Array.from(ni);
  }
  // police stripe applied after decimation so its edge stays crisp on the final vertices (white paint only)
  if (police) for (let i = 0; i < P.length / 3; i++) {
    if (C[i * 3] === 255 && C[i * 3 + 1] === 255 && C[i * 3 + 2] === 255 && P[i * 3 + 1] > 0.5 && P[i * 3 + 1] < 0.8 && Math.abs(P[i * 3 + 2]) > 0.78) { C[i * 3] = BAND[0]; C[i * 3 + 1] = BAND[1]; C[i * 3 + 2] = BAND[2]; }
  }
  // a fresh document: one mesh, one primitive, one white vertex-coloured material
  const out = new Document(), buf = out.createBuffer();
  const mat = out.createMaterial('car').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0.2).setRoughnessFactor(0.5);
  const prim = out.createPrimitive().setMaterial(mat).setMode(4);
  prim.setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(P).setBuffer(buf));
  prim.setAttribute('NORMAL', out.createAccessor().setType('VEC3').setArray(N).setBuffer(buf));
  prim.setAttribute('COLOR_0', out.createAccessor().setType('VEC3').setArray(C).setBuffer(buf).setNormalized(true));
  prim.setIndices(out.createAccessor().setType('SCALAR').setArray(I).setBuffer(buf));
  const mesh = out.createMesh('bmw').addPrimitive(prim);
  out.createScene('car').addChild(out.createNode('bmw').setMesh(mesh));
  await out.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(cfg.out, out);
  console.log(`  -> ${cfg.out} ${(fs.statSync(cfg.out).size / 1024).toFixed(0)} KB, ${I.length / 3} tris (from ${srcTris}), length ${cfg.len} m, roof ${roofH.toFixed(2)} m`);
}
for (const name of Object.keys(CFG)) await build(name);
await build('sedan', true);
console.log('\ndone.');