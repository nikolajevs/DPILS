import * as THREE from 'three';
import { buildingAt } from '../world/data.js';
import { terrainH } from '../world/terrain.js';
import { camera, scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';

/* ---------- realistic shots: flying tracers, bullet marks, dust, sparks, shells ----------
   The game (mp.js) knows where every bullet stops: a wall, the ground or a body. This module draws the consequences.
   A tracer is a short bright streak that really flies (560 m/s for the rifle, slower pellets, a faster sniper bullet);
   when its head reaches the end of the path, the mark appears: a bullet hole on the surface, a puff of dust, sparks
   off stone, a wisp of smoke. The hole is oriented by the true surface normal (the nearest wall edge of the building
   outline, the slope of the terrain), so it lies on the wall instead of floating in front of it. Marks live half a
   minute and fade; the pools are capped so a long firefight cannot grow without bound. */

const V = new THREE.Vector3(), V2 = new THREE.Vector3();

/* ---------- textures, drawn once on a canvas ---------- */
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let TEX_HOLE = null, TEX_PUFF = null;
function holeTex() {   // a dark punched hole with a rim of dust and short cracks
  if (TEX_HOLE) return TEX_HOLE;
  TEX_HOLE = canvasTex(64, (g, s) => {
    const c = s / 2;
    let r = g.createRadialGradient(c, c, 0, c, c, 26);
    r.addColorStop(0, 'rgba(200,195,185,0.5)'); r.addColorStop(0.45, 'rgba(160,155,145,0.28)'); r.addColorStop(1, 'rgba(160,155,145,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(15,14,12,0.75)'; g.lineWidth = 1.4;
    for (let i = 0; i < 8; i++) { const a = Math.random() * 6.283, l = 10 + Math.random() * 14; g.beginPath(); g.moveTo(c + Math.cos(a) * 5, c + Math.sin(a) * 5); g.lineTo(c + Math.cos(a + (Math.random() - 0.5) * 0.5) * l, c + Math.sin(a + (Math.random() - 0.5) * 0.5) * l); g.stroke(); }
    r = g.createRadialGradient(c, c, 0, c, c, 11);
    r.addColorStop(0, 'rgba(8,8,8,1)'); r.addColorStop(0.6, 'rgba(14,13,12,0.95)'); r.addColorStop(1, 'rgba(20,18,16,0)');
    g.fillStyle = r; g.beginPath(); g.arc(c, c, 11, 0, 6.283); g.fill();
  });
  return TEX_HOLE;
}
function puffTex() {   // a soft round blob: dust, smoke, sparks
  if (TEX_PUFF) return TEX_PUFF;
  TEX_PUFF = canvasTex(32, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
  return TEX_PUFF;
}
/* ---------- bullet marks ---------- */
const decals = [], DECAL_MAX = 140, DECAL_LIFE = 30;
const decalGeo = new THREE.PlaneGeometry(1, 1);
const decalMat = () => worldSpace(new THREE.MeshBasicMaterial({ map: holeTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
function addDecal(x, y, z, n, size, tint) {
  let d;
  if (decals.length >= DECAL_MAX) d = decals.shift();   // the oldest mark gives its place to the new one
  else { d = { mesh: new THREE.Mesh(decalGeo, decalMat()), t: 0 }; scene.add(d.mesh); }
  d.t = 0; d.mesh.material.color.setHex(tint); d.mesh.material.opacity = 1;
  d.mesh.position.set(x + n[0] * 0.03, y + n[1] * 0.03, z + n[2] * 0.03);
  V.set(x + n[0], y + n[1], z + n[2]); d.mesh.lookAt(V); d.mesh.rotateZ(Math.random() * 6.283);
  const s = size * (0.8 + Math.random() * 0.5); d.mesh.scale.set(s, s, 1);
  decals.push(d);
}

/* ---------- particles: dust, sparks, smoke, the puff of a body hit ----------
   One InstancedMesh for the whole pool (as the effects of the donor game do): a soft quad per particle, turned to the
   camera every frame, its own colour and opacity. The opacity rides an instanced attribute aOp into the fragment —
   three has no per-instance opacity of its own. No sprite materials are created or disposed during a firefight. */
const PART_MAX = 240;
const partGeo = new THREE.PlaneGeometry(1, 1);
const partOp = new THREE.InstancedBufferAttribute(new Float32Array(PART_MAX), 1);
partOp.setUsage(THREE.DynamicDrawUsage);
partGeo.setAttribute('aOp', partOp);
const partMat = worldSpace(new THREE.MeshBasicMaterial({ map: puffTex(), transparent: true, depthWrite: false }));
{
  const base = THREE.Material.prototype.onBeforeCompile;
  partMat.onBeforeCompile = function (s) {
    base.call(this, s);   // the terrain lift of the page stays (this material is worldSpace: it does not lift)
    s.vertexShader = 'attribute float aOp;\nvarying float vOp;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = aOp;');
    s.fragmentShader = 'varying float vOp;\n' + s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vOp;');
  };
  partMat.customProgramCacheKey = () => 'part-op';
}
const partMesh = new THREE.InstancedMesh(partGeo, partMat, PART_MAX);
partMesh.count = 0; partMesh.frustumCulled = false;
partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
partMesh.setColorAt(0, new THREE.Color(1, 1, 1));   // allocates the instanceColor buffer
scene.add(partMesh);
const pool = Array.from({ length: PART_MAX }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, s0: 1, s1: 1, c: new THREE.Color(), op: 1, grav: 0 }));
const free = [...pool], parts = [];
const PM = new THREE.Matrix4(), PQ = new THREE.Quaternion(), PV = new THREE.Vector3(), PS = new THREE.Vector3();
function puff(x, y, z, vx, vy, vz, life, s0, s1, color, op, grav) {
  const p = free.pop() || parts.shift();   // the oldest particle gives its place to the new one
  p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.t = 0; p.life = life; p.s0 = s0; p.s1 = s1; p.c.setHex(color); p.op = op; p.grav = grav;
  parts.push(p);
}
const rnd = (a, b) => a + Math.random() * (b - a);

/* ---------- the numbers of damage over the one you hit ---------- */
const floats = [];
let floatBox = null;
function dmgFloat(x, y, z, text, cls) {
  if (!floatBox) { floatBox = document.getElementById('mpFloaters'); if (!floatBox) return; }
  if (floats.length >= 24) floats.shift().el.remove();
  const el = document.createElement('div'); el.className = 'mp-float' + (cls ? ' ' + cls : ''); el.textContent = text; floatBox.append(el);
  floats.push({ x, y, z, el, t: 0 });
}

/* ---------- where exactly the bullet met the surface, and which way the surface faces ----------
   freePath steps 1.5 m, so its answer is up to that much inside the wall: bisect the last step down to ~3 mm. */
function refine(o, d, len) {
  const block = t => {
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t, g = terrainH(x, z);
    if (y < g) return 1;
    const b = buildingAt(x, z); return b && y < g + (b.top || 12) ? 2 : 0;
  };
  let lo = Math.max(0.2, len - 1.6), hi = len;
  if (!block(hi)) hi = len; else for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (block(mid)) hi = mid; else lo = mid; }
  const x = o[0] + d[0] * hi, y = o[1] + d[1] * hi, z = o[2] + d[2] * hi, g = terrainH(x, z), b = buildingAt(x, z);
  if (!b || y < g + 0.08) {   // the ground: its normal is the slope of the terrain
    const e = 0.6, hx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e), hz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e), L = Math.hypot(hx, 1, hz);
    return { x, y: Math.max(y, g), z, n: [-hx / L, 1 / L, -hz / L], kind: 'ground' };
  }
  if (d[1] < -0.2 && y > g + (b.top || 12) - 0.9) return { x, y, z, n: [0, 1, 0], kind: 'roof' };   // came from above onto the roof
  const r = b.ring; let nx = 0, nz = 0, bd = 1e18;   // the wall: the normal of the nearest edge of the outline
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], ex = r[i] - ax, ez = r[i + 1] - az, L2 = ex * ex + ez * ez; if (L2 < 1e-9) continue;
    const s = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), px = ax + ex * s - x, pz = az + ez * s - z, dd = px * px + pz * pz;
    if (dd < bd) { bd = dd; const L = Math.sqrt(L2); nx = ez / L; nz = -ex / L; }
  }
  if (nx * d[0] + nz * d[2] > 0) { nx = -nx; nz = -nz; }   // face the shooter
  if (!nx && !nz) { const L = Math.hypot(d[0], d[2]) || 1; nx = -d[0] / L; nz = -d[2] / L; }
  return { x, y, z, n: [nx, 0, nz], kind: 'wall' };
}
const HOLE_SIZE = [0.1, 0.055, 0.14, 0.08, 0.1];   // by weapon: the sniper leaves a bigger mark, a pellet a small one
function surfaceImpact(o, d, len, w) {
  const s = refine(o, d, len), ground = s.kind === 'ground';
  addDecal(s.x, s.y, s.z, s.n, HOLE_SIZE[w] ?? 0.1, ground ? 0x9a8f7a : 0xc9c5bc);
  const n = s.n;
  for (let i = 0, k = w === 1 ? 3 : 6; i < k; i++)   // dust thrown off the surface
    puff(s.x + n[0] * 0.05, s.y + n[1] * 0.05, s.z + n[2] * 0.05, n[0] * rnd(0.6, 2) + rnd(-0.7, 0.7), n[1] * rnd(0.6, 2) + rnd(0.1, 0.9), n[2] * rnd(0.6, 2) + rnd(-0.7, 0.7), rnd(0.3, 0.6), 0.06, rnd(0.25, 0.4), ground ? 0x9a8a70 : 0xa8a29a, 0.5, -1.2);
  if (!ground) for (let i = 0; i < 5; i++)   // sparks off stone and concrete
    puff(s.x + n[0] * 0.04, s.y + n[1] * 0.04, s.z + n[2] * 0.04, n[0] * rnd(1.5, 4) + rnd(-2, 2), n[1] * rnd(1.5, 4) + rnd(-0.5, 2), n[2] * rnd(1.5, 4) + rnd(-2, 2), rnd(0.12, 0.28), 0.035, 0.008, 0xffc873, 0.95, -9);
  puff(s.x + n[0] * 0.1, s.y + n[1] * 0.1 + 0.03, s.z + n[2] * 0.1, n[0] * 0.3 + rnd(-0.15, 0.15), 0.45, n[2] * 0.3 + rnd(-0.15, 0.15), 0.8, 0.12, 0.55, 0x9a9a9a, 0.28, 0.2);   // a wisp of smoke
}
function bodyImpact(o, d, len) {
  const x = o[0] + d[0] * len, y = o[1] + d[1] * len, z = o[2] + d[2] * len;
  for (let i = 0; i < 5; i++) puff(x, y, z, rnd(-1.2, 1.2) + d[0] * 0.6, rnd(-0.4, 1.2), rnd(-1.2, 1.2) + d[2] * 0.6, rnd(0.18, 0.3), 0.05, rnd(0.12, 0.2), 0x7a1f1f, 0.7, -3);
}

