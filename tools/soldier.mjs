#!/usr/bin/env node
/* Build models/Soldier.glb — the ready soldier of the game (the only player character).

   Body: "S.W.A.T. Operator" by SpatialNeglect (Sketchfab, CC-BY-4.0, uid 9e82fabf26194896b5ad4a364d864eab),
   a Mixamo-rigged special-forces operator: helmet with night-vision goggles, face mask, tactical uniform,
   gloves and boots. The display rifle (non-skinned nodes at the origin), the chest magazines and pouches
   are removed — the game attaches its own weapons to the hands. The skinned body is merged per material,
   decimated, textures compressed to WebP, geometry meshopt-compressed.

   Animations: Mixamo clips uploaded to Sketchfab by fauze (CC-BY-4.0), retargeted onto the operator's rig.
   Both are Mixamo skeletons, so local bone rotations transfer directly; only the Hips needs a root-frame
   correction and a scaled / re-anchored / de-drifted position track. The avatar holds its weapon with two-bone
   IK (src/game/avatar.js) and freezes the arms in the Carry clip's first frame, so locomotion mainly drives legs.
     Idle <- Rifle Idle · Walk <- Pistol Walk · Run <- Pistol Run · Jump <- Jumping · Death <- Falling Back Death.
   Bones are renamed to the names avatar.js already uses (ShoulderL / UpperArmL / LowerArmL / FistL / Head / …).

   Sources (Sketchfab token in sketchfab.token at the repo root, gitignored):
     node tools/sf-dl.mjs 9e82fabf26194896b5ad4a364d864eab <SB>/swat.zip gltf   (then unpack to <SB>/swat/)
     node tools/sf-dl.mjs d9ed346ee92c4606baca727b0ad6ed7b <SB>/clips/rifle-idle.glb
     node tools/sf-dl.mjs 94486ec326714092aec96746e3315c3c <SB>/clips/pistol-walk.glb
     node tools/sf-dl.mjs c2985913ff7a4988b34374af1ee13d28 <SB>/clips/pistol-run.glb
     node tools/sf-dl.mjs 9d8127cec9f04c3db3287cab301b4529 <SB>/clips/jumping.glb
     node tools/sf-dl.mjs 61732876c5ad4d548c433252be7f2d25 <SB>/clips/death-falling.glb

   Run: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
        node tools/soldier.mjs             (writes models/Soldier.glb of this checkout)
        COMPRESS=0 node tools/soldier.mjs  (uncompressed intermediate for testing)
        SB=<dir> OUT=<path> node tools/soldier.mjs  (override sources / output) */
import { NodeIO, Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const COMPRESS = process.env.COMPRESS !== '0';
const SB = process.env.SB || 'C:/Users/igors/AppData/Local/Temp/chatbox-sandbox/edf6b850-2043-474a-ba0e-70b619aa0027/';
const SRC = {
  body: SB + 'swat/x/scene.gltf',
  clips: { Idle: SB + 'clips/rifle-idle.glb', Walk: SB + 'clips/pistol-walk.glb', Run: SB + 'clips/pistol-run.glb', Jump: SB + 'clips/jumping.glb', Death: SB + 'clips/death-falling.glb' },
};
const OUT = process.env.OUT || fileURLToPath(new URL('../models/Soldier.glb', import.meta.url));
const TARGET_TRIS = 40000;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const clean = s => s.replace(/^mixamorig:/, '').replace(/_\d+$/, '');
const RENAME = {
  Hips: 'Hips', Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2', Neck: 'Neck', Head: 'Head', HeadTop_End: 'HeadTop_End',
  LeftShoulder: 'ShoulderL', LeftArm: 'UpperArmL', LeftForeArm: 'LowerArmL', LeftHand: 'FistL',
  RightShoulder: 'ShoulderR', RightArm: 'UpperArmR', RightForeArm: 'LowerArmR', RightHand: 'FistR',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l', LeftToe_End: 'toe_l',
  RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r', RightToe_End: 'toe_r',
};
for (const side of ['Left', 'Right']) { const s = side === 'Left' ? 'l' : 'r';
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) { const fn = f.toLowerCase();
    for (let i = 1; i <= 4; i++) RENAME[`${side}Hand${f}${i}`] = i < 4 ? `${fn}_0${i}_${s}` : `${fn}_end_${s}`; } }
const renamed = n => RENAME[clean(n)] || clean(n);

const qFromM = m => { const q = new THREE.Quaternion(); new THREE.Matrix4().fromArray(m).decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q; };
const qArr = q => [q.x, q.y, q.z, q.w];
const parentNode = n => n.listParents().find(p => p instanceof Node);

