import * as THREE from 'three';
import { SIGNALS } from './street-tags.js';
import { COL, inBuilding, matPlain } from './data.js';
import { STATE } from '../core/state.js';
import { U, hook, scene } from '../render/renderer.js';
import { GB, box, lathe, polyA } from '../core/geometry.js';
import { hb } from '../core/util.js';

/* ---------- traffic lights on 18. novembra iela ----------
   The signals OSM maps on the street (src/world/street-tags.js) within 35 m of each other make one signalled junction or
   crossing, centred on its junction nodes. Every street that leads into it is an approach: a line of the city data seen
   from the junction, 20 m out along it. The traffic that comes in drives on the right: on a two-way street the right half
   of the carriageway, on a pair of one-way carriageways the one on the right. Each approach gets a stop line across the
   lanes coming in, 1.2 m before the carriageway it crosses or 0.8 m before the zebra in front of it, and a signal on a
   post at the right kerb by the stop line, facing the drivers: three lenses that go through the cycle below (they glow
   the same by day and night). At the signalled zebras pedestrian signals stand at both kerbs. */
function buildSignals(sorted, ZR, ZB, marks, WHITE, N18) {
  // the junctions: signal nodes chained within 35 m
  const par = SIGNALS.map((_, i) => i), root = i => par[i] === i ? i : (par[i] = root(par[i]));
  for (let i = 0; i < SIGNALS.length; i++) for (let j = i + 1; j < SIGNALS.length; j++) if (Math.hypot(SIGNALS[i][0] - SIGNALS[j][0], SIGNALS[i][1] - SIGNALS[j][1]) < 35) par[root(i)] = root(j);
  const groups = new Map(); SIGNALS.forEach((s, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });

  const post = new GB(false), lens = new GB(false), POLE = hb('#4a4f53'), HEAD = hb('#1f2123');
  const DIM = { r: hb('#3d1713'), a: hb('#3b2d12'), g: hb('#12301d') }, LIT = { r: [255, 38, 26], a: [255, 168, 24], g: [40, 255, 130] };
  const ROLE = { A: 0.2, B: 0.4, PA: 0.6, PB: 0.8 }, COLR = { r: 0.25, a: 0.5, g: 0.75 };
  const s = ZR.s; let offset = 0;   // the junction's place in the cycle, a fraction of it
  // painted shapes on the road (corners [x, z] in order around)
  const quad = (a, b, c, d) => { const v = marks.v; for (const p of [a, b, c, d]) marks.vert(p[0], 0, p[1], 0, 1, 0, WHITE); marks.triUp(v, v + 1, v + 2); marks.triUp(v, v + 2, v + 3); };
  const tri = (a, b, c) => { const v = marks.v; for (const p of [a, b, c]) marks.vert(p[0], 0, p[1], 0, 1, 0, WHITE); marks.triUp(v, v + 1, v + 2); };
  /* a lane arrow 5 m long from (x, z) pointing along (dx, dz): a shaft 0.16 m wide, the straight head 1.4 m long, and a
     branch to the left or right leaving the shaft at 1.5 m at 45°, with its own head */
  function arrow(x, z, dx, dz, S, L, R) {
    const lx = dz, lz = -dx, P = (u, v) => [x + dx * u + lx * v, z + dz * u + lz * v], top = S ? 3.6 : 2.2;
    quad(P(0, -0.08), P(top, -0.08), P(top, 0.08), P(0, 0.08));
    if (S) tri(P(3.6, -0.38), P(3.6, 0.38), P(5, 0));
    for (const [on, sg] of [[L, 1], [R, -1]]) { if (!on) continue;
      const eu = 0.707, ev = 0.707 * sg, nu = -ev, nv = eu, w = 0.08, u0 = 1.5, v0 = 0, u1 = 2.5, v1 = sg;
      quad(P(u0 + nu * w, v0 + nv * w), P(u1 + nu * w, v1 + nv * w), P(u1 - nu * w, v1 - nv * w), P(u0 - nu * w, v0 - nv * w));
      tri(P(u1 + nu * 0.35, v1 + nv * 0.35), P(u1 - nu * 0.35, v1 - nv * 0.35), P(u1 + eu * 0.7, v1 + ev * 0.7)); }
  }
  /* a lens: a square of half size h facing (fx, fz) at (x, y, z). The dark glass is part of the head; the light in front
     of it is a square of the lens mesh that the shader shows only while it is on. What it belongs to rides in the normal,
     which an unlit material has no use for: x the role (A, B, PA, PB), y the colour, z the junction's offset. */
  function lensAt(x, y, z, fx, fz, h, c, role) {
    const rx = fz, rz = -fx, Q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    polyA(post, Q.map(([a, b]) => [x + rx * a * h, y + b * h, z + rz * a * h]), DIM[c], fx, 0, fz);
    const k = Q.map(([a, b]) => lens.vert(x + fx * 0.006 + rx * a * h, y + b * h, z + fz * 0.006 + rz * a * h, ROLE[role], COLR[c], offset, LIT[c]));
    lens.tri(k[0], k[1], k[2]); lens.tri(k[0], k[2], k[3]);   // counter-clockwise seen from in front
  }
  // a signal on a post at (bx, bz), its head facing (fx, fz): three lenses for traffic, two for pedestrians
  function signal(bx, bz, fx, fz, ped, role) {
    if (inBuilding(bx, bz)) return;
    const y0 = ped ? 1.95 : 2.3, y1 = ped ? 2.65 : 3.4, hx = bx + fx * 0.05, hz = bz + fz * 0.05;
    lathe(post, bx, bz, 0, [[0.07, 0], [0.06, y1 + 0.15]], 6, 0, POLE);
    box(post, hx, hz, fx, fz, 0.12, ped ? 0.14 : 0.17, y0, y1, HEAD);
    if (!ped) box(post, hx - fx * 0.13, hz - fz * 0.13, fx, fz, 0.015, 0.3, y0 - 0.1, y1 + 0.1, HEAD);   // the backplate
    const lx = hx + fx * 0.125, lz = hz + fz * 0.125;
    if (ped) { lensAt(lx, 2.45, lz, fx, fz, 0.1, 'r', role); lensAt(lx, 2.15, lz, fx, fz, 0.1, 'g', role); }
    else { lensAt(lx, 3.12, lz, fx, fz, 0.11, 'r', role); lensAt(lx, 2.85, lz, fx, fz, 0.11, 'a', role); lensAt(lx, 2.58, lz, fx, fz, 0.11, 'g', role); }
    COL.add(bx, bz, bx + 0.01, bz, 0.12, 0);
  }
  // the lines of the streets near (cx, cz): each with its point nearest the junction
  function approaches(cx, cz) {
    const lines = new Map();
    ZR.near(cx, cz, 30, (id, d, px, pz) => { const k = id * 6, li = s[k + 4], o = sorted[li]; if (o.cls > 3 || s[k + 5] !== o.zone) return; const e = lines.get(li); if (!e || d < e.d) lines.set(li, { li, d, px, pz, hw: o.zone }); });
    const arms = [];
    for (const L of lines.values()) {
      const p = sorted[L.li].pts, n = p.length >> 1, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
      let sN = 0, bd = 1e9;   // the distance along the line of the point nearest the junction
      for (let i = 0; i < n - 1; i++) { const dx = p[2 * i + 2] - p[2 * i], dz = p[2 * i + 3] - p[2 * i + 1], l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((L.px - p[2 * i]) * dx + (L.pz - p[2 * i + 1]) * dz) / l2)), d = Math.hypot(L.px - p[2 * i] - dx * t, L.pz - p[2 * i + 1] - dz * t); if (d < bd) { bd = d; sN = cum[i] + t * Math.sqrt(l2); } }
      const at = sv => { let i = 0; while (i < n - 2 && cum[i + 1] < sv) i++; const t = Math.max(0, Math.min(1, (sv - cum[i]) / ((cum[i + 1] - cum[i]) || 1))); return [p[2 * i] + (p[2 * i + 2] - p[2 * i]) * t, p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * t]; };
      for (const dir of [1, -1]) { const E = at(Math.max(0, Math.min(cum[n - 1], sN + dir * 20))), ex = E[0] - L.px, ez = E[1] - L.pz, el = Math.hypot(ex, ez); if (el < 8) continue;
        arms.push({ li: L.li, qx: L.px, qz: L.pz, ux: ex / el, uz: ez / el, hw: L.hw }); }
    }
    return arms;
  }
  let gi = 0;
  for (const g of groups.values()) {
    const J = g.filter(t => t[2] === 'j'), src = J.length ? J : g, cx = src.reduce((a, t) => a + t[0], 0) / src.length, cz = src.reduce((a, t) => a + t[1], 0) / src.length;
    const arms = approaches(cx, cz); offset = (gi++ * 23 % 60) / 60;   // the junctions out of step with each other
    for (const A of arms) {
      const rx = A.uz, rz = -A.ux, line = sorted[A.li], o = (A.qx - cx) * rx + (A.qz - cz) * rz;   // right of the drivers coming in
      if (line.isDual && o < 0) continue;   // the carriageway going out
      const a = line.isDual ? -A.hw + 0.3 : 0.15, b = A.hw - 0.3;
      // the stop line: past the carriageways it crosses, and before the zebra in front of it
      let dS = 2;
      for (const B of arms) { if (B.li === A.li || Math.abs(B.ux * A.ux + B.uz * A.uz) > 0.8) continue;
        const nx = -B.uz, nz = B.ux, c0 = (A.qx - B.qx) * nx + (A.qz - B.qz) * nz, k = A.ux * nx + A.uz * nz; if (Math.abs(k) < 0.2) continue;
        const sx = Math.max((B.hw - c0) / k, (-B.hw - c0) / k); if (sx > 0 && sx < 30) dS = Math.max(dS, sx + 1.2); }
      for (const Z of ZB) { const zs = (Z.x - A.qx) * A.ux + (Z.z - A.qz) * A.uz, zl = (Z.x - A.qx) * rx + (Z.z - A.qz) * rz;
        if (zs > 0 && zs < 30 && Math.abs(zl) < A.hw + 1 && Math.abs(Z.tx * A.ux + Z.tz * A.uz) > 0.8) dS = Math.max(dS, zs + 2.8); }
      if (dS > 30) continue;
      const P = (sv, off) => [A.qx + A.ux * sv + rx * off, A.qz + A.uz * sv + rz * off];
      quad(P(dS, a), P(dS, b), P(dS + 0.4, b), P(dS + 0.4, a));
      const B = P(dS + 0.6, A.hw + 1.0); signal(B[0], B[1], A.ux, A.uz, false, line.name === N18 ? 'A' : 'B');
      /* the lanes coming in: two on a carriageway of four lanes (or of a pair, two lanes wide), else one; the ways out of
         the junction seen from them (ahead, to the left, to the right) give the arrows: one lane takes them all, of two
         the left one goes ahead and left, the right one ahead and right. Over the last 20 m before the stop line the line
         between two lanes is solid. */
      const nL = line.isDual ? (A.hw >= 3 ? 2 : 1) : (A.hw >= 6 ? 2 : 1), lo = line.isDual ? -A.hw : 0, lw = (line.isDual ? 2 * A.hw : A.hw) / nL;
      const dx = -A.ux, dz = -A.uz, lx = dz, lz = -dx; let ahead = false, left = false, right = false;
      for (const O of arms) { if (O.ux * A.ux + O.uz * A.uz > 0.8) continue; const f = O.ux * dx + O.uz * dz, sd = O.ux * lx + O.uz * lz;
        if (f > 0.7) ahead = true; else if (sd > 0.6) left = true; else if (sd < -0.6) right = true; }
      if (nL === 2) { const m = lo + lw; quad(P(dS, m - 0.07), P(dS, m + 0.07), P(dS + 20, m + 0.07), P(dS + 20, m - 0.07)); }
      for (let i = 0; i < nL; i++) {
        const S = ahead, L = left && i === 0, R = right && i === nL - 1;
        if (!S && !L && !R) continue; const c = P(dS + 7.5, lo + (i + 0.5) * lw); arrow(c[0], c[1], dx, dz, S || (!L && !R), L, R);
      }
    }
    // the pedestrian signals at the zebras of the junction: crossing 18. novembra iela (PA) or a side street (PB)
    for (const Z of ZB) { if (Math.hypot(Z.x - cx, Z.z - cz) > 25) continue; const nx = -Z.tz, nz = Z.tx, role = sorted[Z.li].name === N18 ? 'PA' : 'PB';
      for (const sg of [1, -1]) signal(Z.x + nx * sg * (Z.hw + 0.8) + Z.tx * 2.4, Z.z + nz * sg * (Z.hw + 0.8) + Z.tz * 2.4, -nx * sg, -nz * sg, true, role); }
  }
  /* Give way. Where a tertiary or residential side street joins or crosses 18. novembra iela further than 40 m from its
     signals, the main street goes first: the lanes of the side street coming in get a broken transverse line (dashes 0.5 m with gaps of 0.4 m,
     0.3 m wide) 0.8 m before the carriageway of 18. novembra iela, or before the zebra in front of it. */
  const main18 = (x, z, r) => { let best = null;
    ZR.near(x, z, r, (id, d, px, pz) => { const k = id * 6, o = sorted[s[k + 4]]; if (o.name !== N18 || o.cls > 3 || s[k + 5] !== o.zone || (best && d >= best.d)) return;
      const ex = s[k + 2] - s[k], ez = s[k + 3] - s[k + 1], el = Math.hypot(ex, ez) || 1; best = { d, px, pz, tx: ex / el, tz: ez / el, hw: o.zone }; });
    return best; };
  sorted.forEach((L, li) => {
    // tertiary and residential side streets: a primary or secondary one is a main road itself (Daugavas and Krāslavas iela,
    // which carry on from the ends of 18. novembra iela)
    if (L.cls > 3 || L.cls < 2 || L.name === N18 || !L.zone || L.zone < 2 || L.isDual) return;
    const p = L.pts, n = p.length >> 1, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
    const at = sv => { let i = 0; while (i < n - 2 && cum[i + 1] < sv) i++; const t = Math.max(0, Math.min(1, (sv - cum[i]) / ((cum[i + 1] - cum[i]) || 1))); return [p[2 * i] + (p[2 * i + 2] - p[2 * i]) * t, p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * t]; };
    // where it meets the main street (as a distance along it): an end on the carriageway, or a segment across the centre line
    const meets = [];
    for (const [i, sv] of [[0, 0], [n - 1, cum[n - 1]]]) { const M = main18(p[2 * i], p[2 * i + 1], 14); if (M && M.d < M.hw + 3) meets.push([sv, M]); }
    for (let i = 0; i < n - 1; i++) { const ax = p[2 * i], az = p[2 * i + 1], ex = p[2 * i + 2] - ax, ez = p[2 * i + 3] - az, el = Math.hypot(ex, ez); if (el < 0.5) continue;
      ZR.near(ax + ex / 2, az + ez / 2, el / 2 + 1, id => { const k = id * 6, o = sorted[s[k + 4]]; if (o.name !== N18 || o.cls > 3 || s[k + 5] !== o.zone) return;
        const rx = s[k + 2] - s[k], rz = s[k + 3] - s[k + 1], den = ex * rz - ez * rx; if (Math.abs(den) < 1e-9) return;
        const t = ((s[k] - ax) * rz - (s[k + 1] - az) * rx) / den, u = ((s[k] - ax) * ez - (s[k + 1] - az) * ex) / den; if (t <= 0 || t >= 1 || u < 0 || u > 1) return;
        const rl = Math.hypot(rx, rz) || 1; meets.push([cum[i] + t * el, { px: ax + ex * t, pz: az + ez * t, tx: rx / rl, tz: rz / rl, hw: o.zone }]); }); }
    const done = [];
    for (const [sv, M] of meets) {
      const Q = at(sv); if (done.some(d => Math.abs(d - sv) < 10) || SIGNALS.some(t => Math.hypot(t[0] - Q[0], t[1] - Q[1]) < 40)) continue; done.push(sv);
      for (const dir of [1, -1]) { const s2 = Math.max(0, Math.min(cum[n - 1], sv + dir * 15)), E = at(s2), el = Math.hypot(E[0] - Q[0], E[1] - Q[1]); if (el < 8) continue;
        const ux = (E[0] - Q[0]) / el, uz = (E[1] - Q[1]) / el, rx = uz, rz = -ux, nx = -M.tz, nz = M.tx, c0 = (Q[0] - M.px) * nx + (Q[1] - M.pz) * nz, k = ux * nx + uz * nz;
        if (Math.abs(k) < 0.3) continue; const sx = Math.max((M.hw - c0) / k, (-M.hw - c0) / k); if (!(sx > 0 && sx < 25)) continue;
        let dS = sx + 0.8;
        for (const Z of ZB) { if (Z.li !== li) continue; const zs = (Z.x - Q[0]) * ux + (Z.z - Q[1]) * uz; if (zs > 0 && zs < 25) dS = Math.max(dS, zs + 2.8); }
        const P = (sv2, off) => [Q[0] + ux * sv2 + rx * off, Q[1] + uz * sv2 + rz * off], b = L.zone - 0.3;
        for (let t = 0.15; t < b - 0.1; t += 0.9) { const e = Math.min(t + 0.5, b); quad(P(dS, t), P(dS, e), P(dS + 0.3, e), P(dS + 0.3, t)); }
      }
    }
  });
  roundabouts(sorted, ZB, quad);
  const pm = post.mesh(matPlain); if (pm) { pm.castShadow = pm.receiveShadow = true; scene.add(pm); }
  const lm = lens.mesh(hook(new THREE.MeshBasicMaterial({ vertexColors: true }), 'signal-lens', sh => {
    sh.uniforms.uSigTime = U.time;
    sh.vertexShader = 'uniform float uSigTime;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + CYCLE);
  }));
  if (lm) scene.add(lm);
  return groups.size;
}
/* Give way at the roundabouts: the traffic on the ring goes first. A ring is a closed street of classes 0–3 drawn round
   (16 points or more, every one within 10 % of the mean radius, 8–40 m): the two of Latgales iela, Vidzemes, Smiltenes
   iela and a few more. Every street that ends on it gets the broken transverse line across the lanes coming in, 0.8 m
   out from the outer edge of the ring, or past a zebra that lies right there. OSM keeps a one-way way in its direction, so
   of the one-way carriageways at a ring (a pair split from one node, or of the same street side by side, both ends
   within 40 m and leaving the same way) the one that ends there comes in, across its whole width, and the one that
   starts there goes out. A two-way street gets the line on the right half, the lanes coming in. */
