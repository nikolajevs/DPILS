import * as THREE from 'three';
import { buildingAt, onRoad } from '../world/data.js';
import { terrainH } from '../world/terrain.js';
import { camera, scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { reduceMotion } from '../core/env.js';
import { fbm } from './muzzle.js';
import { prop, onProps } from './props.js';

/* ---------- grenades ----------
   The server flies every grenade and says where and when it goes off (server/game.mjs, damage and all). Each page
   also flies its own copy of it, with the same rules (keep NADE and the step in step with server/combat.mjs and
   server/physics.mjs), so that it moves smoothly; at the blast the copy is put where the server's grenade was. */
const NADE = { g: 18 };
// the charged throw (keep server/combat.mjs NADE in step): the left mouse button held down gathers the speed from min
// to max over chargeMs; loft lifts the velocity a little above the aim, exactly as the server does
const NADE_THROW = { min: 6, max: 24, loft: 0.17, chargeMs: 1100 };
const list = new Map();
const GEO = new THREE.SphereGeometry(0.1, 10, 8), MAT = worldSpace(new THREE.MeshLambertMaterial({ color: 0x3d5a2a }));
function stepNade(n, dt) {
  const [px, py, pz] = n.p; n.v[1] -= NADE.g * dt;
  let x = px + n.v[0] * dt, y = py + n.v[1] * dt, z = pz + n.v[2] * dt;
  const b = buildingAt(x, z), gr = terrainH(x, z);
  if (b) {
    const top = gr + (b.top || 12);
    if (py >= top - 0.05) { if (y < top + 0.1) { y = top + 0.1; if (n.v[1] < 0) n.v[1] *= -0.35; n.v[0] *= 0.8; n.v[2] *= 0.8; } }
    else if (!buildingAt(px, z)) { x = px; n.v[0] *= -0.4; } else if (!buildingAt(x, pz)) { z = pz; n.v[2] *= -0.4; } else { x = px; z = pz; n.v[0] *= -0.4; n.v[2] *= -0.4; }
  } else if (y < gr + 0.12) { y = gr + 0.12; if (n.v[1] < 0) n.v[1] *= -0.4; n.v[0] *= 0.7; n.v[2] *= 0.7; if (Math.abs(n.v[1]) < 0.8) n.v[1] = 0; }
  n.p = [x, y, z];
}
/* модель гранаты посажена дном в ноль (так она стоит на карте); в полёте центруем её вокруг точки сервера */
function flyNade() {
  const m = prop('nade'); if (!m) return null;
  for (const c of m.children) c.position.y -= 0.1;
  return m;
}
function addNade(m) {
  const model = flyNade();
  const mesh = model || new THREE.Mesh(GEO, MAT); mesh.position.set(m.p[0], m.p[1], m.p[2]); scene.add(mesh);
  list.set(m.id, { mesh, model: !!model, p: m.p.slice(), v: m.v.slice(), age: 0 });
}
onProps(() => {
  for (const n of list.values()) if (!n.model) {
    const m = flyNade(); if (!m) continue;
    m.position.copy(n.mesh.position); m.rotation.copy(n.mesh.rotation);
    scene.remove(n.mesh); n.mesh = m; n.model = true;
  }
});
/* ---------- the blast ----------
   A frag grenade going off as it looks on film, not as a ball of fire: a white flash of a few hundredths of a second
   that lights the street around (the one light of the flashes, mp.js flashLit), a small fireball burnt out in a fifth
   of a second, hot fragments streaking away, a skirt of dust that the shock throws out along the ground, clods of earth
   (grit of the road, of the roof) flung up that trail dust and fall back, and a dark cloud of smoke and dust that swells,
   glows orange from the fire inside for a moment, then rises, drifts with the wind, greys and thins over several
   seconds. A burst in the air throws no earth and leaves no mark; one on a surface leaves a black scorch for most of a
   minute. Near the blast the camera jolts (camShake, called by loop.js), the ears ring and the world goes dull (mp.js
   deafen). Two instanced meshes draw every particle, so a fight makes and disposes no materials: the smoke is lit by
   the scene like any surface (the sun, the sky and the flash itself: grey by day, dark at night, orange in the flash),
   its quads bent like the face of a ball so that a puff has a lit and a shaded side; the fire, the glow and the
   fragments are added on top in colours brighter than white for the bloom of the page. Each particle has its own cell
   of a small atlas painted once from smooth noise, its own turn, size, colour, opacity and glow. */
const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v, rnd = (a, b) => a + Math.random() * (b - a);
const V = new THREE.Vector3();
const CELL = 128;
// n × n drawings in the cells of one canvas: fn(cell, x, y, out) puts [brightness, opacity] into out, x and y from −1 to 1
function paint(n, fn) {
  const side = CELL * n, c = document.createElement('canvas'); c.width = c.height = side;
  const g = c.getContext('2d'), img = g.createImageData(side, side), d = img.data, out = [0, 0];
  for (let i = 0; i < n * n; i++) {
    const ox = (i % n) * CELL, oy = Math.floor(i / n) * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const u = (x - 3) / (CELL - 7), v = (y - 3) / (CELL - 7);
      if (u <= 0 || v <= 0 || u >= 1 || v >= 1) continue;   // a clear margin: the mipmaps of one cell do not bleed into the next
      fn(i, u * 2 - 1, v * 2 - 1, out);
      const o = ((oy + y) * side + ox + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(255 * clamp(out[0])); d[o + 3] = Math.round(255 * clamp(out[1]));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// the smoke: three billows (a rim that wanders with the angle, denser lumps inside, frayed at the edge) and a clod of earth
const SMOKE_TEX = paint(2, (i, x, y, out) => {
  const r = Math.hypot(x, y), ca = r ? x / r : 1, sa = r ? y / r : 0;
  if (i === 3) { const R = 0.5 + 0.4 * fbm(ca * 1.7 + 5, sa * 1.7 + 3, 77); out[0] = 0.5 + 0.5 * fbm(x * 5 + 1, y * 5 + 2, 91); out[1] = clamp((R - r) * 12); return; }
  const s = i * 37 + 11, R = 0.58 + 0.34 * fbm(ca * 1.5 + s, sa * 1.5 - s, s), lump = fbm(x * 2.3 + s * 3, y * 2.3 - s, s + 5), fine = fbm(x * 6.5 + s, y * 6.5 + s * 2, s + 9);
  const e = clamp((R * (0.82 + 0.36 * fine) - r) / 0.5);
  out[0] = 0.72 + 0.28 * (lump * 0.6 + fine * 0.4); out[1] = e * e * (3 - 2 * e) * (0.55 + 0.45 * lump);
});
// the fire: two billows of flame, white-hot where they are dense, a soft glow, and a streak with its head at +x
const FIRE_TEX = paint(2, (i, x, y, out) => {
  const r = Math.hypot(x, y);
  if (i === 2) { out[0] = 1; out[1] = Math.exp(-r * r * 5) * clamp((1 - r) * 4); return; }
  if (i === 3) { const a = (x + 1) / 2, w = 0.06 + 0.12 * a; out[0] = 1; out[1] = a * a * Math.exp(-(y * y) / (w * w)) * clamp((1 - x) * 10); return; }
  const ca = r ? x / r : 1, sa = r ? y / r : 0, s = i * 53 + 7, R = 0.5 + 0.4 * fbm(ca * 1.6 + s, sa * 1.6 - s, s), lump = fbm(x * 3 + s, y * 3 - s, s + 3);
  const e = clamp((R - r) / 0.45), I = clamp(e * e * (0.35 + 0.65 * lump) + Math.max(0, 1 - r / 0.3) * 0.5);
  out[0] = 0.55 + 0.45 * I; out[1] = I;
});
// the scorch: black soot at the heart, grey ash towards a ragged rim, rays of soot thrown out past it
const SCORCH_TEX = paint(1, (i, x, y, out) => {
  const r = Math.hypot(x, y), ca = r ? x / r : 1, sa = r ? y / r : 0;
  const R = 0.5 + 0.28 * fbm(ca * 2 + 3, sa * 2 + 7, 41), rays = fbm(ca * 7 + 1, sa * 7 + 2, 53), grain = fbm(x * 9, y * 9, 61);
  const body = clamp((R - r) / 0.3) * (0.6 + 0.4 * grain), streak = clamp((R + 0.45 * rays - r) / 0.4) * rays * rays * 0.9;
  out[0] = 0.25 + 0.5 * grain * clamp(r / R); out[1] = Math.max(body, streak) * clamp((1 - r) * 5) * (0.75 + 0.25 * grain);
});
// the opacity and the glow of a particle (x, y) and the corner of its atlas cell (z, w) ride one instanced attribute aP;
// the glow is the light of the fire inside the smoke, added to what the scene lights
function particleMat(m, key) {
  const base = THREE.Material.prototype.onBeforeCompile;   // the page's own patch (world/terrain.js) stays: these are worldSpace, it lifts nothing
  m.onBeforeCompile = function (s) {
    base.call(this, s);
    s.vertexShader = 'attribute vec4 aP;\nvarying vec2 vP;\n' + s.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * 0.5 + aP.zw;\nvP = aP.xy;');
    s.fragmentShader = 'varying vec2 vP;\n' + s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vP.x;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vP.y * vec3(2.4, 1.0, 0.3);');
  };
  m.customProgramCacheKey = () => key;
  return worldSpace(m);
}
// a quad bent like the face of a ball (its normals lean out towards the rim): a puff turned to the camera gets a lit and a shaded side
function bentQuad() {
  const g = new THREE.PlaneGeometry(1, 1, 2, 2), p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { V.set(p.getX(i) * 1.7, p.getY(i) * 1.7, 1).normalize(); n.setXYZ(i, V.x, V.y, V.z); }
  return g;
}
function cloud(geo, mat, max, order) {
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); aP.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aP', aP);
  const mesh = new THREE.InstancedMesh(geo, mat, max); mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = order;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.setColorAt(0, new THREE.Color(1, 1, 1)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);   // allocates the colours
  scene.add(mesh);
  return { mesh, aP, list: [], free: Array.from({ length: max }, () => ({})) };
}
const smokeMat = particleMat(new THREE.MeshLambertMaterial({ map: SMOKE_TEX, transparent: true, depthWrite: false }), 'nade-smoke');
const fireMat = particleMat(new THREE.MeshBasicMaterial({ map: FIRE_TEX, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 'nade-fire');
const SMOKE = cloud(bentQuad(), smokeMat, 640, 1), FIRE = cloud(new THREE.PlaneGeometry(1, 1), fireMat, 200, 2);
const WHITE = [1, 1, 1];
// a particle: where it is and flies, how long it lives, its size from s0 to s1 (grow: how soon it gets there), its turn and spin,
// drag towards the air around (rise: the speed it climbs at, wind: how much of the wind takes it), gravity, colour from
// c0 to c1, opacity (fin: the fade-in, fout: the share of its life before it fades out), the glow of the fire for heatT
// seconds, the atlas cell; len and w make a streak along the flight; a clod falls to the ground and may trail dust
const PD = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, s0: 1, s1: 1, grow: 2, roll: 0, spin: 0, drag: 0, rise: 0, wind: 0, grav: 0, c0: WHITE, c1: WHITE, op: 1, fin: 0, fout: 0.5, heat: 0, heatT: 0.25, frame: 0, len: 0, w: 0, floor: -1e9, clod: false, roof: 0, trail: 0, tt: 0, dust: WHITE, d: 0 };
function emit(sys, o) { const p = sys.free.pop() || sys.list.shift(); Object.assign(p, PD, o); sys.list.push(p); return p; }
const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
// the colours of what a blast throws up, by what it went off on: the dust, the clods, the soot of the first cloud
const SURF = {
  ground: { dust: lin(0xa39580), dirt: lin(0x3b2e22), soot: lin(0x302a24) },
  road: { dust: lin(0xb0aea8), dirt: lin(0x4a4946), soot: lin(0x2c2a28) },
  roof: { dust: lin(0xb0aca6), dirt: lin(0x4a4744), soot: lin(0x2c2a28) },
  air: { dust: lin(0xa8a5a0), dirt: lin(0x3a3835), soot: lin(0x2a2826) }
};
const WIND = [0.9, 0.35];   // m/s: the smoke drifts east-south-east
// a random direction; from a burst on a surface none goes into it: up is the least it rises (0 — along the surface)
function dir(air, up) {
  let x, y, z, l;
  do { x = rnd(-1, 1); y = rnd(-1, 1); z = rnd(-1, 1); l = x * x + y * y + z * z; } while (l > 1 || l < 0.01);
  if (!air) y = Math.abs(y) * (1 - up) + up * Math.sqrt(l);
  l = Math.hypot(x, y, z); return [x / l, y / l, z / l];
}
const glow = { x: 0, y: 0, z: 0, t: 9 }, shake = { a: 0, t: 9, ph: [0, 0, 0, 0, 0, 0] };
function blast(x, y, z) {
  const gr = terrainH(x, z), b = buildingAt(x, z), top = b ? gr + (b.top || 12) : -1e9, onRoof = !!b && y > top - 0.6;
  const floor = onRoof ? top : gr, air = y - floor > 1.3, kind = air ? 'air' : onRoof ? 'roof' : onRoad(x, z, 0.5) ? 'road' : 'ground', S = SURF[kind];
  const cy = air ? y : floor + 0.12;   // the heart of the burst
  // the flash: a white-hot core and a wide glow in the air, gone in a few hundredths of a second
  emit(FIRE, { x, y: cy + 0.4, z, life: 0.08, s0: 3, s1: 5, grow: 1, c0: [6.5, 4.4, 2], c1: [3.5, 1.5, 0.4], fout: 0, frame: 2 });
  emit(FIRE, { x, y: cy + 0.7, z, life: 0.25, s0: 7, s1: 10, c0: [1.8, 0.85, 0.3], c1: [0.8, 0.22, 0.04], op: 0.55, fout: 0, frame: 2 });
  // the fireball: billows of flame thrown out a metre or two and burnt out in a fifth of a second
  for (let i = 0; i < 14; i++) {
    const [dx, dy, dz] = dir(air, 0.2), sp = rnd(6, 14);
    emit(FIRE, { x: x + dx * 0.3, y: cy + 0.35 + dy * 0.3, z: z + dz * 0.3, vx: dx * sp, vy: dy * sp, vz: dz * sp, drag: 8, life: rnd(0.14, 0.3), s0: rnd(0.9, 1.3), s1: rnd(2.2, 3.4), grow: 2.5, roll: rnd(0, 6.28), spin: rnd(-3, 3), c0: [5, 2.6, 0.9], c1: [1.3, 0.28, 0.04], op: 0.95, fout: 0.3, frame: i & 1 });
  }
  // hot fragments: fast streaks out in every direction (from a surface — along it and up)
  for (let i = 0; i < 34; i++) {
    const [dx, dy, dz] = dir(air, 0.03), sp = rnd(28, 70);
    emit(FIRE, { x, y: cy + 0.15, z, vx: dx * sp, vy: dy * sp, vz: dz * sp, drag: 1.2, grav: -9.8, life: rnd(0.07, 0.28), len: rnd(0.7, 1.6), w: rnd(0.035, 0.06), c0: [4, 2.6, 1.1], c1: [2.6, 0.9, 0.2], fout: 0.4, frame: 3 });
  }
  // the cloud: dark smoke and dust shot up and out, glowing from the fire inside for a moment, then rising, drifting and greying
  for (let i = 0; i < 28; i++) {
    const [dx, dy, dz] = dir(air, 0.35), sp = rnd(3, 10);
    emit(SMOKE, { x: x + dx * 0.3, y: cy + 0.25 + dy * 0.3, z: z + dz * 0.3, vx: dx * sp, vy: dy * sp, vz: dz * sp, drag: 2.6, rise: rnd(0.12, 0.45), wind: 1, life: rnd(6, 10), s0: rnd(0.8, 1.2), s1: rnd(3.6, 5.8), grow: 3, roll: rnd(0, 6.28), spin: rnd(-0.5, 0.5), c0: S.soot, c1: S.dust, op: rnd(0.85, 1), fin: 0.03, fout: 0.4, heat: rnd(0.5, 1), heatT: rnd(0.15, 0.35), floor, frame: i % 3 });
  }
  glow.x = x; glow.y = cy + 0.8; glow.z = z; glow.t = 0;
  const d = camera.position.distanceTo(V.set(x, cy, z)), a = clamp(1 - d / 32) ** 1.6;   // the jolt, when the shock reaches the camera
  if (a > 0.01 && a >= shake.a * Math.exp(-Math.max(0, shake.t) * 5)) { shake.a = a; shake.t = -d / 340; for (let i = 0; i < 6; i++) shake.ph[i] = rnd(0, 6.283); }
  if (air) return kind;
  // the skirt: the shock throws dust out along the surface in a ring that slows, rolls and settles
  for (let i = 0, n = 22; i < n; i++) {
    const an = (i + rnd(-0.3, 0.3)) / n * 6.283, ca = Math.cos(an), sa = Math.sin(an), sp = rnd(8, 15);
    emit(SMOKE, { x: x + ca * 0.5, y: floor + 0.4, z: z + sa * 0.5, vx: ca * sp, vy: rnd(0.3, 1.5), vz: sa * sp, drag: 3.2, rise: rnd(0.1, 0.35), wind: 1, life: rnd(3.5, 5.5), s0: 0.8, s1: rnd(3.2, 4.6), grow: 3, roll: rnd(0, 6.28), spin: rnd(-0.6, 0.6), c0: S.dust, c1: S.dust, op: 0.7, fin: 0.03, fout: 0.3, floor, frame: i % 3 });
  }
  // a low haze of dust that hangs on longest
  for (let i = 0; i < 4; i++) {
    const an = rnd(0, 6.283), r = rnd(0.5, 2), ca = Math.cos(an), sa = Math.sin(an);
    emit(SMOKE, { x: x + ca * r, y: floor + 0.8, z: z + sa * r, vx: ca * 1.5, vz: sa * 1.5, drag: 1.5, rise: 0.12, wind: 1, life: rnd(9, 13), s0: 2, s1: rnd(5, 7), roll: rnd(0, 6.28), spin: rnd(-0.15, 0.15), c0: S.dust, c1: S.dust, op: 0.4, fin: 0.4, fout: 0.25, floor, frame: i % 3 });
  }
  // clods flung up (the bigger ones trail dust), falling back and lying a moment
  for (let i = 0; i < 28; i++) {
    const an = rnd(0, 6.283), el = rnd(0.35, 1.45), sp = rnd(5, 12), ce = Math.cos(el), s = rnd(0.06, 0.17);
    emit(SMOKE, { x, y: floor + 0.1, z, vx: Math.cos(an) * ce * sp, vy: Math.sin(el) * sp, vz: Math.sin(an) * ce * sp, grav: -9.8, drag: 0.25, life: rnd(1.4, 2.4), s0: s, s1: s, roll: rnd(0, 6.28), spin: rnd(-12, 12), c0: S.dirt, c1: S.dirt, fout: 0.85, frame: 3, clod: true, roof: onRoof ? top : 0, trail: i < 12 ? 0.06 : 0, dust: S.dust });
  }
  scorch(x, floor, z, onRoof);
  return kind;
}
// the server's blast: the flying copy goes, the blast is drawn; gives what it went off on ('ground', 'road', 'roof' or 'air') for its sound
function boomNade(m) {
  const n = list.get(m.id); if (n) { scene.remove(n.mesh); list.delete(m.id); }
  return blast(m.x, m.y, m.z);
}
/* ---------- the scorch marks ---------- */
const scorches = [], SCORCH_MAX = 10, SCORCH_LIFE = 45;
const scorchGeo = new THREE.PlaneGeometry(1, 1);
const scorchMat = () => worldSpace(new THREE.MeshBasicMaterial({ map: SCORCH_TEX, color: 0x1c1915, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
function scorch(x, y, z, roof) {
  let d = scorches.length >= SCORCH_MAX ? scorches.shift() : null;   // the oldest mark gives its place to the new one
  if (!d) { d = { mesh: new THREE.Mesh(scorchGeo, scorchMat()), t: 0 }; scene.add(d.mesh); }
  let nx = 0, ny = 1, nz = 0;
  if (!roof) { const e = 0.8, hx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e), hz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e), L = Math.hypot(hx, 1, hz); nx = -hx / L; ny = 1 / L; nz = -hz / L; }   // lies along the slope
  d.t = 0; d.mesh.material.opacity = 0.9; d.mesh.position.set(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04);
  d.mesh.lookAt(V.set(x + nx, y + ny, z + nz)); d.mesh.rotateZ(rnd(0, 6.283));
  const s = rnd(3.2, 4.2); d.mesh.scale.set(s, s, 1);
  scorches.push(d);
}
/* ---------- the frame ---------- */
function stepCloud(sys, dt) {
  const L = sys.list;
  for (let i = L.length - 1; i >= 0; i--) {
    const p = L[i]; p.t += dt;
    if (p.t >= p.life) { L.splice(i, 1); sys.free.push(p); continue; }
    if (p.drag) {   // the air takes the particle: towards its climb and the wind (which takes hold as the burst slows)
      const e = Math.exp(-p.drag * dt), wk = p.wind * Math.min(1, p.t / 1.5), tx = WIND[0] * wk, tz = WIND[1] * wk;
      p.vx = tx + (p.vx - tx) * e; p.vy = p.rise + (p.vy - p.rise) * e; p.vz = tz + (p.vz - tz) * e;
    }
    p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.roll += p.spin * dt;
    if (p.clod) {
      if (p.trail && p.t < 0.7 && (p.tt -= dt) <= 0 && sys.free.length) {   // a wisp of dust behind it (only from the spare particles: none is taken away mid-loop)
        p.tt = p.trail;
        emit(sys, { x: p.x, y: p.y, z: p.z, vx: p.vx * 0.1, vy: p.vy * 0.1, vz: p.vz * 0.1, drag: 2, rise: 0.2, wind: 1, life: rnd(0.6, 1.1), s0: 0.12, s1: rnd(0.5, 0.8), roll: rnd(0, 6.28), c0: p.dust, c1: p.dust, op: 0.35, fin: 0.05, fout: 0.2, frame: (Math.random() * 3) | 0 });
      }
      const g = (p.roof && buildingAt(p.x, p.z) ? p.roof : terrainH(p.x, p.z)) + p.s0 * 0.4;
      if (p.y < g && p.vy < 0) {   // down: it lies a moment and is gone
        if (p.vy < -4 && sys.free.length) emit(sys, { x: p.x, y: g, z: p.z, vy: 0.4, drag: 2, rise: 0.15, life: rnd(0.5, 0.8), s0: 0.15, s1: 0.6, roll: rnd(0, 6.28), c0: p.dust, c1: p.dust, op: 0.3, fout: 0.2, frame: (Math.random() * 3) | 0 });
        p.y = g; p.vx = p.vy = p.vz = 0; p.grav = 0; p.spin = 0; p.trail = 0; p.drag = 0; p.life = p.t + 1.2;
      }
    }
  }
}
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), QR = new THREE.Quaternion(), QI = new THREE.Quaternion(), PV = new THREE.Vector3(), PS = new THREE.Vector3(), ZA = new THREE.Vector3(0, 0, 1);
function drawCloud(sys, sort) {
  const L = sys.list, mesh = sys.mesh, n = L.length;
  if (!n && !mesh.count) return;
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  if (sort && n > 1) { for (const p of L) p.d = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2; L.sort((a, b) => b.d - a.d); }   // the far ones first: the near smoke covers them
  const col = mesh.instanceColor.array, ap = sys.aP.array;
  QI.copy(camera.quaternion).invert();
  for (let i = 0; i < n; i++) {
    const p = L[i], k = p.t / p.life;
    let a = p.op * (p.fin ? Math.min(1, p.t / p.fin) : 1);
    if (k > p.fout) { const f = (k - p.fout) / (1 - p.fout); a *= 1 - f * f * (3 - 2 * f); }
    const m = k ** 0.35, c0 = p.c0, c1 = p.c1;
    col[i * 3] = c0[0] + (c1[0] - c0[0]) * m; col[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * m; col[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * m;
    const h = p.heat * Math.max(0, 1 - p.t / p.heatT) ** 2;
    ap[i * 4] = a; ap[i * 4 + 1] = h; ap[i * 4 + 2] = (p.frame & 1) * 0.5; ap[i * 4 + 3] = 0.5 - (p.frame >> 1) * 0.5;
    if (p.len) {   // a streak: along its flight as the camera sees it, its head at the particle
      const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
      PV.set(p.vx, p.vy, p.vz).applyQuaternion(QI);
      const fs = Math.hypot(PV.x, PV.y) / sp, l = p.len * fs + p.w;
      QR.setFromAxisAngle(ZA, Math.atan2(PV.y, PV.x)); Q.copy(camera.quaternion).multiply(QR);
      PS.set(l, p.w, 1); PV.set(p.x - p.vx / sp * l * 0.5, p.y - p.vy / sp * l * 0.5, p.z - p.vz / sp * l * 0.5);
    } else {
      let s = p.s0 + (p.s1 - p.s0) * (1 - (1 - k) ** p.grow), y = p.y;
      if (y < p.floor + s * 0.28) y = p.floor + s * 0.28;   // a puff does not sink into the ground it rolls on
      QR.setFromAxisAngle(ZA, p.roll); Q.copy(camera.quaternion).multiply(QR); PS.set(s, s, s); PV.set(p.x, y, p.z);
    }
    M.compose(PV, Q, PS); mesh.setMatrixAt(i, M);
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; sys.aP.needsUpdate = true;
}
function tickNades(dt) {
  for (const [id, n] of list) {
    for (let t = 0; t < dt; t += 1 / 30) stepNade(n, Math.min(1 / 30, dt - t));
    n.mesh.position.set(n.p[0], n.p[1], n.p[2]); n.mesh.rotation.x += dt * 6; n.age += dt;
    if (n.age > 4) { scene.remove(n.mesh); list.delete(id); }   // the server's blast message got lost
  }
  glow.t += dt; shake.t += dt;
  stepCloud(SMOKE, dt); stepCloud(FIRE, dt); drawCloud(SMOKE, true); drawCloud(FIRE, false);
  for (let i = scorches.length - 1; i >= 0; i--) {
    const d = scorches[i]; d.t += dt;
    if (d.t >= SCORCH_LIFE) { scene.remove(d.mesh); d.mesh.material.dispose(); scorches.splice(i, 1); continue; }
    if (d.t > SCORCH_LIFE - 10) d.mesh.material.opacity = 0.9 * (SCORCH_LIFE - d.t) / 10;
  }
}
// the light of the latest blast for the one light of the flashes (mp.js flashLit): white in the flash, then the flicker of the fireball
function blastGlow(out, col) {
  const t = glow.t; if (t > 0.5) return 0;
  const flash = t < 0.02 ? 1 : Math.exp(-(t - 0.02) / 0.05), fire = (1 - t / 0.5) ** 2 * (0.7 + 0.3 * Math.sin(t * 97) * Math.sin(t * 61 + 1));
  out.set(glow.x, glow.y, glow.z); col.setRGB(1, 0.62 + 0.3 * flash, 0.3 + 0.55 * flash);
  return 150 * flash + 12 * fire;
}
// the jolt of a blast near the camera, put on after the camera is placed for the frame (loop.js); it dies in half a second
function camShake(cam) {
  const t = shake.t; if (t < 0 || t > 1 || reduceMotion) return;
  const e = shake.a * Math.exp(-t * 5) * Math.min(1, t / 0.015), ph = shake.ph;
  cam.position.x += e * 0.06 * Math.sin(t * 80 + ph[0]); cam.position.y += e * 0.09 * Math.sin(t * 95 + ph[1]); cam.position.z += e * 0.06 * Math.sin(t * 70 + ph[2]);
  cam.rotation.x += e * 0.03 * Math.sin(t * 55 + ph[3]); cam.rotation.y += e * 0.018 * Math.sin(t * 62 + ph[4]); cam.rotation.z += e * 0.035 * Math.sin(t * 48 + ph[5]);
}
function clearNades() { for (const n of list.values()) scene.remove(n.mesh); list.clear(); }
// a new game: no smoke, fire or scorch of the last one
function clearBlasts() {
  for (const s of [SMOKE, FIRE]) { s.free.push(...s.list); s.list.length = 0; s.mesh.count = 0; }
  for (const d of scorches) { scene.remove(d.mesh); d.mesh.material.dispose(); } scorches.length = 0;
  glow.t = shake.t = 9;
}

/* ---------- the arc of the aimed throw ----------
   The same flight the server will fly (stepNade above is the server's physics.mjs), stepped ahead from the hand to the
   first touch of ground, roof or wall — or to the fuse, if it bursts in the air. A dashed line shows the arc, a ring
   marks the spot. Shown while the grenade is in hand (G), grown by the charge of the left mouse button. */
function predictNade(p, v, maxT = 2.5) {
  const n = { p: p.slice(), v: v.slice() }, pts = [n.p.slice()], dt = 1 / 30;
  let hit = null;
  for (let t = 0; t < maxT; t += dt) {
    const v0 = n.v.slice();
    stepNade(n, dt);
    pts.push(n.p.slice());
    // a bounce changes the velocity beyond gravity alone: the arc ends at the first touch
    if (Math.abs(n.v[0] - v0[0]) > 1e-9 || Math.abs(n.v[2] - v0[2]) > 1e-9 || n.v[1] > v0[1] - NADE.g * dt + 1e-9) { hit = n.p.slice(); break; }
  }
  return { pts, hit: hit || pts[pts.length - 1] };
}
const PRE_N = 96;
const preGeo = new THREE.BufferGeometry();
preGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRE_N * 3), 3));
const preLine = new THREE.Line(preGeo, worldSpace(new THREE.LineDashedMaterial({ color: 0xffc24d, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: 1 })));
preLine.visible = false; preLine.frustumCulled = false; scene.add(preLine);
const preRing = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 24), worldSpace(new THREE.MeshBasicMaterial({ color: 0xffc24d, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })));
preRing.rotation.x = -Math.PI / 2; preRing.visible = false; preRing.frustumCulled = false; scene.add(preRing);
function showNadePreview(p, v) {
  const { pts, hit } = predictNade(p, v), attr = preGeo.attributes.position, n = Math.min(PRE_N, pts.length);
  for (let i = 0; i < n; i++) attr.setXYZ(i, pts[i][0], pts[i][1], pts[i][2]);
  attr.needsUpdate = true; preGeo.setDrawRange(0, n); preLine.computeLineDistances(); preLine.visible = true;
  preRing.position.set(hit[0], hit[1] + 0.06, hit[2]); preRing.visible = true;
}
function hideNadePreview() { preLine.visible = false; preRing.visible = false; }

// a flying grenade (the ready model, or the ball while it has not come), the smoke and the fire of a blast and a scorch, out of
// the scene, for the warm-up (mp.js loadModels): their programs compiled and their drawings sent to the GPU before the first blast
function nadeSamples() {
  const cloudSample = sys => { const m = new THREE.InstancedMesh(sys.mesh.geometry, sys.mesh.material, 1); m.setColorAt(0, new THREE.Color(1, 1, 1)); return m; };
  return [flyNade() || new THREE.Mesh(GEO, MAT), cloudSample(SMOKE), cloudSample(FIRE), new THREE.Mesh(scorchGeo, scorchMat())];
}

export { nadeSamples, addNade, boomNade, blastGlow, camShake, clearBlasts, clearNades, tickNades, NADE_THROW, showNadePreview, hideNadePreview };
