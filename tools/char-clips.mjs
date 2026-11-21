#!/usr/bin/env node
/* Retarget the body clips of the player characters (models/Soldier.glb, Spartan.glb, Alien.glb, 2B.glb) and mark every
   step clip with how fast it walks and where its steps fall. Replaces the clips tools/character.mjs put in (Idle, Walk,
   Run, Jump, Death; Carry, the arms of the hold, stays as it is) and adds the directional and crouched ones.

   Why again: character.mjs carried the turn of each joint from the rest pose of the source onto the rest pose of the
   target as the target's nodes have it. But those node poses are not a T-pose: they are a frame of whatever animation the
   Sketchfab file came with — the Spartan stands with bent knees, 2B half sits with her arms up. Every clip inherited the
   difference: bent-kneed Spartans, and a 2B whose legs flew out sideways in the walk and floated in a crouch. Here the
   rest of both sides is the bind pose of the skin (the inverse bind matrices: a clean T- or A-pose, legs straight, the
   axes of the world), the turns are put on the target's own hierarchy (2B has a fourth spine bone the Mixamo clips do
   not know), and the height of the hips is found so that the lowest foot of the target is as high over the ground as
   the source's is: the feet stand on the ground in every frame, whatever the length of the legs.

     Idle             standing with a rifle             "Rifle Idle"                     fauze             d9ed346ee92c4606baca727b0ad6ed7b
     Walk, Run        forwards                          "ST Pistol Walk" / "ST Pistol Run" fauze           94486ec326714092aec96746e3315c3c / c2985913ff7a4988b34374af1ee13d28
     Jump, Death                                        "Jumping" / "Falling Back Death(1)" fauze          9d8127cec9f04c3db3287cab301b4529 / 61732876c5ad4d548c433252be7f2d25
     WalkL, WalkR     side-steps at a walk              "Walk Left" / "Walk Right"       fauze             78cb1d884e43412e9f3ed7a73ae5424f / 9a272afe0d3f442e886d2c1a2b1ba1d5
     WalkB            walking backwards                 "Walking Backwards"              Appsbypaulhamilton 244e1a6443bd43019243e13713ebbf58
     RunL, RunR       jogging strafes (R: L mirrored)   "Synth Strafe Left 2.0"          vadimfedenko      10c339229d6d4f3f9344aa6d6c46711a
     RunB             running backwards                 "Synth Running Backward 2.0"     vadimfedenko      794a943660ee4b0f92c4db8d8874c43a
     Crouch           kneeling, aiming                  "ST Idle Crouching Aiming"       fauze             f2cf924280234133abb31688626a597f
     CrouchF          crouched walk forwards            "Crouched Walking"               merks11           a06d785a52184d7e86f77debcbc18e51
     CrouchL, CrouchR crouched side-steps (R mirrored)  "Crouched Sneaking Left"         roffa             f2f87e2623c547b489d761cff0948d81
   all CC BY 4.0 on Sketchfab (credits in models/README.md). Download each with tools/sf-dl.mjs into one folder under the
   file name of SRC below (rifle-idle.glb, pistol-walk.glb, …).

   The step clips get glTF extras, which three.js hands to clip.userData:
     speed  the ground speed of the clip as it plays, in units of the file's scene per second (the page multiplies by the
            scale it gives the figure). A source that walks over the ground has its exact drift; the target walks it a
            little faster or slower by the length of its legs, so the drift is scaled by the speed of the target's planted
            foot over the source's. A source that walks in place: the planted foot of the target, +10 % (measured on the
            sources that walk over the ground, the foot comes out ~9 % short: it rolls a little even mid-stance);
     plant  the phase (0…1) when the left foot is farthest along the direction of travel: it is put down;
     lift   the phase when it is farthest the other way: it is lifted (a clip played backwards puts it down there);
     dir    the direction of travel in the file's frame [x, z] (+z forward, +x the figure's left).
   The jump gets { takeoff, apex, land }: the seconds when its feet leave the ground, are highest and touch down again.
   avatar.js plays all the step clips of a blend on one phase, each shifted by its plant, so the feet of the blended
   clips land together, and at the rate the speed of the player asks for, so they do not slide.

   Run: npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer three@0.187.0
        node tools/char-clips.mjs <clips dir> [Soldier Spartan Alien 2B]
        MODELS=<dir> overrides the folder of the models (they are rewritten in place). */
