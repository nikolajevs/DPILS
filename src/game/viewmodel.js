import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { worldSpace } from '../render/world-space.js';

/* ---------- the AK-47 (models/fp_ak47.glb, CC BY 4.0, see models/README.md; built by tools/fp-ak.mjs) ----------
   One file, two uses. The arms of a soldier in gloves holding the rifle, rigged, with the clips idle, walk, run, fire,
   reload and equip: the view from your own eyes. And "AK47_static", the rifle alone in its rest pose with a third of
   the triangles: the players seen from the side (avatar.js). The file is in metres and looks along +z; the eyes of the
   arms are at EYE. The rest pose of the arms holds the rifle: where its hands and right shoulder are in it is what the
   players seen from the side copy (ak.hands, ak.shoulder).
   The arms hang on the camera and are drawn over everything: their vertices keep their place on the screen but their
   depth is squeezed into the first thousandth of the depth range, ordered among themselves by distance. So the rifle
   never goes into a wall you stand at, and the near plane of the city (0.3 m) does not cut the hands. */
const FILE = 'models/fp_ak47.glb';
const EYE = new THREE.Vector3(0, 1.598, 0.022);
let loading = null, ak = null, settled = false;
function loadAK() {
  if (!loading) loading = new Promise(res => import('three/addons/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => {   // the decoder of the packed geometry comes only with the game
    const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
    L.load(FILE, g => {
      const gun = g.scene.getObjectByName('AK47_static'); if (gun) gun.removeFromParent();
      g.scene.updateMatrixWorld(true);
      const bone = re => { let f = null; g.scene.traverse(o => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; };
      const at = o => o ? o.getWorldPosition(new THREE.Vector3()) : null;
      // the muzzle: the middle of the front end of the rifle; the points where the hands hold it, in the rest pose
      const muzzle = new THREE.Vector3(), box = new THREE.Box3();
      if (gun) {   // (the packed geometry keeps its scale in the node: the points go through the world matrix)
        gun.updateMatrixWorld(true); box.setFromObject(gun); let n = 0; const v = new THREE.Vector3();
        gun.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.z > box.max.z - 0.012) { muzzle.x += v.x; muzzle.y += v.y; n++; } } });
        muzzle.set(muzzle.x / Math.max(1, n), muzzle.y / Math.max(1, n), box.max.z);
      }
      // each hand as the soldier of the file holds the rifle: the wrist and the knuckles of the middle, index and little fingers
      const hand = side => { const h = { w: at(bone(new RegExp('^DEF-hand' + side))), m: at(bone(new RegExp('^DEF-f_middle01' + side))), i: at(bone(new RegExp('^DEF-f_index01' + side))), k: at(bone(new RegExp('^DEF-f_pinky01' + side))) }; return h.w && h.m && h.i && h.k ? h : null; };
      ak = { gltf: g, gun, muzzle, hands: { R: hand('R'), L: hand('L') }, shoulder: at(bone(/^DEF-upper_armR/)), root: bone(/^Grip_01/) };
      settled = true; res(ak);
    }, undefined, () => { settled = true; res(null); });
  }, () => { settled = true; res(null); }));
  return loading;
}
const akReady = () => ak, akSettled = () => settled;   // settled: the file has come or failed

// over everything: the depth of each vertex squeezed into the near end, by its distance (up to 4 m)
const OVER = 'gl_Position.z = (-1.0 + 0.0015 * clamp(-mvPosition.z / 4.0, 0.0, 1.0)) * gl_Position.w;';
function drawOver(m) {
  const base = m.onBeforeCompile;   // the page's own patch (world/terrain.js) stays
  m.onBeforeCompile = function (s, r) { base.call(this, s, r); s.vertexShader = s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + OVER); };
  m.customProgramCacheKey = () => 'over';
  return m;
}

/* The view from the eyes. update(dt, s) every frame with s = { show, speed (m/s), reload (0…1, or −1), yaw, pitch, kick };
   fire() at each shot, equip() when the rifle is taken. The clips are chosen by state: reload over equip over fire
   over the steps (idle, walk, run); each fades in and out, and the steps get what the others leave. The reload is
   driven by its progress, so the magazine goes in when the game's reload ends whatever its length. */
