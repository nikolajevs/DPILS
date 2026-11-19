import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { worldSpace } from '../render/world-space.js';
import { makeFlash } from './muzzle.js';
import { at, reach, relMatrix, setFrame, turnBy, turnOf } from './ik.js';
import { prop, onProps } from './props.js';

/* ---------- the AK-47 (models/fp_ak47.glb, CC BY 4.0, see models/README.md; built by tools/fp-ak.mjs) ----------
   One file, two uses. The arms of a soldier in gloves holding the rifle, rigged, with the clips idle, walk, run, fire,
   reload and equip: the view from your own eyes. And "AK47_static", the rifle alone in its rest pose with a third of
   the triangles: the players seen from the side (avatar.js). The file is in metres and looks along +z; the eyes of the
   arms are at EYE. The rest pose of the arms holds the rifle: where its hands and right shoulder are in it is what the
   players seen from the side copy (ak.hands, ak.palm, ak.shoulder).
   The same arms hold the other weapons of the game (models/fp_*.glb, avatar.js loads them): the AK is hidden, the
   weapon rides the bone of the rifle with its grip in the right palm, and the left hand is moved onto its handguard
   (HOLD below; the pistol is held out in front, the left hand under the right). The clips stay those of the AK.
   The arms hang on the camera and are drawn over everything: their vertices keep their place on the screen but their
   depth is squeezed into the first thousandth of the depth range, ordered among themselves by distance. So the rifle
   never goes into a wall you stand at, and the near plane of the city (0.09–0.3 m, src/game/loop.js) does not cut the hands. */
const FILE = 'models/fp_ak47.glb';
const EYE = new THREE.Vector3(0, 1.598, 0.022);
// where a picked-up sight sits on each weapon, in the frame of its file (metres, lens +z, mount bottom y=0):
// the AK in the coordinates of its own file (the arms' bone carries it), the others from their grip (HOLD).
// The top of the receiver was measured off the models (tools/sights.mjs builds the sights to the same convention).
const SIGHT_MOUNT = [[-0.13, 1.5, 0.24], [0, 0.088, 0.1], [0, 0.045, 0.05], [0, 0.086, -0.055], [0, 0.112, 0]];
let loading = null, ak = null, settled = false;
function loadAK() {
  if (!loading) loading = new Promise(res => import('three/addons/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => {   // the decoder of the packed geometry comes only with the game
    const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
    L.load(FILE, g => {
      const gun = g.scene.getObjectByName('AK47_static'); if (gun) gun.removeFromParent();
      g.scene.updateMatrixWorld(true);
      const bone = re => { let f = null; g.scene.traverse(o => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; };
      const at = o => o ? o.getWorldPosition(new THREE.Vector3()) : null;
      // each hand as the soldier of the file holds the rifle: the wrist and the knuckles of the middle, index and little
      // fingers, and the palm between the wrist and the knuckles
      const hand = side => { const h = { w: at(bone(new RegExp('^DEF-hand' + side))), m: at(bone(new RegExp('^DEF-f_middle01' + side))), i: at(bone(new RegExp('^DEF-f_index01' + side))), k: at(bone(new RegExp('^DEF-f_pinky01' + side))) }; return h.w && h.m && h.i && h.k ? h : null; };
      const hands = { R: hand('R'), L: hand('L') }, palm = h => h && h.w.clone().lerp(h.m, 0.5);
      ak = { gltf: g, gun, muzzle: gun ? muzzleOf(gun) : new THREE.Vector3(), hands, palm: { R: palm(hands.R), L: palm(hands.L) }, shoulder: at(bone(/^DEF-upper_armR/)), root: bone(/^Grip_01/) };
      settled = true; res(ak);
    }, undefined, () => { settled = true; res(null); });
  }, () => { settled = true; res(null); }));
  return loading;
}
const akReady = () => ak, akSettled = () => settled;   // settled: the file has come or failed
// the muzzle of a gun: the middle of its front end, in the frame it stands in (a packed model keeps the scale of its
// geometry in its node: the points go through the world matrix)
function muzzleOf(obj) {
  obj.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(obj, true), m = new THREE.Vector3(), v = new THREE.Vector3(); let n = 0;   // the exact box: a turned model's rough one reaches past its muzzle
  obj.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.z > box.max.z - 0.012) { m.x += v.x; m.y += v.y; n++; } } });
  return m.set(m.x / Math.max(1, n), m.y / Math.max(1, n), box.max.z);
}
/* How the arms hold each weapon of the game, in the order of WEAPONS (mp.js), in the frame of its model: metres, the
   muzzle along +z, the top +y, +x its left side, the origin at its grip (tools/fp-weapons.mjs; avatar.js levels a
   tilted file). grip: where the right palm is on it; fore: where the left palm is; shift: how far it is held from
   where the AK's grip is in the rest pose of the arms (their frame: +z forward, +y up, +x to the left); draw: more of
   that for the view from the eyes only (the players seen from the side would push the stock out of their back).
   A palm is the point between the wrist and the middle knuckle, inside the hand, and it is put where the arms of the
   file have it on the AK: the right one 3.4 cm to the right of the pistol grip, just behind its back edge and three
   fifths of the way down it (so the trigger is 9 cm ahead of it); the left one 2 cm under the handguard and 1 cm out
   from its left side, the fingers wrapped round it. A palm on the middle of a gun would sink the hand into it and set
   the whole gun 5 cm to the right of where the AK is. The long guns are held where the AK is; the shotgun's pump is
   far out, so in the view from the eyes it is drawn 7 cm back and the left shoulder comes forward the rest of the way,
   6 cm (reach in ik.js; the shoulder is out of sight). The
   pistol is held out in front, the left hand cupped under the base of its grip. The players seen from the side hold
   them the same way (avatar.js). */
