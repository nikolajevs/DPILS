import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { lmSchools } from './schools.js';
import { lmChurchHill } from './church-hill.js';
import { lmShops } from './shops.js';
import { lmHospital } from './hospital.js';
import { TX, rigaNow } from '../transit/transit.js';
import { lmGrounds, lmSquare } from './unity-square.js';
import { lmAirBridge } from './air-bridge.js';
import { lmJunction } from './junction.js';
import { lmSC } from './heat-plant.js';
import { lmKP } from './culture-palace.js';
import { FUEL_POOLS, lmFuel } from './fuel.js';
import { SPW, lmSpeedway } from './speedway.js';
import { lmStation } from './station.js';
import { lmTVTower } from './tv-tower.js';
import { lmVesma } from './vesma.js';
import { lmRigas } from './rigas.js';
import { lmRenesanse } from './renesanse.js';
import { lmDULab, lmDUMain, lmDUParades } from './university.js';
import { lmLatgola } from './latgola.js';
import { lmUnityHouse } from './unity-house.js';
import { lmSigns, lmTiles, lmWallTex } from './tiles.js';
import { LMB } from './core.js';
import { lmTramWires, lmVienibas } from '../world/tram-wires.js';
import { lmOverpass } from '../world/overpass.js';
import { allMats, std } from '../render/materials.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { TERR, vbComp } from '../world/terrain.js';
import { U, hook, scene } from '../render/renderer.js';
import { GB } from '../core/geometry.js';

/* ---- materials, night lights, the hotel clock ---- */
const LMM = {}; let lmClk = null;
function lmNight(n) {
  if (!LMM.det) return;
  LMM.det.emissiveIntensity = n * 1.7; LMM.txt.emissiveIntensity = n * 1.5; LMM.ash.emissiveIntensity = n * 0.16; LMM.duw.emissiveIntensity = n * 0.06; LMM.stone.emissiveIntensity = n * 0.13; LMM.globe.emissiveIntensity = n * 3.2; LMM.clk.emissiveIntensity = 0.9 + n * 1.3;
  if (LMM.spwLamp) LMM.spwLamp.emissiveIntensity = n * 3.4; if (LMM.spwSheet) LMM.spwSheet.emissiveIntensity = 0.32 * (1 - n); if (SPW.pools) SPW.pools.visible = n > 0.5;   // the speedway: lamps, roof sheets
  if (LMM.schDet) LMM.schDet.emissiveIntensity = n * 1.7;   // schools: the lit windows
  if (LMM.chDet) LMM.chDet.emissiveIntensity = n * 1.7;   // Church Hill: the lit windows
  if (LMM.shDet) LMM.shDet.emissiveIntensity = n * 1.05;   // supermarkets: shop windows and boards
  if (LMM.fuLamp) { LMM.fuLamp.emissiveIntensity = n * 2.6; LMM.fuTxt.emissiveIntensity = n * 1.6; LMM.fuFascia.userData.glow.value = 0.28 + n * 0.45; } if (FUEL_POOLS) FUEL_POOLS.visible = n > 0.5;   // fuel stations
}
function lmTick() {
  if (!lmClk) return;
  const m = Math.floor((TX.ok ? TX.sec : rigaNow().sec) / 60) % 1440; if (m === lmClk.m) return; lmClk.m = m;
  const g = lmClk.g, W = lmClk.cv.width, H = lmClk.cv.height;
  g.fillStyle = '#111213'; g.fillRect(0, 0, W, H); g.font = '700 50px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#2a1210'; g.fillText('88:88', W / 2, H / 2 + 2); g.fillStyle = '#ff3a22'; g.fillText(Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'), W / 2, H / 2 + 2);
  lmClk.tex.needsUpdate = true;
}
if (!THREE.ShaderLib.physical.fragmentShader.includes('#include <opaque_fragment>')) console.warn('three.js: the landmark materials lost their NaN guard (no opaque_fragment)');
const LM_SAFE = s => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>',
  'if (any(isnan(outgoingLight)) || any(isinf(outgoingLight))) outgoingLight = diffuseColor.rgb * 0.3;\noutgoingLight = min( outgoingLight, vec3( 40.0 ) );\n#include <opaque_fragment>'); };
