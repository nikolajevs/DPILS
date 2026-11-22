import * as THREE from 'three';
import { P } from './player.js';
import { camera, scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { terrainH } from '../world/terrain.js';
import { $, reduceMotion } from '../core/env.js';

/* ---------- the «Шторм»: the shrinking zone of the last twenty minutes of a match, drawn over the city ----------
   The server owns the circle (server/storm.mjs: it begins beyond the whole field and shrinks in nine stages towards a
   random point of open ground, the burn outside, the last survivor wins the match). This module draws it: a wall of storm on the edge of the safe circle — a curtain
   of electric filaments rising out of a glowing hem, lightning striking it now and then — and a gold beacon column
   on the final point, visible across the whole city. The HUD keeps the phase, the countdown, the living and the way
   in (an arrow and the distance when you stand outside); the maps (STATE.mapOverlay of mp.js) draw the current circle,
   the next one and the final point. The circle the server sends every couple of seconds is eased towards on the page,
   so the wall glides instead of stepping. Everything here is worldSpace: the wall stands in true city coordinates,
   its hem below the ground, its top above the sky. */

const S = { on: false, phase: 'play', pi: -1, stages: 9, kind: 'hold', from: null, to: null, cur: { x: -1000, z: 500, r: 3200 }, disp: { x: -1000, z: 500, r: 3200 }, dps: 0, final: null, alive: 0, total: 0, left: 0, roundLeft: 0, recvAt: 0, cycle: 0 };
export const stormState = S;
export const stormAudio = { thunder: null, zap: null };   // mp.js hooks the game's own audio context in (one context, one volume knob)

let wall = null, beacon = null, built = false;
let flash = 0, flashId = 1, nextFlash = 0, outK = 0, radarT = 0, flashHide = 0;
const V = new THREE.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- the wall and the beacon ---------- */
const WALL_VS = `
varying vec2 vUv; varying vec3 vW; varying vec3 vN;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const WALL_FS = `
uniform float uTime, uFlash, uFlashId, uOutside, uCx, uCz, uPer12, uPer5;
varying vec2 vUv; varying vec3 vW; varying vec3 vN;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 2; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }   // two octaves: the wall is a full-screen overdraw, keep it cheap
// value noise periodic in x (the lattice wraps at the period): the filaments are measured in metres of the ring's
// arc, so they keep their true size at every distance — 45 m from the wall the view still crosses several of them
float pnoise(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, per), x1 = mod(i.x + 1.0, per);
  float a = hash2(vec2(x0, i.y)), b = hash2(vec2(x1, i.y)), c = hash2(vec2(x0, i.y + 1.0)), d = hash2(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float pfbm(vec2 p, float per) { float v = 0.0, a = 0.5; for (int i = 0; i < 2; i++) { v += a * pnoise(p, per); p *= 2.0; per *= 2.0; a *= 0.5; } return v; }
void main() {
  // the angle around the circle from the world position, NOT uv.x: the cylinder's seam quad interpolates uv.x
  // backwards across the whole wrap, and the camera meets exactly that quad — the noise would alias into a flat wash
  float ang = atan(vW.z - uCz, vW.x - uCx) * 0.15915494 + 0.5;
  float h = vW.y;
  // the energy curtain: filaments ~12 m and ~5 m wide on the ring's arc, rising at two speeds; the periodic noise
  // wraps seamlessly around the circle (no seam at the atan branch cut) and keeps its size at every distance
  float f1 = pfbm(vec2(ang * uPer12, h * 0.055 - uTime * 0.35), uPer12);
  float f2 = pfbm(vec2(ang * uPer5 + 7.0, h * 0.110 - uTime * 0.80), uPer5);
  float fil = smoothstep(0.34, 0.62, f1) * 0.7 + smoothstep(0.40, 0.70, f2) * 0.5;   // thresholds for the two-octave range (0…0.75)
  float ca = cos(ang * 6.2831853), sa = sin(ang * 6.2831853);
  float swirl = fbm(vec2(ca * 8.0, sa * 8.0) + vec2(uTime * 0.02, h * 0.004 + uTime * 0.01));   // the slow weather around the ring
  // the height profile: a dense wall from the street to ~120 m, gone by ~360 m
  float hf = pow(1.0 - smoothstep(90.0, 360.0, h), 1.4);
  // the glowing hem: an electric band hugging the ground, ~30 m tall
  float hem = exp(-max(0.0, h + 6.0) * 0.075);
  // the grazing fire: seen edge-on the wall burns bright (the view along the ring from inside)
  vec3 vd = normalize(cameraPosition - vW);
  float fres = pow(1.0 - abs(dot(normalize(vN), vd)), 2.0);
  // lightning: a few jagged bolts at random azimuths while the flash lives
  float bolt = 0.0;
  if (uFlash > 0.01) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ba = hash(uFlashId + fi * 7.31);
      float d = abs(fract(ang - ba + 0.5) - 0.5);
      float jag = hash(floor(h * 0.12) + fi * 3.7 + uFlashId) * 0.010;
      bolt += (1.0 - smoothstep(0.0, 0.004 + jag, d)) * (0.45 + 0.55 * hash(floor(h * 0.25) + fi + uFlashId));
    }
    bolt *= uFlash;
  }
  // the palette in LINEAR light (the HDR pipeline blends before the tone map and the sRGB encode): a near-black
  // indigo body, electric cyan filaments, the white-hot bolt — the bloom of the page takes what goes over white
  vec3 deep = vec3(0.004, 0.007, 0.045);
  vec3 mid = vec3(0.012, 0.035, 0.16);
  vec3 glow = vec3(0.07, 0.55, 1.0);
  vec3 col = mix(deep, mid, swirl);
  col = mix(col, glow, clamp(fil, 0.0, 1.0) * 0.85);
  col += glow * hem * 1.6;
  col += glow * fres * 0.6;
  col += vec3(0.6, 0.85, 1.0) * bolt * 3.0;
  col = mix(col, vec3(0.12, 0.006, 0.20) + glow * fil * 0.6, uOutside * 0.45);   // the storm angers when you stand outside
  float a = (0.78 + 0.18 * fil + 0.04 * swirl) * hf + hem * 0.85 + fres * 0.30 * hf + bolt;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.96));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const BEACON_FS = `
uniform float uTime;
varying vec2 vUv;
void main() {
  float pulse = 0.32 + 0.10 * sin(uTime * 2.2) + 0.05 * sin(uTime * 5.7);
  float a = pow(1.0 - vUv.y, 2.4) * pulse;
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.28), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function build() {
  if (built) return; built = true;
  const wm = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uFlashId: { value: 1 }, uOutside: { value: 0 }, uCx: { value: -1000 }, uCz: { value: 500 }, uPer12: { value: 1676 }, uPer5: { value: 4021 } },
    vertexShader: WALL_VS, fragmentShader: WALL_FS,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,   // the zone is an overlay over the world: the HDR pipeline's depth prepass clips the near face of a kilometres-wide shader cylinder, so the wall draws over the city (the storm reads as weather, not geometry)
  });
  worldSpace(wm);
  wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true), wm);
  wall.scale.set(3200, 520, 3200); wall.position.set(-1000, 220, 500);   // the hem at −40 m, the top at 480 m
  wall.renderOrder = 20; wall.frustumCulled = false; wall.visible = false;
  scene.add(wall);
  const bm = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: WALL_VS, fragmentShader: BEACON_FS,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,   // the guide column stands over the roofs: visible across the whole city
  });
  worldSpace(bm);
  beacon = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1, 24, 1, true), bm);
  beacon.scale.set(1, 700, 1); beacon.renderOrder = 21; beacon.frustumCulled = false; beacon.visible = false;
  scene.add(beacon);
}

/* ---------- the state from the server ---------- */
export function setStorm(m) {
  if (!m) return;
  const first = !S.on;
  Object.assign(S, { on: true, phase: m.phase, pi: m.pi, stages: m.stages || 9, kind: m.kind, from: m.from, to: m.to, dps: m.dps, final: m.final, alive: m.alive, total: m.total, left: m.left, roundLeft: m.roundLeft || 0, cycle: m.cycle, recvAt: performance.now() });
  if (m.cur) S.cur = { x: m.cur.x, z: m.cur.z, r: m.cur.r };
  if (first) S.disp = { ...S.cur };
  build();
  const fight = S.phase === 'play' || S.phase === 'sudden';
  wall.visible = S.phase !== 'end';
  beacon.visible = fight && !!S.final;
  if (beacon.visible) beacon.position.set(S.final.x, terrainH(S.final.x, S.final.z) + 340, S.final.z);
  $('stormHud').hidden = false;
  if (first) nextFlash = performance.now() + 2500;
}
export function clearStorm() {
  S.on = false;
  if (wall) wall.visible = false;
  if (beacon) beacon.visible = false;
  $('stormHud').hidden = true; $('stormDist').hidden = true; $('stormHurt').hidden = true; $('stormFlash').hidden = true; $('stormTint').hidden = true;
  document.body.classList.remove('storm-out');
}

/* ---------- the frame ---------- */
export function stormTick(dt, now) {
  if (!S.on) return;
  // the circle glides towards the server's own (a heartbeat every 2 s): the wall never steps
  const k = Math.min(1, dt * 1.6);
  S.disp.x += (S.cur.x - S.disp.x) * k; S.disp.z += (S.cur.z - S.disp.z) * k; S.disp.r += (S.cur.r - S.disp.r) * k;
  const c = S.disp, fight = S.phase === 'play' || S.phase === 'sudden';
  const dx = P.x - c.x, dz = P.z - c.z, dist = Math.hypot(dx, dz), outside = fight && dist > c.r;
  outK += ((outside ? 1 : 0) - outK) * Math.min(1, dt * 3);
  // the wall follows the circle
  wall.scale.set(Math.max(1, c.r), 520, Math.max(1, c.r)); wall.position.set(c.x, 220, c.z);
  const u = wall.material.uniforms;
  u.uTime.value = now / 1000; u.uOutside.value = outK; u.uCx.value = c.x; u.uCz.value = c.z;
  u.uPer12.value = Math.max(8, Math.round(6.2831853 * c.r / 12)); u.uPer5.value = Math.max(16, Math.round(6.2831853 * c.r / 5));
  // lightning now and then: the wall flashes, the sky blinks, the thunder rolls (heard near the wall or outside)
  if (now >= nextFlash) {
    flash = 1; flashId = 1 + Math.random() * 900; nextFlash = now + 3500 + Math.random() * 6500;
    const wallD = Math.abs(dist - c.r);
    if (fight && (outside || wallD < 260)) {
      const vol = clamp(1.1 - wallD / 300, 0.25, 1);
      if (!reduceMotion) { const f = $('stormFlash'); f.hidden = false; f.style.opacity = String(0.16 + 0.2 * vol); clearTimeout(flashHide); flashHide = setTimeout(() => { f.hidden = true; }, 170); }
      if (stormAudio.thunder) { const wx = c.x + dx / (dist || 1) * c.r, wz = c.z + dz / (dist || 1) * c.r; V.set(wx, P.y + 60, wz).applyMatrix4(camera.matrixWorldInverse); const d = V.length(), pan = d > 0.5 ? 0.85 * V.x / Math.max(0.5, Math.hypot(V.x, V.z)) : 0; try { stormAudio.thunder(vol, d, pan); } catch (e) {} }
    }
  }
  flash *= Math.exp(-dt * 5); u.uFlash.value = flash; u.uFlashId.value = flashId;
  if (beacon.visible) beacon.material.uniforms.uTime.value = now / 1000;
  // the HUD: the phase, the countdown, the living
  const left = Math.max(0, S.left - (now - S.recvAt)), roundLeft = Math.max(0, S.roundLeft - (now - S.recvAt));
  const ph = $('stormPhase');
  const label = S.phase === 'end' ? 'КАТКА ЗАВЕРШЕНА' : S.phase === 'sudden' ? 'ФИНАЛ · ЗОНА ИСЧЕЗАЕТ' : S.kind === 'shrink' ? 'ЗОНА СУЖАЕТСЯ' : 'ЗОНА СТАБИЛЬНА';
  if (ph.textContent !== label) { ph.textContent = label; ph.dataset.kind = S.phase === 'sudden' ? 'sudden' : S.kind; }
  $('stormTimer').textContent = fmt(left);
  const sub = S.phase === 'play' ? 'этап ' + (S.pi + 1) + '/' + S.stages + ' · до конца ' + fmt(roundLeft) : S.phase === 'sudden' ? 'последний выживший побеждает' : 'до следующей катки';
  const subEl = $('stormSub'); if (subEl.textContent !== sub) subEl.textContent = sub;
  const al = $('stormAlive'); if (al.textContent !== String(S.alive)) al.textContent = String(S.alive);
  $('stormHud').dataset.phase = S.phase;
  // the way in: the arrow to the middle and the distance to the edge while you stand outside
  const distEl = $('stormDist');
  if (outside) {
    V.set(c.x, P.y + 30, c.z).project(camera);
    let sx = V.x, sy = V.y; if (V.z > 1) { sx = -sx; sy = -sy; }   // the middle behind the back: the arrow turns around
    $('stormArrow').style.transform = 'rotate(' + Math.atan2(sx, sy).toFixed(3) + 'rad)';
    $('stormDistN').textContent = Math.round(dist - c.r) + ' м';
    distEl.hidden = false;
  } else distEl.hidden = true;
  $('stormHurt').hidden = !outside;
  $('stormTint').hidden = !outside;
  document.body.classList.toggle('storm-out', outside);
  // the radar: the whole circle at a glance, the next one, the final point and you
  if ((radarT -= dt) <= 0) { radarT = 0.2; drawRadar(c, fight); }
}

function drawRadar(c, fight) {
  const cv = $('stormRadar'); if (!cv) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, mx = W / 2, my = H / 2;
  g.clearRect(0, 0, W, H);
  const sc = 52 / Math.max(20, c.r);
  // the danger beyond the edge
  g.save();
  g.beginPath(); g.rect(0, 0, W, H); g.arc(mx, my, Math.max(2, c.r * sc), 0, 6.2832, true);
  g.fillStyle = 'rgba(40, 54, 130, .30)'; g.fill('evenodd');
  g.restore();
  g.beginPath(); g.arc(mx, my, Math.max(2, c.r * sc), 0, 6.2832);
  g.lineWidth = 1.6; g.strokeStyle = 'rgba(87, 200, 255, .95)'; g.stroke();
  if (fight && S.to) {   // the next circle
    g.beginPath(); g.arc(mx + (S.to.x - c.x) * sc, my + (S.to.z - c.z) * sc, Math.max(1.5, S.to.r * sc), 0, 6.2832);
    g.setLineDash([3, 3]); g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.8)'; g.stroke(); g.setLineDash([]);
  }
  if (S.final) {   // the final point
    const fx = mx + (S.final.x - c.x) * sc, fy = my + (S.final.z - c.z) * sc;
    g.beginPath(); g.moveTo(fx, fy - 3.5); g.lineTo(fx + 3.5, fy); g.lineTo(fx, fy + 3.5); g.lineTo(fx - 3.5, fy); g.closePath();
    g.fillStyle = 'rgba(255, 210, 77, .95)'; g.fill();
  }
  // you: the dot inside, or pressed to the rim with the true bearing
  let px = (P.x - c.x) * sc, pz = (P.z - c.z) * sc; const pl = Math.hypot(px, pz);
  if (pl > 56) { px *= 56 / pl; pz *= 56 / pl; }
  g.beginPath(); g.arc(mx + px, my + pz, 3, 0, 6.2832);
  g.fillStyle = pl > 52 ? '#ff5a4d' : '#ffd24d'; g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
}

/* ---------- the circles on the city maps (the minimap and the full map, STATE.mapOverlay of mp.js) ---------- */
export function stormMapOverlay(ctx, cx, cz, ppm, w, h) {
  if (!S.on || S.phase === 'end') return;
  const c = S.disp, x = w / 2 + (c.x - cx) * ppm, y = h / 2 + (c.z - cz) * ppm, r = Math.max(1, c.r * ppm);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.arc(x, y, r, 0, 6.2832, true);
  ctx.fillStyle = 'rgba(38, 52, 128, .20)'; ctx.fill('evenodd');   // the storm beyond the edge
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(87, 200, 255, .95)'; ctx.stroke();
  if (S.phase === 'play' && S.to) {   // the next circle: where the run goes
    const nx = w / 2 + (S.to.x - cx) * ppm, ny = h / 2 + (S.to.z - cz) * ppm, nr = Math.max(1, S.to.r * ppm);
    ctx.beginPath(); ctx.arc(nx, ny, nr, 0, 6.2832);
    ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke(); ctx.setLineDash([]);
  }
  if (S.final) {   // the final point
    const fx = w / 2 + (S.final.x - cx) * ppm, fy = h / 2 + (S.final.z - cz) * ppm;
    ctx.beginPath(); ctx.moveTo(fx, fy - 5); ctx.lineTo(fx + 5, fy); ctx.lineTo(fx, fy + 5); ctx.lineTo(fx - 5, fy); ctx.closePath();
    ctx.fillStyle = 'rgba(255, 210, 77, .95)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke();
  }
  ctx.restore();
}