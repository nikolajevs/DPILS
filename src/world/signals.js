import * as THREE from 'three';
import { SIGNALS } from './street-tags.js';
import { COL, inBuilding, matPlain } from './data.js';
import { hook, scene } from '../render/renderer.js';
import { GB, box, lathe, polyA } from '../core/geometry.js';
import { hb } from '../core/util.js';

/* ---------- traffic lights on 18. novembra iela ----------
   The signals OSM maps on the street (src/world/street-tags.js) within 35 m of each other make one signalled junction or
   crossing, centred on its junction nodes. Every street that leads into it is an approach: a line of the city data seen
   from the junction, 20 m out along it. The traffic that comes in drives on the right: on a two-way street the right half
   of the carriageway, on a pair of one-way carriageways the one on the right. Each approach gets a stop line across the
   lanes coming in, 1.2 m before the carriageway it crosses or 0.8 m before the zebra in front of it, and a signal on a
   post at the right kerb by the stop line, facing the drivers: three lenses, the green lit for 18. novembra iela and the
   red for the streets that cross it (the lenses glow the same by day and night). At the signalled zebras pedestrian
   signals stand at both kerbs, red where the zebra crosses 18. novembra iela, green across a side street. */
function buildSignals(sorted, ZR, ZB, marks, WHITE, N18) {
  // the junctions: signal nodes chained within 35 m
  const par = SIGNALS.map((_, i) => i), root = i => par[i] === i ? i : (par[i] = root(par[i]));
  for (let i = 0; i < SIGNALS.length; i++) for (let j = i + 1; j < SIGNALS.length; j++) if (Math.hypot(SIGNALS[i][0] - SIGNALS[j][0], SIGNALS[i][1] - SIGNALS[j][1]) < 35) par[root(i)] = root(j);
  const groups = new Map(); SIGNALS.forEach((s, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });

  const post = new GB(false), lens = new GB(false), POLE = hb('#4a4f53'), HEAD = hb('#1f2123');
  const DIM = { r: hb('#3d1713'), a: hb('#3b2d12'), g: hb('#12301d') }, LIT = { r: [255, 38, 26], a: [255, 168, 24], g: [40, 255, 130] };
  const s = ZR.s;
  // a lens: a square of half size h facing (fx, fz) at (x, y, z), lit or dim
  const lensAt = (x, y, z, fx, fz, h, c, lit) => { const rx = fz, rz = -fx;
    polyA(lit ? lens : post, [[x - rx * h, y - h, z - rz * h], [x + rx * h, y - h, z + rz * h], [x + rx * h, y + h, z + rz * h], [x - rx * h, y + h, z - rz * h]], lit ? LIT[c] : DIM[c], fx, 0, fz); };
  // a signal on a post at (bx, bz), its head facing (fx, fz): three lenses for traffic, two for pedestrians
  function signal(bx, bz, fx, fz, ped, lit) {
    if (inBuilding(bx, bz)) return;
    const y0 = ped ? 1.95 : 2.3, y1 = ped ? 2.65 : 3.4, hx = bx + fx * 0.05, hz = bz + fz * 0.05;
    lathe(post, bx, bz, 0, [[0.07, 0], [0.06, y1 + 0.15]], 6, 0, POLE);
    box(post, hx, hz, fx, fz, 0.12, ped ? 0.14 : 0.17, y0, y1, HEAD);
    if (!ped) box(post, hx - fx * 0.13, hz - fz * 0.13, fx, fz, 0.015, 0.3, y0 - 0.1, y1 + 0.1, HEAD);   // the backplate
    const lx = hx + fx * 0.125, lz = hz + fz * 0.125;
    if (ped) { lensAt(lx, 2.45, lz, fx, fz, 0.1, 'r', lit === 'r'); lensAt(lx, 2.15, lz, fx, fz, 0.1, 'g', lit === 'g'); }
    else { lensAt(lx, 3.12, lz, fx, fz, 0.11, 'r', lit === 'r'); lensAt(lx, 2.85, lz, fx, fz, 0.11, 'a', false); lensAt(lx, 2.58, lz, fx, fz, 0.11, 'g', lit === 'g'); }
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
  for (const g of groups.values()) {
    const J = g.filter(t => t[2] === 'j'), src = J.length ? J : g, cx = src.reduce((a, t) => a + t[0], 0) / src.length, cz = src.reduce((a, t) => a + t[1], 0) / src.length;
    const arms = approaches(cx, cz);
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
      const P = (sv, off) => [A.qx + A.ux * sv + rx * off, A.qz + A.uz * sv + rz * off], v = marks.v;
      for (const [x, z] of [P(dS, a), P(dS, b), P(dS + 0.4, a), P(dS + 0.4, b)]) marks.vert(x, 0, z, 0, 1, 0, WHITE);
      marks.triUp(v, v + 1, v + 3); marks.triUp(v, v + 3, v + 2);
      const B = P(dS + 0.6, A.hw + 1.0); signal(B[0], B[1], A.ux, A.uz, false, line.name === N18 ? 'g' : 'r');
    }
    // the pedestrian signals at the zebras of the junction
    for (const Z of ZB) { if (Math.hypot(Z.x - cx, Z.z - cz) > 25) continue; const nx = -Z.tz, nz = Z.tx, lit = sorted[Z.li].name === N18 ? 'r' : 'g';
      for (const sg of [1, -1]) signal(Z.x + nx * sg * (Z.hw + 0.8) + Z.tx * 2.4, Z.z + nz * sg * (Z.hw + 0.8) + Z.tz * 2.4, -nx * sg, -nz * sg, true, lit); }
  }
  const pm = post.mesh(matPlain); if (pm) { pm.castShadow = pm.receiveShadow = true; scene.add(pm); }
  const lm = lens.mesh(hook(new THREE.MeshBasicMaterial({ vertexColors: true }))); if (lm) scene.add(lm);
  return groups.size;
}

export { buildSignals };
