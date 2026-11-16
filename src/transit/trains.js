import * as THREE from 'three';
import { LINES, matPlain } from '../world/data.js';
import { std } from '../render/materials.js';
import { bridgeY } from '../world/terrain.js';
import { hook, scene } from '../render/renderer.js';
import { GB, box } from '../core/geometry.js';
import { hb } from '../core/util.js';
import { buildNet, laneRoute, matchShape, routeAt } from './route-match.js';

/* ---------- passenger trains through Daugavpils on their real timetable ----------
   trains.js (tools/trains.js, from the GTFS feed of the domestic trains) keeps each trip through Daugavpils as its run in
   from the stop before and out to the stop after, and the time it stands at the station. Only the station lies on the
   map: the two lines out of it ("legs", to the edge of the map: the Riga line north-west, the Krāslava line east) are laid
   on the drawn tracks once (route-match.js) and joined at the stop position into one line across the map. A train runs on
   it: from the stop before it speeds up, runs and slows down to stand with its middle at the stop position (glide, at
   0.5 m/s², as the trams and buses), and the same way out; where it is past the edge of the map it is not drawn.
   The trains: three-car diesel units, 25 m a car, a cab at each end, as the Daugavpils line is not electrified. */
const TN = window.TRAINS || null;
const CAR = 24.5, GAP = 0.6, CARS = 3, LEN = CARS * CAR + (CARS - 1) * GAP, ACC = 0.5;
const TRN = { ok: false, path: null, sSt: 0, len: 0, trips: [], svc: [], dayMin: 0, dayMax: 0, placed: [], mesh: [], glow: [] };
function effDay(d) { if (d > TRN.dayMax) d -= Math.ceil((d - TRN.dayMax) / 7) * 7; if (d < TRN.dayMin) d += Math.ceil((TRN.dayMin - d) / 7) * 7; return d; }
const dec = a => { const o = []; let x = 0, z = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; z += a[i + 1]; o.push(x / 10, z / 10); } return o; };

