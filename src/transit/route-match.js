/* ---------- the routes of the vehicles on the drawn rails and roads ----------
   The GTFS shapes of Daugavpils satiksme run from stop to stop in straight lines (a vertex every 100 m on the whole,
   up to a kilometre apart), so they cut every corner. Each shape is laid on the network of the model instead, as a
   satnav would: its vertices are the waypoints, each with the places on the network within reach of it (the nearest of
   each way, both ways along it where that is allowed), and the chain of places is chosen that fits the vertices best
   (hidden Markov model, Viterbi): a place is the better the closer it is to its vertex (and, as asked, with the stop on
   its right, or with no track alongside to its right: a tram keeps right), a step between two places the better the
   closer the way between them on the network is to the straight line between the vertices. The way between two places
   is the shortest along the network (Dijkstra over the directed edges) with no turn sharper than a vehicle can take:
   75° for a tram; a bus turns round only at a price (at the end of its line), a tram only at the end of a track. Where
   the network has a gap, the vehicle goes on in a curve along the ways at both ends; off the network, straight on.
   Pure: no imports, so that tools and checks can run it outside the page. */

const KEY = (x, z) => Math.round(x * 10) * 1048576 + Math.round(z * 10);
const segT = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9; return Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); };

/* the network: ways = [{ pts: flat x, z array, fwd / back: false where it may not be driven along / against its points,
   cf / cb: the cost of a metre along / against them (1 by default), bridge }].
   OSM joins two ways at a shared node, but the lines of citydata.js are simplified and a through way may have lost the
   node where another one ends on it (a T junction) or crosses it: such an end is cut into the segment it lies on (within
   0.6 m), and with cross: true two ways crossing at grade (neither on a bridge) are joined where they cross. */
