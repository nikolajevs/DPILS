import { fuelCen } from '../landmarks/fuel.js';
import { lmBar, lmLathe } from '../landmarks/helpers.js';
import { COL } from './data.js';
import { CARROAD, TRAMGRID } from '../transit/transit.js';
import { groundMaterial } from '../render/materials.js';
import { detailTex } from '../render/textures.js';
import { BRIDGES, BRSEG, terrainH } from './terrain.js';
import { scene } from '../render/renderer.js';
import { GB, box, polyA } from '../core/geometry.js';
import { dec, hb, sh } from '../core/util.js';
import { C } from '../core/env.js';

/* ---------- 18. novembra iela: the overpass over the railway by Daugavgrīva prison ----------
   The street (A13) and both tram tracks cross the main line to Indra and the sidings east of the station on a 45 m bridge
   (OSM way 127382597) between ramps on embankments: from the junction with 1. Preču iela in the west the street climbs
   about 150 m to the bridge, in the east it runs out onto the plateau by x = -90; steps lead down from its sidewalks to the
   side streets. Trains pass under it with room to spare. In the terrain model (20 m grid) the embankments are smoothed to
   a few metres and the bridge to nothing, so the deck lay just over the rails. Here the corridor has its own profile: the
   deck 8.2 m over the rails (6.6 m clear under the girders), a straight ramp of about 5 % from the west, level over the
   bridge with a slight crest, a gentle rise onto the plateau, the corners rounded over 40 m and never under the ground.
   Everything on it follows the profile: the carriageways, the tram tracks, the sidewalks, the steps, lamps, vehicles and
   walkers (the corridor is a bridge with its own profile, B.prof). Grassed slopes run down from its edges, concrete
   abutments face the tracks, two piers on columns stand between them. The look follows a street photograph (Google Street
   View, April 2024): tram tracks in the asphalt in the middle, steel guard rails between the road and the sidewalks,
   railings of vertical bars painted grey-blue on a low curb along both edges. The centre line runs from the west foot
   midway between the sidewalks, along the bridge and the eastern road; with each point the half width out to the edge on
   the left (north, going east) and on the right. */
const OV = { C: [[-423.8, 1566.5, 13.8, 13.8], [-406.1, 1557.7, 11.9, 11.9], [-388.2, 1549.5, 10.7, 10.7], [-369.2, 1542.3, 10.6, 10.6], [-350.2, 1535.6, 10, 10], [-331.2, 1529.4, 9.9, 9.9],
  [-312.4, 1522.5, 9.9, 9.9], [-293.6, 1514.5, 9.8, 9.8], [-275.1, 1506.5, 9.6, 9.6], [-234.2, 1488.8, 9.6, 9.6], [-176.6, 1462.7, 10.6, 11.1], [-149.7, 1447.5, 10.9, 10.3],
  [-129.3, 1433.2, 10.7, 9.8], [-118.3, 1424.2, 10.6, 10.1], [-108.3, 1415.5, 10.8, 10.2], [-91.2, 1398.8, 11.3, 10.3]],
  bw: 8, be: 9, piers: [9.9, 23.2], clear: 8.2, pr: null };
