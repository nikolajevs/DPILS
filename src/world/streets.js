import { STATE } from '../core/state.js';
import { due, pause } from '../core/pause.js';
import { CARROAD, TRAMGRID } from '../transit/transit.js';
import { fortBridgeLine, fortSkipLine } from '../fortress/index.js';
import { gfSkipLine } from '../landmarks/griva-fortress.js';
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
import { TERR, bridgeDeck, bridgeOf, densify, terrainH } from './terrain.js';
import { groundSurf, releaseGroundSurf } from './ground.js';
import { WH, walkStrip, walkStripV, walkSlab as walkRing } from './walkgrid.js';
import { buildStreetWear, wearMat } from './streetwear.js';
import { scene } from '../render/renderer.js';
import { GB, SegGrid, box, polyA } from '../core/geometry.js';
import { area2, bbox, dec, hb, reversed, rnd, sh, triangulate } from '../core/util.js';
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
/* ---------- raised sidewalks and kerbs ----------
   The sidewalk is a slab WH above the road: a paved top with a slight fall towards the kerb, concrete skirts down
   to the ground on both edges and caps at the ends, so it reads as a slab from the street, not a painted sheet. The
   top goes into the paving group, the skirts into the plain concrete one; the strip is registered for walkH, which
   lifts the player, the lamps, the signals and the stops onto it. The kerb is a stone CH high along the
   road edge, laid over the same clipped runs as its painted apron: a battered face towards the road, a flat top, a
   back face hidden in the sidewalk slab. Where the runs stop at a junction the slab's own skirt shows as the corner
   kerb. CH stands a little above WH so the kerb reads against the paving. */
const CH = 0.15;
/* The foot of a skirt: the drawn ground under the point, not the bilinear heights. The ground layers sag under those on
   a crest by up to their subTris tol (0.35 m), so a skirt standing at y = 0 ended in the air above the grass — the
   floating kerbs and sidewalks of Lielā iela in Grīva. Only downwards: where the ground stands above the heights the
   foot stays at 0 and buries itself in it. Bridges, the overpass and the cutting keep their own decks (GBC). */
const groundFoot = (x, z) => { if (!TERR.on || STATE.GBC) return 0; const f = groundSurf(x, z) - terrainH(x, z); return f < 0 ? f : 0; };
/* The carriageway as a height field, like groundSurf for the grass. The asphalt is densified to 0.15 m of the heights
   while the ground layers sag under them on a crest by up to 0.35 m, and the asphalt writes no depth: a skirt footed on
   the drawn ground beside a carriageway stands a third of a metre below the road it meets, and its whole face paints
   over the asphalt as a concrete wall — the kerb blocks and half-metre kerbs of Lielā iela in Grīva. Where a skirt edge
   meets a carriageway its foot follows the road surface instead, a hand below it; over grass it keeps the drawn ground.
   The index is built once every carriageway is laid and released with the ground one. */
