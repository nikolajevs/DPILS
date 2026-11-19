import { STATE } from '../core/state.js';
import { lmBar, lmBoxL } from './helpers.js';
import { polyA } from '../core/geometry.js';
import { terrainH } from '../world/terrain.js';
import { RB, rbLocal } from '../world/bridge-railway.js';
import { RP } from '../world/underpass-rail.js';
import { COL } from '../world/data.js';
import { hb, sh } from '../core/util.js';

/* ---- Dzelzceļa tilts over the Daugava (data and sources: src/world/bridge-railway.js) ----
   Heights: y = 0 is the top of the rails, level from end to end at RB.H (the ground at both ends is shaped to it,
   src/world/underpass-rail.js). Everything is drawn in the frame of the deck except the feet of the piers and walls,
   given as y < −50: those stand y + 100 m off the ground under them (DEEP: 2 m into it).
   - South-west end: the steel girder span over Lielā iela (two plate girders, dark grey, railings on both edges, the
     clearance sign "4,8" with a striped board on both faces over the road), resting on the abutment of large rough
     blocks with its wing along the road and on the pier that carries the first truss too. A red and white booth on the
     embankment.
   - Three through trusses, light grey: parallel chords 12.5 m apart, panels of about 11 m with a vertical at each end
     and two diagonals crossing at mid-height (the rhombi of the photographs), floor beams under the deck at the
     verticals, walkways of planks inside the trusses, top bracing, sway frames and heavier portals at the ends.
   - River piers of ashlar with pointed cutwaters, a dressed cap; the north-east abutment, U-shaped, at the head of the
     embankment with a second booth behind it. */
const DEEP = -102;
const STONE = hb('#aaa395'), CAP = hb('#bdb7a9'), STEEL = hb('#b6bcbf'), DARK = hb('#4b5054'), PLANK = hb('#7b746a'), RAIL = hb('#b9bec1');

