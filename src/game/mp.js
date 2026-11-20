import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { FALL, P, freeSpot, keys } from './player.js';
import { PLACES } from '../ui/places.js';
import { buildingAt, onRoad } from '../world/data.js';
import { PERF } from './perf.js';
import { worldSpace } from '../render/world-space.js';
import { CHARS, CHAR_KEYS, gunModel, gunSource, loadAvatar, makeAvatar, parseChar } from './avatar.js';
import { drawOver, loadAK, makeViewmodel } from './viewmodel.js';
import { onProps, prop } from './props.js';
import { FLASH_SIZE, makeFlash } from './muzzle.js';
import { SET, keyName, onChange } from './settings.js';
import { firstGames } from './help.js';
import { rememberServer } from '../ui/servers.js';
import { addNade, blastGlow, boomNade, clearBlasts, clearNades, nadeSamples, tickNades, onNadeBounce, setNadeBodies, syncNade, liveNades, NADE_THROW, showNadePreview, hideNadePreview } from './nades.js';
import { KINDS, SLOT_SVG, bindInv, setItems, itemBack, itemTook, tickItems, renderInv, invTick, closeInv, toggleInv } from './inventory.js';
import { terrainH } from '../world/terrain.js';
import { camera, canvas, renderer, scene } from '../render/renderer.js';
import { CH, addLine, openChat } from './chat.js';
import { createVoice } from './voice.js';
import { openLocal } from './local.js';
import { ambStart, ambTick } from './ambience.js';
import { statEvent } from './stats.js';
import { playerKey, boardOn, setBoardOn, account } from './identity.js';
import { initLeaders } from './leaders.js';
import { rest } from '../core/pause.js';
import { $, reduceMotion } from '../core/env.js';
import { boomSound, crackSound, hitSound, loadSounds, nadeBounce, shotSound, stepSound } from './sfx.js';
import { carAt, carPath } from '../world/car-hit.js';
import { fxSamples, tracerShot, bindTracer, hitTracer, tickFx, clearFx, dmgFloat, ejectShell, muzzleSmoke } from './impacts.js';
import { WEAPONS as WSRV, bulletAt, bulletDrop } from '../../server/combat.mjs';   // the server's own ballistics: the muzzle velocities and the bullet's fall

