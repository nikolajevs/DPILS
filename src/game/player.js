import { STATE } from '../core/state.js';
import { COL, inBuilding, inWater, onRoad } from '../world/data.js';
import { terrainH, walkLift } from '../world/terrain.js';
import { upLow } from '../world/underpass.js';
import { rbLow } from '../world/bridge-railway.js';
import { parkedAt, parkedPush } from '../landmarks/parking.js';
import { staticCarPush } from '../world/cars.js';
import { SET } from './settings.js';
import { $, HX, HY } from '../core/env.js';

/* ---------- player ---------- */
// eye: height of the eyes over the feet (1.7 standing, 1.1 crouched); up: the jump, metres over the ground; vy: its speed
const P = { x: -1487, y: 1.7, z: 1263, yaw: 0.6, pitch: 0, fly: false, walked: 0, eye: 1.7, up: 0, vy: 0, crouch: false };
const JUMP = { v: 6.4, g: 21, eyeStand: 1.7, eyeCrouch: 1.1, crouchSpeed: 1.8 };
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
  if (P.fly) { P.x = x; P.z = z; P.y = Math.max(P.y, terrainH(x, z) + 30); } else { [P.x, P.z] = freeSpot(x, z); P.eye = 1.7; P.up = 0; P.vy = 0; P.y = 1.7 + walkLift(P.x, P.z); }
  if (yaw != null) { P.yaw = yaw; P.pitch = P.fly ? -0.45 : 0; }
  STATE.hudTimer = 0; STATE.mapTimer = 0; STATE.lodTimer = 0;
}
function collide(feet) {   // feet: the height the walker stands at; under the deck of Vienības tilts only the walls under it count, on it only the walls of the deck
  for (let it = 0; it < 2; it++) { const low = upLow(P.x, P.z, feet), rlow = rbLow(P.x, P.z, feet); COL.near(P.x, P.z, 0.45, (id, d, px, pz) => {
    const tg = COL.s[id * 6 + 5]; if (tg === 1 && low || tg === 2 && !low || tg === 3 && !rlow) return;   // tag 3: the walls under the ends of the railway bridge
    const Rr = 0.45 + COL.s[id * 6 + 4]; if (d >= Rr || d < 1e-5) return; const k = (Rr - d) / d; P.x += (P.x - px) * k; P.z += (P.z - pz) * k;
  }); parkedPush(P); staticCarPush(P); }   // and the cars parked at this time of day and the standing ones
}
function step(dt) {
  let f = 0, s = 0;
  if (keys.has(SET.keys.forward) || keys.has('ArrowUp')) f += 1; if (keys.has(SET.keys.back) || keys.has('ArrowDown')) f -= 1;
  if (keys.has(SET.keys.right)) s += 1; if (keys.has(SET.keys.left)) s -= 1;
  if (keys.has('ArrowLeft')) P.yaw += 1.9 * dt; if (keys.has('ArrowRight')) P.yaw -= 1.9 * dt;
  f += touch.mz; s += touch.mx;
  const run = keys.has(SET.keys.run) || keys.has('ShiftRight');
  const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  if (P.fly) {
    const sp = (28 + P.y * 0.45) * (run ? 4 : 1), cp = Math.cos(P.pitch);
    P.x += (-sy * cp * f + cy * s) * sp * dt; P.z += (-cy * cp * f - sy * s) * sp * dt; P.y += Math.sin(P.pitch) * f * sp * dt;
    if (keys.has('KeyE') || keys.has('Space')) P.y += sp * 0.6 * dt; if (keys.has('KeyQ')) P.y -= sp * 0.6 * dt;
    P.y = Math.max(terrainH(P.x, P.z) + 2, Math.min(1500, P.y));
  } else if (l > 0.01) {
    const sp = P.crouch ? JUMP.crouchSpeed : run ? 11 : 6; let dx = (-sy * f + cy * s) * sp * dt, dz = (-cy * f - sy * s) * sp * dt;   // 6 m/s by default: a brisk jog, the run clip plays at its own rate; Shift is the sprint
    const feet = P.y - P.eye - P.up;   // where the feet stood at the last frame
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3)); dx /= n; dz /= n;
    for (let i = 0; i < n; i++) {
      const ox = P.x, oz = P.z; P.x += dx; P.z += dz; collide(feet);
      if (inWater(P.x, P.z) && !onRoad(P.x, P.z, 1.2) && !(inWater(ox, oz) && !onRoad(ox, oz, 1.2))) { P.x = ox; P.z = oz; break; }
    }
    P.walked += sp * dt * l;
  }
  P.x = Math.max(-HX, Math.min(HX, P.x)); P.z = Math.max(-HY, Math.min(HY, P.z));
  if (!P.fly) {
    const ground = P.y - P.eye - P.up;   // the ground under the feet at the last frame (walkLift uses it to tell bridges from what is under them)
    P.crouch = keys.has(SET.keys.crouch) && P.up <= 0.001;   // crouch: C (hold), on a walk and in the game alike
    if (STATE.mp) {   // in the game: jump (space) too
      if (keys.has(SET.keys.jump) && P.up <= 0.001 && !P.crouch) P.vy = JUMP.v;
      if (P.vy !== 0 || P.up > 0) { P.vy -= JUMP.g * dt; P.up += P.vy * dt; if (P.up <= 0) { P.up = 0; P.vy = 0; } }
    } else { P.up = 0; P.vy = 0; }
    P.eye += ((P.crouch ? JUMP.eyeCrouch : JUMP.eyeStand) - P.eye) * Math.min(1, dt * 12);
    P.y = P.eye + P.up + walkLift(P.x, P.z, ground);
  }   // up the hills and ramparts, down into the moats, over the bridges
}
function setFly(on) {
  if (STATE.mp && on) return;
  P.fly = on; $('bFly').setAttribute('aria-pressed', on);
  if (on) { P.y = Math.max(P.y, terrainH(P.x, P.z) + 70); P.pitch = Math.min(P.pitch, -0.35); } else { [P.x, P.z] = freeSpot(P.x, P.z); P.eye = 1.7; P.up = 0; P.vy = 0; P.y = 1.7 + terrainH(P.x, P.z); P.pitch = 0; }
  STATE.hudTimer = 0; STATE.lodTimer = 0;
}

export { JUMP, P, freeSpot, keys, setFly, step, teleport, touch };