/* ---------- tracers that fly ---------- */
const tracers = [], SPEED = [560, 380, 820, 430, 560];   // m/s by weapon, for the eye (the hit itself is judged at once)
const tracerMat = color => worldSpace(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, fog: false }));
function tracerShot(o, d, len, w, kind, color, onArrive) {
  if (tracers.length > 80) { const tr = tracers.shift(); scene.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); }
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const l = new THREE.Line(g, tracerMat(color));
  l.frustumCulled = false; scene.add(l);
  tracers.push({ l, o, d, len, w, kind, onArrive, t: 0, speed: SPEED[w] ?? 560, trail: w === 1 ? 2.5 : 7, start: 0.9, done: false, fade: 0 });
}

/* ---------- shells out of your own gun ---------- */
const shells = [], SHELL_MAX = 24;
const shellGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.032, 6), shellMat = worldSpace(new THREE.MeshBasicMaterial({ color: 0xd2a94f }));
function ejectShell() {
  if (shells.length >= SHELL_MAX) { const s = shells.shift(); scene.remove(s.m); }
  camera.updateMatrixWorld();
  V.set(0.2, -0.14, -0.4).applyMatrix4(camera.matrixWorld);
  const e = camera.matrixWorld.elements;
  const m = new THREE.Mesh(shellGeo, shellMat); m.position.copy(V); scene.add(m);
  shells.push({ m, vx: e[0] * rnd(1.2, 2.2) + rnd(-0.3, 0.3), vy: e[1] * rnd(1.2, 2.2) + rnd(0.6, 1.4), vz: e[2] * rnd(1.2, 2.2) + rnd(-0.3, 0.3), rx: rnd(4, 12), rz: rnd(4, 12), t: 0 });
}
// a wisp of powder smoke at the muzzle of your own gun (mp.js gives the world point and the aim)
function muzzleSmoke(x, y, z, d) { puff(x, y, z, d[0] * 0.7 + rnd(-0.1, 0.1), 0.35, d[2] * 0.7 + rnd(-0.1, 0.1), 0.5, 0.05, 0.22, 0xb9b9b9, 0.22, 0.15); }

