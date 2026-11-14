import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { scene } from '../render/renderer.js';
import { area2, pip } from '../core/util.js';

/* ---------- landmarks modelled from photographs ----------
   Vienības nams (Unity House, architect Verners Vitands, 1936–37) and Park Hotel Latgola with the Latgola shopping
   centre are drawn by hand here instead of by the generic façade atlas. Each lives in a local frame: u runs from the
   main façade into the building, v along it (metres); origin and axes come from the cadastre outline, which still
   gives collisions and the map footprint. Proportions are measured on photographs (Wikimedia Commons,
   visitdaugavpils.lv, celotajs.lv, militaryheritagetourism.info, neighborhood.lv); the portico, its 29.4 m width,
   the 18 m cornice and the 12 m columns match the cadastre outline. */
const LMF = { vn: [-1488, 1328.7, 0.8678, -0.4969], lat: [-1448.3, 1174.1, 0.8528, -0.5223], du: [-1497.7, 1537.4, -0.8604, 0.5097], p1: [-2088.2, 1366.8, 0.8607, -0.5090], ren: [-1759.53, 1019.91, -0.5075, -0.8616], ves: [-1172.1, 1098.1, -0.523, -0.852], tv: [-405.55, 1114.19, 0.5015, 0.8652], vk: [-810.09, 820.13, 0.7919, -0.6106], kp: [922.3, -465.5, -0.3338, -0.9426], sc: [-1142.8, 1903.9, 0.9224, -0.3863] };
const lmW = (f, u, v) => [f[0] + u * f[2] - v * f[3], f[1] + u * f[3] + v * f[2]];
const lmL = (f, x, z) => [(x - f[0]) * f[2] + (z - f[1]) * f[3], -(x - f[0]) * f[3] + (z - f[1]) * f[2]];
// a cadastre building whose outline contains one of these points is left to buildLandmarks
const LM_KEYS = [lmW(LMF.vn, 40, 15), lmW(LMF.lat, 10, 30), lmW(LMF.lat, 50, 30), lmW(LMF.lat, 2.6, 64.6),
  lmW(LMF.du, 8, 38), lmW(LMF.p1, 20, 80), lmW(LMF.p1, 36.2, 3), lmW(LMF.p1, 70, -15), lmW(LMF.ren, 22, 30), lmW(LMF.ren, 5, 54), lmW(LMF.ren, 20, 12), lmW(LMF.ves, 7, 10), lmW(LMF.vk, 14, 42), lmW(LMF.vk, 14, 8), lmW(LMF.vk, 14, 76),
  lmW(LMF.kp, 50, 18), lmW(LMF.kp, 110, 52), lmW(LMF.kp, 53.8, 47), lmW(LMF.kp, -24.5, 94), lmW(LMF.sc, 20, 20)];
// outlines that are not real buildings: the canopy of the cinema Renesanse, mapped in OSM as its only building:part way
const LM_DROP = [lmW(LMF.ren, -8.85, 40.6), lmW(LMF.vk, 1.55, 41.75), lmW(LMF.kp, 69.5, -2.4)];   // canopies that OSM maps as building parts
function lmDrops(ring, bb) { if (Math.abs(area2(ring)) > 150) return false; for (const [x, z] of LM_DROP) if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(x, z, ring)) return true; return false; }
function lmOwns(ring, bb) { for (const [x, z] of LM_KEYS) if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(x, z, ring)) return true; return false; }
/* Flower beds by Vienības nams (frame vn): the long carpet bed in the garden strip in front of the portico with a
   five-globe candelabrum at each end, and the bed in front of the concert-hall wing towards Rīgas iela. */
const LM_BEDS = [
  { cu: -17.5, cv: 14.65, hu: 3.0, hv: 13.65, r: 2.2, kind: 0, lamps: [2.6, 26.7] },
  { cu: 11, cv: -13, hu: 8.0, hv: 4.0, r: 3.6, kind: 1, lamps: [] }
];
function bedDist(b, u, v) { const qx = Math.abs(u - b.cu) - (b.hu - b.r), qy = Math.abs(v - b.cv) - (b.hv - b.r); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - b.r; }
function lmClear(x, z) { const [u, v] = lmL(LMF.vn, x, z); for (const b of LM_BEDS) if (bedDist(b, u, v) < 1.2) return true; return false; }

/* textured geometry with sRGB vertex colour and a per-vertex "lights on at night" flag */
class LMB {
  constructor() { this.p = []; this.n = []; this.t = []; this.c = []; this.l = []; this.i = []; }
  q(A, B, Cc, D, n, uv, c, lit = 0) {
    if (STATE.GBC) { const sh2 = Q => [Q[0], Q[1] + STATE.GBC(Q[0], Q[1], Q[2]), Q[2]]; A = sh2(A); B = sh2(B); Cc = sh2(Cc); D = sh2(D); }
    const k = this.p.length / 3;
    for (const [j, Q] of [A, B, Cc, D].entries()) { this.p.push(Q[0], Q[1], Q[2]); this.n.push(n[0], n[1], n[2]); this.t.push(uv[2 * j], uv[2 * j + 1]); this.c.push(c[0] / 255, c[1] / 255, c[2] / 255); this.l.push(lit); }
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
    if ((uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] >= 0) this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
    else this.i.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }
  mesh(mat, shadow = true) {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aLit', new THREE.Float32BufferAttribute(this.l, 1)); g.setIndex(this.i);
    const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
  }
}
const LMWHITE = [255, 255, 255];

export { LMB, LMF, LMWHITE, LM_BEDS, LM_KEYS, bedDist, lmClear, lmDrops, lmL, lmOwns, lmW };
