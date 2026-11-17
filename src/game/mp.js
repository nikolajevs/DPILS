import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P, freeSpot } from './player.js';
import { PLACES } from '../ui/places.js';
import { buildingAt } from '../world/data.js';
import { terrainH } from '../world/terrain.js';
import { camera, canvas, scene } from '../render/renderer.js';
import { $ } from '../core/env.js';

/* ---------- online shooter: deathmatch on the city map ----------
   The server (server/index.mjs) owns health, kills and respawns. This module: the connection, the other players
   (simple procedural figures, drawn 120 ms in the past between two snapshots), the gun in hand, shooting with the
   line of fire checked against terrain and buildings, and the game panels. Keep RULES and rayToSegment in step with
   server/combat.mjs. */
const RULES = { mag: 30, reloadMs: 1800, gapMs: 100, range: 160, hitR: 0.5, headR: 0.28, bodyBottom: 1.6, bodyTop: 0.25 };
const MP = { on: false, ws: null, id: 0, name: '', hp: 100, dead: false, deadAt: 0, ammo: RULES.mag, reloadAt: 0, lastShot: 0, firing: false, kills: 0, deaths: 0, board: [], team: 0, teams: ['Красные', 'Синие'], score: [0, 0], win: 30, spawn: 0, kick: 0, sendT: 0 };
STATE.mp = false;
const remotes = new Map();   // id → { name, group, buf: [{ t, x, y, z, yaw, pitch }], tag }
const tracers = [];
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
const aim = () => { const cp = Math.cos(P.pitch); return [-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp]; };

/* ---------- figures of the other players ---------- */
const GEO = { box: new THREE.BoxGeometry(1, 1, 1), head: new THREE.SphereGeometry(0.17, 12, 8) };
const HUE = [0.0, 0.6];   // red and blue team
function makeFigure(team) {
  const hue = HUE[team] ?? 0.3, col = new THREE.Color().setHSL(hue, 0.65, 0.42), dark = new THREE.Color().setHSL(hue, 0.5, 0.2);
  const mc = new THREE.MeshLambertMaterial({ color: col }), md = new THREE.MeshLambertMaterial({ color: dark }), ms = new THREE.MeshLambertMaterial({ color: 0xe0b890 }), mg = new THREE.MeshLambertMaterial({ color: 0x25272b });
  const g = new THREE.Group(), part = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO.box, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o; };
  part(md, 0.2, 0.8, 0.22, -0.12, 0.4, 0); part(md, 0.2, 0.8, 0.22, 0.12, 0.4, 0);   // legs
  part(mc, 0.46, 0.6, 0.26, 0, 1.1, 0);   // torso
  part(mc, 0.13, 0.55, 0.13, -0.3, 1.12, 0); const arm = part(mc, 0.13, 0.13, 0.55, 0.28, 1.2, -0.25);   // arms: the right one holds the gun forward
  part(mg, 0.07, 0.1, 0.62, 0.28, 1.2, -0.45);   // the gun
  const head = new THREE.Mesh(GEO.head, ms); head.position.set(0, 1.58, 0); g.add(head);
  g.userData.head = head; g.userData.arm = arm; return g;
}
function addRemote(id, name, team) {
  if (remotes.has(id) || id === MP.id) return remotes.get(id);
  const group = makeFigure(team), tag = document.createElement('div'); tag.className = 'mp-tag t' + team; tag.textContent = name || '…'; group.visible = false; scene.add(group); $('mpTags').append(tag);
  const r = { name, team, group, buf: [], tag }; remotes.set(id, r); return r;
}
function dropRemote(id) { const r = remotes.get(id); if (!r) return; scene.remove(r.group); r.tag.remove(); remotes.delete(id); }
function nameOf(id) { const b = MP.board.find(e => e.id === id); return b ? b.name : '?'; }
function teamOf(id) { const b = MP.board.find(e => e.id === id); return b ? b.team : 0; }
function pose(r, t) {
  const b = r.buf; if (!b.length) return null;
  while (b.length > 2 && b[1].t <= t) b.shift();
  const a = b[0], c = b[1] || a, k = c.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (c.t - a.t))) : 1, l = (u, v) => u + (v - u) * k;
  let dy = c.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return { x: l(a.x, c.x), y: l(a.y, c.y), z: l(a.z, c.z), yaw: a.yaw + dy * k, pitch: l(a.pitch, c.pitch) };
}

