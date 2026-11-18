import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P, freeSpot, keys } from './player.js';
import { PLACES } from '../ui/places.js';
import { buildingAt, onRoad } from '../world/data.js';
import { PERF } from './perf.js';
import { worldSpace } from '../render/world-space.js';
import { gunModel, loadAvatar, loadHumans, makeAvatar, parseLook, ready as avatarReady, humansReady } from './avatar.js';
import { akSettled, loadAK, makeViewmodel } from './viewmodel.js';
import { SET, keyName, onChange } from './settings.js';
import { firstGames } from './help.js';
import { rememberServer } from '../ui/servers.js';
import { addNade, boomNade, clearNades, tickNades } from './nades.js';
import { KINDS, bindInv, setItems, itemBack, itemTook, tickItems, renderInv, closeInv, toggleInv } from './inventory.js';
import { terrainH } from '../world/terrain.js';
import { camera, canvas, scene } from '../render/renderer.js';
import { CH, addLine, openChat } from './chat.js';
import { createVoice } from './voice.js';
import { openLocal } from './local.js';
import { ambStart, ambTick } from './ambience.js';
import { statEvent } from './stats.js';
import { playerKey, boardOn, setBoardOn, account } from './identity.js';
import { initLeaders } from './leaders.js';
import { $ } from '../core/env.js';
import { boomSound, crackSound, hitSound, loadSounds, shotSound, stepSound } from './sfx.js';
import { tracerShot, tickFx, clearFx, dmgFloat, ejectShell, muzzleSmoke, muzzleTex } from './impacts.js';

/* ---------- online shooter: deathmatch on the city map ----------
   The server (server/index.mjs) owns health, kills and respawns. This module: the connection, the other players
   (simple procedural figures, drawn 120 ms in the past between two snapshots), the gun in hand, shooting with the
   line of fire checked against terrain and buildings, and the game panels. Keep RULES and rayToSegment in step with
   server/combat.mjs. */
const RULES = { hitR: 0.4, headR: 0.28, bodyBottom: 1.6, bodyTop: 0.05 };
// the weapons (keep server/combat.mjs in step; the server has the damage): the rifle fires bursts, the shotgun
// throws eight pellets in a cone, one shot per click
const WEAPONS = [
  { name: 'Автомат', mag: 30, reloadMs: 1800, gapMs: 100, range: 160, pellets: 1, cone: 0, auto: true },
  { name: 'Дробовик', mag: 6, reloadMs: 2600, gapMs: 800, range: 45, pellets: 8, cone: 0.05, auto: false },
  { name: 'Снайперская', mag: 5, reloadMs: 2800, gapMs: 1300, range: 400, pellets: 1, cone: 0, auto: false, scope: true },   // right mouse button: the scope
  { name: 'Пистолет', mag: 12, reloadMs: 1400, gapMs: 170, range: 90, pellets: 1, cone: 0, auto: false, base: 0.001, kick: 0.006, vol: 0.25, hear: 150 },
  { name: 'Пулемёт', mag: 100, reloadMs: 4500, gapMs: 65, range: 140, pellets: 1, cone: 0, auto: true, base: 0.012, burst: 0.003, cap: 0.05, kick: 0.004, vol: 0.45, hear: 260 },
];
// what the weapons of the table do not say themselves: the kick of one shot, how loud, how far it is heard, the size of the gun in your hands
const FEEL = { kick: 0.0035, vol: 0.35, hear: 220, vm: 0.55 };
const MP = { ffa: false, on: false, ws: null, id: 0, name: '', hp: 100, dead: false, deadAt: 0, weapon: 0, nades: 2, lastNade: 0, spec: 0, scope: false, zoom: 0, ammo: [30, 6, 5, 12, 100], reserve: [90, 24, 15, 36, 200], meds: 0, lastMed: 0, noAmmoAt: 0, reloadAt: 0, reloadW: 0, lastShot: 0, firing: false, burst: 0, rtt: 0, kills: 0, deaths: 0, board: [], team: 0, teams: ['Красные', 'Синие'], score: [0, 0], win: 30, spawn: 0, kick: 0, sendT: 0 };
// the pockets (keep server/combat.mjs in step: RESERVE and INV): the server owns them, the page only shows and predicts
const RESERVE = [90, 24, 15, 36, 200], NADE_MAX = 3, MED_MAX = 2;
bindInv({ useMed, switchWeapon, beep: kind => { if (kind === 'pick') tone(660, 990, 0.09, 0.22, 'triangle'); else if (kind === 'med') tone(440, 660, 0.16, 0.25, 'sine'); else tone(180, 120, 0.12, 0.2, 'square'); } });
function useMed() {
  const now = performance.now();
  if (MP.dead || MP.meds <= 0 || MP.hp >= 100 || now - MP.lastMed < 800 || !MP.ws || MP.ws.readyState !== 1) return;
  MP.lastMed = now; MP.ws.send(JSON.stringify({ t: 'use', kind: 'med' }));
}
STATE.mp = false;
let voice = null;
const remotes = new Map();   // id → { name, group, buf: [{ t, x, y, z, yaw, pitch }], tag }
const DEFAULT_SERVER = '';   // e.g. 'wss://dpils-game.example.com'; empty: ?server=…, the saved address, or localhost

/* ---------- geometry ---------- */
function rayToSegment(o, d, len, a, b) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = o[0] - a[0], wy = o[1] - a[1], wz = o[2] - a[2];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], B = d[0] * ux + d[1] * uy + d[2] * uz, C = ux * ux + uy * uy + uz * uz;
  const D = d[0] * wx + d[1] * wy + d[2] * wz, E = ux * wx + uy * wy + uz * wz, den = A * C - B * B;
  let t = den > 1e-9 ? (B * E - C * D) / den : 0, s;
  t = Math.max(0, Math.min(len, t)); s = C > 0 ? Math.max(0, Math.min(1, (B * t + E) / C)) : 0;
  t = Math.max(0, Math.min(len, (B * s - D) / A));
  const px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t, qx = a[0] + ux * s, qy = a[1] + uy * s, qz = a[2] + uz * s;
  return { dist: Math.hypot(px - qx, py - qy, pz - qz), t };
}
// how far the shot flies before the ground or a roof line stops it
function freePath(o, d, len) {
  for (let t = 1.5; t < len; t += 1.5) {
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t, g = terrainH(x, z);
    if (y < g) return t;
    const b = buildingAt(x, z); if (b && y < g + (b.top || 12)) return t;
  }
  return len;
}
const aim = (yaw = P.yaw, pitch = P.pitch) => { const cp = Math.cos(pitch); return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]; };
// how wide the shots scatter now: a little always, more when walking or running, more after each shot of a burst
const MOVE = () => [SET.keys.forward, SET.keys.back, SET.keys.left, SET.keys.right];
function spreadNow() {
  if (W().scope) return (MP.zoom > 0.9 ? 0.0004 : 0.04) + (MOVE().some(k => keys.has(k)) ? 0.03 : 0) + (P.up > 0.02 ? 0.04 : 0);   // steady only when scoped and still
  const moving = MOVE().some(k => keys.has(k)), run = keys.has(SET.keys.run) || keys.has('ShiftRight');
  if (W().cone) return W().cone * (P.crouch ? 0.8 : 1) + (moving ? 0.01 : 0) + (P.up > 0.02 ? 0.03 : 0);   // the shotgun's pellets spread in a wide cone
  return ((W().base ?? 0.002) + (moving ? (run ? 0.022 : 0.008) : 0) + MP.burst) * (P.crouch ? 0.5 : 1) + (P.up > 0.02 ? 0.03 : 0);   // crouching steadies the aim, a jump spoils it
}

