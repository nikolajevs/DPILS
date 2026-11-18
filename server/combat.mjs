/* Combat geometry: the rules, the weapons and the hitboxes. The hitboxes (HIT, rayHit) are shared with the page
   (src/game/mp.js imports them); the weapons table is kept in step with the copy there by hand. */
export const RULES = {
  maxPlayers: 16, hp: 100, bodyDmg: 22, headDmg: 40, range: 160, fireGapMs: 85, respawnMs: 3000, protectMs: 2500,
  runSpeed: 11, tickHz: 15,
};
// the weapons (keep src/game/mp.js in step): pellets per shot, damage of a pellet to the body and to the head, range, how
// much of the damage is lost over the range (falloff 0.6: 40 % left at the end), the least time between shots
export const WEAPONS = [
  { name: 'Автомат', mag: 30, gapMs: 85, pellets: 1, dmg: 22, head: 40, range: 160, falloff: 0 },
  { name: 'Дробовик', mag: 6, gapMs: 750, pellets: 8, dmg: 9, head: 16, range: 45, falloff: 0.6 },
  { name: 'Снайперская', mag: 5, gapMs: 1300, pellets: 1, dmg: 70, head: 100, range: 400, falloff: 0 },
  { name: 'Пистолет', mag: 12, gapMs: 150, pellets: 1, dmg: 20, head: 42, range: 90, falloff: 0.3 },
  { name: 'Пулемёт', mag: 100, gapMs: 60, pellets: 1, dmg: 16, head: 28, range: 140, falloff: 0.25 },
];   // mag: the magazine size (keep src/game/mp.js in step); the reserve and the reload time are below
// the grenade (keep src/game/nades.js in step): thrown along the aim lifted by `loft`, falls with `g`, bounces on the
// ground and off walls, goes off after `fuseMs`; damage falls linearly from `dmg` at the blast to 0 at `radius`.
// The player charges the throw with the mouse held down: the speed grows from `minSpeed` to `maxSpeed`; `speed` is the
// throw of the bots and of a message without a speed.
// the number put in a kill message for a grenade (the weapons are 0 … WEAPONS.length − 1)
export const W_NADE = 9;
export const NADE = { count: 2, speed: 15, minSpeed: 6, maxSpeed: 24, loft: 0.17, g: 18, fuseMs: 2500, radius: 8, dmg: 100, cooldownMs: 900, self: 0.5 };
// the inventory (keep src/game/mp.js and src/game/inventory.js in step): the reserve each weapon starts with, the time
// of its reload, and the items that lie on the map and are picked up by walking over them
export const RESERVE = [90, 24, 15, 36, 200];
export const RELOAD_MS = [1800, 2600, 2800, 1400, 4500];
export const ITEMS = {
  ammo: { name: 'Патроны', respawnMs: 25000, give: [30, 8, 5, 12, 50] },   // reserve added per weapon
  nade: { name: 'Граната', respawnMs: 30000 },
  med: { name: 'Аптечка', respawnMs: 35000, heal: 50 },
};
export const INV = { nadeMax: 3, medMax: 2, reserveCap: 2, itemCount: 12, pickR: 1.7, medGapMs: 800 };   // reserveCap: reserve up to RESERVE × this
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
// the hitboxes of a person (the server judges by them and the page predicts by the same code, src/game/mp.js):
// a head sphere, a torso capsule and two leg capsules, all in metres. The pose p = { x, y, z, eye, yaw } carries the
// eye height: crouching (eye 1.1 instead of 1.7) compresses the torso and the legs, the head keeps its size. The legs
// stand apart along the person's own x axis, so a ray between them misses. zone: 1 head, 0 torso, 2 legs; a leg hit
// takes HIT.legMul of the body damage. The head wins over the torso where the two overlap (the neck).
export const HIT = { headR: 0.18, headDrop: 0.1, neck: 0.26, hip: 0.5, torsoR: 0.25, legR: 0.11, legOff: 0.13, legMul: 0.75, grace: 0.05 };
// the nearest hit of the ray (o + t·d, 0 ≤ t ≤ len, |d| = 1) on the pose p: { t, zone } or null
export function rayHit(o, d, len, p) {
  const e = p.eye || 1.7, f = p.y - e, hx = p.x, hy = p.y - HIT.headDrop, hz = p.z;
  const head = rayToSegment(o, d, len, [hx, hy, hz], [hx, hy, hz]);
  if (head.dist <= HIT.headR) return { t: head.t, zone: 1 };
  const hipY = f + HIT.hip * e;
  const torso = rayToSegment(o, d, len, [hx, p.y - HIT.neck, hz], [hx, hipY, hz]);
  let best = torso.dist <= HIT.torsoR ? { t: torso.t, zone: 0 } : null;
  const cx = Math.cos(p.yaw || 0) * HIT.legOff, cz = -Math.sin(p.yaw || 0) * HIT.legOff;
  for (const s of [1, -1]) {
    const leg = rayToSegment(o, d, len, [hx + s * cx, hipY, hz + s * cz], [hx + s * cx, f + 0.05, hz + s * cz]);
    if (leg.dist <= HIT.legR && (!best || leg.t < best.t)) best = { t: leg.t, zone: 2 };
  }
  return best;
}
