import { SER, serFiller, serQuad, serWing, wallStrip } from './series.js';
import { flatRoof } from './walls.js';
import { BLD } from '../world/data.js';
import { box, polyA } from '../core/geometry.js';
import { hb, pick, sh } from '../core/util.js';

/* ---------- Miera iela 143: the five-storey block with two passages through it ----------
   OpenStreetMap maps two covered ways (tunnel=building_passage) through the house: a driveway for cars at the
   south-west (the way from Darba iela's yards to the service road behind the block) and, 70 m on, a passage for
   people only, closed to motor vehicles by a bollard at each end. The cadastre outline has both as 6 m wide
   bays set back 1.2–2 m from the façades. In the frame of the house (u along the long side, 0.684 · east − 0.7295 · south;
   v across it towards the south-east; origin (905, −247)) the outline is rectangles:
   two wings of two sections (u −80.4…−48 and 28.9…61.6), the middle of four (−42.3…22.9), a wing of one section
   across the north-east end (u 60.1…73.3, v −19.4…−2.5), and between them the two bridges 5.8 m wide with the passages
   under them. The bridges are drawn here: the upper four storeys one window wide, the ground storey a wall with the
   opening, a ceiling and walls inside the passage, a lamp, and the bollards of the pedestrian one. The wings are the
   grey pebble-finish panel walls with cream brick stair towers over the doors (Mapillary 2020), the entrances on the side of the service road (north-west), balconies towards the yard. */
const UX = 0.684, UZ = -0.7295, VX = -UZ, VZ = UX, OX = 905, OZ = -247;
const W = (u, v) => [OX + UX * u + VX * v, OZ + UZ * u + VZ * v];
const FL = 5, FH = 2.8, YB = 1.0, H = YB + FL * FH, PASS_H = 3.1;
// wings: [u0, u1, v0, v1]; the bridges: [u0, u1, v0, v1, the centre and the width of the opening]
const WINGS = [[-80.45, -48, 0.5, 13.2], [-42.25, 22.85, 0.6, 13.5], [28.85, 61.6, 0.7, 13.8]];
const BRIDGES = [{ r: [-48, -42.25, 1.9, 11.5], c: -45.5, w: 3.8, cars: true }, { r: [22.85, 28.85, 2.1, 11.9], c: 25.95, w: 2.6, cars: false }];
const CROSS = [60.1, 73.3, -19.4, -2.5], STUB = [60.1, 61.6, -2.5, 0.7];

function mieraOf(outer) {
  const n = outer.length >> 1; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += outer[2 * i] / n; z += outer[2 * i + 1] / n; }
  return n >= 29 && n <= 33 && Math.hypot(x - 910, z + 246) < 8;
}

function rect(u0, u1, v0, v1, alongV) {   // a rectangle of the frame as the o of serWing: a the half along its long axis
  const [cx, cz] = W((u0 + u1) / 2, (v0 + v1) / 2);
  return alongV ? { cx, cz, ux: VX, uz: VZ, a: (v1 - v0) / 2, b: (u1 - u0) / 2 } : { cx, cz, ux: UX, uz: UZ, a: (u1 - u0) / 2, b: (v1 - v0) / 2 };
}

