import { STATE } from '../core/state.js';
import { lmBar, lmBoxL } from './helpers.js';
import { polyA } from '../core/geometry.js';
import { terrainH } from '../world/terrain.js';
import { RB } from '../world/bridge-railway.js';
import { WL } from '../core/env.js';
import { hb, sh } from '../core/util.js';

/* ---- Dzelzceļa tilts over the Daugava (data and sources: src/world/bridge-railway.js) ----
   Five through-truss spans between abutments of rough ashlar, the first and the last 12 m are concrete beams over the
   service roads along the river banks. The track lies at y = 0 of the deck line, a straight line from the height of
   one bank to the other (the same as the rails drawn by buildLines): everything from -1.4 m up goes with the deck, the
   piers below stay on the river bed. */
const SPANS = 5, EDGE = 12, TH = 7.0, TW = 2.95, PANELS = 8;
function lmRailBridge(K) {
  const G = K.plain, { A, T, N, L } = RB, STEEL = hb('#aeb4b7'), STEEL2 = sh(STEEL, 0.82), DECK = hb('#4b4f52'), STONE = hb('#bab4a6'), STONE2 = sh(STONE, 0.9), CON = hb('#a8a59d'), RAIL = hb('#8d9396');
  const h0 = terrainH(A[0], A[1]), h1 = terrainH(RB.B[0], RB.B[1]);
  const line = s => h0 + (h1 - h0) * Math.max(0, Math.min(1, s / L));
  // geometry in the frame of the deck: the parts above -1.4 m ride on the straight deck line, the foundations stay on the ground
  STATE.GBC = (x, y, z) => { if (y <= -1.4) return 0; const s = (x - A[0]) * T[0] + (z - A[1]) * T[1]; return line(s) - terrainH(x, z); };
  const P = (s, d, y) => [A[0] + T[0] * s + N[0] * d, y, A[1] + T[1] * s + N[1] * d];
  const f = (s, d = 0) => [A[0] + T[0] * s + N[0] * d, A[1] + T[1] * s + N[1] * d, T[0], T[1]];
  const box = (s0, s1, d0, d1, y0, y1, col, bottom = true) => lmBoxL(G, f(0), s0, s1, d0, d1, y0, y1, col, bottom);
  const bar = (s0, d0, y0, s1, d1, y1, w, col) => lmBar(G, P(s0, d0, y0), P(s1, d1, y1), w, col);
  const s0 = EDGE, s1 = L - EDGE, span = (s1 - s0) / SPANS, pw = span / PANELS;
  // ---- the approach beams over the river-bank roads: a slab with a steel railing, abutments of ashlar below
  for (const [a, b] of [[0, s0], [s1, L]]) {
    box(a, b, -2.6, 2.6, -1.3, -0.05, CON); box(a, b, -2.1, 2.1, -0.5, 0, DECK, false);
    for (const d of [-2.5, 2.5]) { bar(a, d, 0.95, b, d, 0.95, 0.07, RAIL); bar(a, d, 0.45, b, d, 0.45, 0.05, RAIL); for (let s = a; s <= b + 0.01; s += 1.5) bar(s, d, 0, s, d, 0.95, 0.05, RAIL); }
  }
  // the abutments of ashlar on the bank slopes under the ends of the trusses, with a course of dressed stone on top
  for (const [a, b, sg] of [[s0 - 0.8, s0 + 0.4, 1], [s1 - 0.4, s1 + 5, -1]]) { box(a, b, -3.6, 3.6, -14, -1.3, STONE); box(a - 0.15 * sg, b + 0.15 * sg, -3.8, 3.8, -1.6, -1.3, STONE2);
    for (const e of [a, b]) for (let y = -12; y < -1.7; y += 0.55) for (const d of [-3.6, 3.6]) box(e - 0.01, e + 0.01, d - 0.0, d + 0.0, y, y + 0.03, STONE2, false); }
  // ---- the piers: ashlar shafts with pointed cutwaters (hexagonal plan), a cap stone under the trusses
  const prism = (cs, cd, hs, hd, y0, y1, col) => {   // a hexagon with points along d: half thickness hs, half length hd, points 2.0 m long
    const o = [[-hs, -hd + 2.0], [-hs, hd - 2.0], [0, hd], [hs, hd - 2.0], [hs, -hd + 2.0], [0, -hd]], n = o.length;
    const q = o.map(([u, v]) => [cs + u, cd + v]);
    for (let i = 0; i < n; i++) { const a = q[i], b = q[(i + 1) % n], ds = b[0] - a[0], dd = b[1] - a[1], l = Math.hypot(ds, dd), ns = dd / l, nd = -ds / l;   // outward normal in (s, d)
      polyA(G, [P(a[0], a[1], y0), P(b[0], b[1], y0), P(b[0], b[1], y1), P(a[0], a[1], y1)], col, T[0] * ns + N[0] * nd, 0, T[1] * ns + N[1] * nd); }
    polyA(G, q.map(([s, d]) => P(s, d, y1)), sh(col, 1.06), 0, 1, 0);
  };
  for (let k = 1; k < SPANS; k++) { const s = s0 + k * span;
    prism(s, 0, 1.15, 3.7, -12, -1.35, STONE); for (let y = -11.4; y < -1.7; y += 0.55) prism(s, 0, 1.17, 3.74, y, y + 0.05, STONE2); prism(s, 0, 1.4, 4.0, -1.65, -1.3, STONE2);
    box(s - 1.0, s + 1.0, -2.1, 2.1, -1.3, -0.95, STEEL2); }   // the shoes
  // ---- the trusses: plate floor, lower and upper chords, Warren web with verticals, portals, bracing
  for (let k = 0; k < SPANS; k++) { const a = s0 + k * span, b = a + span;
    box(a + 0.25, b - 0.25, -2.5, 2.5, -1.0, -0.45, DECK);                           // the floor with its ballast trough
    for (const sg of [-1, 1]) { const d = sg * TW;
      box(a + 0.1, b - 0.1, d - 0.25, d + 0.25, -0.95, -0.15, STEEL2);              // the lower chord
      box(a + 0.1, b - 0.1, d - 0.3, d + 0.3, TH - 0.4, TH, STEEL);                 // the upper chord
      for (let i = 0; i <= PANELS; i++) { const s = a + i * pw, end = i === 0 || i === PANELS;
        bar(s, d, -0.15, s, d, TH - 0.4, end ? 0.5 : 0.28, STEEL2);                // verticals
        if (i < PANELS) { const m = s + pw / 2; bar(s, d, -0.1, m, d, TH - 0.4, 0.26, STEEL); bar(m, d, TH - 0.4, s + pw, d, -0.1, 0.26, STEEL); }
        if (!end) bar(s, 0, TH - 0.5, s, 0, TH - 0.5, 0.01, STEEL); }
      // the footway outside: a plank deck on brackets, a railing
      box(a, b, d + sg * 0.25, d + sg * 1.25, -0.5, -0.38, hb('#7b7d7a'), false);
      bar(a, d + sg * 1.2, 0.6, b, d + sg * 1.2, 0.6, 0.06, RAIL); bar(a, d + sg * 1.2, -0.1, b, d + sg * 1.2, -0.1, 0.05, RAIL);
      for (let s = a; s <= b + 0.01; s += 2) { bar(s, d + sg * 1.2, -0.38, s, d + sg * 1.2, 0.6, 0.05, RAIL); bar(s, d + sg * 0.25, -0.95, s, d + sg * 1.2, -0.38, 0.06, STEEL2); } }
    for (let i = 0; i <= PANELS; i++) { const s = a + i * pw; bar(s, -TW, -0.5, s, TW, -0.5, 0.3, STEEL2);   // the floor beams
      if (i > 0 && i < PANELS && i % 2 === 0) { bar(s, -TW, TH - 0.5, s, TW, TH - 0.5, 0.24, STEEL); bar(s, -TW, TH - 2.2, s, 0, TH - 0.5, 0.18, STEEL); bar(s, TW, TH - 2.2, s, 0, TH - 0.5, 0.18, STEEL); } }
    for (let i = 0; i < PANELS; i += 2) { const sa = a + i * pw, sb = sa + 2 * pw; bar(sa, -TW, TH - 0.45, sb, TW, TH - 0.45, 0.14, STEEL2); bar(sa, TW, TH - 0.45, sb, -TW, TH - 0.45, 0.14, STEEL2); }   // the wind bracing
    for (const s of [a, b]) { box(s - 0.2, s + 0.2, -TW - 0.3, TW + 0.3, TH - 1.3, TH - 0.4, STEEL2); }   // the portal frames
  }
  STATE.GBC = null;
}

export { lmRailBridge };
