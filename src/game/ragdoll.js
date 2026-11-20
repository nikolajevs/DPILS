import * as THREE from 'three';
import { walkLift, terrainH } from '../world/terrain.js';
import { buildingAt } from '../world/data.js';

/* ---------- the ragdoll of a killed player ----------
   The death clip used to topple every body backwards the same way. Now the skeleton itself falls: the
   joints become particles of a verlet simulation (gravity, sticks between the joints, limits on the
   bends, the ground of walkLift), thrown by the killing blow (fall: the direction away from the shooter,
   head / nade: a harder throw) and carrying the speed the player had (vel). The bones are put back on
   the particles every frame, so the skin, the gun tied to the hand and the gear follow. All four
   characters share the Mixamo bone names (tools/character.mjs); 2B has one more spine bone, and her
   skirt hangs from the hips and rides along. makeRagdoll returns null when a bone is missing — the
   caller keeps the death clip. The body settles and goes to sleep; mp.js hides it after three seconds.
   The houses are solid for the dead too: a particle inside an outline is pushed out through the nearest
   edge (no corpse lying in the lobby of the Unity House), and one thrown onto a roof rests on it.
   The blow itself: fall = { x, z, y, zone, head, nade, soft, vf } — the direction it came along (the
   bullet's own tangent at the hit, or away from the blast), the zone it struck (1 head, 0 torso, 2 legs:
   that chain takes the most, the rest fade through THROW_W), and vf, the speed fraction left in the
   bullet — a spent bullet pushes less, but the ceiling stays: a real 4–5 N·s must not launch a body. */

