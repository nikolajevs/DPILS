import * as THREE from 'three';
import { $, reduceMotion } from '../core/env.js';
import { camera, hemi, renderer, scene, sun, U, WEAK_GPU } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { sky, terrainH } from '../world/terrain.js';

/* ---------- the electric storm: the lightning, the arcs, the charged air and the light of the flashes ----------
   storm.js keeps the zone (the circle from the server, the wall, the HUD, the maps); this module is its weather, all
   of it in true world coordinates (worldSpace) and depth-tested against the city like the wall itself:
   – lightning: branching channels built on the CPU by midpoint displacement — a jagged main channel from the cloud
     to the ground with forks that peter out in the air, now and then a «spider» crawling sideways through the top of
     the wall. A strike lives like a real one: the stepped leader creeps down dimly (~70 ms), the return stroke lights
     the whole channel, up to three restrikes light the main channel alone while the forks go dark, and the channel
     glows out. Each piece is a camera-facing ribbon (additive: an HDR-white core in a blue glow that the bloom of the
     page spreads), never thinner than a couple of pixels, so a bolt two kilometres off is still a line;
   – the strike lights the city: the ambient light, the haze and the sky jump with every stroke, the more the nearer
     (stormLight, called by the frame loop after the day has written its own light); the wall glows round the bolt
     (storm.js takes the two brightest from fxWall); the thunder comes at the speed of sound — a crack and a tear
     when close, a long roll when far;
   – arcs: short sparks crawling along the foot of the wall near the camera, and over the ground around you when you
     stand in the storm, re-forming every few hundredths of a second, with their crackle;
   – the air of the storm: charged motes drifting up and blinking, and slanted rain that glints at every flash —
     both wrapped in a box round the camera and drawn only beyond the edge of the circle;
   – inside the storm (the camera beyond the edge) the day itself goes dark: the sun dims, the haze thickens and turns
     indigo, the sky closes with cloud — and the low hum of the wall (stormAudio.bed) swells as you come near it.
   reduceMotion: one stroke per bolt, a fraction of the flash light, no white screen, no flicker of the arcs. */

export const stormAudio = { thunder: null, zap: null, bed: null, arc: null };   // mp.js hooks the game's own audio context in (one context, one volume knob)

