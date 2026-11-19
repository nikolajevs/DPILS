import { C } from '../core/env.js';
import { STATE } from '../core/state.js';
import { polyA } from '../core/geometry.js';
import { dec, hb, sh } from '../core/util.js';
import { lmBar } from '../landmarks/helpers.js';
import { VB, vbLocal, vbP, vbY } from './bridge-vienibas.js';
import { COL } from './data.js';
import { terrainH } from './terrain.js';   // a cycle: used at run time only

/* ---------- Daugavas iela under the north end of Vienības tilts ----------
   At the bridge Daugavas iela splits: one carriageway climbs onto the dam to the teardrop junction at the end of the
   bridge, the other (OSM way of 306 m along the bank) runs on below and passes under the last span of the bridge in a
   concrete box, one lane wide between hatched margins, 3.9 m high (the sign on the beam). Along it gabion walls hold
   the dam on one side and the bank towards the river on the other, with grass slopes above them (Google Street View,
   April 2024). The terrain model (20 m grid) had the end of the bridge at 3.9 m over Vienības laukums, 2 m below the
   junction it leads to, and the street at the height of the deck, so the street ran into the embankment of the bridge.
   Here:
   - the bridge ends at the height of the junction, read 10 m past its end on its axis;
   - the street has its own profile: straight from one end of the way to the other, under the bridge 5 m below the
     deck (3.9 m clear under a beam of 1.1 m), no steeper than 4.5 %, the corners rounded;
   - a fine patch of the terrain (1 m, src/world/terrain.js) lays it out: the street level across its carriageway and
     sidewalk, gabions of 1.8 m on the dam side and 0.8 m towards the river with slopes of 1 : 1.5 above them, the end of
     the bridge on a level of its own; under the bridge the box is concrete, the embankment of the bridge open over it.
   Frame of the street: s along the way from its west end, d across it (positive towards the river). */
const UP = { ok: false, L: 0, X: null, Z: null, TX: null, TZ: null, h: null, sc: 0, sbC: 0, gap: [0, 0], D1: 0, h0: 0, NW: 4.3, SW: 4.3, bb: [0, 0, 0, 0] };
const STEP = 2;
const fss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
// the height of the bridge deck at s along it (above the reference, like terrainH), with the end raised to the junction
const upDeck = sb => UP.h0 + (UP.D1 - UP.h0) * Math.max(0, Math.min(1, sb / VB.L)) + vbY(sb);
// the nearest point of the street: s along it, d across (positive towards the river), and its sample index
function upLocal(x, z) {
  let bd = 1e9, bs = 0, bdd = 0; const n = UP.X.length;
  for (let i = 0; i < n - 1; i++) { const x1 = UP.X[i], z1 = UP.Z[i], dx = UP.X[i + 1] - x1, dz = UP.Z[i + 1] - z1, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; bs = (i + t) * STEP; const l = Math.sqrt(l2); bdd = ((x - px) * -dz + (z - pz) * dx) / l; } }
  return [Math.min(bs, UP.L), bdd];
}
const upH = s => { const k = Math.max(0, Math.min(UP.h.length - 1.001, s / STEP)), i = Math.floor(k), f = k - i; return UP.h[i] + (UP.h[Math.min(UP.h.length - 1, i + 1)] - UP.h[i]) * f; };