function lmRailBridge(K) {
  const G = K.plain, W = K.walls[0], { A, T, N, BEAR, PANELS, TH, TW } = RB;
  const H = RB.H != null ? RB.H : terrainH(A[0], A[1]);
  STATE.GBC = (x, y, z) => y < -50 ? 100 : H - terrainH(x, z);
  const P = (s, d, y) => [A[0] + T[0] * s + N[0] * d, y, A[1] + T[1] * s + N[1] * d];
  const gnd = (s, d) => { const q = P(s, d, 0); return terrainH(q[0], q[2]) - H; };   // the ground in the frame of the deck
  const f = [A[0], A[1], T[0], T[1]];
  const box = (s0, s1, d0, d1, y0, y1, col, bottom = true) => lmBoxL(G, f, s0, s1, d0, d1, y0, y1, col, bottom);
  const bar = (s0, d0, y0, s1, d1, y1, w, col) => lmBar(G, P(s0, d0, y0), P(s1, d1, y1), w, col);
  const nrm = (ns, nd) => [T[0] * ns + N[0] * nd, 0, T[1] * ns + N[1] * nd];
  /* a face of rough blocks from (s0, d0) to (s1, d1), outward normal (ns, nd) in the frame, from 2 m under the ground
     up to y1; cut every 2 m so that its foot follows the ground. Blocks of 1.25 × 0.62 m (the ashlar texture scaled). */
  const BLK = 6 / 2.5;
  const ashFace = (s0, d0, s1, d1, ns, nd, y1, col = STONE) => {
    const L = Math.hypot(s1 - s0, d1 - d0), m = Math.max(1, Math.ceil(L / 2)), n = nrm(ns, nd);
    for (let k = 0; k < m; k++) {
      const a = k / m, b = (k + 1) / m, sa = s0 + (s1 - s0) * a, da = d0 + (d1 - d0) * a, sb = s0 + (s1 - s0) * b, dbb = d0 + (d1 - d0) * b;
      const ya = gnd(sa, da) - 2, yb = gnd(sb, dbb) - 2, ua = L * a / BLK, ub = L * b / BLK;
      if (y1 <= Math.max(ya, yb)) continue;
      W.q(P(sa, da, DEEP), P(sb, dbb, DEEP), P(sb, dbb, y1), P(sa, da, y1), n, [ua, ya / BLK, ub, yb / BLK, ub, y1 / BLK, ua, y1 / BLK], col);
    }
  };
  // a block of masonry: four faces of blocks, a dressed cap course 0.3 m thick projecting 0.15 m
  const mass = (s0, s1, d0, d1, top, faces = [1, 1, 1, 1]) => {
    if (faces[0]) ashFace(s0, d1, s0, d0, -1, 0, top);
    if (faces[1]) ashFace(s1, d0, s1, d1, 1, 0, top);
    if (faces[2]) ashFace(s0, d0, s1, d0, 0, -1, top);
    if (faces[3]) ashFace(s1, d1, s0, d1, 0, 1, top);
    box(s0 - 0.15, s1 + 0.15, d0 - 0.15, d1 + 0.15, top, top + 0.3, CAP);
  };
  const shoe = (s, d) => { box(s - 0.6, s + 0.6, d - 0.45, d + 0.45, -2.0, -1.75, sh(STEEL, 0.7)); box(s - 0.35, s + 0.35, d - 0.3, d + 0.3, -1.75, -1.45, sh(STEEL, 0.78)); };

  /* ---- the south-west end ---- */
  const AS = RB.ABUT_SW, PS = RB.PIER_SW, [g0, g1] = RB.GIRDER;
  // the abutment: its face towards the road, the wing along the road on the north-west, the end on the south-east;
  // above the cap a parapet on both sides of the girders up to the embankment
  ashFace(AS.s, AS.d0, AS.s, AS.d1, 1, 0, -2.3); box(AS.s - 0.5, AS.s + 0.15, AS.d0 - 0.15, AS.d1 + 0.15, -2.3, -2.0, CAP);
  const TOP = -0.3;   // the tops of the walls along the embankment, their caps flush with it
  ashFace(AS.wing, AS.d0, AS.s, AS.d0, 0, -1, TOP); box(AS.wing - 0.15, AS.s + 0.15, AS.d0 - 0.15, AS.d0 + 0.6, TOP, TOP + 0.25, CAP);
  ashFace(AS.wing, AS.d0 + 0.6, AS.wing, AS.d0, -1, 0, TOP);
  for (const [d0, d1] of [[AS.d0, -3.3], [3.3, AS.d1]]) { ashFace(AS.s - 0.1, d0, AS.s - 0.1, d1, 1, 0, TOP); box(AS.s - 0.7, AS.s + 0.05, d0, d1, TOP, TOP + 0.25, CAP); }
  ashFace(AS.s - 0.1, -3.3, AS.s - 0.7, -3.3, 0, 1, TOP); ashFace(AS.s - 0.7, 3.3, AS.s - 0.1, 3.3, 0, -1, TOP);
  ashFace(-1.5, AS.d1, AS.s, AS.d1, 0, 1, -2.3);
  box(AS.s - 0.9, AS.s - 0.1, -3.3, 3.3, -2.0, -1.85, sh(STONE, 0.8));   // the bed of the girders
  // the pier by the road: the girders on its south-west half, the first truss on the other
  mass(PS.s0, PS.s1, PS.d0, PS.d1, -2.3);
  for (const sg of [-1, 1]) { shoe(BEAR[0], sg * TW); box(g1 - 0.6, g1, sg * 2.75 - 0.4, sg * 2.75 + 0.4, -2.0, -1.85, sh(STEEL, 0.7)); box(g0, g0 + 0.6, sg * 2.75 - 0.4, sg * 2.75 + 0.4, -2.0, -1.85, sh(STEEL, 0.7)); }
  // the girder span: two plate girders 1.4 m deep with stiffeners, a deck of plates over them, cross frames below
  for (const sg of [-1, 1]) {
    const d = sg * 2.75;
    box(g0, g1, d - 0.12, d + 0.12, -1.75, -0.45, DARK);                                    // the web
    box(g0, g1, d - 0.35, d + 0.35, -1.85, -1.75, sh(DARK, 0.9)); box(g0, g1, d - 0.35, d + 0.35, -0.55, -0.45, sh(DARK, 0.9));   // the flanges
    for (let s = g0 + 0.7; s < g1 - 0.3; s += 1.4) box(s - 0.05, s + 0.05, d + sg * 0.12, d + sg * 0.3, -1.75, -0.55, sh(DARK, 0.85));   // stiffeners outside
  }
  box(g0, g1, -3.05, 3.05, -0.45, -0.3, sh(DARK, 1.15));                                     // the deck plate, its edges a lighter line
  for (let s = g0 + 1.2; s < g1 - 0.5; s += 2.4) { bar(s, -2.75, -1.7, s, 2.75, -0.6, 0.12, sh(DARK, 0.8)); bar(s, 2.75, -1.7, s, -2.75, -0.6, 0.12, sh(DARK, 0.8)); }
  for (const sg of [-1, 1]) {   // railings on both edges, a cable tray on the north-west one
    const d = sg * 2.98;
    bar(g0, d, 1.0, g1, d, 1.0, 0.06, RAIL); bar(g0, d, 0.5, g1, d, 0.5, 0.045, RAIL);
    for (let s = g0; s <= g1 + 0.01; s += 1.6) bar(s, d, -0.3, s, d, 1.0, 0.06, RAIL);
  }
  bar(g0, -3.2, -0.75, g1, -3.2, -0.75, 0.16, sh(DARK, 0.7)); bar(g0, -3.2, -1.0, g1, -3.2, -1.0, 0.08, sh(DARK, 0.6));
  // the clearance sign over the road on both faces: a red ring on white, "4,8", a board striped red and white beside it
  const sc = RP.sw ? rbLocal(RP.sw.cross[0], RP.sw.cross[1])[0] : 7;
  for (const sg of [-1, 1]) {
    const dF = sg * 3.3, n = nrm(0, sg), cy = -1.1, Pt = (u, v, off) => P(sc + u * sg, dF + sg * off, cy + v);
    for (const [r, col, off] of [[0.36, hb('#c8202a'), 0.01], [0.27, hb('#f2f0ea'), 0.02]]) for (let k = 0; k < 18; k++) { const a0 = k / 18 * 2 * Math.PI, a1 = (k + 1) / 18 * 2 * Math.PI; polyA(G, [Pt(0, 0, off), Pt(Math.cos(a0) * r, Math.sin(a0) * r, off), Pt(Math.cos(a1) * r, Math.sin(a1) * r, off)], col, n[0], 0, n[2]); }
    const seg = (u0, v0, u1, v1) => lmBar(G, Pt(u0, v0, 0.04), Pt(u1, v1, 0.04), 0.024, hb('#1c1c1c'));
    seg(-0.06, 0.1, -0.15, -0.02); seg(-0.15, -0.02, -0.04, -0.02); seg(-0.07, 0.04, -0.07, -0.1);              // "4"
    seg(-0.01, -0.1, -0.01, -0.07);                                                                          // ","
    seg(0.04, 0.1, 0.13, 0.1); seg(0.04, 0, 0.13, 0); seg(0.04, -0.1, 0.13, -0.1); seg(0.04, 0.1, 0.04, -0.1); seg(0.13, 0.1, 0.13, -0.1);   // "8"
    for (let k = 0; k < 6; k++) { const u0 = 0.5 + k * 0.18, col = k % 2 ? hb('#f2f0ea') : hb('#c8202a');   // the striped board
      polyA(G, [Pt(u0, -0.16, 0.015), Pt(u0 + 0.18, -0.16, 0.015), Pt(u0 + 0.18, 0.16, 0.015), Pt(u0, 0.16, 0.015)], col, n[0], 0, n[2]); }
  }

  /* ---- the river piers: ashlar hexagons with pointed cutwaters along d, a dressed cap, the shoes of the trusses ---- */
  for (const p of RB.PIERS) {
    const o = [[-p.hs, p.d0 + 2.0], [-p.hs, p.d1 - 2.0], [0, p.d1], [p.hs, p.d1 - 2.0], [p.hs, p.d0 + 2.0], [0, p.d0]], m = o.length;
    for (let i = 0; i < m; i++) { const a = o[i], b = o[(i + 1) % m], ds = b[0] - a[0], dd = b[1] - a[1], l = Math.hypot(ds, dd); ashFace(p.s + a[0], a[1], p.s + b[0], b[1], dd / l, -ds / l, -2.3); }
    const c = o.map(([u, v]) => [u * (p.hs + 0.15) / p.hs, v + Math.sign(v - (p.d0 + p.d1) / 2) * 0.15]);
    for (let i = 0; i < m; i++) { const a = c[i], b = c[(i + 1) % m], ds = b[0] - a[0], dd = b[1] - a[1], l = Math.hypot(ds, dd), n = nrm(dd / l, -ds / l);
      polyA(G, [P(p.s + a[0], a[1], -2.3), P(p.s + b[0], b[1], -2.3), P(p.s + b[0], b[1], -2.0), P(p.s + a[0], a[1], -2.0)], CAP, n[0], 0, n[2]); }
    polyA(G, c.map(([u, v]) => P(p.s + u, v, -2.0)), sh(CAP, 1.05), 0, 1, 0);
  }
  for (let k = 1; k < BEAR.length - 1; k++) for (const sg of [-1, 1]) for (const e of [-0.55, 0.55]) shoe(BEAR[k] + e, sg * TW);

  /* ---- the north-east abutment: the face to the river with the seat of the truss, a back wall, the wings ---- */
  const AN = RB.ABUT_NE;
  ashFace(AN.s, AN.d1w, AN.s, AN.d0, -1, 0, -2.3); box(AN.s - 0.15, AN.back, AN.d0 - 0.15, AN.d1w + 0.15, -2.3, -2.0, CAP);
  ashFace(AN.back - 0.8, AN.d1w, AN.back - 0.8, AN.d0, -1, 0, TOP); box(AN.back - 0.95, AN.back, AN.d0 - 0.15, AN.d1w + 0.15, TOP, TOP + 0.25, CAP);
  ashFace(AN.s, AN.d0, AN.wingL, AN.d0, 0, -1, TOP); box(AN.s, AN.wingL, AN.d0 - 0.15, AN.d0 + 0.6, TOP, TOP + 0.25, CAP); ashFace(AN.wingL, AN.d0, AN.wingL, AN.d0 + 0.6, 1, 0, TOP);
  ashFace(AN.wingR, AN.d1w, AN.s, AN.d1w, 0, 1, TOP); box(AN.s, AN.wingR, AN.d1w - 0.6, AN.d1w + 0.15, TOP, TOP + 0.25, CAP); ashFace(AN.wingR, AN.d1w - 0.6, AN.wingR, AN.d1w, 1, 0, TOP);
  for (const sg of [-1, 1]) shoe(BEAR[3], sg * TW);

  /* ---- the trusses ---- */
  const ends = BEAR.map((b, k) => [k === 0 ? b - 0.6 : b + 0.55, k === BEAR.length - 1 ? b + 0.5 : b - 0.55]);
  for (let k = 0; k < BEAR.length - 1; k++) {
    const a = ends[k][0], b = ends[k + 1][1], np = PANELS[k], pw = (b - a) / np, yT = TH - 0.6, yB = -1.0;
    box(a, b, -2.3, 2.3, -0.75, -0.4, DARK);                                                   // the floor with its ballast trough
    for (const sg of [-1, 1]) {
      const d = sg * TW;
      box(a, b, d - 0.3, d + 0.3, -1.45, -0.55, sh(STEEL, 0.86));                              // the lower chord
      box(a, b, d - 0.32, d + 0.32, yT, TH, STEEL);                                             // the upper chord
      box(a, b, d - 0.36, d + 0.36, yT - 0.12, yT, sh(STEEL, 0.8));                             // its lower flange
      for (let i = 0; i <= np; i++) { const s = a + i * pw, end = i === 0 || i === np;
        bar(s, d, -0.6, s, d, yT, end ? 0.62 : 0.34, end ? STEEL : sh(STEEL, 0.9));              // the verticals, heavier at the ends
        if (i < np) { const s2 = s + pw;                                                         // two diagonals crossing at mid-height
          bar(s, d, yT, s2, d, -0.6, 0.3, STEEL); bar(s, d, -0.6, s2, d, yT, 0.3, STEEL);
          box(s + pw / 2 - 0.45, s + pw / 2 + 0.45, d - 0.2, d + 0.2, (yT + yB) / 2 - 0.45, (yT + yB) / 2 + 0.45, sh(STEEL, 0.84)); }   // the plate where they cross
      }
      box(a, b, d - sg * 0.4 - 0.3, d - sg * 0.4 + 0.3, -0.35, -0.27, PLANK);                    // the walkway inside the truss
      bar(a, d - sg * 0.25, 0.75, b, d - sg * 0.25, 0.75, 0.05, RAIL);                           // its handrail on the verticals
    }
    for (let i = 0; i <= np; i++) { const s = a + i * pw, end = i === 0 || i === np;
      box(s - 0.25, s + 0.25, -TW, TW, -1.6, -0.75, sh(STEEL, 0.75));                          // the floor beams
      bar(s, -TW, TH - 0.35, s, TW, TH - 0.35, end ? 0.45 : 0.28, sh(STEEL, 0.92));             // the struts between the upper chords
      if (!end) for (const sg of [-1, 1]) bar(s, sg * TW, TH - 2.2, s, sg * (TW - 1.6), TH - 0.4, 0.16, sh(STEEL, 0.9));   // knee braces
      if (i < np) { const s2 = s + pw; bar(s, -TW, TH - 0.3, s2, TW, TH - 0.3, 0.14, sh(STEEL, 0.85)); bar(s, TW, TH - 0.3, s2, -TW, TH - 0.3, 0.14, sh(STEEL, 0.85)); }   // the top bracing
    }
    for (const s of [a, b]) {   // the portals: two beams with a lattice between them and knee braces down the end posts
      box(s - 0.25, s + 0.25, -TW, TW, TH - 0.9, TH - 0.4, STEEL); box(s - 0.2, s + 0.2, -TW, TW, TH - 3.2, TH - 2.8, STEEL);
      for (let j = 0; j < 4; j++) { const d0 = -TW + j * TW / 2, d1 = d0 + TW / 2; bar(s, d0, TH - 2.9, s, d1, TH - 0.8, 0.14, sh(STEEL, 0.9)); bar(s, d1, TH - 2.9, s, d0, TH - 0.8, 0.14, sh(STEEL, 0.9)); }
      for (const sg of [-1, 1]) bar(s, sg * TW, TH - 5.0, s, sg * (TW - 1.4), TH - 3.0, 0.22, STEEL);
    }
  }

  /* ---- the sentry booths: boards painted in red and white vertical stripes, a window on each side, a door, a hipped roof ---- */
  for (const b of RB.BOOTHS) booth(G, P, gnd(b.s, b.d), b, nrm);

  // walls a walker under the deck runs into (tag 3: not for one walking on the deck over them, src/game/player.js)
  const wall = (s0, d0, s1, d1, r) => { const p = P(s0, d0, 0), q = P(s1, d1, 0); COL.add(p[0], p[2], q[0], q[2], r, 3); };
  wall(AS.s - 0.3, AS.d0, AS.s - 0.3, AS.d1, 0.3); wall(AS.wing, AS.d0 + 0.3, AS.s, AS.d0 + 0.3, 0.3);
  for (const [s0, d0, s1, d1] of [[PS.s0, PS.d0, PS.s0, PS.d1], [PS.s1, PS.d0, PS.s1, PS.d1], [PS.s0, PS.d0, PS.s1, PS.d0], [PS.s0, PS.d1, PS.s1, PS.d1]]) wall(s0, d0, s1, d1, 0.15);
  wall(AN.s + 0.3, AN.d0, AN.s + 0.3, AN.d1w, 0.3);
  STATE.GBC = null;
}

