import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { worldSpace } from '../render/world-space.js';
import { HOLD, SIGHT_MOUNT, akReady, muzzleOf } from './viewmodel.js';
import { prop, onProps } from './props.js';
import { alignHand, at, reach, relMatrix, setFrame } from './ik.js';
import { FLASH_SIZE, makeFlash } from './muzzle.js';

/* ---------- the ready models of the players ----------
   Four characters (CC BY 4.0, see models/README.md), each a rigged body with the same fauze Mixamo clips
   (Idle, Walk, Run, Jump, Death, Carry) retargeted by tools/character.mjs onto its own skeleton:
   the S.W.A.T. operator (Soldier.glb, the default), the Halo Spartan MKV (Spartan.glb), the alien of the
   Mixamo retexture (Alien.glb) and 2B of NieR:Automata (2B.glb, a 3ds Max biped rig with skirt bones).
   The player picks one in the game panel; the choice rides the join/board messages as its key (CHARS).
   All are loaded once, with the city (loadModels of src/game/mp.js); every player gets a clone with its
   own skeleton and mixer. The models keep their original textures, uncoloured: the two teams will get
   their own models later, so no team painting is applied.
   Only if the files cannot come are the players the simple figures of src/game/mp.js.
   Each model is scaled to its height with the feet on the ground and turned to look where the game looks
   (turn: the file's facing, the game along −z). The bones carry the standard names of MODEL.arms.
   The weapons in hand are ready models too (models/fp_shotgun.glb, fp_sniper.glb, fp_pistol.glb, fp_mg.glb — CC BY 4.0, from Sketchfab, credits in models/README.md): metres, the muzzle along +z, the top along +y, the grip at the origin.
   The AK (null in MODEL.guns) is the rifle of the arms of viewmodel.js. Every gun is held in both hands: see heldGun and hold below. */
const MODEL = {
  guns: [null, 'models/fp_shotgun.glb', 'models/fp_sniper.glb', 'models/fp_pistol.glb', 'models/fp_mg.glb'], gunLen: [1, 1, 1, 1.5, 1], gunYaw: [0, 0, 0, 0, 0], gunM: [false, true, true, true, true], headScale: 1,   // one gun model for each weapon of the game; the fp_* guns are already in metres and point along +z (gunM), the pistol is a little bigger in the hand
  // a gun whose file lies tilted: where its bore and its left side point in the file. The Makarov came off its display
  // stand rolled by 35° and its barrel 30° down and aside (tools/fp-weapons.mjs did not level it): it is turned once on
  // loading, about its grip, so that every clone has the muzzle along +z and the top along +y (axes of its faces)
  gunAxes: [null, null, null, { bore: [0.289, -0.408, 0.866], left: [0.8165, 0.5774, 0] }, null],
  clips: { idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', death: 'Death', hold: 'Carry' },   // hold: the pose of the arms with a rifle
  arms: ['ShoulderL', 'UpperArmL', 'LowerArmL', 'FistL', 'ShoulderR', 'UpperArmR', 'LowerArmR', 'FistR'], hand: 'FistR', head: 'Head',
};
// the characters: turn — the y turn of the file so it faces the game's −z; the textures stay as the file has them
const CHARS = {
  soldier: { file: 'models/Soldier.glb', name: 'Оператор SWAT', height: 1.8, turn: Math.PI },
  spartan: { file: 'models/Spartan.glb', name: 'Спартанец MKV', height: 2.0, turn: Math.PI },
  alien: { file: 'models/Alien.glb', name: 'Пришелец', height: 1.9, turn: Math.PI },
  '2b': { file: 'models/2B.glb', name: '2B — NieR', height: 1.68, turn: Math.PI },
};
const CHAR_KEYS = Object.keys(CHARS);
const parseChar = s => (typeof s === 'string' && CHARS[s] ? s : '');
const randomChar = () => CHAR_KEYS[Math.floor(Math.random() * CHAR_KEYS.length)];
const assets = {};
let gunsP = null;
function loadAvatar() {
  if (!gunsP) gunsP = import('three/addons/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => {
    const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);   // the character files are packed with EXT_meshopt_compression
    const chars = Promise.all(CHAR_KEYS.map(key => new Promise(res => {
      L.load(CHARS[key].file, g => {
        const clips = Object.fromEntries(g.animations.map(c => [c.name, c])), probe = clone(g.scene), mixer = new THREE.AnimationMixer(probe);
        if (clips[MODEL.clips.idle]) { mixer.clipAction(clips[MODEL.clips.idle]).play(); mixer.update(0.01); }
        const head = probe.getObjectByName(MODEL.head); if (head) head.scale.setScalar(MODEL.headScale);
        probe.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(probe, true), h = box.max.y - box.min.y || 1;
        assets[key] = { scene: g.scene, clips, scale: CHARS[key].height / h, floor: -box.min.y * CHARS[key].height / h };
        res(assets[key]);
      }, undefined, () => res(null));
    })));
    // the guns come with the characters; without them the simple rifle is drawn
    const guns = Promise.all([...new Set(MODEL.guns.filter(Boolean))].map(f => new Promise(r => L.load(f, x => r([f, x.scene]), undefined, () => r([f, null]))))).then(list => {
      const by = Object.fromEntries(list); return MODEL.guns.map((f, i) => level((f && by[f]) || null, MODEL.gunAxes[i]));
    });
    return Promise.all([chars, guns]).then(([, g]) => { for (const k in assets) assets[k].guns = g; return assets.soldier || null; });
  });
  return gunsP;
}
const ready = () => assets.soldier || null;
// a tilted gun turned about its origin so that its bore is +z and its left side +x; two groups, because readyGun sets
// the y turn of the outer one
function level(src, ax) {
  if (!src || !ax) return src;
  const X = new THREE.Vector3(...ax.left).normalize(), Z = new THREE.Vector3(...ax.bore), turn = new THREE.Group(), outer = new THREE.Group();
  Z.addScaledVector(X, -Z.dot(X)).normalize();
  turn.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, new THREE.Vector3().crossVectors(Z, X), Z).invert());
  turn.add(src); outer.add(turn); return outer;
}