/* Called by terrainInit once the grid is final (terrainH without a patch yet): the profile and the patch, or null. */
function upPatch() {
  const N = C.names.indexOf('Daugavas iela'); if (N < 0) return null;
  // the way that passes under the end of the bridge: it crosses the axis of the bridge within 25 m of its end
  let way = null, cross = null;
  for (const l of C.l) { if (l[1] !== N || l[0] > 3 || l[3]) continue; const p = dec(l[2]), n = p.length >> 1; let cum = 0;
    for (let i = 0; i < n - 1; i++) { const [s1, d1] = vbLocal(p[2 * i], p[2 * i + 1]), [s2, d2] = vbLocal(p[2 * i + 2], p[2 * i + 3]), sl = Math.hypot(p[2 * i + 2] - p[2 * i], p[2 * i + 3] - p[2 * i + 1]);
      if (Math.sign(d1) !== Math.sign(d2)) { const t = d1 / (d1 - d2), sb = s1 + (s2 - s1) * t; if (sb > VB.L - 25 && sb < VB.L) { way = p; cross = { s: cum + t * sl, sb }; } }
      cum += sl; } }
  if (!way) return null;
  // resampled every 2 m: points and tangents
  const n = way.length >> 1, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(way[2 * i] - way[2 * i - 2], way[2 * i + 1] - way[2 * i - 1]));
  const L = cum[n - 1], M = Math.floor(L / STEP) + 1, X = new Float32Array(M), Z = new Float32Array(M), TX = new Float32Array(M), TZ = new Float32Array(M);
  let sg = 0; for (let k = 0; k < M; k++) { const sv = Math.min(L, k * STEP); while (sg < n - 2 && cum[sg + 1] < sv) sg++; const sl = Math.max(1e-6, cum[sg + 1] - cum[sg]), t = (sv - cum[sg]) / sl;
    X[k] = way[2 * sg] + (way[2 * sg + 2] - way[2 * sg]) * t; Z[k] = way[2 * sg + 1] + (way[2 * sg + 3] - way[2 * sg + 1]) * t; TX[k] = (way[2 * sg + 2] - way[2 * sg]) / sl; TZ[k] = (way[2 * sg + 3] - way[2 * sg + 1]) / sl; }
  Object.assign(UP, { L: (M - 1) * STEP, X, Z, TX, TZ, sc: cross.s, sbC: cross.sb });
  // the deck: from the Grīva end to the height of the junction 10 m past the north end; the gap under it over the street
  const [ex, , ez] = vbP(VB.L + 10, 0, 0); UP.h0 = terrainH(VB.A[0], VB.A[1]); UP.D1 = terrainH(ex, ez);
  const k0 = Math.round(UP.sc / STEP), cosA = Math.abs(VB.T[0] * -TZ[k0] + VB.T[1] * TX[k0]) || 1;   // the street's normal along the bridge axis
  UP.gap = [UP.sbC - UP.SW / cosA, UP.sbC + UP.NW / cosA];
  let Uc = 1e9; for (let sb = UP.gap[0]; sb <= UP.gap[1]; sb += 0.5) Uc = Math.min(Uc, upDeck(sb) - 5.0);
  // the profile: straight between the heights at the ends, under the deck 5 m below it, 4.5 % at most, corners rounded
  const g0 = terrainH(X[0], Z[0]), g1 = terrainH(X[M - 1], Z[M - 1]), U = [];
  for (let k = 0; k < M; k++) { const s = k * STEP; let u = g0 + (g1 - g0) * s / UP.L; if (Math.abs(s - UP.sc) <= VB.HW + 1.5) u = Math.min(u, Uc); U.push(u); }
  const G = 0.045 * STEP; let h = U.map((_, k) => { let m = 1e9; for (let j = 0; j < M; j++) m = Math.min(m, U[j] + G * Math.abs(k - j)); return m; });
  h = h.map((_, k) => { const w = Math.min(7, k, M - 1 - k); let t = 0; for (let j = -w; j <= w; j++) t += h[k + j]; return Math.min(U[k], t / (2 * w + 1)); });
  UP.h = Float32Array.from(h);
  // the patch: a 1 m grid over the street and 25 m round it
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let k = 0; k < M; k++) { x0 = Math.min(x0, X[k]); x1 = Math.max(x1, X[k]); z0 = Math.min(z0, Z[k]); z1 = Math.max(z1, Z[k]); }
  x0 = Math.floor(x0 - 25); z0 = Math.floor(z0 - 25); x1 = Math.ceil(x1 + 25); z1 = Math.ceil(z1 + 25);
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1, d = new Float32Array(nx * nz); UP.bb = [x0, z0, x1, z1]; UP.ok = true;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i, z = z0 + j, H = terrainH(x, z), [s, dd] = upLocal(x, z), [sb, db] = vbLocal(x, z), adb = Math.abs(db);
    // the end of the bridge on the level of the junction, north of the street, fading out 25 m past it and 10 m beside it
    const wp = sb >= UP.gap[1] - 0.5 && sb <= VB.L + 25 && adb <= VB.HW + 12 ? (sb <= VB.L + 6 ? 1 : 1 - fss((sb - VB.L - 6) / 19)) * (adb <= VB.HW + 3 ? 1 : 1 - fss((adb - VB.HW - 3) / 10)) : 0;
    const He = H + Math.max(0, UP.D1 - H) * wp;
    const wE = s <= 0 || s >= UP.L ? 0 : fss(Math.min(s, UP.L - s) / 10), hs = upH(s), under = (sb > VB.L - 40 && sb < VB.L + 0.5 && adb <= VB.HW + 0.5) || (sb >= UP.gap[1] - 0.5 && sb <= VB.L + 15 && adb <= VB.HW + 3);
    // (the end of the bridge and the start of the ramps beyond it keep the level of the junction up to the wall of the box:
    // the gabion and its slope had cut it by up to a metre just past the end of the deck, which then stood in the air)
    let t;
    if (dd >= -UP.NW && dd <= UP.SW) t = hs;   // the street, level across
    else { const e = dd < 0 ? -UP.NW - dd : dd - UP.SW; t = under ? He : Math.min(He, hs + (dd < 0 ? 1.8 : 0.8) + e / 1.5); }   // gabion and slope above it; under the bridge its walls
    d[j * nx + i] = (He - H) + (t - He) * wE;
  }
  return { x0, z0, s: 1, nx, nz, d };
}

