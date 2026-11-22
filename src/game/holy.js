/* The «Царь горы» event on the page (server/game.mjs owns the rules, HOLY in server/combat.mjs): the four temples of
   Church Hill become capture points for a few minutes. This module draws the four bell-tower beacons — a light column,
   a capture ring that fills as a side stands in it, a swinging bronze bell — plus the event HUD (the four chips, the
   hold countdown, the buffs you hold), the world labels, the bell flashes on the minimap and the golden flash of the
   grand prize. The bells themselves are synthesised (sfx.js bellSound) and wired by mp.js through holyAudio; the arena
   ring and the player dots stay with mp.js. The rules, the capture and the prize are the server's — this is the picture. */
import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P } from './player.js';
import { camera, scene } from '../render/renderer.js';
import { $, reduceMotion } from '../core/env.js';
import { HOLY } from '../../server/combat.mjs';

const S = { on: false, id: 0, points: [], hold: null, left: 0, recvAt: 0, capR: HOLY.capR, capMs: HOLY.capMs, holdMs: HOLY.holdMs, buffs: { ...HOLY.buffs }, buffName: { ...HOLY.buffName }, flashes: [] };   // buffs and their labels come with the 'holy' message: the admin panel can tune them live (server/events.mjs)
let ME = { unit: 't0', ffa: false };
export function holyMe(unit, ffa) { ME = { unit, ffa }; }
export const holyAudio = { bell: null };   // mp.js wires it to the game's one audio context (bellSound)
const NEUTRAL = new THREE.Color('#ffd27a'), RED = new THREE.Color('#d8392f'), BLUE = new THREE.Color('#2f78d8'), GOLD = new THREE.Color('#e8a317'), RUST = new THREE.Color('#b8452f');
function ownerColor(owner, team) {
  if (!owner) return NEUTRAL;
  if (!ME.ffa) return team === 1 ? BLUE : RED;
  return owner === ME.unit ? GOLD : RUST;
}
const myBuffs = () => { const b = {}; if (S.on) for (const pt of S.points) if (pt.owner === ME.unit) b[HOLY.temples[pt.i].buff] = true; return b; };
export function holySpeedMul() { return myBuffs().speed ? S.buffs.speed : 1; }

/* ---------- the 3D markers ---------- */
const BEAM_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const BEAM_FS = [
  'uniform vec3 uColor; uniform float uTime; uniform float uOpacity; varying vec2 vUv;',
  'void main(){',
  '  float fall = pow(1.0 - vUv.y, 1.25);',
  '  float shimmer = 0.78 + 0.22 * sin(uTime * 2.2 + vUv.y * 9.0);',
  '  gl_FragColor = vec4(uColor, uOpacity * fall * shimmer);',
  '}',
].join('\n');
const RING_FS = [
  'uniform vec3 uColor; uniform float uProg; uniform float uTime; uniform float uContest; uniform float uOwner; uniform float uCapR; varying vec2 vUv;',
  'void main(){',
  '  vec2 p = (vUv - 0.5) * 2.0; float r = length(p) * (uCapR + 1.0);',
  '  float ring = smoothstep(0.55, 0.0, abs(r - uCapR) - 0.32);',
  '  float a01 = fract(atan(p.y, p.x) / 6.28318 + 0.25);',
  '  float arc = smoothstep(0.5, 0.0, abs(r - (uCapR - 1.35)) - 0.3) * step(a01, uProg);',
  '  float pulse = 0.62 + 0.38 * sin(uTime * 3.0);',
  '  float alpha = ring * (uOwner > 0.5 ? 0.72 : 0.42) * pulse + arc * 0.9;',
  '  alpha *= uContest > 0.5 ? (0.55 + 0.45 * sin(uTime * 13.0)) : 1.0;',
  '  if (alpha < 0.01) discard;',
  '  gl_FragColor = vec4(uColor, alpha);',
  '}',
].join('\n');
function makeBell() {
  const prof = [[0.02, 0], [0.56, 0], [0.62, 0.08], [0.52, 0.42], [0.36, 0.82], [0.3, 1.04], [0.13, 1.2], [0.02, 1.28]].map(([x, y]) => new THREE.Vector2(x * 2.0, y * 2.0));
  const geo = new THREE.LatheGeometry(prof, 16);
  const mat = new THREE.MeshLambertMaterial({ color: 0xc9a227, emissive: 0x000000 });
  const bell = new THREE.Mesh(geo, mat); bell.position.y = 7.4; bell.userData.noProbe = true;
  return bell;
}
function buildPoint(pt) {
  const g = new THREE.Group(); g.position.set(pt.x, pt.gy, pt.z); g.userData.noProbe = true;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 2.8, 110, 16, 1, true), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: NEUTRAL.clone() }, uTime: { value: 0 }, uOpacity: { value: 0.34 } },
    vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  beam.position.y = 55; beam.renderOrder = 20; beam.frustumCulled = false; beam.userData.noProbe = true; g.add(beam);
  const ring = new THREE.Mesh(new THREE.PlaneGeometry((S.capR + 1) * 2, (S.capR + 1) * 2), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: NEUTRAL.clone() }, uProg: { value: 0 }, uTime: { value: 0 }, uContest: { value: 0 }, uOwner: { value: 0 }, uCapR: { value: S.capR } },
    vertexShader: BEAM_VS, fragmentShader: RING_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.22; ring.renderOrder = 3; ring.userData.noProbe = true; g.add(ring);
  const bell = makeBell(); g.add(bell);
  scene.add(g);
  const label = document.createElement('div'); label.className = 'holy-label'; label.hidden = true; $('mpTags').append(label);
  return { group: g, beam, ring, bell, label, col: NEUTRAL.clone(), dispProg: 0, swing: 0, flash: 0 };
}
function build() {
  for (const pt of S.points) if (!pt.vis) pt.vis = buildPoint(pt);
}
function clearHoly() {
  for (const pt of S.points) if (pt.vis) {
    scene.remove(pt.vis.group);
    pt.vis.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    pt.vis.label.remove(); pt.vis = null;
  }
  S.on = false; S.points = []; S.hold = null; S.flashes = [];
  $('holyHud').hidden = true; $('holyFlash').hidden = true;
  document.body.classList.remove('holy');
}

