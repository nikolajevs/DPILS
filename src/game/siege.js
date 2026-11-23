/* The «Штурм Динабурга» event on the page (server/game.mjs owns the rules, SIEGE in server/combat.mjs): the
   reconstruction of the 1812 siege. This module draws the protective dome over the fortress while the garrison
   prepares — a glass shell of hexagonal plates that lets nobody across — and the altar marker at the cannon fountain
   in the garden: a light column, a capture ring that fills as the attackers hold it, the world label. Plus the event
   HUD (the phase clock, the two side buttons of the registration, the altar progress of the assault), the minimap
   picture and the flash of the prize. The dome falls with a collapse when the assault begins. The rules, the phases,
   the balance and the loot are the server's — this is the picture. */
import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P } from './player.js';
import { camera, scene } from '../render/renderer.js';
import { terrainH } from '../world/terrain.js';
import { $, reduceMotion } from '../core/env.js';
import { SIEGE } from '../../server/combat.mjs';

const S = { on: false, id: 0, phase: 'reg', left: 0, recvAt: 0, counts: { a: 0, d: 0 }, prog: 0, contest: null, holdMs: SIEGE.holdMs, capR: SIEGE.capR, altar: { ...SIEGE.altar, gy: 0 }, area: { cx: SIEGE.cx, cz: SIEGE.cz, r: SIEGE.r }, dome: null, names: { ...SIEGE.names }, mySide: null };
export const siegeNet = { join: null };   // mp.js wires it to the socket: the registration buttons send through it
const ATK = new THREE.Color('#3f7fd6'), DEF = new THREE.Color('#d84331'), NEUTRAL = new THREE.Color('#ffd27a'), SHIELD = new THREE.Color('#57c8ff');
const sideColor = s => s === 'a' ? ATK : s === 'd' ? DEF : NEUTRAL;
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- the dome: a glass shell of hex plates over the fortress ---------- */
const DOME_VS = [
  'varying vec2 vUv; varying vec3 vN; varying vec3 vV;',
  'void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
].join('\n');
const DOME_FS = [
  'uniform vec3 uColor; uniform float uTime; uniform float uOpacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV;',
  'float hexDist(vec2 p){ p = abs(p); return max(dot(p, vec2(0.5, 0.866)), p.x); }',
  'void main(){',
  '  vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5;',
  '  vec2 uv = vUv * vec2(160.0, 60.0);',
  '  vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h;',
  '  vec2 gv = dot(a, a) < dot(b, b) ? a : b;',
  '  float line = smoothstep(0.07, 0.0, 0.5 - hexDist(gv));',
  '  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);',
  '  float scan = 0.5 + 0.5 * sin(vUv.y * 42.0 - uTime * 1.7);',
  '  float alpha = (line * 0.5 + fres * 0.55 + 0.05) * (0.72 + 0.28 * scan) * uOpacity;',
  '  if (alpha < 0.01) discard;',
  '  gl_FragColor = vec4(uColor, alpha);',
  '}',
].join('\n');
let domeVis = null, domeFall = 0;   // domeFall: the collapse animation after the dome is down (0 — none)
function buildDome(d) {
  clearDome();
  const geo = new THREE.SphereGeometry(d.r, 56, 28, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: SHIELD.clone() }, uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: DOME_VS, fragmentShader: DOME_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.y = 0.38;   // a low shell over the ramparts, not a half-sphere to the sky
  mesh.position.set(d.cx, terrainH(d.cx, d.cz) - 3, d.cz);
  mesh.renderOrder = 15; mesh.frustumCulled = false; mesh.userData.noProbe = true;
  scene.add(mesh);
  domeVis = { mesh, rise: 0 };
}
function clearDome() {
  if (!domeVis) return;
  scene.remove(domeVis.mesh); domeVis.mesh.geometry.dispose(); domeVis.mesh.material.dispose(); domeVis = null; domeFall = 0;
}

