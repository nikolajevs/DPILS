import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { AREAS, COL, M_ASPH, M_DIRT, M_LAND, M_PAVE, ROAD, inBuilding } from '../world/data.js';
import { carGeo, carMat, carsReady } from '../world/cars.js';
import { LAMPS } from '../world/streets.js';
import { CARROAD } from '../transit/transit.js';
import { TERR, subTris, terrainH } from '../world/terrain.js';
import { camera, scene } from '../render/renderer.js';
import { GB, SegGrid, box, lathe, polyA } from '../core/geometry.js';
import { area2, bbox, edgeN, hash, hb, obb, pip, reversed, sh, triangulate } from '../core/util.js';
import { lmClear, lmL } from './core.js';
import { HF, RF } from './hospital.js';
import { spwNoTree } from './speedway.js';
import { fuelNoTree } from './fuel.js';

/* ---- the car parks of the city (parking.js, from OpenStreetMap: every amenity=parking with its aisles and spaces) ----
   - the ground by its surface: asphalt, concrete, paving, gravel or earth, grass pavers; a low kerb where it borders
     a lawn (not along streets, paths or houses); a grass island round a tree that stands deep inside;
   - the stalls, 2.5 × 5 m: as mapped (amenity=parking_space), else square to the mapped aisles on both sides of them,
     else in rows along the longer side of the car park (one along an edge, an aisle, two back to back, ...); a strip
     narrower than 4.4 m takes cars along it, one behind the other. None on a street, a path or a rail, in a house, on
     the forecourt of a fuel station; no more than the capacity mapped. White lines on the paved ones (in about half of
     the yards);
   - the cars: three shapes (saloon, hatchback, people carrier), each car its colour, and as many as stand there at
     that time of day: in the yards most at night, in the car parks of the stores in the evening, at work places in the
     working hours; fewer at work and more at the stores at the weekend. A walker cannot pass through them;
   - the lamps round the larger ones, a P sign at the way in, the lift gates mapped.
   The car parks that a landmark draws itself are left to it: by Vienības laukums and the Culture Palace (by their OSM
   ids), behind the police in the fortress, at the hospital and in the speedway's paddock (by where they are); only the
   lidar trees are kept off them, as off the others. */
const OWN_ID = new Set([818019767, 366845896]);   // unity-square.js, culture-palace.js
const KOM = [-2804.8, -352.4, -0.8720, -0.4895];   // the Commandant's house in the fortress (FORT_CLASSIC 'kom' in src/fortress/arsenals.js): fortPolice draws its car park
function owned(x, z) {
  const inF = (f, u0, u1, v0, v1) => { const [u, v] = lmL(f, x, z); return u > u0 - 6 && u < u1 + 6 && v > v0 - 6 && v < v1 + 6; };
  return inF(KOM, -1.5, 108.4, -66.7, -32.2) || inF(HF, -172, -74, -145, -109) || inF(RF, 12, 39, 12, 23) || spwNoTree(x, z);
}
const KIND_DRAWN = k => k <= 3;   // surface, street_side, lane, layby (multi-storey, underground and rooftop ones are buildings)
const STRIP = k => k >= 1 && k <= 3;   // along a street
const SURF = [  // asphalt, paving, gravel or earth, grass pavers, concrete: [material, colour]
  () => [M_ASPH, '#5c5d5e'], () => [M_PAVE, '#8e877c'], () => [M_DIRT, '#867a62'], () => [M_LAND, '#66734f'], () => [M_ASPH, '#8b8a85']];