let RS = null;
function buildRoadSurf(b) {
  if (!TERR.on || !b.ni) return;
  const n = b.ni / 3, P = b.pos, S = 32, NX = Math.ceil(2 * HX / S) + 1, NZ = Math.ceil(2 * HY / S) + 1;
  /* heights per triangle corner, in triangle order: the builder is indexed, its triangle t owns vertices idx[3t..],
     not 3t.. — reading H[3t] of a per-vertex array gave the feet of the skirts strangers' heights (wedges and gaps at
     every junction) and, past the array's end, NaN: whole skirt triangles vanished from the kerb line */
  const H = new Float32Array(n * 3);
  const D = new Float32Array(n * 10), cnt = new Int32Array(NX * NZ + 1);
  for (let t = 0; t < n; t++) {
    const a = b.idx[3 * t], c = b.idx[3 * t + 1], d = b.idx[3 * t + 2], k = t * 10;
    H[3 * t] = P[3 * a + 1] + terrainH(P[3 * a], P[3 * a + 2]);
    H[3 * t + 1] = P[3 * c + 1] + terrainH(P[3 * c], P[3 * c + 2]);
    H[3 * t + 2] = P[3 * d + 1] + terrainH(P[3 * d], P[3 * d + 2]);
    const ax = P[3 * a], az = P[3 * a + 2], bx = P[3 * c], bz = P[3 * c + 2], cx = P[3 * d], cz = P[3 * d + 2];
    D[k] = ax; D[k + 1] = az; D[k + 2] = bx; D[k + 3] = bz; D[k + 4] = cx; D[k + 5] = cz;
    D[k + 6] = Math.min(ax, bx, cx); D[k + 7] = Math.min(az, bz, cz); D[k + 8] = Math.max(ax, bx, cx); D[k + 9] = Math.max(az, bz, cz);
    for (let j = Math.max(0, Math.floor((D[k + 7] + HY) / S)); j <= Math.min(NZ - 1, Math.floor((D[k + 9] + HY) / S)); j++)
      for (let i = Math.max(0, Math.floor((D[k + 6] + HX) / S)); i <= Math.min(NX - 1, Math.floor((D[k + 8] + HX) / S)); i++) cnt[j * NX + i + 1]++;
  }
  for (let c = 0; c < NX * NZ; c++) cnt[c + 1] += cnt[c];
  const idx = new Int32Array(cnt[NX * NZ]), cur = cnt.slice(0, NX * NZ);
  for (let t = 0; t < n; t++) {
    const k = t * 10;
    for (let j = Math.max(0, Math.floor((D[k + 7] + HY) / S)); j <= Math.min(NZ - 1, Math.floor((D[k + 9] + HY) / S)); j++)
      for (let i = Math.max(0, Math.floor((D[k + 6] + HX) / S)); i <= Math.min(NX - 1, Math.floor((D[k + 8] + HX) / S)); i++) idx[cur[j * NX + i]++] = t;
  }
  RS = { D, H, idx, cnt, NX, NZ, S };
}
// the road surface under the point, relative to the heights there; a skirt edge stands a hand off the asphalt edge,
// so the taps reach 0.6 m across it. null where no carriageway is near
function roadRel(x, z) {
  if (!RS) return null;
  const { D, H, idx, cnt, NX, NZ, S } = RS;
  for (let tap = 0; tap < 5; tap++) {
    const px = x + (tap === 1 ? 0.6 : tap === 2 ? -0.6 : 0), pz = z + (tap === 3 ? 0.6 : tap === 4 ? -0.6 : 0);
    const i = Math.floor((px + HX) / S), j = Math.floor((pz + HY) / S);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
    const cell = j * NX + i;
    for (let q = cnt[cell]; q < cnt[cell + 1]; q++) {
      const t = idx[q], k = t * 10;
      if (px < D[k + 6] || pz < D[k + 7] || px > D[k + 8] || pz > D[k + 9]) continue;
      const ax = D[k], az = D[k + 1], bx = D[k + 2], bz = D[k + 3], cx = D[k + 4], cz = D[k + 5];
      const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az); if (Math.abs(det) < 1e-9) continue;
      const u = ((px - ax) * (cz - az) - (cx - ax) * (pz - az)) / det, v = ((bx - ax) * (pz - az) - (px - ax) * (bz - az)) / det;
      if (u < -1e-4 || v < -1e-4 || u + v > 1.0001) continue;
      const a = t * 3; return H[a] + u * (H[a + 1] - H[a]) + v * (H[a + 2] - H[a]) - terrainH(x, z);
    }
  }
  return null;
}
const footAt = (x, z) => { if (!TERR.on || STATE.GBC) return 0; const r = roadRel(x, z); if (r !== null && Number.isFinite(r)) return Math.min(r, 0) - 0.05; return groundFoot(x, z); };   // in a hollow the road chord stands above the heights: the foot stays under it
// a vertical skirt along the edge q (flat x,z pairs) from the ground up to y (a number or one per point); the normal
// is across each segment, to the left of it for flip (the left edge of the slab), to the right otherwise
function skirt(sk, q, y, col, flip, F = null) {
  const n = q.length >> 1; if (n < 2) return; const v0 = sk.v, s = flip ? -1 : 1; sk.ensure(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1), h = typeof y === 'number' ? y : y[i], f = F ? F[i] : 0;
    let tx = q[2 * c] - q[2 * a], tz = q[2 * c + 1] - q[2 * a + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    sk.vert(q[2 * i], f, q[2 * i + 1], -tz * s, 0, tx * s, sh(col, 0.85)); sk.vert(q[2 * i], h, q[2 * i + 1], -tz * s, 0, tx * s, col);   // dirt at the foot
  }
  for (let i = 0; i < n - 1; i++) { const k = v0 + 2 * i;
    if (flip) { sk.tri(k, k + 1, k + 3); sk.tri(k, k + 3, k + 2); } else { sk.tri(k, k + 2, k + 3); sk.tri(k, k + 3, k + 1); } }
}
function slabRun(b, sk, p, off, hw, col, E = null) {
  const n = p.length >> 1; if (n < 2) return;
  const e0 = off - hw, e1 = off + hw, y0 = WH + (Math.abs(e0) < Math.abs(e1) ? 0 : 0.02), y1 = WH + (Math.abs(e0) < Math.abs(e1) ? 0.02 : 0);
  const v0 = b.v; b.ensure(n * 2); const q0 = [], q1 = [];
  for (let i = 0; i < n; i++) {
    const [tx, tz, m] = frame(p, i, n, E), nx = -tz, nz = tx;
    const x0 = p[2 * i] + nx * e0 * m, z0 = p[2 * i + 1] + nz * e0 * m, x1 = p[2 * i] + nx * e1 * m, z1 = p[2 * i + 1] + nz * e1 * m;
    b.vert(x0, y0, z0, 0, 1, 0, col); b.vert(x1, y1, z1, 0, 1, 0, col);
    q0.push(x0, z0); q1.push(x1, z1);
  }
  for (let i = 0; i < n - 1; i++) { const k = v0 + 2 * i; b.triUp(k, k + 1, k + 3); b.triUp(k, k + 3, k + 2); }
  const SC = sh(col, 0.72);
  const f0 = [], f1 = []; for (let i = 0; i < n; i++) { f0.push(footAt(q0[2 * i], q0[2 * i + 1])); f1.push(footAt(q1[2 * i], q1[2 * i + 1])); }
  skirt(sk, q0, y0, SC, true, f0); skirt(sk, q1, y1, SC, false, f1);
  const cap = (i, sgn) => { const [tx, tz, m] = frame(p, i, n, E), nx = -tz, nz = tx;
    const xa = p[2 * i] + nx * e0 * m, za = p[2 * i + 1] + nz * e0 * m, xb = p[2 * i] + nx * e1 * m, zb = p[2 * i + 1] + nz * e1 * m;
    polyA(sk, [[xa, footAt(xa, za), za], [xa, y0, za], [xb, y1, zb], [xb, footAt(xb, zb), zb]], SC, tx * sgn, 0, tz * sgn); };
  cap(0, -1); cap(n - 1, 1);
  walkStrip(p, off, hw);
}
// the same slab between edges A[i], B[i] that change along the line (A < B throughout)
function slabRunV(b, sk, p, A, B, col, E = null) {
  const n = p.length >> 1; if (n < 2) return;
  const v0 = b.v; b.ensure(n * 2); const q0 = [], q1 = [], yA = [], yB = [];
  for (let i = 0; i < n; i++) {
    const [tx, tz, m] = frame(p, i, n, E), nx = -tz, nz = tx, a = A[i] * m, bb = B[i] * m;
    const x0 = p[2 * i] + nx * a, z0 = p[2 * i + 1] + nz * a, x1 = p[2 * i] + nx * bb, z1 = p[2 * i + 1] + nz * bb;
    const ya = WH + (Math.abs(A[i]) < Math.abs(B[i]) ? 0 : 0.02), yb = WH + (Math.abs(A[i]) < Math.abs(B[i]) ? 0.02 : 0);
    b.vert(x0, ya, z0, 0, 1, 0, col); b.vert(x1, yb, z1, 0, 1, 0, col);
    q0.push(x0, z0); q1.push(x1, z1); yA.push(ya); yB.push(yb);
  }
  for (let i = 0; i < n - 1; i++) { const k = v0 + 2 * i; b.triUp(k, k + 1, k + 3); b.triUp(k, k + 3, k + 2); }
  const SC = sh(col, 0.72);
  const f0 = [], f1 = []; for (let i = 0; i < n; i++) { f0.push(footAt(q0[2 * i], q0[2 * i + 1])); f1.push(footAt(q1[2 * i], q1[2 * i + 1])); }
  skirt(sk, q0, yA, SC, true, f0); skirt(sk, q1, yB, SC, false, f1);
  const cap = (i, sgn) => { const [tx, tz, m] = frame(p, i, n, E), nx = -tz, nz = tx;
    const xa = p[2 * i] + nx * A[i] * m, za = p[2 * i + 1] + nz * A[i] * m, xb = p[2 * i] + nx * B[i] * m, zb = p[2 * i + 1] + nz * B[i] * m;
    polyA(sk, [[xa, footAt(xa, za), za], [xa, yA[i], za], [xb, yB[i], zb], [xb, footAt(xb, zb), zb]], SC, tx * sgn, 0, tz * sgn); };
  cap(0, -1); cap(n - 1, 1);
  walkStripV(p, A, B);
}
/* The slab stops at junctions like the kerb does: raised WH above the road, it would otherwise lie across the
   carriageway of every street that crosses or joins (a paved bar with skirts and end caps over the asphalt, city-wide).
   The runs are cut once all the carriageways are known, the same capsules as clipRuns, and each run gets square caps:
   its skirt reads as the corner kerb. Deferred into SLABS because a street laid early must still stop at a street laid
   after it. */
