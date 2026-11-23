/* The «Царь горы» event on the page (server/game.mjs owns the rules, HOLY in server/combat.mjs): the four temples of
   Church Hill become capture points for a few minutes. Nobody is carried there — the players find their own way, so the
   picture is also the way: from anywhere in the city the four columns of light over the temples and the crown of light
   over the hill show where the race is, and an arrow at the screen edge and on the minimap points there.
   Beside each temple stands an altar — a small stone belfry in the manner of its confession (the Orthodox blue tent
   under a gilded onion, the Catholic dark bulb, the Lutheran spire, the Old Believers' red drum) with a bronze bell
   that swings when the altar is taken, lanterns and four banners on the edge of the ring in the holder's colour.
   The capture ring lies on the slope itself (the terrain height in its shader); it fills as a side stands in it,
   golden motes rise inside, and a taken altar sends a wave across the ground. Arcs of light join every taken altar to
   the crown; when one side holds all four the crown burns in its colour and fills as the hold runs out.
   The HUD: the four chips (the buff of each altar, its holder, the capture), the hold countdown, the buffs you hold,
   the distance to the hill while you are away, and the note that you are in the race (the first altar you take
   enlists you: after a death you may come back by the hill — mp.js puts that choice first). The world labels, the
   bell flashes on the minimap and the golden flash of the grand prize. The bells themselves are synthesised
   (sfx.js bellSound) and wired by mp.js through holyAudio; the player dots stay with mp.js. The rules, the capture and
   the prize are the server's — this is the picture. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STATE } from '../core/state.js';
import { P } from './player.js';
import { camera, scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { terrainH } from '../world/terrain.js';
import { $, reduceMotion } from '../core/env.js';
import { HOLY } from '../../server/combat.mjs';

const S = { on: false, id: 0, points: [], hold: null, left: 0, recvAt: 0, capR: HOLY.capR, capMs: HOLY.capMs, holdMs: HOLY.holdMs, buffs: { ...HOLY.buffs }, buffName: { ...HOLY.buffName }, flashes: [], hill: { ...HOLY.hill }, enlisted: 0, crown: null };   // buffs and their labels come with the 'holy' message: the admin panel can tune them live (server/events.mjs)
let ME = { unit: '' };   // the unit of the server (unitOf in game.mjs): the own team of the players, or the player alone
export function holyMe(unit) { ME = { unit }; }
export const holyAudio = { bell: null };   // mp.js wires it to the game's one audio context (bellSound)
const NEUTRAL = new THREE.Color('#ffd47a'), GOLD = new THREE.Color('#ffb02e'), RUST = new THREE.Color('#e8452c'), CLOTH = new THREE.Color('#efe6d2');
function ownerColor(owner) {   // no sides: an altar is yours (your team's) in gold, a rival's in red, nobody's pale gold
  if (!owner) return NEUTRAL;
  return owner === ME.unit ? GOLD : RUST;
}
const myBuffs = () => { const b = {}; if (S.on) for (const pt of S.points) if (pt.owner === ME.unit) b[HOLY.temples[pt.i].buff] = true; return b; };
export function holySpeedMul() { return myBuffs().speed ? S.buffs.speed : 1; }
// the confession of each temple decides the roof of its altar (the order of HOLY.temples)
const STYLE = ['orth', 'cath', 'luth', 'old'];
const ICO = { dmg: 'M6 3l12 12M18 3L6 15M4 17l3 3M17 4l3 3', regen: 'M12 5v14M5 12h14', speed: 'M13 2 4.5 13.5H11L9.5 22 19 10h-6.5z', reload: 'M4 12a8 8 0 1 1 2.3 5.7M4 12V7m0 5h5' };
const BEAM_H = 150, CROWN_H = 80, CROWN_S = 1.5, ARC_H = 58;   // the column of light over an altar, the crown over the hill (and its scale), where the arcs leave the columns

/* ---------- the shaders ---------- */
// the column of light: soft sides (it is light, not a tube), brighter at the foot, bands rising up it
const BEAM_VS = 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }';
const BEAM_FS = [
  'uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uFlash; uniform float uSpeed;',
  'varying vec2 vUv; varying vec3 vN; varying vec3 vV;',
  'void main(){',
  '  float fall = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.025, vUv.y);',
  '  float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.8);',
  '  float bands = 0.7 + 0.3 * sin(vUv.y * 70.0 - uTime * uSpeed);',
  '  float a = (uOpacity * bands + uFlash * 0.9) * fall * edge;',
  '  gl_FragColor = vec4(uColor * (1.0 + uFlash * 0.6), a);',
  '}',
].join('\n');
// the ring on the ground: draped over the slope by the terrain height of the city (terrain.js puts terrainH into the
// common chunk, and onBeforeCompile hands every material its textures); the rim, the ticks, the capture arc, the
// eight-pointed star, the faint fill and the wave of a capture
const RING_VS = [
  '#include <common>',
  'uniform vec2 uC; varying vec2 vP;',
  'void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xz - uC; wp.y = terrainH(wp.xz) + 0.16; gl_Position = projectionMatrix * viewMatrix * wp; }',
].join('\n');
const RING_FS = [
  'uniform vec3 uColor; uniform vec3 uProgColor; uniform float uProg; uniform float uTime; uniform float uContest; uniform float uOwner; uniform float uR; uniform float uWave;',
  'varying vec2 vP;',
  'float ln(float d, float w){ float f = fwidth(d) + 0.015; return 1.0 - smoothstep(w, w + f, abs(d)); }',
  'void main(){',
  '  float r = length(vP), a = atan(vP.x, -vP.y), a01 = fract(a / 6.28318);',
  '  float R = uR, pulse = 0.72 + 0.28 * sin(uTime * 2.4);',
  '  float rim = ln(r - R, 0.2) * (0.75 + 0.25 * pulse) + ln(r - (R - 0.75), 0.06) * 0.55;',
  '  float tick = step(fract(a01 * 36.0 + uTime * 0.02), 0.22) * step(R + 0.45, r) * step(r, R + 1.35);',
  '  float bandM = step(R - 2.0, r) * step(r, R - 1.15);',
  '  float filled = bandM * step(a01, uProg);',
  '  float star = pow(abs(cos(a * 4.0 + uTime * 0.12)), 5.0);',
  '  float starLn = ln(r - mix(R * 0.26, R * 0.6, star), 0.09) * step(r, R * 0.62);',
  '  float inner = ln(r - R * 0.26, 0.07) + ln(r - R * 0.66, 0.05) * 0.7;',
  '  float fill = step(r, R) * (0.05 + 0.09 * smoothstep(0.0, R, r)) * (0.6 + 0.8 * uOwner);',
  '  float w = uWave, rw = R * (1.0 + 1.7 * w);',
  '  float wave = w > 0.0 ? ln(r - rw, 0.25 + 1.6 * w) * (1.0 - w) : 0.0;',
  '  float flick = uContest > 0.5 ? 0.5 + 0.5 * sin(uTime * 13.0) : 1.0;',
  '  float base = (rim * (0.55 + 0.35 * uOwner) + tick * 0.45 + starLn * 0.32 + inner * 0.3 + fill + bandM * 0.1) * flick;',
  '  vec3 col = uColor * base + uProgColor * filled * 0.95 + uColor * wave * 1.2;',
  '  float alpha = clamp(base + filled * 0.9 + wave, 0.0, 1.0);',
  '  if (alpha < 0.01) discard;',
  '  gl_FragColor = vec4(col / max(alpha, 0.001), alpha);',
  '}',
].join('\n');
// the motes rising inside the ring: a fixed spot each (the base height follows the slope), a sway and a rise
const MOTE_VS = [
  'attribute vec4 aSeed; uniform float uTime; uniform float uSpeed; uniform float uSize; uniform float uH; varying float vA;',
  'void main(){',
  '  float ph = aSeed.w, h = mod(uTime * uSpeed * (0.6 + 0.4 * fract(ph * 7.13)) + ph * uH, uH);',
  '  vec3 p = vec3(aSeed.x + sin(uTime * 0.7 + ph * 6.0) * 0.4, aSeed.z + h, aSeed.y + cos(uTime * 0.6 + ph * 5.0) * 0.4);',
  '  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;',
  '  gl_PointSize = uSize * (0.6 + 0.8 * fract(ph * 3.7)) * 300.0 / max(1.0, -mv.z);',
  '  float k = h / uH; vA = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.55, 1.0, k));',
  '}',
].join('\n');
const MOTE_FS = 'uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float g = pow(max(0.0, 1.0 - d * 2.0), 2.0); gl_FragColor = vec4(uColor * (1.0 + g), g * vA * uOpacity); }';
// the crown over the hill and the arcs to it: light with a rim (the fresnel of the view), the crown filled from below
// as the hold runs, pulses flowing along the arcs towards the crown
const HOLO_VS = 'varying vec3 vN; varying vec3 vV; varying vec3 vL; varying vec2 vUv; void main(){ vUv = uv; vL = position; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }';
const CROWN_FS = [
  'uniform vec3 uColor; uniform float uTime; uniform float uGlow; uniform float uFill;',
  'varying vec3 vN; varying vec3 vV; varying vec3 vL;',
  'void main(){',
  '  float rim = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.0);',
  '  float scan = 0.8 + 0.2 * sin(vL.y * 3.0 - uTime * 2.0);',
  '  float filled = step(vL.y, mix(-2.4, 9.0, uFill)) * step(0.001, uFill);',
  '  float a = (0.32 + 0.6 * rim) * scan * uGlow + filled * (0.3 + 0.3 * rim);',
  '  gl_FragColor = vec4(uColor * (0.8 + 0.5 * rim + filled * 0.6), clamp(a, 0.0, 0.95));',
  '}',
].join('\n');
const ARC_FS = [
  'uniform vec3 uColor; uniform float uTime; uniform float uOn;',
  'varying vec3 vN; varying vec3 vV; varying vec2 vUv;',
  'void main(){',
  '  float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.2);',
  '  float pulse = smoothstep(0.75, 1.0, fract(vUv.x * 5.0 - uTime * 0.9));',
  '  float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);',
  '  float a = uOn * (0.35 + 0.65 * pulse) * (0.35 + 0.65 * edge) * ends;',
  '  if (a < 0.005) discard;',
  '  gl_FragColor = vec4(uColor * (0.9 + 0.6 * pulse), a);',
  '}',
].join('\n');
const glow = (vs, fs, uniforms, extra) => new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...extra });   // light: added to what is behind (the bright core, the motes)
const tint = (vs, fs, uniforms, extra) => glow(vs, fs, uniforms, { blending: THREE.NormalBlending, ...extra });   // coloured light that keeps its colour against a bright day sky (the halo, the crown, the arcs)

