import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { fortGround } from '../fortress/ground-height.js';
import { FORT, fss } from '../fortress/index.js';
import { spwCap, spwGround } from '../landmarks/speedway.js';
import { VB, vbGround, vbLocal } from './bridge-vienibas.js';
import { cutCarve, cutY } from './cutting.js';
import { upPatch, upUnder } from './underpass.js';
import { U, renderer, scene, terrUniforms } from '../render/renderer.js';
import { SegGrid } from '../core/geometry.js';
import { dec } from '../core/util.js';
import { C, WL } from '../core/env.js';

/* ---------- terrain ----------
   The ground rises and falls with the heights of terrain.js (the LGIA lidar terrain model, 20 m grid, built by tools/terrain.js). The
   shared vertex chunks of three.js lift every vertex of every material, shadows included, by the height under it, so
   the ground, streets, trees, vehicles and lamps follow it without being rebuilt. Generic buildings are first shifted
   in their geometry so that each stands level at the height of the upper side of its outline, with the foot of its
   walls down to the ground on the lower side; bridges keep a straight deck from bank to bank. Heights are relative to
   Vienības laukums. */
const TERR = { on: false, x0: 0, z0: 0, s: 25, nx: 2, nz: 2, ref: 0, q: null };
U.tTerr = { value: null }; U.uTerrA = { value: new THREE.Vector4(0, 0, 0.04, 0) }; U.uTerrB = { value: new THREE.Vector4(2, 2, 0, 0) };
U.tPatch = { value: null }; U.uPatchA = { value: new THREE.Vector4(0, 0, 1, 0) }; U.uPatchB = { value: new THREE.Vector4(2, 2, 0, 0) };
THREE.ShaderChunk.common += `
uniform sampler2D tTerr; uniform vec4 uTerrA; uniform vec4 uTerrB; uniform sampler2D tPatch; uniform vec4 uPatchA; uniform vec4 uPatchB;
float terrTexel(vec2 i) { vec4 t = texture2D(tTerr, (i + 0.5) / uTerrB.xy); return (t.r * 65280.0 + t.g * 255.0) * 0.1; }
float patchTexel(vec2 i) { vec4 t = texture2D(tPatch, (i + 0.5) / uPatchB.xy); return (t.r * 65280.0 + t.g * 255.0) * 0.001 - 32.768; }
float terrainH(vec2 p) {
  if (uTerrA.w < 0.5) return 0.0;
  vec2 g = clamp((p - uTerrA.xy) * uTerrA.z, vec2(0.0), uTerrB.xy - 1.001), i = floor(g), f = g - i;
  float h = mix(mix(terrTexel(i), terrTexel(i + vec2(1.0, 0.0)), f.x), mix(terrTexel(i + vec2(0.0, 1.0)), terrTexel(i + vec2(1.0)), f.x), f.y) - uTerrB.z;
  if (uPatchA.w > 0.5) { vec2 e = (p - uPatchA.xy) * uPatchA.z;
    if (e.x >= 0.0 && e.y >= 0.0 && e.x < uPatchB.x - 1.001 && e.y < uPatchB.y - 1.001) { vec2 j = floor(e), k = e - j;
      h += mix(mix(patchTexel(j), patchTexel(j + vec2(1.0, 0.0)), k.x), mix(patchTexel(j + vec2(0.0, 1.0)), patchTexel(j + vec2(1.0)), k.x), k.y); } }
  return h;
}`;
THREE.ShaderChunk.project_vertex = `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelMatrix * mvPosition; mvPosition.y += terrainH(mvPosition.xz);
mvPosition = viewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`;
THREE.ShaderChunk.worldpos_vertex = `#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    worldPosition = batchingMatrix * worldPosition;
  #endif
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
  #endif
  worldPosition = modelMatrix * worldPosition; worldPosition.y += terrainH(worldPosition.xz);
#endif`;

