import * as THREE from 'three';
import { buildingAt } from '../world/data.js';
import { terrainH } from '../world/terrain.js';
import { walkH } from '../world/walkgrid.js';
import { camera, scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { carAt } from '../world/car-hit.js';
import { WEAPONS, bulletAt, bulletDir, bulletDrop, dragDist } from '../../server/combat.mjs';
import { domeCross, domeHit } from './siege.js';

/* ---------- realistic shots: flying tracers, bullet marks, dust, sparks, shells ----------
   The game (mp.js) knows where every bullet stops: a wall, the ground or a body. This module draws the consequences.
   A tracer is a short bright streak that really flies at the weapon's muzzle velocity, braked by the same drag
   (dragDist: the server's v(t) = v0/(1+k·v0·t), server/combat.mjs) along the same falling arc (bulletAt: gravity sinks
   the bullet ½·g·t(s)², ~1.23 m at 400 m with the sniper), so the streak and the hit arrive together; the server's 'bhit' cuts it short at a body;
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
partMesh.userData.noProbe = true; scene.add(partMesh);
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
   freePath's coarse step is up to 1.5 m, so its answer can sit inside the wall: bisect the last step down to ~3 mm.
   A point-blank mark (len near 0, the muzzle resting on the face) bisects from 0 and lands on the face itself.
   The point rides the bullet's falling arc (bulletAt at the weapon's velocity), the same one the server flew. */
function refine(o, d, len, v, k) {
  const block = t => {
    const x = o[0] + d[0] * t, y = o[1] + d[1] * t - bulletDrop(t, v, k), z = o[2] + d[2] * t, g = terrainH(x, z);
    if (y < g) return 1;
    const b = buildingAt(x, z); return b && y < g + (b.top || 12) ? 2 : carAt(x, y, z) ? 3 : 0;
  };
  let lo = Math.max(0, len - 1.6), hi = len;
  if (!block(hi)) hi = len; else for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (block(mid)) hi = mid; else lo = mid; }
  const [x, y, z] = bulletAt(o, d, hi, v, k), g = terrainH(x, z), b = buildingAt(x, z);
  d = bulletDir(d, hi, v, k);   // the way the bullet was going when it met the surface: the roof and the wall face read it
  const car = carAt(x, y, z);
  if (car && !b) {   // a car: from above the roof, else the side facing away from the axis
    if (y > car.top - 0.25) return { x, y, z, n: [0, 1, 0], kind: 'car' };
    const nx = x - car.px, nz = z - car.pz, L = Math.hypot(nx, nz) || 1;
    return { x, y, z, n: [nx / L, 0, nz / L], kind: 'car' };
  }
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
  const s = refine(o, d, len, SPEED[w] ?? 560, DRAG[w] ?? 0), ground = s.kind === 'ground';
  const car = s.kind === 'car';
  addDecal(s.x, s.y, s.z, s.n, HOLE_SIZE[w] ?? 0.1, ground ? 0x9a8f7a : car ? 0x6a6a70 : 0xc9c5bc);
  const n = s.n;
  for (let i = 0, k = car ? 0 : w === 1 ? 3 : 6; i < k; i++)   // dust thrown off the surface
    puff(s.x + n[0] * 0.05, s.y + n[1] * 0.05, s.z + n[2] * 0.05, n[0] * rnd(0.6, 2) + rnd(-0.7, 0.7), n[1] * rnd(0.6, 2) + rnd(0.1, 0.9), n[2] * rnd(0.6, 2) + rnd(-0.7, 0.7), rnd(0.3, 0.6), 0.06, rnd(0.25, 0.4), ground ? 0x9a8a70 : 0xa8a29a, 0.5, -1.2);
  if (!ground) for (let i = 0, k = car ? 9 : 5; i < k; i++)   // sparks off stone and concrete
    puff(s.x + n[0] * 0.04, s.y + n[1] * 0.04, s.z + n[2] * 0.04, n[0] * rnd(1.5, 4) + rnd(-2, 2), n[1] * rnd(1.5, 4) + rnd(-0.5, 2), n[2] * rnd(1.5, 4) + rnd(-2, 2), rnd(0.12, 0.28), 0.035, 0.008, 0xffc873, 0.95, -9);
  puff(s.x + n[0] * 0.1, s.y + n[1] * 0.1 + 0.03, s.z + n[2] * 0.1, n[0] * 0.3 + rnd(-0.15, 0.15), 0.45, n[2] * 0.3 + rnd(-0.15, 0.15), 0.8, 0.12, 0.55, 0x9a9a9a, 0.28, 0.2);   // a wisp of smoke
}
function bodyImpact(o, d, len, w) {
  const [x, y, z] = bulletAt(o, d, len, SPEED[w] ?? 560, DRAG[w] ?? 0);
  for (let i = 0; i < 5; i++) puff(x, y, z, rnd(-1.2, 1.2) + d[0] * 0.6, rnd(-0.4, 1.2), rnd(-1.2, 1.2) + d[2] * 0.6, rnd(0.18, 0.3), 0.05, rnd(0.12, 0.2), 0x7a1f1f, 0.7, -3);
}
// the bullet met a grenade in the air ('nshot'): a strike of sparks and olive fragments where they crossed — no decal,
// there is no surface; the blast itself follows at once (the server's 'boom')
function nadeImpact(o, d, len, w) {
  const [x, y, z] = bulletAt(o, d, len, SPEED[w] ?? 560, DRAG[w] ?? 0);
  for (let i = 0; i < 8; i++) puff(x, y, z, rnd(-3, 3) + d[0] * 1.5, rnd(-1, 3), rnd(-3, 3) + d[2] * 1.5, rnd(0.1, 0.25), 0.03, 0.008, 0xffc873, 0.95, -9);
  for (let i = 0; i < 4; i++) puff(x, y, z, rnd(-2, 2), rnd(0, 2.5), rnd(-2, 2), rnd(0.15, 0.3), 0.04, 0.01, 0x3d5a2a, 0.8, -6);
  puff(x, y, z, 0, 0.5, 0, 0.5, 0.1, 0.4, 0x9a9a9a, 0.3, 0.2);
}