const COLS = ['#e8e8e6', '#1d1f22', '#8d9196', '#5b6067', '#7a1f22', '#1f3f6e', '#c9c6bd', '#2f4a35', '#b8bcc0', '#3a3d42', '#e8e8e6', '#1d1f22', '#8d9196', '#9a2a1e', '#2a4f8f', '#6e5a3e'];
const CCOLS = COLS.map(c => new THREE.Color(c));   // the paint tints the white body of the BMW models (src/world/cars.js)
// how full a car park is through the day, by whose cars stand in it: [hour, share] on weekdays and at the weekend
const OCC = [
  [[[0, .86], [6, .86], [9, .42], [16, .45], [19, .78], [22, .86], [24, .86]], [[0, .88], [8, .88], [11, .66], [17, .62], [20, .82], [24, .88]]],   // yard
  [[[0, .04], [7, .05], [9, .35], [12, .55], [16, .6], [18, .78], [20, .6], [21.5, .12], [22.5, .04], [24, .04]], [[0, .04], [8, .05], [10, .55], [13, .8], [17, .75], [20, .45], [21.5, .1], [22.5, .04], [24, .04]]],   // shop
  [[[0, .08], [6, .1], [8, .8], [16.5, .8], [18.5, .25], [21, .1], [24, .08]], [[0, .06], [9, .1], [12, .22], [16, .15], [20, .08], [24, .06]]],   // work
  [[[0, .3], [7, .32], [10, .55], [18, .6], [21, .4], [24, .3]], [[0, .3], [8, .3], [11, .6], [18, .62], [21, .42], [24, .3]]]];   // other
const occAt = (prof, h, weekend) => { const c = OCC[prof][weekend ? 1 : 0]; for (let i = 1; i < c.length; i++) if (h <= c[i][0]) { const [h0, a] = c[i - 1], [h1, b] = c[i]; return a + (b - a) * (h - h0) / (h1 - h0); } return c[c.length - 1][1]; };

const PARKING_LOTS = [];   // the drawn car parks: { r: outer ring, bb, isl: [x, z, ...] the trees on grass islands }, for tree-room.js
const PSTAT = { lots: 0, stalls: 0, cars: 0, islands: 0, lamps: 0, mapped: 0, ofMapped: 0 };   // for checks: window.__city.parking
const PCOL = new SegGrid(20);   // a segment along each stall (its index), as wide as a car
let ST = null, TILES = [], lastKey = -1, lastVis = 0;

/* ---- rectangles: [cx, cz, ux, uz, ha, hb] — centre, the long axis, half length along it and half width ---- */
function rectHit(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  for (const [nx, nz] of [[a[2], a[3]], [-a[3], a[2]], [b[2], b[3]], [-b[3], b[2]]]) {
    const ra = a[4] * Math.abs(nx * a[2] + nz * a[3]) + a[5] * Math.abs(-nx * a[3] + nz * a[2]), rb = b[4] * Math.abs(nx * b[2] + nz * b[3]) + b[5] * Math.abs(-nx * b[3] + nz * b[2]);
    if (Math.abs(dx * nx + dz * nz) >= ra + rb - 0.04) return false;
  }
  return true;
}
const corner = (R, su, sv, m = 0) => [R[0] + R[2] * su * (R[4] - m) - R[3] * sv * (R[5] - m), R[1] + R[3] * su * (R[4] - m) + R[2] * sv * (R[5] - m)];
class RectHash {
  constructor() { this.m = new Map(); this.r = []; }
  keys(R, f) { const e = R[4] + R[5]; for (let i = Math.floor((R[0] - e) / 8); i <= Math.floor((R[0] + e) / 8); i++) for (let j = Math.floor((R[1] - e) / 8); j <= Math.floor((R[1] + e) / 8); j++) f(i * 100000 + j); }
  hit(R) { let h = false; this.keys(R, k => { if (h) return; const l = this.m.get(k); if (l) for (const i of l) if (rectHit(R, this.r[i])) { h = true; break; } }); return h; }
  add(R) { const i = this.r.length; this.r.push(R); this.keys(R, k => { let l = this.m.get(k); if (!l) this.m.set(k, l = []); l.push(i); }); }
}

