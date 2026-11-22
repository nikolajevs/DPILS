import { STATE } from '../core/state.js';
import { COL, inBuilding, inWater, onRoad, shorePush } from '../world/data.js';
import { terrainH, walkLift } from '../world/terrain.js';
import { upLow } from '../world/underpass.js';
import { rbLow } from '../world/bridge-railway.js';
import { parkedAt, parkedPush } from '../landmarks/parking.js';
import { staticCarPush } from '../world/cars.js';
import { SET } from './settings.js';
import { HX, HY } from '../core/env.js';

/* ---------- player ---------- */
// eye: height of the eyes over the feet (1.7 standing, 1.1 crouched); up: the jump, metres over the ground; vy: its speed;
// vx/vz: the walk's own velocity — it ramps up and brakes (MOVE), so the strafe is not "on rails";
// kx/kz: the blast knockback (the server's 'push'), a horizontal velocity that decays as it slides;
// fallTop: the apex of the current flight (absolute feet height); landH: the height just landed from (mp.js reports it
// to the server, which owns the damage); land: the camera dip of a hard landing, decaying
const P = { x: -1487, y: 1.7, z: 1263, yaw: 0.6, pitch: 0, fly: false, walked: 0, eye: 1.7, up: 0, vy: 0, crouch: false, vx: 0, vz: 0, kx: 0, kz: 0, fallTop: 0, landH: 0, land: 0, speedMul: 1 };   // speedMul: the «Святая гонка» Lutheran bell hastens the holding side (mp.js sets it)
const JUMP = { v: 6.4, g: 21, eyeStand: 1.7, eyeCrouch: 1.1, crouchSpeed: 1.8 };
// the weight of the walk, m/s²: accel — the ramp-up to the keyed speed (6 m/s in ~0.15 s, the sprint 11 in ~0.28 s),
// decel — the brake when the keys are released (a ~0.3 m slide from the jog, ~1.1 m from the sprint),
// air — the little authority over the jump: the momentum carries, no friction aloft
const MOVE = { accel: 40, decel: 55, air: 10 };
const STEP = 0.4;   // the tallest rise the walk climbs as a step (a kerb 0.13, a tread 0.18, a platform 0.35); taller is a wall
const FALL = { safe: 3 };   // keep in step with server/combat.mjs: a landing from above 3 m is reported to the server (it deals the damage)
const keys = new Set(); const touch = { mx: 0, mz: 0 };
STATE.started = false; STATE.night = false; STATE.locked = false; STATE.introT = 0;
function freeSpot(x, z) {
  const bad = (a, b) => inBuilding(a, b) || (inWater(a, b) && !onRoad(a, b, 1)) || parkedAt(a, b);
  if (!bad(x, z)) return [x, z];
  for (let r = 4; r < 400; r += 5) for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283 + r, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r; if (!bad(nx, nz)) return [nx, nz]; }
  return [x, z];
}
function collide(feet) {   // feet: the height the walker stands at; under the deck of Vienības tilts only the walls under it count, on it only the walls of the deck
  for (let it = 0; it < 2; it++) { const low = upLow(P.x, P.z, feet), rlow = rbLow(P.x, P.z, feet); COL.near(P.x, P.z, 0.45, (id, d, px, pz) => {
    const tg = COL.s[id * 6 + 5]; if (tg === 1 && low || tg === 2 && !low || tg === 3 && !rlow) return;   // tag 3: the walls under the ends of the railway bridge
    const Rr = 0.45 + COL.s[id * 6 + 4]; if (d >= Rr || d < 1e-5) return; const k = (Rr - d) / d; P.x += (P.x - px) * k; P.z += (P.z - pz) * k;
  }); parkedPush(P); staticCarPush(P);   // and the cars parked at this time of day and the standing ones
  const [sx, sz] = shorePush(P.x, P.z, 0.45); P.x = sx; P.z = sz; }   // deep water holds its bank: slide along it, no revert
}
/* The flying camera: no collisions, the ground is the floor (2 m above it) and 1500 m the ceiling. P.fly marks it;
   the game itself never flies — it is the free view of the dead man (spectate in mp.js, base 10 m/s) and the camera
   of the view tools (tools/shots.js, tools/warm.mjs set P.fly and place P themselves). WASD along the look, E / Space
   up, Q down, Shift four times faster; the speed grows with the height so the city can be crossed quickly. */