// the line across the map: the Riga leg backwards, then the Krāslava leg, both laid on the tracks from the stop position
function trainPath() {
  const rails = LINES.filter(l => l.cls === 8).map(l => ({ pts: l.pts, bridge: !!l.bridge })), net = buildNet(rails), st = TN.S.stop;
  const legs = TN.legs.map(enc => {
    const p = dec(enc), pts = [st[0], st[1]];   // from the stop position, then every 40 m of the leg
    for (let i = 2; i < p.length; i += 2) { const l = pts.length; if (Math.hypot(p[i] - pts[l - 2], p[i + 1] - pts[l - 1]) >= 40 || i >= p.length - 2) pts.push(p[i], p[i + 1]); }
    const m = matchShape(net, pts, { reach: 30, maxTurn: 35 * Math.PI / 180, max: 8 });
    return laneRoute(m, () => 0, 2, 0);
  });
  const [W, E] = legs, n0 = W.pts.length >> 1, pts = [];
  for (let i = n0 - 1; i >= 0; i--) pts.push(W.pts[2 * i], W.pts[2 * i + 1]);
  for (let i = 2; i < E.pts.length; i += 2) pts.push(E.pts[i], E.pts[i + 1]);
  const n = pts.length >> 1, cum = new Float32Array(n); for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  TRN.path = { pts: Float32Array.from(pts), cum, len: cum[n - 1] }; TRN.sSt = W.len; TRN.dir = [-1, 1];   // out along leg 0 is towards smaller s
}
// a car: the cab at +z where it has one; "glow" holds the lit windows, the head and the tail lights
function carModel(type) {   // 0 the leading car, 1 a middle car, 2 the trailing car (its cab at −z)
  const body = new GB(false), glow = new GB(false), L = CAR / 2, W = 1.55;
  const WHITE = hb('#e9ecea'), GREEN = hb('#2f7d4f'), DARK = hb('#23272b'), GLASS = hb('#2b3640'), GREY = hb('#8d9396'), YEL = hb('#e8c547'), WARM = hb('#d9b27c'), HEAD = hb('#fffaf0'), RED = hb('#ff2a18');
  box(body, 0, 0, 0, 1, L - 1.6, 1.2, 0.35, 1.05, DARK);                                  // the underframe
  for (const z of [L - 3.2, -L + 3.2]) box(body, 0, z, 0, 1, 1.5, 1.35, 0.15, 1.0, hb('#1b1d20'));   // the bogies
  box(body, 0, 0, 0, 1, L, W, 1.05, 1.75, WHITE); box(body, 0, 0, 0, 1, L + 0.005, W + 0.005, 1.25, 1.55, GREEN);   // the green band
  box(body, 0, 0, 0, 1, L - 0.02, W - 0.01, 1.75, 2.85, GLASS); box(body, 0, 0, 0, 1, L, W, 2.85, 3.85, WHITE);
  for (let k = -5; k <= 5; k++) box(body, 0, k * 2.15, 0, 1, 0.12, W + 0.006, 1.75, 2.85, WHITE);        // window pillars
  for (const z of [L - 4.6, -L + 4.6]) for (const s of [-1, 1]) box(body, s * (W + 0.004), z, 0, 1, 0.65, 0.01, 1.05, 3.4, GREY);   // the doors
  box(body, 0, 0, 0, 1, L - 0.6, 1.25, 3.85, 4.1, GREY);                                   // the roof
  for (let k = -5; k < 5; k++) if (k !== -5 && k !== 4) box(glow, 0, (k + 0.5) * 2.15, 0, 1, 0.95, W + 0.012, 1.8, 2.8, WARM, false);
  const cab = (s, lights) => {   // a cab end at z = s·L: a yellow front with the windscreen, and its lights
    box(body, 0, s * (L + 0.3), 0, 1, 0.3, W - 0.05, 1.05, 3.6, YEL); box(body, 0, s * (L + 0.62), 0, 1, 0.02, W - 0.25, 2.2, 3.3, GLASS);
    box(body, 0, s * (L + 0.5), 0, 1, 0.2, W - 0.4, 3.6, 3.9, WHITE);
    for (const x of [-1.05, 1.05]) box(glow, x, s * (L + 0.63), 0, 1, 0.012, 0.16, 1.45, 1.62, lights, false);
    box(glow, 0, s * (L + 0.65), 0, 1, 0.012, 0.18, 3.55, 3.7, lights, false);
  };
  if (type === 0) { cab(1, HEAD); box(body, 0, -L - 0.25, 0, 1, 0.25, 1.0, 1.1, 3.6, DARK); }   // the gangway behind
  else if (type === 2) { cab(-1, RED); box(body, 0, L + 0.25, 0, 1, 0.25, 1.0, 1.1, 3.6, DARK); }
  else for (const s of [-1, 1]) box(body, 0, s * (L + 0.25), 0, 1, 0.25, 1.0, 1.1, 3.6, DARK);
  return [body.mesh(matPlain).geometry, glow.mesh(matPlain).geometry];
}
function buildTrains() {
  if (!TN || !TN.legs || TN.legs.length < 2 || !TN.S || !TN.S.stop) return 0;
  trainPath();
  TRN.svc = TN.services.map(a => new Set(a)); let mn = 1e9, mx = -1e9; for (const a of TN.services) for (const d of a) { mn = Math.min(mn, d); mx = Math.max(mx, d); } TRN.dayMin = mn; TRN.dayMax = mx;
  // the same train under two names on different days (Rīga – Krāslava and Rīga – Indra): one trip, both calendars
  const seen = new Map();
  for (const t of TN.trips) { const [name, dest, svc, inLeg, prev, prevDep, inDist, arr, dep, outLeg, next, nextArr, outDist] = t, key = [inLeg, prevDep, arr, dep, outLeg, nextArr].join();
    let o = seen.get(key); if (!o) { seen.set(key, o = { name, dest, svc: [], inLeg, prev, prevDep, inDist, arr, dep, outLeg, next, nextArr, outDist }); TRN.trips.push(o); } o.svc.push(svc); }
  /* a train that ends here stands at the platform until the next one leaves back the way it came (within 4 hours, over
     the night too): the unit turns round */
  for (const t of TRN.trips) { if (t.outLeg >= 0 || t.inLeg < 0) continue; let best = Infinity;
    for (const u of TRN.trips) if (u.inLeg < 0 && u.outLeg === t.inLeg) for (const d of [u.dep, u.dep + 86400]) if (d >= t.arr && d - t.arr <= 4 * 3600 && d < best) best = d;
    t.until = best < Infinity ? best : t.arr + 300; }
  const bodyMat = std({ vertexColors: true, roughness: 0.45, metalness: 0.15 }, 'train');
  const glowMat = hook(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.15, 1.15, 1.15), toneMapped: true }), 'train-glow');
  for (let type = 0; type < 3; type++) { const [bg, gg] = carModel(type), b = new THREE.InstancedMesh(bg, bodyMat, 4), g = new THREE.InstancedMesh(gg, glowMat, 4);
    for (const m of [b, g]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); } b.receiveShadow = true; TRN.mesh.push(b); TRN.glow.push(g); }
  TRN.ok = true; return TRN.trips.length;
}
// where a trip is at the given second of its day: { s (the middle of the train along the path), dir (+1 towards larger s) } or null
function tripAt(t, sec) {
  const D = TRN.dir, at = (leg, d) => TRN.sSt + (leg === 0 ? -d : d);
  if (t.inLeg >= 0 && sec >= t.prevDep && sec < t.arr) { const T = t.arr - t.prevDep, left = t.inDist - glide(t.inDist, T, sec - t.prevDep); return { s: at(t.inLeg, left), dir: -D[t.inLeg] }; }
  if (sec >= t.arr && sec <= (t.outLeg < 0 ? t.until : t.dep)) return { s: TRN.sSt, dir: t.outLeg >= 0 ? D[t.outLeg] : t.inLeg >= 0 ? -D[t.inLeg] : 1 };
  if (t.outLeg >= 0 && sec > t.dep && sec <= t.nextArr) { const T = t.nextArr - t.dep; return { s: at(t.outLeg, glide(t.outDist, T, sec - t.dep)), dir: D[t.outLeg] }; }
  return null;
}
// as glide in transit.js, the rate of a train
function glide(D, T, t) {
  if (D <= 0) return 0; const disc = T * T - 6 * D / ACC, v = disc > 0 ? ACC * (T - Math.sqrt(disc)) / 3 : 2 * D / T, ta = disc > 0 ? 1.5 * v / ACC : T / 2, rise = x => x * x * x - x * x * x * x / 2;
  if (t < ta) return v * ta * rise(t / ta); if (t > T - ta) return D - v * ta * rise((T - t) / ta); return v * ta / 2 + v * (t - ta);
}
const PA = [0, 0, 0, 0], PB = [0, 0, 0, 0], MX = new THREE.Matrix4(), QY = new THREE.Quaternion(), VUP = new THREE.Vector3(0, 1, 0), VP = new THREE.Vector3(), VS = new THREE.Vector3(1, 1, 1);
// the trains on the map at that second of that day; the ones drawn go into placed (for the labels and the map)
function updateTrains(sec, day, placed) {
  if (!TRN.ok) return 0;
  const cnt = [0, 0, 0], P = TRN.path; let n = 0;
  for (const t of TRN.trips) {
    let q = null;
    for (let back = 0; back < 2 && !q; back++) { const s = sec + back * 86400; if (!t.svc.some(v => TRN.svc[v].has(effDay(day - back)))) continue; q = tripAt(t, s); }
    if (!q || q.s < -LEN || q.s > P.len + LEN) continue;
    n++;
    for (let k = 0; k < CARS; k++) {
      const type = k === 0 ? 0 : k === CARS - 1 ? 2 : 1, mid = q.s + q.dir * (LEN / 2 - CAR / 2 - k * (CAR + GAP)), M = TRN.mesh[type];
      if (cnt[type] >= M.instanceMatrix.count) continue;
      routeAt(P, mid + q.dir * (CAR / 2 - 3), PA); routeAt(P, mid - q.dir * (CAR / 2 - 3), PB);   // the two bogies on the track
      const cx = (PA[0] + PB[0]) / 2, cz = (PA[1] + PB[1]) / 2, dx = PA[0] - PB[0], dz = PA[1] - PB[1];
      QY.setFromAxisAngle(VUP, Math.atan2(dx, dz)); MX.compose(VP.set(cx, (bridgeY(PA[0], PA[1], dx, dz) + bridgeY(PB[0], PB[1], dx, dz)) / 2, cz), QY, VS);
      M.setMatrixAt(cnt[type], MX); TRN.glow[type].setMatrixAt(cnt[type], MX); cnt[type]++;
      if (k === 0) placed.push({ x: cx, z: cz, kind: 2, route: 'Поезд', dest: t.dest, dx, dz });
    }
  }
  for (let type = 0; type < 3; type++) for (const m of [TRN.mesh[type], TRN.glow[type]]) { m.count = cnt[type]; m.instanceMatrix.needsUpdate = true; }
  return n;
}
// the next departures from the station within a day of that second of that day: [{ at (seconds from that midnight), dest, name }]
function trainDepartures(sec, day, max) {
  const out = [];
  for (const t of TRN.trips) { if (t.outLeg < 0) continue;
    for (let sd = day - 1; sd <= day + 1; sd++) { const at = (sd - day) * 86400 + t.dep; if (at < sec - 30 || at > sec + 86400 || !t.svc.some(v => TRN.svc[v].has(effDay(sd)))) continue; out.push({ at, dest: t.dest, name: t.name }); } }
  return out.sort((a, b) => a.at - b.at).slice(0, max);
}

// by the station: within 60 m of its building or of the stop position of the trains
TRN.near = (x, z) => { const st = TN && TN.S && TN.S.stop; return !!st && (Math.hypot(x - st[0], z - st[1]) < 60 || Math.hypot(x + 806.8, z - 870.2) < 60); };

export { TRN, buildTrains, trainDepartures, updateTrains };