/* ---------- online shooter: deathmatch on the city map ----------
   The server (server/index.mjs) owns health, kills and respawns. This module: the connection, the other players
   (simple procedural figures, drawn 120 ms in the past between two snapshots), the gun in hand, shooting with the
   line of fire checked against terrain and buildings, and the game panels. The bullet really flies on the server
   (server/game.mjs, at the weapon's vel from server/combat.mjs): the page draws the tracer to the wall and the server's
   'bhit' cuts it at the body when the bullet arrives — the damage, the hit marker and the blood all land together. */
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
const MUZZLE = 0.6;   // the barrel this far along the ray from the eye (keep server/game.mjs in step): the tracer leaves the gun, not the face
// the damage of one pellet to the body and to the head (keep server/combat.mjs in step); the inventory panel shows it
const DMG = [
  { dmg: 22, head: 40 },
  { dmg: 9, head: 16 },
  { dmg: 70, head: 100 },
  { dmg: 20, head: 42 },
  { dmg: 16, head: 28 },
];
const MP = { ffa: false, on: false, ws: null, id: 0, name: '', hp: 100, dead: false, deadAt: 0, weapon: 0, nades: 2, lastNade: 0, spec: 0, specFP: true, scope: false, zoom: 0, ammo: [30, 6, 5, 12, 100], reserve: [90, 24, 15, 36, 200], meds: 0, lastMed: 0, noAmmoAt: 0, reloadAt: 0, reloadW: 0, lastShot: 0, firing: false, burst: 0, rtt: 0, kills: 0, deaths: 0, board: [], team: 0, teams: ['Красные', 'Синие'], score: [0, 0], win: 30, spawn: 0, kick: 0, sendT: 0, sights: { sight: 0, optic: 0 }, attach: [null, null, null, null, null] };   // the picked-up sights: loose in the pocket and mounted per weapon (server/combat.mjs INV)
// the pockets (keep server/combat.mjs in step: RESERVE and INV): the server owns them, the page only shows and predicts
const RESERVE = [90, 24, 15, 36, 200], NADE_MAX = 3, MED_MAX = 2;
// the aimed grenade throw: G takes the grenade in hand, the mouse aims it, the left button held down charges the power
const NAIM = { on: false, charging: false, t0: 0, power: 0, full: false, at: 0 };
const NTHROW = { at: 0, pw: 0, gone: false };   // the throw just made: the arm follows through, then the weapon comes back up; gone: its grenade is in the air
try { MP.specFP = localStorage.getItem('dpils.specfp') !== '0'; } catch (e) {}   // the dead man's camera: from the eyes by default, the choice is remembered
bindInv({ useMed, switchWeapon, attach: (w, kind) => { if (MP.dead || !MP.ws || MP.ws.readyState !== 1) return; MP.ws.send(JSON.stringify({ t: 'attach', w, kind })); tone(kind ? 520 : 300, kind ? 780 : 200, 0.08, 0.2, 'triangle'); }, beep: kind => { if (kind === 'pick') tone(660, 990, 0.09, 0.22, 'triangle'); else if (kind === 'med') tone(440, 660, 0.16, 0.25, 'sine'); else tone(180, 120, 0.12, 0.2, 'square'); } });
// the mounted sights of every weapon onto the arms in hand (and back, when a weapon is swapped or a sight taken off)
function syncVm() { if (vm) MP.attach.forEach((k, w) => vm.attach(w, k)); }
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
// how far the shot flies before the ground or a roof line stops it; the scan starts at 0.3 m (a wall the shooter leans
// on stops the shot too) and is bisected to ~3 mm (the same refinement impacts.js uses for the mark), so the tracer
// stops at the wall, not up to 1.5 m inside it. The barrel stands MUZZLE along the ray: fire/otherShot start the tracer
// there, and a wall nearer than the barrel rests the muzzle on it (a zero-length flight, the mark at the face).
// v (m/s) bends the scan down by the bullet's gravity — the same arc the server flies (server/combat.mjs bulletDrop)
function freePath(o, d, len, cars = false, v = 0) {   // cars: parked and standing cars stop it too (shots only; sight lines look over them)
  const wall = wallPath(o, d, len, v);
  return cars ? carPath(o, d, wall, v) : wall;
}
function wallPath(o, d, len, v) {
  const block = t => {
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t - (v ? bulletDrop(t, v) : 0), z = o[2] + d[2] * t, g = terrainH(x, z);
    if (y < g) return true;
    const b = buildingAt(x, z); return !!(b && y < g + (b.top || 12));
  };
  if (block(0)) return 0;
  for (let t = 0.3, step = 0.5; t < len; t += step) {
    if (!block(t)) { if (t >= 3) step = 1.5; continue; }
    let lo = Math.max(0, t - step), hi = t;
    for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; if (block(m)) hi = m; else lo = m; }
    return hi;
  }
  return len;
}
// the tracer's origin: MUZZLE along the ray from the eye, or the wall face when the barrel rests on it
function muzzleAt(eye, d, wallEye) {
  const mz = Math.min(MUZZLE, wallEye);
  return { o: [eye[0] + d[0] * mz, eye[1] + d[1] * mz, eye[2] + d[2] * mz], mz };
}
const aim = (yaw = P.yaw, pitch = P.pitch) => { const cp = Math.cos(pitch); return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]; };
// how wide the shots scatter now: a little always, more when walking or running, more after each shot of a burst
const MOVE = () => [SET.keys.forward, SET.keys.back, SET.keys.left, SET.keys.right];
function spreadNow() {
  const at = MP.attach[MP.weapon], aimed = MP.zoom > 0.9;
  const v = Math.hypot(P.vx, P.vz);   // the real speed: the brake slide still counts as moving (the inertia, player.js MOVE)
  const moving = MOVE().some(k => keys.has(k)) || v > 0.5, run = keys.has(SET.keys.run) || keys.has('ShiftRight') || v > 7;
  const hip = () => W().cone
    ? W().cone * (P.crouch ? 0.8 : 1) * (at === 'sight' && aimed ? 0.75 : 1) + (moving ? 0.01 : 0) + (P.up > 0.02 ? 0.03 : 0)   // the shotgun's pellets spread in a wide cone
    : ((W().base ?? 0.002) + (moving ? (run ? 0.022 : 0.008) : 0) + MP.burst) * (P.crouch ? 0.5 : 1) * (at === 'sight' && aimed ? 0.35 : 1) + (P.up > 0.02 ? 0.03 : 0);   // crouching steadies the aim, a jump spoils it; the red dot tightens it more
  if (at === 'optic' || (W().scope && !at)) {   // the long zoom (mounted optic or the sniper's own): steady only when scoped and still
    if (aimed) return 0.0004 + (moving ? 0.03 : 0) + (P.up > 0.02 ? 0.04 : 0);
    if (W().scope && !at) return 0.04 + (moving ? 0.03 : 0) + (P.up > 0.02 ? 0.04 : 0);
  }
  return hip();
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
function addRemote(id, name, team, char) {
  if (remotes.has(id) || id === MP.id) return remotes.get(id);
  const hue = MP.ffa ? (id * 0.381966) % 1 : (HUE[team] ?? 0.3), group = makeFigure(hue), tag = document.createElement('div'); tag.className = 'mp-tag ' + (MP.ffa ? 'tf' : 't' + team); if (MP.ffa) tag.style.background = 'hsla(' + Math.round(hue * 360) + ', 55%, 32%, .78)'; tag.textContent = name || '…'; group.visible = false; group.userData.noProbe = true; scene.add(group); $('mpTags').append(tag);
  const r = { id, name, team, hue, group, buf: [], tag, char: parseChar(char), figHead: group.userData.head, figArm: group.userData.arm }; remotes.set(id, r); attachAvatar(r); return r;
}
/* ---------- the models of the game, loaded with the city ----------
   The arms with the AK (viewmodel.js, their file also has the AK of the others), the soldier and the guns
   (avatar.js) and the items of the map (props.js) are loaded while the city is built
   (src/main.js), and the arms are put on the camera. One player with every gun, one of each item and one
   of each mark of a firefight join the scene for the warm-up of the city's shaders (render/post.js warmUp), their
   textures sent to the GPU. So a game starts with the
   ready models from its first frame, without a pause at the first player or the first shot. The samples leave the
   scene after the first frame; their materials are not disposed, so the programs stay compiled for the players
   to come. The boxes of makeFigure and of the gun in hand remain for a file that did not come. */
let modelsP = null, modelsDone = false, samples = null;
// onPart(f): the share of the files that have come (the loading bar)
function loadModels(onPart) {
  if (modelsP) return modelsP;
  const files = [loadAK(), loadAvatar(), new Promise(r => onProps(r))]; let n = 0;
  if (onPart) for (const f of files) f.then(() => onPart(++n / files.length));
  modelsP = Promise.all(files).then(([k, a]) => {
    if (k) upgradeAK(); if (a) upgradeViewmodels();
    samples = new THREE.Group(); samples.visible = false;
    for (const key of CHAR_KEYS) { const av = makeAvatar(key); if (av) samples.add(av.root); }
    for (const o of [...fxSamples(), ...nadeSamples(), vm && vm.nadeSample(), prop('ammo'), prop('med'), prop('sight'), prop('optic')]) if (o) samples.add(o);
  }).catch(e => console.error(e)).finally(() => { modelsDone = true; });
  return modelsP;
}
// on: the samples into the scene just before its warm-up, their textures (and those of the arms) to the GPU, one at a
// time with a pause between them when the slice is used up (src/core/pause.js); off: out again
async function warmSamples(on) {
  if (!samples) return;
  if (!on) { scene.remove(samples); samples = null; return; }
  samples.userData.noProbe = true; scene.add(samples);
  const tex = new Set();
  for (const root of [samples, camera]) root.traverse(o => { for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) for (const v of Object.values(m)) if (v && v.isTexture) tex.add(v); });
  for (const t of tex) { await rest(); renderer.initTexture(t); }
}
// the ready animated model instead of the simple figure (the chosen character; the boxes remain if the file did not come)
function attachAvatar(r) {
  if (r.av) return;
  if (!modelsDone) { loadModels().then(() => { if (!r.av && remotes.has(r.id)) attachAvatar(r); }); return; }   // only if the city was ready before the files
  const av = makeAvatar(r.char); if (!av) return;
  for (const c of r.group.children) c.visible = false; r.group.add(av.root); r.av = av;
  (r.attach || []).forEach((k, w) => av.setAttach(w, k));   // the sights the server says this player mounted
  if (av.root.userData.head) { r.group.userData.head = av.root.userData.head; r.group.userData.arm = av.root.userData.arm; }   // the aim turns the proxies of the person
}
function rebuildAvatar(r) {   // the character changed on the board: the old model off, the new one on
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
    if (vm && (vm.has(i) || vm.addWeapon(i, gunSource(i)))) { m.clear(); return; }   // the arms of viewmodel.js hold it: the boxes and their fists go
    const g = gunModel(i); if (!g || m.userData.ready) return; m.userData.ready = true;
    m.children.forEach(c => { if (!c.userData.keep) c.visible = false; });   // the old boxes off (the hands stay)
    const s = [0.55, 0.29, 0.46, 0.8, 0.44][i] ?? FEEL.vm;   // the fp_* guns are in metres: these keep the on-screen size of the old boxes
    g.rotation.y = Math.PI; g.scale.multiplyScalar(s); g.position.set(0.05, i === 3 ? 0.07 : -0.02, i === 3 ? 0.02 : 0.12); m.add(g);
    m.userData.flashZ = g.position.z - (g.userData.muzzle || 0.5) * s; m.userData.flashY = g.position.y + (g.userData.muzzleY || 0) * s;   // the flash at the muzzle tip
    hands[i].scale.setScalar(i === 3 ? 0.6 : 1);   // the pistol is small: its fists too
    placeHands(hands[i], HAND_REAL[i]);   // the real model's grip sits a little differently than the box's
  });
}
// the AK in your own hands: the arms of the soldier with their clips (viewmodel.js) in place of the boxes. Its file
// comes before the avatars: they take their AK from it
let vm = null, vmX = 0, vmZ = 0, vmSpeed = 0;
function upgradeAK() {
  if (vm) return; vm = makeViewmodel(camera); if (!vm) return;
  models[0].clear(); MP.vm = vm; vm.setWeapon(MP.weapon); syncVm(); if (vm.has(MP.weapon) && !MP.dead) vm.equip();
}
function dropRemote(id) { const r = remotes.get(id); if (!r) return; scene.remove(r.group); r.tag.remove(); remotes.delete(id); }
function nameOf(id) { const b = MP.board.find(e => e.id === id); return b ? b.name : '?'; }
const isMate = r => !MP.ffa && r.team === MP.team;   // in the free-for-all nobody is a teammate
function teamOf(id) { const b = MP.board.find(e => e.id === id); return b ? b.team : 0; }
// the body of a killed remote: its last snapshot, the speed it had, and the throw of the killing blow —
// away from where the shot came (m.dx/dz of the server's kill), with a random spread so no two falls match
function corpseOf(r, m) {
  const b = r.buf, c = { ...b[b.length - 1] }, p = b[b.length - 2] || c, dt = Math.max(0.03, (c.t - p.t) / 1000);
  c.vel = { x: (c.x - p.x) / dt, y: (c.y - p.y) / dt, z: (c.z - p.z) / dt };
  let dx = -(m.dx || 0), dz = -(m.dz || 0);
  if (Math.hypot(dx, dz) < 0.01) { const a = Math.random() * 6.283; dx = Math.sin(a); dz = Math.cos(a); }   // no direction known: any way
  const a = Math.atan2(dx, dz) + (Math.random() - 0.5) * 1.1;
  c.fall = { x: Math.sin(a), z: Math.cos(a), head: !!m.head, nade: m.w === 9, soft: m.w === 10, roll: (Math.random() - 0.5) * 0.5 };   // a fall crumples in place
  return c;
}
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
  gun.position.set(0.17, -0.16, -0.5); gun.scale.setScalar(0.8); gun.visible = false; camera.add(gun); camera.userData.noProbe = true; scene.add(camera);   // a touch higher so the hands on the grip show above the bottom edge
})();
// the hands that hold the gun: a fist on the grip, a supporting hand on the forend, the sleeves going off the bottom of the
// frame. They live inside each weapon model, so they switch, kick and tilt with it and hide when the scope is up.
const vmSkin = worldSpace(new THREE.MeshLambertMaterial({ color: 0xe0b890 })), vmSleeve = worldSpace(new THREE.MeshLambertMaterial({ color: 0x4b5320 }));
const HAND_BOX = [   // [right hand, left hand] on the fallback boxes of each weapon
  [[0, -0.10, 0.14], [0, -0.03, -0.20]], [[0, -0.07, 0.24], [0, -0.03, -0.30]], [[0, -0.08, 0.02], [0, -0.04, -0.30]],
  [[0, -0.05, 0.02], [-0.06, -0.07, 0.0]], [[0, -0.06, 0.05], [0, -0.03, -0.18]],
];
const HAND_REAL = [   // the same on the ready models (their grip is at the holder's origin, shifted in upgradeViewmodels)
  [[0.05, -0.06, 0.12], [0.03, -0.03, -0.18]], [[0.05, -0.05, 0.13], [0.02, -0.04, 0.0]], [[0.05, -0.05, 0.12], [0.02, -0.03, -0.04]],
  [[0.05, 0.045, 0.03], [0.02, 0.025, 0.015]], [[0.05, -0.05, 0.12], [0.02, -0.03, -0.01]],
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
// the grenade in hand while the gloved arms of viewmodel.js are not there (their file has not come): a fist like the
// fallback weapons hold, the sleeve off the bottom of the frame, on the camera; nadeHandTick moves it like the arms
const nadeHand = new THREE.Group(), nadeBall = new THREE.Group();
(function () {
  const mb = worldSpace(new THREE.MeshLambertMaterial({ color: 0x3d5a2a })), ml = worldSpace(new THREE.MeshLambertMaterial({ color: 0x8a8f94 }));
  nadeBall.add(new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), mb));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.018, 8), ml); cap.position.y = 0.038; nadeBall.add(cap);
  const lever = new THREE.Mesh(GEO.box, ml); lever.scale.set(0.007, 0.03, 0.014); lever.position.set(0.025, 0.025, 0); lever.rotation.z = -0.25; nadeBall.add(lever);
  nadeBall.position.set(-0.03, 0.02, -0.02); nadeHand.add(nadeBall);
  const fist = makeArm([0.16, -0.30, 0.10]); fist.scale.setScalar(0.8); fist.position.set(0.01, -0.03, 0.02); nadeHand.add(fist);
  nadeHand.visible = false; camera.add(nadeHand);
  onProps(() => { const m = prop('nade'); if (!m) return; nadeBall.clear(); m.scale.setScalar(0.5); m.position.y = -0.033; nadeBall.add(m); });
})();
// the flash of your own gun (muzzle.js): the AK of the arms has its own at its muzzle (viewmodel.js); this one serves
// the other guns, at the muzzle tip of the ready model (upgradeViewmodels keeps its place). Made on the first shot
let fpFlash = null;
function ownFlash() {
  if (!fpFlash) { fpFlash = makeFlash({ size: 0.9, wrap: drawOver }); fpFlash.group.rotation.y = Math.PI; gun.add(fpFlash.group); }
  const m = models[MP.weapon]; fpFlash.group.position.set(0, m.userData.flashY ?? 0, m.userData.flashZ ?? -0.45);
  return fpFlash;
}
// One light for the flashes: of your own gun, or of a shot of someone near you, whichever is brighter now. A single
// light keeps the number of lights, and with it the shaders of the whole city, as they are. It stands in the scene itself
// (in world coordinates), not in the gun's group, and is always there, dark between the shots and in the walk: three
// counts only the lights that are shown, and a light that came and went with the gun — at the start of a game, at each
// death, with the scope up — changed the number of lights of every material, so all the shaders of the city were compiled
// again at the start of a game. The warm-up of the city (render/post.js) takes the lights among the scene's own children.
const flashLight = new THREE.PointLight(0xffb868, 0, 22, 2); scene.add(flashLight);
const near = { x: 0, y: 0, z: 0, t: 9, pow: 0 };   // the last flash of another player within 60 m
const MV = new THREE.Vector3();
let actx = null;
function ac() {   // the audio context of the game sounds, with one volume knob (the settings)
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)(); actx.master = actx.createGain(); actx.master.gain.value = SET.vol;
    const lim = actx.createDynamicsCompressor(); lim.threshold.value = -6; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.2;   // a limiter: a burst of shots does not clip
    actx.dull = actx.createBiquadFilter(); actx.dull.type = 'lowpass'; actx.dull.frequency.value = 20000; actx.dull.Q.value = 0.7;   // open; a blast close by shuts it for a few seconds (deafen)
    actx.master.connect(actx.dull); actx.dull.connect(lim); lim.connect(actx.destination); actx.lim = lim;
  }
  if (actx.state === 'suspended') actx.resume(); return actx;
}
onChange(() => { if (actx) actx.master.gain.value = SET.vol; if (voice) voice.setVolume(SET.voiceVol); });
// a blast close by (k: 1 at the heart, 0 at the edge): after its bang the world goes dull and the ears ring, the closer the longer
function deafen(k, delay) {
  try {
    ac(); const now = actx.currentTime, t0 = now + delay + 0.07, f = actx.dull.frequency;
    f.cancelScheduledValues(now); f.setValueAtTime(f.value, now);
    f.setTargetAtTime(250 + 2200 * (1 - k), t0, 0.015); f.setTargetAtTime(20000, t0 + 0.4 + 1.4 * k, 0.5 + 1.1 * k);
    const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 3300 + Math.random() * 1000;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.045 * k * SET.vol, t0 + 0.08); g.gain.setTargetAtTime(0, t0 + 0.3, 0.45 + 0.9 * k);
    o.connect(g); g.connect(actx.lim); o.start(t0); o.stop(t0 + 7);   // the ring is past the dull ears: it is in them
  } catch (e) {}
}
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
function wallHit(o, d, len, hear = 45, v = 0) {
  const [x, y, z] = v ? bulletAt(o, d, len, v) : [o[0] + d[0] * len, o[1] + d[1] * len, o[2] + d[2] * len], s = spot(x, y, z);
  if (s.d > hear) return;
  const car = !!carAt(x, y, z), ground = !car && y - terrainH(x, z) < 0.5;
  if (car) { try { hitSound(ac(), actx.master, 'metal', 0.8 * 4 / (4 + s.d) * (1 - s.d / hear), s.d, s.pan); } catch (e) {} return; }
  const mat = ground ? (onRoad(x, z, 1.5) ? 'road' : 'grass') : (WALL_MAT[(buildingAt(x, z) || {}).kind] || 'concrete');
  try { hitSound(ac(), actx.master, ground ? 'ground' : 'wall', 0.7 * 4 / (4 + s.d) * (1 - s.d / hear), s.d, s.pan, mat); } catch (e) {}
}
// someone else's shot: its sound (later and duller the farther it is), the hits of its bullets near you and the crack of one
// that flies past your head
function otherShot(m) {
  const wf = WEAPONS[m.w] || WEAPONS[0], hear = m.w === 2 ? 600 : (wf.hear ?? FEEL.hear), s = spot(m.o[0], m.o[1], m.o[2]);
  if (s.d < 60 && m.rays && m.rays[0]) { const d = m.rays[0]; near.x = m.o[0] + d[0] * 0.9; near.y = m.o[1] - 0.15 + d[1] * 0.9; near.z = m.o[2] + d[2] * 0.9; near.t = 0; near.pow = 0.8 * (1 - s.d / 60); }   // its flash lights the street
  if (s.d < hear) {
    let real = false; try { real = shotSound(ac(), actx.master, m.w, (SHOT_VOL[m.w] ?? 0.5) * (1 - s.d / hear) * 25 / (25 + s.d), s.d, s.pan); } catch (e) {}
    if (!real) bang((m.w === 2 ? 0.7 : m.w === 1 ? 0.5 : (wf.vol ?? FEEL.vol) * 0.85) * (1 - s.d / hear), true);
  }
  let heard = 0, crack = false;
  for (const r of m.rays) {
    // the server's length starts at the barrel; a zero length means the muzzle rested on a wall nearer than MUZZLE
    const vel = (WSRV[m.w] || WSRV[0]).vel || 560;   // the muzzle velocity lives in the server's table (the page's copy above has no vel)
    const mz = r[3] > 0 ? MUZZLE : Math.min(MUZZLE, wallPath(m.o, r, MUZZLE + 0.5, vel));
    const o = [m.o[0] + r[0] * mz, m.o[1] + r[1] * mz, m.o[2] + r[2] * mz];
    const len = carPath(o, r, r[3], vel);   // the server does not know the cars: its bullet stops in one here too
    const kind = mz + len < wf.range - 0.5 ? 'surface' : 'air';   // a body hit arrives as 'bhit' and cuts the tracer there
    const cb = kind === 'surface' && heard < 2 ? (heard++, () => wallHit(o, r, len, 45, vel)) : null;   // of a shotgun's pellets, two are heard
    bindTracer(r[4], tracerShot(o, r, len, m.w, kind, 0xffb060, cb));
    if (crack || MP.dead) continue;
    const t = (P.x - m.o[0]) * r[0] + (P.y - m.o[1]) * r[1] + (P.z - m.o[2]) * r[2];   // the point of the bullet's path nearest to your head
    if (t < 6 || t > mz + len + 1) continue;
    const cx = m.o[0] + r[0] * t, cy = m.o[1] + r[1] * t - bulletDrop(Math.max(0, t - mz), vel), cz = m.o[2] + r[2] * t, near = Math.hypot(cx - P.x, cy - P.y, cz - P.z);
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
let ownTracers = null;   // the tracers of the shot just fired, bound to the server's bullet ids when its 'shot' echo returns
const W = () => WEAPONS[MP.weapon];
function fire(now) {
  const w = W();
  if (MP.dead || !STATE.locked || now - MP.lastShot < w.gapMs) return;
  if (MP.reloadAt) return;
  if (MP.ammo[MP.weapon] <= 0) { reload(now); return; }
  statEvent('shot', {}, !!MP.local); MP.lastShot = now; MP.ammo[MP.weapon]--; MP.kick = 1;
  const eye = [P.x, P.y, P.z], rays = [], mine = [], yaw0 = P.yaw + punch.y, pitch0 = P.pitch + punch.p;   // the rays fly where the crosshair stands (the aim punch included): the shot's own recoil kicks the view only after they are computed — kicking first lifted every sniper shot 0.03 rad (1.7°) over the target, a clean miss past ~40 m
  for (let i = 0; i < w.pellets; i++) {
    const sp = spreadNow(), ang = Math.random() * 6.283, rad = sp * Math.sqrt(Math.random());
    const d = aim(yaw0 + Math.cos(ang) * rad, pitch0 + Math.sin(ang) * rad);
    const vel = WSRV[MP.weapon].vel || 560;
    const wallEye = wallPath(eye, d, w.range, vel), { o, mz } = muzzleAt(eye, d, wallEye), clear = carPath(o, d, wallEye - mz, vel);   // the wall along the falling arc, as the server sees it
    rays.push([+d[0].toFixed(4), +d[1].toFixed(4), +d[2].toFixed(4)]);   // the server judges the hit itself, when the bullet arrives
    const kind = mz + clear < w.range - 0.5 ? 'surface' : 'air';   // a body, if the bullet finds one, comes back as 'bhit'
    mine.push(tracerShot(o, d, clear, MP.weapon, kind, 0xffe9a0, kind === 'surface' && i < 2 ? () => wallHit(o, d, clear, 45, vel) : null));   // the mark and the hit sound appear when the bullet arrives (of a shotgun's pellets, two are heard)
  }
  ownTracers = mine;
  P.pitch = Math.min(1.5, P.pitch + (w.pellets > 1 ? 0.02 : w.scope ? 0.03 : (w.kick ?? FEEL.kick))); P.yaw += (Math.random() - 0.5) * (w.pellets > 1 ? 0.006 : 0.0016); if (w.auto) MP.burst = Math.min(w.cap ?? 0.03, MP.burst + (w.burst ?? 0.0045));
  if (vm && vm.has(MP.weapon)) { vm.fire(FLASH_SIZE[MP.weapon]); vm.muzzle(MV); }
  else { const f = ownFlash(); f.fire(1, FLASH_SIZE[MP.weapon]); gun.updateWorldMatrix(true, false); f.group.getWorldPosition(MV); }
  ejectShell(); muzzleSmoke(MV.x, MV.y, MV.z, aim());
  let real = false; try { real = shotSound(ac(), actx.master, MP.weapon, SHOT_VOL[MP.weapon]); } catch (e) {}
  if (!real) bang(w.pellets > 1 ? 0.6 : w.scope ? 0.8 : (w.vol ?? FEEL.vol), true);
  MP.ws.send(JSON.stringify({ t: 'shoot', w: MP.weapon, rays }));
  if (MP.ammo[MP.weapon] <= 0) reload(now);
  updatePanel();
}
let slotsT = 0;   // the weapon belt stays visible until this moment: a switch (keys, wheel, inventory) or a spawn shows it, then it fades away
function switchWeapon(i) {
  nadeCancel(); NTHROW.at = 0;   // a new weapon cuts the follow-through of a throw short
  if (MP.dead || i === MP.weapon || i < 0 || i >= WEAPONS.length) return;
  MP.weapon = i; MP.firing = false; MP.scope = false; crossGap = CROSS[i].ring ? 20 : CROSS[i].gap; models.forEach((m, k) => { m.visible = k === i; }); if (vm) { vm.setWeapon(i); vm.equip(); } tone(300, 200, 0.06, 0.15, 'square'); slotsT = performance.now() + 1600; updatePanel();   // the reload keeps running: the server locks every weapon until it ends (server/game.mjs shoot)
}
function reload(now) {
  const w = W(); MP.scope = false;
  if (MP.reloadAt || MP.ammo[MP.weapon] >= w.mag || MP.dead) return;
  if (MP.reserve[MP.weapon] <= 0) { if (now - MP.noAmmoAt > 3000) { MP.noAmmoAt = now; feed('Запас патронов пуст — ищите ящики на карте', 'sys'); } return; }
  MP.reloadAt = now; MP.reloadW = MP.weapon; MP.ws.send(JSON.stringify({ t: 'reload', w: MP.weapon })); updatePanel();   // the server counts the reload and takes the rounds from the reserve
}

/* ---------- panels ---------- */
const el = id => $(id);
let hitT = 0, hitDur = 180, hurtT = 0, hurtAmp = 1, hurtBloom = 0;
/* ---------- aim punch: the view flinches when a bullet lands on you ----------
   The kick grows with the damage, throws the look up and away from the shooter's side and springs back in about a
   third of a second. It is put on the camera after it is placed (aimPunch, loop.js), and fire() aims with it, so the
   bullet flies where the flinching crosshair points. The gun in hand jolts (MP.kick), the crosshair blooms (hurtBloom),
   the red vignette flares and fades (hurtAmp). */
const punch = { p: 0, y: 0, r: 0 };
function aimPunch(cam) {
  if (reduceMotion || (!punch.p && !punch.y && !punch.r)) return;
  cam.rotation.x += punch.p; cam.rotation.y += punch.y; cam.rotation.z += punch.r;
}
function punchReset() { punch.p = punch.y = punch.r = 0; hurtBloom = 0; hurtT = 0; el('mpHurt').hidden = true; }
// the flinch of a body that took a hit: a sharp jolt in 45 ms, then a springy decay (mp.js puts it on the group, avatar.js on the bones)
function flinchK(now, t) { if (!t) return 0; const a = (now - t) / 1000; if (a < 0 || a > 0.42) return 0; return a < 0.045 ? a / 0.045 : Math.exp(-(a - 0.045) * 8.5); }
function updatePanel() {
  el('mpHp').style.width = Math.max(0, MP.hp) + '%'; el('mpHpN').textContent = Math.max(0, Math.ceil(MP.hp)); el('mpStat').dataset.hp = MP.hp <= 25 ? 'low' : MP.hp <= 60 ? 'mid' : 'ok';
  el('mpWeapon').textContent = W().name; el('mpAmmo').textContent = MP.reloadAt ? 'перезарядка…' : MP.ammo[MP.weapon] + ' / ' + MP.reserve[MP.weapon]; el('mpAmmo').title = 'в магазине / запас'; el('mpAmmo').dataset.empty = !MP.reloadAt && MP.ammo[MP.weapon] === 0 ? 1 : 0; el('mpAmmo').dataset.reload = MP.reloadAt ? 1 : 0;
  const nk = keyName(SET.keys.grenade), mk = keyName(SET.keys.med);
  el('mpNades').textContent = '×' + Math.max(0, MP.nades); el('mpNadesBox').dataset.empty = MP.nades > 0 ? 0 : 1; el('mpNadesBox').title = 'Гранаты (' + nk + ' — прицельный бросок)'; el('mpNadeKey').textContent = nk;
  el('mpMeds').textContent = '×' + Math.max(0, MP.meds); el('mpMedsBox').dataset.empty = MP.meds > 0 ? 0 : 1; el('mpMedsBox').title = 'Аптечки (' + mk + ')'; el('mpMedKey').textContent = mk;
  const sl = el('mpSlots'); if (sl.children.length !== WEAPONS.length) { sl.textContent = ''; WEAPONS.forEach((w, i) => { const d = document.createElement('span'), b = document.createElement('b'), r = document.createElement('i'); d.title = w.name; d.innerHTML = SLOT_SVG[i]; b.textContent = i + 1; d.append(b, r); sl.append(d); }); }
  [...sl.children].forEach((d, i) => { d.classList.toggle('on', i === MP.weapon); d.querySelector('i').textContent = MP.reserve[i]; d.title = WEAPONS[i].name + ' · запас ' + MP.reserve[i]; });
  renderInv({ weapons: WEAPONS.map((w, i) => ({ name: w.name, mag: MP.ammo[i], magSize: w.mag, reserve: MP.reserve[i], on: i === MP.weapon, key: keyName(SET.keys['w' + (i + 1)]), dmg: DMG[i].dmg, head: DMG[i].head, pellets: w.pellets, gapMs: w.gapMs, range: w.range, reloadMs: w.reloadMs, auto: w.auto, scope: !!w.scope, attach: MP.attach[i] })), nades: MP.nades, nadeMax: NADE_MAX, meds: MP.meds, medMax: MED_MAX, sights: MP.sights, hp: MP.hp, medKey: keyName(SET.keys.med), nadeKey: keyName(SET.keys.grenade), reloadKey: keyName(SET.keys.reload), reloadW: MP.reloadAt ? MP.reloadW : -1, reloadAt: MP.reloadAt, name: MP.name, team: MP.team, ffa: MP.ffa, kills: MP.kills, deaths: MP.deaths });
  el('mpScore').textContent = MP.kills + ' · ' + MP.deaths; el('mpFps').textContent = PERF.fps + ' кадр/с' + (PERF.scale < 1 ? ' · разрешение ' + Math.round(PERF.scale * 100) + ' %' : '');
  el('mpMeName').textContent = MP.name || 'Вы'; el('mpMeDot').className = 'dot ' + (MP.ffa ? 'tf' : 't' + MP.team);
  const tm = el('mpTeams'); tm.textContent = '';
  if (MP.ffa) { const lead = [...MP.board].sort((a, b) => b.kills - a.kills)[0], me = document.createElement('b'), ld = document.createElement('b'), lim = document.createElement('small'); me.className = 'me'; me.textContent = 'Вы ' + MP.kills; ld.className = 'lead'; ld.textContent = lead ? lead.name + ' ' + lead.kills : ''; lim.textContent = 'до ' + MP.win; tm.append(me, ld, lim); } else { const chip = (i, t, s) => { const e = document.createElement('b'), n = document.createElement('small'), v = document.createElement('span'); e.className = 't' + i; n.textContent = t; v.textContent = s; e.append(n, v); return e; };
  const lim = document.createElement('small'); lim.textContent = 'до ' + MP.win; tm.append(chip(0, MP.teams[0], MP.score[0]), lim, chip(1, MP.teams[1], MP.score[1])); }
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
  MP.dead = true; MP.deadAt = performance.now(); MP.firing = false; MP.scope = false; gun.visible = false; closeInv(); nadeCancel(); punchReset();
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
// G takes the grenade in hand (the arms bring it up and pull the pin): the mouse aims, the arc and the disc of the blast
// show where it will go, the left button held down winds the throw up and charges it (the arcs round the crosshair),
// the release throws; the right button or G again puts it away and the weapon comes back up
function nadeCancel(thrown) {
  if (!NAIM.on) return;
  NAIM.on = false; NAIM.charging = false; NAIM.power = 0; NAIM.full = false;
  hideNadePreview(); el('nadeUi').hidden = true;
  if (!thrown && vm && !MP.dead) vm.equip();
}
function nadePrep() {
  const now = performance.now();
  if (MP.dead || !MP.ws || MP.ws.readyState !== 1) return;
  if (NAIM.on) { nadeCancel(); return; }
  if (MP.nades <= 0) { feed('Гранат нет — ищите их на карте', 'sys'); tone(180, 120, 0.12, 0.2, 'square'); return; }
  if (now - MP.lastNade < 900) return;
  NAIM.on = true; NAIM.charging = false; NAIM.power = 0; NAIM.full = false; NAIM.at = now; NTHROW.at = 0;
  MP.scope = false; MP.firing = false; closeInv();
  el('nadeUi').hidden = false; el('nadeUi').dataset.full = '0'; nadeGauge(0);
  tone(340, 430, 0.07, 0.15, 'triangle');
  setTimeout(() => { if (NAIM.on && now === NAIM.at) tone(1250, 900, 0.035, 0.08, 'square'); }, 360);   // the click of the pin coming out
}
function throwNade(power) {
  const now = performance.now();
  if (MP.dead || MP.nades <= 0 || now - MP.lastNade < 900) { nadeCancel(); return; }
  MP.nades--; MP.lastNade = now;
  const d = aim(), sp = NADE_THROW.min + (NADE_THROW.max - NADE_THROW.min) * Math.max(0, Math.min(1, power));
  MP.ws.send(JSON.stringify({ t: 'throw', dx: +d[0].toFixed(4), dy: +d[1].toFixed(4), dz: +d[2].toFixed(4), sp: +sp.toFixed(2) }));
  tone(260, 140, 0.12, 0.2, 'triangle');
  NTHROW.at = now; NTHROW.pw = Math.max(0, Math.min(1, power)); NTHROW.gone = false;
  nadeCancel(true); updatePanel();
}
// what the arms do with the grenade now: { t: seconds in hand, pw: the charge, rel: seconds since the release (−1 before),
// pwRel: the charge it went with, gone: the grenade is already in the air }, or null when they hold the weapon; the end of the follow-through brings the weapon back
function nadeView(now) {
  if (MP.nadePose) return MP.nadePose;   // a pose held still, for the headless checks (tools/shot-items.mjs)
  if (NAIM.on) return { t: (now - NAIM.at) / 1000, pw: NAIM.charging ? NAIM.power : 0, rel: -1, pwRel: 0 };
  if (NTHROW.at) {
    const r = (now - NTHROW.at) / 1000;
    if (r < 0.42 && !MP.dead) return { t: 9, pw: 0, rel: r, pwRel: NTHROW.pw, gone: NTHROW.gone };
    NTHROW.at = 0; if (vm && !MP.dead) vm.equip();
  }
  return null;
}
// the power arcs round the crosshair
const nadeArcs = [...document.querySelectorAll('#nadeUi .ng-fill')];
function nadeGauge(pw) { const o = (59.34 * (1 - pw)).toFixed(2); for (const a of nadeArcs) a.style.strokeDashoffset = o; }
const NADE_FROM = new THREE.Vector3();
// every frame while the grenade is in hand: the charge grows, the arc follows the aim and the power
function nadeAimTick(now) {
  if (!NAIM.on) return;
  if (!STATE.locked || MP.dead) { nadeCancel(); return; }
  if (NAIM.charging) {
    NAIM.power = Math.min(1, (now - NAIM.t0) / NADE_THROW.chargeMs);
    if (NAIM.power >= 1 && !NAIM.full) { NAIM.full = true; tone(900, 900, 0.05, 0.1, 'square'); }
  }
  const pw = MP.nadePose ? MP.nadePose.pw : NAIM.charging ? NAIM.power : 0, d = aim(), sp = NADE_THROW.min + (NADE_THROW.max - NADE_THROW.min) * pw;
  // the arc is drawn out of the grenade in hand (it sweeps into the true flight within a couple of metres)
  if (vm && vm.canNade) vm.nadeAt(NADE_FROM); else nadeBall.getWorldPosition(NADE_FROM);
  const r = showNadePreview([P.x + d[0] * 0.6, P.y - 0.2 + d[1] * 0.6, P.z + d[2] * 0.6], [d[0] * sp, d[1] * sp + NADE_THROW.loft * sp, d[2] * sp], pw, NADE_FROM);
  nadeGauge(pw); el('nadeUi').dataset.full = NAIM.full ? '1' : '0';
  const m = String(Math.round(r.dist)); if (el('nadeDist').textContent !== m) el('nadeDist').textContent = m;
}
// the stand-in fist (no gloved arms): the same moves, roughly — up from below, back over the shoulder, the whip and down
function nadeHandTick(nv) {
  nadeHand.visible = !!nv && !(vm && vm.canNade);
  if (!nadeHand.visible) return;
  const e = k => k * k * (3 - 2 * k), cl = k => Math.max(0, Math.min(1, k));
  let x, y, z, rx;
  if (nv.rel < 0) { const up = 1 - (1 - cl(nv.t / 0.3)) ** 3, b = e(nv.pw); x = 0.17 + 0.05 * b; y = -0.55 + (0.42 + 0.17 * b) * up; z = -0.36 + 0.16 * b; rx = -0.9 * b; }
  else if (nv.rel < 0.09) { const k = (nv.rel / 0.09) ** 3, b = e(nv.pwRel); x = 0.17 + 0.05 * b - 0.12 * k; y = -0.13 + 0.17 * b - (0.17 * b - 0.1) * k; z = -0.36 + 0.16 * b - (0.16 * b + 0.1) * k; rx = -0.9 * b + (0.9 * b + 0.5) * k; }
  else { const k = 1 - (1 - cl((nv.rel - 0.09) / 0.3)) ** 3; x = 0.05 - 0.15 * k; y = -0.03 - 0.4 * k; z = -0.46 + 0.1 * k; rx = 0.5 + 0.5 * k; }
  nadeHand.position.set(x, y, z); nadeHand.rotation.x = rx; nadeBall.visible = nv.rel < 0.08 && !nv.gone;
}
const specAble = r => !r.fallT && r.buf.length > 0;   // alive with a fresh snapshot: the first-person view hides the body, so group.visible is not the test
const specList = () => [...remotes.entries()].filter(([, r]) => specAble(r)).sort((a, b) => isMate(b[1]) - isMate(a[1])).map(e => e[0]);
function specNext(dir) {
  const l = specList(); if (!l.length) { MP.spec = 0; return; }
  const i = l.indexOf(MP.spec); MP.spec = l[i < 0 ? 0 : (i + dir + l.length) % l.length];
}
function specCam() {   // F or the button on the death panel: the eyes ↔ behind the back
  MP.specFP = !MP.specFP;
  try { localStorage.setItem('dpils.specfp', MP.specFP ? '1' : '0'); } catch (e) {}
  specCamUi();
}
function specCamUi() { const b = el('mpSpecCam'); b.textContent = MP.specFP ? 'Из-за спины (F)' : 'От первого лица (F)'; b.setAttribute('aria-pressed', String(MP.specFP)); }
// dead: the camera rides a living player's eyes (first person, the default) or follows from behind — the killer first,
// then teammates — until the respawn; F switches the two views
function spectate(now) {
  if (!MP.dead) return;
  let r = remotes.get(MP.spec); if (!r || !specAble(r)) { specNext(1); r = remotes.get(MP.spec); }
  const label = el('mpSpec'); if (!r) { label.textContent = 'Некого показывать'; return; }
  const p = pose(r, now - 120); if (!p) return;
  if (MP.specFP) { P.x = p.x; P.y = p.y; P.z = p.z; P.yaw = p.yaw; P.pitch = p.pitch; }   // from the eyes: the watched body is hidden in mpTick
  else { P.yaw = p.yaw; P.pitch = -0.14; P.x = p.x + Math.sin(p.yaw) * 3.2; P.z = p.z + Math.cos(p.yaw) * 3.2; P.y = p.y + 0.6; }
  const t = 'Наблюдение: ' + r.name + (isMate(r) ? ' (свой)' : MP.ffa ? '' : ' (враг)') + ' · ← → или щелчок — другой · F — ' + (MP.specFP ? 'из-за спины' : 'от первого лица'); if (label.textContent !== t) label.textContent = t;
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
    case 'hello': MP.ffa = m.mode === 'ffa'; document.body.classList.toggle('ffa', MP.ffa); if (MP.ffa) { const o = el('mpRespawnAt').querySelector('option[value=mate]'); if (o) o.remove(); } if (!MP.local) rememberServer(MP.url, m.server); voice = createVoice({ myId: () => MP.id, send: (to, d) => MP.ws.send(JSON.stringify({ t: 'rtc', to, d })), info: voiceInfo, onSpeaking: showSpeaking }); voice.setVolume(SET.voiceVol); CH.send = (text, team) => MP.ws.send(JSON.stringify({ t: 'chat', text, team })); MP.id = m.id; MP.name = m.name; MP.team = m.team; MP.teams = m.teams; MP.win = m.win; MP.score = m.score; MP.board = m.board; for (const e of m.board) addRemote(e.id, e.name, e.team, e.char); document.body.dataset.team = m.team;
      MP.arena = m.arena || null; clearFx(); clearBlasts(); setItems(m.items);
      for (const [id, a] of Object.entries(m.attach || {})) { const r = remotes.get(+id); if (r && Array.isArray(a)) { r.attach = a; if (r.av) a.forEach((k, w) => r.av.setAttach(w, k)); } } if (MP.arena) { arenaChoices(); feed('Арена: ' + MP.arena.name + (MP.ffa ? '' : '. Вы — ' + m.teams[m.team].toLowerCase()), 'sys'); }
      if (MP.local) feed('Тренировка с ботами: ' + MP.board.filter(e => e.bot).length + ', уровень «' + ({ easy: 'лёгкий', normal: 'средний', hard: 'трудный' }[MP.local.level] || '') + '»', 'sys'); break;
    case 'spawn': {
      nadeCancel(); punchReset();
      const [x, z] = freeSpot(m.x, m.z); P.x = x; P.z = z; P.eye = 1.7; P.up = 0; P.vy = 0; P.vx = P.vz = 0; P.kx = P.kz = 0; P.fallTop = 0; P.landH = 0; P.land = 0; P.crouch = false; P.y = 1.7 + terrainH(x, z); P.yaw = m.yaw; P.pitch = 0; STATE.mapTimer = 0; STATE.lodTimer = 0;
      if (!MP.started) { MP.started = true; showGame(); }
      MP.weapon = 0; MP.scope = false; models.forEach((mm, k) => { mm.visible = k === 0; }); MP.hp = m.hp; MP.ammo = m.mag ? m.mag.slice() : WEAPONS.map(w => w.mag); MP.reserve = m.reserve ? m.reserve.slice() : RESERVE.slice(); MP.meds = m.meds ?? 0; MP.reloadAt = 0; MP.dead = false; STATE.mpDead = false; document.body.classList.remove('dead'); MP.spec = 0; MP.nades = m.nades ?? 2; MP.sights = m.sights ? { ...m.sights } : { sight: 0, optic: 0 }; MP.attach = Array.isArray(m.attach) ? m.attach.slice() : [null, null, null, null, null]; syncVm(); clearNades(); gun.visible = true; if (vm) { vm.setWeapon(0); vm.equip(); } el('mpDead').hidden = true; slotsT = performance.now() + 2600; updatePanel();   // the belt greets the spawn, then hides
      MP.ws.send(JSON.stringify({ t: 'state', x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch }));   // the server has the point as asked: tell it where the player really stands
      if (canvas.requestPointerLock) { canvas.focus(); try { const pr = canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} }
      break;
    }
    case 'pong': MP.rtt = Math.round(MP.rtt ? MP.rtt * 0.6 + (performance.now() - m.c) * 0.4 : performance.now() - m.c); el('mpPing').textContent = 'пинг ' + MP.rtt + ' мс'; updatePanel(); break;
    case 'correct': P.x = m.x; P.z = m.z; if (m.out) edgeNotice(); break;
    case 'snap': {
      const t = performance.now(), seen = new Set();
      for (const [id, x, y, z, yaw, pitch, h, w] of m.p) { if (id === MP.id) continue; seen.add(id); const r = remotes.get(id) || addRemote(id, nameOf(id), teamOf(id)); r.buf.push({ t, x, y, z, yaw, pitch, h, w }); if (r.buf.length > 12) r.buf.shift(); }
      for (const [id, r] of remotes) if (!seen.has(id) && !r.fallT) { r.group.visible = false; r.buf.length = 0; }
      break;
    }
    case 'shot': { const rs = remotes.get(m.id); if (rs) rs.shotAt = performance.now(); if (m.id === MP.id) { if (ownTracers) { m.rays.forEach((r, i) => bindTracer(r[4], ownTracers[i])); ownTracers = null; } } else otherShot(m); break; }
    case 'nbounce': syncNade(m.id, m.p, m.v); break;   // the server bounced the grenade off a body: the copy follows its flight
    case 'nshot': {   // a bullet shot the grenade down: cut the tracer, sparks there; the blast ('boom') follows at once
      hitTracer(m.bid, m.d, 'nade');
      if (m.by === MP.id) { feed('Граната сбита', 'sys'); tone(1200, 1800, 0.09, 0.25, 'triangle'); }
      else { const s = spot(m.at[0], m.at[1], m.at[2]); if (s.d < 40) try { nadeBounce(ac(), actx.master, 'wall', 0.5 * (1 - s.d / 40), s.d, s.pan); } catch (e) {} }
      break;
    }
    case 'bhit': { const body = m.v && m.v !== MP.id; hitTracer(m.bid, m.d, body);
      if (body) { const rv = remotes.get(m.v); if (rv) { rv.flinchT = performance.now(); rv.flinchZone = m.zone; const rs = remotes.get(m.by), bp = rs && rs.buf.length ? rs.buf[rs.buf.length - 1] : null; let dx = bp ? m.at[0] - bp.x : Math.random() - 0.5, dz = bp ? m.at[2] - bp.z : Math.random() - 0.5; const l = Math.hypot(dx, dz) || 1; rv.flinchDX = dx / l; rv.flinchDZ = dz / l; } }   // the victim flinches away from the bullet's path
      if (body && m.by !== MP.id) { const s = spot(m.at[0], m.at[1], m.at[2]); if (s.d < 40) try { hitSound(ac(), actx.master, 'body', 0.6 * 4 / (4 + s.d) * (1 - s.d / 40), s.d, s.pan); } catch (e) {} } break; }   // the bullet reached a body: cut the tracer, bleed there; a bystander hears the impact (the shooter gets 'hit')
    case 'hit': statEvent('hit', m, !!MP.local); hitT = performance.now(); if (m.kill) { tone(880, 880, 0.12, 0.25, 'triangle'); tone(1320, 1320, 0.25, 0.25, 'triangle', 0.1); } else tone(m.head ? 2600 : 1700, m.head ? 2200 : 1400, 0.07, 0.2, 'square'); { const r = remotes.get(m.id), g = r && r.group.visible ? r.group.position : null; if (g) { const s = spot(g.x, g.y + 1.2, g.z); try { hitSound(ac(), actx.master, m.head ? 'head' : 'body', 0.75 * 6 / (6 + s.d), s.d, s.pan); } catch (e) {} if (m.dmg > 0) dmgFloat(g.x, g.y + 1.9, g.z, String(m.dmg), m.head ? 'head' : m.kill ? 'kill' : ''); } } { const hm = el('mpHit'); hm.className = m.head ? 'head' : m.kill ? 'kill' : ''; hm.hidden = false; hm.style.animation = 'none'; void hm.offsetWidth; hm.style.animation = ''; hitDur = m.kill ? 260 : 180; } break;   // every hit pops the marker afresh, even in a long burst
    case 'hurt': {
      const dmg = Math.max(0, MP.hp - m.hp);
      statEvent('taken', { dmg }, !!MP.local); MP.hp = m.hp; hurtT = performance.now();
      if (m.fall) { tone(70, 32, 0.3, 0.5, 'sine'); el('mpHurtDir').hidden = true; }   // a fall: no side to point at and no aim punch, the thud of the landing already sounded
      else {
        let real = false; try { real = hitSound(ac(), actx.master, 'body', 1); } catch (e) {} if (!real) tone(160, 60, 0.18, 0.4, 'sawtooth');
        el('mpHurtDir').hidden = false;
        const a = Math.atan2(-m.dx, -m.dz) - P.yaw; el('mpHurtDir').style.transform = 'rotate(' + (-a) + 'rad)';   // the side the shot came from
        const s = Math.min(1.5, 0.3 + dmg / 35), rel = Math.atan2(Math.sin(a), Math.cos(a));   // the aim punch: up and away from the shooter's side, scaled by the damage
        punch.p = Math.min(0.085, punch.p + 0.026 * s + Math.random() * 0.006);
        punch.y = Math.max(-0.045, Math.min(0.045, punch.y - Math.sign(rel || Math.random() - 0.5) * 0.011 * s + (Math.random() - 0.5) * 0.008));
        punch.r = Math.max(-0.025, Math.min(0.025, punch.r + (Math.random() - 0.5) * 0.02 * s));
        MP.kick = Math.max(MP.kick, 0.45 + 0.25 * s); hurtBloom = Math.min(26, hurtBloom + 7 * s);
      }
      hurtAmp = Math.min(1, 0.5 + dmg / 70); el('mpHurt').style.opacity = String(hurtAmp);
      el('mpHurt').hidden = false; updatePanel();
      if (m.hp <= 0) die(m.fall ? '' : nameOf(m.by), m.by);
      break;
    }
    case 'push': {   // the blast throws: the server sends the velocity, the jump carries it up and the slide aside (player.js)
      if (MP.dead) break;
      P.kx += m.vx; P.kz += m.vz;
      const kl = Math.hypot(P.kx, P.kz); if (kl > 16) { P.kx *= 16 / kl; P.kz *= 16 / kl; }
      P.vy = Math.min(P.vy + m.vy, 16);
      break;
    }
    case 'kill': { feed(m.kn + '  ➜  ' + m.vn + (m.w === 9 ? '  (граната)' : m.w === 10 ? '  (падение)' : m.head ? '  (в голову)' : ''), m.killer === MP.id ? 'mine' : m.victim === MP.id ? 'dead' : ''); if (m.killer === MP.id) { MP.kills++; if (m.victim !== MP.id) statEvent('kill', m, !!MP.local); } if (m.victim === MP.id) { MP.deaths++; statEvent('death', {}, !!MP.local); if (!MP.dead) die(m.w === 10 ? '' : m.kn, m.killer); } else { const rv = remotes.get(m.victim); if (rv && rv.buf.length) { rv.fallT = performance.now(); rv.corpse = corpseOf(rv, m); } } updatePanel(); break; }
    case 'alive': { const r = remotes.get(m.id); if (r) { r.buf.length = 0; r.fallT = 0; } break; }
    case 'board': MP.board = m.board; MP.score = m.score; for (const e of m.board) { const r = addRemote(e.id, e.name, e.team, e.char); if (r) { r.name = e.name; r.tag.textContent = e.name; const char = parseChar(e.char); if (char !== r.char) { r.char = char; rebuildAvatar(r); } } if (e.id === MP.id) { MP.kills = e.kills; MP.deaths = e.deaths; } } for (const id of [...remotes.keys()]) if (!m.board.some(e => e.id === id)) dropRemote(id); drawBoard(); updatePanel(); if (voice) voice.setPeers(m.board.filter(e => e.id !== MP.id && !e.bot).map(e => e.id)); break;
    case 'left': dropRemote(m.id); break;
    case 'nade': { const own = m.by === MP.id && !!NTHROW.at; addNade(m, own ? (vm && vm.canNade ? vm.nadeAt(MV) : nadeBall.getWorldPosition(MV)) : null); if (own) NTHROW.gone = true; } if (m.by !== MP.id) { const rt = remotes.get(m.by); if (rt) rt.throwAt = performance.now(); const dd = Math.hypot(m.p[0] - P.x, m.p[2] - P.z); if (dd < 40) tone(500, 300, 0.08, 0.1 * (1 - dd / 40), 'triangle'); } break;
    case 'item': itemBack(m); break;
    case 'took': itemTook(m.id); if (m.to === MP.id) { feed('+ ' + KINDS[m.kind].name, 'sys'); tone(660, 990, 0.09, 0.22, 'triangle'); } break;
    case 'inv': MP.ammo = m.mag.slice(); MP.reserve = m.reserve.slice(); MP.nades = m.nades; MP.meds = m.meds; if (m.sights) MP.sights = { ...m.sights }; if (Array.isArray(m.attach)) { MP.attach = m.attach.slice(); syncVm(); } updatePanel(); break;
    case 'attach': if (m.id === MP.id) { MP.attach = m.attach.slice(); syncVm(); updatePanel(); } else { const r = remotes.get(m.id); if (r) { r.attach = m.attach; if (r.av) m.attach.forEach((k, w) => r.av.setAttach(w, k)); } } break;
    case 'heal': { const got = m.hp - MP.hp; MP.hp = m.hp; MP.meds = m.meds; feed('Аптечка: +' + got + ' HP', 'sys'); tone(440, 660, 0.16, 0.25, 'sine'); updatePanel(); break; }
    case 'boom': {
      const surf = boomNade(m), dd = Math.hypot(m.x - P.x, m.z - P.z), hear = 300; if (dd < hear) { const v = 1 - dd / hear; let real = false; try { real = boomSound(ac(), actx.master, 1.1 * v, dd, spot(m.x, P.y, m.z).pan, surf); } catch (e) {} if (!real) { bang(1.1 * v, true); tone(80, 35, 0.6, 0.5 * v, 'sine'); } }
      if (dd < 14 && !MP.dead) {   // the white of the flash: full when you look at it, a little from the side or behind
        const look = dd < 1 ? 1 : Math.max(0, -(Math.sin(P.yaw) * (m.x - P.x) + Math.cos(P.yaw) * (m.z - P.z)) / dd);
        el('mpFlash').hidden = false; el('mpFlash').style.opacity = String(0.8 * (1 - dd / 14) * (0.3 + 0.7 * look)); setTimeout(() => { el('mpFlash').hidden = true; }, 220);
      }
      if (dd < 11 && !MP.dead) deafen(1 - dd / 11, dd / 340);
      break;
    }
    case 'say': addLine(m, MP.id); if (m.id !== MP.id) tone(900, 700, 0.05, 0.08, 'sine'); break;
    case 'rtc': if (voice) voice.signal(m.from, m.d); break;
    case 'win': { nadeCancel(); const mine = m.mode === 'ffa' ? m.mvp === MP.id : m.team === MP.team, row = m.rows.find(r => r.id === MP.id); statEvent('round', { win: mine, kills: row ? row.kills : 0 }, !!MP.local); showSummary(m); break; }
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
  try { localStorage.setItem('dpils.mp', JSON.stringify({ name, server: el('mpServer').value.trim(), spawn: el('mpSpawn').value, team: el('mpTeam').value, char: el('mpChar').value })); } catch (e) {}
  MP.spawn = +el('mpSpawn').value; MP.wantTeam = +el('mpTeam').value; MP.url = url; MP.local = local || null; loadModels(); msg.textContent = 'Подключаюсь…'; el('goPlay').disabled = true; el('goTrain').disabled = true;
  let ws; try { ws = local ? openLocal(local) : new WebSocket(url); } catch (e) { msg.textContent = 'Неверный адрес сервера.'; el('goPlay').disabled = false; el('goTrain').disabled = false; return; }
  MP.ws = ws; MP.started = false;
  ws.onopen = () => { const s = spawnPoint(); ws.send(JSON.stringify({ t: 'join', name, team: MP.wantTeam, char: el('mpChar').value || undefined, key: local ? undefined : playerKey() || undefined, ...s })); };
  ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onerror = () => { if (!MP.started) msg.textContent = 'Не удалось подключиться к ' + url; };
  ws.onclose = () => { nadeCancel(); el('nadeWarn').hidden = true; if (MP.started) { el('mpDead').hidden = true; el('mpOver').hidden = false; if (document.pointerLockElement) document.exitPointerLock(); } else { el('goPlay').disabled = false; el('goTrain').disabled = false; if (!msg.textContent.startsWith('На сервере') && !msg.textContent.startsWith('Не удалось')) msg.textContent = 'Соединение закрыто.'; } };
}
let uiReady = false;
function initUi() {   // the fields of the player and of the training: once, when the start card first needs them (or when the city is ready)
  if (uiReady) return; uiReady = true;
  const sel = el('mpSpawn'); sel.textContent = '';
  PLACES.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p[0]; sel.append(o); });
  const r = document.createElement('option'); r.value = -1; r.textContent = 'Случайное место'; sel.append(r);
  const ch = el('mpChar'); ch.textContent = '';
  for (const key of CHAR_KEYS) { const o = document.createElement('option'); o.value = key; o.textContent = CHARS[key].name; ch.append(o); }
  try { const s = JSON.parse(localStorage.getItem('dpils.mp') || '{}'); if (s.name) el('mpName').value = s.name; if (s.server) el('mpServer').value = s.server; if (s.spawn != null) sel.value = s.spawn; if (s.team != null) el('mpTeam').value = s.team; if (parseChar(s.char)) ch.value = s.char; } catch (e) {}
  const acc = account(); if (acc) el('mpName').value = acc.name;   // the account's nick belongs to its key on the server
  el('mpName').placeholder = 'Игрок' + (100 + Math.floor(Math.random() * 900));
  if (!el('mpName').value) el('mpName').value = el('mpName').placeholder;
  const rs = el('mpRespawnAt'); rs.textContent = ''; for (const [v, t] of [['mate', 'Рядом с товарищем'], ['rand', 'Случайное место']].concat(PLACES.map((p, i) => [i, p[0]]))) { const o = document.createElement('option'); o.value = v; o.textContent = t; rs.append(o); }
  el('mpNoBoard').checked = !boardOn(); el('mpNoBoard').onchange = () => setBoardOn(!el('mpNoBoard').checked); initLeaders(() => (MP.on ? (MP.local ? '' : MP.url) : serverUrl()));
  el('goPlay').onclick = () => join(); el('goTrain').onclick = () => { const o = { bots: +el('trBots').value, level: el('trLevel').value, mode: el('trMode').value, arena: el('trArena').value }; try { localStorage.setItem('dpils.train', JSON.stringify(o)); } catch (e) {} join(o); };
  try { const t = JSON.parse(localStorage.getItem('dpils.train') || '{}'); for (const [k, id] of [['bots', 'trBots'], ['level', 'trLevel'], ['mode', 'trMode'], ['arena', 'trArena']]) if (t[k] != null && [...el(id).options].some(o => o.value === String(t[k]))) el(id).value = t[k]; } catch (e) {} el('mpRespawn').onclick = respawn; el('mpSpecCam').onclick = specCam; specCamUi(); el('mpLeave').onclick = () => location.reload(); el('mpOverBtn').onclick = () => location.reload();
  el('bLeave').onclick = () => location.reload();
}

/* ---------- input ---------- */
canvas.addEventListener('wheel', e => { if (MP.on && !MP.dead) switchWeapon((MP.weapon + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length); }, { passive: true });
canvas.addEventListener('contextmenu', e => { if (MP.on) e.preventDefault(); });
canvas.addEventListener('mousedown', e => {
  if (MP.on && e.button === 2) { if (NAIM.on) { nadeCancel(); return; } if ((W().scope || MP.attach[MP.weapon]) && !MP.dead && !MP.reloadAt) MP.scope = true; }   // right button: the sniper's own scope, or the sight mounted on any weapon
  if (!MP.on || e.button !== 0) return;
  if (MP.dead) { specNext(1); return; }
  if (NAIM.on) { if (STATE.locked) { NAIM.charging = true; NAIM.t0 = performance.now(); NAIM.power = 0; NAIM.full = false; } return; }   // the held left button gathers the throw instead of firing
  MP.firing = true; if (!STATE.locked && !MP.dead) return; fire(performance.now());
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) { MP.firing = false; if (NAIM.on && NAIM.charging) { NAIM.charging = false; throwNade(NAIM.power); } }   // the release throws with the gathered power
  if (e.button === 2) MP.scope = false;
});
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;   // typing in the chat box
  if (!MP.on || e.repeat) return;
  if (e.code === SET.keys.voice && voice) { if (!voice.hasMic) { voice.enableMic().then(ok => { el('mpVoice').dataset.mic = ok ? 'on' : 'denied'; }); } else voice.talk(true); }
  else if (!MP.dead && (e.code === SET.keys.chat || e.code === SET.keys.teamChat || e.code === 'Enter')) { e.preventDefault(); nadeCancel(); openChat(e.code === SET.keys.teamChat && !MP.ffa); }
  else if (MP.dead && (e.code === 'ArrowRight' || e.code === 'KeyE')) specNext(1);
  else if (MP.dead && (e.code === 'ArrowLeft' || e.code === 'KeyQ')) specNext(-1);
  else if (MP.dead && e.code === 'KeyF') specCam();
  else if (e.code === SET.keys.inv) { if (!MP.dead) { nadeCancel(); toggleInv(); } }
  else if (e.code === SET.keys.med) useMed();
  else if (e.code === SET.keys.grenade) { closeInv(); nadePrep(); }
  else if (e.code === SET.keys.reload) { closeInv(); nadeCancel(); reload(performance.now()); }
  else if (e.code === SET.keys.w1) switchWeapon(0); else if (e.code === SET.keys.w2) switchWeapon(1); else if (e.code === SET.keys.w3) switchWeapon(2); else if (e.code === SET.keys.w4) switchWeapon(3); else if (e.code === SET.keys.w5) switchWeapon(4);
  else if (e.code === SET.keys.board) { e.preventDefault(); el('mpBoard').hidden = false; drawBoard(); }
  else if ((e.code === 'Space' || e.code === 'Enter') && MP.dead) { e.preventDefault(); respawn(); }
});
window.addEventListener('keyup', e => { if (e.code === SET.keys.board) el('mpBoard').hidden = true; if (e.code === SET.keys.voice && voice) voice.talk(false); });

