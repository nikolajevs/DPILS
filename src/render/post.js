import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { clock } from '../game/loop.js';
import { QUALITY, TOD, qi, timeI } from './lighting.js';
import { P } from '../game/player.js';
import { IMP_HI, IMP_U, ITILE, impTiles, treeTiles } from '../world/trees.js';
import { floraLod } from '../landmarks/flora.js';
import { tiles } from '../buildings/walls.js';
import { terrainH } from '../world/terrain.js';
import { GPU, LIGHTDIR, POST, U, camera, renderer, scene, sun } from './renderer.js';
import { PU, updateProbes } from './cityprobe.js';
import { mirrorPass } from './mirror.js';
import { isStandIn } from './batch.js';
import { waterSsr } from '../world/water.js';
import { TILE, TTILE, reduceMotion } from '../core/env.js';

/* ---------- HDR post-processing: ambient occlusion from depth, bloom, tone mapping ---------- */
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DEPTH_GLSL = `uniform sampler2D tDepth; uniform vec4 uProj;
float zAt(vec2 uv) { return uProj.x * uProj.y / (uProj.y - textureLod(tDepth, uv, 0.0).x * (uProj.y - uProj.x)); }
vec3 posAt(vec2 uv) { float z = zAt(uv); return vec3((uv * 2.0 - 1.0) * uProj.zw * z, z); }`;
/* Scalable ambient obscurance (McGuire et al.): a spiral of depth taps around the pixel, normal rebuilt from depth.
   The pass runs at half resolution, so the centre of its pixel falls on the border of two depth texels, and so do
   its ±1 px neighbours: the nearest fetch picked either side, a neighbour could read the very texel of the centre and
   the rebuilt normal tilted — on walls seen at a grazing angle every other column shaded itself into dark stripes.
   The centre is therefore pinned to one texel of its 2×2 block (uv0) and every tap rebuilds its position from the
   centre of the texel it actually reads (posT). */
