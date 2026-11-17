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
   The weapons in hand are ready models too (models/Rifle.glb, models/Shotgun.glb, CC0, the same pack as the zombie
   survivors of Quaternius): the muzzle along +z, the top along +y, the grip at the origin, in the units of the soldier. */
const MODEL = {
  file: 'models/Soldier.glb', guns: ['models/Rifle.glb', 'models/Shotgun.glb', 'models/Rifle.glb'], gunLen: [1, 1, 1.15], height: 1.8, headScale: 0.8,   // the guns: one model for each weapon of the game   // the head of the file is big: a little smaller
  tint: ['Main', 'Helmet'],   // the materials painted in the colour of the team
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
function readyGun(src, k) {
  const g = src.clone(true); g.traverse(o => { if (o.isMesh) o.material = worldSpace(o.material.clone()); });
  const box = new THREE.Box3().setFromObject(g), holder = new THREE.Group(); holder.add(g); holder.scale.setScalar(asset.scale * k); holder.userData.muzzle = box.max.z * asset.scale * k; return holder;
}
// one player's model: update(dt, { speed, air, dead, shot }) every frame
function makeAvatar(hue) {
  if (!asset) return null;
  const root = clone(asset.scene), inner = new THREE.Group(), mixer = new THREE.AnimationMixer(root), act = {}, C = MODEL.clips;
  root.scale.setScalar(asset.scale); root.position.y = asset.floor; inner.rotation.y = Math.PI; inner.add(root);
  root.traverse(o => {
    if (!o.isMesh) return; o.frustumCulled = false;   // a skinned mesh keeps the bounds of its rest pose
    o.material = worldSpace(Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone());
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (MODEL.tint.includes(m.name)) m.color.setHSL(hue, 0.5, m.name === 'Helmet' ? 0.3 : 0.36);
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
  const hand = root.getObjectByName(MODEL.hand), mount = new THREE.Group(), guns = MODEL.guns.map((f, i) => asset.guns[i] ? readyGun(asset.guns[i], MODEL.gunLen[i]) : boxRifle());
  const flash = new THREE.Mesh(GEO, MF); flash.scale.setScalar(0.14); flash.visible = false; let gun = guns[0];
  if (hand) { inner.updateMatrixWorld(true); const k = hand.getWorldScale(new THREE.Vector3()).x || 1; mount.scale.setScalar(1 / k); hand.add(mount); }
  mount.quaternion.setFromAxisAngle(new THREE.Vector3(1, 1, 1).normalize(), Math.PI * 2 / 3);   // the axes of the fist: x forward, z up; the gun's muzzle is z, its top y
  guns.forEach((g, i) => { g.visible = i === 0; mount.add(g); }); mount.add(flash);
  function setGun(i) { i = Math.max(0, Math.min(guns.length - 1, i | 0)); guns.forEach((g, k) => { g.visible = k === i; }); gun = guns[i]; flash.position.set(0, 0.04, gun.userData.muzzle + 0.05); }
  setGun(0);
  return { root: inner, update, mount, setGun, mixer, get gun() { return gun; } };
}

// a ready gun for the viewmodel of the player himself (a clone in metres, the muzzle along +z), or null before the files have come
function gunModel(i) { return asset && asset.guns[i] ? readyGun(asset.guns[i], MODEL.gunLen[i]) : null; }

export { MODEL, gunModel, loadAvatar, makeAvatar, ready };
