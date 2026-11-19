import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { due, pause } from '../core/pause.js';
import { inBuilding, inWater } from './data.js';
import { WH } from './walkgrid.js';
import { U, scene } from '../render/renderer.js';
import { std } from '../render/materials.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { hash, rnd } from '../core/util.js';

/* ---------- the wear of the streets ----------
   A road that is used is not one flat colour: the wheels polish dark tracks along every lane, patches of newer asphalt
   lie over the old, iron covers sit in the carriageway, oil drips where cars stand, and weeds seed the seam between the
   kerb and the asphalt and the outer edge of the sidewalk. The tracks and the gutter shadow are ribbons laid with the
   markings (src/world/streets.js, kind 'w' and 'g'); everything here is instanced decals and grass cards over the laid
   lines, one mesh a kind for the whole city. Lines on a bridge or in the cutting keep their own profile (gbc) and are
   left alone: the decals lie at road level. The grass stands at y = 0 (or WH on a sidewalk slab): the terrain lift of
   the page raises it after the instance matrix, as it does the lamps and the flowers. */

// the ribbons of wheel polish and the gutter shadow: one transparent sheet over the asphalt, under nothing else
function wearMat() {
  return std({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.7, metalness: 0 }, 'street-wear');
}

/* ---------- textures ---------- */
function manholeTex() {
  const S = 128, cv = mkCanvas(S, S), g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#43464a'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill();
  g.strokeStyle = '#2b2d30'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 57, 0, 7); g.stroke();
  g.strokeStyle = '#585c61'; g.lineWidth = 3;
  for (const r of [44, 26]) { g.beginPath(); g.arc(64, 64, r, 0, 7); g.stroke(); }
  g.lineWidth = 4;
  for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.beginPath(); g.moveTo(64 + Math.cos(a) * 28, 64 + Math.sin(a) * 28); g.lineTo(64 + Math.cos(a) * 42, 64 + Math.sin(a) * 42); g.stroke(); }
  g.fillStyle = '#585c61'; g.beginPath(); g.arc(64, 64, 12, 0, 7); g.fill();
  g.fillStyle = '#2b2d30'; g.beginPath(); g.arc(64, 64, 5, 0, 7); g.fill();
  for (let k = 0; k < 260; k++) { const a = hash(k * 3.7) * 7, r = Math.sqrt(hash(k * 9.1)) * 56; g.fillStyle = hash(k * 5.3) > 0.5 ? 'rgba(90,94,99,0.5)' : 'rgba(30,32,34,0.5)'; g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2, 2); }
  return toTex(cv, true, false);
}
// an irregular blob with a soft rim, used for patches of newer asphalt and for oil stains
function blobTex(fill, speck, seed) {
  const S = 128, cv = mkCanvas(S, S), g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.fillStyle = fill; g.beginPath();
  for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI * 2, r = 40 + hash(k * 7.9 + seed) * 18; const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r; k ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.fill();
  if (speck) for (let k = 0; k < 200; k++) { const a = hash(k * 3.1 + seed) * 7, r = Math.sqrt(hash(k * 8.3 + seed)) * 44; g.fillStyle = speck; g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2, 2); }
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createRadialGradient(64, 64, 20, 64, 64, 60); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return toTex(cv, true, false);
}
function grassTex() {
  const S = 128, cv = mkCanvas(S, S), g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  for (let b = 0; b < 15; b++) {
    const q = k => hash(b * 17.3 + k * 7.7), bx = 64 + (q(1) - 0.5) * 26, tipx = 64 + (q(2) - 0.5) * 96, tipy = 8 + q(3) * 46, w = 3 + q(4) * 3;
    const dry = q(5) > 0.8, base = dry ? '#5a6b2c' : '#33511f', tip = dry ? '#9a8f55' : '#86934a';
    const gr = g.createLinearGradient(0, S, 0, tipy); gr.addColorStop(0, base); gr.addColorStop(1, tip);
    g.fillStyle = gr; g.beginPath();
    g.moveTo(bx - w, S); g.quadraticCurveTo(bx - w + (tipx - bx) * 0.3, S * 0.5, tipx, tipy);
    g.quadraticCurveTo(bx + w + (tipx - bx) * 0.3, S * 0.5, bx + w, S); g.closePath(); g.fill();
  }
  return toTex(cv, true, false);
}