/* Things under the bridge: on the street in the box, not on the deck. A walker by the height it stands at (below the
   deck by 2 m or more), a vehicle by its heading (along the street); with neither, on the deck. */
function upUnder(x, z, dx = 0, dz = 0, prev = null) {
  if (!UP.ok) return false;
  const [sb, db] = vbLocal(x, z); if (sb < UP.gap[0] - 0.5 || sb > UP.gap[1] + 0.5 || Math.abs(db) > VB.HW + 1) return false;
  if (prev !== null) return prev < upDeck(sb) - 2;
  const l = Math.hypot(dx, dz); if (!l) return false;
  const k = Math.max(0, Math.min(UP.X.length - 1, Math.round(UP.sc / STEP))); return Math.abs((dx * UP.TX[k] + dz * UP.TZ[k]) / l) > 0.7;
}
// a walker under the deck at the north end of the bridge: at the box over the street and its wings, 2 m or more below the
// deck (feet = the height he stands at). COL walls of tag 1 (rails of the deck) do not stop him, tag 2 (the walls of the
// box) stop only him
function upLow(x, z, feet) {
  if (!UP.ok) return false;
  const [sb, db] = vbLocal(x, z); if (sb < UP.gap[0] - 3 || sb > VB.L + 3 || Math.abs(db) > VB.HW + 4) return false;
  return feet < upDeck(Math.min(sb, VB.L)) - 2;
}
// the stretch of the bridge's embankment left open over the street (lmVienibas leaves out its slopes there)
const upGap = s => UP.ok && s > UP.gap[0] && s < UP.gap[1];
// no street lamp in the box or by its mouths (a pole of 8 m stood through the deck)
const upNoLamp = (x, z) => { if (!UP.ok) return false; const [sb, db] = vbLocal(x, z); return sb > UP.gap[0] - 3 && sb < VB.L + 3 && Math.abs(db) < VB.HW + 3; };
// no tree on the street, its gabions and slopes, nor in the box
function upNoTree(x, z) { if (!UP.ok || x < UP.bb[0] || x > UP.bb[2] || z < UP.bb[1] || z > UP.bb[3]) return false; const [s, d] = upLocal(x, z); return s > 0 && s < UP.L && d > -UP.NW - 6 && d < UP.SW + 3; }