/* ---------- figures of the other players ---------- */
const GEO = { box: new THREE.BoxGeometry(1, 1, 1), head: new THREE.SphereGeometry(0.17, 12, 8) };
const HUE = [0.0, 0.6];   // red and blue team
function makeFigure(hue) {
  const col = new THREE.Color().setHSL(hue, 0.65, 0.42), dark = new THREE.Color().setHSL(hue, 0.5, 0.2);
  const mc = worldSpace(new THREE.MeshLambertMaterial({ color: col })), md = worldSpace(new THREE.MeshLambertMaterial({ color: dark })), ms = worldSpace(new THREE.MeshLambertMaterial({ color: 0xe0b890 })), mg = worldSpace(new THREE.MeshLambertMaterial({ color: 0x25272b }));
  const g = new THREE.Group(); g.rotation.order = 'YXZ'; const part = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO.box, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o; };
  part(md, 0.2, 0.8, 0.22, -0.12, 0.4, 0); part(md, 0.2, 0.8, 0.22, 0.12, 0.4, 0);   // legs
  part(mc, 0.46, 0.6, 0.26, 0, 1.1, 0);   // torso
  part(mc, 0.13, 0.55, 0.13, -0.3, 1.12, 0); const arm = part(mc, 0.13, 0.13, 0.55, 0.28, 1.2, -0.25);   // arms: the right one holds the gun forward
  part(mg, 0.07, 0.1, 0.62, 0.28, 1.2, -0.45);   // the gun
  const head = new THREE.Mesh(GEO.head, ms); head.position.set(0, 1.58, 0); g.add(head);
  g.userData.head = head; g.userData.arm = arm; return g;
}
function addRemote(id, name, team, look) {
  if (remotes.has(id) || id === MP.id) return remotes.get(id);
  const hue = MP.ffa ? (id * 0.381966) % 1 : (HUE[team] ?? 0.3), group = makeFigure(hue), tag = document.createElement('div'); tag.className = 'mp-tag ' + (MP.ffa ? 'tf' : 't' + team); if (MP.ffa) tag.style.background = 'hsla(' + Math.round(hue * 360) + ', 55%, 32%, .78)'; tag.textContent = name || '…'; group.visible = false; scene.add(group); $('mpTags').append(tag);
  const r = { name, team, hue, group, buf: [], tag, look: parseLook(look) ? look : '', figHead: group.userData.head, figArm: group.userData.arm }; remotes.set(id, r); attachAvatar(r); return r;
}
// the ready animated model instead of the simple figure, as soon as its file has come; look — the chosen person
function attachAvatar(r) {
  if (r.av) return;
  if (!akSettled()) { loadAK().then(() => { if (!r.av && remotes.has(r.id)) attachAvatar(r); }); return; }   // their AK is in the file of the arms
  if (r.look) {   // the people's files are heavier: they come only when someone has chosen a person
    if (!humansReady()) { loadHumans().then(h => { if (h && !r.av && remotes.has(r.id)) attachAvatar(r); }); return; }
  } else if (!avatarReady()) return;
  const av = makeAvatar(r.hue, r.look); if (!av) return;
  for (const c of r.group.children) c.visible = false; r.group.add(av.root); r.av = av;
  if (av.root.userData.head) { r.group.userData.head = av.root.userData.head; r.group.userData.arm = av.root.userData.arm; }   // the aim turns the proxies of the person
}
function rebuildAvatar(r) {   // the look changed on the board: the old model off, the new one on
  if (r.av) {
    r.group.remove(r.av.root);
    r.av.root.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); });
    r.av = null; r.group.userData.head = r.figHead; r.group.userData.arm = r.figArm;
  }
  attachAvatar(r);
}
// the gun in your own hands: the ready models in place of the boxes
function upgradeViewmodels() {
  models.forEach((m, i) => {
    if (i === 0 && vm) return;   // the AK has the arms of viewmodel.js
    const g = gunModel(i); if (!g || m.userData.ready) return; m.userData.ready = true;
    m.children.forEach(c => { if (!c.userData.keep) c.visible = false; });   // the old boxes off (the hands stay)
    g.rotation.y = Math.PI; g.scale.multiplyScalar([0.55, 0.55, 0.5, 0.85, 0.5][i] ?? FEEL.vm); g.position.set(0.05, i === 3 ? 0.07 : -0.02, i === 3 ? 0.02 : 0.12); m.add(g); if (i === 0) flash.position.set(0.05, 0.0, -g.userData.muzzle * 0.55 + 0.1);
    placeHands(hands[i], HAND_REAL[i]);   // the real model's grip sits a little differently than the box's
  });
}
// the AK in your own hands: the arms of the soldier with their clips (viewmodel.js) in place of the boxes. Its file
// comes before the avatars: they take their AK from it
let vm = null, vmX = 0, vmZ = 0, vmSpeed = 0;
function upgradeAK() {
  if (vm) return; vm = makeViewmodel(camera); if (!vm) return;
  models[0].clear(); MP.vm = vm; if (MP.weapon === 0 && !MP.dead) vm.equip();
}
function dropRemote(id) { const r = remotes.get(id); if (!r) return; scene.remove(r.group); r.tag.remove(); remotes.delete(id); }
function nameOf(id) { const b = MP.board.find(e => e.id === id); return b ? b.name : '?'; }
const isMate = r => !MP.ffa && r.team === MP.team;   // in the free-for-all nobody is a teammate
function teamOf(id) { const b = MP.board.find(e => e.id === id); return b ? b.team : 0; }
function pose(r, t) {
  const b = r.buf; if (!b.length) return null;
  while (b.length > 2 && b[1].t <= t) b.shift();
  const a = b[0], c = b[1] || a, k = c.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (c.t - a.t))) : 1, l = (u, v) => u + (v - u) * k;
  let dy = c.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return { x: l(a.x, c.x), y: l(a.y, c.y), z: l(a.z, c.z), yaw: a.yaw + dy * k, pitch: l(a.pitch, c.pitch), h: l(a.h || 1.7, c.h || 1.7), w: c.w || 0 };
}

