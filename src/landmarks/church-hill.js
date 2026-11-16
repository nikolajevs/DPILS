import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { LMB, LM_KEYS, LMWHITE, lmW } from './core.js';
import { lmBar, lmBoxW, lmLathe, lmWF, lmWall } from './helpers.js';
import { LMM, lmStd } from './index.js';
import { lmHip } from './tv-tower.js';
import { LMWS } from './tiles.js';
import { GB, polyA } from '../core/geometry.js';
import { area2, hb, sh } from '../core/util.js';
import { matGold } from '../world/data.js';
import { TERR, terrainH } from '../world/terrain.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { scene } from '../render/renderer.js';

/* ---------- Church Hill (Baznīcu kalns) ----------
   Four churches of four confessions within 300 m of each other in Jaunbūve, modelled from the Wikimedia Commons
   photographs of each (categories "Daugavpils Ss Boris and Gleb Orthodox Cathedral", "Evangelical Lutheran Church of
   Martin Luther in Daugavpils", "Church of the Immaculate Conception of Blessed Virgin Mary in Daugavpils", "Old
   Believers Church of the Nativity of the Theotokos in Daugavpils") on their cadastre and OSM outlines (OSM ways
   88592954, 88592806, 88592868, 129571412). Each lives in a local frame: u along its long side from the west end,
   v across it, in metres.
   - Ss Boris and Gleb Orthodox Cathedral (1905), Russian Revival, white with sky-blue ornament: a basilica, the
     aisles with big arched windows between columns of blue squares and two gabled porches on each side, the
     clerestory above with smaller arched windows; over the east end a square block crowned by kokoshnik arches with
     the gilded onion on a blue drum in the middle and four smaller ones round it, blue tents with small onions on
     its corners and on the corners of the aisles; the bell tower at the west end: a square base, the belfry, four
     gables round a tall blue octagonal tent with dormers and a gilded onion on top.
   - Martin Luther Cathedral (1893), neo-Gothic in red brick with dressings of pale stone: the nave between
     buttresses under a steep grey roof, pointed windows of leaded glass, a transept with steep gables and rose
     windows, a polygonal apse, the west tower with a gable on each face and a slim octagonal spire of grey metal.
   - Church of the Immaculate Conception of the Virgin Mary (1902–05), neo-Baroque, white: twin west towers in four
     tiers with dark bulbs and spires, the pedimented front between them, a nave over two aisles and three apses in a
     trefoil at the east end, the middle one high under a grey half-dome.
   - Old Believers' Church of the Nativity of the Theotokos (1908): salmon-pink walls with white lesenes, window
     hoods and pointed gables, the bell tower behind the west porch with a small gilded onion on a red drum, a large
     gilded onion on a red drum over the nave and a small blue one over the altar.
   And, away from the hill, the Catholic Church of the Divine Mercy in Ķīmiķu ciemats (2019), drawn with the same
   means (churchKm). */
const F = { bg: [-139.48, 1291.67, 0.7689, 0.6394], lu: [52.07, 1292.68, 0.7125, 0.7017], ca: [176.09, 1275.05, 0.7237, 0.6901], ob: [-21.39, 1039.03, 0.7248, 0.6889], km: [1153.2, -1430.6, -0.2201, -0.9755] };
LM_KEYS.push(lmW(F.bg, 30, 11), lmW(F.lu, 15, 12), lmW(F.ca, 20, 14), lmW(F.ob, 17, 10), lmW(F.km, 20, -9));   // the cadastre buildings these replace

let seed = 1905; const rr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const W3 = (f, u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
const ang = f => Math.atan2(f[3], f[2]);
const near = (a, b) => Math.abs(a - b) < 0.01;
// a building stands level at the height of the upper side of its outline, as the generic ones do (see buildBuildings)
function standOn(f, pts) {
  if (!TERR.on) return null;
  let lo = 1e9, hi = -1e9; for (const [u, v] of pts) { const [x, z] = lmW(f, u, v), t = terrainH(x, z); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const base = Math.min(hi - 0.15, lo + 2.5);
  return (x, y, z) => { const t = terrainH(x, z); return y <= 0.05 ? Math.min(base, t) - 0.25 - t - y : base - t; };
}

// ---- the atlas of windows and doors of the four churches (colour, ORM, night light)
const CT = {};
function chAtlas() {
  const PX = 48, AW = 1024, AH = 1024, cv = mkCanvas(AW, AH), om = mkCanvas(AW, AH), gm = mkCanvas(AW, AH), g = cv.getContext('2d'), o = om.getContext('2d'), e = gm.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, AW, AH); o.fillStyle = 'rgb(0,225,0)'; o.fillRect(0, 0, AW, AH); e.fillStyle = '#000'; e.fillRect(0, 0, AW, AH);
  let X = 0, Y = 0;
  const ORM = { matte: 'rgb(0,225,0)', glass: 'rgb(0,26,0)' };
  const R = (x, y, w, h, col, k = 'matte', glow = '#000') => { g.fillStyle = col; g.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); o.fillStyle = ORM[k]; o.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); e.fillStyle = glow; e.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); };
  const glass = (x, y, w, h, c = ['#2f3a43', '#55656f', '#28313a'], glow = '#ffcf94') => {
    const a = X + x * PX, b = Y + y * PX, gr = g.createLinearGradient(0, b, 0, b + h * PX); gr.addColorStop(0, c[0]); gr.addColorStop(0.45, c[1]); gr.addColorStop(0.55, c[2]); gr.addColorStop(1, c[0]);
    g.fillStyle = gr; g.fillRect(a, b, w * PX, h * PX); o.fillStyle = ORM.glass; o.fillRect(a, b, w * PX, h * PX); e.fillStyle = glow; e.fillRect(a, b, w * PX, h * PX);
  };
  const line = (x1, y1, x2, y2, w, col) => { for (const [c, s] of [[g, col], [o, ORM.matte], [e, '#000']]) { c.strokeStyle = s; c.lineWidth = w * PX; c.beginPath(); c.moveTo(X + x1 * PX, Y + y1 * PX); c.lineTo(X + x2 * PX, Y + y2 * PX); c.stroke(); } };
  const grid = (w, h, f, cols, rows, col) => { for (let i = 0; i <= cols; i++) line(i * w / cols, 0, i * w / cols, h, f, col); for (let j = 0; j <= rows; j++) line(0, j * h / rows, w, j * h / rows, f, col); };
  // the top of a tile is the top of the opening: a window with a head gives its upper part to the head
  const defs = [
    // window of the Orthodox cathedral: white frame, two casements under a transom, the head radiating
    ['orth', 1.4, 3.3, () => { glass(0, 0, 1.4, 3.3); grid(1.4, 3.3, 0.07, 2, 1, '#f1f3f2'); line(0, 0.75, 1.4, 0.75, 0.07, '#f1f3f2'); line(0, 2.05, 1.4, 2.05, 0.05, '#f1f3f2'); for (let k = 1; k < 4; k++) line(0.7, 0.75, 0.7 + Math.cos(Math.PI * k / 4) * 0.7, 0.75 - Math.sin(Math.PI * k / 4) * 0.7, 0.04, '#f1f3f2'); }],
    // leaded glass of the Lutheran church: small diamond panes in amber and pale blue, a stone mullion
    ['goth', 1.6, 6.4, () => { glass(0, 0, 1.6, 6.4, ['#4a4130', '#8a7a52', '#3c3428'], '#ffd59a'); for (let y = 0; y < 6.4; y += 0.3) for (let x = 0; x < 1.6; x += 0.27) if (rr() < 0.2) R(x + 0.02, y + 0.02, 0.23, 0.26, rr() < 0.5 ? '#7a8ea0' : '#9c6a3a', 'glass', '#ffcf94');
      for (let y = -1.6; y < 6.4; y += 0.27) { line(0, y, 1.6, y + 1.6, 0.02, '#2b2620'); line(1.6, y, 0, y + 1.6, 0.02, '#2b2620'); }
      line(0.8, 0, 0.8, 6.4, 0.1, '#cfc7b8'); line(0, 2.2, 1.6, 2.2, 0.06, '#cfc7b8'); for (const x of [0, 1.6]) line(x, 0, x, 6.4, 0.1, '#cfc7b8'); }],
    // the tall round-arched windows of the Catholic church: white frame, small panes
    ['bar', 1.6, 4.6, () => { glass(0, 0, 1.6, 4.6); grid(1.6, 4.6, 0.05, 3, 9, '#f2f1ed'); }],
    // the windows of the Old Believers' church: white frame, two casements and a transom
    ['pom', 1.2, 3.0, () => { glass(0, 0, 1.2, 3.0); grid(1.2, 3.0, 0.06, 2, 1, '#f3f1ec'); line(0, 0.9, 1.2, 0.9, 0.06, '#f3f1ec'); }],
    // a round rose window: stone ring and spokes over coloured glass
    ['rose', 2.0, 2.0, () => { glass(0, 0, 2, 2, ['#3a3a4a', '#6b5f86', '#2c2c3a'], '#ffd59a'); const cx = X + PX, cy = Y + PX; for (const [c, s] of [[g, '#d6cec0'], [o, ORM.matte], [e, '#000']]) { c.strokeStyle = s; c.lineWidth = 0.08 * PX; c.beginPath(); c.arc(cx, cy, 0.95 * PX, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(cx, cy, 0.3 * PX, 0, Math.PI * 2); c.stroke(); for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; c.beginPath(); c.moveTo(cx + Math.cos(a) * 0.3 * PX, cy + Math.sin(a) * 0.3 * PX); c.lineTo(cx + Math.cos(a) * 0.95 * PX, cy + Math.sin(a) * 0.95 * PX); c.stroke(); } } }],
    // panelled wooden double door with a fanlight
    ['door', 2.0, 3.6, () => { R(0, 0, 2, 3.6, '#5b3a26'); glass(0.1, 0.1, 1.8, 0.8); for (const x of [0.1, 1.04]) { R(x, 1.0, 0.86, 2.5, '#6c4630'); for (let k = 0; k < 3; k++) R(x + 0.13, 1.15 + k * 0.8, 0.6, 0.62, '#5a3a26'); } }],
    // a belfry opening: dark, with a bell
    ['bell', 1.4, 3.0, () => { R(0, 0, 1.4, 3, '#1c1d20'); R(0.2, 0.9, 1.0, 0.06, '#5a4a3a'); g.fillStyle = '#8a6a3a'; g.beginPath(); g.moveTo(X + 0.5 * PX, Y + 0.96 * PX); g.lineTo(X + 0.9 * PX, Y + 0.96 * PX); g.lineTo(X + 1.08 * PX, Y + 1.7 * PX); g.lineTo(X + 0.32 * PX, Y + 1.7 * PX); g.fill(); }],
    // the statue of the Virgin in a niche: white robe, blue mantle, a golden halo
    ['statue', 1.3, 2.9, () => { R(0, 0, 1.3, 2.9, '#3f4a57'); R(0.25, 2.65, 0.8, 0.25, '#d8d8d8'); const P = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo : g.moveTo).call(g, X + x * PX, Y + y * PX)); g.fill(); };
      P([[0.65, 0.55], [0.95, 2.65], [0.35, 2.65]], '#eef0f2'); P([[0.65, 0.6], [1.02, 2.65], [0.86, 2.65], [0.65, 1.1], [0.44, 2.65], [0.28, 2.65]], '#4f86c6');
      g.fillStyle = '#f0d9c4'; g.beginPath(); g.arc(X + 0.65 * PX, Y + 0.48 * PX, 0.13 * PX, 0, 7); g.fill(); g.strokeStyle = '#e9c46a'; g.lineWidth = 2; g.beginPath(); g.arc(X + 0.65 * PX, Y + 0.48 * PX, 0.22 * PX, 0, 7); g.stroke(); }],
    // the icon over a door: a saint in red and gold on blue
    ['icon', 1.4, 2.2, () => { R(0, 0, 1.4, 2.2, '#2f5f9a'); R(0.1, 0.1, 1.2, 2.0, '#d9b04a'); R(0.25, 0.4, 0.9, 1.7, '#a8322c'); g.fillStyle = '#e9c27a'; g.beginPath(); g.arc(X + 0.7 * PX, Y + 0.45 * PX, 0.22 * PX, 0, Math.PI * 2); g.fill(); }],
  ];
  let x0 = 2, rowY = 2, rowH = 0;
  for (const [name, w, h, draw] of defs.sort((a, b) => b[2] - a[2])) {
    const pw = Math.ceil(w * PX), ph = Math.ceil(h * PX); if (x0 + pw > AW) { x0 = 2; rowY += rowH + 4; rowH = 0; }
    X = x0; Y = rowY; for (const c of [g, o, e]) { c.save(); c.beginPath(); c.rect(X, Y, pw, ph); c.clip(); } draw(); for (const c of [g, o, e]) c.restore();
    CT[name] = { u0: (X + 0.5) / AW, u1: (X + pw - 0.5) / AW, v0: 1 - (Y + ph - 0.5) / AH, v1: 1 - (Y + 0.5) / AH };
    x0 += pw + 4; rowH = Math.max(rowH, ph);
  }
  const mk = (c, srgb) => { const t = toTex(c, srgb, false); t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  return [mk(cv, true), mk(om, false), mk(gm, true)];
}

