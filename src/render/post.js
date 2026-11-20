import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { clock } from '../game/loop.js';
import { QUALITY, TIMES, qi, timeI } from './lighting.js';
import { P } from '../game/player.js';
import { treeTiles } from '../world/trees.js';
import { tiles } from '../buildings/walls.js';
import { terrainH } from '../world/terrain.js';
import { LIGHTDIR, POST, U, camera, renderer, scene, sun } from './renderer.js';
import { updateProbes } from './cityprobe.js';
import { TILE, TTILE, reduceMotion } from '../core/env.js';

/* ---------- HDR post-processing: ambient occlusion from depth, bloom, tone mapping ---------- */
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DEPTH_GLSL = `uniform sampler2D tDepth; uniform vec4 uProj;
float zAt(vec2 uv) { return uProj.x * uProj.y / (uProj.y - textureLod(tDepth, uv, 0.0).x * (uProj.y - uProj.x)); }
vec3 posAt(vec2 uv) { float z = zAt(uv); return vec3((uv * 2.0 - 1.0) * uProj.zw * z, z); }`;
// Scalable ambient obscurance (McGuire et al.): a spiral of depth taps around the pixel, normal rebuilt from depth
const AO_FRAG = `${DEPTH_GLSL}
uniform vec2 uPx; uniform float uAoRes; varying vec2 vUv;
#define NS 10
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  if (textureLod(tDepth, vUv, 0.0).x >= 0.999999) { gl_FragColor = vec4(1.0, 1e5, 0.0, 1.0); return; }
  vec3 P = posAt(vUv);
  vec3 l = posAt(vUv - vec2(uPx.x, 0.0)), r = posAt(vUv + vec2(uPx.x, 0.0)), dn = posAt(vUv - vec2(0.0, uPx.y)), up = posAt(vUv + vec2(0.0, uPx.y));
  vec3 dx = abs(l.z - P.z) < abs(r.z - P.z) ? P - l : r - P, dy = abs(dn.z - P.z) < abs(up.z - P.z) ? P - dn : up - P;
  vec3 cn = cross(dy, dx); float cl = length(cn); vec3 n = cl > 1e-12 ? cn / cl : vec3(0.0, 0.0, -1.0);
  float R = clamp(P.z * 0.03, 0.8, 14.0), rPix = min(R / (P.z * uProj.w) * 0.5 * uAoRes, 0.12 * uAoRes), ao = 1.0;
  if (rPix > 1.5) {
    float phi = ign(gl_FragCoord.xy) * 6.2831853, sum = 0.0;
    for (int i = 0; i < NS; i++) {
      float a = (float(i) + 0.5) / float(NS), ang = float(i) * 2.3999632 + phi;
      vec3 v = posAt(vUv + vec2(cos(ang), sin(ang)) * (sqrt(a) * rPix) * uPx * 2.0) - P;
      float vv = dot(v, v), f = max(R * R - vv, 0.0);
      sum += f * f * f * max((dot(v, n) - 0.004 * P.z - 0.015) / (vv + 0.02), 0.0);
    }
    ao = max(0.0, 1.0 - sum * 5.0 / (float(NS) * R * R * R * R * R * R));
  }
  if (isnan(ao) || isinf(ao) || !(ao >= 0.0)) ao = 1.0;   // recessed windows can leave a degenerate depth stencil
  gl_FragColor = vec4(ao, P.z, 0.0, 1.0);
}`;
const BRIGHT_FRAG = `uniform sampler2D tSrc; uniform vec2 uPx; uniform float uThresh; uniform float uExposure; varying vec2 vUv;
void main() {
  vec3 s = vec3(0.0); float w = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec3 c = min(textureLod(tSrc, vUv + (vec2(float(i), float(j)) - 0.5) * uPx, 0.0).rgb * uExposure, vec3(24.0));
    float k = 1.0 / (1.0 + max(c.r, max(c.g, c.b))); s += c * k; w += k;
  }
  s /= w; float br = max(s.r, max(s.g, s.b));
  gl_FragColor = vec4(s * (max(br - uThresh, 0.0) / max(br, 1e-4)), 1.0);
}`;
const DOWN_FRAG = `uniform sampler2D tSrc; uniform vec2 uPx; varying vec2 vUv;
void main() { gl_FragColor = vec4((texture2D(tSrc, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(1.0, -1.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uPx).rgb) * 0.25, 1.0); }`;
const FINAL_FRAG = `${DEPTH_GLSL}
uniform sampler2D tScene; uniform sampler2D tAO; uniform sampler2D tB1; uniform sampler2D tB2; uniform sampler2D tB3;
uniform vec2 uAoPx; uniform float uExposure; uniform float uBloom; uniform float uAo; uniform float uSeed;
uniform vec2 uSunUv; uniform float uRayI; uniform vec3 uRayC;
varying vec2 vUv;
vec3 fit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(O * fit(I * (c / 0.6)), 0.0, 1.0);
}
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 col = texture2D(tScene, vUv).rgb * uExposure;
  if (uAo > 0.0 && textureLod(tDepth, vUv, 0.0).x < 0.999999) {
    float z = zAt(vUv), a = 0.0, w = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 s = textureLod(tAO, vUv + vec2(float(i), float(j)) * uAoPx, 0.0).rg;
      float k = max(0.0, 1.0 - abs(s.g - z) / (0.08 * z + 0.05)) + 1e-3; a += s.r * k; w += k;
    }
    a /= w; if (isnan(a) || isinf(a)) a = 1.0;
    a = mix(a, 1.0, clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)) * 0.4, 0.0, 0.65));   // sunlit surfaces keep most of their brightness
    col *= mix(1.0, a, uAo * (1.0 - smoothstep(1500.0, 3000.0, z)));
  }
  if (uBloom > 0.0) col += (texture2D(tB1, vUv).rgb * 0.45 + texture2D(tB2, vUv).rgb * 0.33 + texture2D(tB3, vUv).rgb * 0.22) * uBloom;
  if (uRayI > 0.001) {   // volumetric sun rays: march the depth from the pixel towards the sun on screen, sky texels glow
    vec2 dv = (uSunUv - vUv) * (0.85 / 40.0); vec2 uv = vUv; float illum = 1.0, acc = 0.0;
    for (int i = 0; i < 40; i++) { uv += dv;
      float sky = step(0.999999, textureLod(tDepth, uv, 0.0).x);
      acc += sky * illum; illum *= 0.965; }
    acc *= 0.03;
    float fall = 1.0 - smoothstep(0.35, 1.15, length(uSunUv - 0.5));
    col += uRayC * (acc * uRayI * fall);
  }
  col = aces(col);
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.06);
  vec2 q = vUv - 0.5; col *= 1.0 - 0.32 * dot(q, q);
  col = mix(col * 12.92, 1.055 * pow(max(col, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), col));
  col += (h12(gl_FragCoord.xy + uSeed) - 0.5) * (2.0 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`;
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsScene = new THREE.Scene();
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null); fsQuad.frustumCulled = false; fsScene.add(fsQuad);
const fsMat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
const PROJ = new THREE.Vector4(), PXV = new THREE.Vector2();
// scale: the share of the drawing buffer the scene is drawn at (set by the frame rate, see src/game/perf.js); the
// last pass draws it up to the full canvas
const PP = { rt: null, ao: null, bl: [], w: 0, h: 0, msaa: -1, scale: 1 };
let matAO, matBright, matDown, matFinal;
if (POST) {
  const t = () => ({ value: null }), v2 = () => ({ value: new THREE.Vector2() });
  matAO = fsMat(AO_FRAG, { tDepth: t(), uProj: { value: PROJ }, uPx: v2(), uAoRes: { value: 1 } });
  matBright = fsMat(BRIGHT_FRAG, { tSrc: t(), uPx: v2(), uThresh: { value: 2 }, uExposure: { value: 1 } });
  matDown = fsMat(DOWN_FRAG, { tSrc: t(), uPx: v2() });
  matFinal = fsMat(FINAL_FRAG, { tDepth: t(), uProj: { value: PROJ }, tScene: t(), tAO: t(), tB1: t(), tB2: t(), tB3: t(), uAoPx: v2(), uExposure: { value: 1 }, uBloom: { value: 0 }, uAo: { value: 0 }, uSeed: { value: 0 }, uSunUv: v2(), uRayI: { value: 0 }, uRayC: { value: new THREE.Vector3(1, 0.7, 0.4) } });
}
function ppTargets(w, h, msaa) {
  w = Math.max(1, Math.round(w * PP.scale)); h = Math.max(1, Math.round(h * PP.scale));
  if (PP.rt && PP.w === w && PP.h === h && PP.msaa === msaa) return;
  for (const t of [PP.rt, PP.ao, ...PP.bl]) if (t) t.dispose();
  PP.w = w; PP.h = h; PP.msaa = msaa;
  const o = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, stencilBuffer: false };
  PP.rt = new THREE.WebGLRenderTarget(w, h, Object.assign({ samples: Math.max(0, msaa) }, o));
  PP.rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  const small = k => new THREE.WebGLRenderTarget(Math.max(1, w >> k), Math.max(1, h >> k), Object.assign({ depthBuffer: false }, o));
  PP.ao = small(1); PP.bl = [1, 2, 3, 4].map(small);
}
function fsPass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }
function renderFrame() {
  renderer.info.reset();
  updateProbes(camera.position.x, camera.position.z);   // the two nearest city cubes for the water and the glass
  if (!POST) { renderer.render(scene, camera); return; }
  const q = QUALITY[qi], T = TIMES[timeI];
  renderer.getDrawingBufferSize(PXV); ppTargets(PXV.x, PXV.y, q.msaa);
  renderer.setRenderTarget(PP.rt); renderer.render(scene, camera);
  const th = Math.tan(camera.fov * Math.PI / 360); PROJ.set(camera.near, camera.far, th * camera.aspect, th);
  if (q.ao) { const u = matAO.uniforms; u.tDepth.value = PP.rt.depthTexture; u.uPx.value.set(1 / PP.w, 1 / PP.h); u.uAoRes.value = PP.ao.height; fsPass(matAO, PP.ao); }
  if (q.bloom) {
    let u = matBright.uniforms; u.tSrc.value = PP.rt.texture; u.uPx.value.set(1 / PP.w, 1 / PP.h); u.uThresh.value = T.thresh; u.uExposure.value = T.exp; fsPass(matBright, PP.bl[0]);
    u = matDown.uniforms; for (let k = 1; k < 4; k++) { u.tSrc.value = PP.bl[k - 1].texture; u.uPx.value.set(1 / PP.bl[k - 1].width, 1 / PP.bl[k - 1].height); fsPass(matDown, PP.bl[k]); }
  }
  const u = matFinal.uniforms;
  u.tScene.value = PP.rt.texture; u.tDepth.value = PP.rt.depthTexture; u.tAO.value = PP.ao.texture; u.tB1.value = PP.bl[1].texture; u.tB2.value = PP.bl[2].texture; u.tB3.value = PP.bl[3].texture;
  u.uAoPx.value.set(1 / PP.ao.width, 1 / PP.ao.height); u.uExposure.value = T.exp; u.uBloom.value = q.bloom ? T.bloom : 0; u.uAo.value = q.ao ? 0.85 : 0; u.uSeed.value = reduceMotion ? 0 : (clock * 60 % 64);
  // the sun (the moon at night) on screen: rays only while it is in front of the camera, near the frame
  SUNV.copy(camera.position).addScaledVector(LIGHTDIR, 3000).project(camera);
  const fwd = LIGHTDIR.dot(camera.getWorldDirection(RAYF));
  u.uSunUv.value.set(SUNV.x * 0.5 + 0.5, SUNV.y * 0.5 + 0.5);
  u.uRayI.value = q.bloom && fwd > 0.05 ? (T.rays || 0) * Math.min(1, (fwd - 0.05) / 0.2) : 0;
  u.uRayC.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(T.sunI * 0.3);   // Color has r/g/b, not x/y/z: copy() would give NaN
  fsPass(matFinal, null);
}
/* Compiles the shaders of everything in the scene before the first frame, an object at a time with a frame between
   slices of about 40 ms, so the page stays responsive and the loading bar can follow. A shader program depends on the
   material, on the kind of object (instanced or not, receiving shadows) and on the target drawn into, so one object
   of each combination is compiled, into the target the scene is drawn into. renderer.compile compiles everything in
   the scene it is given, so the scene is shown one object at a time (with its lights). */