/* ---------- the crosshair ----------
   Four lines and a dot (a ring for the shotgun) whose gap follows the real angular spread of the shots, projected to
   screen pixels through the current field of view. The colour warns about the magazine: amber when it runs low or a
   reload is on, red when it is empty; a ring around the cross counts the reload down. */
const CROSS = [
  { gap: 5, len: 9, th: 2 },        // rifle
  { ring: true, gap: 12, th: 2 },   // shotgun: the ring is the pellet cone
  { gap: 12, len: 7, th: 1.5 },     // sniper, from the hip
  { gap: 4, len: 7, th: 2 },        // pistol
  { gap: 8, len: 10, th: 2.5 } ];   // machine gun
const crossEl = $('cross'), crossRe = crossEl.querySelector('.c-re circle');
let crossGap = 6, crossKey = '';
function crossTick(dt, now) {
  const cfg = CROSS[MP.weapon], w = W();
  const show = !MP.dead && MP.zoom <= 0.6;
  const vis = show ? '' : 'hidden'; if (crossEl.style.visibility !== vis) crossEl.style.visibility = vis;
  if (show && crossEl.hidden) crossEl.hidden = false;   // whatever hid it (a lock release), the fight crosshair comes back
  if (!show) return;
  const K = canvas.clientHeight / (2 * Math.tan(camera.fov * Math.PI / 360));   // screen pixels per radian at this fov
  const target = Math.min(80, (cfg.ring ? Math.max(10, spreadNow() * K) : Math.min(70, cfg.gap + (SET.crossDyn ? spreadNow() * K : 0))) + hurtBloom);   // a hit on you blooms the crosshair too
  crossGap += (target - crossGap) * Math.min(1, dt * 14);
  hurtBloom *= Math.exp(-dt * 5); if (hurtBloom < 0.1) hurtBloom = 0;
  const mag = MP.ammo[MP.weapon];
  const col = NAIM.on ? '#ffd27a' : MP.reloadAt ? '#ffc24d' : mag === 0 ? '#ff5a4d' : mag <= w.mag * 0.25 ? '#ffc24d' : SET.crossCol;   // amber while the grenade is aimed
  const g = Math.round(crossGap * 2) / 2, key = MP.weapon + '|' + g + '|' + col + '|' + SET.crossDot;
  if (key !== crossKey) {
    crossKey = key;
    crossEl.classList.toggle('ring', !!cfg.ring); crossEl.classList.toggle('nodot', !SET.crossDot);
    crossEl.style.setProperty('--gap', g + 'px'); crossEl.style.setProperty('--len', (cfg.len || 0) + 'px');
    crossEl.style.setProperty('--th', cfg.th + 'px'); crossEl.style.setProperty('--col', col);
  }
  if (MP.reloadAt) { const p = Math.min(1, (now - MP.reloadAt) / WEAPONS[MP.reloadW].reloadMs); crossRe.style.strokeDashoffset = (106.81 * (1 - p)).toFixed(1); crossEl.classList.add('reloading'); }
  else crossEl.classList.remove('reloading');
}