/* ---------- tracers that fly ---------- */
const tracers = [], SPEED = WEAPONS.map(w => w.vel ?? 560), DRAG = WEAPONS.map(w => w.drag ?? 0);   // m/s and the drag by weapon — the server's own ballistics, so the eye and the hit agree
const byBid = new Map();   // the server's bullet id → its tracer, so 'bhit' can cut the right streak at the body
const tracerMat = color => worldSpace(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, fog: false }));
function dropTracer(tr) { scene.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); if (tr.bid) byBid.delete(tr.bid); }
function tracerShot(o, d, len, w, kind, color, onArrive) {
  if (tracers.length > 80) dropTracer(tracers.shift());
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const l = new THREE.Line(g, tracerMat(color));
  l.frustumCulled = false; l.userData.noProbe = true; scene.add(l);
  const tr = { l, o, d, len, w, kind, onArrive, t: 0, speed: SPEED[w] ?? 560, k: DRAG[w] ?? 0, trail: w === 1 ? 2.5 : 7, start: 0.9, done: false, fade: 0, bid: 0 };
  tracers.push(tr); return tr;
}
function bindTracer(bid, tr) { if (bid && tr) { tr.bid = bid; byBid.set(bid, tr); } }
// the bullet reached a body (the server's 'bhit') or a grenade ('nshot', body = 'nade'): cut the tracer at the hit
// distance and show the impact there. If the streak already flew past (our own shot, drawn a round-trip early), show it at once.
function hitTracer(bid, dist, body) {
  const tr = byBid.get(bid); byBid.delete(bid);
  if (!tr) return;
  tr.len = Math.min(tr.len, dist);
  if (body === 'nade') tr.kind = 'nade'; else if (body) tr.kind = 'body';
  const impact = () => { if (tr.kind === 'surface') surfaceImpact(tr.o, tr.d, tr.len, tr.w); else if (tr.kind === 'body') bodyImpact(tr.o, tr.d, tr.len, tr.w); else if (tr.kind === 'nade') nadeImpact(tr.o, tr.d, tr.len, tr.w); };
  if (tr.done || tr.start + dragDist(tr.t, tr.speed, tr.k) >= tr.len) {   // already there or past: the impact now, not on a later frame
    if (!tr.done) { tr.done = true; impact(); if (tr.onArrive) tr.onArrive(); }
    else if (body === 'nade') nadeImpact(tr.o, tr.d, tr.len, tr.w);
    else if (body) bodyImpact(tr.o, tr.d, tr.len, tr.w);
  }
}

