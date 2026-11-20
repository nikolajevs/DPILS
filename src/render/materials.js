import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { U, hook } from './renderer.js';
import { PU } from './cityprobe.js';

/* ---------- materials ---------- */
// vertex colours are given in sRGB: they are made linear as they are read. Since three.js r15x vColor is a vec4 and
// three-component colours take the 'vColor.rgb *= color' branch; a chunk that no longer matches is reported.
const SRGB_COLOR_VERTEX = (() => {
  const src = THREE.ShaderChunk.color_vertex, out = src
    .replace('vColor.rgb *= color;', 'vColor.rgb *= pow( color, vec3( 2.2 ) );')
    .replace('vColor *= color;', 'vColor *= vec4( pow( color.rgb, vec3( 2.2 ) ), color.a );');
  if (!out.includes('vColor.rgb *= pow( color')) console.warn('color_vertex changed: vertex colours are not made linear');
  return out;
})();
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
    s.uniforms.uAtlas = { value: STATE.facTex }; s.uniforms.uMask = { value: STATE.facMask }; s.uniforms.uPbr = { value: STATE.facPbr }; s.uniforms.uNrm = { value: STATE.facNrm }; s.uniforms.uNight = U.night; s.uniforms.uLit = U.lit; s.uniforms.uTime = U.time;
    Object.assign(s.uniforms, PU);   // the city cubes: the glass mirrors the street, not the filtered sky
    s.vertexShader = 'attribute vec2 aUv; attribute vec3 aInfo; attribute vec3 aTint;\nvarying vec2 vCellUv; varying vec3 vInfo; varying vec3 vTint; varying float vWy;\n' +
      s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCellUv = aUv; vInfo = aInfo; vTint = pow(aTint, vec3(2.2)); vWy = (modelMatrix * vec4(transformed, 1.0)).y;');
    s.fragmentShader = 'uniform sampler2D uAtlas; uniform sampler2D uMask; uniform sampler2D uPbr; uniform sampler2D uNrm; uniform float uNight; uniform float uLit; uniform float uTime;\nuniform samplerCube uProbeA; uniform samplerCube uProbeB; uniform float uProbeMix; uniform float uProbeOn;\nvarying vec2 vCellUv; varying vec3 vInfo; varying vec3 vTint; varying float vWy;\n' + SAMPLE_GLSL +
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
        vec4 pb = ATLAS(uPbr, auv, gx, gy);   // R roughness, G metalness, B height, A occlusion (src/render/textures.js)
        float hc2 = h12(cell * 1.7 + sd * 31.0 + 3.0);
        tcol = mix(tcol, tcol * (0.7 + 0.6 * hc2) + vec3(0.02, 0.015, 0.0) * step(0.7, hc2), fm.g);
        diffuseColor.rgb = tcol * mix(vec3(1.0), vTint, fm.r);
        diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 2.4, vWy));
      `).replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(pb.r, 0.06, fm.g);')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = pb.g * (1.0 - fm.g);')
        .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace('radiance += iblRadiance;', 'radiance += iblRadiance * (1.0 - fm.g * uProbeOn);') + `
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        if (uProbeOn > 0.01 && fm.g > 0.01) {   // where the probes reach, the glass takes its mirror from the city cubes
          vec3 wn = normalize(geometryNormal * mat3(viewMatrix));
          vec3 wp = cameraPosition - vViewPosition * mat3(viewMatrix);
          vec3 Rw = reflect(normalize(wp - cameraPosition), wn);
          radiance += mix(textureCube(uProbeA, Rw).rgb, textureCube(uProbeB, Rw).rgb, uProbeMix) * fm.g * uProbeOn;
        }
