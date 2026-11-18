import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P } from '../game/player.js';
import { PERF } from '../game/perf.js';
import { LINES, buildingAt, inWater } from './data.js';
import { walkLift } from './terrain.js';
import { loadHumans, makeAvatar, randomLook } from '../game/avatar.js';
import { timeI } from '../render/lighting.js';
import { scene } from '../render/renderer.js';

/* ---------- the people of the streets ----------
   A few citizens walk near the player: the same Quaternius models as the players (src/game/avatar.js), but unarmed —
   the whole walk clip, no team gear. Each walks a route: from where it stands to a point 200–450 m away along the
   footways, paths and pedestrian streets (on their line) and the streets (on the sidewalk, to the right of the way it
   goes), by the shortest way through the network of them; there it takes the next route, one that does not send it
   back the way it came unless it stands at a dead end. It turns smoothly towards where it goes.
   The pool is small and follows the player: anyone farther than 180 m is taken away and, when needed, a new person
   starts out of sight (behind the camera, or farther than 90 m) on a point of the network 40–150 m away. Only the near
   ones animate every frame; the far ones take their steps in batches of a quarter second. They are fewer at night.
   In the online game the streets are empty of civilians: there every person is a player.
   The model of a person is turned half round inside its root (src/game/avatar.js: the file faces the other way);
   a person therefore stands in a group of its own, which is turned, as a player's model does. */
const peds = [];
let hState = 0, reviewAt = 0;   // hState: 0 not asked, 1 loading, 2 ready, 3 the files did not come
const MAX_PEDS = 12;

/* ---- the network to walk ----
   Nodes are the points of the lines (points within 0.5 m are one: the ways of OSM share their nodes at the
   junctions); an edge keeps its length and how far to the right of its line a person walks (0 on a footway, path or
   pedestrian street; the half width of the carriageway and 1.2 m more on a street). Streets cost a little more than
   footways, so a person takes a footway when there is one. */
const WALK = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 0, 6: 0, 15: 0 };   // line class → 1: walked on its sidewalk, 0: on its line
let G = null;
function network() {
  if (G) return G;
  const idx = new Map(), X = [], Z = [], adj = [];
  const node = (x, z) => { const k = (Math.round(x * 2) + 30000) * 100000 + Math.round(z * 2) + 30000; let i = idx.get(k); if (i === undefined) { i = X.length; idx.set(k, i); X.push(x); Z.push(z); adj.push([]); } return i; };
  for (const l of LINES) {
    const side = WALK[l.cls]; if (side === undefined) continue;
    const off = side ? l.w / 2 + 1.2 : 0, cost = side ? 1.15 : 1, p = l.pts;
    let a = node(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) {
      const b = node(p[i], p[i + 1]); if (b === a) continue;
      const len = Math.hypot(X[b] - X[a], Z[b] - Z[a]); adj[a].push(b, len * cost, off); adj[b].push(a, len * cost, off); a = b;
    }
  }
  const grid = new Map();   // 50 m cells of the nodes that have edges
  for (let i = 0; i < X.length; i++) { if (!adj[i].length) continue; const k = Math.floor(X[i] / 50) * 10000 + Math.floor(Z[i] / 50); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i); }
  const n = X.length;
  G = { X, Z, adj, grid, dist: new Float64Array(n).fill(Infinity), prev: new Int32Array(n).fill(-1), touched: [] };
  return G;
}
// the nodes of the network between r0 and r1 metres from (x, z)
function nodesNear(x, z, r0, r1) {
  const out = [], { X, Z, grid } = G;
  for (let i = Math.floor((x - r1) / 50); i <= Math.floor((x + r1) / 50); i++) for (let j = Math.floor((z - r1) / 50); j <= Math.floor((z + r1) / 50); j++) {
    for (const k of grid.get(i * 10000 + j) || []) { const d = Math.hypot(X[k] - x, Z[k] - z); if (d >= r0 && d <= r1) out.push(k); }
  }
  return out;
}
// shortest ways from a node, as far as `limit` (Dijkstra on a binary heap); leaves G.dist and G.prev filled
function reach(src, limit) {
  const { adj, dist, prev, touched } = G;
  for (const k of touched) { dist[k] = Infinity; prev[k] = -1; } touched.length = 0;
  const heap = [[0, src]]; dist[src] = 0; touched.push(src);
  const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist[u] || d > limit) continue;
    const a = adj[u];
    for (let e = 0; e < a.length; e += 3) { const v = a[e], nd = d + a[e + 1]; if (nd < dist[v]) { if (dist[v] === Infinity) touched.push(v); dist[v] = nd; prev[v] = u; push([nd, v]); } }
  }
}
/* a route from node `src`: the way to a node 200–450 m off along the network whose first step does not turn back
   against (hx, hz), the way the person came (if it has one); as a polyline of the points a person walks */
