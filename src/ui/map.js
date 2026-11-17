import { STATE } from '../core/state.js';
import { P } from '../game/player.js';
import { PLACES } from './places.js';
import { drawVehicles } from '../transit/transit.js';
import { AREAS, BLD, LINES } from '../world/data.js';
import { canvas } from '../render/renderer.js';
import { $, HX, HY } from '../core/env.js';

/* ---------- 2D map (minimap and full map) ---------- */
function drawMap(ctx, w, h, cx, cz, ppm, dpr, detail) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = STATE.night ? '#232b33' : '#e6e4d8'; ctx.fillRect(0, 0, w, h);
  const x0 = cx - w / 2 / ppm, x1 = cx + w / 2 / ppm, z0 = cz - h / 2 / ppm, z1 = cz + h / 2 / ppm;
  ctx.setTransform(ppm * dpr, 0, 0, ppm * dpr, (w / 2 - cx * ppm) * dpr, (h / 2 - cz * ppm) * dpr);
  const vis = bb => bb[2] >= x0 && bb[0] <= x1 && bb[3] >= z0 && bb[1] <= z1;
  const path = r => { ctx.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]); ctx.closePath(); };
  const AC = STATE.night ? { 0: '#2c4f66', 1: '#2c4433', 4: '#31503a', 3: '#2f4636', 5: '#2f4636', 10: '#356043', 6: '#4c4a3c', 14: '#38393c' } : { 0: '#9cc3d9', 1: '#b5d0a4', 4: '#c3dcae', 3: '#d2e2be', 5: '#c5d6b8', 10: '#b2d6a3', 6: '#efe4bd', 2: '#c8d9b3', 11: '#d3dfc0', 14: '#d6d4cf' };
  for (const a of AREAS) { const c = AC[a.cls]; if (!c || !vis(a.bb)) continue; ctx.beginPath(); for (const r of a.rings) path(r); ctx.fillStyle = c; ctx.fill('evenodd'); }
  if (detail > 0) { ctx.fillStyle = STATE.night ? '#4a535c' : '#c9bfae'; ctx.beginPath(); for (const b of BLD) if (vis(b.bb) && (detail > 1 || b.kind !== 7)) path(b.ring); ctx.fill(); }
  const minW = 1 / ppm;
  const pass = (test, color, wmul, wmin) => { ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const l of LINES) { if (!test(l.cls) || !vis(l.bb)) continue; const p = l.pts; ctx.lineWidth = Math.max(l.w * wmul, wmin * minW); ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.stroke(); } };
  pass(c => c === 10 || c === 11, STATE.night ? '#2c4f66' : '#9cc3d9', 1, 0.8);
  if (detail > 1) pass(c => c === 6 || c === 15 || c === 7, STATE.night ? '#59616a' : '#cfc6b4', 1, 0.6);
  if (detail > 0) pass(c => c === 4 || c === 5, STATE.night ? '#6a737c' : '#ffffff', 1, 0.7);
  pass(c => c === 8, STATE.night ? '#8d8479' : '#8b8580', 0.5, 0.9);
  pass(c => c === 3, STATE.night ? '#7d8790' : '#ffffff', 1, 1.1);
  pass(c => c <= 2, STATE.night ? '#c4a36a' : '#f3d08a', 1.1, 1.8);
  if (detail > 1) pass(c => c === 9, '#b3272d', 0.25, 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const mini = $('minimap'), mctx = mini.getContext('2d'); STATE.mapTimer = 0;
/* The minimap is put together from square tiles of the map drawn once and kept: drawing the houses, areas and streets
   of the whole window anew every 0.15 s took up to a third of the main thread in flight (thousands of houses in view).
   Tiles are 256 CSS pixels at zoom levels half an octave apart; the level is the next finer one, scaled down to the
   zoom of the moment, and each tile carries a 2 px margin so the scaled tiles overlap without seams. */
const MT = { T: 256, pad: 2, max: 20, cache: new Map() };
function miniTile(lv, i, j, dpr) {
  const key = lv + ':' + i + ':' + j + ':' + (STATE.night ? 1 : 0) + ':' + dpr;
  let c = MT.cache.get(key);
  if (c) { MT.cache.delete(key); MT.cache.set(key, c); return c; }   // the cache keeps the most recently used tiles
  const ppm = Math.pow(2, lv / 2), S = MT.T + 2 * MT.pad, size = MT.T / ppm;
  c = document.createElement('canvas'); c.width = c.height = Math.round(S * dpr);
  drawMap(c.getContext('2d'), S, S, (i + 0.5) * size, (j + 0.5) * size, ppm, dpr, ppm > 0.22 ? 2 : ppm > 0.07 ? 1 : 0);
  MT.cache.set(key, c); if (MT.cache.size > MT.max) MT.cache.delete(MT.cache.keys().next().value);
  return c;
}
function drawMini() {
  const css = mini.clientWidth || 190, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (mini.width !== Math.round(css * dpr)) mini.width = mini.height = Math.round(css * dpr);
  const ppm = P.fly ? Math.max(0.03, css / (700 + P.y * 9)) : css / 380;
  const lv = Math.ceil(Math.log2(ppm) * 2 - 1e-6), s = ppm / Math.pow(2, lv / 2), size = MT.T / Math.pow(2, lv / 2), half = css / 2 / ppm, S = (MT.T + 2 * MT.pad) * s;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.imageSmoothingEnabled = true;
  for (let j = Math.floor((P.z - half) / size); j <= Math.floor((P.z + half) / size); j++) for (let i = Math.floor((P.x - half) / size); i <= Math.floor((P.x + half) / size); i++)
    mctx.drawImage(miniTile(lv, i, j, dpr), css / 2 + (i * size - P.x) * ppm - MT.pad * s, css / 2 + (j * size - P.z) * ppm - MT.pad * s, S, S);
  drawVehicles(mctx, P.x, P.z, ppm, css, css, ppm > 0.1 ? 3.5 : 2.5);
  if (STATE.mapOverlay) STATE.mapOverlay(mctx, P.x, P.z, ppm, css, css);
  arrow(mctx, css / 2, css / 2, 1);
}
function arrow(ctx, x, y, k) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-P.yaw); ctx.beginPath(); ctx.moveTo(0, -9 * k); ctx.lineTo(6 * k, 7 * k); ctx.lineTo(0, 3.5 * k); ctx.lineTo(-6 * k, 7 * k); ctx.closePath();
  ctx.fillStyle = '#b3272d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.restore();
}
const big = $('bigmap'), bigC = $('mapCanvas'); let bigPpm = 0.05;
function openMap() {
  big.hidden = false; if (document.pointerLockElement) document.exitPointerLock();
  const availW = Math.min(window.innerWidth - 50, 1100), availH = window.innerHeight - 110;
  bigPpm = Math.min(availW / (2 * HX), availH / (2 * HY));
  const w = Math.round(2 * HX * bigPpm), h = Math.round(2 * HY * bigPpm), dpr = Math.min(2, window.devicePixelRatio || 1);
  bigC.width = w * dpr; bigC.height = h * dpr; bigC.style.width = w + 'px'; bigC.style.height = h + 'px';
  const ctx = bigC.getContext('2d'); drawMap(ctx, w, h, 0, 0, bigPpm, dpr, 1);
  ctx.font = '600 11px "Golos Text", sans-serif'; ctx.textBaseline = 'middle';
  for (const p of PLACES) { const x = w / 2 + p[2] * bigPpm, y = h / 2 + p[3] * bigPpm; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 6.3); ctx.fillStyle = '#1d4f91'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = STATE.night ? '#232b33' : '#f4f2e9'; ctx.fillStyle = STATE.night ? '#e9e6df' : '#1c2527'; const left = x > w - 150; ctx.textAlign = left ? 'right' : 'left'; ctx.strokeText(p[0], x + (left ? -7 : 7), y); ctx.fillText(p[0], x + (left ? -7 : 7), y); }
  drawVehicles(ctx, 0, 0, bigPpm, w, h, 2.5);
  if (STATE.mapOverlay) STATE.mapOverlay(ctx, 0, 0, bigPpm, w, h);
  arrow(ctx, w / 2 + P.x * bigPpm, h / 2 + P.z * bigPpm, 1.2);
}
function closeMap() { big.hidden = true; canvas.focus(); }

export { big, bigC, bigPpm, closeMap, drawMini, openMap };
