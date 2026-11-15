import { STATE } from '../core/state.js';
import { resize } from '../game/loop.js';
import { TX } from '../transit/transit.js';
import { lampHeads, lampPools, matHeadDay, matHeadNight } from '../world/lamps.js';
import { lmNight } from '../landmarks/index.js';
import { matGold } from '../world/data.js';
import { allMats } from './materials.js';
import { envScene, envSky, pmrem, sky } from '../world/terrain.js';
import { LIGHTDIR, MAXTEX, U, WEAK_GPU, hemi, renderer, scene, sun } from './renderer.js';
import { lin } from '../core/util.js';
import { $ } from '../core/env.js';

/* ---------- lighting, sky, quality ---------- */
/* Time of day. Colours are linear; sun/moon direction is "towards the light" (+x east, +z south).
   haze = fog density per metre at ground level, lit = share of windows with the light on. */
const TIMES = [
  { name: 'день', dir: [-0.55, 0.62, 0.56], top: '#1f5fbf', hor: '#b9d0e6', glow: [0.9, 0.78, 0.55], gnd: '#737868', sun: '#fff0dc', sunI: 2.7, disc: 60, hemi: 0.08, exp: 0.8,
    lit: 0, cover: 0.42, cloudLit: [1.35, 1.3, 1.22], cloudDark: [0.36, 0.43, 0.56], stars: 0, haze: 1 / 9000, thresh: 2.6, bloom: 0.45, lamps: false },
  { name: 'вечер', dir: [-0.9, 0.17, -0.4], top: '#2f5596', hor: '#e2b189', glow: [1.7, 0.72, 0.26], gnd: '#6a6052', sun: '#ffab63', sunI: 2.5, disc: 50, hemi: 0.1, exp: 0.95,
    lit: 0.3, cover: 0.5, cloudLit: [1.5, 0.9, 0.55], cloudDark: [0.3, 0.3, 0.42], stars: 0, haze: 1 / 5500, thresh: 2.0, bloom: 0.6, lamps: true },
  { name: 'ночь', dir: [0.45, 0.7, -0.4], top: '#03060d', hor: '#111927', glow: [0.1, 0.12, 0.18], gnd: '#0b0f17', sun: '#8ea6f2', sunI: 0.34, disc: 3, hemi: 0.05, exp: 1.25,
    lit: 0.5, cover: 0.38, cloudLit: [0.1, 0.115, 0.15], cloudDark: [0.02, 0.025, 0.035], stars: 1, haze: 1 / 5000, thresh: 1.1, bloom: 0.9, lamps: true }
];
let timeI = 0;
const ENV = [];   // PMREM environment per time of day
function setTime(i) {
  timeI = i; const T = TIMES[i]; STATE.night = i === 2;
  const b = $('bNight'); b.firstChild.textContent = 'Время: ' + T.name; b.setAttribute('aria-pressed', i > 0);
  LIGHTDIR.set(T.dir[0], T.dir[1], T.dir[2]).normalize();
  const top = lin(T.top), hor = lin(T.hor), gnd = lin(T.gnd), sc = lin(T.sun);
  for (const s of [sky, envSky]) {
    const u = s.material.uniforms, env = s === envSky;
    u.uSkyTop.value.copy(top); u.uSkyHor.value.copy(hor); u.uSkyGnd.value.copy(gnd); u.uSkyGlow.value.fromArray(T.glow);
    u.uSunDisc.value.copy(sc).multiplyScalar(env ? 0 : T.disc); u.uCloudLit.value.fromArray(T.cloudLit); u.uCloudDark.value.fromArray(T.cloudDark);
    u.uStars.value = env ? 0 : T.stars; u.uCover.value = T.cover; u.uSkyline.value = env ? 1 : 0;
  }
  scene.fog.color.copy(hor); scene.fog.near = T.haze; U.fogGlow.value.fromArray(T.glow);
  sun.color.copy(sc); sun.intensity = T.sunI * Math.PI; U.sunCol.value.copy(sc).multiplyScalar(T.sunI);   // ×π: the old scale of light
  hemi.intensity = T.hemi * Math.PI;
  renderer.toneMappingExposure = T.exp;
  U.night.value = i === 2 ? 1 : i === 1 ? 0.8 : 0; U.lit.value = T.lit; lmNight(U.night.value);
  // the environment of each time of day is filtered once (the GGX filter of three.js is costly on weak GPUs) and kept
  if (!ENV[i]) ENV[i] = pmrem.fromScene(envScene, 0, 0.1, 100);
  STATE.envRT = ENV[i]; scene.environment = STATE.envRT.texture;
  if (lampHeads) { lampHeads.material = T.lamps ? matHeadNight : matHeadDay; lampPools.visible = T.lamps; }
  for (const g of TX.glow) g.visible = T.lamps;
  STATE.shadowDirty = true; STATE.mapTimer = 0;
}
const QUALITY = [
  { name: 'высокая', shadow: Math.min(4096, MAXTEX), pr: 2, tree: 300, det: 700, far: 4200, msaa: 4, ao: 1, bloom: 1 },
  { name: 'средняя', shadow: 2048, pr: 1.25, tree: 170, det: 520, far: 3000, msaa: 4, ao: 1, bloom: 1 },
  { name: 'низкая', shadow: 0, pr: 1, tree: 100, det: 360, far: 2400, msaa: 0, ao: 0, bloom: 0 }
];
let qi = WEAK_GPU || matchMedia('(pointer: coarse)').matches ? 1 : 0;
try { const s = localStorage.getItem('dpils-quality2'); if (s != null) qi = Math.max(0, Math.min(2, +s)); } catch (e) {}
function setQuality(i) {
  qi = i; const q = QUALITY[i];
  $('bQuality').textContent = 'Графика: ' + q.name;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
  const want = q.shadow > 0;
  if (want) { if (sun.shadow.map && sun.shadow.mapSize.x !== q.shadow) { sun.shadow.map.dispose(); sun.shadow.map = null; } sun.shadow.mapSize.set(q.shadow, q.shadow); }
  if (renderer.shadowMap.enabled !== want || sun.castShadow !== want) { renderer.shadowMap.enabled = want; sun.castShadow = want; for (const m of allMats) m.needsUpdate = true; matGold && (matGold.needsUpdate = true); }
  try { localStorage.setItem('dpils-quality2', String(i)); } catch (e) {}
  resize(); STATE.lodTimer = 0; STATE.shadowDirty = true;
}

export { QUALITY, TIMES, qi, setQuality, setTime, timeI };