/* ---------- the gun in hand, tracers, sounds ---------- */
const gun = new THREE.Group(), models = WEAPONS.map(() => new THREE.Group());
(function () {
  const m1 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x2a2d31 })), m2 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x6b4a2b })), m3 = worldSpace(new THREE.MeshLambertMaterial({ color: 0x555a60 }));
  const add = (g, m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO.box, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); };
  const [r, s, n] = models;
  add(r, m1, 0.06, 0.09, 0.52, 0, 0, 0); add(r, m1, 0.03, 0.03, 0.18, 0, 0.0, -0.33); add(r, m2, 0.055, 0.16, 0.1, 0, -0.11, 0.14); add(r, m1, 0.045, 0.13, 0.07, 0, -0.1, -0.06);   // rifle
  add(s, m3, 0.035, 0.035, 0.8, -0.022, 0.012, -0.12); add(s, m3, 0.035, 0.035, 0.8, 0.022, 0.012, -0.12); add(s, m2, 0.075, 0.06, 0.22, 0, -0.045, -0.3); add(s, m1, 0.07, 0.1, 0.3, 0, -0.01, 0.2); add(s, m2, 0.06, 0.16, 0.3, 0, -0.07, 0.38);   // shotgun: two barrels, pump, stock
  add(n, m1, 0.045, 0.07, 1.0, 0, 0, -0.2); add(n, m3, 0.02, 0.02, 0.45, 0, 0.0, -0.95); add(n, m1, 0.05, 0.05, 0.28, 0, 0.065, -0.15); add(n, m2, 0.06, 0.15, 0.4, 0, -0.06, 0.4); add(n, m1, 0.04, 0.12, 0.07, 0, -0.08, 0.02);   // sniper rifle: long barrel, scope, stock
  models.slice(3).forEach(m => add(m, m1, 0.05, 0.08, 0.4, 0, 0, -0.1));   // the simple boxes of the weapons that have no ready model yet
  models.forEach((m, k) => { m.visible = k === 0; gun.add(m); });
  gun.position.set(0.17, -0.16, -0.5); gun.scale.setScalar(0.8); gun.visible = false; camera.add(gun); scene.add(camera);   // a touch higher so the hands on the grip show above the bottom edge
})();
// the hands that hold the gun: a fist on the grip, a supporting hand on the forend, the sleeves going off the bottom of the
// frame. They live inside each weapon model, so they switch, kick and tilt with it and hide when the scope is up.
const vmSkin = worldSpace(new THREE.MeshLambertMaterial({ color: 0xe0b890 })), vmSleeve = worldSpace(new THREE.MeshLambertMaterial({ color: 0x4b5320 }));
const HAND_BOX = [   // [right hand, left hand] on the fallback boxes of each weapon
  [[0, -0.10, 0.14], [0, -0.03, -0.20]], [[0, -0.07, 0.24], [0, -0.03, -0.30]], [[0, -0.08, 0.02], [0, -0.04, -0.30]],
  [[0, -0.05, 0.02], [-0.06, -0.07, 0.0]], [[0, -0.06, 0.05], [0, -0.03, -0.18]],
];
const HAND_REAL = [   // the same on the ready models (their grip is at the holder's origin, shifted in upgradeViewmodels)
  [[0.05, -0.06, 0.12], [0.03, -0.03, -0.18]], [[0.05, -0.06, 0.14], [0.03, -0.02, -0.22]], [[0.05, -0.06, 0.12], [0.03, -0.02, -0.25]],
  [[0.05, 0.02, 0.02], [0.0, 0.0, 0.0]], [[0.05, -0.06, 0.12], [0.03, -0.03, -0.16]],
];
function makeArm(dir) {   // a fist with a wrist and a sleeve reaching toward the elbow (off the frame)
  const g = new THREE.Group(), d = new THREE.Vector3(...dir).normalize(), z = new THREE.Vector3(0, 0, 1);
  const fist = new THREE.Mesh(GEO.box, vmSkin); fist.scale.set(0.10, 0.09, 0.12); g.add(fist);
  const wrist = new THREE.Mesh(GEO.box, vmSkin); wrist.scale.set(0.08, 0.08, 0.07); wrist.position.copy(d).multiplyScalar(0.08); wrist.quaternion.setFromUnitVectors(z, d); g.add(wrist);
  const sleeve = new THREE.Mesh(GEO.box, vmSleeve); sleeve.scale.set(0.095, 0.095, 0.30); sleeve.position.copy(d).multiplyScalar(0.26); sleeve.quaternion.setFromUnitVectors(z, d); g.add(sleeve);
  return g;
}
function placeHands(hg, a) { hg.userData.R.position.set(...a[0]); hg.userData.L.position.set(...a[1]); }
const hands = models.map((m, i) => {
  const hg = new THREE.Group(); hg.userData.keep = true;
  const R = makeArm([0.16, -0.30, 0.10]), L = makeArm([-0.20, -0.30, 0.12]);   // right elbow to the bottom-right, left to the bottom-left
  hg.add(R, L); hg.userData.R = R; hg.userData.L = L; placeHands(hg, HAND_BOX[i]); m.add(hg); return hg;
});
const flash = new THREE.Sprite(worldSpace(new THREE.SpriteMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95, depthWrite: false, fog: false }))); flash.scale.setScalar(0.3); flash.position.set(0, 0, -0.45); flash.visible = false; gun.add(flash);   // the star texture is attached on the first shot: module-scope calls into impacts.js can hit an import cycle
const flashLight = new THREE.PointLight(0xffc36a, 0, 20, 2); flashLight.position.set(0, 0.05, -0.5); gun.add(flashLight);   // the flash lights the street for a moment
const MV = new THREE.Vector3();
let actx = null;
function ac() {   // the audio context of the game sounds, with one volume knob (the settings)
  if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); actx.master = actx.createGain(); actx.master.gain.value = SET.vol; const lim = actx.createDynamicsCompressor(); lim.threshold.value = -6; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.2; actx.master.connect(lim); lim.connect(actx.destination); }   // a limiter: a burst of shots does not clip
  if (actx.state === 'suspended') actx.resume(); return actx;
}
onChange(() => { if (actx) actx.master.gain.value = SET.vol; if (voice) voice.setVolume(SET.voiceVol); });
function bang(vol, low) {
  try {
    ac();
    const n = Math.floor(actx.sampleRate * 0.12), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, low ? 3 : 5);
    const s = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low ? 900 : 2400; g.gain.value = vol;
    s.buffer = buf; s.connect(f); f.connect(g); g.connect(actx.master); s.start();
  } catch (e) {}
}
// where a sound comes from: its distance (m) and side (-1 left … 1 right) for the camera
const SV = new THREE.Vector3();
function spot(x, y, z) { SV.set(x, y, z).applyMatrix4(camera.matrixWorldInverse); const d = SV.length(); return { d, pan: d > 0.5 ? 0.85 * SV.x / Math.max(0.5, Math.hypot(SV.x, SV.z)) : 0 }; }
// the recorded shots are louder than the old synthetic bang: their own volumes, in the order of WEAPONS
const SHOT_VOL = [0.55, 0.7, 0.75, 0.45, 0.55];
// what a bullet hits, by the facade style of the cadastre (tools/process.js): wood, brick, plaster or metal
const WALL_MAT = { 0: 'concrete', 1: 'stone', 2: 'stone', 3: 'concrete', 4: 'concrete', 5: 'wood', 6: 'metal', 12: 'metal', 13: 'metal', 14: 'concrete' };
// a bullet stopped by a wall or the ground at distance len along d from o: the sound of the hit, if it is near enough to hear
function wallHit(o, d, len, hear = 45) {
  const x = o[0] + d[0] * len, y = o[1] + d[1] * len, z = o[2] + d[2] * len, s = spot(x, y, z);
  if (s.d > hear) return;
  const ground = y - terrainH(x, z) < 0.5;
  const mat = ground ? (onRoad(x, z, 1.5) ? 'road' : 'grass') : (WALL_MAT[(buildingAt(x, z) || {}).kind] || 'concrete');
  try { hitSound(ac(), actx.master, ground ? 'ground' : 'wall', 0.7 * 4 / (4 + s.d) * (1 - s.d / hear), s.d, s.pan, mat); } catch (e) {}
}
// someone else's shot: its sound (later and duller the farther it is), the hits of its bullets near you and the crack of one
// that flies past your head
function otherShot(m) {
  const wf = WEAPONS[m.w] || WEAPONS[0], hear = m.w === 2 ? 600 : (wf.hear ?? FEEL.hear), s = spot(m.o[0], m.o[1], m.o[2]);
  if (s.d < hear) {
    let real = false; try { real = shotSound(ac(), actx.master, m.w, (SHOT_VOL[m.w] ?? 0.5) * (1 - s.d / hear) * 25 / (25 + s.d), s.d, s.pan); } catch (e) {}
    if (!real) bang((m.w === 2 ? 0.7 : m.w === 1 ? 0.5 : (wf.vol ?? FEEL.vol) * 0.85) * (1 - s.d / hear), true);
  }
  let hits = 0, crack = false;
  for (const r of m.rays) {
    const len = r[3], who = r[4];
    const kind = who === MP.id ? 'air' : who ? 'body' : (len < wf.range - 0.5 ? 'surface' : 'air');   // into you: no mark, 'hurt' speaks
    let cb = null;
    if (who !== MP.id && hits < 2) {   // the hits of its bullets near you are heard when they arrive
      hits++;
      if (who) { const h = spot(m.o[0] + r[0] * len, m.o[1] + r[1] * len, m.o[2] + r[2] * len); cb = () => { if (h.d < 40) try { hitSound(ac(), actx.master, 'body', 0.6 * 4 / (4 + h.d) * (1 - h.d / 40), h.d, h.pan); } catch (e) {} }; }
      else if (kind === 'surface') cb = () => wallHit(m.o, r, len);
    }
    tracerShot(m.o, r, len, m.w, kind, 0xffb060, cb);
    if (crack || MP.dead || who === MP.id) continue;
    const t = (P.x - m.o[0]) * r[0] + (P.y - m.o[1]) * r[1] + (P.z - m.o[2]) * r[2];   // the point of the bullet's path nearest to your head
    if (t < 6 || t > len + 1) continue;
    const cx = m.o[0] + r[0] * t, cy = m.o[1] + r[1] * t, cz = m.o[2] + r[2] * t, near = Math.hypot(cx - P.x, cy - P.y, cz - P.z);
    if (near < 2.5) { crack = true; try { crackSound(ac(), actx.master, 0.25 + 0.5 * (1 - near / 2.5), spot(cx, cy, cz).pan); } catch (e) {} }
  }
}
function tone(f0, f1, dur, vol, type = 'sine', delay = 0) {
  try {
    ac();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + delay; o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(actx.master); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
/* ---------- shooting ---------- */
const W = () => WEAPONS[MP.weapon];
function fire(now) {
  const w = W();
  if (MP.dead || !STATE.locked || now - MP.lastShot < w.gapMs) return;
  if (MP.reloadAt) return;
  if (MP.ammo[MP.weapon] <= 0) { reload(now); return; }
  statEvent('shot', {}, !!MP.local); MP.lastShot = now; MP.ammo[MP.weapon]--; MP.kick = 1; if (vm && MP.weapon === 0) vm.fire();
  const o = [P.x, P.y, P.z], t = performance.now() - 120, rays = [], yaw0 = P.yaw, pitch0 = P.pitch;   // the rays fly where the crosshair stood: the recoil kicks the view only after they are computed — kicking first lifted every sniper shot 0.03 rad (1.7°) over the target, a clean miss past ~40 m
  for (let i = 0; i < w.pellets; i++) {
    const sp = spreadNow(), ang = Math.random() * 6.283, rad = sp * Math.sqrt(Math.random());
    const d = aim(yaw0 + Math.cos(ang) * rad, pitch0 + Math.sin(ang) * rad), clear = freePath(o, d, w.range);
    let best = null;
    for (const [id, r] of remotes) {
      if (isMate(r)) continue;   // no friendly fire: shots pass through teammates
      const p = pose(r, t); if (!p || !r.group.visible) continue;
      const a = [p.x, p.y - (p.h || 1.7) + 0.1, p.z], b = [p.x, p.y + RULES.bodyTop, p.z], h = rayToSegment(o, d, clear, a, b);
      if (h.dist <= RULES.hitR && (!best || h.t < best.t)) best = { id, t: h.t };
    }
    const len = best ? best.t : clear; rays.push([+d[0].toFixed(4), +d[1].toFixed(4), +d[2].toFixed(4), +len.toFixed(1), best ? best.id : 0]);
    const kind = best ? 'body' : (clear < w.range - 0.5 ? 'surface' : 'air');
    tracerShot(o, d, len, MP.weapon, kind, 0xffe9a0, kind === 'surface' && i < 2 ? () => wallHit(o, d, clear) : null);   // the mark and the hit sound appear when the bullet arrives (of a shotgun's pellets, two are heard)
  }
  P.pitch = Math.min(1.5, P.pitch + (w.pellets > 1 ? 0.02 : w.scope ? 0.03 : (w.kick ?? FEEL.kick))); P.yaw += (Math.random() - 0.5) * (w.pellets > 1 ? 0.006 : 0.0016); if (w.auto) MP.burst = Math.min(w.cap ?? 0.03, MP.burst + (w.burst ?? 0.0045));
  flash.material.rotation = Math.random() * 6.283; flash.scale.setScalar(0.24 + Math.random() * 0.14);
  if (vm && MP.weapon === 0) { flash.scale.multiplyScalar(1.7); placeFlash(); }   // the muzzle of the arms is twice as far as the boxes'
  ejectShell(); gun.updateWorldMatrix(true, false); flash.getWorldPosition(MV); muzzleSmoke(MV.x, MV.y, MV.z, aim());
  let real = false; try { real = shotSound(ac(), actx.master, MP.weapon, SHOT_VOL[MP.weapon]); } catch (e) {}
  if (!real) bang(w.pellets > 1 ? 0.6 : w.scope ? 0.8 : (w.vol ?? FEEL.vol), true);
  MP.ws.send(JSON.stringify({ t: 'shoot', w: MP.weapon, rays }));
  if (MP.ammo[MP.weapon] <= 0) reload(now);
  updatePanel();
}
function switchWeapon(i) {
  if (MP.dead || i === MP.weapon || i < 0 || i >= WEAPONS.length) return;
  MP.weapon = i; MP.firing = false; MP.scope = false; models.forEach((m, k) => { m.visible = k === i; }); if (vm && i === 0) vm.equip(); tone(300, 200, 0.06, 0.15, 'square'); updatePanel();   // the reload keeps running: the server locks every weapon until it ends (server/game.mjs shoot)
}
function reload(now) {
  const w = W(); MP.scope = false;
  if (MP.reloadAt || MP.ammo[MP.weapon] >= w.mag || MP.dead) return;
  if (MP.reserve[MP.weapon] <= 0) { if (now - MP.noAmmoAt > 3000) { MP.noAmmoAt = now; feed('Запас патронов пуст — ищите ящики на карте', 'sys'); } return; }
  MP.reloadAt = now; MP.reloadW = MP.weapon; MP.ws.send(JSON.stringify({ t: 'reload', w: MP.weapon })); updatePanel();   // the server counts the reload and takes the rounds from the reserve
}

/* ---------- panels ---------- */
const el = id => $(id);
let hitT = 0, hurtT = 0;
function updatePanel() {
  el('mpHp').style.width = Math.max(0, MP.hp) + '%'; el('mpHpN').textContent = Math.max(0, Math.ceil(MP.hp)); el('mpStat').dataset.hp = MP.hp <= 25 ? 'low' : MP.hp <= 60 ? 'mid' : 'ok';
  el('mpWeapon').textContent = W().name; el('mpAmmo').textContent = MP.reloadAt ? 'перезарядка…' : MP.ammo[MP.weapon] + ' / ' + MP.reserve[MP.weapon]; el('mpAmmo').title = 'в магазине / запас'; el('mpAmmo').dataset.empty = !MP.reloadAt && MP.ammo[MP.weapon] === 0 ? 1 : 0;
  el('mpNades').textContent = '●'.repeat(Math.max(0, MP.nades)) || '—';
  el('mpMeds').textContent = '✚'.repeat(Math.max(0, MP.meds)) || '—';
  const sl = el('mpSlots'); if (sl.children.length !== WEAPONS.length) { sl.textContent = ''; WEAPONS.forEach((w, i) => { const d = document.createElement('span'), b = document.createElement('b'), r = document.createElement('i'); d.title = w.name; b.textContent = i + 1; d.append(b, r); sl.append(d); }); }
  [...sl.children].forEach((d, i) => { d.classList.toggle('on', i === MP.weapon); d.querySelector('i').textContent = MP.reserve[i]; d.title = WEAPONS[i].name + ' · запас ' + MP.reserve[i]; });
  renderInv({ weapons: WEAPONS.map((w, i) => ({ name: w.name, mag: MP.ammo[i], magSize: w.mag, reserve: MP.reserve[i], on: i === MP.weapon, key: keyName(SET.keys['w' + (i + 1)]) })), nades: MP.nades, nadeMax: NADE_MAX, meds: MP.meds, medMax: MED_MAX, hp: MP.hp, medKey: keyName(SET.keys.med), nadeKey: keyName(SET.keys.grenade) });
  el('mpScore').textContent = MP.kills + ' · ' + MP.deaths; el('mpFps').textContent = ' · ' + PERF.fps + ' кадр/с' + (PERF.scale < 1 ? ' · разрешение ' + Math.round(PERF.scale * 100) + ' %' : '');
  const tm = el('mpTeams'); tm.textContent = '';
  if (MP.ffa) { const lead = [...MP.board].sort((a, b) => b.kills - a.kills)[0], me = document.createElement('b'), ld = document.createElement('b'), lim = document.createElement('small'); me.className = 'me'; me.textContent = 'Вы ' + MP.kills; ld.className = 'lead'; ld.textContent = lead ? lead.name + ' ' + lead.kills : ''; lim.textContent = 'до ' + MP.win; tm.append(me, ld, lim); } else { const chip = (i, t) => { const e = document.createElement('b'); e.className = 't' + i; e.textContent = t; return e; };
  const lim = document.createElement('small'); lim.textContent = 'до ' + MP.win; tm.append(chip(0, MP.teams[0] + ' ' + MP.score[0]), lim, chip(1, MP.score[1] + ' ' + MP.teams[1])); }
}
function drawBoard() {
  const rows = [...MP.board].sort((a, b) => (MP.ffa ? 0 : a.team - b.team) || b.kills - a.kills || a.deaths - b.deaths), ol = el('mpBoardList'); ol.textContent = '';
  for (const e of rows) { const li = document.createElement('li'); li.className = (MP.ffa ? 'tf' : 't' + e.team) + (e.id === MP.id ? ' me' : ''); const n = document.createElement('span'), k = document.createElement('b'), dd = document.createElement('i'); n.textContent = e.name; k.textContent = e.kills; dd.textContent = e.deaths; li.append(n, k, dd); ol.append(li); }
}
function feed(text, cls) {
  const f = el('mpFeed'), d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; f.prepend(d); while (f.children.length > 6) f.lastChild.remove(); setTimeout(() => d.remove(), 7000);
}
function die(byName, byId) {
  STATE.mpDead = true; document.body.classList.add('dead'); MP.spec = remotes.has(byId) ? byId : 0;   // watch the one who killed you first
  MP.dead = true; MP.deadAt = performance.now(); MP.firing = false; MP.scope = false; gun.visible = false; closeInv();
  if (document.pointerLockElement) document.exitPointerLock();
  el('mpDead').hidden = false; el('mpDeadBy').textContent = byName ? 'Вас убил ' + byName : 'Вы погибли';
}
function spawnPoint(choice = MP.spawn) {
  const i = choice >= 0 ? choice : Math.floor(Math.random() * PLACES.length), pl = PLACES[i], a = Math.random() * 6.283, r = 3 + Math.random() * 20;
  return { x: pl[2] + Math.cos(a) * r, z: pl[3] + Math.sin(a) * r, yaw: pl[4] || 0 };
}
// ---------- the end of a round: the table of the round and the time to the next one ----------
let endTimer = 0;
function showSummary(m) {
  const ffa = m.mode === 'ffa', mine = ffa ? m.mvp === MP.id : m.team === MP.team, title = el('mpEndTitle'); title.className = ffa ? 'tf' : 't' + (m.team === 1 ? 1 : 0);
  title.textContent = ffa ? (mine ? 'Победа! Вы набрали ' : 'Победил ' + m.name + ': ') + (m.rows[0] ? m.rows[0].kills : '') + ' убийств' : (mine ? 'Победа! ' : 'Поражение. ') + 'Выиграли ' + m.name.toLowerCase() + ', ' + m.score[0] + ' : ' + m.score[1];
  const mvp = m.rows.find(r => r.id === m.mvp); el('mpEndMvp').textContent = mvp ? '★ Лучший игрок раунда: ' + mvp.name + ' — ' + mvp.kills + ' убийств, ' + mvp.dmg + ' урона' : '';
  const t = el('mpEndTable'); t.textContent = '';
  const row = (cells, cls) => { const r = document.createElement('div'); r.className = 'end-row ' + cls; for (const c of cells) { const s = document.createElement('span'); s.textContent = c; r.append(s); } t.append(r); };
  row(['игрок', 'убийств', 'смертей', 'в голову', 'урон', 'точность'], 'head');
  for (const r of m.rows) row([(r.id === m.mvp ? '★ ' : '') + r.name, r.kills, r.deaths, r.heads, r.dmg, r.acc + ' %'], (ffa ? 'tf' : 't' + (r.team === 1 ? 1 : 0)) + (r.id === MP.id ? ' me' : ''));
  el('mpEnd').hidden = false; const until = performance.now() + (m.nextMs || 10000); clearInterval(endTimer);
  const tick = () => { const left = Math.max(0, Math.ceil((until - performance.now()) / 1000)); el('mpEndNext').textContent = 'Новый раунд через ' + left + ' с'; if (!left) clearInterval(endTimer); };
  tick(); endTimer = setInterval(tick, 300);
}
// ---------- grenades and the dead man's view ----------
function throwNade() {
  const now = performance.now(); if (MP.dead || MP.nades <= 0 || now - MP.lastNade < 900) return;
  MP.nades--; MP.lastNade = now; const d = aim(); MP.ws.send(JSON.stringify({ t: 'throw', dx: +d[0].toFixed(4), dy: +d[1].toFixed(4), dz: +d[2].toFixed(4) }));
  tone(260, 140, 0.12, 0.2, 'triangle'); MP.kick = 0.6; updatePanel();
}
const specList = () => [...remotes.entries()].filter(([, r]) => r.group.visible && !r.fallT).sort((a, b) => isMate(b[1]) - isMate(a[1])).map(e => e[0]);
function specNext(dir) {
  const l = specList(); if (!l.length) { MP.spec = 0; return; }
  const i = l.indexOf(MP.spec); MP.spec = l[i < 0 ? 0 : (i + dir + l.length) % l.length];
}
// dead: the camera follows a living player from behind (the killer first, then teammates), until the respawn
function spectate(now) {
  if (!MP.dead) return;
  let r = remotes.get(MP.spec); if (!r || !r.group.visible || r.fallT) { specNext(1); r = remotes.get(MP.spec); }
  const label = el('mpSpec'); if (!r) { label.textContent = 'Некого показывать'; return; }
  const p = pose(r, now - 120); if (!p) return;
  P.yaw = p.yaw; P.pitch = -0.14; P.x = p.x + Math.sin(p.yaw) * 3.2; P.z = p.z + Math.cos(p.yaw) * 3.2; P.y = p.y + 0.6;
  const t = 'Наблюдение: ' + r.name + (isMate(r) ? ' (свой)' : MP.ffa ? '' : ' (враг)') + ' · ← → или щелчок — другой'; if (label.textContent !== t) label.textContent = t;
}
// ---------- the arena: the choices of the respawn, the edge, the ring and the bases on the maps ----------
function arenaChoices() {   // in an arena you come back on your base (or next to a teammate), not where you like
  const rs = el('mpRespawnAt'); rs.textContent = '';
  for (const [v, t] of [['base', 'На своей базе']].concat(MP.ffa ? [] : [['mate', 'Рядом с товарищем']])) { const o = document.createElement('option'); o.value = v; o.textContent = t; rs.append(o); }
}
function edgeNotice() { const now = performance.now(); if (now - (MP.edgeAt || 0) > 3000) feed('Граница арены: дальше нельзя', 'sys'); MP.edgeAt = now; }
function respawn() {
  if (!MP.dead || performance.now() - MP.deadAt < 3000) return;
  const v = el('mpRespawnAt').value; if (v === 'base') { MP.ws.send(JSON.stringify({ t: 'respawn' })); return; }
  if (v === 'mate') { MP.ws.send(JSON.stringify({ t: 'respawn', mate: true })); return; }
  MP.ws.send(JSON.stringify({ t: 'respawn', ...spawnPoint(v === 'rand' ? -1 : +v) }));
}

/* ---------- messages from the server ---------- */
function onMsg(m) {
  switch (m.t) {
    case 'hello': MP.ffa = m.mode === 'ffa'; document.body.classList.toggle('ffa', MP.ffa); if (MP.ffa) { const o = el('mpRespawnAt').querySelector('option[value=mate]'); if (o) o.remove(); } if (!MP.local) rememberServer(MP.url, m.server); voice = createVoice({ myId: () => MP.id, send: (to, d) => MP.ws.send(JSON.stringify({ t: 'rtc', to, d })), info: voiceInfo, onSpeaking: showSpeaking }); voice.setVolume(SET.voiceVol); CH.send = (text, team) => MP.ws.send(JSON.stringify({ t: 'chat', text, team })); MP.id = m.id; MP.name = m.name; MP.team = m.team; MP.teams = m.teams; MP.win = m.win; MP.score = m.score; MP.board = m.board; for (const e of m.board) addRemote(e.id, e.name, e.team, e.look); document.body.dataset.team = m.team;
      MP.arena = m.arena || null; clearFx(); setItems(m.items); if (MP.arena) { arenaChoices(); feed('Арена: ' + MP.arena.name + (MP.ffa ? '' : '. Вы — ' + m.teams[m.team].toLowerCase()), 'sys'); }
      if (MP.local) feed('Тренировка с ботами: ' + MP.board.filter(e => e.bot).length + ', уровень «' + ({ easy: 'лёгкий', normal: 'средний', hard: 'трудный' }[MP.local.level] || '') + '»', 'sys'); break;
    case 'spawn': {
      const [x, z] = freeSpot(m.x, m.z); P.x = x; P.z = z; P.eye = 1.7; P.up = 0; P.vy = 0; P.crouch = false; P.y = 1.7 + terrainH(x, z); P.yaw = m.yaw; P.pitch = 0; STATE.mapTimer = 0; STATE.lodTimer = 0;
      if (!MP.started) { MP.started = true; showGame(); }
      MP.weapon = 0; MP.scope = false; models.forEach((mm, k) => { mm.visible = k === 0; }); MP.hp = m.hp; MP.ammo = m.mag ? m.mag.slice() : WEAPONS.map(w => w.mag); MP.reserve = m.reserve ? m.reserve.slice() : RESERVE.slice(); MP.meds = m.meds ?? 0; MP.reloadAt = 0; MP.dead = false; STATE.mpDead = false; document.body.classList.remove('dead'); MP.spec = 0; MP.nades = m.nades ?? 2; clearNades(); gun.visible = true; if (vm) vm.equip(); el('mpDead').hidden = true; updatePanel();
      MP.ws.send(JSON.stringify({ t: 'state', x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch }));   // the server has the point as asked: tell it where the player really stands
      if (canvas.requestPointerLock) { canvas.focus(); try { const pr = canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} }
      break;
    }
    case 'pong': MP.rtt = Math.round(MP.rtt ? MP.rtt * 0.6 + (performance.now() - m.c) * 0.4 : performance.now() - m.c); el('mpPing').textContent = ' · пинг ' + MP.rtt + ' мс'; updatePanel(); break;
    case 'correct': P.x = m.x; P.z = m.z; if (m.out) edgeNotice(); break;
    case 'snap': {
      const t = performance.now(), seen = new Set();
      for (const [id, x, y, z, yaw, pitch, h, w] of m.p) { if (id === MP.id) continue; seen.add(id); const r = remotes.get(id) || addRemote(id, nameOf(id), teamOf(id)); r.buf.push({ t, x, y, z, yaw, pitch, h, w }); if (r.buf.length > 12) r.buf.shift(); }
      for (const [id, r] of remotes) if (!seen.has(id) && !r.fallT) { r.group.visible = false; r.buf.length = 0; }
      break;
    }
    case 'shot': { if (m.id === MP.id) break; const rs = remotes.get(m.id); if (rs) rs.shotAt = performance.now(); otherShot(m); break; }
    case 'hit': statEvent('hit', m, !!MP.local); hitT = performance.now(); if (m.kill) { tone(880, 880, 0.12, 0.25, 'triangle'); tone(1320, 1320, 0.25, 0.25, 'triangle', 0.1); } else tone(m.head ? 2600 : 1700, m.head ? 2200 : 1400, 0.07, 0.2, 'square'); { const r = remotes.get(m.id), g = r && r.group.visible ? r.group.position : null; if (g) { const s = spot(g.x, g.y + 1.2, g.z); try { hitSound(ac(), actx.master, m.head ? 'head' : 'body', 0.75 * 6 / (6 + s.d), s.d, s.pan); } catch (e) {} if (m.dmg > 0) dmgFloat(g.x, g.y + 1.9, g.z, String(m.dmg), m.head ? 'head' : m.kill ? 'kill' : ''); } } el('mpHit').className = m.head ? 'head' : m.kill ? 'kill' : ''; el('mpHit').hidden = false; break;
    case 'hurt': {
      statEvent('taken', { dmg: Math.max(0, MP.hp - m.hp) }, !!MP.local); MP.hp = m.hp; hurtT = performance.now(); { let real = false; try { real = hitSound(ac(), actx.master, 'body', 1); } catch (e) {} if (!real) tone(160, 60, 0.18, 0.4, 'sawtooth'); } el('mpHurt').hidden = false; updatePanel();
      const a = Math.atan2(-m.dx, -m.dz) - P.yaw; el('mpHurtDir').style.transform = 'rotate(' + (-a) + 'rad)';   // the side the shot came from
      if (m.hp <= 0) die(nameOf(m.by), m.by);
      break;
    }
    case 'kill': { feed(m.kn + '  ➜  ' + m.vn + (m.w === 9 ? '  (граната)' : m.head ? '  (в голову)' : ''), m.killer === MP.id ? 'mine' : m.victim === MP.id ? 'dead' : ''); if (m.killer === MP.id) { MP.kills++; if (m.victim !== MP.id) statEvent('kill', m, !!MP.local); } if (m.victim === MP.id) { MP.deaths++; statEvent('death', {}, !!MP.local); if (!MP.dead) die(m.kn, m.killer); } else { const rv = remotes.get(m.victim); if (rv && rv.buf.length) { rv.fallT = performance.now(); rv.corpse = { ...rv.buf[rv.buf.length - 1] }; } } updatePanel(); break; }
    case 'alive': { const r = remotes.get(m.id); if (r) { r.buf.length = 0; r.fallT = 0; } break; }
    case 'board': MP.board = m.board; MP.score = m.score; for (const e of m.board) { const r = addRemote(e.id, e.name, e.team, e.look); if (r) { r.name = e.name; r.tag.textContent = e.name; const look = parseLook(e.look) ? e.look : ''; if (look !== r.look) { r.look = look; rebuildAvatar(r); } } if (e.id === MP.id) { MP.kills = e.kills; MP.deaths = e.deaths; } } for (const id of [...remotes.keys()]) if (!m.board.some(e => e.id === id)) dropRemote(id); drawBoard(); updatePanel(); if (voice) voice.setPeers(m.board.filter(e => e.id !== MP.id && !e.bot).map(e => e.id)); break;
    case 'left': dropRemote(m.id); break;
    case 'nade': addNade(m); if (m.by !== MP.id) { const dd = Math.hypot(m.p[0] - P.x, m.p[2] - P.z); if (dd < 40) tone(500, 300, 0.08, 0.1 * (1 - dd / 40), 'triangle'); } break;
    case 'item': itemBack(m); break;
    case 'took': itemTook(m.id); if (m.to === MP.id) { feed('+ ' + KINDS[m.kind].name, 'sys'); tone(660, 990, 0.09, 0.22, 'triangle'); } break;
    case 'inv': MP.ammo = m.mag.slice(); MP.reserve = m.reserve.slice(); MP.nades = m.nades; MP.meds = m.meds; updatePanel(); break;
    case 'heal': { const got = m.hp - MP.hp; MP.hp = m.hp; MP.meds = m.meds; feed('Аптечка: +' + got + ' HP', 'sys'); tone(440, 660, 0.16, 0.25, 'sine'); updatePanel(); break; }
    case 'boom': {
      boomNade(m); const dd = Math.hypot(m.x - P.x, m.z - P.z), hear = 300; if (dd < hear) { const v = 1 - dd / hear; let real = false; try { real = boomSound(ac(), actx.master, 1.1 * v, dd, spot(m.x, P.y, m.z).pan); } catch (e) {} if (!real) { bang(1.1 * v, true); tone(80, 35, 0.6, 0.5 * v, 'sine'); } }
      if (dd < 14 && !MP.dead) { el('mpFlash').hidden = false; el('mpFlash').style.opacity = String(0.8 * (1 - dd / 14)); setTimeout(() => { el('mpFlash').hidden = true; }, 220); }
      break;
    }
    case 'say': addLine(m, MP.id); if (m.id !== MP.id) tone(900, 700, 0.05, 0.08, 'sine'); break;
    case 'rtc': if (voice) voice.signal(m.from, m.d); break;
    case 'win': { const mine = m.mode === 'ffa' ? m.mvp === MP.id : m.team === MP.team, row = m.rows.find(r => r.id === MP.id); statEvent('round', { win: mine, kills: row ? row.kills : 0 }, !!MP.local); showSummary(m); break; }
    case 'round': el('mpEnd').hidden = true; clearInterval(endTimer); break;
    case 'chat': feed(m.text, 'sys'); break;
    case 'full': el('mpMsg').textContent = 'На сервере нет мест.'; break;
  }
}

/* ---------- joining ---------- */
function serverUrl() {
  const q = new URLSearchParams(location.search).get('server'), typed = el('mpServer').value.trim();
  let u = typed || q || DEFAULT_SERVER || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'ws://localhost:8787' : '');
  if (u && !/^wss?:\/\//.test(u)) u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + u;
  return u;
}
function showGame() {
  firstGames(); ambStart(); try { loadSounds(ac()); } catch (e) {}
  STATE.mp = true; MP.on = true; STATE.started = true; P.fly = false; document.body.classList.add('mp');
  $('start').hidden = true; $('hud').hidden = false; el('mpHud').hidden = false; $('cross').hidden = false; STATE.lodTimer = 0;
  $('bFly').setAttribute('aria-pressed', false); if ($('places').hidden === false) $('places').hidden = true;
}
function join(local) {   // local: { bots, level, mode, arena } for the game against bots in the page, with no server
  const name = el('mpName').value.trim(), url = local ? 'local:' : serverUrl(), msg = el('mpMsg');
  if (!url) { msg.textContent = 'Укажите адрес сервера (поле «Сервер»).'; return; }
  const look = uiLook();
  try { localStorage.setItem('dpils.mp', JSON.stringify({ name, server: el('mpServer').value.trim(), spawn: el('mpSpawn').value, team: el('mpTeam').value, look })); } catch (e) {}
  MP.spawn = +el('mpSpawn').value; MP.wantTeam = +el('mpTeam').value; MP.url = url; MP.local = local || null; loadAK().then(k => { if (k) upgradeAK(); loadAvatar().then(a => { if (a) { for (const r of remotes.values()) attachAvatar(r); upgradeViewmodels(); } }); }); if (look) loadHumans(); msg.textContent = 'Подключаюсь…'; el('goPlay').disabled = true; el('goTrain').disabled = true;
  let ws; try { ws = local ? openLocal(local) : new WebSocket(url); } catch (e) { msg.textContent = 'Неверный адрес сервера.'; el('goPlay').disabled = false; el('goTrain').disabled = false; return; }
  MP.ws = ws; MP.started = false;
  ws.onopen = () => { const s = spawnPoint(); ws.send(JSON.stringify({ t: 'join', name, team: MP.wantTeam, look: look || undefined, key: local ? undefined : playerKey() || undefined, ...s })); };
  ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onerror = () => { if (!MP.started) msg.textContent = 'Не удалось подключиться к ' + url; };
  ws.onclose = () => { if (MP.started) { el('mpDead').hidden = true; el('mpOver').hidden = false; if (document.pointerLockElement) document.exitPointerLock(); } else { el('goPlay').disabled = false; el('goTrain').disabled = false; if (!msg.textContent.startsWith('На сервере') && !msg.textContent.startsWith('Не удалось')) msg.textContent = 'Соединение закрыто.'; } };
}
// the chosen person: sex, haircut, hair colour, beard — a short string for the join message and the memory of the browser
const HAIR_NAMES = { m: ['Короткая', 'Ёжик', 'Пробор'], f: ['Длинные', 'Пучки', 'Короткие'] };
function uiLook() {
  const sex = el('mpChar').value; if (!sex) return '';
  return sex + '.' + (el('mpHair').value || '0') + '.' + (el('mpHairCol').value || '0') + (sex === 'm' && el('mpBeard').checked ? '.1' : '');
}
function charUi() {
  const sex = el('mpChar').value, hs = el('mpHair'); hs.textContent = '';
  (HAIR_NAMES[sex] || []).forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = n; hs.append(o); });
  el('mpHairRow').hidden = el('mpHairColRow').hidden = !sex; el('mpBeardRow').hidden = sex !== 'm';
}
let uiReady = false;
function initUi() {   // the fields of the player and of the training: once, when the start card first needs them (or when the city is ready)
  if (uiReady) return; uiReady = true;
  const sel = el('mpSpawn'); sel.textContent = '';
  PLACES.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p[0]; sel.append(o); });
  const r = document.createElement('option'); r.value = -1; r.textContent = 'Случайное место'; sel.append(r);
  el('mpChar').onchange = charUi;
  try { const s = JSON.parse(localStorage.getItem('dpils.mp') || '{}'); if (s.name) el('mpName').value = s.name; if (s.server) el('mpServer').value = s.server; if (s.spawn != null) sel.value = s.spawn; if (s.team != null) el('mpTeam').value = s.team;
    const L = parseLook(s.look); if (L) { el('mpChar').value = L.sex; charUi(); el('mpHair').value = L.hair; el('mpHairCol').value = L.col; el('mpBeard').checked = !!L.beard; }
  } catch (e) {}
  const acc = account(); if (acc) el('mpName').value = acc.name;   // the account's nick belongs to its key on the server
  el('mpName').placeholder = 'Игрок' + (100 + Math.floor(Math.random() * 900));
  if (!el('mpName').value) el('mpName').value = el('mpName').placeholder;
  const rs = el('mpRespawnAt'); rs.textContent = ''; for (const [v, t] of [['mate', 'Рядом с товарищем'], ['rand', 'Случайное место']].concat(PLACES.map((p, i) => [i, p[0]]))) { const o = document.createElement('option'); o.value = v; o.textContent = t; rs.append(o); }
  el('mpNoBoard').checked = !boardOn(); el('mpNoBoard').onchange = () => setBoardOn(!el('mpNoBoard').checked); initLeaders(() => (MP.on ? (MP.local ? '' : MP.url) : serverUrl()));
  el('goPlay').onclick = () => join(); el('goTrain').onclick = () => { const o = { bots: +el('trBots').value, level: el('trLevel').value, mode: el('trMode').value, arena: el('trArena').value }; try { localStorage.setItem('dpils.train', JSON.stringify(o)); } catch (e) {} join(o); };
  try { const t = JSON.parse(localStorage.getItem('dpils.train') || '{}'); for (const [k, id] of [['bots', 'trBots'], ['level', 'trLevel'], ['mode', 'trMode'], ['arena', 'trArena']]) if (t[k] != null && [...el(id).options].some(o => o.value === String(t[k]))) el(id).value = t[k]; } catch (e) {} el('mpRespawn').onclick = respawn; el('mpLeave').onclick = () => location.reload(); el('mpOverBtn').onclick = () => location.reload();
  el('bLeave').onclick = () => location.reload();
}

