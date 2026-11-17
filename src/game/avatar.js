import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { worldSpace } from '../render/world-space.js';

/* ---------- the ready model of the players ----------
   models/RobotExpressive.glb (CC0, see models/README.md) with its own animations: Idle, Walking, Running, Jump, Death.
   It is loaded once when a game starts; every other player gets a clone with its own skeleton and mixer and a colour
   of its own on the orange "Main" material. Until the file has come (or if it cannot) the players are the simple
   figures of src/game/mp.js. The model is scaled to a man's height with the feet on the ground, and turned to look
   where the game looks (the model looks along +z, the game along −z). */
const HEIGHT = 1.8;
let loading = null, asset = null;
function loadAvatar() {
  if (!loading) loading = new Promise(res => {
    new GLTFLoader().load('models/RobotExpressive.glb', g => {
      const box = new THREE.Box3().setFromObject(g.scene), h = box.max.y - box.min.y || 1;
      asset = { scene: g.scene, clips: Object.fromEntries(g.animations.map(c => [c.name, c])), scale: HEIGHT / h, floor: -box.min.y * HEIGHT / h }; res(asset);
    }, undefined, () => res(null));
  });
  return loading;
}
const ready = () => asset;

// a simple rifle, the muzzle along +z, the grip at the origin
const GEO = new THREE.BoxGeometry(1, 1, 1), M1 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x2a2d31 })), M2 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x6b4a2b }));
function rifle() {
  const g = new THREE.Group(), add = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); };
  add(M1, 0.07, 0.1, 0.62, 0, 0.02, 0.28); add(M1, 0.035, 0.035, 0.3, 0, 0.03, 0.72); add(M2, 0.06, 0.13, 0.22, 0, 0, -0.1); add(M1, 0.05, 0.16, 0.08, 0, -0.1, 0.18); add(M1, 0.045, 0.1, 0.08, 0, -0.07, 0.04);
  g.scale.setScalar(1.15); return g;
}
// one player's model: update(dt, { speed, air, dead }) every frame
function makeAvatar(hue) {
  if (!asset) return null;
  const root = clone(asset.scene), inner = new THREE.Group(), mixer = new THREE.AnimationMixer(root), act = {};
  root.scale.setScalar(asset.scale); root.position.y = asset.floor; inner.rotation.y = Math.PI; inner.add(root);
  root.traverse(o => {
    if (!o.isMesh) return; o.frustumCulled = false;   // a skinned mesh keeps the bounds of its rest pose
    o.material = worldSpace(Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone());
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.name === 'Main') m.color.setHSL(hue, 0.7, 0.42);
  });
  for (const n of ['Idle', 'Walking', 'Running', 'Jump', 'Death']) if (asset.clips[n]) { act[n] = mixer.clipAction(asset.clips[n]); act[n].play(); act[n].weight = n === 'Idle' ? 1 : 0; }
  if (act.Death) { act.Death.setLoop(THREE.LoopOnce, 1); act.Death.clampWhenFinished = true; }
  // the right arm keeps the pose it has in Idle (the gun is held level) whatever the legs and the body do
  const armBones = ['ShoulderR', 'UpperArmR', 'ArmR', 'LowerArmR', 'Palm2R', 'Palm1R', 'Palm3R', 'Middle1R', 'Index1R', 'Index2R', 'Middle2R', 'Ring1R', 'Ring2R', 'Thumb1R', 'Thumb2R', 'ThumbR'].map(n => root.getObjectByName(n)).filter(o => o && o.isBone);
  for (const n in act) act[n].weight = n === 'Idle' ? 1 : 0; mixer.update(0.01); const armQ = armBones.map(o => o.quaternion.clone());
  let deadT = -1;
  const want = (s) => s.dead ? { Death: 1 } : s.air ? { Jump: 1 } : s.speed > 5 ? { Running: 1 } : s.speed > 0.5 ? { Walking: 1 } : { Idle: 1 };
  function update(dt, s) {
    const w = want(s);
    if (s.dead && deadT < 0) { deadT = 0; if (act.Death) { act.Death.reset(); act.Death.play(); } } else if (!s.dead) deadT = -1;
    for (const n in act) { const t = w[n] || 0; act[n].weight += (t - act[n].weight) * Math.min(1, dt * 10); }
    if (act.Walking) act.Walking.timeScale = Math.max(0.6, Math.min(1.8, s.speed / 1.7));
    if (act.Running) act.Running.timeScale = Math.max(0.7, Math.min(1.6, s.speed / 6.5));
    mixer.update(dt);
    if (!s.dead) armBones.forEach((o, i) => o.quaternion.copy(armQ[i]));
  }
  const hand = root.getObjectByName('Palm2R') || root.getObjectByName('LowerArmR');   // the loader drops the dots of the names
  // a mount on the hand in metres: the skeleton of the file is in other units, so the mount is scaled back
  const mount = new THREE.Group(); if (hand) { inner.updateMatrixWorld(true); const k = hand.getWorldScale(new THREE.Vector3()).x || 1; mount.scale.setScalar(1 / k); hand.add(mount); }
  mount.rotation.y = 0.61;   // the hand of the file points 35° above the level: turned so that the barrel is level
  mount.add(rifle());
  return { root: inner, update, mount, mixer };
}

export { loadAvatar, makeAvatar, ready };