function makeSampler(chan) {
  if (!chan) return null;
  const s = chan.getSampler(), times = s.getInput().getArray(), vals = s.getOutput().getArray(), path = chan.getTargetPath();
  const n = times.length, dim = path === 'rotation' ? 4 : 3;
  return t => {
    if (t <= times[0]) return Array.from(vals.slice(0, dim));
    if (t >= times[n - 1]) return Array.from(vals.slice((n - 1) * dim, n * dim));
    let i = 1; while (times[i] < t) i++;
    const a = (t - times[i - 1]) / (times[i] - times[i - 1] || 1), o0 = (i - 1) * dim, o1 = i * dim;
    if (path === 'rotation') { const qa = new THREE.Quaternion().fromArray(vals, o0), qb = new THREE.Quaternion().fromArray(vals, o1); return qArr(qa.slerp(qb, a)); }
    const out = []; for (let k = 0; k < dim; k++) out.push(vals[o0 + k] + (vals[o1 + k] - vals[o0 + k]) * a); return out;
  };
}

// rest-pose skinned height (feet to head) of a document
function restHeight(d) {
  const r = d.getRoot(); let minY = 1e9, maxY = -1e9;
  const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k]; o[c * 4 + rr] = s; } return o; };
  for (const n of r.listNodes()) { const skin = n.getSkin(), mesh = n.getMesh(); if (!skin || !mesh) continue;
    const ibm = skin.getInverseBindMatrices(), M = skin.listJoints().map((j, i) => mul(j.getWorldMatrix(), ibm.getElement(i, [])));
    for (const p of mesh.listPrimitives()) { const P = p.getAttribute('POSITION'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); if (!J || !W) continue;
      const v = [], jj = [], ww = [];
      for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); J.getElement(i, jj); W.getElement(i, ww); let y = 0;
        for (let k = 0; k < 4; k++) { const w = ww[k]; if (!w) continue; const m = M[jj[k]]; y += w * (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]); }
        minY = Math.min(minY, y); maxY = Math.max(maxY, y); } } }
  return maxY - minY;
}

// ---- load body, strip gear, rename bones ----
const doc = await io.read(SRC.body), root = doc.getRoot();
const skin = root.listSkins()[0], joints = skin.listJoints();
// the display rifle and the patch planes are not skinned (they lie at the origin, not on the body);
// the chest magazines (material lambert1.003) and pouches are skinned but carried by the game's own items
const KILL_MATS = new Set(['lambert1.003', 'pouch', 'patch']);
const disposed = new Set();
const disposeTree = n => { if (disposed.has(n)) return; disposed.add(n); for (const c of [...n.listChildren()]) disposeTree(c); const m = n.getMesh(); n.dispose(); if (m && !disposed.has(m)) { disposed.add(m); m.dispose(); } };
for (const n of [...root.listNodes()]) {
  const m = n.getMesh(); if (!m) continue;
  const gear = !n.getSkin() || m.listPrimitives().some(p => KILL_MATS.has(p.getMaterial()?.getName()));
  if (gear) disposeTree(n);
}
for (const a of root.listAnimations()) a.dispose();
for (const j of joints) j.setName(renamed(j.getName()));
const bone = nm => root.listNodes().find(n => n.getName() === nm);
const tgtHeight = restHeight(doc);

// ---- merge skinned primitives per material ----
const groups = new Map();
for (const n of root.listNodes()) { const m = n.getMesh(); if (!m || !n.getSkin()) continue;
  for (const p of m.listPrimitives()) { const key = p.getMaterial()?.getName() || 'none'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); } }
