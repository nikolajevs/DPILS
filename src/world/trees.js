import * as THREE from 'three';
import { PP } from '../render/post.js';
import { fortTreeY } from '../fortress/build.js';
import { fortNoTree } from '../fortress/ground-height.js';
import { SQ_SPRUCES } from '../landmarks/unity-square.js';
import { SHOP_TREES } from '../landmarks/shops.js';
import { upNoTree } from './underpass.js';
import { PARK_RINGS, PARK_TREES, parkNoTree } from '../landmarks/parks.js';
import { fuelNoTree } from '../landmarks/fuel.js';
import { spwNoTree } from '../landmarks/speedway.js';
import { lmClear } from '../landmarks/core.js';
import { ssNoTree } from '../landmarks/substation.js';
import { ovNoTree } from './overpass.js';
import { vbNoTree } from './bridge-vienibas.js';
import { AREAS, inBuilding, onRoad, wetTree } from './data.js';
import { treeRoom } from './tree-room.js';
import { inParking } from '../landmarks/parking.js';
import { std } from '../render/materials.js';
import { R, mkCanvas } from '../render/textures.js';
import { terrainH } from './terrain.js';
import { U, renderer, scene, terrUniforms } from '../render/renderer.js';
import { due, pause, rest } from '../core/pause.js';
import { hash, hb, pip, rnd } from '../core/util.js';
import { C, HX, HY, TTILE } from '../core/env.js';

/* ---------- trees ---------- */
// the trees of lidar-trees.js as bytes, 6 a tree (see tools/lidar.js), or null
function lidarTrees() { const L = window.LIDAR_TREES; if (!L || !L.n) return null; const s = atob(L.d), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.length === L.n * 6 ? b : null; }
// A crown is a cloud of small leaf cards that always face the viewer (and the sun in the shadow pass), shaded as one soft
// ball. Far trees are two-quad impostors baked from the very same model, so the switch between the two is hard to spot.
const treeTiles = new Map();
const LIDAR_STATS = { moved: 0, narrower: 0, out: 0 };   // what treeRoom did to the lidar trees (for checks: window.__city.treeStats)
// Leaf atlas, 2 × 2 cells: 0 broadleaf, 1 birch, 2 pine needles, 3 spruce twigs
function leafAtlas() {
  const S = 256, cv = mkCanvas(S * 2, S * 2), g = cv.getContext('2d'), rr = (a, b) => a + R() * (b - a);
  const hsl = (h, s, l) => `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%)`;
  const cell = (c, fn) => { g.save(); g.translate((c % 2) * S, (c >> 1) * S); g.beginPath(); g.rect(0, 0, S, S); g.clip(); fn(); g.restore(); };
  const leaf = (x, y, len, wid, rot, col, rib) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = col; g.beginPath(); g.moveTo(0, -len / 2); g.quadraticCurveTo(wid, -len * 0.12, 0, len / 2); g.quadraticCurveTo(-wid, -len * 0.12, 0, -len / 2); g.fill();
    g.strokeStyle = rib; g.lineWidth = 0.7; g.beginPath(); g.moveTo(0, -len / 2); g.lineTo(0, len / 2); g.stroke(); g.restore();
  };
  const disc = (n, spread, fn) => { for (let k = 0; k < n; k++) { const a = R() * 6.283, r = Math.pow(R(), 0.62) * S * spread; fn(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, k / n); } };
  cell(0, () => disc(250, 0.43, (x, y, t) => { const l = 13 + t * 24 + rr(-4, 4); leaf(x, y, rr(15, 24), rr(7, 10), R() * 6.283, hsl(rr(86, 112), rr(38, 56), l), hsl(95, 35, l + 9)); }));
  cell(1, () => disc(260, 0.44, (x, y, t) => { const l = 17 + t * 26 + rr(-4, 4); leaf(x, y, rr(10, 15), rr(5.5, 8), R() * 6.283, hsl(rr(72, 98), rr(40, 58), l), hsl(80, 40, l + 8)); }));
  cell(2, () => {
    // Scots pine: fine glaucous blue-green needles along many short twigs, a continuous needle mass
    for (let b = 0; b < 60; b++) {
      const a = R() * 6.283, x0 = S / 2 + rr(-0.14, 0.14) * S, y0 = S / 2 + rr(-0.14, 0.14) * S, len = S * rr(0.13, 0.24), ca = Math.cos(a), sa = Math.sin(a), l0 = 13 + (b % 5) * 3;
      g.strokeStyle = '#5a4030'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + ca * len, y0 + sa * len); g.stroke();
      for (let k = 1; k < len; k += 1.6) {
        const x = x0 + ca * k, y = y0 + sa * k;
        for (const sd of [-1, 1]) { const na = a + sd * rr(0.4, 0.95), nl = rr(8, 15) * (1 - k / len * 0.3); g.strokeStyle = hsl(rr(100, 140), rr(20, 42), l0 + rr(0, 12)); g.lineWidth = rr(0.9, 1.3); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl); g.stroke(); }
      }
      for (let k = 0; k < 4; k++) { const na = a + rr(-0.45, 0.45), nl = rr(8, 14); g.strokeStyle = hsl(rr(95, 130), rr(26, 44), l0 + rr(6, 16)); g.lineWidth = 1; g.beginPath(); g.moveTo(x0 + ca * len, y0 + sa * len); g.lineTo(x0 + ca * len + Math.cos(na) * nl, y0 + sa * len + Math.sin(na) * nl); g.stroke(); }
    }
  });
  cell(3, () => {
    // a spruce bough: short dense needles all along the twig, both sides, and a lighter tuft of new growth at the tip
    for (let b = 0; b < 30; b++) {
      const a = R() * 6.283, x0 = S / 2 + rr(-0.12, 0.12) * S, y0 = S / 2 + rr(-0.12, 0.12) * S, len = S * rr(0.16, 0.30), ca = Math.cos(a), sa = Math.sin(a), l0 = 7 + (b % 5) * 3.5;
      g.strokeStyle = '#3a2c20'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + ca * len, y0 + sa * len); g.stroke();
      for (let k = 2; k < len; k += 1.2) {
        const x = x0 + ca * k, y = y0 + sa * k;
        for (const sd of [-1, 1]) { const na = a + sd * rr(0.5, 1.15), nl = rr(6, 12) * (1 - k / len * 0.35); g.strokeStyle = hsl(rr(108, 140), rr(24, 42), l0 + rr(0, 12)); g.lineWidth = 1.3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl); g.stroke(); }
      }
      for (let k = 0; k < 7; k++) { const na = a + rr(-0.7, 0.7), nl = rr(7, 12); g.strokeStyle = hsl(rr(105, 135), rr(28, 44), l0 + rr(6, 16)); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x0 + ca * len, y0 + sa * len); g.lineTo(x0 + ca * len + Math.cos(na) * nl, y0 + sa * len + Math.sin(na) * nl); g.stroke(); }
    }
  });
  // give see-through texels the mean leaf colour of their cell, so mip levels do not grow dark fringes
  const id = g.getImageData(0, 0, S * 2, S * 2), d = id.data;
  for (let c = 0; c < 4; c++) {
    const x0 = (c % 2) * S, y0 = (c >> 1) * S; let r = 0, gg = 0, b = 0, n = 0;
    for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) { const k = (y * S * 2 + x) * 4; if (d[k + 3] > 200) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; } }
    r /= n || 1; gg /= n || 1; b /= n || 1;
    for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) { const k = (y * S * 2 + x) * 4; if (d[k + 3] < 8) { d[k] = r; d[k + 1] = gg; d[k + 2] = b; } }
  }
  const t = new THREE.DataTexture(new Uint8Array(d.buffer), S * 2, S * 2, THREE.RGBAFormat);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