/* ---------- input ---------- */
canvas.addEventListener('wheel', e => { if (MP.on && !MP.dead) switchWeapon((MP.weapon + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length); }, { passive: true });
canvas.addEventListener('contextmenu', e => { if (MP.on) e.preventDefault(); });
canvas.addEventListener('mousedown', e => { if (MP.on && e.button === 2 && W().scope && !MP.dead && !MP.reloadAt) MP.scope = true; if (!MP.on || e.button !== 0) return; if (MP.dead) { specNext(1); return; } MP.firing = true; if (!STATE.locked && !MP.dead) return; fire(performance.now()); });
window.addEventListener('mouseup', e => { if (e.button === 0) MP.firing = false; if (e.button === 2) MP.scope = false; });
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;   // typing in the chat box
  if (!MP.on || e.repeat) return;
  if (e.code === SET.keys.voice && voice) { if (!voice.hasMic) { voice.enableMic().then(ok => { el('mpVoice').dataset.mic = ok ? 'on' : 'denied'; }); } else voice.talk(true); }
  else if (!MP.dead && (e.code === SET.keys.chat || e.code === SET.keys.teamChat || e.code === 'Enter')) { e.preventDefault(); openChat(e.code === SET.keys.teamChat && !MP.ffa); }
  else if (MP.dead && (e.code === 'ArrowRight' || e.code === 'KeyE')) specNext(1);
  else if (MP.dead && (e.code === 'ArrowLeft' || e.code === 'KeyQ')) specNext(-1);
  else if (e.code === SET.keys.inv) { if (!MP.dead) toggleInv(); }
  else if (e.code === SET.keys.med) useMed();
  else if (e.code === SET.keys.grenade) throwNade();
  else if (e.code === SET.keys.reload) reload(performance.now());
  else if (e.code === SET.keys.w1) switchWeapon(0); else if (e.code === SET.keys.w2) switchWeapon(1); else if (e.code === SET.keys.w3) switchWeapon(2); else if (e.code === SET.keys.w4) switchWeapon(3); else if (e.code === SET.keys.w5) switchWeapon(4);
  else if (e.code === SET.keys.board) { e.preventDefault(); el('mpBoard').hidden = false; drawBoard(); }
  else if ((e.code === 'Space' || e.code === 'Enter') && MP.dead) { e.preventDefault(); respawn(); }
});
window.addEventListener('keyup', e => { if (e.code === SET.keys.board) el('mpBoard').hidden = true; if (e.code === SET.keys.voice && voice) voice.talk(false); });