// three's own materials get the terrain too (the shadow depth ones must), except the cube faces the PMREM generator
// draws to filter the environment (its materials draw through project_vertex since three.js r18x): lifted by the
// terrain they would miss the camera and leave the environment black
const TERR_OFF = { value: new THREE.Vector4(0, 0, 0, 0) };
THREE.Material.prototype.onBeforeCompile = function (s) { terrUniforms(s); if (/^PMREM/.test(this.name)) s.uniforms.uTerrA = TERR_OFF; };
// the same bilinear height as the shaders, from the same decimetres
function terrainH(x, z) {
  if (!TERR.on) return 0;
  const nx = TERR.nx, q = TERR.q; let gx = (x - TERR.x0) / TERR.s, gz = (z - TERR.z0) / TERR.s;
  gx = gx < 0 ? 0 : gx > nx - 1.001 ? nx - 1.001 : gx; gz = gz < 0 ? 0 : gz > TERR.nz - 1.001 ? TERR.nz - 1.001 : gz;
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * nx + i, a = q[k], b = q[k + 1], c = q[k + nx], d = q[k + nx + 1];
  const h = ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) * 0.1 - TERR.ref;
  return PATCH.on ? h + patchAt(x, z) : h;
}
/* A fine patch over the grid: offsets in metres on a 1 m grid over a small box, added to the heights, for places the
   20 m grid cannot draw (Daugavas iela under the end of Vienības tilts, src/world/underpass.js). Inside its box the
   ground layers and lines are cut finer so that they follow it (densify, subTris), and the depth grid under the ground
   is drawn at 2 m (src/world/ground.js). Kept to the millimetre, as the shaders read it. */
const PATCH = { on: false, x0: 0, z0: 0, s: 1, nx: 2, nz: 2, d: null, bb: [0, 0, 0, 0] };
function patchAt(x, z) {
  const P = PATCH, gx = (x - P.x0) / P.s, gz = (z - P.z0) / P.s; if (gx < 0 || gz < 0 || gx >= P.nx - 1.001 || gz >= P.nz - 1.001) return 0;
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * P.nx + i, d = P.d;
  return (d[k] * (1 - fx) + d[k + 1] * fx) * (1 - fz) + (d[k + P.nx] * (1 - fx) + d[k + P.nx + 1] * fx) * fz;
}
const inPatch = (x0, z0, x1, z1) => PATCH.on && x1 >= PATCH.bb[0] && x0 <= PATCH.bb[2] && z1 >= PATCH.bb[1] && z0 <= PATCH.bb[3];
function setPatch(p) {
  const n = p.nx * p.nz, data = new Uint8Array(n * 4), d = new Float32Array(n);
  for (let k = 0; k < n; k++) { const v = Math.max(0, Math.min(65535, Math.round((p.d[k] + 32.768) * 1000))); d[k] = v / 1000 - 32.768; data[4 * k] = v >> 8; data[4 * k + 1] = v & 255; data[4 * k + 3] = 255; }
  const tex = new THREE.DataTexture(data, p.nx, p.nz, THREE.RGBAFormat, THREE.UnsignedByteType); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  Object.assign(PATCH, { on: true, x0: p.x0, z0: p.z0, s: p.s, nx: p.nx, nz: p.nz, d, bb: [p.x0, p.z0, p.x0 + (p.nx - 1) * p.s, p.z0 + (p.nz - 1) * p.s] });
  U.tPatch.value = tex; U.uPatchA.value.set(p.x0, p.z0, 1 / p.s, 1); U.uPatchB.value.set(p.nx, p.nz, 0, 0);
}
/* Railways run at an even grade. On a 20 m grid the terrain model puts a node now on the bed, now on the slope of an
   embankment or the top of a cutting, so along a line its heights jump by metres. Each line (bridges left out) gets
   a profile — the median of the heights over ±70 m, then their mean over ±150 m, both narrowing towards its ends so
   that ways meeting at a switch meet, and no steeper than 1.2 % — and the grid takes it within 10 m of the track,
   blending back to the terrain by 30 m: the embankment or the cutting the track runs on. */