import { NodeIO, Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { fileURLToPath } from 'node:url';

const [SRC_DIR, ...which] = process.argv.slice(2);
if (!SRC_DIR) { console.error('usage: node tools/char-clips.mjs <clips dir> [Soldier Spartan Alien 2B]'); process.exit(1); }
const MODELS = (process.env.MODELS || fileURLToPath(new URL('../models/', import.meta.url))).replace(/[\\/]?$/, '/');
const FILES = which.length ? which : ['Soldier', 'Spartan', 'Alien', '2B'];
// name in the file, source glb, the direction it walks in the source frame (x = the figure's left), mirror: left and
// right swapped; strip: the horizontal drift of the source taken out (the clip plays in place); jump: timed for avatar.js
const SRC = [
  { name: 'Idle', src: 'rifle-idle' },
  { name: 'Walk', src: 'pistol-walk', dir: [0, 1], strip: true },
  { name: 'Run', src: 'pistol-run', dir: [0, 1], strip: true },
  { name: 'Jump', src: 'jumping', strip: true, jump: true },
  { name: 'Death', src: 'death-falling' },
  { name: 'WalkL', src: 'walk-left', dir: [1, 0], strip: true },
  { name: 'WalkR', src: 'walk-right', dir: [-1, 0], strip: true },
  { name: 'WalkB', src: 'walk-back-a', dir: [0, -1], strip: true },
  { name: 'RunL', src: 'synth-left', dir: [1, 0], strip: true },
  { name: 'RunR', src: 'synth-left', dir: [-1, 0], strip: true, mirror: true },   // the right strafe of the set is slower and lopsided: the left one mirrored
  { name: 'RunB', src: 'synth-back', dir: [0, -1], strip: true },
  { name: 'Crouch', src: 'crouch-idle-aim' },
  { name: 'CrouchF', src: 'crouch-walk-c', dir: [0, 1], strip: true },
  { name: 'CrouchL', src: 'crouch-left', dir: [1, 0], strip: true },
  { name: 'CrouchR', src: 'crouch-left', dir: [-1, 0], strip: true, mirror: true },
];

// Mixamo -> the standard bone names of the characters (as tools/character.mjs)
const MIXAMO = { Hips: 'Hips', Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2', Neck: 'Neck', Head: 'Head', HeadTop_End: 'HeadTop_End',
  LeftShoulder: 'ShoulderL', LeftArm: 'UpperArmL', LeftForeArm: 'LowerArmL', LeftHand: 'FistL',
  RightShoulder: 'ShoulderR', RightArm: 'UpperArmR', RightForeArm: 'LowerArmR', RightHand: 'FistR',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l', LeftToe_End: 'toe_l',
  RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r', RightToe_End: 'toe_r' };
for (const side of ['Left', 'Right']) { const s = side === 'Left' ? 'l' : 'r';
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) { const fn = f.toLowerCase();
    for (let i = 1; i <= 4; i++) MIXAMO[`${side}Hand${f}${i}`] = i < 4 ? `${fn}_0${i}_${s}` : `${fn}_end_${s}`; } }
const twin = n => n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n;
const FEET = ['foot_l', 'foot_r', 'ball_l', 'ball_r'];

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const clean = s => s.replace(/^mixamorig\d*:/, '').replace(/_\d+$/, '');
const parentNode = n => n.listParents().find(p => p instanceof Node);
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const FPS = 30;

function makeSampler(chan) {
  const s = chan.getSampler(), times = s.getInput().getArray(), vals = s.getOutput().getArray(), dim = chan.getTargetPath() === 'rotation' ? 4 : 3, n = times.length;
  return t => {
    if (t <= times[0]) return Array.from(vals.slice(0, dim));
    if (t >= times[n - 1]) return Array.from(vals.slice((n - 1) * dim, n * dim));
    let i = 1; while (times[i] < t) i++;
    const a = (t - times[i - 1]) / (times[i] - times[i - 1] || 1), o0 = (i - 1) * dim, o1 = i * dim;
    if (dim === 4) { const q = Q().fromArray(vals, o0).slerp(Q().fromArray(vals, o1), a); return [q.x, q.y, q.z, q.w]; }
    const out = []; for (let k = 0; k < dim; k++) out.push(vals[o0 + k] + (vals[o1 + k] - vals[o0 + k]) * a); return out;
  };
}
// the nodes of a document as three.js objects (to pose and measure): obj node → Object3D; rest() puts the node poses back;
// play(anim, t) poses an animation at time t
function poser(doc) {
  const nodes = doc.getRoot().listNodes(), obj = new Map(), scene = new THREE.Object3D();
  for (const n of nodes) { const o = new THREE.Object3D(); o.scale.fromArray(n.getScale()); obj.set(n, o); }
  for (const n of nodes) { const p = parentNode(n); (p ? obj.get(p) : scene).add(obj.get(n)); }
  const rest = () => { for (const [n, o] of obj) { o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); } };
  const chans = new Map();
  const play = (anim, t) => {
    if (!chans.has(anim)) chans.set(anim, anim.listChannels().map(c => ({ o: obj.get(c.getTargetNode()), path: c.getTargetPath(), s: makeSampler(c) })));
    rest(); for (const c of chans.get(anim)) { if (c.path === 'rotation') c.o.quaternion.fromArray(c.s(t)); else if (c.path === 'translation') c.o.position.fromArray(c.s(t)); }
    scene.updateMatrixWorld(true);
  };
  rest(); scene.updateMatrixWorld(true);
  return { obj, scene, rest, play };
}
const durOf = anim => Math.max(...anim.listChannels().map(c => { const a = c.getSampler().getInput().getArray(); return a[a.length - 1]; }));
// the bind pose of a skin: the turn of every joint (the inverse of its inverse bind matrix; the spaces of these files
// are upright, face +z and have the left at +x, like the world of the scene)
function bindOf(skin) {
  const ibm = skin.getInverseBindMatrices(), out = new Map();
  skin.listJoints().forEach((j, i) => { const q = Q(); new THREE.Matrix4().fromArray(ibm.getElement(i, [])).invert().decompose(V(), q, V()); out.set(j, q); });
  return out;
}
// the length of the left leg (thigh to ankle) in the units of the scene, from the node poses (a bone keeps its length)
function legOf(P, find) { const w = n => P.obj.get(find(n)).getWorldPosition(V()); return w('thigh_l').distanceTo(w('calf_l')) + w('calf_l').distanceTo(w('foot_l')); }
const lowest = (P, find) => Math.min(...FEET.map(n => P.obj.get(find(n)).getWorldPosition(V()).y));

