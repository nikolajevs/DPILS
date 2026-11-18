import { STATE } from '../core/state.js';
import { P } from '../game/player.js';
import { PLACES } from './places.js';
import { drawVehicles } from '../transit/transit.js';
import { AREAS, BLD, LINES, ROAD, inWater } from '../world/data.js';
import { canvas } from '../render/renderer.js';
import { $, C, HX, HY, NAMES } from '../core/env.js';

/* ---------- 2D map (minimap and full map) ----------
   Both are drawn from square tiles of the map (256 CSS pixels, at zoom levels half an octave apart) that are drawn
   once and kept: the level is the next finer one, scaled down to the zoom of the moment, and every tile carries a 2 px
   margin so the scaled tiles overlap without seams. What lies in a tile is found through a grid of the areas, houses
   and lines (400 m cells). The full map adds over the tiles the names of the streets, of the river and of the places,
   and, every frame, the vehicles and the player. */

/* ---- colours: day and night ---- */
const PAL = {
  day: { bg: '#e6e4d8', area: { 0: '#9cc3d9', 1: '#b5d0a4', 2: '#c8d9b3', 3: '#d2e2be', 4: '#c3dcae', 5: '#c5d6b8', 6: '#efe4bd', 7: '#ebe6cb', 8: '#e0ddd1', 9: '#dbd4d1', 10: '#b2d6a3', 11: '#d3dfc0', 12: '#d9d4ca', 13: '#d2e4c2' },
    bld: '#c9bfae', shed: '#d4ccbe', edge: '#a89d8a', water: '#9cc3d9', casing: '#bcb4a6', majorCase: '#d29d55', major: '#f3d08a', minor: '#ffffff',
    path: '#cdc4b2', track: '#b39f7d', rail: '#8b8580', railDash: '#f4f2ea', tram: '#b3272d',
    text: '#283033', halo: 'rgba(248, 246, 238, 0.92)', waterText: '#3a6a88', place: '#1d4f91', poi: '#5b6670' },
  night: { bg: '#232b33', area: { 0: '#2c4f66', 1: '#2c4433', 2: '#2c4433', 3: '#2f4636', 4: '#31503a', 5: '#2f4636', 6: '#4c4a3c', 7: '#2b3329', 8: '#262e36', 9: '#2b2b32', 10: '#356043', 11: '#2d4234', 12: '#323940', 13: '#30483a' },
    bld: '#4a535c', shed: '#414950', edge: '#5d6770', water: '#2c4f66', casing: '#1b2127', majorCase: '#7d6533', major: '#c4a36a', minor: '#6a737c',
    path: '#59616a', track: '#6d6352', rail: '#8d8479', railDash: '#2a3138', tram: '#d0454a',
    text: '#ebe7de', halo: 'rgba(22, 28, 34, 0.9)', waterText: '#8fbad3', place: '#7fb0ff', poi: '#a7b0b6' }
};
const pal = () => (STATE.night ? PAL.night : PAL.day);

/* ---- what lies where: a grid of the map features ---- */
const CELL = 400;
let IDX = null;
function mapIndex() {
  if (IDX) return IDX;
  const cells = new Map();
  const add = (bb, kind, id) => {
    for (let i = Math.floor(bb[0] / CELL); i <= Math.floor(bb[2] / CELL); i++) for (let j = Math.floor(bb[1] / CELL); j <= Math.floor(bb[3] / CELL); j++) {
      const k = (i + 100) * 1000 + j + 100; let c = cells.get(k); if (!c) cells.set(k, c = [[], [], []]); c[kind].push(id);
    }
  };
  AREAS.forEach((a, n) => add(a.bb, 0, n)); BLD.forEach((b, n) => add(b.bb, 1, n)); LINES.forEach((l, n) => add(l.bb, 2, n));
  IDX = { cells, mark: [new Uint32Array(AREAS.length), new Uint32Array(BLD.length), new Uint32Array(LINES.length)], gen: 0 };
  return IDX;
}
// the areas, houses and lines whose boxes meet the box, each in its old order (the order the layers are drawn in)
function query(x0, z0, x1, z1) {
  const I = mapIndex(), g = ++I.gen, out = [[], [], []];
  for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
    const c = I.cells.get((i + 100) * 1000 + j + 100); if (!c) continue;
    for (let k = 0; k < 3; k++) for (const id of c[k]) if (I.mark[k][id] !== g) { I.mark[k][id] = g; out[k].push(id); }
  }
  for (const o of out) o.sort((a, b) => a - b);
  return out;
}