// ---- openings with heads, walls of polygons, roofs, domes
const KC = { det: null, gold: null };
const sub = (t, a, b) => ({ u0: t.u0, u1: t.u1, v0: t.v0 + (t.v1 - t.v0) * a, v1: t.v0 + (t.v1 - t.v0) * b });   // a band of a tile, from a to b of its height
const headH = (w, kind) => kind === 'round' ? w / 2 : kind === 'pointed' ? w * Math.sqrt(3) / 2 : 0;
function headPts(s, yS, w, kind) {   // the outline of the head of an opening centred at s, springing at yS, from left to right
  const r = w / 2, pts = [];
  if (kind === 'round') for (let k = 0; k <= 10; k++) { const a = Math.PI * k / 10; pts.push([s - Math.cos(a) * r, yS + Math.sin(a) * r]); }
  else { for (let k = 0; k <= 6; k++) { const a = Math.PI - (Math.PI / 3) * k / 6; pts.push([s + r + Math.cos(a) * 2 * r, yS + Math.sin(a) * 2 * r]); }
    for (let k = 5; k >= 0; k--) { const a = (Math.PI / 3) * k / 6; pts.push([s - r + Math.cos(a) * 2 * r, yS + Math.sin(a) * 2 * r]); } }
  return pts;
}
/* An opening {s (centre along the wall), w, y (sill), h (to the spring of the head), head ('round' | 'pointed' |
   none), tile, trim (colour of the moulding round it), tw (its width), trimHead (the head of the moulding when it differs), lit}. With ops it is cut into the wall that
   lmWall draws next, its head laid on the face of the wall, which is not cut there; without, the whole opening is
   laid on the face of the frame Fw at the depth o.d. */
function opening(K, Fw, o, ops) {
  const hh = headH(o.w, o.head), t = o.tile, ys = o.y + o.h, L = o.lit ?? rr() < 0.3, s0 = o.s - o.w / 2, s1 = o.s + o.w / 2, N = [Fw.nx, 0, Fw.nz];
  const tr = o.head ? sub(t, 0, o.h / (o.h + hh)) : t, df = ops ? -0.015 : (o.d ?? -0.03);
  if (ops) ops.push({ s0, s1, y0: o.y, y1: ys, d: o.head ? 0.12 : 0.25, tile: tr, det: KC.det, lit: L, sill: o.sill || null });
  else KC.det.q(Fw.at(s0, o.y, df), Fw.at(s1, o.y, df), Fw.at(s1, ys, df), Fw.at(s0, ys, df), N, [tr.u1, tr.v0, tr.u0, tr.v0, tr.u0, tr.v1, tr.u1, tr.v1], LMWHITE, L ? 1 : 0);
  if (o.head) {
    const pts = headPts(o.s, ys, o.w, o.head), vS = tr.v1;
    const uv = ([x, y]) => [t.u1 - (t.u1 - t.u0) * (x - s0) / o.w, vS + (t.v1 - vS) * Math.min(1, (y - ys) / hh)];
    const cu = uv([o.s, ys]), c = Fw.at(o.s, ys, df);
    for (let k = 0; k < pts.length - 1; k++) { const a = uv(pts[k]), b = uv(pts[k + 1]), P = Fw.at(pts[k][0], pts[k][1], df), Q = Fw.at(pts[k + 1][0], pts[k + 1][1], df);
      KC.det.q(c, P, Q, Q, N, [cu[0], cu[1], a[0], a[1], b[0], b[1], b[0], b[1]], LMWHITE, L ? 1 : 0); }
  }
  if (o.trim) {
    const tw = o.tw || 0.16, dt = df - 0.05, G = K.plain;
    for (const s of [s0 - tw / 2, s1 + tw / 2]) lmBar(G, Fw.at(s, o.y - tw / 2, dt), Fw.at(s, ys, dt), tw, o.trim);
    if (o.head) { const pts = headPts(o.s, ys, o.w + tw, o.trimHead || o.head); for (let k = 0; k < pts.length - 1; k++) lmBar(G, Fw.at(pts[k][0], pts[k][1], dt), Fw.at(pts[k + 1][0], pts[k + 1][1], dt), tw, o.trim); }
    else lmBar(G, Fw.at(s0 - tw, ys + tw / 2, dt), Fw.at(s1 + tw, ys + tw / 2, dt), tw, o.trim);
    lmBar(G, Fw.at(s0 - tw * 1.5, o.y - tw / 2, dt - 0.04), Fw.at(s1 + tw * 1.5, o.y - tw / 2, dt - 0.04), tw, o.trim);
  }
}
/* The walls of a polygon of the frame (either winding) from y0 to y1 in the wall style st; win(e) gives the openings
   of the edge e = {Fw, L, Pl, Ql (its ends in the frame), nu, nv (its outward normal in the frame), s(u, v) (the
   place of a point of the frame along it)}. open leaves out the edge from the last point back to the first. */