// the fallback rifle of boxes, the muzzle along +z, the grip at the origin, in metres
const GEO = new THREE.BoxGeometry(1, 1, 1), M1 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x2a2d31 })), M2 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x6b4a2b }));
function boxRifle() {
  const g = new THREE.Group(), add = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o; };
  add(M1, 0.07, 0.1, 0.62, 0, 0.02, 0.28); add(M1, 0.035, 0.035, 0.3, 0, 0.03, 0.72); add(M2, 0.06, 0.13, 0.22, 0, 0, -0.1); add(M1, 0.05, 0.16, 0.08, 0, -0.1, 0.18); add(M1, 0.045, 0.1, 0.08, 0, -0.07, 0.04);
  g.userData.muzzle = 0.92; return g;
}
// a ready gun: the fp_* models are already in metres, the old ones were in the soldier's units (scaled like him);
// the flash is at the muzzle — its distance from the grip and its height are kept for the viewmodel
function readyGun(src, k, yaw, metres) {
  const g = src.clone(true); g.rotation.y = yaw || 0; g.traverse(o => { if (o.isMesh) o.material = worldSpace(o.material.clone()); });
  const s = (metres ? 1 : (ready() || { scale: 1 }).scale) * k;
  const box = new THREE.Box3().setFromObject(g), holder = new THREE.Group(); holder.add(g); holder.scale.setScalar(s); holder.userData.muzzle = box.max.z * s; holder.userData.muzzleY = (box.min.y + box.max.y) / 2 * s; return holder;
}
/* ---------- the guns in both hands ----------
   A gun does not hang on the hand. Its stock lies against the right shoulder, it points where the player looks, and
   both arms reach for it (two-bone IK, ik.js): the right wrist to the grip, the left to the handguard, each where the
   arms of viewmodel.js hold it, and each hand turned as they turn theirs (where the skeleton has fingers to tell the
   turn). The AK sits as the arms of its file hold it; every other gun is put with its grip where the AK's grip is
   (HOLD of viewmodel.js tells where its grip and handguard are, and how far out the pistol is held), and the left hand
   moves to its handguard. The holder lives in the frame of the figure's inner group: metres, +z forward, +y up, the
   right of the figure −x; its origin is the right shoulder of the arms of the file. A dead player's gun goes down with
   the right hand. */