// the clink of a grenade touching down, heard from where you stand (the page flies its own copy, so every touch is known
// without a message): the impact speed and the distance set the volume, the side and the delay of the sound
onNadeBounce((p, b) => {
  if (!MP.on || MP.dead) return;
  const d = Math.hypot(p[0] - P.x, p[2] - P.z); if (d > 50) return;
  const s = spot(p[0], p[1], p[2]), vol = Math.min(1, b.sp / 12) * (1 - d / 50);
  let real = false; try { real = nadeBounce(ac(), actx.master, b.kind, vol, d, s.pan); } catch (e) {}
  if (!real) tone(1100, 650, 0.05, 0.16 * vol, 'triangle');
});
// the bodies the flying grenade (and the aim arc) bounces off, as the server sees them: the living players, the thrower
// left out (one's own body does not stop one's own grenade); the arc of the aimed throw leaves your own body out too
setNadeBodies(n => {
  const out = [];
  for (const r of remotes.values()) {
    if (r.fallT || !r.buf.length || (n && n.by === r.id)) continue;
    const b = r.buf[r.buf.length - 1];
    out.push({ x: b.x, y: b.y, z: b.z, eye: b.h || 1.7 });
  }
  if (!MP.dead && !(n && (n.preview || n.by === MP.id))) out.push({ x: P.x, y: P.y, z: P.z, eye: P.eye });
  return out;
});
// the danger indicator: a live enemy grenade near you is marked on the screen, or at its edge with a pointer when it is
// off to the side or behind; it pulses faster as the fuse runs out, so you know to move before it goes off
const NW = new THREE.Vector3();
function nadeWarnTick() {
  const w = el('nadeWarn');
  let best = null, bd = 1e9;
  for (const n of liveNades()) {
    if (n.by === MP.id) continue;
    const r = remotes.get(n.by); if (!MP.ffa && r && r.team === MP.team) continue;
    const d = Math.hypot(n.p[0] - P.x, n.p[1] - P.y, n.p[2] - P.z);
    if (d < 12 && d < bd) { bd = d; best = n; }
  }
  if (!best || MP.dead) { w.hidden = true; return; }
  w.hidden = false;
  const left = Math.max(0, 2.5 - best.age), pulse = 0.55 + 0.45 * Math.sin(performance.now() / 1000 * (6 + (2.5 - left) * 7));
  w.style.opacity = ((0.4 + 0.6 * (1 - bd / 12)) * pulse).toFixed(2);
  NW.set(best.p[0], best.p[1], best.p[2]).project(camera);
  const W = innerWidth, H = innerHeight, m = 52, cx = W / 2, cy = H / 2;
  let x = (NW.x * 0.5 + 0.5) * W, y = (-NW.y * 0.5 + 0.5) * H;
  const behind = NW.z > 1; if (behind) { x = W - x; y = H - y; }
  const on = !behind && x > m && x < W - m && y > m && y < H - m;
  if (!on) {
    const ang = Math.atan2(y - cy, x - cx), hw = cx - m, hh = cy - m;
    const t = Math.min(hw / Math.max(1e-6, Math.abs(Math.cos(ang))), hh / Math.max(1e-6, Math.abs(Math.sin(ang))));
    x = cx + Math.cos(ang) * t; y = cy + Math.sin(ang) * t;
    w.dataset.edge = '1'; w.style.setProperty('--ang', ang + 'rad');
  } else w.dataset.edge = '0';
  w.style.left = x + 'px'; w.style.top = y + 'px';
}