const BARK_TILE = 0.7;   // metres of trunk one repeat of the bark photograph covers
// type: 0 pine, 1 broadleaf, 2 birch, 3 spruce
function treeGeo(type) {
  const P = [], N = [], Cc = [], K = []; let H = 0, Rm = 0, seq = 0;
  const solid = (geo, col, m, bark) => {   // bark: [u repeats, v repeats] to lay the bark photograph on it (carried in aCard.xyz of a solid, whose w is 0)
    const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(m);
    const p = g.attributes.position.array, nn = g.attributes.normal.array, uv = g.attributes.uv.array, cf = typeof col === 'function' ? col : null, c = cf ? null : hb(col);
    const sp = type === 2 ? 1 : type === 0 ? 2 : 3;   // which bark photograph: 1 birch, 2 pine, 3 spruce (rounded in the shader)
    for (let i = 0, j = 0; i < p.length; i += 3, j += 2) { P.push(p[i], p[i + 1], p[i + 2]); N.push(nn[i], nn[i + 1], nn[i + 2]); const cc = cf ? cf(p[i + 1]) : c, f = 0.82 + 0.18 * hash(Math.round(p[i + 1] * 3) * 31 + type); Cc.push(cc[0] / 255 * f, cc[1] / 255 * f, cc[2] / 255 * f); K.push(bark ? uv[j] * bark[0] : 0, bark ? uv[j + 1] * bark[1] : 0, bark ? sp : 0, 0); H = Math.max(H, p[i + 1]); }
  };
  const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
  const limb = (ax, ay, az, bx, by, bz, r0, r1, col, seg = 6, arc) => {
    const d = new THREE.Vector3(bx - ax, by - ay, bz - az), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, true, arc ? arc[0] : 0, arc ? arc[1] : Math.PI * 2);
    const bark = type === 1 ? null : [Math.max(1, Math.round(Math.PI * (r0 + r1) * (arc ? arc[1] / 6.283 : 1) / BARK_TILE)), L / BARK_TILE];   // whole repeats round the trunk so the seam matches; the broadleaf has no bark photograph
    solid(g, col, new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), ONE), bark);
  };
  const card = (x, y, z, size, nx, ny, nz, shade, cellIdx) => {
    const rot = hash(seq * 7 + type * 131 + 5) * 6.283, l = Math.hypot(nx, ny, nz) || 1; seq++;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) { P.push(x, y, z); N.push(nx / l, ny / l, nz / l); Cc.push(shade, shade, shade); K.push(cx * size, cy * size, rot, cellIdx + 1); }
    H = Math.max(H, y + size * 1.15); Rm = Math.max(Rm, Math.hypot(x, z) + size * 1.15);
  };
  // blobs: [x, y, z, radius]; ys squashes them vertically; per = cards per square metre of radius
  const crown = (blobs, ys, per, size, cellIdx) => {
    let sx = 0, sy = 0, sz = 0, sw = 0; for (const [x, y, z, s] of blobs) { sx += x * s; sy += y * s; sz += z * s; sw += s; } sx /= sw; sy /= sw; sz /= sw;
    for (const [bx, by, bz, s] of blobs) {
      const n = Math.round(per * s * s);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, phi = Math.acos(1 - 2 * t), th = i * 2.39996 + s * 10, rr = 0.5 + 0.5 * Math.sqrt(hash(seq * 13 + type * 7 + 1));
        const ux = Math.sin(phi) * Math.cos(th), uy = Math.cos(phi), uz = Math.sin(phi) * Math.sin(th);
        const x = bx + ux * s * rr, y = by + uy * s * ys * rr, z = bz + uz * s * rr;
        const shade = (0.45 + 0.55 * (rr - 0.5) / 0.5) * (0.7 + 0.3 * (uy * 0.5 + 0.5));
        card(x, y, z, size * (0.8 + 0.4 * hash(seq * 5 + 3)), x - sx, (y - sy) / ys + s * 0.25, z - sz, shade, cellIdx);
      }
    }
    return sy;
  };
  let capY = 5;
  if (type === 0) {
    // Scots pine: a clean bare bole, grey-brown below and orange above (a forest pine self-prunes its
    // lower branches flush, no stubs stick out), and an open crown of separate needle pads — sky between
    // the layers, not one solid ball. The limbs are hidden under needle strands, no bare sticks show.
    const bark = y => { const t = Math.min(1, Math.max(0, (y - 2.5) / 8.5)), e = t * t * (3 - 2 * t); return [93 + 83 * e, 74 + 37 * e, 58 + 8 * e]; };   // grey-brown below, orange above, gradual
    limb(0, 0, 0, 0.06, 4.2, 0.03, 0.28, 0.22, bark, 7); limb(0.06, 4.2, 0.03, 0.12, 7.6, 0.07, 0.22, 0.15, bark, 7);
    limb(0.12, 7.6, 0.07, 0.18, 12.2, 0.12, 0.15, 0.05, bark, 7);
    const pad = (cx, cy, cz, pr, n, sz, top) => {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, phi = Math.acos(1 - 2 * t), th = i * 2.39996 + cx * 7, rr = 0.35 + 0.65 * Math.sqrt(hash(seq * 13 + 5));
        const ux = Math.sin(phi) * Math.cos(th), uy = Math.cos(phi), uz = Math.sin(phi) * Math.sin(th);
        const x = cx + ux * pr * rr, y = cy + uy * pr * 0.32 * rr, z = cz + uz * pr * rr, up = uy > -0.15;
        card(x, y, z, sz * (0.8 + 0.4 * hash(seq * 5 + 3)), ux * 0.45, up ? 0.85 : -0.5, uz * 0.45, (up ? 0.72 + 0.28 * rr : 0.42 + 0.2 * rr) * (0.85 + 0.15 * top), 2);
      }
    };
    for (let i = 0; i < 6; i++) {
      const a = i * 2.39996 + hash(i * 17 + 2) * 0.7, y = 8.6 + i * 0.62, R = 2.5 - i * 0.28 + hash(i * 13 + 4) * 0.45, rise = 0.45 + hash(i * 7 + 6) * 0.4;
      const tx = Math.cos(a) * R, tz = Math.sin(a) * R, ty = y + rise;
      for (const t of [0.3, 0.55, 0.8]) {   // the limb as a strand of needles, not a bare orange stick
        const jx = (hash(seq * 3 + 7) - 0.5) * 0.14, jz = (hash(seq * 5 + 9) - 0.5) * 0.14;
        card(0.14 + (tx - 0.14) * t + jx, y + (ty - y) * t + 0.08, 0.08 + (tz - 0.08) * t + jz, 0.55 + 0.2 * t, Math.cos(a) * 0.3, 0.9, Math.sin(a) * 0.3, 0.6 + 0.2 * t, 2);
      }
      pad(tx, ty + 0.25, tz, 1.1 + (5 - i) * 0.11, 15, 0.85, i / 5);
    }
    pad(0.15, 12.5, 0.1, 0.85, 9, 0.75, 1); pad(0.1, 13.1, 0.05, 0.55, 6, 0.65, 1);
    card(0.1, 13.5, 0.05, 0.45, 0, 1, 0, 1, 2); capY = 10.8;
  } else if (type === 1) {
    limb(0, 0, 0, 0, 3.5, 0, 0.25, 0.17, '#5b4a3c', 7);
    limb(0, 3.0, 0, 1.3, 4.9, 0.4, 0.12, 0.05, '#55463a', 5); limb(0, 3.2, 0, -1.1, 5.0, -0.6, 0.12, 0.05, '#55463a', 5);
    limb(0, 3.4, 0, 0.25, 6.5, -0.45, 0.15, 0.05, '#55463a', 5); limb(0, 2.8, 0, -0.4, 4.6, 1.15, 0.1, 0.04, '#55463a', 5);
    capY = crown([[0, 5.7, 0, 2.6], [1.35, 4.9, 0.4, 1.9], [-1.15, 5.0, -0.6, 2.0], [0.3, 6.9, -0.5, 1.8], [-0.4, 4.6, 1.25, 1.7]], 0.9, 4.2, 0.95, 0);
  } else if (type === 2) {
    limb(0, 0, 0, 0.12, 7.4, 0.08, 0.16, 0.05, '#e7e4dc', 6);
    // (the dark marks on the trunk are in the bark texture, no longer black patches of geometry)
    limb(0.08, 4.8, 0.05, 0.6, 6.0, 0.3, 0.05, 0.02, '#cfcbc2', 4); limb(0.08, 4.4, 0.05, -0.4, 5.6, -0.6, 0.05, 0.02, '#cfcbc2', 4);
    capY = crown([[0.05, 7.4, 0, 1.8], [0.6, 6.1, 0.3, 1.5], [-0.5, 8.6, -0.2, 1.3], [-0.35, 5.7, -0.6, 1.3]], 1.25, 5.2, 0.85, 1);
  } else {
    // Norway spruce: whorls of drooping limbs, each carrying a row of bough cards from the bole out to
    // the tip, dense enough to hide the trunk, ragged and layered rather than a smooth cone of stars.
    limb(0, 0, 0, 0, 10.1, 0, 0.22, 0.035, '#4a3a2c', 6);
    for (let k = 0; k < 11; k++) {
      const y = 0.9 + k * 0.82 + (hash(k * 7 + 2) - 0.5) * 0.18;
      const r = (2.2 * Math.pow(1 - k / 11.5, 0.9) + 0.1) * (0.85 + 0.3 * hash(k * 13 + 1));
      const m = Math.max(3, Math.round(r * 2.2)), droop = 0.16 + 0.12 * (1 - k / 11), sz = 0.5 + r * 0.3;
      for (let j = 0; j < m; j++) {
        const a = j / m * 6.283 + k * 0.83 + (hash(k * 31 + j) - 0.5) * 0.35;
        const L = r * (0.75 + 0.3 * hash(k * 17 + j * 3)), ca = Math.cos(a), sa = Math.sin(a);
        limb(ca * 0.1, y, sa * 0.1, ca * L, y - droop * L, sa * L, 0.03 * (1 - k / 13) + 0.012, 0.006, '#3f3226', 4);
        const cards = k < 7 ? 3 : 2;
        for (let c = 0; c < cards; c++) {
          const t = cards === 3 ? [0.45, 0.75, 1][c] : [0.6, 1][c];
          const px = ca * L * t, pz = sa * L * t, py = y - droop * L * t * t + (hash(seq * 3 + 1) - 0.5) * 0.12;
          const s = sz * (c === cards - 1 ? 0.78 : c === 0 ? 0.85 : 1) * (0.85 + 0.3 * hash(seq * 5 + 2));
          card(px, py, pz, s, ca * 0.8, c === cards - 1 ? 0.2 : 0.5, sa * 0.8, (0.5 + 0.5 * k / 10) * (c === 0 ? 0.72 : 0.85 + 0.15 * hash(seq * 9 + 4)), 3);
        }
      }
      for (let c = 0; c < 2; c++) {   // boughs close to the bole so the trunk does not show through
        const a = hash(k * 41 + c * 7) * 6.283, ir = r * 0.28;
        card(Math.cos(a) * ir, y + 0.1, Math.sin(a) * ir, sz * 0.8, Math.cos(a) * 0.3, 0.8, Math.sin(a) * 0.3, 0.42 + 0.3 * k / 10, 3);
      }
    }
    for (let c = 0; c < 4; c++) card((hash(c * 3) - 0.5) * 0.15, 9.7 + c * 0.26, (hash(c * 5) - 0.5) * 0.15, 0.44 - c * 0.07, 0.2, 1, 0.2, 0.95, 3);
    capY = 5.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('aCard', new THREE.Float32BufferAttribute(K, 4));
  g.userData = { H: H + 0.2, R: Rm + 0.1, capY };
  return g;
}
/* c.z is the atlas cell + 1, the same at every corner of a card, yet interpolated it comes out a hair above or below
   the whole number (3.0 as 2.9999998), and mod/floor of 2 − ε pointed the pine needles at a cell off the atlas: a pine
   card, or half of one, vanished and came back with the slightest move of the wind or the camera, and the pine crowns
   flickered (in the shadow map too). Rounded, the cell is exact. */
