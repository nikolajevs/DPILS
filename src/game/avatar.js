import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { worldSpace } from '../render/world-space.js';

/* ---------- the ready model of the players ----------
   models/Soldier.glb (CC0, see models/README.md): a soldier with the animations Idle, Walk, Run, Jump, Death and the
   "Carry" ones (the arms hold something in front). It is loaded once when a game starts; every other player gets a clone
   with its own skeleton and mixer and the colours of the team on its helmet and jacket. Until the file has come (or if it
   cannot) the players are the simple figures of src/game/mp.js.
   Everything that belongs to this one file is in MODEL: to use another character change that and nothing else. The model
   is scaled to a man's height with the feet on the ground, and turned to look where the game looks (the file looks
   along +z, the game along −z). The loader drops the dots of the bone names (Fist.R is FistR).
   The weapons in hand are ready models too (models/Rifle.glb, Shotgun.glb, Sniper.glb, CC0, by Quaternius): the muzzle along +z, the top along +y, the grip at the origin, in the units of the soldier. */
const MODEL = {
  file: 'models/Soldier.glb', guns: ['models/AK.glb', 'models/Shotgun.glb', 'models/Sniper.glb', 'models/Pistol.glb', 'models/Rifle.glb'], gunLen: [1, 1, 1, 0.5, 1.1], gunYaw: [Math.PI / 2, 0, Math.PI / 2, Math.PI / 2, 0], height: 1.8, headScale: 0.8,   // one gun model for each weapon of the game (the machine gun is the heavy rifle); gunYaw: the guns of the Toon Shooter pack point along −x, turned to +z; the head of the file is big: a little smaller
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
      Promise.all([...new Set(MODEL.guns)].map(f => new Promise(r => new GLTFLoader().load(f, x => r([f, x.scene]), undefined, () => r([f, null]))))).then(list => {
        const by = Object.fromEntries(list); asset.guns = MODEL.guns.map(f => by[f] || null); res(asset);
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
  let deadT = -1, flashT = 0, flash = null;
  function update(dt, s) {
    const loco = s.dead ? null : s.speed > 5 ? 'run' : s.speed > 0.5 ? 'walk' : 'idle';
    if (s.dead && deadT < 0) { deadT = 0; if (act.death) { act.death.reset(); act.death.play(); } } else if (!s.dead) deadT = -1;
    for (const k in act) { const t = s.dead ? (k === 'death' ? 1 : 0) : (k === loco || k === 'hold' ? 1 : 0); act[k].weight += (t - act[k].weight) * Math.min(1, dt * 10); }
    if (act.walk) act.walk.timeScale = Math.max(0.6, Math.min(1.8, s.speed / 1.7));
    if (act.run) act.run.timeScale = Math.max(0.7, Math.min(1.6, s.speed / 6));
    mixer.update(dt);
    if (!s.dead && !civilian) {   // the head and the spine follow the aim on top of the clip (the bone X points left: up is negative)
      if (bones.Head) bones.Head.quaternion.multiply(QP.setFromAxisAngle(XA, -headProxy.rotation.x));
      if (bones.spine_03) bones.spine_03.quaternion.multiply(QP.setFromAxisAngle(XA, -armProxy.rotation.x * 0.5));
    }
    if (flash) { if (s.shot) flashT = 0.07; flashT = Math.max(0, flashT - dt); flash.visible = flashT > 0; }
  }
  let mount = null, gun = null, setGun = () => {};
  if (!civilian) {   // the gun in the right hand: the fingers of the rig point along +Y, the back of the hand along +X
    const hand = bones.hand_r; mount = new THREE.Group();
    const guns = MODEL.guns.map((f, i) => asset && asset.guns[i] ? readyGun(asset.guns[i], MODEL.gunLen[i], MODEL.gunYaw[i]) : boxRifle());
    flash = new THREE.Mesh(GEO, MF); flash.scale.setScalar(0.09); flash.visible = false; gun = guns[0];
    if (hand) { inner.updateMatrixWorld(true); const k = hand.getWorldScale(new THREE.Vector3()).x || 1; mount.scale.setScalar(1 / k); hand.add(mount); }
    mount.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); mount.position.set(-0.01, 0.09, 0.015);   // the muzzle along the fingers, the slide to the back of the hand
    guns.forEach((g, i) => { g.visible = i === 0; mount.add(g); }); mount.add(flash);
    setGun = i => { i = Math.max(0, Math.min(guns.length - 1, i | 0)); guns.forEach((g, k) => { g.visible = k === i; }); gun = guns[i]; flash.position.set(0, 0.04, gun.userData.muzzle + 0.05); };
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
  let deadT = -1, flashT = 0;
  const want = s => s.dead ? { [C.death]: 1 } : s.air ? { [C.jump]: 1 } : s.speed > 5 ? { [C.run]: 1 } : s.speed > 0.5 ? { [C.walk]: 1 } : { [C.idle]: 1 };
  function update(dt, s) {
    const w = want(s);
    if (s.dead && deadT < 0) { deadT = 0; if (act[C.death]) { act[C.death].reset(); act[C.death].play(); } } else if (!s.dead) deadT = -1;
    for (const n in act) { const t = w[n] || 0; act[n].weight += (t - act[n].weight) * Math.min(1, dt * 10); }
    if (act[C.walk]) act[C.walk].timeScale = Math.max(0.6, Math.min(1.8, s.speed / 1.7));
    if (act[C.run]) act[C.run].timeScale = Math.max(0.7, Math.min(1.6, s.speed / 6));
    mixer.update(dt);
    if (!s.dead) armBones.forEach((o, i) => o.quaternion.copy(armQ[i]));
    if (head) head.scale.setScalar(MODEL.headScale);
    if (s.shot) flashT = 0.07; flashT = Math.max(0, flashT - dt); flash.visible = flashT > 0;
  }
  // a mount on the hand in metres: the skeleton of the file is in other units, so the mount is scaled back
  const hand = root.getObjectByName(MODEL.hand), mount = new THREE.Group(), guns = MODEL.guns.map((f, i) => asset.guns[i] ? readyGun(asset.guns[i], MODEL.gunLen[i], MODEL.gunYaw[i]) : boxRifle());
  const flash = new THREE.Mesh(GEO, MF); flash.scale.setScalar(0.09); flash.visible = false; let gun = guns[0];
  if (hand) { inner.updateMatrixWorld(true); const k = hand.getWorldScale(new THREE.Vector3()).x || 1; mount.scale.setScalar(1 / k); hand.add(mount); }
  mount.quaternion.setFromAxisAngle(new THREE.Vector3(1, 1, 1).normalize(), Math.PI * 2 / 3);   // the axes of the fist: x forward, z up; the gun's muzzle is z, its top y
  guns.forEach((g, i) => { g.visible = i === 0; mount.add(g); }); mount.add(flash);
  function setGun(i) { i = Math.max(0, Math.min(guns.length - 1, i | 0)); guns.forEach((g, k) => { g.visible = k === i; }); gun = guns[i]; flash.position.set(0, 0.04, gun.userData.muzzle + 0.05); }
  setGun(0);
  return { root: inner, update, mount, setGun, mixer, get gun() { return gun; } };
}

// a ready gun for the viewmodel of the player himself (a clone in metres, the muzzle along +z), or null before the files have come
function gunModel(i) { return asset && asset.guns[i] ? readyGun(asset.guns[i], MODEL.gunLen[i], MODEL.gunYaw[i]) : null; }

export { MODEL, gunModel, loadAvatar, loadHumans, makeAvatar, parseLook, randomLook, ready, humansReady };