const lmStd = (opts, key, patch) => std(opts, key, s => { LM_SAFE(s); if (patch) patch(s); });
function buildLandmarks() {
  const [dc, dorm, dglow] = lmTiles(), [sc, sglow] = lmSigns(), WT = [0, 1, 2, 3, 4, 5, 6, 7].map(lmWallTex), ashT = WT[0], renT = WT[1];
  const litPatch = s => {
    s.vertexShader = 'attribute float aLit; varying float vLit;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
    s.fragmentShader = 'varying float vLit;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLit;');
  };
  LMM.ash = lmStd({ vertexColors: true, map: ashT, roughness: 0.92, metalness: 0, emissive: new THREE.Color(1, 0.84, 0.64), emissiveMap: ashT, emissiveIntensity: 0 }, 'lm-ash');
  LMM.ren = lmStd({ vertexColors: true, map: renT, roughness: 0.9, metalness: 0 }, 'lm-ren');
  LMM.duw = lmStd({ vertexColors: true, map: WT[2], roughness: 0.9, metalness: 0, emissive: new THREE.Color(1, 0.84, 0.64), emissiveMap: WT[2], emissiveIntensity: 0 }, 'lm-duw');
  LMM.brick = lmStd({ vertexColors: true, map: WT[3], roughness: 0.88, metalness: 0 }, 'lm-brick');
  LMM.tile = lmStd({ vertexColors: true, map: WT[4], roughness: 0.55, metalness: 0 }, 'lm-tile');
  LMM.panel = lmStd({ vertexColors: true, map: WT[5], roughness: 0.7, metalness: 0 }, 'lm-panel');
  LMM.buff = lmStd({ vertexColors: true, map: WT[6], roughness: 0.88, metalness: 0 }, 'lm-buff');
  LMM.sil = lmStd({ vertexColors: true, map: WT[7], roughness: 0.9, metalness: 0 }, 'lm-sil');
  LMM.det = lmStd({ vertexColors: true, map: dc, roughnessMap: dorm, metalnessMap: dorm, roughness: 1, metalness: 1, emissive: new THREE.Color(1, 1, 1), emissiveMap: dglow, emissiveIntensity: 0 }, 'lm-det', litPatch);
  LMM.txt = lmStd({ vertexColors: true, map: sc, alphaTest: 0.5, roughness: 0.35, metalness: 0.45, emissive: new THREE.Color(1, 1, 1), emissiveMap: sglow, emissiveIntensity: 0 }, 'lm-txt', litPatch);
  LMM.globe = lmStd({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: new THREE.Color(1, 0.82, 0.58), emissiveIntensity: 0 }, 'lm-globe');
  LMM.plain = lmStd({ vertexColors: true, roughness: 0.85, metalness: 0 }, 'lm-plain');
  LMM.stone = lmStd({ vertexColors: true, roughness: 0.85, metalness: 0, emissive: new THREE.Color(1, 0.84, 0.64), emissiveIntensity: 0 }, 'lm-stone');
  const ccv = mkCanvas(256, 80); lmClk = { cv: ccv, g: ccv.getContext('2d'), m: -1, tex: toTex(ccv, true, false) };
  LMM.clk = hook(new THREE.MeshStandardMaterial({ map: lmClk.tex, emissive: new THREE.Color(1, 1, 1), emissiveMap: lmClk.tex, roughness: 0.5, metalness: 0 }), 'lm-clk', LM_SAFE); allMats.push(LMM.clk); lmTick();
  const K = { ash: new LMB(), ren: new LMB(), det: new LMB(), txt: new LMB(), clk: new LMB(), plain: new GB(false), stone: new GB(false), globe: new GB(false) };
  K.walls = [K.ash, K.ren, new LMB(), new LMB(), new LMB(), new LMB(), new LMB(), new LMB()];
  lmUnityHouse(K); lmLatgola(K); lmSquare(K); lmGrounds(K); lmDUMain(K); lmDUParades(K); lmDULab(K); lmRenesanse(K); lmRigas(K); lmVesma(K); lmTVTower(K); lmStation(K); lmSpeedway(K); lmKP(K); lmSC(K); lmFuel(K, litPatch); lmOverpass(K); lmTramWires(K); lmAirBridge(K); lmJunction(K); lmSchools(K, litPatch); lmChurchHill(K, litPatch); lmShops(K, litPatch); STATE.GBC = TERR.on ? vbComp : null; lmVienibas(K); STATE.GBC = null;
  lmHospital(K);
  [LMM.ash, LMM.ren, LMM.duw, LMM.brick, LMM.tile, LMM.panel, LMM.buff, LMM.sil].forEach((m, k) => K.walls[k].mesh(m)); K.det.mesh(LMM.det); K.txt.mesh(LMM.txt, false); K.clk.mesh(LMM.clk, false);
  for (const [b, m] of [[K.plain, LMM.plain], [K.stone, LMM.stone]]) { const pm = b.mesh(m); if (pm) { pm.castShadow = pm.receiveShadow = true; scene.add(pm); } }
  const gm = K.globe.mesh(LMM.globe); if (gm) { gm.receiveShadow = true; scene.add(gm); }
  lmNight(U.night.value);
}

export { LMM, LM_SAFE, buildLandmarks, lmNight, lmStd, lmTick };
