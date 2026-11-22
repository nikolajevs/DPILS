import * as THREE from 'three';
import { BGRID, BLD } from '../world/data.js';
import { SAMPLE_GLSL, std } from './materials.js';
import { U, camera, scene } from './renderer.js';
import { mirrorShow, onMirror } from './mirror.js';

/* ---------- the houses in the glass ----------
   The mirror of the glass (src/render/mirror.js) draws what moves — you, the players, the trams — every frame. The
   houses themselves are merged into tiles of 800 m, millions of triangles: a second pass of them would double the
   frame (+12–20 ms measured when they took ~1000 draw calls; batched now, src/render/batch.js, the triangles stay). In the glass they are a simple model instead: the walls of every house within R of the eye, extruded from its
   footprint (src/world/data.js BLD) to its height, in the colour of its walls, with a grid of dark windows by its
   storeys that light up at night as the windows of the city do. One draw call, rebuilt when the eye has moved MOVE metres.
   Seen dimly in a pane, it puts the street where it is — the houses across it, their parallax as you walk — and hides
   what moves behind a house; past R, and over the roofs, the city cubes show as before. */
const R = 120, MOVE = 25, MAXW = 9000, DEF = [217, 210, 196];
const pos = new Float32Array(MAXW * 12), nrm = new Float32Array(MAXW * 12), col = new Float32Array(MAXW * 12), wal = new Float32Array(MAXW * 12), idx = new Uint32Array(MAXW * 6);
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aWall', new THREE.BufferAttribute(wal, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
geo.setDrawRange(0, 0);
// aWall: metres along the wall, metres up it, the storey height of the house (the window grid)
const mat = std({ vertexColors: true, roughness: 0.9, metalness: 0 }, 'mirror-city', s => {
  s.uniforms.uNight = U.night; s.uniforms.uLit = U.lit;
  s.vertexShader = 'attribute vec3 aWall; varying vec3 vWall;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall;');
  s.fragmentShader = 'uniform float uNight; uniform float uLit; varying vec3 vWall;\n' + SAMPLE_GLSL + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    vec2 wc = vec2(vWall.x / 3.2, vWall.y / vWall.z), wf = fract(wc), wi = floor(wc);
    float win = step(0.24, wf.x) * step(wf.x, 0.76) * step(0.3, wf.y) * step(wf.y, 0.82) * step(0.5, vWall.y);
    float wl = step(1.0 - uLit, h12(wi + vec2(vWall.z * 37.0, 0.0)));   // the lit windows of the evening
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.04, 0.05), win);`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.12, win);')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += win * wl * uNight * vec3(1.0, 0.68, 0.36) * 1.3;');
});
const mesh = new THREE.Mesh(geo, mat);
mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noProbe = true;
scene.add(mesh); mirrorShow(mesh);   // visible (and empty) till the first mirror: the warm-up of the shaders compiles it
const STAT = { walls: 0, at: null };
let cx = 1e9, cz = 1e9;
function build(x, z) {
  cx = x; cz = z; let n = 0;
  const seen = new Set(), c0 = Math.floor((x - R) / 60), c1 = Math.floor((x + R) / 60), r0 = Math.floor((z - R) / 60), r1 = Math.floor((z + R) / 60);
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) {
    const l = BGRID.get((i + 2000) * 4096 + j + 2000); if (!l) continue;
    for (const b of l) {
      if (seen.has(b)) continue; seen.add(b);
      const B = BLD[b], bb = B.bb; if (B.base > 0 || bb[2] < x - R || bb[0] > x + R || bb[3] < z - R || bb[1] > z + R) continue;   // a canopy on posts: not a wall
      const r = B.ring, m = r.length >> 1, t = B.tint || DEF, top = B.top, fh = Math.max(2.6, Math.min(4.5, B.fh || 3.2));
      for (let k = 0; k < m && n < MAXW; k++) {
        const k2 = (k + 1) % m, x1 = r[2 * k], z1 = r[2 * k + 1], x2 = r[2 * k2], z2 = r[2 * k2 + 1], dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
        if (L < 0.3) continue;
        const nx = dz / L, nz = -dx / L, v = n * 4, o = v * 3;
        // a (x1, 0), c (x2, 0), d (x2, top), e (x1, top): the winding of wallQuad (src/buildings/walls.js)
        pos.set([x1, 0, z1, x2, 0, z2, x2, top, z2, x1, top, z1], o);
        for (let q = 0; q < 4; q++) { nrm[o + q * 3] = nx; nrm[o + q * 3 + 1] = 0; nrm[o + q * 3 + 2] = nz; col[o + q * 3] = t[0] / 255; col[o + q * 3 + 1] = t[1] / 255; col[o + q * 3 + 2] = t[2] / 255; }
        wal.set([0, 0, fh, L, 0, fh, L, top, fh, 0, top, fh], o);
        idx.set([v + 1, v, v + 3, v + 1, v + 3, v + 2], n * 6);
        n++;
      }
    }
  }
  for (const a of [geo.attributes.position, geo.attributes.normal, geo.attributes.color, geo.attributes.aWall]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 12); a.needsUpdate = true; }
  geo.index.clearUpdateRanges(); geo.index.addUpdateRange(0, n * 6); geo.index.needsUpdate = true;
  geo.setDrawRange(0, n * 6);
  STAT.walls = n; STAT.at = [Math.round(x), Math.round(z)];
}
onMirror(on => {
  if (!on) { mesh.visible = false; return; }
  const p = camera.position; if (Math.hypot(p.x - cx, p.z - cz) > MOVE) build(p.x, p.z);
  mesh.visible = true;
});

export { STAT as MIRROR_CITY };