function walls(K, f, poly, y0, y1, st, win, open) {
  const pts = poly.map(([u, v]) => lmW(f, u, v)), n = poly.length;
  const order = poly.map((_, i) => i); if (area2(pts.flat()) < 0) order.reverse();
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = order[k], j = order[(k + 1) % n]; if (open && Math.min(i, j) === 0 && Math.max(i, j) === n - 1) continue;
    const Fw = lmWF(pts[i], pts[j]); if (Fw.L < 0.05) continue;
    const Pl = poly[i], Ql = poly[j], e = { Fw, L: Fw.L, Pl, Ql, nu: Fw.nx * f[2] + Fw.nz * f[3], nv: -Fw.nx * f[3] + Fw.nz * f[2],
      s: (u, v) => ((u - Pl[0]) * (Ql[0] - Pl[0]) + (v - Pl[1]) * (Ql[1] - Pl[1])) / Fw.L };
    const ops = []; if (win) for (const o of win(e) || []) opening(K, Fw, o, ops);
    lmWall(K, pts[i], pts[j], y0, y1, ops, st); out.push(e);
  }
  return out;
}
// a moulding along the edges from y0 to y1, standing proj out of the wall
const band = (K, edges, y0, y1, proj, col) => { for (const { Fw } of edges) lmBoxW(K.plain, Fw, -proj, Fw.L + proj, y0, y1, -proj, 0, col); };
const pier = (K, e, s, w, y0, y1, d, col) => lmBoxW(K.plain, e.Fw, s - w / 2, s + w / 2, y0, y1, -d, 0, col);
// a flat lid over a convex polygon of the frame
const lid = (G, f, poly, y, col) => { for (let k = 1; k < poly.length - 1; k++) polyA(G, [W3(f, ...poly[0], y), W3(f, ...poly[k], y), W3(f, ...poly[k + 1], y)], col, 0, 1, 0); };
// points of a frame Fw moved by d out of the wall (the depth of a projection)
const out = (Fw, P, d) => [P[0] + Fw.nx * d, P[1], P[2] + Fw.nz * d];
// a triangular gable in the wall style st between the eave points P and Q (world, at one height) up to Y; back: its colour from behind
function gableEnd(K, st, P, Q, Y, back) {
  const Fw = lmWF([P[0], P[2]], [Q[0], Q[2]]), S = LMWS[st.tex], so = P[0] * Fw.tx + P[2] * Fw.tz, y = P[1], L = Fw.L, A = Fw.at(L / 2, Y, 0);
  K.walls[st.tex].q(Fw.at(0, y, 0), Fw.at(L, y, 0), A, A, [Fw.nx, 0, Fw.nz], [so / S, y / S, (so + L) / S, y / S, (so + L / 2) / S, Y / S, (so + L / 2) / S, Y / S], st.col);
  if (back) polyA(K.plain, [Fw.at(0, y, 0.02), Fw.at(L, y, 0.02), Fw.at(L / 2, Y, 0.02)], back, -Fw.nx, 0, -Fw.nz);
}
// a pitched roof over a rectangle of the frame with the ridge along u (axis 'u') or along v, its gable ends in the wall style st (or none)
function gable(K, f, u0, u1, v0, v1, y, rise, col, st, axis = 'u', ov = 0.4) {
  const G = K.plain, A = (u, v, h) => W3(f, u, v, h), Y = y + rise;
  if (axis === 'u') { const vm = (v0 + v1) / 2, ye = y - ov * rise / (vm - v0);
    polyA(G, [A(u0 - ov, v0 - ov, ye), A(u1 + ov, v0 - ov, ye), A(u1 + ov, vm, Y), A(u0 - ov, vm, Y)], col, 0, 1, 0);
    polyA(G, [A(u1 + ov, v1 + ov, ye), A(u0 - ov, v1 + ov, ye), A(u0 - ov, vm, Y), A(u1 + ov, vm, Y)], sh(col, 0.9), 0, 1, 0);
    if (st) { gableEnd(K, st, A(u0, v1, y), A(u0, v0, y), Y); gableEnd(K, st, A(u1, v0, y), A(u1, v1, y), Y); } }
  else { const um = (u0 + u1) / 2, ye = y - ov * rise / (um - u0);
    polyA(G, [A(u0 - ov, v1 + ov, ye), A(u0 - ov, v0 - ov, ye), A(um, v0 - ov, Y), A(um, v1 + ov, Y)], col, 0, 1, 0);
    polyA(G, [A(u1 + ov, v0 - ov, ye), A(u1 + ov, v1 + ov, ye), A(um, v1 + ov, Y), A(um, v0 - ov, Y)], sh(col, 0.9), 0, 1, 0);
    if (st) { gableEnd(K, st, A(u0, v0, y), A(u1, v0, y), Y); gableEnd(K, st, A(u1, v1, y), A(u0, v1, y), Y); } }
}
// a lean-to roof over u0..u1 from the outer edge v = vo at y0 up to the inner edge v = vi at y1, with its triangular ends
function leanTo(K, f, u0, u1, vo, vi, y0, y1, col, endCol) {
  const G = K.plain, A = (u, v, h) => W3(f, u, v, h), ov = 0.35 * Math.sign(vo - vi), ye = y0 - 0.35 * (y1 - y0) / Math.abs(vi - vo);
  polyA(G, [A(u0 - 0.3, vo + ov, ye), A(u1 + 0.3, vo + ov, ye), A(u1 + 0.3, vi, y1), A(u0 - 0.3, vi, y1)], col, 0, 1, 0);
  for (const u of [u0, u1]) polyA(G, [A(u, vo, y0), A(u, vi, y0), A(u, vi, y1)], endCol, u === u0 ? -f[2] : f[2], 0, u === u0 ? -f[3] : f[3]);
}
// a solid of seg flat faces (a tent, a pyramid, an octagonal drum) turned by rot; prof is [[radius, height]...]
function latheF(G, cx, cz, y0, prof, seg, col, rot) {
  const c = Math.cos(Math.PI / seg);
  for (let k = 0; k < prof.length - 1; k++) {
    const [r0, h0] = prof[k], [r1, h1] = prof[k + 1], dr = (r1 - r0) * c, dh = h1 - h0, l = Math.hypot(dr, dh) || 1;
    for (let s = 0; s < seg; s++) {
      const a0 = rot + s * 2 * Math.PI / seg, a1 = a0 + 2 * Math.PI / seg, am = (a0 + a1) / 2, P = (r, h, a) => [cx + r * Math.cos(a), y0 + h, cz + r * Math.sin(a)];
      polyA(G, [P(r0, h0, a0), P(r0, h0, a1), P(r1, h1, a1), P(r1, h1, a0)], col, Math.cos(am) * dh / l, -dr / l, Math.sin(am) * dh / l);
    }
  }
}
// a gilded cross facing along the frame (angle a of its u axis): the Orthodox one with the slanted lower bar, or a Latin one
function crossOn(x, z, y, h, a, latin = false, G = KC.gold) {
  const w = Math.max(0.06, h * 0.06), ca = -Math.sin(a), sa = Math.cos(a), at = (d, yy) => [x + ca * d, y + yy, z + sa * d];
  lmBar(G, at(0, 0), at(0, h), w, LMWHITE); lmBar(G, at(-h * 0.3, h * 0.68), at(h * 0.3, h * 0.68), w, LMWHITE);
  if (!latin) { lmBar(G, at(-h * 0.15, h * 0.87), at(h * 0.15, h * 0.87), w * 0.8, LMWHITE); lmBar(G, at(-h * 0.2, h * 0.3), at(h * 0.2, h * 0.42), w * 0.8, LMWHITE); }
}
// an onion dome of radius R from y with a closed bottom (gilded, or in the colour col); returns its top
function onion(K, x, z, y, R, col) {
  const P = [[0.02, 0], [R * 0.82, 0], [R * 1.0, R * 0.3], [R * 1.08, R * 0.62], [R * 0.98, R * 0.98], [R * 0.7, R * 1.32], [R * 0.36, R * 1.62], [R * 0.13, R * 1.86], [0.03, R * 2.05]];
  lmLathe(col ? K.plain : KC.gold, x, z, y, P, 16, col || LMWHITE);
  return y + R * 2.05;
}
// a round drum with a moulded top: radius r, from y to y + h; returns the top of the moulding
function drum(K, x, z, y, r, h, col, top) {
  lmLathe(K.plain, x, z, y, [[r, 0], [r, h]], 16, col);
  lmLathe(K.plain, x, z, y + h, [[r, 0], [r + 0.15, 0.05], [r + 0.15, 0.22], [r * 0.9, 0.22]], 16, top || col);
  return y + h + 0.22;
}
// openings round a drum, laid on its face: n of them, centred at the angles a0 + k·2π/n
function drumOpenings(K, x, z, r, n, a0, o) {
  for (let k = 0; k < n; k++) { const a = a0 + k * 2 * Math.PI / n, cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r, tx = -Math.sin(a), tz = Math.cos(a), hw = o.w / 2 + 0.3;
    opening(K, lmWF([cx - tx * hw, cz - tz * hw], [cx + tx * hw, cz + tz * hw]), Object.assign({ s: hw, d: -0.04 }, o)); }
}

// a round window of radius r centred at (s, cy) on the face of Fw at the depth d, in a moulded ring of the colour trim
function oculus(K, Fw, s, cy, r, tile, trim, tw = 0.2, d = -0.03, lit = rr() < 0.3) {
  const uc = (tile.u0 + tile.u1) / 2, vc = (tile.v0 + tile.v1) / 2, n = 16, N = [Fw.nx, 0, Fw.nz], c = Fw.at(s, cy, d);
  const tu = t => [uc + Math.cos(t) * (tile.u1 - tile.u0) / 2, vc + Math.sin(t) * (tile.v1 - tile.v0) / 2], rim = (t, R, dd) => Fw.at(s - Math.cos(t) * R, cy + Math.sin(t) * R, dd);
  for (let q = 0; q < n; q++) { const t0 = q / n * Math.PI * 2, t1 = (q + 1) / n * Math.PI * 2;
    KC.det.q(c, rim(t0, r, d), rim(t1, r, d), rim(t1, r, d), N, [uc, vc, ...tu(t0), ...tu(t1), ...tu(t1)], LMWHITE, lit ? 1 : 0);
    if (trim) lmBar(K.plain, rim(t0, r + tw / 2, d - 0.05), rim(t1, r + tw / 2, d - 0.05), tw, trim); }
}

