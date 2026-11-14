import { STATE } from './core/state.js';
import { PHASE, loading } from './ui/loading.js';
// every module, latest first: a module is evaluated after the earlier ones it needs (see tools/check.js)
import { frame } from './game/loop.js';
import './game/input.js';
import './ui/hud.js';
import './ui/map.js';
import { PP, renderFrame, warmUp } from './render/post.js';
import { QUALITY, TIMES, qi, setQuality, setTime, timeI } from './render/lighting.js';
import { P, setFly, teleport } from './game/player.js';
import './ui/places.js';
import { TX, buildTransit, setClock, updateBoard } from './transit/transit.js';
import { buildTrees } from './world/trees.js';
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
import { buildGround } from './world/ground.js';
import { BLD, LINES, makeMaterials } from './world/data.js';
import './world/palette.js';
import './render/materials.js';
import './render/textures.js';
import { TERR, terrainH, terrainInit, walkLift } from './world/terrain.js';
import { GPU, U, camera, renderer, scene } from './render/renderer.js';
import { GB } from './core/geometry.js';
import './core/util.js';
import { $, C } from './core/env.js';

/* ---------- build everything ----------
   Each step gets a share of the loading bar by its weight: about how many milliseconds it takes on a reference
   machine (the bar is timed by them, scaled to how fast this machine runs the steps). */
const W = { materials: 1100, ground: 2800, lines: 320, houses: 1450, blocks: 110, landmarks: 650, fortress: 2750, trees: 1380, transit: 100, shaders: 1800, frame: 1500 };
const WSUM = Object.values(W).reduce((a, b) => a + b, 0);
let wDone = 0;
const step = (text, w, reported) => {
  const [a, b] = PHASE.build, f0 = a + (b - a) * wDone / WSUM; wDone += w;
  return loading.step(text, f0, a + (b - a) * wDone / WSUM, w, reported);
};
(async () => {
  try {
    await step('Рисую фасады и крыши…', W.materials); makeMaterials(); STATE.goldGB = new GB(false);
    setTime(matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark' ? 2 : 0);
    setQuality(qi);
    terrainInit();
    await step('Заливаю Даугаву и озёра…', W.ground); buildGround();
    await step('Прокладываю улицы, тротуары и рельсы…', W.lines); buildLines();
    const N = C.b.length;
    for (let i = 0; i < N; i += 4000) { const j = Math.min(N, i + 4000); await step('Строю дома: ' + j.toLocaleString('ru') + ' из ' + N.toLocaleString('ru') + '…', W.houses * (j - i) / N); buildBuildings(i, j); }
    await step('Собираю кварталы…', W.blocks); finishBuildings();
    await step('Строю Дом Единства, гостиницу «Латгола» и корпуса университета…', W.landmarks); buildLandmarks();
    await step('Насыпаю валы и копаю рвы крепости…', W.fortress); buildFortress();
    const lamps = buildLamps(); setTime(timeI);
    await step('Сажаю деревья…', W.trees); const trees = buildTrees();
    await step('Выпускаю трамваи и автобусы на линии…', W.transit); const tripsN = buildTransit();
    if (TERR.on) scene.traverse(o => { if (!o.isMesh || !o.frustumCulled || !o.geometry) return; const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (g.boundingSphere && !g.userData.terrGrown) { g.boundingSphere.radius += 70; g.userData.terrGrown = true; } });
    // the shaders of every material, a few at a time, then the first frame (shadow map, environment, post-processing)
    await step('Готовлю шейдеры…', W.shaders, true); await warmUp(f => loading.part(f), loading.frame);
    await step('Рисую первый кадр…', W.frame); frame(performance.now());
    await loading.frame();
    loading.done('Готово: ' + BLD.length.toLocaleString('ru') + ' зданий, ' + LINES.length.toLocaleString('ru') + ' улиц и дорожек, ' + trees.toLocaleString('ru') + ' деревьев, ' + lamps.toLocaleString('ru') + ' фонарей' + (tripsN ? ', ' + tripsN.toLocaleString('ru') + ' рейсов в расписании' : '') + '.');
    $('view').classList.add('shown');
    $('go').disabled = false; $('go').focus();
    window.__city = { TX, setClock, updateBoard, P, teleport, setFly, setTime, fortPoint, walkLift, terrainH, setNight: on => setTime(on ? 2 : 0), setQuality, scene, renderer, camera, renderFrame, U, PP, TIMES, QUALITY, GPU };
  } catch (e) { console.error(e); loading.fail('Ошибка при сборке города: ' + e.message); }
})();
