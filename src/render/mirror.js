import * as THREE from 'three';
import { SegGrid } from '../core/geometry.js';
import { U, camera, renderer, scene } from './renderer.js';

/* ---------- the glass as a mirror ----------
   The city cubes (src/render/cityprobe.js) are shot once: the glass shows the street as it stood at loading, seen from
   one of three far points, with no players, no trams and not you. The wall you look at now gets a true mirror: the
   scene is drawn once more, from the eye mirrored behind the plane of that wall, at a fraction of the screen's
   resolution, into a texture the glass of that plane samples at its own screen point (a planar reflection: the image
   of a flat mirror is exact). What stands before the wall is in it — the street, the houses across it, the trees,
   the trams and cars, the other players and your own character (src/game/mirror-self.js: your body, drawn only into
   the mirror, since the first-person eye has none). An oblique near plane cuts the frame at the wall, so the house
   itself and whatever lies behind it stay out.
   The planes are the facades with windows, registered as they are built (addMirrorWall: the generic houses, the Soviet
   series, the glazed openings of the landmarks). A few times a second the walls round the eye are scored by how much
   mirror they show: the solid angle of each wall in the view times the Fresnel reflectance of glass at that angle,
   and a bonus when your own image falls on it; coplanar walls of neighbouring houses count as one plane. The best plane
   holds until another is clearly better; the change fades the mirror out and the new one in. Glass off the plane keeps
   the cubes. The frame of the mirror ends at a distance (q.far): there its alpha fades out (fog_fragment, U.mirFade)
   and the cubes show through, as they do where the mirror sees the sky. Only on «высокая» and «средняя» with the HDR
   pipeline; the cost is one more pass of the scene, culled by the mirror's frustum and far plane. */
const WALLS = new SegGrid(24);   // a, b: the foot and the top of the wall over the ground at its middle
// x1..z2: the wall (any order), y0..y1: its height span, nx/nz: its outward normal (towards the street)
function addMirrorWall(x1, z1, x2, z2, y0, y1, nx, nz) {
  if (Math.hypot(x2 - x1, z2 - z1) < 1 || y1 - y0 < 1) return;
  if ((z2 - z1) * nx - (x2 - x1) * nz < 0) { let t = x1; x1 = x2; x2 = t; t = z1; z1 = z2; z2 = t; }   // the outward normal is (dz, −dx)
  WALLS.add(x1, z1, x2, z2, y0, y1);
}

// the glass samples the mirror through these (shared by the facades, the series and the landmarks)
const BLANK = new THREE.DataTexture(new Uint8Array(4), 1, 1); BLANK.needsUpdate = true;   // transparent black: nothing mirrored
const MU = { tMirror: { value: BLANK }, uMirrorM: { value: new THREE.Matrix4() }, uMirrorPlane: { value: new THREE.Vector4(1, 0, 0, -1e9) }, uMirrorOn: { value: 0 } };
/* The environment of the glass: the sky (ibl, the PMREM of three), the city cubes over it where they reach, the mirror
   of the plane over both — its alpha says where it saw something (not the sky, not past its far fade). wp, wn: the
   point and the normal of the glass in the world. Needs the uniforms of PU (cityprobe.js) and MU. */
const GLASS_GLSL = `
uniform samplerCube uProbeA; uniform samplerCube uProbeB; uniform float uProbeMix; uniform float uProbeOn;
uniform sampler2D tMirror; uniform mat4 uMirrorM; uniform vec4 uMirrorPlane; uniform float uMirrorOn;
vec3 glassEnv(vec3 ibl, vec3 wp, vec3 wn) {
  vec3 e = ibl;
  if (uProbeOn > 0.01) { vec3 Rw = reflect(normalize(wp - cameraPosition), wn); e = mix(e, mix(textureCube(uProbeA, Rw).rgb, textureCube(uProbeB, Rw).rgb, uProbeMix), uProbeOn); }
  if (uMirrorOn > 0.0) {   // on the plane of the mirror (the facades of a street line sit a few cm apart) and facing as it does
    float k = uMirrorOn * (1.0 - smoothstep(0.2, 0.4, abs(dot(uMirrorPlane.xyz, wp) - uMirrorPlane.w))) * smoothstep(0.985, 0.997, dot(wn, uMirrorPlane.xyz));
    if (k > 0.0) {
      vec4 c = uMirrorM * vec4(wp, 1.0);
      vec4 m = textureLod(tMirror, clamp(c.xy / c.w, vec2(0.001), vec2(0.999)), 0.0) * k;   // premultiplied by its alpha
      e = e * (1.0 - m.a) + m.rgb;
    }
  }
  return e;
}
`;
// lights_fragment_maps with the glass environment in place of the sky's, by the glass weight w (a GLSL expression)
function glassLights(w) {
  const src = THREE.ShaderChunk.lights_fragment_maps, line = 'radiance += iblRadiance;';
  if (!src.includes(line)) throw new Error('mirror: the radiance line of lights_fragment_maps changed (three.js update?)');
  return src.replace(line, `{ float glassW = ${w};
    radiance += glassW > 0.01 ? mix(iblRadiance, glassEnv(iblRadiance, cameraPosition - vViewPosition * mat3(viewMatrix), normalize(geometryNormal * mat3(viewMatrix))), glassW) : iblRadiance; }`);
}