/* ---------- every frame ---------- */
function mpTick(dt) {
  if (!MP.on) return;
  const now = performance.now(), t = now - 120;
  if (voice) voice.update(dt); ambTick(dt); statEvent('tick', { dt }, !!MP.local);
  if (MP.arena && !MP.dead) { const A = MP.arena, dx = P.x - A.cx, dz = P.z - A.cz, d = Math.hypot(dx, dz); if (d > A.r - 1) { P.x = A.cx + dx / d * (A.r - 1); P.z = A.cz + dz / d * (A.r - 1); edgeNotice(); } }   // the edge of the arena
  if ((MP.fpsT = (MP.fpsT || 0) - dt) <= 0) { MP.fpsT = 1; updatePanel(); }
  el('mpReloadFill').style.width = (MP.reloadAt ? Math.min(1, (now - MP.reloadAt) / WEAPONS[MP.reloadW].reloadMs) * 100 : 0).toFixed(1) + '%';   // the reload bar under the rounds, every frame (the crosshair ring keeps its own)
  invTick(now);   // the reload bar of the inventory panel, if it is open
  el('mpSlots').classList.toggle('show', now < slotsT);   // the belt of weapons: shown by a switch or the wheel, hidden once the choice settles
  const nv = nadeView(now);   // the arms with the grenade, or null
  // the scope: the picture closes in (the field of view 66° → 20°) and the gun goes out of sight
  { const at = MP.attach[MP.weapon], mode = at || (W().scope ? 'optic' : null);   // the mounted sight, or the sniper's own scope
    const want = MP.scope && mode && !MP.dead && !MP.reloadAt ? 1 : 0;
    MP.zoom += (want - MP.zoom) * Math.min(1, dt * (mode === 'sight' ? 18 : 14)); if (Math.abs(MP.zoom - want) < 0.01) MP.zoom = want;   // the red dot comes up quicker than the long scope
    const fovT = mode === 'sight' ? 50 : at === 'optic' ? 10 : 20;   // red dot ~1.5x, mounted optic ~7x, the sniper's own ~3.5x
    const fov = SET.fov - (SET.fov - fovT) * MP.zoom; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const scoped = MP.zoom > 0.6, dot = scoped && mode === 'sight';
    if (el('mpDot').hidden === dot) el('mpDot').hidden = !dot;   // the red dot of the collimator; the crosshair hides itself in crossTick
    if (el('mpScope').hidden === (scoped && !dot)) el('mpScope').hidden = !(scoped && !dot);
    if (scoped && !dot) scopeBdc(fov);
    gun.visible = !MP.dead && !nv && (mode === 'sight' || MP.zoom < 0.5); }   // the grenade in hand (and the throw) replaces the gun; the long zoom hides the arms, the red dot keeps them
  ownSteps(dt); tickNades(dt); nadeWarnTick(); tickItems(dt, now); spectate(now); nadeAimTick(now); nadeHandTick(nv);
  if (P.landH > 0) { const h = P.landH; P.landH = 0; if (h > FALL.safe && !MP.dead && MP.ws.readyState === 1) MP.ws.send(JSON.stringify({ t: 'fall', h: +h.toFixed(2) })); }   // a hard landing: the height goes to the server, which owns the damage
  if (MP.reloadAt && now - MP.reloadAt >= WEAPONS[MP.reloadW].reloadMs) {   // the local picture of the reload; the server's 'inv' message is the truth. It finishes on the weapon that started it, even if another is in hand now
    const rw = MP.reloadW; MP.reloadAt = 0; const k = Math.min(WEAPONS[rw].mag - MP.ammo[rw], MP.reserve[rw]);
    MP.ammo[rw] += k; MP.reserve[rw] -= k; updatePanel();
  }
  MP.burst = Math.max(0, MP.burst - dt * 0.03); crossTick(dt, now);
  { const pk = Math.exp(-dt * 8); punch.p *= pk; punch.y *= pk; punch.r *= pk; if (punch.p < 1e-4) punch.p = 0; if (Math.abs(punch.y) < 1e-4) punch.y = 0; if (Math.abs(punch.r) < 1e-4) punch.r = 0; }   // the aim punch springs back
  if ((MP.pingT = (MP.pingT || 0) - dt) <= 0 && MP.ws.readyState === 1) { MP.pingT = 2; MP.ws.send(JSON.stringify({ t: 'ping', c: now, rtt: MP.rtt })); }
  if (MP.firing && W().auto) fire(now);
  if (MP.dead) { const left = Math.max(0, 3 - (now - MP.deadAt) / 1000); el('mpRespawn').disabled = left > 0; el('mpRespawn').textContent = left > 0 ? 'Возрождение через ' + Math.ceil(left) : 'Возродиться (пробел)'; }
  else if ((MP.sendT -= dt) <= 0 && MP.ws.readyState === 1) { MP.sendT = 0.05; MP.ws.send(JSON.stringify({ t: 'state', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), h: +P.eye.toFixed(2), w: MP.weapon })); }
  for (const r of remotes.values()) {
    const g = r.group;
    if (r.fallT) {   // the killed fall by physics (ragdoll.js) and lie for three seconds
      const age = now - r.fallT; if (age > 3000) { r.fallT = 0; g.visible = false; g.rotation.order = 'XYZ'; g.rotation.set(0, 0, 0); r.buf.length = 0; continue; }
      if (r.av) { const c = r.corpse; g.visible = true; g.scale.y = 1; g.rotation.set(0, c.yaw, 0); g.position.set(c.x, c.y - (c.h || 1.7), c.z); r.av.update(dt, { speed: 0, air: false, dead: true, fall: c.fall, vel: c.vel }); continue; }
      const c = r.corpse, k = Math.min(1, age / 350); g.visible = true; g.scale.y = 1;   // the simple figure topples towards the blow, not always backwards
      g.position.set(c.x, c.y - (c.h || 1.7) + 0.18 * k, c.z);
      g.rotation.order = 'YXZ'; g.rotation.y = c.fall ? Math.atan2(c.fall.x, c.fall.z) : c.yaw + Math.PI; g.rotation.x = 1.5 * k * (2 - k); g.rotation.z = (c.fall ? c.fall.roll : 0) * k; continue;
    }
    const p = pose(r, t); if (!p) { g.visible = false; continue; }
    remoteSteps(r, p, now);
    const fk = flinchK(now, r.flinchT), side = fk ? (r.flinchDX || 0) * Math.cos(p.yaw) - (r.flinchDZ || 0) * Math.sin(p.yaw) : 0;   // the body jolts away from the bullet's path
    if (r.av) { if (r.gunW !== p.w) { r.gunW = p.w; r.av.setGun(p.w); } r.av.update(dt, { speed: r.speed || 0, air: !!r.air, dead: false, shotAt: r.shotAt || 0, throwAt: r.throwAt || 0, flinch: fk ? { k: fk, zone: r.flinchZone, side } : null }); }
    g.visible = true; g.position.set(p.x, p.y - p.h - 0.05 * fk * (r.flinchZone === 2 ? 1 : 0.3), p.z); g.scale.y = p.h / 1.7;
    g.rotation.y = p.yaw; g.rotation.x = 0.075 * fk * (r.flinchZone === 1 ? 1.35 : r.flinchZone === 2 ? 0.55 : 1); g.rotation.z = -side * 0.07 * fk;   // the flinch: the torso snaps back, a leg hit buckles the knees
    g.userData.head.rotation.x = p.pitch; g.userData.arm.rotation.x = p.pitch * 0.6;
    if (!r.av && r.figHead) r.figHead.rotation.x = p.pitch - 0.35 * fk;   // the simple figure's head snaps back too
    if (MP.dead && MP.specFP && r.id === MP.spec) g.visible = false;   // the first-person spectate: the watched body must not cover the eye
  }
  tickFx(dt);
  MP.kick = Math.max(0, MP.kick - dt * 9); gun.position.z = -0.45 + MP.kick * 0.05; gun.rotation.x = MP.kick * 0.06; gun.rotation.z = punch.r * 1.6;   // the gun tilts with the flinch of the view
  if (MP.reloadAt) gun.rotation.x = -0.5 * Math.sin(Math.min(1, (now - MP.reloadAt) / WEAPONS[MP.reloadW].reloadMs) * Math.PI);
  if (vm) {   // the arms with the weapon in hand: your speed over the ground chooses the clip of the steps; the reload follows its progress
    vmSpeed += (Math.hypot(P.x - vmX, P.z - vmZ) / Math.max(dt, 1e-3) - vmSpeed) * Math.min(1, dt * 8); vmX = P.x; vmZ = P.z; if (vmSpeed > 40) vmSpeed = 0;
    vm.update(dt, { show: gun.visible && vm.has(MP.weapon), nade: nv, speed: vmSpeed, reload: MP.reloadAt && MP.reloadW === MP.weapon ? (now - MP.reloadAt) / WEAPONS[MP.weapon].reloadMs : -1, yaw: P.yaw, pitch: P.pitch, kick: MP.kick, ads: MP.attach[MP.weapon] === 'sight' ? MP.zoom : 0 });
  }
  flashLit(dt);
  if (hitT && now - hitT > hitDur) { hitT = 0; el('mpHit').hidden = true; }
  if (hurtT) { const ha = now - hurtT; if (ha > 600) { hurtT = 0; el('mpHurt').hidden = true; } else el('mpHurt').style.opacity = (hurtAmp * (1 - ha / 600)).toFixed(3); }   // the red vignette flares, then fades
}
/* ---------- the BDC ladder of the long scope ----------
   The three lower marks are holdover hashes calibrated against the bullet's real fall (BULLET_G, the weapon's vel):
   half, three quarters and the full range of the weapon in hand. The holdover angle at L metres is drop(L)/L radians;
   the view maps the vertical fov onto the screen height, so the hash sits drop(L)/L · (h/2)/tan(fov/2) pixels below the
   centre. The end hashes carry their distance in metres (200 and 400 for the sniper); aim with the hash on the target.
   Recomputed only when the weapon, the zoom or the window changes. */
