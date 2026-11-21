import * as THREE from 'three';
import { LIGHTDIR, U, camera, renderer } from './renderer.js';
import { LAMP_REACH, lampSlot, lampTable } from '../world/lamp-light.js';
import { terrainH } from '../world/terrain.js';

/* ---------- the shadows of the lamps and of what moves ----------
   Two kinds of shadow the sun's cascades (SunLight, src/render/renderer.js) cannot give:
   - the shadows the street lamps throw: the walls round a lamp are known to its light already (src/world/lamp-light.js),
     but a tree, a pole, a fence, a player or a tram under a lamp threw none. The nearest lamps (12 on «высокая», 6 on
     «средняя») get a real depth map each: a camera at the glass looking straight down, 152° wide, so the whole pool of
     the lamp is in it (the light goes down; above the glass there is no map). The shader of the lamps takes the map of
     such a lamp instead of its walls (the map has the houses too, with every balcony and porch), and the walls
     elsewhere; the map fades out with the distance of the lamp from the eye, so a lamp that leaves the set or comes
     into it changes nothing on the screen;
   - the shadows of what moves — players, bots, their corpses, the items of the map, trams, buses and trains: the sun's
     cascades are drawn only when the camera has moved a fair way or the sun has turned (src/render/post.js updateSun),
     so what moves cannot be in them. It is drawn every frame into a map of its own along the sun (or the moon), round
     the eye, and that map darkens the sun's light as the cascades do; and into the maps of the lamps near it.
   All the maps are tiles of one depth atlas (one sampler: the facades use most of the 16 a shader may have): the sun's
   1024² in a corner, the lamps' 512² round it. A lamp's tile is drawn with all that stands still once, when the lamp
   comes into the set — a pass as costly as a cascade of the sun (≈300 draw calls, 3 million triangles), at most one a
   frame — into a second atlas that keeps it; every frame it is copied into the atlas the shaders read and what moves
   near the lamp is drawn over it. Both passes go through three's own shadow renderer (the same depth materials, alpha
   cut-outs of leaves, skinning), each atlas tile a viewport of one light, the way the cascades of SunLight are.
   Only on the quality levels with the sun's shadows; the lamp maps only while the lamps are on and the eye is low. */
const TILE = 512, GRID = 4, ATLAS = TILE * GRID, KMAX = 12;
const TANH = 4, NEAR = 0.4, BELOW = 4.5;   // the lamp cameras: tan of the half angle (76°), the near plane under the glass, the far plane this far under the lamp's foot
const SUNT = 2;   // the sun's map: 2 × 2 tiles in the corner of the atlas
// the tile of lamp slot s: the 4 × 4 grid less the 2 × 2 of the sun, row by row (the shader has the same order)
const tileOf = s => { const t = s + 2 + (s >= 2 ? 2 : 0); return [t & 3, t >> 2]; };

/* a light for three's shadow renderer: its tiles are viewports of the atlas (in tiles; three multiplies by mapSize),
   each with its own camera and frustum */
class TileShadow extends THREE.LightShadow {
  constructor() { super(new THREE.PerspectiveCamera()); this.mapSize.set(TILE, TILE); this._frameExtents.set(GRID, GRID); this.faces = []; }
  getViewportCount() { return this.faces.length; }
  getViewport(i) { return this.faces[i].vp; }
  getCamera(i) { return this.faces[i].cam; }
  getFrustum(i) { return this.faces[i].fr; }
  updateMatrices() {}
}
const STILL = { name: 'lamp maps', castShadow: true, shadow: new TileShadow() };   // what stands still, into the keeping atlas
const MOVE = { name: 'moving shadows', castShadow: true, shadow: new TileShadow() };   // what moves, into the atlas read
let RT_S = null, RT_W = null;
function atlas() {
  const d = new THREE.DepthTexture(ATLAS, ATLAS, THREE.UnsignedIntType);
  d.format = THREE.DepthFormat; d.compareFunction = THREE.LessEqualCompare; d.minFilter = d.magFilter = THREE.LinearFilter;   // hardware PCF, as the sun's
  const rt = new THREE.WebGLRenderTarget(ATLAS, ATLAS, { format: THREE.RedFormat, depthTexture: d, generateMipmaps: false });
  renderer.initRenderTarget(rt); return rt;
}

