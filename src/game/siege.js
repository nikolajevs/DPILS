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
import { quake } from './nades.js';

const S = { on: false, id: 0, phase: 'reg', left: 0, recvAt: 0, counts: { a: 0, d: 0 }, prog: 0, contest: null, holdMs: SIEGE.holdMs, capR: SIEGE.capR, altar: { ...SIEGE.altar, gy: 0 }, area: { cx: SIEGE.cx, cz: SIEGE.cz, r: SIEGE.r }, dome: null, lastDome: null, names: { ...SIEGE.names }, mySide: null };
export const siegeAudio = { up: null, down: null, hit: null };   // mp.js wires it to the game's one audio context (sfx.js dome voices)
export const siegeNet = { join: null };   // mp.js wires it to the socket: the registration buttons send through it
const ATK = new THREE.Color('#3f7fd6'), DEF = new THREE.Color('#d84331'), NEUTRAL = new THREE.Color('#ffd27a'), SHIELD = new THREE.Color('#57c8ff');
const sideColor = s => s === 'a' ? ATK : s === 'd' ? DEF : NEUTRAL;
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- the dome: a living energy shield over the fortress ----------
   A low shell of hex plates in two passes: a tinted glass body (normal blending, so the shield reads against the
   noon sky) under an additive energy shell — a triplanar hex grid (uniform plates, no pinch at the crown), a fresnel
   rim, a slow charge sweep climbing the shell, cells that sparkle as they charge, and ripples spreading from every
   hit (a bystander's bullet, a body thrown against the field). The rise assembles the plates from the ground up
   behind a bright front. The fall is the show: the field overloads white-hot, the plates fail one by one from the
   crown down in a wave of hot edges, seven hundred glowing hex shards burst off the shell and rain down tumbling,
   a shockwave rings the ramparts, the light flashes and the earth jolts. The rules stay the server's — this is the
   picture. */
const DOME_VS = [
  'uniform float uSquash;',
  'varying vec2 vUv; varying vec3 vDir; varying vec3 vW; varying vec3 vN; varying vec3 vV;',
  'void main(){',
  '  vUv = uv; vDir = normalize(position);',
  '  vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;',
  '  vN = normalize(vec3(normal.x, normal.y / uSquash, normal.z));',   // the world normal of the squashed sphere
  '  vV = normalize(cameraPosition - wp.xyz);',
  '  gl_Position = projectionMatrix * viewMatrix * wp;',
  '}',
].join('\n');
// one hex grid on the sphere UV, no derivatives: a triplanar grid with fwidth made the ANGLE/D3D11 shader compiler
// chew for tens of seconds, and every GL call behind it froze the page (the heartbeat then dropped the player).
// This is the original dome's cheap topology with the whole living-shader layering on top.
const DOME_FS = [
  'uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uRise; uniform float uFall; uniform float uHot; uniform float uFlicker; uniform vec4 uHits[6];',
  'varying vec2 vUv; varying vec3 vDir; varying vec3 vW; varying vec3 vN; varying vec3 vV;',
  'float hexDist(vec2 p){ p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }',
  'vec4 hexCell(vec2 uv){ vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5; vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h; vec2 gv = dot(a, a) < dot(b, b) ? a : b; return vec4(gv, uv - gv); }',
  'float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
  'void main(){',
  '  vec4 cell = hexCell(vUv * vec2(220.0, 70.0));',
  '  float hd = hexDist(cell.xy);',
  '  float line = smoothstep(0.075, 0.0, 0.5 - hd);',
  '  float glow = smoothstep(0.26, 0.5, hd);',
  '  float h = hash21(cell.zw);',
  '  float pulse = 0.6 + 0.4 * sin(uTime * (0.5 + h * 0.9) + h * 40.0);',   // each cell breathes at its own rate
  '  float q = floor(uTime * 1.7); float ft = fract(uTime * 1.7);',
  '  float spark = smoothstep(0.975, 0.995, hash21(cell.zw + q * 7.31)) * (1.0 - ft) * (1.0 - ft);',   // a few cells flash as they charge
  '  float ndv = abs(dot(normalize(vN), normalize(vV)));',
  '  float f1 = pow(1.0 - ndv, 2.0); float f2 = pow(1.0 - ndv, 5.0);',
  '  float bp = fract(vDir.y * 1.4 - uTime * 0.1);',
  '  float band = smoothstep(0.0, 0.05, bp) * smoothstep(0.2, 0.05, bp);',   // the slow charge sweep climbing the shell
  '  float scan = 0.5 + 0.5 * sin(vDir.y * 90.0 - uTime * 2.6);',
  '  float hitGlow = 0.0;',
  '  for (int i = 0; i < 6; i++) {',
  '    vec4 hh = uHits[i]; float age = uTime - hh.w;',
  '    if (hh.w > 0.0 && age > 0.0 && age < 1.3) {',
  '      float dist = distance(vW, hh.xyz); float front = age * 130.0; float q = (dist - front) * 0.10;',
  '      hitGlow += exp(-q * q) * (1.0 - age / 1.3) * 0.9 + exp(-dist * 0.09) * exp(-age * 7.0) * 1.4;',
  '    }',
  '  }',
  '  float frontY = uRise * 1.18;',
  '  float vis = 1.0 - smoothstep(frontY - 0.10, frontY, vDir.y);',   // the rise: plates assemble from the ground up
  '  float riseEdge = smoothstep(0.10, 0.0, abs(vDir.y - frontY)) * step(uRise, 0.999) * step(0.001, uRise);',
  '  float local = (1.0 - vDir.y) * 0.9 + h * 0.35;',
  '  float th = uFall * 1.6 - 0.2;',
  '  float alive = smoothstep(th - 0.05, th + 0.05, local);',   // the fall: plates fail from the crown down, each at its own hour
  '  float failEdge = smoothstep(0.14, 0.0, abs(local - th)) * step(0.001, uFall);',
  // normal blending, not additive: over the noon sky an additive net washes out to white, a saturated cyan plate
  // keeps its colour by day and reads as glowing energy by night
  '  vec3 col = mix(uColor * 0.5, uColor * 1.35, clamp(line + spark * 0.6, 0.0, 1.0));',
  '  float energy = line * (0.85 + 0.5 * pulse) + glow * (0.16 + 0.14 * h) + f1 * 0.30 + f2 * 0.55 + 0.02;',
  '  energy *= 0.82 + 0.22 * band + 0.06 * scan;',
  '  energy += spark * 0.5 + hitGlow + riseEdge * 1.1;',
  '  float strobe = mix(1.0, 0.65 + 0.35 * sin(uTime * 55.0), uFlicker);',
  '  energy *= 1.0 + uHot * 2.6 * strobe;',   // the overload: the whole field strobes white-hot before it fails
  '  col = mix(col, vec3(1.0, 0.98, 0.92), clamp(uHot * 0.75 * strobe + failEdge * 0.6 + f2 * 0.35, 0.0, 1.0));',
  '  col += vec3(1.0, 0.62, 0.25) * failEdge * 1.6 + vec3(0.7, 0.95, 1.0) * hitGlow * 0.5;',
  '  float side = gl_FrontFacing ? 1.0 : 0.32;',   // from inside, keep the city and the attackers readable through the field
  '  float alpha = min(energy, 0.95) * vis * alive * uOpacity * side;',
  '  if (alpha < 0.008) discard;',
  '  gl_FragColor = vec4(col, alpha);',
  '}',
].join('\n');
const GLASS_FS = [
  'uniform vec3 uColor; uniform float uOpacity; uniform float uRise; uniform float uFall;',
  'varying vec3 vDir; varying vec3 vN; varying vec3 vV;',
  'void main(){',
  '  float ndv = abs(dot(normalize(vN), normalize(vV)));',
  '  float f = pow(1.0 - ndv, 2.4);',
  '  float vis = 1.0 - smoothstep(uRise * 1.18 - 0.10, uRise * 1.18, vDir.y);',
  '  float local = (1.0 - vDir.y) * 0.9; float th = uFall * 1.6 - 0.2;',
  '  float alive = smoothstep(th - 0.05, th + 0.05, local);',
  '  float side = gl_FrontFacing ? 1.0 : 0.16;',   // the inner glass is a faint veil, not a wall over the whole view
  '  float a = (f * 0.34 + 0.16) * vis * alive * uOpacity * side;',
  '  if (a < 0.004) discard;',
  '  gl_FragColor = vec4(uColor * 0.25 + vec3(0.0, 0.015, 0.05), a);',
  '}',
].join('\n');
const DOME_RING_FS = [
  'uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uFall; varying vec2 vUv;',
  'void main(){',
  '  vec2 p = (vUv - 0.5) * 2.0; float rad = length(p) * 1.06; float ang = atan(p.y, p.x);',
  '  float ring = smoothstep(0.035, 0.0, abs(rad - 1.0));',
  '  float dash = 0.55 + 0.45 * sin(ang * 48.0 - uTime * 2.2);',
  '  float dash2 = 0.5 + 0.5 * sin(ang * 7.0 + uTime * 0.7);',
  '  float inner = smoothstep(1.0, 0.86, rad) * 0.10;',
  '  float pulse = 0.7 + 0.3 * sin(uTime * 1.8);',
  '  float a = (ring * (0.5 + 0.5 * dash) * (0.6 + 0.4 * dash2) * pulse + inner) * uOpacity * (1.0 - uFall);',
  '  if (a < 0.005) discard;',
  '  gl_FragColor = vec4(mix(uColor, vec3(1.0), ring * 0.35), a);',
  '}',
].join('\n');
const MOTE_VS = [
  'attribute float aSeed; attribute float aMax;',
  'uniform float uTime; uniform float uOpacity; uniform float uFall; varying float vA;',
  'void main(){',
  '  vec3 p = position;',
  '  p.y = mod(p.y + uTime * (2.0 + aSeed * 4.0), aMax);',
  '  p.x += sin(uTime * 0.3 + aSeed * 40.0) * 3.0; p.z += cos(uTime * 0.23 + aSeed * 55.0) * 3.0;',
  '  vA = smoothstep(0.0, 8.0, p.y) * smoothstep(aMax, aMax - 20.0, p.y) * uOpacity * (1.0 - uFall);',
  '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
  '  gl_PointSize = clamp((1.6 + aSeed * 2.4) * (240.0 / -mv.z), 0.5, 7.0);',
  '  gl_Position = projectionMatrix * mv;',
  '}',
].join('\n');
const MOTE_FS = [
  'varying float vA;',
  'void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, d) * vA * 0.5; if (a < 0.01) discard; gl_FragColor = vec4(0.55, 0.85, 1.0, a); }',
].join('\n');
const SHARD_VS = [
  'attribute vec3 aVel; attribute float aSeed;',
  'uniform float uT; varying float vK; varying float vA; varying float vRot;',
  'void main(){',
  '  float t = max(0.0, uT - aSeed * 0.5);',
  '  float life = 1.15 + fract(aSeed * 7.13) * 0.95; float k = clamp(t / life, 0.0, 1.0);',
  '  vec3 p = position + aVel * t + vec3(0.0, -11.0, 0.0) * t * t;',
  '  vK = k; vA = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.05, t);',
  '  vRot = aSeed * 6.2831 + t * (2.0 + aSeed * 5.0) * (fract(aSeed * 3.7) > 0.5 ? 1.0 : -1.0);',
  '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
  '  gl_PointSize = clamp((7.0 + fract(aSeed * 5.3) * 9.0) * (1.0 - k * 0.6) * (300.0 / -mv.z), 1.0, 42.0);',
  '  gl_Position = projectionMatrix * mv;',
  '}',
].join('\n');
const SHARD_FS = [
  'uniform vec3 uColor; varying float vK; varying float vA; varying float vRot;',
  'float hexDist(vec2 p){ p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }',
  'void main(){',
  '  vec2 q = gl_PointCoord - 0.5; float c = cos(vRot); float s = sin(vRot);',
  '  q = mat2(c, -s, s, c) * q * 2.0;',
  '  float d = hexDist(q);',
  '  float fill = smoothstep(0.92, 0.72, d);',
  '  float rim = smoothstep(0.92, 0.80, d) - smoothstep(0.72, 0.5, d);',
  '  vec3 col = mix(vec3(1.0, 0.82, 0.5), uColor, vK) * (0.7 + rim * 1.6);',
  '  float a = vA * fill; if (a < 0.01) discard;',
  '  gl_FragColor = vec4(col, a);',
  '}',
].join('\n');
const WAVE_FS = [
  'uniform float uW; uniform vec3 uColor; varying vec2 vUv;',
  'void main(){',
  '  vec2 p = (vUv - 0.5) * 2.0; float rad = length(p) * 1.35;',
  '  float front = uW * 1.32;',
  '  float qb = (rad - front) * 5.5; float band = exp(-qb * qb);',
  '  float trail = smoothstep(front, front - 0.35, rad) * 0.18;',
  '  float qd = (rad - front * 0.72) * 3.0; float dust = exp(-qd * qd) * 0.3;',
  '  float fade = pow(1.0 - uW, 1.4);',
  '  float a = (band * 1.1 + trail + dust) * fade;',
  '  if (a < 0.006) discard;',
  '  vec3 col = mix(vec3(1.0), uColor, clamp(rad * 0.8, 0.0, 1.0)) + vec3(0.45, 0.32, 0.18) * dust;',
  '  gl_FragColor = vec4(col, a);',
  '}',
].join('\n');
let domeVis = null, domeFall = 0;   // domeFall: the collapse animation after the dome is down (0 — none)
// the flash of the collapse: the light lives in the scene from the start (intensity 0, parked under the ground) —
// adding or removing a light mid-fight changes the light count and recompiles every shader of the city, a stall of
// many seconds; the game's other flashes (mp.js flashLight, the fire light of nades.js) live the same way
const domeLight = new THREE.PointLight(0xcfeaff, 0, 1300, 1.3);
domeLight.position.set(0, -500, 0); scene.add(domeLight);
const panOf = (x, z) => { const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz); return d > 0.01 ? Math.max(-1, Math.min(1, (Math.cos(P.yaw) * dx - Math.sin(P.yaw) * dz) / d)) : 0; };
// the materials live from the start and their shaders are warmed below while the page is still loading, before
// anyone joins a fight: a first compile in the middle of the prep would block the page for seconds and the server's
// heartbeat would drop the player. One dome at a time shares them; buildDome resets the uniforms.
const UV_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const domeU = {
  uTime: { value: 0 }, uOpacity: { value: 0 }, uRise: { value: 0 }, uFall: { value: 0 }, uHot: { value: 0 },
  uFlicker: { value: reduceMotion ? 0 : 1 }, uColor: { value: SHIELD.clone() }, uSquash: { value: 0.38 }, uHits: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, -10)) },
};
const shellMat = new THREE.ShaderMaterial({ uniforms: domeU, vertexShader: DOME_VS, fragmentShader: DOME_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const glassMat = new THREE.ShaderMaterial({ uniforms: { ...domeU }, vertexShader: DOME_VS, fragmentShader: GLASS_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const ringMat = new THREE.ShaderMaterial({ uniforms: { uColor: domeU.uColor, uTime: domeU.uTime, uOpacity: domeU.uOpacity, uFall: domeU.uFall }, vertexShader: UV_VS, fragmentShader: DOME_RING_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const moteMat = new THREE.ShaderMaterial({ uniforms: { uTime: domeU.uTime, uOpacity: domeU.uOpacity, uFall: domeU.uFall }, vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const shardMat = new THREE.ShaderMaterial({ uniforms: { uT: { value: -1 }, uColor: { value: SHIELD.clone() } }, vertexShader: SHARD_VS, fragmentShader: SHARD_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const waveMat = new THREE.ShaderMaterial({ uniforms: { uW: { value: 0 }, uColor: { value: SHIELD.clone() } }, vertexShader: UV_VS, fragmentShader: WAVE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
// no prewarm: on ANGLE/D3D11 a parallel compile of these programs saturates the GPU thread and every GL call of
// the city's own first frames queues behind it (the page freezes, the heartbeat drops the player). The shaders are
// kept cheap enough (one hex grid, no derivatives) that their first compile at the prep is a fraction of a second.
function buildDome(d) {
  clearDome();
  const gy = terrainH(d.cx, d.cz);
  const rise = Math.max(0, Math.min(1, d.rise || 0));
  domeU.uRise.value = rise; domeU.uFall.value = 0; domeU.uHot.value = 0; domeU.uOpacity.value = 0.9 * Math.min(1, rise * 3);
  for (const h of domeU.uHits.value) h.set(0, 0, 0, -10);
  shardMat.uniforms.uT.value = -1; waveMat.uniforms.uW.value = 0;
  const geo = new THREE.SphereGeometry(d.r, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2);
  const glass = new THREE.Mesh(geo, glassMat), shell = new THREE.Mesh(geo, shellMat);
  for (const m of [glass, shell]) { m.scale.y = 0.38; m.position.set(d.cx, gy - 3, d.cz); m.frustumCulled = false; m.userData.noProbe = true; scene.add(m); }   // a low shell over the ramparts, not a half-sphere to the sky
  glass.renderOrder = 14; shell.renderOrder = 15;
  // the base ring, laid on the terrain itself so it follows the ramparts' ground
  const R = d.r * 1.06, rg = new THREE.PlaneGeometry(R * 2, R * 2, 72, 72);
  rg.rotateX(-Math.PI / 2);
  const rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) rp.setY(i, terrainH(d.cx + rp.getX(i), d.cz + rp.getZ(i)) + 0.35 - gy);
  const ring = new THREE.Mesh(rg, ringMat);
  ring.position.set(d.cx, gy, d.cz); ring.renderOrder = 12; ring.frustumCulled = false; ring.userData.noProbe = true; scene.add(ring);
  // the motes: slow sparks drifting up inside the field, each under its own patch of shell
  const N = 220, mp = new Float32Array(N * 3), ms = new Float32Array(N), mm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, rr = d.r * 0.94 * Math.sqrt(Math.random());
    const top = 0.38 * Math.sqrt(Math.max(0, d.r * d.r - rr * rr)) * 0.9;
    mp[i * 3] = Math.cos(a) * rr; mp[i * 3 + 1] = Math.random() * top; mp[i * 3 + 2] = Math.sin(a) * rr;
    ms[i] = Math.random(); mm[i] = Math.max(12, top);
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
  mg.setAttribute('aMax', new THREE.BufferAttribute(mm, 1));
  const motes = new THREE.Points(mg, moteMat);
  motes.position.set(d.cx, gy - 3, d.cz); motes.renderOrder = 15; motes.frustumCulled = false; motes.userData.noProbe = true; scene.add(motes);
  domeLight.position.set(d.cx, gy + 70, d.cz); domeLight.distance = d.r * 2.6;
  domeVis = { d: { ...d }, gy, geo, glass, shell, ring, motes, u: domeU, hits: domeU.uHits.value, hitIdx: 0, rise, shards: null, wave: null };
}
// the burst: seven hundred hex plates torn off the shell, each with its own hour, toss and spin (GPU-ballistic)
function burstShards(dv) {
  const N = 700, { d, gy } = dv;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const y = 0.04 + 0.96 * Math.pow(Math.random(), 0.6);
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - y * y));
    const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
    pos[i * 3] = d.cx + dx * d.r; pos[i * 3 + 1] = gy - 3 + y * d.r * 0.38; pos[i * 3 + 2] = d.cz + dz * d.r;
    const sp = 7 + Math.random() * 16;
    vel[i * 3] = dx * sp + (Math.random() - 0.5) * 6; vel[i * 3 + 1] = y * sp * 0.5 + 3 + Math.random() * 7; vel[i * 3 + 2] = dz * sp + (Math.random() - 0.5) * 6;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  shardMat.uniforms.uT.value = -1;
  const points = new THREE.Points(g, shardMat);
  points.frustumCulled = false; points.userData.noProbe = true; points.renderOrder = 16; scene.add(points);
  dv.shards = { points, geo: g, mat: shardMat, t0: performance.now() + 320 };
}
function buildWave(dv) {
  const { d, gy } = dv, R = d.r * 1.35;
  const g = new THREE.PlaneGeometry(R * 2, R * 2); g.rotateX(-Math.PI / 2);
  waveMat.uniforms.uW.value = 0;
  const mesh = new THREE.Mesh(g, waveMat);
  mesh.position.set(d.cx, gy + 0.5, d.cz); mesh.renderOrder = 13; mesh.frustumCulled = false; mesh.userData.noProbe = true; scene.add(mesh);
  dv.wave = { mesh, geo: g, mat: waveMat };
}
function startFall() {
  domeFall = performance.now();
  if (CINE.mode) CINE.collapseAt = domeFall;   // the cinematic holds through the real fall, not the predicted one
  const dv = domeVis, { d, gy } = dv;
  burstShards(dv); buildWave(dv);
  const dd = Math.hypot(d.cx - P.x, d.cz - P.z);
  if (siegeAudio.down) siegeAudio.down(1.15, dd, panOf(d.cx, d.cz));
  quake(d.cx, gy + 40, d.cz, Math.pow(Math.max(0, 1 - dd / (d.r * 1.7)), 1.4) * 0.85);
  S.lastDome = { ...d };
}
function clearDome() {
  if (!domeVis) return;
  const dv = domeVis;
  for (const m of [dv.glass, dv.shell, dv.ring, dv.motes]) scene.remove(m);   // the materials stay: they are shared and prewarmed
  dv.geo.dispose(); dv.ring.geometry.dispose(); dv.motes.geometry.dispose();
  if (dv.shards) { scene.remove(dv.shards.points); dv.shards.geo.dispose(); }
  if (dv.wave) { scene.remove(dv.wave.mesh); dv.wave.geo.dispose(); }
  domeLight.intensity = 0;
  domeVis = null; domeFall = 0;
}
// a hit on the field (a bullet crossing it, a body thrown against it): a ripple spreads from the point, and a short
// electric slap is heard nearby. The ring buffer keeps the last six; the sound is rate-limited so a burst of pellets
// does not machine-gun the ear.
let lastHitSnd = 0;
export function domeHit(x, y, z, strength = 1) {
  if (!domeVis || domeFall) return;
  domeVis.hits[domeVis.hitIdx++ % 6].set(x, y, z, performance.now() / 1000);
  const now = performance.now();
  if (now - lastHitSnd > 90 && siegeAudio.hit) {
    const d = Math.hypot(x - P.x, z - P.z);
    if (d < 420) { lastHitSnd = now; siegeAudio.hit(Math.min(1, strength * (1 - d / 450)), panOf(x, z)); }
  }
}
// where a segment crosses the shell (the ellipsoid of the squashed hemisphere), or null: impacts.js asks for every
// tracer step, so a bystander's bullet splashes on the field exactly where it passes it
export function domeCross(ax, ay, az, bx, by, bz) {
  if (!domeVis || domeFall) return null;
  const { d, gy } = domeVis, y0 = gy - 3, ry = d.r * 0.38;
  const px = (ax - d.cx) / d.r, py = (ay - y0) / ry, pz = (az - d.cz) / d.r;
  const dx = (bx - ax) / d.r, dy = (by - ay) / ry, dz = (bz - az) / d.r;
  const A = dx * dx + dy * dy + dz * dz; if (A < 1e-12) return null;
  const B = 2 * (px * dx + py * dy + pz * dz), C = px * px + py * py + pz * pz - 1;
  const disc = B * B - 4 * A * C; if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t < 0 || t > 1) continue;
    const y = py + dy * t;
    if (y < 0 || y > domeVis.rise * 1.18) continue;
    return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
  }
  return null;
}

/* ---------- the collapse cinematic ----------
   One second before the dome falls the camera leaves the body — which stays where it stood, still and vulnerable —
   and glides to a high vantage outside the shell: the whole dome, the crown-down fracture, the rain of shards and
   the ground shockwave in one frame. It holds through the fall with a slow push-in, then glides back and hands the
   player his body. STATE.cine marks the show: input.js stops the mouse look, loop.js stops the walk, mp.js sends the
   body's coordinates to the server and hides the gun and the crosshair. reduceMotion skips it entirely. */
const CINE = { mode: 0, id: 0, t0: 0, dur: 1, from: null, body: null, vx: 0, vy: 0, vz: 0, vyaw: 0, vpitch: 0, cx: 0, cz: 0, gy: 0, r: 0, ang: 0, dist: 0, collapseAt: 0 };
export const siegeCine = { calm: null };   // mp.js wires it: still the firing hand and the scope when the camera leaves
export function siegeCineBody() { return CINE.body; }
export function siegeCineAbort() { cineEnd(); }
const ease = k => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;
const lerpAng = (a, b, k) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
function cineEnd() {
  if (!CINE.mode) return;
  Object.assign(P, CINE.body); P.fly = false; P.landH = 0;
  CINE.mode = 0; CINE.body = null; STATE.cine = false;
  document.body.classList.remove('cine');
  const c = $('cine'); if (c) c.hidden = true;
}
function cineStart(now, left) {
  const d = S.dome; if (!d) return;
  CINE.body = { x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch, eye: P.eye, up: P.up, vy: P.vy, vx: P.vx, vz: P.vz, kx: P.kx, kz: P.kz, crouch: P.crouch, fallTop: P.fallTop, land: P.land, walked: P.walked };
  CINE.id = S.id; CINE.collapseAt = 0;
  const gy = terrainH(d.cx, d.cz);
  let dx = P.x - d.cx, dz = P.z - d.cz, L = Math.hypot(dx, dz);
  if (L < 80) { dx = 0; dz = 1; L = 1; }   // a body at the centre: look from the staging side
  dx /= L; dz /= L;
  CINE.cx = d.cx; CINE.cz = d.cz; CINE.gy = gy; CINE.r = d.r;
  CINE.dist = d.r * 1.5; CINE.ang = Math.atan2(dz, dx);
  CINE.vx = d.cx + dx * CINE.dist; CINE.vz = d.cz + dz * CINE.dist; CINE.vy = gy + d.r * 0.42;   // low three-quarter aerial: the shell reads as a dome, not a flat ellipse
  const ty = gy + d.r * 0.20;
  CINE.vyaw = Math.atan2(-(d.cx - CINE.vx), -(d.cz - CINE.vz));
  CINE.vpitch = Math.atan2(ty - CINE.vy, Math.hypot(d.cx - CINE.vx, d.cz - CINE.vz));
  CINE.from = { x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch };
  CINE.mode = 1; CINE.t0 = now; CINE.dur = Math.max(350, Math.min(1000, left));
  STATE.cine = true; P.fly = true;
  document.body.classList.add('cine');
  const c = $('cine'); if (c) { c.hidden = false; $('cineCap').textContent = 'ШТУРМ ДИНАБУРГА · ПАДЕНИЕ КУПОЛА'; }
  if (siegeCine.calm) siegeCine.calm();
}
function cineTick(dt, now) {
  if (!CINE.mode) return;
  if (CINE.mode === 1) {   // glide out to the vantage, arriving as the overload begins
    const k = ease(Math.min(1, (now - CINE.t0) / CINE.dur));
    P.x = lerp(CINE.from.x, CINE.vx, k); P.y = lerp(CINE.from.y, CINE.vy, k); P.z = lerp(CINE.from.z, CINE.vz, k);
    P.yaw = lerpAng(CINE.from.yaw, CINE.vyaw, k); P.pitch = lerp(CINE.from.pitch, CINE.vpitch, k);
    if (k >= 1) { CINE.mode = 2; CINE.t0 = now; }
  } else if (CINE.mode === 2) {   // hold: a slow push-in and a whisper of orbit, so the frame is alive
    CINE.ang += dt * 0.02; CINE.dist = Math.max(CINE.r * 1.22, CINE.dist - dt * CINE.r * 0.05);
    P.x = CINE.cx + Math.cos(CINE.ang) * CINE.dist; P.z = CINE.cz + Math.sin(CINE.ang) * CINE.dist; P.y = CINE.vy;
    const ty = CINE.gy + CINE.r * 0.20;
    P.yaw = Math.atan2(-(CINE.cx - P.x), -(CINE.cz - P.z)); P.pitch = Math.atan2(ty - P.y, Math.hypot(CINE.cx - P.x, CINE.cz - P.z));
    const since = CINE.collapseAt ? now - CINE.collapseAt : now - CINE.t0;
    if (since >= (CINE.collapseAt ? 2400 : 3600)) { CINE.mode = 3; CINE.t0 = now; CINE.dur = 900; CINE.from = { x: P.x, y: P.y, z: P.z, yaw: P.yaw, pitch: P.pitch }; }
  } else {   // glide home and hand the body back
    const k = ease(Math.min(1, (now - CINE.t0) / CINE.dur)), b = CINE.body;
    P.x = lerp(CINE.from.x, b.x, k); P.y = lerp(CINE.from.y, b.y, k); P.z = lerp(CINE.from.z, b.z, k);
    P.yaw = lerpAng(CINE.from.yaw, b.yaw, k); P.pitch = lerp(CINE.from.pitch, b.pitch, k);
    if (k >= 1) cineEnd();
  }
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
  if (wantDome && (!domeVis || domeFall)) {
    buildDome(wantDome);
    if (siegeAudio.up) siegeAudio.up(0.9, Math.hypot(wantDome.cx - P.x, wantDome.cz - P.z), panOf(wantDome.cx, wantDome.cz));
  }
  if (!wantDome && domeVis && !domeFall && prevPhase === 'prep') startFall();   // the assault: the dome collapses
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
  siegeCineAbort(); clearDome(); clearAltar();
  S.on = false; S.mySide = null; S.prog = 0; S.contest = null; S.dome = null; S.lastDome = null;
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
    const dv = domeVis, u = dv.u;
    u.uTime.value = t;
    if (domeFall) {
      // the fall, 2.5 s: overload (0–0.35) → the plates fail crown-down (0.32–1.17) → the shards rain and the
      // shockwave rings the ramparts (0.45–1.3) → the last embers and the ring die (to 2.5)
      const age = (now - domeFall) / 1000;
      u.uHot.value = age < 0.35 ? age / 0.35 : Math.max(0, 1 - (age - 0.35) * 3);
      const f = Math.min(1, Math.max(0, (age - 0.32) / 1.0));
      u.uFall.value = f * f * (3 - 2 * f);
      u.uOpacity.value = 0.9;
      if (dv.shards) dv.shards.mat.uniforms.uT.value = (now - dv.shards.t0) / 1000;
      if (dv.wave) dv.wave.mat.uniforms.uW.value = Math.min(1, Math.max(0, (age - 0.5) / 1.1));
      domeLight.intensity = age > 0.4 && age < 1.8 ? 5200 * Math.exp(-(age - 0.4) * 5.0) : 0;
      if (age > 2.8) clearDome();
    } else {
      dv.rise = Math.min(1, dv.rise + dt * 0.75);
      u.uRise.value = dv.rise;
      u.uOpacity.value = 0.9 * Math.min(1, dv.rise * 3);
    }
  }
  // the collapse cinematic: leave the body a second before the fall, hold through it, glide home
  if (!CINE.mode && S.phase === 'prep' && S.dome && !reduceMotion && STATE.mp && !STATE.mpDead) {
    const left = S.left - (now - S.recvAt);
    if (left <= 1000 && left > -400 && CINE.id !== S.id && Math.hypot(S.dome.cx - P.x, S.dome.cz - P.z) < S.dome.r * 1.6) cineStart(now, left);   // only the fighters and the near bystanders: a far watcher keeps his own view
  }
  cineTick(dt, now);
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
  if (S.phase === 'assault' && S.lastDome && domeFall) {   // the fall: the ring flashes hot and dissolves outward
    const age = (performance.now() - domeFall) / 1000;
    if (age < 1.6) {
      const k = age / 1.6, x = w / 2 + (S.lastDome.cx - cx) * ppm, y = h / 2 + (S.lastDome.cz - cz) * ppm, r = S.lastDome.r * ppm * (1 + k * 0.12);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
      ctx.strokeStyle = 'rgba(255,' + Math.round(230 - 120 * k) + ',' + Math.round(180 - 100 * k) + ',' + (0.9 * (1 - k)).toFixed(2) + ')';
      ctx.lineWidth = 2.5 * (1 - k) + 0.5; ctx.stroke();
    }
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