const sources = new Map();
async function source(name) {
  if (sources.has(name)) return sources.get(name);
  const doc = await io.read(SRC_DIR.replace(/[\\/]?$/, '/') + name + '.glb'), root = doc.getRoot(), skin = root.listSkins()[0], joints = skin.listJoints();
  const byStd = new Map(); for (const j of joints) { const s = MIXAMO[clean(j.getName())]; if (s) byStd.set(s, j); }
  const P = poser(doc), find = s => byStd.get(s), anim = root.listAnimations()[0];
  const s = { doc, joints, anim, dur: durOf(anim), bind: bindOf(skin), P, find, byClean: new Map(joints.map(j => [clean(j.getName()), j])), leg: legOf(P, find) };
  sources.set(name, s); return s;
}

// retarget one source clip onto the document (its bones carry the standard names); returns the animation and the drift
async function retarget(doc, T, cfg) {
  const root = doc.getRoot(), S = await source(cfg.src), nodes = root.listNodes(), byName = new Map(nodes.map(n => [n.getName(), n]));
  const tBind = bindOf(root.listSkins()[0]), tHips = byName.get('Hips'), tRoot = parentNode(tHips);
  const tRootQ = Q(); new THREE.Matrix4().fromArray(tRoot.getWorldMatrix()).decompose(V(), tRootQ, V());
  const invTRootM = new THREE.Matrix4().fromArray(tRoot.getWorldMatrix()).invert();
  const tHipsRest = V().fromArray(tHips.getWorldMatrix().slice(12, 15));
  // the joints of the source each with its target bone; the target's bones under the hips in order (parents first)
  const pairs = []; for (const j of S.joints) { const std = MIXAMO[clean(j.getName())], t = std && byName.get(std); if (t && tBind.has(t)) pairs.push({ j, t }); }
  const tOf = new Map(pairs.map(p => [p.t, p])), order = []; (function rec(n) { order.push(n); for (const c of n.listChildren()) rec(c); })(tHips);
  const scale = T.leg / S.leg, frames = Math.max(2, Math.round(S.dur * FPS) + 1), times = Array.from({ length: frames }, (_, i) => i * S.dur / (frames - 1));
  const sHips = S.find('Hips'), sHipsW = [], sLow = [];
  for (const t of times) { S.P.play(S.anim, t); sHipsW.push(S.P.obj.get(sHips).getWorldPosition(V())); sLow.push(lowest(S.P, S.find)); }
  const sGround = Math.min(...sLow);
  const rot = new Map(pairs.map(p => [p.t, new Float32Array(frames * 4)])), pos = new Float32Array(frames * 3), hor = [];
  const W = new Map(), WQ = Q(), D = Q(), L = Q();
  for (let i = 0; i < frames; i++) {
    S.P.play(S.anim, times[i]);
    // the turn of each joint from its bind pose, in the world; mirrored, the turn of its twin reflected in x = 0
    // (a turn about x stays, those about y and z change sign); put on the target's bind pose
    const desired = new Map();
    for (const { j, t } of pairs) {
      const src = cfg.mirror ? S.byClean.get(twin(clean(j.getName()))) || j : j;
      S.P.obj.get(src).getWorldQuaternion(WQ); D.copy(WQ).multiply(S.bind.get(src).clone().invert());
      if (cfg.mirror) { D.y = -D.y; D.z = -D.z; }
      desired.set(t, D.clone().multiply(tBind.get(t)));
    }
    // the local turns down the target's own hierarchy: a bone the source does not move keeps its node turn
    W.clear();
    for (const n of order) {
      const p = parentNode(n), pw = n === tHips ? tRootQ : W.get(p);
      if (desired.has(n)) { L.copy(pw).invert().multiply(desired.get(n)); rot.get(n).set([L.x, L.y, L.z, L.w], i * 4); W.set(n, desired.get(n)); }
      else W.set(n, pw.clone().multiply(Q().fromArray(n.getRotation())));
    }
    // the hips: across the ground by the source's move from its first frame (scaled by the legs, mirrored with the
    // clip); up and down so that the target's lowest foot is as high over the ground as the source's
    T.P.rest(); for (const [n, a] of rot) T.P.obj.get(n).quaternion.fromArray(a, i * 4); T.P.scene.updateMatrixWorld(true);
    const hw = T.P.obj.get(tHips).getWorldPosition(V()), up = hw.y - lowest(T.P, T.find);
    const d = sHipsW[i].clone().sub(sHipsW[0]).multiplyScalar(scale); if (cfg.mirror) d.x = -d.x;
    hor.push(d); pos.set([tHipsRest.x + d.x, (sLow[i] - sGround) * scale + up, tHipsRest.z + d.z], i * 3);
  }
  const drift = hor[frames - 1].clone().setY(0);
  if (cfg.strip) for (let i = 0; i < frames; i++) { const f = i / (frames - 1); pos[i * 3] -= drift.x * f; pos[i * 3 + 2] -= drift.z * f; }
  for (let i = 0; i < frames; i++) { const v = V().fromArray(pos, i * 3).applyMatrix4(invTRootM); pos.set([v.x, v.y, v.z], i * 3); }
  const anim = doc.createAnimation(cfg.name);
  const add = (node, path, type, arr) => {
    const tin = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)), tout = doc.createAccessor().setType(type).setArray(arr);
    const sampler = doc.createAnimationSampler().setInterpolation('LINEAR').setInput(tin).setOutput(tout);
    anim.addSampler(sampler); anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  };
  for (const [n, a] of rot) add(n, 'rotation', 'VEC4', a);
  add(tHips, 'translation', 'VEC3', pos);
  let jump = null;
  if (cfg.jump) {   // the feet off the ground: higher than 4 % of the leg over its lowest
    const off = sLow.map(y => y - sGround > 0.04 * S.leg), apexI = sLow.indexOf(Math.max(...sLow));
    let a = apexI; while (a > 0 && off[a - 1]) a--; let b = apexI; while (b < frames - 1 && off[b + 1]) b++;
    jump = { takeoff: +times[a].toFixed(3), apex: +times[apexI].toFixed(3), land: +times[Math.min(frames - 1, b + 1)].toFixed(3) };
  }
  console.log('  ', cfg.name.padEnd(8), (cfg.mirror ? 'mirror of ' : '') + cfg.src, S.dur.toFixed(2) + 's', 'joints', pairs.length, jump ? JSON.stringify(jump) : '');
  return { anim, drift: drift.length() / S.dur, jump };
}

