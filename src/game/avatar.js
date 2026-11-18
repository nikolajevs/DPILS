import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { worldSpace } from '../render/world-space.js';
import { akReady } from './viewmodel.js';

/* ---------- the ready model of the players ----------
   models/Soldier.glb (CC0, see models/README.md): a soldier with the animations Idle, Walk, Run, Jump, Death and the
   "Carry" ones (the arms hold something in front). It is loaded once when a game starts; every other player gets a clone
   with its own skeleton and mixer and the colours of the team on its helmet and jacket. Until the file has come (or if it
   cannot) the players are the simple figures of src/game/mp.js.
   Everything that belongs to this one file is in MODEL: to use another character change that and nothing else. The model
   is scaled to a man's height with the feet on the ground, and turned to look where the game looks (the file looks
   along +z, the game along −z). The loader drops the dots of the bone names (Fist.R is FistR).
   The weapons in hand are ready models too (models/Rifle.glb, Shotgun.glb, Sniper.glb, CC0, by Quaternius): the muzzle along +z, the top along +y, the grip at the origin, in the units of the soldier.
   The AK (null in MODEL.guns) is the rifle of the arms of viewmodel.js, held in both hands: see akRifle and hold below. */
const MODEL = {
  file: 'models/Soldier.glb', guns: [null, 'models/Shotgun.glb', 'models/Sniper.glb', 'models/Pistol.glb', 'models/Rifle.glb'], gunLen: [1, 1, 1, 0.5, 1.1], gunYaw: [Math.PI / 2, 0, Math.PI / 2, Math.PI / 2, 0], height: 1.8, headScale: 0.8,   // one gun model for each weapon of the game (the machine gun is the heavy rifle); gunYaw: the guns of the Toon Shooter pack point along −x, turned to +z; the head of the file is big: a little smaller
  tint: ['Helmet'], camo: ['Main', 'DarkGreen'],   // tint: painted in the colour of the team; camo: the jacket and the trousers get a camouflage pattern in its tones
  clips: { idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', death: 'Death', hold: 'Walk_Carry' },   // hold: the pose of the arms with a rifle
  arms: ['ShoulderL', 'UpperArmL', 'LowerArmL', 'FistL', 'ShoulderR', 'UpperArmR', 'LowerArmR', 'FistR'], hand: 'FistR', head: 'Head',
};
let loading = null, asset = null;
function loadAvatar() {
  if (!loading) loading = new Promise(res => {
    new GLTFLoader().load(MODEL.file, g => {
      const clips = Object.fromEntries(g.animations.map(c => [c.name, c])), probe = clone(g.scene), mixer = new THREE.AnimationMixer(probe);
      mixer.clipAction(clips[MODEL.clips.idle]).play(); mixer.update(0.01);
      const head = probe.getObjectByName(MODEL.head); if (head) head.scale.setScalar(MODEL.headScale);
      probe.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(probe, true), h = box.max.y - box.min.y || 1;
      asset = { scene: g.scene, clips, scale: MODEL.height / h, floor: -box.min.y * MODEL.height / h, guns: [] };
      // the guns come after the soldier; without them the simple rifle is drawn
      Promise.all([...new Set(MODEL.guns.filter(Boolean))].map(f => new Promise(r => new GLTFLoader().load(f, x => r([f, x.scene]), undefined, () => r([f, null]))))).then(list => {
        const by = Object.fromEntries(list); asset.guns = MODEL.guns.map(f => (f && by[f]) || null); res(asset);
      });
    }, undefined, () => res(null));
  });
  return loading;
}
const ready = () => asset;

// the fallback rifle of boxes, the muzzle along +z, the grip at the origin, in metres
const GEO = new THREE.BoxGeometry(1, 1, 1), M1 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x2a2d31 })), M2 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x6b4a2b })), MF = worldSpace(new THREE.MeshBasicMaterial({ color: 0xffd36a, fog: false }));
function boxRifle() {
  const g = new THREE.Group(), add = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o; };
  add(M1, 0.07, 0.1, 0.62, 0, 0.02, 0.28); add(M1, 0.035, 0.035, 0.3, 0, 0.03, 0.72); add(M2, 0.06, 0.13, 0.22, 0, 0, -0.1); add(M1, 0.05, 0.16, 0.08, 0, -0.1, 0.18); add(M1, 0.045, 0.1, 0.08, 0, -0.07, 0.04);
  g.userData.muzzle = 0.92; return g;
}
// a ready gun in metres (its units are those of the soldier, so it is scaled like him); the flash is at the muzzle
function readyGun(src, k, yaw) {
  const g = src.clone(true); g.rotation.y = yaw || 0; g.traverse(o => { if (o.isMesh) o.material = worldSpace(o.material.clone()); });
  const box = new THREE.Box3().setFromObject(g), holder = new THREE.Group(); holder.add(g); holder.scale.setScalar(asset.scale * k); holder.userData.muzzle = box.max.z * asset.scale * k; return holder;
}
/* ---------- the AK in both hands ----------
   The AK does not hang on the hand like the other guns. Its stock lies against the right shoulder, it points where the
   player looks, and both arms reach for it (two-bone IK): the right hand to the pistol grip, the left to the handguard,
   each wrist where the arms of viewmodel.js hold the rifle, and each hand turned as they turn theirs (where the skeleton
   has fingers to tell the turn). The holder lives in the frame of the figure's inner group: metres, +z forward, +y up,
   the right of the figure −x; its origin is the right shoulder of the arms of the file. A dead player's rifle goes down
   with the right hand. */
