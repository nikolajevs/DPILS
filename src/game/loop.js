import { STATE } from '../core/state.js';
import { updateHud } from '../ui/hud.js';
import { big, drawMini, mapFrame } from '../ui/map.js';
import { renderFrame, updateLod, updateSun } from '../render/post.js';
import { QUALITY, qi } from '../render/lighting.js';
import { P, step } from './player.js';
import { MP, mpLabels, mpTick } from './mp.js';
import { perfTick } from './perf.js';
import { TX, updateBoard, updateClockUI, updateTags, updateTransit } from '../transit/transit.js';
import { lmTick } from '../landmarks/index.js';
import { sky, terrainH } from '../world/terrain.js';
import { pedTick } from '../world/pedestrians.js';
import { U, camera, renderer, scene } from '../render/renderer.js';
import { $, reduceMotion } from '../core/env.js';

/* ---------- frame loop ---------- */
function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();
let last = performance.now(), clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); perfTick(Math.min(5, (now - last) / 1000)); last = now; clock += dt;
  if (STATE.started) { if ($('start').hidden && big.hidden && !(MP.on && MP.dead)) step(dt); }
  else { STATE.introT += reduceMotion ? 0 : dt; P.yaw = 0.6 + STATE.introT * 0.05; P.x = -1350 + Math.sin(P.yaw) * 420; P.z = 1250 + Math.cos(P.yaw) * 420; P.y = 150 + terrainH(P.x, P.z); P.pitch = -0.33; }
  mpTick(dt); updateTransit(dt); lmTick(); pedTick(dt);
  if (!reduceMotion) U.time.value = clock;
  // the full map covers the city: outside the game the 3D picture is not drawn while it is open (the last frame stays)
  if (!big.hidden) { mapFrame(); if (!STATE.mp) return; }
  const bob = (!P.fly && STATE.started && !reduceMotion) ? Math.sin(P.walked * 2.1) * 0.035 : 0;
  camera.position.set(P.x, P.y + bob, P.z); camera.rotation.set(P.pitch, P.yaw, 0);
  const far = QUALITY[qi].far + Math.max(0, P.y - 2) * 9; scene.fog.far = far;
  if (Math.abs(camera.far - (far + 100)) > 20) { camera.far = far + 100; camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
  updateSun();
  if ((STATE.lodTimer -= dt) <= 0) { STATE.lodTimer = 0.3; updateLod(); }
  renderFrame();
  camera.updateMatrixWorld(); updateTags(); mpLabels();
  if (STATE.started) { if ((STATE.hudTimer -= dt) <= 0) { STATE.hudTimer = 0.25; updateHud(); updateClockUI(); if ((TX.boardT = (TX.boardT || 0) - 1) <= 0) { TX.boardT = 2; updateBoard(); } } if ((STATE.mapTimer -= dt) <= 0) { STATE.mapTimer = 0.15; drawMini(); } }
}

export { clock, frame, resize };