// where no stall goes: on a carriageway or an aisle (CARROAD), on a narrow way (a path, a track, a rail: ROAD), in a
// house, on the forecourt of a fuel station, on the flower beds of Vienības laukums
function blocked(x, z) {
  let b = false;
  CARROAD.near(x, z, 12, (id, d) => { if (d < CARROAD.s[id * 6 + 4] + 0.25) b = true; }); if (b) return true;
  ROAD.near(x, z, 3, (id, d) => { const hw = ROAD.s[id * 6 + 4]; if (hw <= 1.95 && d < hw + 0.15) b = true; }); if (b) return true;
  return fuelNoTree(x, z) || lmClear(x, z);
}
const inLot = (L, x, z) => x >= L.bb[0] && x <= L.bb[2] && z >= L.bb[1] && z <= L.bb[3] && pip(x, z, L.rings[0]) && !L.rings.slice(1).some(h => pip(x, z, h));
function fits(R, L, H) {
  if (H.hit(R)) return false;
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [x, z] = corner(R, su, sv, 0.3); if (!inLot(L, x, z) || inBuilding(x, z)) return false; }
  for (const s of [-0.55, 0, 0.55]) { const x = R[0] + R[2] * R[4] * s, z = R[1] + R[3] * R[4] * s; if (blocked(x, z) || inBuilding(x, z)) return false; }
  for (const s of [-1, 1]) { const x = R[0] + R[2] * (R[4] + 0.6) * s, z = R[1] + R[3] * (R[4] + 0.6) * s; if (inBuilding(x, z)) return false; }   // not with its end at a wall
  return true;
}