function terrainRails(T, q) {
  const nx = T.nx, nz = T.nz, s = T.step, hm = (x, z) => { let gx = Math.max(0, Math.min(nx - 1.001, (x - T.x0) / s)), gz = Math.max(0, Math.min(nz - 1.001, (z - T.z0) / s)); const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * nx + i; return ((q[k] * (1 - fx) + q[k + 1] * fx) * (1 - fz) + (q[k + nx] * (1 - fx) + q[k + nx + 1] * fx) * fz) * 0.1; };
  const dmin = new Float32Array(nx * nz).fill(1e9), tgt = new Float32Array(nx * nz), R = 30, ST = 10;
  for (const l of C.l) {
    if (l[0] !== 8 || l[3]) continue;
    const p = dec(l[2]), n = p.length >> 1; let L = 0; const cum = [0]; for (let i = 1; i < n; i++) cum.push(L += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1])); if (L < 20) continue;
    const M = Math.ceil(L / ST) + 1, X = new Float32Array(M), Z = new Float32Array(M), raw = new Float32Array(M), med = new Float32Array(M), pr = new Float32Array(M);
    let sg = 0; for (let k = 0; k < M; k++) { const d = Math.min(L, k * L / (M - 1)); while (sg < n - 2 && cum[sg + 1] < d) sg++; const t = (d - cum[sg]) / Math.max(1e-6, cum[sg + 1] - cum[sg]);
      X[k] = p[2 * sg] + (p[2 * sg + 2] - p[2 * sg]) * t; Z[k] = p[2 * sg + 1] + (p[2 * sg + 3] - p[2 * sg + 1]) * t; raw[k] = hm(X[k], Z[k]); }
    for (let k = 0; k < M; k++) { const w = Math.min(7, k, M - 1 - k), a = Array.from(raw.subarray(k - w, k + w + 1)).sort((u, v) => u - v); med[k] = a[w]; }
    for (let k = 0; k < M; k++) { const w = Math.min(15, k, M - 1 - k); let t = 0; for (let j = -w; j <= w; j++) t += med[k + j]; pr[k] = t / (2 * w + 1); }
    const g = 0.012 * L / (M - 1); for (let k = 1; k < M; k++) pr[k] = Math.max(pr[k - 1] - g, Math.min(pr[k - 1] + g, pr[k])); for (let k = M - 2; k >= 0; k--) pr[k] = Math.max(pr[k + 1] - g, Math.min(pr[k + 1] + g, pr[k]));
    for (let k = 0; k < M - 1; k++) {
      const x1 = X[k], z1 = Z[k], dx = X[k + 1] - x1, dz = Z[k + 1] - z1, l2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(x1, x1 + dx) - R - T.x0) / s)), i1 = Math.min(nx - 1, Math.ceil((Math.max(x1, x1 + dx) + R - T.x0) / s)), j0 = Math.max(0, Math.floor((Math.min(z1, z1 + dz) - R - T.z0) / s)), j1 = Math.min(nz - 1, Math.ceil((Math.max(z1, z1 + dz) + R - T.z0) / s));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = T.x0 + i * s, z = T.z0 + j * s, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), d = Math.hypot(x - x1 - dx * t, z - z1 - dz * t), c = j * nx + i;
        if (d < R && d < dmin[c]) { dmin[c] = d; tgt[c] = pr[k] + (pr[k + 1] - pr[k]) * t; }
      }
    }
  }
  for (let c = 0; c < q.length; c++) if (dmin[c] < R) { const w = dmin[c] < 10 ? 1 : 1 - fss((dmin[c] - 10) / (R - 10)); q[c] = Math.round(q[c] * (1 - w) + tgt[c] * 10 * w); }
}
/* Streets on dams. Daugavas iela runs on the flood dam along the Daugava, between the two top edges OSM draws as
   embankments. On the 20 m grid its nodes fall now on the crest, now on a slope: the street rose and fell by 2-3 m every
   few tens of metres and leaned by up to 2 m across. A street with an embankment line along it within 15 m on both
   sides (40 m and more from any bridge: the Vienības bridge has ramps of its own) gets the crest as its profile — the highest ground within 6 m across, the
   median over ±60 m, then the mean over ±60 m, narrowing towards the ends of the stretch, no steeper than 3 % — and the
   grid takes it within 14 m of the axis, blending back to the terrain by 34 m: a level crest with the slopes below. */
