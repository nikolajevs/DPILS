import * as THREE from 'three';
import { rest } from '../core/pause.js';
import { bridgeY, sky, terrainH } from '../world/terrain.js';
import { GPU, POST, renderer, scene } from './renderer.js';
import { mixCube } from './cubemix.js';

/* ---------- the city in reflections ----------
   The city is static, so a full-screen SSR every frame would only noise along the Daugava, break at a look along the
   river and fight the dynamic resolution. Instead, once the city is built, three cube maps are shot per time of day:
   the Vienības bridge, Unity Square, Gubišče. Only the building boxes and the landmarks go into the frame — trees,
   vehicles, water and players hide by their userData.noProbe mark (set where they are created). The water and the
   facade glass sample the cubes by the reflection vector: the two nearest probes, blended by inverse distance, so
   there is no seam between them; beyond their reach the old sky Fresnel returns. On «низкая» and «минимум», without
   the HDR pipeline and on software WebGL the probes are not shot at all — the picture stays as it was.
   The running day of the server (src/render/lighting.js) needs the cubes of all three times: each set is shot in the
   light of its own time, and between two times the two sets are mixed into a fourth (src/render/cubemix.js). */
const PROBES = [
  { x: -1742, z: 1863, h: 4, bridge: true },   // the middle of the Vienības bridge: the deck over the water, both banks
  { x: -1505.5, z: 1258, h: 9 },               // Unity Square: over the rondel, under the cornices of Latgola
  { x: 1250, z: -300, h: 10 }                  // Gubišče: the promenade, the lake and the city behind the park
];
const SIZE = 256;
const SOFT = /SwiftShader|llvmpipe|Software/i.test(GPU);
let enabled = false, ready = false, busy = false, want = 0, every = false, fadeOn = false, fadeT = 0;
const captured = [];   // per time of day (0 day, 1 evening, 2 night): [{ pos, rt }]
// a 1×1 black cube till the first probe is shot: the samplers are bound from the first compile of the shaders
const dummy = (() => { const c = document.createElement('canvas'); c.width = c.height = 1; const t = new THREE.CubeTexture([c, c, c, c, c, c]); t.needsUpdate = true; return t; })();
// the uniforms shared by the water and the facade: the two nearest cubes and the blend weight between them
const PU = { uProbeA: { value: dummy }, uProbeB: { value: dummy }, uProbeMix: { value: 0 }, uProbeOn: { value: 0 } };
const cubeRT = () => new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
function probeQuality(i) { enabled = POST && !SOFT && i <= 1; if (!enabled) PU.uProbeOn.value = 0; else pump(); }
/* p: the time of the reflections, 0 day … 2 night; between two times the cubes of both are mixed (a running day).
   all: the day needs the cubes of all three times, so they are shot one after another, not only when it gets there.
   light(i, shoot): runs shoot() in the light of time i (lighting.js lightForShot). */
let lightFor = (i, shoot) => shoot();
function probeTime(p, all, light) { want = Math.max(0, Math.min(2, p)); if (all != null) every = all; if (light) lightFor = light; pump(); }
function missing() {
  const a = Math.floor(want), b = Math.ceil(want);
  for (const i of every ? [a, b, 0, 1, 2] : [a, b]) if (!captured[i]) return i;
  return -1;
}
async function pump() {
  if (busy || !enabled || !ready) return;
  busy = true;
  try { for (let i = missing(); i >= 0 && enabled; i = missing()) await shoot(i); } finally { busy = false; }
}
/* One cube at a time, a frame between them; everything a shot changes (what hides from it, the sky's place, the light
   of its time) is put back before the frame, so a shot in the middle of a game shows nowhere on the screen. */
async function shoot(i) {
  const list = [];
  for (const p of PROBES) {
    const rt = cubeRT(), cam = new THREE.CubeCamera(0.5, 3200, rt);
    cam.position.set(p.x, terrainH(p.x, p.z) + (p.bridge ? bridgeY(p.x, p.z, 0, 0) : 0) + p.h, p.z);
    const hide = [];
    scene.traverse(o => { if (o.userData.noProbe && o.visible) { hide.push(o); o.visible = false; } });
    const skyPos = sky.position.clone(), autoUp = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      sky.position.copy(cam.position);   // the sky sphere is small and sits at the origin: carry it to the probe
      lightFor(i, () => {   // in the light of time i, lent by lighting.js for the moment of the shot (a running day is between the times)
        renderer.shadowMap.needsUpdate = true; cam.update(renderer, scene); });   // one shadow map for all faces, not six
    } finally {
      sky.position.copy(skyPos);
      for (const o of hide) o.visible = true;
      renderer.shadowMap.autoUpdate = autoUp; renderer.shadowMap.needsUpdate = true;   // the cascades were fitted to the cube face: refit them to the view camera
    }
    list.push({ pos: cam.position.clone(), rt });
    await rest();
  }
  captured[i] = list;
}
async function captureProbes() { ready = true; await pump(); }
// the cubes of this moment: of one time, or of two mixed into a third set (src/render/cubemix.js), mixed again as the day moves
let mixed = null; const mixAt = { a: null, b: null, k: -1 };
function cubesNow() {
  const a = Math.floor(want), b = Math.ceil(want), k = want - a, A = captured[a], B = captured[b];
  if (!A || !B) return A || B || null;
  if (k < 0.01) return A;
  if (k > 0.99) return B;
  if (!mixed) mixed = A.map(p => ({ pos: p.pos, rt: cubeRT() }));
  if (A !== mixAt.a || B !== mixAt.b || Math.abs(k - mixAt.k) > 0.004) {   // finer than 1 %: the night cubes are far darker, a step of the mix shows in the dusk
    mixAt.a = A; mixAt.b = B; mixAt.k = k;
    for (let j = 0; j < mixed.length; j++) mixCube(mixed[j].rt, A[j].rt.texture, B[j].rt.texture, k);
  }
  return mixed;
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function updateProbes(cx, cz) {   // every frame from renderFrame: the two nearest probes and the weight between them
  const list = enabled ? cubesNow() : null;   // till the cubes are shot, the sky as before
  if (!list) { PU.uProbeOn.value = 0; fadeOn = false; return; }
  if (!fadeOn) { fadeOn = true; fadeT = performance.now(); }   // the city fades into the mirror, not pops
  let i1 = 0, d1 = Infinity, i2 = 1 % list.length, d2 = Infinity;
  for (let k = 0; k < list.length; k++) { const dx = list[k].pos.x - cx, dz = list[k].pos.z - cz, d = dx * dx + dz * dz; if (d < d1) { i2 = i1; d2 = d1; i1 = k; d1 = d; } else if (d < d2) { i2 = k; d2 = d; } }
  const w1 = 1 / (d1 + 400), w2 = 1 / (d2 + 400);
  PU.uProbeA.value = list[i1].rt.texture; PU.uProbeB.value = list[i2].rt.texture;
  PU.uProbeMix.value = w2 / (w1 + w2);
  PU.uProbeOn.value = (1 - sstep(700, 1400, Math.sqrt(d1))) * Math.min(1, (performance.now() - fadeT) / 600);   // beyond the reach of the probes — the sky as before
}

function probeState() { return { on: PU.uProbeOn.value, mix: PU.uProbeMix.value, want, every, enabled, ready, busy, captured: [0, 1, 2].map(i => !!captured[i]), mixed: mixAt.k }; }   // for window.__city

export { PU, captureProbes, probeQuality, probeState, probeTime, updateProbes };
