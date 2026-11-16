import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { TIMES, timeI } from '../render/lighting.js';
import { P } from '../game/player.js';
import { vbGround } from '../world/bridge-vienibas.js';
import { upUnder } from '../world/underpass.js';
import { COL, LINES, inBuilding, matPlain } from '../world/data.js';
import { LINE } from '../world/palette.js';
import { buildNet, dDir, laneRoute, matchShape, nearOn, routeAt } from './route-match.js';
import { TRN, buildTrains, trainDepartures, updateTrains } from './trains.js';
import { AO } from '../landmarks/autoosta.js';
import { std } from '../render/materials.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { bridgeY, terrainH, vbLift } from '../world/terrain.js';
import { camera, scene } from '../render/renderer.js';
import { GB, SegGrid, box, lathe } from '../core/geometry.js';
import { hb } from '../core/util.js';
import { $ } from '../core/env.js';

/* ---------- public transport on the real timetable (GTFS of Daugavpils satiksme) ----------
   The clock runs in Riga time. Each trip is a pattern (shape, stops, times relative to the start) plus a start time
   and a service calendar. A vehicle stands at a stop for part of each leg, then speeds up, runs and slows down to the
   next one (glide), so it passes every stop exactly at the scheduled minute. The shapes of the feed cut from stop to
   stop; each is laid once on the tracks or the roads of the model (route-match.js), and every vehicle runs along that
   route: a tram on its right-hand track, a bus in the right-hand lane, both bogies of a car on the same line. */
/* the city's own feed and, after it, the regional and intercity buses (intercity.js, tools/intercity.js: in the same
   format, their routes marked as coaches, their runs cut at the edge of the map) */
function mergeFeeds(a, b) {
  if (!a || !b || b.day0 !== a.day0) return a ? { ...a, cityStops: a.stops.length } : null;
  const nR = a.routes.length, nS = a.stops.length, nH = a.heads.length, nSh = a.shapes.length, nSv = a.services.length, nP = a.patterns.length;
  return { ...a, cityStops: nS, routes: a.routes.concat(b.routes), stops: a.stops.concat(b.stops), heads: a.heads.concat(b.heads), shapes: a.shapes.concat(b.shapes), services: a.services.concat(b.services),
    patterns: a.patterns.concat(b.patterns.map(p => [p[0] + nR, p[1] + nSh, p[2] + nH, p[3].map(x => x + nS), p[4], p[5], p[6]])), trips: a.trips.concat(b.trips.map(t => [t[0] + nP, t[1], t[2] + nSv])) };
}
const TR = mergeFeeds(window.TRANSIT || null, window.INTERCITY || null);
const DAY0 = Date.UTC(2026, 0, 1) / 864e5;
const CARROAD = new SegGrid(30), TRAMGRID = new SegGrid(20);
const SPEEDS = [1, 10, 60];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const TX = { ok: false, day: 0, sec: 0, si: 0, live: true, scan: 0, resync: 0, shapes: [], pats: [], trips: [], svc: [], dayMin: 0, dayMax: 0, stopRefs: [], act: [], placed: [], trams: 0, buses: 0, glow: [], board: -2 };
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return n + ' ' + (m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c); };
const hhmm = s => { s = ((Math.floor(s) % 86400) + 86400) % 86400; return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0'); };
function rigaNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = t => +parts.find(p => p.type === t).value;
  return { day: Date.UTC(g('year'), g('month') - 1, g('day')) / 864e5 - DAY0, sec: g('hour') * 3600 + g('minute') * 60 + g('second') };
}
// outside the published period, use the same weekday inside it
function effDay(d) { if (d > TX.dayMax) d -= Math.ceil((d - TX.dayMax) / 7) * 7; if (d < TX.dayMin) d += Math.ceil((TX.dayMin - d) / 7) * 7; return d; }
const svcOn = (s, d) => TX.svc[s].has(effDay(d));