const LEAF_GLSL = `vec4 leafTex(vec3 c) { float cell = max(floor(c.z - 0.5), 0.0); return texture2D(uLeaf, (vec2(mod(cell, 2.0), floor(cell * 0.5)) + clamp(vec2(c.x, 1.0 - c.y), 0.02, 0.98)) * 0.5); }\n`;
// replaces <project_vertex>: wind sway (slow: a period of 7-14 s for the trunk, 7 s for the leaf cards), then the card corner is pushed out in view space
const TREE_VERT = `
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    float tScale = length(instanceMatrix[1].xyz);
  #else
    float tScale = 1.0;
  #endif
  vec4 tWorld = modelMatrix * mvPosition; mvPosition.y += terrainH(tWorld.xz);
  mvPosition.xz += vec2(0.8, 0.45) * ((sin(uTime * 0.45 + tWorld.x * 0.05 + tWorld.z * 0.07) + 0.5 * sin(uTime * 0.9 + tWorld.x * 0.13)) * max(transformed.y - 1.2, 0.0) * 0.006 * tScale);
  mvPosition = modelViewMatrix * mvPosition;
  vCard = vec3(0.5, 0.5, 0.0); vBark = aCard.w > 0.5 ? vec3(0.0) : aCard.xyz;
  if (aCard.w > 0.5) {
    float tA = aCard.z + sin(uTime * 0.9 + aCard.z * 40.0 + tWorld.x * 0.3 + tWorld.z * 0.3) * 0.04;
    vec2 tC = aCard.xy * tScale, tO = vec2(tC.x * cos(tA) - tC.y * sin(tA), tC.x * sin(tA) + tC.y * cos(tA));
    mvPosition.xy += tO;
    vCard = vec3(sign(aCard.xy) * 0.5 + 0.5, aCard.w);
    /*NORMAL*/
  }
  gl_Position = projectionMatrix * mvPosition;`;
