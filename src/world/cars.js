import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene } from '../render/renderer.js';
import { std } from '../render/materials.js';

/* ---------- the cars of the city: ready BMW models instead of the old procedural boxes ----------
   Four single-material, vertex-coloured GLBs baked by tools/bmw.mjs (all CC BY 4.0, credits in models/README.md):
     models/bmw_sedan.glb   BMW M3 G80    by SharkyStudios   (kind 0)
     models/bmw_hatch.glb   BMW M140i F20 by Ddiaz Design    (kind 1)
     models/bmw_suv.glb     BMW X6M F96   by SharkyStudios   (kind 2)
     models/bmw_police.glb  the G80 in Latvian police livery (white, blue band, light bar)
   Each is in the city frame: metres, nose along +x, wheels on y = 0, footprint centred on the origin. The body paint is
   baked pure white (255) and every other part — glass, tyres, chrome, lamps, the police band — stays below 240, so a
   per-instance colour tints only the paint: carMat gates instanceColor on near-white vertices (the mask below). The
   files are asked for as soon as this module is imported and decoded with EXT_meshopt_compression; the meshes are
   placed by placeStaticCars (a step of its own in src/main.js) once they are in. The car parks of parking.js instance
   the same geometries themselves (they change through the day); the police, hospital, Unity Square and Culture Palace
   cars register here with addStaticCar and stand forever. */
let geos = null, policeG = null, ready = null;
const staticCars = [];   // { x, z, a, kind, col: [r, g, b] sRGB bytes, police }
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);

// instanceColor reaches only the paint: the raw vertex colour (sRGB bytes, normalised) is near 1 on the body and below
// 0.95 on glass / tyres / chrome / the police band, so the mask leaves those parts their own colour
const carMat = std({ vertexColors: true, roughness: 0.5, metalness: 0.2 }, 'bmwcar', s => {
  const out = s.vertexShader.replace('vColor.rgb *= instanceColor.rgb;',
    'float carPaint = smoothstep( 0.955, 0.995, max( color.r, max( color.g, color.b ) ) );\n\tvColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, carPaint );');
  if (out === s.vertexShader) console.warn('color_vertex changed: the car paint mask is not applied');
  s.vertexShader = out;
});

// The wheels bake light: the sedan / police rim and tyre sidewall are pure white, the hatch / SUV rims silver, so they
// read as bare metal rather than rubber. Paint the whole wheel black. A wheel is a circle of radius ~0.3 m in the x-y
// plane about the axle (|x| ~ 1.55 m, y ~ 0.3 m), outboard at |z| > 0.55 m; everything inside that circle is wheel
// (tyre, sidewall, rim) whatever its baked colour. The body arch sits just outside it (radius >= 0.4 m) and stays paint.
// Chromatic non-white parts that dip into the circle — the police band, lamps, glass — keep their colour.
function blackenWheels(g) {
  const p = g.attributes.position, c = g.attributes.color; if (!p || !c) return;
  const BLACK = 12 / 255;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y > 0.7 || Math.abs(z) < 0.55) continue;
    if (Math.hypot(Math.abs(x) - 1.55, y - 0.30) > 0.34) continue;
    const r = c.getX(i), gg = c.getY(i), b = c.getZ(i), mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    if (mx < 250 / 255 && mx - mn >= 0.06) continue;
    c.setXYZ(i, BLACK, BLACK, BLACK);
  }
}

function initCars() {
  if (ready) return;
  ready = import('three/addons/libs/meshopt_decoder.module.js').then(({ MeshoptDecoder }) => {
    const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
    const grab = f => new Promise(r => L.load(f, g => r(g.scene), undefined, () => r(null)));
    return Promise.all([grab('models/bmw_sedan.glb'), grab('models/bmw_hatch.glb'), grab('models/bmw_suv.glb'), grab('models/bmw_police.glb')]);
  }).then(scenes => {
    // EXT_meshopt_compression quantises the attributes (normalised integers in [-1,1]) and keeps the real scale /
    // ride height in the node matrix, so bake that matrix into float vertices: metres, wheels on y = 0, nose on +x
    const ex = sc => {
      let g = null;
      if (sc) sc.traverse(o => {
        if (!o.isMesh || g) return;
        o.updateWorldMatrix(true, false);
        const src = o.geometry.clone();
        for (const name of ['position', 'normal', 'color']) {
          const a = src.attributes[name]; if (!a) continue;
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j);
          src.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
        }
        src.applyMatrix4(o.matrixWorld);
        blackenWheels(src);
        g = src;
      });
      return g;
    };
    geos = [ex(scenes[0]), ex(scenes[1]), ex(scenes[2])]; policeG = ex(scenes[3]);
  }).catch(e => { console.warn('cars: BMW models failed to load', e); geos = [null, null, null]; policeG = null; });
}
const carGeo = kind => (geos ? geos[kind] : null);
const policeGeometry = () => policeG;
const carsReady = () => ready;
// a car that stands forever (police, hospital, the squares): col is the sRGB byte triple of its paint, police uses the
// police model with white paint so its blue band and light bar keep their colour
function addStaticCar(x, z, a, kind, col, police, y) { staticCars.push({ x, z, a, kind, col, police, y }); }

async function placeStaticCars() {
  if (ready) await ready;
  if (!geos || !staticCars.length) return;
  const colorOf = c => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
  const WHITE = new THREE.Color(1, 1, 1);
  // gather by 1 km tile and by model (the three body kinds and the police car), so each tile is culled whole
  const tiles = new Map();
  for (const c of staticCars) {
    const g = c.police ? policeG : geos[c.kind]; if (!g) continue;
    const key = Math.floor(c.x / 1000) * 100 + Math.floor(c.z / 1000);
    let t = tiles.get(key); if (!t) tiles.set(key, t = { cx: (Math.floor(c.x / 1000) + 0.5) * 1000, cz: (Math.floor(c.z / 1000) + 0.5) * 1000, lists: new Map() });
    const mk = c.police ? 'p' : c.kind; let l = t.lists.get(mk); if (!l) t.lists.set(mk, l = { g, cars: [] });
    l.cars.push(c);
  }
  for (const t of tiles.values()) for (const { g, cars } of t.lists.values()) {
    const m = new THREE.InstancedMesh(g, carMat, cars.length);
    // the shared vertex shader (src/world/terrain.js) lifts every car by the terrain under it, so the matrix carries
    // no terrain height of its own — baking terrainH here would double it and leave the car floating. y is explicit
    // only where a landmark flattens its own platform (the hospital base), and is already relative to the terrain
    cars.forEach((c, i) => { Q.setFromAxisAngle(UP, c.a); M.compose(V.set(c.x, c.y !== undefined ? c.y : 0, c.z), Q, ONE); m.setMatrixAt(i, M); m.setColorAt(i, c.police ? WHITE : colorOf(c.col)); });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = m.receiveShadow = true; m.computeBoundingSphere(); if (m.boundingSphere) m.boundingSphere.radius += 6;
    scene.add(m);
  }
}

initCars();
export { addStaticCar, carGeo, carMat, carsReady, initCars, placeStaticCars, policeGeometry };