/* Draws the box under the bridge, the gabions along the street, guard rails above the drops, the clearance signs. */
function lmUnderpass(K) {
  if (!UP.ok) return;
  const G = K.plain, W2 = K.walls[2], CONC = hb('#bdb9b0'), CONC2 = hb('#a8a399'), GAB = [126, 121, 112], WIRE = hb('#6f7272'), RAIL = hb('#b9bec1'), POST = hb('#8f9497');
  STATE.GBC = (x, y, z) => -terrainH(x, z);   // heights given above the reference
  const at = (s, d, y) => { const k = Math.max(0, Math.min(UP.X.length - 1, Math.round(s / STEP))); return [UP.X[k] - UP.TZ[k] * d + UP.TX[k] * (s - k * STEP), y, UP.Z[k] + UP.TX[k] * d + UP.TZ[k] * (s - k * STEP)]; };
  const gnd = (s, d) => { const [x, , z] = at(s, d, 0); return terrainH(x, z); };
  const nrm = (s, sg) => { const k = Math.max(0, Math.min(UP.X.length - 1, Math.round(s / STEP))); return [-UP.TZ[k] * sg, 0, UP.TX[k] * sg]; };
  const inBox = (s, d) => { const [x, , z] = at(s, d, 0), [sb, db] = vbLocal(x, z); return sb > VB.L - 40 && sb < VB.L + 0.5 && Math.abs(db) <= VB.HW + (d < 0 ? 3.6 : 0.6); };   // the wall under the end of the bridge has wings
  // ---- gabions: baskets of stones in a wire mesh, 0.6 m thick, from the street (or the ground) up to the ground (or the street)
  for (const [dEdge, sg] of [[-UP.NW, -1], [UP.SW, 1]]) {
    for (let s = 6; s < UP.L - 6; s += STEP) {
      const s2 = Math.min(UP.L - 6, s + STEP), a = upH(s), b = upH(s2);
      if (inBox(s, dEdge) || inBox(s2, dEdge)) continue;
      const ga = gnd(s, dEdge + sg * 0.9), gb = gnd(s2, dEdge + sg * 0.9);
      const lo0 = Math.min(a, ga) - 0.2, lo1 = Math.min(b, gb) - 0.2, hi0 = Math.max(a, ga) + 0.1, hi1 = Math.max(b, gb) + 0.1;
      if (hi0 - lo0 < 0.55 && hi1 - lo1 < 0.55) continue;
      const fi = [at(s, dEdge, lo0), at(s2, dEdge, lo1), at(s2, dEdge, hi1), at(s, dEdge, hi0)], n = nrm(s, -sg);   // the face towards the street
      W2.q(fi[0], fi[1], fi[2], fi[3], n, [s / 0.9, lo0 / 0.9, s2 / 0.9, lo1 / 0.9, s2 / 0.9, hi1 / 0.9, s / 0.9, hi0 / 0.9], GAB);
      const o = dEdge + sg * 0.6; polyA(G, [at(s, dEdge, hi0), at(s2, dEdge, hi1), at(s2, o, hi1), at(s, o, hi0)], sh(hb('#8a857b'), 1.05), 0, 1, 0);   // the top
      for (const y of [1, 2]) if (lo0 + y < hi0 - 0.05) lmBar(G, at(s, dEdge - sg * 0.02, lo0 + y), at(s2, dEdge - sg * 0.02, lo1 + y), 0.02, WIRE);   // the baskets, a metre high
      lmBar(G, at(s, dEdge - sg * 0.02, lo0 + 0.2), at(s, dEdge - sg * 0.02, hi0), 0.02, WIRE);
      const [ax, , az] = at(s, dEdge + sg * 0.3, 0), [bx, , bz] = at(s2, dEdge + sg * 0.3, 0); COL.add(ax, az, bx, bz, 0.3, 0);
      // a guard rail on the street where the ground falls away beyond the gabion
      if (sg > 0 && ga < a - 0.6 && gb < b - 0.6) { const r0 = at(s, dEdge - 0.25, 0), r1 = at(s2, dEdge - 0.25, 0);
        lmBar(G, [r0[0], a + 0.55, r0[2]], [r1[0], b + 0.55, r1[2]], 0.12, RAIL); lmBar(G, [r0[0], a, r0[2]], [r0[0], a + 0.6, r0[2]], 0.09, POST); }
    }
  }
  // ---- the box under the bridge: concrete walls along the street up to the beam, the soffit and the beams of the span
  const [g0, g1] = UP.gap, deckP = (sb, db, y) => vbP(sb, db, y);
  for (const [sb, sg] of [[g0, -1], [g1, 1]]) {   // g0: the wall towards the river (facing north), g1: under the end of the bridge (facing south)
    const top = sb2 => upDeck(sb2) - 1.1, n = [VB.T[0] * -sg, 0, VB.T[1] * -sg];
    const wd = VB.HW + (sg > 0 ? 3.5 : 0.5), gnd2 = (db) => { const Q = deckP(sb + sg * 0.8, db, 0); return terrainH(Q[0], Q[2]) + 0.1; };   // under the end of the bridge with wings beside it
    for (let db = -wd; db < wd - 1e-6; db += 1) { const d2 = Math.min(wd, db + 1), A = deckP(sb, db, 0), B = deckP(sb, d2, 0);
      const ra = upH(upLocal(A[0], A[2])[0]) - 0.2, rb = upH(upLocal(B[0], B[2])[0]) - 0.2, ta = Math.abs(db) <= VB.HW ? top(sb) : gnd2(db), tb = Math.abs(d2) <= VB.HW ? top(sb) : gnd2(d2);
      polyA(G, [[A[0], ra, A[2]], [B[0], rb, B[2]], [B[0], Math.max(rb, tb), B[2]], [A[0], Math.max(ra, ta), A[2]]], sh(CONC, sg > 0 ? 0.97 : 1), n[0], 0, n[2]);
      COL.add(A[0], A[2], B[0], B[2], 0.2, 2); }   // tag 2: a wall under the deck, no obstacle for one walking on it
    const A = deckP(sb, -VB.HW - 0.5, 0), B = deckP(sb, VB.HW + 0.5, 0), c0 = deckP(sb - sg * 0.6, -VB.HW - 0.5, 0), c1 = deckP(sb - sg * 0.6, VB.HW + 0.5, 0), y = top(sb);   // a ledge under the beam
    polyA(G, [[A[0], y, A[2]], [B[0], y, B[2]], [c1[0], y, c1[2]], [c0[0], y, c0[2]]], CONC2, 0, -1, 0);
  }
  // the soffit 0.75 m under the deck, the face of the beam under the cornice on both sides, five precast beams between the edge beams
  for (let sb = g0; sb < g1 - 1e-6; sb += 1) { const s2 = Math.min(g1, sb + 1);
    polyA(G, [deckP(sb, -VB.HW, upDeck(sb) - 0.75), deckP(s2, -VB.HW, upDeck(s2) - 0.75), deckP(s2, VB.HW, upDeck(s2) - 0.75), deckP(sb, VB.HW, upDeck(sb) - 0.75)], sh(CONC2, 0.85), 0, -1, 0);
    for (const sg of [-1, 1]) polyA(G, [deckP(sb, sg * 7.25, upDeck(sb) - 1.1), deckP(s2, sg * 7.25, upDeck(s2) - 1.1), deckP(s2, sg * 7.25, upDeck(s2) - 0.8), deckP(sb, sg * 7.25, upDeck(sb) - 0.8)], sh(CONC, 0.92), VB.N[0] * sg, 0, VB.N[1] * sg);
    for (const db of [-4.6, -2.3, 0, 2.3, 4.6]) for (const sg of [-1, 1]) {
      const e = db + sg * 0.45; polyA(G, [deckP(sb, e, upDeck(sb) - 1.1), deckP(s2, e, upDeck(s2) - 1.1), deckP(s2, e, upDeck(s2) - 0.75), deckP(sb, e, upDeck(sb) - 0.75)], sh(CONC2, 0.8), VB.N[0] * sg, 0, VB.N[1] * sg); }
    for (const db of [-4.6, -2.3, 0, 2.3, 4.6]) polyA(G, [deckP(sb, db - 0.45, upDeck(sb) - 1.1), deckP(s2, db - 0.45, upDeck(s2) - 1.1), deckP(s2, db + 0.45, upDeck(s2) - 1.1), deckP(sb, db + 0.45, upDeck(sb) - 1.1)], sh(CONC2, 0.75), 0, -1, 0);
  }
  for (const sg of [-1, 1]) {   // the edge beams under the cornices: their underside and inner face
    polyA(G, [deckP(g0, sg * 6.6, upDeck(g0) - 1.1), deckP(g1, sg * 6.6, upDeck(g1) - 1.1), deckP(g1, sg * 7.25, upDeck(g1) - 1.1), deckP(g0, sg * 7.25, upDeck(g0) - 1.1)], CONC2, 0, -1, 0);
    polyA(G, [deckP(g0, sg * 6.6, upDeck(g0) - 1.1), deckP(g1, sg * 6.6, upDeck(g1) - 1.1), deckP(g1, sg * 6.6, upDeck(g1) - 0.75), deckP(g0, sg * 6.6, upDeck(g0) - 0.75)], sh(CONC2, 0.85), -VB.N[0] * sg, 0, -VB.N[1] * sg); }
  // ---- the clearance sign on the beam over the lane on both faces: a red ring on white, "3,9 m" in black
  const sbS = UP.sbC + 0.6;
  for (const sg of [-1, 1]) {
    const c = deckP(sbS, sg * 7.3, upDeck(sbS) - 0.55), ux = VB.T[0], uz = VB.T[1], n = [VB.N[0] * sg, 0, VB.N[1] * sg], Pt = (u, v, off = 0) => [c[0] + ux * u + n[0] * off, c[1] + v, c[2] + uz * u + n[2] * off];
    for (const [r, col, off] of [[0.34, hb('#c8202a'), 0.01], [0.26, hb('#f2f0ea'), 0.02]]) for (let k = 0; k < 16; k++) { const a0 = k / 16 * 2 * Math.PI, a1 = (k + 1) / 16 * 2 * Math.PI; polyA(G, [Pt(0, 0, off), Pt(Math.cos(a0) * r, Math.sin(a0) * r, off), Pt(Math.cos(a1) * r, Math.sin(a1) * r, off)], col, n[0], 0, n[2]); }
    const seg = (u0, v0, u1, v1) => lmBar(G, Pt(u0 * sg, v0, 0.04), Pt(u1 * sg, v1, 0.04), 0.022, hb('#1c1c1c'));
    // "3": three bars and the right side; ",": a dot; "9": a loop and the right side
    seg(-0.17, 0.09, -0.07, 0.09); seg(-0.17, 0, -0.07, 0); seg(-0.17, -0.09, -0.07, -0.09); seg(-0.07, 0.09, -0.07, -0.09);
    seg(-0.03, -0.1, -0.03, -0.07);
    seg(0.01, 0.09, 0.11, 0.09); seg(0.01, 0, 0.11, 0); seg(0.01, -0.09, 0.11, -0.09); seg(0.01, 0.09, 0.01, 0); seg(0.11, 0.09, 0.11, -0.09);
  }
  STATE.GBC = null;
}

export { UP, lmUnderpass, upDeck, upGap, upLow, upNoLamp, upNoTree, upPatch, upUnder };