/* ---------- what moves ----------
   addMover(root): an object of the scene that moves (a player, an item); its meshes cast shadows from now on, but only
   into the maps of what moves — the passes of what stands still (the sun's cascades too) leave it out. A mover taken
   out of the scene is forgotten. Materials of world-space objects (worldSpace, src/render/world-space.js) cast through
   a depth material without the terrain lift, as they are drawn.
   addMoverInstances(mesh): an InstancedMesh of vehicles all over the city (the trams, the buses, the trains): each frame
   the ones near the eye are copied into a small mesh of its own that casts, so a frame does not draw every bus twice. */
const movers = new Set(), proxies = [], ROOT = new THREE.Object3D(), MP = [];   // MP: per mover near the eye x, y, z, radius
function addMover(o, r = 1.2) { o.userData.moverR = r; movers.add(o); }
function addMoverInstances(src, cap, r) {
  const p = new THREE.InstancedMesh(src.geometry, src.material, cap); p.count = 0; p.castShadow = true; p.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  proxies.push({ src, p, r });
}
const worldDepth = new Map();
function prep(o) {
  o.traverse(m => {
    if (!m.isMesh || m.userData.shPrep === m.material) return;
    m.userData.shPrep = m.material; const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    m.castShadow = !mat.transparent;
    if (mat.userData.noTerr) { let d = worldDepth.get(mat); if (!d) { d = new THREE.MeshDepthMaterial(); d.userData.noTerr = true; worldDepth.set(mat, d); } m.customDepthMaterial = d; }
  });
}
// the movers within `far` of (cx, cz) into ROOT and MP; the far ones and the hidden ones stay out
function gather(cx, cz, far) {
  MP.length = 0; ROOT.children.length = 0;
  for (const o of movers) {
    if (!o.parent) { movers.delete(o); continue; }
    if (!o.visible) continue;
    const e = o.matrixWorld.elements, x = e[12], z = e[14];
    if (Math.abs(x - cx) > far || Math.abs(z - cz) > far) continue;
    prep(o); MP.push(x, e[13] + 1, z, o.userData.moverR); ROOT.children.push(o);
  }
  for (const q of proxies) {
    const s = q.src, a = s.instanceMatrix.array, b = q.p.instanceMatrix.array, cap = q.p.instanceMatrix.count; let n = 0;
    if (s.visible) for (let i = 0; i < s.count && n < cap; i++) {
      const x = a[16 * i + 12], z = a[16 * i + 14]; if (Math.abs(x - cx) > far || Math.abs(z - cz) > far) continue;
      for (let k = 0; k < 16; k++) b[16 * n + k] = a[16 * i + k];
      MP.push(x, a[16 * i + 13] + terrainH(x, z) + 2, z, q.r); n++;
    }
    q.p.count = n;
    if (n) { q.p.instanceMatrix.needsUpdate = true; q.p.computeBoundingSphere(); ROOT.children.push(q.p); }
  }
}
// hides the movers for a pass of what stands still; returns what to show again
const HID = [];
function hideMovers() { HID.length = 0; for (const o of movers) if (o.visible) { o.visible = false; HID.push(o); } return HID; }
function showMovers() { for (const o of HID) o.visible = true; HID.length = 0; }

