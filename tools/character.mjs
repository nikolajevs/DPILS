#!/usr/bin/env node
/* Build the player characters of the game: models/Soldier.glb, Spartan.glb, Alien.glb, 2B.glb.
   Generalised from tools/soldier.mjs: any rigged body + the same fauze Mixamo clips, retargeted
   by the motion delta from each skeleton's own rest pose (works for Mixamo bodies directly and
   for other humanoid rigs through a bone-name table). The avatar (src/game/avatar.js) holds the
   weapons with two-bone IK and freezes the arms in the Carry clip's first frame.

   Characters (Sketchfab, CC-BY; token in sketchfab.token at the repo root, gitignored):
     swat    S.W.A.T. Operator   9e82fabf26194896b5ad4a364d864eab  SpatialNeglect  -> Soldier.glb
     spartan Spartan Armour MKV  57070b2fd9ff472c8988e76d8c5cbe66  McCarthy3D      -> Spartan.glb
     alien   Free Mixamo model   62990b050faf48dd8590d5d15872857c  JonnyMANSON     -> Alien.glb
     2b      NieR:Automata 2B    cec89dce88cf4b3082c73c07ab5613e7  Negin/LeoZack   -> 2B.glb
   Sources: node tools/sf-dl.mjs <uid> <SB>/<name>.glb   (swat comes as a gltf zip: unpack to <SB>/swat/)
   Clips (fauze, CC-BY): rifle-idle d9ed346ee92c4606baca727b0ad6ed7b, pistol-walk 94486ec326714092aec96746e3315c3c,
     pistol-run c2985913ff7a4988b34374af1ee13d28, jumping 9d8127cec9f04c3db3287cab301b4529,
     death-falling 61732876c5ad4d548c433252be7f2d25  ->  <SB>/clips/<name>.glb

   Run: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
        node tools/character.mjs <swat|spartan|alien|2b|all>
        SB=<dir> OUT=<path> COMPRESS=0 node tools/character.mjs <name>   (overrides) */
import { NodeIO, Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const SB = process.env.SB || 'C:/Users/igors/AppData/Local/Temp/chatbox-sandbox/edf6b850-2043-474a-ba0e-70b619aa0027/';
const COMPRESS = process.env.COMPRESS !== '0';
const TARGET_TRIS = 40000;
const CLIPS = { Idle: SB + 'clips/rifle-idle.glb', Walk: SB + 'clips/pistol-walk.glb', Run: SB + 'clips/pistol-run.glb', Jump: SB + 'clips/jumping.glb', Death: SB + 'clips/death-falling.glb' };

// the standard bone names of avatar.js (MODEL.arms / hand / head)
const STD = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'ShoulderL', 'UpperArmL', 'LowerArmL', 'FistL', 'ShoulderR', 'UpperArmR', 'LowerArmR', 'FistR',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'toe_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r', 'toe_r'];
// Mixamo -> standard (also used to read the fauze clips)
const MIXAMO = { Hips: 'Hips', Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2', Neck: 'Neck', Head: 'Head', HeadTop_End: 'HeadTop_End',
  LeftShoulder: 'ShoulderL', LeftArm: 'UpperArmL', LeftForeArm: 'LowerArmL', LeftHand: 'FistL',
  RightShoulder: 'ShoulderR', RightArm: 'UpperArmR', RightForeArm: 'LowerArmR', RightHand: 'FistR',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l', LeftToe_End: 'toe_l',
  RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r', RightToe_End: 'toe_r' };
for (const side of ['Left', 'Right']) { const s = side === 'Left' ? 'l' : 'r';
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) { const fn = f.toLowerCase();
    for (let i = 1; i <= 4; i++) MIXAMO[`${side}Hand${f}${i}`] = i < 4 ? `${fn}_0${i}_${s}` : `${fn}_end_${s}`; } }