/* ---------- the gun in hand, tracers, sounds ---------- */
const gun = new THREE.Group();
(function () {
  const m1 = new THREE.MeshLambertMaterial({ color: 0x2a2d31 }), m2 = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
  const add = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO.box, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); gun.add(o); };
  add(m1, 0.06, 0.09, 0.52, 0, 0, 0); add(m1, 0.03, 0.03, 0.18, 0, 0.0, -0.33); add(m2, 0.055, 0.16, 0.1, 0, -0.11, 0.14); add(m1, 0.045, 0.13, 0.07, 0, -0.1, -0.06);
  gun.position.set(0.17, -0.19, -0.5); gun.scale.setScalar(0.8); gun.visible = false; camera.add(gun); scene.add(camera);
})();
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a })); flash.position.set(0, 0, -0.45); flash.visible = false; gun.add(flash);
let actx = null;
function bang(vol, low) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    const n = Math.floor(actx.sampleRate * 0.12), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, low ? 3 : 5);
    const s = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low ? 900 : 2400; g.gain.value = vol;
    s.buffer = buf; s.connect(f); f.connect(g); g.connect(actx.destination); s.start();
  } catch (e) {}
}
function tracer(o, d, len, color) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o[0] + d[0] * 1.2, o[1] - 0.1 + d[1] * 1.2, o[2] + d[2] * 1.2), new THREE.Vector3(o[0] + d[0] * len, o[1] + d[1] * len, o[2] + d[2] * len)]);
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false }), l = new THREE.Line(g, m); l.frustumCulled = false; scene.add(l); tracers.push({ l, t: 0 });
}

/* ---------- shooting ---------- */
function fire(now) {
  if (MP.dead || !STATE.locked || now - MP.lastShot < RULES.gapMs) return;
  if (MP.reloadAt) return;
  if (MP.ammo <= 0) { reload(now); return; }
  MP.lastShot = now; MP.ammo--; MP.kick = 1; P.pitch = Math.min(1.5, P.pitch + 0.0035);
  const o = [P.x, P.y, P.z], d = aim(), clear = freePath(o, d, RULES.range), t = performance.now() - 120;
  let best = null;
  for (const [id, r] of remotes) {
    if (r.team === MP.team) continue;   // no friendly fire: shots pass through teammates
    const p = pose(r, t); if (!p || !r.group.visible) continue;
    const a = [p.x, p.y - RULES.bodyBottom, p.z], b = [p.x, p.y + RULES.bodyTop, p.z], h = rayToSegment(o, d, clear, a, b);
    if (h.dist <= RULES.hitR && (!best || h.t < best.t)) best = { id, t: h.t };
  }
  const len = best ? best.t : clear;
  tracer(o, d, len, 0xffe9a0); bang(0.35, true);
  MP.ws.send(JSON.stringify({ t: 'shoot', dx: d[0], dy: d[1], dz: d[2], len, hit: best ? best.id : 0 }));
  if (MP.ammo <= 0) reload(now);
  updatePanel();
}
function reload(now) { if (MP.reloadAt || MP.ammo >= RULES.mag || MP.dead) return; MP.reloadAt = now; updatePanel(); }

