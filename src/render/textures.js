import * as THREE from 'three';
import { ANISO } from './renderer.js';
import { hash, hb } from '../core/util.js';

/* ---------- procedural textures ---------- */
let seedR = 12345; const R = () => (seedR = (seedR * 16807) % 2147483647) / 2147483647;
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function valueNoise(size, period, seed) { // tileable smooth noise in [0,1]
  const g = new Float32Array(period * period); for (let i = 0; i < g.length; i++) g[i] = hash(i * 131 + seed * 7919);
  const out = new Float32Array(size * size), k = period / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x * k, fy = y * k, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[(iy % period) * period + ix % period], b = g[(iy % period) * period + (ix + 1) % period], c = g[((iy + 1) % period) * period + ix % period], d = g[((iy + 1) % period) * period + (ix + 1) % period];
    out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return out;
}
function fbm(size, periods, seed) { const out = new Float32Array(size * size); let w = 0; periods.forEach((p, i) => { const n = valueNoise(size, p, seed + i), a = 1 / (i + 1); w += a; for (let k = 0; k < out.length; k++) out[k] += n[k] * a; }); for (let k = 0; k < out.length; k++) out[k] /= w; return out; }
function toTex(cv, srgb, repeat) {
  const t = new THREE.CanvasTexture(cv); t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* Facade atlas: 8 rows (style) × 4 columns (variant); each cell is one bay × one floor.
   Colour atlas is near-neutral; the mask says what the building tint applies to (R), where glass is (G). */
// The brick photographs (ambientCG CC0, grey: the building tint colours them), loaded before the atlas is drawn; null if a file is missing
const loadImg = url => new Promise(res => new THREE.ImageLoader().load(url, res, undefined, () => res(null)));
async function brickPhotos() { const [red, white] = await Promise.all([loadImg('textures/brick_red.webp'), loadImg('textures/brick_white.webp')]); return red && white ? { red, white } : null; }
function facadeAtlas(photos) {
  const S = 256, cv = mkCanvas(S * 4, S * 8), mk = mkCanvas(S * 4, S * 8), g = cv.getContext('2d'), m = mk.getContext('2d');
  const WALL = '#ff0000', TRIM = '#000000', GLASS = '#00ff00', HALF = '#5a0000';
  let ox = 0, oy = 0;
  // PBR atlas alongside the colour and the mask: R roughness, G metalness, B height (0.5 = the wall plane), A ambient
  // occlusion baked from the height once everything is drawn (bakeAO). WM/TM are the wall and trim materials of the row
  // being drawn; rect/path take an explicit override where the structure differs from them (mortar, seams, metal sheet).
  const pk = mkCanvas(S * 4, S * 8), p = pk.getContext('2d', { willReadFrequently: true });
  p.fillStyle = 'rgb(230,0,128)'; p.fillRect(0, 0, pk.width, pk.height);
  let WM = { r: 0.9, m: 0, h: 0.5 }, TM = { r: 0.6, m: 0, h: 0.66 };
  const GLASSP = { r: 0.06, m: 0, h: 0.5 };
  const ph = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };   // a hash of the position: the PBR jitter must not consume the seeded R of the colours
  const pset = (x, y, w, h, o) => { p.fillStyle = `rgb(${Math.round(o.r * 255)},${Math.round(o.m * 255)},${Math.round(o.h * 255)})`; p.fillRect(ox + x, oy + y, w, h); };
  const pbrOf = msk => msk === GLASS ? GLASSP : msk === TRIM ? TM : WM;
  const rect = (x, y, w, h, col, msk, po) => { g.fillStyle = col; g.fillRect(ox + x, oy + y, w, h); if (msk) { m.fillStyle = msk; m.fillRect(ox + x, oy + y, w, h); } pset(x, y, w, h, po || pbrOf(msk)); };
  const shade = (x, y, w, h, a) => { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(ox + x, oy + y, w, h); };
  const light = (x, y, w, h, a) => { g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(ox + x, oy + y, w, h); };
  const path = (fn, col, msk, po) => { g.beginPath(); fn(g, ox, oy); g.fillStyle = col; g.fill(); if (msk) { m.beginPath(); fn(m, ox, oy); m.fillStyle = msk; m.fill(); } const o = po || pbrOf(msk); p.beginPath(); fn(p, ox, oy); p.fillStyle = `rgb(${Math.round(o.r * 255)},${Math.round(o.m * 255)},${Math.round(o.h * 255)})`; p.fill(); };
  const scale = (hex, f) => { const c = hb(hex); return `rgb(${Math.min(255, c[0] * f) | 0},${Math.min(255, c[1] * f) | 0},${Math.min(255, c[2] * f) | 0})`; };
  function glass(x, y, w, h) {
    const gr = g.createLinearGradient(0, oy + y, 0, oy + y + h); gr.addColorStop(0, '#33414c'); gr.addColorStop(0.45, '#5b6d7b'); gr.addColorStop(0.5, '#3d4c58'); gr.addColorStop(1, '#2a343c');
    g.fillStyle = gr; g.fillRect(ox + x, oy + y, w, h); m.fillStyle = GLASS; m.fillRect(ox + x, oy + y, w, h); pset(x, y, w, h, GLASSP);
    shade(x, y, w, Math.min(8, h * 0.1), 0.35); shade(x, y, 5, h, 0.25);
  }
  // window: frame colour, frame width, layout ('soviet' | 'cross' | 'two' | 'one' | 'grid'), sill colour
  function win(x, y, w, h, o) {
    shade(x - 3, y - 2, w + 6, h + 4, 0.22);
    rect(x, y, w, h, o.frame, TRIM);
    const f = o.ft || 6; glass(x + f, y + f, w - 2 * f, h - 2 * f);
    const bar = (bx, by, bw, bh) => rect(bx, by, bw, bh, o.frame, TRIM);
    const iw = w - 2 * f, ih = h - 2 * f, bw = Math.max(3, f - 1);
    if (o.lay === 'soviet') { bar(x + f + iw * 0.42, y + f, bw, ih); bar(x + f, y + f + ih * 0.28, iw, bw); bar(x + f + iw * 0.71, y + f + ih * 0.28, bw, ih * 0.72); }
    else if (o.lay === 'cross') { bar(x + w / 2 - bw / 2, y + f, bw, ih); bar(x + f, y + f + ih * 0.32, iw, bw); }
    else if (o.lay === 'two') bar(x + w / 2 - bw / 2, y + f, bw, ih);
    else if (o.lay === 'grid') { for (let k = 1; k < 3; k++) bar(x + f + iw * k / 3, y + f, bw, ih); bar(x + f, y + f + ih * 0.3, iw, bw); }
    if (o.sill) { rect(x - 7, y + h, w + 14, 6, o.sill, TRIM, { r: 0.72, m: 0, h: 0.72 }); shade(x - 7, y + h + 6, w + 14, 5, 0.28); }
  }
  function bricks(x0, y0, w, h, bw, bh, base, mortar, vary, mortarMask, photo, pp) {
    if (photo) {   // a photographed course, wall tint all over; the relief comes from the photograph's own grey
      rect(x0, y0, w, h, mortar, WALL); g.save(); g.beginPath(); g.rect(ox + x0, oy + y0, w, h); g.clip(); g.drawImage(photo, ox + x0, oy + y0, S, S); g.restore();
      // mortar is the lighter grey in the red brick and the darker one in the silicate: each photo brings the signs of
      // its height/roughness fit (pp: h = hb + hs·lum, r = rb + rs·lum), so the joints sit lower in both
      const tc2 = mkCanvas(S, S), tg = tc2.getContext('2d', { willReadFrequently: true }); tg.drawImage(photo, 0, 0, S, S);
      const pd = tg.getImageData(0, 0, S, S).data, id2 = p.createImageData(w, h), d2 = id2.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k4 = (Math.min(S - 1, y * S / h | 0) * S + Math.min(S - 1, x * S / w | 0)) * 4;
        const lum = (pd[k4] * 0.299 + pd[k4 + 1] * 0.587 + pd[k4 + 2] * 0.114) / 255, o4 = (y * w + x) * 4;
        d2[o4] = Math.max(0, Math.min(255, (pp.rb + pp.rs * lum) * 255)); d2[o4 + 1] = 0;
        d2[o4 + 2] = Math.max(0, Math.min(255, (pp.hb + pp.hs * lum) * 255)); d2[o4 + 3] = 255;
      }
      p.putImageData(id2, ox + x0, oy + y0); return;
    }
    rect(x0, y0, w, h, mortar, mortarMask, { r: 0.95, m: 0, h: 0.32 });
    for (let r = 0, y = y0; y < y0 + h; r++, y += bh) for (let x = x0 - (r % 2 ? bw / 2 : 0); x < x0 + w; x += bw) {
      const v = 1 + (R() - 0.5) * vary; const xx = Math.max(x0, x + 1), ww = Math.min(x0 + w, x + bw - 1) - xx; if (ww <= 0) continue;
      rect(xx, y + 1, ww, Math.min(bh - 1.6, y0 + h - y - 1), scale(base, v), WALL, { r: 0.78 + 0.14 * ph(xx, y), m: 0, h: 0.56 + 0.12 * (ph(xx * 1.3, y * 2.1) - 0.5) });
    }
  }
  const cell = (c, r, fn) => { ox = c * S; oy = r * S; g.save(); m.save(); p.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip(); m.beginPath(); m.rect(ox, oy, S, S); m.clip(); p.beginPath(); p.rect(ox, oy, S, S); p.clip(); fn(); g.restore(); m.restore(); p.restore(); };
  const floorBand = (col) => { rect(0, S - 12, S, 12, col, TRIM); shade(0, S - 12, S, 2, 0.25); shade(0, S - 1, S, 1, 0.2); };
  function shop(frame) {
    rect(16, 18, S - 32, 34, '#2d3a33', TRIM, { r: 0.5, m: 0.1, h: 0.62 }); light(28, 30, 90, 8, 0.5); light(130, 30, 60, 8, 0.35);
    rect(16, 60, S - 32, S - 60, frame, TRIM, { r: 0.45, m: 0.4, h: 0.64 }); glass(24, 68, S - 48, S - 76); rect(S / 2 - 2, 68, 4, S - 76, frame, TRIM, { r: 0.45, m: 0.4, h: 0.66 });
    rect(16, S - 10, S - 32, 10, '#55524c', TRIM, { r: 0.8, m: 0, h: 0.6 });
  }
  const plaster = () => rect(0, 0, S, S, '#ece8e0', WALL);

  // row 0 — plaster, 19th-century eclectic
  WM = { r: 0.92, m: 0, h: 0.5 }; TM = { r: 0.62, m: 0, h: 0.68 };
  for (let c = 0; c < 4; c++) cell(c, 0, () => {
    plaster(); light(0, 0, 10, S, 0.12); light(S - 10, 0, 10, S, 0.12);
    if (c === 3) { shop('#3a3a36'); return; }
    floorBand('#f1eee8');
    const x = 80, y = 46, w = 96, h = 152;
    rect(x - 12, y - 10, w + 24, h + 14, '#f3f0ea', TRIM); shade(x - 12, y + h + 4, w + 24, 3, 0.2);
    if (c === 1) path((q, X, Y) => { q.moveTo(X + x - 12, Y + y + 30); q.arc(X + x + w / 2, Y + y + 30, w / 2 + 12, Math.PI, 0); q.lineTo(X + x + w + 12, Y + y + 40); q.lineTo(X + x - 12, Y + y + 40); }, '#f3f0ea', TRIM);
    if (c === 2) { path((q, X, Y) => { q.moveTo(X + x - 20, Y + y - 12); q.lineTo(X + x + w / 2, Y + y - 40); q.lineTo(X + x + w + 20, Y + y - 12); }, '#f3f0ea', TRIM); shade(x - 20, y - 12, w + 40, 4, 0.3); }
    else { rect(x - 20, y - 24, w + 40, 12, '#f5f2ec', TRIM); shade(x - 20, y - 12, w + 40, 4, 0.3); }
    if (c === 1) { path((q, X, Y) => { q.moveTo(X + x, Y + y + 30); q.arc(X + x + w / 2, Y + y + 30, w / 2, Math.PI, 0); q.lineTo(X + x + w, Y + y + h); q.lineTo(X + x, Y + y + h); }, '#efece5', TRIM); glass(x + 6, y + 30, w - 12, h - 36); rect(x + w / 2 - 2, y + 10, 4, h - 10, '#efece5', TRIM); rect(x + 6, y + 70, w - 12, 4, '#efece5', TRIM); rect(x - 8, y + h, w + 16, 6, '#f3f0ea', TRIM); shade(x - 8, y + h + 6, w + 16, 4, 0.25); }
    else win(x, y, w, h, { frame: '#efece5', ft: 6, lay: 'cross', sill: '#f3f0ea' });
  });
  // row 1 — red brick (Daugavpils fortress and old town)
  WM = { r: 0.85, m: 0, h: 0.58 }; TM = { r: 0.6, m: 0, h: 0.66 };
  for (let c = 0; c < 4; c++) cell(c, 1, () => {
    bricks(0, 0, S, S, 16, 6, '#e6dad2', '#d9d3cb', 0.22, HALF, photos && photos.red, { hb: 0.72, hs: -0.52, rb: 0.7, rs: 0.28 });
    if (c === 3) { shop('#2f2c28'); return; }
    rect(0, S - 10, S, 10, '#cfc6bc', HALF); shade(0, S - 10, S, 2, 0.3);
    if (c === 1) { for (let x = 0; x < S; x += 16) { rect(x + 2, 6, 10, 10, '#cfc5bd', WALL); shade(x + 2, 16, 10, 2, 0.35); } rect(0, 0, 14, S, '#ddd1c8', WALL); rect(S - 14, 0, 14, S, '#ddd1c8', WALL); shade(14, 0, 3, S, 0.2); }
    const x = c === 2 ? 70 : 82, w = c === 2 ? 116 : 92, y = 52, h = 150;
    path((q, X, Y) => { q.moveTo(X + x - 12, Y + y + 26); q.quadraticCurveTo(X + x + w / 2, Y + y - 14, X + x + w + 12, Y + y + 26); q.lineTo(X + x + w + 12, Y + y + 34); q.lineTo(X + x - 12, Y + y + 34); }, '#b9aba2', WALL);
    for (let k = 0; k <= 10; k++) { const t = k / 10, ax = x - 12 + (w + 24) * t; shade(ax, y + 2 + Math.abs(t - 0.5) * 34, 1.5, 22, 0.35); }
    if (c === 2) { win(x, y + 26, w / 2 - 4, h - 26, { frame: '#e9e6df', ft: 6, lay: 'one' }); win(x + w / 2 + 4, y + 26, w / 2 - 4, h - 26, { frame: '#e9e6df', ft: 6, lay: 'one' }); rect(x - 6, y + h, w + 12, 6, '#a39890', HALF); }
    else win(x, y + 26, w, h - 26, { frame: '#e9e6df', ft: 6, lay: 'cross', sill: '#a39890' });
  });
  // row 2 — silicate (white) brick, Soviet 1960–80s
  WM = { r: 0.82, m: 0, h: 0.58 }; TM = { r: 0.6, m: 0, h: 0.66 };
  for (let c = 0; c < 4; c++) cell(c, 2, () => {
    bricks(0, 0, S, S, 16, 6, '#f0eee8', '#d6d3cc', 0.1, WALL, photos && photos.white, { hb: -0.15, hs: 0.95, rb: 0.98, rs: -0.22 });
    rect(0, S - 6, S, 6, '#c9c6bf', WALL);
    if (c === 3) { rect(92, 70, 72, S - 70, '#5c4a3c', TRIM); light(98, 76, 60, 2, 0.2); rect(84, 52, 88, 14, '#9a978f', TRIM); shade(84, 66, 88, 4, 0.4); glass(104, 24, 48, 22); return; }
    if (c === 1) { rect(40, 36, 58, 214, '#ece9e2', TRIM); glass(48, 44, 42, 80); rect(48, 130, 42, 112, '#e2ded5', TRIM); shade(48, 130, 42, 3, 0.2); win(110, 66, 100, 134, { frame: '#ece9e2', ft: 7, lay: 'cross', sill: '#b9b6ae' }); return; }
    win(56, 66, 144, 134, c === 2 ? { frame: '#f7f7f5', ft: 5, lay: 'two', sill: '#e3e3e0' } : { frame: '#e9e6dd', ft: 7, lay: 'soviet', sill: '#b9b6ae' });
  });
  // row 3 — concrete panel blocks
  WM = { r: 0.9, m: 0, h: 0.55 }; TM = { r: 0.55, m: 0, h: 0.64 };
  for (let c = 0; c < 4; c++) cell(c, 3, () => {
    rect(0, 0, S, S, '#dedad2', WALL);
    if (c === 1) { for (let y = 0; y < S; y += 9) for (let x = (y / 9 % 2) * 4; x < S; x += 9) rect(x + 1, y + 1, 7, 7, scale('#e6e2da', 0.94 + R() * 0.1), WALL, { r: 0.88, m: 0, h: 0.55 + 0.1 * (ph(x, y) - 0.5) }); }
    rect(0, 0, 3, S, '#8b8880', TRIM, { r: 0.92, m: 0, h: 0.24 }); rect(0, 0, S, 3, '#8b8880', TRIM, { r: 0.92, m: 0, h: 0.24 }); light(3, 3, S, 2, 0.25);
    if (c === 3) { rect(96, 64, 64, S - 64, '#4a4038', TRIM); rect(84, 48, 88, 12, '#a7a49c', TRIM); shade(84, 60, 88, 5, 0.4); return; }
    win(64, 76, 128, 120, c === 2 ? { frame: '#f7f7f5', ft: 5, lay: 'two', sill: '#e3e3e0' } : { frame: '#dcd8cc', ft: 7, lay: 'soviet', sill: '#a9a69e' });
  });
  // row 4 — renovated / modern plaster
  WM = { r: 0.78, m: 0, h: 0.5 }; TM = { r: 0.5, m: 0, h: 0.62 };
  for (let c = 0; c < 4; c++) cell(c, 4, () => {
    rect(0, 0, S, S, '#efede8', WALL);
    if (c === 3) { shop('#3b3e42'); return; }
    if (c === 2) { rect(0, 0, S, S, '#4a4f55', TRIM, { r: 0.4, m: 0.6, h: 0.55 }); glass(6, 6, S - 12, S - 12); for (let x = 0; x <= S; x += 64) rect(x - 3, 0, 6, S, '#4a4f55', TRIM, { r: 0.35, m: 0.7, h: 0.6 }); rect(0, S - 26, S, 6, '#4a4f55', TRIM, { r: 0.35, m: 0.7, h: 0.6 }); return; }
    if (c === 1) { rect(0, S - 40, S, 40, '#d9d5cc', HALF); win(50, 50, 156, 154, { frame: '#3f4348', ft: 6, lay: 'grid', sill: '#5a5e63' }); return; }
    win(66, 60, 124, 140, { frame: '#f8f8f6', ft: 6, lay: 'two', sill: '#d8d8d4' });
  });
  // row 5 — wooden houses with carved window trims
  WM = { r: 0.68, m: 0, h: 0.56 }; TM = { r: 0.55, m: 0, h: 0.72 };
  for (let c = 0; c < 4; c++) cell(c, 5, () => {
    for (let y = 0; y < S; y += 16) { rect(0, y, S, 16, scale('#e8e2d8', 0.92 + R() * 0.12), WALL, { r: 0.66 + 0.08 * ph(0, y), m: 0, h: 0.56 + 0.08 * (ph(1, y) - 0.5) }); light(0, y, S, 2, 0.18); shade(0, y + 14, S, 2, 0.4); pset(0, y + 14, S, 2, { r: 0.8, m: 0, h: 0.3 }); }
    for (let k = 0; k < 40; k++) { const gx = R() * S, gy = Math.floor(R() * 16) * 16 + 4, gw = 30 + R() * 60; shade(gx, gy, gw, 1, 0.08); pset(gx, gy, gw, 1, { r: 0.72, m: 0, h: 0.47 }); }
    if (c === 2) return;
    if (c === 3) { rect(90, 40, 76, S - 40, '#efe9de', TRIM); rect(98, 50, 60, S - 50, '#8c6a4c', HALF, { r: 0.65, m: 0, h: 0.58 }); for (let x = 104; x < 156; x += 12) { shade(x, 50, 2, S - 50, 0.3); pset(x, 50, 2, S - 50, { r: 0.75, m: 0, h: 0.36 }); } return; }
    const x = 92, y = 70, w = 72, h = 118;
    if (c === 1) { for (const sx of [x - 44, x + w + 8]) { rect(sx, y, 36, h, '#c9c2b6', HALF, { r: 0.7, m: 0, h: 0.6 }); for (let yy = y + 6; yy < y + h; yy += 12) { shade(sx + 3, yy, 30, 2, 0.35); pset(sx + 3, yy, 30, 2, { r: 0.78, m: 0, h: 0.4 }); } } }
    rect(x - 12, y - 10, w + 24, h + 22, '#f1ede5', TRIM);
    path((q, X, Y) => { q.moveTo(X + x - 18, Y + y - 10); q.lineTo(X + x + w / 2, Y + y - 46); q.lineTo(X + x + w + 18, Y + y - 10); }, '#f1ede5', TRIM);
    for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(ox + x - 4 + k * (w + 8) / 4, oy + y - 6, 4, 0, Math.PI); g.fill(); }
    shade(x - 18, y - 10, w + 36, 3, 0.3);
    path((q, X, Y) => { q.moveTo(X + x - 10, Y + y + h + 12); q.lineTo(X + x + w + 10, Y + y + h + 12); q.lineTo(X + x + w / 2, Y + y + h + 34); }, '#f1ede5', TRIM);
    win(x, y, w, h, { frame: '#f6f3ed', ft: 6, lay: 'cross' });
  });
  // row 6 — industrial
  WM = { r: 0.88, m: 0, h: 0.55 }; TM = { r: 0.45, m: 0.5, h: 0.62 };
  for (let c = 0; c < 4; c++) cell(c, 6, () => {
    if (c === 2) { rect(0, 0, S, S, '#d4d1ca', HALF, { r: 0.95, m: 0, h: 0.34 }); for (let y = 0; y < S; y += 32) for (let x = (y / 32 % 2) * 32; x < S; x += 64) rect(x + 1, y + 1, 62, 30, scale('#e2dfd8', 0.95 + R() * 0.08), WALL, { r: 0.88, m: 0, h: 0.56 + 0.08 * (ph(x, y) - 0.5) }); glass(40, 24, 176, 40); for (let x = 40; x <= 216; x += 44) rect(x - 2, 24, 4, 40, '#55595d', TRIM, { r: 0.4, m: 0.6, h: 0.62 }); return; }
    for (let x = 0; x < S; x++) { const v = 0.86 + 0.14 * Math.sin(x / 16 * Math.PI * 2); g.fillStyle = scale('#e9e9e6', v); g.fillRect(ox + x, oy, 1, S); pset(x, 0, 1, S, { r: 0.42 + 0.12 * (1 - v), m: 0.85, h: 0.5 + 0.16 * Math.sin(x / 16 * Math.PI * 2) }); }
    m.fillStyle = WALL; m.fillRect(ox, oy, S, S);
    if (c === 0) { rect(0, 28, S, 46, '#4d5256', TRIM, { r: 0.4, m: 0.6, h: 0.62 }); glass(0, 32, S, 38); for (let x = 0; x < S; x += 32) rect(x, 28, 3, 46, '#4d5256', TRIM, { r: 0.4, m: 0.6, h: 0.64 }); }
    if (c === 3) { rect(28, 40, 200, S - 40, '#9a9c9e', HALF, { r: 0.5, m: 0.75, h: 0.55 }); for (let y = 44; y < S; y += 8) { shade(28, y, 200, 2, 0.25); pset(28, y, 200, 2, { r: 0.55, m: 0.7, h: 0.32 }); } }
  });
  // row 7 — plain outbuildings, garages
  WM = { r: 0.9, m: 0, h: 0.5 }; TM = { r: 0.6, m: 0, h: 0.64 };
  for (let c = 0; c < 4; c++) cell(c, 7, () => {
    rect(0, 0, S, S, '#e4e0d8', WALL);
    for (let y = 0; y < S; y += 24) { shade(0, y, S, 1, 0.08); pset(0, y, S, 1, { r: 0.9, m: 0, h: 0.38 }); }
    if (c === 1) win(96, 70, 64, 56, { frame: '#d9d4ca', ft: 6, lay: 'two' });
    if (c === 2) { rect(18, 50, 220, S - 50, '#a8aaa6', HALF, { r: 0.5, m: 0.7, h: 0.55 }); for (let x = 22; x < 236; x += 10) { shade(x, 50, 3, S - 50, 0.18); pset(x, 50, 3, S - 50, { r: 0.55, m: 0.65, h: 0.35 }); } rect(126, 50, 4, S - 50, '#6f716e', TRIM, { r: 0.45, m: 0.7, h: 0.4 }); shade(18, 50, 220, 5, 0.35); }
    if (c === 3) { rect(100, 72, 58, S - 72, '#6a5a4a', HALF, { r: 0.65, m: 0, h: 0.58 }); shade(100, 72, 58, 4, 0.4); }
  });
  // plaster grain and soiling where the tint applies; the same grain goes into the height and the roughness, so the
  // relief and the sheen carry the grain of the plaster instead of a flat plane
  const id = g.getImageData(0, 0, cv.width, cv.height), md = m.getImageData(0, 0, cv.width, cv.height).data, d = id.data;
  const pid = p.getImageData(0, 0, pk.width, pk.height), pd2 = pid.data;
  const nz = fbm(256, [8, 32, 64], 4);
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const k = (y * cv.width + x) * 4, w = md[k] / 255; if (w < 0.05) continue;
    const n = (nz[(y & 255) * 256 + (x & 255)] - 0.5) * 0.18 + (Math.random() - 0.5) * 0.07, f = 1 + n * w;
    d[k] = Math.min(255, d[k] * f); d[k + 1] = Math.min(255, d[k + 1] * f); d[k + 2] = Math.min(255, d[k + 2] * f);
    pd2[k + 2] = Math.max(0, Math.min(255, pd2[k + 2] + n * w * 46));
    pd2[k] = Math.max(0, Math.min(255, pd2[k] + (Math.random() - 0.5) * 14 * w));
  }
  g.putImageData(id, 0, 0); p.putImageData(pid, 0, 0);
  bakeAO(p, pk.width, pk.height, S, S);
  const tc = toTex(cv, false, false), tm = toTex(mk, false, false), tp = toTex(pk, false, false);
  tc.generateMipmaps = tm.generateMipmaps = tp.generateMipmaps = true; tc.minFilter = tm.minFilter = tp.minFilter = THREE.LinearMipmapLinearFilter;
  return [tc, tm, tp];
}
/* Ambient occlusion from the height channel of a PBR atlas: a pixel lower than the average of its neighbourhood sits in
   a joint, a groove or a recess and takes less indirect light. Samples stay inside the cell (the neighbours across a
   cell border are another material, not a crevice). Writes the A channel; the RGB is left as drawn. */
