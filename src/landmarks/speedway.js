import * as THREE from 'three';
import { LMM, lmStd } from './index.js';
import { lmRegisterOutline } from './tv-tower.js';
import { lmBar, lmBoxL, lmLathe } from './helpers.js';
import { LMT, lr } from './tiles.js';
import { LMWHITE, lmL, lmW } from './core.js';
import { AREAS, COL, M_ASPH, M_MARK, M_PAVE, matPlain } from '../world/data.js';
import { groundMaterial } from '../render/materials.js';
import { detailTex, glowTex } from '../render/textures.js';
import { scene } from '../render/renderer.js';
import { GB, polyA } from '../core/geometry.js';
import { bbox, hash, hb, lin, pip, sh, triangulate } from '../core/util.js';

/* ---- Speedway stadium Lokomotīve, Jelgavas iela 54 ----
   The home of the speedway club Lokomotīve: the track opened in 1963 (405 m, 373 m since 1996). Plan from OpenStreetMap:
   the outer edge of the track (the raceway area, relation 20362487), the infield grass (way 803378638), the start and
   finish node, both stands (ways 130274825 and 130274821), the pit shelter (way 803378635) and the twelve lighting
   masts. The club's plan of the stadium (lokomotive.lv, 2026) names the parts: main stand A along Jelgavas iela with
   sectors A–F and VIP, stand B opposite, the pits and paddock towards Arodu iela, the start line before the VIP sector,
   gates to the track at the apex of each bend; the track is 11.2 m wide on the straights and 16.3 m in the bends. The
   look follows the club's photographs: blue seats with yellow rows, beige stairs with black handrails, a roof of
   shallow translucent barrel vaults on steel trusses over the middle of stand A with the yellow commentators' box
   under it, the yellow back boards, railing and flags of stand B, a fence of dark boards on white posts with
   advertising along the straights, orange air fences in the bends, grey masts with two lamps each, the pit boxes under
   blue roofs. Frame sp: origin in the middle of the track, u along its axis towards Puškina iela (south-east), v across
   it towards Jelgavas iela and stand A (south-west). The site is levelled in terrainInit and the stands can be climbed. */
const SPW = { f: [379.1, 374.0, Math.cos(43.1 * Math.PI / 180), Math.sin(43.1 * Math.PI / 180)], seg: 40, pools: null };
const spwP = (u, v, y) => { const w = lmW(SPW.f, u, v); return [w[0], y, w[1]]; };
const spwN = (nu, nv) => [nu * SPW.f[2] - nv * SPW.f[3], nu * SPW.f[3] + nv * SPW.f[2]];   // a direction of the frame in the world
const spwCap = (x, z) => { const [u, v] = lmL(SPW.f, x, z); return Math.hypot(Math.max(0, Math.abs(u) - SPW.seg), v); };   // distance from the axis
// OSM in the frame: the outer edge of the track, the edge of the infield grass, the lighting masts
const SPW_OUT = [[53, 43.1], [-51, 43.4], [-59.4, 42.4], [-67.4, 39.4], [-74.4, 34.8], [-79.5, 29.3], [-83.8, 23.4], [-86.3, 18.5], [-88.8, 11], [-89.6, 4.2], [-89.5, -4.7], [-87.7, -12.9], [-84.3, -20], [-79.5, -26.4], [-74.8, -31.1], [-68.1, -36.1], [-61.7, -39.5], [-53.7, -42.6], [-46.6, -43.8], [-37.8, -43.8], [48.5, -43.9], [54.7, -42.7], [59.8, -41.1], [64.4, -38.9], [69.2, -35.8], [73.5, -32.6], [78.3, -28.3], [82, -23.4], [86.1, -16.2], [87.8, -10.4], [88.8, -3.5], [88.9, 2.6], [87.2, 10.5], [85.4, 17.3], [81.7, 23.6], [77.9, 28.6], [74, 32.3], [69.6, 36], [64.7, 38.9], [59.7, 41.2], [53, 43.1]];
const SPW_IN = [[-45.9, 31.8], [-51.4, 30], [-56.5, 27.8], [-65, 21.7], [-68.8, 17.1], [-71.8, 11.9], [-73.6, 6.5], [-74.1, 1.3], [-73.3, -5.2], [-71.8, -11.3], [-68.6, -17.3], [-64, -22.2], [-58.9, -26.5], [-52.8, -29.7], [-46.4, -31.8], [-39.7, -32.1], [44.8, -31.8], [50.1, -29.8], [55.3, -27.6], [59.7, -24.4], [63.8, -20.9], [67.4, -16.1], [70.1, -10.7], [71.6, -5.7], [72.2, -0.7], [71.3, 5.5], [69.5, 11.6], [66.7, 17.1], [63.1, 21.9], [58.7, 25.6], [53.8, 28.4], [48.5, 30.3], [42.6, 31.5], [-45.9, 31.8]];
const SPW_MASTS = [[-56.6, 45.4], [-50, -46], [-92, -3.2], [-84.5, 27.3], [-77.9, -30.5], [-17.2, -46.2], [15.4, -46.5], [49.9, -46.4], [76.8, -32.9], [90.9, -4.6], [82.9, 26], [55.4, 45.6]];
/* The stands: front edge v0, depth D, s = +1 when the rows climb towards +v; aisles (u, width) between the sectors of the
   club's plan, the tunnel under the first rows, doors in the back wall. The profile: a 1.3 m front wall with the
   gangway behind it, fifteen rows 0.8 m deep and 0.42 m high, the top gangway at 7.6 m, the back wall. */
const SPR = { wall: 1.3, gang: 1.5, row: 0.8, rise: 0.42, n: 15 };
const SPW_STANDS = [
  { u0: -58.5, u1: 55.2, v0: 47.25, D: 14.6, s: 1, main: true, tunnel: -21, doors: [-48, -33, 12, 30, 46],
    aisles: [[-40.3, 1.2], [-30.2, 1.2], [-11.0, 1.2], [0.35, 1.2], [18.5, 1.2], [28.2, 1.2]] },
  { u0: -57.6, u1: 56.4, v0: -49.0, D: 14.4, s: -1, main: false, tunnel: 0, doors: [-42, -14, 14, 42],
    aisles: [[-28.6, 1.2], [0, 2.4], [28.6, 1.2]] }];