/* ---------- the lamp slots ---------- */
let K = 0;   // the slots of this quality level
const slots = Array.from({ length: KMAX }, (_, s) => {
  const [i, j] = tileOf(s);
  return { lamp: -1, score: 0, ready: 0, drawn: false, fresh: false, dyn: false, reach: 0, cam: new THREE.PerspectiveCamera(2 * Math.atan(TANH) * 180 / Math.PI, 1, NEAR, 10), fr: new THREE.Frustum(), vp: new THREE.Vector4(i, j, 1, 1) };
});
let slotOf = null, mark = null, stamp = 0, cells = null;   // per lamp: its slot (−1 none), the frame it was picked; the lamps (kinds 0, 1) by 40 m cells
const CELL = 40, PICK = 150;   // the lamps within PICK metres of the eye compete for the slots
const ckey = (i, j) => (i + 2048) * 4096 + j + 2048;
function lampCells(tab) {
  const m = new Map(), T = tab.T, F = tab.F;
  for (let j = 0; j < tab.n; j++) { if ((T[4 * j + 3] & 3) > 1) continue; const k = ckey(Math.floor(F[4 * j] / CELL), Math.floor(F[4 * j + 2] / CELL)); let l = m.get(k); if (!l) m.set(k, l = []); l.push(j); }
  return m;
}
const M4 = new THREE.Matrix4();
function frustumOf(cam, fr) { cam.updateMatrixWorld(); fr.setFromProjectionMatrix(M4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), cam.coordinateSystem); }
function take(s, j, tab) {
  const sl = slots[s], F = tab.F, meta = tab.T[4 * j + 3], foot = ((meta >>> 18) & 1023) * 0.1;
  sl.lamp = j; slotOf[j] = s; sl.drawn = false; sl.ready = 0; sl.dyn = false; sl.reach = LAMP_REACH[meta & 3];
  const c = sl.cam; c.near = NEAR; c.far = foot + BELOW; c.updateProjectionMatrix();   // the shader takes the same far plane from the same foot
  c.position.set(F[4 * j], F[4 * j + 1], F[4 * j + 2]); c.up.set(0, 0, -1); c.lookAt(c.position.x, c.position.y - 1, c.position.z);
  frustumOf(c, sl.fr); lampSlot(j, s);
}
function free(s) { const sl = slots[s]; if (sl.lamp < 0) return; lampSlot(sl.lamp, -1); slotOf[sl.lamp] = -1; sl.lamp = -1; sl.drawn = false; sl.ready = 0; sl.dyn = false; }
function freeAll() { for (let s = 0; s < KMAX; s++) free(s); }
function setLampShadows(k) { K = Math.min(KMAX, k); if (slotOf) for (let s = K; s < KMAX; s++) free(s); }

