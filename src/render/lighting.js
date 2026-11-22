import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { resize } from '../game/loop.js';
import { TX } from '../transit/transit.js';
import { lampsOn } from '../world/lamps.js';
import { lampMost } from '../world/lamp-light.js';
import { setLampShadows } from './lamp-shadows.js';
import { lmNight } from '../landmarks/index.js';
import { matGold } from '../world/data.js';
import { allMats } from './materials.js';
import { probeQuality, probeTime } from './cityprobe.js';
import { mixCube, pmremLike } from './cubemix.js';
import { envScene, envSky, pmrem, sky } from '../world/terrain.js';
import { LIGHTDIR, MAXTEX, U, WEAK_GPU, hemi, renderer, scene, sun } from './renderer.js';
import { lin } from '../core/util.js';
import { $ } from '../core/env.js';
import { DAY_MS, dayPhase } from '../../server/daycycle.mjs';

/* ---------- lighting, sky, quality ---------- */
/* Time of day. Colours are linear; sun/moon direction is "towards the light" (+x east, +z south).
   haze = fog density per metre at ground level, lit = share of windows with the light on, lamps = strength of the
   street lamps (src/world/lamp-light.js; in the evening the sky is still light, so they add less), nt = the night of the
   lit windows, the landmarks and the water (U.night), probe = which city cubes the reflections take (0 day, 1 evening,
   2 night; between — a mix of the two, src/render/cityprobe.js). The three fixed times are the choice of the training. */
const TIMES = [
  { name: 'день', dir: [-0.55, 0.62, 0.56], top: '#1f5fbf', hor: '#b9d0e6', glow: [0.9, 0.78, 0.55], gnd: '#737868', sun: '#fff0dc', sunI: 2.7, disc: 60, hemi: 0.08, exp: 0.8,
    lit: 0, cover: 0.42, cloudLit: [1.35, 1.3, 1.22], cloudDark: [0.36, 0.43, 0.56], stars: 0, haze: 1 / 9000, thresh: 2.6, bloom: 0.45, rays: 0.12, lamps: 0, nt: 0, probe: 0 },
  { name: 'вечер', dir: [-0.9, 0.17, -0.4], top: '#2f5596', hor: '#e2b189', glow: [1.7, 0.72, 0.26], gnd: '#6a6052', sun: '#ffab63', sunI: 2.5, disc: 50, hemi: 0.1, exp: 0.95,
    lit: 0.3, cover: 0.5, cloudLit: [1.5, 0.9, 0.55], cloudDark: [0.3, 0.3, 0.42], stars: 0, haze: 1 / 5500, thresh: 2.0, bloom: 0.6, rays: 0.6, lamps: 0.55, nt: 0.8, probe: 1 },
  { name: 'ночь', dir: [0.45, 0.7, -0.4], top: '#03060d', hor: '#111927', glow: [0.1, 0.12, 0.18], gnd: '#0b0f17', sun: '#8ea6f2', sunI: 0.34, disc: 3, hemi: 0.05, exp: 1.25,
    lit: 0.5, cover: 0.38, cloudLit: [0.1, 0.115, 0.15], cloudDark: [0.02, 0.025, 0.035], stars: 1, haze: 1 / 5000, thresh: 1.1, bloom: 0.9, rays: 0.1, lamps: 1, nt: 1, probe: 2 }
];

/* ---------- the day of the game ----------
   On the server (and in the training's «авто») the day runs: 45 minutes from midnight to midnight (server/daycycle.mjs).
   The sun walks the path it has over Daugavpils (55.9° N) in early May or mid-August: up in the north-east at five, 44°
   over the south at noon, down in the north-west at seven; at night a full moon goes the opposite way, 42° high at
   midnight. The look of the sky and the light is keyed by the height of the sun: the three fixed times and four more
   between them — the morning, the dawn and the sunset with the sun on the horizon, the blue dusk after the sun is gone —
   and every parameter goes smoothly from one key to the next. The morning keys differ from the evening ones (a cooler,
   pinker dawn, the lamps going out). The direct light is the sun while it is up; below the horizon it fades out, and
   in the blue dusk, where it is nothing, the light passes to the moon. */
const SET = { name: 'закат', top: '#243a70', hor: '#e8946a', glow: [2.2, 0.7, 0.22], gnd: '#544538', sun: '#ff7a38', sunI: 1.8, disc: 40, hemi: 0.09, exp: 1.05,
  lit: 0.4, cover: 0.5, cloudLit: [1.6, 0.62, 0.35], cloudDark: [0.26, 0.2, 0.3], stars: 0, haze: 1 / 5000, thresh: 1.7, bloom: 0.7, rays: 0.75, lamps: 0.8, nt: 0.9, probe: 1.3 };