const V3 = a => new THREE.Vector3(...a);
// the muzzle of a gun file, found once (muzzleOf reads every vertex of the model): each player has every gun in hand
const MUZZLES = new WeakMap(), muzzleAt = src => { let m = MUZZLES.get(src); if (!m) MUZZLES.set(src, m = muzzleOf(src)); return m; };
function heldGun(i) {
  const a = ready(), k = akReady(), sp = HOLD[i], src = i ? a && a.guns && a.guns[i] : k && k.gun; if (!k || !k.gun || !src || (i && !sp)) return null;
  const g = src.clone(true), shift = new THREE.Group(), holder = new THREE.Group(); g.traverse(o => { if (o.isMesh) o.material = worldSpace(o.material.clone()); });
  // (the node of a packed model keeps the scale of its geometry: it is moved by a group of its own)
  if (i) shift.position.copy(k.palm.R).add(V3(sp.shift)).sub(V3(sp.grip)).sub(k.shoulder); else shift.position.copy(k.shoulder).negate();
  shift.add(g); holder.add(shift);
  const dR = i ? V3(sp.shift) : new THREE.Vector3(), dL = i ? k.palm.R.clone().add(V3(sp.shift)).add(V3(sp.fore)).sub(V3(sp.grip)).sub(k.palm.L) : new THREE.Vector3();
  const rel = (h, d) => h && Object.fromEntries(Object.entries(h).map(([n, v]) => [n, v.clone().sub(k.shoulder).add(d)]));
  holder.userData = { both: true, hands: { R: rel(k.hands.R, dR), L: rel(k.hands.L, dL) }, flashAt: (i ? muzzleAt(src) : k.muzzle).clone().add(shift.position), scopeAt: (i ? V3(SIGHT_MOUNT[i]).add(shift.position) : V3(SIGHT_MOUNT[0]).sub(k.shoulder)) };
  return holder;
}
const POLE = { R: new THREE.Vector3(-0.7, -1, -0.3).normalize(), L: new THREE.Vector3(0.5, -1, -0.2).normalize() };   // where the elbows point
const MA = new THREE.Matrix4(), VT = new THREE.Vector3(), HP = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function turnHand(hand, fingers, h, holder) { const m = holder.matrix; alignHand(hand, fingers, HP[0].copy(h.w).applyMatrix4(m), HP[1].copy(h.m).applyMatrix4(m), HP[2].copy(h.i).applyMatrix4(m), HP[3].copy(h.k).applyMatrix4(m)); }
// H: { R: [upper arm, forearm, hand], L: […], fingers: { R: [middle, index, little], L: […] } | null, ofs }
function hold(H, inner, holder, pitch) {
  setFrame(inner);
  at(H.R[0], holder.position).add(H.ofs); holder.rotation.set(-pitch, 0, 0); holder.scale.setScalar(1); holder.updateMatrix();
  const hs = holder.userData.hands;
  if (hs.R) reach(H.R, VT.copy(hs.R.w).applyMatrix4(holder.matrix), POLE.R);
  if (hs.L) reach(H.L, VT.copy(hs.L.w).applyMatrix4(holder.matrix), POLE.L);
  if (H.fingers) { if (hs.R) turnHand(H.R[2], H.fingers.R, hs.R, holder); if (hs.L) turnHand(H.L[2], H.fingers.L, hs.L, holder); }
}
// the overhand throw of a grenade, from the moment the server got it (mp.js throwAt): the right hand leaves the grip,
// flies up behind the head, whips forward over the shoulder, follows through low and comes back to the gun. Targets from
// the right shoulder in the frame of the figure (metres, +z forward, +y up, the right −x); weighed in and out of the hold
const THROW = { back: V3([-0.08, 0.3, -0.2]), fwd: V3([0.02, 0.24, 0.46]), low: V3([0.1, -0.22, 0.34]) }, THROW_POLE = V3([-1, 0.15, -0.35]).normalize();
const TW = new THREE.Vector3(), TS = new THREE.Vector3(), TQ = new THREE.Vector3();
function throwArm(H, inner, t) {
  if (!H || !(t >= 0 && t < 0.72)) return;
  setFrame(inner); at(H.R[2], TW); at(H.R[0], TS);
  const e = k => k * k * (3 - 2 * k), cl = k => Math.max(0, Math.min(1, k));
  if (t < 0.1) TQ.copy(TW).sub(TS).lerp(THROW.back, e(t / 0.1));
  else if (t < 0.22) TQ.copy(THROW.back).lerp(THROW.fwd, (t - 0.1) / 0.12);
  else if (t < 0.46) TQ.copy(THROW.fwd).lerp(THROW.low, e((t - 0.22) / 0.24));
  else TQ.copy(THROW.low).lerp(TW.clone().sub(TS), e(cl((t - 0.46) / 0.26)));
  reach(H.R, TQ.add(TS), THROW_POLE);
}
// at the moment of death the gun is tied to the right hand (rel), then carried by it
function tieToHand(H, inner, holder) { setFrame(inner); return relMatrix(H.R[2], new THREE.Matrix4()).invert().multiply(holder.matrix); }
function carry(H, inner, holder, rel) { setFrame(inner); relMatrix(H.R[2], MA).multiply(rel).decompose(holder.position, holder.quaternion, holder.scale); }
// the flash (muzzle.js) at the muzzle of the gun in hand, along its barrel: on the holder of the AK, on the hand mount of the others
function placeFlash(gun, flash, mount) {
  const g = flash.group;
  if (gun.userData.both) { gun.add(g); g.position.copy(gun.userData.flashAt); } else { mount.add(g); g.position.set(0, 0.04, gun.userData.muzzle); }
}
// a new shot (its time changed): the flash of the weapon in hand
function shotFlash(flash, s, st) { if (s.shotAt && s.shotAt !== st.at) { st.at = s.shotAt; if (!s.dead) flash.fire(1, FLASH_SIZE[st.w] || 1); } flash.tick(st.dt); }
const makeGun = i => { const a = ready(); return heldGun(i) || (a && a.guns && a.guns[i] ? readyGun(a.guns[i], MODEL.gunLen[i], MODEL.gunYaw[i], MODEL.gunM[i]) : boxRifle()); };
// the picked-up sights on a player seen from the side: one node per gun, on the receiver where heldGun put scopeAt.
// The item models come with the city (props.js); until then the guns stay bare and refresh() puts the sights on later.
function scopeKit(guns, getGun) {
  const nodes = guns.map(() => null), kinds = guns.map(() => null);
  function refresh() {
    guns.forEach((g, i) => {
      const kind = kinds[i];
      if (kind && !nodes[i] && g.userData.scopeAt) {
        const src = prop(kind);
        if (src) {
          const n = src.clone(true); n.userData.sight = kind;
          n.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.material = worldSpace(o.material.clone()); } });
          n.position.copy(g.userData.scopeAt); g.add(n); nodes[i] = n;
        }
      }
      if (nodes[i]) nodes[i].visible = !!kind && getGun() === g;
    });
  }
  function setAttach(i, kind) {
    i = Math.max(0, Math.min(guns.length - 1, i | 0)); kinds[i] = kind || null;
    if (!kinds[i] && nodes[i]) { nodes[i].removeFromParent(); nodes[i].traverse(o => { if (o.isMesh) o.material.dispose(); }); nodes[i] = null; }
    refresh();
  }
  onProps(refresh);
  return { setAttach, refresh };
}
const HOLD_OFS = new THREE.Vector3(0, 0, 0);   // the holder from the shoulder joint of the skeleton
// one player's model: update(dt, { speed, air, dead, shotAt, throwAt, flinch }) every frame (shotAt: the time of the last shot, a new one flashes; throwAt: of the last grenade thrown, the arm swings; flinch: { k, zone, side } of a hit just taken — the head snaps back, the spine jolts);
// char — the chosen character of CHARS ('' = the operator); if its file did not come, the operator stands in
function makeAvatar(char) {
  const key = parseChar(char) || 'soldier', cfg = CHARS[key], asset = assets[key] || assets.soldier;
  if (!asset) return null;
  const cc = assets[key] ? cfg : CHARS.soldier;
  const root = clone(asset.scene), inner = new THREE.Group(), mixer = new THREE.AnimationMixer(root), act = {}, C = MODEL.clips;
  root.scale.setScalar(asset.scale); root.position.y = asset.floor; inner.rotation.y = cc.turn; inner.add(root);
  root.traverse(o => {
    if (!o.isMesh) return; o.frustumCulled = false;   // a skinned mesh keeps the bounds of its rest pose
    o.material = worldSpace(Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone());   // the file's textures, uncoloured
  });
  for (const n of [C.idle, C.walk, C.run, C.jump, C.death]) if (asset.clips[n]) { act[n] = mixer.clipAction(asset.clips[n]); act[n].play(); act[n].weight = n === C.idle ? 1 : 0; }
  if (act[C.death]) { act[C.death].setLoop(THREE.LoopOnce, 1); act[C.death].clampWhenFinished = true; }
  // the arms keep the pose of "holding a rifle" whatever the legs and the body do: that pose is taken once from the first frame of the carry clip
  const armBones = MODEL.arms.map(n => root.getObjectByName(n)).filter(o => o && o.isBone), head = root.getObjectByName(MODEL.head);
  const holdMixer = new THREE.AnimationMixer(root); if (asset.clips[C.hold]) { const a = holdMixer.clipAction(asset.clips[C.hold]); a.play(); holdMixer.update(0.001); }
  const armQ = armBones.map(o => o.quaternion.clone()); holdMixer.stopAllAction(); holdMixer.uncacheRoot(root);
  const spine = root.getObjectByName('Spine1') || root.getObjectByName('Spine');   // the flinch bends the spine and the head on top of the clip
  const flHeadQ = head ? head.quaternion.clone() : null, flSpineQ = spine ? spine.quaternion.clone() : null; let flOn = false;
  let deadT = -1, tied = null; const shot = { at: 0, w: 0, dt: 0 };
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
    // the flinch of a hit (the bhit of mp.js): the mixer rewrote the bones this frame, so the offset is fresh every
    // frame; when it ends the pose the bones had before it is put back (a clip that does not move them would keep it)
    if (!s.dead && s.flinch) {
      const k = s.flinch.k, zn = s.flinch.zone;
      if (head) { head.rotation.x -= (zn === 1 ? 0.4 : 0.15) * k; head.rotation.z -= s.flinch.side * 0.12 * k; }
      if (spine) { spine.rotation.x += (zn === 2 ? 0.05 : 0.13) * k; spine.rotation.z -= s.flinch.side * 0.09 * k; }
      flOn = true;
    } else if (flOn) { if (head && flHeadQ) head.quaternion.copy(flHeadQ); if (spine && flSpineQ) spine.quaternion.copy(flSpineQ); flOn = false; }
    if (H && gun.userData.both) { if (!s.dead) hold(H, inner, gun, headProxy.rotation.x); else if (tied) carry(H, inner, gun, tied); }
    if (H && !s.dead && s.throwAt) throwArm(H, inner, (performance.now() - s.throwAt) / 1000);
    shot.dt = dt; shotFlash(flash, s, shot);
  }
  // a mount on the hand in metres: the skeleton of the file is in other units, so the mount is scaled back
  const hand = root.getObjectByName(MODEL.hand), mount = new THREE.Group(), guns = MODEL.guns.map((f, i) => makeGun(i));
  const flash = makeFlash(); let gun = guns[0];
  const kit = scopeKit(guns, () => gun);
  if (hand) { inner.updateMatrixWorld(true); const k = hand.getWorldScale(new THREE.Vector3()).x || 1; mount.scale.setScalar(1 / k); hand.add(mount); }
  mount.quaternion.setFromAxisAngle(new THREE.Vector3(1, 1, 1).normalize(), Math.PI * 2 / 3);   // the axes of the fist: x forward, z up; the gun's muzzle is z, its top y
  guns.forEach((g, i) => { g.visible = i === 0; (g.userData.both ? inner : mount).add(g); });
  function setGun(i) { i = Math.max(0, Math.min(guns.length - 1, i | 0)); guns.forEach((g, k) => { g.visible = k === i; }); gun = guns[i]; shot.w = i; placeFlash(gun, flash, mount); kit.refresh(); }
  const arm = n => MODEL.arms.slice(n, n + 4).map(b => root.getObjectByName(b)), aL = arm(0), aR = arm(4);   // [shoulder, upper arm, forearm, fist]
  const H = aL.every(Boolean) && aR.every(Boolean) ? { R: aR.slice(1), L: aL.slice(1), fingers: null, ofs: HOLD_OFS } : null;
  const headProxy = new THREE.Object3D(), armProxy = new THREE.Object3D(); inner.userData.head = headProxy; inner.userData.arm = armProxy;   // mp.js turns these with the aim
  setGun(0);
  return { root: inner, update, mount, setGun, setAttach: kit.setAttach, mixer, get gun() { return gun; } };
}

// the model of a weapon as its file has it (metres, the muzzle along +z, the grip at the origin): the arms of viewmodel.js hold a clone of it
const gunSource = i => { const a = ready(); return (a && a.guns && a.guns[i]) || null; };
// a ready gun for the viewmodel of the player himself (a clone in metres, the muzzle along +z), or null before the files have come
function gunModel(i) { const a = ready(); return a && a.guns && a.guns[i] ? readyGun(a.guns[i], MODEL.gunLen[i], MODEL.gunYaw[i], MODEL.gunM[i]) : null; }

export { MODEL, CHARS, CHAR_KEYS, gunModel, gunSource, loadAvatar, makeAvatar, parseChar, randomChar, ready };
