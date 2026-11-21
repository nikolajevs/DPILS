import * as THREE from 'three';
import { fortCar } from '../fortress/arsenals.js';
import { lmStd } from './index.js';
import { lmBench, lmCandelabrum } from './heat-plant.js';
import { lmPipL } from './university.js';
import { lmBar, lmBoxL, lmLathe } from './helpers.js';
import { LM_FLOWERS, bedSpecies, lmFlowerAtlas, lr } from './tiles.js';
import { LMF, LM_BEDS, bedDist, lmL, lmW } from './core.js';
import { band, vband } from '../buildings/walls.js';
import { COL, M_ASPH, M_PAVE } from '../world/data.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { TERR, subTris } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { GB } from '../core/geometry.js';
import { area2, hb, reversed, sh, triangulate } from '../core/util.js';
import { addLight } from '../world/lamp-light.js';

/* ---- Vienības laukums ----
   The city's main square between Park Hotel Latgola and Vienības nams, where the festival stage and the New Year tree
   stand. Plan from OpenStreetMap (the pedestrian area, way 818019765, and the park beside it); the paving follows the
   aerial view: in the semicircle that cuts into the park a round red-brown rondel, rings of darker setts spreading
   from it over the south-western half of the square, a grid of squares over the rest. A row of round concrete planters
   with flowers along the car park by the hotel and smaller ones along the tram line, tall street lamps, two of them
   wound with light garlands, a stand of tall spruces on the park side (photographs: visitdaugavpils.lv, Wikimedia
   Commons). Frame lat (the hotel's): u along the hotel front, v away from it. */
const SQ = { c: [-92.6, 41.7], r: 10.3,
  ped: [[-43.8, 73], [-35.9, 72.9], [-28.6, 72.9], [-26, 74.8], [-26.1, 79.2], [-26.4, 86.2], [-28.8, 86.3], [-89.5, 88.5], [-121.9, 89.2], [-142.9, 89.5], [-143.1, 84.1], [-142.9, 43], [-103.5, 43.4],
    [-103.3, 41.1], [-102.5, 39.1], [-101.5, 37.4], [-99.7, 35.2], [-97.5, 33.6], [-95.3, 32.4], [-91.7, 31.4], [-88.5, 31.5], [-85.2, 32.6], [-82, 34.8], [-69.8, 23.5], [-64.7, 18.4], [-51.1, 4.9], [-45, 3.5], [-45, 4.4]] };
const LM_BOWLS = [];   // round planters, filled with flowers by lmGrounds
const SQ_SPRUCES = [[-104, 27, 1.5], [-99, 21, 1.35], [-95.5, 28.5, 1.55], [-91.5, 22.5, 1.4], [-87, 27.5, 1.5], [-85.5, 19.5, 1.3], [-81, 24.5, 1.45], [-95, 14.5, 1.3], [-101, 13.5, 1.45], [-108, 20.5, 1.35], [-77.5, 17.5, 1.3], [-89.5, 11, 1.4], [-112, 28, 1.3]]
  .map(([u, v, sc]) => { const [x, z] = lmW(LMF.lat, u, v); return [x, z, sc]; });