function mieraBuild(T, id, seed) {
  const G = T.m, D = T.d, tint = hb('#d4ccbb'), pc = sh(tint, 0.9), PLINTH = hb('#9a968f'), CONC = hb('#a9a69f'), DARK = hb('#2c3134');
  const base = { tint, other: 'B', doors: true, wing: false, mode: 2 };   // grey panels with the pebble finish (Mapillary 2020)
  const CREAM = hb('#dcd2b8'), WIN = hb('#2b353d');
  // the wings: entrances on the north-west side (−v), the balconies towards the yard
  const wings = [...WINGS.map(r => [rect(...r), -1, false]), [rect(...CROSS, true), 1, true]];
  for (const [o, ent, one] of wings) {
    serWing(T, o, FL, 'k5', id, seed, { ...base, ent, wing: one });
    // the stairs: a tower of cream silicate brick over the door, rising past the roof, with the narrow stair windows
    const nSec = one ? 1 : Math.max(2, Math.round(2 * o.a / SER.k5.W)), secW = 2 * o.a / nSec, nx = -o.uz * ent, nz = o.ux * ent;
    for (let k = 0; k < nSec; k++) { const t = -o.a + (k + 0.5) * secW, cx = o.cx + o.ux * t + nx * o.b, cz = o.cz + o.uz * t + nz * o.b;
      box(D.plain, cx + nx * 0.22, cz + nz * 0.22, o.ux, o.uz, 1.45, 0.22, 2.62, H + 0.35, CREAM);
      for (const sd of [-1, 1]) box(D.plain, cx + o.ux * sd * 1.25 + nx * 0.2, cz + o.uz * sd * 1.25 + nz * 0.2, o.ux, o.uz, 0.2, 0.2, YB, 2.62, CREAM);
      for (let f = 1; f < FL; f++) box(D.plain, cx + nx * 0.45, cz + nz * 0.45, o.ux, o.uz, 0.3, 0.02, YB + f * FH + 0.6, YB + f * FH + 1.6, WIN); }
  }
  serFiller(T, rect(...STUB, true), FL, tint, id, seed);
  // the bridges
  const holes = [];
  for (const { r: [u0, u1, v0, v1], c, w, cars } of BRIDGES) {
    const hw = w / 2, wallH = YB + FH;
    for (const sv of [-1, 1]) {   // a face: the ground storey a wall with the opening, the four above in the series window cell
      const vf = sv < 0 ? v0 : v1, nx = VX * sv, nz = VZ * sv, A = W(u0, vf), B = W(u1, vf), C0 = W(c - hw, vf), C1 = W(c + hw, vf);
      const q = (a, b, y0, y1, col) => polyA(G.plain, [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], col, nx, 0, nz);
      q(A, C0, 0, wallH, sh(tint, 0.93)); q(C1, B, 0, wallH, sh(tint, 0.93)); q(C0, C1, PASS_H, wallH, sh(tint, 0.9));   // the piers and the lintel
      serQuad(G.ser, A[0], A[1], B[0], B[1], wallH, H, nx, nz, tint, -0.04, -0.04 + (u1 - u0) / 12, 1, FL, SER.k5.cells.E, seed % 32, 64);
      // a concrete frame round the opening
      for (const [a, b] of [[C0, C0], [C1, C1]]) box(D.plain, a[0] + nx * 0.04, a[1] + nz * 0.04, UX, UZ, 0.07, 0.04, 0, PASS_H, CONC);
      box(D.plain, W(c, vf)[0] + nx * 0.04, W(c, vf)[1] + nz * 0.04, UX, UZ, hw + 0.07, 0.04, PASS_H, PASS_H + 0.14, CONC);
    }
    // inside: the walls of the passage, the ceiling, a lamp
    for (const s of [-1, 1]) { const a = W(c + s * hw, v0), b = W(c + s * hw, v1), n = [UX * -s, UZ * -s];
      polyA(G.plain, [[a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], PASS_H, b[1]], [a[0], PASS_H, a[1]]], sh(tint, 0.72), n[0], 0, n[1]);
      polyA(G.plain, [[a[0], 0.9, a[1]], [b[0], 0.9, b[1]], [b[0], 0.4, b[1]], [a[0], 0.4, a[1]]], sh(tint, 0.6), n[0], 0, n[1]); }   // the dirt of the foot of the wall
    const p0 = W(c - hw, v0), p1 = W(c + hw, v0), p2 = W(c + hw, v1), p3 = W(c - hw, v1);
    polyA(G.plain, [[p0[0], PASS_H, p0[1]], [p1[0], PASS_H, p1[1]], [p2[0], PASS_H, p2[1]], [p3[0], PASS_H, p3[1]]], hb('#8f8c86'), 0, -1, 0);
    const [lx, lz] = W(c, (v0 + v1) / 2); box(D.plain, lx, lz, UX, UZ, 0.25, 0.1, PASS_H - 0.1, PASS_H, hb('#d8d6c8'));
    if (!cars) for (const vf of [v0 - 0.5, v1 + 0.5]) { const [bx, bz] = W(c, vf); for (const du of [-0.8, 0.8]) { const [px, pz] = W(c + du, vf); box(D.plain, px, pz, UX, UZ, 0.07, 0.07, 0, 0.8, DARK); } void bx; void bz; }
    // the roof of the bridge with the parapet
    const ring = new Float32Array([W(u0, v0), W(u1, v0), W(u1, v1), W(u0, v1)].flatMap(p => p));
    flatRoof(G.roof, [ring], H + 0.02, hb(pick(['#5d5f60', '#666867', '#545657'], id, 3)), 5, seed);
    for (const sv of [-1, 1]) { const vf = sv < 0 ? v0 : v1, a = W(u0, vf), b = W(u1, vf);
      wallStrip(G.plain, [a[0], 0, a[1]], [b[0], 0, b[1]], H, H + 0.45, pc, VX * sv, VZ * sv); }
    // the hole in the footprint: the passage can be walked
    const h = [W(c - hw, v0 + 0.01), W(c + hw, v0 + 0.01), W(c + hw, v1 - 0.01), W(c - hw, v1 - 0.01)]; holes.push(new Float32Array(h.flat()));
  }
  const b = BLD[BLD.length - 1]; if (b) b.holes = holes;
  void PLINTH;
  return true;
}

export { mieraBuild, mieraOf };