/* ---------- the frame ---------- */
function tickFx(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i]; tr.t += dt;
    const head = Math.min(tr.len, tr.start + tr.t * tr.speed), tail = Math.max(Math.min(tr.start, head), head - tr.trail);
    if (!tr.done && head >= tr.len) {
      tr.done = true;
      if (tr.kind === 'surface') surfaceImpact(tr.o, tr.d, tr.len, tr.w);
      else if (tr.kind === 'body') bodyImpact(tr.o, tr.d, tr.len);
      if (tr.onArrive) tr.onArrive();
    }
    if (tr.done) { tr.fade += dt; tr.l.material.opacity = Math.max(0, 0.85 - tr.fade * 14); if (tr.fade > 0.07) { scene.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); tracers.splice(i, 1); } continue; }
    const p = tr.l.geometry.attributes.position;
    p.setXYZ(0, tr.o[0] + tr.d[0] * tail, tr.o[1] - 0.05 + tr.d[1] * tail, tr.o[2] + tr.d[2] * tail);
    p.setXYZ(1, tr.o[0] + tr.d[0] * head, tr.o[1] + tr.d[1] * head, tr.o[2] + tr.d[2] * head);
    p.needsUpdate = true;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt;
    if (p.t >= p.life) { parts.splice(i, 1); free.push(p); continue; }
    p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  }
  PQ.copy(camera.quaternion);   // every quad faces the camera
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], k = p.t / p.life, s = p.s0 + (p.s1 - p.s0) * k;
    PM.compose(PV.set(p.x, p.y, p.z), PQ, PS.set(s, s, s));
    partMesh.setMatrixAt(i, PM); partMesh.setColorAt(i, p.c); partOp.setX(i, p.op * (1 - k));
  }
  partMesh.count = parts.length;
  partMesh.instanceMatrix.needsUpdate = true;
  if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
  partOp.needsUpdate = true;
  {   // the damage numbers rise and fade over the world point of the hit
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.t += dt;
      if (f.t > 0.9) { f.el.remove(); floats.splice(i, 1); continue; }
      V.set(f.x, f.y + f.t * 0.9, f.z).project(camera);
      if (V.z > 1) { f.el.style.opacity = '0'; continue; }
      f.el.style.transform = 'translate(-50%,-100%) translate(' + ((V.x + 1) / 2 * w).toFixed(0) + 'px,' + ((1 - V.y) / 2 * h).toFixed(0) + 'px)';
      f.el.style.opacity = String(f.t < 0.55 ? 1 : Math.max(0, 1 - (f.t - 0.55) / 0.35));
    }
  }
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i]; d.t += dt;
    if (d.t >= DECAL_LIFE) { scene.remove(d.mesh); d.mesh.material.dispose(); decals.splice(i, 1); continue; }
    if (d.t > DECAL_LIFE - 4) d.mesh.material.opacity = (DECAL_LIFE - d.t) / 4;
  }
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i]; s.t += dt;
    if (s.t > 2.5) { scene.remove(s.m); shells.splice(i, 1); continue; }
    s.vy -= 9.8 * dt; s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt;
    s.m.rotation.x += s.rx * dt; s.m.rotation.z += s.rz * dt;
    const g = terrainH(s.m.position.x, s.m.position.z) + 0.01;
    if (s.m.position.y < g && s.vy < 0) { s.m.position.y = g; s.vy *= -0.3; s.vx *= 0.6; s.vz *= 0.6; s.rx *= 0.5; s.rz *= 0.5; }
  }
}
function clearFx() {
  for (const tr of tracers) { scene.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); } tracers.length = 0;
  free.push(...parts); parts.length = 0; partMesh.count = 0;
  for (const f of floats) f.el.remove(); floats.length = 0;
  for (const d of decals) { scene.remove(d.mesh); d.mesh.material.dispose(); } decals.length = 0;
  for (const s of shells) scene.remove(s.m); shells.length = 0;
}

// one of each mark that is made only in a firefight (a hole, a tracer, a shell), out of the scene: the game's models put them
// into the warm-up of the city (mp.js loadModels), so the first shot does not wait for their shaders and textures
const fxSamples = () => [new THREE.Mesh(decalGeo, decalMat()), new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), tracerMat(0xffe9a0)), new THREE.Mesh(shellGeo, shellMat)];

export { fxSamples, tracerShot, tickFx, clearFx, dmgFloat, ejectShell, muzzleSmoke };