/* ---------- spent cases: out of the ejection port, tumbling, ringing on the ground ----------
   Every weapon throws its own case: the AK and the Minimi a necked brass rifle case, the SVD a longer rimmed one,
   the Makarov a short straight pistol case, the Remington a red 12-gauge hull with a brass head. The profile is a
   lathe of the true cartridge (metres), scaled per weapon; three instanced pools (rifle brass, pistol brass, hulls)
   draw every case lying about in three calls. The case leaves the port on the right of the receiver — mp.js gives
   the muzzle and the axes of the gun, the port stands back from the muzzle by the weapon's own measure — tossed
   right and up, tumbling about a random axis. The pump and the bolt throw late (a third of a second after the shot),
   as the action opens. Gravity brings the case down onto the terrain, the sidewalk under it (walkH) or the roof it
   was fired from; it bounces a few times, ringing on stone (mp.js plays the clink), then lies on its side and stays
   a while, fading at the end. The pools are capped: a long firefight recycles the oldest cases. */
const lathe = pts => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 10);
// 7.62×39: rim, extractor groove, tapered body, shoulder, neck; the SVD and the Minimi scale it to their own rounds
const rifleGeo = lathe([[0, 0], [0.00565, 0], [0.00565, 0.0016], [0.0046, 0.002], [0.0046, 0.0032], [0.00565, 0.0036], [0.00545, 0.027], [0.00435, 0.0315], [0.0043, 0.033], [0.0043, 0.0382], [0.0036, 0.039], [0, 0.039]]);
// 9×18 Makarov: rim, groove, straight body
const pistolGeo = lathe([[0, 0], [0.0048, 0], [0.0048, 0.0014], [0.0039, 0.0018], [0.0039, 0.0028], [0.00475, 0.0032], [0.00475, 0.0172], [0.0044, 0.018], [0, 0.018]]);
// 12 gauge fired hull: brass head, red plastic body, crimped mouth
const hullGeo = lathe([[0, 0], [0.01, 0], [0.01, 0.0018], [0.0088, 0.0022], [0.0088, 0.0034], [0.0099, 0.0038], [0.0099, 0.0155], [0.0093, 0.0162], [0.0093, 0.062], [0.0086, 0.066], [0.008, 0.068], [0, 0.068]]);
{   // the hull's two materials by vertex colour: brass below the head's edge, red plastic above
  const p = hullGeo.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const brass = p.getY(i) < 0.0158; c[i * 3] = brass ? 0.85 : 0.68; c[i * 3 + 1] = brass ? 0.66 : 0.11; c[i * 3 + 2] = brass ? 0.32 : 0.09; }
  hullGeo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}