function prepTransit() {
  TX.shapes = TR.shapes.map(enc => {
    const n = enc.length >> 1, pts = new Float32Array(n * 2), cum = new Float32Array(n); let x = 0, z = 0, L = 0;
    for (let i = 0; i < n; i++) { x += enc[2 * i]; z += enc[2 * i + 1]; pts[2 * i] = x / 10; pts[2 * i + 1] = z / 10; if (i) L += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]); cum[i] = L; }
    return { pts, cum, len: L };
  });
  TX.svc = TR.services.map(a => new Set(a)); let mn = 1e9, mx = -1e9;
  for (const a of TR.services) for (const d of a) { if (d < mn) mn = d; if (d > mx) mx = d; }
  TX.dayMin = mn; TX.dayMax = mx;
  TX.pats = TR.patterns.map(p => {
    const [route, shape, head, stops, alongDm, arr, dep] = p, along = alongDm.map(v => v / 10), n = stops.length;
    // timetables give whole minutes: stops listed in the same minute are spread, by distance, over the time to the next one
    const mt = arr.slice(); let i = 0;
    while (i < n) {
      let j = i; while (j + 1 < n && arr[j + 1] === arr[i]) j++;
      if (j > i) { const tN = j + 1 < n ? arr[j + 1] : arr[i] + 60, aN = j + 1 < n ? along[j + 1] : along[j] + 1, span = Math.max(0.1, aN - along[i]); for (let k = i + 1; k <= j; k++) mt[k] = arr[i] + (tN - arr[i]) * 0.999 * (along[k] - along[i]) / span; }
      i = j + 1;
    }
    return { route, shape, head, stops, along, arr, dep, mt, end: Math.max(dep[n - 1], mt[n - 1]), kind: TR.routes[route][2], coach: TR.routes[route][3] === 1, trips: [] };
  });
  TX.trips = TR.trips.map(([p, start, svc], id) => { const t = { p, start, svc, end: start + TX.pats[p].end, id }; TX.pats[p].trips.push(t); return t; });
  TX.stopRefs = TR.stops.map(() => []);
  TX.pats.forEach((p, pi) => p.stops.forEach((s, k) => { if (k < p.stops.length - 1) TX.stopRefs[s].push([pi, k]); }));
  const now = rigaNow(); TX.day = now.day; TX.sec = now.sec; TX.ok = true;
}
// where a pattern goes: its last stop; a coach's: where its whole trip ends (its head), as its run is cut at the map's edge
const destOf = p => p.coach ? TR.heads[p.head] : TR.stops[p.stops[p.stops.length - 1]][0];
// where a trip is (metres along its route) rel seconds after its start: standing at a stop, then on to the next one
function tripAlong(t, rel) {
  const p = TX.pats[t.p], mt = p.mt, n = mt.length, a = p.alongU;
  if (rel <= 0) return a[0]; if (rel >= mt[n - 1]) return a[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (mt[m] <= rel) lo = m; else hi = m; }
  const T = mt[hi] - mt[lo], dwell = T > 40 ? Math.min(20, T * 0.3) : 0, run = Math.max(1e-3, T - dwell), tt = rel - mt[lo] - dwell;
  if (tt <= 0) return a[lo]; if (tt >= run) return a[hi];
  return a[lo] + glide(a[hi] - a[lo], run, tt, p.kind ? 1.1 : 0.9);
}
/* how far a vehicle has come t seconds into a run of D metres in T seconds: it speeds up and slows down at no more than
   acc m/s² (smoothly: the speed rises as 3x² − 2x³) and runs at an even speed between; where the time is too short for
   that, it speeds up for half of it and slows down for the other half */
function glide(D, T, t, acc) {
  if (D <= 0) return 0;
  const disc = T * T - 6 * D / acc, v = disc > 0 ? acc * (T - Math.sqrt(disc)) / 3 : 2 * D / T, ta = disc > 0 ? 1.5 * v / acc : T / 2;
  const rise = x => x * x * x - x * x * x * x / 2;   // ∫ (3x² − 2x³)
  if (t < ta) return v * ta * rise(t / ta);
  if (t > T - ta) return D - v * ta * rise((T - t) / ta);
  return v * ta / 2 + v * (t - ta);
}
/* the routes: each shape laid on the network of its kind. A bus keeps to the right-hand lane: half way to the kerb on
   a two-way road, the outer lane of one carriageway of a pair (driving it against its way is allowed but dear, in case
   the pair is misread), and its turns are rounded over ±7 m; a tram stays on the track. Per route the points every
   2–2.5 m with their distance along (cum), and per vertex of the shape its distance along the route (vu). */