const mergeGroup = prims => {
  const attrs = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].filter(a => prims.every(p => p.getAttribute(a)));
  const counts = prims.map(p => p.getAttribute('POSITION').getCount()), total = counts.reduce((a, b) => a + b, 0);
  const prim = doc.createPrimitive().setMaterial(prims[0].getMaterial()).setMode(prims[0].getMode());
  for (const a of attrs) { const ref = prims[0].getAttribute(a), size = ref.getElementSize();
    const Arr = ref.getArray().constructor, data = new Arr(total * size); let off = 0;
    for (const p of prims) { const arr = p.getAttribute(a).getArray(); data.set(arr, off); off += arr.length; }
    prim.setAttribute(a, doc.createAccessor().setType(ref.getType()).setArray(data)); }
  const idx = []; let base = 0;
  for (let i = 0; i < prims.length; i++) { const ia = prims[i].getIndices(); if (ia) { const arr = ia.getArray(); for (let k = 0; k < arr.length; k++) idx.push(arr[k] + base); } else { for (let k = 0; k < counts[i]; k++) idx.push(base + k); } base += counts[i]; }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)));
  return prim;
};
const armParent = parentNode(joints[0]);
const oldSkinned = root.listNodes().filter(n => n.getMesh() && n.getSkin());
for (const [name, prims] of groups) { const mesh = doc.createMesh(name).addPrimitive(mergeGroup(prims)); const nd = doc.createNode(name).setMesh(mesh).setSkin(skin); armParent.addChild(nd); }
for (const n of oldSkinned) { const m = n.getMesh(); n.dispose(); if (m && !m.listParents().some(p => p.propertyType === 'Node')) m.dispose(); }
for (const m of root.listMeshes()) if (!m.listPrimitives().length) m.dispose();
for (const m of root.listMaterials()) if (!m.listParents().some(p => p.propertyType === 'Primitive')) m.dispose();
console.log('body:', groups.size, 'material groups, height', tgtHeight.toFixed(3));

