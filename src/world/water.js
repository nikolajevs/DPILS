import * as THREE from 'three';
import { WMASK, waterMask } from './data.js';
import { sky } from './terrain.js';
import { U, hook } from '../render/renderer.js';
import { waterNormalTex } from '../render/textures.js';

/* ---------- water ----------
   After the water of the game nikolajevs/game (public/js/gfx/water.js), without extra render passes: ripples from two
   copies of a normal map drifting against each other (the game's own texture, textures/water_normal.webp, made by its
   tools/gen-textures.mjs), the sky mirrored by the angle of view (Fresnel) with the same gradient, sun glow and clouds
   as the sky of the city, glints of the sun, the colour of the water body by depth and a light band along the banks.
   Made for a river and lakes rather than the sea of the game: the ripples sized in metres (about 34 and 13 m) and drifting
   at a third of a metre a second, the colours darker, no breakers rolling in and no swell. Depth here is the distance
   from the bank (the game read it from its island map): a distance field on an 8 m grid over the water mask, up to
   64 m. The water lies at the height of the terrain plus its own small offset, like every other layer of ground. */
const VERT = `varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0); wp.y += terrainH(wp.xz); vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `uniform float uTime; uniform sampler2D uNormal; uniform sampler2D uShore; uniform vec4 uShoreA;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uSkyGlow; uniform vec3 uCloudLit; uniform vec3 uCloudDark;
uniform float uCover; uniform float uNight; uniform float uShoreFix;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
float wh21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh21(i), wh21(i + vec2(1.0, 0.0)), f.x), mix(wh21(i + vec2(0.0, 1.0)), wh21(i + vec2(1.0, 1.0)), f.x), f.y); }
float wfbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * wnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
vec3 sampleN(vec2 uv) { vec3 n = texture2D(uNormal, uv).xyz * 2.0 - 1.0; return vec3(n.x, n.z, n.y); }   // the map's z up: the world's y up
void main() {
  vec2 p = vWorld.xz;
  float shore = uShoreFix >= 0.0 ? uShoreFix : texture2D(uShore, (p - uShoreA.xy) * uShoreA.zw).r * 64.0;   // metres from the bank
  float depth = clamp(shore / 40.0, 0.0, 1.0), dist = length(cameraPosition - vWorld);
  // ripples: two copies of the normal map drifting against each other, calmer far off (no shimmer)
  vec3 n1 = sampleN(p / 34.0 + uTime * vec2(0.010, 0.006)), n2 = sampleN(p / 13.0 + uTime * vec2(-0.012, 0.018));
  vec3 n = normalize(vec3(n1.x + n2.x, n1.y * n2.y, n1.z + n2.z));
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(150.0, 1500.0, dist) * 0.75));
  vec3 V = normalize(cameraPosition - vWorld), R = reflect(-V, n);
  // Fresnel: at a grazing angle the water mirrors the sky, from above one sees into it
  float F = 0.05 + 0.95 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
  float ry = max(R.y, 0.0), sd = max(dot(R, uSunDir), 0.0);
  vec3 skyc = mix(uSkyHor, uSkyTop, 1.0 - exp(-ry * 3.4)) + uSkyGlow * ((pow(sd, 6.0) * 0.5 + pow(sd, 48.0) * 0.6) * (0.3 + 0.7 * exp(-ry * 5.0)));
  // the clouds of the sky, mirrored
  vec2 cp = R.xz / (ry + 0.12) * 1.5 + uTime * vec2(0.004, 0.0015);
  float cn = wfbm(cp) + 0.3 * wfbm(cp * 0.31 + 5.3), dn = smoothstep(0.80 - uCover * 0.4, 1.10 - uCover * 0.4, cn) * smoothstep(0.0, 0.26, ry);
  skyc = mix(skyc, mix(uCloudDark, uCloudLit, 0.55 + 0.45 * pow(sd, 4.0)), dn * 0.85);
  // the water body: greener over the shallows by the banks, dark blue-green out in the stream
  float dark = 1.0 - 0.6 * uNight - 0.3 * pow(uNight, 4.0);   // 1 by day, 0.4 in the evening (uNight 0.8), 0.1 at night
  vec3 body = mix(vec3(0.075, 0.30, 0.28), vec3(0.012, 0.085, 0.13), smoothstep(0.05, 0.8, depth)) * dark;
  vec3 col = mix(body, skyc, F);
  // the sun: a wide sheen and sharp sparks on the ripples
  col += uSunCol * (pow(sd, 1200.0) * 1.2 + pow(sd, 120.0) * 0.12) * smoothstep(-0.05, 0.1, uSunDir.y);
  // a faint light band where the water begins, broken by the ripples
  float tex = smoothstep(-0.25, 0.45, n1.x + n2.z + sin(p.x * 0.35 + uTime * 0.7) * 0.15);
  float foam = smoothstep(0.5, 2.5, shore) * (1.0 - smoothstep(2.5, 6.0, shore)) * tex * 0.22;
  col = mix(col, vec3(0.82, 0.86, 0.84) * dark, foam);
  /* see-through over the shallows, as in the game, and fading in over the first metres from the bank: the edge one sees
     is the smooth line of the distance field, not the straight sides and corners of the OSM outline */
  float alpha = (0.55 + 0.4 * smoothstep(3.0, 16.0, shore)) + F * 0.3 + foam;
  alpha = clamp(alpha, 0.0, 1.0) * (uShoreFix >= 0.0 ? 1.0 : smoothstep(0.0, 3.5, shore));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// metres from the nearest bank on an 8 m grid over the water mask (two-pass chamfer distance), as a texture
