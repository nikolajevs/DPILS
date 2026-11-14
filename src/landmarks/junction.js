import { STATE } from '../core/state.js';
import { lmBar, lmLathe } from './helpers.js';
import { matPlain } from '../world/data.js';
import { terrainH } from '../world/terrain.js';
import { JN, cutY, jnDeck } from '../world/cutting.js';
import { scene } from '../render/renderer.js';
import { GB, polyA } from '../core/geometry.js';
import { hb, sh } from '../core/util.js';

/* ---- The Latgales iela junction (2009–2011) ----
   Latgales iela runs about 900 m in a cutting some 7 m deep, two lanes each way, and passes under four bridges (Latvian
   Wikipedia; contractor Binders: "Daugavpils traffic node", with photographs): the overpass of Piekrastes iela, a
   75.9 m single-span concrete frame whose soffit curves down into both slopes like an arch, with sidewalks behind red
   railings; two railway bridges of 52.7 and 54.4 m, concrete slabs with white parapets on rows of round columns; and a
   64 m footbridge on slender columns with red railings. Outlines from OpenStreetMap (man_made=bridge ways 884947046–
   884947049, in src/world/cutting.js, which also digs the cutting to its depth). Every line on a bridge (road,
   sidewalks, tracks) takes its height from the bridge's axis: one straight deck from the ground at one rim of the
   cutting to the other (the ground as it was before the cutting was dug). */
const jnLocal = (J, x, z) => [(x - J.S[0]) * J.t[0] + (z - J.S[1]) * J.t[1], (x - J.S[0]) * J.n[0] + (z - J.S[1]) * J.n[1]];
// the junction bridge a line lies on, if any
function jnOf(pts) { for (const J of JN) { let ok = true; for (let i = 0; i < pts.length && ok; i += 2) { const [s, v] = jnLocal(J, pts[i], pts[i + 1]); ok = s > -12 && s < J.L + 12 && Math.abs(v) < J.hw + 2; } if (ok) return J; } return null; }
// a bridge line of the city data on a junction bridge: its ends take the heights of that bridge's deck
function jnFix(B) { const J = jnOf(B.pts); if (!J) return false; const n = B.pts.length >> 1;
  B.H0 = jnDeck(J, jnLocal(J, B.pts[0], B.pts[1])[0]); B.H1 = jnDeck(J, jnLocal(J, B.pts[2 * n - 2], B.pts[2 * n - 1])[0]); return true; }