// where the feet of a clip go: the speed of the planted foot back under the hips, the phases of putting the left one
// down and lifting it (see the head of the file)
function measure(P, find, anim, dir) {
  const dur = durOf(anim), N = 120, D = new THREE.Vector3(dir[0], 0, dir[1]).normalize(), feet = [[], [], [], []], VA = V(), VB = V();
  const hips = P.obj.get(find('Hips')), fl = P.obj.get(find('foot_l')), fr = P.obj.get(find('foot_r'));
  for (let i = 0; i < N; i++) {
    P.play(anim, dur * i / N); const H = hips.getWorldPosition(VB);
    fl.getWorldPosition(VA); feet[0].push(VA.clone().sub(H).dot(D)); feet[1].push(VA.y);
    fr.getWorldPosition(VA); feet[2].push(VA.clone().sub(H).dot(D)); feet[3].push(VA.y);
  }
  // one foot: the stance runs from the farthest point along the travel (put down) to the nearest (lifted), lower than the
  // swing; in its middle half the foot lies flat on the ground, and the slope of its back-travel there is the speed
  const foot = (u, y) => {
    let iMax = 0, iMin = 0; for (let i = 1; i < N; i++) { if (u[i] > u[iMax]) iMax = i; if (u[i] < u[iMin]) iMin = i; }
    const span = (iMin - iMax + N) % N || N, low = (a, n) => { let s = 0; for (let i = 0; i < n; i++) s += y[(a + i) % N]; return s / Math.max(1, n); };
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; const a = Math.round(span * 0.25), b = Math.max(a + 2, Math.round(span * 0.75));
    for (let i = a; i <= b; i++) { const x = i / N * dur, v = u[(iMax + i) % N]; n++; sx += x; sy += v; sxx += x * x; sxy += x * v; }
    return { speed: -(n * sxy - sx * sy) / (n * sxx - sx * sx || 1), plant: iMax / N, lift: iMin / N, ok: low(iMax, span) <= low(iMin, N - span), duty: span / N };
  };
  const l = foot(feet[0], feet[1]), r = foot(feet[2], feet[3]);
  return { speed: (l.speed + r.speed) / 2, plant: l.plant, lift: l.lift, ok: l.ok && r.ok, duty: l.duty, l: l.speed, r: r.speed };
}