/* ---------- the altar: stone, roof, gilding (made once, shared by the four and kept for the next race) ---------- */
let MAT = null;
function mats() {
  if (MAT) return MAT;
  const std = (color, roughness, metalness = 0, emissive = 0) => { const m = worldSpace(new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive })); m.userData.shared = true; return m; };
  MAT = {
    stone: std(0xe2d9c8, 0.9), plinth: std(0x9d9486, 0.95), wood: std(0x4a3220, 0.8),
    gold: std(0xe6b54a, 0.3, 1, 0x2a1800),
    roof: { orth: std(0x3f86bd, 0.45, 0.3), cath: std(0x343a40, 0.5, 0.5), luth: std(0x4b545c, 0.55, 0.35), old: std(0x2f6e5a, 0.5, 0.3) },
    drum: { orth: std(0x3f86bd, 0.5, 0.2), cath: std(0xe2d9c8, 0.9), luth: std(0x4b545c, 0.55, 0.35), old: std(0xb3362c, 0.6) },
  };
  return MAT;
}
// the gilded onion (radius s), standing on y
function onion(s, y) {
  const prof = [[0.02, 0], [0.5, 0.04], [0.92, 0.32], [1.0, 0.58], [0.84, 0.92], [0.5, 1.22], [0.18, 1.5], [0.06, 1.75], [0.02, 1.82]].map(([x, v]) => new THREE.Vector2(x * s, v * s));
  return new THREE.LatheGeometry(prof, 18).translate(0, y, 0);
}
// a cross on y (the foot): the Orthodox one has the slanted foot bar
function cross(y, orth, out) {
  out.push(new THREE.BoxGeometry(0.11, 1.35, 0.11).translate(0, y + 0.67, 0));
  out.push(new THREE.BoxGeometry(0.72, 0.1, 0.1).translate(0, y + 0.98, 0));
  if (orth) { out.push(new THREE.BoxGeometry(0.42, 0.08, 0.08).translate(0, y + 1.2, 0)); out.push(new THREE.BoxGeometry(0.5, 0.08, 0.08).rotateZ(-0.38).translate(0, y + 0.42, 0)); }
}
// the static body of one altar in its local frame (y = 0 is the ground at its middle): the parts grouped by material
// and merged, a few draw calls an altar. The banner poles stand on the slope round the ring (lift: the ground there)
function altarBody(style, poles) {
  const M = mats(), parts = { stone: [], plinth: [], wood: [], gold: [], roof: [], drum: [] };
  const box = (k, sx, sy, sz, x, y, z, ry = 0) => parts[k].push(new THREE.BoxGeometry(sx, sy, sz).rotateY(ry).translate(x, y, z));
  // the platform: a low octagon of two steps (the altar is walked into: it has no body), sunk into the slope so that
  // no side floats
  parts.plinth.push(new THREE.CylinderGeometry(3.7, 3.95, 2.3, 8).rotateY(Math.PI / 8).translate(0, -1.0, 0));
  parts.stone.push(new THREE.CylinderGeometry(2.95, 3.1, 0.25, 8).rotateY(Math.PI / 8).translate(0, 0.27, 0));
  // four pillars with their bases and capitals
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * 1.55, z = sz * 1.55;
    box('stone', 0.64, 0.3, 0.64, x, 0.55, z); box('stone', 0.42, 3.82, 0.42, x, 2.61, z); box('stone', 0.62, 0.26, 0.62, x, 4.62, z);
  }
  // the entablature, the cornice and the beam the bell hangs from
  for (const s of [1, -1]) { box('stone', 3.95, 0.5, 0.52, 0, 4.98, s * 1.55); box('stone', 0.52, 0.5, 3.95, s * 1.55, 4.98, 0); }
  box('stone', 4.4, 0.22, 4.4, 0, 5.34, 0);
  box('wood', 3.2, 0.26, 0.26, 0, 4.62, 0);
  // the lantern posts on the step between the pillars
  for (const [x, z] of [[2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]]) box('stone', 0.2, 0.55, 0.2, x, 0.675, z);
  // the roof by the confession, standing on the cornice (y 5.45)
  if (style === 'orth') {   // the blue tent, a drum, the gilded onion, the Orthodox cross
    parts.roof.push(new THREE.ConeGeometry(2.75, 3.4, 4).rotateY(Math.PI / 4).translate(0, 7.15, 0));
    parts.drum.push(new THREE.CylinderGeometry(0.42, 0.46, 0.75, 14).translate(0, 8.95, 0));
    parts.gold.push(onion(0.62, 9.3)); cross(10.4, true, parts.gold);
  } else if (style === 'cath') {   // a low drum, the dark bulb, the lantern and its spire
    parts.drum.push(new THREE.CylinderGeometry(1.9, 2.05, 0.7, 20).translate(0, 5.8, 0));
    parts.roof.push(new THREE.SphereGeometry(1.75, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1).translate(0, 6.15, 0));
    parts.drum.push(new THREE.CylinderGeometry(0.42, 0.42, 0.8, 10).translate(0, 8.75, 0));
    parts.roof.push(new THREE.ConeGeometry(0.5, 1.5, 10).translate(0, 9.9, 0));
    parts.gold.push(new THREE.SphereGeometry(0.18, 10, 8).translate(0, 10.7, 0)); cross(10.75, false, parts.gold);
  } else if (style === 'luth') {   // the slim octagonal spire of grey metal with four little gables at its foot
    parts.roof.push(new THREE.ConeGeometry(1.9, 6.6, 8).rotateY(Math.PI / 8).translate(0, 8.75, 0));
    for (let k = 0; k < 4; k++) parts.roof.push(new THREE.ConeGeometry(0.9, 1.5, 3).rotateX(-0.25).rotateY(k * Math.PI / 2).translate(Math.sin(k * Math.PI / 2) * 1.75, 6.15, Math.cos(k * Math.PI / 2) * 1.75));
    parts.gold.push(new THREE.SphereGeometry(0.2, 10, 8).translate(0, 12.1, 0)); cross(12.2, false, parts.gold);
  } else {   // the Old Believers: a low green tent, the red drum, the large gilded onion
    parts.roof.push(new THREE.ConeGeometry(2.75, 1.7, 4).rotateY(Math.PI / 4).translate(0, 6.3, 0));
    parts.drum.push(new THREE.CylinderGeometry(0.78, 0.8, 1.5, 16).translate(0, 7.6, 0));
    parts.gold.push(onion(1.0, 8.3)); cross(10.05, true, parts.gold);
  }
  // the banner poles round the ring, each on the ground under it, with a crossbar and a gilded knob
  for (const pl of poles) {
    parts.wood.push(new THREE.CylinderGeometry(0.07, 0.1, 7.2, 7).translate(pl.x, pl.y + 3.4, pl.z));
    parts.gold.push(new THREE.SphereGeometry(0.16, 10, 8).translate(pl.x, pl.y + 7.1, pl.z));
  }
  const top = { orth: 11.8, cath: 12.2, luth: 13.6, old: 11.5 }[style];
  const meshes = [];
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const geo = mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)));
    list.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geo, k === 'roof' || k === 'drum' ? M[k][style] : M[k]);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.noProbe = true;
    meshes.push(mesh);
  }
  return { meshes, top };
}
// the bell: bronze, open at the mouth, a clapper inside; it hangs from the beam (the pivot swings)
function makeBell() {
  const prof = [[0.05, 0], [0.74, 0], [0.78, 0.08], [0.66, 0.42], [0.47, 0.86], [0.4, 1.12], [0.18, 1.3], [0.04, 1.36]].map(([x, y]) => new THREE.Vector2(x * 1.1, y * 1.1));
  const mat = worldSpace(new THREE.MeshStandardMaterial({ color: 0xb8893a, roughness: 0.32, metalness: 0.9, emissive: 0x000000, side: THREE.DoubleSide }));
  const pivot = new THREE.Group(); pivot.position.y = 4.48;
  const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), mat); bell.position.y = -1.5; bell.castShadow = true; pivot.add(bell);
  const clap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat); clap.position.y = -1.32; pivot.add(clap);
  pivot.traverse(o => { o.userData.noProbe = true; });
  return { pivot, mat };
}
// a banner on its pole: a cloth swallow-tailed at the free end; the wave is moved on the CPU (a few dozen vertices) so
// that the lit material of the city (day and night) keeps its light
function makeBanner(mat) {
  const W = 1.35, Hh = 2.3, geo = new THREE.PlaneGeometry(W, Hh, 8, 8);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + W / 2, y = pos.getY(k);
    const v = (y + Hh / 2) / Hh, notch = x > W * 0.99 ? 0.42 * (1 - Math.abs(v - 0.5) * 2) : 0;
    pos.setXYZ(k, x - notch, y, 0);
  }
  geo.userData.base = Float32Array.from(pos.array);
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.userData.noProbe = true;
  return m;
}
function waveBanner(m, t, ph) {
  const pos = m.geometry.attributes.position, b = m.geometry.userData.base;
  for (let k = 0; k < pos.count; k++) {
    const x = b[k * 3], y = b[k * 3 + 1], kx = x / 1.35;
    pos.setZ(k, (Math.sin(t * 2.4 + ph - x * 2.3 + y * 0.6) * 0.24 + Math.sin(t * 3.7 + ph + y * 1.8) * 0.06) * kx);
  }
  pos.needsUpdate = true; m.geometry.computeVertexNormals();
}