const ROUTE_OPT = [{ reach: 30, maxTurn: 75 * Math.PI / 180, keepRight: true, max: 8 }, { reach: 40, maxTurn: 150 * Math.PI / 180, side: true, uturn: 40, max: 6 }];
function buildRoutes() {
  const tw = [], bw = [], bInfo = [];
  for (const l of LINES) {
    if (l.cls === 9) tw.push({ pts: l.pts });
    else if (l.cls <= 4) {
      const hw = l.zone || LINE[l.cls][0] / 2, side = l.side || 0, pair = side !== 0 || l.one;
      // the buses' driveway along the bus station's platform: one way (south), the buses standing at the platform
      const p = l.pts, n = p.length, ao = Math.hypot(p[0] - AO.lane[0][0], p[1] - AO.lane[0][1]) < 2 && Math.hypot(p[n - 2] - AO.lane[1][0], p[n - 1] - AO.lane[1][1]) < 2;
      bw.push({ pts: l.pts, bridge: !!l.bridge, cf: side > 0 ? 4 : 1, cb: side < 0 || l.one ? 4 : 1, back: ao ? false : undefined });
      const off = ao ? AO.laneOff : pair ? Math.max(0.3, hw - 1.7) : Math.max(1.4, Math.min(3.0, hw / 2)); bInfo.push({ off, hw, dp: l.isDual && l.dp !== l.pts ? l.dp : null });
    }
  }
  const nets = [buildNet(tw), buildNet(bw, { cross: true })], aoWay = bw.findIndex(w => w.back === false);
  TX.routes = TX.shapes.map(() => null); TX.stopAt = TX.shapes.map(() => null);
  TX.pats.forEach(p => { const kind = p.kind ? 1 : 0, si = p.shape; if (TX.routes[si]) return;
    /* the stop of the bus station lies on the buses' own driveway along the platform: a coach's vertex there may only be
       laid on it (else the shortest way out north takes the other driveway, away from the platform) */
    const opt = p.coach && aoWay >= 0 ? { ...ROUTE_OPT[kind], allow: (x, z, q) => Math.hypot(x - AO.stopXZ[0], z - AO.stopXZ[1]) > 12 || net.E[q.d >> 1].way === aoWay } : ROUTE_OPT[kind];
    const net = nets[kind], sh = TX.shapes[si], m = matchShape(net, sh.pts, opt);
    const wayOf = d => d >= 0 ? net.E[d >> 1].way : -1, offAt = d => kind && d >= 0 ? bInfo[wayOf(d)].off : 0;
    /* a carriageway of a pair is drawn along its own line where the two split off a single road (laid straight on over
       the last 30–55 m, see dualOf in streets.js): the route keeps to the drawn one */
    const drawn = (d, x, z) => { const dp = kind && d >= 0 ? bInfo[wayOf(d)].dp : null; return dp ? nearOn(dp, x, z) : [x, z]; };
    if (kind) for (let i = 0; i < m.de.length; i++) { const [x, z] = drawn(m.de[i], m.pts[2 * i], m.pts[2 * i + 1]); m.pts[2 * i] = x; m.pts[2 * i + 1] = z; }
    TX.routes[si] = laneRoute(m, offAt, kind ? 2.5 : 2, kind ? 3 : 0);
    // where each vertex (a stop, almost always) lies on the network: the point on the road's middle or the track, which
    // way the vehicle goes there and the half width of the road
    TX.stopAt[si] = m.place.map(q => { if (!q) return null; const [dx, dz] = dDir(net, q.d), [x, z] = drawn(q.d, q.x, q.z); return { x, z, dx, dz, hw: kind ? bInfo[wayOf(q.d)].hw : 0 }; });
  });
  TX.pats.forEach(p => { const sh = TX.shapes[p.shape], R = TX.routes[p.shape]; p.alongU = p.along.map(a => shapeToRoute(sh, R, a)); });
  /* at the bus station the coaches stand end to end along the platform, at three bays: in the order they are there, one
     bay after the other (by the first time each pattern is there), so that the next one does not stand in the same place */
  const atAO = []; TX.pats.forEach(p => { if (!p.coach) return; const k = p.stops.findIndex(s => TR.stops[s][0] === AO.stop); if (k < 0 || !p.trips.length) return;
    atAO.push([Math.min(...p.trips.map(t => t.start)) + p.arr[k], p, k]); });
  atAO.sort((a, b) => a[0] - b[0]).forEach(([, p, k], i) => { const a = p.alongU, lo = k ? a[k - 1] + 1 : 0, hi = k < a.length - 1 ? a[k + 1] - 1 : TX.routes[p.shape].len;
    a[k] = Math.max(lo, Math.min(hi, a[k] + AO.bays[i % AO.bays.length])); });
}
// a distance along a shape of the feed → along its route (between the vertices in proportion)
function shapeToRoute(sh, R, a) {
  const c = sh.cum, n = c.length; if (a <= 0) return R.vu[0]; if (a >= c[n - 1]) return R.vu[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= a) lo = m; else hi = m; }
  return R.vu[lo] + (R.vu[hi] - R.vu[lo]) * (a - c[lo]) / ((c[hi] - c[lo]) || 1);
}
// vehicle models: a tram section (14 m) and a 12 m city bus, front towards +z; "glow" holds lit windows and lamps
const MODEL_LEN = [14, 12, 12.4];   // a tram section, a city bus, a coach
function vehicleModel(kind) {
  const body = new GB(false), glow = new GB(false);
  const WARM = hb('#d9b27c'), WHITE = hb('#fffaf0'), REDL = hb('#ff2a18'), AMBER = hb('#ffb422'), BLACK = hb('#1c1c1c'), GLASS = hb('#2a333b');
  const L = MODEL_LEN[kind] / 2, W = kind ? 1.27 : 1.24;
  if (kind === 2) {   // a coach: high floor, tinted windows all along, a coloured band, the luggage lockers below, one door at the front
    const SILVER = hb('#dfe3e6'), BAND = hb('#e0782b'), LOCK = hb('#b9bec2'), GREY = hb('#9aa0a4');
    box(body, 0, 0, 0, 1, L, W, 0.35, 1.45, SILVER);
    for (const z of [-3.2, -0.6, 2.0]) box(body, 0, z, 0, 1, 1.15, W + 0.006, 0.45, 1.35, LOCK);   // locker doors
    box(body, 0, 0, 0, 1, L + 0.004, W + 0.004, 1.45, 1.62, BAND);
    box(body, 0, 0, 0, 1, L - 0.02, W - 0.01, 1.62, 2.95, hb('#1f272e')); box(body, 0, 0, 0, 1, L, W, 2.95, 3.55, SILVER);
    for (const z of [-4.9, -3.0, -1.1, 0.8, 2.7]) box(body, 0, z, 0, 1, 0.08, W + 0.006, 1.62, 2.95, SILVER);
    box(body, -W - 0.004, L - 1.35, 0, 1, 0.55, 0.01, 0.4, 2.9, GREY);   // the door (on the right, towards the kerb)
    box(body, 0, -0.5, 0, 1, 3.2, 0.95, 3.55, 3.75, GREY);
    for (const z of [3.9, -3.0]) box(body, 0, z, 0, 1, 0.6, 1.3, 0.0, 1.0, BLACK);
    for (let k = -5; k < 4; k++) box(glow, 0, k * 0.95 + 0.5, 0, 1, 0.42, W + 0.012, 1.75, 2.85, WARM, false);
    box(glow, 0, L + 0.012, 0, 1, 0.012, W - 0.12, 1.55, 3.1, WARM, false);
    for (const x of [-0.95, 0.95]) { box(glow, x, L + 0.025, 0, 1, 0.012, 0.18, 0.6, 0.75, WHITE, false); box(glow, x, -L - 0.025, 0, 1, 0.012, 0.1, 0.6, 1.4, REDL, false); }
    box(glow, 0, L + 0.03, 0, 1, 0.012, 0.95, 3.15, 3.45, AMBER, false);
    return [body.mesh(matPlain).geometry, glow.mesh(matPlain).geometry];
  }
  if (kind === 0) {
    const RED = hb('#b3262b'), CREAM = hb('#efe6d2'), GREY = hb('#80858a');
    box(body, 0, 0, 0, 1, L, W, 0.38, 1.2, RED); box(body, 0, 0, 0, 1, L - 0.02, W - 0.01, 1.2, 2.5, GLASS); box(body, 0, 0, 0, 1, L, W, 2.5, 3.2, CREAM);
    box(body, 0, 0, 0, 1, L + 0.01, W + 0.01, 1.12, 1.2, CREAM);
    for (let k = -3; k <= 3; k++) box(body, 0, k * 2.0, 0, 1, 0.1, W + 0.006, 1.2, 2.5, CREAM);
    box(body, 0, 0, 0, 1, 1.7, 0.55, 3.2, 3.5, GREY);
    box(body, 0, 0.6, 0, 1, 0.05, 0.75, 3.5, 3.56, GREY); box(body, 0, 0.6, 0, 1, 0.9, 0.03, 3.56, 4.3, GREY); box(body, 0, 0.6, 0, 1, 0.06, 0.7, 4.3, 4.34, GREY);
    for (const z of [-4.4, 4.4]) box(body, 0, z, 0, 1, 1.2, 1.05, 0.05, 0.42, BLACK);
    for (let k = -3; k < 3; k++) box(glow, 0, (k + 0.5) * 2.0, 0, 1, 0.88, W + 0.012, 1.28, 2.44, WARM, false);
    box(glow, 0, L + 0.012, 0, 1, 0.012, W - 0.18, 1.3, 2.45, WARM, false);
    for (const x of [-0.85, 0.85]) { box(glow, x, L + 0.025, 0, 1, 0.012, 0.13, 0.62, 0.76, WHITE, false); box(glow, x, -L - 0.025, 0, 1, 0.012, 0.12, 0.66, 0.78, REDL, false); }
    box(glow, 0, L + 0.03, 0, 1, 0.012, 0.75, 2.62, 2.92, AMBER, false);
  } else {
    const WHITEB = hb('#eceeed'), BLUE = hb('#1d5ca6'), GREY = hb('#9aa0a4');
    box(body, 0, 0, 0, 1, L, W, 0.32, 1.05, WHITEB); box(body, 0, 0, 0, 1, L + 0.005, W + 0.005, 0.82, 1.0, BLUE);
    box(body, 0, 0, 0, 1, L - 0.02, W - 0.01, 1.05, 2.45, GLASS); box(body, 0, 0, 0, 1, L, W, 2.45, 3.0, WHITEB);
    for (const z of [-5.7, -3.5, -1.3, 0.9, 3.1]) box(body, 0, z, 0, 1, 0.09, W + 0.006, 1.05, 2.45, WHITEB);
    box(body, 0, -1.5, 0, 1, 1.8, 0.85, 3.0, 3.3, GREY);
    for (const z of [3.6, -2.6]) box(body, 0, z, 0, 1, 0.55, 1.3, 0.0, 1.0, BLACK);
    for (const [a, b] of [[-5.7, -3.5], [-3.5, -1.3], [-1.3, 0.9], [0.9, 3.1], [3.1, 5.6]]) box(glow, 0, (a + b) / 2, 0, 1, (b - a) / 2 - 0.1, W + 0.012, 1.12, 2.4, WARM, false);
    box(glow, 0, L + 0.012, 0, 1, 0.012, W - 0.12, 1.0, 2.35, WARM, false);
    for (const x of [-0.95, 0.95]) { box(glow, x, L + 0.025, 0, 1, 0.012, 0.16, 0.55, 0.7, WHITE, false); box(glow, x, -L - 0.025, 0, 1, 0.012, 0.1, 0.5, 1.2, REDL, false); }
    box(glow, 0, L + 0.03, 0, 1, 0.012, 0.95, 2.48, 2.8, AMBER, false);
  }
  return [body.mesh(matPlain).geometry, glow.mesh(matPlain).geometry];
}
function shadowBlobTex() {
  const cv = mkCanvas(64, 128), g = cv.getContext('2d');
  for (let i = 0; i < 12; i++) { const k = i / 12; g.fillStyle = `rgba(0,0,0,${0.09})`; g.beginPath(); g.roundRect ? g.roundRect(4 + k * 10, 4 + k * 12, 56 - k * 20, 120 - k * 24, 14) : g.rect(4 + k * 10, 4 + k * 12, 56 - k * 20, 120 - k * 24); g.fill(); }
  return toTex(cv, false, false);
}
const VCAP = [80, 140, 40];
function buildTransit() {
  if (!TR) return 0;
  prepTransit(); const t0 = performance.now(); buildRoutes(); TX.routeMs = performance.now() - t0;
  const bodyMat = std({ vertexColors: true, roughness: 0.4, metalness: 0.15 }, 'vehicle');
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.15, 1.15, 1.15), toneMapped: true });
  const blobMat = new THREE.MeshBasicMaterial({ map: shadowBlobTex(), color: 0x000000, transparent: true, depthWrite: false, opacity: 0.7 });
  const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
  TX.mesh = [0, 1, 2].map(kind => {
    const [bg, gg] = vehicleModel(kind);
    const b = new THREE.InstancedMesh(bg, bodyMat, VCAP[kind]), g = new THREE.InstancedMesh(gg, glowMat, VCAP[kind]), s = new THREE.InstancedMesh(blobGeo, blobMat, VCAP[kind]);
    for (const m of [b, g, s]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    b.receiveShadow = true; s.renderOrder = 3; TX.glow.push(g);
    return { b, g, s };
  });
  TX.trainTrips = buildTrains(); TX.glow.push(...TRN.glow);   // the passenger trains through the station (trains.js)
  for (const g of TX.glow) g.visible = TIMES[timeI].lamps;
  buildStops();
  scanActive();
  return TR.trips.length + TX.trainTrips;
}
/* the stops: by the kerb on the right of the way the vehicles go there, along it, open towards the road. For a bus the
   kerb of the road it was laid on, the shelter 2.4 m beyond it on the sidewalk; for a tram the kerb of the road its
   track runs in, or 2 m off a track on its own; moved along the kerb (up to 8 m) off a house or another carriageway,
   else only the pole. One per stop of the feed, none within 6 m of another. */