/* ---------- which wall ---------- */
const RANGE = 46, HOLD = 0.7, PICK_EVERY = 0.12;
const FR = new THREE.Frustum(), M4 = new THREE.Matrix4(), Q = new THREE.Vector3(), seen = new Set(), groups = [];
const fres = c => 0.04 + 0.96 * Math.pow(1 - Math.max(0, c), 5);
function pickPlane(terrainH) {
  const c = camera.position;
  if (c.y - terrainH(c.x, c.z) > 60) return null;   // high over the city: no wall is near enough to mirror much
  FR.setFromProjectionMatrix(M4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  seen.clear(); groups.length = 0;
  const s = WALLS.s;
  WALLS.near(c.x, c.z, RANGE, id => {
    if (seen.has(id)) return; seen.add(id);
    const o = id * 6, x1 = s[o], z1 = s[o + 1], dx = s[o + 2] - x1, dz = s[o + 3] - z1, L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L, nx = tz, nz = -tx;
    const front = (c.x - x1) * nx + (c.z - z1) * nz; if (front < 0.2) return;   // the eye is behind it or in it
    const g = terrainH(x1 + dx / 2, z1 + dz / 2), y0 = g + s[o + 4], y1 = g + Math.min(s[o + 5], s[o + 4] + 15);
    // the wall as a grid of patches: each the solid angle it fills, times the reflectance of glass at its angle
    const nu = Math.min(10, Math.max(2, Math.ceil(L / 3))), nv = Math.min(4, Math.max(1, Math.ceil((y1 - y0) / 3.5))), du = L / nu, dv = (y1 - y0) / nv;
    let sc = 0;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      Q.set(x1 + tx * (i + 0.5) * du, y0 + (j + 0.5) * dv, z1 + tz * (i + 0.5) * du);
      if (!FR.containsPoint(Q)) continue;
      const vx = c.x - Q.x, vy = c.y - Q.y, vz = c.z - Q.z, r2 = vx * vx + vy * vy + vz * vz, r = Math.sqrt(r2), cs = (vx * nx + vz * nz) / r;
      sc += du * dv * cs / Math.max(r2, 1) * fres(cs);
    }
    if (sc <= 0) return;
    // your own image: the foot of the eye on this wall, and the mirrored chest in the view
    const ft = (c.x - x1) * tx + (c.z - z1) * tz;
    if (ft > 0.2 && ft < L - 0.2 && c.y > y0 && c.y < y1 + 1 && front < 25) {
      Q.set(c.x - 2 * front * nx, c.y - 0.5, c.z - 2 * front * nz);
      if (FR.containsPoint(Q)) sc += 0.12 / (1 + front / 8);
    }
    const d = x1 * nx + z1 * nz;
    let gr = null; for (const q of groups) if (q.nx * nx + q.nz * nz > 0.9995 && Math.abs(q.d - d) < 0.25) { gr = q; break; }
    if (!gr) groups.push(gr = { nx, nz, d, score: 0, best: 0 });
    gr.score += sc; if (sc > gr.best) { gr.best = sc; gr.nx = nx; gr.nz = nz; gr.d = d; }
  });
  let best = null; for (const q of groups) if (!best || q.score > best.score) best = q;
  return best && best.score > 0.002 ? best : null;
}
const same = (a, b) => a && b && a.nx * b.nx + a.nz * b.nz > 0.9995 && Math.abs(a.d - b.d) < 0.25;