/* ---- Ss Boris and Gleb Orthodox Cathedral ---- */
function cathedralBG(K) {
  const f = F.bg, G = K.plain, a = ang(f), WH = [244, 246, 245], BL = hb('#6cacd9'), BLD = hb('#5a9dd0'), ROOF = hb('#8a8f93'), PL = hb('#c3c8cc'), ST = { tex: 1, col: WH };
  STATE.GBC = standOn(f, [[6.9, 0], [52.2, 0], [57.9, 8.4], [51.3, 22], [6, 22], [0, 15.6], [0.9, 6.4]]);
  const HA = 8, HC = 14, HB = 16.5, bay = k => 7 + (k + 0.5) * 4.89, PORCH = [0, 4], win = (s, y, w, h, o) => Object.assign({ s, w, y, h, head: 'round', tile: CT.orth, trim: BL }, o);
  // the aisles: arched windows in blue surrounds between columns of blue squares, gabled porches with doors
  const BODY = [[6.5, 0], [52, 0], [52, 22], [6.5, 22]];
  const body = walls(K, f, BODY, 0, HA, ST, e => Math.abs(e.nv) > 0.9 ? [1, 2, 3, 5, 6, 7, 8].map(k => win(e.s(bay(k), e.Pl[1]), 1.7, 1.5, 2.8)) : []);
  band(K, body, 0, 0.7, 0.12, PL); band(K, body, HA - 0.9, HA - 0.55, 0.12, BL); band(K, body, HA - 0.55, HA, 0.35, WH);
  for (const e of body) if (Math.abs(e.nv) > 0.9) {
    const v = e.Pl[1], Fw = e.Fw;
    for (let k = 2; k <= 9; k++) if (k !== 4 && k !== 5) { const s = e.s(7 + k * 4.89, v); if (s > 0.5 && s < e.L - 0.5) for (let q = 0; q < 4; q++) pier(K, e, s, 0.48, 1.9 + q * 1.15, 2.38 + q * 1.15, 0.06, BL); }
    for (const k of PORCH) {   // a porch: a shallow block with a gable and the door
      const s = e.s(bay(k), v), dp = -0.8, A = Fw.at(s - 2.4, HA, dp), B = Fw.at(s + 2.4, HA, dp), C = Fw.at(s, HA + 2.9, dp);
      lmBoxW(G, Fw, s - 2.4, s + 2.4, 0, HA, dp, 0, WH); lmBoxW(G, Fw, s - 2.5, s + 2.5, HA - 0.4, HA, dp - 0.1, 0, WH);
      polyA(G, [A, B, C], WH, Fw.nx, 0, Fw.nz);
      polyA(G, [Fw.at(s - 1.7, HA + 0.35, dp - 0.03), Fw.at(s + 1.7, HA + 0.35, dp - 0.03), Fw.at(s, HA + 2.4, dp - 0.03)], BL, Fw.nx, 0, Fw.nz);
      polyA(G, [Fw.at(s - 1.1, HA + 0.6, dp - 0.05), Fw.at(s + 1.1, HA + 0.6, dp - 0.05), Fw.at(s, HA + 1.9, dp - 0.05)], WH, Fw.nx, 0, Fw.nz);
      for (const [P, Q] of [[A, C], [C, B]]) { lmBar(G, P, Q, 0.2, BLD); polyA(G, [P, Q, out(Fw, Q, dp - 0.4), out(Fw, P, dp - 0.4)], ROOF, 0, 1, 0); }
      opening(K, Fw, win(s, 0.15, 1.8, 2.9, { tile: CT.door, lit: false, d: dp - 0.03 }));
    }
  }
  lid(G, f, BODY, HA, ROOF);
  leanTo(K, f, 6.5, 36.5, 0, 4.8, HA, HA + 1.7, ROOF, WH); leanTo(K, f, 6.5, 36.5, 22, 17.2, HA, HA + 1.7, ROOF, WH);
  // the clerestory
  const cl = walls(K, f, [[6.5, 4.8], [36.5, 4.8], [36.5, 17.2], [6.5, 17.2]], HA - 0.3, HC, ST, e => Math.abs(e.nv) > 0.9 ? [1, 2, 3, 4, 5].map(k => win(e.s(bay(k), e.Pl[1]), HA + 1.9, 1.2, 2.0, { tw: 0.13 })) : []);
  band(K, cl, HC - 1.0, HC - 0.7, 0.1, BL); band(K, cl, HC - 0.7, HC, 0.3, WH);
  for (const e of cl) if (Math.abs(e.nv) > 0.9) for (let k = 2; k <= 6; k++) { const s = e.s(7 + k * 4.89, e.Pl[1]); for (let q = 0; q < 3; q++) pier(K, e, s, 0.4, HA + 1.9 + q * 0.95, HA + 2.3 + q * 0.95, 0.05, BL); }
  gable(K, f, 6.5, 36.5, 4.8, 17.2, HC, 1.6, ROOF, ST, 'u', 0.35);
  // the apse, half an octagon under a low roof
  const AP = [[52, 0.6], [53.9, 4.4], [57.9, 8.4], [57.0, 12.0], [53.8, 15.0], [52, 21.4]];
  const ea = walls(K, f, AP, 0, HA, ST, e => e.L > 3 && e.L < 6 ? [win(e.L / 2, 2, 1.3, 2.6)] : [], true);
  band(K, ea, 0, 0.7, 0.12, PL); band(K, ea, HA - 0.9, HA - 0.55, 0.12, BL); band(K, ea, HA - 0.55, HA, 0.35, WH);
  for (let k = 0; k < AP.length - 1; k++) polyA(G, [W3(f, ...AP[k], HA), W3(f, ...AP[k + 1], HA), W3(f, 52.5, 11, HA + 2.4)], ROOF, 0, 1, 0);
  // the block over the east end: arched windows, kokoshnik arches over its cornice; the drums and onions on it
  const BLK = [[36.5, 4], [50.5, 4], [50.5, 18], [36.5, 18]];
  const blk = walls(K, f, BLK, HA - 0.3, HB, ST, e => [win(e.L / 2, HA + 2.3, 1.5, 2.8), win(e.L / 2 - 4.2, HA + 2.8, 1.1, 1.9), win(e.L / 2 + 4.2, HA + 2.8, 1.1, 1.9)]);
  band(K, blk, HB - 1.0, HB - 0.7, 0.1, BL); band(K, blk, HB - 0.7, HB, 0.3, WH);
  for (const { Fw } of blk) for (let k = 0; k < 3; k++) {
    const s = (k + 0.5) * Fw.L / 3, r = Fw.L / 6 - 0.15, P = [], Q = [], Bk = [];
    for (let q = 0; q <= 12; q++) { const t = Math.PI * q / 12; P.push(Fw.at(s - Math.cos(t) * r, HB + Math.sin(t) * r * 0.85, -0.15)); Q.push(Fw.at(s - Math.cos(t) * r * 0.72, HB + Math.sin(t) * r * 0.6, -0.17)); Bk.push(Fw.at(s - Math.cos(t) * r, HB + Math.sin(t) * r * 0.85, 1.4)); }
    for (let q = 0; q < 12; q++) { polyA(G, [Fw.at(s, HB, -0.15), P[q], P[q + 1]], WH, Fw.nx, 0, Fw.nz); polyA(G, [Fw.at(s, HB, -0.17), Q[q], Q[q + 1]], BL, Fw.nx, 0, Fw.nz); lmBar(G, P[q], P[q + 1], 0.2, BLD);
      polyA(G, [P[q], P[q + 1], Bk[q + 1], Bk[q]], ROOF, 0, 1, 0); }
  }
  lid(G, f, BLK, HB, ROOF);
  latheF(G, ...lmW(f, 43.5, 11), HB, [[6.2, 0], [3.6, 1.6]], 4, ROOF, a + Math.PI / 4);
  { const [x, z] = lmW(f, 43.5, 11), y = drum(K, x, z, HB + 1.4, 2.7, 5.4, BL, WH);
    drumOpenings(K, x, z, 2.7, 8, a + Math.PI / 8, { w: 0.95, y: HB + 2.4, h: 2.3, head: 'round', tile: CT.orth, trim: WH, tw: 0.13 });
    for (let k = 0; k < 8; k++) { const t = a + k * Math.PI / 4; lmBar(G, [x + Math.cos(t) * 2.75, HB + 1.4, z + Math.sin(t) * 2.75], [x + Math.cos(t) * 2.75, HB + 6.8, z + Math.sin(t) * 2.75], 0.28, WH); }
    crossOn(x, z, onion(K, x, z, y, 3.0), 3.0, a); }
  for (const [u, v] of [[39.4, 6.9], [47.6, 6.9], [39.4, 15.1], [47.6, 15.1]]) { const [x, z] = lmW(f, u, v), y = drum(K, x, z, HB, 1.2, 3.6, BL, WH);
    drumOpenings(K, x, z, 1.2, 4, a, { w: 0.55, y: HB + 1.0, h: 1.5, head: 'round', tile: CT.orth, trim: WH, tw: 0.1 }); crossOn(x, z, onion(K, x, z, y, 1.35), 1.5, a); }
  // slim blue tents with small onions on the corners of the block and of the aisles
  const turret = (u, v, y0, y1) => { const [x, z] = lmW(f, u, v); latheF(G, x, z, y0, [[0.75, 0], [0.75, y1 - y0], [0.9, y1 - y0], [0.9, y1 - y0 + 0.3]], 8, WH, a + Math.PI / 8);
    latheF(G, x, z, y1 + 0.3, [[0.9, 0], [0.12, 3.0]], 8, BLD, a + Math.PI / 8); crossOn(x, z, onion(K, x, z, y1 + 3.2, 0.42), 0.9, a); };
  for (const [u, v] of BLK) turret(u, v, HA, HB + 0.4);
  for (const [u, v] of [[6.5, 0], [6.5, 22], [52, 0.6], [52, 21.4]]) turret(u, v, HA - 1, HA + 1.4);
  // the bell tower over the west porch
  const T1 = [[0, 6.3], [9.4, 6.3], [9.4, 15.7], [0, 15.7]], H1 = 16, T2 = [[1.2, 7.5], [8.2, 7.5], [8.2, 14.5], [1.2, 14.5]], H2 = 24.5;
  const t1 = walls(K, f, T1, 0, H1, ST, e => e.nu < -0.9 ? [win(e.L / 2, 0.15, 2.0, 3.2, { tile: CT.door, lit: false }), win(e.L / 2, 5.2, 1.3, 1.9, { tile: CT.icon, lit: false }), win(e.L / 2, 10.4, 1.3, 2.6)]
    : e.nu > 0.9 ? [] : [win(e.L / 2, 10.4, 1.3, 2.6)]);
  band(K, t1, 0, 0.7, 0.12, PL); band(K, t1, HA - 0.9, HA - 0.55, 0.12, BL); band(K, t1, HA - 0.55, HA, 0.35, WH); band(K, t1, H1 - 1.0, H1 - 0.7, 0.1, BL); band(K, t1, H1 - 0.7, H1, 0.35, WH);
  for (const e of t1) for (const s of [0.35, e.L - 0.35]) pier(K, e, s, 0.7, 0.7, H1 - 1.0, 0.12, WH);
  lid(G, f, T1, H1, ROOF);
  const t2 = walls(K, f, T2, H1, H2, ST, e => [win(e.L / 2 - 1.3, H1 + 1.6, 1.1, 3.6, { tile: CT.bell, lit: false }), win(e.L / 2 + 1.3, H1 + 1.6, 1.1, 3.6, { tile: CT.bell, lit: false })]);
  band(K, t2, H2 - 1.0, H2 - 0.7, 0.1, BL); band(K, t2, H2 - 0.7, H2, 0.3, WH);
  for (const e of t2) { const Fw = e.Fw; for (const s of [0.3, e.L - 0.3]) pier(K, e, s, 0.6, H1, H2 - 1.0, 0.12, WH);
    const A = Fw.at(0.2, H2, -0.3), B = Fw.at(e.L - 0.2, H2, -0.3), C = Fw.at(e.L / 2, H2 + 2.6, -0.3); gableEnd(K, ST, A, B, H2 + 2.6, WH); lmBar(G, A, C, 0.22, BLD); lmBar(G, C, B, 0.22, BLD);
    polyA(G, [Fw.at(e.L / 2 - 1.4, H2 + 0.35, -0.33), Fw.at(e.L / 2 + 1.4, H2 + 0.35, -0.33), Fw.at(e.L / 2, H2 + 1.95, -0.33)], BL, Fw.nx, 0, Fw.nz); }
  lid(G, f, T2, H2, ROOF);
  const [tx, tz] = lmW(f, 4.7, 11);
  latheF(G, tx, tz, H2, [[3.6, 0], [0.45, 11]], 8, BLD, a + Math.PI / 8);
  for (let k = 0; k < 4; k++) {   // dormers in the tent
    const t = a + k * Math.PI / 2, x = tx + Math.cos(t) * 2.35, z = tz + Math.sin(t) * 2.35, Fw = lmWF([x + Math.sin(t) * 0.45, z - Math.cos(t) * 0.45], [x - Math.sin(t) * 0.45, z + Math.cos(t) * 0.45]);
    lmBoxW(G, Fw, 0, 0.9, H2 + 3.2, H2 + 4.6, -0.2, 1.2, WH); gableEnd(K, ST, Fw.at(-0.05, H2 + 4.6, -0.2), Fw.at(0.95, H2 + 4.6, -0.2), H2 + 5.3, WH);
    opening(K, Fw, { s: 0.45, w: 0.45, y: H2 + 3.4, h: 0.8, head: 'round', tile: CT.bell, lit: false, d: -0.22 });
  }
  { const y = drum(K, tx, tz, H2 + 10.7, 0.55, 1.1, WH, BL); crossOn(tx, tz, onion(K, tx, tz, y, 1.05), 2.0, a); }
}

