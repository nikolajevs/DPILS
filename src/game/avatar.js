import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { worldSpace } from '../render/world-space.js';
import { HOLD, SIGHT_MOUNT, akReady, loadAK, muzzleOf } from './viewmodel.js';
import { prop, onProps } from './props.js';
import { alignHand, at, moveBy, reach, relMatrix, setFrame, turnBy, turnOf } from './ik.js';
import { FLASH_SIZE, makeFlash } from './muzzle.js';
import { makeRagdoll } from './ragdoll.js';

/* ---------- the ready models of the players ----------
   Four characters (CC BY 4.0, see models/README.md), each a rigged body with the same Mixamo clips — standing, the
   steps forward, sideways and back at a walk and at a run, kneeling and the crouched steps, the jump, the fall (see
   STEP_SET and legs() below; tools/char-clips.mjs retargets them onto each skeleton; Carry, the hold of the arms, is
   from tools/character.mjs):
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
  clips: { idle: 'Idle', crouch: 'Crouch', jump: 'Jump', death: 'Death', hold: 'Carry' },   // hold: the pose of the arms with a rifle; the step clips are in STEP_SET
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
// each character on its own: its asset, or null if its file did not come (loadChar)
const charWait = {};
for (const key of CHAR_KEYS) { let res; charWait[key] = { p: new Promise(r => { res = r; }), res }; }
let gunsP = null;
/* The files of the players are many megabytes (the four characters 8.6 MB, the guns 2.9, the AK of viewmodel.js 3.9)
   and come while the city is built. The lobby needs only the chosen character and the AK in its hands, so these are
   asked for first; the other characters and the guns only once both have come (or 12 s later at most). Asked for all at
   once, they shared the line and the chosen figure came with the last of them, after all ~17 MB.
   first: the key of the chosen character (the one kept in the browser, src/game/mp.js), the soldier by default. */