/* ---------- the pass ---------- */
const vcam = new THREE.PerspectiveCamera(), rt = { t: null, w: 0, h: 0 };
const N = new THREE.Vector3(), CP = new THREE.Vector3(), V = new THREE.Vector3(), T = new THREE.Vector3(), LA = new THREE.Vector3(), RM = new THREE.Matrix4();
const PL = new THREE.Plane(), CL = new THREE.Vector4(), QV = new THREE.Vector4(), BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const hooks = [], hidden = [];
const onMirror = f => { hooks.push(f); };   // f(true) just before the mirror is drawn, f(false) just after
const mirrorHide = o => { hidden.push(o); };   // shown on the screen, never in the mirror (the aim of a grenade)
let cur = null, want = null, on = 0, pickT = 0, last = 0;
const STAT = { on: 0, plane: null, ms: 0, size: '' }, CC = new THREE.Color();
// q: the mirror settings of the quality level ({ scale, far } or 0: off); w, h: the size the scene is drawn at;
// live: the game or the walk is on (not the flight over the city before the start); sky: the sky sphere (the cubes
// give the sky); terrainH: the ground (src/world/terrain.js, passed by post.js: this module stays below the world's)
function mirrorPass(q, w, h, live, sky, terrainH) {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!q || !live) { cur = want = null; on = 0; MU.uMirrorOn.value = 0; STAT.on = 0; return; }
  camera.updateMatrixWorld();
  if ((pickT -= dt) <= 0) {
    pickT = PICK_EVERY; const best = pickPlane(terrainH);
    if (!best) want = null;
    else if (cur && same(best, cur)) want = cur = best;
    else if (cur) { const held = groups.find(g => same(g, cur)); want = held && held.score >= best.score * HOLD ? (cur = held) : best; }
    else want = best;
  }
  // the change of plane: the old mirror fades out, then the new one in; no plane at all: out
  if (want !== cur) { on = Math.max(0, on - dt / 0.15); if (on === 0) cur = want; }
  else if (cur) on = Math.min(1, on + dt / 0.25);
  if (!cur || on <= 0) { MU.uMirrorOn.value = 0; STAT.on = 0; return; }
  const t0 = performance.now();
  // the eye mirrored behind the plane (three's Reflector): its position, its look and its up reflected
  N.set(cur.nx, 0, cur.nz); const d = cur.d + 0.04;   // the clip just before the facade (it is sunk a few cm into the ring)
  CP.setFromMatrixPosition(camera.matrixWorld);
  const s = N.dot(CP) - d; if (s <= 0.05) { MU.uMirrorOn.value = 0; return; }
  V.copy(CP).addScaledVector(N, -2 * s);
  RM.extractRotation(camera.matrixWorld);
  LA.set(0, 0, -1).applyMatrix4(RM).add(CP);
  T.copy(LA).addScaledVector(N, -2 * (N.dot(LA) - d));
  vcam.position.copy(V); vcam.up.set(0, 1, 0).applyMatrix4(RM).reflect(N); vcam.lookAt(T);
  vcam.fov = camera.fov; vcam.aspect = camera.aspect; vcam.near = camera.near; vcam.far = q.far; vcam.updateProjectionMatrix(); vcam.updateMatrixWorld();
  MU.uMirrorM.value.copy(BIAS).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
  // the oblique near plane (Lengyel): the frame starts at the wall, the house and what is behind it are cut away
  PL.setFromNormalAndCoplanarPoint(N, Q.copy(N).multiplyScalar(d)).applyMatrix4(vcam.matrixWorldInverse);
  CL.set(PL.normal.x, PL.normal.y, PL.normal.z, PL.constant);
  const e = vcam.projectionMatrix.elements;
  QV.set((Math.sign(CL.x) + e[8]) / e[0], (Math.sign(CL.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  CL.multiplyScalar(2 / CL.dot(QV));
  e[2] = CL.x; e[6] = CL.y; e[10] = CL.z + 1; e[14] = CL.w;
  vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();
  // the target: a fraction of the scene's size
  const tw = Math.max(64, Math.round(w * q.scale)), th = Math.max(64, Math.round(h * q.scale));
  if (!rt.t || rt.w !== tw || rt.h !== th) {
    if (rt.t) rt.t.dispose();
    rt.t = new THREE.WebGLRenderTarget(tw, th, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false });
    rt.w = tw; rt.h = th; STAT.size = tw + '×' + th;
  }
  // everything a pass changes is put back before the frame: the sky (the cubes give it), the arms on the camera,
  // the shadow maps (the cascades stay fitted to the eye), the clear colour, the mirror itself (no feedback)
  const skyV = sky.visible, camV = camera.visible, nu = renderer.shadowMap.needsUpdate, cc = renderer.getClearColor(CC), ca = renderer.getClearAlpha();
  const hid = hidden.map(o => o.visible);
  sky.visible = false; camera.visible = false; for (const o of hidden) o.visible = false;
  renderer.shadowMap.needsUpdate = false; MU.uMirrorOn.value = 0; MU.tMirror.value = BLANK;
  U.mirFade.value.set(q.far * 0.65, q.far * 0.95);
  for (const f of hooks) f(true);
  try { renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(rt.t); renderer.clear(); renderer.render(scene, vcam); }
  finally {
    for (const f of hooks) f(false);
    U.mirFade.value.set(0, 0);
    renderer.setClearColor(cc, ca); renderer.setRenderTarget(null);
    sky.visible = skyV; camera.visible = camV; hidden.forEach((o, i) => { o.visible = hid[i]; });
    renderer.shadowMap.needsUpdate = nu;
  }
  MU.tMirror.value = rt.t.texture; MU.uMirrorPlane.value.set(cur.nx, 0, cur.nz, cur.d); MU.uMirrorOn.value = on;
  STAT.on = on; STAT.plane = [+cur.nx.toFixed(3), +cur.nz.toFixed(3), +cur.d.toFixed(2)]; STAT.ms = +(performance.now() - t0).toFixed(2);
}

export { GLASS_GLSL, MU, STAT as MIRROR, addMirrorWall, glassLights, mirrorHide, mirrorPass, onMirror };
