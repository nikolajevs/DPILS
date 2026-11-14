import * as THREE from 'three';
import { GB, polyA } from '../core/geometry.js';
import { hb, obb, sh, triangulate } from '../core/util.js';
import { lmBar, lmLathe } from './helpers.js';
import { lmStd } from './index.js';
import { groundMaterial } from '../render/materials.js';
import { detailTex, mkCanvas, toTex } from '../render/textures.js';
import { scene } from '../render/renderer.js';
import { TERR, subTris } from '../world/terrain.js';

/* ---------- the sports grounds of the schools ----------
   From schools.js (OpenStreetMap): every pitch with its surface (artificial turf mown in stripes, grass, tartan, asphalt,
   sand) and the lines of its sport — football, basketball, volleyball, tennis, a sand pit for the long jump — with its
   goals, baskets (as many as the hoops tag says) or net; the running tracks in red tartan with their lanes (an area,
   a straight line or a loop drawn as the middle of the track, four lanes of 1.22 m unless the lanes tag says
   otherwise); the fences (chain-link mesh, steel bars, boards, concrete); benches, bicycle stands, fitness stations
   and playgrounds. Pitches and tracks are laid on the ground over the paths, their lines over them. Sizes of lines
   follow the rules of each game, scaled down on the small school pitches. */
const SD = window.SCHOOLS || null;
const SURF = { artificial_turf: '#447834', grass: '#587a3c', tartan: '#a5493b', asphalt: '#5e5f61', sand: '#cdb88b', concrete: '#8f8d88', rubber: '#4f7a52', paving_stones: '#8e877c' };
const WHITE = [244, 244, 240], YEL = hb('#e8c43a');

function groundMesh(b, mat, order) { const m = b.mesh(mat); if (m) { m.renderOrder = order; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } }
// a polygon on the ground in one colour, subdivided to follow the terrain
function fillPoly(b, rings, col) {
  const t0 = triangulate(rings), { flat, tris } = TERR.on ? subTris(t0.flat, t0.tris, 0.25) : t0, v0 = b.v; b.ensure(flat.length / 2);
  for (let i = 0; i < flat.length; i += 2) b.vert(flat[i], 0, flat[i + 1], 0, 1, 0, col);
  for (let i = 0; i < tris.length; i += 3) b.triUp(v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2]);
}
// a rectangle in the frame of a pitch (u along it, v across), cut into pieces of about 4 m so it follows the terrain
function rectUV(b, o, u0, u1, v0, v1, col) {
  const nu = Math.max(1, Math.ceil((u1 - u0) / 4)), nv = Math.max(1, Math.ceil((v1 - v0) / 4)), base = b.v; b.ensure((nu + 1) * (nv + 1));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const u = u0 + (u1 - u0) * i / nu, v = v0 + (v1 - v0) * j / nv; b.vert(o.cx + o.ux * u - o.uz * v, 0, o.cz + o.uz * u + o.ux * v, 0, 1, 0, col); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = base + i * (nv + 1) + j; b.triUp(a, a + nv + 1, a + 1); b.triUp(a + 1, a + nv + 1, a + nv + 2); }
}
const line = (b, o, u0, v0, u1, v1, w, col) => {   // a straight line of width w
  const du = u1 - u0, dv = v1 - v0, L = Math.hypot(du, dv) || 1, nu = -dv / L * w / 2, nv = du / L * w / 2;
  const P = (u, v) => [o.cx + o.ux * u - o.uz * v, o.cz + o.uz * u + o.ux * v], k = b.v;
  for (const [u, v] of [[u0 + nu, v0 + nv], [u1 + nu, v1 + nv], [u1 - nu, v1 - nv], [u0 - nu, v0 - nv]]) { const p = P(u, v); b.vert(p[0], 0, p[1], 0, 1, 0, col); }
  b.triUp(k, k + 1, k + 2); b.triUp(k, k + 2, k + 3);
};
const arc = (b, o, cu, cv, r, a0, a1, w, col) => { const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) * r / 0.8)); for (let k = 0; k < n; k++) { const t0 = a0 + (a1 - a0) * k / n, t1 = a0 + (a1 - a0) * (k + 1) / n; line(b, o, cu + Math.cos(t0) * r, cv + Math.sin(t0) * r, cu + Math.cos(t1) * r, cv + Math.sin(t1) * r, w, col); } };
const box3 = (o, u, v) => [o.cx + o.ux * u - o.uz * v, o.cz + o.uz * u + o.ux * v];

