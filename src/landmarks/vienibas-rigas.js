import * as THREE from 'three';
import { COL, M_MARK, M_PAVE } from '../world/data.js';
import { WH, walkSlab as walkRing } from '../world/walkgrid.js';
import { scene } from '../render/renderer.js';
import { GB, polyA } from '../core/geometry.js';
import { area2, hb, reversed, sh, triangulate } from '../core/util.js';
import { lmBar, lmBoxL, lmLathe } from './helpers.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { std } from '../render/materials.js';

/* ---- Vienības iela × Rīgas iela, by the Unity House ----
   The four-way node where Vienības iela (tram in its own bed, the tree alley on the Unity House side) meets Rīgas iela.
   OSM gives only the centre lines, so the generic street layer left a bare asphalt box: sidewalks cut square at the
   junction, one guessed zebra, no corner returns, no tactile paving, no furniture. Photographs of the corridor
   (Mapillary, July 2020 and 2016, the sequence along Vienības iela) show a ballasted tram bed and a wide grass alley
   with a second path, benches and black lantern poles on the Unity House side. This module finishes the node itself:
   rounded corner sidewalks with a returned kerb, blister tactile pads at every crossing, zebras on all four legs,
   corner bollards, a street-name sign, and the bench / lantern / tree row down the south-east approach. Frame: metres,
   x east, z south; the node and the four leg directions measured from the OSM centre lines in citydata.js. */
const N = [-1538.5, 1329.5];
const LEGS = [[0.54, 0.84], [0.81, -0.58], [-0.55, -0.83], [-0.82, 0.57]];   // SE (Vienības), NE (Rīgas), NW (Vienības), SW (Rīgas)
const WI = 3.1, WO = 5.7, R = 5, S0 = 3.0, ZC = WI + R + 1.6;   // kerb line, sidewalk outer edge, corner radius, stub start, zebra station
const perp = d => [-d[1], d[0]];
const add = (p, q, s) => [p[0] + q[0] * s, p[1] + q[1] * s];
const norm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

