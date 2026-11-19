import { staticCarAt } from './cars.js';
import { terrainH } from './terrain.js';
import { bulletDrop } from '../../server/combat.mjs';

/* ---------- a car at a point: the parked cars of the car parks and the standing ones (police, hospital, squares) ----------
   Returns null, or { px, pz, top }: the nearest point of the car's axis (to find which way its side faces) and the height of its roof. */
export const carProbes = [];   // the car parks add theirs (parking.js) — registered, not imported: the game must not wait for that module
export function carAt(x, y, z) {
  for (const f of carProbes) { const c = f(x, y, z); if (c) return c; }
  return staticCarAt(x, y, z, terrainH(x, z));
}

// how far a bullet flies from o along d before it meets a car, or len if it does not: the coarse 0.75 m scan is bisected to ~3 mm.
// v (m/s), when given, follows the bullet's falling arc (combat.mjs bulletDrop) instead of the straight line
export function carPath(o, d, len, v) {
  const hit = t => !!carAt(o[0] + d[0] * t, o[1] + d[1] * t - (v ? bulletDrop(t, v) : 0), o[2] + d[2] * t);
  for (let t = 0.75; t < len; t += 0.75) {
    if (!hit(t)) continue;
    let lo = t - 0.75, hi = t;
    for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (hit(m)) hi = m; else lo = m; }
    return hi;
  }
  return len;
}
