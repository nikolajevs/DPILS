import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { TIMES, timeI } from '../render/lighting.js';
import { P } from '../game/player.js';
import { vbGround } from '../world/bridge-vienibas.js';
import { upUnder } from '../world/underpass.js';
import { COL, inBuilding, matPlain } from '../world/data.js';
import { std } from '../render/materials.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { bridgeY, terrainH, vbLift } from '../world/terrain.js';
import { camera, scene } from '../render/renderer.js';
import { GB, SegGrid, box, lathe } from '../core/geometry.js';
import { hb } from '../core/util.js';
import { $ } from '../core/env.js';

/* ---------- public transport on the real timetable (GTFS of Daugavpils satiksme) ----------
   The clock runs in Riga time. Each trip is a pattern (shape, stops, times relative to the start) plus a start time
   and a service calendar. A vehicle stands at a stop for part of each leg and moves with smooth acceleration between
   stops, so it passes every stop exactly at the scheduled minute. Trams snap to the right-hand OSM track, buses to
   the right-hand lane of the OSM road. */
const TR = window.TRANSIT || null;
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
    return { route, shape, head, stops, along, arr, dep, mt, end: Math.max(dep[n - 1], mt[n - 1]), kind: TR.routes[route][2], trips: [] };
  });
  TX.trips = TR.trips.map(([p, start, svc], id) => { const t = { p, start, svc, end: start + TX.pats[p].end, id }; TX.pats[p].trips.push(t); return t; });
  TX.stopRefs = TR.stops.map(() => []);
  TX.pats.forEach((p, pi) => p.stops.forEach((s, k) => { if (k < p.stops.length - 1) TX.stopRefs[s].push([pi, k]); }));
  const now = rigaNow(); TX.day = now.day; TX.sec = now.sec; TX.ok = true;
}
function tripAlong(t, rel) {
  const p = TX.pats[t.p], mt = p.mt, n = mt.length, a = p.along;
  if (rel <= 0) return a[0]; if (rel >= mt[n - 1]) return a[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (mt[m] <= rel) lo = m; else hi = m; }
  const T = mt[hi] - mt[lo], dwell = T > 40 ? Math.min(20, T * 0.3) : 0;
  let f = (rel - mt[lo] - dwell) / Math.max(1e-3, T - dwell);
  if (f <= 0) return a[lo]; if (f >= 1) return a[hi];
  f -= Math.sin(6.2831853 * f) / 6.2831853;               // zero speed at both stops
  return a[lo] + (a[hi] - a[lo]) * f;
}
function shapeAt(sh, s, o) {
  const c = sh.cum, p = sh.pts, n = c.length; let lo, hi;
  if (s <= 0) { lo = 0; hi = 1; } else if (s >= sh.len) { lo = n - 2; hi = n - 1; }
  else { lo = 0; hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; } }
  const L = (c[hi] - c[lo]) || 1, f = (s - c[lo]) / L;      // extrapolates past both ends
  o[2] = (p[2 * hi] - p[2 * lo]) / L; o[3] = (p[2 * hi + 1] - p[2 * lo + 1]) / L;
  o[0] = p[2 * lo] + (p[2 * hi] - p[2 * lo]) * f; o[1] = p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * f;
  return o;
}
function lanePoint(o, kind) {
  const rx = -o[3], rz = o[2];                              // to the right of the direction of travel
  if (kind === 0) {
    const x = o[0] + rx * 1.6, z = o[1] + rz * 1.6; let best = 3.4, bx = x, bz = z;
    TRAMGRID.near(x, z, 3.4, (id, d, qx, qz) => { if (d < best) { best = d; bx = qx; bz = qz; } });
    o[0] = bx; o[1] = bz; return o;
  }
  let best = 8, bx = o[0], bz = o[1], bw = 0; const s = CARROAD.s;
  CARROAD.near(o[0], o[1], 8, (id, d, qx, qz) => {
    const k = id * 6, dx = s[k + 2] - s[k], dz = s[k + 3] - s[k + 1], L = Math.hypot(dx, dz) || 1;
    if (Math.abs((dx * o[2] + dz * o[3]) / L) < 0.8) return;  // ignore cross streets at junctions
    if (d < best) { best = d; bx = qx; bz = qz; bw = s[k + 4]; }
  });
  const off = bw ? Math.max(1.4, Math.min(3.0, bw * 0.5)) : 1.8;
  o[0] = bx + rx * off; o[1] = bz + rz * off; return o;
}

