import { STATE } from './core/state.js';
import { PHASE, loading } from './ui/loading.js';
import { SB } from './landmarks/schools.js';
import { SHV } from './landmarks/shops.js';
// every module, latest first: a module is evaluated after the earlier ones it needs (see tools/check.js)
import { frame } from './game/loop.js';
import { PERF } from './game/perf.js';
import './game/mirror-self.js';
import { MP, enablePlay, loadModels, warmSamples } from './game/mp.js';
import { stormState } from './game/storm.js';
import './ui/start.js';
import { ambProbe, ambStatus } from './game/ambience.js';
import { statEvent, statsOf } from './game/stats.js';
import './game/input.js';
import './ui/auth.js';
import './ui/hud.js';
import './ui/map.js';
import { PP, renderFrame, warmUp } from './render/post.js';
import { captureProbes, probeState } from './render/cityprobe.js';
import { MIRROR_CITY } from './render/mirror-city.js';
import { MIRROR } from './render/mirror.js';
import { STATIC_WORLD, freezeWorld } from './render/static-world.js';
import { BATCH, batchStatic } from './render/batch.js';
import { splitBigMeshes } from './render/chunks.js';
import { QUALITY, TIMES, dayInfo, qi, qAuto, relight, setCycle, setQuality, setQualityMode, setTime, setTimePref, timePref } from './render/lighting.js';
import { P } from './game/player.js';
import './ui/places.js';
import { TX, buildTransit, setClock } from './transit/transit.js';
import { LIDAR_STATS, buildTrees } from './world/trees.js';
import { PSTAT } from './landmarks/parking.js';
import { SER_STAT } from './buildings/series.js';
import { GUB_STAT } from './landmarks/gubisce.js';
import { buildFortress } from './fortress/build.js';
import './fortress/monuments.js';
import './fortress/arsenals.js';
import './fortress/gates.js';
import './fortress/ground.js';
import './fortress/textures.js';
import { fortPoint } from './fortress/ground-height.js';
import './fortress/index.js';
import { buildLamps } from './world/lamps.js';
import { buildBuildings, finishBuildings } from './buildings/buildings.js';
import { buildLandmarks } from './landmarks/index.js';
import { plantFlora } from './landmarks/flora.js';
import './landmarks/unity-square.js';
import './landmarks/air-bridge.js';
import './landmarks/junction.js';
import './landmarks/heat-plant.js';
import './landmarks/culture-palace.js';
import './landmarks/fuel.js';
import './landmarks/speedway.js';
import './landmarks/station.js';
import './landmarks/tv-tower.js';
import './landmarks/vesma.js';
import './landmarks/rigas.js';
import './landmarks/renesanse.js';
import './landmarks/university.js';
import './landmarks/latgola.js';
import './landmarks/unity-house.js';
import './landmarks/helpers.js';
import './landmarks/tiles.js';
import './landmarks/core.js';
import './buildings/walls.js';
import './buildings/series.js';
import './world/tram-wires.js';
import './world/overpass.js';
import './world/bridge-vienibas.js';
import { buildLines } from './world/streets.js';
import { buildGround, groundDepth } from './world/ground.js';
import { makeMaterials } from './world/data.js';
import './world/palette.js';
import './render/materials.js';
import './render/textures.js';
import { TERR, terrainH, terrainInit, walkLift } from './world/terrain.js';
import { GPU, U, camera, renderer, scene } from './render/renderer.js';
import { GB } from './core/geometry.js';
import { due, pause, rest } from './core/pause.js';
import './core/util.js';
import { $, C } from './core/env.js';

/* ---------- build everything ----------
   Each step gets a share of the loading bar by its weight: about how many milliseconds it takes on a reference
   machine (the bar is timed by them, scaled to how fast this machine runs the steps). Measured 2026-11-18 on one
   laptop with both of its GPUs (RTX 3050 and Intel UHD: 25 and 35 s of building), the shares of the two averaged; the
   shaders are given more than a second visit takes, when the browser has them compiled already. Re-measure when a
   step changes much: a step heavier than its weight slows the bar down, a lighter one leaves it behind. */