const FX = { on: false, light: 0, outK: 0, lit: 0, nextWall: 0, nextNear: 0, nextArc: 0, lastArcSnd: 0, bed: null, flashHide: 0 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = new THREE.Vector3(), FWD = new THREE.Vector3();
const UPX = { value: 0.002 };   // metres per pixel at one metre of depth: the least width of a ribbon

/* ---------- the ribbons: a channel of light, a quad per piece turned to the camera ---------- */
// position: this end of the piece, aOther: the other end; aP: across (−1…1), the direction sign (the far end looks
// back), the half-width in metres, the brightness; aS: the way from the cloud (0…1, the leader shows up to uGrow) and
// the fork mark (a fork fades with uBranch: the restrikes run the main channel only)
const RIB_VS = `
attribute vec3 aOther; attribute vec4 aP; attribute vec2 aS;
uniform float uPx, uGrow, uBranch;
varying float vX, vI, vK;
void main() {
  vec4 a = viewMatrix * vec4(position, 1.0), b = viewMatrix * vec4(aOther, 1.0);
  vec3 d = (b.xyz - a.xyz) * aP.y, n = cross(d, a.xyz);
  float nl = length(n); n = nl > 1e-9 ? n / nl : vec3(1.0, 0.0, 0.0);
  float w = max(aP.z, uPx * max(0.3, -a.z) * 1.8);
  a.xyz += n * (aP.x * w);
  gl_Position = projectionMatrix * a;
  vX = aP.x;
  vK = clamp(aP.z / w, 0.0, 1.0);   // 1: the true width; less: held at the pixel floor, far away
  vI = aP.w * step(aS.x, uGrow) * mix(1.0, uBranch, aS.y) * mix(0.6, 1.0, vK);
}`;
const RIB_FS = `
uniform float uFlash; uniform vec3 uCore, uGlow;
varying float vX, vI, vK;
void main() {
  float x2 = vX * vX;
  vec3 c = uCore * exp(-x2 * mix(4.0, 24.0, vK)) + uGlow * exp(-x2 * 3.2);   // the white-hot core, the blue glow round it
  gl_FragColor = vec4(c * (vI * uFlash), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function ribbon(max, order, core, glow) {
  const g = new THREE.BufferGeometry(), nv = max * 4;
  const attr = k => { const a = new THREE.BufferAttribute(new Float32Array(nv * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
  g.setAttribute('position', attr(3)); g.setAttribute('aOther', attr(3)); g.setAttribute('aP', attr(4)); g.setAttribute('aS', attr(2));
  const idx = new Uint16Array(max * 6);
  for (let i = 0; i < max; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6); }
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
  const m = worldSpace(new THREE.ShaderMaterial({
    uniforms: { uPx: UPX, uGrow: { value: 1 }, uBranch: { value: 1 }, uFlash: { value: 0 }, uCore: { value: new THREE.Color(...core) }, uGlow: { value: new THREE.Color(...glow) } },
    vertexShader: RIB_VS, fragmentShader: RIB_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = order; mesh.visible = false; mesh.userData.noProbe = true;
  scene.add(mesh);
  const a = g.attributes;
  return { mesh, g, u: m.uniforms, max, n: 0, P: a.position.array, O: a.aOther.array, A: a.aP.array, S: a.aS.array };
}
function seg(R, ax, ay, az, bx, by, bz, hw, I, s0, s1, br) {
  if (R.n >= R.max) return;
  const i = R.n++;
  for (let k = 0; k < 4; k++) {
    const v = i * 4 + k, far = k >> 1, p3 = v * 3, p4 = v * 4, p2 = v * 2;
    R.P[p3] = far ? bx : ax; R.P[p3 + 1] = far ? by : ay; R.P[p3 + 2] = far ? bz : az;
    R.O[p3] = far ? ax : bx; R.O[p3 + 1] = far ? ay : by; R.O[p3 + 2] = far ? az : bz;
    R.A[p4] = k & 1 ? 1 : -1; R.A[p4 + 1] = far ? -1 : 1; R.A[p4 + 2] = hw; R.A[p4 + 3] = I;
    R.S[p2] = far ? s1 : s0; R.S[p2 + 1] = br;
  }
}
function commit(R) {
  const a = R.g.attributes;
  for (const k of ['position', 'aOther', 'aP', 'aS']) { const b = a[k]; b.clearUpdateRanges(); b.addUpdateRange(0, R.n * 4 * b.itemSize); b.needsUpdate = true; }
  R.g.setDrawRange(0, R.n * 6);
}
// a jagged channel from a to b by midpoint displacement: `levels` halvings, each midpoint pushed off the line across
// it by up to `rough` of the piece's length — the self-similar kink of a spark. The flat list of the points.
function zig(ax, ay, az, bx, by, bz, levels, rough) {
  let p = [ax, ay, az, bx, by, bz];
  for (let l = 0; l < levels; l++) {
    const q = [];
    for (let i = 0; i + 3 < p.length; i += 3) {
      const x0 = p[i], y0 = p[i + 1], z0 = p[i + 2], x1 = p[i + 3], y1 = p[i + 4], z1 = p[i + 5];
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L2 = dx * dx + dy * dy + dz * dz || 1;
      let rx = Math.random() - 0.5, ry = Math.random() - 0.5, rz = Math.random() - 0.5;
      const k = (rx * dx + ry * dy + rz * dz) / L2; rx -= dx * k; ry -= dy * k; rz -= dz * k;   // across the piece
      const s = Math.sqrt(L2) * rough * Math.random() / (Math.hypot(rx, ry, rz) || 1);
      q.push(x0, y0, z0, (x0 + x1) / 2 + rx * s, (y0 + y1) / 2 + ry * s, (z0 + z1) / 2 + rz * s);
    }
    q.push(p[p.length - 3], p[p.length - 2], p[p.length - 1]);
    p = q;
  }
  return p;
}
// the pieces of a point list: the brightness runs from I0 to I1, the way from s0 to s1
function chain(R, p, hw, I0, I1, s0, s1, br) {
  const n = p.length / 3 - 1;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, j = i * 3;
    seg(R, p[j], p[j + 1], p[j + 2], p[j + 3], p[j + 4], p[j + 5], hw, I0 + (I1 - I0) * t0, s0 + (s1 - s0) * t0, s0 + (s1 - s0) * t1, br);
  }
}
// a fork off the channel p at its point `at`: the parent's way there, bent 25–60° to a random side and a little down,
// dying out in the air above `floor`; a fork of a fork once in a while
function fork(R, p, at, H, len, hw, I, s0, floor, depth) {
  const j = at * 3, k = Math.min(p.length - 3, j + 9);
  let dx = p[k] - p[j], dy = p[k + 1] - p[j + 1], dz = p[k + 2] - p[j + 2];
  const dl = Math.hypot(dx, dy, dz) || 1, phi = Math.random() * 6.2832, tilt = 0.45 + Math.random() * 0.75;
  dx = dx / dl + Math.cos(phi) * tilt; dy = dy / dl - 0.15; dz = dz / dl + Math.sin(phi) * tilt;
  const nl = Math.hypot(dx, dy, dz) || 1;
  const q = zig(p[j], p[j + 1], p[j + 2], p[j] + dx / nl * len, Math.max(floor, p[j + 1] + dy / nl * len), p[j + 2] + dz / nl * len, depth > 0 ? 5 : 4, 0.3);
  const s1 = s0 + len / H;
  chain(R, q, hw, I, I * 0.2, s0, s1, 1);
  if (depth > 0 && Math.random() < 0.55) {
    const m = q.length / 3, a = 1 + Math.floor(Math.random() * (m - 3) * 0.6);
    fork(R, q, a, H, len * (0.3 + Math.random() * 0.3), hw * 0.65, I * 0.6, s0 + (s1 - s0) * a / (m - 1), floor, depth - 1);
  }
}

/* ---------- the pools ---------- */
const BOLT_N = 4, ARC_N = 10;
let built = false;
const bolts = [], arcs = [];
let motes = null, rain = null;
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,.5)'); gr.addColorStop(0.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// the charged motes: points wrapped in a box round the camera, drifting up and blinking, only beyond the edge
const MOTE_VS = `
attribute vec4 aSeed;
uniform vec3 uCam; uniform float uTime, uBox, uR, uCx, uCz, uK, uPx;
varying float vA;
void main() {
  vec3 drift = vec3(sin(uTime * 0.31 + aSeed.w * 6.3) * 1.5, uTime * (0.5 + aSeed.w * 1.5), cos(uTime * 0.27 + aSeed.w * 9.1) * 1.5);
  vec3 q = mod(aSeed.xyz * uBox + drift - uCam, uBox) - 0.5 * uBox;
  vec3 p = uCam + q;
  float edge = 1.0 - smoothstep(0.3, 0.5, max(abs(q.x), max(abs(q.y), abs(q.z))) / uBox);
  float out_ = smoothstep(uR - 14.0, uR + 6.0, length(p.xz - vec2(uCx, uCz)));   // a few spill out of the wall into the circle
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed.w * 7.0) + aSeed.w * 40.0); tw *= tw; tw *= tw;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.16 / (max(0.5, -mv.z) * uPx), 1.0, 7.0);
  vA = edge * out_ * (0.15 + 0.85 * tw) * uK;
}`;
const MOTE_FS = `
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  gl_FragColor = vec4(vec3(0.8, 1.5, 3.2) * (exp(-dot(c, c) * 16.0) * vA), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// the rain: slanted streaks falling through the same kind of box; they take the light of the haze and glint white at a flash
const RAIN_VS = `
attribute vec4 aSeed; attribute float aEnd;
uniform vec3 uCam; uniform float uTime, uBox, uR, uCx, uCz, uK;
varying float vA;
void main() {
  vec3 vel = vec3(3.2, -15.0 - aSeed.w * 6.0, 1.5);
  vec3 q = mod(aSeed.xyz * uBox + vel * uTime - uCam, uBox) - 0.5 * uBox;
  vec3 p = uCam + q - vel * (0.055 * aEnd);
  float r = length(q);
  float edge = (1.0 - smoothstep(0.28, 0.5, r / uBox)) * smoothstep(0.8, 2.5, r);
  float out_ = smoothstep(uR, uR + 3.0, length(p.xz - vec2(uCx, uCz)));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vA = edge * out_ * uK * (1.0 - 0.7 * aEnd);
}`;
const RAIN_FS = `
uniform vec3 uAmb; uniform float uLit;
varying float vA;
void main() {
  gl_FragColor = vec4(uAmb * 1.7 + vec3(1.6, 1.9, 2.6) * uLit, vA * (0.3 + 0.4 * uLit));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function airCloud(n, verts, vs, fs, uniforms, blend, Ctor) {
  const g = new THREE.BufferGeometry(), seed = new Float32Array(n * verts * 4), pos = new Float32Array(n * verts * 3), end = new Float32Array(n * verts);
  for (let i = 0; i < n; i++) { const s = [Math.random(), Math.random(), Math.random(), Math.random()]; for (let k = 0; k < verts; k++) { seed.set(s, (i * verts + k) * 4); end[i * verts + k] = k; } }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const m = worldSpace(new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: blend }));
  const o = new Ctor(g, m); o.frustumCulled = false; o.visible = false; o.renderOrder = 22; o.userData.noProbe = true;
  scene.add(o);
  return o;
}
function airU(extra) { return Object.assign({ uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: 60 }, uR: { value: 1e5 }, uCx: { value: 0 }, uCz: { value: 0 }, uK: { value: 0 } }, extra); }

function build() {
  if (built) return; built = true;
  const tex = glowTex();
  for (let i = 0; i < BOLT_N; i++) {
    const R = ribbon(560, 23, [5.5, 6.5, 9.0], [0.22, 0.48, 1.7]);
    const glow = new THREE.Sprite(worldSpace(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    glow.visible = false; glow.renderOrder = 23; glow.frustumCulled = false; glow.userData.noProbe = true; scene.add(glow);
    bolts.push({ R, glow, t: 9, end: 0, grow: 0.06, pt: [], pa: [], I: 0, br: 1, d: 1e4, ground: true, ang: 0, hy: 0, reach: 1, x: 0, z: 0 });
  }
  for (let i = 0; i < ARC_N; i++) arcs.push({ R: ribbon(48, 23, [2.6, 3.4, 5.6], [0.4, 0.32, 1.5]), t: 9, life: 0, regen: 0, x: 0, z: 0, tx: 1, tz: 0, len: 10, hgt: 1 });
  motes = airCloud(WEAK_GPU ? 260 : 560, 1, MOTE_VS, MOTE_FS, airU({ uPx: UPX }), THREE.AdditiveBlending, THREE.Points);
  rain = airCloud(WEAK_GPU ? 1000 : 2200, 2, RAIN_VS, RAIN_FS, airU({ uAmb: { value: new THREE.Color() }, uLit: { value: 0 } }), THREE.NormalBlending, THREE.LineSegments);
  rain.material.uniforms.uBox.value = 46;
}

/* ---------- a strike ---------- */
// the life of a bolt: the leader (grow), the return stroke, the restrikes; I is its brightness now
function life(B, ground) {
  B.t = 0; B.grow = ground ? 0.05 + Math.random() * 0.05 : 0.09 + Math.random() * 0.09;
  B.pt.length = 0; B.pa.length = 0; B.pt.push(B.grow); B.pa.push(1);
  let t = B.grow;
  const k = reduceMotion ? 0 : Math.floor(Math.random() * (ground ? 4 : 3));
  for (let i = 0; i < k; i++) { t += 0.045 + Math.random() * 0.12; B.pt.push(t); B.pa.push(0.45 + Math.random() * 0.5); }
  B.end = t + 0.55;
}
function freeBolt() { let b = bolts[0]; for (const B of bolts) { if (B.t >= B.end) return B; if (B.t > b.t) b = B; } return b; }
// a cloud-to-ground bolt hitting (x, z) from `top`
function groundBolt(B, x, z, top) {
  const R = B.R; R.n = 0;
  const gy = terrainH(x, z), H = top - gy, lean = H * 0.32;
  const p = zig(x + (Math.random() - 0.5) * lean, top, z + (Math.random() - 0.5) * lean, x, gy - 0.5, z, 7, 0.24);
  chain(R, p, 1.5, 1, 1, 0, 1, 0);   // the half-width with its glow: close by a wider ribbon blooms into a pillar
  const n = p.length / 3, nf = 3 + Math.floor(Math.random() * 5);
  for (let f = 0; f < nf; f++) { const at = Math.floor(n * (0.05 + Math.random() * 0.6)); fork(R, p, at, H, H * (0.12 + Math.random() * 0.28), 0.75, 0.4 + Math.random() * 0.3, at / (n - 1), gy + 6, 1); }
  commit(R);
  B.glow.position.set(x, gy + 3, z); B.ground = true; B.hy = gy + H * 0.55; B.reach = 150;
}
// a spider: a channel crawling sideways along the ring (tx, tz) through the top of the wall, with its forks hanging down
function cloudBolt(B, x, z, tx, tz, y) {
  const R = B.R; R.n = 0;
  const len = 170 + Math.random() * 330, rise = (Math.random() - 0.5) * 70;
  const p = zig(x - tx * len / 2, y - rise / 2, z - tz * len / 2, x + tx * len / 2, y + rise / 2, z + tz * len / 2, 6, 0.22);
  chain(R, p, 1.2, 0.85, 0.85, 0, 1, 0);
  const n = p.length / 3, nf = 4 + Math.floor(Math.random() * 5), floor = terrainH(x, z) + 60;
  for (let f = 0; f < nf; f++) { const at = Math.floor(n * (0.05 + Math.random() * 0.85)); fork(R, p, at, len, len * (0.12 + Math.random() * 0.25), 0.7, 0.35 + Math.random() * 0.3, at / (n - 1), floor, 1); }
  commit(R);
  B.ground = false; B.hy = y; B.reach = len * 0.5;
}
// the strike itself: the bolt, its sound and, near, the white of the screen
function strike(x, z, cx, cz, kind, d, tx, tz) {
  const B = freeBolt(), ground = kind !== 'cloud';
  if (ground) groundBolt(B, x, z, terrainH(x, z) + 300 + Math.random() * 160);
  else cloudBolt(B, x, z, tx, tz, terrainH(x, z) + 230 + Math.random() * 160);
  life(B, ground);
  B.x = x; B.z = z; B.d = d; B.ang = Math.atan2(z - cz, x - cx) / 6.2831853 + 0.5;
  B.R.mesh.visible = true; B.glow.visible = ground;
  if (stormAudio.thunder) {
    V.set(x, camera.position.y + 80, z).applyMatrix4(camera.matrixWorldInverse);
    const pan = 0.85 * V.x / Math.max(1, Math.hypot(V.x, V.z)), vol = clamp(1.25 - d / 1700, 0.16, 1) * (ground ? 1 : 0.7);
    try { stormAudio.thunder(vol, d, pan); } catch (e) {}
  }
  if (ground && d < 320 && !reduceMotion) {
    const f = $('stormFlash'); f.hidden = false; f.style.opacity = String(0.12 + 0.26 * (1 - d / 320));
    clearTimeout(FX.flashHide); FX.flashHide = setTimeout(() => { f.hidden = true; }, 130);
  }
}
function boltTick(B, dt) {
  if (B.t >= B.end) { if (B.R.mesh.visible) { B.R.mesh.visible = false; B.glow.visible = false; } B.I = 0; return; }
  B.t += dt;
  const t = B.t, u = B.R.u;
  if (t < B.grow) { B.I = 0.2 + Math.random() * 0.12; u.uGrow.value = Math.pow(t / B.grow, 0.8); B.br = 1; }   // the leader feels its way down
  else {
    let I = 0; for (let i = 0; i < B.pt.length; i++) if (t >= B.pt[i]) I += B.pa[i] * Math.exp(-(t - B.pt[i]) * 22);
    B.I = Math.min(1.6, I + 0.07 * Math.exp(-(t - B.grow) * 3));   // the strokes, and the channel glowing out
    u.uGrow.value = 1; B.br = Math.exp(-(t - B.grow) * 15);
  }
  u.uFlash.value = B.I; u.uBranch.value = B.br;
  if (B.ground) { const s = 18 + 24 * B.I; B.glow.scale.set(s, s, 1); B.glow.material.color.setRGB(1.2 * B.I, 1.7 * B.I, 2.6 * B.I); }
}

/* ---------- the arcs ---------- */
function arcShape(A) {
  const R = A.R; R.n = 0;
  const ax = A.x - A.tx * A.len / 2, az = A.z - A.tz * A.len / 2, bx = A.x + A.tx * A.len / 2, bz = A.z + A.tz * A.len / 2;
  const p = zig(ax, terrainH(ax, az) + 0.15, az, bx, terrainH(bx, bz) + 0.15, bz, 4, 0.34), n = p.length / 3;
  for (let i = 0; i < n; i++) p[i * 3 + 1] += Math.sin(Math.PI * i / (n - 1)) * A.hgt * (0.7 + Math.random() * 0.3);   // an arch over the ground
  chain(R, p, 0.2, 1, 1, 0, 1, 0);
  const m = Math.floor(n * (0.3 + Math.random() * 0.4)) * 3, gx = p[m] + (Math.random() - 0.5) * 3, gz = p[m + 2] + (Math.random() - 0.5) * 3;
  chain(R, zig(p[m], p[m + 1], p[m + 2], gx, terrainH(gx, gz), gz, 3, 0.4), 0.12, 0.7, 0.4, 0, 1, 0);   // a spit down to the ground
  commit(R);
}
function spawnArc(x, z, tx, tz) {
  let A = arcs[0]; for (const a of arcs) if (a.t - a.life > A.t - A.life) A = a;
  Object.assign(A, { x, z, tx, tz, len: 5 + Math.random() * 20, hgt: 0.5 + Math.random() * 4, t: 0, life: 0.08 + Math.random() * 0.18, regen: 0 });
  arcShape(A); A.R.mesh.visible = true;
  const d = camera.position.distanceTo(V.set(x, terrainH(x, z) + 1, z));
  if (d < 70 && stormAudio.arc && performance.now() - FX.lastArcSnd > 70) {
    FX.lastArcSnd = performance.now(); V.applyMatrix4(camera.matrixWorldInverse);
    try { stormAudio.arc(0.55 * (1 - d / 70), 0.8 * V.x / Math.max(1, Math.hypot(V.x, V.z))); } catch (e) {}
  }
}
function arcTick(A, dt) {
  if (A.t >= A.life) { if (A.R.mesh.visible) A.R.mesh.visible = false; return; }
  A.t += dt;
  if (!reduceMotion && (A.regen -= dt) <= 0) { A.regen = 0.035 + Math.random() * 0.03; arcShape(A); }   // it dances: a new path every few hundredths
  A.R.u.uFlash.value = (reduceMotion ? 0.8 : 0.45 + Math.random() * 0.75) * (1 - 0.5 * A.t / A.life);
}

/* ---------- the frame (storm.js, while the storm is on) ---------- */
// c: the circle as drawn; phase: the server's ('play', 'sudden', 'end')
export function fxTick(dt, now, c, phase) {
  build(); FX.on = true;
  const fight = phase === 'play' || phase === 'sudden', cam = camera.position;
  const dx = cam.x - c.x, dz = cam.z - c.z, dist = Math.hypot(dx, dz) || 1, wallD = Math.abs(dist - c.r), outside = dist > c.r;
  FX.outK += ((fight && outside ? 1 : 0) - FX.outK) * Math.min(1, dt * 2.5);
  UPX.value = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, renderer.domElement.height);
  const th = Math.atan2(dz, dx), rate = phase === 'sudden' ? 1.7 : 1;
  if (fight) {
    // the wall: a bolt every couple of seconds somewhere along the stretch of it you can see, mostly ahead of you
    if (now >= FX.nextWall) {
      FX.nextWall = now + (1300 + Math.random() * 3200) / rate;
      camera.getWorldDirection(FWD);
      const span = Math.min(Math.PI, 1500 / Math.max(1, c.r)), wantFront = Math.random() < 0.72;
      for (let k = 0; k < 8; k++) {
        const a = th + (Math.random() * 2 - 1) * span, rr = c.r < 120 ? c.r + 25 + Math.random() * 110 : c.r + (Math.random() - 0.7) * 30;   // a small last circle: the bolts fall in the storm round it
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, ex = x - cam.x, ez = z - cam.z, d = Math.hypot(ex, ez);
        if (d > 2600 || d < 30) continue;
        if (wantFront && (ex * FWD.x + ez * FWD.z) / d < 0.4 && k < 7) continue;
        const cloud = d > 250 && Math.random() < 0.3;
        strike(x, z, c.x, c.z, cloud ? 'cloud' : 'ground', d, -Math.sin(a), Math.cos(a));
        break;
      }
    }
    // in the storm: strikes all round you
    if (outside && now >= FX.nextNear) {
      FX.nextNear = now + (2200 + Math.random() * 3800) / rate;
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * 6.2832, rho = 45 + Math.random() * 230, x = cam.x + Math.cos(a) * rho, z = cam.z + Math.sin(a) * rho;
        if (Math.hypot(x - c.x, z - c.z) < c.r + 10) continue;
        strike(x, z, c.x, c.z, 'ground', rho, 0, 0); break;
      }
    }
    // the arcs: along the foot of the wall while you are near it, over the ground round you while you are out
    if (now >= FX.nextArc && (wallD < 200 || outside)) {
      const near = outside ? 1 : 1 - wallD / 200;
      FX.nextArc = now + (outside ? 60 + Math.random() * 120 : 50 + Math.random() * 120 + (1 - near) * 260);
      if (!outside || Math.random() < 0.45) {
        const a = th + (Math.random() - 0.5) * 2 * Math.min(Math.PI, 90 / Math.max(1, c.r)), rr = c.r + (Math.random() - 0.5) * 8;
        spawnArc(c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr, -Math.sin(a), Math.cos(a));
      } else {
        const a = Math.random() * 6.2832, rho = 6 + Math.random() * 40, x = cam.x + Math.cos(a) * rho, z = cam.z + Math.sin(a) * rho, b = Math.random() * 6.2832;
        if (Math.hypot(x - c.x, z - c.z) > c.r + 3) spawnArc(x, z, Math.cos(b), Math.sin(b));
      }
    }
  }
  // the bolts and the light they throw: the nearer, the brighter the city round them
  let L = 0;
  for (const B of bolts) { boltTick(B, dt); if (B.I > 0) L += B.I * (B.ground ? 1 : 0.55) * clamp(1.25 - B.d / 900, 0.08, 1); }
  FX.light = Math.min(1.6, L);
  for (const A of arcs) arcTick(A, dt);
  // the air of the storm round the camera
  const airK = fight ? clamp(1.2 - (outside ? 0 : wallD) / 60, 0, 1) : 0, rainK = fight ? clamp((dist - c.r + 3) / 6, 0, 1) : 0;
  FX.lit = clamp(L * 1.4, 0, 1);
  for (const [o, k] of [[motes, airK], [rain, rainK]]) {
    const u = o.material.uniforms;
    o.visible = k > 0.01;
    if (!o.visible) continue;
    u.uCam.value.copy(cam); u.uTime.value = (now / 1000) % 1800; u.uR.value = c.r; u.uCx.value = c.x; u.uCz.value = c.z; u.uK.value = k;
  }
  if (rain.visible) { rain.material.uniforms.uLit.value = reduceMotion ? FX.lit * 0.3 : FX.lit; rain.material.uniforms.uAmb.value.copy(scene.fog.color); }
  // the hum of the wall: it swells near the edge and fills the storm; it leans towards the wall
  const bedV = fight ? (outside ? 0.8 : Math.pow(clamp(1 - wallD / 280, 0, 1), 1.6) * 0.65) : 0;
  if (bedV > 0.01 && !FX.bed && stormAudio.bed) { try { FX.bed = stormAudio.bed(); } catch (e) { FX.bed = null; } }
  if (FX.bed) {
    V.set(c.x + dx / dist * c.r, cam.y, c.z + dz / dist * c.r).applyMatrix4(camera.matrixWorldInverse);
    const pan = outside ? 0 : 0.6 * V.x / Math.max(1, Math.hypot(V.x, V.z));
    FX.bed.set(bedV, pan, outside ? 1 : clamp(1 - wallD / 140, 0, 1));
    if (bedV <= 0.01 && !fight) { FX.bed.stop(); FX.bed = null; }
  }
}
// a strike on demand at (x, z) by the circle c — for the headless views of the tools (a frame with a bolt in it)
export function fxStrike(x, z, c, kind = 'ground') {
  build();
  const a = Math.atan2(z - c.z, x - c.x);
  strike(x, z, c.x, c.z, kind, Math.hypot(x - camera.position.x, z - camera.position.z), -Math.sin(a), Math.cos(a));
}
// the two brightest bolts for the wall's own glow (storm.js): the angle round the ring, the brightness, the height, the reach
export function fxWall(u) {
  let a = null, b = null;
  for (const B of bolts) { if (B.I <= 0.01) continue; if (!a || B.I > a.I) { b = a; a = B; } else if (!b || B.I > b.I) b = B; }
  for (const [k, B] of [['uS1', a], ['uS2', b]]) { if (B) u[k].value.set(B.ang, B.I * (B.ground ? 1 : 0.8), B.hy, B.reach); else u[k].value.y = 0; }
}
export function fxClear() {
  FX.on = false; FX.light = 0; FX.outK = 0; FX.lit = 0;
  for (const B of bolts) { B.t = B.end; B.I = 0; B.R.mesh.visible = false; B.glow.visible = false; }
  for (const A of arcs) { A.t = A.life; A.R.mesh.visible = false; }
  if (motes) { motes.visible = false; rain.visible = false; }
  if (FX.bed) { FX.bed.stop(); FX.bed = null; }
}

/* ---------- the light of the storm on the city (the frame loop, after lighting.js has written the day's own) ----------
   Each value is the day's own plus the storm: the day's is what is there unless it is the one written here last (a
   running day rewrites it every frame, a fixed time leaves it). Once the storm is gone the day's values go back. */
const FLASH = new THREE.Color(0.55, 0.68, 1.0);
const DARK = { fog: new THREE.Color(0.016, 0.02, 0.062), top: new THREE.Color(0.006, 0.008, 0.03), hor: new THREE.Color(0.022, 0.026, 0.08), lit: new THREE.Color(0.05, 0.06, 0.12), dk: new THREE.Color(0.008, 0.01, 0.025) };
const LN = () => ({ b: 0, s: NaN }), LC = () => ({ b: new THREE.Color(), s: new THREE.Color(-1, -1, -1) });
const LIFT = { hemi: LN(), sunI: LN(), haze: LN(), cover: LN(), fog: LC(), sunCol: LC(), top: LC(), hor: LC(), disc: LC(), cLit: LC(), cDark: LC() };
let lifted = false;
function liftN(o, k, R, f) { if (o[k] !== R.s) R.b = o[k]; R.s = o[k] = f(R.b); }
function liftC(col, R, to, mk, add) {
  if (!col.equals(R.s)) R.b.copy(col);
  col.copy(R.b); if (to) col.lerp(to, mk); else col.multiplyScalar(1 - mk);
  if (add) { col.r += FLASH.r * add; col.g += FLASH.g * add; col.b += FLASH.b * add; }
  R.s.copy(col);
}
export function stormLight() {
  let L = FX.light * (reduceMotion ? 0.3 : 1), o = FX.outK;
  if (L < 0.002 && o < 0.002) { if (!lifted) return; lifted = false; L = 0; o = 0; }   // the last pass writes the day's own back
  else lifted = true;
  const su = sky.material.uniforms;
  liftN(hemi, 'intensity', LIFT.hemi, b => b * (1 - 0.4 * o) + L * 0.7);
  liftN(sun, 'intensity', LIFT.sunI, b => b * (1 - 0.75 * o));
  liftC(U.sunCol.value, LIFT.sunCol, null, 0.75 * o, 0);
  liftN(scene.fog, 'near', LIFT.haze, b => b * (1 + 3 * o));
  liftC(scene.fog.color, LIFT.fog, DARK.fog, 0.6 * o, L * 0.12);
  liftC(su.uSkyTop.value, LIFT.top, DARK.top, 0.7 * o, L * 0.06);
  liftC(su.uSkyHor.value, LIFT.hor, DARK.hor, 0.65 * o, L * 0.16);
  liftC(su.uSunDisc.value, LIFT.disc, null, o, 0);
  liftC(su.uCloudLit.value, LIFT.cLit, DARK.lit, 0.8 * o, L * 0.25);
  liftC(su.uCloudDark.value, LIFT.cDark, DARK.dk, 0.8 * o, L * 0.1);
  liftN(su.uCover, 'value', LIFT.cover, b => b + (0.92 - b) * o);
}