/* ---------- the state from the server ---------- */
export function setHoly(m) {
  if (!m) return;
  const first = !S.on;
  S.on = true; S.id = m.id; S.left = m.left; S.recvAt = performance.now(); S.capR = m.capR; S.capMs = m.capMs; S.holdMs = m.holdMs; S.hold = m.hold;
  if (m.buffs) S.buffs = m.buffs;
  if (m.buffName) S.buffName = m.buffName;
  const byI = new Map(S.points.map(pt => [pt.i, pt]));
  S.points = m.points.map(p => { const old = byI.get(p.i); return { ...p, vis: old ? old.vis : null }; });
  build();
  $('holyHud').hidden = false; document.body.classList.add('holy');
  if (first) buildChips();
  paintChips();
}
function buildChips() {
  const box = $('holyPoints'); box.textContent = '';
  for (const tp of HOLY.temples) {
    const chip = document.createElement('div'); chip.className = 'holy-chip'; chip.dataset.i = tp.short;
    chip.title = tp.name + ' · ' + tp.faith + ' · ' + (S.buffName[tp.buff] || HOLY.buffName[tp.buff]);
    chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a4 4 0 0 1 4 4c0 3 1.5 4.5 2 6H6c.5-1.5 2-3 2-6a4 4 0 0 1 4-4zM10 19a2 2 0 0 0 4 0M12 1v2"/></svg><b></b><i class="holy-dot"></i><div class="holy-prog"><i></i></div>';
    chip.querySelector('b').textContent = tp.short;
    box.append(chip);
  }
}
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function paintChips() {
  const chips = $('holyPoints').children;
  for (let i = 0; i < S.points.length && i < chips.length; i++) {
    const pt = S.points[i], chip = chips[i], col = ownerColor(pt.owner, pt.team);
    chip.classList.toggle('owned', !!pt.owner);
    chip.classList.toggle('mine', pt.owner === ME.unit);
    chip.querySelector('.holy-dot').style.background = '#' + col.getHexString();
    const fill = chip.querySelector('.holy-prog i');
    fill.style.width = (pt.prog * 100).toFixed(0) + '%';
    fill.style.background = '#' + ownerColor(pt.progSide, pt.progTeam).getHexString();
  }
}