function buildNet(ways, opt = {}) {
  const cell = 40, S = [];   // S: way, index of the segment's first point
  ways.forEach((w, wi) => { for (let i = 0; i + 3 < w.pts.length; i += 2) S.push(wi, i); });
  const sg = new Map(), cellsOf = (x0, z0, x1, z1, f) => { for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++) f(gx * 65536 + gz); };
  for (let s = 0; s < S.length; s += 2) { const p = ways[S[s]].pts, i = S[s + 1]; cellsOf(Math.min(p[i], p[i + 2]), Math.min(p[i + 1], p[i + 3]), Math.max(p[i], p[i + 2]), Math.max(p[i + 1], p[i + 3]), k => { let l = sg.get(k); if (!l) sg.set(k, l = []); l.push(s); }); }
  const cuts = new Map(), cut = (s, t, x, z) => { let l = cuts.get(s); if (!l) cuts.set(s, l = []); l.push([t, x, z]); };
  ways.forEach((w, wi) => { const p = w.pts, n = p.length;
    for (const e of [0, n - 2]) { const x = p[e], z = p[e + 1], seen = new Set();
      cellsOf(x - 0.6, z - 0.6, x + 0.6, z + 0.6, k => { for (const s of sg.get(k) || []) { if (seen.has(s)) continue; seen.add(s); const wj = S[s], q = ways[wj].pts, i = S[s + 1]; if (wj === wi && (i === e || i + 2 === e)) continue;
        if (Math.hypot(q[i] - x, q[i + 1] - z) < 0.05 || Math.hypot(q[i + 2] - x, q[i + 3] - z) < 0.05) continue;
        const t = segT(x, z, q[i], q[i + 1], q[i + 2], q[i + 3]); if (t <= 0 || t >= 1) continue; if (Math.hypot(q[i] + (q[i + 2] - q[i]) * t - x, q[i + 1] + (q[i + 3] - q[i + 1]) * t - z) < 0.6) cut(s, t, x, z); } }); } });
  if (opt.cross) for (const l of sg.values()) for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) {
    const s1 = l[a], s2 = l[b], w1 = S[s1], w2 = S[s2]; if (w1 === w2 || ways[w1].bridge || ways[w2].bridge) continue;
    const p = ways[w1].pts, i = S[s1 + 1], q = ways[w2].pts, j = S[s2 + 1], rx = p[i + 2] - p[i], rz = p[i + 3] - p[i + 1], sx = q[j + 2] - q[j], sz = q[j + 3] - q[j + 1], den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue;
    const t = ((q[j] - p[i]) * sz - (q[j + 1] - p[i + 1]) * sx) / den, u = ((q[j] - p[i]) * rz - (q[j + 1] - p[i + 1]) * rx) / den; if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue;
    const x = p[i] + rx * t, z = p[i + 1] + rz * t; if (cuts.get(s1)?.some(c => Math.abs(c[1] - x) < 0.05 && Math.abs(c[2] - z) < 0.05)) continue; cut(s1, t, x, z); cut(s2, u, x, z);
  }
  const node = new Map(), NX = [], NZ = [], E = [];   // E: { a, b, len, way, seg, dx, dz }: a → b along the way
  const nodeOf = (x, z) => { const k = KEY(x, z); let id = node.get(k); if (id === undefined) { id = NX.length; node.set(k, id); NX.push(x); NZ.push(z); } return id; };
  for (let s = 0; s < S.length; s += 2) { const wi = S[s], p = ways[wi].pts, i = S[s + 1], pts = [[p[i], p[i + 1]], ...(cuts.get(s) || []).sort((u, v) => u[0] - v[0]).map(c => [c[1], c[2]]), [p[i + 2], p[i + 3]]];
    for (let k = 0; k + 1 < pts.length; k++) { const [ax, az] = pts[k], [bx, bz] = pts[k + 1], len = Math.hypot(bx - ax, bz - az); if (len < 0.05) continue;
      E.push({ a: nodeOf(ax, az), b: nodeOf(bx, bz), len, way: wi, seg: i >> 1, dx: (bx - ax) / len, dz: (bz - az) / len }); } }
  // directed edges: 2e along the segment, 2e + 1 against it; out[n] = the directed edges leaving node n
  const out = NX.map(() => []);
  E.forEach((e, i) => { const w = ways[e.way]; if (w.fwd !== false) out[e.a].push(2 * i); if (w.back !== false) out[e.b].push(2 * i + 1); });
  const CF = new Float32Array(2 * E.length); E.forEach((e, i) => { CF[2 * i] = ways[e.way].cf || 1; CF[2 * i + 1] = ways[e.way].cb || 1; });
  const grid = new Map();
  E.forEach((e, i) => cellsOf(Math.min(NX[e.a], NX[e.b]), Math.min(NZ[e.a], NZ[e.b]), Math.max(NX[e.a], NX[e.b]), Math.max(NZ[e.a], NZ[e.b]), k => { let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i); }));
  const nd = 2 * E.length;
  return { ways, NX, NZ, E, CF, cfMax: CF.reduce((a, b) => Math.max(a, b), 1), out, grid, cell, cache: new Map(), D: { dist: new Float64Array(nd), len: new Float64Array(nd), base: new Float64Array(nd), prev: new Int32Array(nd), mark: new Int32Array(nd), gen: 0 } };
}
const dEnd = (net, d) => { const e = net.E[d >> 1]; return d & 1 ? e.a : e.b; };   // the node a directed edge ends at
const dDir = (net, d) => { const e = net.E[d >> 1]; return d & 1 ? [-e.dx, -e.dz] : [e.dx, e.dz]; };
// the point at t (0..1) along a directed edge
const dPt = (net, d, t) => { const e = net.E[d >> 1], f = d & 1 ? 1 - t : t; return [net.NX[e.a] + e.dx * e.len * f, net.NZ[e.a] + e.dz * e.len * f]; };
// the places on the network within R of (x, z): { d (directed edge), t (0..1 along it in its direction), x, z, dist }
function placesNear(net, x, z, R, max) {
  const c = net.cell, seen = new Set(), res = [];
  for (let gx = Math.floor((x - R) / c); gx <= Math.floor((x + R) / c); gx++) for (let gz = Math.floor((z - R) / c); gz <= Math.floor((z + R) / c); gz++) for (const i of net.grid.get(gx * 65536 + gz) || []) {
    if (seen.has(i)) continue; seen.add(i); const e = net.E[i], ax = net.NX[e.a], az = net.NZ[e.a];
    const t = Math.max(0, Math.min(1, ((x - ax) * e.dx + (z - az) * e.dz) / e.len)), px = ax + e.dx * e.len * t, pz = az + e.dz * e.len * t, dist = Math.hypot(x - px, z - pz); if (dist > R) continue;
    const w = net.ways[e.way]; if (w.fwd !== false) res.push({ d: 2 * i, t, x: px, z: pz, dist }); if (w.back !== false) res.push({ d: 2 * i + 1, t: 1 - t, x: px, z: pz, dist });
  }
  // the nearest place of each way (each way along it), so that one way bending past does not crowd out the others
  res.sort((a, b) => a.dist - b.dist); const seenW = new Set(), out = [];
  for (const p of res) { const k = net.E[p.d >> 1].way * 2 + (p.d & 1); if (seenW.has(k)) continue; seenW.add(k); out.push(p); if (out.length >= max) break; }
  return out;
}
// a binary heap of [cost, state]
class Heap { constructor() { this.c = []; this.s = []; }
  clear() { this.c.length = 0; this.s.length = 0; }
  push(c, s) { const C = this.c, S = this.s; let i = C.length; C.push(c); S.push(s); while (i) { const p = (i - 1) >> 1; if (C[p] <= c) break; C[i] = C[p]; S[i] = S[p]; i = p; } C[i] = c; S[i] = s; }
  pop() { const C = this.c, S = this.s, top = S[0], c = C.pop(), s = S.pop(), n = C.length; if (n) { let i = 0; for (;;) { let m = 2 * i + 1; if (m >= n) break; if (m + 1 < n && C[m + 1] < C[m]) m++; if (C[m] >= c) break; C[i] = C[m]; S[i] = S[m]; i = m; } C[i] = c; S[i] = s; } return top; }
  get size() { return this.c.length; } get min() { return this.c[0]; } }