/* ---- Martin Luther Cathedral ---- */
function cathedralLu(K) {
  const f = F.lu, G = K.plain, a = ang(f), BR = { tex: 3, col: LMWHITE }, BRC = [138, 64, 48], STN = hb('#d9d2c4'), ROOF = hb('#9a9894'), SP = hb('#86888a');
  STATE.GBC = standOn(f, [[0, 3.5], [27.2, 3.5], [29.1, 0], [33.8, 1.6], [36.6, 11.3], [33.9, 20.6], [32.4, 22.5], [6.7, 22.8], [1.5, 16.5], [0, 16.5]]);
  const H = 11, west = e => e.nu < -0.9, gw = (s, y, w, h, o) => Object.assign({ s, w, y, h, head: 'pointed', tile: CT.goth, trim: STN }, o);
  const pinnacle = (x, z, y, h, r = 0.45) => lmLathe(G, x, z, y, [[r, 0], [r, h - 2.4], [0.02, h]], 6, BRC);
  // the nave between buttresses, a pointed window on each side of the tower on its west end
  const nave = walls(K, f, [[0, 3.5], [27.2, 3.5], [27.2, 20.6], [0, 20.6]], 0, H, BR, e => Math.abs(e.nv) > 0.9 ? [0, 1, 2, 3, 4].map(k => gw(e.s(4.1 + k * 5, e.Pl[1]), 3.0, 1.9, 4.4))
    : west(e) ? [gw(e.s(0, 6.1), 3, 1.4, 4.4), gw(e.s(0, 18), 3, 1.4, 4.4)] : []);
  band(K, nave, 0, 0.7, 0.1, STN); band(K, nave, H - 0.55, H, 0.22, STN);
  for (const e of nave) if (Math.abs(e.nv) > 0.9) for (let k = 0; k <= 5; k++) { const s = Math.max(0.4, Math.min(e.L - 0.4, e.s(1.6 + k * 5, e.Pl[1])));
    pier(K, e, s, 0.8, 0, 6.5, 1.0, BRC); pier(K, e, s, 0.8, 6.5, 8.6, 0.55, BRC); pier(K, e, s, 0.9, 6.35, 6.55, 1.05, STN); pier(K, e, s, 0.9, 8.45, 8.65, 0.6, STN); }
  gable(K, f, 0, 33.8, 3.5, 20.6, H, 9.5, ROOF, BR, 'u', 0.4);
  // the transept with steep gables, rose windows over pairs of pointed windows
  const tr = walls(K, f, [[27.2, 1.4], [33.8, 1.4], [33.8, 21], [27.2, 21]], 0, H, BR, e => Math.abs(e.nv) > 0.9 ? [gw(e.L / 2 - 1.3, 2.6, 1.5, 4.2), gw(e.L / 2 + 1.3, 2.6, 1.5, 4.2)] : []);
  band(K, tr, 0, 0.7, 0.1, STN); band(K, tr, H - 0.55, H, 0.22, STN);
  gable(K, f, 27.2, 33.8, 1.4, 21, H, 9.5, ROOF, BR, 'v', 0.35);
  for (const e of tr) if (Math.abs(e.nv) > 0.9) {
    const Fw = e.Fw; oculus(K, Fw, e.L / 2, H + 2.4, 1.6, CT.rose, STN, 0.24, -0.04, true);
    const A = Fw.at(-0.3, H, -0.12), B = Fw.at(e.L + 0.3, H, -0.12), C = Fw.at(e.L / 2, H + 9.6, -0.12); lmBar(G, A, C, 0.3, STN); lmBar(G, C, B, 0.3, STN);
    for (const s of [-0.1, e.L + 0.1]) { const [x, , z] = Fw.at(s, 0, -0.3); pinnacle(x, z, 0, H + 3.6); }
    pinnacle(C[0], C[2], H + 9.3, 2.6, 0.3);
  }
  // the apse, half a hexagon under a pyramid of grey metal
  const AP = [[33.8, 6.6], [36.3, 7.8], [36.6, 11.3], [33.8, 14.6]];
  const ea = walls(K, f, AP, 0, 9, BR, e => e.L > 2 && e.L < 4 ? [gw(e.L / 2, 2.6, 1.1, 3.4)] : [], true);
  band(K, ea, 0, 0.7, 0.1, STN); band(K, ea, 8.55, 9, 0.2, STN);
  for (let k = 0; k < AP.length - 1; k++) polyA(G, [W3(f, ...AP[k], 9), W3(f, ...AP[k + 1], 9), W3(f, 34.2, 10.6, 13.2)], ROOF, 0, 1, 0);
  for (const [u, v] of [[0, 3.5], [0, 20.6]]) pinnacle(...lmW(f, u, v), 0, H + 3.6);
  // the west tower: brick up to a gable on each face, the octagonal spire, pinnacles on the corners
  const TW = [[-0.6, 8.85], [5.8, 8.85], [5.8, 15.25], [-0.6, 15.25]], HT = 30.5, bell = { tile: CT.bell, lit: false };
  const tw = walls(K, f, TW, 0, HT, BR, e => [gw(e.L / 2 - 0.75, 22.4, 0.95, 3.6, bell), gw(e.L / 2 + 0.75, 22.4, 0.95, 3.6, bell),
    ...(west(e) ? [gw(e.L / 2, 0.15, 2.3, 3.0, { tile: CT.door, lit: false, tw: 0.3 }), gw(e.L / 2, 7.2, 1.6, 4.0), gw(e.L / 2, 15.2, 1.0, 2.6)] : Math.abs(e.nv) > 0.9 ? [gw(e.L / 2, 15.2, 1.0, 2.6)] : [])]);
  band(K, tw, 0, 0.7, 0.1, STN); band(K, tw, 13.2, 13.6, 0.15, STN); band(K, tw, 20.6, 21.0, 0.15, STN);
  for (const e of tw) { const Fw = e.Fw; for (const s of [0.4, e.L - 0.4]) pier(K, e, s, 0.8, 0, 20.6, 0.35, BRC);
    const A = Fw.at(0, HT, -0.05), B = Fw.at(e.L, HT, -0.05), C = Fw.at(e.L / 2, HT + 3.8, -0.05); gableEnd(K, BR, A, B, HT + 3.8, BRC); lmBar(G, A, C, 0.25, STN); lmBar(G, C, B, 0.25, STN);
    opening(K, Fw, { s: e.L / 2, w: 1.1, y: HT + 0.5, h: 0.7, head: 'pointed', tile: CT.bell, lit: false, d: -0.07 }); }
  lid(G, f, TW, HT, ROOF);
  const [tx, tz] = lmW(f, 2.6, 12.05);
  latheF(G, tx, tz, HT, [[3.2, 0], [2.7, 3.4], [0.07, 20.6]], 8, SP, a + Math.PI / 8);
  lmBar(KC.gold, [tx, HT + 20.4, tz], [tx, HT + 21.9, tz], 0.08, LMWHITE); lmLathe(KC.gold, tx, tz, HT + 20.7, [[0.02, 0], [0.18, 0.18], [0.02, 0.36]], 8, LMWHITE);
  for (const [u, v] of TW) { const [x, z] = lmW(f, u, v); lmLathe(G, x, z, HT - 0.6, [[0.4, 0], [0.4, 1.4], [0.02, 4.2]], 6, SP); }
}

