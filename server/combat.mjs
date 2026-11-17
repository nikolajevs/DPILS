/* Combat geometry shared in spirit with src/game/mp.js (keep the two copies in step). */
export const RULES = {
  maxPlayers: 16, hp: 100, bodyDmg: 22, headDmg: 40, range: 160, fireGapMs: 85, respawnMs: 3000, protectMs: 2500,
  runSpeed: 11, tolerance: 0.5, headTolerance: 0.45, bodyBottom: 1.6, bodyTop: 0.05, tickHz: 15,
};
// the weapons (keep src/game/mp.js in step): pellets per shot, damage of a pellet to the body and to the head, range, how
// much of the damage is lost over the range (falloff 0.6: 40 % left at the end), the least time between shots
export const WEAPONS = [
  { name: 'Автомат', gapMs: 85, pellets: 1, dmg: 22, head: 40, range: 160, falloff: 0 },
  { name: 'Дробовик', gapMs: 750, pellets: 8, dmg: 9, head: 16, range: 45, falloff: 0.6 },
  { name: 'Снайперская', gapMs: 1300, pellets: 1, dmg: 70, head: 100, range: 400, falloff: 0 },
  { name: 'Пистолет', gapMs: 150, pellets: 1, dmg: 20, head: 42, range: 90, falloff: 0.3 },
  { name: 'Пулемёт', gapMs: 60, pellets: 1, dmg: 16, head: 28, range: 140, falloff: 0.25 },
];
// the grenade (keep src/game/nades.js in step): thrown at `speed` along the aim lifted by `loft`, falls with `g`,
// bounces on the ground and off walls, goes off after `fuseMs`; damage falls linearly from `dmg` at the blast to 0 at `radius`
// the number put in a kill message for a grenade (the weapons are 0 … WEAPONS.length − 1)
export const W_NADE = 9;
export const NADE = { count: 2, speed: 15, loft: 0.17, g: 18, fuseMs: 2500, radius: 8, dmg: 100, cooldownMs: 900, self: 0.5 };
// closest distance between the ray (o + t·d, 0 ≤ t ≤ len, |d| = 1) and the segment a–b; returns { dist, t }
export function rayToSegment(o, d, len, a, b) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = o[0] - a[0], wy = o[1] - a[1], wz = o[2] - a[2];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], B = d[0] * ux + d[1] * uy + d[2] * uz, C = ux * ux + uy * uy + uz * uz;
  const D = d[0] * wx + d[1] * wy + d[2] * wz, E = ux * wx + uy * wy + uz * wz, den = A * C - B * B;
  let t = den > 1e-9 ? (B * E - C * D) / den : 0, s = den > 1e-9 ? (A * E - B * D) / den : 0;
  t = Math.max(0, Math.min(len, t)); s = C > 0 ? Math.max(0, Math.min(1, (B * t + E) / C)) : 0;
  t = Math.max(0, Math.min(len, (B * s - D) / A));
  const px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t, qx = a[0] + ux * s, qy = a[1] + uy * s, qz = a[2] + uz * s;
  return { dist: Math.hypot(px - qx, py - qy, pz - qz), t };
}
