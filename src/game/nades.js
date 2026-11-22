import * as THREE from 'three';
import { buildingAt, onRoad } from '../world/data.js';
import { terrainH, walkLift } from '../world/terrain.js';
import { STATE } from '../core/state.js';
import { camera, scene } from '../render/renderer.js';
import { mirrorHide } from '../render/mirror.js';
import { worldSpace } from '../render/world-space.js';
import { reduceMotion } from '../core/env.js';
import { fbm } from './muzzle.js';
import { prop, onProps } from './props.js';
import { makePhysics } from '../../server/physics.mjs';

/* ---------- grenades ----------
   The server flies every grenade and says where and when it goes off (server/game.mjs, damage and all). Each page
   also flies its own copy of it, with the same rules (keep NADE and the step in step with server/combat.mjs and
   server/physics.mjs), so that it moves smoothly; at the blast the copy is put where the server's grenade was. */
const NADE = { g: 18 };
// the three grenades (keep server/combat.mjs NADE/SMOKE/NAPALM in step): the frag blasts, the smoke lays a screen,
// the napalm a burning patch — the fuse and the reach of each, for the aim arc and its disc
const KIND = { nade: { fuse: 2.5, r: 8 }, smoke: { fuse: 2, r: 6 }, napalm: { fuse: 2, r: 4 } };
// the charged throw (keep server/combat.mjs NADE in step): the left mouse button held down gathers the speed from min
// to max over chargeMs; loft lifts the velocity a little above the aim, exactly as the server does
const NADE_THROW = { min: 6, max: 24, loft: 0.17, chargeMs: 1100 };
const list = new Map();
const GEO = new THREE.SphereGeometry(0.1, 10, 8), MAT = worldSpace(new THREE.MeshLambertMaterial({ color: 0x3d5a2a }));
const MATS = { smoke: worldSpace(new THREE.MeshLambertMaterial({ color: 0x6a7a5a })), napalm: worldSpace(new THREE.MeshLambertMaterial({ color: 0x8a2a22 })) };   // the stand-ins until the models come
// the flight is the server's own step (server/physics.mjs), so the copy, the aim arc and the server never drift apart;
// it also reports each touch (n.bounce) for the clink, and rolls a settled grenade downhill on a slope
// the ground the copy flies over: in the network game the server owns the flight over the raw lidar grid, so the copy
// matches it (terrainH); in the training game the city is the walk's own (walkLift: sidewalks, platforms, ramparts, decks),
// so the copy, the aim arc and the local server stand on the same ground the body does.
const gnd = (x, z) => STATE.mp ? terrainH(x, z) : walkLift(x, z, null);
const gnd3 = (x, z, y = null) => STATE.mp ? terrainH(x, z) : walkLift(x, z, y == null ? null : y - 1.7);
const stepNade = (() => { const s = makePhysics(buildingAt, gnd3).stepNade; return (n, dt) => s(n, dt, NADE.g, bodiesFn ? bodiesFn(n) : undefined); })();
let bounceCb = null;
const onNadeBounce = cb => { bounceCb = cb; };   // mp.js plays the clink of a touch it can hear
let bodiesFn = null;
const setNadeBodies = fn => { bodiesFn = fn; };   // mp.js gives the living bodies the grenade bounces off (the thrower is left out, as on the server)
// the server's bounce off a body ('nbounce'): put the copy back onto the server's flight, the trail starts afresh
function syncNade(id, p, v) { const n = list.get(id); if (!n) return; n.p = p.slice(); n.v = v.slice(); n.hist.length = 0; }
const liveNades = () => [...list.values()].map(n => ({ p: n.p, age: n.age, by: n.by, kind: n.kind }));   // for the danger indicator
/* модель гранаты посажена дном в ноль (так она стоит на карте); в полёте центруем её вокруг точки сервера. На карте она
   вдвое крупнее настоящей, чтобы её было видно; в полёте — почти настоящего размера, как в руке (viewmodel.js) */
const FLY_S = 0.55, FLY_LOW = 0.06;   // the scale in flight; how far the drawn middle sits under the server's point (it keeps 12 cm over the ground)
function flyNade(kind = 'nade') {
  const m = prop(kind); if (!m) return null;
  const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());   // the model stands bottom at 0: centre it on the server's point
  for (const ch of m.children) ch.position.y -= c.y;
  m.scale.setScalar(FLY_S);
  return m;
}
// the shaders of the aim and of the streaks: no lights, no fog, colours brighter than white where the bloom of the page should take them
const aimMat = (vert, frag, uniforms, o = {}) => {
  const m = new THREE.ShaderMaterial(Object.assign({ uniforms, vertexShader: vert, fragmentShader: frag + '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}', transparent: true, depthWrite: false }, o));
  return worldSpace(m);
};
/* ---------- the grenade in flight ----------
   It tumbles end over end along its throw (and rolls along the ground once it runs out of bounce), draws a faint
   streak of disturbed air behind it while it flies fast, and at the throw its spoon springs off and clatters down
   beside the thrower, as the lever of a real fuse does. The streaks and the spoons are small pools made once. */
