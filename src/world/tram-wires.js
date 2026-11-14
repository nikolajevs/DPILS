import { CARROAD } from '../transit/transit.js';
import { LMM } from '../landmarks/index.js';
import { lmBar, lmLathe } from '../landmarks/helpers.js';
import { ovDensify } from './overpass.js';
import { VB, vbEmb, vbGround, vbP, vbY } from './bridge-vienibas.js';
import { COL, TRAMLINES, inBuilding } from './data.js';
import { groundMaterial } from '../render/materials.js';
import { detailTex } from '../render/textures.js';
import { bridgeY, vbLift } from './terrain.js';
import { scene } from '../render/renderer.js';
import { GB, SegGrid, box, polyA } from '../core/geometry.js';
import { hb, sh } from '../core/util.js';
import { WL } from '../core/env.js';

/* ---------- the overhead line of the trams ----------
   The tram lines are electrified (600 V): a contact wire 5.8 m over every track, and a support every 32 m. Where the
   tracks run in a carriageway (on the overpass and along most streets) steel poles stand at both kerbs and a span wire
   crosses the street, the contact wires hung from it; on a track bed of their own a centre pole between the two tracks
   carries an arm over each (as on 18. novembra iela west of the overpass); a single track has a pole beside it, on the
   side away from the street. A pair of tracks gets one support, put up by one of them. Heights follow bridges and the
   overpass like the vehicles do. */