const AO_FRAG = `${DEPTH_GLSL}
uniform vec2 uPx; uniform float uAoRes; varying vec2 vUv;
#define NS 12
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 posT(vec2 uv) { return posAt((floor(uv / uPx) + 0.5) * uPx); }
void main() {
  vec2 uv0 = (floor(vUv / uPx - 0.5 + 1e-3) + 0.5) * uPx;
  if (textureLod(tDepth, uv0, 0.0).x >= 0.999999) { gl_FragColor = vec4(1.0, 1e5, 1.0, 1.0); return; }
  vec3 P = posAt(uv0);
  vec3 l = posAt(uv0 - vec2(uPx.x, 0.0)), r = posAt(uv0 + vec2(uPx.x, 0.0)), dn = posAt(uv0 - vec2(0.0, uPx.y)), up = posAt(uv0 + vec2(0.0, uPx.y));
  vec3 dx = abs(l.z - P.z) < abs(r.z - P.z) ? P - l : r - P, dy = abs(dn.z - P.z) < abs(up.z - P.z) ? P - dn : up - P;
  vec3 cn = cross(dy, dx); float cl = length(cn); vec3 n = cl > 1e-12 ? cn / cl : vec3(0.0, 0.0, -1.0);
  // The tap term (v·n)/|v|² is in 1/m, so a crease shades in proportion to 1/R: tuned for the far 18 m spiral, the
  // 1.5 m one near the eye turned the foot of every wall black over a metre-wide band. The R / 18 keeps the far look
  // and makes the darkening of a crease the same at any distance.
  float R = clamp(P.z * 0.10, 1.5, 18.0), rPix = min(R / (P.z * uProj.w) * 0.5 * uAoRes, 0.14 * uAoRes), ao = 1.0;
  if (rPix > 1.5) {
    float phi = ign(gl_FragCoord.xy) * 6.2831853, sum = 0.0;
    for (int i = 0; i < NS; i++) {
      float a = (float(i) + 0.5) / float(NS), ang = float(i) * 2.3999632 + phi;
      vec3 v = posT(uv0 + vec2(cos(ang), sin(ang)) * (sqrt(a) * rPix) * uPx * 2.0) - P;
      float vv = dot(v, v), f = max(R * R - vv, 0.0);
      sum += f * f * f * max((dot(v, n) - 0.004 * P.z - 0.015) / (vv + 0.02), 0.0);
    }
    ao = max(0.0, 1.0 - sum * 5.0 * (R / 18.0) / (float(NS) * R * R * R * R * R * R));
  }
  if (isnan(ao) || isinf(ao) || !(ao >= 0.0)) ao = 1.0;   // recessed windows can leave a degenerate depth stencil
  // the middle scale (3 m): courtyards enclosed by walls, porches and canopies over the pavement — occluders too big
  // for the contact spiral and too near for the large one, which reaches whole buildings at a distance. Its tap term
  // is the cosine of the tap over the surface (≤ 1), not cos/|v|: taps a few centimetres up the wall no longer drive
  // it to its floor, the foot of a wall settles near 0.5 (a right-angled crease hides half the sky) and fades out
  // over a metre or two.
  float aoM = 1.0, Rm = 3.0;
  float rPixM = min(Rm / (P.z * uProj.w) * 0.5 * uAoRes, 0.10 * uAoRes);
  if (rPixM > 1.0) {
    float phiM = ign(gl_FragCoord.xy + 31.0) * 6.2831853, sumM = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = (float(i) + 0.5) / 8.0, ang = float(i) * 2.3999632 + phiM;
      vec3 v = posT(uv0 + vec2(cos(ang), sin(ang)) * (sqrt(a) * rPixM) * uPx * 2.0) - P;
      float vv = dot(v, v), f = max(Rm * Rm - vv, 0.0);
      sumM += f * f * f * max((dot(v, n) - 0.003 * P.z - 0.01) / sqrt(vv + 0.01), 0.0);
    }
    aoM = max(0.0, 1.0 - sumM * 2.0 / (8.0 * Rm * Rm * Rm * Rm * Rm * Rm));
    if (isnan(aoM) || isinf(aoM) || !(aoM >= 0.0)) aoM = 1.0;
  }
  ao *= 0.25 + 0.75 * aoM;
  // contact shadows: a second, tight spiral (35 cm) that darkens the seams where geometry meets — wall bases, curbs,
  // props on the ground. The cascaded sun map cannot resolve such small occluders, so this carries the contact detail.
  float contact = 1.0, Rc = 0.35;
  float rPixC = min(Rc / (P.z * uProj.w) * 0.5 * uAoRes, 0.1 * uAoRes);
  if (rPixC > 0.75) {
    float phiC = ign(gl_FragCoord.xy + 17.0) * 6.2831853, sumC = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = (float(i) + 0.5) / 8.0, ang = float(i) * 2.3999632 + phiC;
      vec3 v = posT(uv0 + vec2(cos(ang), sin(ang)) * (sqrt(a) * rPixC) * uPx * 2.0) - P;
      float vv = dot(v, v), f = max(Rc * Rc - vv, 0.0);
      sumC += f * f * f * max((dot(v, n) - 0.002 * P.z - 0.006) / (vv + 0.005), 0.0);
    }
    contact = max(0.0, 1.0 - sumC * 6.5 / (8.0 * Rc * Rc * Rc * Rc * Rc * Rc));
    if (isnan(contact) || isinf(contact) || !(contact >= 0.0)) contact = 1.0;
  }
  gl_FragColor = vec4(ao, P.z, contact, 1.0);
}`;
/* The AO is noisy by design: a dozen taps a pixel, their spiral turned anew from pixel to pixel. The 3×3 of the final
   pass hid it on open ground, but where a wall meets the pavement every column caught the crease differently and the
   foot of the plinths stood in a comb of dark teeth. A separable bilateral blur at the AO resolution (9 taps a pass,
   σ 2 texels) averages the turns away. Its depth weight follows the plane of the centre: the tap is compared with the
   depth that plane would have there — linear in 1/z on screen, the slope taken from the centre's nearer neighbour —
   so the blur runs along a wall seen at a grazing angle, where the depth changes fast, and stops at silhouettes. The
   contact term (b) is tight: it takes only the inner 5 taps. g carries the depth of the centre unchanged. */