/* ---------- the altar: the cannon fountain in the garden ---------- */
const BEAM_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const BEAM_FS = [
  'uniform vec3 uColor; uniform float uTime; uniform float uOpacity; varying vec2 vUv;',
  'void main(){ float fall = pow(1.0 - vUv.y, 1.25); float shimmer = 0.78 + 0.22 * sin(uTime * 2.2 + vUv.y * 9.0); gl_FragColor = vec4(uColor, uOpacity * fall * shimmer); }',
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
let altarVis = null;
function buildAltar() {
  if (altarVis) return;
  const a = S.altar, g = new THREE.Group(); g.position.set(a.x, a.gy, a.z); g.userData.noProbe = true;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 2.2, 90, 16, 1, true), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: NEUTRAL.clone() }, uTime: { value: 0 }, uOpacity: { value: 0.3 } },
    vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  beam.position.y = 45; beam.renderOrder = 20; beam.frustumCulled = false; beam.userData.noProbe = true; g.add(beam);
  const ring = new THREE.Mesh(new THREE.PlaneGeometry((S.capR + 1) * 2, (S.capR + 1) * 2), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: NEUTRAL.clone() }, uProg: { value: 0 }, uTime: { value: 0 }, uContest: { value: 0 }, uOwner: { value: 0 }, uCapR: { value: S.capR } },
    vertexShader: BEAM_VS, fragmentShader: RING_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.24; ring.renderOrder = 3; ring.userData.noProbe = true; g.add(ring);
  scene.add(g);
  const label = document.createElement('div'); label.className = 'siege-label'; label.hidden = true; $('mpTags').append(label);
  altarVis = { group: g, beam, ring, label, col: NEUTRAL.clone(), dispProg: 0 };
}
function clearAltar() {
  if (!altarVis) return;
  scene.remove(altarVis.group);
  altarVis.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  altarVis.label.remove(); altarVis = null;
}

/* ---------- the state from the server ---------- */
export function setSiege(m, mySide) {
  if (!m) return;
  const first = !S.on, prevPhase = S.phase;
  S.on = true; S.id = m.id; S.phase = m.phase; S.left = m.left; S.recvAt = performance.now();
  S.counts = m.counts || { a: 0, d: 0 }; S.prog = m.prog || 0; S.contest = m.contest || null;
  S.holdMs = m.holdMs; S.capR = m.capR; S.names = m.names || S.names;
  if (m.altar) S.altar = m.altar;
  if (m.area) S.area = m.area;
  S.dome = m.dome || null;
  if (mySide !== undefined) S.mySide = mySide;
  const wantDome = m.dome;
  if (wantDome && (!domeVis || domeFall)) buildDome(wantDome);
  if (!wantDome && domeVis && !domeFall && prevPhase === 'prep') domeFall = performance.now();   // the assault: the dome collapses
  if (!wantDome && !domeVis) clearDome();
  if (m.phase === 'prep' || m.phase === 'assault') buildAltar();
  document.body.classList.add('siege');
  paintHud(first || prevPhase !== m.phase);
  return { first, prevPhase };
}
export function siegeYou(m) { S.mySide = m.side || null; paintHud(false); }
export function siegeMySide() { return S.mySide; }
function paintHud(phaseChanged) {
  const reg = S.phase === 'reg', prep = S.phase === 'prep', assault = S.phase === 'assault';
  // the registration window stays with the fighters only: once the registration is over, whoever did not sign up
  // (or has left the siege) no longer sees the panel — the dome and the altar on the minimap remain for everyone
  $('siegeHud').hidden = !(reg || S.mySide);
  const sub = reg ? 'регистрация сторон · 1812' : prep ? 'подготовка · купол поднят' : 'штурм крепости · алтарь в саду';
  const subEl = $('siegeSub'); if (subEl.textContent !== sub) subEl.textContent = sub;
  const ba = $('siegeJoinA'), bd = $('siegeJoinD');
  ba.disabled = !reg; bd.disabled = !reg;
  ba.classList.toggle('mine', S.mySide === 'a'); bd.classList.toggle('mine', S.mySide === 'd');
  ba.title = reg ? (S.mySide === 'a' ? 'Вы записаны — нажмите, чтобы отказаться' : 'Записаться в штурмующие') : S.names.a;
  bd.title = reg ? (S.mySide === 'd' ? 'Вы записаны — нажмите, чтобы отказаться' : 'Записаться в гарнизон') : S.names.d;
  $('siegeCountA').textContent = S.counts.a; $('siegeCountD').textContent = S.counts.d;
  $('siegeAltar').hidden = !assault;
  const note = $('siegeNote');
  let nt = '';
  if (reg) nt = S.mySide ? 'Вы — ' + S.names[S.mySide].toLowerCase() + '. После регистрации — телепорт и купол на подготовке.' : 'Выберите сторону: штурмующие берут алтарь, гарнизон выставляет оборону.';
  else if (prep) nt = S.mySide ? 'Вы — ' + S.names[S.mySide].toLowerCase() + '. Купол не пускает и не выпускает, оружие на замке.' : 'Купол вокруг крепости: регистрация закрыта, вы вне штурма.';
  else nt = S.mySide === 'a' ? 'Вы — штурмующие: удержите алтарь (пушку в саду) одну минуту.' : S.mySide === 'd' ? 'Вы — гарнизон: не дайте штурмующим удержать алтарь минуту.' : 'Идёт штурм: алтарь — пушка в саду крепости.';
  if (note.textContent !== nt) note.textContent = nt;
  if (assault) {
    const fill = $('siegeProgFill');
    fill.style.width = (S.prog * 100).toFixed(1) + '%';
    fill.style.background = '#' + sideColor(S.contest).getHexString();
    const at = $('siegeAltarT');
    const txt = 'алтарь · пушка Динабурга — ' + Math.round(S.prog * 100) + '% удержания (' + fmt(S.holdMs) + ')' + (S.contest === 'd' ? ' · гарнизон отбивает' : S.contest === 'a' ? ' · штурмующие держат' : '');
    if (at.textContent !== txt) at.textContent = txt;
  }
}

