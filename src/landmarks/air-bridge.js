import { STATE } from '../core/state.js';
import { lmBar, lmBoxL, lmLathe } from './helpers.js';
import { lmW } from './core.js';
import { bridgeOf, terrainH } from '../world/terrain.js';
import { hb, sh } from '../core/util.js';

/* ---- The "air bridge" to Jaunā Forštadte (gaisa tilts) ----
   The footbridge over the railway yard between Minskas iela and Slāvu iela: the walk from the station side to Jaunā
   Forštadte, "Pervomaika" to the townspeople (OSM way 37794110, "gaisa tilts uz Jauno Forštadti"). After the
   restoration design of 2024 (SIA "Vektors T" for SIA "Tilts", Daugavpils municipality): 200.3 m with two bends, spans
   27+27+27+27+2.4+18.5+27+2.4+27+15 m of prestressed concrete π-beams, 3.25 m wide with a 2.9 m walkway between steel
   railings, precast concrete columns under cap beams, lamp posts with globes; three stairs: a T-stair of 15+9+9 m to
   Minskas iela, a straight 26 m stair down between the tracks and a straight 21 m stair to Slāvu iela. The deck clears
   the tracks by about 6.7 m. */
const AIR = { deck: [[-576.6, -1671.7], [-529.1, -1645.6], [-481.9, -1618.7], [-481.7, -1616.7], [-494.2, -1573.6], [-493.3, -1571.1], [-458.2, -1551.7]],
  spans: [27, 27, 27, 27, 2.4, 18.5, 27, 2.4, 27, 15], W: 3.25, CLR: 7.7, land: [-587.1, -1677.7],
  steps: [[[-582.3, -1686.2], [-587.1, -1677.7], [-576.6, -1671.7]], [[-587.1, -1677.7], [-592.2, -1668.7]], [[-529.1, -1645.6], [-515.4, -1669.9]], [[-468, -1532.6], [-458.2, -1551.7]]] };