const CS = new Float64Array(4096), CJ = new Int32Array(4096);
let fadeR = PICK;
// picks the K lamps nearest the eye (those behind it count a little farther) and gives the new ones free slots
function pick(tab, cx, cy, cz, fx, fz) {
  stamp++; let n = 0; const F = tab.F, r = Math.ceil(PICK / CELL);
  const ci = Math.floor(cx / CELL), cj = Math.floor(cz / CELL);
  for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    const l = cells.get(ckey(i, j)); if (!l) continue;
    for (const k of l) {
      const dx = F[4 * k] - cx, dz = F[4 * k + 2] - cz, dh = Math.hypot(dx, dz), d = Math.hypot(dh, (F[4 * k + 1] - cy) * 0.7);
      if (d > PICK || n >= CS.length) continue;
      const back = dh > 1 ? (dx * fx + dz * fz) / dh : 1;   // the pool of a lamp behind the eye is seen less
      CS[n] = d * (1 + 0.6 * sstep(0.3, -0.5, back) * sstep(12, 30, dh)); CJ[n] = k; n++;
    }
  }
  // the K + 1 best, by selection (a few hundred candidates)
  fadeR = PICK; const want = Math.min(K, n);
  for (let a = 0; a <= want && a < n; a++) {
    let b = a; for (let c = a + 1; c < n; c++) if (CS[c] < CS[b]) b = c;
    const ts = CS[a], tj = CJ[a]; CS[a] = CS[b]; CJ[a] = CJ[b]; CS[b] = ts; CJ[b] = tj;
    if (a < want) mark[CJ[a]] = stamp; else fadeR = Math.min(PICK, CS[a]);
  }
  for (let s = 0; s < K; s++) if (slots[s].lamp >= 0 && mark[slots[s].lamp] !== stamp) free(s);
  for (let a = 0; a < want; a++) {
    const j = CJ[a]; if (slotOf[j] >= 0) { slots[slotOf[j]].score = CS[a]; continue; }
    for (let s = 0; s < K; s++) if (slots[s].lamp < 0) { take(s, j, tab); slots[s].score = CS[a]; break; }
  }
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---------- the sun's map of what moves ----------
   An orthographic camera along the light, round a point a little ahead of the eye on the ground, snapped to its own
   texel grid (a standing player's shadow does not crawl as the eye turns). R grows with the height of the eye. */
const sunFace = { cam: new THREE.OrthographicCamera(), fr: new THREE.Frustum(), vp: new THREE.Vector4(0, 0, SUNT, SUNT) };
const SX = new THREE.Vector3(), SY = new THREE.Vector3(), SC = new THREE.Vector3(), UPV = new THREE.Vector3(), ORG = new THREE.Vector3();
const SB = new THREE.Matrix4().set(0.25, 0, 0, 0.25, 0, 0.25, 0, 0.25, 0, 0, 0.5, 0.5, 0, 0, 0, 1);   // NDC → the sun's corner of the atlas, depth 0…1
const SUN_UP = 100, SUN_DOWN = 60;   // the camera this far up the light from the centre; the map ends this far below it
function placeSun(cx, cy, cz, R) {
  UPV.set(0, 1, 0); if (Math.abs(LIGHTDIR.y) > 0.99) UPV.set(0, 0, 1);
  M4.lookAt(LIGHTDIR, ORG, UPV); SX.setFromMatrixColumn(M4, 0); SY.setFromMatrixColumn(M4, 1);
  const t = 2 * R / (TILE * SUNT); SC.set(cx, cy, cz);
  const a = SC.dot(SX), b = SC.dot(SY); SC.addScaledVector(SX, Math.round(a / t) * t - a).addScaledVector(SY, Math.round(b / t) * t - b);
  const c = sunFace.cam; c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = SUN_UP + SUN_DOWN; c.updateProjectionMatrix();
  c.position.copy(SC).addScaledVector(LIGHTDIR, SUN_UP); c.up.copy(UPV); c.lookAt(SC); frustumOf(c, sunFace.fr);
  U.uShSunM.value.multiplyMatrices(SB, c.projectionMatrix).multiply(c.matrixWorldInverse);
  U.uShSun.value.set(SC.x, SC.z, R, 0);
}

/* ---------- the frame ---------- */
const sm = renderer.shadowMap, orig = sm.render, NOOP = () => {};
const V4 = new THREE.Vector4(), BOX = new THREE.Box2(), V2 = new THREE.Vector2(), FACES = [];
const STAT = { slots: 0, still: 0, stillMs: 0, moving: 0, movers: 0 };
let last = 0, sunDyn = false, stillGap = false;
function draw(L, faces, root) {
  L.shadow.faces = faces; L.shadow.map = L === STILL ? RT_S : RT_W;
  const clr = renderer.clear; renderer.clear = NOOP; sm.needsUpdate = true;   // three clears the whole map before its first viewport: the tiles are cleared here instead
  try { orig.call(sm, [L], root, camera); } finally { renderer.clear = clr; }
}
function clearRect(rt, x, y, w, h) {
  renderer.setRenderTarget(rt); const st = renderer.state;
  st.setScissorTest(true); st.scissor(V4.set(x, y, w, h)); renderer.clear(false, true, false); st.setScissorTest(false);
}
function blit(s) {   // the tile of what stands still into the atlas the shaders read
  const [i, j] = tileOf(s); BOX.min.set(i * TILE, j * TILE); BOX.max.set((i + 1) * TILE, (j + 1) * TILE); V2.set(i * TILE, j * TILE);
  renderer.copyTextureToTexture(RT_S.depthTexture, RT_W.depthTexture, BOX, V2);
}
function frameShadows(scene) {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  const fade = U.uShFade.value, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, alt = Math.max(0, cy - terrainH(cx, cz));
  if (!RT_W) { RT_S = atlas(); RT_W = atlas(); U.tShAtlas.value = RT_W.depthTexture; }
  const prev = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
  const fx = -Math.sin(camera.rotation.y), fz = -Math.cos(camera.rotation.y);   // the eye looks along (fx, fz) (rotation order YXZ)
  const R = Math.min(140, 45 + alt * 0.6), sunOn = sstep(260, 160, alt);
  gather(cx + fx * R * 0.35, cz + fz * R * 0.35, R + PICK + 50);   // round the sun's map, and every lamp that may have a slot
  STAT.movers = ROOT.children.length;
  // the lamps: on while they shine and the eye is low enough to see their pools
  const tab = lampTable(), lampOn = K > 0 && tab && U.uLampOn.value.x > 0 && alt < 90;
  if (tab && !slotOf) { slotOf = new Int8Array(tab.n).fill(-1); mark = new Int32Array(tab.n); cells = lampCells(tab); }
  if (!lampOn) { if (slotOf) freeAll(); }
  else {
    pick(tab, cx, cy, cz, fx, fz);
    // what stands still: one lamp every other frame (a pass of ~300 draw calls), the nearest waiting one
    let w = -1; if (!(stillGap = !stillGap)) for (let s = 0; s < K; s++) if (slots[s].lamp >= 0 && !slots[s].drawn && (w < 0 || slots[s].score < slots[w].score)) w = s;
    if (w >= 0) {
      const t0 = performance.now(), sl = slots[w], [i, j] = tileOf(w);
      clearRect(RT_S, i * TILE, j * TILE, TILE, TILE);
      hideMovers(); try { FACES.length = 0; FACES.push(sl); draw(STILL, FACES, scene); } finally { showMovers(); }
      sl.drawn = true; sl.fresh = true; STAT.still++; STAT.stillMs = performance.now() - t0;
    }
  }
  // what moves: the sun's tile, and the lamp tiles it is near
  FACES.length = 0;
  placeSun(cx + fx * R * 0.35, terrainH(cx + fx * R * 0.35, cz + fz * R * 0.35), cz + fz * R * 0.35, R);
  let sunHit = false; const sx = U.uShSun.value.x, sz = U.uShSun.value.y;
  if (sunOn > 0) for (let m = 0; m < MP.length; m += 4) if (Math.hypot(MP[m] - sx, MP[m + 2] - sz) < R + MP[m + 3] + 40) { sunHit = true; break; }
  if (sunHit || sunDyn) clearRect(RT_W, 0, 0, SUNT * TILE, SUNT * TILE);
  if (sunHit) FACES.push(sunFace);
  sunDyn = sunHit; U.uShSun.value.w = sunHit ? sunOn : 0;
  let used = 0;
  for (let s = 0; s < KMAX; s++) {
    const sl = slots[s];
    if (s >= K || sl.lamp < 0 || !sl.drawn) { fade[s >> 2].setComponent(s & 3, 0); continue; }
    used++; sl.ready = Math.min(1, sl.ready + dt / 0.35);
    fade[s >> 2].setComponent(s & 3, sstep(fadeR, fadeR * 0.7, sl.score) * sl.ready * sstep(90, 50, alt));
    const lx = sl.cam.position.x, ly = sl.cam.position.y, lz = sl.cam.position.z; let hit = false;
    for (let m = 0; m < MP.length; m += 4) if (MP[m + 1] - MP[m + 3] < ly && Math.hypot(MP[m] - lx, MP[m + 2] - lz) < sl.reach + MP[m + 3]) { hit = true; break; }
    if (hit || sl.dyn || sl.fresh) blit(s);
    if (hit) FACES.push(sl);
    sl.dyn = hit; sl.fresh = false;
  }
  STAT.slots = used; STAT.moving = FACES.length;
  if (FACES.length) draw(MOVE, FACES, ROOT);
  renderer.setRenderTarget(prev, face, mip);
}
/* three draws the shadows inside renderer.render, before the scene; the maps of this module are drawn there too (only
   for the main camera: the city cubes of src/render/cityprobe.js read what it left). What moves is hidden from every
   other pass of shadows — the sun's cascades are kept between frames. */
sm.render = function (lights, scene, cam) {
  hideMovers(); try { orig.call(sm, lights, scene, cam); } finally { showMovers(); }
  if (cam !== camera || !sm.enabled) return;
  frameShadows(scene);
};

U.tShAtlas = { value: null };
U.uShFade = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };   // per lamp slot: how much its map counts
U.uShCam = { value: new THREE.Vector4(TANH, NEAR, 1 / ATLAS, 0) };   // the lamp cameras: tan of the half angle, near plane; a texel of the atlas
U.uShSunM = { value: new THREE.Matrix4() };   // the world → the sun's tile of what moves (uv in the atlas, depth)
U.uShSun = { value: new THREE.Vector4(0, 0, 1, 0) };   // its centre x, z, radius on the ground, strength (0: nothing moves near)