function lmTramWires(K) {
  const G = K.plain, POLE = hb('#7b8084'), WIRE = hb('#2b2d2f'), CW = 5.8, TL = TRAMLINES; if (!TL.length) return;
  const lift = (x, z) => vbGround(x, z) + vbLift(x, z) + bridgeY(x, z), P3 = (x, z, y) => [x, y + lift(x, z), z];
  const grid = new SegGrid(20); TL.forEach((p, li) => { for (let i = 0; i < p.length - 2; i += 2) grid.add(p[i], p[i + 1], p[i + 2], p[i + 3], li, 0); });
  const inRoad = (x, z) => { let best = null, bd = 1e9; CARROAD.near(x, z, 10, (id, d) => { if (CARROAD.s[id * 6 + 5] <= 3 && d < CARROAD.s[id * 6 + 4] - 0.3 && d < bd) { bd = d; best = id; } }); return best; };
  const pole = (x, z, h) => { lmLathe(G, x, z, lift(x, z), [[0.17, 0], [0.13, 0.4], [0.09, h]], 8, POLE); COL.add(x, z, x + 0.01, z, 0.15, 0); };
  function support(li, x, z, tx, tz) {
    const nx = -tz, nz = tx; let q = null, qd = 1e9, qli = -1;
    grid.near(x, z, 5.5, (id, d, px, pz) => { const s = grid.s, lj = s[id * 6 + 4]; if (lj === li || d < 2.2) return; const dx = s[id * 6 + 2] - s[id * 6], dz = s[id * 6 + 3] - s[id * 6 + 1], l = Math.hypot(dx, dz) || 1;
      if (Math.abs((dx * tx + dz * tz) / l) > 0.85 && d < qd) { qd = d; q = [px, pz]; qli = lj; } });
    if (q && qli < li) return;   // the other track of the pair carries it
    const road = inRoad(x, z), tracks = q ? [[x, z], q] : [[x, z]];
    if (road !== null) {
      const s = CARROAD.s, ax = s[road * 6], az = s[road * 6 + 1], dx = s[road * 6 + 2] - ax, dz = s[road * 6 + 3] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), l = Math.sqrt(l2);
      const rx = ax + dx * t, rz = az + dz * t, rnx = -dz / l, rnz = dx / l, hw = s[road * 6 + 4] + 0.9, A = [rx + rnx * hw, rz + rnz * hw], B = [rx - rnx * hw, rz - rnz * hw];
      if (inBuilding(A[0], A[1]) || inBuilding(B[0], B[1])) return;
      pole(A[0], A[1], 8.6); pole(B[0], B[1], 8.6); lmBar(G, P3(A[0], A[1], 7.4), P3(B[0], B[1], 7.4), 0.025, WIRE);
      for (const c of tracks) { const k = (c[0] - A[0]) * (B[0] - A[0]) + (c[1] - A[1]) * (B[1] - A[1]), L2 = (B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2, f = Math.max(0, Math.min(1, k / L2)), sx = A[0] + (B[0] - A[0]) * f, sz = A[1] + (B[1] - A[1]) * f;
        lmBar(G, P3(sx, sz, 7.4), P3(c[0], c[1], CW + 0.05), 0.02, WIRE); }
    } else if (q) {
      const cx = (x + q[0]) / 2, cz = (z + q[1]) / 2; if (inBuilding(cx, cz)) return; pole(cx, cz, 7.2);
      for (const c of tracks) { lmBar(G, P3(cx, cz, 6.6), P3(c[0], c[1], 6.6), 0.08, POLE); lmBar(G, P3(cx, cz, 7.15), P3(c[0], c[1], 6.64), 0.03, POLE); lmBar(G, P3(c[0], c[1], 6.6), P3(c[0], c[1], CW + 0.05), 0.02, WIRE); }
    } else {
      const sd = inRoad(x + nx * 3, z + nz * 3) !== null ? -1 : 1, px = x + nx * 2.6 * sd, pz = z + nz * 2.6 * sd; if (inBuilding(px, pz)) return; pole(px, pz, 7.2);
      lmBar(G, P3(px, pz, 6.6), P3(x, z, 6.6), 0.08, POLE); lmBar(G, P3(px, pz, 7.15), P3(x, z, 6.64), 0.03, POLE); lmBar(G, P3(x, z, 6.6), P3(x, z, CW + 0.05), 0.02, WIRE);
    }
  }
  TL.forEach((p, li) => {
    const n = p.length >> 1; if (n < 2) return;
    const w = ovDensify(Array.from(p), 8); for (let i = 0; i < w.length - 2; i += 2) lmBar(G, P3(w[i], w[i + 1], CW), P3(w[i + 2], w[i + 3], CW), 0.03, WIRE);   // the contact wire
    let acc = 12;
    for (let i = 0; i < n - 1; i++) { const x1 = p[2 * i], z1 = p[2 * i + 1], L = Math.hypot(p[2 * i + 2] - x1, p[2 * i + 3] - z1); if (L < 0.01) continue; const tx = (p[2 * i + 2] - x1) / L, tz = (p[2 * i + 3] - z1) / L;
      while (acc < L) { support(li, x1 + tx * acc, z1 + tz * acc, tx, tz); acc += 32; } acc -= L; }
  });
}
function lmVienibas(K) {
  const G = K.plain, { L, T, N, HW, SW, PIERS } = VB, y = vbY, P = vbP;
  const STEEL = hb('#bcc0c2'), STEEL2 = sh(STEEL, 0.86), CONC = hb('#cfccc4'), SLOPE = hb('#a9a79f'), RAILC = hb('#b4b8bb'), STONE = [236, 228, 218];
  const stations = (a, b, step = 2) => { const r = [a]; for (let s = Math.ceil(a / step) * step; s < b - 1e-3; s += step) if (s > a + 1e-3) r.push(s); r.push(b); return r; };
  // a box that follows the deck: d0..d1 across, dy0..dy1 relative to the deck, from s0 to s1
  const deckBox = (B, s0, s1, d0, d1, dy0, dy1, col, faces = 'tbio') => { const st = stations(s0, s1);
    for (let k = 0; k < st.length - 1; k++) { const a = st[k], b = st[k + 1];
      if (faces.includes('t')) polyA(B, [P(a, d0, y(a) + dy1), P(b, d0, y(b) + dy1), P(b, d1, y(b) + dy1), P(a, d1, y(a) + dy1)], sh(col, 1.04), 0, 1, 0);
      if (faces.includes('b')) polyA(B, [P(a, d0, y(a) + dy0), P(b, d0, y(b) + dy0), P(b, d1, y(b) + dy0), P(a, d1, y(a) + dy0)], sh(col, 0.72), 0, -1, 0);
      for (const [d, sg] of [[d0, -1], [d1, 1]]) if (faces.includes(sg > 0 ? 'o' : 'i')) polyA(B, [P(a, d, y(a) + dy0), P(b, d, y(b) + dy0), P(b, d, y(b) + dy1), P(a, d, y(a) + dy1)], col, N[0] * sg, 0, N[1] * sg); }
    for (const [s, sg] of [[s0, -1], [s1, 1]]) polyA(B, [P(s, d0, y(s) + dy0), P(s, d1, y(s) + dy0), P(s, d1, y(s) + dy1), P(s, d0, y(s) + dy1)], sh(col, 0.9), T[0] * sg, 0, T[1] * sg); };
  // ---- the deck: asphalt between raised sidewalks, markings, curbs, the concrete cornice with its panel joints
  const asph = groundMaterial(detailTex(1), 1 / 5, 0.45, 'vb-asph'), pave = groundMaterial(detailTex(2), 1 / 4, 0.5, 'vb-pave'); asph.depthWrite = pave.depthWrite = true;
  const RD = new GB(false), SW_ = new GB(false), MK = new GB(false);
  deckBox(RD, 0, L, -5.3, 5.3, -0.25, 0, hb('#4a4b4d'), 't');
  for (const sg of [-1, 1]) { const a = Math.min(sg * 5.3, sg * 6.95), b = Math.max(sg * 5.3, sg * 6.95); deckBox(SW_, 0, L, a, b, -0.2, 0.18, hb('#9a9488'), 't');
    deckBox(G, 0, L, sg * 5.3 - 0.01, sg * 5.3 + 0.01, 0, 0.18, hb('#a9a69e'), sg > 0 ? 'i' : 'o');
    for (const d of [sg * 5.05]) deckBox(MK, 0, L, d - 0.06, d + 0.06, 0, 0.025, hb('#e6e4dc'), 't'); }
  for (const d of [-0.12, 0.12]) deckBox(MK, 3, L - 3, d - 0.05, d + 0.05, 0, 0.025, hb('#e6e4dc'), 't');
  for (const [b, m] of [[RD, asph], [SW_, pave], [MK, LMM.plain]]) { const me = b.mesh(m); if (me) { me.receiveShadow = true; scene.add(me); } }
  for (const sg of [-1, 1]) { const a = sg > 0 ? 6.95 : -7.25, b = sg > 0 ? 7.25 : -6.95; deckBox(G, 0, L, a, b, -0.8, 0.3, CONC);
    for (let s = 3; s < L; s += 6) deckBox(G, s - 0.02, s + 0.02, sg > 0 ? 7.25 : -7.26, sg > 0 ? 7.26 : -7.25, -0.8, 0.3, sh(CONC, 0.8), sg > 0 ? 'o' : 'i'); }
  // ---- steel girders over the river: four lines, the outer webs with stiffeners and splice plates; the soffit
  const [sA, sB] = [SW[0] - 1, SW[1] + 1];
  deckBox(G, sA, sB, -6.95, 6.95, -0.8, -0.79, sh(STEEL, 0.8), 'b');
  for (const d of [-6.6, -2.3, 2.3, 6.6]) { deckBox(G, sA, sB, d - 0.03, d + 0.03, -3.0, -0.8, STEEL, 'io'); deckBox(G, sA, sB, d - 0.35, d + 0.35, -3.06, -2.98, STEEL2); }
  for (const sg of [-1, 1]) { const dw = sg * 6.63;
    for (const dy of [-1.45, -2.05, -2.55]) deckBox(G, sA, sB, Math.min(dw, dw + sg * 0.07), Math.max(dw, dw + sg * 0.07), dy - 0.04, dy + 0.04, sh(STEEL, 0.94));
    for (let s = sA + 1.3; s < sB; s += 2.6) lmBar(G, P(s, dw + sg * 0.03, y(s) - 0.85), P(s, dw + sg * 0.03, y(s) - 2.97), 0.07, sh(STEEL, 0.92));
    for (let s = sA + 13; s < sB - 5; s += 13) deckBox(G, s - 0.3, s + 0.3, Math.min(dw, dw + sg * 0.04), Math.max(dw, dw + sg * 0.04), -2.95, -0.85, sh(STEEL, 0.83)); }
  // ---- piers: rough granite ashlar with pointed cutwaters and a slight batter, a granite cap and bearings
  const W2 = K.walls[2];
  for (const sp of PIERS) {
    const yt = y(sp) - 3.0 - 0.85, plan = [[-2, -8.6], [0, -11.2], [2, -8.6], [2, 8.6], [0, 11.2], [-2, 8.6]];
    const ring = (yy, grow) => plan.map(([a, b]) => { const sc = 1 + grow * 0.12; return P(sp + a * sc, b + Math.sign(b) * grow * 0.3, yy); });
    let per = 0;
    for (let i = 0; i < plan.length; i++) { const j = (i + 1) % plan.length, [a0, b0] = plan[i], [a1, b1] = plan[j], len = Math.hypot(a1 - a0, b1 - b0), nn = [(b1 - b0) / len, -(a1 - a0) / len], nw = [T[0] * nn[0] + N[0] * nn[1], T[1] * nn[0] + N[1] * nn[1]];
      const cen = (a0 + a1) / 2 * nn[0] + (b0 + b1) / 2 * nn[1], sgn = cen > 0 ? 1 : -1, n3 = [nw[0] * sgn, 0, nw[1] * sgn];
      for (const [y0, y1, g0, g1, col] of [[-4.5, WL + 0.3, 1, 0.55, sh(STONE, 0.62)], [WL + 0.3, yt, 0.55, 0, STONE]]) {
        const r0 = ring(y0, g0), r1 = ring(y1, g1);
        W2.q(r0[i], r0[j], r1[j], r1[i], n3, [per / 6, y0 / 6, (per + len) / 6, y0 / 6, (per + len) / 6, y1 / 6, per / 6, y1 / 6], col); }
      per += len; }
    const cap = plan.map(([a, b]) => [a * 1.12, b + Math.sign(b) * 0.25]);
    for (const [yy, up] of [[yt, false], [yt + 0.4, true]]) { const c = P(sp, 0, yy); for (let i = 0; i < cap.length; i++) { const j = (i + 1) % cap.length; polyA(K.stone, [c, P(sp + cap[i][0], cap[i][1], yy), P(sp + cap[j][0], cap[j][1], yy)], sh(hb('#9d9890'), up ? 1.05 : 0.7), 0, up ? 1 : -1, 0); } }
    for (let i = 0; i < cap.length; i++) { const j = (i + 1) % cap.length; polyA(K.stone, [P(sp + cap[i][0], cap[i][1], yt), P(sp + cap[j][0], cap[j][1], yt), P(sp + cap[j][0], cap[j][1], yt + 0.4), P(sp + cap[i][0], cap[i][1], yt + 0.4)], hb('#9d9890'), T[0] * (cap[i][0] + cap[j][0]) + N[0] * (cap[i][1] + cap[j][1]), 0, T[1] * (cap[i][0] + cap[j][0]) + N[1] * (cap[i][1] + cap[j][1])); }
    for (const d of [-6.6, -2.3, 2.3, 6.6]) { const c = P(sp, d, 0); box(G, c[0], c[2], T[0], T[1], 0.55, 0.45, yt + 0.4, yt + 0.86, hb('#55595c')); }
  }
  // ---- the banks: paved embankments carry the deck down to the street, concrete abutments face the river
  for (const [s0, s1, sw, dir] of [[0, SW[0], SW[0], 1], [SW[1], L, SW[1], -1]]) {
    for (const sg of [-1, 1]) { const st = stations(s0, s1, 2);
      for (let k = 0; k < st.length - 1; k++) { const a = st[k], b = st[k + 1], ha = Math.max(0, y(a) - 0.8), hb_ = Math.max(0, y(b) - 0.8); if (ha + hb_ < 0.01) continue;
        polyA(G, [P(a, sg * HW, ha), P(b, sg * HW, hb_), P(b, sg * (HW + vbEmb(b)), 0.03), P(a, sg * (HW + vbEmb(a)), 0.03)], SLOPE, N[0] * sg, 1.5, N[1] * sg);
        COL.add(...(([x0, , z0]) => [x0, z0])(P(a, sg * (HW + vbEmb(a)), 0)), ...(([x1, , z1]) => [x1, z1])(P(b, sg * (HW + vbEmb(b)), 0)), 0, 0); } }
    const h = y(sw) - 0.8, e = vbEmb(sw), bot = WL - 0.6, nrm = [T[0] * dir, 0, T[1] * dir], AB = hb('#b3b0a8');
    polyA(G, [P(sw, -HW, bot), P(sw, HW, bot), P(sw, HW, h), P(sw, -HW, h)], AB, nrm[0], 0, nrm[2]);
    for (const sg of [-1, 1]) polyA(G, [P(sw, sg * HW, bot), P(sw, sg * (HW + e + 0.8), bot), P(sw, sg * (HW + e), 0.03), P(sw, sg * HW, h)], AB, nrm[0], 0, nrm[2]);
    polyA(G, [P(sw, -HW, h), P(sw, HW, h), P(sw - dir * 1.2, HW, h), P(sw - dir * 1.2, -HW, h)], sh(AB, 1.05), 0, 1, 0);
  }
  // ---- railings of vertical bars on the cornices, steel guard rails between the road and the sidewalks
  for (const sg of [-1, 1]) { const d = sg * 7.12, st = stations(0, L, 2.5);
    for (let k = 0; k < st.length - 1; k++) { const a = st[k], b = st[k + 1];
      for (const h of [0.42, 1.4]) lmBar(G, P(a, d, y(a) + h), P(b, d, y(b) + h), h > 1 ? 0.09 : 0.05, RAILC);
      lmBar(G, P(a, d, y(a) + 0.3), P(a, d, y(a) + 1.45), 0.08, RAILC);
      for (let s = a + 0.16; s < b - 0.05; s += 0.16) lmBar(G, P(s, d, y(s) + 0.42), P(s, d, y(s) + 1.4), 0.025, RAILC);
      COL.add(...(([x0, , z0]) => [x0, z0])(P(a, d, 0)), ...(([x1, , z1]) => [x1, z1])(P(b, d, 0)), 0, 0); }
    lmBar(G, P(L, d, 0.3), P(L, d, 1.45), 0.08, RAILC);
    const dg = sg * 5.45; deckBox(G, 2, L - 2, dg - 0.04, dg + 0.04, 0.5, 0.82, hb('#a2a7aa')); for (let s = 2; s < L - 1; s += 4) lmBar(G, P(s, dg + sg * 0.1, y(s) + 0.18), P(s, dg + sg * 0.1, y(s) + 0.8), 0.1, hb('#8e9396')); }
  // ---- lamp posts: a single arm with a cobra head over the road, an openwork lyre on the pole
  const LAMPC = hb('#a9adb0');
  for (const sg of [-1, 1]) for (let s = sg > 0 ? 14 : 28; s < L - 5; s += 28) {
    const d = sg * 6.98, yb = y(s) + 0.3, [x, , z] = P(s, d, 0), q = (dd, hh) => P(s, d - sg * dd, yb + hh);
    lmLathe(G, x, z, yb, [[0.16, 0], [0.16, 0.35], [0.11, 0.42], [0.075, 9.4], [0.05, 9.6], [0, 9.65]], 8, LAMPC);
    lmBar(G, q(0, 9.3), q(1.9, 9.85), 0.08, LAMPC); lmBar(G, q(1.6, 9.82), q(2.4, 9.88), 0.3, hb('#8c9093'));
    const [lx, , lz] = q(2.0, 0); lmLathe(K.globe, lx, lz, yb + 9.62, [[0, 0], [0.2, 0.03], [0.2, 0.12], [0, 0.16]], 8, hb('#f4efe2'));
    const lyre = (w, sgn) => { for (let k = 0; k < 10; k++) { const t0 = k / 10, t1 = (k + 1) / 10, o = t => 0.12 + w * Math.sin(Math.PI * t) * (1 + sgn * 0.3 * Math.sin(2 * Math.PI * t)); lmBar(G, q(o(t0), 5.4 + 3.4 * t0), q(o(t1), 5.4 + 3.4 * t1), 0.035, LAMPC); } };
    lyre(0.55, 1); lyre(0.3, -1); for (const t of [0.25, 0.5, 0.75]) lmBar(G, q(0.12, 5.4 + 3.4 * t), q(0.12 + 0.55 * Math.sin(Math.PI * t), 5.4 + 3.4 * t + 0.25), 0.03, LAMPC);
  }
}

export { lmTramWires, lmVienibas };