const HEAP = new Heap();
/* from place A to each of the places B (Dijkstra over directed edges, no turn sharper than maxTurn, cost = metres times
   the cost of the edge, plus a little for each turn and the price of turning round): per B { cost, len, last } (Infinity
   where none is reached within limit metres; last: the directed edge it is entered from, -2 straight along A's own
   edge). net.D.prev holds the chain until the next call. */
function routeTo(net, A, Bs, limit, maxTurn, uturn = Infinity) {
  const cosMax = Math.cos(maxTurn), D = net.D, g = ++D.gen, E = net.E, H = HEAP, res = Bs.map(() => ({ cost: Infinity, len: Infinity, base: Infinity, last: -1 }));
  const CF = net.CF;
  Bs.forEach((B, k) => { if (B.d === A.d && B.t >= A.t - 1e-6) { const l = (B.t - A.t) * E[A.d >> 1].len; res[k] = { cost: l * CF[A.d], len: l, base: l, last: -2 }; } });
  const byEdge = new Map(); Bs.forEach((B, k) => { let l = byEdge.get(B.d); if (!l) byEdge.set(B.d, l = []); l.push(k); });
  const start = (1 - A.t) * E[A.d >> 1].len; D.mark[A.d] = g; D.dist[A.d] = start * CF[A.d]; D.len[A.d] = start; D.base[A.d] = start; D.prev[A.d] = -1; H.clear(); H.push(start * CF[A.d], A.d);
  while (H.size) {
    const c0 = H.min, d = H.pop(); if (c0 > D.dist[d] + 1e-9) continue; if (c0 > limit * net.cfMax + (uturn < Infinity ? uturn : 30) || res.every(r => r.cost <= c0)) break;
    const e = E[d >> 1], n = d & 1 ? e.a : e.b, ux = d & 1 ? -e.dx : e.dx, uz = d & 1 ? -e.dz : e.dz, L0 = D.len[d], B0 = D.base[d], outs = net.out[n], dead = outs.length === 1;
    for (const d2 of outs) {
      /* back the way it came: a bus turns round where it must (at the end of its line), at a price; a tram only at the end
         of a track */
      const e2 = E[d2 >> 1], vx = d2 & 1 ? -e2.dx : e2.dx, vz = d2 & 1 ? -e2.dz : e2.dz, cs = ux * vx + uz * vz, back = (d2 >> 1) === (d >> 1) || cs < -0.97;
      if (back ? !(uturn < Infinity || dead) : cs < cosMax) continue;
      const tc = back ? (uturn < Infinity ? uturn : 30) : (1 - cs) * 6, cIn = c0 + tc, bIn = B0 + tc;
      const ks = byEdge.get(d2); if (ks) for (const k of ks) { const c = cIn + Bs[k].t * e2.len * CF[d2]; if (c < res[k].cost) res[k] = { cost: c, len: L0 + Bs[k].t * e2.len, base: bIn + Bs[k].t * e2.len, last: d }; }
      const c2 = cIn + e2.len * CF[d2]; if (L0 + e2.len <= limit && (D.mark[d2] !== g || c2 < D.dist[d2])) { D.mark[d2] = g; D.dist[d2] = c2; D.len[d2] = L0 + e2.len; D.base[d2] = bIn + e2.len; D.prev[d2] = d; H.push(c2, d2); }
    }
  }
  return res;
}
// the points of the way from A to B, right after routeTo found it (B entered from directed edge `last`), each with the
// directed edge it is reached along
function routePts(net, A, B, last) {
  if (last === -2) return [[...dPt(net, A.d, A.t), A.d], [...dPt(net, B.d, B.t), B.d]];
  const chain = []; for (let d = last; d >= 0; d = net.D.prev[d]) { chain.push(d); if (d === A.d) break; }
  chain.reverse(); const o = [[...dPt(net, A.d, A.t), A.d]];
  for (const d of chain) { const n = dEnd(net, d); o.push([net.NX[n], net.NZ[n], d]); }
  o.push([...dPt(net, B.d, B.t), B.d]); return o;
}
/* across a gap of the network between two places: a curve leaving the one and joining the other along their ways (the
   connecting track OSM lacks, the turn into a yard); straight where either end is off the network */