const G = (1 / GRID).toFixed(4), PX = (2 / TILE).toFixed(6);
THREE.ShaderChunk.shadowmap_pars_fragment += `
#ifdef USE_SHADOWMAP
uniform highp sampler2DShadow tShAtlas; uniform vec4 uShFade[ 3 ]; uniform vec4 uShCam; uniform mat4 uShSunM; uniform vec4 uShSun;
// four hardware-filtered taps in a turned square, kept inside the tile (box: its corners in the atlas)
float shPcf( vec2 uv, float z, vec4 box, float r ) {
  return 0.25 * (
    texture( tShAtlas, vec3( clamp( uv + vec2( -0.4, -1.0 ) * r, box.xy, box.zw ), z ) ) +
    texture( tShAtlas, vec3( clamp( uv + vec2( 1.0, -0.4 ) * r, box.xy, box.zw ), z ) ) +
    texture( tShAtlas, vec3( clamp( uv + vec2( 0.4, 1.0 ) * r, box.xy, box.zw ), z ) ) +
    texture( tShAtlas, vec3( clamp( uv + vec2( -1.0, 0.4 ) * r, box.xy, box.zw ), z ) ) );
}
// the map of lamp slot s (its glass at lamp, its foot so high over the ground) at the point p with the normal n:
// 1 lit, 0 in shadow; m: how much the map counts there (0 off it: above the glass, past its edge or its far plane)
float lampMap( int s, vec3 lamp, vec3 p, vec3 n, float foot, out float m ) {
  m = 0.0;
  float fade = uShFade[ s >> 2 ][ s & 3 ];
  if ( fade <= 0.0 || lamp.y - p.y <= uShCam.y + 0.1 ) return 1.0;
  vec3 q = p + n * ( ( lamp.y - p.y ) * uShCam.x * ${PX} ) + normalize( lamp - p ) * 0.03;   // off the surface by a texel of the map there
  vec3 d = q - lamp; float dq = - d.y;
  vec2 c = vec2( d.x, - d.z ) / ( dq * uShCam.x );
  float e = max( abs( c.x ), abs( c.y ) );
  float f = foot + ${BELOW.toFixed(1)}, nr = uShCam.y, z = 0.5 * ( ( f + nr ) / ( f - nr ) - 2.0 * f * nr / ( ( f - nr ) * dq ) ) + 0.5;
  if ( e >= 1.0 || z >= 1.0 ) return 1.0;
  int t = s + 2 + ( s >= 2 ? 2 : 0 ); vec2 o = vec2( float( t & 3 ), float( t >> 2 ) );
  vec4 box = vec4( o * ${G} + 1.5 * uShCam.z, ( o + 1.0 ) * ${G} - 1.5 * uShCam.z );
  m = fade * smoothstep( 1.0, 0.85, e );
  return shPcf( ( o + c * 0.5 + 0.5 ) * ${G}, z, box, 1.5 * uShCam.z );
}
#if NUM_SUN_LIGHT_SHADOWS > 0
// the sun's map of what moves at this point: 1 lit, 0 in the shadow of a player or a vehicle
float sunMoving() {
  if ( uShSun.w <= 0.0 ) return 1.0;
  vec3 p = vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * 0.06;
  float r = length( p.xz - uShSun.xy ) / uShSun.z; if ( r >= 1.0 ) return 1.0;
  vec4 c = uShSunM * vec4( p, 1.0 );
  float s = shPcf( c.xy, min( c.z, 1.0 ), vec4( vec2( 1.5 * uShCam.z ), vec2( ${(SUNT / GRID).toFixed(4)} - 1.5 * uShCam.z ) ), uShCam.z );
  return mix( 1.0, s, uShSun.w * smoothstep( 1.0, 0.8, r ) );
}
#endif
#endif
`;
{
  const SUNLINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;';
  const src = THREE.ShaderChunk.lights_fragment_begin;
  if (!src.includes(SUNLINE)) throw new Error('lamp-shadows: the sun line of lights_fragment_begin changed (three.js update?)');
  THREE.ShaderChunk.lights_fragment_begin = src.replace(SUNLINE, SUNLINE + '\n\t\tdirectLight.color *= receiveShadow ? sunMoving() : 1.0;');
}

export { STAT as LAMP_SHADOWS, addMover, addMoverInstances, setLampShadows };
