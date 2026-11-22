/* The «Шторм» event: a battle royale over the whole city. A safe circle that begins beyond the map shrinks in nine
   stages over thirty minutes towards a random final point; whoever stands outside burns (the napalm's periodic hurt,
   game.mjs stepStorm). The stages hold, then shrink: the hold is the breath before the run, the shrink forces everybody
   towards the middle — the fight is guaranteed. After the last stage the circle vanishes altogether (sudden death,
   two minutes, the damage grows): no camp survives it. The last one alive wins the round; the dead go back to the
   lobby (the page owns that, the server only refuses the respawn). The schedule is pure data and geometry here so the
   combat tests can drive it by their own clock; the game owns the players, the hurt and the cycle. */

export const STORM = {
  waitMs: 60000,          // the gathering between rounds: the city is open, the guns are cold
  endMs: 15000,           // the victory table stands this long before the next gathering
  playMs: 1800000,        // thirty minutes of the shrinking zone (the holds and shrinks below sum to it)
  suddenMs: 120000,       // overtime: the last circle closes to nothing
  tickMs: 500,            // the burn outside is judged twice a second (the napalm's own rhythm)
  suddenDps: 35,
  r0: 3200,               // the first circle covers the whole city and the river banks beyond it
  rEnd: 22,               // the last circle: a courtyard, two men, one winner
  c0: { x: -1000, z: 500 },   // the centre of the first circle — the middle of the built city
  finalR: 1600,           // the final point is drawn this far from c0 at most (walkable, not in the river)
  // the nine stages: radius before → after, the hold and the shrink in seconds, the burn outside in hp/s.
  // holds 970 s + shrinks 830 s = 1800 s exactly.
  radii: [3200, 2100, 1400, 900, 560, 340, 200, 110, 55, 22],
  holds: [180, 150, 130, 110, 100, 90, 80, 70, 60],
  shrinks: [130, 120, 110, 100, 90, 80, 70, 60, 70],
  dps: [2, 3, 4, 6, 8, 11, 15, 20, 26],
};

const lerp = (a, b, k) => a + (b - a) * k;

/* The plan of one round: nine stages with absolute times (t0 — the start of the hold, tShrink — the start of the
   shrink, tEnd — the end of the stage) and the circles they move between. The centre walks from c0 to the final point
   in steps proportional to the radius lost, with a sideways sway that fades as the circle tightens; every step is
   clamped so the next circle lies wholly inside the current one (|Δcentre| + rNext ≤ r). The final stage lands exactly
   on the final point. */
export function stormPlan(c0, cF, t0 = 0, seed = Math.random() * 100) {
  const R = STORM.radii, plan = [];
  let c = { x: c0.x, z: c0.z }, t = t0;
  for (let i = 0; i < R.length - 1; i++) {
    const drop = R[i] - R[i + 1], left = R[i] - STORM.rEnd;
    // the share of the remaining travel this stage takes — proportional to the radius it loses
    let nx = c.x + (cF.x - c.x) * drop / left, nz = c.z + (cF.z - c.z) * drop / left;
    const dx = cF.x - c.x, dz = cF.z - c.z, L = Math.hypot(dx, dz) || 1;
    const sway = Math.sin(seed + i * 2.1) * 0.16 * drop * (R[i + 1] / R[0]);   // the sway dies out towards the end
    nx += -dz / L * sway; nz += dx / L * sway;
    let sx = nx - c.x, sz = nz - c.z; const sl = Math.hypot(sx, sz), cap = drop * 0.85;
    if (sl > cap) { sx *= cap / sl; sz *= cap / sl; }   // the next circle stays inside the current one
    const to = i === R.length - 2 ? { x: cF.x, z: cF.z, r: R[i + 1] } : { x: c.x + sx, z: c.z + sz, r: R[i + 1] };
    const holdMs = STORM.holds[i] * 1000, shrinkMs = STORM.shrinks[i] * 1000;
    plan.push({ i, from: { x: c.x, z: c.z, r: R[i] }, to, dps: STORM.dps[i], t0: t, tShrink: t + holdMs, tEnd: t + holdMs + shrinkMs, holdMs, shrinkMs });
    c = { x: to.x, z: to.z }; t += holdMs + shrinkMs;
  }
  return plan;
}

/* The circle at time t within one stage: still through the hold, then a straight walk from `from` to `to`. */
export function stageCircle(ph, t) {
  if (t <= ph.tShrink) return { x: ph.from.x, z: ph.from.z, r: ph.from.r };
  const k = Math.max(0, Math.min(1, (t - ph.tShrink) / ph.shrinkMs));
  return { x: lerp(ph.from.x, ph.to.x, k), z: lerp(ph.from.z, ph.to.z, k), r: lerp(ph.from.r, ph.to.r, k) };
}

/* A random final point: walkable ground within STORM.finalR of the first centre, tried around the known squares and
   parks first (the arenas of arenas.mjs read as landmarks here without importing them), then anywhere in the disc.
   The fallback is the first centre itself — the Unity square, always walkable. */
export function pickFinal(world, c0 = STORM.c0) {
  const seeds = [[-1487, 1263], [-1730, 1340], [-822, 1462], [-950, 960], [56, 1214], [-2680, -280], [877, -526], [347, 376]];
  const trySpot = (x, z) => {
    if (Math.hypot(x - c0.x, z - c0.z) > STORM.finalR) return null;
    for (let r = 0; r < 60; r += 6) for (let k = 0; k < 8; k++) {
      const a = k / 8 * 6.283 + r * 0.13, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
      if (world.walkable(nx, nz)) return { x: nx, z: nz };
    }
    return null;
  };
  for (let i = seeds.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seeds[i], seeds[j]] = [seeds[j], seeds[i]]; }
  for (const [x, z] of seeds) { const p = trySpot(x + (Math.random() - 0.5) * 220, z + (Math.random() - 0.5) * 220); if (p) return p; }
  for (let k = 0; k < 60; k++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * STORM.finalR; const p = trySpot(c0.x + Math.cos(a) * r, c0.z + Math.sin(a) * r); if (p) return p; }
  return { x: c0.x, z: c0.z };
}