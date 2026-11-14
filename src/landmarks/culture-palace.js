import { STATE } from '../core/state.js';
import { fortCar } from '../fortress/arsenals.js';
import { lmRegisterOutline } from './tv-tower.js';
import { lmAlong, lmEdgeBox, lmFlag, lmFoot, lmLen, lmPipL } from './university.js';
import { lmBar, lmBlock, lmBoxL, lmBoxW, lmLathe, lmLit, lmOp, lmWF } from './helpers.js';
import { LMT, lr } from './tiles.js';
import { LMF, LMWHITE, lmW } from './core.js';
import { M_ASPH, M_PAVE } from '../world/data.js';
import { TERR, subTris, terrainH } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { GB, polyA } from '../core/geometry.js';
import { area2, hb, reversed, sh, triangulate } from '../core/util.js';

/* ---- the square in front: paving, flower beds, candelabra, benches ---- */
const sphereProf = r => { const p = []; for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + k * Math.PI / 8; p.push([Math.abs(Math.cos(a)) * r, r + Math.sin(a) * r]); } return p; };
/* ---- Daugavpils Palace of Culture (Daugavpils Kultūras pils), Smilšu iela 92 ----
   The city's largest hall, 1060 seats, with foyers on two floors; in the upper foyer the largest stained glass in
   Latvia, "Uguns un nakts" by Egons Cēsnieks and Andris Purviņš (1971). The tram stop in front keeps the old name,
   Kultūras un sporta pils: a sports hall is built onto the north end. Renovated in 2019 (REM PRO): insulated and clad
   in light fibre-cement panels, new windows and doors. OpenStreetMap maps the outline (way 115667998) with the sports
   hall and the entrance canopy as building:part ways, so citydata.js had only those two parts. The plan is the OSM
   outline; massing and façades follow photographs (visitdaugavpils.lv, dkp.lv, the drone views of rem.lv): towards the
   car park a 96.5 m front of sixteen bays between square piers under a deep fascia, the foyer glazing set back between
   them in three rows with vertical fins in the middle one, the canopy over the main doors and the ticket office
   (KASES); a three-storey block at the south end with the fly tower behind it, a seven-storey wing beside the stage on
   the east side, the auditorium under a stepped roof; the sports hall on a dark plinth with a clerestory under the
   eaves. Frame kp: origin at the south-west corner, u north along the front, v east into the building. */