/* ---- one view of the map: areas, houses, lines ---- */
function drawMap(ctx, w, h, cx, cz, ppm, dpr) {
  const K = pal(), detail = ppm > 0.22 ? 2 : ppm > 0.07 ? 1 : 0, px = 1 / ppm;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = K.bg; ctx.fillRect(0, 0, w, h);
  const x0 = cx - w / 2 / ppm, x1 = cx + w / 2 / ppm, z0 = cz - h / 2 / ppm, z1 = cz + h / 2 / ppm;
  ctx.setTransform(ppm * dpr, 0, 0, ppm * dpr, (w / 2 - cx * ppm) * dpr, (h / 2 - cz * ppm) * dpr);
  const vis = bb => bb[2] >= x0 && bb[0] <= x1 && bb[3] >= z0 && bb[1] <= z1;
  const ring = r => { ctx.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]); ctx.closePath(); };
  const [areas, blds, lines] = query(x0, z0, x1, z1);
  for (const n of areas) { const a = AREAS[n], c = K.area[a.cls]; if (!c || !vis(a.bb)) continue; ctx.beginPath(); for (const r of a.rings) ring(r); ctx.fillStyle = c; ctx.fill('evenodd'); }
  if (detail > 0) {
    for (const shed of [false, true]) {
      if (shed && detail < 2) continue;
      ctx.beginPath(); for (const n of blds) { const b = BLD[n]; if ((b.kind === 7) === shed && vis(b.bb)) ring(b.ring); }
      ctx.fillStyle = shed ? K.shed : K.bld; ctx.fill();
      if (ppm > 0.7) { ctx.strokeStyle = K.edge; ctx.lineWidth = px; ctx.stroke(); }   // close in, the outlines of the houses
    }
  }
  // lines of one kind go into one path: all lines of a class have the same width
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pass = (test, color, wOf, dash) => {
    const byW = new Map();
    for (const n of lines) { const l = LINES[n]; if (!test(l.cls) || !vis(l.bb)) continue; const lw = wOf(l); let a = byW.get(lw); if (!a) byW.set(lw, a = []); a.push(l.pts); }
    ctx.strokeStyle = color; ctx.setLineDash(dash || []);
    for (const [lw, list] of byW) { ctx.lineWidth = lw; ctx.beginPath(); for (const p of list) { ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); } ctx.stroke(); }
    ctx.setLineDash([]);
  };
  const road = (l, mul, min) => Math.max(l.w * mul, min * px);
  pass(c => c === 10 || c === 11, K.water, l => road(l, 1, 0.8));
  if (detail > 1) { pass(c => c === 6 || c === 15, K.path, l => road(l, 1, 0.6), ppm > 1.2 ? [3 * px, 2 * px] : null); pass(c => c === 7, K.track, l => road(l, 1, 0.7), [4 * px, 3 * px]); }
  // railways: a grey line, closer in with white dashes across it
  pass(c => c === 8, K.rail, l => road(l, 0.5, ppm > 0.25 ? 3 : 0.9));
  if (ppm > 0.25) pass(c => c === 8, K.railDash, l => road(l, 0.3, 1.4), [6 * px, 6 * px]);
  // roads: the casings first, then the fills, so that the junctions join
  const cased = ppm > 0.12, minor = c => c === 4 || c === 5;
  if (cased && detail > 0) pass(minor, K.casing, l => road(l, 1, 0.7) + 1.6 * px);
  if (cased) { pass(c => c === 3, K.casing, l => road(l, 1, 1.1) + 1.6 * px); pass(c => c <= 2, K.majorCase, l => road(l, 1.1, 1.8) + 1.8 * px); }
  if (detail > 0) pass(minor, K.minor, l => road(l, 1, 0.7));
  pass(c => c === 3, K.minor, l => road(l, 1, 1.1));
  pass(c => c <= 2, K.major, l => road(l, 1.1, 1.8));
  if (detail > 1) pass(c => c === 9, K.tram, l => road(l, 0.25, 1));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ---- the tiles ---- */