function loadAvatar(first) {
  if (!gunsP) gunsP = import('three/addons/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => {
    const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);   // the character files are packed with EXT_meshopt_compression
    const k0 = parseChar(first) || 'soldier';
    const head = Promise.all([loadChar1(L, k0), loadAK()]);
    const rest = Promise.race([head, new Promise(r => setTimeout(r, 12000))]);
    const chars = rest.then(() => Promise.all(CHAR_KEYS.filter(k => k !== k0).map(k => loadChar1(L, k))));
    // the guns come with the characters; without them the simple rifle is drawn
    const guns = rest.then(() => Promise.all([...new Set(MODEL.guns.filter(Boolean))].map(f => new Promise(r => L.load(f, x => r([f, x.scene]), undefined, () => r([f, null])))))).then(list => {
      const by = Object.fromEntries(list); return MODEL.guns.map((f, i) => level((f && by[f]) || null, MODEL.gunAxes[i]));
    });
    return Promise.all([head, chars, guns]).then(([, , g]) => { for (const k in assets) assets[k].guns = g; return assets.soldier || null; });
  });
  gunsP.catch(() => { for (const k of CHAR_KEYS) charWait[k].res(null); });   // no decoder: no character will come
  return gunsP;
}
// one character's file: its asset ready for makeAvatar, null if it did not come
function loadChar1(L, key) {
  return new Promise(res => {
    L.load(CHARS[key].file, g => {
      const clips = Object.fromEntries(g.animations.map(c => [c.name, c])), probe = clone(g.scene), mixer = new THREE.AnimationMixer(probe);
      if (clips[MODEL.clips.idle]) { mixer.clipAction(clips[MODEL.clips.idle]).play(); mixer.update(0.01); }
      const head = probe.getObjectByName(MODEL.head); if (head) head.scale.setScalar(MODEL.headScale);
      probe.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(probe, true), h = box.max.y - box.min.y || 1, scale = CHARS[key].height / h;
      // the crouched walk backwards is the forward one played in reverse: its own action, so it can blend with the others
      const cf = clips[STEP_SET.crouch.F]; if (cf && !clips[STEP_SET.crouch.B]) { const cb = cf.clone(); cb.name = STEP_SET.crouch.B; cb.userData = { ...cf.userData, rev: true }; clips[cb.name] = cb; }
      // standing, measured once: the height of the head bone over the soles (metres; the crouch is fitted to it) and the
      // height of the hips in their parent (the flight of the jump clip is taken off to it: the jump of the game lifts the body)
      const hips = probe.getObjectByName('Hips'), jt = clips[MODEL.clips.jump] && clips[MODEL.clips.jump].tracks.find(t => t.name === 'Hips.position');
      let jumpLift = null;
      if (hips && jt) {   // the rise of the hips in the jump clip over their standing height, in metres up (their parent may lie turned)
        const ip = jt.createInterpolant(), p0 = hips.position.clone(), M = new THREE.Matrix3().setFromMatrix4(hips.parent.matrixWorld), d = new THREE.Vector3();
        jumpLift = t => d.fromArray(ip.evaluate(t)).sub(p0).applyMatrix3(M).y * scale;
      }
      assets[key] = { scene: g.scene, clips, scale, floor: -box.min.y * scale, headStand: head ? (head.getWorldPosition(new THREE.Vector3()).y - box.min.y) * scale : 0, jumpLift };
      res(assets[key]);
    }, undefined, () => res(null));
  }).then(a => { charWait[key].res(a); return a; });
}
// the asset of one character as soon as its own file has come (null if it did not): the lobby shows the chosen figure
// without waiting for the others and the guns. Asks for the files if nobody has yet, this character first.
function loadChar(key) {
  const k = parseChar(key) || 'soldier';
  loadAvatar(k);
  return charWait[k].p;
}
const hasChar = key => !!assets[parseChar(key) || 'soldier'];
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
// H: { R: [upper arm, forearm, hand], L: […], fingers: { R: [middle, index, little], L: […] } | null, ofs };
// kick: the recoil of the last shot (RECOIL × its decay): the gun jumps back into the shoulder and its muzzle up
function hold(H, inner, holder, pitch, kick = 0) {
  setFrame(inner);
  at(H.R[0], holder.position).add(H.ofs); holder.rotation.set(-pitch - 0.035 * kick, 0, 0); holder.scale.setScalar(1);
  holder.position.add(VT.set(0, -Math.sin(pitch), -Math.cos(pitch)).multiplyScalar(0.022 * kick)); holder.updateMatrix();
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
// a new shot (its time changed): the flash of the weapon in hand; true on the frame of a new shot
function shotFlash(flash, s, st) { let fired = false; if (s.shotAt && s.shotAt !== st.at) { st.at = s.shotAt; if (!s.dead) { flash.fire(1, FLASH_SIZE[st.w] || 1); fired = true; } } flash.tick(st.dt); return fired; }
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
/* ---------- the legs and the body: steps in every direction, the crouch, the jump, the aim ----------
   The players of a firefight strafe, back off, crouch and hop while their guns stay on the enemy. The body faces the aim
   and the legs walk where the player goes: four step clips around (forward, to the left, to the right, back) at a walk,
   at a run and crouched (STEP_SET; tools/char-clips.mjs measured each one's ground speed and the phase its left foot
   lands at). The velocity in the frame of the figure picks the directions — a diagonal mixes its two neighbours so that
   their strides add up along the way the player goes — and the speed the gaits; all the step clips run on one phase,
   each shifted by the phase of its left foot landing, so the feet of a blend land together, and the phase advances so
   that the strides of the blend cover the ground the player covers: the planted foot stays put (RATE: past it the feet
   slide — a sprint is faster than the run clip can step). Standing still it is the rifle idle or the kneel.
   The crouch is a pose, not a squashed figure: the eye height of the snapshot (1.7 → 1.1) weighs the crouched set, and
   the hitboxes of the server (server/combat.mjs: the head 0.1 under the eye) drop 0.6 m with it, so where the clip's
   head stays higher (the crouched walk carries it ~0.27 m over the kneel) the hips go down on bent knees, the feet
   kept where the clip put them (two-bone IK), and the chest bends over; the bob of the steps stays (fit, smoothed).
   A turn on the spot leaves the legs behind: they keep their heading while the chest follows the aim, up to ~45°, then
   they step round after it. The aim bends the spine back or over and lifts or drops the head; a shot kicks the gun
   into the shoulder and the chest back (RECOIL). The jump: the game's flight lifts the body, the clip only gives the
   pose — from the feet leaving the ground at the top speed of the jump to the apex and down to the touch, timed by the
   vertical speed, its own rise of the hips taken off; on landing its touch-down and the dip of the knees play out. */
const STEP_SET = {
  stand: { F: 'Walk', L: 'WalkL', R: 'WalkR', B: 'WalkB' },
  run: { F: 'Run', L: 'RunL', R: 'RunR', B: 'RunB' },
  crouch: { F: 'CrouchF', L: 'CrouchL', R: 'CrouchR', B: 'CrouchB' },   // CrouchB: CrouchF played backwards (loadAvatar)
};
const RATE = [0.6, 1.9];   // the step clips play at most this much slower or faster than their own speed
const SIDES = ['F', 'L', 'R', 'B'], UF = { F: 1, B: -1, L: 0, R: 0 }, UR = { F: 0, B: 0, L: -1, R: 1 };   // the directions in the frame of the figure: forward, to its right
const RECOIL = [1, 2.2, 2.6, 0.7, 0.8];   // the kick of a shot by weapon (rifle, shotgun, sniper, pistol, machine gun)
const JUMP_V = 6.4;   // the take-off speed of a jump (player.js JUMP.v): the flight runs from it to −JUMP_V
const LEGS_TWIST = 0.8, LEGS_MAX = 1.3;   // the legs step round after the aim past ~45°; the body never twists more than ~75°
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / ((b - a) || 1))); return t * t * (3 - 2 * t); };
const ease = (rate, dt) => 1 - Math.exp(-rate * dt), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), QA = new THREE.Quaternion(), QB = new THREE.Quaternion(), QC = new THREE.Quaternion();
const FT = [new THREE.Vector3(), new THREE.Vector3()], FQ = [new THREE.Quaternion(), new THREE.Quaternion()], VH = new THREE.Vector3(), VP = new THREE.Vector3();
const CW = Array.from({ length: 12 }, () => new THREE.Quaternion()), QD = new THREE.Quaternion();
// a turn q given in the frame, made in the local turn of a bone whose parent stands turned by w in the frame
const localTurn = (o, w, q) => o.quaternion.premultiply(QD.copy(w).invert().multiply(q).multiply(w));
/* The body on top of the clips, in the frame of the figure (+z forward, +x its left; a turn about +x by a positive angle
   bends forward). B — the bones: hips; the chain from the hips to the head (B.chain, the spine bones among them B.bend);
   K, T, S — how the parent of the hips stands in the frame (a turn, a place, a scale; fixed). st — { lift, twist, crouch,
   moving, headStand, pitch, kick, fit } (fit is kept between frames); far: only what the hitboxes need (the flight and the
   crouch), not the aim. The turns are put into the local turns of the bones down the chain, worked out from the turns
   of the clip: no matrices are recomputed here (hold() does it once for all) — but for the crouched walk, whose knees
   bend by IK on the matrices. */