let bdcKey = '';
function scopeBdc(fov) {
  const w = MP.weapon, vel = WSRV[w].vel || 560, range = WSRV[w].range;
  const key = w + ':' + fov.toFixed(2) + ':' + window.innerHeight;
  if (key === bdcKey) return; bdcKey = key;
  const pxPerRad = (window.innerHeight / 2) / Math.tan(fov * Math.PI / 360);
  const marks = el('mpScope').querySelectorAll('s.b1, s.b2, s.b3');
  [0.5, 0.75, 1].forEach((k, i) => {
    const L = range * k, px = bulletDrop(L, vel) / L * pxPerRad;
    marks[i].style.top = 'calc(50% + ' + px.toFixed(1) + 'px)';
    marks[i].dataset.m = String(Math.round(L));
  });
}
const V = new THREE.Vector3(), BLAST_AT = new THREE.Vector3(), BLAST_COL = new THREE.Color();
// the light of the flashes: at the muzzle in your hands while your flash shines, else at the shot of someone near; a grenade's
// blast outshines both for a few tenths of a second (white, then the orange flicker of its fire) and reaches farther
function flashLit(dt) {
  const own = Math.max(fpFlash ? fpFlash.tick(dt) : 0, vm ? vm.glow : 0);
  near.t += dt; const other = near.pow * Math.max(0, 1 - near.t / 0.06) ** 2;
  const boom = blastGlow(BLAST_AT, BLAST_COL);
  if (boom > 4.5 * Math.max(own, other)) { flashLight.position.copy(BLAST_AT); flashLight.color.copy(BLAST_COL); flashLight.distance = 45; flashLight.intensity = boom; return; }
  flashLight.color.setHex(0xffb868); flashLight.distance = 22;
  gun.updateWorldMatrix(true, false);
  if (own >= other) { if (own > 0) { if (vm && vm.has(MP.weapon)) vm.muzzle(MV); else fpFlash.group.getWorldPosition(MV); const L = gun.worldToLocal(flashLight.position.copy(MV)); L.z -= 0.8; gun.localToWorld(L); } }   // a little ahead of the muzzle (along the gun): it lights the street and tints the hands, it does not burn them white
  else flashLight.position.set(near.x, near.y, near.z);
  flashLight.intensity = 4.5 * Math.max(own, other);
}
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
  if (MP.dead) { ownX = P.x; ownZ = P.z; wasUp = 0; return; }
  const moved = Math.hypot(P.x - ownX, P.z - ownZ); ownX = P.x; ownZ = P.z;
  if (P.up > 0.02) { wasUp = Math.max(wasUp, P.up); return; }
  if (wasUp > 0.05) { footstep(0.16 + Math.min(0.45, wasUp * 0.035), 0, onRoad(P.x, P.z, 1.5), true); wasUp = 0; }   // the thud grows with the height fallen
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
  r.sy = p.y; const run = moved / secs > 8; r.stride += moved; if (r.stride < (run ? 3 : 2.1)) return; r.stride = 0;   // the run threshold sits between the jog (6) and the sprint (11)
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

export { MP, initUi as prepareUi, enablePlay, loadModels, mpLabels, mpTick, warmSamples, aimPunch };