// ---- retarget clips ----
const FPS = 30;
const ARM_RE = /^(Shoulder[LR]|UpperArm[LR]|LowerArm[LR]|Fist[LR]|(thumb|index|middle|ring|pinky)_)/;
async function retargetClip(srcPath, clipName, { stripRoot = false, armsAbsolute = false } = {}) {
  const sdoc = await io.read(srcPath), sroot = sdoc.getRoot();
  const sjoints = sroot.listSkins()[0].listJoints(), sAnim = sroot.listAnimations()[0];
  const rotS = new Map(), posS = new Map(); let dur = 0;
  for (const c of sAnim.listChannels()) { const nm = clean(c.getTargetNode().getName()), ta = c.getSampler().getInput().getArray(); dur = Math.max(dur, ta[ta.length - 1]);
    if (c.getTargetPath() === 'rotation') rotS.set(nm, makeSampler(c)); else if (c.getTargetPath() === 'translation') posS.set(nm, makeSampler(c)); }
  const sHips = sjoints.find(j => clean(j.getName()) === 'Hips'), sRoot = parentNode(sHips), sRootM = sRoot.getWorldMatrix(), sRootQ = qFromM(sRootM);
  const sRestP = sHips.getTranslation().slice();
  const tHips = bone('Hips'), tRoot = parentNode(tHips), tRootM = tRoot.getWorldMatrix(), tRootQ = qFromM(tRootM);
  const tRestHipsWorld = new THREE.Vector3().fromArray(tHips.getWorldMatrix().slice(12, 15));
  const invTRootM = new THREE.Matrix4().fromArray(tRootM).invert();
  const scale = tgtHeight / restHeight(sdoc);
  const frames = Math.max(2, Math.round(dur * FPS) + 1), times = []; for (let i = 0; i < frames; i++) times.push(i / FPS);
  const anim = doc.createAnimation(clipName);
  // source hierarchy root->leaf; FK helper composing local rotations into world orientations
  const sSet = new Set(sjoints), sOrder = [], sPar = new Map();
  (function rec(j) { sOrder.push(j); sPar.set(j, parentNode(j)); for (const c of j.listChildren()) if (sSet.has(c)) rec(c); })(sHips);
  const fk = localFn => { const w = new Map(); for (const j of sOrder) { const par = sPar.get(j); const pw = w.has(par) ? w.get(par) : sRootQ; w.set(j, pw.clone().multiply(localFn(j))); } return w; };
  const srcRest = fk(j => new THREE.Quaternion().fromArray(j.getRotation()));
  const matched = [], tRestQ = new Map();
  for (const j of sjoints) { const tName = RENAME[clean(j.getName())]; if (!tName) continue; const tNode = bone(tName); if (!tNode) continue; matched.push({ j, tNode }); tRestQ.set(j, qFromM(tNode.getWorldMatrix())); }
  const outs = new Map(matched.map(({ j, tNode }) => [j, { tNode, arr: new Float32Array(frames * 4) }]));
  for (let i = 0; i < frames; i++) {
    const t = times[i];
    const srcAnim = fk(j => { const s = rotS.get(clean(j.getName())); return new THREE.Quaternion().fromArray(s ? s(t) : j.getRotation()); });
    // desired world orientation = source's motion delta from its own rest, applied to the target's rest
    const desired = new Map();
    for (const { j } of matched) { const nm = RENAME[clean(j.getName())];
      // arms: absolute source world orientation (rest poses differ: T-pose vs arms-down, so a motion delta twists them);
      // body: source's motion delta from its own rest, applied to the target's rest (keeps the target's proportions)
      const d = (armsAbsolute && ARM_RE.test(nm)) ? srcAnim.get(j).clone() : srcAnim.get(j).clone().multiply(srcRest.get(j).clone().invert()).multiply(tRestQ.get(j));
      desired.set(j, d); }
    for (const { j } of matched) { const par = sPar.get(j); const pw = (j === sHips) ? tRootQ : desired.get(par);
      outs.get(j).arr.set(qArr(pw.clone().invert().multiply(desired.get(j))), i * 4); }
  }
  for (const { tNode, arr } of outs.values()) {
    const tin = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times));
    const tout = doc.createAccessor().setType('VEC4').setArray(arr);
    const sampler = doc.createAnimationSampler().setInterpolation('LINEAR').setInput(tin).setOutput(tout);
    anim.addSampler(sampler);
    anim.addChannel(doc.createAnimationChannel().setTargetNode(tNode).setTargetPath('rotation').setSampler(sampler));
  }
  // hips translation: scale, re-anchor to target rest height, strip horizontal drift for in-place locomotion
  const posSamp = posS.get(clean(sHips.getName()));
  const world = times.map(t => new THREE.Vector3().fromArray(posSamp ? posSamp(t) : sRestP).applyMatrix4(new THREE.Matrix4().fromArray(sRootM)));
  const rest0 = world[0].clone(); // baseline = animation's first frame (rest pose is origin-centred, anim grounds the character)
  const delta = world.map(v => v.clone().sub(rest0).multiplyScalar(scale));
  if (stripRoot) { const last = delta[delta.length - 1], t0 = times[0], t1 = times[times.length - 1];
    for (let i = 0; i < delta.length; i++) { const f = (times[i] - t0) / (t1 - t0 || 1); delta[i].x -= last.x * f; delta[i].z -= last.z * f; } }
  const out = new Float32Array(frames * 3);
  for (let i = 0; i < frames; i++) { const wp = tRestHipsWorld.clone().add(delta[i]).applyMatrix4(invTRootM); out.set([wp.x, wp.y, wp.z], i * 3); }
  const tin = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times));
  const tout = doc.createAccessor().setType('VEC3').setArray(out);
  const sampler = doc.createAnimationSampler().setInterpolation('LINEAR').setInput(tin).setOutput(tout);
  anim.addSampler(sampler);
  anim.addChannel(doc.createAnimationChannel().setTargetNode(tHips).setTargetPath('translation').setSampler(sampler));
  console.log('clip', clipName, dur.toFixed(2) + 's', frames, 'frames, scale', scale.toFixed(3));
}
await retargetClip(SRC.clips.Idle, 'Idle');
await retargetClip(SRC.clips.Walk, 'Walk', { stripRoot: true });
await retargetClip(SRC.clips.Run, 'Run', { stripRoot: true });
await retargetClip(SRC.clips.Jump, 'Jump', { stripRoot: true });
await retargetClip(SRC.clips.Death, 'Death');
await retargetClip(SRC.clips.Idle, 'Carry', { armsAbsolute: true });   // arms-forward hold pose; avatar.js freezes the arms to its first frame

// ---- decimate + compress ----
if (COMPRESS) {
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() || 0) / 3;
  const ratio = Math.min(1, TARGET_TRIS / tris);
  if (ratio < 1) for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION').getArray(), idx = p.getIndices().getArray();
    const [dst, err] = MeshoptSimplifier.simplify(idx, pos, 3, Math.max(3, Math.floor(idx.length * ratio / 3) * 3), 0.02);
    if (err < 1) { p.getIndices().setArray(dst); }
  }
  // textures -> WebP
  for (const t of root.listTextures()) { const img = t.getImage(); if (!img) continue;
    const meta = await sharp(img).metadata(); const w = Math.min(1024, meta.width || 1024);
    const buf = await sharp(img).resize({ width: w, height: w, fit: 'inside' }).webp({ quality: 82 }).toBuffer();
    t.setImage(buf).setMimeType('image/webp'); }
  await doc.transform(dedup(), prune({ keepExtras: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
}

await io.write(OUT, doc);
let finalTris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) finalTris += (p.getIndices()?.getCount() || 0) / 3;
console.log('wrote', OUT, 'tris', finalTris, 'clips', root.listAnimations().map(a => a.getName()).join(','));