function booth(G, P, g, b, nrm) {
  const RED = hb('#b8262c'), WHITE = hb('#ecebe6'), ROOF = hb('#55575a'), GLASS = hb('#3d4b55'), hs = b.ls / 2, hd = b.ld / 2, h = 2.5, y0 = g - 0.1;
  const Q = (s, d, y) => P(b.s + s, b.d + d, y);
  const sides = [[-hs, -hd, hs, -hd, 0, -1], [hs, -hd, hs, hd, 1, 0], [hs, hd, -hs, hd, 0, 1], [-hs, hd, -hs, -hd, -1, 0]];
  sides.forEach(([s0, d0, s1, d1, ns, nd], k) => {
    const L = Math.hypot(s1 - s0, d1 - d0), m = Math.max(2, Math.round(L / 0.3)), n = nrm(ns, nd);
    for (let i = 0; i < m; i++) { const a = i / m, c = (i + 1) / m, sa = s0 + (s1 - s0) * a, da = d0 + (d1 - d0) * a, sb = s0 + (s1 - s0) * c, db = d0 + (d1 - d0) * c;
      polyA(G, [Q(sa, da, y0), Q(sb, db, y0), Q(sb, db, g + h), Q(sa, da, g + h)], i % 2 ? WHITE : RED, n[0], 0, n[2]); }
    const o = 0.02, mid = [(s0 + s1) / 2 + ns * o, (d0 + d1) / 2 + nd * o], ts = (s1 - s0) / L, td = (d1 - d0) / L, w = k === 3 ? 0.45 : Math.min(0.55, L / 4);
    const yb = k === 3 ? g + 0.05 : g + 1.1, yt = g + 2.0, col = k === 3 ? hb('#6e4a3a') : GLASS;   // the door on one end, windows on the others
    polyA(G, [Q(mid[0] - ts * w, mid[1] - td * w, yb), Q(mid[0] + ts * w, mid[1] + td * w, yb), Q(mid[0] + ts * w, mid[1] + td * w, yt), Q(mid[0] - ts * w, mid[1] - td * w, yt)], col, n[0], 0, n[2]);
  });
  // the hipped roof with eaves of 0.25 m
  const e = 0.25, ys = g + h, yr = g + h + Math.min(hs, hd) * 0.8, rs = Math.max(0, hs - hd), rd = Math.max(0, hd - hs);
  const c0 = Q(-hs - e, -hd - e, ys), c1 = Q(hs + e, -hd - e, ys), c2 = Q(hs + e, hd + e, ys), c3 = Q(-hs - e, hd + e, ys), r0 = Q(-rs, -rd, yr), r1 = Q(rs, rd, yr);
  const faces = hs >= hd ? [[c0, c1, r1, r0], [c1, c2, r1], [c2, c3, r0, r1], [c3, c0, r0]] : [[c0, c1, r0], [c1, c2, r1, r0], [c2, c3, r1], [c3, c0, r0, r1]];
  for (const tri of faces) polyA(G, tri, ROOF, 0, 1, 0);
  polyA(G, [c0, c3, c2, c1], sh(ROOF, 0.7), 0, -1, 0);
}

export { lmRailBridge };