const AO_BLUR_FRAG = `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec4 c = textureLod(tSrc, vUv, 0.0);
  if (!(c.g < 6e4)) { gl_FragColor = c; return; }   // the sky (1e5 overflows the half float to infinity)
  float q0 = 1.0 / c.g, ql = 1.0 / textureLod(tSrc, vUv - uDir, 0.0).g, qr = 1.0 / textureLod(tSrc, vUv + uDir, 0.0).g;
  float sq = abs(qr - q0) < abs(q0 - ql) ? qr - q0 : q0 - ql, tol = 0.015 * c.g + 0.03;
  float a = c.r, w = 1.0, k5 = c.b, w5 = 1.0;
  for (int i = -4; i <= 4; i++) {
    if (i == 0) continue;
    float fi = float(i);
    vec4 t = textureLod(tSrc, vUv + uDir * fi, 0.0);
    float qe = q0 + sq * fi;
    float k = qe > 0.0 && t.g < 6e4 ? exp(-fi * fi / 8.0) * max(0.0, 1.0 - abs(t.g - 1.0 / qe) / tol) : 0.0;
    a += t.r * k; w += k;
    if (abs(i) <= 2) { k5 += t.b * k; w5 += k; }
  }
  gl_FragColor = vec4(a / w, c.g, k5 / w5, 1.0);
}`;
/* Screen-space reflections for the water. No extra geometry pass: the mask is rebuilt from the depth buffer alone —
   a flat normal near the terrain where the shore field says water stands. The ripples are the very normal map of the
   water (src/world/water.js), so the mirror agrees with what the surface already shows. The ray marches the depth of
   the scene (28 growing steps, 5 of bisection); where it finds geometry, the static city cube gives way to the true
   buildings (the delta keeps the probe as the fallback where the ray leaves the screen). The ground does not mirror:
   the damp-asphalt puddles shimmered at eye level and hid the far players. Half the resolution, faded at the screen
   edge and with the ray's distance; «низкая»/«минимум» skip it (QUALITY.ssr). */
