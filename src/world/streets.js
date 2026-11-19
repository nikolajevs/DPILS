import { STATE } from '../core/state.js';
import { due, pause } from '../core/pause.js';
import { CARROAD, TRAMGRID } from '../transit/transit.js';
import { fortBridgeLine, fortSkipLine } from '../fortress/index.js';
import { airOnLine } from '../landmarks/air-bridge.js';
import { gubOnLine } from '../landmarks/gubisce.js';
import { jnFix } from '../landmarks/junction.js';
import { spwTrackLine } from '../landmarks/speedway.js';
import { ovComp, ovDensify, ovPrep, ovRoadHW, ovTouches } from './overpass.js';
import { vbOnLine } from './bridge-vienibas.js';
import { rbOnLine } from './bridge-railway.js';
import { CROSSINGS, CROSSINGS_LAT, streetTags } from './street-tags.js';
import { cutComp, cutTouches } from './cutting.js';
import { buildSignals } from './signals.js';
import { COL, LINES, M_ASPH, M_BALLAST, M_DIRT, M_LAND, M_MARK, M_PAVE, ROAD, STREAM, TRAMLINES, inWater, matPlain } from './data.js';
import { LINE } from './palette.js';
import { TERR, bridgeDeck, bridgeOf, densify } from './terrain.js';
import { scene } from '../render/renderer.js';
import { GB, SegGrid, box, polyA } from '../core/geometry.js';
import { bbox, dec, hb, rnd, sh } from '../core/util.js';
import { C, HX, HY, WL } from '../core/env.js';

/* ---------- streets, sidewalks, rails, bridges, walls ---------- */
/* The direction a ribbon along p (n points) runs at point i and the mitre that keeps its width there, into FR as
   [tx, tz, m]: the chord through the neighbouring points, square across the segment at the ends; at an end E gives
   (E[0] the first point, E[1] the last), the end is cut across E[k] and mitred like an inner point (a joint with the
   next line, see jointEnds in buildLines). */
const FR = [0, 0, 1];
function frame(p, i, n, E) {
  const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1), e = E ? (i === 0 ? E[0] : i === n - 1 ? E[1] : null) : null;
  let tx, tz, m = 1;
  if (e) { tx = e[0]; tz = e[1]; } else { tx = p[2 * c] - p[2 * a]; tz = p[2 * c + 1] - p[2 * a + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; }
  if (e || (i > 0 && i < n - 1)) { const j = i > 0 ? i : 1, k = j - 1, sx = p[2 * j] - p[2 * k], sz = p[2 * j + 1] - p[2 * k + 1], sl = Math.hypot(sx, sz) || 1; m = 1 / Math.max(0.5, (sx * tx + sz * tz) / sl); }
  FR[0] = tx; FR[1] = tz; FR[2] = m; return FR;
}
function ribbon(b, p, off, hw, col, y = 0, E = null) {
  const n = p.length >> 1; if (n < 2) return; const v0 = b.v; b.ensure(n * 2);
  for (let i = 0; i < n; i++) {
    const [tx, tz, m] = frame(p, i, n, E), nx = -tz, nz = tx;
    b.vert(p[2 * i] + nx * (off - hw) * m, y, p[2 * i + 1] + nz * (off - hw) * m, 0, 1, 0, col);
    b.vert(p[2 * i] + nx * (off + hw) * m, y, p[2 * i + 1] + nz * (off + hw) * m, 0, 1, 0, col);
  }
  for (let i = 0; i < n - 1; i++) { const k = v0 + 2 * i; b.triUp(k, k + 1, k + 3); b.triUp(k, k + 3, k + 2); }
}
// like ribbon, between offsets A[i] and B[i] that change along the line
function ribbonV(b, p, A, B, col, E = null) {
  const n = p.length >> 1; if (n < 2) return; const v0 = b.v; b.ensure(n * 2);
  for (let i = 0; i < n; i++) {
    const [tx, tz, m] = frame(p, i, n, E), nx = -tz, nz = tx;
    b.vert(p[2 * i] + nx * A[i] * m, 0, p[2 * i + 1] + nz * A[i] * m, 0, 1, 0, col);
    b.vert(p[2 * i] + nx * B[i] * m, 0, p[2 * i + 1] + nz * B[i] * m, 0, 1, 0, col);
  }
  for (let i = 0; i < n - 1; i++) { const k = v0 + 2 * i; b.triUp(k, k + 1, k + 3); b.triUp(k, k + 3, k + 2); }
}
function dashes(b, p, off, hw, on, period, col) {
  let acc = 0; const n = p.length >> 1;
  for (let i = 0; i < n - 1; i++) {
    const x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * i + 2], z2 = p[2 * i + 3], L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.01) continue;
    const tx = (x2 - x1) / L, tz = (z2 - z1) / L, nx = -tz, nz = tx;
    let s = -(acc % period); while (s < L) { const a = Math.max(0, s), e = Math.min(L, s + on); if (e > a + 0.05) { const P = t => [x1 + tx * t + nx * off, z1 + tz * t + nz * off]; const A = P(a), B = P(e); const v = b.v; b.vert(A[0] - nx * hw, 0, A[1] - nz * hw, 0, 1, 0, col); b.vert(A[0] + nx * hw, 0, A[1] + nz * hw, 0, 1, 0, col); b.vert(B[0] - nx * hw, 0, B[1] - nz * hw, 0, 1, 0, col); b.vert(B[0] + nx * hw, 0, B[1] + nz * hw, 0, 1, 0, col); b.triUp(v, v + 1, v + 3); b.triUp(v, v + 3, v + 2); } s += period; }
    acc += L;
  }
}
// a steel rail along p, off across from it: a dark web and a polished head 0.17 m high, mitred at the joints like a ribbon
const RAIL_SIDE = [87, 80, 74], RAIL_HEAD = [167, 163, 156];
function railBar(b, p, off, hw = 0.036, h = 0.17) {
  const n = p.length >> 1; if (n < 2) return; const v0 = b.v; b.ensure(n * 6);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1); let tx = p[2 * c] - p[2 * a], tz = p[2 * c + 1] - p[2 * a + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    let m = 1; if (i > 0 && i < n - 1) { const sx = p[2 * i] - p[2 * a], sz = p[2 * i + 1] - p[2 * a + 1], sl = Math.hypot(sx, sz) || 1; m = 1 / Math.max(0.5, (sx * tx + sz * tz) / sl); }
    const nx = -tz, nz = tx, x = p[2 * i], z = p[2 * i + 1], xl = x + nx * (off - hw) * m, zl = z + nz * (off - hw) * m, xr = x + nx * (off + hw) * m, zr = z + nz * (off + hw) * m;
    b.vert(xl, 0, zl, -nx, 0, -nz, RAIL_SIDE); b.vert(xl, h, zl, -nx, 0, -nz, RAIL_SIDE); b.vert(xl, h, zl, 0, 1, 0, RAIL_HEAD); b.vert(xr, h, zr, 0, 1, 0, RAIL_HEAD); b.vert(xr, h, zr, nx, 0, nz, RAIL_SIDE); b.vert(xr, 0, zr, nx, 0, nz, RAIL_SIDE);
  }
  for (let i = 0; i < n - 1; i++) { const k = v0 + 6 * i, q = k + 6; b.tri(k, k + 1, q); b.tri(k + 1, q + 1, q); b.tri(k + 2, k + 3, q + 2); b.tri(k + 3, q + 3, q + 2); b.tri(k + 5, q + 5, k + 4); b.tri(k + 4, q + 5, q + 4); }
}
/* 18. novembra iela across the overpass has four lanes (Street View, April 2024): the carriageway along the centre line
   of the corridor reaches to 0.4 m short of the guard rails. Per point of dp the half width, the ordinary one past the
   corridor, eased over 12 m either way; null for a line that does not run along the centre line. */