/* ---------- one altar ---------- */
function buildPoint(pt) {
  const g = new THREE.Group(), gy = terrainH(pt.x, pt.z), R = S.capR, style = STYLE[pt.i] || 'orth';
  g.position.set(pt.x, gy, pt.z); g.userData.noProbe = true;
  // the four banner poles at the diagonals of the ring, each on its own ground
  const poles = [0, 1, 2, 3].map(k => { const a = Math.PI / 4 + k * Math.PI / 2, x = Math.cos(a) * (R + 0.6), z = Math.sin(a) * (R + 0.6); return { x, z, y: terrainH(pt.x + x, pt.z + z) - gy, a }; });
  const body = altarBody(style, poles);
  for (const m of body.meshes) g.add(m);
  const bell = makeBell(); g.add(bell.pivot);
  // the lanterns: small glowing lamps in the holder's colour
  const lampMat = new THREE.MeshBasicMaterial({ color: NEUTRAL.clone() });
  const lampGeo = mergeGeometries([[2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]].map(([x, z]) => new THREE.BoxGeometry(0.26, 0.34, 0.26).translate(x, 1.12, z)));
  const lamps = new THREE.Mesh(lampGeo, lampMat); lamps.userData.noProbe = true; g.add(lamps);
  // the banners
  const clothMat = worldSpace(new THREE.MeshStandardMaterial({ color: CLOTH.clone(), roughness: 0.85, side: THREE.DoubleSide, emissive: 0x000000 }));
  const banners = poles.map(pl => { const b = makeBanner(clothMat); b.position.set(pl.x, pl.y + 5.6, pl.z); b.rotation.y = -pl.a + Math.PI / 2; g.add(b); return b; });
  // the column of light from the cross into the sky: a bright core and a wide soft glow
  const beamU = () => ({ uColor: { value: NEUTRAL.clone() }, uTime: { value: 0 }, uOpacity: { value: 0.3 }, uFlash: { value: 0 }, uSpeed: { value: 2.2 } });
  const beamOpt = { depthTest: false, side: THREE.DoubleSide };
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, BEAM_H, 16, 1, true), glow(BEAM_VS, BEAM_FS, beamU(), beamOpt));
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 5.6, BEAM_H, 24, 1, true), tint(BEAM_VS, BEAM_FS, beamU(), beamOpt));
  for (const b of [core, halo]) { b.position.y = body.top + BEAM_H / 2; b.renderOrder = 20; b.frustumCulled = false; b.userData.noProbe = true; g.add(b); }
  // the ring on the slope, wide enough for the wave of a capture
  const half = R * 2.9 + 1, ringGeo = new THREE.PlaneGeometry(half * 2, half * 2, 64, 64).rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Vector2(pt.x, pt.z) }, uColor: { value: NEUTRAL.clone() }, uProgColor: { value: NEUTRAL.clone() }, uProg: { value: 0 }, uTime: { value: 0 }, uContest: { value: 0 }, uOwner: { value: 0 }, uR: { value: R }, uWave: { value: 0 } },
    vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  ring.position.set(pt.x, 0, pt.z); ring.renderOrder = 3; ring.frustumCulled = false; ring.userData.noProbe = true;
  scene.add(ring);
  // the motes: a fixed spot each inside the ring, their base on the slope
  const N = 80, seed = new Float32Array(N * 4);
  for (let k = 0; k < N; k++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * R * 0.92, x = Math.cos(a) * r, z = Math.sin(a) * r; seed.set([x, z, terrainH(pt.x + x, pt.z + z) - gy + 0.2, Math.random()], k * 4); }
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const motes = new THREE.Points(moteGeo, glow(MOTE_VS, MOTE_FS, { uColor: { value: NEUTRAL.clone() }, uTime: { value: 0 }, uSpeed: { value: 0.9 }, uSize: { value: 0.55 }, uH: { value: 9 }, uOpacity: { value: 0.7 } }));
  motes.frustumCulled = false; motes.userData.noProbe = true; g.add(motes);
  scene.add(g);
  const label = document.createElement('div'); label.className = 'holy-label'; label.hidden = true; $('mpTags').append(label);
  return { group: g, ring, core, halo, bell: bell.pivot, bellMat: bell.mat, lamps, lampMat, clothMat, banners, motes, label, gy, top: body.top, col: NEUTRAL.clone(), cloth: CLOTH.clone(), dispProg: 0, swing: 0, flash: 0, wave: 0, burst: 0 };
}
/* ---------- the crown over the hill and the arcs to it ---------- */
function crownGeo() {
  const parts = [new THREE.CylinderGeometry(9, 9, 3.2, 56, 1, true), new THREE.TorusGeometry(9, 0.55, 8, 56).rotateX(Math.PI / 2).translate(0, -1.6, 0), new THREE.TorusGeometry(9, 0.4, 8, 56).rotateX(Math.PI / 2).translate(0, 1.6, 0)];
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, b = a + Math.PI / 8;
    parts.push(new THREE.ConeGeometry(1.25, 6.2, 10).translate(Math.cos(a) * 9, 4.7, Math.sin(a) * 9));
    parts.push(new THREE.SphereGeometry(0.85, 12, 8).translate(Math.cos(a) * 9, 8.4, Math.sin(a) * 9));
    parts.push(new THREE.ConeGeometry(0.7, 3.0, 8).translate(Math.cos(b) * 9, 3.1, Math.sin(b) * 9));
  }
  return mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g)));
}
function buildCrown() {
  const H = S.hill, cy = terrainH(H.cx, H.cz) + CROWN_H;
  const crown = new THREE.Mesh(crownGeo(), tint(HOLO_VS, CROWN_FS, { uColor: { value: NEUTRAL.clone() }, uTime: { value: 0 }, uGlow: { value: 0.6 }, uFill: { value: 0 } }, { side: THREE.DoubleSide }));
  crown.position.set(H.cx, cy, H.cz); crown.scale.setScalar(CROWN_S); crown.renderOrder = 21; crown.frustumCulled = false; crown.userData.noProbe = true;
  scene.add(crown);
  const arcs = S.points.map(pt => {
    const vis = pt.vis, ax = pt.x, az = pt.z, ay = vis.gy + vis.top + ARC_H;
    const dx = ax - H.cx, dz = az - H.cz, l = Math.hypot(dx, dz) || 1;
    const end = new THREE.Vector3(H.cx + dx / l * 9.2 * CROWN_S, cy - 1.6 * CROWN_S, H.cz + dz / l * 9.2 * CROWN_S), start = new THREE.Vector3(ax, ay, az);
    const mid = start.clone().add(end).multiplyScalar(0.5); mid.y = Math.max(start.y, end.y) + 22;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 48, 0.8, 8, false), tint(HOLO_VS, ARC_FS, { uColor: { value: NEUTRAL.clone() }, uTime: { value: 0 }, uOn: { value: 0 } }, { side: THREE.DoubleSide }));
    tube.renderOrder = 21; tube.frustumCulled = false; tube.userData.noProbe = true; scene.add(tube);
    return tube;
  });
  S.crown = { crown, arcs, col: NEUTRAL.clone(), glow: 0.6, fill: 0 };
}
function build() {
  for (const pt of S.points) if (!pt.vis) pt.vis = buildPoint(pt);
  if (!S.crown && S.points.length && S.points.every(pt => pt.vis)) buildCrown();
}
function drop(o) {
  scene.remove(o);
  o.traverse(x => { if (x.geometry) x.geometry.dispose(); const ms = x.material ? (Array.isArray(x.material) ? x.material : [x.material]) : []; for (const m of ms) if (!m.userData.shared) m.dispose(); });
}
function clearHoly() {
  for (const pt of S.points) if (pt.vis) { drop(pt.vis.group); drop(pt.vis.ring); pt.vis.label.remove(); pt.vis = null; }
  if (S.crown) { drop(S.crown.crown); for (const a of S.crown.arcs) drop(a); S.crown = null; }
  S.on = false; S.points = []; S.hold = null; S.flashes = []; S.enlisted = 0;
  $('holyHud').hidden = true; $('holyFlash').hidden = true; $('holyPoint').hidden = true; $('holyIn').hidden = true;
  document.body.classList.remove('holy');
}