const OFFSET = new THREE.Vector3(0, 0.035, -0.015);   // the rifle a touch higher and farther than the file holds it: more of it in sight
function makeViewmodel(parent) {
  if (!ak) return null;
  const g = ak.gltf, rig = g.scene, holder = new THREE.Group(), sway = new THREE.Group();
  rig.rotation.y = Math.PI; rig.position.set(-EYE.x, -EYE.y, EYE.z).add(OFFSET);   // the eyes on the camera, +z of the file along −z of the camera
  rig.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true;
    o.material = drawOver(worldSpace(o.material.clone()));
    if (o.material.map) o.material.map.anisotropy = 4;
  });
  sway.add(rig); holder.add(sway); holder.visible = false; parent.add(holder);
  const mixer = new THREE.AnimationMixer(rig), act = {};
  for (const c of g.animations) { const a = mixer.clipAction(c); a.play(); a.weight = 0; act[c.name] = a; }
  if (act.idle) act.idle.weight = 1;
  for (const k of ['fire', 'reload', 'equip']) if (act[k]) act[k].timeScale = 0;   // driven by hand: their time is set every frame
  const muzzle = new THREE.Object3D();
  if (ak.root) { rig.updateMatrixWorld(true); muzzle.position.copy(ak.root.worldToLocal(rig.localToWorld(ak.muzzle.clone()))); ak.root.add(muzzle); }
  const w = { idle: 1, walk: 0, run: 0, fire: 0, reload: 0, equip: 0 };
  let fireT = 9, equipT = 9, lastYaw = null, lastPitch = 0, swX = 0, swY = 0;
  const dur = k => act[k] ? act[k].getClip().duration : 1;
  function update(dt, s) {
    holder.visible = !!s.show; if (!s.show) { lastYaw = null; return; }
    fireT += dt; equipT += dt * 1.8;
    const reloading = s.reload >= 0, equipping = !reloading && equipT < dur('equip'), firing = !reloading && !equipping && fireT < dur('fire');
    const loco = s.speed > 6.5 ? 'run' : s.speed > 0.6 ? 'walk' : 'idle';
    const want = { reload: reloading, equip: equipping, fire: firing };
    for (const k in want) w[k] += ((want[k] ? 1 : 0) - w[k]) * Math.min(1, dt * (want[k] ? 22 : 9));
    for (const k of ['idle', 'walk', 'run']) w[k] += ((k === loco ? 1 : 0) - w[k]) * Math.min(1, dt * 7);
    let over = w.reload + w.equip + w.fire; const k1 = over > 1 ? 1 / over : 1; over = Math.min(1, over);
    const ls = w.idle + w.walk + w.run || 1;
    for (const k of ['idle', 'walk', 'run']) if (act[k]) act[k].weight = w[k] / ls * (1 - over);
    for (const k of ['reload', 'equip', 'fire']) if (act[k]) act[k].weight = w[k] * k1;
    if (act.reload) act.reload.time = Math.max(0, Math.min(1, s.reload)) * dur('reload');
    if (act.equip) act.equip.time = Math.min(equipT, dur('equip') - 1e-3);
    if (act.fire) act.fire.time = Math.min(fireT, dur('fire') - 1e-3);
    if (act.walk) act.walk.timeScale = Math.max(0.6, Math.min(1.5, s.speed / 3.3));
    if (act.run) act.run.timeScale = Math.max(0.8, Math.min(1.3, s.speed / 9));
    mixer.update(dt);
    // the rifle lags a little behind a turn of the view and settles back
    if (lastYaw !== null) {
      let dy = s.yaw - lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      swX += (Math.max(-0.05, Math.min(0.05, dy * 0.6)) - swX) * Math.min(1, dt * 10); swY += (Math.max(-0.04, Math.min(0.04, (s.pitch - lastPitch) * 0.6)) - swY) * Math.min(1, dt * 10);
    }
    swX *= Math.max(0, 1 - dt * 6); swY *= Math.max(0, 1 - dt * 6);
    sway.rotation.set(-swY + (s.kick || 0) * 0.035, -swX, 0); sway.position.z = (s.kick || 0) * 0.03; lastYaw = s.yaw; lastPitch = s.pitch;   // and kicks back at a shot (kick 1 → 0, mp.js)
  }
  return {
    group: holder, update, act,
    fire() { fireT = 0; },
    equip() { equipT = 0; },
    muzzle(v) { return muzzle.getWorldPosition(v); },
  };
}

export { akReady, akSettled, loadAK, makeViewmodel };