/* ---------- placement ---------- */
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function instanced(geo, mat, list, tint) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16);
  const c = new THREE.Color();
  list.forEach((m, i) => { attr.array.set(m.elements, i * 16); if (tint) im.setColorAt(i, tint(i, c)); });
  im.instanceMatrix = attr; im.frustumCulled = false;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  scene.add(im); return im;
}
async function buildStreetWear(sorted) {
  const covers = [], patches = [], stains = [], tufts = [];
  const put = (list, x, z, y, s, rot, cap) => { if (list.length >= cap) return; Q.setFromAxisAngle(UP, rot); M.compose(V.set(x, y, z), Q, S.set(s, s, s)); list.push(M.clone()); };
  for (let li = 0; li < sorted.length; li++) {
    if (due()) await pause();
    const l = sorted[li];
    if (l.cls > 3 || !l.dp || l.gbc || l.bridge || l.rural) continue;
    const p = l.dp, n = p.length >> 1, hw = l.isDual ? (l.zone || l.hw) : l.one ? (l.h1 || l.hw) : (l.hw || l.w / 2);   // a carriageway of a pair and a one-way ramp are narrower than the whole street
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
    const at = s => { let i = 0; while (i < n - 2 && cum[i + 1] < s) i++; const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
      const dx = p[2 * i + 2] - p[2 * i], dz = p[2 * i + 3] - p[2 * i + 1], dl = Math.hypot(dx, dz) || 1;
      return [p[2 * i] + dx * t, p[2 * i + 1] + dz * t, -dz / dl, dx / dl]; };
    const L = cum[n - 1];
    const sides = l.isDual ? [-l.side] : [1, -1];
    // iron covers in the carriageway, near one kerb, alternating sides along the street
    for (let s = 20, k = 0; s < L - 6; s += 38, k++) {
      if (hash(li * 3.3 + k * 7.1) > 0.6) continue;
      const [x, z, nx, nz] = at(s), o = (hw - 1.1) * (k % 2 ? 1 : -1);
      put(covers, x + nx * o, z + nz * o, 0.012, 0.72 + hash(li + k) * 0.12, hash(li * 5 + k) * 6.28, 2500);
    }
    // patches of newer asphalt and oil drips along the wheel paths
    for (let s = 8, k = 0; s < L - 4; s += 14, k++) {
      const h1 = hash(li * 9.7 + k * 3.1), [x, z, nx, nz] = at(s);
      if (h1 < 0.10) { const o = (hash(li + k * 5) - 0.5) * 2 * (hw - 1.2); put(patches, x + nx * o, z + nz * o, 0.010, 1.2 + hash(li * 2 + k) * 1.5, hash(li * 7 + k) * 6.28, 1200); }
      else if (h1 < 0.16) { const lane = (k % 2 ? 1 : -1) * hw / 2, o = lane + (hash(li * 4 + k) - 0.5) * 1.2; put(stains, x + nx * o, z + nz * o, 0.011, 0.7 + hash(li * 6 + k) * 1.1, hash(li * 3 + k) * 6.28, 700); }
    }
    // weeds: the seam at the kerb foot, the outer edge of the sidewalk where it meets grass, cracks in the slab
    for (let s = 3, k = 0; s < L - 2; s += 3.2, k++) {
      const [x, z, nx, nz] = at(s);
      for (const sg of sides) {
        const h = hash(li * 13.1 + k * 5.7 + sg * 3);
        const seam = hw - 0.16, outer = (l.isDual ? (l.zone || hw) + 2.8 : hw + 2.8);
        if (h < 0.22) { const o = sg * seam; put(tufts, x + nx * o, z + nz * o, 0, 0.45 + hash(li + k + sg) * 0.4, h * 6.28, 30000); }
        if (!l.one && h > 0.4 && h < 0.75) { const o = sg * outer, px = x + nx * o, pz = z + nz * o;
          if (!inBuilding(px, pz) && !inWater(px, pz)) put(tufts, px, pz, 0, 0.8 + hash(li * 2 + k + sg) * 0.6, h * 6.28, 30000); }
        if (!l.one && h > 0.96) { const o = sg * (hw + 0.7 + hash(li * 8 + k) * 1.4); put(tufts, x + nx * o, z + nz * o, WH, 0.35 + hash(li * 9 + k) * 0.3, h * 6.28, 30000); }
      }
    }
  }
  // the covers: iron, a little lighter or darker each
  const coverMat = std({ map: manholeTex(), alphaTest: 0.5, roughness: 0.5, metalness: 0.55 }, 'wear-cover');
  const coverGeo = new THREE.PlaneGeometry(1, 1); coverGeo.rotateX(-Math.PI / 2);
  const cm = instanced(coverGeo, coverMat, covers, (i, c) => c.setRGB(0.8 + rnd(i, 1) * 0.4, 0.8 + rnd(i, 2) * 0.4, 0.8 + rnd(i, 3) * 0.4));
  if (cm) { cm.renderOrder = -33.4; cm.receiveShadow = true; }
  // patches and stains: soft transparent sheets over the asphalt
  const patchMat = std({ map: blobTex('#2e2f31', 'rgba(120,122,124,0.35)', 3), transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.9, metalness: 0 }, 'wear-patch');
  const stainMat = std({ map: blobTex('#17130e', null, 8), transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.35, metalness: 0 }, 'wear-stain');
  const quad = new THREE.PlaneGeometry(1, 1); quad.rotateX(-Math.PI / 2);
  const pm = instanced(quad, patchMat, patches); if (pm) { pm.renderOrder = -33.8; pm.receiveShadow = true; }
  const sm = instanced(quad, stainMat, stains); if (sm) { sm.renderOrder = -33.7; sm.receiveShadow = true; }
  // the grass: two crossed cards a tuft, swaying in the wind of the page clock
  const g1 = new THREE.PlaneGeometry(0.55, 0.4); g1.translate(0, 0.2, 0);
  const g2 = g1.clone(); g2.rotateY(Math.PI / 2);
  const tuftGeo = mergeGeometries([g1, g2]);
  const grassMat = std({ map: grassTex(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }, 'wear-grass', s => {
    s.uniforms.uTime = U.time;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 iw = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float sw = sin(uTime * 1.7 + iw.x * 0.6 + iw.y * 0.4) + 0.5 * sin(uTime * 3.1 + iw.y * 0.9);
        transformed.x += sw * 0.035 * uv.y; transformed.z += sw * 0.02 * uv.y;
      #endif`);
  });
  const gm = instanced(tuftGeo, grassMat, tufts, (i, c) => c.setRGB(0.75 + rnd(i, 4) * 0.45, 0.8 + rnd(i, 5) * 0.4, 0.65 + rnd(i, 6) * 0.35));
  if (gm) { gm.castShadow = false; gm.receiveShadow = true; }
  return { covers: covers.length, patches: patches.length, stains: stains.length, tufts: tufts.length };
}

export { buildStreetWear, wearMat };