// the opacity of each case rides an instanced attribute into the fragment (the fade at the end of its life)
function shellMat(vc) {
  const m = worldSpace(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: vc ? 0.5 : 0.85, roughness: vc ? 0.45 : 0.3, vertexColors: vc, transparent: true }));
  const base = THREE.Material.prototype.onBeforeCompile;
  m.onBeforeCompile = function (s) {
    base.call(this, s);
    s.vertexShader = 'attribute float aOp;\nvarying float vOp;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = aOp;');
    s.fragmentShader = 'varying float vOp;\n' + s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vOp;');
  };
  m.customProgramCacheKey = () => 'shell-op';
  return m;
}
const SHELL_POOLS = [];
function shellPool(geo, mat, max) {
  const op = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); op.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOp', op);
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1)); mesh.userData.noProbe = true; scene.add(mesh);
  const pool = { mesh, op, list: [], free: Array.from({ length: max }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, q: new THREE.Quaternion(), ax: new THREE.Vector3(1, 0, 0), spin: 0, t: 0, life: 1, sx: 1, sy: 1, r: 0.005, sleep: false, b: 0, c: new THREE.Color(), op: 1 })) };
  SHELL_POOLS.push(pool); return pool;
}
const POOL_RIFLE = shellPool(rifleGeo, shellMat(false), 48);
const POOL_PISTOL = shellPool(pistolGeo, shellMat(false), 24);
const POOL_HULL = shellPool(hullGeo, shellMat(true), 16);
// the port of each weapon: back from the muzzle, out to the right, up; the delay of the action; the scale of its
// case on the rifle profile; the toss of the ejection (a heavy hull flies slower than a rifle case)
const CASE = [
  { p: POOL_RIFLE, back: 0.55, side: 0.055, lift: 0.03, delay: 0, sx: 1, sy: 1, r: 0.0057, v: 1 },        // АК: 7.62×39
  { p: POOL_HULL, back: 0.42, side: 0.05, lift: 0, delay: 0.32, sx: 1, sy: 1, r: 0.01, v: 0.72 },         // Remington: 12 gauge, the pump
  { p: POOL_RIFLE, back: 0.52, side: 0.05, lift: 0.03, delay: 0.42, sx: 1.27, sy: 1.38, r: 0.0072, v: 0.95 }, // СВД: 7.62×54R, the bolt
  { p: POOL_PISTOL, back: 0.1, side: 0.032, lift: 0.035, delay: 0, sx: 1, sy: 1, r: 0.0048, v: 1.15 },    // Макаров: 9×18
  { p: POOL_RIFLE, back: 0.36, side: 0.05, lift: 0.02, delay: 0, sx: 0.85, sy: 1.16, r: 0.0048, v: 1.05 }, // Minimi: 5.56×45
];
const pending = [];   // the pump and the bolt: their cases leave when the action opens
let shellBounceFn = null;
const onShellBounce = fn => { shellBounceFn = fn; };
const SQ = new THREE.Quaternion(), SY = new THREE.Vector3(0, 1, 0);
function spawnCase(w, port, right, up, back) {
  const c = CASE[w] || CASE[0], pool = c.p;
  const s = pool.free.pop() || pool.list.shift();   // the oldest case gives its place to the new one
  s.x = port[0] + rnd(-0.01, 0.01); s.y = port[1] + rnd(-0.01, 0.01); s.z = port[2] + rnd(-0.01, 0.01);
  const vr = rnd(1.7, 2.9) * c.v, vu = rnd(1.0, 2.0) * c.v, vb = rnd(0, 0.5) * c.v;
  s.vx = right[0] * vr + up[0] * vu + back[0] * vb + rnd(-0.3, 0.3);
  s.vy = right[1] * vr + up[1] * vu + back[1] * vb + rnd(-0.2, 0.3);
  s.vz = right[2] * vr + up[2] * vu + back[2] * vb + rnd(-0.3, 0.3);
  s.ax.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(); s.spin = rnd(9, 22) * c.v;
  s.q.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
  s.t = 0; s.life = rnd(13, 19); s.sleep = false; s.b = 0; s.sx = c.sx; s.sy = c.sy; s.r = c.r * c.sx;
  const tint = rnd(0.85, 1.1);
  if (pool === POOL_HULL) s.c.setRGB(tint, tint * rnd(0.9, 1.1), tint); else s.c.setRGB(0.84 * tint, 0.68 * tint, 0.36 * tint);
  pool.list.push(s);
}
// mp.js gives the world muzzle of the gun and its axes (right, up, back — unit vectors); the port stands back from
// the muzzle on the right of the receiver, and the case flies out of it
function ejectShell(w, muzzle, right, up, back) {
  const c = CASE[w] || CASE[0];
  const port = [muzzle[0] - back[0] * c.back + right[0] * c.side + up[0] * c.lift,
    muzzle[1] - back[1] * c.back + right[1] * c.side + up[1] * c.lift,
    muzzle[2] - back[2] * c.back + right[2] * c.side + up[2] * c.lift];
  if (c.delay > 0) pending.push({ t: c.delay, w, port, right, up, back });
  else spawnCase(w, port, right, up, back);
}
// a wisp of powder smoke at the muzzle of your own gun (mp.js gives the world point and the aim)
function muzzleSmoke(x, y, z, d) { puff(x, y, z, d[0] * 0.7 + rnd(-0.1, 0.1), 0.35, d[2] * 0.7 + rnd(-0.1, 0.1), 0.5, 0.05, 0.22, 0xb9b9b9, 0.22, 0.15); }