#endif`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {   // the baked tangent-space normal map (Sobel of the PBR height + the micro-grain of the material, see
            // bakeNormals): one fetch, laid on a tangent frame taken from the wall's uv; none on glass, fading out
            // with distance (the mip chain flattens the grain on its own as well)
          vec3 nm = ATLAS(uNrm, auv, gx, gy).rgb * 2.0 - 1.0;
          vec3 pp = -vViewPosition, dp1 = dFdx(pp), dp2 = dFdy(pp); vec2 du1 = dFdx(vCellUv), du2 = dFdy(vCellUv);
          vec3 p2 = cross(dp2, normal), p1 = cross(normal, dp1);
          vec3 tT = p2 * du1.x + p1 * du2.x, tB = p2 * du1.y + p1 * du2.y;
          float im = inversesqrt(max(max(dot(tT, tT), dot(tB, tB)), 1e-12));
          float bw = (1.0 - step(0.1, fm.g)) * (blank ? 0.0 : 1.0) * (1.0 - smoothstep(15.0, 80.0, length(vViewPosition)));
          normal = normalize(normal + (nm.x * tT + nm.y * tB) * im * bw);
        }`).replace('#include <emissivemap_fragment>', `
        // the evening reads in columns and floors, not random cells: a column with the curtains drawn stays dark,
        // a floor gone to bed dims, the stairwell column of some houses is lit whole; uLit is the share of lit windows
        // of the time of day (it was set but never used). A rare cold television flickers behind its own curtain.
        float hcol = h12(vec2(cell.x, 0.0) + sd * 57.0 + 11.0);
        float hfl = h12(vec2(0.0, cell.y) + sd * 71.0 + 23.0);
        float hw = h12(cell + sd * 13.1 + 5.0);
        float p = uLit * (hcol < 0.18 ? 0.12 : 1.0) * (hfl < 0.14 ? 0.25 : 1.0);
        float stair = step(0.86, hcol);
        float lit = max(step(1.0 - p, hw), stair);
        float tv = step(0.94, hc2);
        float flick = 0.75 + 0.45 * h12(vec2(floor(uTime * 2.5), cell.x * 3.1 + cell.y * 7.7) + sd);
        vec3 lc = mix(vec3(1.0, 0.68, 0.36), vec3(0.74, 0.83, 1.0), stair * 0.6);
        // only the brightest fifth of the lit windows crosses the bloom threshold of the evening: the halo sits on
        // single windows, not on the whole facade (the rest stays below it, see TIMES.thresh in lighting.js)
        float bright = 1.0 + hc2 * 0.5 + step(0.78, hc2) * 2.2;
        vec3 emit = lc * bright * lit + vec3(0.5, 0.68, 1.0) * tv * flick * 1.6;
        emit += lc * 0.25 * smoothstep(1.0 - p - 0.1, 1.0 - p, hw) * (1.0 - lit);   // a dim glow behind a drawn curtain
        totalEmissiveRadiance += fm.g * uNight * emit;
      `).replace('#include <aomap_fragment>', `
        float aoF = mix(1.0, pb.a, 0.9);   // the crevices baked from the height take less indirect light
        reflectedLight.indirectDiffuse *= aoF;
#if defined( USE_ENVMAP ) && defined( STANDARD )
        float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
        reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, aoF, material.roughness );
#endif
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
const SSR_ON = { value: 0 };   // 1 while the screen-space mirror runs (src/render/post.js): the painted sheen steps back
const RELIEF = 0.05;   // depth of the ground relief in metres at colour amount 1
/* The low octave of the detail also drives the roughness: asphalt gets damp patches that catch the sky and the lamps
   (and darken a little, as wet stone does), paving a faint sheen; the grain itself varies the roughness slightly. */