function flyStep(dt, base = 28) {
  let f = 0, s = 0;
  if (keys.has(SET.keys.forward) || keys.has('ArrowUp')) f += 1; if (keys.has(SET.keys.back) || keys.has('ArrowDown')) f -= 1;
  if (keys.has(SET.keys.right)) s += 1; if (keys.has(SET.keys.left)) s -= 1;
  f += touch.mz; s += touch.mx;
  const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
  const run = keys.has(SET.keys.run) || keys.has('ShiftRight');
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const sp = (base + P.y * 0.45) * (run ? 4 : 1), cp = Math.cos(P.pitch);
  P.x += (-sy * cp * f + cy * s) * sp * dt; P.z += (-cy * cp * f - sy * s) * sp * dt; P.y += Math.sin(P.pitch) * f * sp * dt;
  if (keys.has('KeyE') || keys.has('Space')) P.y += sp * 0.6 * dt; if (keys.has('KeyQ')) P.y -= sp * 0.6 * dt;
  P.y = Math.max(terrainH(P.x, P.z) + 2, Math.min(1500, P.y));
  P.x = Math.max(-HX, Math.min(HX, P.x)); P.z = Math.max(-HY, Math.min(HY, P.z));
}
function step(dt) {
  if (P.fly) { flyStep(dt); return; }
  let f = 0, s = 0;
  if (keys.has(SET.keys.forward) || keys.has('ArrowUp')) f += 1; if (keys.has(SET.keys.back) || keys.has('ArrowDown')) f -= 1;
  if (keys.has(SET.keys.right)) s += 1; if (keys.has(SET.keys.left)) s -= 1;
  if (keys.has('ArrowLeft')) P.yaw += 1.9 * dt; if (keys.has('ArrowRight')) P.yaw -= 1.9 * dt;
  f += touch.mz; s += touch.mx;
  const run = keys.has(SET.keys.run) || keys.has('ShiftRight');
  const l = Math.hypot(f, s); if (l > 1) { f /= l; s /= l; }
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  {
    const sp = (P.crouch ? JUMP.crouchSpeed : run ? 11 : 6) * (P.speedMul || 1);   // 6 m/s by default: a brisk jog, the run clip plays at its own rate; Shift is the sprint
    const tx = (-sy * f + cy * s) * sp, tz = (-cy * f - sy * s) * sp;   // where the keys want to go, m/s
    const air = P.up > 0.001 || P.vy > 0;
    const rate = air ? (l > 0.01 ? MOVE.air : 0) : l > 0.01 ? MOVE.accel : MOVE.decel;
    const dvx = tx - P.vx, dvz = tz - P.vz, dl = Math.hypot(dvx, dvz), cap = rate * dt;
    if (dl <= cap) { P.vx = tx; P.vz = tz; } else { const k = cap / dl; P.vx += dvx * k; P.vz += dvz * k; }
    if (!air && l <= 0.01 && Math.hypot(P.vx, P.vz) < 0.05) P.vx = P.vz = 0;
    let dx = P.vx * dt, dz = P.vz * dt;
    if (dx || dz) {
      let feet = P.y - P.eye - P.up;   // where the feet stood at the last frame
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3)); dx /= n; dz /= n;
      for (let i = 0; i < n; i++) {
        const ox = P.x, oz = P.z; P.x += dx; P.z += dz; collide(feet);
        const gNew = walkLift(P.x, P.z, feet);
        if (!air && gNew - feet > STEP) { P.x = ox; P.z = oz; P.vx = P.vz = 0; break; }   // a rise too tall to step: a wall
        feet = gNew;   // a kerb or a tread: the feet follow the slab up
      }
    }
    P.walked += Math.hypot(P.vx, P.vz) * dt;
  }
  if (P.kx || P.kz) {   // the blast knockback: a decaying slide with the same collisions as the walk, even when standing still
    let dx = P.kx * dt, dz = P.kz * dt;
    let feet = P.y - P.eye - P.up; const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3)); dx /= n; dz /= n;
    const air = P.up > 0.001 || P.vy > 0;
    for (let i = 0; i < n; i++) {
      const ox = P.x, oz = P.z; P.x += dx; P.z += dz; collide(feet);
      const gNew = walkLift(P.x, P.z, feet);
      if (!air && gNew - feet > STEP) { P.x = ox; P.z = oz; P.kx = P.kz = 0; break; }
      feet = gNew;
    }
    const kd = Math.exp(-5 * dt); P.kx *= kd; P.kz *= kd;
    if (Math.hypot(P.kx, P.kz) < 0.05) P.kx = P.kz = 0;
  }
  P.x = Math.max(-HX, Math.min(HX, P.x)); P.z = Math.max(-HY, Math.min(HY, P.z));
  const ground = P.y - P.eye - P.up;   // the ground under the feet at the last frame (walkLift uses it to tell bridges from what is under them)
  P.crouch = keys.has(SET.keys.crouch) && P.up <= 0.001;   // crouch: C (hold)
  const gNow = walkLift(P.x, P.z, ground);
  if (ground - gNow > 0.5 + 12 * dt) P.up += ground - gNow;   // stepped off an edge: the ground fell away faster than any slope — keep the feet where they were and fall, no teleport down
  if (STATE.mp && keys.has(SET.keys.jump) && P.up <= 0.001 && !P.crouch) P.vy = JUMP.v;   // jump (space)
  if (P.vy !== 0 || P.up > 0) {   // in the air: a jump, a blast's kick up or a fall from an edge
    P.fallTop = Math.max(P.fallTop, gNow + P.up);   // the apex of the flight, absolute feet height
    P.vy -= JUMP.g * dt; P.up += P.vy * dt;
    if (P.up <= 0) {   // landing: the height fallen is the apex over the ground met
      P.landH = Math.max(0, P.fallTop - gNow); P.up = 0; P.vy = 0; P.fallTop = 0;
      if (P.landH > FALL.safe) P.land = Math.min(0.45, 0.05 * P.landH);   // the camera dips under a hard landing
    }
  } else P.fallTop = 0;
  P.land *= Math.exp(-7 * dt); if (P.land < 0.005) P.land = 0;
  P.eye += ((P.crouch ? JUMP.eyeCrouch : JUMP.eyeStand) - P.eye) * Math.min(1, dt * 12);
  P.y = P.eye + P.up + gNow;   // up the hills and ramparts, down into the moats, over the bridges; off an edge — a real fall
}

export { FALL, JUMP, MOVE, P, flyStep, freeSpot, keys, step, touch };
