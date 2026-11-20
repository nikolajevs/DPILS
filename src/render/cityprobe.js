import * as THREE from 'three';
import { rest } from '../core/pause.js';
import { bridgeY, sky, terrainH } from '../world/terrain.js';
import { GPU, POST, renderer, scene } from './renderer.js';

/* ---------- the city in reflections ----------
   The city is static, so a full-screen SSR every frame would only noise along the Daugava, break at a look along the
   river and fight the dynamic resolution. Instead, once the city is built, three cube maps are shot per time of day:
   the Vienības bridge, Unity Square, Gubišče. Only the building boxes and the landmarks go into the frame — trees,
   vehicles, water and players hide by their userData.noProbe mark (set where they are created). The water and the
   facade glass sample the cubes by the reflection vector: the two nearest probes, blended by inverse distance, so
   there is no seam between them; beyond their reach the old sky Fresnel returns. On «низкая» and «минимум», without
   the HDR pipeline and on software WebGL the probes are not shot at all — the picture stays as it was. */
const PROBES = [
  { x: -1742, z: 1863, h: 4, bridge: true },   // the middle of the Vienības bridge: the deck over the water, both banks
  { x: -1505.5, z: 1258, h: 9 },               // Unity Square: over the rondel, under the cornices of Latgola
  { x: 1250, z: -300, h: 10 }                  // Gubišče: the promenade, the lake and the city behind the park
];
const SIZE = 256;
const SOFT = /SwiftShader|llvmpipe|Software/i.test(GPU);
let enabled = false, ready = false, busy = false, wantTime = 0, fadeList = null, fadeT = 0;
const captured = [];   // per time of day: [{ pos, rt }]
// a 1×1 black cube till the first probe is shot: the samplers are bound from the first compile of the shaders
const dummy = (() => { const c = document.createElement('canvas'); c.width = c.height = 1; const t = new THREE.CubeTexture([c, c, c, c, c, c]); t.needsUpdate = true; return t; })();
// the uniforms shared by the water and the facade: the two nearest cubes and the blend weight between them
const PU = { uProbeA: { value: dummy }, uProbeB: { value: dummy }, uProbeMix: { value: 0 }, uProbeOn: { value: 0 } };
function probeQuality(i) { enabled = POST && !SOFT && i <= 1; if (!enabled) PU.uProbeOn.value = 0; else if (ready) ensure(wantTime); }
function probeTime(i) { wantTime = i; if (ready && enabled) ensure(i); }
async function ensure(i) {
  if (busy || captured[i] || !enabled || !ready) return;
  busy = true;
  const hide = [];
  scene.traverse(o => { if (o.userData.noProbe && o.visible) { hide.push(o); o.visible = false; } });
  const skyPos = sky.position.clone(), autoUp = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;   // one shadow map for all faces, not six
  try {
    const list = [];
    for (const p of PROBES) {
      const rt = new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const cam = new THREE.CubeCamera(0.5, 3200, rt);
      cam.position.set(p.x, terrainH(p.x, p.z) + (p.bridge ? bridgeY(p.x, p.z, 0, 0) : 0) + p.h, p.z);
      sky.position.copy(cam.position);   // the sky sphere is small and sits at the origin: carry it to the probe
      cam.update(renderer, scene);
      list.push({ pos: cam.position.clone(), rt });
      await rest();
    }
    captured[i] = list;
  } finally {
    sky.position.copy(skyPos);
    renderer.shadowMap.autoUpdate = autoUp; renderer.shadowMap.needsUpdate = true;
    for (const o of hide) o.visible = true;
    busy = false;
    if (wantTime !== i) ensure(wantTime);   // the time changed while the cubes were being shot
  }
}
async function captureProbes() { ready = true; if (enabled) await ensure(wantTime); }
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function updateProbes(cx, cz) {   // every frame from renderFrame: the two nearest probes and the weight between them
  const list = captured[wantTime];   // only the cubes of this time of day: till they are shot, the sky as before
  if (!list || !enabled) { PU.uProbeOn.value = 0; fadeList = null; return; }
  if (list !== fadeList) { fadeList = list; fadeT = performance.now(); }   // the city fades into the mirror, not pops
  let i1 = 0, d1 = Infinity, i2 = 1 % list.length, d2 = Infinity;
  for (let k = 0; k < list.length; k++) { const dx = list[k].pos.x - cx, dz = list[k].pos.z - cz, d = dx * dx + dz * dz; if (d < d1) { i2 = i1; d2 = d1; i1 = k; d1 = d; } else if (d < d2) { i2 = k; d2 = d; } }
  const w1 = 1 / (d1 + 400), w2 = 1 / (d2 + 400);
  PU.uProbeA.value = list[i1].rt.texture; PU.uProbeB.value = list[i2].rt.texture;
  PU.uProbeMix.value = w2 / (w1 + w2);
  PU.uProbeOn.value = (1 - sstep(700, 1400, Math.sqrt(d1))) * Math.min(1, (performance.now() - fadeT) / 600);   // beyond the reach of the probes — the sky as before
}

function probeState() { return { on: PU.uProbeOn.value, mix: PU.uProbeMix.value, wantTime, enabled, ready, busy, captured: captured.map(l => l || null) }; }   // for window.__city

export { PU, captureProbes, probeQuality, probeState, probeTime, updateProbes };
