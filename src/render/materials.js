import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { U, hook } from './renderer.js';

/* ---------- materials ---------- */
const SRGB_COLOR_VERTEX = THREE.ShaderChunk.color_vertex.replace('vColor *= color;', 'vColor *= pow( color, vec3( 2.2 ) );').replace('vColor.xyz *= color.xyz;', 'vColor.xyz *= pow( color.xyz, vec3( 2.2 ) );');
const SAMPLE_GLSL = `
#if __VERSION__ >= 300
#define ATLAS(t, uv, dx, dy) textureGrad(t, uv, dx, dy)
#else
#define ATLAS(t, uv, dx, dy) texture2D(t, uv)
#endif
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;
const allMats = [];
function std(opts, key, patch) {
  const m = hook(new THREE.MeshStandardMaterial(opts), key, s => { s.vertexShader = s.vertexShader.replace('#include <color_vertex>', SRGB_COLOR_VERTEX); if (patch) patch(s); });
  allMats.push(m); return m;
}

function facadeMaterial() {
  const m = std({ roughness: 0.9, metalness: 0 }, 'facade', s => {
    s.uniforms.uAtlas = { value: STATE.facTex }; s.uniforms.uMask = { value: STATE.facMask }; s.uniforms.uNight = U.night;
    s.vertexShader = 'attribute vec2 aUv; attribute vec3 aInfo; attribute vec3 aTint;\nvarying vec2 vCellUv; varying vec3 vInfo; varying vec3 vTint; varying float vWy;\n' +
      s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCellUv = aUv; vInfo = aInfo; vTint = pow(aTint, vec3(2.2)); vWy = (modelMatrix * vec4(transformed, 1.0)).y;');
    s.fragmentShader = 'uniform sampler2D uAtlas; uniform sampler2D uMask; uniform float uNight;\nvarying vec2 vCellUv; varying vec3 vInfo; varying vec3 vTint; varying float vWy;\n' + SAMPLE_GLSL +
      s.fragmentShader.replace('#include <map_fragment>', `
        vec2 dX = dFdx(vCellUv), dY = dFdy(vCellUv);
        float row = vInfo.x, sd = vInfo.y / 255.0, fl = vInfo.z;
        bool shopF = mod(fl, 2.0) > 0.5, blank = fl > 1.5;
        vec2 cell = floor(vCellUv), f = fract(vCellUv);
        float hc = h12(cell + sd * 97.0);
        float col = 0.0;
        if (row < 1.5) col = floor(sd * 2.999);
        else if (row < 3.5) { col = hc < 0.2 + sd * 0.55 ? 2.0 : 0.0; if (row > 2.5 && sd < 0.3 && col < 1.0) col = 1.0; if (row < 2.5 && hc > 0.9) col = 1.0; }
        else if (row < 4.5) col = sd < 0.55 ? 0.0 : (sd < 0.85 ? 1.0 : 2.0);
        else if (row < 5.5) col = hc < 0.25 ? 2.0 : (sd < 0.5 ? 0.0 : 1.0);
        else if (row < 6.5) col = sd < 0.45 ? 0.0 : (sd < 0.75 ? 2.0 : 1.0);
        else col = hc < 0.15 ? 1.0 : 0.0;
        if (cell.y < 0.5) {
          if (shopF && row < 4.5) col = 3.0;
          else if (row > 4.5 && row < 5.5 && hc > 0.86) col = 3.0;
          else if (row > 5.5 && row < 6.5 && hc > 0.8) col = 3.0;
          else if (row > 6.5) col = sd > 0.6 ? 2.0 : (hc > 0.82 ? 3.0 : col);
        }
        vec2 sc = vec2(1.0);
        if (blank) { col = (row > 4.5 && row < 5.5) ? 2.0 : 0.0; f.x = 0.04 + fract(vCellUv.x * 4.0) * 0.12; sc.x = 0.48; }
        if (row > 5.5 && row < 6.5 && blank) col = 1.0;
        vec2 auv = (vec2(col, 7.0 - row) + clamp(f, 0.003, 0.997)) * vec2(0.25, 0.125);
        vec2 gx = dX * sc * vec2(0.25, 0.125), gy = dY * sc * vec2(0.25, 0.125);
        vec3 tcol = pow(ATLAS(uAtlas, auv, gx, gy).rgb, vec3(2.2));
        vec4 fm = ATLAS(uMask, auv, gx, gy);
        float hc2 = h12(cell * 1.7 + sd * 31.0 + 3.0);
        tcol = mix(tcol, tcol * (0.7 + 0.6 * hc2) + vec3(0.02, 0.015, 0.0) * step(0.7, hc2), fm.g);
        diffuseColor.rgb = tcol * mix(vec3(1.0), vTint, fm.r);
        diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 2.4, vWy));
      `).replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.06, fm.g);')
        .replace('#include <emissivemap_fragment>', `
        float lit = step(0.5, h12(cell + sd * 13.1 + 5.0));
        vec3 lc = mix(vec3(1.0, 0.68, 0.36), vec3(0.62, 0.78, 1.0), step(0.92, hc2));
        totalEmissiveRadiance += fm.g * lit * uNight * lc * (1.2 + hc2);
      `);
  });
  m.extensions = { derivatives: true }; return m;
}
function roofMaterial() {
  const m = std({ roughness: 0.85, metalness: 0 }, 'roof', s => {
    s.uniforms.uAtlas = { value: STATE.roofTex };
    s.vertexShader = 'attribute vec2 aUv; attribute vec3 aInfo; attribute vec3 aTint;\nvarying vec2 vCellUv; varying vec3 vInfo; varying vec3 vTint;\n' +
      s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCellUv = aUv; vInfo = aInfo; vTint = pow(aTint, vec3(2.2));');
    s.fragmentShader = 'uniform sampler2D uAtlas;\nvarying vec2 vCellUv; varying vec3 vInfo; varying vec3 vTint;\n' + SAMPLE_GLSL +
      s.fragmentShader.replace('#include <map_fragment>', `
        vec2 dX = dFdx(vCellUv), dY = dFdy(vCellUv);
        float mt = vInfo.x; vec2 f = fract(vCellUv);
        vec2 auv = (vec2(mod(mt, 4.0), 1.0 - floor(mt / 4.0)) + clamp(f, 0.003, 0.997)) * vec2(0.25, 0.5);
        vec3 tcol = pow(ATLAS(uAtlas, auv, dX * vec2(0.25, 0.5), dY * vec2(0.25, 0.5)).rgb, vec3(2.2));
        diffuseColor.rgb = tcol * vTint * (0.92 + 0.16 * h12(floor(vCellUv * 0.5) + vInfo.y));
      `).replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vInfo.z / 255.0;');
  });
  m.extensions = { derivatives: true }; return m;
}
function groundMaterial(tex, scale, amt, key, extra = '') {   // extra: GLSL that may change diffuseColor at the world point vWxz
  return std({ vertexColors: true, roughness: 0.96, metalness: 0, depthWrite: false }, 'ground-' + key, s => {
    s.uniforms.uDetail = { value: tex };
    s.vertexShader = 'varying vec2 vWxz;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz;')
      .replace('#include <beginnormal_vertex>', `vec2 tW = (modelMatrix * vec4(position, 1.0)).xz;   // ground lies flat in its geometry: its normal is that of the terrain
        vec3 objectNormal = normalize(vec3(terrainH(tW - vec2(6.0, 0.0)) - terrainH(tW + vec2(6.0, 0.0)), 12.0, terrainH(tW - vec2(0.0, 6.0)) - terrainH(tW + vec2(0.0, 6.0))));`);
    s.fragmentShader = 'uniform sampler2D uDetail; varying vec2 vWxz;\n' + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float dt = texture2D(uDetail, vWxz * ${scale.toFixed(4)}).r * 2.0;
      float dt2 = texture2D(uDetail, vWxz * ${(scale * 0.137).toFixed(4)} + 0.37).r * 2.0;
      diffuseColor.rgb *= mix(1.0, dt, ${amt.toFixed(3)}) * mix(1.0, dt2, ${(amt * 0.6).toFixed(3)});${extra}`);
  });
}

export { SAMPLE_GLSL, allMats, facadeMaterial, groundMaterial, roofMaterial, std };