function ovWidths(dp, hw) {
  const m = dp.length >> 1, W = []; let on = 0;
  for (let i = 0; i < m; i++) { const w = ovRoadHW(dp[2 * i], dp[2 * i + 1]); if (w !== null) on++; W.push(w === null ? hw : Math.max(hw, w)); }
  if (on < m / 2) return null;
  return W.map((_, i) => { let a = 0, k = 0; for (let j = Math.max(0, i - 3); j <= Math.min(m - 1, i + 3); j++) { a += W[j]; k++; } return a / k; });
}
const LAMPS = [];
async function buildLines() {
  if (TERR.on) ovPrep();
  const groups = [0, 1, 2, 3, 4, 5].map(() => new GB(false)), lineCol = {}; for (const k in LINE) lineCol[k] = hb(LINE[k][1]);
  const walk = groups[1], marks = groups[5], extra = new GB(false);
  const PAVE = hb('#8f897e'), CURB = hb('#a9a69e'), WHITE = hb('#e8e6df'), RAIL = hb('#4a4440'), SLEEP = hb('#635d56'), GRAVEL = hb('#8b8475');
  const sorted = C.l.map(l => ({ cls: l[0], name: l[1], pts: dec(l[2]), bridge: !!l[3] }));
  // the carriageways from the least to the main streets, so a main street is laid over the service roads that join it
  // (the comparator used to leave the other lines in between, which left that order to the sort and let some service roads lie over 18. novembra iela)
  const rank = l => l.cls <= 4 ? 4 - l.cls : 5;
  sorted.sort((a, b) => rank(a) - rank(b));
  /* Joints. OSM splits a street into ways at many nodes where nothing else meets it, and each piece was laid with square
     ends across its own last segment: where the two turn there, even by a few degrees, a wedge of ground showed between
     them from the centre line out, widest at the outer edge of the sidewalk (in the fortress by the Konstantin gate,
     where two living streets meet at 3°). Where exactly two lines of the same class end at a node (or a closed line
     meets itself) and turn there by less than 60°, both ends are cut across the bisector of the two, the way a ribbon
     is mitred at its inner points, so the two pieces meet edge to edge as if they were one way. Not between classes: a
     narrower piece (a footway on from a street) would leave bare the inner corner the wider one gives up; nor at a
     sharper turn or where the inner corner would draw back past the first point of either line, which would fold the
     ribbon: those keep their square ends. JOINT: the line ends at each node of the data. */
  const JOINT = new Map(), jKey = (x, z) => Math.round(x * 10) + ',' + Math.round(z * 10);
  sorted.forEach((l, li) => { if (!LINE[l.cls] || l.cls === 10 || l.cls === 11) return; const p = l.pts, n = p.length;
    for (const end of [0, 1]) { const k = jKey(end ? p[n - 2] : p[0], end ? p[n - 1] : p[1]); let a = JOINT.get(k); if (!a) JOINT.set(k, a = []); a.push([li, end]); } });
  // for line li laid along dp: [first, last] the directions its ends are cut across (frame's E), null for a square end
  function jointEnds(li, dp) {
    const l = sorted[li]; if (l.cls === 9) return null;   // the tram tracks are laid in runs of their own
    const p = l.pts, n = p.length, m = dp.length, E = [null, null];
    for (const end of [0, 1]) {
      const x = end ? p[n - 2] : p[0], z = end ? p[n - 1] : p[1], at = JOINT.get(jKey(x, z)); if (!at || at.length !== 2) continue;
      if (Math.abs((end ? dp[m - 2] : dp[0]) - x) > 0.01 || Math.abs((end ? dp[m - 1] : dp[1]) - z) > 0.01) continue;   // its end was moved
      const [lj, ej] = at[0][0] === li && at[0][1] === end ? at[1] : at[0], q = sorted[lj].pts, nq = q.length; if (sorted[lj].cls !== l.cls) continue;
      // each line's first segment away from the node, from the data on both sides so the two lines agree on the cut
      const fx = (end ? p[n - 4] : p[2]) - x, fz = (end ? p[n - 3] : p[3]) - z, gx = (ej ? q[nq - 4] : q[2]) - x, gz = (ej ? q[nq - 3] : q[3]) - z;
      const fl = Math.hypot(fx, fz), gl = Math.hypot(gx, gz); if (fl < 1e-3 || gl < 1e-3) continue;
      const cos = -(fx * gx + fz * gz) / (fl * gl); if (cos < 0.5) continue;   // the turn, from the other line on into this one
      const reach = (LINE[l.cls][0] / 2 + (l.cls <= 3 ? 2.7 : 0)) * Math.sqrt((1 - cos) / (1 + cos));   // how far the inner corner of the sidewalk draws back
      if (reach >= Math.min(fl, gl)) continue;
      const tx = fx / fl - gx / gl, tz = fz / fl - gz / gl, tl = (end ? -1 : 1) * Math.hypot(tx, tz);
      E[end] = [tx / tl, tz / tl];   // along the line: from the other line into this one at its start, on into it at its end
    }
    return E[0] || E[1] ? E : null;
  }
  let lampSeq = 0; const lampGrid = new Set(), tramLater = [];
  /* Dual carriageways. OSM maps many main streets as two one-way ways side by side, and the data keep neither the
     one-way flag nor the lanes, so each way was drawn as a whole two-way street 6–11 m wide. On 18. novembra iela west of
     the overpass, where the two ways run 3–10 m apart, the carriageways overlapped with their centre lines, edge lines
     and sidewalks. A road most of whose points have beside them (not ahead) another way of the same name and class
     running parallel 3–26 m away is one carriageway of a pair: a lane wide where the two run 8 m apart or less, two
     lanes from 11 m; a median under 4.5 m is painted asphalt with a double line, a wider one is left to the ground; the
     sidewalk, the kerb and the lamps go on the outer side only. */
  const PAIR = new SegGrid(40), TRK = new SegGrid(20), MED = new SegGrid(20);   // MED: the asphalt medians with tracks in them
  sorted.forEach((l, li) => { if ((l.cls <= 3 && l.name >= 0) || l.cls === 9) for (let i = 0; i < l.pts.length - 2; i += 2) (l.cls === 9 ? TRK : PAIR).add(l.pts[i], l.pts[i + 1], l.pts[i + 2], l.pts[i + 3], li, 0); });
  // the ends of the named streets: how many other lines of the same street end within 2.5 m of (x, z)
  const ENDS = []; sorted.forEach((l, li) => { if (l.cls <= 3 && l.name >= 0) { const p = l.pts, n = p.length; ENDS.push([p[0], p[1], li], [p[n - 2], p[n - 1], li]); } });
  /* One-way ramps (OSM oneway, street-tags.js) that leave the end of a two-way road together, as at both ends of the
     teardrop junction at Vienības tilts: OSM starts both from the road's end node, so their kerbs and edge lines crossed
     in a V. Each is laid in its half of the road it splits from (a lane's half width aside at the node), turning back to
     its own line over 30 m. */
  const ONE = []; sorted.forEach((l, li) => { if (l.cls <= 3) { const t = streetTags(l.pts); if (t && t.oneway) { const p = l.pts, n = p.length; ONE.push([p[0], p[1], li, 0], [p[n - 2], p[n - 1], li, 1]); } } });
  const dirFrom = (p, end) => { const n = p.length >> 1; let acc = 0, x = end ? p[2 * n - 2] : p[0], z = end ? p[2 * n - 1] : p[1]; const x0 = x, z0 = z;
    for (let k = 1; k < n && acc < 15; k++) { const i = end ? n - 1 - k : k; acc += Math.hypot(p[2 * i] - x, p[2 * i + 1] - z); x = p[2 * i]; z = p[2 * i + 1]; }
    const l = Math.hypot(x - x0, z - z0) || 1; return [(x - x0) / l, (z - z0) / l]; };
  function splitApart(li, pts, dp, hw) {
    const n = pts.length, m = dp.length >> 1;
    for (const end of [0, 1]) {
      const ex = end ? pts[n - 2] : pts[0], ez = end ? pts[n - 1] : pts[1], near = o => Math.abs(o[0] - ex) < 1 && Math.abs(o[1] - ez) < 1;
      const sibs = ONE.filter(o => o[2] !== li && near(o)); if (sibs.length !== 1 || !ENDS.some(o => near(o) && !ONE.some(q => q[2] === o[2]))) continue;
      const a = dirFrom(pts, end), b = dirFrom(sorted[sibs[0][2]].pts, sibs[0][3]); let bx = a[0] + b[0], bz = a[1] + b[1]; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      let px = -bz, pz = bx; if (px * a[0] + pz * a[1] < 0) { px = -px; pz = -pz; }
      const idx = Array.from({ length: m }, (_, k) => end ? m - 1 - k : k), cum = [0]; for (let k = 1; k < m; k++) cum.push(cum[k - 1] + Math.hypot(dp[2 * idx[k]] - dp[2 * idx[k - 1]], dp[2 * idx[k] + 1] - dp[2 * idx[k - 1] + 1]));
      for (let k = 0; k < m && cum[k] < 30; k++) { const t = cum[k] / 30, w = hw * (1 - t * t * (3 - 2 * t)), i = idx[k]; dp[2 * i] += px * w; dp[2 * i + 1] += pz * w; }
    }
  }
  const splitAt = (li, x, z) => { const me = sorted[li], seen = new Set();
    for (const [ex, ez, lj] of ENDS) if (lj !== li && Math.abs(ex - x) < 2.5 && Math.abs(ez - z) < 2.5 && sorted[lj].name === me.name && sorted[lj].cls === me.cls) seen.add(lj);
    return seen.size; };
  const partner = (li, x, z, tx, tz) => { const me = sorted[li]; let best = null;
    PAIR.near(x, z, 26, (id, d, px, pz) => { const s = PAIR.s, lj = s[id * 6 + 4], o = sorted[lj]; if (lj === li || o.cls !== me.cls || o.name !== me.name || d < 3) return;
      if (o.oneTag === undefined) { const t = streetTags(o.pts); o.oneTag = !!t && !!t.oneway; } if (o.oneTag) return;   // a one-way ramp is no carriageway of a pair (Daugavas iela at the bridge)
      const dx = s[id * 6 + 2] - s[id * 6], dz = s[id * 6 + 3] - s[id * 6 + 1], l = Math.hypot(dx, dz) || 1; if (Math.abs((dx * tx + dz * tz) / l) < 0.9) return;
      if (Math.abs((px - x) * tx + (pz - z) * tz) > 0.3 * d) return;
      if (!best || d < best.d) best = { d, s: Math.sign((px - x) * -tz + (pz - z) * tx) || 1 }; });
    return best; };
  function dualOf(li, pts, dp, lanes) {   // per point of dp: the distance to the other carriageway and the half width; null if not a pair
    let n = 0, hit = 0;
    for (let i = 0; i < pts.length - 2; i += 2) { const dx = pts[i + 2] - pts[i], dz = pts[i + 3] - pts[i + 1], sl = Math.hypot(dx, dz); if (sl < 0.5) continue; const tx = dx / sl, tz = dz / sl;
      for (let s = 0; s < sl; s += 6) { n++; if (partner(li, pts[i] + tx * s, pts[i + 1] + tz * s, tx, tz)) hit++; } }
    if (!n || hit / n < 0.5) return null;
    const m = dp.length >> 1, D = new Array(m).fill(null), S = new Array(m).fill(0);
    for (let i = 0; i < m; i++) { const a = Math.max(0, i - 1), c = Math.min(m - 1, i + 1), tx = dp[2 * c] - dp[2 * a], tz = dp[2 * c + 1] - dp[2 * a + 1], l = Math.hypot(tx, tz) || 1;
      const q = partner(li, dp[2 * i], dp[2 * i + 1], tx / l, tz / l); if (q) { D[i] = q.d; S[i] = q.s; } }
    // the side most of it has; where the other way is missing (past its ends) the nearest known distance; smoothed
    const side = Math.sign(S.reduce((a, b) => a + b, 0)) || 1; let last = null;
    for (let i = 0; i < m; i++) { if (D[i] === null || S[i] !== side) D[i] = last; else last = D[i]; }
    last = null; for (let i = m - 1; i >= 0; i--) { if (D[i] === null) D[i] = last; else last = D[i]; }
    if (D[0] === null) return null;
    /* Where the pair splits off a single road, OSM joins both carriageways to the end node of that road, so over the last
       10–20 m their centre lines run together into a point. At the west end of the overpass bridge they did, and the edge
       lines, kerbs and sidewalks of the two carriageways cut in a V across the four lanes of the bridge. There the end of
       each carriageway is laid straight on, the way it comes from 30–55 m out: the two stay apart at the distance they
       settled at, and carry on the edges of the road they split from. */
    if (dp !== pts) for (const end of [0, 1]) {
      const np = pts.length; if (splitAt(li, end ? pts[np - 2] : pts[0], end ? pts[np - 1] : pts[1]) < 2) continue;
      const idx = Array.from({ length: m }, (_, k) => end ? m - 1 - k : k), cum = [0]; let acc = 0;
      for (let k = 1; k < m; k++) { const i = idx[k], j = idx[k - 1]; acc += Math.hypot(dp[2 * i] - dp[2 * j], dp[2 * i + 1] - dp[2 * j + 1]); cum.push(acc); }
      if (acc < 45) continue;
      const at = sv => { let k = 0; while (k < m - 2 && cum[k + 1] < sv) k++; const i = idx[k], j = idx[k + 1], t = Math.max(0, Math.min(1, (sv - cum[k]) / ((cum[k + 1] - cum[k]) || 1)));
        return [dp[2 * i] + (dp[2 * j] - dp[2 * i]) * t, dp[2 * i + 1] + (dp[2 * j + 1] - dp[2 * i + 1]) * t]; };
      const A = at(30), B = at(Math.min(55, acc)), tl = Math.hypot(A[0] - B[0], A[1] - B[1]) || 1, tx = (A[0] - B[0]) / tl, tz = (A[1] - B[1]) / tl;
      const kA = cum.findIndex(c => c >= 30), dRef = D[idx[kA]];
      for (let k = 0; k < kA; k++) { const i = idx[k], r = 30 - cum[k]; dp[2 * i] = A[0] + tx * r; dp[2 * i + 1] = A[1] + tz * r; if (D[i] < dRef) D[i] = dRef; }
    }
    const Ds = D.map((_, i) => { let a = 0, k = 0; for (let j = Math.max(0, i - 2); j <= Math.min(m - 1, i + 2); j++) { a += D[j]; k++; } return a / k; });
    /* lanes of 3.25 m where OSM gives their number (where the two carriageways run closer than their width, up to the
       middle between them); otherwise guessed from the distance */
    const H = Ds.map(d => lanes ? Math.min(lanes * 1.625, Math.max(1.85, d / 2)) : Math.max(1.85, Math.min(3.4, 1.85 + (d - 8) * 0.5)));
    const trm = Ds.map((d, i) => { const a = Math.max(0, i - 1), c = Math.min(m - 1, i + 1), tx = dp[2 * c] - dp[2 * a], tz = dp[2 * c + 1] - dp[2 * a + 1], l = Math.hypot(tx, tz) || 1;
      const cx = dp[2 * i] - tz / l * side * d / 2, cz = dp[2 * i + 1] + tx / l * side * d / 2; let t = false; TRK.near(cx, cz, Math.max(0.5, d / 2 - 0.6 * H[i]), () => { t = true; }); return t; });
    /* A narrow median is asphalt: painted under 4 m, or under 4.5 m where tram tracks run in it (by the overpass bridge):
       too narrow for a track bed of its own, the rails lie flush between the lanes as on the bridge. The width is taken
       over ±30 m and runs shorter than 25 m join their neighbours: a median of 4–5 m (Latgales iela) went from painted to
       grass and back every few metres, the two carriageways each deciding for themselves. */
    const cumD = [0]; for (let i = 1; i < m; i++) cumD.push(cumD[i - 1] + Math.hypot(dp[2 * i] - dp[2 * i - 2], dp[2 * i + 1] - dp[2 * i - 1]));
    const paint = Ds.map((d, i) => { let a = 0, k = 0; for (let j = i; j >= 0 && cumD[i] - cumD[j] <= 30; j--) { a += Ds[j] - 2 * H[j]; k++; } for (let j = i + 1; j < m && cumD[j] - cumD[i] <= 30; j++) { a += Ds[j] - 2 * H[j]; k++; }
      return a / k < (trm[i] ? 4.5 : 4.0); });
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < m;) { let j = i; while (j < m && paint[j] === paint[i]) j++;
      if ((i > 0 || j < m) && (cumD[j - 1] - cumD[i]) < 25) for (let k = i; k < j; k++) paint[k] = !paint[k];
      i = j; }
    // no sidewalk on the outer side where a tram bed runs alongside instead (the ramp west of the overpass)
    const bed = H.map((h, i) => { const a = Math.max(0, i - 1), c = Math.min(m - 1, i + 1), tx = dp[2 * c] - dp[2 * a], tz = dp[2 * c + 1] - dp[2 * a + 1], l = Math.hypot(tx, tz) || 1, o = -side * (h + 1.4);
      let t = false; TRK.near(dp[2 * i] - tz / l * o, dp[2 * i + 1] + tx / l * o, 2.5, () => { t = true; }); return t; });
    return { side, D: Ds, H, paint, trm, bed };
  }
  // the diagonal hatching of a painted median from the edge of the lane (off a) to its middle (off b), s the side of it;
  // no stripe where cut(x, z, tx, tz) says the middle of it lies in a junction
  function hatch(b, p, A, B, s, col, cut) {
    let acc = 0; const n = p.length >> 1;
    for (let i = 0; i < n - 1; i++) {
      const x1 = p[2 * i], z1 = p[2 * i + 1], L = Math.hypot(p[2 * i + 2] - x1, p[2 * i + 3] - z1); if (L < 0.01) continue;
      const tx = (p[2 * i + 2] - x1) / L, tz = (p[2 * i + 3] - z1) / L, nx = -tz * s, nz = tx * s, a = A[i], w = B[i] - A[i];
      for (let t = (6 - acc % 6) % 6; t < L; t += 6) {
        if (w < 1.1) continue;   // no stubs where the median is only just wider than a double line
        const v = b.v, P = (u, o, e) => [x1 + tx * (u + e) + nx * o, z1 + tz * (u + e) + nz * o], m = P(t + w / 2, a + w / 2, 0);
        if (cut(m[0], m[1], tx, tz)) continue;
        const q = [P(t, a, -0.2), P(t, a, 0.2), P(t + w, a + w, -0.2), P(t + w, a + w, 0.2)]; for (const [x, z] of q) b.vert(x, 0, z, 0, 1, 0, col);
        b.triUp(v, v + 1, v + 3); b.triUp(v, v + 3, v + 2); }
      acc += L;
    }
  }
  /* Markings stop at junctions. They were drawn straight through every crossing, so the edge lines, centre dashes and
     kerbs of one street ran across the carriageway of the other (on 18. novembra iela at each of its junctions). Now the
     markings are collected while the streets are laid and painted once all of them are known, cut where they enter the
     carriageway of a street that crosses (not the next piece of the same street, nor one running alongside) or a painted
     median. The pedestrian crossings OSM maps as short footways across a main street get a zebra, and the centre and
     lane lines stop at it. */
  const ZR = new SegGrid(30), ZEB = new SegGrid(20), JOBS = [], HATCH = []; let zMax = 1;   // ZR: carriageways and painted medians
  const addZone = (x1, z1, x2, z2, li, hw) => { ZR.add(x1, z1, x2, z2, li, hw); if (hw > zMax) zMax = hw; };
  // the polyline p moved off to the side (off: a number, or one per point), mitred at the joints like a ribbon (E as in frame)
  function offPoly(p, off, E = null) {
    const n = p.length >> 1, q = new Array(2 * n);
    for (let i = 0; i < n; i++) { const [tx, tz, m] = frame(p, i, n, E), o = (typeof off === 'number' ? off : off[i]) * m; q[2 * i] = p[2 * i] - tz * o; q[2 * i + 1] = p[2 * i + 1] + tx * o; }
    return q; }
  /* a marking of line li along p at off (a number or one per point), half width w; kind 'k' a kerb, 'e' an edge line,
     'c' a centre or lane line (these also stop at zebras); dash [on, period] for a broken line; keep: per point, where
     the marking runs (all along when absent) */
  function mark(li, p, off, w, col, kind, dash = null, keep = null) {
    const L = sorted[li], q = offPoly(p, off, L.dp === p ? L.je : null), n = q.length >> 1, job = (qq, i0) => JOBS.push({ li, p, i0, q: qq, w, col, kind, dash, gbc: STATE.GBC });
    if (!keep) { job(q, 0); return; }
    let s = -1; for (let i = 0; i <= n; i++) { const k = i < n && keep[i]; if (k && s < 0) s = i; if (!k && s >= 0) { if (i - s >= 2) job(q.slice(2 * s, 2 * i), s); s = -1; } } }
  /* the zones near (x, z) within r that may cut a marking of line li running along (tx, tz): the carriageways of the
     streets that cross it and the painted medians (type 0), service roads (1, only the kerbs stop at them) and the zebras
     (2, only the centre and lane lines); each [x1, z1, dx, dz, |d|², radius², type] */
  const ZNONE = []; let zSeen = null, zStamp = 0;
  function zonesNear(li, x, z, r, tx, tz) {
    const me = sorted[li], s = ZR.s, e = ZEB.s; let out = ZNONE; zStamp++;
    const put = (k, g, rr, type) => { const dx = g[k + 2] - g[k], dz = g[k + 3] - g[k + 1]; if (out === ZNONE) out = []; out.push([g[k], g[k + 1], dx, dz, dx * dx + dz * dz || 1e-9, rr * rr, type]); };
    ZR.near(x, z, r + zMax, id => { if (zSeen[id] === zStamp) return; zSeen[id] = zStamp; const k = id * 6, lj = s[k + 4]; if (lj === li) return; const o = sorted[lj];
      if (me.name >= 0 && o.name === me.name && o.cls === me.cls && !(me.one && o.one)) return;   // the same street: its next piece, the other carriageway (one-way ramps crossing in a junction do cut each other)
      const dx = s[k + 2] - s[k], dz = s[k + 3] - s[k + 1], l = Math.hypot(dx, dz) || 1; if (Math.abs((dx * tx + dz * tz) / l) > 0.94) return;   // alongside
      put(k, s, s[k + 5] + 0.15, o.cls === 4 ? 1 : 0); });
    ZEB.near(x, z, r + 3, id => put(id * 6, e, e[id * 6 + 5], 2));
    return out; }
  function inZones(Z, kind, x, z) {
    for (let j = 0; j < Z.length; j++) { const c = Z[j]; if ((c[6] === 1 && kind !== 'k') || (c[6] === 2 && kind !== 'c')) continue;
      let t = ((x - c[0]) * c[2] + (z - c[1]) * c[3]) / c[4]; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - c[0] - c[2] * t, ez = z - c[1] - c[3] * t; if (ex * ex + ez * ez < c[5]) return true; }
    return false; }
  // the zones near segment i of the polyline p that line li is drawn along, found once for all the markings of the line
  const zCache = new Map();
  function segZones(li, p, i) {
    let c = zCache.get(li); if (!c) zCache.set(li, c = []);
    if (c[i] === undefined) { const ax = p[2 * i], az = p[2 * i + 1], bx = p[2 * i + 2], bz = p[2 * i + 3], L = Math.hypot(bx - ax, bz - az) || 1e-9;
      c[i] = zonesNear(li, (ax + bx) / 2, (az + bz) / 2, L / 2 + 9, (bx - ax) / L, (bz - az) / L); }
    return c[i]; }
  // the part of the segment (ax, az) + t (dx, dz), 0 ≤ t ≤ 1, inside the capsule c (a zone): [t0, t1], or null
  function capInt(ax, az, dx, dz, c) {
    const px = c[0], pz = c[1], ex = c[2], ez = c[3], el2 = c[4], r2 = c[5], dd = dx * dx + dz * dz || 1e-12; let lo = Infinity, hi = -Infinity;
    for (const [cx, cz] of [[px, pz], [px + ex, pz + ez]]) {   // the round ends
      const fx = ax - cx, fz = az - cz, b = fx * dx + fz * dz, disc = b * b - dd * (fx * fx + fz * fz - r2); if (disc <= 0) continue;
      const sq = Math.sqrt(disc); lo = Math.min(lo, (-b - sq) / dd); hi = Math.max(hi, (-b + sq) / dd); }
    // the band between them: 0 ≤ along ≤ 1 and |across| < r, both linear in t
    const el = Math.sqrt(el2), r = Math.sqrt(r2); let t0 = -Infinity, t1 = Infinity;
    const within = (c0, c1, mn, mx) => { if (Math.abs(c1) < 1e-12) { if (c0 <= mn || c0 >= mx) t0 = Infinity; return; } let u = (mn - c0) / c1, v = (mx - c0) / c1; if (u > v) [u, v] = [v, u]; t0 = Math.max(t0, u); t1 = Math.min(t1, v); };
    within(((ax - px) * ex + (az - pz) * ez) / el2, (dx * ex + dz * ez) / el2, 0, 1);
    within(((ax - px) * ez - (az - pz) * ex) / el, (dx * ez - dz * ex) / el, -r, r);
    if (t0 < t1) { lo = Math.min(lo, t0); hi = Math.max(hi, t1); }
    return hi <= 0 || lo >= 1 || lo >= hi ? null : [Math.max(0, lo), Math.min(1, hi)];   // a capsule is convex: one interval
  }
  // the runs of a marking outside the zones that apply to its kind
  function clipRuns(J) {
    const q = J.q, n = q.length >> 1, runs = [], kind = J.kind; let cur = null;
    const end = () => { if (cur && cur.length >= 4) { let len = 0; for (let k = 0; k < cur.length - 2; k += 2) len += Math.hypot(cur[k + 2] - cur[k], cur[k + 3] - cur[k + 1]); if (len > 0.4) runs.push(cur); } cur = null; };
    for (let i = 0; i < n - 1; i++) {
      const ax = q[2 * i], az = q[2 * i + 1], bx = q[2 * i + 2], bz = q[2 * i + 3], dx = bx - ax, dz = bz - az; if (dx * dx + dz * dz < 1e-8) continue;
      const Z = segZones(J.li, J.p, J.i0 + i); let iv = null;
      for (let j = 0; j < Z.length; j++) { const c = Z[j]; if ((c[6] === 1 && kind !== 'k') || (c[6] === 2 && kind !== 'c')) continue; const r = capInt(ax, az, dx, dz, c); if (r) (iv || (iv = [])).push(r); }
      if (!iv) { if (!cur) cur = [ax, az]; cur.push(bx, bz); continue; }
      iv.sort((a, b) => a[0] - b[0]); let t = 0;
      for (const [u, v] of iv) { if (v <= t) continue; if (u > t + 1e-6) { if (!cur) cur = [ax + dx * t, az + dz * t]; cur.push(ax + dx * u, az + dz * u); } end(); t = v; }
      if (t < 1 - 1e-6) cur = [ax + dx * t, az + dz * t, bx, bz];
    }
    end(); return runs;
  }
  // pedestrian crossings: a short footway (under 45 m) across the carriageway of a main street (classes 0-2) at more than 65°
  function zebras() {
    const out = [], seen = new Set(), s = ZR.s;
    for (const f of sorted) { if (f.cls !== 6) continue; const p = f.pts; let len = 0; for (let i = 0; i < p.length - 2; i += 2) len += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); if (len > 45) continue;
      for (let i = 0; i < p.length - 2; i += 2) { const cx = p[i], cz = p[i + 1], ex = p[i + 2] - cx, ez = p[i + 3] - cz, fl = Math.hypot(ex, ez); if (fl < 0.5) continue;
        ZR.near(cx + ex / 2, cz + ez / 2, fl / 2 + 0.5, id => { const k = id * 6, lj = s[k + 4], o = sorted[lj]; if (o.cls > 2 || !o.zone) return;
          const px = s[k], pz = s[k + 1], rx = s[k + 2] - px, rz = s[k + 3] - pz, rl = Math.hypot(rx, rz); if (rl < 0.5 || s[k + 5] !== o.zone) return;   // not a median
          if (Math.abs((rx * ex + rz * ez) / (rl * fl)) > 0.42) return;
          const den = rx * ez - rz * ex; if (Math.abs(den) < 1e-9) return;
          const t = ((cx - px) * ez - (cz - pz) * ex) / den, u = ((cx - px) * rz - (cz - pz) * rx) / den; if (t < 0 || t > 1 || u < 0 || u > 1) return;
          const x = px + rx * t, z = pz + rz * t, key = lj + ':' + Math.round(x / 5) + ',' + Math.round(z / 5); if (seen.has(key)) return; seen.add(key);
          out.push({ x, z, tx: rx / rl, tz: rz / rl, hw: o.zone, li: lj }); }); } }
    // on 18. novembra iela the crossings OSM maps as nodes replace the guess: a zebra where marked, none where not
    if (N18 >= 0) {
      const kept = out.filter(Z => sorted[Z.li].name !== N18); out.length = 0; out.push(...kept);
      for (const [x, z, marked] of CROSSINGS) { if (!marked) continue; let best = null;
        ZR.near(x, z, 2, (id, d, px, pz) => { const k = id * 6, lj = s[k + 4], o = sorted[lj]; if (o.name !== N18 || s[k + 5] !== o.zone || (best && d >= best.d)) return;
          const rx = s[k + 2] - s[k], rz = s[k + 3] - s[k + 1], rl = Math.hypot(rx, rz) || 1; best = { d, x: px, z: pz, tx: rx / rl, tz: rz / rl, hw: o.zone, li: lj }; });
        if (best) out.push(best); } }
    // around Latgales iela and its roundabouts the same from the crossings OSM maps there, on any street drawn with a zone
    { const kept = out.filter(Z => !CROSSINGS_LAT.some(([x, z]) => Math.hypot(Z.x - x, Z.z - z) < 6)); out.length = 0; out.push(...kept); }
    for (const [x, z, marked] of CROSSINGS_LAT) { if (!marked) continue; let best = null;
      ZR.near(x, z, 2.5, (id, d, px, pz) => { const k = id * 6, lj = s[k + 4], o = sorted[lj]; if (!o.zone || s[k + 5] !== o.zone || (best && d >= best.d)) return;
        const rx = s[k + 2] - s[k], rz = s[k + 3] - s[k + 1], rl = Math.hypot(rx, rz) || 1; best = { d, x: px, z: pz, tx: rx / rl, tz: rz / rl, hw: o.zone, li: lj }; });
      if (best) out.push(best); }
    return out; }
  const N18 = C.names.indexOf('18. novembra iela');
  /* the ballast of a railway track reaches half way to the next track alongside (closer than 9 m): a station's or a
     yard's tracks lie in one bed of ballast, not each on its own strip in the grass */
  const RAILS = new SegGrid(20); sorted.forEach((l, li) => { if (l.cls === 8) for (let i = 0; i + 3 < l.pts.length; i += 2) RAILS.add(l.pts[i], l.pts[i + 1], l.pts[i + 2], l.pts[i + 3], 0, li); });
  const railBed = (li, dp, hw) => {
    const m = dp.length >> 1, A = new Array(m).fill(-hw), B = new Array(m).fill(hw), rs = RAILS.s;
    for (let i = 0; i < m; i++) { const a = Math.max(0, i - 1), c = Math.min(m - 1, i + 1), tx = dp[2 * c] - dp[2 * a], tz = dp[2 * c + 1] - dp[2 * a + 1], l = Math.hypot(tx, tz) || 1, ux = tx / l, uz = tz / l, x = dp[2 * i], z = dp[2 * i + 1];
      RAILS.near(x, z, 9, (id, d, px, pz) => { const k = id * 6; if (rs[k + 5] === li) return; const ex = rs[k + 2] - rs[k], ez = rs[k + 3] - rs[k + 1], el = Math.hypot(ex, ez) || 1; if (Math.abs((ex * ux + ez * uz) / el) < 0.8) return;
        const lat = (px - x) * -uz + (pz - z) * ux; if (Math.abs(lat) < 2.5) return; const half = Math.min(4.6, Math.abs(lat) / 2 + 0.15);
        if (lat > 0) B[i] = Math.max(B[i], half); else A[i] = Math.min(A[i], -half); }); }
    const sm = (V, f) => V.map((_, i) => { let v = V[i]; for (let j = Math.max(0, i - 2); j <= Math.min(m - 1, i + 2); j++) v = f(v, V[j]); return v; });
    return [sm(A, Math.max), sm(B, Math.min)];   // a neighbour that comes and goes for a point or two makes no notch
  };
  for (let li = 0; li < sorted.length; li++) {
    if (due()) await pause();
    const l = sorted[li], { cls, pts } = l; const n = pts.length >> 1;
    if (cls === 12 || cls === 13 || cls === 14) {
      if (fortSkipLine(cls, pts)) continue;   // the fortress draws its own walls and earthworks
      /* an embankment is in the terrain model already (bare earth by lidar). The ridge, 3 m high and 10 m wide, came from
         before the terrain: it stood a second time on the top edge where OSM draws the line, so on the dam of Daugavas iela
         two of them walled in the street and covered its carriageway */
      if (cls === 14 && TERR.on) continue;
      const h = cls === 13 ? 5.5 : cls === 12 ? 2 : 3, hw = cls === 13 ? 1.1 : cls === 12 ? 0.2 : 5, col = hb(cls === 13 ? '#8a6e5c' : cls === 12 ? '#a39d92' : '#6b8a4d');
      for (let i = 0; i < n - 1; i++) {
        const x1 = pts[2 * i], z1 = pts[2 * i + 1], x2 = pts[2 * i + 2], z2 = pts[2 * i + 3]; const L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.2) continue;
        const nx = (z2 - z1) / L * hw, nz = -(x2 - x1) / L * hw;
        if (cls === 14) { polyA(extra, [[x1 + nx, 0, z1 + nz], [x2 + nx, 0, z2 + nz], [x2, h, z2], [x1, h, z1]], col, nx, 2, nz); polyA(extra, [[x1 - nx, 0, z1 - nz], [x2 - nx, 0, z2 - nz], [x2, h, z2], [x1, h, z1]], sh(col, 0.9), -nx, 2, -nz); }
        else {
          polyA(extra, [[x1 + nx, 0, z1 + nz], [x2 + nx, 0, z2 + nz], [x2 + nx, h, z2 + nz], [x1 + nx, h, z1 + nz]], col, nx, 0, nz);
          polyA(extra, [[x1 - nx, 0, z1 - nz], [x2 - nx, 0, z2 - nz], [x2 - nx, h, z2 - nz], [x1 - nx, h, z1 - nz]], col, -nx, 0, -nz);
          polyA(extra, [[x1 + nx, h, z1 + nz], [x2 + nx, h, z2 + nz], [x2 - nx, h, z2 - nz], [x1 - nx, h, z1 - nz]], sh(col, 1.1), 0, 1, 0);
          COL.add(x1, z1, x2, z2, hw, 0);
        }
      }
      continue;
    }
    const def = LINE[cls]; if (!def) continue;
    if (cls === 10 || cls === 11) { // drop river centre lines that run inside the river polygon
      let inside = 0; for (let i = 0; i < n - 1; i++) if (inWater((pts[2 * i] + pts[2 * i + 2]) / 2, (pts[2 * i + 1] + pts[2 * i + 3]) / 2)) inside++;
      if (inside > (n - 1) * 0.3) continue;
    }
    l.bb = bbox(pts); l.w = def[0]; LINES.push(l);
    if (spwTrackLine(cls, pts)) continue;   // the speedway track: lmSpeedway lays the whole track, the line stays on the map
    const hw = def[0] / 2;
    if (l.bridge && vbOnLine(pts)) {   // on Vienības tilts: lmVienibas draws the deck, the line still guides traffic and walking
      if (cls <= 4) for (let i = 0; i < n - 1; i++) CARROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, cls);
      for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw + (cls <= 3 ? 2.6 : 0), cls <= 7 ? l.name : -1);
      continue;
    }
    if (l.bridge && gubOnLine(pts)) {   // the boardwalk at Gubiščes ezers: lmGubisce draws its deck of planks, the line still guides walking
      for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, l.name);
      continue;
    }
    if (l.bridge && airOnLine(pts)) {   // the air bridge to Jaunā Forštadte: lmAirBridge draws it and sets its heights
      for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, l.name);
      continue;
    }
    // on the overpass of 18. novembra iela everything but the railway under it follows the corridor's own profile
    const onOv = TERR.on && cls !== 8 && cls !== 10 && cls !== 11 && ovTouches(l.bb);
    const onBridge = l.bridge && cls !== 10 && cls !== 11 && TERR.on && !onOv, dp = onOv ? ovDensify(densify(pts)) : TERR.on ? densify(pts) : pts;
    let jn = false;
    if (onOv) STATE.GBC = ovComp;
    else if (onBridge) { const B = bridgeOf(pts, hw + (cls <= 3 ? 2.7 : 0.3)); jn = jnFix(B); STATE.GBC = bridgeDeck(B); }
    else STATE.GBC = TERR.on && cls !== 10 && cls !== 11 && cutTouches(l.bb) ? cutComp : null;   // the road of the Latgales iela cutting keeps its profile
    if (cls === 10 || cls === 11) for (let i = 0; i < n - 1; i++) STREAM.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, 0);
    l.gbc = STATE.GBC;
    l.isDual = false;
    const tags = cls <= 3 ? streetTags(pts) : null, lanes4 = !!tags && tags.lanes >= 4, rural = !!tags && !!tags.rural, one = !!tags && !!tags.oneway; l.one = one;
    const dual = cls <= 3 && l.name >= 0 && !jn && !one ? dualOf(li, pts, dp, tags && tags.lanes) : null; l.isDual = !!dual; l.side = dual ? dual.side : 0;   // side: where the other carriageway of a pair is (+1 right of the line, the way it runs)
    let je = jointEnds(li, dp); l.dp = dp; l.je = je;   // after dualOf, which may move the ends of dp
    // four lanes: across the overpass from guard rail to guard rail, elsewhere 13 m where OSM says so
    const W = dual ? null : onOv && cls === 0 ? ovWidths(dp, lanes4 ? 6.5 : hw) : lanes4 ? new Array(dp.length >> 1).fill(6.5) : null;
    let hwC = hw;   // the half width that traffic, the tram tracks and the lamps go by
    if (dual) {   // one carriageway of a pair: s is the side of the other one
      const { side: s, D, H, paint, trm } = dual, m = dp.length >> 1, A = [], B = [];
      // a painted median: each carriageway's asphalt reaches 0.3 m past the middle, so the two always meet
      for (let i = 0; i < m; i++) { const inner = paint[i] ? D[i] / 2 + 0.3 : H[i]; if (s > 0) { A.push(-H[i]); B.push(inner); } else { A.push(-inner); B.push(H[i]); } }
      ribbonV(groups[def[2]], dp, A, B, lineCol[cls], je);
      for (let i = 0; i < m - 1; i++) if (paint[i] && paint[i + 1]) {   // a painted median cuts the markings of the streets crossing it; tracks in it lie flush
        const o = j => { const a = Math.max(0, j - 1), c = Math.min(m - 1, j + 1), tx = dp[2 * c] - dp[2 * a], tz = dp[2 * c + 1] - dp[2 * a + 1], l = Math.hypot(tx, tz) || 1; return [dp[2 * j] - tz / l * s * D[j] / 2, dp[2 * j + 1] + tx / l * s * D[j] / 2]; };
        const p0 = o(i), p1 = o(i + 1);
        addZone(p0[0], p0[1], p1[0], p1[1], li, Math.max(0.3, (D[i] + D[i + 1]) / 4 - (H[i] + H[i + 1]) / 2 + 0.05));
        if (trm[i] && trm[i + 1]) MED.add(p0[0], p0[1], p1[0], p1[1], (D[i] + D[i + 1]) / 4, 0); }
      mark(li, dp, H.map(h => -s * (h - 0.3)), 0.07, WHITE, 'e');                                          // the outer edge line
      /* the inner line: half of the double line on a narrow median, the lane's edge where it is wider (hatched up to the
         middle) or not painted; none where tram tracks run in the median */
      const narrow = D.map((d, i) => paint[i] && d - 2 * H[i] < 1.4), off = D.map((d, i) => s * (narrow[i] ? d / 2 - 0.13 : paint[i] ? H[i] - 0.05 : H[i] - 0.3));
      mark(li, dp, off, 0.065, WHITE, 'c', null, trm.map(t => !t));
      HATCH.push({ li, p: dp, A: H.map((h, i) => paint[i] && !narrow[i] && !trm[i] ? h + 0.1 : 0), B: D.map((d, i) => paint[i] && !narrow[i] && !trm[i] ? d / 2 : 0), s, gbc: STATE.GBC });
      hwC = H.slice().sort((a, b) => a - b)[H.length >> 1];
      mark(li, dp, 0, 0.07, WHITE, 'c', [3, 9], H.map(h => h >= 3));                                      // the line between two lanes, where there are two
      const wk = H.map((h, i) => dual.bed[i] ? h + 0.1 : h + 2.7);   // a sidewalk of no width beside a tram bed
      ribbonV(walk, dp, H.map((h, i) => s > 0 ? -wk[i] : h + 0.1), H.map((h, i) => s > 0 ? -(h + 0.1) : wk[i]), PAVE, je);
      mark(li, dp, H.map(h => -s * (h + 0.08)), 0.06, CURB, 'k');
    } else if (W) {   // 18. novembra iela with four lanes: a double centre line, broken lines between the lanes, the trams in the inner two
      const H = W, four = H.map(h => h >= 6);
      ribbonV(groups[def[2]], dp, H.map(h => -h), H, lineCol[cls], je);
      ribbonV(walk, dp, H.map(h => h + 0.1), H.map(h => h + 2.7), PAVE, je); ribbonV(walk, dp, H.map(h => -h - 2.7), H.map(h => -h - 0.1), PAVE, je);
      for (const sg of [1, -1]) {
        mark(li, dp, H.map(h => sg * (h + 0.08)), 0.12, CURB, 'k'); mark(li, dp, H.map(h => sg * (h - 0.45)), 0.07, WHITE, 'e');
        mark(li, dp, sg * 0.12, 0.06, WHITE, 'c', null, four);                                            // the double centre line
        mark(li, dp, H.map(h => sg * h / 2), 0.07, WHITE, 'c', [3, 9], four); }                           // between the lanes
      mark(li, dp, 0, 0.07, WHITE, 'c', [3, 9], four.map(f => !f));                                         // past the overpass, two lanes again
      hwC = H.slice().sort((a, b) => a - b)[H.length >> 1];
    } else if (one) {   // a one-way ramp (OSM oneway): its lanes of 3.5 m with margins, kerbs and edge lines, no sidewalk
      const h1 = tags.hw || Math.max(2.6, tags.lanes * 1.75 + 0.85);
      splitApart(li, pts, dp, h1); l.je = je = jointEnds(li, dp);
      ribbon(groups[def[2]], dp, 0, h1, lineCol[cls], 0, je);
      for (const sg of [1, -1]) { mark(li, dp, sg * (h1 + 0.08), 0.12, CURB, 'k'); mark(li, dp, sg * (h1 - 0.35), 0.07, WHITE, 'e'); }
      if (tags.lanes >= 2) mark(li, dp, 0, 0.07, WHITE, 'c', [3, 9]);
      if (tags.hatch) { const m = dp.length >> 1; HATCH.push({ li, p: dp, A: new Array(m).fill(h1 - 2.25), B: new Array(m).fill(h1 - 0.35), s: tags.hatch, gbc: STATE.GBC }); }   // the hatched margin
      hwC = h1;
    } else {
      if (rural) { ribbon(groups[2], dp, hw + 0.6, 0.6, GRAVEL, 0, je); ribbon(groups[2], dp, -hw - 0.6, 0.6, GRAVEL, 0, je); }   // a country road: gravel shoulders, no kerb or sidewalk
      else if (cls <= 3) { ribbon(walk, dp, hw + 1.4, 1.3, PAVE, 0, je); ribbon(walk, dp, -hw - 1.4, 1.3, PAVE, 0, je); mark(li, dp, hw + 0.08, 0.12, CURB, 'k'); mark(li, dp, -hw - 0.08, 0.12, CURB, 'k'); }
      if (cls === 8) { const [A, B] = railBed(li, dp, hw); ribbonV(groups[def[2]], dp, A, B, lineCol[cls], je); }
      else if (cls !== 9) ribbon(groups[def[2]], dp, 0, hw, lineCol[cls], 0, je);
      if (cls <= 2) mark(li, dp, 0, 0.07, WHITE, 'c', [3, 9]);
      if (cls === 0) { mark(li, dp, hw - 0.45, 0.07, WHITE, 'e'); mark(li, dp, -hw + 0.45, 0.07, WHITE, 'e'); }
    }
    if (cls <= 4) { l.zone = hwC; for (let i = 0; i < n - 1; i++) addZone(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], li, hwC); }
    if (cls === 8) { dashes(marks, dp, 0, 1.25, 0.25, 0.6, SLEEP); railBar(extra, dp, 0.76); railBar(extra, dp, -0.76); }   // steel rails on the sleepers
    if (cls === 9) { TRAMLINES.push(pts); for (let i = 0; i < n - 1; i++) TRAMGRID.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], 0, 0); tramLater.push({ dp, gbc: STATE.GBC }); }   // drawn once all the roads are known
    if (cls <= 4) for (let i = 0; i < n - 1; i++) CARROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hwC, cls);
    if (cls < 10 || cls === 15) for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hwC + (cls <= 3 ? 2.6 : 0), cls <= 7 ? l.name : -1);
    if (l.bridge && cls !== 10 && cls !== 11 && !fortBridgeLine(pts) && !onOv && !jn && !(cls === 8 && rbOnLine(pts))) bridge(extra, dp, hw + (cls <= 3 ? 2.7 : 0.3));   // the railway bridge over the Daugava: lmRailBridge
    STATE.GBC = null;
    if (cls <= 3 && !rural) { // street lamps every ~32 m on one side (the outer side of a carriageway of a pair); none on a country road
      const side = dual ? -dual.side : rnd(lampSeq++, 5) < 0.5 ? 1 : -1, hw = hwC; let acc = 14;
      for (let i = 0; i < n - 1; i++) {
        const x1 = pts[2 * i], z1 = pts[2 * i + 1], x2 = pts[2 * i + 2], z2 = pts[2 * i + 3], L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.01) continue;
        const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
        while (acc < L) {
          const off = (hw + 0.6) * side, x = x1 + tx * acc - tz * off, z = z1 + tz * acc + tx * off, k = Math.round(x / 14) + ',' + Math.round(z / 14);
          let trk = false; TRK.near(x, z, 2.2, () => { trk = true; });   // not on a tram bed
          if (!trk && !lampGrid.has(k) && Math.abs(x) < HX && Math.abs(z) < HY) { lampGrid.add(k); LAMPS.push(x, z, Math.atan2(tz * side, -tx * side) ); }
          acc += 32;
        }
        acc -= L;
      }
    }
  }
  /* Tram tracks: where a track runs inside a carriageway its rails lie flush in a concrete strip, with no sleepers (on
     the overpass and along most streets); on a track bed of its own, ballast with sleepers and steel rails on them. */
  const TSLAB = hb('#57585a'), TSTEEL = hb('#a19d96');
  for (const T of tramLater) {
    if (due()) await pause();
    STATE.GBC = T.gbc; const p = T.dp, m = p.length >> 1; let run = [p[0], p[1]], emb = null;
    const flush = () => { if (run.length < 4) return;
      if (emb) { ribbon(groups[4], run, 0, 1.25, TSLAB); for (const o of [0.76, -0.76]) { ribbon(marks, run, o, 0.04, TSTEEL); ribbon(marks, run, o - Math.sign(o) * 0.07, 0.015, RAIL); } }
      else { ribbon(groups[3], run, 0, LINE[9][0] / 2, lineCol[9]); dashes(marks, run, 0, 1.25, 0.25, 0.6, SLEEP); railBar(extra, run, 0.76); railBar(extra, run, -0.76); } };
    for (let i = 0; i < m - 1; i++) {
      const mx = (p[2 * i] + p[2 * i + 2]) / 2, mz = (p[2 * i + 1] + p[2 * i + 3]) / 2; let e = false;
      CARROAD.near(mx, mz, 8, (id, d) => { if (CARROAD.s[id * 6 + 5] <= 3 && d < CARROAD.s[id * 6 + 4] - 0.3) e = true; });
      if (!e) MED.near(mx, mz, 6, (id, d) => { if (d < MED.s[id * 6 + 4]) e = true; });
      if (emb === null) emb = e; if (e !== emb) { flush(); run = [p[2 * i], p[2 * i + 1]]; emb = e; }
      run.push(p[2 * i + 2], p[2 * i + 3]);
    }
    flush();
  }
  // the zebras (stripes 0.5 m wide along the street, 4 m long), then the markings cut at the junctions and the zebras
  const ZB = zebras();
  for (const Z of ZB) {
    const nx = -Z.tz, nz = Z.tx, k = Math.max(1, Math.floor((2 * Z.hw - 0.7 + 0.6) / 1.1)), c0 = -(k - 1) * 1.1 / 2;
    ZEB.add(Z.x - nx * Z.hw, Z.z - nz * Z.hw, Z.x + nx * Z.hw, Z.z + nz * Z.hw, 0, 2.4);
    STATE.GBC = sorted[Z.li].gbc || null;
    for (let j = 0; j < k; j++) { const c = c0 + j * 1.1, v = marks.v;
      for (const [a, b] of [[-2, -0.25], [-2, 0.25], [2, -0.25], [2, 0.25]]) marks.vert(Z.x + Z.tx * a + nx * (c + b), 0, Z.z + Z.tz * a + nz * (c + b), 0, 1, 0, WHITE);
      marks.triUp(v, v + 1, v + 3); marks.triUp(v, v + 3, v + 2); }
  }
  zSeen = new Int32Array(ZR.s.length / 6);
  for (const J of JOBS) { if (due()) await pause(); STATE.GBC = J.gbc; for (const run of clipRuns(J)) { if (J.dash) dashes(marks, run, 0, J.w, J.dash[0], J.dash[1], J.col); else ribbon(marks, run, 0, J.w, J.col); } }
  for (const Hh of HATCH) { if (due()) await pause(); STATE.GBC = Hh.gbc; hatch(marks, Hh.p, Hh.A, Hh.B, Hh.s, WHITE, (x, z, tx, tz) => inZones(zonesNear(Hh.li, x, z, 0.2, tx, tz), 'c', x, z)); }
  STATE.GBC = null;
  buildSignals(sorted, ZR, ZB, marks, WHITE, N18);   // traffic lights and stop lines on 18. novembra iela, give way at the roundabouts
  const orders = [-37, -37, -36, -35, -34, -33], mats = [M_LAND, M_PAVE, M_DIRT, M_BALLAST, M_ASPH, M_MARK];
  groups.forEach((g, k) => { const m = g.mesh(mats[k]); if (m) { m.renderOrder = orders[k] + (k === 0 ? -0.5 : 0); m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } });
  const em = extra.mesh(matPlain); if (em) { em.castShadow = em.receiveShadow = true; scene.add(em); }
}
function bridge(b, p, hw) {
  const n = p.length >> 1, CON = hb('#9d9a92'), RAILC = hb('#5f6266');
  for (let i = 0; i < n - 1; i++) {
    const x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * i + 2], z2 = p[2 * i + 3], L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.05) continue;
    const tx = (x2 - x1) / L, tz = (z2 - z1) / L, nx = -tz, nz = tx;
    for (const s of [-1, 1]) {
      const ax = x1 + nx * hw * s, az = z1 + nz * hw * s, bx = x2 + nx * hw * s, bz = z2 + nz * hw * s;
      polyA(b, [[ax, 0.02, az], [bx, 0.02, bz], [bx, -1.3, bz], [ax, -1.3, az]], CON, nx * s, 0, nz * s);
      polyA(b, [[ax, 0.0, az], [bx, 0.0, bz], [bx, 1.05, bz], [ax, 1.05, az]], RAILC, nx * s, 0, nz * s);
      polyA(b, [[ax, 0.0, az], [bx, 0.0, bz], [bx, 1.05, bz], [ax, 1.05, az]], RAILC, -nx * s, 0, -nz * s);
      COL.add(ax, az, bx, bz, 0.15, 0);
    }
    polyA(b, [[x1 - nx * hw, -1.3, z1 - nz * hw], [x2 - nx * hw, -1.3, z2 - nz * hw], [x2 + nx * hw, -1.3, z2 + nz * hw], [x1 + nx * hw, -1.3, z1 + nz * hw]], sh(CON, 0.7), 0, -1, 0);
    for (let t = 15; t < L; t += 32) { const cx = x1 + tx * t, cz = z1 + tz * t; if (inWater(cx, cz)) box(b, cx, cz, nx, nz, hw * 0.8, 1.0, WL - 1, -1.3, sh(CON, 0.85), false); }
  }
}

export { LAMPS, buildLines, ribbon };