const H = 1 / 60, G = 9.81, DAMP = 0.996, ITER = 8;
// the particles: 0 hips, 1 chest, 2 neck, 3 head, 4–6 left arm, 7–9 right arm, 10–12 left leg, 13–15 right leg
const RAD = [0.14, 0.13, 0.07, 0.11, 0.07, 0.06, 0.05, 0.07, 0.06, 0.05, 0.09, 0.07, 0.06, 0.09, 0.07, 0.06];   // thickness above the ground
const IMAS = [0.7, 0.9, 1, 1.3, 1, 1.1, 1.2, 1, 1.1, 1.2, 0.9, 1.1, 1.2, 0.9, 1.1, 1.2];   // inverse mass: the core is heavy, the limbs fly
const THROW_W = [0.85, 1, 1.1, 1.15, 0.9, 0.85, 0.8, 0.9, 0.85, 0.8, 0.8, 0.75, 0.7, 0.8, 0.75, 0.7];   // how much of the blow each joint takes
const STICKS = [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [5, 6], [1, 7], [7, 8], [8, 9], [0, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [4, 7], [10, 13]];   // the bones and the two girdles
// bends that must not fold: hips–neck and chest–head keep the spine from doubling up; an arm or a leg
// cannot stretch past its full length (max 0 = the sum of its two sticks) nor fold flat; the chest–hip
// diagonals keep the torso from shearing into a parallelogram
const LIMITS = [[0, 2, 0.55, 1.02], [1, 3, 0.5, 1.05], [4, 6, 0.1, 0], [7, 9, 0.1, 0], [10, 12, 0.15, 0], [13, 15, 0.15, 0], [1, 10, 0.7, 1.25], [1, 13, 0.7, 1.25]];
const MID = { 4: 5, 7: 8, 10: 11, 13: 14 };   // the elbow / knee between the ends of a limb
// the bones of each chain and the particle on each (null: the bone rides between the neighbouring particles)
const CHAINS = [
  { b: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Spine3', 'Neck', 'Head'], p: [0, null, null, 1, null, 2, 3], opt: { Spine3: 1 } },
  { b: ['ShoulderL', 'UpperArmL', 'LowerArmL', 'FistL'], p: [4, null, 5, 6] },
  { b: ['ShoulderR', 'UpperArmR', 'LowerArmR', 'FistR'], p: [7, null, 8, 9] },
  { b: ['thigh_l', 'calf_l', 'foot_l'], p: [10, 11, 12] },
  { b: ['thigh_r', 'calf_r', 'foot_r'], p: [13, 14, 15] },
];

const PV = new THREE.Vector3(), DV = new THREE.Vector3(), SV = new THREE.Vector3(), SS = new THREE.Vector3();
const PQ = new THREE.Quaternion(), DQ = new THREE.Quaternion(), RQ = new THREE.Quaternion();
const PM = new THREE.Matrix4();

// inner — the figure's group (the bones live under it); find(name) — a bone of its skeleton;
// opts: { fall: { x, z, head, nade }, vel: { x, y, z } } — the blow and the speed of the moment of death
function makeRagdoll(inner, find, opts) {
  const chains = [];
  for (const c of CHAINS) {
    const bones = [], parts = [];
    for (let i = 0; i < c.b.length; i++) {
      const b = find(c.b[i]);
      if (!b) { if (c.opt && c.opt[c.b[i]]) continue; return null; }
      bones.push(b); parts.push(c.p[i]);
    }
    chains.push({ bones, parts });
  }
  inner.updateWorldMatrix(true, true);
  const boneOf = [], rest = new Map();
  for (const c of chains) c.bones.forEach((b, i) => { rest.set(b, b.getWorldPosition(new THREE.Vector3())); if (c.parts[i] != null) boneOf[c.parts[i]] = b; });
  // the particles start where the joints stand, with the speed of the player plus the throw of the blow
  const fall = opts.fall || {};
  let fx = fall.x || 0, fz = fall.z || 0;
  if (!fx && !fz) { const a = Math.random() * 6.283; fx = Math.sin(a); fz = Math.cos(a); }
  const zone = fall.zone == null ? (fall.head ? 1 : 0) : fall.zone, fy = fall.y || 0;
  const vf = fall.vf == null ? 1 : Math.max(0, Math.min(1, fall.vf));   // the speed left in the bullet after drag and stone
  const pow = fall.soft ? 0.25 + Math.random() * 0.35 : fall.nade ? 4.5 + Math.random() * 2.5 : (2 + Math.random() * 1.4 + (fall.head ? 1.2 : 0)) * (0.6 + 0.4 * vf);   // soft: a fall from height crumples in place
  const up = fall.nade ? 2.2 + Math.random() * 2 : fall.head ? 0.6 : 0.15;
  const vel = opts.vel || { x: 0, y: 0, z: 0 }, vl = Math.hypot(vel.x, vel.y, vel.z), vk = vl > 9 ? 9 / vl : 1;
  const P = [], O = [];
  for (let i = 0; i < 16; i++) {
    // the struck chain takes the blow, the rest fade through THROW_W: head/neck ×1.7, legs ×1.5 (the core 0.7), torso ×1.15;
    // a blast or a soft fall shakes the whole body evenly, as before
    const p = rest.get(boneOf[i]).clone(), w = THROW_W[i] * (fall.nade || fall.soft ? 1 : zone === 1 && (i === 2 || i === 3) ? 1.7 : zone === 2 ? (i >= 10 ? 1.5 : 0.7) : zone === 0 && (i === 0 || i === 1) ? 1.15 : 1), j = i >= 4 ? 0.8 : 0.5;   // the limbs flail more than the core
    const vx = vel.x * vk + fx * pow * w + (Math.random() - 0.5) * j, vy = vel.y * vk + up * w + fy * pow * w * 0.5 + (Math.random() - 0.5) * j * 0.5, vz = vel.z * vk + fz * pow * w + (Math.random() - 0.5) * j;
    P.push(p); O.push(p.clone().addScaledVector(new THREE.Vector3(vx, vy, vz), -H));
  }
  const sticks = STICKS.map(([a, b]) => ({ a, b, r: P[a].distanceTo(P[b]) }));
  const limits = LIMITS.map(([a, b, mn, mx]) => {
    if (mx === 0) { const m = MID[a], full = P[a].distanceTo(P[m]) + P[m].distanceTo(P[b]); return { a, b, mn: mn * full, mx: 0.995 * full }; }
    const r = P[a].distanceTo(P[b]); return { a, b, mn: mn * r, mx: mx * r };
  });
  // the write-back: each bone rides its particle (or lerps between the two around it) and turns towards
  // the next particle of its chain; the turn is the shortest arc from the direction it had at death, so
  // the twist of the pose is kept. The last bone of a chain (head, hands, feet) keeps its local turn.
  const entries = [];
  for (const c of chains) {
    const n = c.bones.length;
    for (let i = 0; i < n; i++) {
      const b = c.bones[i], p = c.parts[i];
      let pa = -1, pb = -1;
      for (let k = i - 1; k >= 0; k--) if (c.parts[k] != null) { pa = c.parts[k]; break; }
      for (let k = i + 1; k < n; k++) if (c.parts[k] != null) { pb = c.parts[k]; break; }
      const e = { bone: b, p, pa, pb, aim: pb, q0: b.getWorldQuaternion(new THREE.Quaternion()), dir0: null, f: 0 };
      const rp = rest.get(b);
      if (p == null) {
        const ra = rest.get(boneOf[pa]), rb = rest.get(boneOf[pb]);
        e.f = rp.distanceTo(ra) / Math.max(1e-5, rb.distanceTo(ra));
        e.dir0 = rb.clone().sub(rp);
      } else if (pb >= 0) e.dir0 = rest.get(boneOf[pb]).clone().sub(rp);
      else e.aim = -1;
      if (e.dir0) { if (e.dir0.lengthSq() < 1e-10) e.dir0.set(0, 1, 0); e.dir0.normalize(); }
      entries.push(e);
    }
  }
  let acc = 0, quiet = 0, life = 0, done = false;
  function relax(a, b, r, k) {
    DV.copy(P[b]).sub(P[a]); const d = DV.length(); if (d < 1e-6) return;
    const diff = (d - r) / d * k, wa = IMAS[a] / (IMAS[a] + IMAS[b]);
    P[a].addScaledVector(DV, diff * wa); P[b].addScaledVector(DV, -diff * (1 - wa));
  }
  function ground() {
    for (let i = 0; i < 16; i++) {
      const p = P[i], o = O[i], g = walkLift(p.x, p.z) + RAD[i];
      if (p.y < g) {
        p.y = g;
        o.x = p.x - (p.x - o.x) * 0.35; o.z = p.z - (p.z - o.z) * 0.35;   // the ground drags the slide
        o.y = p.y + (p.y - o.y) * 0.1;   // a tenth of the fall bounces back, the rest dies
      }
    }
  }
  // the houses: a particle inside an outline is pushed out through the nearest edge — the corpse must not lie in the
  // lobby; above the roof line it rests on the roof instead (walkLift knows the ground, not the roofs). The wall kills
  // the inward way and drags the slide, as the ground does.
  function walls() {
    for (let i = 0; i < 16; i++) {
      const p = P[i], o = O[i], b = buildingAt(p.x, p.z, p.y);   // the height matters: under an open canopy the body lies free
      if (!b) continue;
      const roof = terrainH(p.x, p.z) + (b.top || 12);
      if (p.y > roof - 0.4) {
        const g = roof + RAD[i];
        if (p.y < g) { p.y = g; o.x = p.x - (p.x - o.x) * 0.35; o.z = p.z - (p.z - o.z) * 0.35; o.y = p.y + (p.y - o.y) * 0.1; }
        continue;
      }
      const r = b.ring; let qx = p.x, qz = p.z, bd = 1e18;
      for (let k = 0, j = r.length - 2; k < r.length; j = k, k += 2) {
        const ax = r[j], az = r[j + 1], ex = r[k] - ax, ez = r[k + 1] - az, L2 = ex * ex + ez * ez; if (L2 < 1e-9) continue;
        const s = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.z - az) * ez) / L2)), px = ax + ex * s, pz = az + ez * s, dd = (px - p.x) * (px - p.x) + (pz - p.z) * (pz - p.z);
        if (dd < bd) { bd = dd; qx = px; qz = pz; }
      }
      let nx = qx - p.x, nz = qz - p.z; const L = Math.hypot(nx, nz);
      if (L > 1e-6) { nx /= L; nz /= L; } else { nx = 0; nz = 1; }
      p.x = qx + nx * (RAD[i] + 0.02); p.z = qz + nz * (RAD[i] + 0.02);
      const vx = p.x - o.x, vz = p.z - o.z, vn = vx * nx + vz * nz;
      const tx = vx - vn * nx, tz = vz - vn * nz, rn = Math.max(0, vn) * 0.2;
      o.x = p.x - (tx * 0.6 + rn * nx); o.z = p.z - (tz * 0.6 + rn * nz);
    }
  }
  function step() {
    for (let i = 0; i < 16; i++) {
      const p = P[i], o = O[i];
      SV.copy(p).sub(o).multiplyScalar(DAMP); o.copy(p); p.add(SV); p.y -= G * H * H;
    }
    for (let it = 0; it < ITER; it++) {
      for (const s of sticks) relax(s.a, s.b, s.r, 1);
      for (const l of limits) { const d = P[l.a].distanceTo(P[l.b]); if (d < l.mn) relax(l.a, l.b, l.mn, 0.9); else if (d > l.mx) relax(l.a, l.b, l.mx, 0.9); }
      if (it % 2 === 1) { ground(); walls(); }
    }
    ground(); walls();
    life += H;
    let mx = 0; for (let i = 0; i < 16; i++) mx = Math.max(mx, P[i].distanceToSquared(O[i]));
    quiet = mx < 2e-6 ? quiet + 1 : 0;   // everything under ~0.09 m/s for half a second: the body has settled
    if (quiet > 30 || life > 2.6) done = true;
  }
  function write() {
    inner.updateWorldMatrix(true, true);
    for (const e of entries) {
      if (e.p != null) PV.copy(P[e.p]); else PV.copy(P[e.pa]).lerp(P[e.pb], e.f);
      if (e.aim >= 0) {
        DV.copy(P[e.aim]).sub(PV); const l = DV.length();
        if (l > 1e-6) { DQ.setFromUnitVectors(e.dir0, DV.divideScalar(l)); PQ.copy(DQ).multiply(e.q0); } else PQ.copy(e.q0);
        e.bone.parent.matrixWorld.decompose(SV, RQ, SS);
        e.bone.quaternion.copy(RQ.invert().multiply(PQ));
      }
      PM.copy(e.bone.parent.matrixWorld).invert();
      e.bone.position.copy(PV.applyMatrix4(PM));
      e.bone.updateMatrix();
      e.bone.matrixWorld.multiplyMatrices(e.bone.parent.matrixWorld, e.bone.matrix);
    }
  }
  return {
    step(dt) {
      if (done) return;
      acc = Math.min(acc + dt, H * 4);
      let stepped = false;
      while (acc >= H && !done) { acc -= H; step(); stepped = true; }
      if (stepped) write();
    },
  };
}

export { makeRagdoll };