// a line of the city data that belongs to the air bridge or its stairs (drawn and walked by lmAirBridge)
function airOnLine(pts) { const V = [...AIR.deck, ...AIR.steps.flat()]; for (let i = 0; i < pts.length; i += 2) if (!V.some(([x, z]) => Math.hypot(pts[i] - x, pts[i + 1] - z) < 1.2)) return false; return true; }
function lmAirBridge(K) {
  const G = K.plain, CON = hb('#aaa7a0'), DECK = hb('#8f8a84'), RAIL = hb('#4d5458'), POST = hb('#5b6064');
  const P = AIR.deck, n = P.length, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[n - 1]; let low = 1e9; for (let s = 0; s <= L; s += 4) { const q = airAt(s); low = Math.min(low, terrainH(q[0], q[1])); }
  const D = low + AIR.CLR, hw = AIR.W / 2;
  function airAt(s) { let i = 0; while (i < n - 2 && cum[i + 1] < s) i++; const t = (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-6); return [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t, i]; }
  // geometry above the ground is given in absolute heights, feet at y = 0 stay on the ground
  STATE.GBC = (x, y, z) => y > 0.05 ? -terrainH(x, z) : 0;
  const frame = (A, B) => { const l = Math.hypot(B[0] - A[0], B[1] - A[1]); return [A[0], A[1], (B[0] - A[0]) / l, (B[1] - A[1]) / l, l]; };
  const railing = (f, l, v, y0) => { const at = (u, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
    lmBar(G, at(0, y0 + 1.1), at(l, y0 + 1.1), 0.07, RAIL); lmBar(G, at(0, y0 + 0.12), at(l, y0 + 0.12), 0.05, RAIL);
    const k = Math.max(1, Math.round(l / 0.3)); for (let i = 0; i <= k; i++) lmBar(G, at(i * l / k, y0 + 0.12), at(i * l / k, y0 + 1.1), i % 5 ? 0.025 : 0.06, RAIL); };
  // deck: π-beams under a slab, railings on both edges
  for (let i = 0; i < n - 1; i++) { const f = frame(P[i], P[i + 1]), l = f[4];
    lmBoxL(G, f, -0.05, l + 0.05, -hw, hw, D - 0.22, D, CON); for (const v of [-hw + 0.45, hw - 0.85]) lmBoxL(G, f, -0.05, l + 0.05, v, v + 0.4, D - 1.0, D - 0.22, sh(CON, 0.95));
    lmBoxL(G, f, 0, l, -hw + 0.18, hw - 0.18, D, D + 0.02, DECK, false);
    for (const v of [-hw + 0.1, hw - 0.1]) railing(f, l, v, D); }
  // piers at the span joints: a column under a cap beam
  const scale = L / AIR.spans.reduce((a, b) => a + b, 0); let sp = 0;
  for (let k = 0; k <= AIR.spans.length; k++) { const q = airAt(Math.min(L, sp * scale)), i = q[2], f0 = frame(P[i], P[i + 1]), f = [q[0], q[1], f0[2], f0[3]];
    lmBoxL(G, f, -0.3, 0.3, -0.3, 0.3, 0, D - 1.55, CON); lmBoxL(G, f, -0.45, 0.45, -hw - 0.1, hw + 0.1, D - 1.55, D - 1.0, sh(CON, 0.92));
    if (k % 2 === 0) { const w = lmW(f, 0, hw + 0.15); lmBar(G, [w[0], D, w[1]], [w[0], D + 4.2, w[1]], 0.09, POST); lmLathe(K.globe, w[0], w[1], D + 4.2, [[0.02, 0], [0.18, 0.08], [0.24, 0.24], [0.18, 0.42], [0, 0.48]], 12, hb('#f4f1e8')); }
    if (k < AIR.spans.length) sp += AIR.spans[k]; }
  // stairs: steps on an inclined slab with railings, a column under each long flight
  const stair = (A, B, h0, h1, wd = 2.4) => { const f = frame(A, B), l = f[4], m = Math.max(2, Math.round((h0 - h1) / 0.16)), hv = wd / 2;
    for (let k = 0; k < m; k++) { const ya = h0 - (k + 1) * (h0 - h1) / m; lmBoxL(G, f, k * l / m, (k + 1) * l / m + 0.02, -hv, hv, Math.max(ya - 0.35, h1 > 0.05 ? 0.06 : 0), ya + (h0 - h1) / m, CON, false); }
    const at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
    for (const v of [-hv + 0.08, hv - 0.08]) { lmBar(G, at(0, v, h0 + 1.0), at(l, v, h1 + 1.0), 0.06, RAIL); for (let u = 0; u <= l; u += 1.5) { const y = h0 + (h1 - h0) * u / l; lmBar(G, at(u, v, y), at(u, v, y + 1.0), 0.04, RAIL); } }
    if (l > 10) { const y = (h0 + h1) / 2 - 0.4; lmBoxL(G, [...lmW(f, l / 2, 0), f[2], f[3]], -0.25, 0.25, -0.25, 0.25, 0, y, CON); } };
  const gl = AIR.land, Lnd = (D + terrainH(gl[0], gl[1])) / 2, edge = (A, B, d) => { const l = Math.hypot(B[0] - A[0], B[1] - A[1]); return [A[0] + (B[0] - A[0]) * d / l, A[1] + (B[1] - A[1]) * d / l]; };
  const g = p => terrainH(p[0], p[1]);
  stair(P[0], gl, D, Lnd + 0.1, 2.9);
  lmBoxL(G, [gl[0], gl[1], 0.8714, 0.4906], -1.6, 1.6, -2.3, 2.3, Lnd - 0.25, Lnd + 0.1, CON); lmBoxL(G, [gl[0], gl[1], 1, 0], -0.25, 0.25, -0.25, 0.25, 0, Lnd - 0.25, CON);
  for (const e of [[-582.3, -1686.2], [-592.2, -1668.7]]) stair(edge(gl, e, 1.2), e, Lnd + 0.1, g(e) + 0.02);
  stair(edge([-529.1, -1645.6], [-515.4, -1669.9], hw), [-515.4, -1669.9], D, g([-515.4, -1669.9]) + 0.02);
  stair(P[n - 1], [-468, -1532.6], D, g([-468, -1532.6]) + 0.02);
  STATE.GBC = null;
  // walking: the deck at its own height, the stairs from their tops to the ground
  const reg = (pts, h0, h1, w) => { const B = bridgeOf(pts.flat(), w); B.H0 = h0; B.H1 = h1; };
  reg(P, D, D, hw); reg([P[0], gl], D, Lnd, 1.4); for (const e of [[-582.3, -1686.2], [-592.2, -1668.7]]) reg([gl, e], Lnd, g(e), 1.2);
  reg([[-529.1, -1645.6], [-515.4, -1669.9]], D, g([-515.4, -1669.9]), 1.2); reg([P[n - 1], [-468, -1532.6]], D, g([-468, -1532.6]), 1.2);
}

export { airOnLine, lmAirBridge };