/* ---- the Catholic Church of the Immaculate Conception ----
   Proportions from the front photograph: towers 9 m wide with cornices at 9.9, 17.4, 25.2 and 31.2 m, the front
   between them 9.5 m wide up to 17.4 m, its curved gable with the niche of the Virgin to 24 m, crosses at 43 m. */
function churchCa(K) {
  const f = F.ca, G = K.plain, a = ang(f), WH = [246, 245, 241], TR = [255, 255, 255], BASE = hb('#dcd8d0'), ROOF = hb('#96989a'), DARK = hb('#3b4047'), ST = { tex: 1, col: WH };
  STATE.GBC = standOn(f, [[0.2, 27.5], [0, 0], [39, 0], [42.2, 3.4], [44.6, 13], [42.7, 22.9], [39.2, 25.9]]);
  const U = [11.2, 15.6, 20, 24.4, 28.8, 33.2], C1 = 9.9, C2 = 17.4, HS = 10.5;
  const pil = (e, s, y0, y1, w = 0.7) => pier(K, e, s, w, y0, y1, 0.15, TR), rw = (s, y, w, h, o) => Object.assign({ s, w, y, h, head: 'round', tile: CT.bar, trim: TR }, o);
  // the nave; its west wall is the front between the towers: three doors, the big window, cornices and pilasters, columns by the window
  const nave = walls(K, f, [[0, 9], [9, 9], [9, 7.2], [38.3, 7.2], [38.3, 20.3], [9, 20.3], [9, 18.5], [0, 18.5]], 0, C2, ST, e => e.nu < -0.9
    ? [rw(e.s(0, 13.75), 0.15, 2.2, 3.6, { tile: CT.door, lit: false, tw: 0.32 }), rw(e.s(0, 11.0), 0.15, 1.1, 2.4, { tile: CT.door, lit: false }), rw(e.s(0, 16.5), 0.15, 1.1, 2.4, { tile: CT.door, lit: false }),
      rw(e.s(0, 13.75), 10.6, 1.9, 3.3, { tw: 0.3 })]
    : Math.abs(e.nv) > 0.9 ? (e.L > 20 ? U.map(u => rw(e.s(u, e.Pl[1]), 12.6, 1.4, 2.2)) : []) : []);
  band(K, nave, C2 - 0.8, C2, 0.4, TR);
  for (const e of nave) if (e.nu < -0.9) {
    band(K, [e], 0, 0.8, 0.15, BASE); band(K, [e], C1 - 0.7, C1, 0.5, TR); band(K, [e], 6.3, 6.7, 0.25, TR);
    for (const v of [9.5, 12.15, 15.35, 18]) pil(e, e.s(0, v), 0.8, C1 - 0.7, 0.5);
    for (const v of [9.5, 18]) pil(e, e.s(0, v), C1, C2 - 0.8, 0.7);
    for (const v of [12.1, 15.4]) { const [x, , z] = e.Fw.at(e.s(0, v), 0, -0.4); lmLathe(G, x, z, C1, [[0.4, 0], [0.4, 0.3], [0.28, 0.4], [0.28, C2 - C1 - 1.4], [0.42, C2 - C1 - 1.0], [0.42, C2 - C1 - 0.8]], 10, TR); }
    const c = e.s(0, 13.75), Fw = e.Fw; for (let q = 0; q < 10; q++) { const t0 = Math.PI * q / 10, t1 = Math.PI * (q + 1) / 10;   // the arched hood over the main door
      lmBar(G, Fw.at(c - Math.cos(t0) * 2.0, 4.7 + Math.sin(t0) * 1.3, -0.3), Fw.at(c - Math.cos(t1) * 2.0, 4.7 + Math.sin(t1) * 1.3, -0.3), 0.3, TR); }
  } else if (Math.abs(e.nv) > 0.9 && e.L > 20) for (let k = 0; k <= 6; k++) pil(e, e.s(9 + k * 4.4, e.Pl[1]), HS, C2 - 0.8, 0.6);
  gable(K, f, 0.3, 38.3, 7.2, 20.3, C2, 5.0, ROOF, ST, 'u', 0.35);
  { // the curved gable over the front with the niche of the Virgin
    const Fw = lmWF(lmW(f, -0.05, 18.5), lmW(f, -0.05, 9)), m = 4.75;
    const half = [[4.75, C2], [4.75, C2 + 1.5], [4.4, C2 + 2.1], [3.6, C2 + 2.9], [2.6, C2 + 3.45], [2.15, C2 + 3.6], [2.15, C2 + 5.4], [1.6, C2 + 6.1], [0.8, C2 + 6.5], [0, C2 + 6.65]];
    const prof = [...half.map(([d, y]) => [m - d, y]), ...half.slice(0, -1).reverse().map(([d, y]) => [m + d, y])];
    for (const [d, sgn] of [[-0.05, 1], [0.35, -1]]) { const c = Fw.at(m, C2, d); for (let k = 0; k < prof.length - 1; k++) polyA(G, [c, Fw.at(...prof[k], d), Fw.at(...prof[k + 1], d)], WH, Fw.nx * sgn, 0, Fw.nz * sgn); }
    for (let k = 1; k < prof.length - 2; k++) if (k !== 5 && k !== prof.length - 7) lmBar(G, Fw.at(...prof[k], -0.15), Fw.at(...prof[k + 1], -0.15), 0.3, TR);
    for (const d of [-2.0, 2.0]) lmBoxW(G, Fw, m + d - 0.3, m + d + 0.3, C2, C2 + 5.2, -0.4, 0, TR);
    lmBoxW(G, Fw, m - 2.45, m + 2.45, C2 + 5.0, C2 + 5.4, -0.5, 0.35, TR);
    opening(K, Fw, { s: m, w: 1.3, y: C2 + 1.2, h: 2.2, head: 'round', tile: CT.statue, trim: TR, lit: false, d: -0.08 });
    const [x, , z] = Fw.at(m, 0, 0.15); crossOn(x, z, C2 + 6.6, 1.9, a, true);
  }
  const [lx, lz] = lmW(f, 38.6, 13.75); latheF(G, lx, lz, C2 + 4.6, [[0.6, 0], [0.6, 1.4], [0.75, 1.4], [0.05, 2.4]], 8, WH, a); crossOn(lx, lz, C2 + 7, 1.2, a, true);   // the small lantern on the east gable
  // the aisles under lean-to roofs, tall windows between pilasters
  for (const [vo, vi] of [[0, 7.2], [27.5, 20.3]]) {
    const outer = e => Math.abs(e.nv) > 0.9 && near(e.Pl[1], vo);
    const ai = walls(K, f, [[9, Math.min(vo, vi)], [38.3, Math.min(vo, vi)], [38.3, Math.max(vo, vi)], [9, Math.max(vo, vi)]], 0, HS, ST, e => outer(e) ? U.map(u => rw(e.s(u, vo), 2.8, 1.6, 4.2)) : []);
    band(K, ai, 0, 0.8, 0.12, BASE); band(K, ai, HS - 0.8, HS, 0.4, TR);
    for (const e of ai) if (outer(e)) for (let k = 0; k <= 6; k++) pil(e, e.s(9 + k * 4.4, vo), 0.8, HS - 0.8);
    leanTo(K, f, 9, 38.3, vo, vi, HS, 12.3, ROOF, WH);
  }
  // three apses in a trefoil: half-round walls under half-domes
  const apse = (cu, cv, r, h, segs, wins) => {
    const pts = []; for (let k = 0; k <= 8; k++) { const t = -Math.PI / 2 + Math.PI * k / 8; pts.push([cu + Math.cos(t) * r, cv + Math.sin(t) * r]); }
    const E = walls(K, f, pts, 0, h, ST, e => segs.includes(Math.min(pts.indexOf(e.Pl), pts.indexOf(e.Ql))) ? wins(e) : [], true);
    band(K, E, 0, 0.8, 0.12, BASE); band(K, E, h - 0.7, h, 0.35, TR);
    const R2 = r + 0.3, P = (t, b) => W3(f, cu + Math.cos(t) * R2 * Math.cos(b), cv + Math.sin(t) * R2 * Math.cos(b), h + R2 * 0.85 * Math.sin(b));
    for (let k = 0; k < 8; k++) for (let q = 0; q < 5; q++) {
      const t0 = -Math.PI / 2 + Math.PI * k / 8, t1 = t0 + Math.PI / 8, b0 = q / 5 * Math.PI / 2, b1 = (q + 1) / 5 * Math.PI / 2;
      polyA(G, q === 4 ? [P(t0, b0), P(t1, b0), P(t1, b1)] : [P(t0, b0), P(t1, b0), P(t1, b1), P(t0, b1)], ROOF, 0, 1, 0);
    }
  };
  apse(38.3, 13.75, 5.6, 14.5, [1, 3, 4, 6], e => [rw(e.L / 2, 3.2, 1.2, 3.4), rw(e.L / 2, 9.6, 0.9, 2.0)]);
  apse(38.3, 3.6, 3.3, 8.6, [2, 5], e => [rw(e.L / 2, 2.8, 0.8, 2.6)]);
  apse(38.3, 23.9, 3.3, 8.6, [2, 5], e => [rw(e.L / 2, 2.8, 0.8, 2.6)]);
  // the twin towers: tiers stepping in under heavy cornices, obelisks on the corners, a dark bulb, a lantern and a spire
  const obelisk = (x, z, y) => latheF(G, x, z, y, [[0.32, 0], [0.32, 0.45], [0.2, 0.45], [0.04, 2.0]], 4, TR, a + Math.PI / 4);
  for (const [v0, v1] of [[0, 9], [18.5, 27.5]]) {
    const vIn = v0 ? v0 : v1, inner = e => Math.abs(e.nv) > 0.9 && Math.abs(e.Pl[1] - vIn) < 2.5;
    const tier = (i, y0, y1, win, cor = 0.45) => { const p = [[i, v0 + i], [9 - i, v0 + i], [9 - i, v1 - i], [i, v1 - i]];
      const E = walls(K, f, p, y0, y1, ST, e => inner(e) && y1 <= C2 ? [] : win(e)); band(K, E, y1 - 0.7, y1, cor, TR); band(K, E, y1 - 1.0, y1 - 0.7, 0.18, TR);
      for (const e of E) for (const s of [0.4, e.L - 0.4]) pil(e, s, y0, y1 - 1.0, 0.8); lid(G, f, p, y1, ROOF); return { p, E }; };
    const t1 = tier(0, 0, C1, () => []); band(K, t1.E, 0, 0.8, 0.15, BASE); band(K, t1.E, 6.3, 6.7, 0.25, TR);
    for (const e of t1.E) if (e.nu < -0.9 || Math.abs(e.nv) > 0.9 && !inner(e)) oculus(K, e.Fw, e.L / 2, 4.6, 0.55, CT.rose, TR, 0.22);
    tier(0.2, C1, C2, e => [rw(e.L / 2, 12.0, 1.3, 2.2)]);
    const { p: p3 } = tier(0.6, C2, 25.2, e => [rw(e.L / 2, 19.2, 1.4, 2.6, { tile: CT.bell, lit: false })]);
    const { p: p4 } = tier(1.3, 25.2, 31.2, e => [rw(e.L / 2, 26.6, 1.2, 2.2, { tile: CT.bell, lit: false })]);
    tier(2.3, 31.2, 33.6, () => [], 0.3);
    for (const [u, v] of p3) { const [x, z] = lmW(f, u + Math.sign(4.5 - u) * 0.2, v + Math.sign((v0 + v1) / 2 - v) * 0.2); obelisk(x, z, 25.2); }
    for (const [u, v] of p4) { const [x, z] = lmW(f, u + Math.sign(4.5 - u) * 0.15, v + Math.sign((v0 + v1) / 2 - v) * 0.15); obelisk(x, z, 31.2); }
    const [x, z] = lmW(f, 4.5, (v0 + v1) / 2);
    latheF(G, x, z, 33.6, [[2.1, 0], [2.35, 0.5], [2.0, 1.5], [1.2, 2.3], [0.6, 2.6]], 8, DARK, a + Math.PI / 8);
    latheF(G, x, z, 36.2, [[0.6, 0], [0.6, 0.9], [0.75, 0.9], [0.75, 1.1], [0.45, 1.1], [0.55, 1.6], [0.05, 5.2]], 8, DARK, a + Math.PI / 8);
    crossOn(x, z, 41.3, 1.8, a, true);
  }
}

