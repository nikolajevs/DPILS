import { hb, obb, pick, rnd } from '../core/util.js';
import { ROAD } from '../world/data.js';
import { SER, serFiller, serWing, serWings } from './series.js';

/* ---------- the blocks of the Kandavas iela 4 yard (Esplanāde), as built ----------
   The five-storey blocks around this yard are already recognised by serBuild (k5, the photographed silicate-brick
   series); the four-storey ones of the same quarter are not (serType knows 5–10 storeys), and the short wing of
   Cietokšņa iela 55 is under 30 m long. They are the same standard projects: the brick k5 of 1960s Daugavpils built
   four storeys high on Parādes iela (15A, 17 — red brick, 15 — the panel p5), Cietokšņa iela 53 and Vienības iela 26
   in silicate brick. Matched by the centre of their cadastre outline, like the blocks of Ķīmija (kimija.js).
   The entrances of Kandavas iela 4 face the yard, not the street: OSM maps its four staircase doors (addr:flats
   1–18 … 49–66) on the south-east side, and those of Cietokšņa iela 53 on the west side towards the yard. */
// [cx, cz, storeys, series, colour (null: the palette pick of serBuild), entrance bearing (0: the side with more paths)]
const KAN_HOUSES = [
  [-1506.8, 1105.3, 4, 'k5', '#b05a43', 0],     // Parādes iela 15A — red brick
  [-1450.2, 1127.8, 4, 'p5', '#bdbab2', 0],     // Parādes iela 15 — panel, loggias
  [-1418.7, 1034.8, 4, 'k5', '#d8cfbf', 240],   // Cietokšņa iela 53 — silicate brick, doors to the yard (OSM)
  [-1409.1, 1088.9, 4, 'k5', '#b9654a', 0],     // Parādes iela 17 — an L of two wings, red brick
  [-1615.5, 1157.2, 4, 'k5', '#d6cbb5', 0],     // Vienības iela 26 — silicate brick
  [-1480.6, 953.7, 5, 'k5', null, 0],           // Cietokšņa iela 55 — the short wing across the end
  [-1573.1, 997.1, 5, 'k5', null, 150]          // Kandavas iela 4 — the doors on the yard side (OSM staircases)
];
let KANG = null;
function kandOf(outer) {
  if (!KANG) { KANG = new Map(); for (const r of KAN_HOUSES) { const k = Math.floor(r[0] / 20) * 100000 + Math.floor(r[1] / 20); let l = KANG.get(k); if (!l) KANG.set(k, l = []); l.push(r); } }
  const n = outer.length >> 1; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += outer[2 * i] / n; z += outer[2 * i + 1] / n; }
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const r of KANG.get((Math.floor(x / 20) + i) * 100000 + Math.floor(z / 20) + j) || []) if (Math.hypot(r[0] - x, r[1] - z) < 3) return { fl: r[2], t: r[3], c: r[4], e: r[5] };
  return null;
}
function kandBuild(rec, outer, T, id, seed, K) {
  const fl = K.fl || rec[5], o = obb(outer); if (!o) return false;
  const parts = (o.fill < 0.9 && serWings(outer, o)) || (o.fill >= 0.8 ? [{ o, join: {} }] : null);
  if (!parts) return false;   // too far from a rectangle and not cut into wings: the generic builder
  for (const pt of parts) {
    const w = pt.o, vx = -w.uz, vz = w.ux;
    if (pt.filler) { serFiller(T, w, fl, hb(K.c || pick(SER.k5.pal, id, 1)), id, seed); continue; }
    // the entrances: on the mapped side, else on the side with more paths and drives along it
    let ent = 0;
    if (K.e) { const want = K.e, off = sv => { const b = (Math.atan2(vx * sv, -vz * sv) * 180 / Math.PI + 360) % 360; return Math.abs(((b - want) % 360 + 540) % 360 - 180); }; if (Math.min(off(-1), off(1)) < 60) ent = off(-1) < off(1) ? -1 : 1; }
    if (!ent) { const hits = sv => { let n = 0; for (let k = -2; k <= 2; k++) for (const d of [5, 9, 13]) { const x = w.cx + w.ux * k * w.a / 2.5 + vx * sv * (w.b + d), z = w.cz + w.uz * k * w.a / 2.5 + vz * sv * (w.b + d);
      let on = false; ROAD.near(x, z, 6, (rid, dd) => { if (dd < ROAD.s[rid * 6 + 4] + 0.8) on = true; }); if (on) n++; } return n; };
      const h0 = hits(-1), h1 = hits(1); ent = h0 === h1 ? (rnd(id, 51) < 0.5 ? -1 : 1) : h0 > h1 ? -1 : 1; }
    const tint = hb(K.c || pick(SER[K.t].pal, id, 1));
    const other = K.t === 'k5' && rnd(id, 52) > 0.65 ? 'C' : 'B';
    serWing(T, w, fl, K.t, id, seed, { ent, other, tint, join: pt.join, wing: parts.length > 1 || 2 * w.a < 30, pitched: false, doors: true });
  }
  return true;
}

export { kandBuild, kandOf };