function shoreTexture() {
  if (!WMASK) waterMask();
  const W = WMASK, NX = W.NX >> 1, NZ = W.NZ >> 1, S = W.S * 2, n = NX * NZ, d = new Float32Array(n), INF = 1e6;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { let wet = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) if (W.m[(2 * j + b) * W.NX + 2 * i + a] === 1) wet++;
    d[j * NX + i] = wet >= 3 ? INF : 0; }
  const D1 = S, D2 = S * Math.SQRT2;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i; if (!d[k]) continue; let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + D1); if (j > 0) { v = Math.min(v, d[k - NX] + D1); if (i > 0) v = Math.min(v, d[k - NX - 1] + D2); if (i < NX - 1) v = Math.min(v, d[k - NX + 1] + D2); } d[k] = v; }
  for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) { const k = j * NX + i; if (!d[k]) continue; let v = d[k];
    if (i < NX - 1) v = Math.min(v, d[k + 1] + D1); if (j < NZ - 1) { v = Math.min(v, d[k + NX] + D1); if (i < NX - 1) v = Math.min(v, d[k + NX + 1] + D2); if (i > 0) v = Math.min(v, d[k + NX - 1] + D2); } d[k] = v; }
  // smoothed twice over 3 × 3 cells, so the line the water fades in along has no steps of the grid
  for (let pass = 0; pass < 2; pass++) { const e = Float32Array.from(d);
    for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) { const k = j * NX + i; if (e[k] >= INF / 2) continue; let s = 0, c = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const v = e[k + b * NX + a]; if (v < INF / 2) { s += v; c++; } } d[k] = s / c; } }
  const data = new Uint8Array(n); for (let k = 0; k < n; k++) data[k] = Math.round(Math.max(0, Math.min(64, d[k] - S / 2)) / 64 * 255);
  const t = new THREE.DataTexture(data, NX, NZ, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return { tex: t, a: new THREE.Vector4(W.X0, W.Z0, 1 / (NX * S), 1 / (NZ * S)) };
}

/* the material of the water: for the river and the lakes (made once the water areas are known), or with shoreFix the
   metres from the bank everywhere (the ditches of the fortress, which are not in the water mask) */
let SHORE = null, NORMAL = null; const MATS = new Map();
function waterMat(shoreFix = -1) {
  if (MATS.has(shoreFix)) return MATS.get(shoreFix);
  if (!SHORE) SHORE = shoreTexture();
  if (!NORMAL) { NORMAL = { value: waterNormalTex() }; NORMAL.value.wrapS = NORMAL.value.wrapT = THREE.RepeatWrapping;
    // the game's normal map once it has arrived (till then the procedural one of the city)
    new THREE.TextureLoader().load('textures/water_normal.webp', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; NORMAL.value = t; }); }
  const su = sky.material.uniforms, m = hook(new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: true, depthWrite: false }), 'water');
  Object.assign(m.uniforms, { uTime: U.time, uNormal: NORMAL, uShore: { value: SHORE.tex }, uShoreA: { value: SHORE.a }, uShoreFix: { value: shoreFix }, uSunDir: U.sunDir, uSunCol: U.sunCol,
    uSkyTop: su.uSkyTop, uSkyHor: su.uSkyHor, uSkyGlow: su.uSkyGlow, uCloudLit: su.uCloudLit, uCloudDark: su.uCloudDark, uCover: su.uCover, uNight: U.night });
  MATS.set(shoreFix, m);
  return m;
}

export { waterMat };