const BLUE = { name: 'сумерки', top: '#0a1530', hor: '#2e3b58', glow: [0, 0, 0], gnd: '#171a22', sun: '#8ea6f2', sunI: 0, disc: 0, hemi: 0.065, exp: 1.2,
  lit: 0.48, cover: 0.42, cloudLit: [0.14, 0.12, 0.16], cloudDark: [0.045, 0.05, 0.075], stars: 0.2, haze: 1 / 5000, thresh: 1.3, bloom: 0.85, rays: 0, lamps: 1, nt: 1, probe: 1.75 };
const DAWN = { name: 'рассвет', top: '#2c4a86', hor: '#e6a296', glow: [1.8, 0.8, 0.5], gnd: '#4f4a48', sun: '#ff9a70', sunI: 1.8, disc: 40, hemi: 0.09, exp: 1.05,
  lit: 0.3, cover: 0.45, cloudLit: [1.55, 0.85, 0.75], cloudDark: [0.27, 0.25, 0.36], stars: 0, haze: 1 / 4200, thresh: 1.8, bloom: 0.7, rays: 0.65, lamps: 0.8, nt: 0.85, probe: 1.3 };
const MORN = { name: 'утро', top: '#2a59a8', hor: '#d6c4b4', glow: [1.3, 0.92, 0.6], gnd: '#6b695e', sun: '#ffd6a8', sunI: 2.5, disc: 55, hemi: 0.09, exp: 0.88,
  lit: 0.05, cover: 0.42, cloudLit: [1.45, 1.15, 0.95], cloudDark: [0.33, 0.36, 0.48], stars: 0, haze: 1 / 6000, thresh: 2.3, bloom: 0.55, rays: 0.4, lamps: 0, nt: 0.25, probe: 0.5 };
const DEG = Math.PI / 180, LAT = 55.87 * DEG, DECL = 10 * DEG, MOON_DECL = 8 * DEG, BLUE_E = -7;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// towards a body of declination d at the hour angle H (0 at its highest, growing westwards): +x east, +y up, +z south
function skyDir(H, d, v) {
  const north = Math.sin(d) * Math.cos(LAT) - Math.cos(d) * Math.cos(H) * Math.sin(LAT);
  return v.set(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.sin(LAT) + Math.cos(d) * Math.cos(H) * Math.cos(LAT), -north);
}
// the hour angle (after noon) at which the sun stands e degrees over the horizon
const hourAt = e => Math.acos(clamp((Math.sin(e * DEG) - Math.sin(LAT) * Math.sin(DECL)) / (Math.cos(LAT) * Math.cos(DECL)), -1, 1));
// the keys by the height of the sun, in degrees: after noon to the evening, before noon from the morning
const DUSK = [[24, TIMES[0]], [9, TIMES[1]], [0, SET], [BLUE_E, BLUE], [-14, TIMES[2]]];
const DAWNS = [[24, TIMES[0]], [9, MORN], [0, DAWN], [BLUE_E, BLUE], [-14, TIMES[2]]];
const KEYS = [...TIMES, SET, BLUE, DAWN, MORN];
{ // the direction each key's own sky is drawn with (its glow round the sun): the sun at that height, morning or evening
  const v = new THREE.Vector3(), at = (H, K) => { skyDir(H, DECL, v); K.dir = [v.x, v.y, v.z]; };
  at(hourAt(0), SET); at(hourAt(BLUE_E), BLUE); at(-hourAt(0), DAWN); at(-hourAt(9), MORN);
}
for (const K of KEYS) K.c = { top: lin(K.top), hor: lin(K.hor), gnd: lin(K.gnd), sun: lin(K.sun) };
// the light of this moment: a key, or a mix of two (post.js takes the exposure, the bloom and the rays from it)
const TOD = { c: { top: new THREE.Color(), hor: new THREE.Color(), gnd: new THREE.Color(), sun: new THREE.Color() }, glow: [0, 0, 0], cloudLit: [0, 0, 0], cloudDark: [0, 0, 0] };
const SC = ['sunI', 'disc', 'hemi', 'exp', 'lit', 'cover', 'stars', 'thresh', 'bloom', 'rays', 'lamps', 'nt', 'probe'];
function mixKeys(A, B, t) {
  for (const k in TOD.c) TOD.c[k].copy(A.c[k]).lerp(B.c[k], t);
  for (const k of ['glow', 'cloudLit', 'cloudDark']) for (let j = 0; j < 3; j++) TOD[k][j] = A[k][j] + (B[k][j] - A[k][j]) * t;
  for (const k of SC) TOD[k] = A[k] + (B[k] - A[k]) * t;
  TOD.haze = Math.exp(Math.log(A.haze) + (Math.log(B.haze) - Math.log(A.haze)) * t);   // the haze thins and thickens by factors
}
function skyLook(s, T, env) {
  const u = s.material.uniforms;
  u.uSkyTop.value.copy(T.c.top); u.uSkyHor.value.copy(T.c.hor); u.uSkyGnd.value.copy(T.c.gnd); u.uSkyGlow.value.fromArray(T.glow);
  u.uSunDisc.value.copy(T.c.sun).multiplyScalar(env ? 0 : T.disc); u.uCloudLit.value.fromArray(T.cloudLit); u.uCloudDark.value.fromArray(T.cloudDark);
  u.uStars.value = env ? 0 : T.stars; u.uCover.value = T.cover; u.uSkyline.value = env ? 1 : 0;
}
// TOD onto the scene: the sky (the water takes the same uniforms), the haze, the sun or the moon, the windows, the lamps
let shownN = -1, shownL = -1;
function apply(force) {
  const T = TOD;
  skyLook(sky, T, false);
  scene.fog.color.copy(T.c.hor); scene.fog.near = T.haze; U.fogGlow.value.fromArray(T.glow);
  sun.color.copy(T.c.sun); sun.intensity = T.sunI * Math.PI; U.sunCol.value.copy(T.c.sun).multiplyScalar(T.sunI);   // ×π: the old scale of light
  sun.position.copy(LIGHTDIR).multiplyScalar(1000);
  hemi.intensity = T.hemi * Math.PI;
  renderer.toneMappingExposure = T.exp;
  U.lit.value = T.lit;
  if (force || Math.abs(T.nt - shownN) > 0.004) { shownN = T.nt; U.night.value = T.nt; lmNight(T.nt); }
  if (force || Math.abs(T.lamps - shownL) > 0.004 || (T.lamps > 0) !== (shownL > 0)) { shownL = T.lamps; lampsOn(T.lamps); for (const g of TX.glow) g.visible = T.lamps > 0; }
}
// a key whole, with its own direction of the light
function show(K) { LIGHTDIR.set(K.dir[0], K.dir[1], K.dir[2]).normalize(); mixKeys(K, K, 0); apply(true); }
/* The environment (the light of the sky on every material) of a key: filtered once (the GGX filter of three.js is
   costly on weak GPUs) and kept. Between two keys the day mixes their two environments into one more cube (cubemix.js). */