function akRifle() {
  const k = akReady(); if (!k || !k.gun) return boxRifle();
  const g = k.gun.clone(true), shift = new THREE.Group(), holder = new THREE.Group(); g.traverse(o => { if (o.isMesh) o.material = worldSpace(o.material.clone()); });
  shift.position.copy(k.shoulder).negate(); shift.add(g); holder.add(shift);   // (the node of the rifle keeps the scale of its packed geometry: it is moved by a group of its own)
  const rel = h => h && Object.fromEntries(Object.entries(h).map(([n, v]) => [n, v.clone().sub(k.shoulder)]));
  holder.userData = { both: true, hands: { R: rel(k.hands.R), L: rel(k.hands.L) }, flashAt: k.muzzle.clone().sub(k.shoulder).add(new THREE.Vector3(0, 0, 0.05)) };
  return holder;
}
const POLE = { R: new THREE.Vector3(-0.7, -1, -0.3).normalize(), L: new THREE.Vector3(0.5, -1, -0.2).normalize() };   // where the elbows point
const IM = new THREE.Matrix4(), MA = new THREE.Matrix4(), MB = new THREE.Matrix4(), QA = new THREE.Quaternion(), QB = new THREE.Quaternion(), QC = new THREE.Quaternion();
const VA = new THREE.Vector3(), VB = new THREE.Vector3(), VC = new THREE.Vector3(), VD = new THREE.Vector3(), VE = new THREE.Vector3(), VF = new THREE.Vector3(), VS = new THREE.Vector3(), VT = new THREE.Vector3();
const F = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], FX = new THREE.Vector3(), FY = new THREE.Vector3(), FZ = new THREE.Vector3();
// positions and turns in the frame of inner (IM: the inverse of its world matrix, set by hold)
const at = (o, v) => v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(IM);
function turnOf(o, q) { MA.multiplyMatrices(IM, o.matrixWorld).decompose(VS, q, VT); return q; }
function turn(o, q) {   // turn the bone o by q (in the frame of inner) about its own joint
  turnOf(o, QB); turnOf(o.parent, QC); QB.premultiply(q);
  o.quaternion.copy(QC.invert().multiply(QB)); o.updateMatrixWorld(true);
}
function reach(arm, T, pole) {   // the analytic two-bone IK: the elbow in the plane of the shoulder, the target and the pole
  const [a, b, c] = arm, A = at(a, VA), B = at(b, VB), C = at(c, VC), l1 = A.distanceTo(B), l2 = B.distanceTo(C);
  VD.subVectors(T, A); let d = VD.length(); if (d < 1e-5 || l1 < 1e-5 || l2 < 1e-5) return; VD.divideScalar(d);
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-4), (l1 + l2) * 0.999);
  const ca = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))), sa = Math.sqrt(1 - ca * ca);
  VE.copy(pole).addScaledVector(VD, -pole.dot(VD)); if (VE.lengthSq() < 1e-8) VE.set(0, -1, 0); VE.normalize();
  VF.copy(A).addScaledVector(VD, l1 * ca).addScaledVector(VE, l1 * sa);   // the elbow
  turn(a, QA.setFromUnitVectors(B.sub(A).normalize(), VE.subVectors(VF, A).normalize()));
  at(b, B); at(c, C); VE.copy(A).addScaledVector(VD, d);   // the wrist
  turn(b, QA.setFromUnitVectors(C.sub(B).normalize(), VE.sub(B).normalize()));
}
function basis(w, m, i, k, M) {   // a frame of a hand: y from the wrist to the middle knuckle, x across the knuckles
  FY.subVectors(m, w).normalize(); FX.subVectors(i, k); FZ.crossVectors(FX, FY).normalize(); FX.crossVectors(FY, FZ);
  return M.makeBasis(FX, FY, FZ);
}
function turnHand(hand, fingers, h, holder) {
  at(hand, F[0]); at(fingers[0], F[1]); at(fingers[1], F[2]); at(fingers[2], F[3]); basis(F[0], F[1], F[2], F[3], MA);
  F[0].copy(h.w).applyMatrix4(holder.matrix); F[1].copy(h.m).applyMatrix4(holder.matrix); F[2].copy(h.i).applyMatrix4(holder.matrix); F[3].copy(h.k).applyMatrix4(holder.matrix); basis(F[0], F[1], F[2], F[3], MB);
  turn(hand, QA.setFromRotationMatrix(MB.multiply(MA.transpose())));   // a frame's transpose is its inverse
}
// H: { R: [upper arm, forearm, hand], L: […], fingers: { R: [middle, index, little], L: […] } | null, ofs }
function hold(H, inner, holder, pitch) {
  inner.updateMatrixWorld(true); IM.copy(inner.matrixWorld).invert();
  at(H.R[0], holder.position).add(H.ofs); holder.rotation.set(-pitch, 0, 0); holder.scale.setScalar(1); holder.updateMatrix();
  const hs = holder.userData.hands;
  if (hs.R) reach(H.R, VT.copy(hs.R.w).applyMatrix4(holder.matrix), POLE.R);
  if (hs.L) reach(H.L, VT.copy(hs.L.w).applyMatrix4(holder.matrix), POLE.L);
  if (H.fingers) { if (hs.R) turnHand(H.R[2], H.fingers.R, hs.R, holder); if (hs.L) turnHand(H.L[2], H.fingers.L, hs.L, holder); }
}
// at the moment of death the rifle is tied to the right hand (rel), then carried by it
function tieToHand(H, inner, holder) { inner.updateMatrixWorld(true); IM.copy(inner.matrixWorld).invert(); return MB.multiplyMatrices(IM, H.R[2].matrixWorld).invert().multiply(holder.matrix).clone(); }
function carry(H, inner, holder, rel) {
  inner.updateMatrixWorld(true); IM.copy(inner.matrixWorld).invert();
  MA.multiplyMatrices(IM, H.R[2].matrixWorld).multiply(rel).decompose(holder.position, holder.quaternion, holder.scale);
}
// the flash at the muzzle of the gun in hand: on the holder of the AK, on the hand mount of the others
function placeFlash(gun, flash, mount) {
  if (gun.userData.both) { gun.add(flash); flash.position.copy(gun.userData.flashAt); } else { mount.add(flash); flash.position.set(0, 0.04, gun.userData.muzzle + 0.05); }
}
const makeGun = i => i === 0 ? akRifle() : asset && asset.guns[i] ? readyGun(asset.guns[i], MODEL.gunLen[i], MODEL.gunYaw[i]) : boxRifle();
const HOLD_OFS = { human: new THREE.Vector3(0, 0, 0), soldier: new THREE.Vector3(0, 0, 0) };   // the holder from the shoulder joint of each skeleton
// the camouflage: blotches of three tones of the colour of the team (a smooth noise of the position on the body at rest,
// cut at two levels), on the material of the file; the vertex position before the skeleton moves it keeps the pattern on the body
const CAMO_GLSL = `
varying vec3 vCamo;
uniform vec3 uCamoA; uniform vec3 uCamoB; uniform vec3 uCamoC;
float camoH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float camoN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(camoH(i), camoH(i + vec3(1, 0, 0)), f.x), mix(camoH(i + vec3(0, 1, 0)), camoH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(camoH(i + vec3(0, 0, 1)), camoH(i + vec3(1, 0, 1)), f.x), mix(camoH(i + vec3(0, 1, 1)), camoH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
function camouflage(m, hue) {
  const A = new THREE.Color().setHSL(hue, 0.4, 0.42), B = new THREE.Color().setHSL(hue, 0.5, 0.27), C = new THREE.Color().setHSL(hue, 0.55, 0.14), base = THREE.Material.prototype.onBeforeCompile;
  m.onBeforeCompile = function (s) {
    base.call(this, s);   // the lift of the page's shaders by the terrain (see world/terrain.js) stays
    s.uniforms.uCamoA = { value: A }; s.uniforms.uCamoB = { value: B }; s.uniforms.uCamoC = { value: C };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCamo;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamo = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + CAMO_GLSL).replace('#include <color_fragment>', `#include <color_fragment>
      { float n = camoN(vCamo * 5.5) * 0.6 + camoN(vCamo * 12.0 + 3.7) * 0.4; diffuseColor.rgb = n < 0.42 ? uCamoA : n < 0.6 ? uCamoB : uCamoC; }`);
  };
  m.customProgramCacheKey = () => 'camo'; m.needsUpdate = true;
}
/* ---------- the people of Quaternius (CC0, models/humans/) ----------
   A man and a woman in metres (1.81 / 1.77 m), one file of twenty animations and six haircuts that bind to the same
   skeleton by bone name. The player chooses them in the game panel; the choice rides the join/board messages as a
   short string 'm.H.C.B' / 'f.H.C' (sex, haircut, hair colour, beard). The legs walk their own clip while the upper
   body keeps the pistol-hold pose (the split of the donor game, by the bone names below); there is no jump clip —
   the idle stands in for it. The team is told by a cap and an armband, not by painting the skin. hue < 0: a civilian
   of the streets, no team gear. */
const HUMAN = {
  files: { male: 'models/humans/male.glb', female: 'models/humans/female.glb', anims: 'models/humans/anims.glb' },
  hair: ['hair_beard', 'hair_buns', 'hair_buzzed', 'hair_buzzedfemale', 'hair_long', 'hair_simpleparted'],
  clips: { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', hold: 'Pistol_Idle_Loop', death: 'Death01' },
};
const HAIR = { m: [null, 'hair_buzzed', 'hair_simpleparted'], f: ['hair_long', 'hair_buns', 'hair_buzzedfemale'] };
const HAIR_COLORS = ['#2b1d14', '#5a3a22', '#a5743f', '#d8c08a', '#8a8a8a'];
const LOWER = /^(root|pelvis|thigh_|calf_|foot_|ball_)/;   // the bones of the legs and the hips: they walk, the rest holds the gun
function parseLook(s) {
  const m = typeof s === 'string' && /^([mf])(?:\.([0-9]))?(?:\.([0-9]))?(?:\.([0-9]))?$/.exec(s);
  if (!m || +m[2] > 2 || +m[3] > 4 || +m[4] > 1) return null;
  return { sex: m[1], hair: +(m[2] || 0), col: +(m[3] || 0), beard: +(m[4] || 0) };
}
function randomLook() {
  const sex = Math.random() < 0.5 ? 'm' : 'f', col = Math.floor(Math.pow(Math.random(), 1.6) * 5);
  return sex + '.' + Math.floor(Math.random() * 3) + '.' + col + (sex === 'm' && Math.random() < 0.25 ? '.1' : '');
}
// half of a clip: the tracks of the leg bones (lower) or of all the rest (upper)
function partClip(clip, lower) {
  const c = clip.clone(); c.tracks = c.tracks.filter(t => LOWER.test(t.name.split('.')[0]) === lower); return c;
}
let hLoading = null, humans = null;
function loadHumans() {
  if (!hLoading) hLoading = new Promise(res => {
    const L = new GLTFLoader();
    const grab = f => new Promise(r => L.load(f, g => r(g), undefined, () => r(null)));
    Promise.all([grab(HUMAN.files.male), grab(HUMAN.files.female), grab(HUMAN.files.anims), ...HUMAN.hair.map(h => grab('models/humans/' + h + '.glb'))]).then(([male, female, anims, ...hairs]) => {
      const C = HUMAN.clips;
      if (!male || !female || !anims || !anims.animations.some(c => c.name === C.idle)) { res(null); return; }
      const clips = Object.fromEntries(anims.animations.map(c => [c.name, c]));
      const floor = scene => { const p = scene.clone(); p.updateMatrixWorld(true); return -new THREE.Box3().setFromObject(p, true).min.y; };
      humans = {
        male: { scene: male.scene, floor: floor(male.scene) }, female: { scene: female.scene, floor: floor(female.scene) },
        hairs: Object.fromEntries(HUMAN.hair.map((h, i) => [h, hairs[i] ? hairs[i].scene : null])),
        clips: { idle: partClip(clips[C.idle], true), walk: partClip(clips[C.walk], true), run: partClip(clips[C.run], true), hold: partClip(clips[C.hold], false), death: clips[C.death] },
        full: { idle: clips[C.idle], walk: clips[C.walk], run: clips[C.run], death: clips[C.death] },
      };
      res(humans);
    });
  });
  return hLoading;
}
const humansReady = () => humans;
// a haircut binds to the skeleton of the body: the same bone names, the inverses and the bind matrix of its own
function attachHair(bodyRoot, bones, partRoot, color) {
  const meshes = [];
  partRoot.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.bind(new THREE.Skeleton(o.skeleton.bones.map(b => bones[b.name]).filter(Boolean), o.skeleton.boneInverses), o.bindMatrix);
    o.material = worldSpace(o.material.clone()); if (color) o.material.color.set(color);
    o.frustumCulled = false; meshes.push(o);
  });
  for (const m of meshes) bodyRoot.add(m);
}
const CAP_GEO = new THREE.SphereGeometry(0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), BRIM_GEO = new THREE.CylinderGeometry(0.125, 0.125, 0.014, 12), BAND_GEO = new THREE.TorusGeometry(0.055, 0.016, 6, 14);
const XA = new THREE.Vector3(1, 0, 0), QP = new THREE.Quaternion();
function makeHuman(hue, L, civilian) {
  if (!humans) return null;
  const src = L.sex === 'f' ? humans.female : humans.male;
  const root = clone(src.scene), inner = new THREE.Group();
  root.position.y = src.floor; inner.rotation.y = Math.PI; inner.add(root);
  const bones = {};
  root.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.material = worldSpace(Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone());
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (/^MI_Hair/.test(m.name)) m.color.set(HAIR_COLORS[L.col]);   // the stubble and brows of the file follow the haircut
  });
  const hairName = HAIR[L.sex][L.hair];
  if (hairName && humans.hairs[hairName]) attachHair(root, bones, clone(humans.hairs[hairName]), HAIR_COLORS[L.col]);
  if (L.beard && L.sex === 'm' && humans.hairs.hair_beard) attachHair(root, bones, clone(humans.hairs.hair_beard), HAIR_COLORS[L.col]);
  if (hue >= 0) {   // the team: a cap on the head and a band on the left arm
    const gear = worldSpace(new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(hue, 0.6, 0.4) }));
    if (bones.Head) {
      const cap = new THREE.Mesh(CAP_GEO, gear); cap.position.set(0, 0.1, 0.01); cap.scale.set(1, 0.85, 1.05); bones.Head.add(cap);
      const brim = new THREE.Mesh(BRIM_GEO, gear); brim.position.set(0, 0.1, 0.01); bones.Head.add(brim);
    }
    if (bones.upperarm_l) { const band = new THREE.Mesh(BAND_GEO, gear); band.rotation.x = Math.PI / 2; band.position.y = 0.1; bones.upperarm_l.add(band); }
  }
  const mixer = new THREE.AnimationMixer(root), act = {};
  // a civilian walks the whole clip (the arms swing); a player keeps the legs and the gun-hold upper body apart
  const keys = civilian ? ['idle', 'walk', 'run', 'death'] : ['idle', 'walk', 'run', 'hold', 'death'];
  for (const k of keys) { const clip = civilian ? humans.full[k] : humans.clips[k]; if (clip) { act[k] = mixer.clipAction(clip); act[k].play(); act[k].weight = k === 'idle' || k === 'hold' ? 1 : 0; } }
  if (act.death) { act.death.setLoop(THREE.LoopOnce, 1); act.death.clampWhenFinished = true; }
  const headProxy = new THREE.Object3D(), armProxy = new THREE.Object3D();   // mp.js turns these as the soldier's head and arm
  let deadT = -1, flashT = 0, flash = null, H = null, tied = null;
  function update(dt, s) {
    const loco = s.dead ? null : s.speed > 5 ? 'run' : s.speed > 0.5 ? 'walk' : 'idle';
    if (s.dead && deadT < 0) { deadT = 0; if (act.death) { act.death.reset(); act.death.play(); } tied = H && gun && gun.userData.both ? tieToHand(H, inner, gun) : null; } else if (!s.dead) deadT = -1;
    for (const k in act) { const t = s.dead ? (k === 'death' ? 1 : 0) : (k === loco || k === 'hold' ? 1 : 0); act[k].weight += (t - act[k].weight) * Math.min(1, dt * 10); }
    if (act.walk) act.walk.timeScale = Math.max(0.6, Math.min(1.8, s.speed / 1.7));
    if (act.run) act.run.timeScale = Math.max(0.7, Math.min(1.6, s.speed / 6));
    mixer.update(dt);
    if (!s.dead && !civilian) {   // the head and the spine follow the aim on top of the clip (the bone X points left: up is negative)
      if (bones.Head) bones.Head.quaternion.multiply(QP.setFromAxisAngle(XA, -headProxy.rotation.x));
      if (bones.spine_03) bones.spine_03.quaternion.multiply(QP.setFromAxisAngle(XA, -armProxy.rotation.x * 0.5));
    }
    if (H && gun && gun.userData.both) { if (!s.dead) hold(H, inner, gun, headProxy.rotation.x); else if (tied) carry(H, inner, gun, tied); }
    if (flash) { if (s.shot) flashT = 0.07; flashT = Math.max(0, flashT - dt); flash.visible = flashT > 0; }
  }
  let mount = null, gun = null, setGun = () => {};
  if (!civilian) {   // the gun in the right hand: the fingers of the rig point along +Y, the back of the hand along +X
    const hand = bones.hand_r; mount = new THREE.Group();
    const guns = MODEL.guns.map((f, i) => makeGun(i));
    flash = new THREE.Mesh(GEO, MF); flash.scale.setScalar(0.09); flash.visible = false; gun = guns[0];
    if (hand) { inner.updateMatrixWorld(true); const k = hand.getWorldScale(new THREE.Vector3()).x || 1; mount.scale.setScalar(1 / k); hand.add(mount); }
    mount.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); mount.position.set(-0.01, 0.09, 0.015);   // the muzzle along the fingers, the slide to the back of the hand
    guns.forEach((g, i) => { g.visible = i === 0; (g.userData.both ? inner : mount).add(g); });
    setGun = i => { i = Math.max(0, Math.min(guns.length - 1, i | 0)); guns.forEach((g, k) => { g.visible = k === i; }); gun = guns[i]; placeFlash(gun, flash, mount); };
    const B = n => bones[n], all = a => a.every(Boolean) ? a : null;
    const R = all(['upperarm_r', 'lowerarm_r', 'hand_r'].map(B)), L = all(['upperarm_l', 'lowerarm_l', 'hand_l'].map(B)), fR = all(['middle_01_r', 'index_01_r', 'pinky_01_r'].map(B)), fL = all(['middle_01_l', 'index_01_l', 'pinky_01_l'].map(B));
    if (R && L) H = { R, L, fingers: fR && fL ? { R: fR, L: fL } : null, ofs: HOLD_OFS.human };
    setGun(0);
    inner.userData.head = headProxy; inner.userData.arm = armProxy;
  }
  return { root: inner, update, mount, setGun, mixer, get gun() { return gun; } };
}

// one player's model: update(dt, { speed, air, dead, shot }) every frame; look — the chosen person ('' = the soldier);
// civilian: a person of the streets — the whole walk clip, no gun and no team gear
function makeAvatar(hue, look, civilian) {
  const L = look ? parseLook(look) : null;
  if (L) return makeHuman(hue, L, civilian);
  if (!asset) return null;
  const root = clone(asset.scene), inner = new THREE.Group(), mixer = new THREE.AnimationMixer(root), act = {}, C = MODEL.clips;
  root.scale.setScalar(asset.scale); root.position.y = asset.floor; inner.rotation.y = Math.PI; inner.add(root);
  root.traverse(o => {
    if (!o.isMesh) return; o.frustumCulled = false;   // a skinned mesh keeps the bounds of its rest pose
    o.material = worldSpace(Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone());
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (MODEL.tint.includes(m.name)) m.color.setHSL(hue, 0.5, 0.3); else if (MODEL.camo.includes(m.name)) camouflage(m, hue); }
  });
  for (const n of [C.idle, C.walk, C.run, C.jump, C.death]) if (asset.clips[n]) { act[n] = mixer.clipAction(asset.clips[n]); act[n].play(); act[n].weight = n === C.idle ? 1 : 0; }
  if (act[C.death]) { act[C.death].setLoop(THREE.LoopOnce, 1); act[C.death].clampWhenFinished = true; }
  // the arms keep the pose of "holding a rifle" whatever the legs and the body do: that pose is taken once from the first frame of the carry clip
  const armBones = MODEL.arms.map(n => root.getObjectByName(n)).filter(o => o && o.isBone), head = root.getObjectByName(MODEL.head);
  const holdMixer = new THREE.AnimationMixer(root); if (asset.clips[C.hold]) { const a = holdMixer.clipAction(asset.clips[C.hold]); a.play(); holdMixer.update(0.001); }
  const armQ = armBones.map(o => o.quaternion.clone()); holdMixer.stopAllAction(); holdMixer.uncacheRoot(root);
  let deadT = -1, flashT = 0, tied = null;
  const want = s => s.dead ? { [C.death]: 1 } : s.air ? { [C.jump]: 1 } : s.speed > 5 ? { [C.run]: 1 } : s.speed > 0.5 ? { [C.walk]: 1 } : { [C.idle]: 1 };
  function update(dt, s) {
    const w = want(s);
    if (s.dead && deadT < 0) { deadT = 0; if (act[C.death]) { act[C.death].reset(); act[C.death].play(); } tied = H && gun.userData.both ? tieToHand(H, inner, gun) : null; } else if (!s.dead) deadT = -1;
    for (const n in act) { const t = w[n] || 0; act[n].weight += (t - act[n].weight) * Math.min(1, dt * 10); }
    if (act[C.walk]) act[C.walk].timeScale = Math.max(0.6, Math.min(1.8, s.speed / 1.7));
    if (act[C.run]) act[C.run].timeScale = Math.max(0.7, Math.min(1.6, s.speed / 6));
    mixer.update(dt);
    if (!s.dead) armBones.forEach((o, i) => o.quaternion.copy(armQ[i]));
    if (head) head.scale.setScalar(MODEL.headScale);
    if (H && gun.userData.both) { if (!s.dead) hold(H, inner, gun, headProxy.rotation.x); else if (tied) carry(H, inner, gun, tied); }
    if (s.shot) flashT = 0.07; flashT = Math.max(0, flashT - dt); flash.visible = flashT > 0;
  }
  // a mount on the hand in metres: the skeleton of the file is in other units, so the mount is scaled back
  const hand = root.getObjectByName(MODEL.hand), mount = new THREE.Group(), guns = MODEL.guns.map((f, i) => makeGun(i));
  const flash = new THREE.Mesh(GEO, MF); flash.scale.setScalar(0.09); flash.visible = false; let gun = guns[0];
  if (hand) { inner.updateMatrixWorld(true); const k = hand.getWorldScale(new THREE.Vector3()).x || 1; mount.scale.setScalar(1 / k); hand.add(mount); }
  mount.quaternion.setFromAxisAngle(new THREE.Vector3(1, 1, 1).normalize(), Math.PI * 2 / 3);   // the axes of the fist: x forward, z up; the gun's muzzle is z, its top y
  guns.forEach((g, i) => { g.visible = i === 0; (g.userData.both ? inner : mount).add(g); });
  function setGun(i) { i = Math.max(0, Math.min(guns.length - 1, i | 0)); guns.forEach((g, k) => { g.visible = k === i; }); gun = guns[i]; placeFlash(gun, flash, mount); }
  const arm = n => MODEL.arms.slice(n, n + 4).map(b => root.getObjectByName(b)), aL = arm(0), aR = arm(4);   // [shoulder, upper arm, forearm, fist]
  const H = aL.every(Boolean) && aR.every(Boolean) ? { R: aR.slice(1), L: aL.slice(1), fingers: null, ofs: HOLD_OFS.soldier } : null;
  const headProxy = new THREE.Object3D(), armProxy = new THREE.Object3D(); inner.userData.head = headProxy; inner.userData.arm = armProxy;   // mp.js turns these with the aim
  setGun(0);
  return { root: inner, update, mount, setGun, mixer, get gun() { return gun; } };
}

// a ready gun for the viewmodel of the player himself (a clone in metres, the muzzle along +z), or null before the files have come
function gunModel(i) { return asset && asset.guns[i] ? readyGun(asset.guns[i], MODEL.gunLen[i], MODEL.gunYaw[i]) : null; }

export { MODEL, gunModel, loadAvatar, loadHumans, makeAvatar, parseLook, randomLook, ready, humansReady };