function route(src, hx, hz) {
  const { X, Z, adj, dist, prev, touched } = G;
  reach(src, 460);
  const far = touched.filter(k => dist[k] >= 200 && dist[k] <= 450), near = touched.filter(k => dist[k] >= 40 && dist[k] < 200);
  const firstStep = k => { let c = k, b = -1; while (prev[c] !== -1) { b = c; c = prev[c]; } return b; };
  const forward = k => { const f = firstStep(k); if (f < 0) return false; if (!hx && !hz) return true; const dx = X[f] - X[src], dz = Z[f] - Z[src], l = Math.hypot(dx, dz) || 1; return (dx * hx + dz * hz) / l > -0.35; };
  let dest = -1;
  for (const pool of [far, near]) { for (let tries = 0; tries < 12 && pool.length && dest < 0; tries++) { const k = pool[(Math.random() * pool.length) | 0]; if (forward(k)) dest = k; } if (dest >= 0) break; }
  if (dest < 0) { const pool = far.length ? far : near.length ? near : touched.filter(k => k !== src); if (!pool.length) return null; dest = pool[(Math.random() * pool.length) | 0]; }   // a dead end: back it is
  const ids = []; for (let c = dest; c !== -1; c = prev[c]) ids.push(c); ids.reverse();
  if (ids.length < 2) return null;
  // the offset of each edge (to the right of the way), then the points: the corners where two edges meet
  const offs = [];
  for (let i = 0; i < ids.length - 1; i++) { const a = adj[ids[i]]; let o = 0; for (let e = 0; e < a.length; e += 3) if (a[e] === ids[i + 1]) { o = a[e + 2]; break; } offs.push(o); }
  const pts = [];
  for (let i = 0; i < ids.length; i++) {
    const nrm = j => { const a = ids[j], b = ids[j + 1], dx = X[b] - X[a], dz = Z[b] - Z[a], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };   // to the right of the way
    const n1 = i > 0 ? nrm(i - 1) : nrm(i), n2 = i < ids.length - 1 ? nrm(i) : n1, o = (i > 0 ? offs[i - 1] : offs[0]) * 0.5 + (i < ids.length - 1 ? offs[i] : offs[i - 1]) * 0.5;
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) { mx = n1[0]; mz = n1[1]; } else { mx /= ml; mz /= ml; }
    const k = Math.min(2, 1 / Math.max(0.5, mx * n1[0] + mz * n1[1]));   // a mitred corner, not too far out
    let x = X[ids[i]], z = Z[ids[i]];
    for (const f of [1, 0.5, 0]) { const px = x + mx * o * k * f, pz = z + mz * o * k * f; if (f === 0 || (!buildingAt(px, pz) && !inWater(px, pz))) { x = px; z = pz; break; } }   // off a wall or the water: nearer the line
    if (!pts.length || Math.hypot(x - pts[pts.length - 2], z - pts[pts.length - 1]) > 0.3) pts.push(x, z);
  }
  return pts.length >= 4 ? { pts, end: dest } : null;
}