/* ---------- the state from the server ---------- */
export function setHoly(m) {
  if (!m) return;
  const first = !S.on || S.id !== m.id;
  if (S.on && S.id !== m.id) clearHoly();
  S.on = true; S.id = m.id; S.left = m.left; S.recvAt = performance.now(); S.capR = m.capR; S.capMs = m.capMs; S.holdMs = m.holdMs; S.hold = m.hold;
  if (m.buffs) S.buffs = m.buffs;
  if (m.buffName) S.buffName = m.buffName;
  if (m.hill) S.hill = m.hill;
  const byI = new Map(S.points.map(pt => [pt.i, pt]));
  S.points = m.points.map(p => { const old = byI.get(p.i); return { ...p, vis: old ? old.vis : null }; });
  build();
  $('holyHud').hidden = false; document.body.classList.add('holy');
  if (first) buildChips();
  paintChips();
}
// the first altar taken enlisted me in the race (server 'holyIn'): a death may bring me back by the hill
export function holyEnlist(m) { if (S.on && m && m.id === S.id) { S.enlisted = m.id; $('holyIn').hidden = false; } }
export const holyEnlisted = () => S.on && S.enlisted === S.id;
function buildChips() {
  const box = $('holyPoints'); box.textContent = '';
  for (const tp of HOLY.temples) {
    const chip = document.createElement('div'); chip.className = 'holy-chip';
    chip.title = tp.name + ' · ' + tp.faith + ' · ' + (S.buffName[tp.buff] || HOLY.buffName[tp.buff]);
    chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICO[tp.buff] + '"/></svg><b></b><small class="holy-who"></small><div class="holy-prog"><i></i></div>';
    chip.querySelector('b').textContent = tp.short;
    box.append(chip);
  }
}
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtD = d => (d < 1000 ? Math.max(10, Math.round(d / 10) * 10) + ' м' : (d / 1000).toFixed(1).replace('.', ',') + ' км');
const hex = c => '#' + c.getHexString();
function paintChips() {
  const chips = $('holyPoints').children;
  for (let i = 0; i < S.points.length && i < chips.length; i++) {
    const pt = S.points[i], chip = chips[i], col = ownerColor(pt.owner);
    chip.classList.toggle('owned', !!pt.owner);
    chip.classList.toggle('mine', !!pt.owner && pt.owner === ME.unit);
    chip.classList.toggle('rival', !!pt.owner && pt.owner !== ME.unit);
    chip.classList.toggle('contest', !!pt.contest);
    chip.style.setProperty('--own', hex(col));
    const who = pt.contest ? 'спор' : !pt.owner ? 'свободен' : pt.owner === ME.unit ? 'ваш' : (pt.name || 'соперник');
    const w = chip.querySelector('.holy-who'); if (w.textContent !== who) w.textContent = who;
    const fill = chip.querySelector('.holy-prog i');
    fill.style.width = (pt.prog * 100).toFixed(0) + '%';
    fill.style.background = hex(ownerColor(pt.progSide));
  }
}