const SPW_PITS = { u0: -109.4, u1: -104.2, v0: -18.3, v1: 18.1, n: 10 };
const SPW_GATES = [[-1, 6.0], [1, -2.5]];   // gates in the fence at the apex of each bend: side of u, v
const SPW_START = -4.9;                     // the start and finish line, OSM node 7515105713
const SPW_FLAGS = [[['#9e3039', 0.4], ['#f3f1ec', 0.2], ['#9e3039', 0.4]], [['#f3f1ec', 0.5], ['#d4213d', 0.5]], { bg: '#c8102e', cross: '#f3f1ec' },
  [['#fdb913', 1 / 3], ['#006a44', 1 / 3], ['#c1272d', 1 / 3]], { bg: '#006aa7', cross: '#fecc00' }, [['#1b1b1b', 1 / 3], ['#dd0000', 1 / 3], ['#ffce00', 1 / 3]],
  [['#0072ce', 1 / 3], ['#1b1b1b', 1 / 3], ['#f3f1ec', 1 / 3]], [['#0057b7', 0.5], ['#ffd700', 0.5]]];   // LV, PL, DK, LT, SE, DE, EE, UA
const spwRowY = d => d < SPR.gang ? SPR.wall : SPR.wall + SPR.rise * Math.min(SPR.n, Math.floor((d - SPR.gang) / SPR.row) + 1);
// how high a walker stands on the terraces (and on the portal over a tunnel)
function spwGround(x, z) {
  const [u, v] = lmL(SPW.f, x, z); if (Math.abs(v) < 47 || Math.abs(v) > 64 || Math.abs(u) > 59) return 0;
  for (const S of SPW_STANDS) { if (u < S.u0 || u > S.u1) continue; const d = (v - S.v0) * S.s; if (d < 0 || d > S.D) continue;
    return Math.abs(u - S.tunnel) < 1.4 && d < SPR.gang + 3 * SPR.row ? SPR.wall + 3 * SPR.rise + 0.06 : spwRowY(d); }
  return 0;
}
// the cadastre and OSM outlines of the stands and of the pit shelter are drawn here; the raceway line and trees stay off
const SPW_KEYS = [[0, 54.5], [0, -56.2], [-106.8, 0]];
function spwDrops(ring, bb) { for (const [u, v] of SPW_KEYS) { const [x, z] = lmW(SPW.f, u, v); if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(x, z, ring)) return true; } return false; }
function spwTrackLine(cls, pts) { if (cls !== 7) return false; for (let i = 0; i < pts.length; i += 2) if (spwCap(pts[i], pts[i + 1]) > 47) return false; return true; }
function spwNoTree(x, z) { const [u, v] = lmL(SPW.f, x, z); return u > -116 && u < 106 && v > -66 && v < 70; }
/* The edges of the track: both OSM rings at 1 m steps, smoothed (three passes of a 7-point mean keep the straights
   straight and round off the corners of the mapped polygon); the inner edge is resampled at 1 m, and along its outward
   normals the width of the track is taken up to the outer ring and smoothed, so that the outer edge, the fence and the
   air fences run parallel to the racing surface. */
function spwRings() {
  const prep = r => { const p = r.slice(0, -1); let q = [];
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let k = 0; k < m; k++) q.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m]); }
    for (let it = 0; it < 3; it++) { const N = q.length; q = q.map((_, i) => { let x = 0, z = 0; for (let k = -3; k <= 3; k++) { const c = q[(i + k + N) % N]; x += c[0]; z += c[1]; } return [x / 7, z / 7]; }); }
    return q; };
  const Iq = prep(SPW_IN), Oq = prep(SPW_OUT), cum = [0];
  for (let i = 1; i <= Iq.length; i++) { const a = Iq[i - 1], b = Iq[i % Iq.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[Iq.length], n = Math.round(L), I = [];
  for (let k = 0, j = 0; k < n; k++) { const s = k * L / n; while (cum[j + 1] < s) j++; const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1), a = Iq[j], b = Iq[(j + 1) % Iq.length]; I.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  const N = I.map((p, i) => { const a = I[(i + n - 1) % n], b = I[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; let nu = (b[1] - a[1]) / l, nv = -(b[0] - a[0]) / l; if (nu * p[0] + nv * p[1] < 0) { nu = -nu; nv = -nv; } return [nu, nv]; });
  let W = I.map((p, i) => { const d = N[i]; let best = 1e9;
    for (let j = 0; j < Oq.length; j++) { const a = Oq[j], b = Oq[(j + 1) % Oq.length], eu = b[0] - a[0], ev = b[1] - a[1], den = d[0] * ev - d[1] * eu; if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - p[0]) * ev - (a[1] - p[1]) * eu) / den, s = ((a[0] - p[0]) * d[1] - (a[1] - p[1]) * d[0]) / den; if (t > 0 && s >= 0 && s <= 1 && t < best) best = t; }
    return best < 30 ? best : 11.6; });
  for (let it = 0; it < 3; it++) W = W.map((_, i) => { let s = 0; for (let k = -4; k <= 4; k++) s += W[(i + k + n) % n]; return s / 9; });
  return { I, N, W, O: I.map((p, i) => [p[0] + N[i][0] * W[i], p[1] + N[i][1] * W[i]]), n };
}
// a flag at world (x, z) hanging from yt, flying along the world direction dir: stripes from the top [colour, share], or a Nordic cross
function spwFlag(G, x, z, yt, dir, F) {
  const L = 1.8, H = 1.2, nx = -dir[1], nz = dir[0];
  const quad = (s0, s1, h0, h1, col) => { const p = (s, h) => [x + dir[0] * s * L, yt - h * H - s * 0.1, z + dir[1] * s * L], Q = [p(s0, h1), p(s1, h1), p(s1, h0), p(s0, h0)], c = hb(col); polyA(G, Q, c, nx, 0, nz); polyA(G, Q, c, -nx, 0, -nz); };
  if (Array.isArray(F)) { let h = 0; for (const [c, t] of F) { quad(0, 1, h, h + t, c); h += t; } }
  else { const xs = [0, 0.33, 0.47, 1], ys = [0, 0.43, 0.57, 1]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) quad(xs[i], xs[i + 1], ys[j], ys[j + 1], i === 1 || j === 1 ? F.cross : F.bg); }
}
// a tile of the landmark atlas on an upright face with the outward normal Nw (world xz), centred on (x, z), from y0 up
function spwTile(K, name, x, z, y0, Nw, w, h, lit) {
  const t = LMT[name], r = [Nw[1] * w / 2, -Nw[0] * w / 2];
  K.det.q([x - r[0], y0, z - r[1]], [x + r[0], y0, z + r[1]], [x + r[0], y0 + h, z + r[1]], [x - r[0], y0 + h, z - r[1]], [Nw[0], 0, Nw[1]], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, lit ? 1 : 0);
}
/* One stand: the terraces as solid steps of concrete, the aisles with half steps and handrails, seats (instanced
   later), the front railing, the tunnel portal, doors in the back wall; stand B also has its yellow back boards, the
   railing along its top and the flags. Its outline goes to the map; only the front and back walls stop a walker. */