/* ---- the people ---- */
// a new person: on a node 40–150 m from the player, out of sight (behind the camera, or farther than 90 m)
function place(p) {
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  const cands = nodesNear(P.x, P.z, 40, 150).filter(k => { const dx = G.X[k] - P.x, dz = G.Z[k] - P.z, d = Math.hypot(dx, dz); return d > 90 || (dx * fx + dz * fz) / d < 0.2; });
  for (let tries = 0; tries < 6 && cands.length; tries++) {
    const r = route(cands[(Math.random() * cands.length) | 0], 0, 0); if (!r) continue;
    setRoute(p, r); p.x = r.pts[0]; p.z = r.pts[1]; p.yaw = segYaw(p); p.speed = 1.1 + Math.random() * 0.6; p.acc = 0; p.g.visible = true;
    return true;
  }
  return false;
}
function setRoute(p, r) { p.pts = r.pts; p.end = r.end; p.seg = 0; }
const segYaw = p => { const o = p.seg * 2, dx = p.pts[o + 2] - p.pts[o], dz = p.pts[o + 3] - p.pts[o + 1]; return Math.atan2(-dx, -dz); };   // the yaw of the models: forward is (−sin, −cos)
function dropPed(p) { scene.remove(p.g); p.g.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }); }
let netAsked = false;
function pedTick(dt) {
  if (STATE.mp || !STATE.started) { for (const p of peds) p.g.visible = false; return; }
  if (hState === 0) { hState = 1; loadHumans().then(h => { hState = h ? 2 : 3; }); return; }
  if (hState !== 2) return;
  if (!G) { if (!netAsked) { netAsked = true; setTimeout(network, 0); } return; }   // the network once, in a task of its own
  const target = Math.min(MAX_PEDS, Math.round((PERF.fps < 30 ? 4 : PERF.fps < 45 ? 7 : 10) * (timeI >= 2 ? 0.4 : 1)));
  const now = performance.now() / 1000;   // the review keeps real time: the frame dt is clamped, and on slow frames the streets would otherwise stay empty for minutes
  if (now >= reviewAt) {
    reviewAt = now + 0.5;
    for (let i = peds.length - 1; i >= 0; i--) { const q = peds[i], d = Math.hypot(q.x - P.x, q.z - P.z); if (d > 180 || (q.speed === 0 && d > 90)) { dropPed(q); peds.splice(i, 1); } }   // gone far (or stuck, out of sight): a new one starts nearer by
    if (peds.length < target) {
      const av = makeAvatar(-1, randomLook(), true);
      if (av) { const g = new THREE.Group(); g.add(av.root); scene.add(g); const p = { av, g }; if (place(p)) peds.push(p); else dropPed(p); }
    }
    while (peds.length > target + 2) dropPed(peds.pop());   // the pool shrinks quietly
  }
  for (const p of peds) {
    // along the route; at its end the next one, on from there
    let step = p.speed * dt;
    while (step > 0) {
      const o = p.seg * 2, ex = p.pts[o + 2], ez = p.pts[o + 3], left = Math.hypot(ex - p.x, ez - p.z);
      if (step < left) { p.x += (ex - p.x) / left * step; p.z += (ez - p.z) / left * step; step = 0; break; }
      p.x = ex; p.z = ez; step -= left; p.seg++;
      if (p.seg * 2 + 3 >= p.pts.length) {   // there: the next route, not back the way it came
        const hx = ex - p.pts[o], hz = ez - p.pts[o + 1], l = Math.hypot(hx, hz) || 1, r = route(p.end, hx / l, hz / l);
        if (r) { setRoute(p, r); if (Math.hypot(r.pts[0] - p.x, r.pts[1] - p.z) > 0.05) { r.pts.unshift(p.x, p.z); } }
        else { p.seg--; p.speed = 0; step = 0; break; }   // nowhere to go (a piece of the network on its own): it stands, and goes when out of sight
      }
    }
    // turn smoothly towards the way
    const want = segYaw(p); let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); p.yaw += d * Math.min(1, dt * 6);
    const dist = Math.hypot(p.x - P.x, p.z - P.z);
    p.g.visible = dist < 160;
    if (!p.g.visible) continue;
    p.g.position.set(p.x, walkLift(p.x, p.z), p.z); p.g.rotation.y = p.yaw;
    if (dist < 70) p.av.update(dt, { speed: p.speed, air: false, dead: false, shot: false });
    else { p.acc += dt; if (p.acc > 0.25) { p.av.update(p.acc, { speed: p.speed, air: false, dead: false, shot: false }); p.acc = 0; } }
  }
}
const PEDS = { list: peds, net: () => G };   // for checks (window.__city.peds)

export { PEDS, pedTick };
