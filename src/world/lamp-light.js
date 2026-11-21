import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { due, pause } from '../core/pause.js';
import { U } from '../render/renderer.js';
import { BGRID, BLD, buildingAt } from './data.js';
import { terrainH } from './terrain.js';

/* ---------- the light of the lamps ----------
   Every lit material (standard, lambert, phong — everything that runs three's lighting loop) takes the light of the
   lamps near the point it shades, the way it takes the sun: the asphalt, the walls, the trees, the cars and the players
   are lit by the same lamps, each by its own normal, colour and gloss. 17 000 point lights cannot be three.js lights,
   so the lamps live in one integer data texture (tLamp, RGBA32UI: one sampler, as the facades already use most of the
   16 a GPU gives a shader) and the shader finds its own (a 2-D "clustered" lookup). Its sections, in texels:
   - the lamps: per lamp its head in the world (terrain included, float bits) and its kind, the angle of its arm and
     its height over what it stands on;
   - the walls: per lamp 32 directions round it (8 per texel, 16 bits each), each the distance to the first house wall
     that way and how far the top of that wall lies under the lamp. A point behind the wall is in the shadow of the
     house unless the ray from the lamp passes over the roof, so a courtyard behind a row of houses stays dark while a
     low shed, its roof and the wall facing the lamp are lit. Passages and canopies on posts let the light through;
   - the lists: per cell the lamps that reach it, nearest to the cell first (4 indices per texel);
   - the cells: a grid of 24 m cells over the city, each where its list starts and how long it is (4 per texel).
   The kinds: 0 — a street lamp on its arm (8 m, the light thrown down and wide along the road, cut off at the horizon,
   a little more towards the road than back to the houses); 1 — a park or square globe (4 m, all round, less up);
   2 — a small light (a canopy downlight, a lantern on a wall). The shader also adds a small share of each lamp as
   bounced light, so the side of a wall that faces away is not black next to a bright pool. */
const ND = 32, ROCC = 32, TW = 4096, CS = 24, MAXC = 31;
const REACH = [30, 18, 10];   // metres, per kind: where the light of a lamp ends (the shader has the same numbers)
const L = [], LS = 6;   // per light: x, y (in the geometry, before the terrain lifts it), z, kind, the angle of its arm, foot
const STAT = { lights: 0, cells: 0, entries: 0, maxPerCell: 0, ms: 0 };

/* A light at a point of the geometry being built now: the height compensation of the builder (STATE.GBC) is applied
   as to the vertices, the terrain is added when the lights are put together. dir: the angle of the arm (x towards
   +x, turning towards +z), kind 0 only. foot: how high the light is over what its post stands on (the ground, a
   bridge deck, a roof): a few metres below that it gives no light — the deck of a bridge does not let it down onto
   the piers and the ground underneath. By default the height given, which is the height over the ground. */
function addLight(x, y, z, kind = 1, dir = 0, foot = y) {
  if (STATE.GBC) y += STATE.GBC(x, y, z);
  L.push(x, y, z, kind, dir, foot);
}