const TMPV = new THREE.Vector3();
function envOf(K) {
  if (K.env) return K.env;
  TMPV.copy(LIGHTDIR); LIGHTDIR.set(K.dir[0], K.dir[1], K.dir[2]).normalize();   // U.sunDir is LIGHTDIR: the glow of the key's sky
  skyLook(envSky, K, true);
  K.env = pmrem.fromScene(envScene, 0, 0.1, 100);
  LIGHTDIR.copy(TMPV);
  return K.env;
}
function useEnv(rt) { if (STATE.envRT !== rt) { STATE.envRT = rt; scene.environment = rt.texture; } }
let envMix = null; const envAt = { a: null, b: null, k: -1 };
function mixEnv(A, B, k) {
  const a = envOf(A), b = envOf(B);
  if (!envMix) envMix = pmremLike(a);
  if (a !== envAt.a || b !== envAt.b || Math.abs(k - envAt.k) > 0.008) { envAt.a = a; envAt.b = b; envAt.k = k; mixCube(envMix, a.texture, b.texture, k, a.texture.mipmaps.length); }
  useEnv(envMix);
}

let timeI = 0, fixed = 0, cyc = null;   // timeI: the nearest of the three times (the shadow key, the birds); cyc: the running day, or null — a fixed time
function setTime(i) {
  cyc = null; fixed = timeI = i; const T = TIMES[i];
  show(T); useEnv(envOf(T));
  STATE.night = i === 2;
  probeTime(T.probe, false, lightForShot);   // the city cubes of this time of day, shot once the city stands (src/render/cityprobe.js)
  STATE.shadowDirty = true; STATE.mapTimer = 0;
}
/* The day from the share f of it gone (0 midnight, 0.5 noon), `len` ms long; len = Infinity stops the clock there
   (the tools: a view at a chosen hour). The environments of all the keys are filtered now, not in the middle of a fight. */