/* ---------- the bell and the prize ---------- */
function strike(i, vol, delay) {
  const tp = HOLY.temples[i], pt = S.points.find(p => p.i === i);
  const x = pt ? pt.x : tp.x, z = pt ? pt.z : tp.z;
  const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
  const pan = d > 0.5 ? 0.85 * (dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)) / d : 0;   // the side the temple stands on
  if (holyAudio.bell) try { holyAudio.bell(tp.bell, vol, d, pan, delay || 0); } catch (e) {}
}
export function holyBell(m) {
  const pt = S.points.find(p => p.i === m.i);
  if (pt && pt.vis) { pt.vis.swing = 1; pt.vis.flash = 1; pt.vis.wave = 0.001; pt.vis.burst = 1; }
  S.flashes.push({ i: m.i, at: performance.now(), side: m.side });
  strike(m.i, 1, 0); strike(m.i, 0.55, 0.85);   // the bell swings twice
}
export function holyWin(m) {
  for (const pt of S.points) if (pt.vis) { pt.vis.swing = 1; pt.vis.flash = 1; pt.vis.wave = 0.001; pt.vis.burst = 1; }
  for (let k = 0; k < 4; k++) strike(k, 0.9, k * 0.22);   // a peal: the four notes spell a chord
  for (let k = 0; k < 4; k++) strike(k, 0.7, 1.3 + k * 0.16);
  S.flashes.push({ i: -1, at: performance.now(), side: m.side });
  if (!reduceMotion) { const f = $('holyFlash'); f.hidden = false; f.style.opacity = '0.5'; setTimeout(() => { f.style.opacity = '0'; setTimeout(() => { f.hidden = true; }, 400); }, 260); }
}