function ovPrep() {
  if (OV.pr) return;
  const C = OV.C, n = C.length, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(C[i][0] - C[i - 1][0], C[i][1] - C[i - 1][1]));
  OV.cum = cum; OV.L = cum[n - 1]; OV.sW = cum[OV.bw]; OV.sE = cum[OV.be];
  OV.at = s => { let i = 0; while (i < n - 2 && cum[i + 1] < s) i++; const t = Math.max(0, Math.min(1, (s - cum[i]) / (cum[i + 1] - cum[i]))); return [C[i][0] + (C[i + 1][0] - C[i][0]) * t, C[i][1] + (C[i + 1][1] - C[i][1]) * t, i, t]; };
  const mid = OV.at((OV.sW + OV.sE) / 2), Hd = terrainH(mid[0], mid[1]) + OV.clear, h0 = terrainH(C[0][0], C[0][1]), h1 = terrainH(C[n - 1][0], C[n - 1][1]);
  const N = Math.ceil(OV.L / 2), raw = [];
  for (let k = 0; k <= N; k++) { const s = Math.min(OV.L, k * 2);
    raw.push(s < OV.sW ? h0 + (Hd - h0) * s / OV.sW : s <= OV.sE ? Hd + 0.15 * (1 - ((2 * s - OV.sW - OV.sE) / (OV.sE - OV.sW)) ** 2) : Hd + (h1 - Hd) * (s - OV.sE) / (OV.L - OV.sE)); }
  OV.pr = raw.map((_, k) => { const w = Math.min(10, k, N - k); let a = 0; for (let j = -w; j <= w; j++) a += raw[k + j]; const p = OV.at(Math.min(OV.L, k * 2)); return Math.max(a / (2 * w + 1), terrainH(p[0], p[1])); });
  OV.Hd = Hd;
  // the corridor is a bridge with its own profile: lamps, vehicles and walkers find their height with bridgeY
  const pts = []; for (const c of C) pts.push(c[0], c[1]);
  const B = { pts, cum, L: OV.L, H0: OV.pr[0], H1: OV.pr[N], hw: 15, hws: C.slice(0, -1).map((c, i) => Math.max(c[2], c[3], C[i + 1][2], C[i + 1][3]) + 0.3), prof: ovH }, id = BRIDGES.length; BRIDGES.push(B);
  for (let i = 0; i < n - 1; i++) BRSEG.add(C[i][0], C[i][1], C[i + 1][0], C[i + 1][1], id, i);
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const c of C) { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); z0 = Math.min(z0, c[1]); z1 = Math.max(z1, c[1]); } OV.bb = [x0 - 16, z0 - 16, x1 + 16, z1 + 16];
}
const ovH = s => { const k = Math.max(0, Math.min(OV.pr.length - 1.001, s / 2)), i = Math.floor(k), f = k - i; return OV.pr[i] + (OV.pr[Math.min(OV.pr.length - 1, i + 1)] - OV.pr[i]) * f; };
// the nearest point of the centre line: s along it, d to the left (north); null outside the corridor (with a margin)
function ovLocal(x, z, margin = 0.6) {
  const C = OV.C, n = C.length; let best = null, bd = 1e9;
  for (let i = 0; i < n - 1; i++) { const x1 = C[i][0], z1 = C[i][1], dx = C[i + 1][0] - x1, dz = C[i + 1][1] - z1, l2 = dx * dx + dz * dz, tr = ((x - x1) * dx + (z - z1) * dz) / l2, t = Math.max(0, Math.min(1, tr)), dd = Math.hypot(x - x1 - dx * t, z - z1 - dz * t);
    if (dd < bd) { bd = dd; const l = Math.sqrt(l2); best = { i, t, s: OV.cum[i] + (i === 0 ? Math.min(tr, 1) : i === n - 2 ? Math.max(tr, 0) : t) * l, d: ((x - x1) * dz - (z - z1) * dx) / l, hl: C[i][2] + (C[i + 1][2] - C[i][2]) * t, hr: C[i][3] + (C[i + 1][3] - C[i][3]) * t }; } }
  if (!best || best.s < 0 || best.s > OV.L || best.d > best.hl + margin || -best.d > best.hr + margin) return null;
  return best;
}
// the half width of the carriageway along the centre line of the corridor at (x, z): to 0.4 m short of the guard rails; null off it
function ovRoadHW(x, z) { if (!OV.pr) return null; const q = ovLocal(x, z, -1); return q && Math.abs(q.d) < 1.5 ? Math.min(q.hl, q.hr) - 3.3 : null; }
function ovComp(x, y, z) { const q = ovLocal(x, z); return q ? ovH(q.s) - terrainH(x, z) : 0; }   // GBC for what lies on the corridor
const ovTouches = bb => OV.pr && bb[2] >= OV.bb[0] && bb[0] <= OV.bb[2] && bb[3] >= OV.bb[1] && bb[1] <= OV.bb[3];
function ovDensify(p, step = 4) { const o = [p[0], p[1]]; for (let i = 2; i < p.length; i += 2) { const x0 = p[i - 2], z0 = p[i - 1], m = Math.max(1, Math.ceil(Math.hypot(p[i] - x0, p[i + 1] - z0) / step)); for (let k = 1; k <= m; k++) o.push(x0 + (p[i] - x0) * k / m, z0 + (p[i + 1] - z0) * k / m); } return o; }
// no tree on the embankment and its slopes; the cadastre sheds under the ramps give way to them
function ovNoTree(x, z) { if (!OV.pr || x < OV.bb[0] || x > OV.bb[2] || z < OV.bb[1] || z > OV.bb[3]) return false; const q = ovLocal(x, z, 16); if (!q) return false; const H = Math.max(0, ovH(q.s) - terrainH(x, z)); return (q.d > 0 ? q.d - q.hl : -q.d - q.hr) < H * 1.5 + 2; }
function ovDrops(ring, bb) { if (!OV.pr || !ovTouches(bb)) return false; const [cx, cz] = fuelCen(ring), q = ovLocal(cx, cz, -0.5); return !!q && (q.s < OV.sW - 2 || q.s > OV.sE + 2) && ovH(q.s) - terrainH(cx, cz) > 1.5; }
function lmOverpass(K) {
  if (!OV.pr) return;
  const G = K.plain, L = OV.L, sW = OV.sW, sE = OV.sE;
  const CON = hb('#b2afa7'), GRASS = hb('#5f7546'), STEEL = hb('#a5aaad'), RAILC = hb('#7a8892'), ASPH = hb('#4e4f51');
  // a frame at s: the point, the tangent from the neighbouring points, the half widths, the height of the road
  const fr = s => { const p = OV.at(s), a = OV.at(Math.max(0, s - 1)), b = OV.at(Math.min(L, s + 1)), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tu = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], C = OV.C, i = p[2], t = p[3];
    return { x: p[0], z: p[1], tu, nl: [tu[1], -tu[0]], hl: C[i][2] + (C[i + 1][2] - C[i][2]) * t, hr: C[i][3] + (C[i + 1][3] - C[i][3]) * t, h: ovH(s) }; };
  const W3 = (f, d, dy) => { const x = f.x + f.nl[0] * d, z = f.z + f.nl[1] * d; return [x, f.h + dy - terrainH(x, z), z]; };   // dy over the road
  const edge = (f, side) => side > 0 ? f.hl : -f.hr;
  const steps = (a, b, st) => { const o = []; for (let s = a; s < b - 1e-6; s += st) o.push(s); o.push(b); return o; };
  // ---- the asphalt over the whole corridor, under the lines of the carriageways, tracks and sidewalks. Unlike the ground
  // layers it writes depth, and before them: the lines then lie on it and what passes under the bridge stays hidden
  { const g = new GB(false), S = steps(0, L, 2), mat = groundMaterial(detailTex(1), 1 / 5, 0.45, 'ov-deck'); mat.depthWrite = true;
    for (const s of S) { const f = fr(s); for (const d of [f.hl, 0, -f.hr]) { const P = W3(f, d, -0.06); g.vert(P[0], P[1], P[2], 0, 1, 0, ASPH); } }
    for (let k = 0; k < S.length - 1; k++) for (let j = 0; j < 2; j++) { const a = k * 3 + j; g.triUp(a, a + 3, a + 1); g.triUp(a + 1, a + 3, a + 4); }
    const m = g.mesh(mat); m.renderOrder = -70; m.frustumCulled = false; m.receiveShadow = m.castShadow = true; scene.add(m); }
  // ---- the embankments: a concrete edge under the railing, grassed slopes down to the ground (1 : 1.5)
  const ramp = [[0, sW], [sE, L]];
  for (const [a, b] of ramp) { const S = steps(a, b, 3);
    for (let k = 0; k < S.length - 1; k++) { const f0 = fr(S[k]), f1 = fr(S[k + 1]);
      for (const sd of [1, -1]) { const e0 = edge(f0, sd), e1 = edge(f1, sd), A = W3(f0, e0, -0.3), B = W3(f1, e1, -0.3), H0 = Math.max(0, A[1] + 0.3), H1 = Math.max(0, B[1] + 0.3);
        if (H0 < 0.05 && H1 < 0.05) continue;
        const T0 = W3(f0, e0 + sd * 1.5 * H0, 0), T1 = W3(f1, e1 + sd * 1.5 * H1, 0); T0[1] = 0; T1[1] = 0;
        polyA(G, [A, B, T1, T0], GRASS, f0.nl[0] * sd, 1.2, f0.nl[1] * sd);
        polyA(G, [W3(f0, e0, -0.3), W3(f1, e1, -0.3), W3(f1, e1, 0.2), W3(f0, e0, 0.2)], CON, f0.nl[0] * sd, 0, f0.nl[1] * sd);
        polyA(G, [W3(f0, e0, 0.2), W3(f1, e1, 0.2), W3(f1, e1 - sd * 0.4, 0.2), W3(f0, e0 - sd * 0.4, 0.2)], sh(CON, 1.06), 0, 1, 0); } } }
  // ---- the abutments: concrete walls closing the embankments towards the tracks
  for (const [s, dir] of [[sW, 1], [sE, -1]]) { const f = fr(s), Hl = W3(f, f.hl, 0)[1], Hr = W3(f, -f.hr, 0)[1];
    const A = W3(f, f.hl + 1.5 * Hl, 0), B = W3(f, -f.hr - 1.5 * Hr, 0); A[1] = 0; B[1] = 0;
    polyA(G, [A, W3(f, f.hl, 0.2), W3(f, -f.hr, 0.2), B], CON, f.tu[0] * dir, 0, f.tu[1] * dir);
    polyA(G, [W3(f, f.hl + 0.6, -0.5), W3(f, -f.hr - 0.6, -0.5), W3(f, -f.hr - 0.6, -0.45), W3(f, f.hl + 0.6, -0.45)], sh(CON, 0.9), 0, 1, 0); }
  // ---- the deck: the slab with its cornices, six girders under it, two piers on three columns each between the tracks
  { const S = steps(sW, sE, 3);
    for (let k = 0; k < S.length - 1; k++) { const f0 = fr(S[k]), f1 = fr(S[k + 1]);
      polyA(G, [W3(f0, f0.hl, -0.45), W3(f1, f1.hl, -0.45), W3(f1, -f1.hr, -0.45), W3(f0, -f0.hr, -0.45)], sh(CON, 0.8), 0, -1, 0);
      for (const sd of [1, -1]) { const e0 = edge(f0, sd) + sd * 0.05, e1 = edge(f1, sd) + sd * 0.05;
        polyA(G, [W3(f0, e0, -0.95), W3(f1, e1, -0.95), W3(f1, e1, 0.25), W3(f0, e0, 0.25)], CON, f0.nl[0] * sd, 0, f0.nl[1] * sd);
        polyA(G, [W3(f0, e0, -0.95), W3(f1, e1, -0.95), W3(f1, e1 - sd * 0.5, -0.95), W3(f0, e0 - sd * 0.5, -0.95)], sh(CON, 0.75), 0, -1, 0);
        polyA(G, [W3(f0, e0, 0.25), W3(f1, e1, 0.25), W3(f1, e1 - sd * 0.45, 0.25), W3(f0, e0 - sd * 0.45, 0.25)], sh(CON, 1.06), 0, 1, 0); }
      for (let g = 0; g < 6; g++) { const d0 = -f0.hr + 1.2 + (f0.hl + f0.hr - 2.4) * g / 5, d1 = -f1.hr + 1.2 + (f1.hl + f1.hr - 2.4) * g / 5;
        for (const w of [-0.25, 0.25]) polyA(G, [W3(f0, d0 + w, -0.45), W3(f1, d1 + w, -0.45), W3(f1, d1 + w, -1.6), W3(f0, d0 + w, -1.6)], sh(CON, 0.88), f0.nl[0] * Math.sign(w), 0, f0.nl[1] * Math.sign(w));
        polyA(G, [W3(f0, d0 - 0.25, -1.6), W3(f1, d1 - 0.25, -1.6), W3(f1, d1 + 0.25, -1.6), W3(f0, d0 + 0.25, -1.6)], sh(CON, 0.78), 0, -1, 0); } }
    // the piers lie along the tracks: the direction of the nearest railway
    for (const ds of OV.piers) { const f = fr(sW + ds); let dir = f.nl, bd = 1e9;
      for (const l of C.l) { if (l[0] !== 8) continue; const p = dec(l[2]); for (let i = 0; i < p.length - 2; i += 2) { const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((f.x - p[i]) * dx + (f.z - p[i + 1]) * dz) / l2)), dd = Math.hypot(f.x - p[i] - dx * t, f.z - p[i + 1] - dz * t); if (dd < bd) { bd = dd; const ll = Math.sqrt(l2); dir = [dx / ll, dz / ll]; } } }
      const sin = Math.abs(dir[0] * f.tu[1] - dir[1] * f.tu[0]) || 1, half = Math.max(f.hl, f.hr) / Math.max(0.35, sin), top = f.h - 1.6, Ht = top - terrainH(f.x, f.z);
      box(G, f.x, f.z, dir[0], dir[1], half, 0.7, Ht - 1.0, Ht, CON);
      for (const a of [-half + 1.2, 0, half - 1.2]) { const x = f.x + dir[0] * a, z = f.z + dir[1] * a; lmLathe(G, x, z, 0, [[0.55, 0], [0.45, 0.4], [0.45, top - 1.0 - terrainH(x, z)]], 12, sh(CON, 0.95)); } } }
  // ---- railings of vertical bars on the curbs along both edges, guard rails between the road and the sidewalks
  const gaps = []; for (const l of C.l) { if (l[0] !== 15) continue; const p = dec(l[2]); for (let i = 0; i < p.length; i += 2) { const q = ovLocal(p[i], p[i + 1], 3); if (q) gaps.push(q.s); } }
  const free = s => !gaps.some(g => Math.abs(g - s) < 2.2);
  for (const sd of [1, -1]) {
    const S = steps(0, L, 2.4);
    for (let k = 0; k < S.length - 1; k++) { const f0 = fr(S[k]), f1 = fr(S[k + 1]), e0 = edge(f0, sd) - sd * 0.2, e1 = edge(f1, sd) - sd * 0.2, H0 = W3(f0, edge(f0, sd), 0)[1], H1 = W3(f1, edge(f1, sd), 0)[1], sm = (S[k] + S[k + 1]) / 2;
      if (Math.max(H0, H1) < 0.8 || !free(sm)) continue;
      lmBar(G, W3(f0, e0, 0.2), W3(f0, e0, 1.3), 0.07, RAILC); lmBar(G, W3(f0, e0, 1.25), W3(f1, e1, 1.25), 0.06, RAILC); lmBar(G, W3(f0, e0, 0.35), W3(f1, e1, 0.35), 0.045, RAILC);
      for (let j = 1; j < 16; j++) { const u = j / 16, f = fr(S[k] + (S[k + 1] - S[k]) * u), e = edge(f, sd) - sd * 0.2; lmBar(G, W3(f, e, 0.35), W3(f, e, 1.25), 0.02, RAILC); }
      if (S[k] >= sW - 1) wbeam(f0, f1, edge(f0, sd) - sd * 2.9, edge(f1, sd) - sd * 2.9, sd);   // on the bridge and the east ramp, by the sidewalks
      if (S[k] < sW - 1 || S[k + 1] > sE + 1) { const A = W3(f0, edge(f0, sd), 0), B = W3(f1, edge(f1, sd), 0); COL.add(A[0], A[2], B[0], B[2], 0, 0); } }
  }
  /* ---- on the west ramp the tracks leave the middle of the street for a grassed bed of their own on its north side
     (Street View, April 2024): a W-beam between the carriageway and the bed wherever the tracks run beside the road, none
     by the sidewalks; where the tracks still lie between the two carriageways (by the bridge) it stays open */
  { const S = steps(2, sW - 1, 2.4), cs = CARROAD.s;
    const g = S.map(s => { const f = fr(s), tr = [], rd = [], ofs = (px, pz) => (px - f.x) * f.nl[0] + (pz - f.z) * f.nl[1], along = (px, pz) => Math.abs((px - f.x) * f.tu[0] + (pz - f.z) * f.tu[1]);
      TRAMGRID.near(f.x, f.z, 14, (id, d, px, pz) => { if (along(px, pz) < 1.5) tr.push(ofs(px, pz)); });
      CARROAD.near(f.x, f.z, 14, (id, d, px, pz) => { const k = id * 6, dx = cs[k + 2] - cs[k], dz = cs[k + 3] - cs[k + 1], l = Math.hypot(dx, dz) || 1;
        if (cs[k + 5] > 3 || along(px, pz) > 1.5 || Math.abs((dx * f.tu[0] + dz * f.tu[1]) / l) < 0.8) return; const o = ofs(px, pz); rd.push([o - cs[k + 4], o + cs[k + 4]]); });
      if (!tr.length || !rd.length) return null;
      const t0 = Math.min(...tr) - 1.3, t1 = Math.max(...tr) + 1.3, r0 = Math.min(...rd.map(r => r[0])), r1 = Math.max(...rd.map(r => r[1]));
      if (t0 > r1 + 0.4) return [r1 + Math.min(0.6, (t0 - r1) / 2), 1];       // the bed north of the road (left going east)
      if (t1 < r0 - 0.4) return [r0 - Math.min(0.6, (r0 - t1) / 2), -1];
      return null; });
    for (let k = 0; k < S.length - 1; k++) { const a = g[k], b = g[k + 1]; if (!a || !b || a[1] !== b[1] || Math.abs(a[0] - b[0]) > 1.2) continue;
      const f0 = fr(S[k]), f1 = fr(S[k + 1]); wbeam(f0, f1, a[0], b[0], -a[1]);
      const A = W3(f0, a[0], 0), B = W3(f1, b[0], 0); COL.add(A[0], A[2], B[0], B[2], 0.05, 0); }
  }
  // a W-beam from frame f0 to f1 at g0..g1 across, its posts on the side sd (away from the traffic)
  function wbeam(f0, f1, g0, g1, sd) {
    for (const w of [0.04, -0.04]) polyA(G, [W3(f0, g0 + w, 0.45), W3(f1, g1 + w, 0.45), W3(f1, g1 + w, 0.8), W3(f0, g0 + w, 0.8)], STEEL, f0.nl[0] * Math.sign(w), 0, f0.nl[1] * Math.sign(w));
    lmBar(G, W3(f0, g0 + sd * 0.12, 0), W3(f0, g0 + sd * 0.12, 0.8), 0.12, sh(STEEL, 0.8));
  }
}

export { lmOverpass, ovComp, ovDensify, ovDrops, ovNoTree, ovPrep, ovRoadHW, ovTouches };
