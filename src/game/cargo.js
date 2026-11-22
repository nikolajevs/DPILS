/* The cargo event on the page (server/game.mjs owns the rules, CARGO in server/combat.mjs): a supply crate
   parachutes into an open spot, a red-orange smoke beacon and a light pillar mark the landing, whoever takes the
   loot is marked for everyone for a minute. This module draws the crate itself — the descent along the server's
   timeline, the parachute collapsing onto the crate at the landing, the beacon pillar and the pickup ring — plus
   the event banner, the screen-edge pointer to the crate and the «you are marked» countdown. The marks over the
   players and the minimap icons are drawn by mp.js (it owns the remote bodies and the map overlay). */
import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P } from './player.js';
import { camera, scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { addMover } from '../render/lamp-shadows.js';
import { $ } from '../core/env.js';
import { prop, onProps } from './props.js';

let cur = null;   // { id, x, z, gy, y0, t0, landAt, speed, state, group, chute, beam, ring, collapse, fade, flash }
let srvOff = 0;   // server clock − performance.now(): 'snap' and 'hello' carry the server's now
const serverNow = () => performance.now() + srvOff;
export function cargoClock(now) { srvOff = now - performance.now(); }

const banner = $('cargoBanner'), bTitle = $('cargoTitle'), bSub = $('cargoSub');
const point = $('cargoPoint'), pointD = $('cargoPointD'), pointArr = $('cargoPointArr');
const self = $('cargoSelf'), selfT = $('cargoSelfT');
const label = document.createElement('div'); label.className = 'cargo-label'; label.hidden = true; $('mpTags').append(label);
let selfUntil = 0, flashUntil = 0;

/* the crate with its parachute: the ready model (models/cargo.glb, nodes 'crate' and 'chute') or a box stand-in */
function makeBody() {
  const g = new THREE.Group();
  const m = prop('cargo');
  if (m) { g.add(m); g.userData.chute = m.getObjectByName('chute'); return g; }
  g.userData.fallback = true;
  const box = (c, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), worldSpace(new THREE.MeshLambertMaterial({ color: c }))); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); return o; };
  box(0x6b4a2a, 1.3, 0.16, 1.3, 0, 0.08, 0);   // the pallet
  box(0x4a5d23, 1.2, 1.1, 1.2, 0, 0.72, 0);   // the crate
  box(0x3a4a1a, 1.24, 0.08, 1.24, 0, 1.3, 0);
  const chute = new THREE.Group(); chute.name = 'chute';
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.35, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), worldSpace(new THREE.MeshLambertMaterial({ color: 0xe8e4da, side: THREE.DoubleSide })));
  canopy.scale.set(1, 0.42, 0.62); canopy.position.y = 2.55; chute.add(canopy);
  for (const [lx, lz] of [[-0.5, -0.35], [0.5, -0.35], [-0.5, 0.35], [0.5, 0.35]]) {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 4), worldSpace(new THREE.MeshBasicMaterial({ color: 0x9a968c })));
    line.position.set(lx * 0.7, 1.95, lz * 0.7); line.rotation.z = lx * 0.32; line.rotation.x = -lz * 0.32; chute.add(line);
  }
  g.add(chute); g.userData.chute = chute;
  return g;
}
// the beacon pillar and the pickup ring appear when the crate lands
function makeBeacon() {
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.8, 70, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = 35; beam.userData.noProbe = true; beam.renderOrder = 5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.6, 32), new THREE.MeshBasicMaterial({ color: 0xffb02a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.userData.noProbe = true;
  return { beam, ring };
}
function clearCargo() {
  if (cur) { scene.remove(cur.group); cur.group.traverse(o => { if (o.isMesh && !o.userData.shared && o.material && !o.material.userData?.shared) o.material.dispose?.(); }); cur = null; }
  banner.hidden = true; point.hidden = true; label.hidden = true; self.hidden = true; selfUntil = 0; flashUntil = 0;
}
export function cargoDrop(m) {
  clearCargo();
  const group = makeBody(); group.userData.noProbe = true;
  const { beam, ring } = makeBeacon(); group.add(beam); group.add(ring);
  group.position.set(m.x, m.y0, m.z); scene.add(group); addMover(group, 1.6);
  cur = { id: m.id, x: m.x, z: m.z, gy: m.gy, y0: m.y0, t0: m.t0, landAt: m.landAt, speed: m.speed, state: 'fall', group, chute: group.userData.chute, beam, ring, collapse: -1, fade: 1, flash: 0 };
  banner.hidden = false; bTitle.textContent = 'Груз сброшен с парашютом'; bSub.textContent = 'Ищите дым-маяк';
  onProps(() => {   // the model came after the drop: replace the box stand-in, keep the place and the beacon
    if (!cur || cur.id !== m.id || !cur.group.userData.fallback) return;
    const fresh = prop('cargo'); if (!fresh) return;
    const g = cur.group;
    for (const o of [...g.children]) if (o !== cur.beam && o !== cur.ring) g.remove(o);
    g.add(fresh); cur.chute = fresh.getObjectByName('chute'); g.userData.chute = cur.chute; delete g.userData.fallback;
  });
}
export function cargoLand(m) {
  if (!cur || cur.id !== m.id) return;
  cur.state = 'landed'; cur.collapse = 0; cur.flash = 1;
  bTitle.textContent = 'Груз приземлился'; bSub.textContent = 'Дым-маяк виден издалека — заберите груз';
}
export function cargoTook(m, mine) {
  if (cur && cur.id === m.id) { cur.state = 'gone'; cur.fade = 0; }
  banner.hidden = false; flashUntil = performance.now() + 6000;
  bTitle.textContent = mine ? 'Вы забрали груз!' : 'Груз забрал ' + (m.name || 'игрок');
  bSub.textContent = mine ? 'Вы помечены для всех на 60 секунд — уносите ноги' : 'Носитель помечен для всех на 60 секунд';
  banner.classList.toggle('mine', !!mine);
}
export function cargoEnd(m) {
  if (cur && cur.id === m.id) { cur.state = 'gone'; cur.fade = 0; }
  banner.hidden = false; flashUntil = performance.now() + 4000; banner.classList.remove('mine');
  bTitle.textContent = 'Груз исчез'; bSub.textContent = 'Никто не забрал';
}
export function cargoSelf(until) {
  selfUntil = until || 0;
  if (!until) self.hidden = true;
}
const V = new THREE.Vector3();
export function cargoTick(dt) {
  const now = performance.now();
  // the «you are marked» countdown: the server's minute, shown while alive
  if (selfUntil) {
    const left = Math.max(0, Math.ceil((selfUntil - serverNow()) / 1000));
    if (!left || STATE.mpDead) { selfUntil = 0; self.hidden = true; }
    else { self.hidden = false; const t = left + ' с'; if (selfT.textContent !== t) selfT.textContent = t; self.classList.toggle('low', left <= 10); }
  }
  if (flashUntil && now > flashUntil) { flashUntil = 0; banner.hidden = true; }
  if (!cur) { if (!label.hidden) label.hidden = true; if (!point.hidden) point.hidden = true; return; }
  const c = cur, t = serverNow();
  const d = Math.hypot(c.x - P.x, c.z - P.z);
  const near = Math.max(0, Math.min(1, (d - 12) / 30));   // the pillar blinds whoever stands at the crate: it fades out close by
  // the descent along the server's timeline; the sway of a load under a canopy
  if (c.state === 'fall') {
    const y = Math.max(c.gy, c.y0 - c.speed * (t - c.t0) / 1000);
    c.group.position.set(c.x, y, c.z);
    c.group.rotation.z = Math.sin(t * 0.0007) * 0.055; c.group.rotation.x = Math.cos(t * 0.0005) * 0.045;
    c.group.rotation.y = Math.sin(t * 0.0003) * 0.12;
    if (c.chute) { const b = 1 + Math.sin(t * 0.002) * 0.015; c.chute.scale.set(b, 1, b); }
  } else if (c.state === 'landed') {
    c.group.position.set(c.x, c.gy, c.z); c.group.rotation.set(0, c.group.rotation.y, 0);
    if (c.collapse >= 0 && c.collapse < 1) {   // the parachute folds onto the crate over a second
      c.collapse = Math.min(1, c.collapse + dt / 0.9);
      const k = c.collapse * c.collapse * (3 - 2 * c.collapse);
      if (c.chute) { c.chute.scale.set(1 - 0.38 * k, 1 - 0.93 * k, 1 - 0.38 * k); c.chute.position.y = 1.3 * k; }
    }
    const pulse = 0.24 + 0.09 * Math.sin(t * 0.004);
    c.beam.material.opacity = Math.min(1, c.beam.material.opacity + dt * 0.8) * pulse / 0.2 * near;
    c.ring.material.opacity = 0.4 + 0.15 * Math.sin(t * 0.005);
    const rs = 1 + 0.04 * Math.sin(t * 0.005); c.ring.scale.set(rs, rs, 1);
    if (c.flash > 0) { c.flash = Math.max(0, c.flash - dt * 1.6); c.ring.scale.setScalar(1 + (1 - c.flash) * 1.6); c.ring.material.opacity = c.flash * 0.8; }
  } else {   // taken or expired: the crate shrinks away
    c.fade = Math.max(0, c.fade - dt * 2.2);
    c.group.scale.setScalar(Math.max(0.001, c.fade));
    c.beam.material.opacity *= c.fade; c.ring.material.opacity *= c.fade;
    if (c.fade <= 0) { scene.remove(c.group); cur = null; label.hidden = true; point.hidden = true; return; }
  }
  // the banner's live line: the state and the distance
  if (!flashUntil) {
    const sub = c.state === 'fall' ? 'Снижается · ' + Math.max(1, Math.round(d)) + ' м' : c.state === 'landed' ? (d < 30 ? 'Подойдите, чтобы забрать · ' + Math.max(1, Math.round(d)) + ' м' : 'Дымит · ' + Math.max(1, Math.round(d)) + ' м') : '';
    if (bSub.textContent !== sub) bSub.textContent = sub;
  }
  // the world label over the crate
  V.set(c.x, c.group.position.y + 3.4, c.z).project(camera);
  const w = window.innerWidth, h = window.innerHeight;
  if (V.z < 1 && Math.abs(V.x) < 1.1 && Math.abs(V.y) < 1.1 && d < 500 && !STATE.mpDead) {
    label.hidden = false;
    const txt = 'ГРУЗ · ' + Math.max(1, Math.round(d)) + ' м'; if (label.textContent !== txt) label.textContent = txt;
    label.style.transform = 'translate(-50%,-100%) translate(' + ((V.x + 1) / 2 * w).toFixed(0) + 'px,' + ((1 - V.y) / 2 * h).toFixed(0) + 'px)';
  } else label.hidden = true;
  // the screen-edge pointer when the crate is off screen (or behind): an arrow with the distance
  if (c.state !== 'gone' && !STATE.mpDead) {
    V.set(c.x, c.group.position.y + 1.5, c.z).project(camera);   // the crate itself, in the air or on the ground
    const behind = V.z > 1;
    let sx = (V.x + 1) / 2 * w, sy = (1 - V.y) / 2 * h;
    if (behind) { sx = w - sx; sy = h - sy; }
    const on = !behind && Math.abs(V.x) < 0.95 && Math.abs(V.y) < 0.95;
    if (on) point.hidden = true;
    else {
      const dx = sx - w / 2, dy = sy - h / 2, m = 46;
      const k = Math.min((w / 2 - m) / Math.max(1e-6, Math.abs(dx)), (h / 2 - m) / Math.max(1e-6, Math.abs(dy)));
      const px = w / 2 + dx * k, py = h / 2 + dy * k;
      point.hidden = false;
      point.style.transform = 'translate(-50%,-50%) translate(' + px.toFixed(0) + 'px,' + py.toFixed(0) + 'px)';
      pointArr.style.transform = 'rotate(' + Math.atan2(dy, dx).toFixed(3) + 'rad)';
      const txt = Math.max(1, Math.round(d)) + ' м'; if (pointD.textContent !== txt) pointD.textContent = txt;
    }
  } else point.hidden = true;
}
/* the crate on the minimap (mp.js draws it into STATE.mapOverlay): a gold box under a canopy arc, a pulsing ring */
export function cargoMap(ctx, cx, cz, ppm, w, h) {
  if (!cur || cur.state === 'gone') return;
  const x = w / 2 + (cur.x - cx) * ppm, y = h / 2 + (cur.z - cz) * ppm;
  if (x < 6 || y < 6 || x > w - 6 || y > h - 6) return;
  const t = performance.now() * 0.003, r = 8 + 3 * Math.sin(t);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.strokeStyle = 'rgba(255, 176, 42, .8)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#ffb02a'; ctx.fillRect(x - 4, y - 2, 8, 7);
  ctx.beginPath(); ctx.arc(x, y - 3, 6, Math.PI, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 5, y - 3); ctx.lineTo(x - 3, y + 1); ctx.moveTo(x + 5, y - 3); ctx.lineTo(x + 3, y + 1); ctx.stroke();
  ctx.restore();
}
export { clearCargo };