/* ---------- panels ---------- */
const el = id => $(id);
let hitT = 0, hurtT = 0;
function updatePanel() {
  el('mpHp').style.width = Math.max(0, MP.hp) + '%'; el('mpHpN').textContent = Math.max(0, Math.ceil(MP.hp));
  el('mpAmmo').textContent = MP.reloadAt ? 'перезарядка…' : MP.ammo + ' / ' + RULES.mag;
  el('mpScore').textContent = MP.kills + ' · ' + MP.deaths;
  const tm = el('mpTeams'); tm.textContent = ''; const chip = (i, t) => { const e = document.createElement('b'); e.className = 't' + i; e.textContent = t; return e; };
  const lim = document.createElement('small'); lim.textContent = ' до ' + MP.win; tm.append(chip(0, MP.teams[0] + ' ' + MP.score[0]), ' : ', chip(1, MP.score[1] + ' ' + MP.teams[1]), lim);
}
function drawBoard() {
  const rows = [...MP.board].sort((a, b) => a.team - b.team || b.kills - a.kills || a.deaths - b.deaths), ol = el('mpBoardList'); ol.textContent = '';
  for (const e of rows) { const li = document.createElement('li'); li.className = 't' + e.team + (e.id === MP.id ? ' me' : ''); const n = document.createElement('span'), k = document.createElement('b'), dd = document.createElement('i'); n.textContent = e.name; k.textContent = e.kills; dd.textContent = e.deaths; li.append(n, k, dd); ol.append(li); }
}
function feed(text, cls) {
  const f = el('mpFeed'), d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; f.prepend(d); while (f.children.length > 6) f.lastChild.remove(); setTimeout(() => d.remove(), 7000);
}
function die(byName) {
  MP.dead = true; MP.deadAt = performance.now(); MP.firing = false; gun.visible = false;
  if (document.pointerLockElement) document.exitPointerLock();
  el('mpDead').hidden = false; el('mpDeadBy').textContent = byName ? 'Вас убил ' + byName : 'Вы погибли';
}
function spawnPoint() {
  const i = MP.spawn >= 0 ? MP.spawn : Math.floor(Math.random() * PLACES.length), pl = PLACES[i], a = Math.random() * 6.283, r = 3 + Math.random() * 20;
  return { x: pl[2] + Math.cos(a) * r, z: pl[3] + Math.sin(a) * r, yaw: pl[4] || 0 };
}
function respawn() { if (!MP.dead || performance.now() - MP.deadAt < 3000) return; MP.ws.send(JSON.stringify({ t: 'respawn', ...spawnPoint() })); }