function lmSquare(K) {
  const f = LMF.lat, G = K.plain, PED = SQ.ped, [cu, cv] = SQ.c;
  const inPed = (u, v) => lmPipL([u, v], PED) && Math.hypot(u - cu, v - cv) > 0.3;
  // paving lines and the rondel, a layer draped over the square's paving
  const b = new GB(false), DARK = hb('#8d8780'), RED = hb('#8e5c4c'), LIGHT = hb('#b9b5ae');
  const quad = (A, B, Cc, D, col) => { const k = [A, B, Cc, D].map(([u, v]) => { const [x, z] = lmW(f, u, v); return b.vert(x, 0, z, 0, 1, 0, col); }); b.triUp(k[0], k[1], k[2]); b.triUp(k[0], k[2], k[3]); };
  const strip = (u0, v0, u1, v1, w, col) => { const L = Math.hypot(u1 - u0, v1 - v0), nu = -(v1 - v0) / L * w / 2, nv = (u1 - u0) / L * w / 2;
    quad([u0 + nu, v0 + nv], [u1 + nu, v1 + nv], [u1 - nu, v1 - nv], [u0 - nu, v0 - nv], col); };
  const R = 46;   // rings within this radius of the rondel, the grid of squares beyond it
  for (let r = 15; r <= R; r += 5.2) for (let a = -Math.PI; a < Math.PI; a += 0.9 / r) { const a1 = a + 0.9 / r, u0 = cu + Math.cos(a) * r, v0 = cv + Math.sin(a) * r, u1 = cu + Math.cos(a1) * r, v1 = cv + Math.sin(a1) * r;
    if (inPed((u0 + u1) / 2, (v0 + v1) / 2)) strip(u0, v0, u1, v1, 0.32, DARK); }
  for (let k = 0; k < 64; k++) { const a = k / 64 * 2 * Math.PI; for (let r = SQ.r + 0.4; r < R; r += 1) { const u0 = cu + Math.cos(a) * r, v0 = cv + Math.sin(a) * r, u1 = cu + Math.cos(a) * (r + 1), v1 = cv + Math.sin(a) * (r + 1);
    if (k % 4 === 0 && inPed((u0 + u1) / 2, (v0 + v1) / 2)) strip(u0, v0, u1, v1, 0.2, DARK); } }
  const G7 = 7.5, grid = (u, v) => inPed(u, v) && Math.hypot(u - cu, v - cv) > R + 0.5;
  for (let u = -142.5; u < -26; u += G7) for (let v = 3.5; v < 89.5; v += 1) if (grid(u, v + 0.5)) strip(u, v, u, v + 1, 0.3, DARK);
  for (let v = 4; v < 89.5; v += G7) for (let u = -143; u < -26; u += 1) if (grid(u + 0.5, v)) strip(u, v, u + 1, v, 0.3, DARK);
  // the rondel: red-brown disc in a ring of light setts edged with dark lines
  const disc = (r0, r1, col, n = 48) => { for (let k = 0; k < n; k++) { const a0 = k / n * 2 * Math.PI, a1 = (k + 1) / n * 2 * Math.PI, P = (r, a) => [cu + Math.cos(a) * r, cv + Math.sin(a) * r];
    quad(P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a1), col); } };
  disc(4.2, SQ.r, LIGHT); disc(0, 4.2, RED); disc(4.2, 4.5, DARK); disc(SQ.r - 0.3, SQ.r, DARK); disc(1.3, 1.5, hb('#6b4136'));
  const m = b.mesh(M_PAVE); if (m) { m.renderOrder = -36.6; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); }
  // the car park in front of the hotel (OSM way 818019767; the city data has no car parks): asphalt, white stall lines
  // and cars in angled stalls on both sides of the one-way aisle
  { const PK = [[-21.7, 5.1], [-43.6, 5], [-43.8, 73], [-35.9, 72.9], [-28.6, 72.9], [-22.6, 70]];
    let r = []; for (const [u, v] of PK) r.push(...lmW(f, u, v)); r = new Float32Array(r); if (area2(r) < 0) r = reversed(r);
    const t0 = triangulate([r]), { flat, tris } = TERR.on ? subTris(t0.flat, t0.tris, 0.25) : t0, a = new GB(false); a.ensure(flat.length / 2); const v0 = a.v;
    for (let i = 0; i < flat.length; i += 2) a.vert(flat[i], 0, flat[i + 1], 0, 1, 0, hb('#5a5b5c')); for (let i = 0; i < tris.length; i += 3) a.triUp(v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2]);
    const am = a.mesh(M_ASPH); if (am) { am.renderOrder = -34.4; am.frustumCulled = false; am.receiveShadow = true; scene.add(am); }
    const lines = new GB(false), dl = [0.866, 0.5], WHT = hb('#d8d8d4'), COLS = ['#e8e8e6', '#1d1f22', '#8d9196', '#5b6067', '#7a1f22', '#1f3f6e', '#c9c6bd', '#2f4a35', '#b8bcc0'];
    const dir = [f[2] * dl[0] - f[3] * dl[1], f[3] * dl[0] + f[2] * dl[1]];
    for (const uc of [-38.2, -25.6]) for (let v = 9; v < 70; v += 2.9) {
      { const vl = v - 1.45, A = lmW(f, uc - dl[0] * 2.5, vl - dl[1] * 2.5), B = lmW(f, uc + dl[0] * 2.5, vl + dl[1] * 2.5), n = [-dir[1] * 0.06, dir[0] * 0.06];   // the line between two stalls
        const k = [[A[0] + n[0], A[1] + n[1]], [B[0] + n[0], B[1] + n[1]], [B[0] - n[0], B[1] - n[1]], [A[0] - n[0], A[1] - n[1]]].map(([x, z]) => lines.vert(x, 0, z, 0, 1, 0, WHT)); lines.triUp(k[0], k[1], k[2]); lines.triUp(k[0], k[2], k[3]); }
      if (lr() < 0.8) { const [x, z] = lmW(f, uc, v); fortCar(G, x, z, dir[0], dir[1], hb(COLS[Math.floor(lr() * COLS.length)]), false); } }
    const lm = lines.mesh(M_PAVE); if (lm) { lm.renderOrder = -33.9; lm.frustumCulled = false; lm.receiveShadow = true; scene.add(lm); } }
  // round concrete planters: a row along the car park by the hotel, smaller ones along the tram line
  const CONC = hb('#b4b0a7'), SOIL = hb('#4a3a2c'), KINDS = [[4, 6], [5, 2], [0, 1], [6, 4], [2, 3]];
  const bowl = (u, v, r, k) => { const [x, z] = lmW(f, u, v), h = 0.5;
    lmLathe(G, x, z, 0, [[r * 0.6, 0], [r * 0.8, 0.08], [r, h - 0.05], [r - 0.04, h], [r - 0.13, h], [r - 0.13, h - 0.1]], 24, CONC);
    lmLathe(G, x, z, h - 0.1, [[r - 0.13, 0], [0, 0.02]], 16, SOIL); LM_BOWLS.push({ x, z, r: r - 0.1, y: h - 0.08, kinds: KINDS[k % KINDS.length] }); };
  for (let k = 0; k < 9; k++) bowl(-47, 15 + k * 6.6, 0.95, k);
  for (let k = 0; k < 9; k++) bowl(-140.5, 47 + k * 4.8, 0.6, k + 2);
  // tall lamps, two wound with light garlands
  const POLE = hb('#5b6064');
  for (const [u, v, gar] of [[-118, 66, 1], [-92, 74, 0], [-66, 62, 1], [-62, 30, 0], [-128, 52, 0]]) {
    const [x, z] = lmW(f, u, v); lmLathe(G, x, z, 0, [[0.16, 0], [0.12, 0.6], [0.08, 11.5], [0.06, 12.2]], 10, POLE);
    lmBar(G, [x, 11.9, z], [x + f[2] * 1.3, 12.2, z + f[3] * 1.3], 0.08, POLE); lmBoxL(K.globe, [x + f[2] * 1.3, z + f[3] * 1.3, f[2], f[3]], -0.35, 0.35, -0.16, 0.16, 11.95, 12.15, hb('#f2efe6'));
    addLight(x + f[2] * 1.3, 11.9, z + f[3] * 1.3, 0, Math.atan2(f[3], f[2])); if (gar) addLight(x, 7.6, z, 2);   // their light (src/world/lamp-light.js)
    if (gar) for (let k = 0; k < 14; k++) { const a = k / 14 * 2 * Math.PI, gx = x + Math.cos(a) * 0.75, gz = z + Math.sin(a) * 0.75; lmBar(K.globe, [gx, 6.0, gz], [gx, 9.2, gz], 0.035, hb('#fff2d8')); }
    if (gar) for (const y of [6.0, 9.2]) lmLathe(G, x, z, y, [[0.78, 0], [0.78, 0.05], [0.72, 0.05], [0.72, 0]], 16, POLE);
  }
}

