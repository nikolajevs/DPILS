import * as THREE from 'three';
import { renderer } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { prop } from './props.js';
import { gunSource } from './avatar.js';
import { akReady } from './viewmodel.js';

/* ---------- the pictures of the inventory: the models themselves, shot once ----------
   A slot of the inventory (inventory.js) shows the thing as the game draws it, not a drawn sign: once the model of a
   gun or an item has come, the city's renderer shoots it once into a small target of its own — the guns from the side
   with the muzzle to the right, the items three quarters from above, on a transparent ground, lit by a little studio of
   three lights — and the pixels are kept as a picture (an object URL). Taken one at a time, a few milliseconds each,
   when the panel first wants them; until a picture is ready (or if a model never comes) the SVG of the slot stands in.
   Keys: 'g0'…'g4' — the guns in the order of WEAPONS (mp.js), the item kinds ('nade', 'smoke', 'napalm', 'med',
   'sight', 'optic'). */
const KEYS = ['g0', 'g1', 'g2', 'g3', 'g4', 'nade', 'smoke', 'napalm', 'med', 'sight', 'optic'];
const SIZE = { gun: [480, 150], item: [192, 192] };   // ≈3× the size they are shown at: sharp on a dense screen
// where the camera looks from (towards the middle of the model): the guns from their right side (+z, the muzzle, goes
// to the right of the picture), a little from above; the items three quarters, the optic more from the side (a tube)
const VIEW = { gun: [-1, 0.16, -0.05], item: [0.85, 0.8, 1.15], optic: [1.25, 0.55, 0.45], sight: [1.1, 0.6, 0.8] };
const pics = new Map(), subs = new Set();
let stage = null, busy = false;

function studio() {
  if (stage) return stage;
  stage = new THREE.Scene();
  stage.add(new THREE.HemisphereLight(0xe6eefa, 0x3a3430, 1.3 * Math.PI));
  const key = new THREE.DirectionalLight(0xfff0da, 2 * Math.PI); key.position.set(-1.5, 3, 2.2); stage.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.1 * Math.PI); fill.position.set(-3, 0.8, -0.6); stage.add(fill);   // the side the guns are seen from: dark metal reads as metal, not as a hole
  const rim = new THREE.DirectionalLight(0xc4d8ff, 0.9 * Math.PI); rim.position.set(1.6, 1.2, -2.6); stage.add(rim);
  return stage;
}
// a fresh copy of the model, or null while it has not come: the geometry is shared, the materials are copies marked
// worldSpace (the page lifts every shader by the terrain under it; the studio stands at its own origin)
function model(key) {
  let src = null;
  if (key[0] === 'g') { const i = +key.slice(1); src = i === 0 ? (akReady() || {}).gun : gunSource(i); }
  else src = prop(key);
  if (!src) return null;
  const m = src.clone(true);
  m.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(x => worldSpace(x.clone())) : worldSpace(o.material.clone()); });
  return m;
}
const V = new THREE.Vector3(), PREV = new THREE.Color();
async function shoot(key) {
  const obj = model(key); if (!obj) return false;
  const gun = key[0] === 'g', [W, H] = gun ? SIZE.gun : SIZE.item, sc = studio();
  const holder = new THREE.Group(); holder.add(obj); sc.add(holder); holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true), mid = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(...(VIEW[gun ? 'gun' : key] || VIEW.item)).normalize();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
  cam.position.copy(mid).addScaledVector(dir, 50); cam.up.set(0, 1, 0); cam.lookAt(mid); cam.updateMatrixWorld(true);
  // fit the frame to the model as the camera sees it: every vertex taken into the camera's frame
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  holder.traverse(o => {
    if (!o.isMesh) return; const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { V.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(cam.matrixWorldInverse); if (V.x < x0) x0 = V.x; if (V.x > x1) x1 = V.x; if (V.y < y0) y0 = V.y; if (V.y > y1) y1 = V.y; }
  });
  const pad = gun ? 1.04 : 1.1, aspect = W / H;
  let hw = (x1 - x0) / 2 * pad, hh = (y1 - y0) / 2 * pad;
  if (!(hw > 0 && hh > 0)) { sc.remove(holder); return false; }
  if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  cam.left = cx - hw; cam.right = cx + hw; cam.top = cy + hh; cam.bottom = cy - hh; cam.updateProjectionMatrix();
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;   // the target keeps sRGB, as the screen would (no tone mapping into a target)
  const prevRT = renderer.getRenderTarget(), prevA = renderer.getClearAlpha(); renderer.getClearColor(PREV);
  try {
    renderer.setRenderTarget(rt); const compiled = renderer.compileAsync(sc, cam); renderer.setRenderTarget(prevRT);
    await compiled;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam);
  } finally { renderer.setRenderTarget(prevRT); renderer.setClearColor(PREV, prevA); sc.remove(holder); }
  const buf = new Uint8Array(W * H * 4);
  await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, buf);
  rt.dispose();
  holder.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); });
  // the rows come bottom up; the edges are premultiplied by their coverage (the samples averaged over a clear ground)
  const img = new ImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const s0 = (H - 1 - y) * W * 4, d0 = y * W * 4;
    for (let x = 0; x < W * 4; x += 4) {
      const a = buf[s0 + x + 3], k = a > 0 && a < 255 ? 255 / a : 1;
      d[d0 + x] = Math.min(255, buf[s0 + x] * k); d[d0 + x + 1] = Math.min(255, buf[s0 + x + 1] * k); d[d0 + x + 2] = Math.min(255, buf[s0 + x + 2] * k); d[d0 + x + 3] = a;
    }
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').putImageData(img, 0, 0);
  const blob = await new Promise(r => cv.toBlob(r, 'image/webp', 0.92));
  if (!blob) return false;
  pics.set(key, URL.createObjectURL(blob));
  return true;
}
// shoot whatever has come and is not shot yet, one model at a time; each new picture is told to the subscribers
async function makePics() {
  if (busy) return; busy = true;
  try {
    for (const key of KEYS) {
      if (pics.has(key)) continue;
      let ok = false; try { ok = await shoot(key); } catch (e) { console.warn('inventory picture ' + key + ':', e); pics.set(key, null); }
      if (ok) for (const f of subs) f(key);
    }
  } finally { busy = false; }
}
const picUrl = key => pics.get(key) || null;
const onPic = f => { subs.add(f); };
export { makePics, onPic, picUrl };