/* ---------- messages from the server ---------- */
function onMsg(m) {
  switch (m.t) {
    case 'hello': MP.id = m.id; MP.name = m.name; MP.team = m.team; MP.teams = m.teams; MP.win = m.win; MP.score = m.score; MP.board = m.board; for (const e of m.board) addRemote(e.id, e.name, e.team); document.body.dataset.team = m.team; break;
    case 'spawn': {
      const [x, z] = freeSpot(m.x, m.z); P.x = x; P.z = z; P.y = 1.7 + terrainH(x, z); P.yaw = m.yaw; P.pitch = 0; STATE.mapTimer = 0; STATE.lodTimer = 0;
      if (!MP.started) { MP.started = true; showGame(); }
      MP.hp = m.hp; MP.ammo = RULES.mag; MP.reloadAt = 0; MP.dead = false; gun.visible = true; el('mpDead').hidden = true; updatePanel();
      MP.ws.send(JSON.stringify({ t: 'state', x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch }));   // the server has the point as asked: tell it where the player really stands
      if (canvas.requestPointerLock) { canvas.focus(); try { const pr = canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {} }
      break;
    }
    case 'correct': P.x = m.x; P.z = m.z; break;
    case 'snap': {
      const t = performance.now(), seen = new Set();
      for (const [id, x, y, z, yaw, pitch] of m.p) { if (id === MP.id) continue; seen.add(id); const r = remotes.get(id) || addRemote(id, nameOf(id), teamOf(id)); r.buf.push({ t, x, y, z, yaw, pitch }); if (r.buf.length > 12) r.buf.shift(); }
      for (const [id, r] of remotes) if (!seen.has(id)) { r.group.visible = false; r.buf.length = 0; }
      break;
    }
    case 'shot': { if (m.id === MP.id) break; tracer(m.o, m.d, m.len, 0xffb060); const dd = Math.hypot(m.o[0] - P.x, m.o[2] - P.z); if (dd < 220) bang(0.3 * (1 - dd / 220), true); break; }
    case 'hit': hitT = performance.now(); el('mpHit').className = m.head ? 'head' : m.kill ? 'kill' : ''; el('mpHit').hidden = false; break;
    case 'hurt': {
      MP.hp = m.hp; hurtT = performance.now(); el('mpHurt').hidden = false; updatePanel();
      const a = Math.atan2(-m.dx, -m.dz) - P.yaw; el('mpHurtDir').style.transform = 'rotate(' + (-a) + 'rad)';   // the side the shot came from
      if (m.hp <= 0) die(nameOf(m.by));
      break;
    }
    case 'kill': { feed(m.kn + '  ➜  ' + m.vn + (m.head ? '  (в голову)' : ''), m.killer === MP.id ? 'mine' : m.victim === MP.id ? 'dead' : ''); if (m.killer === MP.id) { MP.kills++; } if (m.victim === MP.id) { MP.deaths++; if (!MP.dead) die(m.kn); } updatePanel(); break; }
    case 'alive': { const r = remotes.get(m.id); if (r) r.buf.length = 0; break; }
    case 'board': MP.board = m.board; MP.score = m.score; for (const e of m.board) { const r = addRemote(e.id, e.name, e.team); if (r) { r.name = e.name; r.tag.textContent = e.name; } if (e.id === MP.id) { MP.kills = e.kills; MP.deaths = e.deaths; } } for (const id of [...remotes.keys()]) if (!m.board.some(e => e.id === id)) dropRemote(id); drawBoard(); updatePanel(); break;
    case 'left': dropRemote(m.id); break;
    case 'win': { const mine = m.team === MP.team; el('mpBanner').hidden = false; el('mpBanner').className = 'mp-banner t' + (m.team === 1 ? 1 : 0); el('mpBanner').textContent = (mine ? 'Победа! ' : 'Поражение. ') + 'Выиграли ' + m.name.toLowerCase() + ', ' + m.score[0] + ' : ' + m.score[1]; setTimeout(() => { el('mpBanner').hidden = true; }, 9000); break; }
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
  STATE.mp = true; MP.on = true; STATE.started = true; P.fly = false; document.body.classList.add('mp');
  $('start').hidden = true; $('hud').hidden = false; el('mpHud').hidden = false; $('cross').hidden = false; STATE.lodTimer = 0;
  $('bFly').setAttribute('aria-pressed', false); if ($('places').hidden === false) $('places').hidden = true;
}
function join() {
  const name = el('mpName').value.trim(), url = serverUrl(), msg = el('mpMsg');
  if (!url) { msg.textContent = 'Укажите адрес сервера (поле «Сервер»).'; return; }
  try { localStorage.setItem('dpils.mp', JSON.stringify({ name, server: el('mpServer').value.trim(), spawn: el('mpSpawn').value, team: el('mpTeam').value })); } catch (e) {}
  MP.spawn = +el('mpSpawn').value; MP.wantTeam = +el('mpTeam').value; msg.textContent = 'Подключаюсь…'; el('goPlay').disabled = true;
  let ws; try { ws = new WebSocket(url); } catch (e) { msg.textContent = 'Неверный адрес сервера.'; el('goPlay').disabled = false; return; }
  MP.ws = ws; MP.started = false;
  ws.onopen = () => { const s = spawnPoint(); ws.send(JSON.stringify({ t: 'join', name, team: MP.wantTeam, ...s })); };
  ws.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onerror = () => { if (!MP.started) msg.textContent = 'Не удалось подключиться к ' + url; };
  ws.onclose = () => { if (MP.started) { el('mpDead').hidden = true; el('mpOver').hidden = false; if (document.pointerLockElement) document.exitPointerLock(); } else { el('goPlay').disabled = false; if (!msg.textContent.startsWith('На сервере') && !msg.textContent.startsWith('Не удалось')) msg.textContent = 'Соединение закрыто.'; } };
}
function initUi() {
  const sel = el('mpSpawn'); sel.textContent = '';
  PLACES.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p[0]; sel.append(o); });
  const r = document.createElement('option'); r.value = -1; r.textContent = 'Случайное место'; sel.append(r);
  try { const s = JSON.parse(localStorage.getItem('dpils.mp') || '{}'); if (s.name) el('mpName').value = s.name; if (s.server) el('mpServer').value = s.server; if (s.spawn != null) sel.value = s.spawn; if (s.team != null) el('mpTeam').value = s.team; } catch (e) {}
  el('mpName').placeholder = 'Игрок' + (100 + Math.floor(Math.random() * 900));
  if (!el('mpName').value) el('mpName').value = el('mpName').placeholder;
  el('goPlay').onclick = join; el('mpRespawn').onclick = respawn; el('mpLeave').onclick = () => location.reload(); el('mpOverBtn').onclick = () => location.reload();
  el('bLeave').onclick = () => location.reload();
}