function buildStops() {
  const b = new GB(false), POSTC = hb('#4b5054'), ROOF = hb('#5c646a'), GLASSC = hb('#9fb3ba'), BENCH = hb('#7a5a40'), SIGNB = hb('#1d5ca6'), SIGNT = hb('#c0262d');
  const placed = [], s6 = CARROAD.s;
  const onCarriage = (x, z) => { let on = false; CARROAD.near(x, z, 12, (id, d) => { if (d < s6[id * 6 + 4] + 0.4) on = true; }); return on; };
  TR.stops.forEach((st, si) => {
    if (si >= TR.cityStops) return;   // the regional buses stop at the city's stops; the bus station has its platform (lmAutoosta)
    let ref = TX.stopRefs[si][0];
    if (!ref) { for (let pi = 0; pi < TX.pats.length && !ref; pi++) { const k = TX.pats[pi].stops.indexOf(si); if (k >= 0) ref = [pi, k]; } }
    if (!ref) return;
    const pat = TX.pats[ref[0]], sh = TX.shapes[pat.shape], sx = st[1] / 10, sz = st[2] / 10;
    // the vertex of the shape at the stop, and where it lies on the network
    let vi = -1, vd = 1e9; for (let i = 0; i < sh.pts.length; i += 2) { const d = Math.hypot(sh.pts[i] - sx, sh.pts[i + 1] - sz); if (d < vd) { vd = d; vi = i >> 1; } }
    const q = vi >= 0 && vd < 5 ? TX.stopAt[pat.shape][vi] : null;
    let cx, cz, tx, tz;
    if (q) { tx = q.dx; tz = q.dz; let bx = q.x, bz = q.z, hw = q.hw, own = false;
      if (pat.kind === 0) { own = true; let best = 1e9; CARROAD.near(q.x, q.z, 14, (id, d, px, pz) => { const k = id * 6, ex = s6[k + 2] - s6[k], ez = s6[k + 3] - s6[k + 1], l = Math.hypot(ex, ez) || 1;
          if (d < s6[k + 4] && Math.abs((ex * tx + ez * tz) / l) > 0.9 && d < best) { best = d; bx = px; bz = pz; hw = s6[k + 4]; own = false; } }); }
      const off = own ? 2.0 : hw + 2.4; cx = bx - tz * off; cz = bz + tx * off; }
    else { const o = routeAt(TX.routes[pat.shape], pat.alongU[ref[1]], [0, 0, 0, 0]); tx = o[2]; tz = o[3]; cx = o[0] - tz * 3.2; cz = o[1] + tx * 3.2; }
    const rx = -tz, rz = tx, sign = pat.kind === 0 ? SIGNT : SIGNB;
    if (placed.some(([x, z]) => Math.hypot(x - cx, z - cz) < 6)) return;
    // off a house or another carriageway: along the kerb
    let ok = false; for (const sft of [0, 2, -2, 4, -4, 6, -6, 8, -8]) { const x = cx + tx * sft, z = cz + tz * sft; if (!inBuilding(x, z) && !inBuilding(x + rx * 0.8, z + rz * 0.8) && !onCarriage(x, z)) { cx = x; cz = z; ok = true; break; } }
    placed.push([cx, cz]);
    const pole = (x, z) => { lathe(b, x, z, 0, [[0.045, 0], [0.045, 2.95]], 6, 0, POSTC); box(b, x, z, tx, tz, 0.02, 0.24, 2.45, 2.93, sign); COL.add(x, z, x + 0.01, z, 0.08, 0); };
    if (!ok) { pole(cx - rx * 1.2, cz - rz * 1.2); return; }
    box(b, cx + rx * 0.68, cz + rz * 0.68, tx, tz, 2.0, 0.035, 0.12, 2.28, GLASSC);
    box(b, cx, cz, tx, tz, 2.15, 0.88, 2.3, 2.42, ROOF);
    for (const [u, v] of [[-1.95, -0.72], [1.95, -0.72], [-1.95, 0.68], [1.95, 0.68]]) box(b, cx + tx * u + rx * v, cz + tz * u + rz * v, tx, tz, 0.05, 0.05, 0, 2.3, POSTC, false);
    box(b, cx + tx * 1.97 + rx * 0.05, cz + tz * 1.97 + rz * 0.05, rx, rz, 0.62, 0.03, 0.3, 2.2, GLASSC);
    box(b, cx + rx * 0.42, cz + rz * 0.42, tx, tz, 1.4, 0.2, 0.43, 0.49, BENCH);
    pole(cx - tx * 2.7 - rx * 0.5, cz - tz * 2.7 - rz * 0.5);
    COL.add(cx + rx * 0.68 - tx * 2, cz + rz * 0.68 - tz * 2, cx + rx * 0.68 + tx * 2, cz + rz * 0.68 + tz * 2, 0.06, 0);
  });
  const m = b.mesh(matPlain); if (m) { m.castShadow = m.receiveShadow = true; scene.add(m); }
}
function scanActive() {
  const s = TX.sec, act = []; let trams = 0, buses = 0, coaches = 0;
  for (const t of TX.trips) {
    for (let back = 0; back < 2; back++) {
      const tt = s + back * 86400; if (tt < t.start - 90 || tt > t.end + 20) continue;
      if (!svcOn(t.svc, TX.day - back)) continue;
      act.push({ t, off: back * 86400 }); const q = TX.pats[t.p]; if (q.kind === 0) trams++; else if (q.coach) coaches++; else buses++; break;
    }
  }
  TX.act = act; TX.trams = trams; TX.buses = buses; TX.coaches = coaches;
}
function nextDeparture() { // first trip start after now (today or tomorrow)
  for (let back = 0; back < 2; back++) {
    let best = Infinity; const from = back ? -1 : TX.sec;
    for (const t of TX.trips) if (t.start > from && t.start < best && svcOn(t.svc, TX.day + back)) best = t.start;
    if (best < Infinity) return back * 86400 + best;
  }
  return null;
}
const PA = [0, 0, 0, 0], PB2 = [0, 0, 0, 0], MX = new THREE.Matrix4(), QY = new THREE.Quaternion(), VUP = new THREE.Vector3(0, 1, 0), VP = new THREE.Vector3(), VS = new THREE.Vector3(), VE = new THREE.Euler();
function updateTransit(dt) {
  if (!TX.ok) return;
  const sp = SPEEDS[TX.si];
  TX.sec += dt * sp;
  if (TX.live && (TX.resync -= dt) <= 0) { TX.resync = 20; const n = rigaNow(); TX.day = n.day; TX.sec = n.sec; }
  while (TX.sec >= 86400) { TX.sec -= 86400; TX.day++; } while (TX.sec < 0) { TX.sec += 86400; TX.day--; }
  if ((TX.scan -= dt * Math.max(1, sp / 10)) <= 0) { TX.scan = 0.5; scanActive(); }
  const cnt = [0, 0, 0], placed = [];
  for (const a of TX.act) {
    const t = a.t, p = TX.pats[t.p], kind = p.kind ? (p.coach ? 2 : 1) : 0, R = TX.routes[p.shape], M = TX.mesh[kind];
    const s = tripAlong(t, TX.sec + a.off - t.start);
    const secs = kind === 0 ? (t.id % 20 < 9 ? [12.6, 12.6] : [15]) : [MODEL_LEN[kind]];
    let front = s, first = true;
    for (const L of secs) {
      if (cnt[kind] >= VCAP[kind]) break;
      routeAt(R, front - 0.3, PA); routeAt(R, front - L + 0.3, PB2);   // the two bogies on the same line
      const cx = (PA[0] + PB2[0]) / 2, cz = (PA[1] + PB2[1]) / 2, yaw = Math.atan2(PA[0] - PB2[0], PA[1] - PB2[1]);
      // over a bridge the deck stands above the ground under it: up Vienības tilts nose up or down
      const hdx = PA[0] - PB2[0], hdz = PA[1] - PB2[1], lift = (x, z) => (upUnder(x, z, hdx, hdz) ? 0 : vbGround(x, z) + vbLift(x, z)) + bridgeY(x, z, hdx, hdz), ya = lift(PA[0], PA[1]), yb = lift(PB2[0], PB2[1]), gy = (ya + yb) / 2;
      if ((vbGround(PA[0], PA[1]) || vbGround(PB2[0], PB2[1])) && !upUnder(PA[0], PA[1], hdx, hdz)) QY.setFromEuler(VE.set(-Math.atan2(ya - yb, L), yaw, 0, 'YXZ')); else QY.setFromAxisAngle(VUP, yaw);
      MX.compose(VP.set(cx, gy, cz), QY, VS.set(1, 1, L / MODEL_LEN[kind])); M.b.setMatrixAt(cnt[kind], MX); M.g.setMatrixAt(cnt[kind], MX);
      MX.compose(VP.set(cx, gy + 0.035, cz), QY, VS.set(3.6, 1, L + 1.6)); M.s.setMatrixAt(cnt[kind], MX);
      if (first) placed.push({ x: cx, z: cz, kind: kind === 2 ? 3 : kind, route: TR.routes[p.route][0], dest: destOf(p), dx: hdx, dz: hdz });
      cnt[kind]++; front -= L + 0.7; first = false;
    }
  }
  for (const kind of [0, 1, 2]) { const M = TX.mesh[kind]; for (const m of [M.b, M.g, M.s]) { m.count = cnt[kind]; m.instanceMatrix.needsUpdate = true; } }
  TX.trainsOn = updateTrains(TX.sec, TX.day, placed);
  TX.placed = placed;
}
// small labels over vehicles near the camera
const tagEls = [], TAGV = new THREE.Vector3();
function updateTags() {
  const host = $('tags'); if (!TX.ok || !STATE.started || !$('start').hidden) { for (const e of tagEls) e.hidden = true; return; }
  const cx = camera.position.x, cz = camera.position.z, near = [];
  for (const v of TX.placed) { const d = Math.hypot(v.x - cx, v.z - cz); if (d < 160) near.push([d, v]); }
  near.sort((a, b) => a[0] - b[0]);
  const w = window.innerWidth, h = window.innerHeight; let k = 0;
  const testWalls = !(P.fly && P.y > 30);
  for (const [d, v] of near) {
    if (k >= 10) break;
    if (testWalls) { // hide the label when a building stands between us and the vehicle
      let hidden = false; const n = Math.floor((d - 8) / 3);
      for (let i = 1; i <= n && !hidden; i++) { const f = i * 3 / d; hidden = inBuilding(cx + (v.x - cx) * f, cz + (v.z - cz) * f); }
      if (hidden) continue;
    }
    TAGV.set(v.x, (v.kind === 0 ? 4.9 : v.kind === 2 ? 5.2 : v.kind === 3 ? 4.3 : 3.7) + terrainH(v.x, v.z) + bridgeY(v.x, v.z, v.dx || 0, v.dz || 0), v.z).project(camera);
    if (TAGV.z > 1 || TAGV.z < -1 || Math.abs(TAGV.x) > 1.05 || Math.abs(TAGV.y) > 1.05) continue;
    let e = tagEls[k];
    if (!e) { e = document.createElement('div'); e.className = 'vtag'; e.innerHTML = '<span class="rt"></span><span></span>'; host.append(e); tagEls[k] = e; }
    const key = v.kind + v.route + v.dest;
    if (e.dataset.key !== key) { e.dataset.key = key; e.firstChild.textContent = v.route; e.firstChild.className = 'rt' + (v.kind === 0 ? ' tram' : v.kind === 2 ? ' train' : v.kind === 3 ? ' coach' : ''); e.lastChild.textContent = '→ ' + v.dest; }
    e.hidden = false; e.style.opacity = String(Math.max(0.35, 1 - d / 170));
    e.style.transform = `translate(${((TAGV.x + 1) / 2 * w).toFixed(1)}px, ${((1 - TAGV.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
    k++;
  }
  for (; k < tagEls.length; k++) tagEls[k].hidden = true;
}
// clock panel and the departures board of the nearest stop
function updateClockUI() {
  if (!TX.ok) return;
  $('clock').hidden = false;
  $('clkTime').textContent = hhmm(TX.sec);
  $('clkDay').textContent = WD[new Date((TX.day + DAY0) * 864e5).getUTCDay()] + (TX.live ? ' · сейчас в Даугавпилсе' : '');
  $('clkSpeed').textContent = '×' + SPEEDS[TX.si]; $('clkSpeed').setAttribute('aria-pressed', TX.si > 0);
  $('clkNow').hidden = TX.live && TX.si === 0;
  const info = $('clkInfo'), first = $('clkFirst');
  if (TX.trams + TX.buses > 0) { info.textContent = 'на линии: ' + plural(TX.trams, 'трамвай', 'трамвая', 'трамваев') + ', ' + plural(TX.buses, 'автобус', 'автобуса', 'автобусов') + (TX.coaches ? ', ' + plural(TX.coaches, 'междугородний', 'междугородних', 'междугородних') : '') + (TX.trainsOn ? ', ' + plural(TX.trainsOn, 'поезд', 'поезда', 'поездов') : ''); first.hidden = true; }
  else { const n = nextDeparture(); info.textContent = n == null ? 'транспорт не ходит' : 'транспорт не ходит, первый рейс в ' + hhmm(n); first.hidden = n == null; first.dataset.t = n == null ? '' : n; }
}
function updateBoard() {
  const el = $('board');
  if (!TX.ok || P.fly) { el.hidden = true; TX.board = -2; return; }
  if (TRN.ok && TRN.near(P.x, P.z)) { trainBoard(el); return; }
  let best = 35, bi = -1;
  TR.stops.forEach((s, i) => { const d = Math.hypot(s[1] / 10 - P.x, s[2] / 10 - P.z); if (d < best) { best = d; bi = i; } });
  if (bi < 0) { el.hidden = true; TX.board = -2; return; }
  const name = TR.stops[bi][0], group = [];
  TR.stops.forEach((s, i) => { if (s[0] === name && Math.hypot(s[1] - TR.stops[bi][1], s[2] - TR.stops[bi][2]) < 1500) group.push(i); });
  const deps = [], now = TX.sec;
  for (const si of group) for (const [pi, k] of TX.stopRefs[si]) {
    const p = TX.pats[pi];
    for (let back = 0; back < 2; back++) for (const day of [TX.day - back, TX.day + 1 - back]) {
      const base = (day - TX.day) * 86400;
      if (!p.trips.length) continue;
      for (const t of p.trips) {
        const at = base + t.start + p.dep[k]; if (at < now - 20 || at > now + 5400) continue;
        if (!svcOn(t.svc, day)) continue; deps.push([at, p]);
      }
    }
  }
  const uniq = new Map(); for (const d of deps) uniq.set(d[0] + '|' + d[1].route + '|' + d[1].head, d);
  const list = [...uniq.values()].sort((a, b) => a[0] - b[0]).slice(0, 6);
  el.hidden = false; $('boardName').textContent = name;
  const ol = $('boardList'); ol.textContent = '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'В ближайшие полтора часа рейсов нет'; ol.append(li); return; }
  for (const [at, p] of list) {
    const li = document.createElement('li'), rt = document.createElement('span'), hd = document.createElement('span'), mn = document.createElement('span');
    rt.className = 'rt' + (p.kind === 0 ? ' tram' : p.coach ? ' coach' : ''); rt.textContent = TR.routes[p.route][0];
    hd.className = 'hd'; hd.textContent = destOf(p); hd.title = p.coach ? TR.routes[p.route][1] : TR.heads[p.head];
    const m = Math.ceil((at - now) / 60); mn.className = 'mn';
    const b = document.createElement('b'); b.textContent = m <= 0 ? 'сейчас' : m + ' мин'; mn.append(b, ' · ' + hhmm(at));
    li.append(rt, hd, mn); ol.append(li);
  }
}
// by the railway station: the next trains out of it
function trainBoard(el) {
  const list = trainDepartures(TX.sec, TX.day, 6), now = TX.sec, ol = $('boardList');
  el.hidden = false; $('boardName').textContent = 'Вокзал Daugavpils · поезда'; ol.textContent = '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Поездов в ближайшие сутки нет'; ol.append(li); return; }
  for (const d of list) {
    const li = document.createElement('li'), rt = document.createElement('span'), hd = document.createElement('span'), mn = document.createElement('span');
    rt.className = 'rt train'; rt.textContent = 'Поезд'; hd.className = 'hd'; hd.textContent = d.dest; hd.title = d.name;
    const m = Math.ceil((d.at - now) / 60), b = document.createElement('b'); mn.className = 'mn';
    b.textContent = m <= 0 ? 'сейчас' : m < 120 ? m + ' мин' : Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'; mn.append(b, ' · ' + hhmm(d.at));
    li.append(rt, hd, mn); ol.append(li);
  }
}
function setClock(sec, live) { TX.sec = sec; TX.live = live; while (TX.sec >= 86400) { TX.sec -= 86400; TX.day++; } while (TX.sec < 0) { TX.sec += 86400; TX.day--; } TX.scan = 0; updateClockUI(); updateBoard(); }
function drawVehicles(ctx, ox, oz, ppm, w, h, r) {
  if (!TX.ok) return;
  for (const v of TX.placed) {
    const x = w / 2 + (v.x - ox) * ppm, y = h / 2 + (v.z - oz) * ppm; if (x < -5 || y < -5 || x > w + 5 || y > h + 5) continue;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fillStyle = v.kind === 0 ? '#c0262d' : v.kind === 2 ? '#2f7d4f' : v.kind === 3 ? '#e0782b' : '#1d5ca6'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
}

export { CARROAD, SPEEDS, TRAMGRID, TX, buildTransit, drawVehicles, rigaNow, setClock, updateBoard, updateClockUI, updateTags, updateTransit };