const HOLD = [null,
  { grip: [-0.034, -0.025, -0.06], fore: [0.034, -0.027, 0.43], shift: [0, 0, 0], draw: [0, 0, -0.07] },   // Remington 870: round the wrist of the stock, the left hand under the pump
  { grip: [-0.031, -0.053, -0.105], fore: [0.027, -0.025, 0.24], shift: [0, 0, 0] },   // SVD: the grip of the thumbhole stock, the left hand under the wooden handguard
  { grip: [-0.023, -0.021, -0.098], fore: [0.036, -0.073, -0.077], shift: [0.025, 0.05, 0.17] },   // Makarov: held out, the left hand under the base of the grip
  { grip: [-0.034, -0.033, -0.097], fore: [0.035, -0.021, 0.25], shift: [0, 0, 0] },   // Minimi: the pistol grip, the left hand under the handguard before the box
];
const GIVE = 0.1;   // how far the left shoulder may come forward after the hand (metres)
const V3 = a => new THREE.Vector3(...a);

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
  const akMeshes = []; rig.traverse(o => { if (o.isMesh && /^Material\.00[07]/.test(o.material.name)) akMeshes.push(o); });   // the rifle itself, hidden under the other weapons
  sway.add(rig); holder.add(sway); holder.visible = false; parent.add(holder);
  // the bones of the arms (the twist bones between them follow) and the middle knuckles, that tell where a palm is
  const B = re => { let f = null; rig.traverse(o => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; };
  const arm = s => [B(new RegExp('^DEF-upper_arm' + s + '_')), B(new RegExp('^DEF-forearm' + s + '_')), B(new RegExp('^DEF-hand' + s + '_'))];
  const ARM = { R: arm('R'), L: arm('L') }, KN = { L: B(/^DEF-f_middle01L/) }, ikOk = !!(ak.root && ARM.R.every(Boolean) && ARM.L.every(Boolean) && KN.L && ak.palm.R && ak.palm.L);
  const shoulderL = ikOk ? ARM.L[0].position.clone() : null;   // where the left shoulder is put back before each clip (reach may draw it forward)
  // the rifle's bone at rest, in the frame of the arms: the other weapons ride it, from where the AK's grip is
  setFrame(rig); const restInv = ak.root ? relMatrix(ak.root, new THREE.Matrix4()).invert() : new THREE.Matrix4();
  const mixer = new THREE.AnimationMixer(rig), act = {};
  for (const c of g.animations) { const a = mixer.clipAction(c); a.play(); a.weight = 0; act[c.name] = a; }
  if (act.idle) act.idle.weight = 1;
  for (const k of ['fire', 'reload', 'equip']) if (act[k]) act[k].timeScale = 0;   // driven by hand: their time is set every frame
  const muzzle = new THREE.Object3D(), flash = makeFlash({ wrap: drawOver });
  if (ak.root) {   // the muzzle rides the bone of the rifle; its flash points along the barrel (+z of the file) in metres
    rig.updateMatrixWorld(true); muzzle.position.copy(ak.root.worldToLocal(rig.localToWorld(ak.muzzle.clone()))); ak.root.add(muzzle);
    const dir = ak.root.worldToLocal(rig.localToWorld(ak.muzzle.clone().add(new THREE.Vector3(0, 0, 0.1)))).sub(muzzle.position).normalize();
    muzzle.add(flash.group); flash.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); muzzle.updateMatrixWorld(true);
    flash.group.scale.setScalar(1 / (muzzle.getWorldScale(new THREE.Vector3()).x || 1));
  }
  const FL = new Map([[muzzle, { q: flash.group.quaternion.clone(), s: flash.group.scale.x }]]);   // how the flash sits under each muzzle
  const guns = []; let cur = 0, adsT = 0;   // the other weapons: { box (the holder on the rifle's bone), muzzle, shift, dL }
  function addWeapon(i, src) {
    const sp = HOLD[i]; if (!sp || !src || guns[i] || !ikOk) return false;
    const box = new THREE.Group(), inner = new THREE.Group(), model = src.clone(true), mz = new THREE.Object3D(), shift = V3(sp.shift).add(V3(sp.draw || [0, 0, 0]));
    model.traverse(o => { if (!o.isMesh) return; o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; o.material = drawOver(worldSpace(o.material.clone())); });
    // the holder: the frame of the arms at rest, moved to the AK's grip (and out, for the pistol), carried by the rifle's bone
    restInv.clone().multiply(new THREE.Matrix4().makeTranslation(ak.palm.R.clone().add(shift))).decompose(box.position, box.quaternion, box.scale);
    inner.position.copy(V3(sp.grip)).negate(); inner.add(model); box.add(inner); mz.position.copy(muzzleOf(src)).sub(V3(sp.grip)); box.add(mz); ak.root.add(box);
    FL.set(mz, { q: new THREE.Quaternion(), s: 1 });
    guns[i] = { box, muzzle: mz, shift, dL: ak.palm.R.clone().add(shift).add(V3(sp.fore)).sub(V3(sp.grip)).sub(ak.palm.L) };
    setWeapon(cur); return true;
  }
  function setWeapon(i) {
    cur = i; for (const m of akMeshes) m.visible = !guns[i];
    guns.forEach((g, k) => { if (g) g.box.visible = k === i; });
    const mz = guns[i] ? guns[i].muzzle : muzzle, p = FL.get(mz);
    mz.add(flash.group); flash.group.position.set(0, 0, 0); flash.group.quaternion.copy(p.q); flash.group.scale.setScalar(p.s);
    scopes.forEach((n, k) => { if (n) n.visible = k === i; });
  }
  // the picked-up sights (props.js): one per weapon, on the receiver. The AK's rides the rifle's bone like the flash;
  // the others ride their holder, from the grip of the file. attach(i, kind|null) swaps it; the models may come later.
  const scopes = [null, null, null, null, null], attachK = [null, null, null, null, null];
  function placeScope(i) {
    if (scopes[i]) { scopes[i].removeFromParent(); scopes[i].traverse(o => { if (o.isMesh) o.material.dispose(); }); scopes[i] = null; }
    const kind = attachK[i]; if (!kind) return;
    const src = prop(kind); if (!src) return;
    const n = src.clone(true); n.userData.sight = kind;
    n.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; o.material = drawOver(worldSpace(o.material.clone())); } });
    if (i === 0) {
      if (!ak.root) return;
      rig.updateMatrixWorld(true);
      n.position.copy(ak.root.worldToLocal(rig.localToWorld(V3(SIGHT_MOUNT[0]))));
      // the bone's own axes are turned against the rig: carry the rig's orientation into it, like the muzzle flash does
      const qb = new THREE.Quaternion(), qr = new THREE.Quaternion();
      ak.root.getWorldQuaternion(qb); rig.getWorldQuaternion(qr);
      n.quaternion.copy(qb.invert().multiply(qr));
      n.scale.setScalar(1 / (ak.root.getWorldScale(new THREE.Vector3()).x || 1));   // the bone lives in centimetres
      ak.root.add(n);
    } else {
      const g = guns[i]; if (!g) return;
      n.position.copy(V3(SIGHT_MOUNT[i])).sub(V3(HOLD[i].grip));
      g.box.add(n);
    }
    scopes[i] = n; n.visible = cur === i;
  }
  function attach(i, kind) { i = Math.max(0, Math.min(4, i | 0)); attachK[i] = kind || null; placeScope(i); }
  onProps(() => { for (let i = 0; i < 5; i++) if (attachK[i]) placeScope(i); });
  // after the clip: the right wrist out with the pistol, the left onto the handguard of the weapon in hand while the
  // clip has it on the rifle's (not while it fetches a magazine); each hand keeps the turn the clip gave it
  const G = new THREE.Matrix4(), G3 = new THREE.Matrix3(), T = new THREE.Vector3(), D = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), Qh = new THREE.Quaternion(), Qa = new THREE.Quaternion();
  function moveHand(a, d, give) { at(a[2], T).add(d); turnOf(a[2], Qh); reach(a, T, null, give); turnOf(a[2], Qa); turnBy(a[2], Qa.invert().premultiply(Qh)); }
  function grip(gw) {
    setFrame(rig); relMatrix(ak.root, G).multiply(restInv); G3.setFromMatrix4(G);   // how the rifle's bone has moved from its rest
    if (gw.shift.lengthSq() > 0) moveHand(ARM.R, D.copy(gw.shift).applyMatrix3(G3));
    P1.copy(ak.palm.L).applyMatrix4(G); at(ARM.L[2], P2).lerp(at(KN.L, T), 0.5);
    const on = Math.min(1, Math.max(0, (0.2 - P1.distanceTo(P2)) / 0.12));
    if (on > 0) moveHand(ARM.L, D.copy(gw.dL).applyMatrix3(G3).multiplyScalar(on), GIVE);
  }
  const w = { idle: 1, walk: 0, run: 0, fire: 0, reload: 0, equip: 0 };
  let fireT = 9, equipT = 9, lastYaw = null, lastPitch = 0, swX = 0, swY = 0, glow = 0;
  const dur = k => act[k] ? act[k].getClip().duration : 1;
  function update(dt, s) {
    glow = flash.tick(dt);
    holder.visible = !!s.show; if (!s.show) { lastYaw = null; return; }
    fireT += dt; equipT += dt * 1.8;
    const reloading = s.reload >= 0, equipping = !reloading && equipT < dur('equip'), firing = !reloading && !equipping && fireT < dur('fire');
    const loco = s.speed > 5 ? 'run' : s.speed > 0.6 ? 'walk' : 'idle';   // the same threshold as the body (avatar.js): the arms jog when the legs jog
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
    if (shoulderL) ARM.L[0].position.copy(shoulderL);
    mixer.update(dt);
    if (guns[cur]) grip(guns[cur]);
    // the rifle lags a little behind a turn of the view and settles back
    if (lastYaw !== null) {
      let dy = s.yaw - lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      swX += (Math.max(-0.05, Math.min(0.05, dy * 0.6)) - swX) * Math.min(1, dt * 10); swY += (Math.max(-0.04, Math.min(0.04, (s.pitch - lastPitch) * 0.6)) - swY) * Math.min(1, dt * 10);
    }
    swX *= Math.max(0, 1 - dt * 6); swY *= Math.max(0, 1 - dt * 6);
    // aiming through a red dot: the sway and the kick die away, and the window of the sight comes to the centre of
    // the camera (the holder slides against the bone's place of this frame); the optic hides the arms entirely (mp.js)
    adsT += ((s.ads || 0) - adsT) * Math.min(1, dt * 12);
    const calm = 1 - 0.85 * adsT;
    sway.rotation.set((-swY + (s.kick || 0) * 0.035) * calm, -swX * calm, 0); sway.position.z = (s.kick || 0) * 0.03 * calm; lastYaw = s.yaw; lastPitch = s.pitch;   // and kicks back at a shot (kick 1 → 0, mp.js)
    const sc = scopes[cur];
    if (sc && adsT > 0.001 && attachK[cur] === 'sight') {
      T.set(-0.004, 0.072, 0.06); sc.localToWorld(T); holder.worldToLocal(T);   // the lens centre measured in item_sight.glb
      holder.position.set(-T.x * adsT, -T.y * adsT, 0);
    } else holder.position.set(0, 0, 0);
  }
  return {
    group: holder, update, act,
    fire(scale) { fireT = 0; flash.fire(1, scale); },
    get glow() { return glow; },   // the brightness of the flash now, for its light (mp.js)
    equip() { equipT = 0; },
    muzzle(v) { return (guns[cur] ? guns[cur].muzzle : muzzle).getWorldPosition(v); },
    addWeapon, setWeapon, attach,
    has: i => i === 0 || !!guns[i],   // the arms hold this weapon (its model has come)
  };
}

export { HOLD, SIGHT_MOUNT, akReady, akSettled, drawOver, loadAK, makeViewmodel, muzzleOf };