const SSR_FRAG = `${DEPTH_GLSL}
#include <common>
uniform sampler2D tScene; uniform sampler2D uShore; uniform sampler2D uNormal;
uniform vec4 uShoreA; uniform vec2 uPx; uniform vec2 uSsrPx; uniform float uTime;
uniform samplerCube uProbeA; uniform samplerCube uProbeB; uniform float uProbeMix; uniform float uProbeOn;
varying vec2 vUv;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 viewN(vec3 P) {
  vec3 l = posAt(vUv - vec2(uPx.x, 0.0)), r = posAt(vUv + vec2(uPx.x, 0.0)), dn = posAt(vUv - vec2(0.0, uPx.y)), up = posAt(vUv + vec2(0.0, uPx.y));
  vec3 dx = abs(l.z - P.z) < abs(r.z - P.z) ? P - l : r - P, dy = abs(dn.z - P.z) < abs(up.z - P.z) ? P - dn : up - P;
  vec3 cn = cross(dy, dx); float cl = length(cn); return cl > 1e-12 ? cn / cl : vec3(0.0, 0.0, -1.0);
}
vec3 march(vec3 P, vec3 R, float maxD, float blur, out float conf) {
  conf = 0.0;
  float t = 0.4 + ign(gl_FragCoord.xy) * 0.4, prev = 0.0;
  vec2 uv = vUv; bool hit = false;
  for (int i = 0; i < 28; i++) {
    vec3 Q = P + R * t;
    if (Q.z <= 0.05) break;
    uv = Q.xy / (Q.z * uProj.zw) * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    if (textureLod(tDepth, uv, 0.0).x >= 0.999999) break;   // the sky: nothing to mirror
    float dz = Q.z - zAt(uv);
    if (dz > 0.02 + t * 0.002 && dz < max(0.5, t * 0.06)) {   // behind the surface, but not through it
      float lo = prev, hi = t;
      for (int k = 0; k < 5; k++) {
        float m = (lo + hi) * 0.5; vec3 Qm = P + R * m;
        vec2 um = Qm.xy / (Qm.z * uProj.zw) * 0.5 + 0.5;
        if (Qm.z - zAt(um) > 0.0) hi = m; else lo = m;
      }
      t = hi; hit = true; break;
    }
    prev = t; t += max(0.4, t * 0.10);
    if (t > maxD) break;
  }
  if (!hit) return vec3(0.0);
  vec3 Q = P + R * t; uv = Q.xy / (Q.z * uProj.zw) * 0.5 + 0.5;
  float edge = smoothstep(0.0, 0.10, uv.x) * smoothstep(1.0, 0.90, uv.x) * smoothstep(0.0, 0.10, uv.y) * smoothstep(1.0, 0.90, uv.y);
  conf = edge * (1.0 - smoothstep(maxD * 0.55, maxD, t));
  vec2 e = uSsrPx * blur * (1.0 + t * 0.012);   // a cross tap for the ripple's roughness, wider far off
  return textureLod(tScene, uv, 0.0).rgb * 0.4
    + (textureLod(tScene, uv + vec2(e.x, 0.0), 0.0).rgb + textureLod(tScene, uv - vec2(e.x, 0.0), 0.0).rgb
    + textureLod(tScene, uv + vec2(0.0, e.y), 0.0).rgb + textureLod(tScene, uv - vec2(0.0, e.y), 0.0).rgb) * 0.15;
}
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1e5);
  if (textureLod(tDepth, vUv, 0.0).x >= 0.999999) return;
  vec3 P = posAt(vUv);
  vec3 n = viewN(P);
  vec3 nw = normalize(vec3(n.x, n.y, -n.z) * mat3(viewMatrix));
  if (nw.y < 0.6) return;   // the mirror lies flat: water, not walls, roofs or boats' sides
  vec3 w = cameraPosition + vec3(P.x, P.y, -P.z) * mat3(viewMatrix);
  float th = terrainH(w.xz);
  float shore = texture2D(uShore, (w.xz - uShoreA.xy) * uShoreA.zw).r;
  vec3 Vw = normalize(cameraPosition - w);
  vec3 col = vec3(0.0); float conf = 0.0;
  if (shore > 0.02 && w.y - th < 1.2) {   // water (the depth under it is the bed, a hand's breadth below the surface); dry ground mirrors nothing
    vec3 n1 = texture2D(uNormal, w.xz / 34.0 + uTime * vec2(0.010, 0.006)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNormal, w.xz / 13.0 + uTime * vec2(-0.012, 0.018)).xyz * 2.0 - 1.0;
    vec3 wn = normalize(vec3(n1.x + n2.x, n1.z * n2.z, n1.y + n2.y));   // the map's z up, as in the water shader
    wn = normalize(mix(wn, vec3(0.0, 1.0, 0.0), smoothstep(150.0, 1500.0, length(P)) * 0.75));
    vec3 Rw = reflect(-Vw, wn);
    if (Rw.y < 0.03) return;   // a steep ripple would mirror the bed, not the city
    float F = 0.05 + 0.95 * pow(1.0 - max(dot(wn, Vw), 0.0), 4.0);
    vec3 nv = mat3(viewMatrix) * wn;
    vec3 hit = march(P, reflect(normalize(P), normalize(vec3(nv.x, nv.y, -nv.z))), 420.0, 0.8, conf);
    vec3 Rp = normalize(vec3(Rw.x, max(Rw.y, 0.02), Rw.z));
    vec3 pc = mix(textureCube(uProbeA, Rp).rgb, textureCube(uProbeB, Rp).rgb, uProbeMix) * uProbeOn;
    col = F * conf * (hit - pc);   // the cube keeps the mirror where the ray found nothing
  }
  gl_FragColor = vec4(col, P.z);
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
uniform sampler2D tScene; uniform sampler2D tAO; uniform sampler2D tSSR; uniform sampler2D tB1; uniform sampler2D tB2; uniform sampler2D tB3;
uniform vec2 uAoPx; uniform vec2 uSsrPx; uniform float uExposure; uniform float uBloom; uniform float uAo; uniform float uContact; uniform float uSsr; uniform float uSeed;
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
    float z = zAt(vUv), a = 0.0, c = 0.0, w = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec3 s = textureLod(tAO, vUv + vec2(float(i), float(j)) * uAoPx, 0.0).rgb;
      float k = max(0.0, 1.0 - abs(s.g - z) / (0.08 * z + 0.05)) + 1e-3; a += s.r * k; c += s.b * k; w += k;
    }
    a /= w; c /= w; if (isnan(a) || isinf(a)) a = 1.0; if (isnan(c) || isinf(c)) c = 1.0;
    a = mix(a, 1.0, clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)) * 0.4, 0.0, 0.65));   // sunlit surfaces keep most of their brightness
    col *= mix(1.0, a, uAo * (1.0 - smoothstep(1500.0, 3000.0, z)));
    col *= mix(1.0, c, uContact * (1.0 - smoothstep(40.0, 140.0, z)));   // contact seams fade out before they alias
  }
  if (uSsr > 0.0 && textureLod(tDepth, vUv, 0.0).x < 0.999999) {   // the mirror, upsampled by depth like the AO
    float z = zAt(vUv); vec3 s = vec3(0.0); float w = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      vec4 t = textureLod(tSSR, vUv + (vec2(float(i), float(j)) - 0.5) * uSsrPx, 0.0);
      float k = max(0.0, 1.0 - abs(t.a - z) / (0.05 * z + 0.03)) + 1e-3;
      s += t.rgb * k; w += k;
    }
    col += s / w;
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
const SOFT = /SwiftShader|llvmpipe|Software/i.test(GPU);   // software WebGL: no mirror in the glass, as no city cubes (cityprobe.js)
// scale: the share of the drawing buffer the scene is drawn at (set by the frame rate, see src/game/perf.js); the
// last pass draws it up to the full canvas
const PP = { rt: null, ao: null, ao2: null, ssr: null, bl: [], w: 0, h: 0, msaa: -1, scale: 1 };
let matAO, matAoBlur, matSSR, matBright, matDown, matFinal;
if (POST) {
  const t = () => ({ value: null }), v2 = () => ({ value: new THREE.Vector2() });
  matAO = fsMat(AO_FRAG, { tDepth: t(), uProj: { value: PROJ }, uPx: v2(), uAoRes: { value: 1 } });
  matAoBlur = fsMat(AO_BLUR_FRAG, { tSrc: t(), uDir: v2() });
  matSSR = fsMat(SSR_FRAG, Object.assign({ tDepth: t(), tScene: t(), uProj: { value: PROJ }, uPx: v2(), uSsrPx: v2(), uShore: t(), uShoreA: { value: new THREE.Vector4() }, uNormal: t(), uTime: U.time }, PU));
  matBright = fsMat(BRIGHT_FRAG, { tSrc: t(), uPx: v2(), uThresh: { value: 2 }, uExposure: { value: 1 } });
  matDown = fsMat(DOWN_FRAG, { tSrc: t(), uPx: v2() });
  matFinal = fsMat(FINAL_FRAG, { tDepth: t(), uProj: { value: PROJ }, tScene: t(), tAO: t(), tSSR: t(), tB1: t(), tB2: t(), tB3: t(), uAoPx: v2(), uSsrPx: v2(), uExposure: { value: 1 }, uBloom: { value: 0 }, uAo: { value: 0 }, uContact: { value: 0 }, uSsr: { value: 0 }, uSeed: { value: 0 }, uSunUv: v2(), uRayI: { value: 0 }, uRayC: { value: new THREE.Vector3(1, 0.7, 0.4) } });
}
function ppTargets(w, h, msaa) {
  w = Math.max(1, Math.round(w * PP.scale)); h = Math.max(1, Math.round(h * PP.scale));
  if (PP.rt && PP.w === w && PP.h === h && PP.msaa === msaa) return;
  for (const t of [PP.rt, PP.ao, PP.ao2, PP.ssr, ...PP.bl]) if (t) t.dispose();
  PP.w = w; PP.h = h; PP.msaa = msaa;
  const o = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, stencilBuffer: false };
  PP.rt = new THREE.WebGLRenderTarget(w, h, Object.assign({ samples: Math.max(0, msaa) }, o));
  PP.rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  const small = k => new THREE.WebGLRenderTarget(Math.max(1, w >> k), Math.max(1, h >> k), Object.assign({ depthBuffer: false }, o));
  PP.ao = small(1); PP.ao2 = small(1); PP.ssr = small(1); PP.bl = [1, 2, 3, 4].map(small);
}
function fsPass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }
function renderFrame() {
  renderer.info.reset();
  updateProbes(camera.position.x, camera.position.z);   // the two nearest city cubes for the water and the glass
  if (!POST) { mirrorPass(0); renderer.render(scene, camera); return; }
  const q = QUALITY[qi], T = TOD;   // the light of this moment: a fixed time or the running day (lighting.js)
  renderer.getDrawingBufferSize(PXV); ppTargets(PXV.x, PXV.y, q.msaa);
  mirrorPass(q.mirror, PP.w, PP.h, STATE.started && !SOFT, terrainH);   // the glass of the wall in view: its mirror, drawn before the scene that samples it (src/render/mirror.js)
  renderer.setRenderTarget(PP.rt); renderer.render(scene, camera);
  const th = Math.tan(camera.fov * Math.PI / 360); PROJ.set(camera.near, camera.far, th * camera.aspect, th);
  if (q.ao) {
    const u = matAO.uniforms; u.tDepth.value = PP.rt.depthTexture; u.uPx.value.set(1 / PP.w, 1 / PP.h); u.uAoRes.value = PP.ao.height; fsPass(matAO, PP.ao);
    const b = matAoBlur.uniforms;   // the noise of the spiral turns blurred away: across, then down, back into PP.ao
    b.tSrc.value = PP.ao.texture; b.uDir.value.set(1 / PP.ao.width, 0); fsPass(matAoBlur, PP.ao2);
    b.tSrc.value = PP.ao2.texture; b.uDir.value.set(0, 1 / PP.ao.height); fsPass(matAoBlur, PP.ao);
  }
  let ssrOn = false;
  if (q.ssr) {
    const wu = waterSsr();   // the shore field and the ripple map appear while the city is built; till then, no mirror
    if (wu.shoreTex && wu.normal && wu.normal.value) {
      const u = matSSR.uniforms;
      u.tDepth.value = PP.rt.depthTexture; u.tScene.value = PP.rt.texture;
      u.uPx.value.set(1 / PP.w, 1 / PP.h); u.uSsrPx.value.set(1 / PP.ssr.width, 1 / PP.ssr.height);
      u.uShore.value = wu.shoreTex; u.uShoreA.value.copy(wu.shoreA); u.uNormal.value = wu.normal.value;
      fsPass(matSSR, PP.ssr); ssrOn = true;
    }
  }
  if (q.bloom) {
    let u = matBright.uniforms; u.tSrc.value = PP.rt.texture; u.uPx.value.set(1 / PP.w, 1 / PP.h); u.uThresh.value = T.thresh; u.uExposure.value = T.exp; fsPass(matBright, PP.bl[0]);
    u = matDown.uniforms; for (let k = 1; k < 4; k++) { u.tSrc.value = PP.bl[k - 1].texture; u.uPx.value.set(1 / PP.bl[k - 1].width, 1 / PP.bl[k - 1].height); fsPass(matDown, PP.bl[k]); }
  }
  const u = matFinal.uniforms;
  u.tScene.value = PP.rt.texture; u.tDepth.value = PP.rt.depthTexture; u.tAO.value = PP.ao.texture; u.tSSR.value = PP.ssr.texture; u.tB1.value = PP.bl[1].texture; u.tB2.value = PP.bl[2].texture; u.tB3.value = PP.bl[3].texture;
  u.uAoPx.value.set(1 / PP.ao.width, 1 / PP.ao.height); u.uSsrPx.value.set(1 / PP.ssr.width, 1 / PP.ssr.height); u.uExposure.value = T.exp; u.uBloom.value = q.bloom ? T.bloom : 0; u.uAo.value = q.ao ? 0.85 : 0; u.uContact.value = q.ao ? 0.9 : 0; u.uSsr.value = ssrOn ? 1 : 0; u.uSeed.value = reduceMotion ? 0 : (clock * 60 % 64);
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
    if (!o.layers.mask || isStandIn(o)) return;   // not drawn: a mesh cut into tiles, a piece drawn by its batch (src/render/batch.js)
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { const k = m.uuid + (o.isInstancedMesh ? 'i' : o.isBatchedMesh ? 'b' : '') + (o.receiveShadow ? 'r' : '') + (o.isPoints ? 'p' : o.isLine ? 'l' : o.isSprite ? 's' : ''); if (!seen.has(k)) { seen.add(k); objs.push(o); } }
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
    for (const [m, t] of [[matAO, PP.ao], [matAoBlur, PP.ao2], [matSSR, PP.ssr], [matBright, PP.bl[0]], [matDown, PP.bl[1]], [matFinal, null]]) { fsQuad.material = m; renderer.setRenderTarget(t); renderer.compile(fsScene, fsCam); renderer.setRenderTarget(null); await nextFrame(); } }
}
const SUNV = new THREE.Vector3(), RAYF = new THREE.Vector3();
/* The sun shadow is redrawn only when a coarse cell of the camera state changes: the cascades snap their centres to
   their own texel grids (SunLightShadow), so between redraws the maps stay fixed in the world and do not shimmer.
   Coverage grows with the eye's height above the ground — on foot the near cascade keeps street detail, in flight the
   slices stretch so the ground below stays inside them. The last cascade fades to no shadow at the coverage edge. */
let shadowFar = 0;
function updateSun() {
  sun.position.copy(LIGHTDIR).multiplyScalar(1000);   // the light shines from its position towards the origin
  if (!renderer.shadowMap.enabled) return;
  const alt = Math.max(0, P.y - terrainH(P.x, P.z));
  const far = Math.min(2400, Math.round((360 + alt * 1.8) / 20) * 20);
  const step = far * 0.02;
  const key = Math.round(camera.position.x / step) + ',' + Math.round(camera.position.z / step) + ',' +
    Math.round(camera.rotation.y / 0.05) + ',' + Math.round(camera.rotation.x / 0.08) + ',' +
    Math.round(camera.fov) + ',' + Math.round(camera.near * 20) + ',' + Math.round(camera.far / 200) + ',' +
    far + ',' + timeI + ',' + qi;
  if (key !== shadowKey || STATE.shadowDirty) {
    shadowKey = key; STATE.shadowDirty = false;
    if (far !== shadowFar) { shadowFar = far; sun.shadow.camera.far = far; }
    renderer.shadowMap.needsUpdate = true;
  }
}
let shadowKey = ''; STATE.shadowDirty = true;
renderer.shadowMap.autoUpdate = false;
STATE.lodTimer = 0;
function updateLod() {
  const q = QUALITY[qi], x = camera.position.x, z = camera.position.z, y = Math.max(0, camera.position.y - terrainH(x, z));
  const dist = (x0, z0, s) => { const dx = Math.max(x0 - x, 0, x - x0 - s), dz = Math.max(z0 - z, 0, z - z0 - s); return Math.hypot(dx, dz, y * 0.5); };
  for (const t of tiles.values()) { const v = dist(t.x0, t.z0, TILE) < q.det; for (const m of t.det) m.visible = v; }
  floraLod(x, z, y, q.tree);   // the flowers of the parks: drawn as far as the near trees (src/landmarks/flora.js)
  // Far-tree impostors fade into the haze and their tiles stop drawing past impFar: at eye level a few hundred tile
  // draws of sub-pixel trees in fog were a large share of the frame (worst on Firefox, slow per draw). The radius
  // grows with height so a flight still sees the forest out to where the haze closes; the shader fades over the last
  // 500 m (uImpFar) so the cull is never a visible pop.
  // A tree tile near the eye shows its trees as models; the impostors are drawn by tiles of 2 × 2 tree tiles
  // (src/world/trees.js), and the shader folds those of a tile shown as models into a point (IMP_U: their keys).
  const impFar = Math.min(q.far, 2600 + y * 6); U.impFar.value = impFar;
  const hiKeys = IMP_U.hi.value; let nHi = 0;
  for (const t of treeTiles.values()) {
    const v = dist(t.x0, t.z0, TTILE) < q.tree; t.near = v;
    if (t.hi.length && t.hi[0].visible !== v) STATE.shadowDirty = true; for (const m of t.hi) m.visible = v;
    if (v) { if (nHi < IMP_HI) hiKeys[nHi++] = t.key; else if (!lodWarned) { lodWarned = true; console.warn('updateLod: more tree tiles near than IMP_HI, their impostors stay'); } }
  }
  IMP_U.n.value = nHi;
  for (const it of impTiles) { let lo = false; if (dist(it.x0, it.z0, ITILE) < impFar) for (const t of it.subs) if (!t.near) { lo = true; break; } it.lo.visible = lo; }
}
let lodWarned = false;

export { PP, renderFrame, updateLod, updateSun, warmUp };
