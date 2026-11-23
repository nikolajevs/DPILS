/* Combat geometry: the rules, the weapons and the hitboxes. The hitboxes (HIT, rayHit) are shared with the page
   (src/game/mp.js imports them); the weapons table is kept in step with the copy there by hand. */
export const RULES = {
  maxPlayers: 64, hp: 100, bodyDmg: 22, headDmg: 40, range: 160, fireGapMs: 85, respawnMs: 3000, protectMs: 2500,
  runSpeed: 11, tickHz: 15,
};
// the weapons (keep src/game/mp.js in step): pellets per shot, damage of a pellet to the body and to the head, range,
// the least time between shots, and vel — the muzzle velocity in m/s: the bullet really flies (server/game.mjs steps it),
// so the hit lands when it arrives, not at the click. The page draws its tracers at the same speeds (src/game/impacts.js
// reads vel from here).
// drag: the air brakes the bullet, v(t) = v0/(1 + drag·v0·t) — one coefficient per cartridge, the same in the server's
// flight, the page's tracer and the bots' aim. In distance it reads v(s) = v0·e^(−drag·s), and the damage goes as v²/v0²
// (the old linear falloff is gone): the shotgun keeps ~40 % at 45 m, the pistol ~70 % at 90 m, the machine gun ~75 % at
// 140 m as before, the rifle now loses ~30 % by 160 m and the sniper ~10 % by 400 m — distance costs damage, not only arc.
// pen: the penetration budget in metres of wall chord (physics.mjs shotPath): a corner clip or a thin shed is punched
// through and the bullet flies on at v·(1 − chord/pen); a twelve-metre panel house stays solid. The shotgun punches nothing.
// The bullet falls while it flies: BULLET_G below, the same arc on the server, in the page's tracer and in the bots' aim.
// Real gravity with the drag's longer flight time: a 7.62 (820 m/s) at 400 m is ~0.50 s in the air and sinks ~1.23 m —
// long shots need holdover, and the scope's lower marks are calibrated against exactly this arc (src/game/mp.js).
export const WEAPONS = [
  { name: 'Автомат', mag: 30, gapMs: 85, pellets: 1, dmg: 22, head: 40, range: 160, vel: 560, drag: 0.0012, pen: 0.45 },
  { name: 'Дробовик', mag: 6, gapMs: 750, pellets: 8, dmg: 9, head: 16, range: 45, vel: 380, drag: 0.01, pen: 0 },
  { name: 'Снайперская', mag: 5, gapMs: 1300, pellets: 1, dmg: 70, head: 100, range: 400, vel: 820, drag: 0.00013, pen: 1.2 },
  { name: 'Пистолет', mag: 12, gapMs: 150, pellets: 1, dmg: 20, head: 42, range: 90, vel: 430, drag: 0.002, pen: 0.2 },
  { name: 'Пулемёт', mag: 100, gapMs: 60, pellets: 1, dmg: 16, head: 28, range: 140, vel: 560, drag: 0.001, pen: 0.6 },
  // the three assault rifles (models fp_m4 / fp_scar / fp_ar15, CC BY 4.0, models/README.md): the M4A1 is the quick
  // one (fast cycle, light 5.56), the SCAR-L the heavy hitter (slower, harder, punches a little more), the AR-15 the
  // flat-shooting marksman's rifle (the fastest bullet, the least drag, the longest reach of the three)
  { name: 'M4A1', mag: 30, gapMs: 75, pellets: 1, dmg: 20, head: 36, range: 170, vel: 620, drag: 0.0011, pen: 0.45 },
  { name: 'SCAR-L', mag: 30, gapMs: 95, pellets: 1, dmg: 24, head: 44, range: 180, vel: 590, drag: 0.001, pen: 0.55 },
  { name: 'AR-15', mag: 30, gapMs: 90, pellets: 1, dmg: 22, head: 42, range: 200, vel: 700, drag: 0.0008, pen: 0.4 },
];   // mag: the magazine size (keep src/game/mp.js in step); the reserve and the reload time are below
// the grenade (keep src/game/nades.js in step): thrown along the aim lifted by `loft`, falls with `g`, bounces on the
// ground, off walls and off players (bodyR + r is the capsule it meets), goes off after `fuseMs`; damage falls linearly
// from `dmg` at the blast to 0 at `radius`. A bullet that meets it in the air detonates it: hitR is the radius the
// bullet judges by (a little wider than the drawn body, so the shot is possible), r is the physical radius of the body.
// The player charges the throw with the mouse held down: the speed grows from `minSpeed` to `maxSpeed`; `speed` is the
// throw of the bots and of a message without a speed.
// the number put in a kill message for a grenade (the weapons are 0 … WEAPONS.length − 1)
export const W_NADE = 9;
export const W_FALL = 10;   // the kill feed: a fall, not a weapon
export const W_FIRE = 11;   // the kill feed: burnt in the napalm's patch
export const W_STORM = 12;   // the kill feed: taken by the storm outside the safe circle (the «Шторм» event, storm.mjs)
// a fall hurts above the safe height: k hp per metre over safe (10 m costs 56, above 15 m kills); g is the player's jump
// gravity (JUMP in src/game/player.js) so the bots fall at the same rate; maxH caps the client's landing report
export const FALL = { safe: 3, k: 8, g: 21, maxH: 80 };
// push: the knockback — the blast throws the living with a velocity (m/s) that fades from `push` at the centre to 0 at
// the radius, like the damage, plus a `pushUp` kick up so even a blast at chest height lifts one off the ground. The
// server sends it to the player ('push'), the client adds it to the jump and a decaying slide; a bot slides on the server.
export const NADE = { count: 2, speed: 15, minSpeed: 6, maxSpeed: 24, loft: 0.17, g: 18, fuseMs: 2500, radius: 8, dmg: 100, cooldownMs: 900, self: 0.5, push: 15, pushUp: 3, r: 0.1, hitR: 0.25, bodyR: 0.3 };
// the two special grenades (keep src/game/nades.js and src/game/mp.js in step): they fly and bounce by the same rules
// (speed, loft, g, cooldown of NADE above), but go off into a zone instead of a blast. The smoke (M18) lays a screen
// that hides the street for `durMs` — no damage, but the bots cannot see through it; the napalm (AN-M14) bursts into a
// burning patch that costs `dps` health a second to whoever stands in it (the thrower included, teammates spared),
// judged every `tickMs` (napalmCells below: the patch is not a disc). `count` is what the ready belt holds at spawn, one of each kind; the belt cap is INV.nadeMax.
// The screen is not a ball that is there at once: it swells out of the canister over `growMs`, holds, and over the last
// `fadeMs` thins from the edge in (smokeCore below); `height` is how high its dense core stands over the surface, and a
// sight line that crosses `hide` metres of that core or more is blind (smokeDepth) — the bots, the name tags and the
// screen the page draws all go by this one shape.
export const SMOKE = { count: 1, fuseMs: 2000, radius: 6, height: 3.6, durMs: 15000, growMs: 2500, fadeMs: 3500, hide: 1.2 };
// The napalm's patch is a set of burning cells laid once where it went off (napalmCells): the filler runs out over the
// surface from the burst as far as `radius`, on a lattice `step` apart, its rim ragged — walls stop it (it flows round a
// corner and through an arch, not through the house), a step higher than `climb` stops it, and a burst on a roof stays on
// that roof. It spreads out from the burst over `spreadMs` (the farther along the way, the later a cell lights) and
// burns out over the last `dieMs` of `durMs`, the rim first and the heart last. A cell burns whoever stands within `cellR`
// of it (feet from `under` below its surface to `over` above) while its heat (fireHeat: up over `inMs`, down over
// `outMs`) is `hot` or more. A smoke screen puts the fire out: every cell its dense core covers goes out in `outMs` and
// does not light again (game.mjs stepZones) — a smoke thrown into the fire, or a napalm thrown into a smoke, fizzles.
export const NAPALM = { count: 1, fuseMs: 2000, radius: 4, durMs: 8000, dps: 30, tickMs: 250, step: 1.25, climb: 0.9, cellR: 0.85, under: 1, over: 2.2, spreadMs: 800, dieMs: 2400, inMs: 250, outMs: 600, hot: 0.35, douseMs: 350 };
const HEX = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
// the cells of a napalm burst at (x, y, z), y the surface it went off on: [{ x, y, z, on, off }] — on and off in ms
// after the burst. world: { ground(x, z), buildingAt(x, z, y), freePath(o, d, len) } (server/world.mjs, physics.mjs).
// A flood over a hex lattice from the burst: a neighbour joins if it lies within the ragged rim, its surface (the
// ground, or the roof of the house it stands on — the same rule as the zone's own surface, game.mjs surfaceAt) is
// within `climb` of the cell it is reached from, and nothing solid stands on the line between them just over the
// higher of the two. rnd: the lattice jitter, the rim's lobes and the times (Math.random; the tests pass their own).
export function napalmCells(world, x, y, z, rnd = Math.random) {
  const N = NAPALM, R = N.radius, s = N.step, h = s * Math.sqrt(3) / 2;
  const l1 = rnd() * 6.283, l2 = rnd() * 6.283, reach = a => R * (0.84 + 0.09 * Math.sin(3 * a + l1) + 0.07 * Math.sin(5 * a + l2));
  const surf = (cx, cz, y0) => {
    const g = world.ground(cx, cz), b = world.buildingAt(cx, cz, y0 + 0.3);
    const sy = !b ? g : y0 + 0.3 > g + (b.top || 12) - 0.6 ? g + (b.top || 12) : null;   // in the wall of a house: no fire there
    return sy != null && Math.abs(sy - y0) <= N.climb ? sy : null;
  };
  const cells = [{ i: 0, j: 0, x, y, z, d: 0 }], seen = new Set([0]);
  for (let q = 0; q < cells.length; q++) {
    const c = cells[q];
    for (const [di, dj] of HEX) {
      const i = c.i + di, j = c.j + dj, k = i * 64 + j; if (seen.has(k)) continue;
      const px = x + (i + j * 0.5) * s + (rnd() - 0.5) * 0.36, pz = z + j * h + (rnd() - 0.5) * 0.36, r = Math.hypot(px - x, pz - z);
      if (r > reach(Math.atan2(pz - z, px - x))) { seen.add(k); continue; }
      const sy = surf(px, pz, c.y); if (sy == null) continue;   // not seen yet: another neighbour, at another height, may reach it
      const dx = px - c.x, dz = pz - c.z, l = Math.hypot(dx, dz);
      if (l > 1e-6 && world.freePath([c.x, Math.max(sy, c.y) + 0.4, c.z], [dx / l, 0, dz / l], l) < l - 0.02) continue;   // a wall between
      seen.add(k); cells.push({ i, j, x: px, y: sy, z: pz, d: c.d + l });
    }
  }
  return cells.map(c => {
    const f = Math.min(1, c.d / R);
    const on = c.d ? Math.round(N.spreadMs * f * (0.85 + 0.3 * rnd())) : 0;
    const off = Math.round(N.durMs - N.dieMs * f * (0.65 + 0.35 * rnd()) - (c.d ? rnd() * 250 : 0));
    return { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), on, off: Math.max(on + N.inMs + N.outMs, off) };
  });
}
// how hot a cell burns ageMs after the burst, 0 to 1: it catches over inMs, burns, and dies down over the last outMs
export function fireHeat(c, ageMs) {
  if (ageMs < c.on || ageMs >= c.off) return 0;
  return Math.min(1, (ageMs - c.on) / NAPALM.inMs, (c.off - ageMs) / NAPALM.outMs);
}
// the heat of the fire under feet standing at (x, fy, z) — the hottest cell within reach, 0 out of the fire
export function fireUnder(cells, ageMs, x, fy, z, reach = NAPALM.cellR) {
  let best = 0;
  for (const c of cells) {
    if (fy < c.y - NAPALM.under || fy > c.y + NAPALM.over) continue;
    const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz >= reach * reach) continue;
    const k = fireHeat(c, ageMs); if (k > best) best = k;
  }
  return best;
}
// the dense core of a smoke screen of radius r, ageMs after it was laid, of durMs in all: half an ellipsoid standing
// on the surface, rc across and hc up, or null when it is out. It swells out of the canister — a puff of a quarter of the
// width at once, the full width by growMs — holds, and over the last fadeMs shrinks to nothing as the screen thins
export function smokeCore(r, ageMs, durMs) {
  const left = durMs - ageMs; if (ageMs < 0 || left <= 0) return null;
  const g = Math.min(1, ageMs / SMOKE.growMs), grow = 1 - (1 - g) * (1 - g), fade = Math.min(1, left / SMOKE.fadeMs);
  return { rc: r * 0.85 * (0.25 + 0.75 * grow) * fade, hc: SMOKE.height * (0.35 + 0.65 * grow) * (0.4 + 0.6 * fade) };
}
// how many metres of dense smoke the sight line from a to b goes through: its chords through the screens' cores, summed
// (cores: { x, y, z, rc, hc } — y the surface the screen lies on, the half under it is not smoke). SMOKE.hide or more
// and the far end is hidden
export function smokeDepth(cores, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
  if (L < 1e-6) return 0;
  let sum = 0;
  for (const c of cores) {
    if (!c || !(c.rc > 0) || !(c.hc > 0)) continue;
    const ox = (a[0] - c.x) / c.rc, oy = (a[1] - c.y) / c.hc, oz = (a[2] - c.z) / c.rc, ux = dx / c.rc, uy = dy / c.hc, uz = dz / c.rc;   // into the unit sphere
    const A = ux * ux + uy * uy + uz * uz, B = ox * ux + oy * uy + oz * uz, C = ox * ox + oy * oy + oz * oz - 1, D = B * B - A * C;
    if (D <= 0) continue;
    const q = Math.sqrt(D); let s0 = Math.max(0, (-B - q) / A), s1 = Math.min(1, (-B + q) / A);
    if (Math.abs(uy) > 1e-9) { const s = -oy / uy; if (uy > 0) s0 = Math.max(s0, s); else s1 = Math.min(s1, s); }   // above the surface only
    else if (oy < 0) continue;
    if (s1 > s0) sum += (s1 - s0) * L;
  }
  return sum;
}
export const NADE_KINDS = ['nade', 'smoke', 'napalm'];   // the frag, the smoke, the incendiary — the 'throw' message's kind
// the cargo event (server/game.mjs, src/game/cargo.js): a supply crate parachutes into a random open spot every few
// minutes — meds, grenades and the rare 8× optic inside, a smoke beacon marks the landing. Whoever takes the loot is
// marked for everyone for markMs: the bait is the fight around the crate. The crate waits on the ground groundMs,
// then is gone; the next drop comes gapMs after the previous one ended (taken or expired).
// The admin panel's «Ивенты» tab tunes these values live and keeps them in server/data/events.json (server/events.mjs).
export const CARGO = {
  firstMs: 75000, gapMs: 150000, alt: 130, speed: 6.5, pickR: 2.6, groundMs: 150000, markMs: 60000, beaconR: 5,
  loot: [['med', 2], ['nade', 1], ['smoke', 1], ['napalm', 1], ['optic', 1]],   // belt first, the surplus into the pack; the optic only if not already owned
};
// the «Царь горы» event (server/game.mjs, src/game/holy.js): the four temples of Church Hill (Церковная горка) —
// an Orthodox cathedral, a Catholic church, a Lutheran church and an Old Believers' church — stand within three hundred
// metres of one another. Every few minutes the hill is called: four bell-tower altars light up beside the temples and
// become capture points. Nobody is carried there — the field stays as it was, and whoever wants the prize makes his own
// way across the city to the beams over the hill. One player alone (or any one member of a team of the players) takes
// an altar by standing in its ring; the taken temple rings its bell across the whole city and grants its buff to
// whoever holds it — the player, or his whole team. The first altar a player takes enlists him in the race: after a
// death he comes back beside the hill (hill.spawn, off the rings), not across the city. Whoever holds all four for
// holdMs wins the grand prize. The bells are synthesised on the page (sfx.js bellSound), one strike note per temple —
// together they spell a chord. Part of the bots (hill.pilgrims) go to the hill too (game.mjs, bots.mjs).
// The admin panel's «Ивенты» tab tunes the timings, the prize and the buffs live (server/events.mjs); the page gets
// the changed buffs and their labels in the 'holy' message, so the picture and the prediction stay with the server.
export const HOLY = {
  firstMs: 240000, gapMs: 420000, durMs: 600000, warnMs: 60000,   // the first call, the gap after one ends, its length (the way to the hill is the players' own), the warning before
  hill: { name: 'Церковная горка', cx: 56, cz: 1214, r: 260, spawn: [60, 150], pilgrims: 0.5 },   // the hill: its middle and edge, the ring round the middle where the enlisted come back, the share of the bots sent there
  capMs: 7000, capR: 13, holdMs: 180000,   // a point takes 7 s alone in the ring (13 m); all four held 3 minutes win the prize
  prizeKills: 5,   // the grand prize: +5 kills to each winner (the holder, or every member of the holding team)
  buffs: { dmg: 1.25, regen: 3, speed: 1.2, reload: 0.7, rate: 0.85 },   // cathedral: damage; catholic: regen hp/s; lutheran: speed; old believers: reload and cycle
  buffName: { dmg: 'Урон +25%', regen: 'Реген +3 HP/с', speed: 'Скорость +20%', reload: 'Перезарядка −30% · темп +15%' },
  temples: [
    { name: 'Собор Бориса и Глеба', short: 'Собор', faith: 'Православие', x: -124, z: 1287, buff: 'dmg', bell: 174.61 },
    { name: 'Костёл Девы Марии', short: 'Костёл', faith: 'Католицизм', x: 181, z: 1266, buff: 'regen', bell: 220.0 },
    { name: 'Церковь Мартина Лютера', short: 'Лютер', faith: 'Лютеранство', x: 57, z: 1286, buff: 'speed', bell: 261.63 },
    { name: 'Ново-Строенская церковь', short: 'Ново-Строенская', faith: 'Старообрядие', x: -15, z: 1086, buff: 'reload', bell: 329.63 },
  ],
};
// the «Штурм Динабурга» event (server/game.mjs, src/game/siege.js): the reconstruction of the 1812 siege — Napoleon
// besieged the fortress and never took it. Registration opens regMs before the assault (the sides are chosen by hand,
// the balance keeps them within `balance` of each other); then the registered are teleported in — the garrison inside
// the walls, the attackers to the staging ground outside — and the protective dome goes up for prepMs: it lets nobody
// in or out and the guns are cold. Then the dome falls and the assault runs durMs. The altar is the cannon fountain
// in the fortress garden (the four barrels of src/fortress/monuments.js): the attackers hold its ring alone for holdMs
// to win; the garrison wins by holding out to the last second (the historical outcome) or by wiping the attackers.
// The fallen leave the event at once — the teleport back to the city; the survivors of the winning side take the rare
// loot (the 8× optic, the red dot, double reserve, the full belt) and prizeKills each. The dome stands over the main
// rampart (its polygon in fortress.js reaches 450 m from the centre), the fight is kept within r of the same centre.
// The admin panel's «Ивенты» tab tunes the timings and the prize live (server/events.mjs).
export const SIEGE = {
  firstMs: 480000, gapMs: 1200000, regMs: 600000, prepMs: 120000, durMs: 1500000, warnMs: 60000,   // the first call, the gap after one ends, registration 10 min, the dome 2 min, the assault 25 min
  holdMs: 60000, capR: 12, balance: 3, prizeKills: 8,   // the altar: a minute alone in the 12 m ring; the sides within 3; +8 kills to each survivor
  cx: -2817.4, cz: -218.1, domeR: 470, r: 560,   // the centre of the main rampart, the dome over it, the edge of the fight
  altar: { x: -2815.6, z: -442.5 },   // the cannon fountain in the fortress garden (FORT_FOUNTAIN, src/fortress/monuments.js)
  names: { a: 'Штурмующие', d: 'Гарнизон' },
};
// the inventory (keep src/game/mp.js and src/game/inventory.js in step): the reserve each weapon starts with, the time
// of its reload, and the items that lie on the map and are picked up by walking over them
export const RESERVE = [90, 24, 15, 36, 200, 90, 90, 90];
export const RELOAD_MS = [1800, 2600, 2800, 1400, 4500, 1700, 2000, 1800];
// the loadout (keep src/game/mp.js in step): only two weapons are equipped on the player at a time — the rifle and the
// pistol by default. The other six ride in the backpack (PACK): 30 cells, six filled with them at the start and
// 24 free for loot. A weapon index lives in exactly one place — a loadout slot or a pack cell — never both. Swapping exchanges a
// pack cell with a loadout slot (server/game.mjs swapWeapon); the magazines and the reserve stay per weapon type.
// A pack cell holds a weapon index or an item kind string ('sight', 'optic', 'med', 'nade', 'smoke', 'napalm'): the sights live in the pack
// until mounted (mounting frees the cell, taking off returns the sight to a free cell), and the med kits and grenades
// beyond the ready belt (INV.medMax / INV.nadeMax) are stored here — the belt refills from the pack as it is spent.
export const LOADOUT = [0, 3];
export const PACK = [1, 2, 4, 5, 6, 7, ...Array(24).fill(null)];   // the six guns not equipped (the three rifles among them: swap one into a slot from the inventory, I) and 24 free cells
export const ITEMS = {
  ammo: { name: 'Патроны', respawnMs: 25000, give: [30, 8, 5, 12, 50, 30, 30, 30] },   // reserve added per weapon
  nade: { name: 'Граната', respawnMs: 30000 },
  smoke: { name: 'Дымовая граната', respawnMs: 35000 },
  napalm: { name: 'Напалм', respawnMs: 40000 },
  med: { name: 'Аптечка', respawnMs: 35000, heal: 50 },
  sight: { name: 'Коллиматор', respawnMs: 45000 },   // the red dot: fast aim, tighter spread, on any weapon
  optic: { name: 'Оптика 8x', respawnMs: 60000 },   // the long scope: strong zoom with its overlay, on any weapon
};
export const INV = { nadeMax: 2, medMax: 3, reserveCap: 2, itemCount: 24, pickR: 1.7, medGapMs: 800, sightMax: 1, opticMax: 1, weaponSlots: 2, packSlots: 30 };   // reserveCap: reserve up to RESERVE × this; nadeMax/medMax: the ready belt (grenades of one kind / med kits) — the surplus rides in the pack and refills the belt as it is spent; sightMax/opticMax: owned of each kind, in the pack + mounted; weaponSlots: equipped guns; packSlots: the backpack
// ---- the ballistics of a flying bullet: gravity and air drag. The path is parameterised by the distance s along the
// initial (unit) direction d. The drag v(t) = v0/(1 + k·v0·t) integrates to s(t) = ln(1 + k·v0·t)/k, so in distance the
// speed reads v(s) = v0·e^(−k·s) and the time to reach s is t(s) = (e^(k·s) − 1)/(k·v0); the bullet sinks ½·g·t(s)²
// below the straight line. k = 0 gives the old no-drag arc (s/v seconds, ½·g·(s/v)²). The server steps the hit along
// this arc (game.mjs), the page draws its tracer and its impact marks on the same one (impacts.js), and the bots aim
// above the target by the same drop (bots.mjs) — one formula, three places. The damage goes as v(s)²/v0² = e^(−2k·s).
export const BULLET_G = 9.81;
export const dragTime = (s, v, k) => (k > 0 ? (Math.exp(k * s) - 1) / (k * v) : s / v);   // seconds to fly s metres
export const dragDist = (t, v, k) => (k > 0 ? Math.log(1 + k * v * t) / k : v * t);   // metres flown in t seconds
export const dragVel = (s, v, k) => v * Math.exp(-k * s);   // the speed left after s metres
export const bulletDrop = (s, v, k = 0) => { const t = dragTime(s, v, k); return 0.5 * BULLET_G * t * t; };
// the point of the arc s metres along d from o (out, when given, is filled and returned)
export function bulletAt(o, d, s, v, k = 0, out = [0, 0, 0]) {
  out[0] = o[0] + d[0] * s; out[1] = o[1] + d[1] * s - bulletDrop(s, v, k); out[2] = o[2] + d[2] * s; return out;
}
// the unit tangent of the arc at s: the initial direction bent down by g·t(s)/v(s) (the way the bullet is going there)
export function bulletDir(d, s, v, k = 0, out = [0, 0, 0]) {
  const x = d[0], y = d[1] - BULLET_G * dragTime(s, v, k) * Math.exp(k * s) / v, z = d[2], l = Math.hypot(x, y, z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l; return out;
}
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
// closest points of two segments a–b and c–d: { dist, pa, pb }, pa on a–b, pb on c–d. The grenade's bounce off a
// player reads the normal from pa − pb (the body's capsule is the second segment).
export function segToSegment(a, b, c, d) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - c[0], vy = d[1] - c[1], vz = d[2] - c[2];
  const wx = a[0] - c[0], wy = a[1] - c[1], wz = a[2] - c[2];
  const A = ux * ux + uy * uy + uz * uz, B = ux * vx + uy * vy + uz * vz, C = vx * vx + vy * vy + vz * vz;
  const D = ux * wx + uy * wy + uz * wz, E = vx * wx + vy * wy + vz * wz, den = A * C - B * B;
  let s = den > 1e-9 ? Math.max(0, Math.min(1, (B * E - C * D) / den)) : 0;
  let t = C > 1e-9 ? Math.max(0, Math.min(1, (B * s + E) / C)) : 0;
  s = A > 1e-9 ? Math.max(0, Math.min(1, (B * t - D) / A)) : 0;
  const pa = [a[0] + ux * s, a[1] + uy * s, a[2] + uz * s], pb = [c[0] + vx * t, c[1] + vy * t, c[2] + vz * t];
  return { dist: Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]), pa, pb };
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