// ---- the lines of the games, in the frame of the court: half length A along u, half width B across
function football(m, o, A, B, col = WHITE) {
  const w = 0.1, r = Math.min(9.15, A * 0.2), pd = Math.min(16.5, A * 0.32), pw = Math.min(20.15, B * 0.6), gd = Math.min(5.5, A * 0.11), gw = Math.min(9.16, B * 0.3);
  line(m, o, -A, -B, A, -B, w, col); line(m, o, -A, B, A, B, w, col); line(m, o, -A, -B, -A, B, w, col); line(m, o, A, -B, A, B, w, col); line(m, o, 0, -B, 0, B, w, col);
  arc(m, o, 0, 0, r, 0, Math.PI * 2, w, col);
  for (const s of [-1, 1]) { const e = s * A; line(m, o, e, -pw, e - s * pd, -pw, w, col); line(m, o, e, pw, e - s * pd, pw, w, col); line(m, o, e - s * pd, -pw, e - s * pd, pw, w, col);
    line(m, o, e, -gw, e - s * gd, -gw, w, col); line(m, o, e, gw, e - s * gd, gw, w, col); line(m, o, e - s * gd, -gw, e - s * gd, gw, w, col); }
}
function basketball(m, o, A, B, col = WHITE) {
  const w = 0.06, k = Math.min(1, A / 14), kw = 2.45 * Math.min(1, B / 7.5), kd = 5.8 * k, r3 = Math.min(6.75 * k, B - 0.5);
  line(m, o, -A, -B, A, -B, w, col); line(m, o, -A, B, A, B, w, col); line(m, o, -A, -B, -A, B, w, col); line(m, o, A, -B, A, B, w, col); line(m, o, 0, -B, 0, B, w, col);
  arc(m, o, 0, 0, 1.8 * k, 0, Math.PI * 2, w, col);
  for (const s of [-1, 1]) { const e = s * A, bu = e - s * 1.575 * k;
    line(m, o, e, -kw, e - s * kd, -kw, w, col); line(m, o, e, kw, e - s * kd, kw, w, col); line(m, o, e - s * kd, -kw, e - s * kd, kw, w, col);
    arc(m, o, e - s * kd, 0, 1.8 * k, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2, w, col);
    const a = Math.asin(Math.min(1, (B - 0.9) / r3)); arc(m, o, bu, 0, r3, s > 0 ? Math.PI - a : -a, s > 0 ? Math.PI + a : a, w, col); }
}
function volleyball(m, o, A, B, col = WHITE) {
  const a = Math.min(9, A - 0.5), b = Math.min(4.5, B - 0.5), w = 0.06;
  line(m, o, -a, -b, a, -b, w, col); line(m, o, -a, b, a, b, w, col); line(m, o, -a, -b, -a, b, w, col); line(m, o, a, -b, a, b, w, col); line(m, o, 0, -b, 0, b, w, col);
  line(m, o, -3, -b, -3, b, w, col); line(m, o, 3, -b, 3, b, w, col);
  return [a, b];
}
function tennis(m, o, A, B, col = WHITE) {
  const a = Math.min(11.885, A - 1), b = Math.min(5.485, B - 0.6), bs = b * 0.75, sv = Math.min(6.4, a * 0.54), w = 0.05;
  line(m, o, -a, -b, a, -b, w, col); line(m, o, -a, b, a, b, w, col); line(m, o, -a, -bs, a, -bs, w, col); line(m, o, -a, bs, a, bs, w, col);
  line(m, o, -a, -b, -a, b, w, col); line(m, o, a, -b, a, b, w, col); line(m, o, -sv, -bs, -sv, bs, w, col); line(m, o, sv, -bs, sv, bs, w, col); line(m, o, -sv, 0, sv, 0, w, col);
  return [a, b];
}