function spwStand(K, S, SEATS) {
  const f = SPW.f, G = K.plain, V = d => S.v0 + S.s * d, P = (u, d, y) => spwP(u, V(d), y), D = S.D;
  const bx = (u0, u1, d0, d1, y0, y1, col) => lmBoxL(G, f, u0, u1, Math.min(V(d0), V(d1)), Math.max(V(d0), V(d1)), y0, y1, col, false);
  const CON = hb(S.main ? '#b3afa6' : '#bab7af'), STEP = hb(S.main ? '#cbbd9c' : '#e0ded7'), IRON = hb('#2a2e32');
  const yRow = k => SPR.wall + SPR.rise * (k + 1), dRow = k => SPR.gang + SPR.row * k, top = yRow(SPR.n - 1), back = D - 0.3, para = top + 1.1;
  const TW = 1.4, tun = (u, k) => k < 3 && Math.abs(u - S.tunnel) < TW + 0.1, toTrack = spwN(0, -S.s), outW = spwN(0, S.s);
  // the terraces: front wall and gangway, the rows, the top gangway, the back wall
  bx(S.u0, S.u1, 0, SPR.gang, 0, SPR.wall, CON);
  for (let k = 0; k < SPR.n; k++) bx(S.u0, S.u1, dRow(k), dRow(k + 1), 0, yRow(k), sh(CON, k % 2 ? 0.97 : 1));
  bx(S.u0, S.u1, dRow(SPR.n), back, 0, top, CON); bx(S.u0, S.u1, back, D, 0, para, sh(CON, 1.03));
  // aisles at both ends and between the sectors: a half step in the back of every row, a black handrail up the middle
  const aisles = [[S.u0 + 0.6, 1.2], ...S.aisles, [S.u1 - 0.6, 1.2]];
  for (const [ua, wa] of aisles) {
    for (let k = 0; k < SPR.n; k++) { if (tun(ua, k)) continue;
      bx(ua - wa / 2, ua + wa / 2, dRow(k), dRow(k) + SPR.row / 2, yRow(k), yRow(k) + 0.012, STEP); bx(ua - wa / 2, ua + wa / 2, dRow(k) + SPR.row / 2, dRow(k + 1), yRow(k), yRow(k) + SPR.rise / 2, STEP); }
    if (ua < S.u0 + 1 || ua > S.u1 - 1) continue;
    const k0 = Math.abs(ua - S.tunnel) < TW ? 3 : 0, d0 = dRow(k0) + 0.2, y0 = yRow(k0) + 0.95, d1 = dRow(SPR.n), y1 = top + 0.95, yr = d => y0 + (y1 - y0) * (d - d0) / (d1 - d0);
    for (const ur of wa > 2 ? [ua - 0.6, ua + 0.6] : [ua]) { lmBar(G, P(ur, d0, y0), P(ur, d1, y1), 0.05, IRON); for (let k = k0; k < SPR.n; k += 3) { const d = dRow(k) + 0.6; lmBar(G, P(ur, d, yRow(k) + SPR.rise / 2), P(ur, d, yr(d)), 0.04, IRON); } }
  }
  // seats in the blocks between the aisles, at the back of each row; stand A has a yellow row in every four
  const ang = Math.atan2(toTrack[0], toTrack[1]);
  for (let i = 0; i < aisles.length - 1; i++) { const b0 = aisles[i][0] + aisles[i][1] / 2, b1 = aisles[i + 1][0] - aisles[i + 1][1] / 2, m = Math.floor((b1 - b0 - 0.1) / 0.5), st = (b0 + b1) / 2 - (m - 1) * 0.25;
    for (let k = 0; k < SPR.n; k++) for (let j = 0; j < m; j++) { const u = st + j * 0.5; if (tun(u, k)) continue; const w = lmW(f, u, V(dRow(k + 1))); SEATS.push(w[0], yRow(k), w[1], ang, S.main && k % 4 === 3 ? 1 : 0); } }
  // the tunnel to the track: a portal over the first three rows with a dark opening and a railing on top
  { const u = S.tunnel, yt = yRow(2) + 0.06;
    bx(u - TW, u + TW, -0.05, dRow(3), 0, yt, CON);
    polyA(G, [P(u - 1.0, -0.07, 0), P(u + 1.0, -0.07, 0), P(u + 1.0, -0.07, 2.25), P(u - 1.0, -0.07, 2.25)], hb('#17191b'), toTrack[0], 0, toTrack[1]);
    for (const [a, b] of [[[u - TW, 0.05], [u + TW, 0.05]], [[u - TW, 0.05], [u - TW, dRow(3)]], [[u + TW, 0.05], [u + TW, dRow(3)]]]) { lmBar(G, P(a[0], a[1], yt + 1.0), P(b[0], b[1], yt + 1.0), 0.05, IRON); lmBar(G, P(a[0], a[1], yt), P(a[0], a[1], yt + 1.0), 0.045, IRON); } }
  // the railing on the front wall
  for (const [a, b] of [[S.u0, S.tunnel - TW], [S.tunnel + TW, S.u1]]) {
    lmBar(G, P(a, 0.1, SPR.wall + 1.0), P(b, 0.1, SPR.wall + 1.0), 0.05, IRON); lmBar(G, P(a, 0.1, SPR.wall + 0.5), P(b, 0.1, SPR.wall + 0.5), 0.03, IRON);
    const m = Math.max(1, Math.round((b - a) / 1.6)); for (let k = 0; k <= m; k++) { const u = a + (b - a) * k / m; lmBar(G, P(u, 0.1, SPR.wall), P(u, 0.1, SPR.wall + 1.0), 0.045, IRON); }
  }
  // the back wall: pilasters of the frame every 6.3 m and a band at the level of the top gangway; doors between them,
  // the main entrance from Jelgavas iela behind the VIP sector
  const doorAt = u => S.doors.some(dd => Math.abs(u - dd) < 1.3) || (S.main && Math.abs(u + 1) < 2.8);
  for (let u = S.u0 + 0.25; u < S.u1; u += (S.u1 - S.u0 - 0.5) / 18) if (!doorAt(u)) bx(u - 0.25, u + 0.25, D, D + 0.14, 0, para, sh(CON, 0.93));
  bx(S.u0, S.u1, D, D + 0.08, top - 0.35, top, sh(CON, 0.9));
  for (const u of S.doors) { const [x, z] = lmW(f, u, V(D + 0.02)); spwTile(K, 'stDoor', x, z, 0, outW, 1.4, 2.6, lr() < 0.4); }
  if (S.main) { const [x, z] = lmW(f, -1, V(D + 0.02)); spwTile(K, 'vkDoors', x, z, 0, outW, 4.6, 2.9, true); }
  if (!S.main) {
    // stand B: yellow ribbed boards along the back of the top gangway, a railing on the back wall, flags behind it
    const YEL = hb('#e2b62a'); bx(S.u0, S.u1, back - 0.05, back, top, para, YEL);
    for (let u = S.u0 + 0.3; u < S.u1; u += 0.6) bx(u - 0.04, u + 0.04, back - 0.09, back - 0.05, top, para, sh(YEL, 0.82));
    const yr = para + 1.05; lmBar(G, P(S.u0, D - 0.12, yr), P(S.u1, D - 0.12, yr), 0.05, IRON); lmBar(G, P(S.u0, D - 0.12, para + 0.5), P(S.u1, D - 0.12, para + 0.5), 0.03, IRON);
    for (let k = 0; k <= 57; k++) { const u = S.u0 + (S.u1 - S.u0) * k / 57; lmBar(G, P(u, D - 0.12, para), P(u, D - 0.12, yr), 0.04, IRON); }
    const wind = spwN(0.94, 0.34); let fi = 0;
    for (let u = S.u0 + 4.5; u < S.u1 - 2; u += 9.6) { const [x, , z] = P(u, D + 0.3, 0), yt = para + 5.6;
      lmBar(G, [x, 0, z], [x, yt, z], 0.09, hb('#d9d9d6')); lmLathe(G, x, z, yt, [[0, 0], [0.08, 0.05], [0.06, 0.13], [0, 0.18]], 8, hb('#c9a24a')); spwFlag(G, x, z, yt - 0.1, wind, SPW_FLAGS[fi++ % SPW_FLAGS.length]); }
  }
  lmRegisterOutline(f, [[S.u0, V(0)], [S.u1, V(0)], [S.u1, V(D)], [S.u0, V(D)]], 2, false);
  for (const d of [0, D]) { const A = lmW(f, S.u0, V(d)), B = lmW(f, S.u1, V(d)); COL.add(A[0], A[1], B[0], B[1], 0, 0); }
  for (const u of [S.u0, S.u1]) { const A = lmW(f, u, V(dRow(1))), B = lmW(f, u, V(D)); COL.add(A[0], A[1], B[0], B[1], 0, 0); }   // the ends: in from the front gangway only
}
/* The roof over the middle of stand A (sectors C, VIP and D): ten shallow barrel vaults of translucent sheet running
   from the back of the stand to over its middle rows, rising towards the front; steel arches at their ends, cantilever
   trusses in the valleys on columns that stand in the back wall; under the roof the yellow commentators' box and five
   floodlights over the home straight. */