function bridgeGap(net, a, b) {
  const L = Math.hypot(b.x - a.x, b.z - a.z); if (a.free || b.free || L < 1) return [[b.x, b.z, -1]];
  const [ax, az] = dDir(net, a.d), [bx, bz] = dDir(net, b.d), c1x = a.x + ax * L / 3, c1z = a.z + az * L / 3, c2x = b.x - bx * L / 3, c2z = b.z - bz * L / 3, o = [], m = Math.max(4, Math.ceil(L / 4));
  for (let i = 1; i <= m; i++) { const t = i / m, u = 1 - t; o.push([u * u * u * a.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * b.x, u * u * u * a.z + 3 * u * u * t * c1z + 3 * u * t * t * c2z + t * t * t * b.z, -1]); }
  return o;
}
/* the shape (flat x, z of its vertices) laid on the network: { pts (flat), de: per point the directed edge it is reached
   along (-1 across a gap), at: per vertex its index into the points, place: per vertex the place chosen (null off the
   network), how: per vertex the step to it (1 along the network, -1 across a gap), breaks } */
function matchShape(net, shape, opt) {
  const R = opt.reach, K = opt.max || 8, sigma = opt.sigma || 10, beta = opt.beta || 25, maxTurn = opt.maxTurn;
  const n = shape.length >> 1, V = []; for (let i = 0; i < n; i++) V.push([shape[2 * i], shape[2 * i + 1]]);
  // places per vertex (a stop stands to the right of the way: the place facing it scores better); and the vertex itself
  const C = V.map(([x, z]) => {
    const pl = placesNear(net, x, z, R, K);
    for (const p of pl) { const [dx, dz] = dDir(net, p.d), side = (x - p.x) * -dz + (z - p.z) * dx; p.e = (p.dist / sigma) ** 2 + (opt.side && side < -2 ? 1.5 : 0);
      // keeping right: a track with another one alongside to its right is the one for the other way
      if (opt.keepRight && placesNear(net, p.x, p.z, 5, 12).some(q => { if ((q.d >> 1) === (p.d >> 1)) return false; const [qx, qz] = dDir(net, q.d); return Math.abs(qx * dx + qz * dz) > 0.9 && (q.x - p.x) * -dz + (q.z - p.z) * dx > 1; })) p.e += 3; }
    pl.push({ free: true, x, z, e: 9 }); return pl;
  });
  const pkey = p => p.free ? 'f' : p.d + ':' + p.t.toFixed(4);
  let score = C[0].map(p => p.e); const back = [null], vias = [null];
  for (let i = 0; i + 1 < n; i++) {
    const A = C[i], B = C[i + 1], chord = Math.hypot(V[i + 1][0] - V[i][0], V[i + 1][1] - V[i][1]), limit = Math.max(3 * chord, chord + 250);
    const nb = new Array(B.length).fill(Infinity), bk = new Array(B.length).fill(-1), via = new Array(B.length).fill(false);
    const Bnet = B.filter(b => !b.free), Bi = B.map((b, k) => k).filter(k => !B[k].free), bkey = Bnet.map(pkey).join(',');
    A.forEach((a, ia) => {
      if (!Number.isFinite(score[ia])) return;
      if (!a.free && Bnet.length) {
        const ck = pkey(a) + '|' + bkey + '|' + limit.toFixed(0); let r = net.cache.get(ck);
        if (!r) { r = routeTo(net, a, Bnet, limit, maxTurn, opt.uturn).map(x => [x.cost, x.len, x.base]); net.cache.set(ck, r); }
        /* the step: how much longer the way is than the line between the vertices, the turns on it, and a little of what its
           edges cost more (they steer the way itself; a gap is no better for them) */
        r.forEach(([cost, len, base], j) => { if (!Number.isFinite(cost)) return; const k = Bi[j], s = score[ia] + Math.abs(len - chord) / beta + (base - len) / beta + (cost - base) / (4 * beta) + B[k].e; if (s < nb[k]) { nb[k] = s; bk[k] = ia; via[k] = true; } });
      }
      /* straight on: between two vertices off the network, or across a gap in it. Dearer than any way along the network
         within the limit, so that it never cuts a corner the network goes round */
      B.forEach((b, k) => { const s = score[ia] + b.e + (a.free && b.free ? 4 : 10 + 3 * chord / beta); if (s < nb[k]) { nb[k] = s; bk[k] = ia; via[k] = false; } });
    });
    score = nb; back.push(bk); vias.push(via);
  }
  // back along the best chain
  let k = 0; for (let j = 1; j < score.length; j++) if (score[j] < score[k]) k = j;
  const pick = new Array(n), how = new Array(n).fill(-1); for (let i = n - 1; i >= 0; i--) { pick[i] = k; if (i) { how[i] = vias[i][k] ? 1 : -1; k = back[i][k]; } }
  const pts = [], de = [], at = [], place = []; let breaks = 0;
  const put = (x, z, d) => { const m = pts.length; if (m && Math.abs(pts[m - 2] - x) < 1e-3 && Math.abs(pts[m - 1] - z) < 1e-3) return; pts.push(x, z); de.push(d); };
  for (let i = 0; i < n; i++) {
    const p = C[i][pick[i]]; place.push(p.free ? null : p);
    if (i) { const a = C[i - 1][pick[i - 1]];
      if (how[i] > 0) { const chord = Math.hypot(V[i][0] - V[i - 1][0], V[i][1] - V[i - 1][1]), r = routeTo(net, a, [p], Math.max(3 * chord, chord + 250), maxTurn, opt.uturn)[0]; for (const [x, z, d] of routePts(net, a, p, r.last)) put(x, z, d); }
      else { if (!a.free || !p.free) breaks++; put(a.x, a.z, a.free ? -1 : a.d); for (const [x, z, d] of bridgeGap(net, a, p)) put(x, z, d); } }
    else put(p.x, p.z, p.free ? -1 : p.d);
    at.push((pts.length >> 1) - 1);
  }
  return { pts, de, at, place, how, breaks };
}