// the outline of a keel gable (an ogee arch with a point) of half-width 1 and height 1, from left to right
const KEEL = (() => { const h = [[-1, 0], [-1.04, 0.12], [-1.0, 0.3], [-0.86, 0.5], [-0.62, 0.68], [-0.36, 0.8], [-0.16, 0.9], [0, 1]]; return [...h, ...h.slice(0, -1).reverse().map(([x, y]) => [-x, y])]; })();
/* A keel gable on the face of the frame Fw centred at s, from y to y + h, half-width w, standing d out of the wall:
   filled with col, capped with metal along its edge that runs back into the roof by back metres. */
function keel(K, Fw, s, y, w, h, d, col, cap, back) {
  const G = K.plain, P = KEEL.map(([x, t]) => Fw.at(s + x * w, y + t * h, d)), c = Fw.at(s, y + h * 0.3, d);
  for (let k = 0; k < P.length - 1; k++) { polyA(G, [c, P[k], P[k + 1]], col, Fw.nx, 0, Fw.nz); lmBar(G, P[k], P[k + 1], 0.24, cap);
    if (back) polyA(G, [P[k], P[k + 1], out(Fw, P[k + 1], -back), out(Fw, P[k], -back)], cap, 0, 1, 0); }
  polyA(G, [Fw.at(s - w, y, d), Fw.at(s + w, y, d), c], col, Fw.nx, 0, Fw.nz);
}
// a row of small white arches under a cornice (the arcade frieze of Russian brick churches) along the edges
function arcade(K, edges, y, r, col) {
  for (const { Fw, L } of edges) { const n = Math.max(1, Math.round(L / (2 * r + 0.3))), step = L / n;
    for (let k = 0; k < n; k++) { const s = (k + 0.5) * step, pts = headPts(s, y, 2 * r, 'pointed');
      for (let q = 0; q < pts.length - 1; q++) lmBar(K.plain, Fw.at(pts[q][0], pts[q][1], -0.08), Fw.at(pts[q + 1][0], pts[q + 1][1], -0.08), 0.16, col);
      lmBar(K.plain, Fw.at(s - r, y - 0.35, -0.08), Fw.at(s - r, y, -0.08), 0.16, col); lmBar(K.plain, Fw.at(s + r, y - 0.35, -0.08), Fw.at(s + r, y, -0.08), 0.16, col); }
    lmBoxW(K.plain, Fw, -0.1, L + 0.1, y - 0.55, y - 0.35, -0.12, 0, col); lmBoxW(K.plain, Fw, -0.1, L + 0.1, y + r * 1.75 + 0.05, y + r * 1.75 + 0.3, -0.14, 0, col); }
}
// dentils: small blocks under a cornice every step metres
const dentils = (K, edges, y0, y1, step, col) => { for (const e of edges) { const n = Math.floor(e.L / step); for (let k = 0; k < n; k++) pier(K, e, (k + 0.5) * e.L / n, step * 0.45, y0, y1, 0.14, col); } };

