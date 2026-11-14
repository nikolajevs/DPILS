import { STATE } from '../core/state.js';
import { CARROAD, TRAMGRID } from '../transit/transit.js';
import { fortBridgeLine, fortSkipLine } from '../fortress/index.js';
import { airOnLine } from '../landmarks/air-bridge.js';
import { jnFix } from '../landmarks/junction.js';
import { spwTrackLine } from '../landmarks/speedway.js';
import { ovComp, ovDensify, ovPrep, ovTouches } from './overpass.js';
import { vbOnLine } from './bridge-vienibas.js';
import { COL, LINES, M_ASPH, M_BALLAST, M_DIRT, M_LAND, M_MARK, M_PAVE, ROAD, STREAM, TRAMLINES, inWater, matPlain } from './data.js';
import { LINE } from './palette.js';
import { TERR, bridgeDeck, bridgeOf, densify } from './terrain.js';
import { scene } from '../render/renderer.js';
import { GB, box, polyA } from '../core/geometry.js';
import { bbox, dec, hb, rnd, sh } from '../core/util.js';
import { C, HX, HY, WL } from '../core/env.js';

/* ---------- streets, sidewalks, rails, bridges, walls ---------- */
function ribbon(b, p, off, hw, col, y = 0) {
  const n = p.length >> 1; if (n < 2) return; const v0 = b.v; b.ensure(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1);
    let tx = p[2 * c] - p[2 * a], tz = p[2 * c + 1] - p[2 * a + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    let m = 1;
    if (i > 0 && i < n - 1) { const sx = p[2 * i] - p[2 * a], sz = p[2 * i + 1] - p[2 * a + 1]; const sl = Math.hypot(sx, sz) || 1; m = 1 / Math.max(0.5, (sx * tx + sz * tz) / sl); }
    const nx = -tz, nz = tx;
    b.vert(p[2 * i] + nx * (off - hw) * m, y, p[2 * i + 1] + nz * (off - hw) * m, 0, 1, 0, col);
    b.vert(p[2 * i] + nx * (off + hw) * m, y, p[2 * i + 1] + nz * (off + hw) * m, 0, 1, 0, col);
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
const LAMPS = [];
function buildLines() {
  if (TERR.on) ovPrep();
  const groups = [0, 1, 2, 3, 4, 5].map(() => new GB(false)), lineCol = {}; for (const k in LINE) lineCol[k] = hb(LINE[k][1]);
  const walk = groups[1], marks = groups[5], extra = new GB(false);
  const PAVE = hb('#8f897e'), CURB = hb('#a9a69e'), WHITE = hb('#e8e6df'), RAIL = hb('#4a4440'), SLEEP = hb('#635d56');
  const sorted = C.l.map(l => ({ cls: l[0], name: l[1], pts: dec(l[2]), bridge: !!l[3] }));
  sorted.sort((a, b) => (b.cls <= 4 && a.cls <= 4) ? b.cls - a.cls : 0);
  let lampSeq = 0; const lampGrid = new Set(), tramLater = [];
  for (const l of sorted) {
    const { cls, pts } = l; const n = pts.length >> 1;
    if (cls === 12 || cls === 13 || cls === 14) {
      if (fortSkipLine(cls, pts)) continue;   // the fortress draws its own walls and earthworks
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
    if (l.bridge && airOnLine(pts)) {   // the air bridge to Jaunā Forštadte: lmAirBridge draws it and sets its heights
      for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, l.name);
      continue;
    }
    // on the overpass of 18. novembra iela everything but the railway under it follows the corridor's own profile
    const onOv = TERR.on && cls !== 8 && cls !== 10 && cls !== 11 && ovTouches(l.bb);
    const onBridge = l.bridge && cls !== 10 && cls !== 11 && TERR.on && !onOv, dp = onOv ? ovDensify(densify(pts)) : TERR.on ? densify(pts) : pts;
    let jn = false;
    if (onOv) STATE.GBC = ovComp;
    else if (onBridge) { const B = bridgeOf(pts, hw + (cls <= 3 ? 2.7 : 0.3)); jn = jnFix(B); STATE.GBC = bridgeDeck(B); } else STATE.GBC = null;
    if (cls === 10 || cls === 11) for (let i = 0; i < n - 1; i++) STREAM.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, 0);
    if (cls <= 3) { ribbon(walk, dp, hw + 1.4, 1.3, PAVE); ribbon(walk, dp, -hw - 1.4, 1.3, PAVE); ribbon(marks, dp, hw + 0.08, 0.12, CURB); ribbon(marks, dp, -hw - 0.08, 0.12, CURB); }
    if (cls !== 9) ribbon(groups[def[2]], dp, 0, hw, lineCol[cls]);
    if (cls <= 2) dashes(marks, dp, 0, 0.07, 3, 9, WHITE);
    if (cls === 0) { ribbon(marks, dp, hw - 0.45, 0.07, WHITE); ribbon(marks, dp, -hw + 0.45, 0.07, WHITE); }
    if (cls === 8) { dashes(marks, dp, 0, 1.25, 0.25, 0.6, SLEEP); railBar(extra, dp, 0.76); railBar(extra, dp, -0.76); }   // steel rails on the sleepers
    if (cls === 9) { TRAMLINES.push(pts); for (let i = 0; i < n - 1; i++) TRAMGRID.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], 0, 0); tramLater.push({ dp, gbc: STATE.GBC }); }   // drawn once all the roads are known
    if (cls <= 4) for (let i = 0; i < n - 1; i++) CARROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw, cls);
    if (cls < 10 || cls === 15) for (let i = 0; i < n - 1; i++) ROAD.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], hw + (cls <= 3 ? 2.6 : 0), cls <= 7 ? l.name : -1);
    if (l.bridge && cls !== 10 && cls !== 11 && !fortBridgeLine(pts) && !onOv && !jn) bridge(extra, dp, hw + (cls <= 3 ? 2.7 : 0.3));
    STATE.GBC = null;
    if (cls <= 3) { // street lamps every ~32 m on one side
      const side = rnd(lampSeq++, 5) < 0.5 ? 1 : -1; let acc = 14;
      for (let i = 0; i < n - 1; i++) {
        const x1 = pts[2 * i], z1 = pts[2 * i + 1], x2 = pts[2 * i + 2], z2 = pts[2 * i + 3], L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.01) continue;
        const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
        while (acc < L) {
          const off = (hw + 0.6) * side, x = x1 + tx * acc - tz * off, z = z1 + tz * acc + tx * off, k = Math.round(x / 14) + ',' + Math.round(z / 14);
          if (!lampGrid.has(k) && Math.abs(x) < HX && Math.abs(z) < HY) { lampGrid.add(k); LAMPS.push(x, z, Math.atan2(tz * side, -tx * side) ); }
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
    STATE.GBC = T.gbc; const p = T.dp, m = p.length >> 1; let run = [p[0], p[1]], emb = null;
    const flush = () => { if (run.length < 4) return;
      if (emb) { ribbon(groups[4], run, 0, 1.25, TSLAB); for (const o of [0.76, -0.76]) { ribbon(marks, run, o, 0.04, TSTEEL); ribbon(marks, run, o - Math.sign(o) * 0.07, 0.015, RAIL); } }
      else { ribbon(groups[3], run, 0, LINE[9][0] / 2, lineCol[9]); dashes(marks, run, 0, 1.25, 0.25, 0.6, SLEEP); railBar(extra, run, 0.76); railBar(extra, run, -0.76); } };
    for (let i = 0; i < m - 1; i++) {
      const mx = (p[2 * i] + p[2 * i + 2]) / 2, mz = (p[2 * i + 1] + p[2 * i + 3]) / 2; let e = false;
      CARROAD.near(mx, mz, 8, (id, d) => { if (CARROAD.s[id * 6 + 5] <= 3 && d < CARROAD.s[id * 6 + 4] - 0.3) e = true; });
      if (emb === null) emb = e; if (e !== emb) { flush(); run = [p[2 * i], p[2 * i + 1]]; emb = e; }
      run.push(p[2 * i + 2], p[2 * i + 3]);
    }
    flush();
  }
  STATE.GBC = null;
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