// ---- equipment, standing on the ground
const STEEL = hb('#c9ccce'), DARK = hb('#3f4447'), NET = hb('#30343a');
function goal(G, o, u, s, wGoal, hGoal) {   // posts and bar at u (end of the pitch, s = +1/-1 the side it faces from), the frame of the net behind
  const P = (uu, v, y) => { const p = box3(o, uu, v); return [p[0], y, p[1]]; }, d = 1.2, W = wGoal / 2;
  for (const v of [-W, W]) { lmBar(G, P(u, v, 0), P(u, v, hGoal), 0.1, STEEL); lmBar(G, P(u, v, hGoal), P(u + s * d, v, hGoal * 0.7), 0.05, STEEL); lmBar(G, P(u + s * d, v, hGoal * 0.7), P(u + s * d, v, 0), 0.05, STEEL); }
  lmBar(G, P(u, -W, hGoal), P(u, W, hGoal), 0.1, STEEL); lmBar(G, P(u + s * d, -W, 0.03), P(u + s * d, W, 0.03), 0.05, STEEL); lmBar(G, P(u + s * d, -W, hGoal * 0.7), P(u + s * d, W, hGoal * 0.7), 0.05, STEEL);
  for (let k = 1; k < 8; k++) { const v = -W + (2 * W) * k / 8; lmBar(G, P(u, v, hGoal), P(u + s * d, v, 0), 0.015, NET); }   // a hint of the net
}
function hoop(G, o, u, s) {   // a pole behind the end line, an arm, the backboard and the ring
  const P = (uu, v, y) => { const p = box3(o, uu, v); return [p[0], y, p[1]]; }, POLE = hb('#2f5f8f');
  lmBar(G, P(u + s * 1.0, 0, 0), P(u + s * 1.0, 0, 3.3), 0.14, POLE); lmBar(G, P(u + s * 1.0, 0, 3.2), P(u - s * 0.25, 0, 3.2), 0.08, POLE);
  const bu = u - s * 0.3, [x0, z0] = box3(o, bu, -0.9), [x1, z1] = box3(o, bu, 0.9), nx = -s * o.ux, nz = -s * o.uz;
  polyA(G, [[x0, 2.9, z0], [x1, 2.9, z1], [x1, 3.95, z1], [x0, 3.95, z0]], hb('#f2f2ee'), nx, 0, nz); polyA(G, [[x1, 2.9, z1], [x0, 2.9, z0], [x0, 3.95, z0], [x1, 3.95, z1]], hb('#dedfdb'), -nx, 0, -nz);
  const [rx, rz] = box3(o, bu - s * 0.38, 0); for (let k = 0; k < 10; k++) { const a0 = k / 10 * Math.PI * 2, a1 = (k + 1) / 10 * Math.PI * 2; lmBar(G, [rx + Math.cos(a0) * 0.23, 3.05, rz + Math.sin(a0) * 0.23], [rx + Math.cos(a1) * 0.23, 3.05, rz + Math.sin(a1) * 0.23], 0.025, hb('#d0562a')); }
}
function net(G, o, b, h) {   // posts at the sides and a dark band of net between them
  const P = (u, v, y) => { const p = box3(o, u, v); return [p[0], y, p[1]]; };
  for (const v of [-b - 0.5, b + 0.5]) lmBar(G, P(0, v, 0), P(0, v, h + 0.1), 0.08, STEEL);
  const A = P(0, -b - 0.5, h), B = P(0, b + 0.5, h), C2 = P(0, b + 0.5, h - 0.9), D = P(0, -b - 0.5, h - 0.9);
  polyA(G, [A, B, C2, D], NET, o.ux, 0, o.uz); polyA(G, [B, A, D, C2], NET, -o.ux, 0, -o.uz); lmBar(G, A, B, 0.04, hb('#f0f0ec'));
}
function bench(G, x, z, a) {
  const ux = Math.cos(a), uz = Math.sin(a), P = (u, v, y) => [x + ux * u - uz * v, y, z + uz * u + ux * v], W = hb('#8a5a35');
  for (const u of [-0.7, 0.7]) { lmBar(G, P(u, -0.2, 0), P(u, -0.2, 0.42), 0.06, DARK); lmBar(G, P(u, 0.2, 0), P(u, 0.2, 0.8), 0.06, DARK); }
  for (const v of [-0.18, -0.06, 0.06]) lmBar(G, P(-0.85, v, 0.44), P(0.85, v, 0.44), 0.1, W);
  for (const y of [0.6, 0.74]) lmBar(G, P(-0.85, 0.22, y), P(0.85, 0.22, y), 0.1, W);
}
function fitness(G, x, z, a) {   // pull-up bars, parallel bars and a ladder
  const ux = Math.cos(a), uz = Math.sin(a), P = (u, v, y) => [x + ux * u - uz * v, y, z + uz * u + ux * v], C = hb('#2e6fa6'), Y = hb('#e0b53a');
  for (const [u, h] of [[-3, 2.2], [-1.8, 2.5]]) { lmBar(G, P(u, -0.6, 0), P(u, -0.6, h), 0.08, C); lmBar(G, P(u, 0.6, 0), P(u, 0.6, h), 0.08, C); lmBar(G, P(u, -0.6, h), P(u, 0.6, h), 0.04, Y); }
  for (const v of [-0.25, 0.25]) { lmBar(G, P(0, v, 0), P(0, v, 1.2), 0.07, C); lmBar(G, P(1.8, v, 0), P(1.8, v, 1.2), 0.07, C); lmBar(G, P(0, v, 1.2), P(1.8, v, 1.2), 0.05, Y); }
  for (const v of [-0.5, 0.5]) lmBar(G, P(3.2, v, 0), P(3.2, v, 2.4), 0.08, C); for (let k = 1; k < 8; k++) lmBar(G, P(3.2, -0.5, k * 0.3), P(3.2, 0.5, k * 0.3), 0.035, Y);
}
function playground(G, x, z, a) {   // a swing, a slide off a small tower, a sand pit
  const ux = Math.cos(a), uz = Math.sin(a), P = (u, v, y) => [x + ux * u - uz * v, y, z + uz * u + ux * v], R = hb('#c8432f'), B2 = hb('#2f7fbf'), Y = hb('#f0c23a'), W = hb('#9a6a3d');
  for (const u of [-3.6, -1.0]) { lmBar(G, P(u, -0.8, 0), P(u, 0, 2.3), 0.08, B2); lmBar(G, P(u, 0.8, 0), P(u, 0, 2.3), 0.08, B2); }
  lmBar(G, P(-3.6, 0, 2.3), P(-1.0, 0, 2.3), 0.08, B2); for (const u of [-2.8, -1.8]) { lmBar(G, P(u - 0.2, 0, 2.3), P(u - 0.2, 0, 0.5), 0.015, DARK); lmBar(G, P(u + 0.2, 0, 2.3), P(u + 0.2, 0, 0.5), 0.015, DARK); lmBar(G, P(u - 0.22, 0, 0.48), P(u + 0.22, 0, 0.48), 0.08, R); }
  for (const [u, v] of [[1, -0.6], [2.2, -0.6], [1, 0.6], [2.2, 0.6]]) lmBar(G, P(u, v, 0), P(u, v, 2.4), 0.09, W);
  polyA(G, [P(1, -0.6, 1.2), P(2.2, -0.6, 1.2), P(2.2, 0.6, 1.2), P(1, 0.6, 1.2)], W, 0, 1, 0);
  polyA(G, [P(0.95, -0.7, 2.4), P(2.25, -0.7, 2.4), P(1.6, 0, 3.0)], R, 0, 0.6, -0.8); polyA(G, [P(2.25, 0.7, 2.4), P(0.95, 0.7, 2.4), P(1.6, 0, 3.0)], R, 0, 0.6, 0.8);
  polyA(G, [P(0.95, 0.7, 2.4), P(0.95, -0.7, 2.4), P(1.6, 0, 3.0)], Y, -0.8, 0.6, 0); polyA(G, [P(2.25, -0.7, 2.4), P(2.25, 0.7, 2.4), P(1.6, 0, 3.0)], Y, 0.8, 0.6, 0);
  polyA(G, [P(2.2, -0.3, 1.2), P(4.6, -0.3, 0.1), P(4.6, 0.3, 0.1), P(2.2, 0.3, 1.2)], Y, 0.45, 0.9, 0);
  for (const [u0, v0, u1, v1] of [[-3.6, 2, -1, 2], [-1, 2, -1, 4], [-1, 4, -3.6, 4], [-3.6, 4, -3.6, 2]]) lmBar(G, P(u0, v0, 0.12), P(u1, v1, 0.12), 0.18, W);
}