function body(B, inner, st, dt, far) {
  const h = B.hips, ch = B.chain, n = ch.length;
  const tw = far ? 0 : st.twist, p = far ? 0 : clamp(st.pitch, -0.9, 0.9);
  // the hips: the clip's own rise off in the air (the game lifts the body), the legs' own heading
  if (st.lift > 1e-3) h.position.add(VP.set(0, -st.lift / B.S, 0).applyQuaternion(QD.copy(B.K).invert()));
  if (Math.abs(tw) > 1e-3) localTurn(h, B.K, QA.setFromAxisAngle(AY, tw));
  // the turns of the chain in the frame (CW[0] the hips) and, for the crouch, the height of the head bone
  CW[0].copy(B.K).multiply(h.quaternion); for (let i = 0; i < n; i++) CW[i + 1].copy(CW[i]).multiply(ch[i].quaternion);
  // the crouch fitted to the hitboxes: how far the head bone is over where the eye height puts it (smoothed: the steps bob)
  let drop = 0, hunch = 0;
  if (B.head && st.crouch > 0.02) {
    let s = B.S; VH.copy(h.position).multiplyScalar(s).applyQuaternion(B.K).add(B.T); s *= h.scale.x;
    for (let i = 0; i < n; i++) { VH.add(VP.copy(ch[i].position).multiplyScalar(s).applyQuaternion(CW[i])); s *= ch[i].scale.x; }
    st.fit += (Math.max(0, VH.y - (st.headStand - 0.6 * st.crouch) - 0.05) - st.fit) * ease(5, dt);
  } else st.fit *= 1 - ease(8, dt);
  if (st.fit > 0.005) { drop = Math.min(0.2, st.fit * 0.6) * st.moving; hunch = clamp((st.fit - drop) / 0.5, 0, 0.6); }   // a kneel only bends over: its knee is on the ground
  if (drop > 0.005 && B.legs) {   // the hips go down, the feet stay where the clip put them: the knees bend (two-bone IK)
    setFrame(inner);
    for (let k = 0; k < 2; k++) { at(B.legs[k][2], FT[k]); turnOf(B.legs[k][2], FQ[k]); }
    moveBy(h, VH.set(0, -drop, 0));
    for (let k = 0; k < 2; k++) { reach(B.legs[k], FT[k]); turnOf(B.legs[k][2], QC); turnBy(B.legs[k][2], QB.copy(FQ[k]).multiply(QC.invert())); }   // the knee bends where the clip bent it, the foot keeps its turn
  }
  // the spine: the twist of the legs undone, the lean with the aim (back to aim up, over to aim down), the hunch, the
  // kick; the same turn q about each spine bone's joint. Each bone's local turn takes q seen from its parent as the clip
  // had it, and everything above it rides along, so the head's parent ends up turned by q^(number of spine bones)
  const bend = B.bend.length, lean = -0.45 * p + hunch - 0.025 * st.kick, look = -0.35 * p - 0.9 * hunch;
  if (bend && Math.abs(lean) + Math.abs(tw) > 1e-3) {
    QB.setFromAxisAngle(AX, lean / bend).multiply(QC.setFromAxisAngle(AY, -tw / bend));
    QA.identity();
    for (let i = 0; i < n; i++) {
      if (B.isBend[i]) { localTurn(ch[i], CW[i], QB); QA.premultiply(QB); }
      CW[i + 1].premultiply(QA);   // (the turns above a bent bone take its bend; CW[i] itself is its parent's, already turned)
    }
  }
  if (B.head && Math.abs(look) > 1e-3) localTurn(B.head, CW[n - 1], QC.setFromAxisAngle(AX, look));   // the eyes along the gun
}
// one player's model: update(dt, s) every frame, s = { vx, vz, yaw, pitch, h, air, vy, dead, shotAt, throwAt, flinch, fall, vel }:
// vx, vz — the velocity over the ground (m/s, the world), yaw — where the figure faces (as the group of mp.js turns),
// pitch — the aim up (+) or down, h — the height of the eyes (1.7 standing, 1.1 crouched), air — off the ground, vy — the
// vertical speed of the feet; (speed alone, without vx and vz, walks forward). shotAt: the time of the last shot, a new
// one flashes and kicks; throwAt: of the last grenade thrown, the arm swings; flinch: { k, zone, side } of a hit just
// taken — the head snaps back, the spine jolts. On death the skeleton falls by physics (ragdoll.js): fall — the
// direction of the killing blow { x, z, head, nade }, vel — the speed the player had; without the bones for it the
// death clip plays as before. lod: far away — the lean with the aim and the twist of the legs are skipped (body()).
// char — the chosen character of CHARS ('' = the operator); if its file did not come, the operator stands in
/* The bounds of a skinned body, for the cull of each camera. three tests a skinned mesh by its own boundingSphere, and
   the one it would compute is the pose of one moment; so the bodies used to be drawn by every camera always — the
   screen, the glass of the walls, the maps of the sun and the lamps — the players behind your back too, each mesh a
   draw call and a skeleton upload. Now the sphere is the rest pose of the file (computed once per geometry, the
   clones share it) grown by CULL_PAD metres: room for any step, the crouch, the jump, the gun held out and a body the
   ragdoll threw (ragdoll.js moves the bones, not the player), so a body is culled only when it is well out of view. */