/* ---- the lidar trees (lidar-trees.js: 6 bytes a tree, see tools/lidar.js), by 20 m cells ---- */
function lidarCells() {
  const T = window.LIDAR_TREES, cells = new Map(); if (!T || !T.n) return cells;
  const s = atob(T.d); if (s.length !== T.n * 6) return cells; const b = k => s.charCodeAt(k);
  for (let k = 0; k < s.length; k += 6) { const x = (b(k) | b(k + 1) << 8) / 5 - 6600, z = (b(k + 2) | b(k + 3) << 8) / 5 - 6600, r = (b(k + 5) >> 4) * 0.8, key = Math.floor(x / 20) * 100000 + Math.floor(z / 20); let l = cells.get(key); if (!l) cells.set(key, l = []); l.push(x, z, r); }
  return cells;
}
const ringDist = (r, x, z) => { let d = 1e9; const n = r.length >> 1; for (let i = 0, j = n - 1; i < n; j = i++) { const ax = r[2 * j], az = r[2 * j + 1], dx = r[2 * i] - ax, dz = r[2 * i + 1] - az, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return d; };

function lmParking(K) {
  const D = window.PARKING; if (!D) return;
  STATE.GBC = null;
  const G = K.plain, KERB = hb('#a29f99'), WHITE = hb('#dcdcd7'), GRASS = hb('#5a7a3e');
  // the car parks to draw
  const LOTS = [], byData = new Map();
  D.lots.forEach((a, k) => {
    const [id, kind, surf, cap, acc, fee, prof] = a; if (!KIND_DRAWN(kind)) return;
    const rings = a.slice(7).map((p, i) => { let r = Float32Array.from(p); if ((area2(r) < 0) === (i === 0)) r = reversed(r); return r; });
    if (rings[0].length < 6) return;
    const bb = bbox(rings[0]), A = Math.abs(area2(rings[0])) / 2 - rings.slice(1).reduce((s, h) => s + Math.abs(area2(h)) / 2, 0), cx = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2;
    if (OWN_ID.has(id) || owned(cx, cz)) { PARKING_LOTS.push({ r: rings[0], bb, isl: [] }); return; }   // a landmark draws it: only the trees are kept off it
    if (inBuilding(cx, cz) && A < 600) return;
    const L = { id, kind, surf, cap, acc, fee, prof, rings, bb, A, seed: hash(Math.abs(id) % 1e9), isl: [], stalls: [] };
    byData.set(k, L); LOTS.push(L);
  });
  for (const a of D.aisles) { const L = byData.get(a[0]); if (L) (L.aisles = L.aisles || []).push(a.slice(1)); }
  for (const a of D.spaces) { const L = byData.get(a[0]); if (L) (L.spaces = L.spaces || []).push(a.slice(1)); }
  const H = new RectHash();

  // the trees deep inside: on grass islands, which the stalls keep clear of (tree-room.js leaves them where they are)
  const cells = lidarCells();
  for (const L of LOTS) {
    for (let i = Math.floor(L.bb[0] / 20); i <= Math.floor(L.bb[2] / 20); i++) for (let j = Math.floor(L.bb[1] / 20); j <= Math.floor(L.bb[3] / 20); j++) {
      const l = cells.get(i * 100000 + j); if (!l) continue;
      for (let k = 0; k < l.length; k += 3) { const x = l[k], z = l[k + 1], r = l[k + 2]; if (!inLot(L, x, z)) continue;
        const d = Math.min(...L.rings.map(q => ringDist(q, x, z))), reach = Math.max(2.5, Math.min(5, 0.6 * r));
        if (d + Math.max(0.6, 0.5 * r) <= reach || blocked(x, z)) continue;   // tree-room moves it out, or off the way
        L.isl.push(x, z); H.add([x, z, 1, 0, 1.45, 1.45]); PSTAT.islands++;
        if (!STRIP(L.kind) && d > 1.8) { lathe(G, x, z, 0, [[1.38, 0], [1.38, 0.14], [1.22, 0.14]], 14, 0, KERB); lathe(G, x, z, 0.14, [[1.22, 0], [0, 0.03]], 14, 0, GRASS); }
      } }
  }

  // the lamps round the larger ones: along the outline every 28 m, 0.8 m in, the arm inwards; not within 14 m of another
  const lampNear = new Set(), lk = (x, z) => Math.floor(x / 14) * 100000 + Math.floor(z / 14), lampAt = (x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (lampNear.has(lk(x, z) + a * 100000 + b)) return true; return false; };
  for (let i = 0; i < LAMPS.length; i += 3) lampNear.add(lk(LAMPS[i], LAMPS[i + 1]));
  for (const L of LOTS) {
    if (L.A < 1000 || STRIP(L.kind)) continue;
    const r = L.rings[0], n = r.length >> 1; let carry = 14;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = r[2 * i], az = r[2 * i + 1], dx = r[2 * j] - ax, dz = r[2 * j + 1] - az, len = Math.hypot(dx, dz); if (len < 0.1) continue;
      const [nx, nz] = edgeN(r, i);
      for (let s = carry; s < len; s += 28) { const x = ax + dx * s / len - nx * 0.8, z = az + dz * s / len - nz * 0.8;
        if (lampAt(x, z) || !inLot(L, x, z) || blocked(x, z) || inBuilding(x, z) || H.hit([x, z, 1, 0, 0.4, 0.4])) continue;
        LAMPS.push(x, z, Math.atan2(nz, -nx)); lampNear.add(lk(x, z)); H.add([x, z, 1, 0, 0.45, 0.45]); PSTAT.lamps++; }
      carry = ((carry - len) % 28 + 28) % 28; }
  }

  // the stalls
  const S = [];   // [rect, lot, face (+1 the car's front along the rect's axis), parallel]
  const put = (L, R, face, par) => { if (!fits(R, L, H)) return false; H.add(R); L.stalls.push(S.length); S.push([R, L, face, par]); return true; };
  for (const L of LOTS) {
    // as mapped
    for (const p of L.spaces || []) { const r = Float32Array.from(p), o = obb(area2(r) < 0 ? reversed(r) : r); if (!o || o.a > 3.8 || o.a < 1.9 || o.b > 2 || o.b < 0.9) continue;
      put(L, [o.cx, o.cz, o.ux, o.uz, Math.min(o.a, 2.6), Math.min(o.b, 1.3)], hash(S.length * 7 + 1) < 0.5 ? 1 : -1, false); }
    if (L.spaces && L.stalls.length) continue;
    // square to the aisles, on both sides
    for (const a of L.aisles || []) { const n = a.length >> 1;
      for (let i = 0; i + 1 < n; i++) { const ax = a[2 * i], az = a[2 * i + 1], dx = a[2 * i + 2] - ax, dz = a[2 * i + 3] - az, len = Math.hypot(dx, dz); if (len < 3) continue;
        const tx = dx / len, tz = dz / len, e0 = i === 0 ? 3 : 2.6, e1 = i + 2 === n ? 3 : 2.6, k = Math.floor((len - e0 - e1) / 2.5); if (k < 1) continue;
        const s0 = e0 + (len - e0 - e1 - k * 2.5) / 2;
        for (const side of [-1, 1]) for (let q = 0; q < k; q++) { const s = s0 + (q + 0.5) * 2.5, ox = -tz * side, oz = tx * side;
          put(L, [ax + tx * s + ox * 5.1, az + tz * s + oz * 5.1, ox, oz, 2.5, 1.25], hash(S.length * 13 + 3) < 0.78 ? 1 : -1, false); } } }
    // rows along the longer side, where no aisle is mapped or the aisles leave most of it empty
    if (L.stalls.length >= Math.max(3, L.A / 28 * 0.35)) continue;
    const o = obb(L.rings[0]); if (!o || o.b < 1.05) continue;
    const at = (u, v) => [o.cx + o.ux * u - o.uz * v, o.cz + o.uz * u + o.ux * v];
    if (2 * o.b < 4.4) {   // a strip: one behind the other
      const k = Math.floor((2 * o.a - 0.6) / 6); for (let q = 0; q < k; q++) { const u = -k * 3 + (q + 0.5) * 6, [x, z] = at(u, 0); put(L, [x, z, o.ux, o.uz, 2.6, 1.1], hash(S.length * 5 + 9) < 0.5 ? 1 : -1, true); }
      continue;
    }
    const rows = [];
    if (STRIP(L.kind) || 2 * o.b < 7) rows.push([0, 1]);
    else { let v = -o.b + 2.5, f = -1; while (v <= o.b - 2.4) { rows.push([v, f]); v += f < 0 ? 11 : 5; f = -f; } }
    for (const [v, f] of rows) { const k = Math.floor((2 * o.a - 1) / 2.5), u0 = -k * 1.25;
      for (let q = 0; q < k; q++) { const [x, z] = at(u0 + (q + 0.5) * 2.5, v); put(L, [x, z, -o.uz, o.ux, 2.5, 1.25], (hash(S.length * 17 + 5) < 0.8 ? 1 : -1) * f, false); } }
  }
  // no more than the capacity mapped: every n-th dropped, evenly
  const keep = new Uint8Array(S.length).fill(1);
  for (const L of LOTS) { const n = L.stalls.length; if (L.cap > 0 && n > L.cap) L.stalls.forEach((s, i) => { if (Math.floor((i + 1) * L.cap / n) === Math.floor(i * L.cap / n)) keep[s] = 0; }); L.stalls = L.stalls.filter(s => keep[s]); }

  // the ground, the kerbs, the lines
  const GR = SURF.map(() => new GB(false)), lines = new GB(false), quad = (b, P, col) => { const q = P.map(([x, z]) => b.vert(x, 0, z, 0, 1, 0, col)); b.triUp(q[0], q[1], q[2]); b.triUp(q[0], q[2], q[3]); };
  for (const L of LOTS) {
    const surf = L.surf < SURF.length ? L.surf : 0, [, c0] = SURF[surf](), col = sh(hb(c0), 0.94 + L.seed * 0.12), b = GR[surf];
    const t0 = triangulate(L.rings), { flat, tris } = TERR.on ? subTris(t0.flat, t0.tris, 0.25) : t0, v0 = b.v; b.ensure(flat.length / 2);
    for (let i = 0; i < flat.length; i += 2) b.vert(flat[i], 0, flat[i + 1], 0, 1, 0, col);
    for (let i = 0; i < tris.length; i += 3) b.triUp(v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2]);
    if (surf === 3) { const o = obb(L.rings[0]); if (o) for (let u = -o.a; u <= o.a; u += 0.6) { const P = [[u - 0.04, -o.b], [u + 0.04, -o.b], [u + 0.04, o.b], [u - 0.04, o.b]].map(([p, q]) => [o.cx + o.ux * p - o.uz * q, o.cz + o.uz * p + o.ux * q]); if (P.some(([x, z]) => inLot(L, x, z))) quad(lines, P, hb('#4e5a40')); } }
    // the kerb where it borders a lawn, in pieces of up to 4 m
    if (!STRIP(L.kind)) for (const r of L.rings) { const n = r.length >> 1;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = r[2 * i], az = r[2 * i + 1], dx = r[2 * j] - ax, dz = r[2 * j + 1] - az, len = Math.hypot(dx, dz); if (len < 0.3) continue;
        const [nx, nz] = edgeN(r, i), m = Math.ceil(len / 4);
        for (let p = 0; p < m; p++) { const s0 = p / m, s1 = (p + 1) / m, x1 = ax + dx * s0, z1 = az + dz * s0, x2 = ax + dx * s1, z2 = az + dz * s1, mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
          let road = false; ROAD.near(mx, mz, 9, (id, d) => { if (d < ROAD.s[id * 6 + 4] + 0.6) road = true; }); if (road || inBuilding(mx + nx * 0.5, mz + nz * 0.5)) continue;
          const W = 0.15, h = 0.12;
          polyA(G, [[x1, 0, z1], [x2, 0, z2], [x2, h, z2], [x1, h, z1]], sh(KERB, 0.92), -nx, 0, -nz);
          polyA(G, [[x1, h, z1], [x2, h, z2], [x2 + nx * W, h, z2 + nz * W], [x1 + nx * W, h, z1 + nz * W]], KERB, 0, 1, 0);
          polyA(G, [[x1 + nx * W, 0, z1 + nz * W], [x2 + nx * W, 0, z2 + nz * W], [x2 + nx * W, h, z2 + nz * W], [x1 + nx * W, h, z1 + nz * W]], sh(KERB, 0.85), nx, 0, nz); } } }
    // the lines between the stalls (on paved ground; in about half of the yards)
    if ((surf === 0 || surf === 1 || surf === 4) && (L.prof !== 0 || L.seed < 0.5)) for (const s of L.stalls) { const [R, , , par] = S[s]; if (par) continue;
      for (const sv of [-1, 1]) { const [x1, z1] = corner(R, -1, sv), [x2, z2] = corner(R, 1, sv), wx = -R[3] * 0.05, wz = R[2] * 0.05; quad(lines, [[x1 - wx, z1 - wz], [x2 - wx, z2 - wz], [x2 + wx, z2 + wz], [x1 + wx, z1 + wz]], WHITE); } }
    PARKING_LOTS.push({ r: L.rings[0], bb: L.bb, isl: L.isl });
    AREAS.push({ cls: 14, rings: L.rings, bb: L.bb });   // on the map
  }
  GR.forEach((b, k) => { const [mat] = SURF[k](), m = b.mesh(mat); if (m) { m.renderOrder = -34.4; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } });
  { const m = lines.mesh(M_PAVE); if (m) { m.renderOrder = -33.9; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } }

  // the P sign at the way in (the point of the outline nearest a street or an aisle), the lift gates
  const BLUE = hb('#1f56b5'), STEEL = hb('#8a8f94'), RED = hb('#c8312a');
  for (const L of LOTS) {
    if (L.A < 300 || STRIP(L.kind) || L.stalls.length < 8 || (L.prof === 0 && L.acc === 2)) continue;
    const r = L.rings[0], n = r.length >> 1; let best = null, bd = 30;
    for (let i = 0; i < n; i++) { const x = r[2 * i], z = r[2 * i + 1]; CARROAD.near(x, z, 30, (id, d, px, pz) => { const e = d - CARROAD.s[id * 6 + 4]; if (e < bd) { bd = e; best = [i, px, pz]; } }); }
    if (!best) continue;
    const [i, px, pz] = best, vx = r[2 * i], vz = r[2 * i + 1], cx = (L.bb[0] + L.bb[2]) / 2, cz = (L.bb[1] + L.bb[3]) / 2, cl = Math.hypot(cx - vx, cz - vz) || 1;
    let x = vx + (cx - vx) / cl * 1.4, z = vz + (cz - vz) / cl * 1.4; for (let t = 0; t < 4 && (blocked(x, z) || H.hit([x, z, 1, 0, 0.3, 0.3])); t++) { x += (cx - vx) / cl * 1.2; z += (cz - vz) / cl * 1.2; }
    if (!inLot(L, x, z) || blocked(x, z) || inBuilding(x, z) || H.hit([x, z, 1, 0, 0.3, 0.3])) continue;
    let fx = px - x, fz = pz - z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl; const tx = -fz, tz = fx;
    lathe(G, x, z, 0, [[0.04, 0], [0.04, 2.35]], 6, 0, STEEL);
    box(G, x + fx * 0.06, z + fz * 0.06, tx, tz, 0.31, 0.02, 1.72, 2.34, hb('#e8e8e4'));
    box(G, x + fx * 0.08, z + fz * 0.08, tx, tz, 0.28, 0.005, 1.75, 2.31, BLUE);
    const P = (a, b, y0, y1) => box(G, x + fx * 0.09 + tx * (a + b) / 2, z + fz * 0.09 + tz * (a + b) / 2, tx, tz, (b - a) / 2, 0.004, y0, y1, WHITE);
    P(-0.13, -0.06, 1.83, 2.23); P(-0.06, 0.06, 2.16, 2.23); P(-0.06, 0.06, 1.99, 2.06); P(0.06, 0.12, 2.0, 2.22);
    COL.add(x, z, x + 0.01, z, 0.06, 0); H.add([x, z, 1, 0, 0.3, 0.3]);
  }
  for (const [k, x, z, dx, dz] of D.gates) { if (!byData.has(k)) continue; const nx = -dz, nz = dx, hx = x + nx * 2.3, hz = z + nz * 2.3;
    box(G, hx, hz, dx, dz, 0.16, 0.16, 0, 1.05, hb('#e4e2dc')); box(G, hx, hz, dx, dz, 0.18, 0.18, 0.75, 1.05, RED);
    for (let q = 0; q < 8; q++) { const a = 0.15 + q * 0.55, b = a + 0.55, m = (a + b) / 2; box(G, hx - nx * m, hz - nz * m, nx, nz, 0.275, 0.04, 0.92, 1.0, q % 2 ? WHITE : RED); }
    COL.add(hx, hz, hx + 0.01, hz, 0.2, 0); }

  // the cars: per stall its shape, colour, place and how likely it is taken; drawn per 1 km tile
  const n = S.length;
  ST = { n: 0, x: new Float32Array(n), z: new Float32Array(n), y: new Float32Array(n), a: new Float32Array(n), kind: new Uint8Array(n), col: new Uint8Array(n), u: new Float32Array(n), lot: new Uint16Array(n), occ: new Uint8Array(n), prof: [], f: [] };
  LOTS.forEach((L, li) => { ST.prof[li] = L.prof; ST.f[li] = 0.85 + 0.3 * L.seed; L.li = li; });
  const tiles = new Map();
  for (let s = 0; s < n; s++) { if (!keep[s]) continue; const [R, L, face, par] = S[s], k = ST.n++, h1 = hash(s * 2654435761 + 11), h2 = hash(s * 40503 + 7);
    const dx = R[2] * face, dz = R[3] * face; ST.x[k] = R[0]; ST.z[k] = R[1]; ST.y[k] = terrainH(R[0], R[1]); ST.a[k] = Math.atan2(-dz, dx); ST.kind[k] = par ? (h1 < 0.7 ? 1 : 0) : h1 < 0.5 ? 0 : h1 < 0.82 ? 1 : 2; ST.col[k] = Math.floor(h2 * COLS.length); ST.u[k] = hash(s * 7919 + 3); ST.lot[k] = L.li;
    const hl = ST.kind[k] === 2 ? 1.55 : ST.kind[k] === 1 ? 1.15 : 1.4; PCOL.add(R[0] - R[2] * hl, R[1] - R[3] * hl, R[0] + R[2] * hl, R[1] + R[3] * hl, k, 0);
    const key = Math.floor(R[0] / 1000) * 100 + Math.floor(R[1] / 1000); let t = tiles.get(key); if (!t) tiles.set(key, t = { cx: (Math.floor(R[0] / 1000) + 0.5) * 1000, cz: (Math.floor(R[1] / 1000) + 0.5) * 1000, s: [[], [], []] }); t.s[ST.kind[k]].push(k); }
  for (const t of tiles.values()) { t.m = null; TILES.push(t); }   // the BMW meshes are made by placeParkingCars once the files are in
  PSTAT.car = (x, z) => { let best = null, bd = 60; for (let k = 0; k < ST.n; k++) { const d = Math.hypot(ST.x[k] - x, ST.z[k] - z); if (ST.occ[k] && d < bd) { bd = d; best = [ST.x[k], ST.z[k], ST.a[k]]; } } return best; };   // the nearest parked car (for checks)
  PSTAT.lots = LOTS.length; PSTAT.stalls = ST.n; PSTAT.mapped = LOTS.reduce((t, L) => t + (L.cap > 0 ? L.cap : 0), 0); PSTAT.ofMapped = LOTS.reduce((t, L) => t + (L.cap > 0 ? L.stalls.length : 0), 0);   // the capacities mapped, and how many stalls those car parks got
}