// 3ds Max biped (the 2B file, spaces in names) -> standard; skirt/jaw/breast bones keep their names
const BIPED = { 'root hips': 'Hips', 'spine lower': 'Spine', 'spine middle': 'Spine1', 'spine upper': 'Spine2', 'unused bip spine 3': 'Spine3',
  'head neck lower': 'Neck', 'head neck upper': 'Head',
  'arm left shoulder 1': 'ShoulderL', 'arm left shoulder 2': 'UpperArmL', 'arm left elbow': 'LowerArmL', 'arm left wrist': 'FistL',
  'arm right shoulder 1': 'ShoulderR', 'arm right shoulder 2': 'UpperArmR', 'arm right elbow': 'LowerArmR', 'arm right wrist': 'FistR',
  'leg left thigh': 'thigh_l', 'leg left knee': 'calf_l', 'leg left ankle': 'foot_l', 'leg left toes': 'ball_l', 'unused bip toe l end': 'toe_l',
  'leg right thigh': 'thigh_r', 'leg right knee': 'calf_r', 'leg right ankle': 'foot_r', 'leg right toes': 'ball_r', 'unused bip toe r end': 'toe_r' };
for (const side of ['left', 'right']) { const s = side === 'left' ? 'l' : 'r';
  const fingers = { 1: 'thumb', 2: 'index', 3: 'middle', 4: 'ring', 5: 'pinky' };
  for (const [n, fn] of Object.entries(fingers)) for (const [i, c] of [['a', '01'], ['b', '02'], ['c', '03']]) BIPED[`arm ${side} finger ${n}${i}`] = `${fn}_${c}_${s}`; }

const CHARS = {
  swat: { body: SB + 'swat/x/scene.gltf', out: 'Soldier.glb', map: MIXAMO, killMats: ['lambert1.003', 'pouch', 'patch'], killStatic: true, tint: ['helmet'], camo: ['uniform'] },
  spartan: { body: SB + 'cand/57070b2f.glb', out: 'Spartan.glb', map: MIXAMO, killMats: ['lambert2'], killStatic: true, tint: ['Spartan_Helmet_Mat'], camo: ['Spartan_Chest_Mat', 'Spartan_Arms_Mat', 'Spartan_Legs_Mat', 'Spartan_Shoulders_Mat'] },
  alien: { body: SB + 'cand/62990b05.glb', out: 'Alien.glb', map: MIXAMO, killMats: [], killStatic: true, tint: ['Ch44_Body'], camo: ['Ch44_body1'] },
  '2b': { body: SB + 'cand/cec89dce.glb', out: '2B.glb', map: BIPED, killMats: [], killStatic: true, tint: ['Material_26'], camo: ['Material_25'] },
};

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const clean = s => s.replace(/^mixamorig:/, '').replace(/_\d+$/, '');
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