function setCycle(f, len = DAY_MS) {
  cyc = { f0: f, t0: performance.now(), len, at: -1, f, e: 0 };
  for (const K of KEYS) envOf(K);
  dayTick(true);
}
const dayShare = () => (((cyc.f0 + (performance.now() - cyc.t0) / cyc.len) % 1) + 1) % 1;
const SV = new THREE.Vector3(), MV = new THREE.Vector3(), shadowDir = new THREE.Vector3();
// every frame from the loop; the light is set ten times a second, the sun shadow is redrawn when the light has moved 0.15°
function dayTick(force) {
  if (!cyc) return;
  const now = performance.now();
  if (!force && now - cyc.at < 100) return;
  cyc.at = now;
  const f = dayShare(), H = (f - 0.5) * 2 * Math.PI;
  skyDir(H, DECL, SV); const e = Math.asin(clamp(SV.y, -1, 1)) / DEG;
  const keys = H > 0 ? DUSK : DAWNS;
  let A = keys[0][1], B = A, k = 0;
  if (e < keys[0][0]) {
    A = B = keys[keys.length - 1][1];
    for (let j = 0; j + 1 < keys.length; j++) if (e > keys[j + 1][0]) { A = keys[j][1]; B = keys[j + 1][1]; k = (keys[j][0] - e) / (keys[j][0] - keys[j + 1][0]); break; }
  }
  mixKeys(A, B, k);
  if (e > BLUE_E) { LIGHTDIR.copy(SV); TOD.sunI *= sstep(-1, 3, e); }   // the sun: its light fades as it touches the horizon
  else LIGHTDIR.copy(skyDir(H + Math.PI, MOON_DECL, MV));   // the moon, opposite the sun
  TOD.lamps = clamp((4 - e) / 10, 0, 1);   // the street lamps: on as the sun sets, full in the dusk; out in the morning the same way
  apply(force);
  mixEnv(A, B, k);
  const night = e < BLUE_E; if (night !== STATE.night) { STATE.night = night; STATE.mapTimer = 0; }
  timeI = TOD.probe < 0.5 ? 0 : TOD.probe < 1.5 ? 1 : 2;
  probeTime(TOD.probe, true, lightForShot);   // the day needs the cubes of all three times: shot one after another, then mixed
  if (force || LIGHTDIR.angleTo(shadowDir) > 0.0026) { shadowDir.copy(LIGHTDIR); STATE.shadowDirty = true; }
  cyc.f = f; cyc.e = e;
}
function relight() { if (cyc) dayTick(true); else setTime(fixed); }
// the city cubes of time i are shot in the light of that time (cityprobe.js): a running day lends it to them for the moment of the shot
function lightForShot(i, shoot) {
  if (!cyc && i === fixed) { shoot(); return; }
  const keep = new THREE.Vector3().copy(LIGHTDIR);
  show(TIMES[i]); useEnv(envOf(TIMES[i]));
  try { shoot(); } finally {
    LIGHTDIR.copy(keep);
    if (cyc) dayTick(true); else { show(TIMES[fixed]); useEnv(envOf(TIMES[fixed])); }
  }
}
// for the tools and window.__city: what the sky shows now
function dayInfo() {
  if (!cyc) return { mode: 'fixed', time: fixed, name: TIMES[fixed].name };
  const h = cyc.f * 24;
  return { mode: 'cycle', f: +cyc.f.toFixed(5), clock: String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor(h % 1 * 60)).padStart(2, '0'), sun: +cyc.e.toFixed(2), lenMin: cyc.len / 60000, light: LIGHTDIR.toArray().map(v => +v.toFixed(3)), night: STATE.night };
}
/* The choice of the training (the lobby, src/ui/start.js): «авто» or a fixed time, remembered in the browser. Before a
   game the city behind the card shows that choice; «авто» there is the day of the server's clock (daycycle.mjs). */
const PREF = 'dpils-time';
function timePref() { let v = 'auto'; try { const s = localStorage.getItem(PREF); if (s === '0' || s === '1' || s === '2') v = s; } catch (e) {} return v; }
function setTimePref(v, keep) {
  if (!keep) try { localStorage.setItem(PREF, v); } catch (e) {}
  if (v === 'auto') setCycle(dayPhase(Date.now())); else setTime(Math.max(0, Math.min(2, Math.round(+v) || 0)));
}