const TS = 256, PAD = 2;
const MT = { max: 20, cache: new Map() }, BT = { max: 64, cache: new Map() };   // minimap, full map (emptied when it closes)
const tileKey = (lv, i, j, dpr) => lv + ':' + i + ':' + j + ':' + (STATE.night ? 1 : 0) + ':' + dpr;
function makeTile(T, lv, i, j, dpr) {
  const ppm = Math.pow(2, lv / 2), S = TS + 2 * PAD, size = TS / ppm, c = document.createElement('canvas'); c.width = c.height = Math.round(S * dpr);
  drawMap(c.getContext('2d'), S, S, (i + 0.5) * size, (j + 0.5) * size, ppm, dpr);
  T.cache.set(tileKey(lv, i, j, dpr), c); if (T.cache.size > T.max) T.cache.delete(T.cache.keys().next().value);
  return c;
}
function getTile(T, lv, i, j, dpr, make) {
  const k = tileKey(lv, i, j, dpr), c = T.cache.get(k);
  if (c) { T.cache.delete(k); T.cache.set(k, c); return c; }   // the caches keep the most recently used tiles
  return make ? makeTile(T, lv, i, j, dpr) : null;
}
/* the view (cx, cz) at ppm into a w × h canvas. budget: milliseconds this call may spend drawing new tiles (the full
   map fills in over a few frames: a tile not drawn yet shows the one an octave coarser, if kept); returns whether all
   tiles were at hand */
function drawTiles(ctx, T, w, h, cx, cz, ppm, dpr, budget) {
  const lv = Math.ceil(Math.log2(ppm) * 2 - 1e-6), lp = Math.pow(2, lv / 2), s = ppm / lp, size = TS / lp, S = (TS + 2 * PAD) * s, t0 = performance.now();
  let whole = true;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = true;
  for (let j = Math.floor((cz - h / 2 / ppm) / size); j <= Math.floor((cz + h / 2 / ppm) / size); j++) for (let i = Math.floor((cx - w / 2 / ppm) / size); i <= Math.floor((cx + w / 2 / ppm) / size); i++) {
    const x = w / 2 + (i * size - cx) * ppm, y = h / 2 + (j * size - cz) * ppm;
    let t = getTile(T, lv, i, j, dpr, budget === undefined || performance.now() - t0 < budget);
    if (t) { ctx.drawImage(t, x - PAD * s, y - PAD * s, S, S); continue; }
    whole = false;
    t = getTile(T, lv - 2, i >> 1, j >> 1, dpr, false);   // an octave coarser: four times the ground, half the detail
    if (t) { const qi = i - 2 * (i >> 1), qj = j - 2 * (j >> 1), src = (TS / 2) * (t.width / (TS + 2 * PAD)), o = PAD * (t.width / (TS + 2 * PAD)); ctx.drawImage(t, o + qi * src, o + qj * src, src, src, x, y, size * ppm, size * ppm); }
    else { ctx.fillStyle = pal().bg; ctx.fillRect(x, y, size * ppm + 1, size * ppm + 1); }
  }
  return whole;
}

/* ---- the minimap ---- */
const mini = $('minimap'), mctx = mini.getContext('2d'); STATE.mapTimer = 0;
function drawMini() {
  const css = mini.clientWidth || 190, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (mini.width !== Math.round(css * dpr)) mini.width = mini.height = Math.round(css * dpr);
  const ppm = P.fly ? Math.max(0.03, css / (700 + P.y * 9)) : css / 380;
  drawTiles(mctx, MT, css, css, P.x, P.z, ppm, dpr);
  drawVehicles(mctx, P.x, P.z, ppm, css, css, ppm > 0.1 ? 3.5 : 2.5);
  if (STATE.mapOverlay) STATE.mapOverlay(mctx, P.x, P.z, ppm, css, css);
  arrow(mctx, css / 2, css / 2, 1);
}
function arrow(ctx, x, y, k) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-P.yaw); ctx.beginPath(); ctx.moveTo(0, -9 * k); ctx.lineTo(6 * k, 7 * k); ctx.lineTo(0, 3.5 * k); ctx.lineTo(-6 * k, 7 * k); ctx.closePath();
  ctx.fillStyle = '#b3272d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.restore();
}

/* ---- names on the full map ----
   Placed for one zoom and kept while the map is only moved (they stand at points of the city), placed anew when the
   zoom changes or the map has moved by a good part of its size. A street gets its name along its straightest
   stretch that is long enough for it, upright, and no closer than 260 px to the same name; nothing may cover
   anything already placed. The order is the priority: the places of the list, the main streets, the river, the
   smaller streets, the named sights. */