function terrainDams(T, q) {
  const nx = T.nx, nz = T.nz, s = T.step, hm = (x, z) => { const gx = Math.max(0, Math.min(nx - 1.001, (x - T.x0) / s)), gz = Math.max(0, Math.min(nz - 1.001, (z - T.z0) / s)), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * nx + i; return ((q[k] * (1 - fx) + q[k + 1] * fx) * (1 - fz) + (q[k + nx] * (1 - fx) + q[k + nx + 1] * fx) * fz) * 0.1; };
  // the embankment lines and the bridges, as segments in 50 m cells
  const cells = new Map(), key = (i, j) => i * 100003 + j, put = (seg, r) => { for (let i = Math.floor((Math.min(seg[0], seg[2]) - r) / 50); i <= Math.floor((Math.max(seg[0], seg[2]) + r) / 50); i++) for (let j = Math.floor((Math.min(seg[1], seg[3]) - r) / 50); j <= Math.floor((Math.max(seg[1], seg[3]) + r) / 50); j++) { const k = key(i, j); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(seg); } };
  for (const l of C.l) { const emb = l[0] === 14; if (!emb && !l[3]) continue; const p = dec(l[2]); for (let i = 0; i + 3 < p.length; i += 2) put([p[i], p[i + 1], p[i + 2], p[i + 3], emb], emb ? 16 : 40); }
  const near = (x, z, tx, tz) => {   // [an embankment along the street on the left, on the right, a bridge within 40 m]
    let L = false, R = false, B = false;
    for (const g of cells.get(key(Math.floor(x / 50), Math.floor(z / 50))) || []) {
      const dx = g[2] - g[0], dz = g[3] - g[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - g[0]) * dx + (z - g[1]) * dz) / l2)), ex = g[0] + dx * t - x, ez = g[1] + dz * t - z, d = Math.hypot(ex, ez);
      if (!g[4]) { if (d < 40) B = true; continue; }
      if (d > 15 || Math.abs(dx * tx + dz * tz) < 0.8 * Math.sqrt(l2)) continue;
      if (ex * tz - ez * tx > 0) L = true; else R = true;
    }
    return [L, R, B];
  };
  const dmin = new Float32Array(nx * nz).fill(1e9), tgt = new Float32Array(nx * nz), R0 = 14, R = 34, ST = 10;
  for (const l of C.l) {
    if (l[0] > 5 || l[3]) continue;
    const p = dec(l[2]), n = p.length >> 1; let Ltot = 0; const cum = [0]; for (let i = 1; i < n; i++) cum.push(Ltot += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1])); if (Ltot < 60) continue;
    const M = Math.ceil(Ltot / ST) + 1, X = new Float32Array(M), Z = new Float32Array(M), TX = new Float32Array(M), TZ = new Float32Array(M), on = new Uint8Array(M);
    let sg = 0; for (let k = 0; k < M; k++) { const d = Math.min(Ltot, k * Ltot / (M - 1)); while (sg < n - 2 && cum[sg + 1] < d) sg++; const sl = Math.max(1e-6, cum[sg + 1] - cum[sg]), t = (d - cum[sg]) / sl;
      X[k] = p[2 * sg] + (p[2 * sg + 2] - p[2 * sg]) * t; Z[k] = p[2 * sg + 1] + (p[2 * sg + 3] - p[2 * sg + 1]) * t; TX[k] = (p[2 * sg + 2] - p[2 * sg]) / sl; TZ[k] = (p[2 * sg + 3] - p[2 * sg + 1]) / sl;
      const [a, b, br] = near(X[k], Z[k], TX[k], TZ[k]); on[k] = a && b && !br ? 1 : 0; }
    for (let k = 1; k < M - 1; k++) if (!on[k]) { let a = k, b = k; while (a > 0 && !on[a - 1] && k - a < 3) a--; while (b < M - 1 && !on[b + 1] && b - k < 3) b++; if (a > 0 && b < M - 1 && on[a - 1] && on[b + 1] && b - a < 3) for (let j = a; j <= b; j++) on[j] = 2; }   // close gaps up to 30 m
    for (let k0 = 0; k0 < M;) {
      if (!on[k0]) { k0++; continue; } let k1 = k0; while (k1 + 1 < M && on[k1 + 1]) k1++;
      const m = k1 - k0 + 1; if (m >= 7) {
        const raw = new Float32Array(m), med = new Float32Array(m), pr = new Float32Array(m);
        for (let k = 0; k < m; k++) { const x = X[k0 + k], z = Z[k0 + k], ux = -TZ[k0 + k], uz = TX[k0 + k]; let h = -1e9; for (let o = -6; o <= 6; o += 2) h = Math.max(h, hm(x + ux * o, z + uz * o)); raw[k] = h; }
        for (let k = 0; k < m; k++) { const w = Math.min(6, k, m - 1 - k), a = Array.from(raw.subarray(k - w, k + w + 1)).sort((u, v) => u - v); med[k] = a[w]; }
        for (let k = 0; k < m; k++) { const w = Math.min(6, k, m - 1 - k); let t = 0; for (let j = -w; j <= w; j++) t += med[k + j]; pr[k] = t / (2 * w + 1); }
        const g = 0.03 * ST; for (let k = 1; k < m; k++) pr[k] = Math.max(pr[k - 1] - g, Math.min(pr[k - 1] + g, pr[k])); for (let k = m - 2; k >= 0; k--) pr[k] = Math.max(pr[k + 1] - g, Math.min(pr[k + 1] + g, pr[k]));
        for (let k = 0; k < m - 1; k++) {
          const x1 = X[k0 + k], z1 = Z[k0 + k], dx = X[k0 + k + 1] - x1, dz = Z[k0 + k + 1] - z1, l2 = dx * dx + dz * dz || 1;
          const i0 = Math.max(0, Math.floor((Math.min(x1, x1 + dx) - R - T.x0) / s)), i1 = Math.min(nx - 1, Math.ceil((Math.max(x1, x1 + dx) + R - T.x0) / s)), j0 = Math.max(0, Math.floor((Math.min(z1, z1 + dz) - R - T.z0) / s)), j1 = Math.min(nz - 1, Math.ceil((Math.max(z1, z1 + dz) + R - T.z0) / s));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const x = T.x0 + i * s, z = T.z0 + j * s, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), d = Math.hypot(x - x1 - dx * t, z - z1 - dz * t), c = j * nx + i;
            if (d < R && d < dmin[c]) { dmin[c] = d; tgt[c] = pr[k] + (pr[k + 1] - pr[k]) * t; }
          }
        }
      }
      k0 = k1 + 1;
    }
  }
  for (let c = 0; c < q.length; c++) if (dmin[c] < R) { const w = dmin[c] < R0 ? 1 : 1 - fss((dmin[c] - R0) / (R - R0)); q[c] = Math.round(q[c] * (1 - w) + tgt[c] * 10 * w); }
}
function terrainInit() {
  const T = window.TERRAIN; if (!T || !T.h) return;
  const bin = atob(T.h), n = bin.length >> 1, q = new Int16Array(n);
  for (let k = 0; k < n; k++) q[k] = (bin.charCodeAt(2 * k) | bin.charCodeAt(2 * k + 1) << 8) << 16 >> 16;
  Object.assign(TERR, { x0: T.x0, z0: T.z0, s: T.step, nx: T.nx, nz: T.nz, q });
  terrainRails(T, q);
  terrainDams(T, q);   // streets on dams: a level crest
  // the fortress keeps a level site: inside it the height of the ground round it, blending out over 200 m
  if (FORT.ok) {
    const at = k => Math.hypot(T.x0 + (k % T.nx) * T.step - FORT.cx, T.z0 + Math.floor(k / T.nx) * T.step - FORT.cz);
    let s = 0, m = 0; for (let k = 0; k < n; k++) { const d = at(k); if (d > FORT.R + 60 && d < FORT.R + 160) { s += q[k]; m++; } }
    const c = m ? s / m : 0; for (let k = 0; k < n; k++) { const d = at(k); if (d < FORT.R + 260) q[k] = Math.round(c + (q[k] - c) * fss((d - FORT.R - 60) / 200)); }
  }
  // the speedway stadium lies level: the track, both stands and the paddock at the mean height of the track (the ground
  // there falls 1.5 m towards Jelgavas iela), blending back to the terrain between 90 and 140 m from the axis of the track
  { const at = k => spwCap(T.x0 + (k % T.nx) * T.step, T.z0 + Math.floor(k / T.nx) * T.step);
    let s = 0, m = 0; for (let k = 0; k < n; k++) if (at(k) < 50) { s += q[k]; m++; }
    if (m) { const c = s / m; for (let k = 0; k < n; k++) { const d = at(k); if (d < 140) q[k] = Math.round(c + (q[k] - c) * fss((d - 90) / 50)); } } }
  cutCarve(T, q);   // Latgales iela in its cutting, deeper than the model shows it (src/world/cutting.js)
  TERR.on = true; TERR.ref = 0; TERR.ref = terrainH(-1487, 1263);
  const data = new Uint8Array(n * 4); for (let k = 0; k < n; k++) { const v = Math.max(0, q[k]); data[4 * k] = v >> 8; data[4 * k + 1] = v & 255; data[4 * k + 3] = 255; }
  const tex = new THREE.DataTexture(data, T.nx, T.nz, THREE.RGBAFormat, THREE.UnsignedByteType); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  U.tTerr.value = tex; U.uTerrA.value.set(T.x0, T.z0, 1 / T.step, 1); U.uTerrB.value.set(T.nx, T.nz, TERR.ref, 0);
  const p = upPatch(); if (p) setPatch(p);   // Daugavas iela under the end of Vienības tilts (src/world/underpass.js)
}
// a shift applied to the y of every vertex written into a GB while it is set (buildings standing level, bridge decks)
STATE.GBC = null;
// bridges: straight decks from the height at one end to the height at the other
const BRIDGES = [], BRSEG = new SegGrid(32);
function bridgeOf(pts, hw) {
  const n = pts.length >> 1, cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]));
  const B = { pts, cum, L: Math.max(cum[n - 1], 0.01), H0: terrainH(pts[0], pts[1]), H1: terrainH(pts[2 * n - 2], pts[2 * n - 1]), hw }, id = BRIDGES.length; BRIDGES.push(B);
  for (let i = 0; i < n - 1; i++) BRSEG.add(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3], id, i);
  return B;
}
// a bridge may carry its own profile of heights along it (B.prof) and a half width per segment (B.hws)
const bridgeAt = (B, i, px, pz) => { const s = B.cum[i] + Math.hypot(px - B.pts[2 * i], pz - B.pts[2 * i + 1]); return B.prof ? B.prof(s) : B.H0 + (B.H1 - B.H0) * s / B.L; };
function bridgeDeck(B) {   // GBC for the geometry of one bridge: everything above the underside of the deck goes with the deck
  return (x, y, z) => { if (y < -1.4) return 0; let best = 1e9, v = 0; const n = B.pts.length >> 1;
    for (let i = 0; i < n - 1; i++) { const x1 = B.pts[2 * i], z1 = B.pts[2 * i + 1], dx = B.pts[2 * i + 2] - x1, dz = B.pts[2 * i + 3] - z1, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2)), px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(x - px, z - pz); if (d < best) { best = d; v = bridgeAt(B, i, px, pz); } }
    return v - terrainH(x, z); };
}
// how far a point on a bridge deck is above the ground under it (for walkers, vehicles and lamps). A road can run under
// a bridge: given a heading (dx, dz), only a deck running the same way counts; given the height one stands at (prev),
// only a deck within reach of it, so a walker under the bridge stays on the ground and one on it stays on the deck
function bridgeY(x, z, dx = 0, dz = 0, prev = null) {
  let r = 0, bd = 1e9; const dl = Math.hypot(dx, dz), S = BRSEG.s;
  BRSEG.near(x, z, 16, (id, d, px, pz) => { const o = id * 6, B = BRIDGES[S[o + 4]]; if (d >= (B.hws ? B.hws[S[o + 5]] : B.hw) + 1 || d >= bd) return;
    if (dl > 0) { const sx = S[o + 2] - S[o], sz = S[o + 3] - S[o + 1], sl = Math.hypot(sx, sz) || 1; if (Math.abs(sx * dx + sz * dz) < 0.7 * sl * dl) return; }
    const h = bridgeAt(B, S[o + 5], px, pz); if (prev !== null && Math.abs(h - prev) > 1.6) return;
    bd = d; r = h - terrainH(x, z); });
  return bd < 1e9 ? Math.max(0, r) : cutY(x, z);   // off the decks, the road of the Latgales iela cutting has its own profile
}
// Vienības tilts is drawn over a level city; on the relief its deck runs straight from the height of one bank to that of
// the other: vbLift is how far that line is above the ground at a point on the bridge, vbComp shifts its geometry
// (the piers below the water line and the feet of the embankments stay on the ground)
function vbLine(s) { const B = [VB.A[0] + VB.T[0] * VB.L, VB.A[1] + VB.T[1] * VB.L], h0 = terrainH(VB.A[0], VB.A[1]), h1 = terrainH(B[0], B[1]); return h0 + (h1 - h0) * Math.max(0, Math.min(1, s / VB.L)); }
function vbLift(x, z) { if (!TERR.on) return 0; const [s, d] = vbLocal(x, z); if (s < -2 || s > VB.L + 2 || Math.abs(d) > VB.HW + 1) return 0; return vbLine(s) - terrainH(x, z); }
function vbComp(x, y, z) { if (y <= WL + 0.5) return 0; const [s, d] = vbLocal(x, z); if (y <= 0.05 && Math.abs(d) > VB.HW + 0.01) return 0; return vbLine(s) - terrainH(x, z); }
// the height a walker stands at above the level city
const walkLift = (x, z, prev = null) => fortGround(x, z) + (upUnder(x, z, 0, 0, prev) ? 0 : vbGround(x, z) + vbLift(x, z)) + terrainH(x, z) + bridgeY(x, z, 0, 0, prev) + spwGround(x, z);   // under the end of Vienības tilts: on Daugavas iela
// the surface of a river or lake at a point: in the terrain model water is the lowest ground around, so the lowest
// height within 50 m keeps the water level right up to its banks
function waterLevel(x, z) { let m = terrainH(x, z); for (const r of [20, 50]) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; m = Math.min(m, terrainH(x + Math.cos(a) * r, z + Math.sin(a) * r)); } return m; }
// polylines cut where the ground bends, so that ribbons laid on them follow it (to within tol metres)
function densify(p, tol = 0.15) {
  const n = p.length >> 1, o = [p[0], p[1]];
  const seg = (x0, z0, x1, z1, d) => { const L = Math.hypot(x1 - x0, z1 - z0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const fine = inPatch(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
    if (d < (fine ? 18 : 12) && L > (fine ? 1 : 6) && Math.abs(terrainH(mx, mz) - (terrainH(x0, z0) + terrainH(x1, z1)) / 2) > tol) { seg(x0, z0, mx, mz, d + 1); seg(mx, mz, x1, z1, d + 1); } else o.push(x1, z1); };
  for (let i = 1; i < n; i++) seg(p[2 * i - 2], p[2 * i - 1], p[2 * i], p[2 * i + 1], 0);
  return o;
}
// triangles split along their longest side until they lie on the ground to within tol metres (or get small); the
// new points are shared between the two triangles of a split side, so no cracks open inside a polygon
function subTris(flat, tris, tol) {
  const F = Array.from(flat), T = [], mid = new Map(), Hc = [];
  const hAt = i => { if (Hc[i] === undefined) Hc[i] = terrainH(F[2 * i], F[2 * i + 1]); return Hc[i]; };
  const split = (a, b) => { const k = a < b ? a * 4194304 + b : b * 4194304 + a; let m = mid.get(k); if (m === undefined) { m = F.length >> 1; F.push((F[2 * a] + F[2 * b]) / 2, (F[2 * a + 1] + F[2 * b + 1]) / 2); mid.set(k, m); } return m; };
  const st = []; for (let t = 0; t < tris.length; t += 3) st.push([tris[t], tris[t + 1], tris[t + 2], 0]);
  while (st.length) {
    const [a, b, c, d] = st.pop(), L = (p, q) => Math.hypot(F[2 * q] - F[2 * p], F[2 * q + 1] - F[2 * p + 1]), lab = L(a, b), lbc = L(b, c), lca = L(c, a), lm = Math.max(lab, lbc, lca);
    let err = 0; const fine = inPatch(Math.min(F[2 * a], F[2 * b], F[2 * c]), Math.min(F[2 * a + 1], F[2 * b + 1], F[2 * c + 1]), Math.max(F[2 * a], F[2 * b], F[2 * c]), Math.max(F[2 * a + 1], F[2 * b + 1], F[2 * c + 1])), mn = fine ? 1.5 : 12, dm = fine ? 24 : 16;
    if (lm > mn && d < dm) for (const [p, q] of [[a, b], [b, c], [c, a]]) err = Math.max(err, Math.abs(terrainH((F[2 * p] + F[2 * q]) / 2, (F[2 * p + 1] + F[2 * q + 1]) / 2) - (hAt(p) + hAt(q)) / 2));
    if (lm > mn && d < dm && (err > tol || lm > 400)) {
      if (lab === lm) { const m = split(a, b); st.push([a, m, c, d + 1], [m, b, c, d + 1]); }
      else if (lbc === lm) { const m = split(b, c); st.push([a, b, m, d + 1], [a, m, c, d + 1]); }
      else { const m = split(c, a); st.push([a, b, m, d + 1], [m, b, c, d + 1]); }
    } else T.push(a, b, c);
  }
  return { flat: F, tris: T };
}

/* Sky: gradient with a sun glow that hugs the horizon, drifting clouds lit from the sun's side, stars at night.
   The copy used for the reflection map also has a dark skyline, so windows at eye level mirror "the other side of the street". */
const SKY_FRAG = `uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uSkyGlow; uniform vec3 uSkyGnd; uniform vec3 uSunDir; uniform vec3 uSunDisc; uniform vec3 uCloudLit; uniform vec3 uCloudDark;
uniform float uTime; uniform float uStars; uniform float uCover; uniform float uSkyline;
varying vec3 vDir;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
float cloud(vec2 p) { float n = fbm(p) + 0.3 * fbm(p * 0.31 + 5.3); return smoothstep(0.80 - uCover * 0.4, 1.10 - uCover * 0.4, n); }
void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0), s = max(dot(d, uSunDir), 0.0);
  vec3 col = mix(uSkyHor, uSkyTop, 1.0 - exp(-y * 3.4));
  float glow = pow(s, 6.0) * 0.5 + pow(s, 48.0) * 0.6;
  col += uSkyGlow * (glow * (0.3 + 0.7 * exp(-y * 5.0)));
  col += uSunDisc * smoothstep(0.99990, 0.99996, s);
  if (uStars > 0.0) {
    vec3 q = d * 380.0, c = floor(q), f = fract(q) - 0.5; float h = h21(c.xy + c.z * 37.7);
    col += vec3(0.85, 0.92, 1.0) * (step(0.9972, h) * smoothstep(0.4, 0.0, length(f)) * (0.3 + 2.5 * fract(h * 917.3)) * uStars * smoothstep(0.02, 0.3, d.y));
  }
  if (d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.12) * 1.5 + uTime * vec2(0.004, 0.0015);
    float dn = cloud(p);
    if (dn > 0.001) {
      vec2 sd = normalize(uSunDir.xz + vec2(1e-4)) * 0.22;
      float occ = cloud(p + sd) * 0.6 + cloud(p + sd * 2.2) * 0.4;
      vec3 cc = mix(uCloudDark, uCloudLit, exp(-occ * 1.6) * (1.0 - 0.35 * dn));
      cc += uSkyGlow * (pow(s, 10.0) * (1.0 - dn) * 0.8);
      cc = mix(col, cc, smoothstep(0.0, 0.26, d.y));       // distant clouds sink into the haze
      col = mix(col, cc, dn);
    }
  }
  if (uSkyline > 0.5) { float sl = 0.02 + 0.07 * vnoise(vec2(atan(d.z, d.x) * 9.0, 1.7)); col = mix(col, uSkyGnd * 0.6, smoothstep(sl + 0.02, sl - 0.02, d.y)); }
  col = mix(col, uSkyGnd, smoothstep(0.0, -0.05, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function skyMaterial() {
  const c = () => ({ value: new THREE.Color() });
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uSkyTop: c(), uSkyHor: c(), uSkyGlow: c(), uSkyGnd: c(), uSunDir: U.sunDir, uSunDisc: c(), uCloudLit: c(), uCloudDark: c(), uTime: U.time, uStars: { value: 0 }, uCover: { value: 0.4 }, uSkyline: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SKY_FRAG
  });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial());
sky.renderOrder = -100; sky.frustumCulled = false; scene.add(sky);
const envScene = new THREE.Scene(); const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()); envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer); STATE.envRT = null;

export { BRIDGES, BRSEG, PATCH, TERR, bridgeDeck, bridgeOf, bridgeY, densify, envScene, envSky, inPatch, pmrem, sky, subTris, terrainH, terrainInit, vbComp, vbLift, walkLift, waterLevel };