/* ---------- the bell and the prize ---------- */
function strike(i, vol, delay) {
  const tp = HOLY.temples[i], pt = S.points.find(p => p.i === i);
  const x = pt ? pt.x : tp.x, z = pt ? pt.z : tp.z, y = pt ? pt.gy : 0;
  const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
  const pan = d > 0.5 ? 0.85 * (dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)) / d : 0;   // the side the temple stands on
  if (holyAudio.bell) try { holyAudio.bell(tp.bell, vol, d, pan, delay || 0); } catch (e) {}
}
export function holyBell(m) {
  const pt = S.points.find(p => p.i === m.i);
  if (pt) { pt.swing = 1; pt.flash = 1; if (pt.vis) pt.vis.swing = 1; }
  S.flashes.push({ i: m.i, at: performance.now(), team: m.team, side: m.side });
  strike(m.i, 1, 0); strike(m.i, 0.55, 0.85);   // the bell swings twice
  setTimeout(() => { const q = S.points.find(p => p.i === m.i); if (q) q.swing = 0.7; }, 850);
}
export function holyWin(m) {
  for (const pt of S.points) { pt.swing = 1; pt.flash = 1; }
  for (let k = 0; k < 4; k++) strike(k, 0.9, k * 0.22);   // a peal: the four notes spell a chord
  for (let k = 0; k < 4; k++) strike(k, 0.7, 1.3 + k * 0.16);
  S.flashes.push({ i: -1, at: performance.now(), team: m.team, side: m.side });
  if (!reduceMotion) { const f = $('holyFlash'); f.hidden = false; f.style.opacity = '0.5'; setTimeout(() => { f.style.opacity = '0'; setTimeout(() => { f.hidden = true; }, 400); }, 260); }
}

/* ---------- the frame ---------- */
const V = new THREE.Vector3();
export function holyTick(dt) {
  if (!S.on) return;
  const now = performance.now(), t = now / 1000;
  const left = Math.max(0, S.left - (now - S.recvAt));
  $('holyTimer').textContent = fmt(left);
  const held = S.points.filter(p => p.owner).length;
  const sub = S.hold ? 'удержание всех храмов' : 'Церковная горка · захвачено ' + held + '/4';
  const subEl = $('holySub'); if (subEl.textContent !== sub) subEl.textContent = sub;
  // the hold countdown
  const holdEl = $('holyHold');
  if (S.hold) {
    holdEl.hidden = false;
    const hl = Math.max(0, S.hold.left - (now - S.recvAt));
    $('holyHoldT').textContent = fmt(hl);
    holdEl.classList.toggle('mine', S.hold.side === ME.unit);
    const hn = $('holyHoldName'); const nm = S.hold.side === ME.unit ? 'Вы держите все храмы' : (S.hold.name || 'Соперник') + ' держит все храмы';
    if (hn.textContent !== nm) hn.textContent = nm;
  } else holdEl.hidden = true;
  // the buffs you hold
  const b = myBuffs(), buffBox = $('holyBuffs');
  const want = Object.keys(b).sort().join(',');
  if (buffBox.dataset.have !== want) {
    buffBox.dataset.have = want; buffBox.textContent = '';
    const ICO = { dmg: 'M6 3l12 12M18 3L6 15M4 17l3 3M17 4l3 3', regen: 'M12 5v14M5 12h14', speed: 'M13 2 4.5 13.5H11L9.5 22 19 10h-6.5z', reload: 'M4 12a8 8 0 1 1 2.3 5.7M4 12V7m0 5h5' };
    for (const k of Object.keys(b)) {
      const s = document.createElement('span'); s.className = 'holy-buff'; s.title = S.buffName[k] || HOLY.buffName[k];
      s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICO[k] + '"/></svg>';
      buffBox.append(s);
    }
  }
  paintChips();
  // the markers
  const w = window.innerWidth, h = window.innerHeight;
  for (const pt of S.points) {
    const vis = pt.vis; if (!vis) continue;
    const target = ownerColor(pt.owner, pt.team);
    vis.col.lerp(target, Math.min(1, dt * 4));
    vis.dispProg += (pt.prog - vis.dispProg) * Math.min(1, dt * 8);
    vis.swing = Math.max(0, vis.swing - dt * 0.9);
    vis.flash = Math.max(0, vis.flash - dt * 1.8);
    const bu = vis.beam.material.uniforms;
    bu.uColor.value.copy(vis.col); bu.uTime.value = t; bu.uOpacity.value = (pt.owner ? 0.44 : 0.3) + vis.flash * 0.55;
    const ru = vis.ring.material.uniforms;
    ru.uColor.value.copy(vis.col); ru.uTime.value = t; ru.uProg.value = vis.dispProg; ru.uOwner.value = pt.owner ? 1 : 0;
    ru.uContest.value = (pt.prog > 0.02 && pt.prog < 0.98 && pt.owner !== pt.progSide) ? 1 : 0;
    vis.bell.rotation.z = Math.sin(t * 9) * vis.swing * 0.55;
    vis.bell.material.color.copy(vis.col).lerp(new THREE.Color('#c9a227'), pt.owner ? 0.35 : 0.8);
    vis.bell.material.emissive.copy(vis.col).multiplyScalar(pt.owner ? 0.35 + vis.flash * 0.5 : 0.05);
    const d = Math.hypot(pt.x - P.x, pt.z - P.z);
    V.set(pt.x, pt.gy + 9.5, pt.z).project(camera);
    if (V.z < 1 && Math.abs(V.x) < 1.1 && Math.abs(V.y) < 1.1 && d < 240 && !STATE.mpDead) {
      vis.label.hidden = false;
      const txt = HOLY.temples[pt.i].short.toUpperCase() + ' · ' + (S.buffName[HOLY.temples[pt.i].buff] || HOLY.buffName[HOLY.temples[pt.i].buff]);
      if (vis.label.textContent !== txt) vis.label.textContent = txt;
      vis.label.style.borderColor = '#' + vis.col.getHexString();
      vis.label.style.transform = 'translate(-50%,-100%) translate(' + ((V.x + 1) / 2 * w).toFixed(0) + 'px,' + ((1 - V.y) / 2 * h).toFixed(0) + 'px)';
    } else vis.label.hidden = true;
  }
}