/* ---------- the frame ---------- */
const V = new THREE.Vector3(), TMP = new THREE.Color();
function tickPoint(pt, vis, dt, t) {
  const target = ownerColor(pt.owner), k = Math.min(1, dt * 4);
  vis.col.lerp(target, k);
  vis.cloth.lerp(pt.owner ? target : CLOTH, k);
  vis.dispProg += (pt.prog - vis.dispProg) * Math.min(1, dt * 8);
  vis.swing = Math.max(0, vis.swing - dt * 0.45);
  vis.flash = Math.max(0, vis.flash - dt * 1.4);
  vis.burst = Math.max(0, vis.burst - dt * 0.6);
  if (vis.wave > 0) vis.wave = vis.wave + dt * 0.55 >= 1 ? 0 : vis.wave + dt * 0.55;
  const capturing = pt.prog > 0.02 && pt.prog < 0.999 && pt.owner !== pt.progSide;
  const d = Math.hypot(pt.x - P.x, pt.z - P.z), near = Math.max(0.12, Math.min(1, (d - 10) / 45));   // the column fades round you when you stand at it
  // the columns
  for (const [b, op] of [[vis.core, pt.owner ? 0.7 : 0.5], [vis.halo, pt.owner ? 0.42 : 0.3]]) {
    const u = b.material.uniforms;
    u.uColor.value.copy(vis.col); u.uTime.value = t; u.uOpacity.value = op * near; u.uFlash.value = vis.flash * near; u.uSpeed.value = capturing ? 7 : 2.2;
  }
  // the ring
  const ru = vis.ring.material.uniforms;
  ru.uColor.value.copy(vis.col); ru.uProgColor.value.copy(ownerColor(pt.progSide)); ru.uTime.value = t; ru.uProg.value = vis.dispProg; ru.uOwner.value = pt.owner ? 1 : 0;
  ru.uContest.value = pt.contest ? 1 : 0; ru.uWave.value = vis.wave;
  // the motes: quicker while the altar is being taken and in the burst of a capture
  const mu = vis.motes.material.uniforms;
  mu.uColor.value.copy(capturing ? ownerColor(pt.progSide) : vis.col); mu.uTime.value = t; mu.uSpeed.value = 0.8 + (capturing ? 2.2 : 0) + vis.burst * 4; mu.uOpacity.value = 0.45 + (pt.owner ? 0.25 : 0) + (capturing ? 0.3 : 0) + vis.burst * 0.4;
  // the bell, the lamps and the banners
  vis.bell.rotation.z = reduceMotion ? 0 : Math.sin(t * 3.4) * vis.swing * 0.6;
  vis.bellMat.emissive.copy(vis.col).multiplyScalar(pt.owner ? 0.12 + vis.flash * 0.6 : 0.02);
  TMP.copy(vis.col).multiplyScalar(1.4 + 0.25 * Math.sin(t * 7 + pt.i) + vis.flash * 1.5); vis.lampMat.color.copy(TMP);
  vis.clothMat.color.copy(vis.cloth); vis.clothMat.emissive.copy(vis.cloth).multiplyScalar(pt.owner ? 0.12 + vis.flash * 0.4 : 0);
  if (!reduceMotion && d < 260) vis.banners.forEach((b, k) => waveBanner(b, t, pt.i * 1.7 + k * 0.9));
  return d;
}
function tickCrown(dt, t) {
  const C = S.crown; if (!C) return;
  const H = S.hill, hold = S.hold, hc = hold ? (hold.side === ME.unit ? GOLD : RUST) : NEUTRAL;
  C.col.lerp(hc, Math.min(1, dt * 3));
  const now = performance.now(), hl = hold ? Math.max(0, hold.left - (now - S.recvAt)) : 0;
  C.fill += ((hold ? 1 - hl / S.holdMs : 0) - C.fill) * Math.min(1, dt * 4);
  C.glow += ((hold ? 1.25 : 0.55 + 0.1 * S.points.filter(p => p.owner).length) - C.glow) * Math.min(1, dt * 3);
  const cu = C.crown.material.uniforms; cu.uColor.value.copy(C.col); cu.uTime.value = t; cu.uGlow.value = C.glow; cu.uFill.value = C.fill;
  C.crown.rotation.y += dt * (hold ? 0.5 : 0.15) * (reduceMotion ? 0.2 : 1);
  C.crown.position.y = terrainH(H.cx, H.cz) + CROWN_H + (reduceMotion ? 0 : Math.sin(t * 0.8) * 1.2);
  S.points.forEach((pt, k) => {
    const a = C.arcs[k]; if (!a) return; const u = a.material.uniforms;
    u.uColor.value.copy(pt.vis ? pt.vis.col : NEUTRAL); u.uTime.value = t; u.uOn.value += ((pt.owner ? (hold ? 1 : 0.65) : 0) - u.uOn.value) * Math.min(1, dt * 3);
  });
}
export function holyTick(dt) {
  if (!S.on) return;
  const now = performance.now(), t = now / 1000;
  const left = Math.max(0, S.left - (now - S.recvAt));
  $('holyTimer').textContent = fmt(left);
  const H = S.hill, dHill = Math.hypot(H.cx - P.x, H.cz - P.z), away = dHill > H.r;
  const held = S.points.filter(p => p.owner).length;
  const sub = S.hold ? 'удержание всех храмов' : away ? 'Церковная горка · ' + fmtD(dHill) + ' · доберитесь сами' : 'Церковная горка · захвачено ' + held + '/4';
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
    for (const k of Object.keys(b)) {
      const s = document.createElement('span'); s.className = 'holy-buff'; s.title = S.buffName[k] || HOLY.buffName[k];
      s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICO[k] + '"/></svg>';
      buffBox.append(s);
    }
  }
  paintChips();
  // the altars and their labels
  const w = window.innerWidth, h = window.innerHeight;
  for (const pt of S.points) {
    const vis = pt.vis; if (!vis) continue;
    const d = tickPoint(pt, vis, dt, t);
    V.set(pt.x, vis.gy + vis.top + 1.5, pt.z).project(camera);
    if (V.z < 1 && Math.abs(V.x) < 1.1 && Math.abs(V.y) < 1.1 && d < 260 && !STATE.mpDead) {
      vis.label.hidden = false;
      const tp = HOLY.temples[pt.i], capturing = pt.prog > 0.02 && pt.prog < 0.999 && pt.owner !== pt.progSide;
      const txt = tp.short.toUpperCase() + ' · ' + (S.buffName[tp.buff] || HOLY.buffName[tp.buff]) + (capturing ? ' · захват ' + Math.round(pt.prog * 100) + '%' : pt.owner ? ' · ' + (pt.owner === ME.unit ? 'ваш' : pt.name || 'соперник') : '');
      if (vis.label.textContent !== txt) vis.label.textContent = txt;
      vis.label.style.borderColor = hex(vis.col);
      vis.label.style.transform = 'translate(-50%,-100%) translate(' + ((V.x + 1) / 2 * w).toFixed(0) + 'px,' + ((1 - V.y) / 2 * h).toFixed(0) + 'px)';
    } else vis.label.hidden = true;
  }
  tickCrown(dt, t);
  // the way to the hill while you are away: over the crown when it is on screen, at the screen edge when not
  const pointEl = $('holyPoint');
  if (away && !STATE.mpDead) {
    V.set(H.cx, terrainH(H.cx, H.cz) + CROWN_H - 6, H.cz).project(camera);
    const behind = V.z > 1;
    let sx = (V.x + 1) / 2 * w, sy = (1 - V.y) / 2 * h;
    if (behind) { sx = w - sx; sy = h - sy; }
    const on = !behind && Math.abs(V.x) < 0.92 && Math.abs(V.y) < 0.9;
    let px = sx, py = sy, rot = Math.PI / 2;
    if (!on) {
      const dx = sx - w / 2, dy = sy - h / 2, mx = 90, my = 54;   // the label is wide: keep it whole on the screen
      const k = Math.min((w / 2 - mx) / Math.max(1e-6, Math.abs(dx)), (h / 2 - my) / Math.max(1e-6, Math.abs(dy)));
      px = w / 2 + dx * k; py = h / 2 + dy * k; rot = Math.atan2(dy, dx);
    }
    pointEl.hidden = false; pointEl.classList.toggle('edge', !on);
    pointEl.style.transform = 'translate(-50%,-50%) translate(' + px.toFixed(0) + 'px,' + py.toFixed(0) + 'px)';
    $('holyPointArr').style.transform = 'rotate(' + rot.toFixed(3) + 'rad)';
    const txt = fmtD(dHill); const de = $('holyPointD'); if (de.textContent !== txt) de.textContent = txt;
  } else pointEl.hidden = true;
}

