import * as THREE from 'three';
import { due, pause } from '../core/pause.js';
import { scene } from '../render/renderer.js';
import { std } from '../render/materials.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { hash, rnd } from '../core/util.js';

/* ---------- the wear of the streets ----------
   A road that is used is not one flat colour: iron covers sit in the carriageway near the kerb, patches of newer
   asphalt lie over the old, oil drips where cars stand, and a shadow gathers in the gutter at the kerb foot. The
   gutter shadow is a ribbon laid with the markings (src/world/streets.js, kind 'g'); everything here is instanced
   decals over the laid lines, one mesh a kind for the whole city. Lines on a bridge or in the cutting keep their own
   profile (gbc) and are left alone: the decals lie at road level, y ≈ 0, and the terrain lift of the page raises them
   after the instance matrix, as it does the lamps and the flowers. */

// the gutter shadow: one transparent sheet over the asphalt at the kerb foot
function wearMat() {
  return std({ vertexColors: true, transparent: true, opacity: 0.11, depthWrite: false, roughness: 0.7, metalness: 0 }, 'street-wear');
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
  for (let k = 0; k <= 28; k++) { const a = k / 28 * Math.PI * 2, r = 42 + hash(Math.floor(k / 2) * 7.9 + seed) * 14 + hash(k * 3.3 + seed) * 4; const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r; k ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.fill();
  if (speck) for (let k = 0; k < 200; k++) { const a = hash(k * 3.1 + seed) * 7, r = Math.sqrt(hash(k * 8.3 + seed)) * 44; g.fillStyle = speck; g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2, 2); }
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createRadialGradient(64, 64, 26, 64, 64, 60); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
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
  const covers = [], patches = [], stains = [];
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
  return { covers: covers.length, patches: patches.length, stains: stains.length };
}

export { buildStreetWear, wearMat };