// shadow: the map size of EACH sun cascade (the two cascades share one atlas twice as wide, hence the MAXTEX/2 cap);
// lampSh: how many of the nearest lamps throw shadows from a depth map of their own (src/render/lamp-shadows.js)
const QUALITY = [
  { name: 'высокая', shadow: Math.min(4096, MAXTEX >> 1), pr: 2, tree: 300, det: 700, far: 4200, msaa: 4, ao: 1, bloom: 1, ssr: 1, lamps: 16, lampSh: 12, mirror: { scale: 0.5, far: 450 } },
  { name: 'средняя', shadow: Math.min(2048, MAXTEX >> 1), pr: 1.25, tree: 170, det: 520, far: 3000, msaa: 4, ao: 1, bloom: 1, ssr: 1, lamps: 12, lampSh: 6, mirror: { scale: 0.4, far: 280 } },
  { name: 'низкая', shadow: 0, pr: 1, tree: 100, det: 360, far: 2400, msaa: 0, ao: 0, bloom: 0, ssr: 0, lamps: 8, lampSh: 0 },
  { name: 'минимум', shadow: 0, pr: 0.7, tree: 50, det: 200, far: 1500, msaa: 0, ao: 0, bloom: 0, ssr: 0, lamps: 4, lampSh: 0 }   // for weak machines: a smaller picture, near houses only
];   // mirror: the glass of the wall in view mirrors the scene drawn at this share of the screen's size, out to far metres (src/render/mirror.js); none on the low levels
/* Quality mode: 'auto' — the page adapts by itself (dynamic resolution and the level, in the city and the game alike,
   see game/perf.js); a fixed level is the player's choice and stays. Both are remembered. */
let qAuto = true;
try { qAuto = localStorage.getItem('dpils-quality-mode') !== 'fixed'; } catch (e) {}
const COARSE = matchMedia('(pointer: coarse)').matches;
// Firefox's WebGL path is markedly slower per draw and per frame than Chromium's on the same GPU (measured: the city
// at 20-28 fps in Firefox vs 60-80 in Chromium on an RTX 3050). In auto it therefore starts two levels down, where the
// frame is cheap (no MSAA / AO / bloom, whole resolution, nearer far plane); auto raises it back only if there is real
// headroom. Chromium keeps the top level.
const FIREFOX = /firefox/i.test(navigator.userAgent);
let qi = WEAK_GPU || COARSE ? 1 : 0;
try { const s = localStorage.getItem('dpils-quality2'); if (s != null) qi = Math.max(0, Math.min(QUALITY.length - 1, +s)); } catch (e) {}
if (qAuto && (WEAK_GPU || COARSE)) qi = Math.max(qi, 1);   // auto on a weak machine never starts at the top level, whatever was remembered
if (qAuto && FIREFOX) qi = Math.max(qi, 2);   // auto in Firefox starts at «низкая»: its WebGL cannot afford the top levels
const qWatch = [];
const onQuality = f => { qWatch.push(f); };
function qualityBtn() {
  const b = $('bQuality');
  b.textContent = 'Графика: ' + (qAuto ? 'авто' : QUALITY[qi].name);
  b.title = qAuto ? 'Качество графики: авто, подстраивается под FPS. Клик — фиксированное' : 'Качество графики: ' + QUALITY[qi].name + ', фиксированное. Клик — следующий режим';
}
function setQuality(i) {
  qi = i; const q = QUALITY[i];
  qualityBtn();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
  lampMost(q.lamps);   // the most street lamps one point takes, nearest first (src/world/lamp-light.js)
  setLampShadows(q.lampSh);   // how many of the nearest lamps have a shadow map (src/render/lamp-shadows.js)
  const want = q.shadow > 0;
  if (want) { if (sun.shadow.map && sun.shadow.mapSize.x !== q.shadow) { sun.shadow.map.dispose(); sun.shadow.map = null; } sun.shadow.mapSize.set(q.shadow, q.shadow); }
  if (renderer.shadowMap.enabled !== want || sun.castShadow !== want) { renderer.shadowMap.enabled = want; sun.castShadow = want; for (const m of allMats) m.needsUpdate = true; matGold && (matGold.needsUpdate = true); }
  try { localStorage.setItem('dpils-quality2', String(i)); } catch (e) {}
  resize(); STATE.lodTimer = 0; STATE.shadowDirty = true;
  probeQuality(i);   // the probes live on «высокая» and «средняя» only
  for (const f of qWatch) f();
}
function setQualityMode(m) {   // 'auto' or the index of a fixed level, 0…QUALITY.length−1
  qAuto = m === 'auto';
  try { localStorage.setItem('dpils-quality-mode', qAuto ? 'auto' : 'fixed'); } catch (e) {}
  if (qAuto) { qualityBtn(); for (const f of qWatch) f(); }
  else setQuality(Math.max(0, Math.min(QUALITY.length - 1, Math.round(+m))));
}

export { QUALITY, TIMES, TOD, dayInfo, dayTick, qi, qAuto, onQuality, relight, setCycle, setQuality, setQualityMode, setTime, setTimePref, timeI, timePref };