// ---- fences: a textured strip with posts; chain-link and bars are cut out of their texture
let FM = null;
function fenceMats() {
  const mk = draw => { const cv = mkCanvas(128, 128), g = cv.getContext('2d'); draw(g); const t = toTex(cv, true, true); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  const chain = mk(g => { g.strokeStyle = '#8d9396'; g.lineWidth = 7; for (let k = -2; k < 4; k++) { g.beginPath(); g.moveTo(k * 64, 0); g.lineTo(k * 64 + 128, 128); g.stroke(); g.beginPath(); g.moveTo(k * 64 + 128, 0); g.lineTo(k * 64, 128); g.stroke(); } });
  const bars = mk(g => { g.fillStyle = '#3c4a3f'; g.fillRect(0, 6, 128, 10); g.fillRect(0, 112, 128, 10); for (let k = 0; k < 4; k++) g.fillRect(k * 32 + 12, 0, 8, 128); });
  const boards = mk(g => { for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#7b5a3c' : '#86643f'; g.fillRect(k * 16, 0, 15, 128); g.fillStyle = '#4e3826'; g.fillRect(k * 16 + 15, 0, 1, 128); } });
  const conc = mk(g => { g.fillStyle = '#a9a69f'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#8e8b85'; for (let y = 8; y < 128; y += 24) for (let x = (y / 24 % 2) * 16; x < 128; x += 32) g.fillRect(x, y, 14, 10); g.fillStyle = '#77746e'; g.fillRect(0, 0, 3, 128); });
  const m = (map, alpha) => lmStd({ map, alphaTest: alpha ? 0.45 : 0, side: THREE.DoubleSide, roughness: 0.7, metalness: alpha ? 0.4 : 0 }, 'sch-fence-' + (alpha ? 'a' : 'o'));
  FM = { chain: [m(chain, true), 2.0, 1.0], bars: [m(bars, true), 1.6, 1.0], boards: [m(boards, false), 1.6, 1.0], concrete: [m(conc, false), 2.0, 2.0] };
}
function fenceKind(t) { if (/wire|chain|mesh/.test(t)) return 'chain'; if (/wood/.test(t)) return 'boards'; if (/concrete/.test(t)) return 'concrete'; return 'bars'; }
function fences(G) {
  if (!SD.fences.length) return;
  fenceMats(); const geo = {}; for (const k in FM) geo[k] = { p: [], n: [], t: [], i: [] };
  for (const [type, hTag, pts] of SD.fences) {
    const kind = fenceKind(type), [, hDef, uScale] = FM[kind], h = hTag || hDef, g = geo[kind]; let u = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], z0 = pts[i + 1], x1 = pts[i + 2], z1 = pts[i + 3], L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.05) continue;
      const nx = (z1 - z0) / L, nz = -(x1 - x0) / L, k = g.p.length / 3;
      g.p.push(x0, 0, z0, x1, 0, z1, x1, h, z1, x0, h, z0); for (let q = 0; q < 4; q++) g.n.push(nx, 0, nz);
      g.t.push(u / uScale, 0, (u + L) / uScale, 0, (u + L) / uScale, h / 1.6, u / uScale, h / 1.6); g.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
      if (kind === 'chain' || kind === 'bars') for (let s = 0; s < L; s += 2.6) lmBar(G, [x0 + (x1 - x0) * s / L, 0, z0 + (z1 - z0) * s / L], [x0 + (x1 - x0) * s / L, h + 0.05, z0 + (z1 - z0) * s / L], 0.06, kind === 'chain' ? hb('#7f8588') : hb('#33403a'));
      u += L;
    }
  }
  for (const k in geo) { const g = geo[k]; if (!g.i.length) continue; const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3)); bg.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(g.t, 2)); bg.setIndex(g.i);
    const m = new THREE.Mesh(bg, FM[k][0]); m.castShadow = k === 'boards' || k === 'concrete'; m.receiveShadow = true; scene.add(m); }
}