async function build(name) {
  const cfg = CHARS[name];
  const OUT = process.env.OUT || fileURLToPath(new URL('../models/' + cfg.out, import.meta.url));
  const renamed = n => cfg.map[clean(n)] || clean(n);
  const doc = await io.read(cfg.body), root = doc.getRoot();
  const skin = root.listSkins()[0], joints = skin.listJoints();
  // ---- strip display gear ----
  const KILL_MATS = new Set(cfg.killMats);
  const disposed = new Set();
  const disposeTree = n => { if (disposed.has(n)) return; disposed.add(n); for (const c of [...n.listChildren()]) disposeTree(c); const m = n.getMesh(); n.dispose(); if (m && !disposed.has(m)) { disposed.add(m); m.dispose(); } };
  for (const n of [...root.listNodes()]) {
    const m = n.getMesh(); if (!m) continue;
    const gear = (cfg.killStatic && !n.getSkin()) || m.listPrimitives().some(p => KILL_MATS.has(p.getMaterial()?.getName()));
    if (gear) disposeTree(n);
  }
  for (const a of root.listAnimations()) a.dispose();
  for (const j of joints) j.setName(renamed(j.getName()));
  const bone = nm => root.listNodes().find(n => n.getName() === nm);
  const tgtHeight = restHeight(doc);
  const missing = STD.filter(n => !bone(n));
  if (missing.length) console.log('WARN missing bones:', missing.join(', '));

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
  for (const [mname, prims] of groups) { const mesh = doc.createMesh(mname).addPrimitive(mergeGroup(prims)); const nd = doc.createNode(mname).setMesh(mesh).setSkin(skin); armParent.addChild(nd); }
  for (const n of oldSkinned) { const m = n.getMesh(); n.dispose(); if (m && !m.listParents().some(p => p.propertyType === 'Node')) m.dispose(); }
  for (const m of root.listMeshes()) if (!m.listPrimitives().length) m.dispose();
  for (const m of root.listMaterials()) if (!m.listParents().some(p => p.propertyType === 'Primitive')) m.dispose();
  console.log(name + ':', groups.size, 'material groups, height', tgtHeight.toFixed(3));

  // ---- retarget the fauze clips ----
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
    const sSet = new Set(sjoints), sOrder = [], sPar = new Map();
    (function rec(j) { sOrder.push(j); sPar.set(j, parentNode(j)); for (const c of j.listChildren()) if (sSet.has(c)) rec(c); })(sHips);
    const fk = localFn => { const w = new Map(); for (const j of sOrder) { const par = sPar.get(j); const pw = w.has(par) ? w.get(par) : sRootQ; w.set(j, pw.clone().multiply(localFn(j))); } return w; };
    const srcRest = fk(j => new THREE.Quaternion().fromArray(j.getRotation()));
    // every source joint matched to a target bone by the standard name (source through MIXAMO, target through cfg.map)
    const matched = [], tRestQ = new Map();
    for (const j of sjoints) { const std = MIXAMO[clean(j.getName())]; if (!std) continue; const tNode = bone(std); if (!tNode) continue; matched.push({ j, tNode }); tRestQ.set(j, qFromM(tNode.getWorldMatrix())); }
    const outs = new Map(matched.map(({ j, tNode }) => [j, { tNode, arr: new Float32Array(frames * 4) }]));
    for (let i = 0; i < frames; i++) {
      const t = times[i];
      const srcAnim = fk(j => { const s = rotS.get(clean(j.getName())); return new THREE.Quaternion().fromArray(s ? s(t) : j.getRotation()); });
      const desired = new Map();
      for (const { j } of matched) { const std = MIXAMO[clean(j.getName())];
        const d = (armsAbsolute && ARM_RE.test(std)) ? srcAnim.get(j).clone() : srcAnim.get(j).clone().multiply(srcRest.get(j).clone().invert()).multiply(tRestQ.get(j));
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
    const posSamp = posS.get(clean(sHips.getName()));
    const world = times.map(t => new THREE.Vector3().fromArray(posSamp ? posSamp(t) : sRestP).applyMatrix4(new THREE.Matrix4().fromArray(sRootM)));
    const rest0 = world[0].clone();
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
    console.log(' clip', clipName, dur.toFixed(2) + 's', frames, 'frames, matched', matched.length, 'scale', scale.toFixed(3));
  }
  await retargetClip(CLIPS.Idle, 'Idle');
  await retargetClip(CLIPS.Walk, 'Walk', { stripRoot: true });
  await retargetClip(CLIPS.Run, 'Run', { stripRoot: true });
  await retargetClip(CLIPS.Jump, 'Jump', { stripRoot: true });
  await retargetClip(CLIPS.Death, 'Death');
  await retargetClip(CLIPS.Idle, 'Carry', { armsAbsolute: true });

  // ---- decimate + compress ----
  if (COMPRESS) {
    let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() || 0) / 3;
    const ratio = Math.min(1, TARGET_TRIS / tris);
    if (ratio < 1) for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION').getArray(), idx = p.getIndices().getArray();
      const [dst, err] = MeshoptSimplifier.simplify(idx, pos, 3, Math.max(3, Math.floor(idx.length * ratio / 3) * 3), 0.02);
      if (err < 1) { p.getIndices().setArray(dst); }
    }
    for (const t of root.listTextures()) { const img = t.getImage(); if (!img) continue;
      const meta = await sharp(img).metadata(); const w = Math.min(1024, meta.width || 1024);
      const buf = await sharp(img).resize({ width: w, height: w, fit: 'inside' }).webp({ quality: 82 }).toBuffer();
      t.setImage(buf).setMimeType('image/webp'); }
    await doc.transform(dedup(), prune({ keepExtras: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  }
  await io.write(OUT, doc);
  let finalTris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) finalTris += (p.getIndices()?.getCount() || 0) / 3;
  console.log('wrote', OUT, 'tris', finalTris, 'clips', root.listAnimations().map(a => a.getName()).join(','), 'tint', cfg.tint.join(','), 'camo', cfg.camo.join(','));
}

const which = process.argv[2] || 'all';
for (const name of which === 'all' ? Object.keys(CHARS) : [which]) {
  if (!CHARS[name]) { console.error('unknown character', name); process.exit(1); }
  await build(name);
}