const CULL_PAD = 2.5, SV = new THREE.Vector3();
function cullBounds(o) {
  const g = o.geometry.userData;
  if (!g.cullSphere) { o.computeBoundingSphere(); g.cullSphere = o.boundingSphere.clone(); g.cullSphere.radius += CULL_PAD / (SV.setFromMatrixScale(o.matrixWorld).x || 1); }
  o.boundingSphere = g.cullSphere.clone(); o.frustumCulled = true;
}
function makeAvatar(char) {
  const key = parseChar(char) || 'soldier', cfg = CHARS[key], asset = assets[key] || assets.soldier;
  if (!asset) return null;
  const cc = assets[key] ? cfg : CHARS.soldier;
  const root = clone(asset.scene), inner = new THREE.Group(), mixer = new THREE.AnimationMixer(root), act = {}, C = MODEL.clips;
  root.scale.setScalar(asset.scale); root.position.y = asset.floor; inner.rotation.y = cc.turn; inner.add(root);
  inner.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) cullBounds(o);
    o.material = worldSpace(Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone());   // the file's textures, uncoloured
  });
  for (const n of [C.idle, C.crouch, C.jump, C.death]) if (asset.clips[n]) { act[n] = mixer.clipAction(asset.clips[n]); act[n].play(); act[n].weight = n === C.idle ? 1 : 0; }
  if (act[C.death]) { act[C.death].setLoop(THREE.LoopOnce, 1); act[C.death].clampWhenFinished = true; }
  if (act[C.jump]) act[C.jump].timeScale = 0;   // posed by the flight, not played
  // the step clips, each with its ground speed in metres a second and the phases of its left foot (tools/char-clips.mjs)
  const steps = [];
  for (const set in STEP_SET) for (const side in STEP_SET[set]) {
    const clip = asset.clips[STEP_SET[set][side]], ud = clip && clip.userData; if (!ud || !(ud.speed > 0)) continue;
    const a = mixer.clipAction(clip); a.play(); a.weight = 0; a.timeScale = 0;
    steps.push({ a, set, side, dur: clip.duration, speed: ud.speed * asset.scale, plant: ud.plant || 0, lift: ud.lift || 0, rev: !!ud.rev });
  }
  const stepOf = (set, side) => steps.find(x => x.set === set && x.side === side), speedOf = (set, side) => { const e = stepOf(set, side); return e ? e.speed : 0; };
  // the walk gives way to the run between the walk's own speed and halfway to the run's, in each direction
  const GAIT = {}; for (const d of SIDES) { const w = speedOf('stand', d), r = speedOf('run', d); GAIT[d] = !r ? [1e9, 2e9] : !w ? [-2, -1] : [w, Math.max(w + 0.3, (w + r) / 2)]; }
  // the stride of each clip (metres a cycle): a diagonal mixes its two neighbours so that their strides add up along the
  // way the player goes (a half-and-half of a forward and a side step would point 5° off and step 30 % short)
  const STRIDE = {}; for (const set in STEP_SET) { STRIDE[set] = {}; for (const d of SIDES) { const e = stepOf(set, d); STRIDE[set][d] = e ? e.speed * e.dur : 0; } }
  const J = { takeoff: 0.57, apex: 0.81, land: 1.08, ...((asset.clips[C.jump] || {}).userData || {}) };
  // the arms keep the pose of "holding a rifle" whatever the legs and the body do: that pose is taken once from the first frame of the carry clip
  const armBones = MODEL.arms.map(n => root.getObjectByName(n)).filter(o => o && o.isBone), head = root.getObjectByName(MODEL.head);
  const holdMixer = new THREE.AnimationMixer(root); if (asset.clips[C.hold]) { const a = holdMixer.clipAction(asset.clips[C.hold]); a.play(); holdMixer.update(0.001); }
  const armQ = armBones.map(o => o.quaternion.clone()); holdMixer.stopAllAction(); holdMixer.uncacheRoot(root);
  const spine = root.getObjectByName('Spine1') || root.getObjectByName('Spine');   // the flinch bends the spine and the head on top of the clip
  const bone = n => root.getObjectByName(n), leg = s => [bone('thigh_' + s), bone('calf_' + s), bone('foot_' + s)];
  const B = { hips: bone('Hips'), head, legs: [leg('l'), leg('r')], chain: [], bend: [], isBend: [], K: new THREE.Quaternion(), T: new THREE.Vector3(), S: 1 };
  if (!B.legs.every(l => l.every(Boolean))) B.legs = null;
  if (B.hips) {   // the chain from the hips to the head (2B has a fourth spine bone in it) and the stand of the hips' parent in the frame
    for (let o = head; o && o !== B.hips && o !== root; o = o.parent) B.chain.unshift(o);
    if (!head || B.chain[0].parent !== B.hips) { B.chain = []; B.head = null; }
    B.bend = ['Spine', 'Spine1', 'Spine2'].map(bone).filter(o => o && B.chain.includes(o)); B.isBend = B.chain.map(o => B.bend.includes(o));
    inner.updateMatrixWorld(true); setFrame(inner); const s = new THREE.Vector3(); relMatrix(B.hips.parent, new THREE.Matrix4()).decompose(B.T, B.K, s); B.S = s.x || 1;
  }
  let deadT = -1, tied = null, ragdoll = null; const shot = { at: 0, w: 0, dt: 0 };
  // the state of the legs: the velocity in the frame of the figure (f forward, r to its right), the direction weights,
  // the phase of the steps, the crouch, the heading of the legs against the aim, the flight and the landing
  let mvF = 0, mvR = 0, dirF = 1, dirR = 0, phase = 0, crouch = 0, lastYaw = null, airW = 0, wasAir = false, jumpT = J.takeoff, landT = -1, turning = false;
  const dirW = {}, st = { lift: 0, twist: 0, crouch: 0, moving: 0, headStand: asset.headStand, pitch: 0, kick: 0, fit: 0 };
  function legs(dt, s) {
    const yaw = s.yaw || 0, sy = Math.sin(yaw), cy = Math.cos(yaw), k = ease(10, dt);
    const vx = s.vx ?? -sy * (s.speed || 0), vz = s.vz ?? -cy * (s.speed || 0);
    mvF += (-(vx * sy + vz * cy) - mvF) * k; mvR += ((vx * cy - vz * sy) - mvR) * k;
    const v = Math.hypot(mvF, mvR), m = sstep(0.2, 0.7, v);
    if (v > 0.05) { dirF = mvF / v; dirR = mvR / v; }   // nearly still: the last direction
    for (const set in STRIDE) {   // the two neighbours of the direction, each by its share of the way over its stride
      const L = STRIDE[set], a = { F: L.F && Math.max(0, dirF) / L.F, B: L.B && Math.max(0, -dirF) / L.B, R: L.R && Math.max(0, dirR) / L.R, L: L.L && Math.max(0, -dirR) / L.L };
      const sum = a.F + a.B + a.R + a.L || 1; dirW[set] = { F: a.F / sum, B: a.B / sum, R: a.R / sum, L: a.L / sum };
    }
    crouch += (clamp((1.7 - (s.h || 1.7)) / 0.6, 0, 1) - crouch) * ease(10, dt);
    // the flight: the pose of the jump clip by the vertical speed; the landing plays its touch-down out
    if (s.air) {
      airW += (1 - airW) * ease(14, dt); landT = -1;
      const vy = s.vy || 0, t = vy > 0 ? J.takeoff + (J.apex - J.takeoff) * clamp(1 - vy / JUMP_V, 0, 1) : J.apex + (J.land - 0.04 - J.apex) * clamp(-vy / JUMP_V, 0, 1);
      jumpT = wasAir ? jumpT + (t - jumpT) * ease(18, dt) : t;
    } else {
      if (wasAir) landT = 0;
      if (landT >= 0) { landT += dt; jumpT = J.land + landT; if (landT > 0.5) landT = -1; }
      airW = landT >= 0 ? Math.min(airW, (1 - landT / 0.5) * (1 - 0.55 * m)) : airW * (1 - ease(12, dt));   // a run lands through it quicker
    }
    wasAir = !!s.air;
    // the legs against the aim: standing, they keep their heading while the chest turns, and step round after it
    const dyaw = lastYaw === null ? 0 : wrap(yaw - lastYaw); lastYaw = yaw;
    if (m > 0.5 || s.air) { st.twist *= 1 - ease(10, dt); turning = false; }
    else {
      st.twist = clamp(st.twist - dyaw, -LEGS_MAX, LEGS_MAX);
      if (Math.abs(st.twist) > LEGS_TWIST) turning = true;
      if (turning) { st.twist -= Math.sign(st.twist) * Math.min(Math.abs(st.twist), dt * 6); if (Math.abs(st.twist) < 0.04) turning = false; }
    }
    const stepW = turning ? 0.65 * (1 - m) : 0, stepSide = st.twist > 0 ? 'R' : 'L';   // the shuffle of the feet while they turn
    // the weights: the air pose over everything, then standing or stepping, upright or crouched
    const base = 1 - airW, ground = base * (1 - m), still = ground * (1 - stepW);
    // the phase runs so that the strides of the blend, added up along their directions, cover the ground the player covers
    let sf = 0, sr = 0, W = 0, D = 0;
    for (const e of steps) {
      const g = sstep(GAIT[e.side][0], GAIT[e.side][1], v), setW = e.set === 'crouch' ? crouch : (1 - crouch) * (e.set === 'run' ? g : 1 - g);
      let t = base * m * dirW[e.set][e.side] * setW;
      if (stepW && e.side === stepSide && e.set !== 'run') t += ground * stepW * (e.set === 'crouch' ? crouch : 1 - crouch);
      e.a.weight += (t - e.a.weight) * ease(12, dt); if (e.a.weight < 1e-3) e.a.weight = 0;
      if (e.a.weight) { const w = e.a.weight, L = e.speed * e.dur; sf += w * L * UF[e.side]; sr += w * L * UR[e.side]; W += w; D += w * e.dur; }
    }
    if (W) { const d = D / W; phase = (phase + dt * clamp(Math.max(v, stepW * 1.4) / Math.max(0.05, Math.hypot(sf, sr) / W), RATE[0] / d, RATE[1] / d)) % 1; }
    for (const e of steps) { const ph = e.rev ? e.lift - phase : e.plant + phase; e.a.time = (ph - Math.floor(ph)) * e.dur; }
    const tgt = { [C.idle]: still * (1 - crouch), [C.crouch]: still * crouch, [C.jump]: airW, [C.death]: 0 };
    for (const n in act) { act[n].weight += ((tgt[n] || 0) - act[n].weight) * (n === C.jump ? 1 : ease(12, dt)); if (act[n].weight < 1e-3) act[n].weight = 0; }
    if (act[C.jump]) act[C.jump].time = jumpT;
    st.crouch = crouch; st.moving = m;
  }
  function update(dt, s) {
    if (s.dead && deadT < 0) {
      deadT = 0; tied = H && gun.userData.both ? tieToHand(H, inner, gun) : null;
      ragdoll = makeRagdoll(inner, n => root.getObjectByName(n), { fall: s.fall, vel: s.vel });   // the body falls from the pose it had, thrown by the blow
      if (!ragdoll && act[C.death]) { for (const n in act) act[n].weight = 0; for (const e of steps) e.a.weight = 0; act[C.death].weight = 1; act[C.death].reset(); act[C.death].play(); }
    } else if (!s.dead && deadT >= 0) {   // back alive: the clips wait in the idle pose and the rise blends out of it
      deadT = -1; ragdoll = null; for (const e of steps) e.a.weight = 0; for (const n in act) act[n].weight = n === C.idle ? 1 : 0; airW = 0; landT = -1; st.twist = 0; st.fit = 0; lastYaw = null;
    }
    if (ragdoll) ragdoll.step(dt);
    else { if (!s.dead) legs(dt, s); mixer.update(dt); }
    shot.dt = dt; const fired = shotFlash(flash, s, shot);
    st.kick = fired ? RECOIL[shot.w] || 1 : st.kick * (1 - ease(11, dt));
    if (s.dead) { if (H && gun.userData.both && tied) carry(H, inner, gun, tied); return; }
    armBones.forEach((o, i) => o.quaternion.copy(armQ[i]));
    if (head) head.scale.setScalar(MODEL.headScale);
    st.pitch = s.pitch ?? headProxy.rotation.x;
    st.lift = s.air && asset.jumpLift && act[C.jump] ? act[C.jump].weight * Math.max(0, asset.jumpLift(jumpT)) : 0;   // the flight lifts the body, not the clip
    if (B.hips) body(B, inner, st, dt, !!s.lod);
    // the flinch of a hit (the bhit of mp.js), on top of the clip: the mixer rewrote the bones this frame, so the
    // offset is fresh every frame
    if (s.flinch) {
      const k = s.flinch.k, zn = s.flinch.zone;
      if (head) { head.rotation.x -= (zn === 1 ? 0.4 : 0.15) * k; head.rotation.z -= s.flinch.side * 0.12 * k; }
      if (spine) { spine.rotation.x += (zn === 2 ? 0.05 : 0.13) * k; spine.rotation.z -= s.flinch.side * 0.09 * k; }
    }
    if (H && gun.userData.both) hold(H, inner, gun, st.pitch, st.kick);
    if (H && s.throwAt) throwArm(H, inner, (performance.now() - s.throwAt) / 1000);
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

export { MODEL, CHARS, CHAR_KEYS, gunModel, gunSource, hasChar, loadAvatar, loadChar, makeAvatar, parseChar, randomChar, ready };