function roundabouts(sorted, ZB, quad) {
  const rings = [];
  sorted.forEach((L, li) => { const p = L.pts, n = p.length >> 1; if (L.cls > 3 || !L.zone || n < 16 || Math.hypot(p[0] - p[2 * n - 2], p[1] - p[2 * n - 1]) > 1) return;
    let cx = 0, cz = 0, R = 0; for (let i = 0; i < n - 1; i++) { cx += p[2 * i]; cz += p[2 * i + 1]; } cx /= n - 1; cz /= n - 1;
    for (let i = 0; i < n - 1; i++) R += Math.hypot(p[2 * i] - cx, p[2 * i + 1] - cz); R /= n - 1; if (R < 8 || R > 40) return;
    for (let i = 0; i < n - 1; i++) if (Math.abs(Math.hypot(p[2 * i] - cx, p[2 * i + 1] - cz) - R) > 0.1 * R) return;
    rings.push({ li, cx, cz, R, hw: L.zone }); });
  for (const G of rings) {
    // the streets ending on the ring: the end (0 the first point, 1 the last), the points from it out, the way out
    const ends = [];
    sorted.forEach((L, li) => { if (li === G.li || L.cls > 4 || !L.zone) return; const p = L.pts, n = p.length >> 1; if (n < 2) return;
      for (const e of [0, 1]) { const i0 = e ? n - 1 : 0; if (Math.abs(Math.hypot(p[2 * i0] - G.cx, p[2 * i0 + 1] - G.cz) - G.R) > G.hw + 1.5) continue;
        const q = []; for (let k = 0; k < n; k++) { const i = e ? n - 1 - k : k; q.push(p[2 * i], p[2 * i + 1]); }
        let ox = 0, oz = 0; for (let k = 2, acc = 0; k < q.length && acc < 12; k += 2) { acc += Math.hypot(q[k] - q[k - 2], q[k + 1] - q[k - 1]); ox = q[k] - q[0]; oz = q[k + 1] - q[1]; }
        const ol = Math.hypot(ox, oz); if (ol < 1) continue;
        ends.push({ li, e, q, ox: ox / ol, oz: oz / ol, key: L.name >= 0 ? 'n' + L.name : 'c' + L.cls }); } });
    for (const E of ends) {
      const L = sorted[E.li], q = E.q, m = q.length >> 1, fx = q[q.length - 2], fz = q[q.length - 1];
      // a one-way pair: the two split from one node (their far ends meet) or run side by side under one name
      const oneway = L.isDual || ends.some(F => F.li !== E.li && F.e !== E.e && Math.hypot(F.q[0] - q[0], F.q[1] - q[1]) < 60 &&
        (Math.hypot(F.q[F.q.length - 2] - fx, F.q[F.q.length - 1] - fz) < 3 || (F.key === E.key && Math.hypot(F.q[0] - q[0], F.q[1] - q[1]) < 40 && F.ox * E.ox + F.oz * E.oz > 0.8)));
      if (oneway && E.e === 0) continue;   // a one-way carriageway leaving the ring
      // out along the street to 0.8 m past the outer edge of the ring
      const at = sv => { let acc = 0; for (let k = 0; k < m - 1; k++) { const dx = q[2 * k + 2] - q[2 * k], dz = q[2 * k + 3] - q[2 * k + 1], l = Math.hypot(dx, dz); if (l < 1e-6) continue;
          if (acc + l >= sv || k === m - 2) { const t = Math.min(1, (sv - acc) / l); return [q[2 * k] + dx * t, q[2 * k + 1] + dz * t, dx / l, dz / l]; } acc += l; } return null; };
      let dS = -1; for (let sv = 0; sv < 30; sv += 0.25) { const P = at(sv); if (!P) break; if (Math.hypot(P[0] - G.cx, P[1] - G.cz) >= G.R + G.hw + 0.8) { dS = sv; break; } }
      if (dS < 0) continue;
      // a zebra the line would cross (its stripes run 2 m either side of it) puts the line out past it; one set back a car
      // length or more, as most at the rings are, leaves it at the ring
      for (const Z of ZB) { if (Z.li !== E.li) continue; const zs = Math.hypot(Z.x - q[0], Z.z - q[1]); if (Math.abs(zs - dS) < 2.6) dS = Math.max(dS, zs + 2.8); }
      const A = at(dS), B = at(dS + 0.3); if (!A || !B) continue;
      const ux = A[2], uz = A[3], rx = uz, rz = -ux, hw = L.zone, a = oneway ? -hw + 0.3 : 0.15, b = hw - 0.3;
      const P = (Q, off) => [Q[0] + rx * off, Q[1] + rz * off];
      STATE.GBC = L.gbc || null;
      for (let t = a; t < b - 0.1; t += 0.9) { const e = Math.min(t + 0.5, b); quad(P(A, t), P(A, e), P(B, e), P(B, t)); }
      STATE.GBC = null;
    }
  }
}
/* The cycle of a junction, 60 s, in the vertex shader of the lens mesh (a light that is off collapses to a point):
   18. novembra iela (A) green 0–30 s, amber 30–33, red 33–58, red and amber 58–60; the street across (B) red until 35,
   red and amber 35–37, green 37–55, amber 55–58, red again; between them 2 s when both are red. Pedestrians crossing
   18. novembra iela (PA) have green 37–53, those crossing a side street (PB) 0–28, both before the traffic across them
   gets its green. Every junction starts at its own place in the cycle. The clock is the page's own (U.time), so the
   lights keep going when the timetable clock is sped up or stopped. */
const CYCLE = `{
  float sr = normal.x, sc = normal.y, st = mod(uSigTime + normal.z * 60.0, 60.0);
  bool red = sc < 0.375, amb = sc >= 0.375 && sc < 0.625, on;
  if (sr < 0.3) on = red ? st >= 33.0 : amb ? (st >= 30.0 && st < 33.0) || st >= 58.0 : st < 30.0;
  else if (sr < 0.5) on = red ? st < 37.0 || st >= 58.0 : amb ? (st >= 35.0 && st < 37.0) || (st >= 55.0 && st < 58.0) : st >= 37.0 && st < 55.0;
  else if (sr < 0.7) on = red ? !(st >= 37.0 && st < 53.0) : st >= 37.0 && st < 53.0;
  else on = red ? st >= 28.0 : st < 28.0;
  if (!on) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

export { buildSignals };