const SLABS = [];
function walkSlab(b, sk, li, p, off, hw, col, E = null) { SLABS.push({ li, p, off, hw, col, E, gbc: STATE.GBC, v: 0 }); }
function walkSlabV(b, sk, li, p, A, B, col, E = null) { SLABS.push({ li, p, A, B, col, E, gbc: STATE.GBC, v: 1 }); }
// a kerb stone along p: a battered face towards the road (the road lies to the left of p), a flat top CH high, a back
// face down into the sidewalk; sA < 0 mirrors it to the other side by walking p backwards, keeping the winding
function curbBar(b, p, w, sA, col) {
  let q = p;
  if (sA < 0) { q = []; for (let i = (p.length >> 1) - 1; i >= 0; i--) q.push(p[2 * i], p[2 * i + 1]); }
  const n = q.length >> 1; if (n < 2) return; const v0 = b.v; b.ensure(n * 6);
  const top = sh(col, 1.06), face = sh(col, 0.88), back = sh(col, 0.78);
  for (let i = 0; i < n; i++) {
    const [tx, tz, m] = frame(q, i, n, null), nx = -tz, nz = tx, x = q[2 * i], z = q[2 * i + 1], P = (t, y) => [x + nx * t * m, y, z + nz * t * m];
    const f = 0.95 + rnd(i, 7) * 0.1, fc = sh(face, f), tc = sh(top, f), bc = sh(back, f), dirty = sh(fc, 0.8);   // each stone weathers its own way, dirt at its foot
    const a = P(-w, 0), c = P(-w + 0.03, CH), d = P(w, CH), e = P(w, 0);
    b.vert(a[0], a[1], a[2], -nx, 0, -nz, dirty); b.vert(c[0], c[1], c[2], -nx, 0, -nz, fc);
    b.vert(c[0], c[1], c[2], 0, 1, 0, tc); b.vert(d[0], d[1], d[2], 0, 1, 0, tc);
    b.vert(d[0], d[1], d[2], nx, 0, nz, bc); b.vert(e[0], e[1], e[2], nx, 0, nz, sh(bc, 0.85));
  }
  for (let i = 0; i < n - 1; i++) { const k = v0 + 6 * i, r = k + 6;
    b.tri(k, k + 1, r); b.tri(k + 1, r + 1, r); b.tri(k + 2, k + 3, r + 2); b.tri(k + 3, r + 3, r + 2); b.tri(k + 5, r + 5, k + 4); b.tri(k + 4, r + 5, r + 4); }
  const cap = (i, sgn) => { const [tx, tz, m] = frame(q, i, n, null), nx = -tz, nz = tx, x = q[2 * i], z = q[2 * i + 1], P = (t, y) => [x + nx * t * m, y, z + nz * t * m];
    polyA(b, [P(-w, 0), P(-w + 0.03, CH), P(w, CH), P(w, 0)], face, tx * sgn, 0, tz * sgn); };
  cap(0, -1); cap(n - 1, 1);
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
  const walk = groups[1], marks = groups[5], extra = new GB(false), wear = new GB(false);
  const PAVE = hb('#8f897e'), CURB = hb('#a9a69e'), WHITE = hb('#e8e6df'), RAIL = hb('#4a4440'), SLEEP = hb('#635d56'), GRAVEL = hb('#8b8475');
  const GUT = hb('#0a0a0a');   // the gutter shadow at the kerb foot: a transparent ribbon over the asphalt (src/world/streetwear.js)
  const sorted = C.l.map(l => ({ cls: l[0], name: l[1], pts: dec(l[2]), bridge: !!l[3] }));
  // the carriageways from the least to the main streets, so a main street is laid over the service roads that join it
  // (the comparator used to leave the other lines in between, which left that order to the sort and let some service roads lie over 18. novembra iela)
  const rank = l => l.cls <= 4 ? 4 - l.cls : 5;
  sorted.sort((a, b) => rank(a) - rank(b));
  /* Joints. OSM splits a street into ways at many nodes where nothing else meets it, and each piece was laid with square
     ends across its own last segment: where the two turn there, even by a few degrees, a wedge of ground showed between
     them from the centre line out, widest at the outer edge of the sidewalk (in the fortress by the Konstantin gate,
     where two living streets meet at 3В°). Where exactly two lines of the same class end at a node (or a closed line
     meets itself) and turn there by less than 60В°, both ends are cut across the bisector of the two, the way a ribbon
     is mitred at its inner points, so the two pieces meet edge to edge as if they were one way. Not between classes: a
     narrower piece (a footway on from a street) would leave bare the inner corner the wider one gives up; nor at a
     sharper turn or where the inner corner would draw back past the first point of either line, which would fold the
     ribbon: those keep their square ends. JOINT: the line ends at each node of the data. */
  const JOINT = new Map(), MITER = new Set(), jKey = (x, z) => Math.round(x * 10) + ',' + Math.round(z * 10);
  sorted.forEach((l, li) => { if (!LINE[l.cls] || l.cls === 10 || l.cls === 11) return; const p = l.pts, n = p.length;
    for (const end of [0, 1]) { const k = jKey(end ? p[n - 2] : p[0], end ? p[n - 1] : p[1]); let a = JOINT.get(k); if (!a) JOINT.set(k, a = []); a.push([li, end]); } });
  /* Which pairs of lines continue one another (same street, turning by less than 60В° at a shared node): their zones do not
     cut each other's markings or slabs. A fork of the same name (VienД«bas iela at Saules iela: three ways at one node, two
     of them the same street turning by ~90В°) is a crossing, not a continuation: each branch stops at the other's
     carriageway. Pairwise, not only where exactly two ends meet, so a dual carriageway splitting off a single road keeps
     its edges through the split node where three ways meet. */
  JOINT.forEach(at => {
    for (let a = 0; a < at.length; a++) for (let b = a + 1; b < at.length; b++) {
      const [li, ei] = at[a], [lj, ej] = at[b], L = sorted[li], O = sorted[lj];
      if (L.cls !== O.cls || L.name < 0 || L.name !== O.name) continue;
      const dir = (l, e) => { const p = l.pts, n = p.length, x = e ? p[n - 2] : p[0], z = e ? p[n - 1] : p[1];
        const fx = (e ? p[n - 4] : p[2]) - x, fz = (e ? p[n - 3] : p[3]) - z, fl = Math.hypot(fx, fz); return fl < 1e-3 ? null : [fx / fl, fz / fl]; };
      const f = dir(L, ei), g = dir(O, ej); if (!f || !g) continue;
      if (-(f[0] * g[0] + f[1] * g[1]) < 0.5) continue;
      MITER.add(li + ':' + lj); MITER.add(lj + ':' + li);
    }
  });
  /* Roundabouts that OSM splits into arcs at every approach: the closed-line test in signals.js never sees them (the
     fortress ring is four unnamed primary arcs). Chain class 0-3 lines end to end into a closed loop and keep the loop
     if it is round (12+ points, every one within 10% of the mean radius 8-40 m). Members draw as one ring: a narrow
     carriageway without a centre line, a grass island kerbed inside, sidewalk outside only; signals.js gives the
     approaches their give-way lines. */
  const RING_HW = 3.5;
  {
    const ends = new Map();
    sorted.forEach((l, li) => { if (l.cls > 3) return; const p = l.pts, n = p.length;
      for (const e of [0, 1]) { const k = jKey(e ? p[n - 2] : p[0], e ? p[n - 1] : p[1]); let a = ends.get(k); if (!a) ends.set(k, a = []); a.push([li, e]); } });
    const inRing = new Set();
    sorted.forEach((l, li) => {
      if (inRing.has(li) || l.cls > 3) return;
      const p0 = l.pts, n0 = p0.length, startK = jKey(p0[0], p0[1]);
      const chain = [li], pts = Array.from(p0);
      let cur = li, curEnd = 1, nodeK = jKey(p0[n0 - 2], p0[n0 - 1]), ok = false;
      for (let guard = 0; guard < 10 && nodeK !== startK; guard++) {
        const at = ends.get(nodeK); if (!at) { ok = false; break; }
        // the ring continues tangentially (an approach leaves radially, a turn of ~90°): pick the same-class end that turns least
        const ix = pts[pts.length - 2] - pts[pts.length - 4], iz = pts[pts.length - 1] - pts[pts.length - 3], il = Math.hypot(ix, iz) || 1;
        let best = null;
        for (const [lj, ej] of at) {
          if (lj === cur || lj === li || chain.includes(lj) || sorted[lj].cls !== l.cls) continue;
          const q = sorted[lj].pts, nq = q.length;
          const ax = ej ? q[nq - 2] : q[0], az = ej ? q[nq - 1] : q[1], bx = ej ? q[nq - 4] : q[2], bz = ej ? q[nq - 3] : q[3];
          const ux = bx - ax, uz = bz - az, ul = Math.hypot(ux, uz) || 1, d = (ix * ux + iz * uz) / (il * ul);
          if (d > 0.5 && (!best || d > best.d)) best = { lj, ej, d };
        }
        if (!best) { ok = false; break; }
        ok = true; chain.push(best.lj);
        const q = sorted[best.lj].pts, nq = q.length;
        if (best.ej === 0) for (let i = 2; i < nq; i += 2) pts.push(q[i], q[i + 1]); else for (let i = nq - 4; i >= 0; i -= 2) pts.push(q[i], q[i + 1]);
        cur = best.lj; curEnd = 1 - best.ej; nodeK = jKey(pts[pts.length - 2], pts[pts.length - 1]);
      }
      if (!ok || nodeK !== startK || chain.length < 2 || chain.length > 8) return;
      const n = pts.length >> 1; if (n < 12) return;
      let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += pts[2 * i]; cz += pts[2 * i + 1]; } cx /= n; cz /= n;
      let R = 0; for (let i = 0; i < n; i++) R += Math.hypot(pts[2 * i] - cx, pts[2 * i + 1] - cz); R /= n;
      if (R < 8 || R > 40) return;
      for (let i = 0; i < n; i++) if (Math.abs(Math.hypot(pts[2 * i] - cx, pts[2 * i + 1] - cz) - R) > 0.1 * R) return;
      const dx = pts[2] - pts[0], dz = pts[3] - pts[1], dl = Math.hypot(dx, dz) || 1;
      const inner = Math.sign((-dz / dl) * (cx - pts[0]) + (dx / dl) * (cz - pts[1])) || 1;   // which side of the line the island lies
      const ring = { id: li, cx, cz, R, inner, hw: RING_HW };
      chain.forEach(a => { inRing.add(a); sorted[a].ring = ring; });
    });
  }
  // for line li laid along dp: [first, last] the directions its ends are cut across (frame's E), null for a square end
  function jointEnds(li, dp) {
    const l = sorted[li]; if (l.cls === 9) return null;   // the tram tracks are laid in runs of their own
    const p = l.pts, n = p.length, m = dp.length, E = [null, null];
    for (const end of [0, 1]) {
      const x = end ? p[n - 2] : p[0], z = end ? p[n - 1] : p[1], at = JOINT.get(jKey(x, z)); if (!at || at.length !== 2) continue;
      const [lj, ej] = at[0][0] === li && at[0][1] === end ? at[1] : at[0], q = sorted[lj].pts, nq = q.length; if (sorted[lj].cls !== l.cls) continue;
      // each line's first segment away from the node, from the data on both sides so the two lines agree on the cut
      const fx = (end ? p[n - 4] : p[2]) - x, fz = (end ? p[n - 3] : p[3]) - z, gx = (ej ? q[nq - 4] : q[2]) - x, gz = (ej ? q[nq - 3] : q[3]) - z;
      const fl = Math.hypot(fx, fz), gl = Math.hypot(gx, gz); if (fl < 1e-3 || gl < 1e-3) continue;
      const cos = -(fx * gx + fz * gz) / (fl * gl); if (cos < 0.5) continue;   // the turn, from the other line on into this one
      if (Math.abs((end ? dp[m - 2] : dp[0]) - x) > 0.01 || Math.abs((end ? dp[m - 1] : dp[1]) - z) > 0.01) continue;   // its end was moved
      const reach = (LINE[l.cls][0] / 2 + (l.cls <= 3 ? 2.7 : 0)) * Math.sqrt((1 - cos) / (1 + cos));   // how far the inner corner of the sidewalk draws back
      if (reach >= Math.min(fl, gl)) continue;
      const tx = fx / fl - gx / gl, tz = fz / fl - gz / gl, tl = (end ? -1 : 1) * Math.hypot(tx, tz);
      E[end] = [tx / tl, tz / tl];   // along the line: from the other line into this one at its start, on into it at its end
    }
    return E[0] || E[1] ? E : null;
  }
  let lampSeq = 0; const lampGrid = new Set(), tramLater = [];
  /* Dual carriageways. OSM maps many main streets as two one-way ways side by side, and the data keep neither the
     one-way flag nor the lanes, so each way was drawn as a whole two-way street 6вЂ“11 m wide. On 18. novembra iela west of
     the overpass, where the two ways run 3вЂ“10 m apart, the carriageways overlapped with their centre lines, edge lines
     and sidewalks. A road most of whose points have beside them (not ahead) another way of the same name and class
     running parallel 3вЂ“26 m away is one carriageway of a pair: a lane wide where the two run 8 m apart or less, two
     lanes from 11 m; a median under 4.5 m is painted asphalt with a double line, a wider one is left to the ground; the
     sidewalk, the kerb and the lamps go on the outer side only. */
  const PAIR = new SegGrid(40), TRK = new SegGrid(20), MED = new SegGrid(20);   // MED: the asphalt medians with tracks in them
  sorted.forEach((l, li) => { if ((l.cls <= 3 && l.name >= 0) || l.cls === 9) for (let i = 0; i < l.pts.length - 2; i += 2) (l.cls === 9 ? TRK : PAIR).add(l.pts[i], l.pts[i + 1], l.pts[i + 2], l.pts[i + 3], li, 0); });
  // the ends of the named streets: how many other lines of the same street end within 2.5 m of (x, z)
  const ENDS = []; sorted.forEach((l, li) => { if (l.cls <= 3 && l.name >= 0) { const p = l.pts, n = p.length; ENDS.push([p[0], p[1], li], [p[n - 2], p[n - 1], li]); } });
  /* One-way ramps (OSM oneway, street-tags.js) that leave the end of a two-way road together, as at both ends of the
     teardrop junction at VienД«bas tilts: OSM starts both from the road's end node, so their kerbs and edge lines crossed
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
       10вЂ“20 m their centre lines run together into a point. At the west end of the overpass bridge they did, and the edge
       lines, kerbs and sidewalks of the two carriageways cut in a V across the four lanes of the bridge. There the end of
       each carriageway is laid straight on, the way it comes from 30вЂ“55 m out: the two stay apart at the distance they
       settled at, and carry on the edges of the road they split from. */
    if (dp !== pts) for (const end of [0, 1]) {
      const np = pts.length; if (splitAt(li, end ? pts[np - 2] : pts[0], end ? pts[np - 1] : pts[1]) < 1) continue;   // one same-name way carrying on is enough: the pair splits off it (the fortress ring approaches)
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
       over В±30 m and runs shorter than 25 m join their neighbours: a median of 4вЂ“5 m (Latgales iela) went from painted to
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
    const L = sorted[li], q = offPoly(p, off, L.dp === p ? L.je : null), n = q.length >> 1, job = (qq, i0) => JOBS.push({ li, p, i0, q: qq, w, col, kind, dash, gbc: STATE.GBC, sA: kind === 'k' ? Math.sign(typeof off === 'number' ? off : off[0]) : 0 });
    if (!keep) { job(q, 0); return; }
    let s = -1; for (let i = 0; i <= n; i++) { const k = i < n && keep[i]; if (k && s < 0) s = i; if (!k && s >= 0) { if (i - s >= 2) job(q.slice(2 * s, 2 * i), s); s = -1; } } }
  /* the zones near (x, z) within r that may cut a marking of line li running along (tx, tz): the carriageways of the
     streets that cross it and the painted medians (type 0), service roads (1, only the kerbs stop at them) and the zebras
     (2, only the centre and lane lines); each [x1, z1, dx, dz, |d|ВІ, radiusВІ, type] */
  const ZNONE = []; let zSeen = null, zStamp = 0;
  function zonesNear(li, x, z, r, tx, tz) {
    const me = sorted[li], s = ZR.s, e = ZEB.s; let out = ZNONE; zStamp++;
    const put = (k, g, rr, type) => { const dx = g[k + 2] - g[k], dz = g[k + 3] - g[k + 1]; if (out === ZNONE) out = []; out.push([g[k], g[k + 1], dx, dz, dx * dx + dz * dz || 1e-9, rr * rr, type]); };
    ZR.near(x, z, r + zMax, id => { if (zSeen[id] === zStamp) return; zSeen[id] = zStamp; const k = id * 6, lj = s[k + 4]; if (lj === li) return; const o = sorted[lj];
      if (me.name >= 0 && o.name === me.name && o.cls === me.cls && !(me.one && o.one) && MITER.has(li + ':' + lj)) return;   // the same street continuing through a mitred joint (one-way ramps crossing in a junction do cut each other); a fork of the same name is a crossing
      const dx = s[k + 2] - s[k], dz = s[k + 3] - s[k + 1], l = Math.hypot(dx, dz) || 1; if (Math.abs((dx * tx + dz * tz) / l) > 0.94) return;   // alongside
      put(k, s, s[k + 5] + 0.15, o.cls === 4 ? 1 : 0); });
    ZEB.near(x, z, r + 3, id => put(id * 6, e, e[id * 6 + 5], 2));
    return out; }
  function inZones(Z, kind, x, z) {
    for (let j = 0; j < Z.length; j++) { const c = Z[j]; if ((c[6] === 1 && kind !== 'k' && kind !== 'g') || (c[6] === 2 && kind !== 'c')) continue;
      let t = ((x - c[0]) * c[2] + (z - c[1]) * c[3]) / c[4]; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - c[0] - c[2] * t, ez = z - c[1] - c[3] * t; if (ex * ex + ez * ez < c[5]) return true; }
    return false; }
  // the zones near segment i of the polyline p that line li is drawn along, found once for all the markings of the line
  const zCache = new Map();
  function segZones(li, p, i) {
    let c = zCache.get(li); if (!c) zCache.set(li, c = []);
    if (c[i] === undefined) { const ax = p[2 * i], az = p[2 * i + 1], bx = p[2 * i + 2], bz = p[2 * i + 3], L = Math.hypot(bx - ax, bz - az) || 1e-9;
      c[i] = zonesNear(li, (ax + bx) / 2, (az + bz) / 2, L / 2 + 9, (bx - ax) / L, (bz - az) / L); }
    return c[i]; }
  // the part of the segment (ax, az) + t (dx, dz), 0 в‰¤ t в‰¤ 1, inside the capsule c (a zone): [t0, t1], or null
  function capInt(ax, az, dx, dz, c) {
    const px = c[0], pz = c[1], ex = c[2], ez = c[3], el2 = c[4], r2 = c[5], dd = dx * dx + dz * dz || 1e-12; let lo = Infinity, hi = -Infinity;
    for (const [cx, cz] of [[px, pz], [px + ex, pz + ez]]) {   // the round ends
      const fx = ax - cx, fz = az - cz, b = fx * dx + fz * dz, disc = b * b - dd * (fx * fx + fz * fz - r2); if (disc <= 0) continue;
      const sq = Math.sqrt(disc); lo = Math.min(lo, (-b - sq) / dd); hi = Math.max(hi, (-b + sq) / dd); }
    // the band between them: 0 в‰¤ along в‰¤ 1 and |across| < r, both linear in t
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
      for (let j = 0; j < Z.length; j++) { const c = Z[j]; if ((c[6] === 1 && kind !== 'k' && kind !== 'g') || (c[6] === 2 && kind !== 'c')) continue; const r = capInt(ax, az, dx, dz, c); if (r) (iv || (iv = [])).push(r); }
      if (!iv) { if (!cur) cur = [ax, az]; cur.push(bx, bz); continue; }
      iv.sort((a, b) => a[0] - b[0]); let t = 0;
      for (const [u, v] of iv) { if (v <= t) continue; if (u > t + 1e-6) { if (!cur) cur = [ax + dx * t, az + dz * t]; cur.push(ax + dx * u, az + dz * u); } end(); t = v; }
      if (t < 1 - 1e-6) cur = [ax + dx * t, az + dz * t, bx, bz];
    }
    end(); return runs;
  }
  // the runs of the centre line p outside the carriageways that cross it: points as {x, z, i, t} (segment i, fraction t);
  // service roads cut the slab too (a driveway crosses it), zebras do not (the crossing meets the sidewalk)
  function clipSlab(li, p) {
    const n = p.length >> 1, runs = []; let cur = null;
    const end = () => { if (cur && cur.length >= 2) { let len = 0; for (let k = 0; k < cur.length - 1; k++) len += Math.hypot(cur[k + 1].x - cur[k].x, cur[k + 1].z - cur[k].z); if (len > 0.4) runs.push(cur); } cur = null; };
    const pt = (i, t) => ({ x: p[2 * i] + (p[2 * i + 2] - p[2 * i]) * t, z: p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * t, i, t });
    for (let i = 0; i < n - 1; i++) {
      const ax = p[2 * i], az = p[2 * i + 1], dx = p[2 * i + 2] - ax, dz = p[2 * i + 3] - az; if (dx * dx + dz * dz < 1e-8) continue;
      const Z = segZones(li, p, i); let iv = null;
      for (const c of Z) { if (c[6] === 2) continue; const r = capInt(ax, az, dx, dz, c); if (r) (iv || (iv = [])).push(r); }
      if (!iv) { if (!cur) cur = [pt(i, 0)]; cur.push(pt(i, 1)); continue; }
      iv.sort((a, b) => a[0] - b[0]); let t = 0;
      for (const [u, v] of iv) { if (v <= t) continue; if (u > t + 1e-6) { if (!cur) cur = [pt(i, t)]; cur.push(pt(i, u)); } end(); t = v; }
      if (t < 1 - 1e-6) cur = [pt(i, t), pt(i, 1)];
    }
    end(); return runs;
  }
  // one edge of a slab (a point per point of p, with its height), cut outside the same capsules; the cut follows the
  // crossing carriageway's own edge, so a skewed junction gets a clean corner instead of a square tab poking into it
  function clipEdge(li, p, q) {
    const n = q.length, runs = []; let cur = null;
    const end = () => { if (cur && cur.length >= 2) { let len = 0; for (let k = 0; k < cur.length - 1; k++) len += Math.hypot(cur[k + 1].x - cur[k].x, cur[k + 1].z - cur[k].z); if (len > 0.4) runs.push(cur); } cur = null; };
    for (let i = 0; i < n - 1; i++) {
      const ax = q[i].x, az = q[i].z, dx = q[i + 1].x - ax, dz = q[i + 1].z - az; if (dx * dx + dz * dz < 1e-8) continue;
      const Z = segZones(li, p, i); let iv = null;
      for (const c of Z) { if (c[6] === 2) continue; const r = capInt(ax, az, dx, dz, c); if (r) (iv || (iv = [])).push(r); }
      const pt = t => ({ x: ax + dx * t, z: az + dz * t, y: q[i].y + (q[i + 1].y - q[i].y) * t, i, t });
      if (!iv) { if (!cur) cur = [pt(0)]; cur.push(pt(1)); continue; }
      iv.sort((a, b) => a[0] - b[0]); let t = 0;
      for (const [u, v] of iv) { if (v <= t) continue; if (u > t + 1e-6) { if (!cur) cur = [pt(t)]; cur.push(pt(u)); } end(); t = v; }
      if (t < 1 - 1e-6) cur = [pt(t), pt(1)];
    }
    end(); return runs;
  }
  // pedestrian crossings: a short footway (under 45 m) across the carriageway of a main street (classes 0-2) at more than 65В°
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
      if (fortSkipLine(cls, pts) || gfSkipLine(cls, pts)) continue;   // the fortress draws its own walls and earthworks
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
    const tag0 = cls <= 3 ? streetTags(pts) : null, hw = l.ring ? RING_HW : tag0 && tag0.hw && !tag0.oneway ? tag0.hw : def[0] / 2;   // a narrower country road where OSM says so (src/world/street-tags.js); a roundabout arc is a lane and a half each way
    if (l.bridge && vbOnLine(pts)) {   // on VienД«bas tilts: lmVienibas draws the deck, the line still guides traffic and walking
      if (cls <= 4) for (let i = 0; i < n - 1; i++) CARROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, cls);
      for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw + (cls <= 3 ? 2.6 : 0), cls <= 7 ? l.name : -1);
      continue;
    }
    if (l.bridge && gubOnLine(pts)) {   // the boardwalk at GubiЕЎДЌes ezers: lmGubisce draws its deck of planks, the line still guides walking
      for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, l.name);
      continue;
    }
    if (l.bridge && airOnLine(pts)) {   // the air bridge to JaunДЃ ForЕЎtadte: lmAirBridge draws it and sets its heights
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
    l.hw = hw; l.rural = rural; l.lanes4 = lanes4;   // read by the street wear (covers, patches, weeds)
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
      walkSlabV(walk, extra, li, dp, H.map((h, i) => s > 0 ? -wk[i] : h + 0.1), H.map((h, i) => s > 0 ? -(h + 0.1) : wk[i]), PAVE, je);
      mark(li, dp, H.map(h => -s * (h + 0.08)), 0.06, CURB, 'k');
      mark(li, dp, H.map(h => -s * (h - 0.02)), 0.09, GUT, 'g');   // the gutter shadow at the kerb foot
    } else if (W) {   // 18. novembra iela with four lanes: a double centre line, broken lines between the lanes, the trams in the inner two
      const H = W, four = H.map(h => h >= 6);
      ribbonV(groups[def[2]], dp, H.map(h => -h), H, lineCol[cls], je);
      walkSlabV(walk, extra, li, dp, H.map(h => h + 0.1), H.map(h => h + 2.7), PAVE, je); walkSlabV(walk, extra, li, dp, H.map(h => -h - 2.7), H.map(h => -h - 0.1), PAVE, je);
      for (const sg of [1, -1]) {
        mark(li, dp, H.map(h => sg * (h + 0.08)), 0.12, CURB, 'k'); mark(li, dp, H.map(h => sg * (h - 0.45)), 0.07, WHITE, 'e');
        mark(li, dp, sg * 0.12, 0.06, WHITE, 'c', null, four);                                            // the double centre line
        mark(li, dp, H.map(h => sg * h / 2), 0.07, WHITE, 'c', [3, 9], four); }                           // between the lanes
      mark(li, dp, 0, 0.07, WHITE, 'c', [3, 9], four.map(f => !f));                                         // past the overpass, two lanes again
      hwC = H.slice().sort((a, b) => a - b)[H.length >> 1];
      for (const sg of [1, -1]) mark(li, dp, H.map(h => sg * (h - 0.02)), 0.09, GUT, 'g');   // the gutter shadow at each kerb
    } else if (one) {   // a one-way ramp (OSM oneway): its lanes of 3.5 m with margins, kerbs and edge lines, no sidewalk
      const h1 = tags.hw || Math.max(2.6, tags.lanes * 1.75 + 0.85);
      splitApart(li, pts, dp, h1); l.je = je = jointEnds(li, dp);
      ribbon(groups[def[2]], dp, 0, h1, lineCol[cls], 0, je);
      for (const sg of [1, -1]) { mark(li, dp, sg * (h1 + 0.08), 0.12, CURB, 'k'); mark(li, dp, sg * (h1 - 0.35), 0.07, WHITE, 'e'); }
      if (tags.lanes >= 2) mark(li, dp, 0, 0.07, WHITE, 'c', [3, 9]);
      if (tags.hatch) { const m = dp.length >> 1; HATCH.push({ li, p: dp, A: new Array(m).fill(h1 - 2.25), B: new Array(m).fill(h1 - 0.35), s: tags.hatch, gbc: STATE.GBC }); }   // the hatched margin
      hwC = h1; l.h1 = h1;
      for (const sg of [1, -1]) mark(li, dp, sg * (h1 - 0.02), 0.09, GUT, 'g');   // the gutter shadow at each kerb
    } else {
      if (l.ring) {   // a roundabout arc: grass island kerbed inside, sidewalk and kerb outside only, no centre or edge lines
        const si = l.ring.inner;
        walkSlab(walk, extra, li, dp, -si * (hw + 1.4), 1.3, PAVE, je);
        mark(li, dp, -si * (hw + 0.08), 0.12, CURB, 'k'); mark(li, dp, si * (hw + 0.08), 0.12, CURB, 'k');
      }
      else if (rural) { ribbon(groups[2], dp, hw + 0.6, 0.6, GRAVEL, 0, je); ribbon(groups[2], dp, -hw - 0.6, 0.6, GRAVEL, 0, je); }   // a country road: gravel shoulders, no kerb or sidewalk
      else if (cls <= 3) { walkSlab(walk, extra, li, dp, hw + 1.4, 1.3, PAVE, je); walkSlab(walk, extra, li, dp, -hw - 1.4, 1.3, PAVE, je); mark(li, dp, hw + 0.08, 0.12, CURB, 'k'); mark(li, dp, -hw - 0.08, 0.12, CURB, 'k'); }
      if (cls === 8) { const [A, B] = railBed(li, dp, hw); ribbonV(groups[def[2]], dp, A, B, lineCol[cls], je); }
      else if (cls !== 9) ribbon(groups[def[2]], dp, 0, hw, lineCol[cls], 0, je);
      if (!l.ring && cls <= 2 && !(tags && tags.noCentre)) mark(li, dp, 0, 0.07, WHITE, 'c', [3, 9]);   // no centre line where OSM says lane_markings=no
      if (!l.ring && cls === 0) { mark(li, dp, hw - 0.45, 0.07, WHITE, 'e'); mark(li, dp, -hw + 0.45, 0.07, WHITE, 'e'); }
      if (cls <= 3 && !rural) for (const sg of [1, -1]) mark(li, dp, sg * (hw - 0.02), 0.09, GUT, 'g');   // the gutter shadow where a kerb stands
    }
    if (cls <= 4) { l.zone = hwC; for (let i = 0; i < n - 1; i++) addZone(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], li, hwC); }
    if (cls === 8) { dashes(marks, dp, 0, 1.25, 0.25, 0.6, SLEEP); railBar(extra, dp, 0.76); railBar(extra, dp, -0.76); }   // steel rails on the sleepers
    if (cls === 9) { TRAMLINES.push(pts); for (let i = 0; i < n - 1; i++) TRAMGRID.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], 0, 0); tramLater.push({ dp, gbc: STATE.GBC }); }   // drawn once all the roads are known
    if (cls <= 4) for (let i = 0; i < n - 1; i++) CARROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hwC, cls);
    if (cls < 10 || cls === 15) for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hwC + (cls <= 3 ? 2.6 : 0), cls <= 7 ? l.name : -1);
    if (l.bridge && cls !== 10 && cls !== 11 && !fortBridgeLine(pts) && !onOv && !jn && !(cls === 8 && rbOnLine(pts))) bridge(extra, dp, hw + (cls <= 3 ? 2.7 : 0.3));   // the railway bridge over the Daugava: lmRailBridge
    STATE.GBC = null;
    if (cls <= 3 && !rural) { // street lamps every ~32 m on one side (the outer side of a carriageway of a pair); none on a country road
      const side = dual ? -dual.side : l.ring ? -l.ring.inner : rnd(lampSeq++, 5) < 0.5 ? 1 : -1, hw = hwC; let acc = 14;
      for (let i = 0; i < n - 1; i++) {
        const x1 = pts[2 * i], z1 = pts[2 * i + 1], x2 = pts[2 * i + 2], z2 = pts[2 * i + 3], L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.01) continue;
        const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
        while (acc < L) {
          const off = (hw + 0.6) * side, x = x1 + tx * acc - tz * off, z = z1 + tz * acc + tx * off, k = Math.round(x / 14) + ',' + Math.round(z / 14);
          let trk = false; TRK.near(x, z, 2.2, () => { trk = true; });   // not on a tram bed
          if (!trk && !lampGrid.has(k) && Math.abs(x) < HX && Math.abs(z) < HY) { lampGrid.add(k); LAMPS.push(x, z, Math.atan2(tx * side, tz * side)); }   // the arm (local +x turned by the angle: cos a, −sin a) reaches over the carriageway
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
  buildRoadSurf(groups[4]);   // the carriageways the skirt feet must meet (src/world/streets.js, footAt)
  zSeen = new Int32Array(ZR.s.length / 6);
  for (const S of SLABS) {   // the sidewalk slabs, cut at the junctions now that every carriageway is in ZR
    if (due()) await pause();
    STATE.GBC = S.gbc;
    const n = S.p.length >> 1, p = S.p, q0 = [], q1 = [];
    for (let i = 0; i < n; i++) {
      const [tx, tz, m] = frame(p, i, n, S.E), nx = -tz, nz = tx;
      const oa = S.v ? S.A[i] : S.off - S.hw, ob = S.v ? S.B[i] : S.off + S.hw, fall = Math.abs(oa) < Math.abs(ob);
      q0.push({ x: p[2 * i] + nx * oa * m, z: p[2 * i + 1] + nz * oa * m, y: WH + (fall ? 0 : 0.02) });
      q1.push({ x: p[2 * i] + nx * ob * m, z: p[2 * i + 1] + nz * ob * m, y: WH + (fall ? 0.02 : 0) });
    }
    const r0 = clipEdge(S.li, p, q0), r1 = clipEdge(S.li, p, q1), SC = sh(S.col, 0.72);
    if (r0.length && r0.length === r1.length) {
      for (let k = 0; k < r0.length; k++) {
        const A = r0[k], B = r1[k];
        let ring = []; for (const q of A) ring.push(q.x, q.z); for (let j = B.length - 1; j >= 0; j--) ring.push(B[j].x, B[j].z);
        if (area2(ring) < 0) ring = reversed(ring);
        const { flat, tris } = triangulate([ring]), yOf = new Map();
        for (const q of A) yOf.set(q.x + ',' + q.z, q.y); for (const q of B) yOf.set(q.x + ',' + q.z, q.y);
        const v0 = walk.v; walk.ensure(flat.length / 2);
        for (let j = 0; j < flat.length; j += 2) walk.vert(flat[j], yOf.get(flat[j] + ',' + flat[j + 1]) ?? WH, flat[j + 1], 0, 1, 0, S.col);
        for (let j = 0; j < tris.length; j += 3) walk.triUp(v0 + tris[j], v0 + tris[j + 1], v0 + tris[j + 2]);
        skirt(extra, A.flatMap(q => [q.x, q.z]), A.map(q => q.y), SC, true, A.map(q => footAt(q.x, q.z)));
        skirt(extra, B.flatMap(q => [q.x, q.z]), B.map(q => q.y), SC, false, B.map(q => footAt(q.x, q.z)));
        const cap = (u, v, sgn) => {
          if (Math.hypot(u.x - v.x, u.z - v.z) < 1e-6) return;
          const [tx, tz] = frame(p, u.i, n, S.E);
          polyA(extra, [[u.x, footAt(u.x, u.z), u.z], [u.x, u.y, u.z], [v.x, v.y, v.z], [v.x, footAt(v.x, v.z), v.z]], SC, tx * sgn, 0, tz * sgn);
        };
        cap(A[0], B[0], -1); cap(A[A.length - 1], B[B.length - 1], 1);
        walkRing(ring, WH);
      }
    } else {   // the edges disagree on the number of runs (a capsule grazing one edge): square caps on centre-line runs
      const np = n;
      for (const r of clipSlab(S.li, p)) {
        const m = r.length, pr = new Float32Array(m * 2); for (let j = 0; j < m; j++) { pr[2 * j] = r[j].x; pr[2 * j + 1] = r[j].z; }
        const E = S.E ? [r[0].i === 0 && r[0].t === 0 ? S.E[0] : null, r[m - 1].i === np - 2 && r[m - 1].t === 1 ? S.E[1] : null] : null;
        const En = E && (E[0] || E[1]) ? E : null;
        if (S.v) slabRunV(walk, extra, pr, r.map(q => S.A[q.i] + (S.A[q.i + 1] - S.A[q.i]) * q.t), r.map(q => S.B[q.i] + (S.B[q.i + 1] - S.B[q.i]) * q.t), S.col, En);
        else slabRun(walk, extra, pr, S.off, S.hw, S.col, En);
      }
    }
  }
  STATE.GBC = null;
  for (const J of JOBS) { if (due()) await pause(); STATE.GBC = J.gbc; const tgt = J.kind === 'w' || J.kind === 'g' ? wear : marks;   // wheel polish and gutter shadow go to the transparent wear sheet
    for (const run of clipRuns(J)) { if (J.dash) dashes(tgt, run, 0, J.w, J.dash[0], J.dash[1], J.col); else ribbon(tgt, run, 0, J.w, J.col); if (J.kind === 'k') curbBar(extra, run, J.w, J.sA, CURB); } }
  for (const Hh of HATCH) { if (due()) await pause(); STATE.GBC = Hh.gbc; hatch(marks, Hh.p, Hh.A, Hh.B, Hh.s, WHITE, (x, z, tx, tz) => inZones(zonesNear(Hh.li, x, z, 0.2, tx, tz), 'c', x, z)); }
  STATE.GBC = null;
  buildSignals(sorted, ZR, ZB, marks, WHITE, N18);   // traffic lights and stop lines on 18. novembra iela, give way at the roundabouts
  const orders = [-37, -37, -36, -35, -34, -33], mats = [M_LAND, M_PAVE, M_DIRT, M_BALLAST, M_ASPH, M_MARK];
  groups.forEach((g, k) => { const m = g.mesh(mats[k]); if (m) { m.renderOrder = orders[k] + (k === 0 ? -0.5 : 0); m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } });
  const em = extra.mesh(matPlain); if (em) { em.castShadow = em.receiveShadow = true; scene.add(em); }
  const wm = wear.mesh(wearMat()); if (wm) { wm.renderOrder = -33.6; wm.frustumCulled = false; wm.receiveShadow = true; scene.add(wm); }
  await buildStreetWear(sorted);   // covers, patches, stains and the weeds of the kerbs (src/world/streetwear.js)
  releaseGroundSurf(); RS = null;   // the drawn-ground and road indexes were only needed to foot the skirts on them
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


