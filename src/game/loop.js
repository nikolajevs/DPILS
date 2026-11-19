import { STATE } from '../core/state.js';
import { updateHud } from '../ui/hud.js';
import { big, drawMini, mapFrame } from '../ui/map.js';
import { renderFrame, updateLod, updateSun } from '../render/post.js';
import { QUALITY, qi } from '../render/lighting.js';
import { P, step } from './player.js';
import { MP, mpLabels, mpTick, aimPunch } from './mp.js';
import { camShake } from './nades.js';
import { perfTick } from './perf.js';
import { TX, updateBoard, updateClockUI, updateTags, updateTransit } from '../transit/transit.js';
import { lmTick } from '../landmarks/index.js';
import { sky, terrainH } from '../world/terrain.js';
import { U, camera, renderer, scene } from '../render/renderer.js';
import { $, reduceMotion } from '../core/env.js';

/* ---------- frame loop ---------- */
function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();
/* The near plane cuts away whatever is closer to the eye. Its corners lie farther out than its centre, the more so the
   wider the field of view (up to 100° in the game) and the screen: at 0.3 m they reached 0.5–0.8 m, past the 0.45 m the
   player keeps from a wall (collide in player.js), and a look along a wall or up a wall cut into it and showed the rooms
   and streets behind. So the plane comes in until its farthest corner is 0.22 m from the eye; high in flight (and over the city
   before the start) it goes out again for the depth precision of the far city. */
const NEAR_REACH = 0.22;
function nearPlane() {
  const t = Math.tan(camera.fov * Math.PI / 360), corner = Math.sqrt(1 + t * t * (1 + camera.aspect * camera.aspect));
  const n = Math.min(0.3, NEAR_REACH / corner);
  return P.fly || !STATE.started ? Math.max(n, Math.min(1, (P.y - terrainH(P.x, P.z)) * 0.01)) : n;
}
let last = performance.now(), clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); perfTick(Math.min(5, (now - last) / 1000)); last = now; clock += dt;
  if (STATE.started) { if ($('start').hidden && big.hidden && !(MP.on && MP.dead)) step(dt); }
  else { STATE.introT += reduceMotion ? 0 : dt; P.yaw = 0.6 + STATE.introT * 0.05; P.x = -1350 + Math.sin(P.yaw) * 420; P.z = 1250 + Math.cos(P.yaw) * 420; P.y = 150 + terrainH(P.x, P.z); P.pitch = -0.33; }
  mpTick(dt); updateTransit(dt); lmTick();
  if (!reduceMotion) U.time.value = clock;
  // the full map covers the city: outside the game the 3D picture is not drawn while it is open (the last frame stays)
  if (!big.hidden) { mapFrame(); if (!STATE.mp) return; }
  const bob = (!P.fly && STATE.started && !reduceMotion) ? Math.sin(P.walked * 2.1) * 0.035 : 0;
  camera.position.set(P.x, P.y + bob, P.z); camera.rotation.set(P.pitch, P.yaw, 0); aimPunch(camera); camShake(camera);   // the flinch of a hit on you, then the jolt of a grenade's blast near you
  const far = QUALITY[qi].far + Math.max(0, P.y - 2) * 9; scene.fog.far = far;
  const near = nearPlane();
  if (Math.abs(camera.far - (far + 100)) > 20 || Math.abs(camera.near - near) > near * 0.05) { camera.far = far + 100; camera.near = near; camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
  updateSun();
  if ((STATE.lodTimer -= dt) <= 0) { STATE.lodTimer = 0.3; updateLod(); }
  renderFrame();
  camera.updateMatrixWorld(); updateTags(); mpLabels();
  if (STATE.started) { if ((STATE.hudTimer -= dt) <= 0) { STATE.hudTimer = 0.25; updateHud(); updateClockUI(); if ((TX.boardT = (TX.boardT || 0) - 1) <= 0) { TX.boardT = 2; updateBoard(); } } if ((STATE.mapTimer -= dt) <= 0) { STATE.mapTimer = 0.15; drawMini(); } }
}

export { clock, frame, resize };