const COS = new Float32Array(ND), SIN = new Float32Array(ND);
for (let k = 0; k < ND; k++) { COS[k] = Math.cos(k * 2 * Math.PI / ND); SIN[k] = Math.sin(k * 2 * Math.PI / ND); }
// the walls round a lamp: per direction the first wall with a house behind it, and the top of that house
const HT = Array.from({ length: ND }, () => []);
let stamp = new Int32Array(0), stampN = 0;
function edgesHit(ring, x, z) {
  const n = ring.length >> 1;
  for (let e = 0; e < n; e++) {
    const f = (e + 1) % n, ax = ring[2 * e] - x, az = ring[2 * e + 1] - z, bx = ring[2 * f] - x, bz = ring[2 * f + 1] - z;
    const ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez; if (ll < 1e-8) continue;
    const s0 = Math.max(0, Math.min(1, -(ax * ex + az * ez) / ll)), cx = ax + ex * s0, cz = az + ez * s0;   // the nearest point of the edge
    if (cx * cx + cz * cz > ROCC * ROCC) continue;
    const ua = Math.atan2(az, ax) * ND / (2 * Math.PI); let du = Math.atan2(bz, bx) * ND / (2 * Math.PI) - ua;
    if (du > ND / 2) du -= ND; else if (du < -ND / 2) du += ND;
    const lo = Math.ceil(Math.min(ua, ua + du) - 1e-6), hi = Math.floor(Math.max(ua, ua + du) + 1e-6);
    for (let k = lo; k <= hi; k++) {
      const kk = ((k % ND) + ND) % ND, dx = COS[kk], dz = SIN[kk], den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ez - az * ex) / den, s = (ax * dz - az * dx) / den;
      if (s < -1e-6 || s > 1 + 1e-6 || t <= 0.05 || t >= ROCC) continue;
      HT[kk].push(t);
    }
  }
}
function occlusion(out, o, x, z, yH) {
  for (const h of HT) h.length = 0;
  stampN++;
  const i0 = Math.floor((x - ROCC) / 60), i1 = Math.floor((x + ROCC) / 60), j0 = Math.floor((z - ROCC) / 60), j1 = Math.floor((z + ROCC) / 60);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const l = BGRID.get((i + 2000) * 4096 + j + 2000); if (!l) continue;
    for (const id of l) {
      if (stamp[id] === stampN) continue; stamp[id] = stampN;
      const b = BLD[id], bb = b.bb;
      if (bb[0] > x + ROCC || bb[2] < x - ROCC || bb[1] > z + ROCC || bb[3] < z - ROCC || (b.base || 0) > 1) continue;   // far, or a canopy on posts
      edgesHit(b.ring, x, z);
      if (b.holes) for (const h of b.holes) edgesHit(h, x, z);
    }
  }
  for (let k = 0; k < ND; k++) {
    let t = 255, d = 0; const h = HT[k];
    if (h.length) {
      h.sort((a, b) => a - b);
      for (const th of h) {   // the first wall with a house behind it (not the mouth of a passage, not a canopy)
        const px = x + COS[k] * (th + 0.4), pz = z + SIN[k] * (th + 0.4), b = buildingAt(px, pz, 1);
        if (!b) continue;
        t = Math.min(254, Math.round(th / ROCC * 255)); d = Math.max(0, Math.min(255, Math.round((yH - terrainH(px, pz) - b.top) / 0.05)));
        break;
      }
    }
    out[o + 2 * k] = t; out[o + 2 * k + 1] = d;
  }
}

/* Puts the registered lights together into the texture the shaders read; called once all the lamps of the city are
   registered (buildLamps). The walls round 18 000 lamps take a few hundred milliseconds: the work pauses now and then
   so the loading screen keeps moving (src/core/pause.js). */