// the middle of the Daugava, west to east (the river has no name in the data of the city)
const DAUGAVA = [-6250, -3334, -5750, -2814, -5250, -2194, -4750, -1634, -4250, -614, -3750, -164, -3250, -54, -2750, 266, -2250, 1576, -2000, 1756, -1500, 1986, -1000, 2276, -500, 2426, 0, 2516, 500, 2496, 1000, 2466, 1500, 2376, 2000, 2306, 2500, 2336, 3000, 2456, 3500, 2446, 4000, 2336, 4500, 2256, 5000, 1936, 5500, 1536, 5750, 1056, 6000, 466];
const FONT = '"Golos Text", system-ui, sans-serif';
const STREET = [   // road classes: minimum zoom (px per m), font
  [0.16, '600 12px ' + FONT], [0.16, '600 12px ' + FONT], [0.2, '600 12px ' + FONT], [0.32, '500 11px ' + FONT], [0.9, '500 10.5px ' + FONT], [0.6, '500 10.5px ' + FONT]
];
let LBL = null;
const widths = new Map();
function textW(ctx, font, text) { const k = font + '|' + text; let w = widths.get(k); if (w === undefined) { ctx.font = font; w = ctx.measureText(text).width; widths.set(k, w); } return w; }
function placeLabels(ctx, V) {
  const { w, h, ppm, cx, cz } = V, boxes = [], items = [], seen = new Map();
  const sx = x => w / 2 + (x - cx) * ppm, sy = z => h / 2 + (z - cz) * ppm;
  const free = b => { if (b[0] < 2 || b[1] < 2 || b[2] > w - 2 || b[3] > h - 2) return false; for (const o of boxes) if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false; return true; };
  const near = (text, x, y, d) => { for (const [a, b] of seen.get(text) || []) if ((a - x) ** 2 + (b - y) ** 2 < d * d) return true; return false; };
  const keep = (text, x, y) => { let l = seen.get(text); if (!l) seen.set(text, l = []); l.push([x, y]); };
  // a name along a line (screen points): its straightest long stretches, the longest first
  const along = (pts, text, font, fs, kind, gap) => {
    const tw = textW(ctx, font, text), n = pts.length >> 1, runs = [];
    let i = 0;
    while (i < n - 1) {
      const ax = pts[2 * i], ay = pts[2 * i + 1]; let bx = pts[2 * i + 2], by = pts[2 * i + 3], j = i + 1; const a0 = Math.atan2(by - ay, bx - ax);
      while (j < n - 1) { const qx = pts[2 * j + 2], qy = pts[2 * j + 3]; let d = Math.atan2(qy - by, qx - bx) - a0; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) > 0.28) break; bx = qx; by = qy; j++; }
      const len = Math.hypot(bx - ax, by - ay); if (len >= tw + 14) runs.push([len, ax, ay, bx, by]);
      i = j;
    }
    runs.sort((p, q) => q[0] - p[0]);
    for (const [len, ax, ay, bx, by] of runs) {
      let ang = Math.atan2(by - ay, bx - ax); if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      // along a long stretch the name may stand more than once
      for (let k = 1, m = Math.max(1, Math.floor(len / (tw + gap))); k <= m; k++) {
        const f = (k - 0.5) / m, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        if (near(text, x, y, gap)) continue;
        const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang)), hw = tw / 2 + 3, hh = fs / 2 + 2, ex = c * hw + s * hh, ey = s * hw + c * hh, b = [x - ex, y - ey, x + ex, y + ey];
        if (!free(b)) continue;
        boxes.push(b); keep(text, x, y); items.push({ x: cx + (x - w / 2) / ppm, z: cz + (y - h / 2) / ppm, ang, text, font, kind });
      }
    }
  };
  const toScreen = p => { const o = new Float32Array(p.length); for (let i = 0; i < p.length; i += 2) { o[i] = sx(p[i]); o[i + 1] = sy(p[i + 1]); } return o; };
  const x0 = cx - w / 2 / ppm, x1 = cx + w / 2 / ppm, z0 = cz - h / 2 / ppm, z1 = cz + h / 2 / ppm;
  // 1. the places of the list: a dot and the name beside it
  const placeFont = '600 12px ' + FONT;
  for (const p of PLACES) {
    const x = sx(p[2]), y = sy(p[3]); if (x < -50 || y < -20 || x > w + 50 || y > h + 20) continue;
    const tw = textW(ctx, placeFont, p[0]), left = x > w - tw - 20, b = left ? [x - tw - 12, y - 9, x + 5, y + 9] : [x - 5, y - 9, x + tw + 12, y + 9];
    if (!free(b)) { const d = [x - 5, y - 5, x + 5, y + 5]; if (free(d)) { boxes.push(d); items.push({ x: p[2], z: p[3], dot: true, kind: 'place' }); } continue; }
    boxes.push(b); items.push({ x: p[2], z: p[3], dot: true, text: p[0], font: placeFont, left, kind: 'place' });
  }
  // 2–4. streets by class (the main ones first), the river between the main and the smaller streets
  const [, , lines] = query(x0, z0, x1, z1);
  const streets = cls => { const [minZ, font] = STREET[cls]; if (ppm < minZ) return; const fs = parseFloat(font.split(' ')[1]);
    const list = lines.map(n => LINES[n]).filter(l => l.cls === cls && l.name >= 0).sort((a, b) => (b.bb[2] - b.bb[0] + b.bb[3] - b.bb[1]) - (a.bb[2] - a.bb[0] + a.bb[3] - a.bb[1]));
    for (const l of list) along(toScreen(l.pts), NAMES[l.name], font, fs, 'street', 260); };
  streets(0); streets(1); streets(2);
  along(toScreen(DAUGAVA), 'Daugava', 'italic 500 15px ' + FONT, 15, 'water', 520);
  streets(3); streets(5); streets(4);
  // 5. the named sights of the city data
  if (ppm >= 0.45) {
    const font = 'italic 500 11px ' + FONT;
    for (const p of C.p) {
      const x = sx(p[1]), y = sy(p[2]); if (x < 0 || y < 0 || x > w || y > h) continue;
      const text = NAMES[p[0]], tw = textW(ctx, font, text), b = [x - 4, y - 8, x + tw + 10, y + 8];
      if (!free(b)) continue; boxes.push(b); items.push({ x: p[1], z: p[2], dot: true, text, font, kind: 'poi' });
    }
  }
  return { ppm, cx, cz, w, h, night: STATE.night, items };
}
function drawLabels(ctx, V) {
  const K = pal(); ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const it of LBL.items) {
    const x = V.w / 2 + (it.x - V.cx) * V.ppm, y = V.h / 2 + (it.z - V.cz) * V.ppm;
    if (it.dot) {
      ctx.beginPath(); ctx.arc(x, y, it.kind === 'place' ? 3.5 : 2.5, 0, 6.3); ctx.fillStyle = it.kind === 'place' ? K.place : K.poi; ctx.fill(); ctx.strokeStyle = STATE.night ? '#141a1f' : '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      if (!it.text) continue;
      ctx.font = it.font; ctx.textAlign = it.left ? 'right' : 'left'; const tx = x + (it.left ? -7 : 7);
      ctx.lineWidth = 3; ctx.strokeStyle = K.halo; ctx.strokeText(it.text, tx, y); ctx.fillStyle = it.kind === 'place' ? K.text : K.poi; ctx.fillText(it.text, tx, y);
      continue;
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(it.ang); ctx.font = it.font; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = K.halo; ctx.strokeText(it.text, 0, 0); ctx.fillStyle = it.kind === 'water' ? K.waterText : K.text; ctx.fillText(it.text, 0, 0);
    ctx.restore();
  }
}