async function warmUp(report, nextFrame) {
  const seen = new Set(), objs = [];
  scene.traverse(o => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { const k = m.uuid + (o.isInstancedMesh ? 'i' : '') + (o.receiveShadow ? 'r' : '') + (o.isPoints ? 'p' : o.isLine ? 'l' : o.isSprite ? 's' : ''); if (!seen.has(k)) { seen.add(k); objs.push(o); } }
  });
  const all = scene.children, lights = all.filter(o => o.isLight);
  const target = () => { if (!POST) return; renderer.getDrawingBufferSize(PXV); ppTargets(PXV.x, PXV.y, QUALITY[qi].msaa); renderer.setRenderTarget(PP.rt); };
  for (let i = 0; i < objs.length;) {
    const t0 = performance.now(); target();
    try { while (i < objs.length && performance.now() - t0 < 40) { scene.children = lights.concat([objs[i++]]); renderer.compile(scene, camera); } }
    finally { scene.children = all; renderer.setRenderTarget(null); }
    report(i / objs.length); await nextFrame();
  }
  // the passes after the scene, each into the kind of target it draws into (the output encoding is part of a program),
  // one a frame
  if (POST) { target(); renderer.setRenderTarget(null);
    for (const [m, t] of [[matAO, PP.ao], [matBright, PP.bl[0]], [matDown, PP.bl[1]], [matFinal, null]]) { fsQuad.material = m; renderer.setRenderTarget(t); renderer.compile(fsScene, fsCam); renderer.setRenderTarget(null); await nextFrame(); } }
}
const SUNV = new THREE.Vector3(), RAYF = new THREE.Vector3();
let shadowHalf = 0;
const LX = new THREE.Vector3(), LY = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0), TGT = new THREE.Vector3();
function updateSun() {
  const dir = LIGHTDIR;
  const half = P.fly ? Math.min(1400, Math.max(180, (P.y - terrainH(P.x, P.z)) * 2.6)) : 170;
  if (Math.abs(half - shadowHalf) > half * 0.15) { shadowHalf = half; const c = sun.shadow.camera; c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 1; c.far = 3000; c.updateProjectionMatrix(); }
  const fwdX = -Math.sin(P.yaw), fwdZ = -Math.cos(P.yaw), lead = P.fly ? 0 : shadowHalf * 0.45;
  TGT.set(P.x + fwdX * lead, 0, P.z + fwdZ * lead); TGT.y = Math.round(terrainH(TGT.x, TGT.z) / 10) * 10;
  LX.crossVectors(UPV, dir).normalize(); LY.crossVectors(dir, LX);
  // snap to a coarse grid (a whole number of texels) and redraw the shadow map only when the grid cell changes
  const texel = 2 * shadowHalf / Math.max(512, sun.shadow.mapSize.x), stepS = texel * Math.max(1, Math.round(shadowHalf * 0.06 / texel));
  const a = Math.round(TGT.dot(LX) / stepS) * stepS, b = Math.round(TGT.dot(LY) / stepS) * stepS, c = Math.round(TGT.dot(dir) / 50) * 50;
  const key = a + ',' + b + ',' + c + ',' + shadowHalf + ',' + timeI;
  if (key !== shadowKey || STATE.shadowDirty) { shadowKey = key; STATE.shadowDirty = false; renderer.shadowMap.needsUpdate = true; }
  TGT.copy(LX).multiplyScalar(a).addScaledVector(LY, b).addScaledVector(dir, c);
  sun.target.position.copy(TGT); sun.position.copy(TGT).addScaledVector(dir, 1200); sun.target.updateMatrixWorld();
}
let shadowKey = ''; STATE.shadowDirty = true;
renderer.shadowMap.autoUpdate = false;
STATE.lodTimer = 0;
function updateLod() {
  const q = QUALITY[qi], x = camera.position.x, z = camera.position.z, y = Math.max(0, camera.position.y - terrainH(x, z));
  const dist = (x0, z0, s) => { const dx = Math.max(x0 - x, 0, x - x0 - s), dz = Math.max(z0 - z, 0, z - z0 - s); return Math.hypot(dx, dz, y * 0.5); };
  for (const t of tiles.values()) { const v = dist(t.x0, t.z0, TILE) < q.det; for (const m of t.det) m.visible = v; }
  // Far-tree impostors fade into the haze and their tiles stop drawing past impFar: at eye level a few hundred tile
  // draws of sub-pixel trees in fog were a large share of the frame (worst on Firefox, slow per draw). The radius
  // grows with height so a flight still sees the forest out to where the haze closes; the shader fades over the last
  // 500 m (uImpFar) so the cull is never a visible pop.
  const impFar = Math.min(q.far, 2600 + y * 6); U.impFar.value = impFar;
  for (const t of treeTiles.values()) { const d = dist(t.x0, t.z0, TTILE), v = d < q.tree; if (t.hi.length && t.hi[0].visible !== v) STATE.shadowDirty = true; for (const m of t.hi) m.visible = v; const lo = !v && d < impFar; for (const m of t.lo) m.visible = lo; }
}

export { PP, renderFrame, updateLod, updateSun, warmUp };