/* ---- the Old Believers' Church of the Nativity of the Theotokos ---- */
function churchOb(K) {
  const f = F.ob, G = K.plain, a = ang(f), PINK = hb('#e9ab9d'), WH = hb('#f6f3ee'), ROOF = hb('#a3abaf'), RED = hb('#b3402f'), BLU = hb('#3d64b0'), STONE = hb('#9d9890'), ST = { tex: 1, col: PINK };
  STATE.GBC = standOn(f, [[1.3, 19.6], [0, 13], [0, 6.2], [1.1, 0], [33.8, 0], [35.5, 6], [35.5, 12.9], [33.8, 19.6]]);
  const hw = (s, y, w, h, o) => Object.assign({ s, w, y, h, head: 'round', tile: CT.pom, trim: WH, tw: 0.24 }, o), keelW = (s, y, w, h, o) => hw(s, y, w, h, Object.assign({ trimHead: 'pointed' }, o));
  const base = E => { band(K, E, -0.3, 0.6, 0.1, STONE); band(K, E, 0.6, 0.75, 0.13, WH); };
  // the main volume: tall windows under keel hoods, the arcade frieze and a dentil cornice, a projection with a keel gable in the middle of each side
  const HM = 12.5, MAIN = [[13, 0], [33.8, 0], [33.8, 19.6], [13, 19.6]];
  const main = walls(K, f, MAIN, 0, HM, ST, e => Math.abs(e.nv) > 0.9 ? [16.4, 30.4].map(u => keelW(e.s(u, e.Pl[1]), 3.0, 1.5, 3.6)) : e.nu > 0.9 ? [keelW(e.s(33.8, 2.8), 3.0, 1.3, 3.6), keelW(e.s(33.8, 16.8), 3.0, 1.3, 3.6)] : []);
  base(main); arcade(K, main, 10.3, 0.42, WH); band(K, main, HM - 0.75, HM - 0.55, 0.16, WH); dentils(K, main, HM - 0.55, HM - 0.3, 0.55, WH); band(K, main, HM - 0.3, HM, 0.4, WH);
  for (const e of main) if (Math.abs(e.nv) > 0.9) {
    const Fw = e.Fw, s = e.s(23.4, e.Pl[1]), dp = -0.6;
    lmBoxW(G, Fw, s - 3.5, s + 3.5, 0, 7.2, dp, 0, PINK); lmBoxW(G, Fw, s - 3.6, s + 3.6, -0.3, 0.6, dp - 0.1, dp, STONE);
    for (const q of [s - 3.2, s + 3.2]) lmBoxW(G, Fw, q - 0.3, q + 0.3, 0.6, 7.2, dp - 0.12, 0, WH);
    keel(K, Fw, s, 7.2, 3.7, 2.4, dp - 0.05, PINK, ROOF, 1.2); keel(K, Fw, s, 7.2, 3.3, 2.1, dp - 0.08, WH, WH, 0); keel(K, Fw, s, 7.4, 2.9, 1.75, dp - 0.1, PINK, WH, 0);
    opening(K, Fw, keelW(s, 2.8, 1.5, 2.8, { d: dp - 0.03, tile: CT.icon, lit: false }));
    for (const q of [-2.0, 2.0]) opening(K, Fw, hw(s + q, 3.0, 0.8, 3.4, { d: dp - 0.03 }));
  }
  lmHip(G, f, 13, 33.8, 0, 19.6, HM, 2.4, ROOF, 0.5);
  // the large gilded onion on an octagonal red drum
  { const [x, z] = lmW(f, 23.4, 9.8), y0 = HM + 1.6;
    latheF(G, x, z, y0, [[2.75, 0], [2.75, 3.0]], 8, RED, a + Math.PI / 8); latheF(G, x, z, y0 + 3.0, [[2.75, 0], [3.0, 0.15], [3.0, 0.45], [2.5, 0.45]], 8, WH, a + Math.PI / 8);
    for (let k = 0; k < 8; k++) { const t = a + Math.PI / 8 + k * Math.PI / 4; lmBar(G, [x + Math.cos(t) * 2.8, y0, z + Math.sin(t) * 2.8], [x + Math.cos(t) * 2.8, y0 + 3.0, z + Math.sin(t) * 2.8], 0.18, WH); }
    crossOn(x, z, onion(K, x, z, y0 + 3.45, 3.0), 2.8, a); }
  // the altar on the east end with a small blue onion
  const ap = walls(K, f, [[33.8, 6], [35.5, 6], [35.5, 12.9], [33.8, 12.9]], 0, 8, ST, null); base(ap); band(K, ap, 7.5, 8, 0.25, WH);
  lmHip(G, f, 33.8, 35.5, 6, 12.9, 8, 1.2, ROOF, 0.25);
  { const [x, z] = lmW(f, 34.8, 9.45), y = drum(K, x, z, 8.6, 0.38, 1.0, PINK, WH); crossOn(x, z, onion(K, x, z, y, 0.55, BLU), 0.9, a); }
  // the narthex in two storeys, the west porch with a keel gable, the bell tower over it
  const HW = 10, NAR = [[1.1, 0], [13, 0], [13, 19.6], [1.1, 19.6]];
  const nar = walls(K, f, NAR, 0, HW, ST, e => { if (e.nu > 0.9) return []; const pos = e.nu < -0.9 ? [3, 16.6] : [4.6, 9.5]; const o = [];
    for (const p of pos) { const s = e.nu < -0.9 ? e.s(1.1, p) : e.s(p, e.Pl[1]); o.push(hw(s, 1.4, 1.2, 2.4), hw(s, 5.5, 1.3, 2.6)); } return o; });
  base(nar); dentils(K, nar, HW - 0.55, HW - 0.3, 0.55, WH); band(K, nar, HW - 0.3, HW, 0.35, WH); band(K, nar, HW - 0.75, HW - 0.55, 0.14, WH);
  lmHip(G, f, 1.1, 13, 0, 19.6, HW, 3.6, ROOF, 0.45);
  const PO = [[0, 6.2], [1.6, 6.2], [1.6, 13], [0, 13]];
  const po = walls(K, f, PO, 0, HW + 0.3, ST, e => e.nu < -0.9 ? [hw(e.L / 2, 0.4, 1.9, 2.6, { tile: CT.door, lit: false, tw: 0.4 }), hw(e.L / 2, 5.0, 1.2, 2.6)] : []);
  base(po);
  for (const e of po) if (e.nu < -0.9) { const Fw = e.Fw;
    for (const s of [0.5, e.L - 0.5]) { pier(K, e, s, 1.0, 0.6, 4.2, 0.4, WH); lmBoxW(G, Fw, s - 0.6, s + 0.6, 4.2, 4.6, -0.5, 0, WH); const [x, , z] = Fw.at(s, 0, -0.35); lmLathe(G, x, z, 4.6, [[0.42, 0], [0.42, 4.8], [0.55, 5.0], [0.55, 5.4]], 10, WH); }
    keel(K, Fw, e.L / 2, HW - 0.2, 3.6, 5.6, -0.4, WH, ROOF, 2.0);
    opening(K, Fw, hw(e.L / 2, HW + 0.9, 1.0, 1.0, { tile: CT.icon, lit: false, d: -0.45, trim: hb('#c9a24a'), tw: 0.12 }));
    const [x, , z] = Fw.at(e.L / 2, 0, -0.4); crossOn(x, z, HW + 5.4, 1.1, a); }
  lid(G, f, PO, HW + 0.3, ROOF);
  const TW = [[3.5, 6.8], [9.5, 6.8], [9.5, 12.8], [3.5, 12.8]], HT = 18.5, bell = { tile: CT.bell, lit: false };
  const tw = walls(K, f, TW, HW - 0.5, HT, ST, e => [keelW(e.L / 2 - 1.15, 13.3, 0.7, 2.6, bell), keelW(e.L / 2, 13.0, 0.8, 3.2, bell), keelW(e.L / 2 + 1.15, 13.3, 0.7, 2.6, bell)]);
  band(K, tw, HT - 0.75, HT - 0.55, 0.14, WH); dentils(K, tw, HT - 0.55, HT - 0.3, 0.5, WH); band(K, tw, HT - 0.3, HT, 0.4, WH);
  lid(G, f, TW, HT, ROOF);
  const [tx, tz] = lmW(f, 6.5, 9.8);
  latheF(G, tx, tz, HT, [[4.0, 0], [1.4, 1.1]], 4, ROOF, a + Math.PI / 4);
  { const y = drum(K, tx, tz, HT + 0.9, 1.05, 1.4, RED, WH); crossOn(tx, tz, onion(K, tx, tz, y, 1.3), 1.7, a); }
}

/* Draws the four churches with their own atlas of windows and doors; the gilded domes and crosses go into one mesh. */
/* ---- the Catholic Church of the Divine Mercy in Ķīmiķu ciemats (Višķu iela 36, consecrated in 2019; OSM way 705215817) ----
   Away from Church Hill, but built with its means. From the Mapillary photographs of 2020 (from the south-east, the
   south-west and the north-west): red brick, a hall of two storeys under a pitched roof of red-brown tiles, tall
   windows of small panes in white frames along both sides, the front gable to the south with a cross on its apex, the
   door and a narrow window over it, the north end with two rows of windows; the square bell tower of about 27 m on the
   south-east corner, with small windows up each face, the belfry with two openings a face, a low pyramid and a cross.
   Frame km: u from the south-east corner northwards along the east side, v eastwards (the hall lies at v < 0). */
function churchKm(K) {
  const f = F.km, G = K.plain, a = ang(f), BR = { tex: 3, col: [255, 238, 228] }, ROOF = hb('#94473a'), TRIM = hb('#efe9df'), STONE = hb('#8f8b84');
  const BODY = [[0, -18.5], [43, -18.5], [43, 1.5], [0, 1.5]], H = 9.6, TW = [[-1.0, -4.1], [4.6, -4.1], [4.6, 1.6], [-1.0, 1.6]], HT = 25.5;
  STATE.GBC = standOn(f, BODY);
  const pom = (s, y, w = 1.2, h = 1.8) => ({ s, w, y, h, tile: CT.pom, trim: TRIM, tw: 0.1 });
  const body = walls(K, f, BODY, 0, H, BR, e => {
    if (Math.abs(e.nv) > 0.9) { const o = []; for (let u = 7.5; u <= 39; u += 6.3) o.push({ s: e.s(u, e.Pl[1]), w: 1.5, y: 1.4, h: 6.6, tile: CT.bar, trim: TRIM, tw: 0.12 }); return o; }   // the long sides
    if (e.nu < -0.9) { const s = e.s(0, -11.3); return [{ s, w: 2.0, y: 0.15, h: 3.0, tile: CT.door, lit: false, tw: 0.25, trim: TRIM }, { s, w: 1.0, y: 4.2, h: 4.9, tile: CT.bar, trim: TRIM, tw: 0.1 }]; }   // the south front
    return [pom(e.L * 0.3, 1.6), pom(e.L * 0.7, 1.6), pom(e.L * 0.3, 5.6), pom(e.L * 0.7, 5.6)];   // the north end
  });
  band(K, body, 0, 0.6, 0.06, STONE); band(K, body, H - 0.35, H, 0.12, sh(hb('#b5553e'), 0.9));
  gable(K, f, 0, 43, -18.5, 1.5, H, 5.2, ROOF, BR, 'u', 0.5);
  // small gablets on the roof, two a side
  for (const u of [14, 30]) for (const sv of [-1, 1]) { const v0 = sv < 0 ? -18.5 : 1.5, vm = -8.5, A = W3(f, u - 1.2, v0 + (vm - v0) * 0.35, H + 5.2 * 0.35), B = W3(f, u + 1.2, v0 + (vm - v0) * 0.35, H + 5.2 * 0.35), C = W3(f, u, v0 + (vm - v0) * 0.35, H + 5.2 * 0.35 + 1.1);
    polyA(G, [A, B, C], hb('#a85a45'), -f[3] * sv, 0.3, f[2] * sv); lmBar(G, A, C, 0.12, ROOF); lmBar(G, C, B, 0.12, ROOF); }
  crossOn(...lmW(f, -0.1, -8.5), H + 5.2, 1.6, a, true);
  // the bell tower
  const tw = walls(K, f, TW, 0, HT, BR, e => { const o = []; for (let y = 3.4; y < 19; y += 3.6) o.push(pom(e.L / 2, y, 0.8, 1.3));
    for (const d of [-0.8, 0.8]) o.push({ s: e.L / 2 + d, w: 1.0, y: 21.6, h: 2.6, tile: CT.bell, lit: false, trim: TRIM, tw: 0.08 }); return o; });
  band(K, tw, 0, 0.6, 0.06, STONE); band(K, tw, 20.8, 21.2, 0.14, STONE); band(K, tw, HT - 0.4, HT, 0.18, STONE);
  const [tx, tz] = lmW(f, 1.8, -1.25);
  latheF(G, tx, tz, HT, [[3.96 + 0.3, 0], [0.06, 2.8]], 4, ROOF, a + Math.PI / 4);
  crossOn(tx, tz, HT + 2.7, 2.2, a, true);
}
function lmChurchHill(K, litPatch) {
  const [dc, dorm, dglow] = chAtlas();
  LMM.chDet = lmStd({ vertexColors: true, map: dc, roughnessMap: dorm, metalnessMap: dorm, roughness: 1, metalness: 1, emissive: new THREE.Color(1, 1, 1), emissiveMap: dglow, emissiveIntensity: 0 }, 'lm-ch-det', litPatch);
  KC.det = new LMB(); KC.gold = new GB(false);
  cathedralBG(K); cathedralLu(K); churchCa(K); churchOb(K); churchKm(K);
  STATE.GBC = null;
  KC.det.mesh(LMM.chDet);
  const gm = KC.gold.mesh(matGold); if (gm) { gm.castShadow = true; gm.receiveShadow = true; scene.add(gm); }
  KC.det = KC.gold = null;
}

export { lmChurchHill };