const TR_N = 24, TR_MAX = 8, TR_LEN = 2.6;
const trailMat = aimMat('attribute vec3 aT; varying vec3 vT;\nvoid main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  `varying vec3 vT;
void main() {
  float a = (1.0 - vT.x * vT.x) * pow(1.0 - vT.y, 1.7) * vT.z * 0.42;
  gl_FragColor = vec4(0.95, 0.93, 0.88, a);`, {}, { side: THREE.DoubleSide });
const trails = Array.from({ length: TR_MAX }, () => {
  const geo = new THREE.BufferGeometry(), ix = [];
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TR_N * 6), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(TR_N * 6), 3).setUsage(THREE.DynamicDrawUsage));
  for (let i = 0; i < TR_N - 1; i++) { const a = i * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } geo.setIndex(ix);
  const mesh = new THREE.Mesh(geo, trailMat); mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 1; mesh.userData.noProbe = true; scene.add(mesh);
  return { mesh, geo, used: false };
});
function freeTrail(t) { if (t) { t.used = false; t.mesh.visible = false; } }
// the streak of a grenade: its last positions, turned to the camera, thinning and fading to the tail
function drawTrail(n, dt) {
  const t = n.trail; if (!t) return;
  const h = n.hist, p = n.p;
  if (!h.length || Math.hypot(p[0] - h[0][0], p[1] - h[0][1], p[2] - h[0][2]) > 0.08) { h.unshift(p.slice()); if (h.length > TR_N) h.pop(); } else h[0] = p.slice();
  n.ta += ((Math.hypot(n.v[0], n.v[1], n.v[2]) > 5 ? 1 : 0) - n.ta) * Math.min(1, dt * (n.ta > 0.5 ? 5 : 12));
  if (n.ta < 0.01 || h.length < 2) { t.mesh.visible = false; return; }
  const cam = camera.position, P = t.geo.attributes.position.array, A = t.geo.attributes.aT.array;
  let s = 0, m = 0;
  for (let i = 0; i < h.length; i++) {
    const q = h[i], a = h[Math.max(0, i - 1)], b = h[Math.min(h.length - 1, i + 1)];
    if (i) s += Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]);
    const k = Math.min(1, s / TR_LEN);
    const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2], vx = cam.x - q[0], vy = cam.y - q[1], vz = cam.z - q[2];
    const sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx, sl = Math.hypot(sx, sy, sz) || 1;
    const hw = (0.022 + 0.0016 * Math.hypot(vx, vy, vz)) * (1 - 0.6 * k) / sl, o = i * 6;
    P[o] = q[0] + sx * hw; P[o + 1] = q[1] + sy * hw; P[o + 2] = q[2] + sz * hw; P[o + 3] = q[0] - sx * hw; P[o + 4] = q[1] - sy * hw; P[o + 5] = q[2] - sz * hw;
    A[o] = -1; A[o + 3] = 1; A[o + 1] = A[o + 4] = k; A[o + 2] = A[o + 5] = n.ta * Math.min(1, (n.age - 0.04) * 8);
    m = i + 1; if (k >= 1) break;
  }
  t.geo.attributes.position.needsUpdate = true; t.geo.attributes.aT.needsUpdate = true; t.geo.setDrawRange(0, (m - 1) * 6); t.mesh.visible = true;
}
// the spoon: a strip of olive steel bent over at its head
const SPOON_MAX = 6, spoonMat = worldSpace(new THREE.MeshLambertMaterial({ color: 0x6f7358 }));
const spoonLong = new THREE.BoxGeometry(0.016, 0.075, 0.0022).translate(0, -0.0375, 0), spoonHead = new THREE.BoxGeometry(0.016, 0.024, 0.0022).translate(0, 0.012, 0);
const spoons = Array.from({ length: SPOON_MAX }, () => {
  const g = new THREE.Group(), a = new THREE.Mesh(spoonLong, spoonMat), b = new THREE.Mesh(spoonHead, spoonMat);
  b.rotation.x = 1.25; g.add(a, b); g.visible = false; g.userData.noProbe = true; scene.add(g);
  return { g, on: false, p: [0, 0, 0], v: [0, 0, 0], ax: new THREE.Vector3(), w: 0, t: 0, rest: false };
});
function popSpoon(p, v) {
  const s = spoons.find(x => !x.on) || spoons.reduce((a, b) => (a.t > b.t ? a : b));
  const h = Math.hypot(v[0], v[2]) || 1, dx = v[0] / h, dz = v[2] / h, side = rnd(0.9, 2.1);
  s.on = true; s.rest = false; s.t = 0; s.p = p.slice();
  s.v = [v[0] * 0.18 - dz * side - dx * 0.4, rnd(2.4, 3.6), v[2] * 0.18 + dx * side - dz * 0.4];   // up and off to the right of the throw
  s.ax.set(rnd(-1, 1), rnd(-0.4, 0.4), rnd(-1, 1)).normalize(); s.w = rnd(22, 34);
  s.g.position.set(p[0], p[1], p[2]); s.g.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); s.g.visible = true;
}
const QT = new THREE.Quaternion(), TA = new THREE.Vector3();
function tickSpoons(dt) {
  for (const s of spoons) {
    if (!s.on) continue;
    s.t += dt; if (s.t > 4) { s.on = false; s.g.visible = false; continue; }
    if (s.rest) continue;
    s.v[1] -= 9.8 * dt; const e = Math.exp(-dt * 0.6); s.v[0] *= e; s.v[2] *= e;
    s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt; s.p[2] += s.v[2] * dt;
    const b = buildingAt(s.p[0], s.p[2], s.p[1]), gr = gnd(s.p[0], s.p[2]), top = b ? gr + (b.top || 12) : gr, floor = (b && s.p[1] > top - 0.5 ? top : gr) + 0.006;
    if (s.p[1] < floor && s.v[1] < 0) {   // a clink on the ground: it hops once or twice and lies flat
      s.p[1] = floor; s.v[1] *= -0.32; s.v[0] *= 0.45; s.v[2] *= 0.45; s.w *= 0.4;
      if (Math.abs(s.v[1]) < 0.6) { s.rest = true; s.g.rotation.set(-Math.PI / 2 + rnd(-0.15, 0.15), rnd(0, 6.28), 0, 'YXZ'); s.g.position.set(s.p[0], floor, s.p[2]); continue; }
    }
    s.g.position.set(s.p[0], s.p[1], s.p[2]); s.g.quaternion.premultiply(QT.setFromAxisAngle(s.ax, s.w * dt));
  }
}
// from: where the grenade in hand was drawn when it left it (your own throw): the flying copy starts there and slides onto
// the server's flight within a tenth of a second
function addNade(m, from = null) {
  const kind = m.kind || 'nade', model = flyNade(kind);
  const mesh = model || new THREE.Mesh(GEO, MATS[kind] || MAT); if (!model) mesh.scale.setScalar(FLY_S); mesh.position.set(m.p[0], m.p[1], m.p[2]);
  mesh.quaternion.setFromAxisAngle(V.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), rnd(0, 6.283)); mesh.userData.noProbe = true; scene.add(mesh);
  const trail = trails.find(t => !t.used) || null; if (trail) trail.used = true;
  list.set(m.id, { mesh, model: !!model, kind, p: m.p.slice(), v: m.v.slice(), age: 0, w: rnd(10, 15), trail, hist: [], ta: 0, fz: 0, by: m.by, off: from ? [from.x - m.p[0], from.y - m.p[1], from.z - m.p[2]] : null });
  popSpoon(from ? [from.x, from.y, from.z] : m.p, m.v);
}
onProps(() => {
  for (const n of list.values()) if (!n.model) {
    const m = flyNade(n.kind); if (!m) continue;
    m.position.copy(n.mesh.position); m.quaternion.copy(n.mesh.quaternion);
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
  mesh.userData.noProbe = true; scene.add(mesh);
  return { mesh, aP, list: [], free: Array.from({ length: max }, () => ({})) };
}
const smokeMat = particleMat(new THREE.MeshLambertMaterial({ map: SMOKE_TEX, transparent: true, depthWrite: false }), 'nade-smoke');
const fireMat = particleMat(new THREE.MeshBasicMaterial({ map: FIRE_TEX, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 'nade-fire');
const SMOKE = cloud(bentQuad(), smokeMat, 900, 1), FIRE = cloud(new THREE.PlaneGeometry(1, 1), fireMat, 320, 2);
// the napalm's carpet of flame: ordinary blending, not additive — added light washes out on a sunlit street, while
// solid flame quads read by day as well as by night; the additive FIRE on top of them gives the bloom its glow
const flameMat = particleMat(new THREE.MeshBasicMaterial({ map: FIRE_TEX, transparent: true, depthWrite: false, fog: false }), 'nade-flame');
const FLAME = cloud(new THREE.PlaneGeometry(1, 1), flameMat, 320, 2);
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
  const gr = gnd(x, z), b = buildingAt(x, z, y), top = b ? gr + (b.top || 12) : -1e9, onRoof = !!b && y > top - 0.6;
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
  const n = list.get(m.id); if (n) { scene.remove(n.mesh); freeTrail(n.trail); list.delete(m.id); }
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
  if (!roof) { const e = 0.8, hx = (gnd(x + e, z) - gnd(x - e, z)) / (2 * e), hz = (gnd(x, z + e) - gnd(x, z - e)) / (2 * e), L = Math.hypot(hx, 1, hz); nx = -hx / L; ny = 1 / L; nz = -hz / L; }   // lies along the slope
  d.t = 0; d.mesh.material.opacity = 0.9; d.mesh.position.set(x + nx * 0.04, y + ny * 0.04, z + nz * 0.04);
  d.mesh.lookAt(V.set(x + nx, y + ny, z + nz)); d.mesh.rotateZ(rnd(0, 6.283));
  const s = rnd(3.2, 4.2); d.mesh.scale.set(s, s, 1);
  scorches.push(d);
}
/* ---------- the zones: the smoke screen and the burning patch ----------
   The server lays them where the special grenade went off ('zone', server/game.mjs) and says when they are out
   ('zoneEnd'); the page breathes them out of the same two particle clouds the blast uses. The smoke is a white-grey
   screen that swells to its radius and hangs for the zone's life; the napalm is a carpet of flame with dark smoke
   above and sparks jumping out, lit by one flickering light that follows the nearest patch. A late joiner gets the
   live zones with their remaining time in 'hello'. */
const zones = new Map();
const fireLight = new THREE.PointLight(0xff7a2a, 0, 24, 1.8); fireLight.userData.noProbe = true; scene.add(fireLight);
function addZone(m) {
  const n = list.get(m.id); if (n) { scene.remove(n.mesh); freeTrail(n.trail); list.delete(m.id); }   // the flying copy goes into its zone
  const dur = (m.durMs != null ? m.durMs : m.left != null ? m.left : 8000) / 1000;
  const z = { kind: m.kind, x: m.x, y: m.y, z: m.z, r: m.r || 4, t: 0, dur, acc: 0, acc2: 0, acc3: 0 };
  zones.set(m.id, z);
  if (m.kind === 'fire') {
    emit(FIRE, { x: m.x, y: m.y + 0.4, z: m.z, life: 0.12, s0: 2.5, s1: 4, grow: 1, c0: [5, 3, 1.2], c1: [2.5, 1, 0.3], fout: 0, frame: 2 });   // the pop of ignition
    for (let i = 0; i < 16; i++) { const a = rnd(0, 6.283), r = rnd(0.2, z.r * 0.8); emit(FIRE, { x: m.x + Math.cos(a) * r, y: m.y + 0.15, z: m.z + Math.sin(a) * r, vy: rnd(1, 3), life: rnd(0.3, 0.6), s0: rnd(0.5, 0.9), s1: rnd(1.4, 2.2), grow: 2, c0: [4.5, 2.2, 0.7], c1: [1.6, 0.4, 0.06], op: 0.9, fout: 0.3, frame: i & 1 }); }
    scorch(m.x, m.y, m.z, false);
    glow.x = m.x; glow.y = m.y + 0.6; glow.z = m.z; glow.t = 0;   // the ignition lights the street for a moment (blastGlow)
  } else {
    for (let i = 0; i < 26; i++) { const a = rnd(0, 6.283), r = rnd(0, z.r * 0.5); emit(SMOKE, { x: m.x + Math.cos(a) * r, y: m.y + rnd(0.1, 0.8), z: m.z + Math.sin(a) * r, vx: Math.cos(a) * rnd(0.5, 2), vy: rnd(0.3, 1), vz: Math.sin(a) * rnd(0.5, 2), drag: 1.6, rise: rnd(0.3, 0.7), wind: 0.6, life: rnd(3.5, 6), s0: rnd(0.8, 1.3), s1: rnd(3.5, 5.5), grow: 2.5, roll: rnd(0, 6.28), spin: rnd(-0.4, 0.4), c0: [0.86, 0.86, 0.84], c1: [0.72, 0.72, 0.7], op: rnd(0.8, 0.95), fin: 0.15, fout: 0.35, floor: m.y, frame: i % 3 }); }
  }
}
const endZone = id => { zones.delete(id); };
function tickZones(dt) {
  let lit = null, ld = 1e9;
  for (const [id, z] of zones) {
    z.t += dt;
    if (z.t >= z.dur) { zones.delete(id); continue; }
    const fade = Math.min(1, z.t * 3) * Math.min(1, (z.dur - z.t) / 1.5 + 0.15);   // breathes in, dies out
    if (z.kind === 'smoke') {
      z.acc += (z.t < 1.5 ? 55 : 16) * fade * dt;
      while (z.acc >= 1) {
        z.acc--; const a = rnd(0, 6.283), r = rnd(0, z.r * 0.4);
        emit(SMOKE, { x: z.x + Math.cos(a) * r, y: z.y + rnd(0.05, 0.5), z: z.z + Math.sin(a) * r, vx: Math.cos(a) * rnd(0.2, 1.2), vy: rnd(0.2, 0.8), vz: Math.sin(a) * rnd(0.2, 1.2), drag: 1.6, rise: rnd(0.35, 0.8), wind: 0.6, life: rnd(3.5, 6), s0: rnd(0.7, 1.1), s1: rnd(3.5, 5.5), grow: 2.5, roll: rnd(0, 6.28), spin: rnd(-0.4, 0.4), c0: [0.86, 0.86, 0.84], c1: [0.72, 0.72, 0.7], op: rnd(0.8, 0.95), fin: 0.15, fout: 0.35, floor: z.y, frame: (Math.random() * 3) | 0 });
      }
    } else {
      z.acc += 100 * fade * dt;
      while (z.acc >= 1) {
        z.acc--; const a = rnd(0, 6.283), r = Math.sqrt(Math.random()) * z.r * 0.9;
        const x = z.x + Math.cos(a) * r, zz = z.z + Math.sin(a) * r;
        emit(FLAME, { x, y: z.y + 0.08, z: zz, vx: rnd(-0.3, 0.3), vy: rnd(1.2, 2.8), vz: rnd(-0.3, 0.3), drag: 1.2, life: rnd(0.35, 0.8), s0: rnd(0.5, 0.8), s1: rnd(1.4, 2.3), grow: 2, roll: rnd(0, 6.28), spin: rnd(-2, 2), c0: [1, 0.45, 0.12], c1: [0.8, 0.18, 0.02], op: 0.95, fout: 0.25, floor: z.y, frame: (Math.random() * 2) | 0 });
        if (Math.random() < 0.3) emit(FIRE, { x, y: z.y + 0.3, z: zz, vy: rnd(1, 2), life: rnd(0.2, 0.4), s0: rnd(0.5, 0.9), s1: rnd(1, 1.6), grow: 2, c0: [2.5, 1.2, 0.4], c1: [1.2, 0.4, 0.1], op: 0.5, fout: 0.3, frame: 2 });   // the glow the bloom takes
      }
      z.acc2 += 10 * fade * dt;
      while (z.acc2 >= 1) {
        z.acc2--; const a = rnd(0, 6.283), r = rnd(0, z.r * 0.7);
        emit(SMOKE, { x: z.x + Math.cos(a) * r, y: z.y + rnd(0.8, 1.6), z: z.z + Math.sin(a) * r, vx: rnd(-0.3, 0.3), vy: rnd(1, 2), vz: rnd(-0.3, 0.3), drag: 1.2, rise: rnd(0.8, 1.6), wind: 0.8, life: rnd(2.5, 4.5), s0: rnd(0.7, 1), s1: rnd(2.5, 4), grow: 2.5, roll: rnd(0, 6.28), spin: rnd(-0.5, 0.5), c0: [0.16, 0.14, 0.12], c1: [0.35, 0.33, 0.3], op: 0.5, fin: 0.1, fout: 0.3, floor: z.y, frame: (Math.random() * 3) | 0 });
      }
      z.acc3 += 6 * fade * dt;
      while (z.acc3 >= 1) {
        z.acc3--; const a = rnd(0, 6.283), r = rnd(0, z.r * 0.8);
        emit(FIRE, { x: z.x + Math.cos(a) * r, y: z.y + 0.2, z: z.z + Math.sin(a) * r, vx: rnd(-1.5, 1.5), vy: rnd(2, 5), vz: rnd(-1.5, 1.5), grav: -9.8, life: rnd(0.2, 0.5), s0: 0.04, s1: 0.07, c0: [4, 2.6, 1], c1: [2, 0.8, 0.2], fout: 0.3, frame: 2 });
      }
      const d = camera.position.distanceTo(V.set(z.x, z.y + 1, z.z));
      if (d < ld) { ld = d; lit = z; }
    }
  }
  if (lit) { fireLight.position.set(lit.x, lit.y + 1.1, lit.z); fireLight.intensity = (26 + 10 * Math.sin(clock * 31) * Math.sin(clock * 17 + 1)) * Math.min(1, lit.t * 3) * Math.min(1, (lit.dur - lit.t) / 1.5 + 0.2); }
  else fireLight.intensity = 0;
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
      const g = (p.roof && buildingAt(p.x, p.z, p.y) ? p.roof : gnd(p.x, p.z)) + p.s0 * 0.4;
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
  clock += dt; AIM_U.uT.value = clock;
  for (const [id, n] of list) {
    for (let t = 0; t < dt; t += 1 / 30) stepNade(n, Math.min(1 / 30, dt - t));
    n.age += dt;
    const k = n.off ? Math.max(0, 1 - n.age / 0.12) ** 2 : 0, rest = n.v[1] === 0 ? FLY_LOW : FLY_LOW * Math.min(1, n.age * 4);
    n.mesh.position.set(n.p[0] + (k ? n.off[0] * k : 0), n.p[1] - rest + (k ? n.off[1] * k : 0), n.p[2] + (k ? n.off[2] * k : 0));
    // end over end about the level axis across its way; on the ground it rolls as far as it goes
    const vh = Math.hypot(n.v[0], n.v[2]);
    if (vh > 0.03) {
      const w = n.v[1] === 0 ? vh / 0.07 : n.w; n.w *= Math.exp(-dt * 0.5);
      n.mesh.quaternion.premultiply(QT.setFromAxisAngle(TA.set(n.v[2] / vh, 0, -n.v[0] / vh), w * dt));
    }
    drawTrail(n, dt);
    if (n.bounce && bounceCb) bounceCb(n.p, n.bounce);
    if (n.age < 2.5 && (n.fz -= dt) <= 0) {   // the fuse: a wisp of smoke and now and then a spark, so it reads at night too
      n.fz = 0.07;
      emit(SMOKE, { x: n.p[0], y: n.p[1] + 0.05, z: n.p[2], vx: rnd(-0.2, 0.2), vy: rnd(0.3, 0.7), vz: rnd(-0.2, 0.2), drag: 2, rise: 0.4, wind: 1, life: rnd(0.4, 0.7), s0: 0.05, s1: rnd(0.18, 0.3), roll: rnd(0, 6.28), c0: [0.8, 0.8, 0.78], c1: [0.7, 0.7, 0.68], op: 0.3, fin: 0.05, fout: 0.3, frame: (Math.random() * 3) | 0 });
      if (Math.random() < 0.3) emit(FIRE, { x: n.p[0], y: n.p[1] + 0.05, z: n.p[2], vx: rnd(-1, 1), vy: rnd(0.5, 2), vz: rnd(-1, 1), grav: -9.8, life: rnd(0.05, 0.12), s0: 0.03, s1: 0.05, c0: [4, 2.6, 1], c1: [2, 0.8, 0.2], fout: 0.2, frame: 2 });
    }
    if (n.age > 4) { scene.remove(n.mesh); freeTrail(n.trail); list.delete(id); }   // the server's blast message got lost
  }
  tickSpoons(dt);
  tickZones(dt);
  glow.t += dt; shake.t += dt;
  stepCloud(SMOKE, dt); stepCloud(FIRE, dt); stepCloud(FLAME, dt); drawCloud(SMOKE, true); drawCloud(FIRE, false); drawCloud(FLAME, false);
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
function clearNades() { for (const n of list.values()) { scene.remove(n.mesh); freeTrail(n.trail); } list.clear(); for (const s of spoons) { s.on = false; s.g.visible = false; } }
// a new game: no smoke, fire or scorch of the last one
function clearBlasts() {
  for (const s of [SMOKE, FIRE, FLAME]) { s.free.push(...s.list); s.list.length = 0; s.mesh.count = 0; }
  for (const d of scorches) { scene.remove(d.mesh); d.mesh.material.dispose(); } scorches.length = 0;
  zones.clear(); fireLight.intensity = 0;
  glow.t = shake.t = 9;
}

/* ---------- the arc of the aimed throw ----------
   The same flight the server will fly (stepNade above is the server's physics.mjs), stepped ahead from the hand for
   the whole fuse. Up to the first touch of ground, roof or wall the arc is a ribbon of light with pulses running along
   it to the target; after the touch the bounces and the roll are a fainter dotted trail. Where it goes off a disc lies
   on the ground, the roofs and the slopes: the reach of the blast in a dashed red rim that turns slowly, a sonar wave
   running out to it, the aim point in the middle and a soft beam of light standing over it, so the spot reads from far
   away. Where a wall hides the arc it shows through as a faint ghost. The ribbon widens with the distance, so it stays
   a few pixels wide on the screen. Shown while the grenade is in hand (G), grown and warmed by the charge of the left
   mouse button. Every part is made once; aiming only rewrites the numbers of two small meshes. */
const FUSE = 2.5;   // keep server/combat.mjs NADE.fuseMs in step; the reach of each kind is in KIND above
let clock = 0;   // seconds, for the running pulses
function predictNade(p, v, maxT = FUSE) {
  const n = { p: p.slice(), v: v.slice(), preview: true }, pts = [n.p.slice()], dt = 1 / 30;   // preview: the aim arc bends round the bodies too, but not round your own
  let first = -1, wall = false;
  for (let t = 0; t < maxT - 1e-6; t += dt) {
    const vx = n.v[0], vy = n.v[1], vz = n.v[2];
    stepNade(n, dt);
    pts.push(n.p.slice());
    // a bounce changes the velocity beyond gravity alone; a wall turns the way along the ground back
    if (first < 0 && (Math.abs(n.v[0] - vx) > 1e-9 || Math.abs(n.v[2] - vz) > 1e-9 || n.v[1] > vy - NADE.g * dt + 1e-9)) { first = pts.length - 1; wall = vx * n.v[0] < 0 || vz * n.v[2] < 0; }
    if (first >= 0 && n.v[1] === 0 && Math.abs(n.v[0]) + Math.abs(n.v[2]) < 0.02) break;   // lies still: the rest of the fuse adds nothing
  }
  return { pts, first, wall, end: n.p };
}
const surfAt = (x, z, roof) => { const g = gnd(x, z); if (roof) { const b = buildingAt(x, z); if (b) return g + (b.top || 12); } return g; };
const AIM_U = { uT: { value: 0 }, uCol: { value: new THREE.Color(1, 0.74, 0.34) }, uRim: { value: new THREE.Color(1, 0.24, 0.12) } };
const DISC_U = { value: 8 };   // the reach of the disc: the blast, the screen or the patch (KIND)
// the ribbon: aArc = (across −1…1, metres along the arc, 0 before the first touch / 1 after)
const ARC_MAX = 96;
const arcGeo = new THREE.BufferGeometry();
arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_MAX * 6), 3).setUsage(THREE.DynamicDrawUsage));
arcGeo.setAttribute('aArc', new THREE.BufferAttribute(new Float32Array(ARC_MAX * 6), 3).setUsage(THREE.DynamicDrawUsage));
{ const ix = []; for (let i = 0; i < ARC_MAX - 1; i++) { const a = i * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } arcGeo.setIndex(ix); }
const ARC_V = 'attribute vec3 aArc; varying vec3 vA;\nvoid main() { vA = aArc; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const ARC_F = `uniform float uT, uGhost; uniform vec3 uCol; varying vec3 vA;
void main() {
  float u = abs(vA.x), s = vA.y;
  float core = 1.0 - smoothstep(0.3, 0.58, u), rim = 1.0 - smoothstep(0.6, 1.0, u);   // a bright core in a dark rim: it reads on a pale street too
  float lead = smoothstep(0.04, 0.7, s);   // fades in out of the hand
  float ph = fract(s * 0.9 - uT * 1.9);
  float pulse = smoothstep(0.0, 0.07, ph) * (1.0 - smoothstep(0.22, 0.42, ph));   // the pulses running to the target
  float dots = 1.0 - smoothstep(0.16, 0.3, abs(fract(s * 2.2) - 0.5));          // after the first touch: dots
  vec3 dark = vec3(0.07, 0.04, 0.015), col; float a;
  if (vA.z < 0.5) { col = mix(dark, mix(uCol * 1.35, vec3(2.4, 2.05, 1.6), pulse), core); a = max(core * (0.8 + 0.2 * pulse), rim * 0.42); }
  else { col = mix(dark, uCol * 1.15, core); a = max(core * 0.75, rim * 0.34) * dots; }
  if (uGhost > 0.5) { col = uCol; a = core * 0.24 * (vA.z < 0.5 ? 1.0 : dots); }
  a *= lead;
  gl_FragColor = vec4(col, a);`;
const arcLine = new THREE.Mesh(arcGeo, aimMat(ARC_V, ARC_F, { ...AIM_U, uGhost: { value: 0 } }, { side: THREE.DoubleSide }));
const arcGhost = new THREE.Mesh(arcGeo, aimMat(ARC_V, ARC_F, { ...AIM_U, uGhost: { value: 1 } }, { side: THREE.DoubleSide, depthFunc: THREE.GreaterDepth }));
arcLine.renderOrder = 4; arcGhost.renderOrder = 3;
// the disc of the blast, draped over what it lies on: rings of vertices, the shading drawn from the metres to the centre (aL)
const DISC_R = [0, 0.35, 0.8, 1.4, 2.2, 3.1, 4, 5, 6, 6.9, 7.6, 8, 8.5], DISC_S = 48, DISC_N = 1 + (DISC_R.length - 1) * DISC_S;
const discGeo = new THREE.BufferGeometry();
discGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DISC_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
{
  const L = new Float32Array(DISC_N * 2), ix = [];
  for (let r = 1; r < DISC_R.length; r++) for (let k = 0; k < DISC_S; k++) {
    const i = 1 + (r - 1) * DISC_S + k, an = k / DISC_S * Math.PI * 2; L[i * 2] = Math.cos(an) * DISC_R[r]; L[i * 2 + 1] = Math.sin(an) * DISC_R[r];
    const k1 = (k + 1) % DISC_S, a = 1 + (r - 1) * DISC_S;
    if (r === 1) ix.push(0, a + k1, a + k); else { const b = a - DISC_S; ix.push(b + k, b + k1, a + k, b + k1, a + k1, a + k); }
  }
  discGeo.setAttribute('aL', new THREE.BufferAttribute(L, 2)); discGeo.setIndex(ix);
}
const DISC_V = 'attribute vec2 aL; varying vec2 vL;\nvoid main() { vL = aL; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const DISC_F = `uniform float uT, uR; uniform vec3 uCol, uRim; varying vec2 vL;
void main() {
  float r = length(vL), fw = fwidth(r), k = r / uR;
  float inside = 1.0 - smoothstep(uR - fw, uR + fw, r);
  float fill = inside * (0.035 + 0.12 * k * k * k);
  float seg = fract(atan(vL.y, vL.x) * (36.0 / 6.2831853) - uT * 0.3);
  float dash = smoothstep(0.0, 0.06, seg) * (1.0 - smoothstep(0.52, 0.6, seg));
  float rim = (1.0 - smoothstep(0.06, 0.06 + fw * 1.5, abs(r - uR))) * dash;
  float rim2 = (1.0 - smoothstep(0.02, 0.02 + fw * 1.5, abs(r - uR + 0.28))) * 0.45;
  float wave = fract(uT * 0.6), wr = wave * uR;
  float sonar = (1.0 - smoothstep(0.0, 0.5 + fw, abs(r - wr))) * (1.0 - wave) * (1.0 - wave) * inside * 0.35;
  float ring = 1.0 - smoothstep(0.03, 0.03 + fw * 1.5, abs(r - 0.48));
  float dt = 1.0 - smoothstep(0.08, 0.08 + fw * 1.5, r);
  vec2 ab = abs(vL); float m = max(ab.x, ab.y);
  float tick = (1.0 - smoothstep(0.022, 0.022 + fw * 1.5, min(ab.x, ab.y))) * step(0.62, m) * (1.0 - step(0.92, m));
  float aim = max(max(ring, dt), tick);
  float aR = clamp(fill + rim * 0.9 + rim2 * 0.5 + sonar, 0.0, 1.0), aA = aim * 0.95;
  float a = aA + aR * (1.0 - aA);
  vec3 col = (uCol * 1.6 * aA + uRim * 1.3 * aR * (1.0 - aA)) / max(a, 1e-3);
  gl_FragColor = vec4(col, a);`;
const disc = new THREE.Mesh(discGeo, aimMat(DISC_V, DISC_F, { ...AIM_U, uR: DISC_U }, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
disc.renderOrder = 2;
// the beam over the spot: a quad turned to the camera about the upright
const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
const beam = new THREE.Mesh(beamGeo, aimMat('varying vec2 vU;\nvoid main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  `uniform float uT; uniform vec3 uCol; varying vec2 vU;
void main() {
  float x = 1.0 - abs(vU.x * 2.0 - 1.0), y = vU.y;
  float a = x * x * x * (1.0 - y) * (1.0 - y) * (0.42 + 0.08 * sin(uT * 6.0));
  gl_FragColor = vec4(uCol * 1.8, a);`, AIM_U, { blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
beam.renderOrder = 5;
// the first touch, when the grenade bounces on before it goes off: a small ring where it lands
const touch = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.24, 28).rotateX(-Math.PI / 2), worldSpace(new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, depthWrite: false, fog: false })));
touch.renderOrder = 4;
const aimGroup = new THREE.Group(); aimGroup.add(arcGhost, arcLine, disc, beam, touch); aimGroup.visible = false;
aimGroup.traverse(o => { o.frustumCulled = false; }); aimGroup.userData.noProbe = true; scene.add(aimGroup); mirrorHide(aimGroup);   // the aim is for the screen, not for the glass
// the aim's colours by kind: the frag warms amber to red, the smoke stays pale steel, the napalm burns orange
const AIM_COLD = { nade: new THREE.Color(1, 0.66, 0.2), smoke: new THREE.Color(0.72, 0.8, 0.88), napalm: new THREE.Color(1, 0.45, 0.12) };
const AIM_HOT = { nade: new THREE.Color(1, 0.34, 0.07), smoke: new THREE.Color(0.92, 0.96, 1), napalm: new THREE.Color(1, 0.2, 0.03) };
const AIM_RIM = { nade: [1, 0.24, 0.12], smoke: [0.78, 0.84, 0.9], napalm: [1, 0.42, 0.1] };
let discAt = [1e9, 0, 0];
// p, v: where the grenade leaves the hand and how fast (as the server will fly it); power 0…1 warms the colour; from: where
// the grenade in hand is drawn, the arc starts there and sweeps into the true flight within a couple of metres.
// Gives the metres along the ground to where it goes off, and whether it bursts in the air
const ARC_Q = Array.from({ length: ARC_MAX }, () => [0, 0, 0]), ARC_S = new Float32Array(ARC_MAX);
function showNadePreview(p, v, power = 0, from = null, kind = 'nade') {
  const K = KIND[kind] || KIND.nade;
  const { pts, first, wall, end } = predictNade(p, v, K.fuse), n = Math.min(ARC_MAX, pts.length);
  AIM_U.uCol.value.copy(AIM_COLD[kind] || AIM_COLD.nade).lerp(AIM_HOT[kind] || AIM_HOT.nade, power);
  AIM_U.uRim.value.setRGB(...(AIM_RIM[kind] || AIM_RIM.nade));
  DISC_U.value = K.r;
  const ox = from ? from.x - p[0] : 0, oy = from ? from.y - p[1] : 0, oz = from ? from.z - p[2] : 0;
  for (let i = 0, s = 0; i < n; i++) {
    const q = pts[i]; if (i) s += Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1], q[2] - pts[i - 1][2]);
    const k = Math.min(1, s / 2.4), w = 1 - k * k * (3 - 2 * k), Q = ARC_Q[i];
    Q[0] = q[0] + ox * w; Q[1] = q[1] + oy * w; Q[2] = q[2] + oz * w; ARC_S[i] = s;
  }
  // the ribbon, turned to the camera point by point, about as wide on the screen near and far
  const cam = camera.position, P = arcGeo.attributes.position.array, A = arcGeo.attributes.aArc.array;
  for (let i = 0; i < n; i++) {
    const q = ARC_Q[i], a = ARC_Q[Math.max(0, i - 1)], b = ARC_Q[Math.min(n - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2], vx = cam.x - q[0], vy = cam.y - q[1], vz = cam.z - q[2];
    const sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx, sl = Math.hypot(sx, sy, sz) || 1;
    const after = first >= 0 && i > first ? 1 : 0, hw = (0.001 + 0.0085 * Math.hypot(vx, vy, vz)) * (after ? 0.8 : 1) / sl;
    const o = i * 6;
    P[o] = q[0] + sx * hw; P[o + 1] = q[1] + sy * hw; P[o + 2] = q[2] + sz * hw;
    P[o + 3] = q[0] - sx * hw; P[o + 4] = q[1] - sy * hw; P[o + 5] = q[2] - sz * hw;
    A[o] = -1; A[o + 3] = 1; A[o + 1] = A[o + 4] = ARC_S[i]; A[o + 2] = A[o + 5] = after;
  }
  arcGeo.attributes.position.needsUpdate = true; arcGeo.attributes.aArc.needsUpdate = true; arcGeo.setDrawRange(0, Math.max(0, n - 1) * 6);
  // the disc where it goes off, draped again only when the spot has moved
  const [ex, ey, ez] = end, gr = gnd(ex, ez), b = buildingAt(ex, ez, ey), roof = !!b && ey > gr + (b.top || 12) - 0.6, floor = roof ? gr + (b.top || 12) : gr;
  if (Math.abs(ex - discAt[0]) + Math.abs(ez - discAt[2]) + Math.abs(ey - discAt[1]) > 0.02) {
    discAt = [ex, ey, ez];
    const D = discGeo.attributes.position.array, L = discGeo.attributes.aL.array;
    for (let i = 0; i < DISC_N; i++) { const x = ex + L[i * 2], z = ez + L[i * 2 + 1]; D[i * 3] = x; D[i * 3 + 1] = surfAt(x, z, roof) + 0.07; D[i * 3 + 2] = z; }
    discGeo.attributes.position.needsUpdate = true;
  }
  const air = ey - floor > 1.3;
  beam.position.set(ex, floor, ez); beam.scale.set(0.55, Math.max(2.8, ey - floor + 0.8), 1); beam.rotation.y = Math.atan2(cam.x - ex, cam.z - ez);
  const fp = first >= 0 ? pts[first] : null;
  touch.visible = !!fp && !wall && Math.hypot(fp[0] - ex, fp[2] - ez) > 1.2;
  if (touch.visible) touch.position.set(fp[0], fp[1] - 0.08, fp[2]);
  aimGroup.visible = true;
  return { dist: Math.hypot(ex - p[0], ez - p[2]), air };
}
function hideNadePreview() { aimGroup.visible = false; discAt[0] = 1e9; }

// a flying grenade (the ready model, or the ball while it has not come), the smoke and the fire of a blast, a scorch and the aim, out of
// the scene, for the warm-up (mp.js loadModels): their programs compiled and their drawings sent to the GPU before the first blast
function nadeSamples() {
  const cloudSample = sys => { const m = new THREE.InstancedMesh(sys.mesh.geometry, sys.mesh.material, 1); m.setColorAt(0, new THREE.Color(1, 1, 1)); return m; };
  const aim = [arcLine, arcGhost, disc, beam, touch].map(o => new THREE.Mesh(o.geometry, o.material));   // the aim, the streak and the spoon too
  return [flyNade() || new THREE.Mesh(GEO, MAT), flyNade('smoke'), flyNade('napalm'), cloudSample(SMOKE), cloudSample(FIRE), cloudSample(FLAME), new THREE.Mesh(scorchGeo, scorchMat()), ...aim, new THREE.Mesh(trails[0].geo, trailMat), new THREE.Mesh(spoonLong, spoonMat)];
}

export { nadeSamples, addNade, addZone, endZone, boomNade, blastGlow, camShake, clearBlasts, clearNades, tickNades, onNadeBounce, setNadeBodies, syncNade, liveNades, NADE_THROW, showNadePreview, hideNadePreview };