function lmJunction(K) {
  const G = K.plain, CON = hb('#c9c6bf'), WHITE = hb('#e6e4de'), RED = hb('#b3352f'), GREY = hb('#8f9295');
  const top = new GB(false);   // deck tops, drawn before the ground layers so the road and the tracks lie on them
  STATE.GBC = (x, y, z) => y > 0.05 ? -terrainH(x, z) : cutY(x, z);   // heights given absolute, feet at y = 0 on the ground (on the road of the cutting)
  const road = [[-1086.4, -1258.4], [-938.3, -1299.2], [-731.2, -1330.8], [-685.3, -1337.4], [-637.1, -1340.3], [-583.8, -1336.9], [-511.4, -1319.4], [-422.0, -1287.6]];
  // where a bridge axis crosses the middle of the road, and the road's direction there
  const cross = J => { for (let i = 0; i < road.length - 1; i++) { const [x1, z1] = road[i], [x2, z2] = road[i + 1], ex = x2 - x1, ez = z2 - z1, d = J.t[0] * ez - J.t[1] * ex; if (Math.abs(d) < 1e-6) continue;
      const u = ((x1 - J.S[0]) * ez - (z1 - J.S[1]) * ex) / d, w = ((x1 - J.S[0]) * J.t[1] - (z1 - J.S[1]) * J.t[0]) / d; if (w >= 0 && w <= 1) { const l = Math.hypot(ex, ez); return { s: u, rd: [ex / l, ez / l] }; } } return { s: J.L / 2, rd: J.n }; };
  for (const J of JN) {
    const P = (s, v, y) => [J.S[0] + J.t[0] * s + J.n[0] * v, y, J.S[1] + J.t[1] * s + J.n[1] * v], hw = J.hw, c = cross(J), N = 48;
    const rail = J.kind === 'rail', thick = rail ? 1.25 : J.kind === 'foot' ? 0.8 : 0.95;
    // deck top under the ribbons
    { const k = [P(-0.5, -hw, 0), P(J.L + 0.5, -hw, 0), P(J.L + 0.5, hw, 0), P(-0.5, hw, 0)].map(([x, , z], i) => { const s = i === 1 || i === 2 ? J.L + 0.5 : -0.5; return top.vert(x, jnDeck(J, s) - 0.04, z, 0, 1, 0, rail ? hb('#7d766c') : hb('#6d6e70')); });
      top.triUp(k[0], k[1], k[2]); top.triUp(k[0], k[2], k[3]); }
    // the body: sides from the deck down to the soffit, the soffit itself; the overpass's soffit curves down into the slopes
    // past the middle the legs of the frame reach into the slopes: their foot never stands above the ground
    const sof = s => { const d = jnDeck(J, s) - thick; if (J.kind !== 'arch') return d; const q = (s - c.s) / (J.L / 2); let b = d - 13 * q * q;
      if (Math.abs(q) > 0.45) { const p0 = P(s, -hw, 0), p1 = P(s, hw, 0), g = Math.min(terrainH(p0[0], p0[2]), terrainH(p1[0], p1[2])) - 0.6; if (b > g) b = g; } return b; };
    for (const e of [0, J.L]) { const d = jnDeck(J, e), b = Math.min(sof(e), d - thick), sg = e ? 1 : -1;   // close the ends
      polyA(G, [P(e, -hw, d), P(e, hw, d), P(e, hw, b), P(e, -hw, b)], sh(CON, 0.9), J.t[0] * sg, 0, J.t[1] * sg); }
    for (let i = 0; i < N; i++) { const s0 = J.L * i / N, s1 = J.L * (i + 1) / N, d0 = jnDeck(J, s0), d1 = jnDeck(J, s1), b0 = sof(s0), b1 = sof(s1);
      for (const sg of [-1, 1]) polyA(G, [P(s0, sg * hw, d0), P(s1, sg * hw, d1), P(s1, sg * hw, b1), P(s0, sg * hw, b0)], sg < 0 ? CON : sh(CON, 0.96), J.n[0] * sg, 0, J.n[1] * sg);
      polyA(G, [P(s0, -hw, b0), P(s1, -hw, b1), P(s1, hw, b1), P(s0, hw, b0)], sh(CON, 0.8), 0, -1, 0);
      // white fascia along both edges, red railings (solid white parapets on the railway bridges)
      for (const sg of [-1, 1]) {
        polyA(G, [P(s0, sg * (hw + 0.12), d0 + 0.15), P(s1, sg * (hw + 0.12), d1 + 0.15), P(s1, sg * (hw + 0.12), d0 - 0.65), P(s0, sg * (hw + 0.12), d0 - 0.65)], WHITE, J.n[0] * sg, 0, J.n[1] * sg);
        if (rail) { polyA(G, [P(s0, sg * (hw - 0.15), d0), P(s1, sg * (hw - 0.15), d1), P(s1, sg * (hw - 0.15), d1 + 1.1), P(s0, sg * (hw - 0.15), d0 + 1.1)], WHITE, J.n[0] * sg, 0, J.n[1] * sg);
          polyA(G, [P(s0, sg * (hw - 0.15), d0), P(s1, sg * (hw - 0.15), d1), P(s1, sg * (hw - 0.15), d1 + 1.1), P(s0, sg * (hw - 0.15), d0 + 1.1)], sh(WHITE, 0.9), -J.n[0] * sg, 0, -J.n[1] * sg); }
        else { const v = sg * (hw - 0.1); lmBar(G, P(s0, v, d0 + 1.1), P(s1, v, d1 + 1.1), 0.08, RED); lmBar(G, P(s0, v, d0 + 0.15), P(s1, v, d1 + 0.15), 0.06, RED);
          for (let k = 0; k < 3; k++) { const s = s0 + (s1 - s0) * k / 3, y = jnDeck(J, s); lmBar(G, P(s, v, y + 0.15), P(s, v, y + 1.1), 0.035, RED); } }
      }
      // the overpass: red railings also between the roadway and the sidewalks
      if (J.kind === 'arch') for (const v of [-3.9, 3.9]) { lmBar(G, P(s0, v, d0 + 1.0), P(s1, v, d1 + 1.0), 0.07, RED); lmBar(G, P(s0, v, d0 + 0.5), P(s1, v, d1 + 0.5), 0.06, RED);
        for (let k = 0; k < 2; k++) { const s = s0 + (s1 - s0) * k / 2, y = jnDeck(J, s); lmBar(G, P(s, v, y), P(s, v, y + 1.0), 0.06, RED); } }
    }
    // piers under the railway bridges and the footbridge: rows of round columns under cap beams along the road, at the
    // middle of the road and at both kerbs
    if (J.kind !== 'arch') for (const off of [-11, 0, 11]) {
      const cosA = Math.abs(c.rd[0] * J.n[0] + c.rd[1] * J.n[1]) || 1, sp = c.s + off / cosA, cx = J.S[0] + J.t[0] * sp, cz = J.S[1] + J.t[1] * sp, top0 = jnDeck(J, sp) - thick;
      const half = (hw - 0.4) / cosA, m = J.kind === 'foot' ? 1 : Math.max(2, Math.round(2 * half / 4.2));
      const A = [cx - c.rd[0] * half, cz - c.rd[1] * half], B = [cx + c.rd[0] * half, cz + c.rd[1] * half];
      if (J.kind !== 'foot') lmBar(G, [A[0], top0 - 0.45, A[1]], [B[0], top0 - 0.45, B[1]], 0.9, sh(CON, 0.9));
      else lmBar(G, [cx - c.rd[0] * 1.6, top0 - 0.35, cz - c.rd[1] * 1.6], [cx + c.rd[0] * 1.6, top0 - 0.35, cz + c.rd[1] * 1.6], 0.7, sh(CON, 0.9));
      for (let k = 0; k < m; k++) { const f = m === 1 ? 0.5 : k / (m - 1), x = A[0] + (B[0] - A[0]) * f, z = A[1] + (B[1] - A[1]) * f;
        lmLathe(G, x, z, 0, [[J.kind === 'foot' ? 0.32 : 0.5, 0], [J.kind === 'foot' ? 0.32 : 0.5, top0 - 0.85], [0, top0 - 0.85]], 14, CON); }
    }
    if (J.kind === 'arch') for (const sg of [-1, 1]) for (let s = 6; s < J.L; s += 18) { const p = P(s, sg * (hw - 0.3), 0), y = jnDeck(J, s);   // lamps on the overpass
      lmBar(G, [p[0], y, p[2]], [p[0], y + 9, p[2]], 0.14, GREY); lmBar(G, [p[0], y + 9, p[2]], [p[0] - J.n[0] * sg * 1.6, y + 9.1, p[2] - J.n[1] * sg * 1.6], 0.08, GREY); }
  }
  STATE.GBC = null;
  const m = top.mesh(matPlain); if (m) { m.renderOrder = -56; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }
}

export { jnFix, lmJunction };