// vehicle models: a tram section (14 m) and a 12 m city bus, front towards +z; "glow" holds lit windows and lamps
const MODEL_LEN = [14, 12];
function vehicleModel(kind) {
  const body = new GB(false), glow = new GB(false);
  const WARM = hb('#d9b27c'), WHITE = hb('#fffaf0'), REDL = hb('#ff2a18'), AMBER = hb('#ffb422'), BLACK = hb('#1c1c1c'), GLASS = hb('#2a333b');
  const L = MODEL_LEN[kind] / 2, W = kind ? 1.27 : 1.24;
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
const VCAP = [80, 140];
function buildTransit() {
  if (!TR) return 0;
  prepTransit();
  const bodyMat = std({ vertexColors: true, roughness: 0.4, metalness: 0.15 }, 'vehicle');
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.15, 1.15, 1.15), toneMapped: true });
  const blobMat = new THREE.MeshBasicMaterial({ map: shadowBlobTex(), color: 0x000000, transparent: true, depthWrite: false, opacity: 0.7 });
  const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
  TX.mesh = [0, 1].map(kind => {
    const [bg, gg] = vehicleModel(kind);
    const b = new THREE.InstancedMesh(bg, bodyMat, VCAP[kind]), g = new THREE.InstancedMesh(gg, glowMat, VCAP[kind]), s = new THREE.InstancedMesh(blobGeo, blobMat, VCAP[kind]);
    for (const m of [b, g, s]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    b.receiveShadow = true; s.renderOrder = 3; TX.glow.push(g);
    return { b, g, s };
  });
  for (const g of TX.glow) g.visible = TIMES[timeI].lamps;
  buildStops();
  scanActive();
  return TR.trips.length;
}
function buildStops() {
  const b = new GB(false), POSTC = hb('#4b5054'), ROOF = hb('#5c646a'), GLASSC = hb('#9fb3ba'), BENCH = hb('#7a5a40'), SIGNB = hb('#1d5ca6'), SIGNT = hb('#c0262d');
  const o = [0, 0, 0, 0], seen = new Set();
  TR.stops.forEach((st, si) => {
    let ref = TX.stopRefs[si][0];
    if (!ref) { for (let pi = 0; pi < TX.pats.length && !ref; pi++) { const k = TX.pats[pi].stops.indexOf(si); if (k >= 0) ref = [pi, k]; } }
    if (!ref) return;
    const pat = TX.pats[ref[0]], key = Math.round(st[1] / 40) + ',' + Math.round(st[2] / 40);
    if (seen.has(key)) return; seen.add(key);
    shapeAt(TX.shapes[pat.shape], pat.along[ref[1]], o);
    const tx = o[2], tz = o[3], rx = -tz, rz = tx;
    let hw = 3.4, bx = st[1] / 10, bz = st[2] / 10;
    if (pat.kind !== 0) { let best = 9; CARROAD.near(bx, bz, 9, (id, d, qx, qz) => { if (d < best) { best = d; hw = CARROAD.s[id * 6 + 4]; bx = qx; bz = qz; } }); }
    const off = hw + (pat.kind === 0 ? 1.9 : 2.4), cx = bx + rx * off, cz = bz + rz * off, sign = pat.kind === 0 ? SIGNT : SIGNB;
    const pole = (x, z) => { lathe(b, x, z, 0, [[0.045, 0], [0.045, 2.95]], 6, 0, POSTC); box(b, x, z, tx, tz, 0.02, 0.24, 2.45, 2.93, sign); COL.add(x, z, x + 0.01, z, 0.08, 0); };
    if (inBuilding(cx, cz) || inBuilding(cx + rx * 0.8, cz + rz * 0.8)) { pole(bx + rx * (hw + 0.7), bz + rz * (hw + 0.7)); return; }
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
  const s = TX.sec, act = []; let trams = 0, buses = 0;
  for (const t of TX.trips) {
    for (let back = 0; back < 2; back++) {
      const tt = s + back * 86400; if (tt < t.start - 90 || tt > t.end + 20) continue;
      if (!svcOn(t.svc, TX.day - back)) continue;
      act.push({ t, off: back * 86400 }); if (TX.pats[t.p].kind === 0) trams++; else buses++; break;
    }
  }
  TX.act = act; TX.trams = trams; TX.buses = buses;
}
function nextDeparture() { // first trip start after now (today or tomorrow)
  for (let back = 0; back < 2; back++) {
    let best = Infinity; const from = back ? -1 : TX.sec;
    for (const t of TX.trips) if (t.start > from && t.start < best && svcOn(t.svc, TX.day + back)) best = t.start;
    if (best < Infinity) return back * 86400 + best;
  }
  return null;
}
const PO = [0, 0, 0, 0], PA = [0, 0, 0, 0], PB2 = [0, 0, 0, 0], MX = new THREE.Matrix4(), QY = new THREE.Quaternion(), VUP = new THREE.Vector3(0, 1, 0), VP = new THREE.Vector3(), VS = new THREE.Vector3(), VE = new THREE.Euler();
function updateTransit(dt) {
  if (!TX.ok) return;
  const sp = SPEEDS[TX.si];
  TX.sec += dt * sp;
  if (TX.live && (TX.resync -= dt) <= 0) { TX.resync = 20; const n = rigaNow(); TX.day = n.day; TX.sec = n.sec; }
  while (TX.sec >= 86400) { TX.sec -= 86400; TX.day++; } while (TX.sec < 0) { TX.sec += 86400; TX.day--; }
  if ((TX.scan -= dt * Math.max(1, sp / 10)) <= 0) { TX.scan = 0.5; scanActive(); }
  const cnt = [0, 0], placed = [];
  for (const a of TX.act) {
    const t = a.t, p = TX.pats[t.p], kind = p.kind ? 1 : 0, sh = TX.shapes[p.shape], M = TX.mesh[kind];
    const s = tripAlong(t, TX.sec + a.off - t.start);
    const secs = kind === 0 ? (t.id % 20 < 9 ? [12.6, 12.6] : [15]) : [12];
    let front = s, first = true;
    for (const L of secs) {
      if (cnt[kind] >= VCAP[kind]) break;
      lanePoint(shapeAt(sh, front - 0.3, PA), kind); lanePoint(shapeAt(sh, front - L + 0.3, PB2), kind);
      const cx = (PA[0] + PB2[0]) / 2, cz = (PA[1] + PB2[1]) / 2, yaw = Math.atan2(PA[0] - PB2[0], PA[1] - PB2[1]);
      // over a bridge the deck stands above the ground under it: up Vienības tilts nose up or down
      const hdx = PA[0] - PB2[0], hdz = PA[1] - PB2[1], lift = (x, z) => (upUnder(x, z, hdx, hdz) ? 0 : vbGround(x, z) + vbLift(x, z)) + bridgeY(x, z, hdx, hdz), ya = lift(PA[0], PA[1]), yb = lift(PB2[0], PB2[1]), gy = (ya + yb) / 2;
      if ((vbGround(PA[0], PA[1]) || vbGround(PB2[0], PB2[1])) && !upUnder(PA[0], PA[1], hdx, hdz)) QY.setFromEuler(VE.set(-Math.atan2(ya - yb, L), yaw, 0, 'YXZ')); else QY.setFromAxisAngle(VUP, yaw);
      MX.compose(VP.set(cx, gy, cz), QY, VS.set(1, 1, L / MODEL_LEN[kind])); M.b.setMatrixAt(cnt[kind], MX); M.g.setMatrixAt(cnt[kind], MX);
      MX.compose(VP.set(cx, gy + 0.035, cz), QY, VS.set(3.6, 1, L + 1.6)); M.s.setMatrixAt(cnt[kind], MX);
      if (first) placed.push({ x: cx, z: cz, kind, route: TR.routes[p.route][0], dest: TR.stops[p.stops[p.stops.length - 1]][0], dx: hdx, dz: hdz });
      cnt[kind]++; front -= L + 0.7; first = false;
    }
  }
  for (const kind of [0, 1]) { const M = TX.mesh[kind]; for (const m of [M.b, M.g, M.s]) { m.count = cnt[kind]; m.instanceMatrix.needsUpdate = true; } }
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
    TAGV.set(v.x, (v.kind === 0 ? 4.9 : 3.7) + terrainH(v.x, v.z) + bridgeY(v.x, v.z, v.dx || 0, v.dz || 0), v.z).project(camera);
    if (TAGV.z > 1 || TAGV.z < -1 || Math.abs(TAGV.x) > 1.05 || Math.abs(TAGV.y) > 1.05) continue;
    let e = tagEls[k];
    if (!e) { e = document.createElement('div'); e.className = 'vtag'; e.innerHTML = '<span class="rt"></span><span></span>'; host.append(e); tagEls[k] = e; }
    const key = v.kind + v.route + v.dest;
    if (e.dataset.key !== key) { e.dataset.key = key; e.firstChild.textContent = v.route; e.firstChild.className = 'rt' + (v.kind === 0 ? ' tram' : ''); e.lastChild.textContent = '→ ' + v.dest; }
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
  if (TX.trams + TX.buses > 0) { info.textContent = 'на линии: ' + plural(TX.trams, 'трамвай', 'трамвая', 'трамваев') + ', ' + plural(TX.buses, 'автобус', 'автобуса', 'автобусов'); first.hidden = true; }
  else { const n = nextDeparture(); info.textContent = n == null ? 'транспорт не ходит' : 'транспорт не ходит, первый рейс в ' + hhmm(n); first.hidden = n == null; first.dataset.t = n == null ? '' : n; }
}
function updateBoard() {
  const el = $('board');
  if (!TX.ok || P.fly) { el.hidden = true; TX.board = -2; return; }
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
    rt.className = 'rt' + (p.kind === 0 ? ' tram' : ''); rt.textContent = TR.routes[p.route][0];
    hd.className = 'hd'; hd.textContent = TR.stops[p.stops[p.stops.length - 1]][0]; hd.title = TR.heads[p.head];
    const m = Math.ceil((at - now) / 60); mn.className = 'mn';
    const b = document.createElement('b'); b.textContent = m <= 0 ? 'сейчас' : m + ' мин'; mn.append(b, ' · ' + hhmm(at));
    li.append(rt, hd, mn); ol.append(li);
  }
}
function setClock(sec, live) { TX.sec = sec; TX.live = live; while (TX.sec >= 86400) { TX.sec -= 86400; TX.day++; } while (TX.sec < 0) { TX.sec += 86400; TX.day--; } TX.scan = 0; updateClockUI(); updateBoard(); }
function drawVehicles(ctx, ox, oz, ppm, w, h, r) {
  if (!TX.ok) return;
  for (const v of TX.placed) {
    const x = w / 2 + (v.x - ox) * ppm, y = h / 2 + (v.z - oz) * ppm; if (x < -5 || y < -5 || x > w + 5 || y > h + 5) continue;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fillStyle = v.kind === 0 ? '#c0262d' : '#1d5ca6'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
}

export { CARROAD, SPEEDS, TRAMGRID, TX, buildTransit, drawVehicles, rigaNow, setClock, updateBoard, updateClockUI, updateTags, updateTransit };
