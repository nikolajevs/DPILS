import * as THREE from 'three';
import { LAMPS } from './streets.js';
import { COL, inBuilding, inWater, matPlain } from './data.js';
import { glowTex } from '../render/textures.js';
import { bridgeY, terrainH } from './terrain.js';
import { upNoLamp } from './underpass.js';
import { walkH } from './walkgrid.js';
import { addLight, buildLampLight, lampLight } from './lamp-light.js';
import { hook, scene } from '../render/renderer.js';
import { GB, box, lathe } from '../core/geometry.js';
import { hb, lin } from '../core/util.js';

/* ---------- street lamps ----------
   The poles, the heads, their glass and the halos round it are instanced meshes, one set per square kilometre: a single
   mesh for the whole city could not be culled and drew all its 17 000 lamps (and their shadows) in every frame.
   The light itself is not drawn here: each lamp is a light of src/world/lamp-light.js, which every lit material takes
   (the flat additive discs that stood for it lit grass as brightly as asphalt and never touched a wall or a car). At
   night only the glass under the head glows; the housing stays grey metal. */
const LTILE = 1000;
let lampLens = null, lampHalos = null, matLensDay, matLensNight;

/* The halo: a soft glow round the glass, facing the camera — the haze of the night air round a bright lamp. It shows
   on every quality level (the bloom of the post-processing is off on the lower ones). The glass faces down, so seen
   from above the halo dims; far away it keeps a few pixels on the screen and dims as it grows. */
function haloMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { tGlow: { value: glowTex() } },
    vertexShader: `#include <common>
      varying vec2 vUv; varying float vA;
      void main() {
        vec4 c = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        c.y += terrainH( c.xz );
        vec3 e = cameraPosition - c.xyz; float d = length( e );
        float s = max( 1.0, d * 0.0025 );
        vA = ( 0.2 + 0.8 * smoothstep( -0.05, 0.35, - e.y / d ) ) * smoothstep( 1.5, 4.0, d ) / ( s * s );
        vec4 mv = viewMatrix * c; mv.xy += position.xy * 1.7 * s; mv.z += min( 1.2, d * 0.3 );   // towards the eye, off its own head
        vUv = uv; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D tGlow; varying vec2 vUv; varying float vA;
      void main() {
        float g = texture2D( tGlow, vUv ).a;
        gl_FragColor = vec4( vec3( 1.0, 0.72, 0.42 ) * ( g * g * 0.5 * vA ), 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
}

async function buildLamps() {
  const n = LAMPS.length / 3, ok = [];
  for (let i = 0; i < n; i++) { const x = LAMPS[3 * i], z = LAMPS[3 * i + 1]; if (!inBuilding(x, z) && !inWater(x, z) && !upNoLamp(x, z)) ok.push(i); }
  const pole = new GB(false), PC = hb('#55595c');
  lathe(pole, 0, 0, 0, [[0.11, 0], [0.08, 7.6], [0.06, 8.2]], 6, 0, PC); box(pole, 0.7, 0, 1, 0, 0.75, 0.04, 8.05, 8.15, PC);
  const pg = pole.mesh(matPlain).geometry;
  const head = new THREE.BoxGeometry(0.7, 0.16, 0.32); head.translate(1.35, 7.98, 0);
  const lens = new THREE.BoxGeometry(0.58, 0.03, 0.24); lens.translate(1.37, 7.89, 0);   // the glass under the head
  const halo = new THREE.PlaneGeometry(1, 1);
  const matHead = hook(new THREE.MeshStandardMaterial({ color: lin('#c9cccd'), roughness: 0.4 }));
  matLensDay = hook(new THREE.MeshStandardMaterial({ color: lin('#e6e8e4'), roughness: 0.15 }));
  matLensNight = hook(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.8, 0.55).multiplyScalar(6) }));
  const matHalo = haloMaterial();
  const tiles = new Map();
  for (const i of ok) { const k = Math.floor(LAMPS[3 * i] / LTILE) * 1000 + Math.floor(LAMPS[3 * i + 1] / LTILE); let t = tiles.get(k); if (!t) tiles.set(k, t = []); t.push(i); }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), q0 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), S1 = new THREE.Vector3(1, 1, 1), bx = new THREE.Box3(), bp = new THREE.Vector3();
  lampLens = []; lampHalos = [];
  for (const list of tiles.values()) {
    let cx = 0, cz = 0; for (const i of list) { cx += LAMPS[3 * i]; cz += LAMPS[3 * i + 1]; } cx /= list.length; cz /= list.length;
    const poles = new THREE.InstancedMesh(pg, matPlain, list.length), heads = new THREE.InstancedMesh(head, matHead, list.length);
    const lenses = new THREE.InstancedMesh(lens, matLensDay, list.length), halos = new THREE.InstancedMesh(halo, matHalo, list.length);
    bx.makeEmpty();
    list.forEach((i, k) => {
      const x = LAMPS[3 * i], z = LAMPS[3 * i + 1], a = LAMPS[3 * i + 2]; q.setFromAxisAngle(up, a);
      const ld = [Math.sin(a), Math.cos(a)], by = bridgeY(x, z, ld[0], ld[1]) + walkH(x, z);   // ld: along the road (the arm is across it)
      M.compose(bp.set(x - cx, by, z - cz), q, S1); poles.setMatrixAt(k, M); heads.setMatrixAt(k, M); lenses.setMatrixAt(k, M);
      const hx = x + Math.cos(-a) * 1.37, hz = z + Math.sin(-a) * 1.37;
      M.compose(bp.set(hx - cx, by + 7.86, hz - cz), q0, S1); halos.setMatrixAt(k, M);
      addLight(hx, by + 7.84, hz, 0, -a, 7.84 + walkH(x, z));   // the light under the glass, its arm towards the road
      // the culling sphere of the tile: the poles reach 8.2 m up; the shaders lift all by the terrain
      const y = by + terrainH(x, z); bx.expandByPoint(bp.set(x - cx - 3, y - 1, z - cz - 3)); bx.expandByPoint(bp.set(x - cx + 3, y + 10, z - cz + 3));
      COL.add(x, z, x + 0.01, z, 0.15, 0);
    });
    const sphere = bx.getBoundingSphere(new THREE.Sphere());
    for (const m of [poles, heads, lenses, halos]) { m.position.set(cx, 0, cz); m.boundingSphere = sphere; m.instanceMatrix.needsUpdate = true; scene.add(m); }
    poles.castShadow = heads.castShadow = true; halos.visible = false; halos.renderOrder = 5; halos.userData.noProbe = true;
    lampLens.push(lenses); lampHalos.push(halos);
  }
  await buildLampLight();   // the park lamps and the lamps of the landmarks are registered by now (buildLandmarks)
  return ok.length;
}
// k: the strength of the lamps — 0 by day, 1 at night (less in the evening, while the sky is still light)
function lampsOn(k) {
  lampLight(k);
  if (!lampLens) return;
  for (const m of lampLens) m.material = k > 0 ? matLensNight : matLensDay;
  for (const m of lampHalos) m.visible = k > 0;
}

export { buildLamps, lampsOn };