function bakeAO(ctx, W, H, CW, CH) {
  const id = ctx.getImageData(0, 0, W, H), d = id.data;
  const hAt = (x, y) => d[(y * W + x) * 4 + 2];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = Math.floor(x / CW) * CW, cy = Math.floor(y / CH) * CH, k = (y * W + x) * 4;
    const x0 = Math.max(cx, x - 3), x1 = Math.min(cx + CW - 1, x + 3), y0 = Math.max(cy, y - 3), y1 = Math.min(cy + CH - 1, y + 3);
    const x2 = Math.max(cx, x - 6), x3 = Math.min(cx + CW - 1, x + 6), y2 = Math.max(cy, y - 6), y3 = Math.min(cy + CH - 1, y + 6);
    const avg = (hAt(x0, y) + hAt(x1, y) + hAt(x, y0) + hAt(x, y1) + hAt(x2, y) + hAt(x3, y) + hAt(x, y2) + hAt(x, y3)) / 8;
    const cav = Math.max(0, (avg - d[k + 2]) / 255);
    d[k + 3] = Math.round((1 - Math.min(0.42, cav * 1.9)) * 255);
  }
  ctx.putImageData(id, 0, 0);
}
/* Roof atlas, 4 × 2 tiles of 3 m: 0 concrete, 1 asbestos slate, 2 metal, 3 clay tiles, 4 shingles, 5 membrane, 6 glass, 7 wooden shingles */
function roofAtlas() {
  const S = 256, cv = mkCanvas(S * 4, S * 2), g = cv.getContext('2d');
  const id = g.createImageData(cv.width, cv.height), d = id.data, nz = fbm(256, [4, 16, 64], 9), nz2 = valueNoise(256, 32, 21);
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const t = (x >> 8) + 4 * (y >> 8), u = x & 255, v = y & 255, n = nz[v * 256 + u], fine = Math.random();
    let r = 220, gg = 220, b = 216, f = 1;
    if (t === 0) f = 0.85 + n * 0.25 + fine * 0.08;
    else if (t === 1) { const w = Math.sin(u / 256 * Math.PI * 2 * 14); f = 0.86 + 0.12 * w + (v % 96 < 4 ? -0.25 : 0) + (n - 0.5) * 0.3; if (nz2[v * 256 + u] > 0.72) { r = 160; gg = 175; b = 120; } }
    else if (t === 2) { const s = u % 43; f = 0.95 + (s < 2 ? 0.18 : s < 4 ? -0.15 : 0) + (n - 0.5) * 0.12; }
    else if (t === 3) { const row = v % 32, col = (u + (Math.floor(v / 32) % 2) * 16) % 32; f = 0.8 + 0.25 * Math.sin(col / 32 * Math.PI) - (row > 27 ? 0.3 : 0) + (n - 0.5) * 0.15; }
    else if (t === 4) { const row = v % 20, col = (u + (Math.floor(v / 20) % 2) * 16) % 32; f = 0.9 + (row > 16 ? -0.35 : 0) + (col < 2 ? -0.25 : 0) + (n - 0.5) * 0.25 + fine * 0.1; }
    else if (t === 5) { f = 0.85 + (n - 0.5) * 0.35 + fine * 0.1 + (u % 85 < 2 ? 0.1 : 0); }
    else if (t === 6) { const s = u % 64, q = v % 128; f = s < 4 || q < 4 ? 0.55 : 1.0; r = 205; gg = 225; b = 228; }
    else { const row = v % 14, col = (u + (Math.floor(v / 14) % 3) * 7) % 21; f = 0.88 + (row > 11 ? -0.35 : 0) + (col < 1 ? -0.3 : 0) + (fine - 0.5) * 0.18; }
    const k = (y * cv.width + x) * 4; d[k] = Math.max(0, Math.min(255, r * f)); d[k + 1] = Math.max(0, Math.min(255, gg * f)); d[k + 2] = Math.max(0, Math.min(255, b * f)); d[k + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  const t = toTex(cv, false, false); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
const DETAIL_FILES = ['grass', 'asph', 'pave', 'gravel'], detailCache = [];
// Photographic detail (ambientCG CC0, textures/detail_*.webp, grey ≈ 128 means "no change"). The procedural noise below stands in
// until the photograph has come; the texture object is kept, only its image swaps. One texture per kind is shared by all materials.
function detailTex(kind) {
  if (detailCache[kind]) return detailCache[kind];
  const t = detailCache[kind] = detailNoise(kind);
  new THREE.TextureLoader().load(`textures/detail_${DETAIL_FILES[kind]}.webp`, img => { t.image = img.image; t.needsUpdate = true; }, undefined, () => {});
  return t;
}
function detailNoise(kind) {
  const S = 256, cv = mkCanvas(S, S), g = cv.getContext('2d'), id = g.createImageData(S, S), d = id.data;
  const n1 = fbm(S, [4, 8, 16, 32], kind * 17 + 3), n2 = valueNoise(S, 64, kind * 5 + 1);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, r = Math.random(); let v;
    if (kind === 0) v = 128 + (n1[i] - 0.5) * 70 + (r - 0.5) * 34 + (n2[i] - 0.5) * 20;            // grass / soil
    else if (kind === 1) v = 128 + (n1[i] - 0.5) * 30 + (r - 0.5) * 46 + (n2[i] > 0.8 ? -18 : 0);  // asphalt
    else if (kind === 2) { const a = x % 32, b = (y + (Math.floor(x / 32) % 2) * 16) % 32; v = 136 + (n1[i] - 0.5) * 30 + (r - 0.5) * 20 - (a < 2 || b < 2 ? 46 : 0); } // paving
    else v = 128 + (r - 0.5) * 90 + (n1[i] - 0.5) * 30;                                            // gravel ballast
    v = Math.max(0, Math.min(255, v)); d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255;
  }
  g.putImageData(id, 0, 0); return toTex(cv, false, true);
}
function waterNormalTex() {
  const S = 256, cv = mkCanvas(S, S), g = cv.getContext('2d'), id = g.createImageData(S, S), d = id.data;
  const W = [[3, 1, 0.5], [-2, 4, 0.35], [7, -3, 0.18], [-9, -6, 0.12], [13, 11, 0.06], [5, 17, 0.05]];
  const H = (x, y) => W.reduce((s, [a, b, amp], k) => s + amp * Math.sin(2 * Math.PI * (a * x + b * y) / S + k * 1.7), 0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1); const l = Math.hypot(dx * 2, dy * 2, 1);
    const k = (y * S + x) * 4; d[k] = (dx * 2 / l * 0.5 + 0.5) * 255; d[k + 1] = (dy * 2 / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  g.putImageData(id, 0, 0); return toTex(cv, false, true);
}
function glowTex() { const cv = mkCanvas(128, 128), g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return toTex(cv, false, false); }

export { R, bakeAO, brickPhotos, detailTex, facadeAtlas, fbm, glowTex, mkCanvas, roofAtlas, toTex, valueNoise, waterNormalTex };