/* ---------- input ---------- */
canvas.addEventListener('mousedown', e => { if (!MP.on || e.button !== 0) return; MP.firing = true; if (!STATE.locked && !MP.dead) return; fire(performance.now()); });
window.addEventListener('mouseup', e => { if (e.button === 0) MP.firing = false; });
window.addEventListener('keydown', e => {
  if (!MP.on || e.repeat) return;
  if (e.code === 'KeyR') reload(performance.now());
  else if (e.code === 'Tab') { e.preventDefault(); el('mpBoard').hidden = false; drawBoard(); }
  else if ((e.code === 'Space' || e.code === 'Enter') && MP.dead) { e.preventDefault(); respawn(); }
});
window.addEventListener('keyup', e => { if (e.code === 'Tab') el('mpBoard').hidden = true; });
el('mpDead').addEventListener('click', respawn);

/* ---------- every frame ---------- */
function mpTick(dt) {
  if (!MP.on) return;
  const now = performance.now(), t = now - 120;
  if (MP.reloadAt && now - MP.reloadAt >= RULES.reloadMs) { MP.reloadAt = 0; MP.ammo = RULES.mag; updatePanel(); }
  if (MP.firing) fire(now);
  if (MP.dead) { const left = Math.max(0, 3 - (now - MP.deadAt) / 1000); el('mpRespawn').disabled = left > 0; el('mpRespawn').textContent = left > 0 ? 'Возрождение через ' + Math.ceil(left) : 'Возродиться (пробел)'; }
  else if ((MP.sendT -= dt) <= 0 && MP.ws.readyState === 1) { MP.sendT = 0.05; MP.ws.send(JSON.stringify({ t: 'state', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3) })); }
  for (const r of remotes.values()) {
    const p = pose(r, t), g = r.group; if (!p) { g.visible = false; continue; }
    g.visible = true; g.position.set(p.x, p.y - 1.7, p.z); g.rotation.y = p.yaw; g.userData.head.rotation.x = p.pitch; g.userData.arm.rotation.x = p.pitch * 0.6;
  }
  for (let i = tracers.length - 1; i >= 0; i--) { const tr = tracers[i]; tr.t += dt; tr.l.material.opacity = Math.max(0, 0.9 - tr.t * 9); if (tr.t > 0.1) { scene.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); tracers.splice(i, 1); } }
  MP.kick = Math.max(0, MP.kick - dt * 9); gun.position.z = -0.45 + MP.kick * 0.05; gun.rotation.x = MP.kick * 0.06; flash.visible = MP.kick > 0.6;
  if (MP.reloadAt) gun.rotation.x = -0.5 * Math.sin(Math.min(1, (now - MP.reloadAt) / RULES.reloadMs) * Math.PI);
  if (hitT && now - hitT > 140) { hitT = 0; el('mpHit').hidden = true; }
  if (hurtT && now - hurtT > 600) { hurtT = 0; el('mpHurt').hidden = true; }
}
const V = new THREE.Vector3();
function mpLabels() {
  if (!MP.on) return;
  const w = window.innerWidth, h = window.innerHeight;
  for (const r of remotes.values()) {
    const g = r.group; if (!g.visible) { r.tag.hidden = true; continue; }
    V.set(g.position.x, g.position.y + 2.0, g.position.z).project(camera);
    const d = Math.hypot(g.position.x - P.x, g.position.z - P.z);
    if (V.z > 1 || d > 90 || MP.dead) { r.tag.hidden = true; continue; }
    r.tag.hidden = false; r.tag.style.transform = 'translate(-50%,-100%) translate(' + ((V.x + 1) / 2 * w).toFixed(0) + 'px,' + ((1 - V.y) / 2 * h).toFixed(0) + 'px)';
  }
}
function enablePlay() { initUi(); el('goPlay').disabled = false; }

export { MP, enablePlay, mpLabels, mpTick };
