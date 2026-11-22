/* The match of the server and its «Шторм». A match lasts two hours — one day of the game (daycycle.mjs): it starts at
   every whole multiple of its length since 1970, so the match begins at the game's midnight and a restart of the
   server keeps the schedule. The door is open for the first half hour; then only those who already played in this
   match come back (a reload, a dropped connection). The last twenty minutes are the storm: a battle royale that is
   sure to find the winner. The safe circle begins beyond the whole field of the game (every player is inside it at
   the start, wherever he stands) and shrinks in nine stages towards a random point of open ground (never in a
   building); whoever stands outside burns (game.mjs tickStorm). The stages hold, then shrink: the hold is the breath
   before the run, the shrink forces everybody towards the point — the fight is guaranteed. After the last stage the
   circle closes to nothing (sudden death, the damage grows): no camp survives it. In the storm there is one life —
   no respawn; the last one standing (or the last team of the players standing) wins the match. The victory table stands until the next match. The schedule and the circles are pure
   data and geometry here so the combat tests can drive them by their own clock; the game owns the players, the hurt
   and the cycle. */

export const MATCH = {
  lenMs: 7200000,          // two hours: the length of the day of the game (daycycle.mjs DAY_MS) — one match is one day
  joinShare: 0.25,         // the door is open for the first quarter of the match: thirty minutes
  stormShare: 1 / 6,       // the storm takes the last sixth: twenty minutes
  bootGraceMs: 300000,     // a restarted server opens the door for five minutes: the players it dropped come back
  warnMs: [300000, 60000], // the chat warns of the storm five minutes and one minute ahead
};

/* The schedule of the match running at t (ms since 1970). */
export function matchAt(t, len = MATCH.lenMs) {
  const n = Math.floor(t / len), start = n * len, stormMs = Math.round(len * MATCH.stormShare);
  return { n, len, start, end: start + len, joinUntil: start + Math.round(len * MATCH.joinShare), stormAt: start + len - stormMs, stormMs };
}

export const STORM = {
  windowMs: 1200000,       // the plan below is written for twenty minutes; a shorter match scales every time in it
  suddenMs: 75000,         // overtime: the last circle closes to nothing
  tickMs: 500,             // the burn outside is judged twice a second (the napalm's own rhythm)
  suddenDps: 35,
  rEnd: 22,                // the last circle: a courtyard, two men, one winner
  margin: 60,              // the first circle reaches this far beyond the farthest corner of the field
  // the nine stages: the hold and the shrink in seconds, the burn outside in hp/s. Holds 455 s + shrinks 620 s +
  // the sudden 75 s = 1150 s: the last fifty seconds of the twenty minutes are the victory table.
  holds: [90, 75, 60, 50, 45, 40, 35, 30, 30],
  shrinks: [120, 105, 90, 75, 65, 55, 45, 35, 30],
  dps: [2, 3, 4, 6, 8, 11, 15, 20, 26],
  city: { x: -1000, z: 500, r: 2200 },   // the open city: the final point is drawn in this disc of the streets (an arena: in its own middle)
};

/* The field of the game and the first circle over it: an arena is its own circle; the open city is the rectangle the
   server keeps the players in (hx × hz around the origin), and the circle round its corners holds every one of them. */
export function stormField(arena, hx, hz) {
  if (arena) return { c: { x: arena.cx, z: arena.cz }, r0: arena.r + STORM.margin, fin: { x: arena.cx, z: arena.cz, r: arena.r * 0.6 } };
  return { c: { x: 0, z: 0 }, r0: Math.hypot(hx, hz) + STORM.margin, fin: { ...STORM.city } };
}

/* The radii of the ten circles: from the first one down to rEnd, each the same share of the one before. */
export function stormRadii(r0) {
  const n = STORM.holds.length, q = Math.pow(STORM.rEnd / r0, 1 / n);
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? STORM.rEnd : r0 * Math.pow(q, i)));
}

const lerp = (a, b, k) => a + (b - a) * k;

/* The plan of one storm: nine stages with absolute times (t0 — the start of the hold, tShrink — the start of the
   shrink, tEnd — the end of the stage) and the circles they move between; k scales the times (a shorter window). The
   centre walks from c0 to the final point in steps proportional to the radius lost, with a sideways sway that fades
   as the circle tightens; every step is clamped so the next circle lies wholly inside the current one
   (|Δcentre| + rNext ≤ r). The final stage lands exactly on the final point. */
export function stormPlan(c0, cF, t0 = 0, seed = Math.random() * 100, r0 = 3200, k = 1) {
  const R = stormRadii(r0), plan = [];
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
    const holdMs = Math.round(STORM.holds[i] * 1000 * k), shrinkMs = Math.round(STORM.shrinks[i] * 1000 * k);
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

/* A random final point in the disc `fin`: open ground, never in a building or the water (world.walkable), with room
   round it (most of a ring 8 m out walkable too — not a slot between two houses). The fallback is the walkable spot
   nearest the disc's middle. */
export function pickFinal(world, fin, rnd = Math.random) {
  const open = (x, z) => {
    if (!world.walkable(x, z)) return false;
    let n = 0; for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; if (world.walkable(x + Math.cos(a) * 8, z + Math.sin(a) * 8)) n++; }
    return n >= 6;
  };
  for (let k = 0; k < 400; k++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * fin.r, x = fin.x + Math.cos(a) * r, z = fin.z + Math.sin(a) * r;
    if (open(x, z)) return { x, z };
  }
  for (let r = 0; r < 300; r += 6) for (let k = 0; k < 12; k++) {
    const a = k / 12 * 6.283, x = fin.x + Math.cos(a) * r, z = fin.z + Math.sin(a) * r;
    if (world.walkable(x, z)) return { x, z };
  }
  return { x: fin.x, z: fin.z };
}