/* ---- the BMW meshes of the car parks: made once the models are decoded (src/world/cars.js), a step of its own ---- */
async function placeParkingCars() {
  const r = carsReady(); if (r) await r;
  const geos = [0, 1, 2].map(carGeo);
  for (const t of TILES) {
    if (t.m) continue;
    t.m = t.s.map((list, kind) => { if (!list.length || !geos[kind]) return null; const m = new THREE.InstancedMesh(geos[kind], carMat, list.length);
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(t.cx, 0, t.cz), 800); m.castShadow = m.receiveShadow = true; m.count = 0; m.cols = CCOLS; scene.add(m); return m; });
  }
  lastKey = -1;   // let parkTick fill the matrices now that the meshes exist
}

/* ---- the time of day: which stalls are taken (every 10 minutes of the clock), and which tiles are near enough ---- */
function parkTick(day, sec) {
  if (!ST) return;
  const key = day * 144 + Math.floor(sec / 600);
  if (key !== lastKey) { lastKey = key;
    const wd = ((day + 4) % 7 + 7) % 7, weekend = wd === 0 || wd === 6, h = (sec / 3600) % 24, share = ST.prof.map((p, li) => Math.min(0.97, occAt(p, h, weekend) * ST.f[li]));
    let cars = 0; for (let k = 0; k < ST.n; k++) { const o = ST.u[k] < share[ST.lot[k]] ? 1 : 0; ST.occ[k] = o; cars += o; } PSTAT.cars = cars;
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const t of TILES) { if (!t.m) continue; t.m.forEach((m, kind) => { if (!m) return; let c = 0;
      for (const k of t.s[kind]) { if (!ST.occ[k]) continue; q.setFromAxisAngle(up, ST.a[k]); p.set(ST.x[k], ST.y[k], ST.z[k]); M.compose(p, q, one); m.setMatrixAt(c, M); m.setColorAt(c, m.cols[ST.col[k]]); c++; }
      m.count = c; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }); }
  }
  const now = performance.now(); if (now - lastVis > 400) { lastVis = now; const cx = camera.position.x, cz = camera.position.z, far = 1500 + Math.max(0, camera.position.y) * 2;
    for (const t of TILES) { if (!t.m) continue; const v = Math.hypot(t.cx - cx, t.cz - cz) < far; for (const m of t.m) if (m) m.visible = v; } }
}
// a walker against the parked cars: pushed out of each taken stall (0.45 m of the walker, 0.85 m of the car)
function parkedPush(P) { if (!ST) return; PCOL.near(P.x, P.z, 1.3, (id, d, px, pz) => { if (!ST.occ[PCOL.s[id * 6 + 4]] || d >= 1.3 || d < 1e-5) return; const k = (1.3 - d) / d; P.x += (P.x - px) * k; P.z += (P.z - pz) * k; }); }
function parkedAt(x, z) { if (!ST) return false; let hit = false; PCOL.near(x, z, 1.3, id => { if (ST.occ[PCOL.s[id * 6 + 4]]) hit = true; }); return hit; }
// is (x, z) in a drawn car park (for the trees scattered over the woods)
let LGRID = null;
function inParking(x, z) {
  if (!LGRID) { LGRID = new Map(); for (const L of PARKING_LOTS) for (let i = Math.floor(L.bb[0] / 50); i <= Math.floor(L.bb[2] / 50); i++) for (let j = Math.floor(L.bb[1] / 50); j <= Math.floor(L.bb[3] / 50); j++) { const k = i * 100000 + j; let l = LGRID.get(k); if (!l) LGRID.set(k, l = []); l.push(L); } }
  for (const L of LGRID.get(Math.floor(x / 50) * 100000 + Math.floor(z / 50)) || []) if (x >= L.bb[0] && x <= L.bb[2] && z >= L.bb[1] && z <= L.bb[3] && pip(x, z, L.r)) return true;
  return false;
}

export { PARKING_LOTS, PSTAT, inParking, lmParking, parkTick, parkedAt, parkedPush, placeParkingCars };