let matTree, matTreeDepth, matTreeFar;
// the bark photographs, tileable and neutral: birch white with black lenticels (tools/gen-birch-bark.py),
// pine plates and spruce scales in grey (tools/gen-bark.py) so the trunk's vertex colour tints them.
// A white pixel stands in until the file has come.
function barkTex(file) {
  const c = mkCanvas(1, 1), g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1, 1);
  const t = new THREE.Texture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  new THREE.TextureLoader().load(file, img => { t.image = img.image; t.needsUpdate = true; }, undefined, () => {});
  return t;
}
function treeMaterials(leaf) {
  matTree = std({ vertexColors: true, roughness: 0.78, metalness: 0 }, 'tree', s => {
    s.uniforms.uBark = { value: barkTex('textures/bark_birch.webp') }; s.uniforms.uBarkPine = { value: barkTex('textures/bark_pine.webp') }; s.uniforms.uBarkSpruce = { value: barkTex('textures/bark_spruce.webp') };
    s.uniforms.uLeaf = { value: leaf }; s.uniforms.uTime = U.time; s.uniforms.uSunW = U.sunDir; s.uniforms.uSunC = U.sunCol;
    s.vertexShader = 'attribute vec4 aCard; uniform float uTime; varying vec3 vCard; varying vec3 vBark;\n' + s.vertexShader.replace('#include <project_vertex>', TREE_VERT.replace('/*NORMAL*/', 'vNormal = normalize(vNormal + vec3(tO, 0.0) * (0.55 / max(length(tC), 1e-3)));'));
    s.fragmentShader = 'uniform sampler2D uLeaf; uniform sampler2D uBark; uniform sampler2D uBarkPine; uniform sampler2D uBarkSpruce; uniform vec3 uSunW; uniform vec3 uSunC; varying vec3 vCard; varying vec3 vBark;\n' + LEAF_GLSL + s.fragmentShader.replace('#include <map_fragment>', `
        vec4 lt = leafTex(vCard); float isLeaf = step(0.5, vCard.z);
        if (isLeaf > 0.5) {
          float cut = mix(0.45, 0.2, smoothstep(30.0, 220.0, length(vViewPosition)));
          diffuseColor.rgb *= pow(lt.rgb, vec3(2.2));
          diffuseColor.a = clamp((lt.a - cut) / max(fwidth(lt.a), 1e-3) + 0.5, 0.0, 1.0);
          if (diffuseColor.a < 0.05) discard;
        } else if (vBark.z > 0.5) {
          float sp = floor(vBark.z + 0.5);   // rounded: interpolated, the species code must not land on a neighbour (as the leaf cell once did)
          vec3 bk = sp < 1.5 ? texture2D(uBark, vBark.xy).rgb : sp < 2.5 ? texture2D(uBarkPine, vBark.xy).rgb : texture2D(uBarkSpruce, vBark.xy).rgb;
          diffuseColor.rgb *= min(bk * 1.25, vec3(1.0));   // the bark photograph over the vertex colour: plates and fissures, the tint stays the trunk's
        }
        `).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (isLeaf > 0.5) {   // sunlight shining through the leaves when looking towards the sun
          float tr = pow(max(dot(-normalize(vViewPosition), (viewMatrix * vec4(uSunW, 0.0)).xyz), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunC * vec3(1.0, 1.15, 0.45) * (tr * 0.3);
        }`).replace('reflectedLight.directSpecular + reflectedLight.indirectSpecular', '(reflectedLight.directSpecular + reflectedLight.indirectSpecular) * (1.0 - 0.88 * isLeaf)');
  });
  matTree.extensions = { derivatives: true }; matTree.shadowSide = THREE.DoubleSide;
  matTreeDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  matTreeDepth.onBeforeCompile = s => { terrUniforms(s);
    s.uniforms.uLeaf = { value: leaf }; s.uniforms.uTime = U.time;
    s.vertexShader = 'attribute vec4 aCard; uniform float uTime; varying vec3 vCard; varying vec3 vBark;\n' + s.vertexShader.replace('#include <project_vertex>', TREE_VERT);
    s.fragmentShader = 'uniform sampler2D uLeaf; varying vec3 vCard;\n' + LEAF_GLSL + s.fragmentShader.replace('#include <map_fragment>', 'float la = leafTex(vCard).a; if (vCard.z > 0.5 && la < 0.4) discard;');
  };
}
// Renders each tree type from the side and from above into one atlas (4 columns × 2 rows) for the far impostors
function bakeImpostors(geos, leaf) {
  const CS = 256, rt = new THREE.WebGLRenderTarget(CS * 4, CS * 2, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
  const mat = new THREE.ShaderMaterial({
    vertexColors: true, uniforms: { uLeaf: { value: leaf } },
    vertexShader: `attribute vec4 aCard; varying vec3 vCard; varying vec3 vCol;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vCard = vec3(0.5, 0.5, 0.0);
        if (aCard.w > 0.5) { float a = aCard.z; mv.xy += vec2(aCard.x * cos(a) - aCard.y * sin(a), aCard.x * sin(a) + aCard.y * cos(a)); vCard = vec3(sign(aCard.xy) * 0.5 + 0.5, aCard.w); }
        vCol = color; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: 'uniform sampler2D uLeaf; varying vec3 vCard; varying vec3 vCol;\n' + LEAF_GLSL + 'void main() { vec4 lt = leafTex(vCard); vec3 c = vCol; if (vCard.z > 0.5) { if (lt.a < 0.4) discard; c *= lt.rgb; } gl_FragColor = vec4(c, 1.0); }'
  });
  const sc = new THREE.Scene(), old = new THREE.Color(), oldA = renderer.getClearAlpha(); renderer.getClearColor(old);
  renderer.setClearColor(new THREE.Color(0.17, 0.26, 0.13), 0); renderer.setRenderTarget(rt); renderer.clear(); renderer.autoClear = false; rt.scissorTest = true;
  geos.forEach((g, t) => {
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; sc.add(m);
    const { H, R: Rc } = g.userData;
    for (let row = 0; row < 2; row++) {
      const cam = row ? new THREE.OrthographicCamera(-Rc, Rc, Rc, -Rc, 0.1, 200) : new THREE.OrthographicCamera(-H / 2, H / 2, H, 0, 0.1, 200);
      if (row) { cam.position.set(0, 100, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); } else cam.position.set(0, 0, 100);
      rt.viewport.set(t * CS, row * CS, CS, CS); rt.scissor.set(t * CS, row * CS, CS, CS);
      renderer.setRenderTarget(rt); renderer.render(sc, cam);
    }
    sc.remove(m);
  });
  renderer.setRenderTarget(null); renderer.autoClear = true; renderer.setClearColor(old, oldA); mat.dispose();
  return rt.texture;
}
async function buildTrees() {
  const leaf = leafAtlas(); treeMaterials(leaf); await rest();
  const hi = [0, 1, 2, 3].map(treeGeo); await rest(); const imp = bakeImpostors(hi, leaf), gl = renderer.getContext(); await rest();
  // impostor: an upright quad that turns towards the camera plus a flat cap for the view from above
  matTreeFar = std({ roughness: 0.85, metalness: 0 }, 'treefar', s => {
    s.uniforms.uImp = { value: imp }; s.uniforms.uCap = { value: hi.map(g => new THREE.Vector2(g.userData.R / (g.userData.H / 2), g.userData.capY / g.userData.H)) };
    s.vertexShader = 'attribute float aQ; attribute float aType; uniform vec2 uCap[4]; varying vec3 vImp;\n' + s.vertexShader.replace('#include <project_vertex>', `
      vec3 iC = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz; iC.y += terrainH(iC.xz); float iW = instanceMatrix[0].x, iH = instanceMatrix[1].y;
      vec3 iTo = cameraPosition - iC; vec2 iR = normalize(vec2(iTo.z, -iTo.x) + vec2(1e-5, 0.0));
      vec3 iP, iN; vec2 iCap = uCap[int(aType + 0.5)];
      if (aQ < 0.5) { iP = iC + vec3(iR.x, 0.0, iR.y) * (position.x * iW) + vec3(0.0, position.y * iH, 0.0); iN = vec3(iR.x, 0.0, iR.y) * (position.x * 0.9) + vec3(-iR.y, 0.0, iR.x) * 0.55 + vec3(0.0, position.y * 1.3 - 0.35, 0.0); }
      else { iP = iC + vec3(position.x * iCap.x * iW, iCap.y * iH, position.z * iCap.x * iW); iN = vec3(position.x * 0.35, 1.0, position.z * 0.35); }
      vNormal = normalize((viewMatrix * vec4(iN, 0.0)).xyz);
      vImp = vec3(uv, aType + aQ * 4.0);
      vec4 mvPosition = viewMatrix * vec4(iP, 1.0);
      gl_Position = projectionMatrix * mvPosition;`);
    s.fragmentShader = 'uniform sampler2D uImp; varying vec3 vImp;\n' + s.fragmentShader.replace('#include <map_fragment>', `
      float iq = step(3.5, vImp.z), it = vImp.z - iq * 4.0;
      vec4 it4 = texture2D(uImp, (vec2(it, iq) + clamp(vImp.xy, 0.01, 0.99)) * vec2(0.25, 0.5));
      float icut = mix(0.4, 0.14, smoothstep(250.0, 1400.0, length(vViewPosition)));
      diffuseColor.rgb *= pow(it4.rgb, vec3(2.2));
      diffuseColor.a = clamp((it4.a - icut) / max(fwidth(it4.a), 1e-3) + 0.5, 0.0, 1.0);
      if (diffuseColor.a < 0.05) discard;`).replace('reflectedLight.directSpecular + reflectedLight.indirectSpecular', '(reflectedLight.directSpecular + reflectedLight.indirectSpecular) * 0.12');
  });
  matTreeFar.extensions = { derivatives: true };
  const farGeo = new THREE.BufferGeometry();
  farGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0, -1, 0, -1, -1, 0, 1, 1, 0, 1, 1, 0, -1], 3));
  farGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  farGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1], 2));
  farGeo.setAttribute('aQ', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
  farGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  // a tree: its kind, the scale of the model across (sc) and up (sy), and a variation v for its tint and turn
  const add = (x, z, type, sc, v, sy = sc * (0.88 + (v * 7 % 1) * 0.3)) => {
    if (Math.abs(x) > HX || Math.abs(z) > HY || lmClear(x, z) || ssNoTree(x, z) || wetTree(x, z) || fortNoTree(x, z) || vbNoTree(x, z) || spwNoTree(x, z) || fuelNoTree(x, z) || ovNoTree(x, z) || parkNoTree(x, z) || upNoTree(x, z)) return;
    const i = Math.floor(x / TTILE), j = Math.floor(z / TTILE), k = (i + 100) * 1000 + j + 100;
    let t = treeTiles.get(k); if (!t) treeTiles.set(k, t = { x0: i * TTILE, z0: j * TTILE, list: [] }); t.list.push(x, z, type, sc, v, sy);
  };
  /* The trees the lidar found (lidar-trees.js, tools/lidar.js --trees): outside the woods each where it stands, as high
     and as wide as it was measured. With them the guessed trees go — those of OpenStreetMap, the rows of the parks, and
     the ones scattered over the land classes but for the woods and the scrub; the trees the landmarks set by hand stay,
     and a lidar tree within 4 m of one gives way to it. Where the model has no room for it — in a house, on a street,
     a path or a pitch, its crown in a wall — it is moved a few metres, its crown made narrower, or left out (treeRoom). */
  const LT = lidarTrees();
  if (!LT) for (let i = 0; i < C.t.length; i += 2) { const v = rnd(i, 2); add(C.t[i] / 10, C.t[i + 1] / 10, v < 0.7 ? 1 : v < 0.85 ? 2 : 3, 0.8 + rnd(i, 1) * 0.5, v); }
  const HAND = [];
  SQ_SPRUCES.forEach(([x, z, sc], k) => { add(x, z, 3, sc, rnd(k, 5)); HAND.push(x, z); });   // the spruces by Vienības laukums
  SHOP_TREES.forEach(([x, z, type, sc], k) => { add(x, z, type, sc, rnd(k, 11)); HAND.push(x, z); });   // trees on the lawns of the stores
  if (!LT) PARK_TREES.forEach(([x, z, type, sc], k) => add(x, z, type, sc, rnd(k, 13)));   // the rows of trees in the parks
  if (LT) {
    const near = new Set(); for (let k = 0; k < HAND.length; k += 2) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) near.add((Math.floor(HAND[k] / 4) + a) * 100000 + Math.floor(HAND[k + 1] / 4) + b);
    for (let k = 0; k < LT.length; k += 6) {
      if (k % 3072 === 0 && due()) await pause();
      const x = (LT[k] | LT[k + 1] << 8) / 5 - 6600, z = (LT[k + 2] | LT[k + 3] << 8) / 5 - 6600, h = LT[k + 4] / 5, r = (LT[k + 5] >> 4) * 0.8, type = LT[k + 5] & 15;
      if (near.has(Math.floor(x / 4) * 100000 + Math.floor(z / 4))) continue;
      const p = treeRoom(x, z, r); if (!p) { LIDAR_STATS.out++; continue; } if (p.moved) LIDAR_STATS.moved++; if (p.r < r) LIDAR_STATS.narrower++;
      const g = hi[type].userData, v = hash(k * 2654435761 + 7);
      add(p.x, p.z, type, Math.max(0.3, Math.min(3.5, p.r / g.R)), v, Math.max(0.3, Math.min(3.2, h / g.H)));
    }
  }
  // density per land class: spacing (m), keep probability, type picker
  const DENS = { 1: [17, 1, v => v < 0.58 ? 0 : v < 0.74 ? 3 : v < 0.9 ? 2 : 1], 2: [15, 0.8, v => 1], 4: [9.5, 0.82, v => v < 0.6 ? 1 : v < 0.8 ? 2 : v < 0.95 ? 3 : 0], 5: [16, 0.9, v => v < 0.55 ? 1 : v < 0.75 ? 2 : 3],
    8: [20, 0.38, v => v < 0.72 ? 1 : v < 0.86 ? 2 : 3], 11: [12, 0.5, v => v < 0.85 ? 1 : 2], 3: [30, 0.25, v => v < 0.6 ? 1 : 2] };
  const SCALE = { 1: [0.85, 0.5], 2: [0.35, 0.3], 4: [0.85, 0.65], 5: [0.8, 0.5], 8: [0.55, 0.45], 11: [0.45, 0.3], 3: [0.7, 0.5] };
  // the paved pedestrian squares (highway areas): no tree on them in a park
  const paved = AREAS.filter(a => a.cls === 12), onPaved = (x, z) => paved.some(a => x >= a.bb[0] && x <= a.bb[2] && z >= a.bb[1] && z <= a.bb[3] && pip(x, z, a.rings[0]));
  for (let n = 0; n < AREAS.length; n++) {
    const a = AREAS[n], d = DENS[a.cls]; if (!d || (LT && a.cls !== 1 && a.cls !== 2)) continue; const [s, keep, typ] = d, bb = a.bb;
    for (let gx = Math.ceil(bb[0] / s); gx * s < bb[2]; gx++) {
      if (due()) await pause();
      for (let gz = Math.ceil(bb[1] / s); gz * s < bb[3]; gz++) {
        const h1 = hash(gx * 73856093 ^ gz * 19349663 ^ n), h2 = hash(gx * 83492791 ^ gz * 2971215073 ^ n);
        if (h1 > keep) continue;
        const x = gx * s + (h2 - 0.5) * s * 0.9, z = gz * s + (hash(gx * 19 + gz * 7 + n) - 0.5) * s * 0.9;
        if (!pip(x, z, a.rings[0])) continue; let hole = false; for (let k = 1; k < a.rings.length; k++) if (pip(x, z, a.rings[k])) { hole = true; break; } if (hole) continue;
        if (onRoad(x, z, 2) || inBuilding(x, z) || inBuilding(x + 2, z) || inBuilding(x - 2, z) || inBuilding(x, z + 2) || inBuilding(x, z - 2) || (a.cls === 4 && onPaved(x, z)) || inParking(x, z)) continue;
        const sc = SCALE[a.cls]; add(x, z, typ(h2), sc[0] + h1 * sc[1], h2);
      }
    }
  }
  // the parks as OpenStreetMap draws them, where the city data has no park: as dense as the parks above
  const parkAreas = AREAS.filter(a => a.cls === 4), inPark = (x, z) => parkAreas.some(a => x >= a.bb[0] && x <= a.bb[2] && z >= a.bb[1] && z <= a.bb[3] && pip(x, z, a.rings[0]));
  if (!LT) PARK_RINGS.forEach((r, n) => {
    const [s, keep, typ] = DENS[4], sc = SCALE[4]; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); z0 = Math.min(z0, r[k + 1]); z1 = Math.max(z1, r[k + 1]); }
    for (let gx = Math.ceil(x0 / s); gx * s < x1; gx++) for (let gz = Math.ceil(z0 / s); gz * s < z1; gz++) {
      const h1 = hash(gx * 73856093 ^ gz * 19349663 ^ (n + 7000)), h2 = hash(gx * 83492791 ^ gz * 2971215073 ^ (n + 7000)); if (h1 > keep) continue;
      const x = gx * s + (h2 - 0.5) * s * 0.9, z = gz * s + (hash(gx * 19 + gz * 7 + n + 7000) - 0.5) * s * 0.9;
      if (!pip(x, z, r) || inPark(x, z) || onRoad(x, z, 2) || onPaved(x, z) || inBuilding(x, z) || inBuilding(x + 2, z) || inBuilding(x - 2, z) || inBuilding(x, z + 2) || inBuilding(x, z - 2)) continue;
      add(x, z, typ(h2), sc[0] + h1 * sc[1], h2);
    }
  });
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), q0 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color(); let count = 0;
  /* Culling. An instanced mesh is culled by a sphere of its own (InstancedMesh.boundingSphere), which three.js would
     build from the sphere of the geometry carried through every instance matrix: the impostor quad is scaled by the
     height of the tree, so that sphere came out kilometres wide, every tile of the city passed the frustum test and
     all of them were drawn in every frame (some 650 draws, the largest part of the frame). Each tile gets the sphere
     around its trees instead: crowns, heights, the rampart offset and the terrain lift the shaders add. */
  const tileSphere = new THREE.Sphere(new THREE.Vector3(0, 6, 0), TTILE * 0.75 + 20);
  hi.forEach(g => g.boundingSphere = tileSphere);
  const box = new THREE.Box3(), bp = new THREE.Vector3();
  const sphereOf = (l, n, cx, cz) => {
    box.makeEmpty();
    for (let i = 0; i < n; i++) {
      const x = l[6 * i], z = l[6 * i + 1], g = hi[l[6 * i + 2]].userData, sc = l[6 * i + 3], sy = l[6 * i + 5], r = Math.max(g.R, g.H / 2) * sc + 1, y = fortTreeY(x, z) + terrainH(x, z);
      box.expandByPoint(bp.set(x - cx - r, y - 1, z - cz - r)); box.expandByPoint(bp.set(x - cx + r, y + g.H * sy + 1, z - cz + r));
    }
    return box.getBoundingSphere(new THREE.Sphere());
  };
  // smooth leaf edges: with multisampling on, the alpha of a leaf card becomes sample coverage
  const a2cOn = () => { if (PP.msaa > 0) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE); }, a2cOff = () => gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  const tint = v => { const f = 0.84 + v * 0.3; return col.setRGB(f * (0.94 + (v * 13 % 1) * 0.14), f, f * (0.86 + (v * 29 % 1) * 0.12)); };
  for (const t of treeTiles.values()) {
    if (due()) await pause();
    const l = t.list, n = l.length / 6; count += n; t.hi = []; t.lo = [];
    const cx = t.x0 + TTILE / 2, cz = t.z0 + TTILE / 2;
    const fg = farGeo.clone(), types = new Float32Array(n); fg.boundingSphere = tileSphere;
    const L = new THREE.InstancedMesh(fg, matTreeFar, n), ts = sphereOf(l, n, cx, cz); L.boundingSphere = ts;
    for (let i = 0; i < n; i++) {
      const type = l[6 * i + 2], sc = l[6 * i + 3], v = l[6 * i + 4], sy = l[6 * i + 5], H = hi[type].userData.H; types[i] = type;
      M.compose(new THREE.Vector3(l[6 * i] - cx, fortTreeY(l[6 * i], l[6 * i + 1]), l[6 * i + 1] - cz), q0, new THREE.Vector3(sc * H / 2, sy * H, 1)); L.setMatrixAt(i, M); L.setColorAt(i, tint(v));
    }
    fg.setAttribute('aType', new THREE.InstancedBufferAttribute(types, 1));
    L.position.set(cx, 0, cz); L.instanceMatrix.needsUpdate = true; L.instanceColor.needsUpdate = true; L.onBeforeRender = a2cOn; L.onAfterRender = a2cOff; scene.add(L); t.lo.push(L);
    for (let type = 0; type < 4; type++) {
      const idx = []; for (let i = 0; i < n; i++) if (l[6 * i + 2] === type) idx.push(i); if (!idx.length) continue;
      const Hm = new THREE.InstancedMesh(hi[type], matTree, idx.length); Hm.boundingSphere = ts;
      idx.forEach((i, k) => {
        const sc = l[6 * i + 3], v = l[6 * i + 4], sy = l[6 * i + 5]; q.setFromAxisAngle(up, v * 6.283);
        M.compose(new THREE.Vector3(l[6 * i] - cx, fortTreeY(l[6 * i], l[6 * i + 1]), l[6 * i + 1] - cz), q, new THREE.Vector3(sc, sy, sc)); Hm.setMatrixAt(k, M); Hm.setColorAt(k, tint(v));
      });
      Hm.position.set(cx, 0, cz); Hm.instanceMatrix.needsUpdate = true; Hm.instanceColor.needsUpdate = true; Hm.customDepthMaterial = matTreeDepth;
      Hm.castShadow = true; Hm.receiveShadow = true; Hm.visible = false; Hm.onBeforeRender = a2cOn; Hm.onAfterRender = a2cOff; scene.add(Hm); t.hi.push(Hm);
    }
  }
  return count;
}

export { LIDAR_STATS, buildTrees, treeTiles };