/* ---------- the temples on the minimap (mp.js draws it into STATE.mapOverlay) ---------- */
export function holyMap(ctx, cx, cz, ppm, w, h) {
  if (!S.on) return;
  const now = performance.now(), H = S.hill;
  ctx.save();
  // the hill: a dashed ring round it, or an arrow at the edge of the map pointing there
  const hx = w / 2 + (H.cx - cx) * ppm, hy = h / 2 + (H.cz - cz) * ppm, hr = H.r * ppm;
  if (hx + hr < 0 || hy + hr < 0 || hx - hr > w || hy - hr > h) {
    const dx = hx - w / 2, dy = hy - h / 2, m = 13, k = Math.min((w / 2 - m) / Math.max(1e-6, Math.abs(dx)), (h / 2 - m) / Math.max(1e-6, Math.abs(dy)));
    const s = 1 + 0.12 * Math.sin(now * 0.006);
    ctx.save(); ctx.translate(w / 2 + dx * k, h / 2 + dy * k); ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath(); ctx.moveTo(9 * s, 0); ctx.lineTo(-6 * s, -7 * s); ctx.lineTo(-2.5 * s, 0); ctx.lineTo(-6 * s, 7 * s); ctx.closePath();
    ctx.fillStyle = '#ffd27a'; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(40, 26, 0, .85)'; ctx.stroke();
    ctx.restore();
  } else if (hr > 14) {
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 6.283); ctx.setLineDash([6, 6]); ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(255, 210, 122, .55)'; ctx.stroke(); ctx.setLineDash([]);
  }
  for (const pt of S.points) {
    const x = w / 2 + (pt.x - cx) * ppm, y = h / 2 + (pt.z - cz) * ppm;
    if (x < -12 || y < -12 || x > w + 12 || y > h + 12) continue;
    const col = hex(ownerColor(pt.owner));
    if (pt.owner) { ctx.beginPath(); ctx.arc(x, y, 9 + 1.5 * Math.sin(now * 0.004), 0, 6.283); ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1; }
    if (pt.prog > 0.01 && pt.owner !== pt.progSide) {   // the capture arc
      ctx.beginPath(); ctx.arc(x, y, 11, -Math.PI / 2, -Math.PI / 2 + pt.prog * 6.283);
      ctx.strokeStyle = hex(ownerColor(pt.progSide)); ctx.lineWidth = 2.5; ctx.stroke();
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