/* ---------- the fall and the prize ---------- */
export function siegeOut() { S.mySide = null; paintHud(false); }
export function siegeWin(m) {
  if (!reduceMotion) {
    const f = $('siegeFlash');
    f.style.background = m.side === 'a' ? 'radial-gradient(ellipse at center, rgba(120,170,255,.5), rgba(63,127,214,.26) 58%, transparent 82%)' : 'radial-gradient(ellipse at center, rgba(255,150,120,.5), rgba(216,67,49,.26) 58%, transparent 82%)';
    f.hidden = false; f.style.opacity = '0.55'; setTimeout(() => { f.style.opacity = '0'; setTimeout(() => { f.hidden = true; }, 400); }, 280);
  }
}
export function clearSiege() {
  clearDome(); clearAltar();
  S.on = false; S.mySide = null; S.prog = 0; S.contest = null; S.dome = null;
  $('siegeHud').hidden = true; $('siegeFlash').hidden = true;
  document.body.classList.remove('siege');
}

/* ---------- the frame ---------- */
const V = new THREE.Vector3();
export function siegeTick(dt) {
  if (!S.on) return;
  const now = performance.now(), t = now / 1000;
  $('siegeTimer').textContent = fmt(Math.max(0, S.left - (now - S.recvAt)));
  if (S.phase === 'assault') {
    const fill = $('siegeProgFill');
    fill.style.width = (S.prog * 100).toFixed(1) + '%';
    fill.style.background = '#' + sideColor(S.contest).getHexString();
  }
  // the dome: rises on the prep, collapses when the assault begins
  if (domeVis) {
    const u = domeVis.mesh.material.uniforms;
    u.uTime.value = t;
    if (domeFall) {
      const k = Math.min(1, (now - domeFall) / 1100);
      u.uOpacity.value = 0.85 * (1 - k);
      domeVis.mesh.scale.y = 0.38 * (1 - k * k);
      if (k >= 1) clearDome();
    } else {
      domeVis.rise = Math.min(1, domeVis.rise + dt * 0.9);
      u.uOpacity.value = 0.85 * domeVis.rise;
    }
  }
  // the altar marker
  if (altarVis) {
    const target = S.phase === 'assault' ? sideColor(S.contest) : NEUTRAL;
    altarVis.col.lerp(target, Math.min(1, dt * 4));
    altarVis.dispProg += ((S.phase === 'assault' ? S.prog : 0) - altarVis.dispProg) * Math.min(1, dt * 8);
    const bu = altarVis.beam.material.uniforms;
    bu.uColor.value.copy(altarVis.col); bu.uTime.value = t; bu.uOpacity.value = S.phase === 'assault' ? 0.4 : 0.26;
    const ru = altarVis.ring.material.uniforms;
    ru.uColor.value.copy(altarVis.col); ru.uTime.value = t; ru.uProg.value = altarVis.dispProg; ru.uOwner.value = S.prog > 0.01 ? 1 : 0;
    ru.uContest.value = S.contest === 'd' ? 1 : 0;
    const a = S.altar, d = Math.hypot(a.x - P.x, a.z - P.z);
    V.set(a.x, a.gy + 8.5, a.z).project(camera);
    const w = window.innerWidth, h = window.innerHeight;
    if (V.z < 1 && Math.abs(V.x) < 1.1 && Math.abs(V.y) < 1.1 && d < 320 && !STATE.mpDead) {
      altarVis.label.hidden = false;
      const txt = 'АЛТАРЬ · ПУШКА ДИНАБУРГА' + (S.phase === 'assault' ? ' · ' + Math.round(S.prog * 100) + '%' : '');
      if (altarVis.label.textContent !== txt) altarVis.label.textContent = txt;
      altarVis.label.style.borderColor = '#' + altarVis.col.getHexString();
      altarVis.label.style.transform = 'translate(-50%,-100%) translate(' + ((V.x + 1) / 2 * w).toFixed(0) + 'px,' + ((1 - V.y) / 2 * h).toFixed(0) + 'px)';
    } else altarVis.label.hidden = true;
  }
}