function lmVienibasRigas(K) {
  const G = K.plain, PAVE = hb('#988779'), CURB = hb('#a9a69e'), WHITE = hb('#e8e6df'), DARK = hb('#3a3d40'), STEEL = hb('#5b6064');
  const pave = new GB(false), mark = new GB(false);
  const quad = (b, pts, y, col) => { const k = pts.map(([x, z]) => b.vert(x, y, z, 0, 1, 0, col)); b.triUp(k[0], k[1], k[2]); b.triUp(k[0], k[2], k[3]); };

  // corner returns: the sidewalk block of each corner with its inner corner rounded by a kerb arc tangent to both legs
  for (let c = 0; c < 4; c++) {
    const d1 = LEGS[c], d2 = LEGS[(c + 1) % 4], m = norm(add(d1, d2, 1));
    let n1 = perp(d1), n2 = perp(d2);
    if (n1[0] * m[0] + n1[1] * m[1] < 0) n1 = [-n1[0], -n1[1]];
    if (n2[0] * m[0] + n2[1] * m[1] < 0) n2 = [-n2[0], -n2[1]];
    const C = add(add(N, n1, WI + R), n2, WI + R);
    const arc = rad => { const o = []; for (let k = 0; k <= 12; k++) { const u = norm(add([-n1[0], -n1[1]], [-n2[0], -n2[1]], k / 12)); o.push(add(C, u, rad)); } return o; };
    const inner = arc(R);
    const A = add(add(N, d1, S0), n1, WI), D = add(add(N, d2, S0), n2, WI), E = add(add(N, d2, S0), n2, WO);
    const F = add(add(N, n1, WO), n2, WO), Gp = add(add(N, d1, S0), n1, WO);
    const ring = [A, inner[0], ...inner.slice(1), D, E, F, Gp];
    let flat = []; for (const [x, z] of ring) flat.push(x, z);
    if (area2(flat) < 0) flat = Array.from(reversed(flat));
    const { flat: ff, tris } = triangulate([flat]), v0 = pave.v; pave.ensure(ff.length / 2);
    for (let i = 0; i < ff.length; i += 2) pave.vert(ff[i], WH + 0.01, ff[i + 1], 0, 1, 0, PAVE);
    for (let i = 0; i < tris.length; i += 3) pave.triUp(v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2]);
    walkRing(flat, WH);
    // the returned kerb: a battered face towards the road along the arc and the two stubs, with a flat top
    const kerbLine = [A, ...inner, D];
    for (let i = 0; i < kerbLine.length - 1; i++) {
      const [x0, z0] = kerbLine[i], [x1, z1] = kerbLine[i + 1], dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L, sgn = (nx * (N[0] - x0) + nz * (N[1] - z0)) > 0 ? 1 : -1;
      polyA(G, [[x0, WH + 0.01, z0], [x1, WH + 0.01, z1], [x1, WH + 0.16, z1], [x0, WH + 0.16, z0]], sh(CURB, 0.88), nx * sgn, 0, nz * sgn);
      polyA(G, [[x0, WH + 0.16, z0], [x1, WH + 0.16, z1], [x1 - nx * sgn * 0.12, WH + 0.16, z1 - nz * sgn * 0.12], [x0 - nx * sgn * 0.12, WH + 0.16, z0 - nz * sgn * 0.12]], sh(CURB, 1.06), 0, 1, 0);
    }
    for (const u of [[-n1[0], -n1[1]], [-m[0], -m[1]], [-n2[0], -n2[1]]]) {
      const p = add(C, u, R + 1.0);
      lmLathe(G, p[0], p[1], WH, [[0.09, 0], [0.09, 0.72], [0.06, 0.84], [0, 0.9]], 10, DARK);
      COL.add(p[0], p[1], p[0] + 0.01, p[1], 0.1, 0);
    }
  }

  // zebras on all four legs
  for (const d of LEGS) {
    const n = perp(d);
    for (let c = -(WI - 0.5); c <= WI - 0.5; c += 1.1)
      quad(mark, [add(add(N, d, ZC - 2), n, c - 0.25), add(add(N, d, ZC + 2), n, c - 0.25), add(add(N, d, ZC + 2), n, c + 0.25), add(add(N, d, ZC - 2), n, c + 0.25)], 0.03, WHITE);
  }

  // blister tactile pads where each crossing meets the sidewalk (a canvas of dots, one quad per pad)
  const cv = mkCanvas(64, 64), g2 = cv.getContext('2d', { willReadFrequently: true });
  g2.fillStyle = '#c9c4b8'; g2.fillRect(0, 0, 64, 64); g2.fillStyle = '#a9a496';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g2.beginPath(); g2.arc(8 + x * 16, 8 + y * 16, 5, 0, 7); g2.fill(); }
  const tp = [], tu = [], ti = [];
  for (const d of LEGS) {
    const n = perp(d);
    for (const sg of [-1, 1]) {
      const p = add(add(N, d, ZC - 1.1), n, sg * (WI + 0.8)), k = tp.length / 3;
      for (const [a, b, u, v] of [[-0.4, -0.6, 0, 0], [0.4, -0.6, 1, 0], [0.4, 0.6, 1, 1], [-0.4, 0.6, 0, 1]]) {
        const q = add(add(p, d, a), n, b); tp.push(q[0], WH + 0.02, q[1]); tu.push(u, v);
      }
      ti.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
  tg.setAttribute('normal', new THREE.Float32BufferAttribute(tp.map((_, i) => i % 3 === 1 ? 1 : 0), 3)); tg.setIndex(ti);

  // street-name sign at the north-east corner: pole with two plates, one per street
  { const m = norm(add(LEGS[0], LEGS[1], 1)), b = add(N, m, WO + 1.4);
    lmBar(G, [b[0], WH, b[1]], [b[0], WH + 3.1, b[1]], 0.07, STEEL);
    for (const [d, y] of [[LEGS[0], 2.75], [LEGS[1], 2.35]]) { const n = perp(d);
      polyA(G, [[b[0] - n[0] * 0.8, WH + y, b[1] - n[1] * 0.8], [b[0] + n[0] * 0.8, WH + y, b[1] + n[1] * 0.8], [b[0] + n[0] * 0.8, WH + y + 0.34, b[1] + n[1] * 0.8], [b[0] - n[0] * 0.8, WH + y + 0.34, b[1] - n[1] * 0.8]], hb('#2b4a7b'), n[0], 0, n[1]); }
  }

  // the alley down the south-east approach (Unity House side): benches, black lantern poles, a row of trees
  const d = LEGS[0], nNE = [d[1], -d[0]];
  const WOOD = hb('#7a5c3e'), LEAF = hb('#4d7a3a'), TRUNK = hb('#6b4f38');
  for (let t = 12; t <= 40; t += 8) {
    const p = add(add(N, d, t), nNE, WO + 4.0), f = [p[0], p[1], d[0], d[1]];
    lmBoxL(G, f, -0.9, 0.9, -0.26, 0.26, WH + 0.42, WH + 0.5, WOOD);
    lmBoxL(G, f, -0.9, 0.9, 0.2, 0.3, WH + 0.5, WH + 0.95, WOOD);
    for (const u of [-0.75, 0.75]) lmBoxL(G, f, u - 0.06, u + 0.06, -0.22, 0.22, WH, WH + 0.42, DARK);
    const q = add(add(N, d, t + 4), nNE, WO + 2.6);
    lmBar(G, [q[0], WH, q[1]], [q[0], WH + 4.0, q[1]], 0.06, DARK);
    lmLathe(K.globe, q[0], q[1], WH + 4.0, [[0, 0], [0.16, 0.06], [0.2, 0.2], [0.12, 0.34], [0, 0.38]], 12, hb('#f2efe6'));
    const r = add(add(N, d, t + 2), nNE, WO + 7.5);
    lmLathe(G, r[0], r[1], WH, [[0.16, 0], [0.14, 2.0], [0.1, 2.4]], 8, TRUNK);
    lmLathe(G, r[0], r[1], WH + 2.2, [[0, 0], [1.5, 0.3], [2.0, 1.3], [1.5, 2.5], [0, 3.1]], 10, sh(LEAF, 0.9 + (t % 3) * 0.06));
  }

  const pm = pave.mesh(M_PAVE); if (pm) { pm.renderOrder = -36.8; pm.frustumCulled = false; pm.receiveShadow = true; scene.add(pm); }
  const mm = mark.mesh(M_MARK); if (mm) { mm.renderOrder = -32.9; mm.frustumCulled = false; mm.receiveShadow = true; scene.add(mm); }
  const tm = new THREE.Mesh(tg, std({ map: toTex(cv, true, false), roughness: 0.9, metalness: 0 }, 'lm-vr-tact'));
  tm.renderOrder = -32.8; tm.frustumCulled = false; tm.receiveShadow = true; scene.add(tm);
}

export { lmVienibasRigas };