for (const f of FILES) {
  const path = MODELS + f + '.glb', doc = await io.read(path), root = doc.getRoot();
  const byName = new Map(root.listNodes().map(n => [n.getName(), n])), find = s => byName.get(s);
  const T = { P: poser(doc), find }; T.leg = legOf(T.P, find);
  console.log(f + '.glb: leg', T.leg.toFixed(3), 'units');
  const names = new Set(SRC.map(c => c.name));
  // the old clips go; their keys are shared with Carry (character.mjs deduplicated them), so only the ones left unused
  for (const a of root.listAnimations()) if (names.has(a.getName())) { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); }
  await doc.transform(prune({ propertyTypes: ['Accessor'] }));
  for (const c of SRC) {
    const { anim, drift, jump } = await retarget(doc, T, c), r3 = x => Math.round(x * 1000) / 1000;
    if (jump) anim.setExtras(jump);
    if (!c.dir) continue;
    const m = measure(T.P, find, anim, c.dir);
    let speed = m.speed * 1.1, how = 'feet ×1.1';
    if (drift > 0.05 * T.leg) { const S = await source(c.src), ms = measure(S.P, S.find, S.anim, c.mirror ? [-c.dir[0], c.dir[1]] : c.dir); speed = drift * S.leg / T.leg * m.speed / ms.speed; how = 'drift'; }   // the source's own drift × target feet / source feet
    anim.setExtras({ speed: r3(speed), plant: r3(m.plant), lift: r3(m.lift), dir: c.dir });
    console.log('      speed', (speed / T.leg).toFixed(3), 'legs/s (' + how + '; feet L', (m.l / T.leg).toFixed(3), 'R', (m.r / T.leg).toFixed(3) + ')', 'plant', m.plant.toFixed(2), 'lift', m.lift.toFixed(2), 'stance', m.duty.toFixed(2), m.ok ? '' : '  !! the stance is not the lower phase: check the direction');
  }
  await io.write(path, doc);
  console.log('  wrote', path, 'clips', root.listAnimations().map(a => a.getName()).join(','));
}
