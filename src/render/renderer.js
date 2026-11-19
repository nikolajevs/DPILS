import * as THREE from 'three';
import { $, progress } from '../core/env.js';

/* ---------- renderer & scene ---------- */
// Colours stay as the city was tuned under three.js r128, before it managed colour spaces: hex values and vertex
// colours are taken as they are (the shaders make vertex colours linear themselves, see SRGB_COLOR_VERTEX), canvas
// textures are marked sRGB and the output is sRGB. Light intensities are multiplied by π where they are set (see
// setTime): three.js no longer scales them by π itself.
THREE.ColorManagement.enabled = false;
const canvas = $('view');
// The HDR pipeline (scene → float target → ambient occlusion, bloom, tone mapping) needs WebGL 2 with float render targets;
// without them the scene is drawn straight to the screen as before.
let POST = false;
try { const g = document.createElement('canvas').getContext('webgl2'); POST = !!(g && g.getExtension('EXT_color_buffer_float')); const lc = g && g.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext(); } catch (e) {}
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !POST, powerPreference: 'high-performance' }); }
catch (e) { progress.textContent = 'Браузер не смог запустить 3D-графику (WebGL).'; throw new Error('the city cannot be built'); }
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = POST ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap was removed; PCF is soft enough now
renderer.info.autoReset = false;
const GL2 = true, MAXTEX = renderer.capabilities.maxTextureSize, ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
let GPU = ''; try { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); if (e) GPU = String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL) || ''); } catch (e) {}
const WEAK_GPU = /Intel|Iris|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Basic Render/i.test(GPU) && !/\bArc\b/i.test(GPU);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 1e-4, 3000);     // .near carries the haze density, .far the distance where the world fades out
const camera = new THREE.PerspectiveCamera(66, 1, 0.3, 3200);
camera.rotation.order = 'YXZ';
const sun = new THREE.DirectionalLight(0xffffff, 3 * Math.PI); scene.add(sun); scene.add(sun.target);
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.15 * Math.PI); scene.add(hemi);
const LIGHTDIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();   // towards the sun (or the moon)
// uniforms shared by many materials
const U = { night: { value: 0 }, lit: { value: 0 }, time: { value: 0 }, sunDir: { value: LIGHTDIR }, fogGlow: { value: new THREE.Color(0, 0, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) } };

/* Aerial perspective instead of the stock linear fog: haze that thins with height, takes the colour of the sky at the
   horizon and glows towards the sun; near the far plane it closes completely so the edge of the world never shows. */
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float fogDepth; varying vec3 vFogRay;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n fogDepth = -mvPosition.z; vFogRay = mvPosition.xyz * mat3(viewMatrix);\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; uniform vec3 uFogGlow; uniform vec3 uFogSun; varying float fogDepth; varying vec3 vFogRay;\n#endif';
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  float fogD = length(vFogRay); vec3 fogR = vFogRay / max(fogD, 1e-3);
  float fogT = fogR.y * fogD / 340.0;
  float fogI = fogNear * exp(-max(cameraPosition.y, 0.0) / 340.0) * fogD * (abs(fogT) > 0.01 ? (1.0 - exp(-fogT)) / fogT : 1.0 - 0.5 * fogT);
  float fogQ = fogD / fogFar; fogQ *= fogQ;
  float fogFactor = 1.0 - exp(-fogI - 5.0 * fogQ * fogQ * fogQ);
  float fogS = max(dot(fogR, uFogSun), 0.0);
  vec3 fogC = fogColor + uFogGlow * (pow(fogS, 6.0) * 0.5 + pow(fogS, 48.0) * 0.6);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogFactor);
#endif`;
// every fogged material gets the two extra fog uniforms; patch may edit the shader further
function hook(m, key, patch) {
  m.onBeforeCompile = s => { terrUniforms(s); s.uniforms.uFogGlow = U.fogGlow; s.uniforms.uFogSun = U.sunDir; if (patch) patch(s); };
  if (key) m.customProgramCacheKey = () => key;
  return m;
}

function terrUniforms(s) { s.uniforms.tTerr = U.tTerr; s.uniforms.uTerrA = U.uTerrA; s.uniforms.uTerrB = U.uTerrB; for (const k in U) if (/^(tPatch|uPatch)/.test(k)) s.uniforms[k] = U[k]; }   // with the fine patches of the terrain (src/world/terrain.js)

export { ANISO, GPU, LIGHTDIR, MAXTEX, POST, U, WEAK_GPU, camera, canvas, hemi, hook, renderer, scene, sun, terrUniforms };