// ---- running tracks: a band along a line (open or closed), with lane lines
function bandAlong(b, pts, closed, half, col, lines) {
  const n = pts.length >> 1, N = []; const P = i => [pts[2 * ((i + n) % n)], pts[2 * ((i + n) % n) + 1]];
  for (let i = 0; i < n; i++) {   // the mean normal at each point
    const a = closed || i > 0 ? P(i - 1) : P(i), c = closed || i < n - 1 ? P(i + 1) : P(i), dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1; N.push([dz / L, -dx / L]);
  }
  const strip = (o0, o1, colr) => { const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) { const j = (i + 1) % n, A = P(i), B = P(j), k = b.v;
      for (const [p, nn, o] of [[A, N[i], o0], [B, N[j], o0], [B, N[j], o1], [A, N[i], o1]]) b.vert(p[0] + nn[0] * o, 0, p[1] + nn[1] * o, 0, 1, 0, colr);
      b.triUp(k, k + 1, k + 2); b.triUp(k, k + 2, k + 3); } };
  if (col) strip(-half, half, col);
  if (lines) for (const o of lines) strip(o - 0.025, o + 0.025, WHITE);
}

function schGrounds(G) {
  if (!SD) return;
  const surf = new GB(false), marks = new GB(false), surfMat = groundMaterial(detailTex(0), 1 / 3, 0.18, 'sch-pitch'), markMat = groundMaterial(detailTex(1), 1 / 2, 0.05, 'sch-marks');
  for (const [, sport, surface, hoops, athletics, ring] of SD.pitches) {
    const r = ring.slice(0, -2), o = obb(r); if (!o) continue;
    const sports = sport.split(';'), main = sports[0], sf = surface || (main === 'soccer' ? 'grass' : athletics || main === 'athletics' ? 'sand' : main ? 'asphalt' : 'tartan');
    const base = hb(SURF[sf] || SURF.asphalt);
    if (o.fill > 0.85) {   // a rectangle: turf and grass mown in stripes across it
      const A = o.a, B = o.b, stripes = sf === 'artificial_turf' || sf === 'grass', n = stripes ? Math.max(2, Math.round(A * 2 / 5)) : 1;
      for (let k = 0; k < n; k++) rectUV(surf, o, -A + 2 * A * k / n, -A + 2 * A * (k + 1) / n, -B, B, stripes && k % 2 ? sh(base, 1.07) : base);
      const ia = Math.max(0.5, Math.min(1.5, A * 0.04)), A2 = A - ia, B2 = B - ia;
      if (athletics === 'long_jump' || main === 'athletics') continue;
      if (main === 'soccer') { football(marks, o, A2, B2); const small = A2 < 30; for (const s of [-1, 1]) goal(G, o, s * A2, s, small ? 3 : Math.min(7.32, B2 * 0.3), small ? 2 : 2.44);
        if (sports.includes('basketball')) { basketball(marks, o, Math.min(A2, 14), Math.min(B2, 7.5), YEL); for (const s of [-1, 1]) hoop(G, o, s * Math.min(A2, 14), s); } }
      else if (main === 'basketball') { basketball(marks, o, A2, B2); const nh = hoops || 2; for (const s of nh === 1 ? [1] : [-1, 1]) hoop(G, o, s * A2, s); }
      else if (main === 'volleyball' || main === 'beachvolleyball') { const [, b] = volleyball(marks, o, A2, B2); net(G, o, b, 2.35); }
      else if (main === 'tennis') { const [, b] = tennis(marks, o, A2, B2); net(G, o, b, 1.0); if (sports.includes('basketball')) for (const s of [-1, 1]) hoop(G, o, s * A2, s); }
      else if (!main && sf === 'tartan') { basketball(marks, o, A2, B2); for (const s of [-1, 1]) hoop(G, o, s * A2, s); }
    } else fillPoly(surf, [r], base);
  }
  // long-jump pits and tracks
  for (const [, lanes, isArea, surface, athletics, pts] of SD.tracks) {
    const col = hb(SURF[surface] || SURF.tartan);
    if (isArea) {
      const r = pts.slice(0, -2), o = obb(r); fillPoly(surf, [r], col);
      if (o && o.fill > 0.8 && o.a > 2.5 * o.b) { const nl = lanes || Math.max(1, Math.floor(o.b * 2 / 1.22)), w = o.b * 2 / nl;
        for (let k = 1; k < nl; k++) line(marks, o, -o.a + 0.3, -o.b + k * w, o.a - 0.3, -o.b + k * w, 0.05, WHITE);
        for (const s of [-1, 1]) line(marks, o, s * (o.a - 2), -o.b, s * (o.a - 2), o.b, 0.08, WHITE); }
      continue;
    }
    const closed = pts.length > 6 && Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 0.5;
    const p = closed ? pts.slice(0, -2) : pts;
    if (athletics === 'long_jump') { bandAlong(surf, p, false, 0.61, hb(SURF.tartan), null);
      const n = p.length, e = [p[n - 2], p[n - 1]], d = [e[0] - p[n - 4], e[1] - p[n - 3]], L = Math.hypot(d[0], d[1]) || 1, o = { cx: e[0] + d[0] / L * 4.5, cz: e[1] + d[1] / L * 4.5, ux: d[0] / L, uz: d[1] / L };
      rectUV(surf, o, -4.5, 4.5, -1.4, 1.4, hb(SURF.sand)); continue; }
    const nl = lanes || 4, half = nl * 0.61, offs = []; for (let k = 0; k <= nl; k++) offs.push(-half + k * 1.22);
    bandAlong(surf, p, closed, half + 0.15, col, null); bandAlong(marks, p, closed, half, null, offs);
  }
  for (const [, kind, ring] of SD.areas) {
    const r = ring.slice(0, -2), o = obb(r); if (!o) continue;
    if (kind === 'playground') { fillPoly(surf, [r], hb('#b9a37c')); playground(G, o.cx, o.cz, Math.atan2(o.uz, o.ux)); }
    else { fillPoly(surf, [r], hb('#4f6e4a')); fitness(G, o.cx - o.ux * 0.5, o.cz - o.uz * 0.5, Math.atan2(o.uz, o.ux)); }
  }
  groundMesh(surf, surfMat, -32.5); groundMesh(marks, markMat, -32.4);
  // things on the ground
  for (const [s, kind, x, z] of SD.points) {
    const a = ((x * 7.3 + z * 3.1) % 6.283);
    if (kind === 'bench') bench(G, x, z, a);
    else if (kind === 'fitness_station') fitness(G, x, z, a);
    else if (kind === 'playground') playground(G, x, z, a);
    else if (kind === 'bicycle_parking') for (let k = 0; k < 5; k++) { const ux = Math.cos(a), uz = Math.sin(a), px = x + ux * (k - 2) * 0.8, pz = z + uz * (k - 2) * 0.8; for (let q = 0; q < 6; q++) { const t0 = q / 6 * Math.PI, t1 = (q + 1) / 6 * Math.PI; lmBar(G, [px - uz * Math.cos(t0) * 0.4, 0.05 + Math.sin(t0) * 0.75, pz + ux * Math.cos(t0) * 0.4], [px - uz * Math.cos(t1) * 0.4, 0.05 + Math.sin(t1) * 0.75, pz + ux * Math.cos(t1) * 0.4], 0.05, STEEL); } }
    else if (kind === 'waste_basket') lmLathe(G, x, z, 0, [[0.22, 0], [0.24, 0.7], [0.25, 0.75], [0, 0.75]], 10, hb('#6b4a32'));
  }
  fences(G);
}

export { schGrounds };