async function buildLampLight() {
  const t0 = performance.now(), n = L.length / LS; if (!n) return STAT;
  stamp = new Int32Array(BLD.length); stampN = 0;
  const pos = new Float32Array(n * 3), meta = new Uint32Array(n), occ = new Uint8Array(n * 64);
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (let j = 0; j < n; j++) {
    const x = L[LS * j], z = L[LS * j + 2], kind = L[LS * j + 3], y = L[LS * j + 1] + terrainH(x, z), foot = Math.max(0, Math.min(1023, Math.round(L[LS * j + 5] * 10)));
    const a = ((L[LS * j + 4] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    pos[3 * j] = x; pos[3 * j + 1] = y; pos[3 * j + 2] = z; meta[j] = (kind | (Math.round(a / (2 * Math.PI) * 65535) << 2) | (foot << 18)) >>> 0;
    if ((j & 255) === 0 && due()) await pause();
    occlusion(occ, j * 64, x, z, y);
    const r = REACH[kind]; x0 = Math.min(x0, x - r); z0 = Math.min(z0, z - r); x1 = Math.max(x1, x + r); z1 = Math.max(z1, z + r);
  }
  // the cells each lamp reaches, nearest first
  const nx = Math.ceil((x1 - x0) / CS), nz = Math.ceil((z1 - z0) / CS), cells = new Array(nx * nz);
  for (let j = 0; j < n; j++) {
    const x = L[LS * j], z = L[LS * j + 2], r = REACH[L[LS * j + 3]];
    const ia = Math.max(0, Math.floor((x - r - x0) / CS)), ib = Math.min(nx - 1, Math.floor((x + r - x0) / CS));
    const ja = Math.max(0, Math.floor((z - r - z0) / CS)), jb = Math.min(nz - 1, Math.floor((z + r - z0) / CS));
    for (let i = ia; i <= ib; i++) for (let k = ja; k <= jb; k++) {
      const cx = Math.max(x0 + i * CS, Math.min(x, x0 + (i + 1) * CS)), cz = Math.max(z0 + k * CS, Math.min(z, z0 + (k + 1) * CS));
      if ((cx - x) * (cx - x) + (cz - z) * (cz - z) > r * r) continue;
      const c = k * nx + i; (cells[c] || (cells[c] = [])).push(j);
    }
  }
  let total = 0, most = 0, used = 0;
  for (let c = 0; c < cells.length; c++) { const l = cells[c]; if (!l) continue; used++;
    const mx = x0 + (c % nx + 0.5) * CS, mz = z0 + (Math.floor(c / nx) + 0.5) * CS, dd = j => (L[LS * j] - mx) ** 2 + (L[LS * j + 2] - mz) ** 2;
    l.sort((a, b) => dd(a) - dd(b)); if (l.length > MAXC) l.length = MAXC; total += l.length; most = Math.max(most, l.length); }
  // the sections of the texture, in texels
  const O0 = n, L0 = O0 + 4 * n, C0 = L0 + Math.ceil(total / 4), size = C0 + Math.ceil(nx * nz / 4), rows = Math.ceil(size / TW);
  const T = new Uint32Array(TW * rows * 4), F = new Float32Array(T.buffer);
  for (let j = 0; j < n; j++) { F[4 * j] = pos[3 * j]; F[4 * j + 1] = pos[3 * j + 1]; F[4 * j + 2] = pos[3 * j + 2]; T[4 * j + 3] = meta[j]; }
  for (let j = 0; j < n * 32; j++) T[4 * O0 + (j >> 1)] |= (occ[2 * j] | (occ[2 * j + 1] << 8)) << (16 * (j & 1));   // 2 directions per channel
  let at = 0;
  for (let c = 0; c < cells.length; c++) { const l = cells[c]; if (!l) continue; T[4 * C0 + c] = (at << 5) | l.length; for (const j of l) T[4 * L0 + at++] = j; }
  const tex = new THREE.DataTexture(T, TW, rows, THREE.RGBAIntegerFormat, THREE.UnsignedIntType);
  tex.internalFormat = 'RGBA32UI'; tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  U.tLamp.value = tex;
  U.uLampGrid.value.set(x0, z0, 1 / CS, nx); U.uLampOn.value.z = nz; U.uLampSec.value.set(O0, L0, C0, 0);
  Object.assign(STAT, { lights: n, cells: used, entries: total, maxPerCell: most, texels: size, ms: Math.round(performance.now() - t0) });
  return STAT;
}
// strength: 0 off (by day), 1 at night; most: the most lamps a point takes (the cheaper quality levels take fewer)
function lampLight(strength) { U.uLampOn.value.x = strength; }
function lampMost(most) { U.uLampOn.value.y = most; }

U.tLamp = { value: null };
U.uLampGrid = { value: new THREE.Vector4(0, 0, 1 / CS, 0) };   // x0, z0 of the grid, 1 / the cell, cells across
U.uLampOn = { value: new THREE.Vector4(0, 16, 0, 0) };   // strength, the most lamps a point takes, cells down
U.uLampSec = { value: new THREE.Vector4(0, 0, 0, 0) };   // where the walls, the lists and the cells start

THREE.ShaderChunk.lights_pars_begin += `
uniform highp usampler2D tLamp; uniform vec4 uLampGrid; uniform vec4 uLampOn; uniform vec4 uLampSec;
uvec4 lampT( int t ) { return texelFetch( tLamp, ivec2( t & 4095, t >> 12 ), 0 ); }
uint lampU( int e ) { uvec4 v = lampT( e >> 2 ); int c = e & 3; return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w; }
float lampSide( uint o, float hD, float dy ) {   // o: the wall that way (distance, depth of its top under the lamp)
  if ( ( o & 255u ) == 255u ) return 1.0;
  float r = float( o & 255u ) * ${(ROCC / 255).toFixed(7)}, top = - float( o >> 8 ) * 0.05;
  float front = 1.0 - smoothstep( r + 0.3, r + 0.9, hD );   // before the wall and on it
  float over = smoothstep( top - 0.4, top + 0.4, dy * r / max( hD, 0.01 ) );   // the ray passes over its roof
  return max( front, over );
}
uint lampOccAt( int li, int k ) { uvec4 v = lampT( int( uLampSec.x ) + li * 4 + ( k >> 3 ) ); int c = ( k & 7 ) >> 1; uint w = c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w; return ( w >> uint( ( k & 1 ) * 16 ) ) & 65535u; }
float lampVis( int li, vec2 dxz, float dy ) {   // dxz, dy: from the lamp to the point
  float hD = length( dxz ), u = atan( dxz.y, dxz.x ) * ${(ND / (2 * Math.PI)).toFixed(7)};
  u = u < 0.0 ? u + ${ND.toFixed(1)} : u;
  float k0 = floor( u ), f = u - k0; int i0 = int( k0 ) & ${ND - 1}, i1 = ( i0 + 1 ) & ${ND - 1};
  uint a = lampOccAt( li, i0 ), b = lampOccAt( li, i1 );
  bool na = ( a & 255u ) == 255u, nb = ( b & 255u ) == 255u;
  if ( na && nb ) return 1.0;
  if ( ! na && ! nb ) {   // one wall: its distance and top between the two rays
    float ra = float( a & 255u ), rb = float( b & 255u ), ta = float( a >> 8 ), tb = float( b >> 8 );
    return lampSide( uint( mix( ra, rb, f ) + 0.5 ) | ( uint( mix( ta, tb, f ) + 0.5 ) << 8 ), hD, dy );
  }
  return mix( lampSide( a, hD, dy ), lampSide( b, hD, dy ), f );   // the corner of a house: the shadow edge between them
}
`;
THREE.ShaderChunk.lights_fragment_begin += `
#if defined( RE_Direct )
if ( uLampOn.x > 0.0 ) {
  vec3 lwP = cameraPosition - vViewPosition * mat3( viewMatrix );   // the point in the world
  vec2 lcg = ( lwP.xz - uLampGrid.xy ) * uLampGrid.z;
  if ( lcg.x >= 0.0 && lcg.y >= 0.0 && lcg.x < uLampGrid.w && lcg.y < uLampOn.z ) {
    ivec2 lci = ivec2( lcg ); uint lcell = lampU( int( uLampSec.z ) * 4 + lci.y * int( uLampGrid.w ) + lci.x );
    int lst = int( lcell >> 5u ), lcnt = min( int( lcell & 31u ), int( uLampOn.y ) );
    vec3 lampFill = vec3( 0.0 );
    IncidentLight lampL; lampL.visible = true;
    for ( int i = 0; i < ${MAXC}; i ++ ) {
      if ( i >= lcnt ) break;
      int li = int( lampU( int( uLampSec.y ) * 4 + lst + i ) );
      uvec4 lt = lampT( li );
      vec3 ld = uintBitsToFloat( lt.xyz ) - lwP; float ld2 = dot( ld, ld );
      float lk = float( lt.w & 3u ), lr = lk < 0.5 ? ${REACH[0].toFixed(1)} : lk < 1.5 ? ${REACH[1].toFixed(1)} : ${REACH[2].toFixed(1)};
      float lq = ld2 / ( lr * lr ); if ( lq >= 1.0 ) continue;
      float ldist = sqrt( ld2 ); vec3 lw = ld / ldist;   // towards the lamp; lw.y is the cosine from its nadir
      float lI, lsoft; vec3 lcol;
      if ( lk < 0.5 ) {   // a street lamp: wide along the road (batwing), cut off towards the horizon, more to the road
        float la = float( ( lt.w >> 2u ) & 65535u ) * ${(2 * Math.PI / 65535).toFixed(9)};
        lI = 240.0 * ( 1.0 + 1.5 * smoothstep( 1.0, 0.45, lw.y ) ) * smoothstep( 0.06, 0.3, lw.y ) * ( 1.0 - 0.35 * dot( lw.xz, vec2( cos( la ), sin( la ) ) ) );
        lcol = vec3( 1.0, 0.78, 0.54 ); lsoft = 16.0;
      } else if ( lk < 1.5 ) {   // a globe: all round, less up (its crown)
        lI = 60.0 * ( 0.3 + 0.7 * smoothstep( -0.5, 0.4, lw.y ) ); lcol = vec3( 1.0, 0.8, 0.58 ); lsoft = 6.0;
      } else {
        lI = 12.0 * smoothstep( -0.2, 0.5, lw.y ); lcol = vec3( 1.0, 0.84, 0.66 ); lsoft = 2.0;
      }
      // the window to its reach; lsoft: the glass is not a point — what stands right by the lamp (the crown of a tree,
      // a wall) is not burnt out by 1/d²; the lamp's own pole and head stay out
      float lwin = 1.0 - lq * lq;
      lI *= lwin * lwin * smoothstep( 0.4, 1.6, ldist ) / ( ld2 + lsoft );
      if ( lI < 1e-3 ) continue;
      float lfoot = float( ( lt.w >> 18u ) & 1023u ) * 0.1;
      lI *= smoothstep( - lfoot - 4.0, - lfoot - 2.5, - ld.y );   // nothing far under its own deck or ground (slopes keep a margin)
      lI *= lampVis( li, - ld.xz, - ld.y );
      lampL.color = lcol * ( lI * uLampOn.x );
      lampL.direction = mat3( viewMatrix ) * lw;
      RE_Direct( lampL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      lampFill += lampL.color;
    }
    reflectedLight.indirectDiffuse += lampFill * 0.05 * BRDF_Lambert( material.diffuseColor );   // bounced
  }
}
#endif
`;

export { STAT as LAMP_LIGHT, addLight, buildLampLight, lampLight, lampMost };