function lmGrounds(K) {
  const f = LMF.vn, G = K.plain, CURB = hb('#9a958e');
  // paved forecourt of the theatre and of the concert-hall wing
  { const pv = new GB(false), col = hb('#988779'), c = [[-10.5, -21.5], [30.5, -21.5], [30.5, 34.5], [-10.5, 34.5]].map(([u, v]) => lmW(f, u, v)), k = c.map(([x, z]) => pv.vert(x, 0, z, 0, 1, 0, col));
    pv.triUp(k[0], k[1], k[2]); pv.triUp(k[0], k[2], k[3]); const m = pv.mesh(M_PAVE); m.renderOrder = -37.3; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); }
  const flowerTex = lmFlowerAtlas(), matFlower = lmStd({ map: flowerTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }, 'lm-flower');
  const inst = LM_FLOWERS.map(() => []);
  for (const b of LM_BEDS) {
    // outline: rounded rectangle, 6 points per corner
    const ring = grow => { const pts = [], hu = b.hu + grow, hv = b.hv + grow, r = b.r + grow;
      for (const [sx, sy, a0] of [[1, 1, 0], [-1, 1, 0.5], [-1, -1, 1], [1, -1, 1.5]]) for (let k = 0; k <= 6; k++) { const a = (a0 + k / 12) * Math.PI; pts.push(lmW(f, b.cu + sx * (hu - r) + Math.cos(a) * r, b.cv + sy * (hv - r) + Math.sin(a) * r)); }
      let flat = []; for (const p of pts) flat.push(p[0], p[1]); if (area2(flat) < 0) flat = Array.from(reversed(flat)); return flat; };
    const inner = ring(0), outer = ring(0.16);
    vband(G, outer, 0, 0.18, CURB); band(G, inner, outer, 0.18, sh(CURB, 1.05), false); vband(G, inner, 0.13, 0.18, sh(CURB, 0.9), -1);
    for (let i = 0; i < outer.length / 2; i++) { const j = (i + 1) % (outer.length / 2); COL.add(outer[2 * i], outer[2 * i + 1], outer[2 * j], outer[2 * j + 1], 0, 0); }
    // soil surface painted with the planting pattern
    const PXM = 32, W = Math.round(2 * b.hu * PXM), H = Math.round(2 * b.hv * PXM), cv = mkCanvas(W, H), g = cv.getContext('2d'), id = g.createImageData(W, H), d = id.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const du = (x + 0.5) / PXM - b.hu, dv = (y + 0.5) / PXM - b.hv, sp = bedSpecies(b, du, dv, bedDist(b, b.cu + du, b.cv + dv)), n = 0.42 + Math.random() * 0.3;
      const c = sp < 0 ? [92, 74, 58] : (Math.random() < 0.45 ? [58, 88, 40] : hb(LM_FLOWERS[sp].col)), k = 4 * (y * W + x);
      d[k] = c[0] * n; d[k + 1] = c[1] * n; d[k + 2] = c[2] * n; d[k + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const sp = [], uv = [], ix = [], [cx, cz] = lmW(f, b.cu, b.cv); sp.push(cx, 0.13, cz); uv.push(0.5, 0.5);
    for (let i = 0; i < inner.length / 2; i++) { const [lu, lv] = lmL(f, inner[2 * i], inner[2 * i + 1]); sp.push(inner[2 * i], 0.13, inner[2 * i + 1]); uv.push((lu - b.cu + b.hu) / (2 * b.hu), 1 - (lv - b.cv + b.hv) / (2 * b.hv)); }
    const n = inner.length / 2; for (let i = 0; i < n; i++) ix.push(0, 1 + (i + 1) % n, 1 + i);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(sp.length).fill(0).map((_, k) => k % 3 === 1 ? 1 : 0), 3)); sg.setIndex(ix);
    const sm = new THREE.Mesh(sg, lmStd({ map: toTex(cv, true, false), roughness: 0.95, metalness: 0, side: THREE.DoubleSide }, 'lm-bed')); sm.receiveShadow = true; scene.add(sm);
    // plants on a jittered grid
    for (let a = -b.hu; a < b.hu; a += 0.24) for (let c = -b.hv; c < b.hv; c += 0.24) {
      const du = a + (lr() - 0.5) * 0.18, dv = c + (lr() - 0.5) * 0.18, dd = bedDist(b, b.cu + du, b.cv + dv); if (dd > -0.1) continue;
      const s = bedSpecies(b, du, dv, dd); if (s < 0) continue;
      const [x, z] = lmW(f, b.cu + du, b.cv + dv); inst[s].push(x, 0.13, z, lr() * 6.283, 0.85 + lr() * 0.35);
    }
    // candelabra at the ends of the carpet bed, on granite pedestals
    for (const lv of b.lamps) { lmBoxL(G, f, b.cu - 0.5, b.cu + 0.5, lv - 0.5, lv + 0.5, 0, 0.75, hb('#8d8780'), false); const [x, z] = lmW(f, b.cu, lv); lmCandelabrum(G, K.globe, x, z, 0.75, Math.atan2(f[3], f[2])); }
  }
  // flowers in the round planters of Vienības laukums: two kinds to a bowl, set on a jittered grid inside its rim
  for (const b of LM_BOWLS) { const kinds = b.kinds;
    for (let a = -b.r; a < b.r; a += 0.22) for (let c = -b.r; c < b.r; c += 0.22) { const du = a + (lr() - 0.5) * 0.16, dv = c + (lr() - 0.5) * 0.16; if (Math.hypot(du, dv) > b.r - 0.14) continue;
      inst[kinds[Math.hypot(du, dv) < b.r * 0.45 ? 0 : 1]].push(b.x + du, b.y, b.z + dv, lr() * 6.283, 0.8 + lr() * 0.35); } }
  // benches facing the beds
  for (const v of [6.6, 11.6, 17.8, 22.9]) lmBench(G, f, -21.6, v, 1);
  for (const v of [-15.4, -10.6]) lmBench(G, f, 1.2, v, 1);
  // one instanced mesh per plant: two crossed upright cards and one seen from above
  const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3(), UPY = new THREE.Vector3(0, 1, 0), C3 = new THREE.Color();
  LM_FLOWERS.forEach((fl, s) => {
    const list = inst[s], n = list.length / 5; if (!n) return;
    const w = 0.36, h = fl.h, yt = h * 0.78, u0 = s / 8, u1 = (s + 1) / 8;
    const pos = [-w / 2, 0, 0, w / 2, 0, 0, w / 2, h, 0, -w / 2, h, 0, 0, 0, -w / 2, 0, 0, w / 2, 0, h, w / 2, 0, h, -w / 2, -w / 2, yt, -w / 2, w / 2, yt, -w / 2, w / 2, yt, w / 2, -w / 2, yt, w / 2];
    const uvs = [u0, 0.5, u1, 0.5, u1, 1, u0, 1, u0, 0.5, u1, 0.5, u1, 1, u0, 1, u0, 0, u1, 0, u1, 0.5, u0, 0.5];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(36).fill(0).map((_, k) => k % 3 === 1 ? 1 : 0), 3)); geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
    const im = new THREE.InstancedMesh(geo, matFlower, n);
    for (let i = 0; i < n; i++) { const sc = list[5 * i + 4]; Q4.setFromAxisAngle(UPY, list[5 * i + 3]); M4.compose(V3.set(list[5 * i], list[5 * i + 1], list[5 * i + 2]), Q4, S3.set(sc, sc * (0.9 + lr() * 0.2), sc)); im.setMatrixAt(i, M4); const t = 0.85 + lr() * 0.25; im.setColorAt(i, C3.setRGB(t, t, t)); }
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.frustumCulled = false; im.receiveShadow = true; scene.add(im);
  });
}

export { SQ_SPRUCES, lmGrounds, lmSquare };