const GROUND_WET = { asph: 0.5, pave: 0.15 };
function groundMaterial(tex, scale, amt, key, extra = '') {   // extra: GLSL that may change diffuseColor at the world point vWxz
  const wet = GROUND_WET[key] || 0;
  return std({ vertexColors: true, roughness: 0.96, metalness: 0, depthWrite: false }, 'ground-' + key, s => {
    s.uniforms.uDetail = { value: tex }; s.uniforms.uNight = U.night; s.uniforms.uSsr = SSR_ON;
    s.vertexShader = 'varying vec2 vWxz; varying float vGy;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz; vGy = (modelMatrix * vec4(transformed, 1.0)).y + terrainH(vWxz);')
      .replace('#include <beginnormal_vertex>', `vec2 tW = (modelMatrix * vec4(position, 1.0)).xz;   // ground lies flat in its geometry: its normal is that of the terrain
        vec3 objectNormal = normalize(vec3(terrainH(tW - vec2(6.0, 0.0)) - terrainH(tW + vec2(6.0, 0.0)), 12.0, terrainH(tW - vec2(0.0, 6.0)) - terrainH(tW + vec2(0.0, 6.0))));`);
    s.fragmentShader = 'uniform sampler2D uDetail; uniform float uNight; uniform float uSsr; varying vec2 vWxz; varying float vGy;\n' + SAMPLE_GLSL +
      `float gnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }\n` +
      s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float dt = texture2D(uDetail, vWxz * ${scale.toFixed(4)}).r * 2.0;
      float dt2 = texture2D(uDetail, vWxz * ${(scale * 0.137).toFixed(4)} + 0.37).r * 2.0;
      float wetP = smoothstep(0.62, 0.82, gnoise(vWxz * 0.045) * 0.65 + gnoise(vWxz * 0.16) * 0.35) * ${wet.toFixed(3)};
      diffuseColor.rgb *= mix(1.0, dt, ${amt.toFixed(3)}) * mix(1.0, dt2, ${(amt * 0.6).toFixed(3)}) * (1.0 - 0.3 * wetP);${extra}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * (0.9 + 0.1 * dt); roughnessFactor = mix(roughnessFactor, 0.28, wetP);`)
      .replace('#include <emissivemap_fragment>', wet > 0 ? `#include <emissivemap_fragment>
      {   // the wet patch mirrors the lamps and the evening sky as a sheen stretched along the view. Where the SSR
          // mirror runs (src/render/post.js) it carries the near field — the real lamps and facades — and this painted
          // term keeps only a quarter of itself for the far grazing glow the ray no longer reaches.
          // The noise runs across the view azimuth (soft bands several metres wide, long along it), broken by a slower
          // noise into lamp-like streaks; it lives only at a grazing look. The bands converge to the vanishing point and
          // alias into a vertical comb far off: the sheen fades with the pixel footprint of the band coordinate and dies
          // out well before the haze takes over
        vec3 Vw = normalize(cameraPosition - vec3(vWxz.x, vGy, vWxz.y));
        float graz = pow(1.0 - clamp(Vw.y, 0.0, 1.0), 5.0) * smoothstep(0.30, 0.10, Vw.y);   // a sheen of the grazing look only, not from above
        vec2 va = Vw.xz / max(length(Vw.xz), 1e-3);
        float across = dot(vWxz, vec2(-va.y, va.x)), along = dot(vWxz, va);
        float st = smoothstep(0.50, 0.85, gnoise(vec2(across * 0.12, along * 0.025)))
          * (0.35 + 0.65 * gnoise(vec2(across * 0.04 + 7.3, along * 0.008)));   // broken into lamp-like streaks, not corduroy
        float aa = 1.0 - smoothstep(0.02, 0.08, fwidth(across) * 0.12);   // bands thinner than a pixel dissolve instead of combing
        float far = 1.0 - smoothstep(60.0, 160.0, length(vViewPosition));
        totalEmissiveRadiance += wetP * uNight * graz * st * aa * far * (1.0 - 0.75 * uSsr) * (vec3(1.0, 0.72, 0.4) * 0.32 + uFogGlow * 0.12);
      }` : '#include <emissivemap_fragment>')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      #if ${amt > 0 ? 1 : 0}
      {   // bump from the detail photograph: its grey is the height (relief ${(RELIEF).toFixed(2)} m × colour amount). The slope comes from texture
          // differences along the world axes (the ground is flat), not from screen derivatives, so it is smooth; it fades out with distance
        float e = 1.5 / 512.0, k = ${(RELIEF * amt * 512 * scale / 3).toFixed(4)};
        vec2 q = vWxz * ${scale.toFixed(4)};
        float gx = texture2D(uDetail, q + vec2(e, 0.0)).r - texture2D(uDetail, q - vec2(e, 0.0)).r;
        float gz = texture2D(uDetail, q + vec2(0.0, e)).r - texture2D(uDetail, q - vec2(0.0, e)).r;
        vec3 slope = mat3(viewMatrix) * vec3(-gx, 0.0, -gz) * k * (1.0 - smoothstep(20.0, 90.0, length(vViewPosition)));
        normal = normalize(normal + slope);
      }
      #endif`);
  });
}

export { SAMPLE_GLSL, SSR_ON, allMats, facadeMaterial, groundMaterial, roofMaterial, std };