/* ---- the full map: moved by dragging, zoomed by the wheel, the buttons, the keys or two fingers ---- */
const big = $('bigmap'), bigC = $('mapCanvas'), bctx = bigC.getContext('2d'), info = $('mapInfo');
const V = { cx: 0, cz: 0, ppm: 0.05, fit: 0.05, w: 0, h: 0, dpr: 1, opened: false };
const MAXPPM = 6;
function sizeMap() {
  // the room the window leaves: its padding, the panel's padding and gaps, the header and the legend (they may wrap)
  const sheet = bigC.parentElement, cs = getComputedStyle(big), ss = getComputedStyle(sheet), num = v => parseFloat(v) || 0;
  const padW = num(cs.paddingLeft) + num(cs.paddingRight) + num(ss.paddingLeft) + num(ss.paddingRight), gap = num(ss.rowGap);
  const others = [...sheet.children].filter(e => e !== bigC).reduce((s, e) => s + e.offsetHeight + gap, 0);
  const padH = num(cs.paddingTop) + num(cs.paddingBottom) + num(ss.paddingTop) + num(ss.paddingBottom) + others;
  const w = Math.max(200, Math.min(window.innerWidth - padW, 1600)), h = Math.max(160, window.innerHeight - padH), dpr = Math.min(2, window.devicePixelRatio || 1);
  V.w = Math.round(w); V.h = Math.round(h); V.dpr = dpr; bigC.width = Math.round(V.w * dpr); bigC.height = Math.round(V.h * dpr); bigC.style.width = V.w + 'px'; bigC.style.height = V.h + 'px';
  V.fit = Math.min(V.w / (2 * HX), V.h / (2 * HY)); LBL = null;
}
function clampView() {
  V.ppm = Math.max(V.fit * 0.9, Math.min(MAXPPM, V.ppm));
  V.cx = Math.max(-HX, Math.min(HX, V.cx)); V.cz = Math.max(-HY, Math.min(HY, V.cz));
}
function zoomAt(f, x, y) {   // by f about the canvas point (x, y)
  const wx = V.cx + (x - V.w / 2) / V.ppm, wz = V.cz + (y - V.h / 2) / V.ppm;
  V.ppm *= f; clampView(); V.cx = wx - (x - V.w / 2) / V.ppm; V.cz = wz - (y - V.h / 2) / V.ppm; clampView();
}
const showAll = () => { V.ppm = V.fit; V.cx = 0; V.cz = 0; };
const showMe = () => { V.ppm = Math.max(V.ppm, 0.6); V.cx = P.x; V.cz = P.z; clampView(); };
function openMap() {
  big.hidden = false; STATE.mapOpen = true; if (document.pointerLockElement) document.exitPointerLock();
  sizeMap(); sizeMap();   // twice: the header wraps by the width the canvas gives the panel
  if (!V.opened) { V.opened = true; showAll(); } clampView();
  hint();
}
function closeMap() { big.hidden = true; STATE.mapOpen = false; BT.cache.clear(); LBL = null; canvas.focus(); }
function hint() { info.textContent = STATE.mp ? 'Колёсико — масштаб, перетаскивание — сдвиг' : 'Колёсико — масштаб, перетаскивание — сдвиг, щелчок — перенестись сюда'; }
// a frame of the full map (called by the frame loop while it is open)
function mapFrame() {
  if (big.hidden) return;
  const ctx = bctx, w = V.w, h = V.h;
  drawTiles(ctx, BT, w, h, V.cx, V.cz, V.ppm, V.dpr, 10);
  ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  if (!LBL || LBL.ppm !== V.ppm || LBL.night !== STATE.night || LBL.w !== w || (!drag && (Math.abs(LBL.cx - V.cx) * V.ppm > w * 0.3 || Math.abs(LBL.cz - V.cz) * V.ppm > h * 0.3))) {
    if (!(drag && LBL && LBL.ppm === V.ppm)) LBL = placeLabels(ctx, V);
  }
  drawLabels(ctx, V);
  drawVehicles(ctx, V.cx, V.cz, V.ppm, w, h, V.ppm > 0.5 ? 4 : 2.5);
  if (STATE.mapOverlay) STATE.mapOverlay(ctx, V.cx, V.cz, V.ppm, w, h);
  const px = w / 2 + (P.x - V.cx) * V.ppm, py = h / 2 + (P.z - V.cz) * V.ppm;
  ctx.beginPath(); ctx.arc(px, py, 13, 0, 6.3); ctx.fillStyle = 'rgba(179, 39, 45, 0.16)'; ctx.fill();
  arrow(ctx, px, py, 1.25);
  scaleBar(ctx, w, h);
}
function scaleBar(ctx, w, h) {
  const K = pal(), steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; let m = steps[0]; for (const s of steps) if (s * V.ppm <= 140) m = s;
  const len = m * V.ppm, x = 14, y = h - 16, text = m >= 1000 ? m / 1000 + ' км' : m + ' м';
  ctx.lineWidth = 5; ctx.strokeStyle = K.halo; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 5); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = K.text; ctx.stroke();
  ctx.font = '500 11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 3; ctx.strokeStyle = K.halo; ctx.strokeText(text, x + len + 6, y + 2); ctx.fillStyle = K.text; ctx.fillText(text, x + len + 6, y + 2);
  ctx.textBaseline = 'middle';
}
// what is under the pointer: a place, a street, the river; and where
function describe(x, y) {
  const wx = V.cx + (x - V.w / 2) / V.ppm, wz = V.cz + (y - V.h / 2) / V.ppm, r = 14 / V.ppm;
  let name = '', best = r * r;
  for (const p of PLACES) { const d = (p[2] - wx) ** 2 + (p[3] - wz) ** 2; if (d < best) { best = d; name = p[0]; } }
  if (!name) for (const p of C.p) { const d = (p[1] - wx) ** 2 + (p[2] - wz) ** 2; if (d < best) { best = d; name = NAMES[p[0]]; } }
  if (!name) { let bd = Math.max(8, 6 / V.ppm), n = -1; ROAD.near(wx, wz, bd + 10, (id, d) => { const k = ROAD.s[id * 6 + 5]; if (k >= 0 && d < bd) { bd = d; n = k; } }); if (n >= 0) name = NAMES[n]; }
  if (!name && inWater(wx, wz)) name = 'вода';
  const lat = C.lat0 - wz / C.ky, lon = C.lon0 + wx / C.kx;
  info.textContent = (name ? name + ' · ' : '') + lat.toFixed(4) + '° с. ш., ' + lon.toFixed(4) + '° в. д.';
}
// MAP.pick(x, z): what a click on the map does (src/game/input.js: go there)
const MAP = { pick: null };
let drag = null; const ptrs = new Map();
bigC.addEventListener('pointerdown', e => {
  bigC.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (ptrs.size === 1) drag = { x: e.offsetX, y: e.offsetY, cx: V.cx, cz: V.cz, moved: false };
  else { drag = drag || { moved: true }; drag.moved = true; const [a, b] = [...ptrs.values()]; drag.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
});
bigC.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) { describe(e.offsetX, e.offsetY); return; }
  ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (ptrs.size >= 2 && drag && drag.pinch) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    V.cx -= (mx - drag.pinch.mx) / V.ppm; V.cz -= (my - drag.pinch.my) / V.ppm; zoomAt(d / Math.max(1, drag.pinch.d), mx, my);
    drag.pinch = { d, mx, my }; return;
  }
  if (!drag || drag.pinch) return;
  const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
  if (!drag.moved && dx * dx + dy * dy > 25) drag.moved = true;
  if (drag.moved) { V.cx = drag.cx - dx / V.ppm; V.cz = drag.cz - dy / V.ppm; clampView(); bigC.style.cursor = 'grabbing'; }
});
const endPtr = e => {
  if (!ptrs.delete(e.pointerId)) return;
  if (ptrs.size) { if (drag) { drag.pinch = null; const [a] = [...ptrs.values()]; Object.assign(drag, { x: a.x, y: a.y, cx: V.cx, cz: V.cz }); } return; }
  const d = drag; drag = null; bigC.style.cursor = '';
  if (e.type === 'pointerup' && d && !d.moved && !STATE.mp && MAP.pick) MAP.pick(V.cx + (e.offsetX - V.w / 2) / V.ppm, V.cz + (e.offsetY - V.h / 2) / V.ppm);
};
bigC.addEventListener('pointerup', endPtr); bigC.addEventListener('pointercancel', endPtr);
bigC.addEventListener('pointerleave', () => { if (!ptrs.size) hint(); });
bigC.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode ? 33 : 1))) * 0.0018), e.offsetX, e.offsetY); }, { passive: false });
$('mapZoomIn').onclick = () => zoomAt(1.6, V.w / 2, V.h / 2);
$('mapZoomOut').onclick = () => zoomAt(1 / 1.6, V.w / 2, V.h / 2);
$('mapMe').onclick = showMe; $('mapAll').onclick = showAll;
window.addEventListener('keydown', e => {
  if (big.hidden || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
  const step = 0.25 / V.ppm;
  if (e.key === '+' || e.key === '=') zoomAt(1.4, V.w / 2, V.h / 2); else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.4, V.w / 2, V.h / 2);
  else if (e.code === 'Digit0' || e.code === 'Numpad0') showAll(); else if (e.code === 'KeyC') showMe();
  else if (e.code === 'ArrowLeft') V.cx -= step * V.w; else if (e.code === 'ArrowRight') V.cx += step * V.w; else if (e.code === 'ArrowUp') V.cz -= step * V.h; else if (e.code === 'ArrowDown') V.cz += step * V.h;
  else return;
  clampView();
});
window.addEventListener('resize', () => { if (!big.hidden) { sizeMap(); sizeMap(); clampView(); } });

export { MAP, big, closeMap, drawMini, mapFrame, openMap };