const KP = { L: 96.5, W: 35.2, H: 12.5, FAS: 10.2, PW: 1.4, N: 16, D: 0.85, ENT: 11, KAS: 8 };
const kpPier = k => KP.PW / 2 + k * (KP.L - KP.PW) / KP.N;   // centre lines of the piers along the front
// a tile of the detail atlas on the plane d behind the wall F, between s0..s1 and y0..y1
function lmPane(K, F, s0, s1, y0, y1, d, tile, lit) {
  const t = LMT[tile], a = F.at;
  K.det.q(a(s0, y0, d), a(s1, y0, d), a(s1, y1, d), a(s0, y1, d), [F.nx, 0, F.nz], [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, lit ? 1 : 0);
}
function lmKP(K) {
  const f = LMF.kp, G = K.plain, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const PAN = hb('#e2dccf'), PAN2 = hb('#dad5ca'), LIGHT = hb('#ebe7de'), BASE = hb('#8b8c89'), SLATE = hb('#4d5155'), CAP = hb('#55585c'), ROOF = hb('#4b4d50'), GRIT = hb('#a3a19b'), PLANT = hb('#cfd2d4');
  const st = { tex: 5, col: PAN, plinth: 0.3, pcol: BASE }, st2 = { tex: 5, col: PAN2 }, sport = { tex: 5, col: PAN, plinth: 3.0, pcol: SLATE };
  const coping = top => [[top - 0.12, top + 0.04, 0.06, CAP]], win = () => ({ d: 0.18, lit: lmLit(0.35) });
  const OUT = [[0, 0], [KP.L, 0], [KP.L, 39.7], [127.8, 39.7], [127.8, 66.2], [90.5, 66.2], [90.5, 63.5], [78.3, 63.5], [78.3, KP.W], [31.4, KP.W], [31.4, 44.1], [12.9, 44.1], [12.9, KP.W], [0, KP.W]];
  // the ground falls by under a metre across the site: the building stands level, its walls reach down to the ground
  if (TERR.on) { let lo = 1e9, hi = -1e9; for (const [u, v] of OUT) { const [x, z] = lmW(f, u, v), t = terrainH(x, z); lo = Math.min(lo, t); hi = Math.max(hi, t); }
    const base = Math.min(hi - 0.15, lo + 2.5); STATE.GBC = (x, y, z) => { const t = terrainH(x, z); return y <= 0.05 ? Math.min(base, t) - 0.25 - t - y : base - t; }; }
  // main block: the front's bays are deep openings between the piers, the doors under the canopy deeper still
  const ops = [];
  for (let k = 0; k < KP.N; k++) { const s0 = kpPier(k) + KP.PW / 2, s1 = kpPier(k + 1) - KP.PW / 2, m = (s0 + s1) / 2;
    if (k === KP.ENT) { lmOp(ops, m, 0, s1 - s0, 0, 3.35, null, { d: 2.4 }); lmOp(ops, m, 0, s1 - s0, 3.35, KP.FAS, null, { d: KP.D }); }
    else lmOp(ops, m, 0, s1 - s0, 0, KP.FAS, null, { d: KP.D }); }
  // the south end: three floors of offices and rehearsal rooms over a door with steps
  for (const [v, w] of [[7.3, 1.2], [9.6, 2.4], [13.3, 1.2], [15.4, 1.2], [19.2, 1.2], [21.3, 1.2], [25.2, 1.2], [27.2, 1.2], [30.1, 1.2]])
    for (const [r, sl] of [1.0, 4.7, 8.3].entries()) if (r || v !== 9.6) lmOp(ops, 0, v, w, sl, sl + 1.5, w > 2 ? 'kpWin2' : 'kpWin', win());
  lmOp(ops, 0, 9.6, 2.0, 0, 2.6, 'kpSDoor', { d: 0.2, lit: lmLit(0.5) });
  // the east side towards the tennis courts, a service door by the shed
  for (const u of [3.5, 7.0, 10.5]) for (const sl of [1.0, 4.7, 8.3]) lmOp(ops, u, KP.W, 1.2, sl, sl + 1.5, 'kpWin', win());
  for (let k = 0; k < 13; k++) { const u = 33.6 + k * 3.6; for (const sl of [1.0, 4.7, 8.3]) if (sl > 1 || k !== 5) lmOp(ops, u, KP.W, 1.2, sl, sl + 1.5, 'kpWin', win()); }
  lmOp(ops, 51.6, KP.W, 1.2, 0, 2.2, 'kpSteel', { d: 0.1 });
  // the north end: tall slit windows of the stair hall, the multimedia hall's windows below
  for (let k = 0; k < 6; k++) lmOp(ops, KP.L, 4.4 + k * 2.2, 0.7, 6.0, 9.2, 'kpSlot', { d: 0.2, lit: lmLit(0.5) });
  for (const v of [5.5, 11.0, 16.5]) lmOp(ops, KP.L, v, 2.4, 1.2, 2.7, 'kpWin2', win());
  lmBlock(K, f, { poly: [[0, 0], [KP.L, 0], [KP.L, KP.W], [0, KP.W]], top: KP.H, st, cornice: coping(KP.H), roof: ROOF, roofY: KP.H }, ops);
  // inside each bay: ground-floor glazing over a dark base, two bands, the middle windows with two fins, the upper foyer
  const F = lmWF(lmW(f, 0, 0), lmW(f, KP.L, 0)), D = KP.D;
  for (let k = 0; k < KP.N; k++) {
    const s0 = kpPier(k) + KP.PW / 2, s1 = kpPier(k + 1) - KP.PW / 2, w = (s1 - s0) / 3, lit = lmLit(0.6), ent = k === KP.ENT;
    for (let j = 0; j < 3; j++) { const a = s0 + j * w, b = a + w, kas = k === KP.KAS && j === 1;
      if (ent) lmPane(K, F, a, b, 0, 3.35, 2.4, 'kpDoor', true); else lmPane(K, F, a, b, 0.15, 3.35, D, kas ? 'kpKases' : 'kpLow', lit || kas);
      lmPane(K, F, a, b, 4.25, 6.85, D, 'kpMid', lit); lmPane(K, F, a, b, 7.55, KP.FAS, D, 'kpTop', lit); }
    if (!ent) lmBoxW(G, F, s0, s1, 0, 0.15, D - 0.2, D, BASE, false);
    lmBoxW(G, F, s0, s1, 3.35, 4.25, 0.45, D, LIGHT, !ent); lmBoxW(G, F, s0, s1, 6.85, 7.55, 0.5, D, LIGHT);
    for (const j of [1, 2]) { const s = s0 + j * w; lmBoxW(G, F, s - 0.08, s + 0.08, 3.35, 7.55, 0.15, D, LIGHT, false); }
  }
  // the canopy over the main doors: a thick slab with a grit-finished edge, light soffit with downlights
  { const c = (kpPier(KP.ENT) + kpPier(KP.ENT + 1)) / 2, u0 = c - 5.25, u1 = c + 5.25, y0 = 3.75, y1 = 4.4;
    lmBoxL(G, f, u0, u1, -4.7, 0, y0, y1, GRIT);
    polyA(G, [at(u0 + 0.12, -4.58, y1 + 0.01), at(u1 - 0.12, -4.58, y1 + 0.01), at(u1 - 0.12, 0, y1 + 0.01), at(u0 + 0.12, 0, y1 + 0.01)], ROOF, 0, 1, 0);
    polyA(G, [at(u0 + 0.1, -4.6, y0 - 0.01), at(u1 - 0.1, -4.6, y0 - 0.01), at(u1 - 0.1, 0, y0 - 0.01), at(u0 + 0.1, 0, y0 - 0.01)], hb('#d9d7d1'), 0, -1, 0);
    const t = LMT.latLight; for (let i = 0; i < 6; i++) for (const v of [-3.3, -1.4]) { const u = u0 + 1.0 + i * (u1 - u0 - 2.0) / 5, h = 0.11, y = y0 - 0.02;
      K.det.q(at(u - h, v - h, y), at(u + h, v - h, y), at(u + h, v + h, y), at(u - h, v + h, y), [0, -1, 0], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, 1); } }
  // over the roof: the fly tower with a glazed smoke lantern and a taller shaft at its corner, its lower north part,
  // the auditorium in two steps, the seven-storey wing beside the stage
  const up = (poly, y0, top, o = []) => lmBlock(K, f, { poly, y0, top, st: st2, cornice: coping(top), roof: ROOF, roofY: top }, o);
  { const o = []; lmOp(o, 10, 33.4, 1.1, KP.H, KP.H + 2.2, 'kpSteel', { d: 0.1 }); up([[10, 12], [28, 12], [28, KP.W], [10, KP.W]], KP.H, 25.0, o); }
  up([[28, 12], [41, 12], [41, KP.W], [28, KP.W]], KP.H, 23.5);
  up([[10, 12], [13.8, 12], [13.8, 15.8], [10, 15.8]], 25.0, 27.6);
  up([[41, 9], [60, 9], [60, 32.5], [41, 32.5]], KP.H, 16.8);
  up([[60, 9], [79, 9], [79, 30.5], [60, 30.5]], KP.H, 15.2);
  { const u0 = 14.5, u1 = 23.5, v0 = 18, v1 = 30, y0 = 25.0, y1 = 25.8, yr = 27.0, vm = (v0 + v1) / 2, GL = hb('#91a6b1'), ev = [-f[3], f[2]], k = 1.2 / Math.hypot(1.2, 6);
    lmBoxL(G, f, u0, u1, v0, v1, y0, y1, PAN2, false);
    polyA(G, [at(u0, v0, y1), at(u1, v0, y1), at(u1, vm, yr), at(u0, vm, yr)], GL, -ev[0] * k, 0.98, -ev[1] * k);
    polyA(G, [at(u1, v1, y1), at(u0, v1, y1), at(u0, vm, yr), at(u1, vm, yr)], sh(GL, 1.06), ev[0] * k, 0.98, ev[1] * k);
    polyA(G, [at(u0, v0, y1), at(u0, v1, y1), at(u0, vm, yr)], PAN2, -f[2], 0, -f[3]); polyA(G, [at(u1, v1, y1), at(u1, v0, y1), at(u1, vm, yr)], PAN2, f[2], 0, f[3]);
    for (let i = 1; i < 6; i++) { const u = u0 + i * (u1 - u0) / 6; lmBar(G, at(u, v0, y1 + 0.02), at(u, vm, yr + 0.02), 0.06, hb('#5d6166')); lmBar(G, at(u, v1, y1 + 0.02), at(u, vm, yr + 0.02), 0.06, hb('#5d6166')); } }
  for (const [u0, u1, v0, v1, y0, y1] of [[23.8, 27.2, 13.4, 16.6, 25.0, 26.3], [36, 40, 13, 16, 23.5, 24.6], [30.5, 33, 13, 15.4, 23.5, 24.3], [49.5, 52.5, 20, 23, 16.8, 18.0], [80, 86, 14, 22, KP.H, 14.3], [66, 72, 13, 17, 15.2, 16.4]])
    lmBoxL(G, f, u0, u1, v0, v1, y0, y1, hb('#c3c6c8'), false);
  for (const [u, v] of [[4, 4], [5, 30], [45, 4], [58, 5], [88, 6], [88, 28], [62, 34]]) lmBoxL(G, f, u - 0.35, u + 0.35, v - 0.35, v + 0.35, KP.H, KP.H + 0.55, hb('#a9acae'), false);
  { const o = [];
    for (let fl = 0; fl < 7; fl++) { const sl = 1.1 + fl * 3.3; for (const u of [15.0, 29.3]) if (fl || u < 20) lmOp(o, u, 44.1, 1.2, sl, sl + 1.5, 'kpWin', win()); if (fl > 1) lmOp(o, 31.4, 40.2, 1.2, sl, sl + 1.5, 'kpWin', win()); }
    lmOp(o, 22.2, 44.1, 3.6, 0, 4.0, 'kpRoll', { d: 0.15 }); lmOp(o, 12.9, 40.2, 1.1, 0, 2.2, 'kpSteel', { d: 0.1 });
    lmBlock(K, f, { poly: [[12.9, KP.W], [31.4, KP.W], [31.4, 44.1], [12.9, 44.1]], top: 24.0, st: st2, cornice: coping(24.0), roof: ROOF, roofY: 24.0, wy0: lmFoot([[[12.9, KP.W], [31.4, KP.W], 99]]) }, o); }
  // the north-east wing between the hall and the sports hall
  { const o = []; for (const sl of [1.0, 4.7, 8.3]) { for (let k = 0; k < 7; k++) lmOp(o, 78.3, 38.6 + k * 3.6, 1.2, sl, sl + 1.5, 'kpWin', win()); for (let k = 0; k < 3; k++) lmOp(o, 80.8 + k * 3.7, 63.5, 1.2, sl, sl + 1.5, 'kpWin', win()); }
    lmBlock(K, f, { poly: [[78.3, KP.W], [KP.L, KP.W], [KP.L, 39.7], [90.5, 39.7], [90.5, 63.5], [78.3, 63.5]], top: KP.H, st, cornice: coping(KP.H), roof: ROOF, roofY: KP.H,
      wy0: lmFoot([[[78.3, KP.W], [KP.L, KP.W], 99], [[KP.L, 39.7], [90.5, 39.7], 11.0], [[90.5, 39.7], [90.5, 63.5], 11.0]]) }, o); }
  // the sports hall: dark plinth, clerestory windows between light fins, its door under a dark canopy in the corner
  { const o = [], SP = [[90.5, 39.7], [127.8, 39.7], [127.8, 66.2], [90.5, 66.2]], IN = [110, 52], fins = [];
    for (const [a, b] of [[[96.6, 39.7], [127.8, 39.7]], [[127.8, 39.7], [127.8, 66.2]], [[127.8, 66.2], [90.5, 66.2]]]) {
      const L = lmLen(a, b), n = Math.floor((L - 1) / 3.1), s0 = (L - n * 3.1) / 2;
      for (let k = 0; k < n; k++) { const p = lmAlong(a, b, s0 + (k + 0.5) * 3.1); lmOp(o, p[0], p[1], 2.0, 7.4, 9.4, 'kpClere', { d: 0.25, lit: lmLit(0.5) }); }
      for (let k = 0; k <= n; k++) fins.push([a, b, s0 + k * 3.1]); }
    lmOp(o, 100.2, 39.7, 2.6, 0, 2.7, 'kpSDoor', { d: 0.2, lit: true }); lmOp(o, 102.6, 39.7, 1.3, 1.5, 2.5, 'kpPlate', { d: 0.02 });
    lmBlock(K, f, { poly: SP, top: 11.0, st: sport, cornice: coping(11.0), roof: ROOF, roofY: 11.0 }, o);
    for (const [a, b, s] of fins) lmEdgeBox(G, f, a, b, IN, s - 0.16, s + 0.16, 7.1, 9.8, 0, 0.5, LIGHT);
    lmBoxL(G, f, 98.0, 105.4, 36.3, 39.7, 2.85, 3.45, SLATE); }
  // a one-storey shed behind the hall
  { const o = []; lmOp(o, 53.75, 44.8, 1.1, 0, 2.2, 'kpSteel', { d: 0.05 });
    lmBlock(K, f, { poly: [[51.1, 44.8], [56.4, 44.8], [56.4, 49.2], [51.1, 49.2]], top: 3.2, st: { tex: 5, col: PAN2, plinth: 0.3, pcol: BASE }, cornice: coping(3.2), roof: ROOF, roofY: 3.2 }, o); }
  // in front: three flagpoles by the canopy, round concrete planters along the front
  for (const [k, u] of [76.2, 79.4, 82.6].entries()) { const [x, z] = lmW(f, u, -6.5);
    if (k === 1) lmFlag(G, x, z, 0, 10.5, [f[2], f[3]], 2.2); else { lmBar(G, [x, 0, z], [x, 10.5, z], 0.1, PLANT); lmLathe(G, x, z, 10.5, [[0.06, 0], [0.08, 0.05], [0, 0.14]], 8, PLANT); } }
  for (const u of [50.5, 56.0, 61.5, 85.0, 90.0]) { const [x, z] = lmW(f, u, -5.2);
    lmLathe(G, x, z, 0, [[0.4, 0], [0.62, 0.1], [0.82, 0.5], [0.74, 0.55], [0.7, 0.48]], 14, hb('#b3b0a8')); lmLathe(G, x, z, 0, [[0.7, 0.48], [0.5, 0.78], [0, 0.88]], 10, hb('#4f6b34')); }
  lmRegisterOutline(f, OUT);
  STATE.GBC = null;
  // on the ground, draped over the terrain: the car park towards Smilšu iela (OSM way 366845896; the city data has no
  // car parks), the paved forecourt of the main doors, and the earth-covered reservoir at Smilšu iela 92A, which the
  // cadastre files under reservoirs and bunkers
  const ground = (pts, mat, col, order) => {
    let r = []; for (const [x, z] of pts) r.push(x, z); r = new Float32Array(r); if (area2(r) < 0) r = reversed(r);
    const t0 = triangulate([r]), { flat, tris } = TERR.on ? subTris(t0.flat, t0.tris, 0.25) : t0, b = new GB(false); b.ensure(flat.length / 2); const v = b.v;
    for (let i = 0; i < flat.length; i += 2) b.vert(flat[i], 0, flat[i + 1], 0, 1, 0, col);
    for (let i = 0; i < tris.length; i += 3) b.triUp(v + tris[i], v + tris[i + 1], v + tris[i + 2]);
    const m = b.mesh(mat); if (m) { m.renderOrder = order; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } };
  ground([[841.6, -541.2], [845.9, -505.1], [850.4, -506], [853, -492.9], [888.1, -505.1], [877.4, -535], [877.6, -537.1], [883.7, -539.5], [880.3, -548.8], [875.3, -547], [873.7, -547.7], [863, -544], [861.4, -548.6]], M_ASPH, hb('#5a5b5c'), -34.4);
  ground([[57, -15], [84, -15], [84, 0], [57, 0]].map(([u, v]) => lmW(f, u, v)), M_PAVE, hb('#a39e95'), -36.9);
  // cars in the car park: rows on both sides of the mapped aisles and of two more between them, three in four stalls taken
  { const PK = [[98.3, -50.8], [62.8, -58.8], [62.2, -54.3], [49, -56.2], [48.7, -19], [80.5, -19.1], [82.4, -18.2], [82.6, -11.7], [92.5, -11.8], [92.5, -17.1], [93.7, -18.4], [93.8, -29.7], [98.7, -29.7]];
    const COLS = ['#e8e8e6', '#1d1f22', '#8d9196', '#5b6067', '#7a1f22', '#1f3f6e', '#c9c6bd', '#2f4a35', '#b8bcc0', '#3a3d42'];
    const car = (u, v, along) => { if (!lmPipL([u, v], PK) || lr() > 0.75) return; const [x, z] = lmW(f, u, v), s = lr() < 0.5 ? 1 : -1, d = along ? [f[2] * s, f[3] * s] : [-f[3] * s, f[2] * s];
      fortCar(G, x, z, d[0], d[1], hb(COLS[Math.floor(lr() * COLS.length)]), false); };
    for (const v of [-16.6, -27.4, -32.6, -43.4, -48.6]) for (let u = 65; u < 98; u += 2.6) car(u, v, false);
    for (const u of [50.6, 61.4]) for (let v = -25; v > -56; v -= 2.6) car(u, v, true); }
  { const B = [[-39, 110.7], [-37.9, 76.1], [-10, 77], [-11.1, 111.6]], cu = -24.5, cv = 93.85, T = B.map(([u, v]) => [cu + (u - cu) * 0.72, cv + (v - cv) * 0.8]), GR = hb('#7f9b52');
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, P = [at(...B[i], 0), at(...B[j], 0), at(...T[j], 2.2), at(...T[i], 2.2)];
      const a = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], c = [P[3][0] - P[0][0], P[3][1] - P[0][1], P[3][2] - P[0][2]];
      let n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]]; const l = Math.hypot(...n) * (n[1] < 0 ? -1 : 1); n = n.map(x => x / l);
      polyA(G, P, sh(GR, 0.94 + 0.04 * i), n[0], n[1], n[2]); }
    polyA(G, T.map(([u, v]) => at(u, v, 2.2)), GR, 0, 1, 0);
    lmBoxL(G, f, -26, -23.6, 91, 93.4, 2.0, 2.9, hb('#9c9a94'), false); lmBoxL(G, f, -16, -15.2, 100, 100.8, 2.0, 3.4, hb('#8e9194'), false); }
}

export { lmKP, sphereProf };