/* ---------- the minimap (mp.js draws it into STATE.mapOverlay) ---------- */
export function siegeMap(ctx, cx, cz, ppm, w, h) {
  if (!S.on) return;
  ctx.save();
  if (S.phase === 'prep' && S.dome) {
    const x = w / 2 + (S.dome.cx - cx) * ppm, y = h / 2 + (S.dome.cz - cz) * ppm, r = S.dome.r * ppm;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
    ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(87,200,255,.85)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(87,200,255,.06)'; ctx.fill();
  }
  if (S.phase === 'assault' || S.phase === 'prep') {
    const a = S.altar, x = w / 2 + (a.x - cx) * ppm, y = h / 2 + (a.z - cz) * ppm;
    if (x > -14 && y > -14 && x < w + 14 && y < h + 14) {
      const col = '#' + sideColor(S.contest).getHexString();
      if (S.prog > 0.01) { ctx.beginPath(); ctx.arc(x, y, 11, -Math.PI / 2, -Math.PI / 2 + S.prog * 6.283); ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 6.283); ctx.fillStyle = S.phase === 'assault' ? col : '#ffd27a'; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 3.4, y + 2.6); ctx.lineTo(x + 3.4, y - 2.6); ctx.moveTo(x - 1, y - 3.4); ctx.lineTo(x + 2.6, y + 1);   // a little cannon
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.3; ctx.stroke();
    }
  }
  ctx.restore();
}
// the registration buttons: a click on your own side withdraws the application
$('siegeJoinA').addEventListener('click', () => { if (siegeNet.join) siegeNet.join(S.mySide === 'a' ? null : 'a'); });
$('siegeJoinD').addEventListener('click', () => { if (siegeNet.join) siegeNet.join(S.mySide === 'd' ? null : 'd'); });
export { S as siegeState, clearSiege as siegeClear };