/* ---------- the frame ---------- */
function tickFx(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i]; tr.t += dt;
    const head = Math.min(tr.len, tr.start + dragDist(tr.t, tr.speed, tr.k)), tail = Math.max(Math.min(tr.start, head), head - tr.trail);   // the drag brakes the streak as it brakes the bullet
    // the siege shield: a bystander's bullet crosses the field — a ripple and an electric slap exactly where it passes
    if (!tr.domed && head > (tr.lastHead ?? tr.start)) {
      const p0 = bulletAt(tr.o, tr.d, tr.lastHead ?? tr.start, tr.speed, tr.k), p1 = bulletAt(tr.o, tr.d, head, tr.speed, tr.k);
      const dh = domeCross(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
      if (dh) { tr.domed = true; domeHit(dh[0], dh[1], dh[2], 0.8); }
    }
    tr.lastHead = head;
    if (!tr.done && head >= tr.len) {
      tr.done = true;
      if (tr.kind === 'surface') surfaceImpact(tr.o, tr.d, tr.len, tr.w);
      else if (tr.kind === 'body') bodyImpact(tr.o, tr.d, tr.len, tr.w);
      else if (tr.kind === 'nade') nadeImpact(tr.o, tr.d, tr.len, tr.w);
      if (tr.onArrive) tr.onArrive();
    }
    if (tr.done) { tr.fade += dt; tr.l.material.opacity = Math.max(0, 0.85 - tr.fade * 14); if (tr.fade > 0.07) { dropTracer(tr); tracers.splice(i, 1); } continue; }
    const p = tr.l.geometry.attributes.position, tp = bulletAt(tr.o, tr.d, tail, tr.speed, tr.k), hp = bulletAt(tr.o, tr.d, head, tr.speed, tr.k);
    p.setXYZ(0, tp[0], tp[1] - 0.05, tp[2]);
    p.setXYZ(1, hp[0], hp[1], hp[2]);
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
  for (let i = pending.length - 1; i >= 0; i--) { const p = pending[i]; p.t -= dt; if (p.t <= 0) { spawnCase(p.w, p.port, p.right, p.up, p.back); pending.splice(i, 1); } }
  for (const pool of SHELL_POOLS) {
    const L = pool.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const s = L[i]; s.t += dt;
      if (s.t >= s.life) { L.splice(i, 1); pool.free.push(s); continue; }
      if (!s.sleep) {
        s.vy -= 9.81 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        if (s.spin > 0.01) { SQ.setFromAxisAngle(s.ax, s.spin * dt); s.q.premultiply(SQ); }
        const g0 = terrainH(s.x, s.z); let g = g0 + walkH(s.x, s.z), kind = 'ground';
        const b = buildingAt(s.x, s.z, s.y);
        if (b && s.y >= g0 + (b.top || 12) - 0.1) { g = g0 + (b.top || 12); kind = 'roof'; }   // fired from a roof: the case stays on it
        else if (g > g0 + 0.01) kind = 'step';
        if (s.y <= g + s.r && s.vy < 0) {
          s.y = g + s.r;
          const sp = -s.vy;
          if (sp > 0.7 && s.b < 3) {
            s.vy = sp * 0.32; s.vx *= 0.55; s.vz *= 0.55; s.spin *= 0.45; s.b++;
            s.ax.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
            if (shellBounceFn && sp > 0.9) shellBounceFn([s.x, s.y, s.z], sp, kind);
          } else {   // spent: lie on the side and stay
            s.sleep = true; s.vx = s.vy = s.vz = 0; s.spin = 0;
            const a = rnd(0, 6.283); s.q.setFromUnitVectors(SY, V.set(Math.cos(a), 0, Math.sin(a)));
            s.y = g + s.r * 0.95;
            if (shellBounceFn && sp > 0.9 && s.b === 0) shellBounceFn([s.x, s.y, s.z], sp, kind);
          }
        }
      }
      s.op = s.t > s.life - 1.5 ? (s.life - s.t) / 1.5 : 1;
    }
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      PM.compose(PV.set(s.x, s.y, s.z), s.q, PS.set(s.sx, s.sy, s.sx));
      pool.mesh.setMatrixAt(i, PM); pool.mesh.setColorAt(i, s.c); pool.op.setX(i, s.op);
    }
    pool.mesh.count = L.length;
    pool.mesh.instanceMatrix.needsUpdate = true;
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    pool.op.needsUpdate = true;
  }
}
function clearFx() {
  for (const tr of tracers) dropTracer(tr); tracers.length = 0; byBid.clear();
  free.push(...parts); parts.length = 0; partMesh.count = 0;
  for (const f of floats) f.el.remove(); floats.length = 0;
  for (const d of decals) { scene.remove(d.mesh); d.mesh.material.dispose(); } decals.length = 0;
  pending.length = 0;
  for (const pool of SHELL_POOLS) { pool.free.push(...pool.list); pool.list.length = 0; pool.mesh.count = 0; }
}

// one of each mark that is made only in a firefight (a hole, a tracer, a shell), out of the scene: the game's models put them
// into the warm-up of the city (mp.js loadModels), so the first shot does not wait for their shaders and textures
const fxSamples = () => [new THREE.Mesh(decalGeo, decalMat()), new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), tracerMat(0xffe9a0)), new THREE.InstancedMesh(rifleGeo, POOL_RIFLE.mesh.material, 1), new THREE.InstancedMesh(pistolGeo, POOL_PISTOL.mesh.material, 1), new THREE.InstancedMesh(hullGeo, POOL_HULL.mesh.material, 1)];

export { fxSamples, tracerShot, bindTracer, hitTracer, tickFx, clearFx, dmgFloat, ejectShell, onShellBounce, muzzleSmoke };