// the nearest point on a line (flat x, z)
function nearOn(p, x, z) {
  let bd = Infinity, bx = x, bz = z;
  for (let i = 0; i + 3 < p.length; i += 2) { const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = (x - px) ** 2 + (z - pz) ** 2; if (d < bd) { bd = d; bx = px; bz = pz; } }
  return [bx, bz];
}
// the route of a match: the points moved off the middle of the road into the lane, rounded, resampled
function laneRoute(m, offAt, step, round) {
  const P = m.pts, n = P.length >> 1, O = new Float32Array(n);
  for (let i = 0; i < n; i++) O[i] = offAt(m.de[i]);
  if (n > 1) O[0] = O[1];
  const Q = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1); let ix = P[2 * i] - P[2 * a], iz = P[2 * i + 1] - P[2 * a + 1], ox = P[2 * c] - P[2 * i], oz = P[2 * c + 1] - P[2 * i + 1];
    const li = Math.hypot(ix, iz), lo = Math.hypot(ox, oz); if (li > 1e-6) { ix /= li; iz /= li; } if (lo > 1e-6) { ox /= lo; oz /= lo; }
    if (li <= 1e-6) { ix = ox; iz = oz; } if (lo <= 1e-6) { ox = ix; oz = iz; }
    let tx = ix + ox, tz = iz + oz, tl = Math.hypot(tx, tz); if (tl < 0.2) { tx = ix; tz = iz; tl = 1; } tx /= tl; tz /= tl;
    const off = (O[i] + O[Math.min(n - 1, i + 1)]) / 2 / Math.max(0.6, tx * ix + tz * iz);   // a mitre at a corner
    Q[2 * i] = P[2 * i] - tz * off; Q[2 * i + 1] = P[2 * i + 1] + tx * off;
  }
  const qc = new Float32Array(n); for (let i = 1; i < n; i++) qc[i] = qc[i - 1] + Math.hypot(Q[2 * i] - Q[2 * i - 2], Q[2 * i + 1] - Q[2 * i - 1]);
  const L = n ? qc[n - 1] : 0, k = Math.max(2, Math.ceil(L / step) + 1), R = new Float32Array(2 * k);
  for (let j = 0, i = 0; j < k; j++) { const u = L * j / (k - 1); while (i < n - 2 && qc[i + 1] < u) i++; const f = n > 1 ? Math.max(0, Math.min(1, (u - qc[i]) / ((qc[i + 1] - qc[i]) || 1))) : 0, i2 = Math.min(n - 1, i + 1);
    R[2 * j] = Q[2 * i] + (Q[2 * i2] - Q[2 * i]) * f; R[2 * j + 1] = Q[2 * i + 1] + (Q[2 * i2 + 1] - Q[2 * i + 1]) * f; }
  let pts = R;
  if (round > 0) { pts = new Float32Array(2 * k);
    for (let j = 0; j < k; j++) { let sx = 0, sz = 0, w = 0; for (let q = -round; q <= round; q++) { const jj = Math.max(0, Math.min(k - 1, j + q)), ww = round + 1 - Math.abs(q); sx += R[2 * jj] * ww; sz += R[2 * jj + 1] * ww; w += ww; } pts[2 * j] = sx / w; pts[2 * j + 1] = sz / w; } }
  const cum = new Float32Array(k); for (let j = 1; j < k; j++) cum[j] = cum[j - 1] + Math.hypot(pts[2 * j] - pts[2 * j - 2], pts[2 * j + 1] - pts[2 * j - 1]);
  // the vertices of the shape: their distance along the offset line, then along the resampled, rounded one
  const vu = new Float32Array(m.at.length); m.at.forEach((idx, v) => { const f = L > 0 ? qc[idx] / L * (k - 1) : 0, j = Math.min(k - 2, Math.floor(f)); vu[v] = k > 1 ? cum[j] + (cum[j + 1] - cum[j]) * (f - j) : 0; });
  return { pts, cum, len: cum[k - 1], vu };
}
// the point and the direction at u along a route (past its ends straight on)
function routeAt(R, u, o) {
  const c = R.cum, p = R.pts, n = c.length; let lo, hi;
  if (u <= 0) { lo = 0; hi = 1; } else if (u >= R.len) { lo = n - 2; hi = n - 1; }
  else { lo = 0; hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= u) lo = m; else hi = m; } }
  const L = (c[hi] - c[lo]) || 1, f = (u - c[lo]) / L;
  o[2] = (p[2 * hi] - p[2 * lo]) / L; o[3] = (p[2 * hi + 1] - p[2 * lo + 1]) / L;
  o[0] = p[2 * lo] + (p[2 * hi] - p[2 * lo]) * f; o[1] = p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * f;
  return o;
}

export { buildNet, dDir, laneRoute, matchShape, nearOn, placesNear, routeAt };