/* ---------- the temples on the minimap (mp.js draws it into STATE.mapOverlay) ---------- */
export function holyMap(ctx, cx, cz, ppm, w, h) {
  if (!S.on) return;
  const now = performance.now();
  ctx.save();
  for (const pt of S.points) {
    const x = w / 2 + (pt.x - cx) * ppm, y = h / 2 + (pt.z - cz) * ppm;
    if (x < -12 || y < -12 || x > w + 12 || y > h + 12) continue;
    const col = '#' + ownerColor(pt.owner, pt.team).getHexString();
    if (pt.owner) { ctx.beginPath(); ctx.arc(x, y, 9 + 1.5 * Math.sin(now * 0.004), 0, 6.283); ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1; }
    if (pt.prog > 0.01 && pt.owner !== pt.progSide) {   // the capture arc
      ctx.beginPath(); ctx.arc(x, y, 11, -Math.PI / 2, -Math.PI / 2 + pt.prog * 6.283);
      ctx.strokeStyle = '#' + ownerColor(pt.progSide, pt.progTeam).getHexString(); ctx.lineWidth = 2.5; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 6.283); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 3.5); ctx.moveTo(x - 2.6, y - 1.6); ctx.lineTo(x + 2.6, y - 1.6);   // a little cross
    ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.3; ctx.stroke();
  }
  for (let k = S.flashes.length - 1; k >= 0; k--) {   // the bell flash: a ring spreading from the temple
    const f = S.flashes[k], age = now - f.at;
    if (age > 1700) { S.flashes.splice(k, 1); continue; }
    const pt = f.i >= 0 ? S.points.find(p => p.i === f.i) : null;
    const fx = pt ? w / 2 + (pt.x - cx) * ppm : w / 2, fy = pt ? h / 2 + (pt.z - cz) * ppm : h / 2;
    const a = 1 - age / 1700, r = (f.i < 0 ? 30 : 8) + age * (f.i < 0 ? 0.12 : 0.045);
    ctx.beginPath(); ctx.arc(fx, fy, r, 0, 6.283);
    ctx.strokeStyle = f.i < 0 ? 'rgba(255,210,77,' + (a * 0.9).toFixed(3) + ')' : 'rgba(255,225,150,' + (a * 0.85).toFixed(3) + ')';
    ctx.lineWidth = f.i < 0 ? 3 : 2.5; ctx.stroke();
  }
  ctx.restore();
}
export { S as holyState, clearHoly };