const W = { materials: 2100, ground: 2800, lines: 1600, houses: 3100, blocks: 300, landmarks: 4000, fortress: 2400, trees: 3500, flora: 500, transit: 3500, split: 2150, probes: 1500, models: 1500, shaders: 2500, frame: 4000 };
const WSUM = Object.values(W).reduce((a, b) => a + b, 0);
let wDone = 0;
const step = (text, w, reported) => {
  const [a, b] = PHASE.build, f0 = a + (b - a) * wDone / WSUM; wDone += w;
  return loading.step(text, f0, a + (b - a) * wDone / WSUM, w, reported);
};
(async () => {
  try {
    const before = new Set(scene.children);   // the lights, the sky and the pools of the game: not the city (src/render/batch.js)
    // the players and the guns of the game: their files come while the city is built (src/game/mp.js loadModels)
    let modelsF = 0, modelsStep = false;
    const models = loadModels(f => { modelsF = f; if (modelsStep) loading.part(f); });
    await step('Рисую фасады и крыши…', W.materials); await makeMaterials(); STATE.goldGB = new GB(false); await rest();
    // time of day: the choice of the training, kept in the browser; «авто» (and the first visit) — the day of the server's clock
    setTimePref(timePref(), true); await rest();
    setQuality(qi);
    await terrainInit();
    await step('Заливаю Даугаву и озёра…', W.ground); await buildGround();
    await step('Прокладываю улицы, тротуары и рельсы…', W.lines); await buildLines();
    const N = C.b.length;
    for (let i = 0; i < N; i += 4000) { const j = Math.min(N, i + 4000); await step('Строю дома: ' + j.toLocaleString('ru') + ' из ' + N.toLocaleString('ru') + '…', W.houses * (j - i) / N); await buildBuildings(i, j); }
    await step('Собираю кварталы…', W.blocks); finishBuildings();
    await step('Строю Дом Единства, «Латголу», университет и школы…', W.landmarks); await buildLandmarks();
    await step('Насыпаю валы и копаю рвы крепости…', W.fortress); await buildFortress();
    await groundDepth();   // the depth grids under the ground layers, now that all of them are drawn (src/world/ground.js)
    await rest(); await buildLamps(); relight();
    await step('Сажаю деревья…', W.trees); await buildTrees();
    await step('Сажаю цветы в парках…', W.flora); await plantFlora();   // their files were asked for with the parks
    await step('Выпускаю трамваи и автобусы на линии…', W.transit); await buildTransit();
    await step('Делю землю и улицы на участки…', W.split); await splitBigMeshes(scene);   // the meshes over the whole city, cut into tiles that can be culled (src/render/chunks.js)
    if (TERR.on) {
      const ms = []; scene.traverse(o => { if (o.isMesh && o.frustumCulled && o.geometry) ms.push(o); });
      for (const o of ms) { if (due()) await pause(); const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (g.boundingSphere && !g.userData.terrGrown) { g.boundingSphere.radius += 70; g.userData.terrGrown = true; } }
    }
    await batchStatic(before);   // the still pieces of one material drawn by one call each (src/render/batch.js)
    await step('Снимаю отражения города…', W.probes); await captureProbes();   // the city cubes for water and glass, once per time of day
    // the players and the guns join the scene for the warm-up: the game starts with them ready (a minute at most for slow files)
    await step('Одеваю игроков и раздаю оружие…', W.models, true); modelsStep = true; loading.part(modelsF);
    await Promise.race([models, new Promise(r => setTimeout(r, 60000))]); modelsStep = false; await warmSamples(true);
    // the shaders of every material, a few at a time, then the first frame (shadow map, environment, post-processing)
    await step('Готовлю шейдеры…', W.shaders, true); await warmUp(f => loading.part(f), loading.frame);
    await step('Рисую первый кадр…', W.frame); frame(performance.now());
    await loading.frame(); warmSamples(false);
    freezeWorld();   // the built city keeps its matrices: three stops recomputing ~6600 of them every frame (src/render/static-world.js)
    loading.done();   // no summary line: the bar fades out and the load block leaves the start card
    if (document.body.classList.contains('mp')) $('view').classList.add('shown');   // the city fades in only in a fight; src/ui/startfx.js owns the rule
    enablePlay(); $('chTrain').focus();
    window.__city = { PERF, ambProbe, ambStatus, statEvent, statsOf, MP, STATE, storm: stormState, SB, SHV, TX, treeStats: LIDAR_STATS, parking: PSTAT, series: SER_STAT, gubisce: GUB_STAT, setClock, P, setTime, setCycle, dayInfo, showTime: t => (/^h/i.test(String(t)) ? setCycle(+String(t).slice(1) / 24, Infinity) : setTime(+t)), fortPoint, walkLift, terrainH, setNight: on => setTime(on ? 2 : 0), setQuality, setQualityMode, qualityMode: () => (qAuto ? 'auto' : qi), scene, renderer, camera, renderFrame, U, PP, TIMES, QUALITY, GPU, probeState, mirror: MIRROR, mirrorCity: MIRROR_CITY, staticWorld: STATIC_WORLD, batch: BATCH };
  } catch (e) { console.error(e); loading.fail('Ошибка при сборке города: ' + e.message); }
})();