function spwRoof(K, S, L, pools) {
  const f = SPW.f, G = K.plain, V = d => S.v0 + S.s * d, P = (u, d, y) => spwP(u, V(d), y), toTrack = spwN(0, -S.s);
  const R0 = -30.2, R1 = 18.5, NB = 10, BW = (R1 - R0) / NB, DB = 14.45, DF = 5.0, RISE = 0.85, yv = d => 12.0 + 0.8 * (DB - d) / (DB - DF);
  const PC = hb('#e3e8ea'), PCU = hb('#d3dbdf'), STEEL = hb('#cbd0d3'), DARK = hb('#5d6367'), LENS = hb('#fbfbf6');
  const crown = u => RISE * Math.sin(Math.PI * Math.min(1, Math.max(0, (u - R0) / BW - Math.floor((u - R0) / BW))));
  // the sheets let the daylight through: their own material glows faintly by day (lmNight dims it at night)
  const SH = new GB(false); LMM.spwSheet = lmStd({ vertexColors: true, roughness: 0.55, metalness: 0, emissive: new THREE.Color(0.9, 0.95, 1), emissiveIntensity: 0.32 }, 'spw-sheet');
  for (let b = 0; b < NB; b++) {
    const ub = R0 + b * BW, au = j => ub + j * BW / 8, ah = j => RISE * Math.sin(Math.PI * j / 8);
    for (let j = 0; j < 8; j++) {
      const Q = [P(au(j), DB, yv(DB) + ah(j)), P(au(j + 1), DB, yv(DB) + ah(j + 1)), P(au(j + 1), DF, yv(DF) + ah(j + 1)), P(au(j), DF, yv(DF) + ah(j))];
      polyA(SH, Q, PC, 0, 1, 0); polyA(SH, Q, PCU, 0, -1, 0);
      for (const d of [DB, DF]) lmBar(G, P(au(j), d, yv(d) + ah(j)), P(au(j + 1), d, yv(d) + ah(j + 1)), 0.13, STEEL);
    }
    lmBar(G, P(ub + BW / 2, DB, yv(DB) + RISE - 0.06), P(ub + BW / 2, DF, yv(DF) + RISE - 0.06), 0.1, STEEL);
  }
  { const m = SH.mesh(LMM.spwSheet); m.castShadow = m.receiveShadow = true; scene.add(m); }
  for (let b = 0; b <= NB; b++) {
    const u = R0 + b * BW, dE = DF + 1.6, bot = d => yv(d) - 0.25 - 1.35 * (d - dE) / (DB - dE);
    lmBar(G, P(u, DB, 0), P(u, DB, yv(DB)), 0.36, STEEL);
    lmBar(G, P(u, DB, yv(DB)), P(u, DF, yv(DF)), 0.28, STEEL); lmBar(G, P(u, DB, bot(DB)), P(u, dE, bot(dE)), 0.2, STEEL); lmBar(G, P(u, dE, bot(dE)), P(u, DF, yv(DF)), 0.16, STEEL);
    for (let p = 0; p < 6; p++) { const da = DB - (DB - dE) * p / 6, db = DB - (DB - dE) * (p + 1) / 6; lmBar(G, P(u, db, bot(db)), P(u, db, yv(db)), 0.08, STEEL); lmBar(G, P(u, da, bot(da)), P(u, db, yv(db)), 0.08, STEEL); }
  }
  lmBar(G, P(R0, DB, yv(DB) - 0.1), P(R1, DB, yv(DB) - 0.1), 0.3, DARK);
  // the commentators' box: yellow, glazed towards the track, hung from the roof
  { const U0 = 9.0, U1 = 13.4, D0 = 6.0, D1 = 8.8, Y0 = 9.7, Y1 = 11.9, YB = hb('#e6b42a');
    lmBoxL(G, f, U0, U1, Math.min(V(D0), V(D1)), Math.max(V(D0), V(D1)), Y0, Y1, YB, true);
    lmBoxL(G, f, U0 - 0.1, U1 + 0.1, Math.min(V(D0 - 0.1), V(D1 + 0.1)), Math.max(V(D0 - 0.1), V(D1 + 0.1)), Y1, Y1 + 0.12, sh(YB, 0.85), true);
    const [x, z] = lmW(f, (U0 + U1) / 2, V(D0 - 0.02)); spwTile(K, 'stGlassDk', x, z, Y0 + 0.55, toTrack, U1 - U0 - 0.4, 1.25, true);
    for (const u of [U0 + 0.3, U1 - 0.3]) for (const d of [D0 + 0.3, D1 - 0.3]) lmBar(G, P(u, d, Y1 + 0.12), P(u, d, yv(d) + crown(u)), 0.07, DARK); }
  // floodlights under the crowns at the front edge
  for (let b = 1; b < NB; b += 2) { const u = R0 + BW * (b + 0.5), y = yv(DF + 0.45) + RISE - 0.12;
    lmBoxL(G, f, u - 0.45, u + 0.45, Math.min(V(DF + 0.15), V(DF + 0.75)), Math.max(V(DF + 0.15), V(DF + 0.75)), y - 0.38, y, hb('#3e4347'), true);
    polyA(L, [P(u - 0.4, DF + 0.2, y - 0.39), P(u + 0.4, DF + 0.2, y - 0.39), P(u + 0.4, DF + 0.7, y - 0.39), P(u - 0.4, DF + 0.7, y - 0.39)], LENS, 0, -1, 0);
    const [x, z] = lmW(f, u, S.s * 37.5); pools.push([x, z, 10]); }
}
function lmSpeedway(K) {
  const f = SPW.f, G = K.plain, T = spwRings(), n = T.n, P = spwP, W2 = (u, v) => lmW(f, u, v), L = new GB(false), SEATS = [], pools = [];
  const WHITE = hb('#ecebe6'), IRON = hb('#2a2e32');
  LMM.spwLamp = lmStd({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: new THREE.Color(0.86, 0.93, 1), emissiveIntensity: 0 }, 'spw-lamp');
  const spwCol = (a, b) => { const A = W2(a[0], a[1]), B = W2(b[0], b[1]); COL.add(A[0], A[1], B[0], B[1], 0, 0); };
  const ground = (b, mat, order) => { const m = b.mesh(mat); if (m) { m.renderOrder = order; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } };
  const rect = (b, u0, u1, v0, v1, col) => { const k = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => { const w = W2(u, v); return b.vert(w[0], 0, w[1], 0, 1, 0, col); }); b.triUp(k[0], k[1], k[2]); b.triUp(k[0], k[2], k[3]); };

  // ---- the ground: asphalt in front of the stands and in the paddock (the car park south of the stands, OSM way
  // 803378639, is lmParking's, with its cars), paving at the main entrance;
  // the infield lawn mown in stripes across the track; the granite track, darker on the racing line by the inside and
  // lighter where the loose shale is thrown out towards the fence
  const asph = new GB(false), pave = new GB(false), mk = new GB(false), ASPH = hb('#5c5d5f');
  rect(asph, -58.5, 55.2, 43.0, 47.3, ASPH); rect(asph, -57.6, 56.4, -49.05, -43.6, ASPH); rect(asph, -113.2, -93, -23.5, 40.5, ASPH);
  rect(pave, -56.3, 57.2, 61.8, 66.4, hb('#968f84'));
  ground(asph, M_ASPH, -32.9); ground(pave, M_PAVE, -32.85);
  const inW = []; for (const p of T.I) inW.push(...W2(p[0], p[1]));
  { const stripes = `\n      diffuseColor.rgb *= 1.0 + 0.07 * clamp(sin(dot(vWxz, vec2(${f[2].toFixed(5)}, ${f[3].toFixed(5)})) * 0.62832) * 5.0, -1.0, 1.0);`;
    const { flat, tris } = triangulate([inW]), b = new GB(false), c = hb('#58783a'); b.ensure(flat.length / 2);
    for (let i = 0; i < flat.length; i += 2) b.vert(flat[i], 0, flat[i + 1], 0, 1, 0, c); for (let i = 0; i < tris.length; i += 3) b.triUp(tris[i], tris[i + 1], tris[i + 2]);
    ground(b, groundMaterial(detailTex(0), 1 / 5, 0.45, 'spw-lawn', stripes), -32.7); }
  { const cols = [[0, '#8d8170'], [0.06, '#85796a'], [0.2, '#8e8271'], [0.38, '#9b8e7b'], [0.62, '#a59885'], [0.84, '#afa28d'], [0.95, '#b6a991'], [1, '#aa9d87']].map(([t, c]) => [t, hb(c)]), NC = cols.length, b = new GB(false);
    for (let i = 0; i <= n; i++) { const k = i % n, I = T.I[k], N = T.N[k], w = T.W[k], g = 0.96 + 0.05 * Math.sin(k * 0.11) * Math.sin(k * 0.037 + 2);
      for (const [t, c] of cols) { const [x, z] = W2(I[0] + N[0] * w * t, I[1] + N[1] * w * t); b.vert(x, 0, z, 0, 1, 0, sh(c, g)); } }
    for (let i = 0; i < n; i++) for (let j = 0; j < NC - 1; j++) { const a = i * NC + j; b.triUp(a, a + NC, a + 1); b.triUp(a + 1, a + NC, a + NC + 1); }
    ground(b, groundMaterial(detailTex(3), 1 / 1.3, 0.28, 'spw-track'), -32.6); }
  { const out = []; for (const p of T.O) out.push(...W2(p[0], p[1])); const rings = [new Float32Array(out), new Float32Array(inW)]; AREAS.push({ cls: 6, rings, bb: bbox(rings[0]) }); }   // the track on the map

  // ---- the white kerb along the inside
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = T.I[i], b = T.I[j], na = T.N[i], nb = T.N[j], nw = spwN(na[0], na[1]), A = P(a[0], a[1], 0.1), B = P(b[0], b[1], 0.1);
    polyA(G, [A, B, P(b[0] - nb[0] * 0.3, b[1] - nb[1] * 0.3, 0.1), P(a[0] - na[0] * 0.3, a[1] - na[1] * 0.3, 0.1)], WHITE, 0, 1, 0); polyA(G, [P(a[0], a[1], 0), P(b[0], b[1], 0), B, A], sh(WHITE, 0.9), nw[0], 0, nw[1]); }

  // ---- the fence: dark boards on white posts, advertising along the straights, orange air fences in the bends, open
  // gates at the apex of each bend (from the paddock and for the ambulance)
  const FB = hb('#394045'), POST = hb('#e2e2de'), ADS = ['#c42230', '#f0efea', '#1e4f9b', '#f0c21c', '#16804a', '#ea6b1f', '#202124'].map(hb), ORG = hb('#e5602a'), AIRW = hb('#f1ede4');
  const AIR = [[0.02, 0], [0.9, 0.02], [1.0, 0.38], [0.94, 0.86], [0.72, 1.2], [0.36, 1.37], [0.04, 1.4]];
  const gates = SPW_GATES.map(([sg, gv]) => { let best = 0, bd = 1e9; T.O.forEach((p, i) => { if (Math.sign(p[0]) === sg && Math.abs(p[1] - gv) < bd) { bd = Math.abs(p[1] - gv); best = i; } }); return T.O[best]; });
  const inGate = p => gates.some(g => Math.hypot(p[0] - g[0], p[1] - g[1]) < 2.1), airH = s => 1 - 0.16 * Math.pow(1 - Math.abs(Math.sin(Math.PI * s / 5)), 6);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = T.O[i], b = T.O[j], na = T.N[i], nb = T.N[j], seg = Math.hypot(b[0] - a[0], b[1] - a[1]), nw = spwN(na[0], na[1]); s += seg;
    if (inGate(a) || inGate(b)) {
      if (inGate(a) !== inGate(b)) { const h = inGate(a) ? b : a, nh = inGate(a) ? nb : na, e = [h[0] + nh[0] * 2.0, h[1] + nh[1] * 2.0], ew = spwN(-nh[1], nh[0]);   // a leaf swung out
        for (const sg of [1, -1]) polyA(G, [P(h[0], h[1], 0.05), P(e[0], e[1], 0.05), P(e[0], e[1], 1.15), P(h[0], h[1], 1.15)], FB, ew[0] * sg, 0, ew[1] * sg);
        lmBar(G, P(h[0], h[1], 1.2), P(e[0], e[1], 1.2), 0.06, POST); lmBar(G, P(h[0], h[1], 0), P(h[0], h[1], 1.3), 0.12, POST); lmBar(G, P(e[0], e[1], 0), P(e[0], e[1], 1.2), 0.06, POST); }
      continue;
    }
    const front = Math.abs(a[0]) < 57 && Math.abs(a[1]) > 40, bend = Math.abs(a[0]) > 47 && Math.abs(b[0]) > 47;
    const q = (o, y0, y1, col, sg) => polyA(G, [P(a[0] + na[0] * o, a[1] + na[1] * o, y0), P(b[0] + nb[0] * o, b[1] + nb[1] * o, y0), P(b[0] + nb[0] * o, b[1] + nb[1] * o, y1), P(a[0] + na[0] * o, a[1] + na[1] * o, y1)], col, nw[0] * sg, 0, nw[1] * sg);
    if (front) {   // a board of 3.2 m in one colour with a block of another in its middle, like a logo
      const pi = Math.floor(s / 3.2), c = ADS[Math.floor(hash(pi * 31 + 7) * ADS.length)], pos = s - pi * 3.2, h = hash(pi * 17 + 3);
      const logo = c[0] + c[1] + c[2] > 440 ? ADS[[0, 2, 4, 6][Math.floor(h * 4)]] : ADS[h < 0.6 ? 1 : 3];
      if (pos > 0.8 && pos < 2.5) { q(0, 0.05, 0.34, c, -1); q(0, 0.34, 0.86, logo, -1); q(0, 0.86, 1.15, c, -1); } else q(0, 0.05, 1.15, c, -1);
    } else q(0, 0.05, 1.15, FB, -1);
    q(0.04, 0.05, 1.15, sh(FB, 0.85), 1);
    lmBar(G, P(a[0] + na[0] * 0.02, a[1] + na[1] * 0.02, 1.2), P(b[0] + nb[0] * 0.02, b[1] + nb[1] * 0.02, 1.2), 0.07, POST);
    if (Math.floor(s / 2.5) !== Math.floor((s - seg) / 2.5)) lmBar(G, P(a[0] + na[0] * 0.09, a[1] + na[1] * 0.09, 0), P(a[0] + na[0] * 0.09, a[1] + na[1] * 0.09, 1.25), 0.09, POST);
    if (bend) {
      const hA = airH(s - seg), hB = airH(s), sec = Math.floor(s / 5) % 2, pa = (o, y) => P(a[0] - na[0] * o, a[1] - na[1] * o, y * hA), pb = (o, y) => P(b[0] - nb[0] * o, b[1] - nb[1] * o, y * hB);
      for (let k = 0; k < AIR.length - 1; k++) { const [a0, y0] = AIR[k], [a1, y1] = AIR[k + 1], am = (a0 + a1) / 2 - 0.5, ym = (y0 + y1) / 2 - 0.6;
        polyA(G, [pa(a0, y0), pb(a0, y0), pb(a1, y1), pa(a1, y1)], k === 2 && sec ? AIRW : sh(ORG, 0.9 + 0.1 * k / 6), -nw[0] * am, ym, -nw[1] * am); }
      spwCol([a[0] - na[0], a[1] - na[1]], [b[0] - nb[0], b[1] - nb[1]]);
    } else spwCol(a, b);
  }

  // ---- the start: the line and the four gates in chalk, the tapes between a post on the infield and one by the fence,
  // chequered boards on the fence and on the infield
  { let k0 = 0, bd = 1e9; T.I.forEach((p, i) => { if (p[1] > 0 && Math.abs(p[0] - SPW_START) < bd) { bd = Math.abs(p[0] - SPW_START); k0 = i; } });
    const U = SPW_START, vi = T.I[k0][1], vo = vi + T.W[k0], RED = hb('#c62a2a');
    rect(mk, U - 0.06, U + 0.06, vi, vo, WHITE); rect(mk, U - 1.66, U - 1.54, vi, vo, WHITE);
    for (let g = 1; g < 4; g++) { const v = vi + (vo - vi) * g / 4; rect(mk, U - 1.6, U, v - 0.04, v + 0.04, WHITE); }
    for (const [v0, v1] of [[vi - 0.75, vi - 0.35], [vo - 0.55, vo - 0.15]]) { lmBoxL(G, f, U - 0.2, U + 0.2, v0, v1, 0, 1.25, WHITE); lmBoxL(G, f, U - 0.21, U + 0.21, v0 - 0.01, v1 + 0.01, 0.6, 0.85, RED); lmBoxL(G, f, U - 0.28, U + 0.28, v0 - 0.08, v1 + 0.08, 1.25, 1.4, hb('#3b3f44')); }
    for (const y of [0.55, 0.8, 1.05]) lmBar(G, P(U, vi - 0.35, y), P(U, vo - 0.55, y), 0.03, WHITE);
    const chequer = (v, face, y0, w, h, nc, nr) => { const nw = spwN(0, face); for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) { const ua = U + 0.6 - w / 2 + w * i / nc, ub = ua + w / nc, ya = y0 + h * j / nr, yb = ya + h / nr;
      polyA(G, [P(ua, v, ya), P(ub, v, ya), P(ub, v, yb), P(ua, v, yb)], (i + j) % 2 ? hb('#151618') : hb('#f4f4f0'), nw[0], 0, nw[1]); } };
    chequer(vo - 0.03, -1, 0.15, 1.2, 0.9, 6, 4);
    lmBar(G, P(U + 0.6, vi - 1.32, 0), P(U + 0.6, vi - 1.32, 1.65), 0.08, WHITE); lmBoxL(G, f, U + 0.2, U + 1.0, vi - 1.3, vi - 1.26, 0.95, 1.55, hb('#6d7276')); chequer(vi - 1.25, 1, 0.95, 0.8, 0.6, 4, 3); }
  ground(mk, M_MARK, -32.3);

  // ---- the lighting masts: grey poles with two arms, a lamp on each, turned to the track
  const MAST = hb('#8f9598'), LENS = hb('#fbfbf6'), HOUSE = hb('#4d5256');
  for (const [mu, mv] of SPW_MASTS) {
    const cu = Math.max(-SPW.seg, Math.min(SPW.seg, mu)), nl = Math.hypot(mu - cu, mv) || 1, out = spwN((mu - cu) / nl, mv / nl), tan = [-out[1], out[0]], [x, z] = W2(mu, mv);
    lmBoxL(K.stone, [x, z, f[2], f[3]], -0.45, 0.45, -0.45, 0.45, 0, 0.3, hb('#9a9893'), false);
    lmLathe(G, x, z, 0.3, [[0.2, 0], [0.17, 1.0], [0.11, 13.9], [0.09, 14.5]], 10, MAST);
    for (const sg of [-1, 1]) {
      const B = [x + tan[0] * sg * 1.3 - out[0] * 0.5, 14.9, z + tan[1] * sg * 1.3 - out[1] * 0.5], Cc = [x + tan[0] * sg * 2.5 - out[0] * 1.1, 15.15, z + tan[1] * sg * 2.5 - out[1] * 1.1];
      lmBar(G, [x, 14.0, z], B, 0.11, MAST); lmBar(G, B, Cc, 0.1, MAST);
      const h0 = [Cc[0] + out[0] * 0.1, Cc[1], Cc[2] + out[1] * 0.1], h1 = [Cc[0] - out[0] * 0.75, Cc[1] - 0.08, Cc[2] - out[1] * 0.75]; lmBar(G, h0, h1, 0.4, HOUSE);
      const c = (o, t) => [Cc[0] - out[0] * o + tan[0] * t, Cc[1] - 0.21 - 0.08 * o, Cc[2] - out[1] * o + tan[1] * t];
      polyA(L, [c(0.05, -0.17), c(0.05, 0.17), c(0.7, 0.17), c(0.7, -0.17)], LENS, -out[0] * 0.2, -1, -out[1] * 0.2);
    }
    pools.push([x - out[0] * 8, z - out[1] * 8, 13]); COL.add(x, z, x + 0.01, z, 0.2, 0);
  }

  // ---- the pit shelter by the paddock: ten boxes under blue gabled roofs, open to the track, a bench in each
  { const S = SPW_PITS, bw = (S.v1 - S.v0) / S.n, WALLW = hb('#e4e3dc'), BLUE = hb('#2c58a6'), ex = spwN(1, 0), ev = spwN(0, 1), E = 2.5, R = 3.2;
    lmBoxL(G, f, S.u0, S.u1 + 0.4, S.v0, S.v1, 0, 0.08, hb('#a3a19a'), false); lmBoxL(G, f, S.u0 - 0.25, S.u0, S.v0, S.v1, 0, 2.45, WALLW);
    for (let b = 0; b <= S.n; b++) { const v = S.v0 + b * bw; lmBoxL(G, f, S.u0, S.u1 - 0.5, v - 0.05, v + 0.05, 0.08, 2.45, WALLW); lmBoxL(G, f, S.u1 - 0.18, S.u1, v - 0.08, v + 0.08, 0, E, hb('#f4f4f0')); }
    for (let b = 0; b < S.n; b++) {
      const va = S.v0 + b * bw, vb = va + bw, vm = (va + vb) / 2, ua = S.u0 - 0.35, ub = S.u1 + 0.3;
      for (const [vv, sg] of [[va - 0.05, -1], [vb + 0.05, 1]]) { const Q = [P(ua, vv, E), P(ub, vv, E), P(ub, vm, R), P(ua, vm, R)]; polyA(G, Q, sh(BLUE, sg > 0 ? 1.06 : 1), ev[0] * sg, 1.5, ev[1] * sg); polyA(G, Q, sh(BLUE, 0.7), 0, -1, 0); }
      for (const [uu, sg] of [[S.u1 + 0.02, 1], [S.u0 - 0.27, -1]]) polyA(G, [P(uu, va, E), P(uu, vb, E), P(uu, vm, R - 0.04)], hb('#f4f4f0'), ex[0] * sg, 0, ex[1] * sg);
      lmBoxL(G, f, S.u0 + 0.05, S.u0 + 0.75, va + 0.5, vb - 0.5, 0.08, 0.9, hb('#7c8186'));
      if (b % 3 === 1) lmBoxL(G, f, S.u0 + 0.1, S.u0 + 0.7, vb - 1.2, vb - 0.6, 0.9, 1.5, hb('#b0302c'));
    }
    spwCol([S.u0 - 0.25, S.v0], [S.u0 - 0.25, S.v1]); lmRegisterOutline(f, [[S.u0, S.v0], [S.u1, S.v0], [S.u1, S.v1], [S.u0, S.v1]], 12, false); }

  // ---- the stands, the roof over stand A, the seats
  for (const S of SPW_STANDS) spwStand(K, S, SEATS);
  spwRoof(K, SPW_STANDS[0], L, pools);
  { const sg = new GB(false), I0 = [0, 0, 1, 0];
    lmBoxL(sg, I0, -0.22, 0.22, 0.1, 0.5, 0.34, 0.43, LMWHITE, true); lmBoxL(sg, I0, -0.22, 0.22, 0.03, 0.09, 0.43, 0.84, LMWHITE, true);
    const geo = sg.mesh(matPlain).geometry, cnt = SEATS.length / 5, mat = lmStd({ roughness: 0.45, metalness: 0 }, 'spw-seat'), im = new THREE.InstancedMesh(geo, mat, cnt);
    const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), V3 = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), UPY = new THREE.Vector3(0, 1, 0), C3 = new THREE.Color(), BLUE = lin('#2b4f9e'), YEL = lin('#e1b52b');
    for (let i = 0; i < cnt; i++) { Q4.setFromAxisAngle(UPY, SEATS[5 * i + 3]); M4.compose(V3.set(SEATS[5 * i], SEATS[5 * i + 1], SEATS[5 * i + 2]), Q4, S1); im.setMatrixAt(i, M4);
      im.setColorAt(i, C3.copy(SEATS[5 * i + 4] ? YEL : BLUE).multiplyScalar(0.88 + hash(i * 13 + 5) * 0.18)); }
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.frustumCulled = false; im.receiveShadow = true; scene.add(im); }

  // ---- the lamps: lenses that glow in the evening and at night, pools of light on the track
  { const m = L.mesh(LMM.spwLamp); if (m) scene.add(m); }
  { const pos = [], uv = [], idx = []; for (const [x, z, h] of pools) { const k = pos.length / 3; pos.push(x - h, 0.07, z - h, x + h, 0.07, z - h, x + h, 0.07, z + h, x - h, 0.07, z + h); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(k, k + 2, k + 1, k, k + 3, k + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(0.7, 0.78, 0.95), transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.renderOrder = 5; m.frustumCulled = false; m.visible = false; scene.add(m); SPW.pools = m; }
}

export { SPW, lmSpeedway, spwCap, spwDrops, spwFlag, spwGround, spwNoTree, spwTrackLine };
