import { scene } from './renderer.js';
import { sky } from '../world/terrain.js';

/* ---------- the city stands still ----------
   Before every render three recomputes the matrices of every object of the scene: the local one from its position,
   rotation and scale, the world one from its parent's. The city is about 6400 objects (5500 of them right under the
   scene, two thirds of those the hidden detail of far tiles) and none of them moves once it is built, yet the matrices
   were 13–17 % of the page's main thread in every frame: 5.5 ms of it, 2.2 ms frozen (profiled 2026-11-22 in Chrome on
   an RTX 3050 laptop, where the frame is bound by the processor, not the video card). freezeWorld, called once the city is built and its first
   frame drawn (src/main.js), keeps the matrices of what is in the scene then: matrixAutoUpdate off for each object and
   for the scene itself (the scene's own update would otherwise force every child's world matrix anew). What moves keeps
   its automatic matrices: the sky round the eye, the lights, the camera and the gun on it, what was given to addMover
   (players, items; src/render/lamp-shadows.js), a userData.moves object, and everything that comes into the scene later
   (players, grenades, tracers, scorch marks).
   A safety net: four times a second the frozen objects are compared with the position, rotation and scale they were
   frozen with. One that was moved after all (or taken out of the scene) gets its automatic matrix back, with a warning
   in the console once, so a part of the city that one day learns to move lags a quarter of a second once instead of
   standing still forever. To move a built object on purpose, mark it userData.moves before the city is done. */
const STAT = { frozen: 0, thawed: 0 };
let frozen = [], snap = null, next = 0, warned = false;
const moving = o => o === sky || o.isLight || o.isCamera || o.userData.moves || o.userData.moverR !== undefined;
function write(o, k) {
  const p = o.position, q = o.quaternion, s = o.scale;
  snap[k] = p.x; snap[k + 1] = p.y; snap[k + 2] = p.z; snap[k + 3] = q.x; snap[k + 4] = q.y; snap[k + 5] = q.z; snap[k + 6] = q.w; snap[k + 7] = s.x; snap[k + 8] = s.y; snap[k + 9] = s.z;
}
function freezeWorld() {
  frozen = [];
  const rec = o => {
    if (moving(o)) return;   // and what hangs on it
    o.updateMatrix(); o.matrixAutoUpdate = false; frozen.push(o);
    for (const c of o.children) rec(c);
  };
  for (const o of scene.children) rec(o);
  scene.updateMatrix(); scene.matrixAutoUpdate = false;
  scene.updateMatrixWorld(true);
  snap = new Float64Array(frozen.length * 10);
  for (let i = 0; i < frozen.length; i++) write(frozen[i], i * 10);
  STAT.frozen = frozen.length; STAT.thawed = 0;
}
// every frame from the loop (src/game/loop.js); does its work four times a second
function staticTick(now) {
  if (!snap || now < next) return;
  next = now + 250;
  for (let i = 0; i < frozen.length; i++) {
    const o = frozen[i]; if (!o) continue;
    const k = i * 10, p = o.position, q = o.quaternion, s = o.scale;
    if (o.parent && p.x === snap[k] && p.y === snap[k + 1] && p.z === snap[k + 2] && q.x === snap[k + 3] && q.y === snap[k + 4] && q.z === snap[k + 5] && q.w === snap[k + 6] && s.x === snap[k + 7] && s.y === snap[k + 8] && s.z === snap[k + 9]) continue;
    o.matrixAutoUpdate = true; o.matrixWorldNeedsUpdate = true; frozen[i] = null; STAT.thawed++;   // moved, or out of the scene: its own matrices again
    if (o.parent && !warned) { warned = true; console.warn('static-world: a built object moved and was thawed (mark it userData.moves):', o.name || o.type, o); }
  }
}

export { STAT as STATIC_WORLD, freezeWorld, staticTick };
