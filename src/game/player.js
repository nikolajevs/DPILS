import { STATE } from '../core/state.js';
import { COL, inBuilding, inWater, onRoad } from '../world/data.js';
import { terrainH, walkLift } from '../world/terrain.js';
import { parkedAt, parkedPush } from '../landmarks/parking.js';
import { $, HX, HY } from '../core/env.js';

/* ---------- player ---------- */
const P = { x: -1487, y: 1.7, z: 1263, yaw: 0.6, pitch: 0, fly: false, walked: 0 };
const keys = new Set(); const touch = { mx: 0, mz: 0 };
STATE.started = false; STATE.night = false; STATE.locked = false; STATE.introT = 0;
function freeSpot(x, z) {
  const bad = (a, b) => inBuilding(a, b) || (inWater(a, b) && !onRoad(a, b, 1)) || parkedAt(a, b);
  if (!bad(x, z)) return [x, z];
  for (let r = 4; r < 400; r += 5) for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283 + r, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r; if (!bad(nx, nz)) return [nx, nz]; }
  return [x, z];
}
function teleport(x, z, yaw) {
  if (STATE.mp) return;   // in the game you only appear where the server puts you
  x = Math.max(-HX + 5, Math.min(HX - 5, x)); z = Math.max(-HY + 5, Math.min(HY - 5, z));
  if (P.fly) { P.x = x; P.z = z; P.y = Math.max(P.y, terrainH(x, z) + 30); } else { [P.x, P.z] = freeSpot(x, z); P.y = 1.7 + walkLift(P.x, P.z); }
  if (yaw != null) { P.yaw = yaw; P.pitch = P.fly ? -0.45 : 0; }
  STATE.hudTimer = 0; STATE.mapTimer = 0; STATE.lodTimer = 0;
}
function collide() {
  for (let it = 0; it < 2; it++) { COL.near(P.x, P.z, 0.45, (id, d, px, pz) => {
    const Rr = 0.45 + COL.s[id * 6 + 4]; if (d >= Rr || d < 1e-5) return; const k = (Rr - d) / d; P.x += (P.x - px) * k; P.z += (P.z - pz) * k;
  }); parkedPush(P); }   // and the cars parked at this time of day
}
function step(dt) {
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD')) s += 1; if (keys.has('KeyA')) s -= 1;
  if (keys.has('ArrowLeft')) P.yaw += 1.9 * dt; if (keys.has('ArrowRight')) P.yaw -= 1.9 * dt;
  f += touch.mz; s += touch.mx;
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  if (P.fly) {
    const sp = (28 + P.y * 0.45) * (run ? 4 : 1), cp = Math.cos(P.pitch);
    P.x += (-sy * cp * f + cy * s) * sp * dt; P.z += (-cy * cp * f - sy * s) * sp * dt; P.y += Math.sin(P.pitch) * f * sp * dt;
    if (keys.has('KeyE') || keys.has('Space')) P.y += sp * 0.6 * dt; if (keys.has('KeyQ')) P.y -= sp * 0.6 * dt;
    P.y = Math.max(terrainH(P.x, P.z) + 2, Math.min(1500, P.y));
  } else if (l > 0.01) {
    const sp = run ? 11 : 3.3; let dx = (-sy * f + cy * s) * sp * dt, dz = (-cy * f - sy * s) * sp * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3)); dx /= n; dz /= n;
    for (let i = 0; i < n; i++) {
      const ox = P.x, oz = P.z; P.x += dx; P.z += dz; collide();
      if (inWater(P.x, P.z) && !onRoad(P.x, P.z, 1.2) && !(inWater(ox, oz) && !onRoad(ox, oz, 1.2))) { P.x = ox; P.z = oz; break; }
    }
    P.walked += sp * dt * l;
  }
  P.x = Math.max(-HX, Math.min(HX, P.x)); P.z = Math.max(-HY, Math.min(HY, P.z));
  if (!P.fly) P.y = 1.7 + walkLift(P.x, P.z, P.y - 1.7);   // up the hills and ramparts, down into the moats, over the bridges
}
function setFly(on) {
  if (STATE.mp && on) return;
  P.fly = on; $('bFly').setAttribute('aria-pressed', on);
  if (on) { P.y = Math.max(P.y, terrainH(P.x, P.z) + 70); P.pitch = Math.min(P.pitch, -0.35); } else { [P.x, P.z] = freeSpot(P.x, P.z); P.y = 1.7 + terrainH(P.x, P.z); P.pitch = 0; }
  STATE.hudTimer = 0; STATE.lodTimer = 0;
}

export { P, freeSpot, keys, setFly, step, teleport, touch };