/* ---------- every frame ---------- */
function mpTick(dt) {
  if (!MP.on) return;
  const now = performance.now(), t = now - 120;
  if (voice) voice.update(dt); ambTick(dt); statEvent('tick', { dt }, !!MP.local);
  if (MP.arena && !MP.dead) { const A = MP.arena, dx = P.x - A.cx, dz = P.z - A.cz, d = Math.hypot(dx, dz); if (d > A.r - 1) { P.x = A.cx + dx / d * (A.r - 1); P.z = A.cz + dz / d * (A.r - 1); edgeNotice(); } }   // the edge of the arena
  if ((MP.fpsT = (MP.fpsT || 0) - dt) <= 0) { MP.fpsT = 1; updatePanel(); }
  // the scope: the picture closes in (the field of view 66° → 20°) and the gun goes out of sight
  { const want = MP.scope && W().scope && !MP.dead && !MP.reloadAt ? 1 : 0; MP.zoom += (want - MP.zoom) * Math.min(1, dt * 14); if (Math.abs(MP.zoom - want) < 0.01) MP.zoom = want;
    const fov = SET.fov - (SET.fov - 20) * MP.zoom; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const scoped = MP.zoom > 0.6; if (el('mpScope').hidden === scoped) { el('mpScope').hidden = !scoped; $('cross').style.visibility = scoped ? 'hidden' : ''; }
    gun.visible = !MP.dead && MP.zoom < 0.5; }
  ownSteps(dt); tickNades(dt); tickItems(dt, now); spectate(now);
  if (MP.reloadAt && now - MP.reloadAt >= WEAPONS[MP.reloadW].reloadMs) {   // the local picture of the reload; the server's 'inv' message is the truth. It finishes on the weapon that started it, even if another is in hand now
    const rw = MP.reloadW; MP.reloadAt = 0; const k = Math.min(WEAPONS[rw].mag - MP.ammo[rw], MP.reserve[rw]);
    MP.ammo[rw] += k; MP.reserve[rw] -= k; updatePanel();
  }
  MP.burst = Math.max(0, MP.burst - dt * 0.03); { const px = Math.max(6, Math.round(spreadNow() * 1400)), cr = $('cross'); if (cr.dataset.px !== String(px)) { cr.dataset.px = px; cr.style.width = cr.style.height = px + 'px'; cr.style.margin = (-px / 2) + 'px 0 0 ' + (-px / 2) + 'px'; } }
  if ((MP.pingT = (MP.pingT || 0) - dt) <= 0 && MP.ws.readyState === 1) { MP.pingT = 2; MP.ws.send(JSON.stringify({ t: 'ping', c: now, rtt: MP.rtt })); }
  if (MP.firing && W().auto) fire(now);
  if (MP.dead) { const left = Math.max(0, 3 - (now - MP.deadAt) / 1000); el('mpRespawn').disabled = left > 0; el('mpRespawn').textContent = left > 0 ? 'Возрождение через ' + Math.ceil(left) : 'Возродиться (пробел)'; }
  else if ((MP.sendT -= dt) <= 0 && MP.ws.readyState === 1) { MP.sendT = 0.05; MP.ws.send(JSON.stringify({ t: 'state', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), h: +P.eye.toFixed(2), w: MP.weapon })); }
  for (const r of remotes.values()) {
    const g = r.group;
    if (r.fallT) {   // a killed player topples backwards and lies for three seconds
      const age = now - r.fallT; if (age > 3000) { r.fallT = 0; g.visible = false; g.rotation.x = 0; r.buf.length = 0; continue; }
      if (r.av) { const c = r.corpse; g.visible = true; g.scale.y = 1; g.rotation.set(0, c.yaw, 0); g.position.set(c.x, c.y - (c.h || 1.7), c.z); r.av.update(dt, { speed: 0, air: false, dead: true }); continue; }
      const c = r.corpse; g.visible = true; g.scale.y = 1; g.position.set(c.x, c.y - (c.h || 1.7) + 0.18 * Math.min(1, age / 350), c.z); g.rotation.y = c.yaw; g.rotation.x = 1.5 * Math.min(1, age / 350) * (2 - Math.min(1, age / 350)); continue;
    }
    const p = pose(r, t); if (!p) { g.visible = false; continue; }
    remoteSteps(r, p, now); if (r.av) { if (r.gunW !== p.w) { r.gunW = p.w; r.av.setGun(p.w); } r.av.update(dt, { speed: r.speed || 0, air: !!r.air, dead: false, shot: now - (r.shotAt || 0) < 90 }); } g.visible = true; g.position.set(p.x, p.y - p.h, p.z); g.scale.y = p.h / 1.7; g.rotation.y = p.yaw; g.userData.head.rotation.x = p.pitch; g.userData.arm.rotation.x = p.pitch * 0.6;
  }
  tickFx(dt);
  MP.kick = Math.max(0, MP.kick - dt * 9); gun.position.z = -0.45 + MP.kick * 0.05; gun.rotation.x = MP.kick * 0.06; flash.visible = MP.kick > 0.6; if (flash.visible && !flash.material.map) flash.material.map = muzzleTex(); flashLight.intensity = MP.kick > 0.6 ? 2.5 * MP.kick : 0;
  if (MP.reloadAt) gun.rotation.x = -0.5 * Math.sin(Math.min(1, (now - MP.reloadAt) / WEAPONS[MP.reloadW].reloadMs) * Math.PI);
  if (vm) {   // the arms with the AK: your speed over the ground chooses the clip of the steps; the reload follows its progress
    vmSpeed += (Math.hypot(P.x - vmX, P.z - vmZ) / Math.max(dt, 1e-3) - vmSpeed) * Math.min(1, dt * 8); vmX = P.x; vmZ = P.z; if (vmSpeed > 40) vmSpeed = 0;
    vm.update(dt, { show: gun.visible && MP.weapon === 0, speed: vmSpeed, reload: MP.reloadAt && MP.reloadW === 0 ? (now - MP.reloadAt) / WEAPONS[0].reloadMs : -1, yaw: P.yaw, pitch: P.pitch, kick: MP.kick });
    if (MP.weapon === 0) placeFlash();
  }
  if (hitT && now - hitT > 140) { hitT = 0; el('mpHit').hidden = true; }
  if (hurtT && now - hurtT > 600) { hurtT = 0; el('mpHurt').hidden = true; }
}
const V = new THREE.Vector3();
// the flash and its light at the muzzle of the AK of the arms (both hang on the camera, so the offset is taken there)
function placeFlash() { vm.muzzle(MV); gun.updateWorldMatrix(true, false); gun.worldToLocal(MV); flash.position.copy(MV).z -= 0.04; flashLight.position.copy(MV); }
// ---------- footsteps ----------
let noise = null;
function footstep(vol, pan, bright, low) {
  try {
    ac();
    if (stepSound(actx, actx.master, bright ? 'concrete' : 'grass', vol * 2, pan, low)) return;   // the recorded step (Kenney); the synthesis below is the fallback
    if (!noise) { const n = Math.floor(actx.sampleRate * 0.09); noise = actx.createBuffer(1, n, actx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(), p = actx.createStereoPanner();
    s.buffer = noise; s.playbackRate.value = (low ? 0.55 : 0.85) + Math.random() * 0.3; f.type = 'lowpass'; f.frequency.value = (bright ? 1700 : 600) * (0.85 + Math.random() * 0.3) * (low ? 0.6 : 1); g.gain.value = vol; p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(f); f.connect(g); g.connect(p); p.connect(actx.master); s.start();
  } catch (e) {}
}
// your own steps (one per two metres walking, three running; crouching is silent) and the thud of a landing
let ownX = 0, ownZ = 0, ownStride = 0, wasUp = 0;
function ownSteps(dt) {
  if (MP.dead) { ownX = P.x; ownZ = P.z; return; }
  const moved = Math.hypot(P.x - ownX, P.z - ownZ); ownX = P.x; ownZ = P.z;
  if (P.up > 0.02) { wasUp = Math.max(wasUp, P.up); return; }
  if (wasUp > 0.05) { footstep(0.16, 0, onRoad(P.x, P.z, 1.5), true); wasUp = 0; }
  if (moved > 2 || P.crouch) return;
  const run = keys.has(SET.keys.run) || keys.has('ShiftRight'); ownStride += moved;
  if (ownStride >= (run ? 3 : 2.1)) { ownStride = 0; footstep(run ? 0.1 : 0.05, 0, onRoad(P.x, P.z, 1.5)); }
}
// the steps of the others, by the distance they walk: heard up to 40 m (muffled behind a house), quiet when they crouch
function remoteSteps(r, p, now) {
  if (r.sx === undefined) { r.sx = p.x; r.sz = p.z; r.stride = 0; r.st = now; return; }
  const moved = Math.hypot(p.x - r.sx, p.z - r.sz), secs = Math.max(0.001, (now - r.st) / 1000); r.sx = p.x; r.sz = p.z; r.st = now;
  const inst = moved / secs; r.speed = inst > 25 ? 0 : (r.speed || 0) + (inst - (r.speed || 0)) * 0.35; r.air = Math.abs(p.y - (r.sy ?? p.y)) / secs > 1.5;   // for the animation of the model
  if (moved / secs > 20 || moved < 0.002 || (p.h || 1.7) < 1.5 || Math.abs(p.y - (r.sy ?? p.y)) > 0.15) { r.sy = p.y; return; }   // a jump, a crouch, a teleport or standing still: no steps
  r.sy = p.y; const run = moved / secs > 6; r.stride += moved; if (r.stride < (run ? 3 : 2.1)) return; r.stride = 0;
  const dx = p.x - P.x, dz = p.z - P.z, d = Math.hypot(dx, dz); if (d > 40) return;
  const right = (dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)) / (d || 1);
  const behind = (r.losT || 0) < now - 600 ? (r.losT = now, r.muffled = freePath([P.x, P.y, P.z], [dx / (d || 1), 0, dz / (d || 1)], d) < d - 1) : r.muffled;
  footstep(0.3 * Math.pow(1 - d / 40, 2) * (run ? 1.5 : 1) * (behind ? 0.4 : 1), right, onRoad(p.x, p.z, 1.5) && !behind);
}
function mpLabels() {
  if (!MP.on) return;
  const w = window.innerWidth, h = window.innerHeight;
  for (const r of remotes.values()) {
    const g = r.group; if (!g.visible) { r.tag.hidden = true; continue; }
    V.set(g.position.x, g.position.y + 2.0, g.position.z).project(camera);
    const d = Math.hypot(g.position.x - P.x, g.position.z - P.z), mate = isMate(r);
    if (V.z > 1 || d > (mate ? 250 : 90) || MP.dead || r.fallT) { r.tag.hidden = true; continue; }   // teammates are shown through walls, enemies only in the line of sight
    if (!mate) { const dy = g.position.y + 1.6 - P.y, l = Math.hypot(d, dy) || 1, dir = [(g.position.x - P.x) / l, dy / l, (g.position.z - P.z) / l]; if (freePath([P.x, P.y, P.z], dir, l) < l - 2) { r.tag.hidden = true; continue; } }
    r.tag.hidden = false; r.tag.style.transform = 'translate(-50%,-100%) translate(' + ((V.x + 1) / 2 * w).toFixed(0) + 'px,' + ((1 - V.y) / 2 * h).toFixed(0) + 'px)';
  }
}
// the voice chat: how audible a player is (a teammate always, an enemy within 30 m) and who is speaking now
function voiceInfo(id) {
  const r = remotes.get(id); if (!r) return null; const p = r.buf[r.buf.length - 1];
  return { mate: isMate(r), dist: p ? Math.hypot(p.x - P.x, p.y - P.y, p.z - P.z) : 1e9 };
}
function showSpeaking(ids, me) {
  const box = el('mpVoice'); box.dataset.talk = me ? '1' : '0';
  const names = ids.map(id => nameOf(id)).join(', '); const list = el('mpVoiceList'); if (list.textContent !== names) list.textContent = names;
  for (const [id, r] of remotes) r.tag.classList.toggle('speaking', ids.includes(id));
}
// teammates on the maps; an enemy shows for two seconds after it fires
STATE.mapOverlay = (ctx, cx, cz, ppm, w, h) => {
  if (!MP.on) return; const now = performance.now();
  if (MP.arena) {   // the ring of the arena and the bases of the teams
    const A = MP.arena; ctx.save(); ctx.beginPath(); ctx.arc(w / 2 + (A.cx - cx) * ppm, h / 2 + (A.cz - cz) * ppm, A.r * ppm, 0, 6.283); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(200, 40, 40, .75)'; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
    A.bases.forEach((b, t) => { if (MP.ffa && t) return; for (const [bx, bz] of b) { const x = w / 2 + (bx - cx) * ppm, y = h / 2 + (bz - cz) * ppm; if (x < 4 || y < 4 || x > w - 4 || y > h - 4) continue; ctx.fillStyle = MP.ffa ? '#e8a317' : t ? '#2f78d8' : '#d8392f'; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x - 5, y - 5, 10, 10); } });
    ctx.restore();
  }
  for (const r of remotes.values()) {
    const p = r.buf[r.buf.length - 1]; if (!p || !r.group.visible || r.fallT) continue;
    if (!isMate(r) && now - (r.shotAt || 0) > 2000) continue;
    const x = w / 2 + (p.x - cx) * ppm, y = h / 2 + (p.z - cz) * ppm; if (x < 4 || y < 4 || x > w - 4 || y > h - 4) continue;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.3); ctx.fillStyle = MP.ffa ? '#e8a317' : r.team === 1 ? '#2f78d8' : '#d8392f'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke();
  }
};
PERF.notice = text => feed(text, 'sys');
function enablePlay() { initUi(); el('goPlay').disabled = false; el('goTrain').disabled = false; }

export { MP, initUi as prepareUi, enablePlay, mpLabels, mpTick };
