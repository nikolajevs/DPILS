/* The game itself: everybody against everybody — the only allies are the members of one team of the players
   (teams.mjs: they spare each other, share the team chat, win the storm and the race together) — with or without an
   arena (a play area whose base points are the spawn points of everybody), with or without bots. On the server (opts.match) the fight is a match of two
   hours — the day of the game — with the door open for its first half hour and the «Шторм» for its last twenty
   minutes (storm.mjs): the shrinking circle and one life find the winner. Without opts.match (the training in the
   page) the rounds go to the kill target as before. It knows nothing of the network: a connection is any
   object with send(string) and close(); the Node server (index.mjs) gives it WebSockets, and the page gives it a local
   one for the game against bots with no server at all (src/game/local.js). Players move on their own machines (the game
   limits their speed and keeps them in the arena); the game owns health, shots, kills, scores and respawns. It reads the
   city through `world` (freePath, ground, walkable, buildingAt, stepNade): a shot that would pass through a building does
   not hit, and its tracer stops at the wall. Bullets are real projectiles: they fly at the weapon's muzzle velocity
   (WEAPONS.vel) and the damage lands when the bullet arrives, not at the click. The hit is still judged against the target
   as the shooter saw it at the click (the position rewound by the shooter's lag, frozen for the flight), so “shoot where
   you see” holds while the bullet takes its time to get there. */
import { CARGO, FALL, HIT, HOLY, INV, ITEMS, LOADOUT, NADE, NADE_KINDS, NAPALM, PACK, RELOAD_MS, RESERVE, RULES as R, SIEGE, SMOKE, WEAPONS, W_FALL, W_FIRE, W_NADE, W_STORM, bulletAt, bulletDir, dragDist, dragTime, fireUnder, napalmCells, rayHit, rayToSegment, smokeCore } from './combat.mjs';
import { MATCH as MATCHC, STORM as STORMC, matchAt, pickFinal, stageCircle, stormField, stormPlan } from './storm.mjs';
import { LEVELS, botName, createBrain } from './bots.mjs';
import { DAY_MS, dayPhase } from './daycycle.mjs';

const HX = 5200, HY = 4200;   // bounds a bit wider than the city
const num = (v, lim) => (typeof v === 'number' && isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
const okWeapon = w => Number.isInteger(w) && w >= 0 && w < WEAPONS.length;
export const MUZZLE = 0.6;   // the barrel stands this far along the ray from the eye; a wall nearer rests the muzzle on it (keep src/game/mp.js in step)
// the metres a bullet covers in dt seconds of flight from the geometric distance s0: the drag slows it (v(s) = v0·e^(−k·s),
// combat.mjs), and every punched wall cuts the speed by its factor at the exit face (the chord spent of the budget).
// Most shots punch nothing: then it is one closed form, dragDist from the time already flown.
function flightSeg(b, s0, dt) {
  const k = b.k, v0 = b.speed;
  if (!k && !b.walls.length) return v0 * dt;
  let s = s0, rem = dt, f = 1, i = 0;
  for (; i < b.walls.length; i++) { if (b.walls[i].at <= s0 + 1e-9) f = b.walls[i].f; else break; }
  let va = v0 * Math.exp(-k * s0) * f;
  while (rem > 1e-9) {
    const w = b.walls[i], lim = w ? w.at : Infinity;
    const dc = dragDist(rem, va, k);
    if (s + dc <= lim) { s += dc; break; }
    rem -= dragTime(Math.max(0, lim - s), va, k);
    s = lim; va = v0 * Math.exp(-k * s) * w.f; i++;
  }
  return s - s0;
}

export function createGame(opts) {
  const world = opts.world, MODE = 'ffa', NAME = opts.name || 'Даугавпилс', MAX = opts.maxPlayers || R.maxPlayers;
  // the match of the server (storm.mjs): its length (the day of the game), the door of its first half hour, the grace of
  // a restart; no kill target — the storm of the last twenty minutes decides it. null: the endless rounds of the training
  // off: the shift of the schedule — the servers of one process start their matches one after another (index.mjs SERVERS)
  const MATCH = opts.match ? { len: Math.max(60000, +opts.match.len || MATCHC.lenMs), grace: opts.match.graceMs ?? MATCHC.bootGraceMs, off: +opts.match.offset || 0 } : null;
  const WIN = MATCH ? Infinity : opts.win || 20;
  const now = opts.now || (() => Date.now()), players = new Map();
  // the day of the game (daycycle.mjs): its length; null — no clock, the page keeps the time of day it has
  const DAY = opts.day ? { len: Math.max(60000, +opts.day.len || DAY_MS), off: +opts.day.offset || 0 } : null;   // off: the midnight of this server, with its match
  const dayNow = () => DAY && { f: +dayPhase(now(), DAY.len, DAY.off).toFixed(6), len: DAY.len };
  let nextId = 1, roundOver = false, nextNade = 1, nextBid = 1;
  const nades = new Map(), bullets = new Map(), zones = new Map(), timers = [];   // zones: the smoke screens and the burning patches left by the special grenades
  // the arena: its bases stood on something walkable; without an arena bots roam round the square
  const walkSpot = (x, z) => { if (world.walkable(x, z)) return [x, z]; for (let r = 4; r < 80; r += 4) for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r; if (world.walkable(nx, nz)) return [nx, nz]; } return [x, z]; };
  const arena = opts.arena ? { ...opts.arena, bases: opts.arena.bases.map(b => b.map(([x, z]) => walkSpot(x, z))) } : null;
  const area = arena || (opts.area ? { cx: opts.area.cx ?? -1487, cz: opts.area.cz ?? 1263, r: opts.area.r ?? 450 } : { cx: -1487, cz: 1263, r: 450 });   // a centre alone keeps the default radius
  const send = (p, m) => { if (p.conn) p.conn.send(JSON.stringify(m)); };
  const all = m => { const s = JSON.stringify(m); for (const p of players.values()) if (p.conn) p.conn.send(s); };
  const humans = () => [...players.values()].filter(p => !p.bot);
  const nameBase = s => String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Игрок';
  const taken = n => [...players.values()].some(p => p.name === n);
  function cleanName(s) {
    let n = nameBase(s), base = n, k = 2;
    while (taken(n)) n = base.slice(0, 13) + '#' + k++;
    return n;
  }
  const validKey = k => typeof k === 'string' && /^[0-9a-f]{16,64}$/i.test(k), lb = opts.board || null;   // the leaderboard (leaderboard.mjs): only the humans who sent a key are in it
  const acc = opts.accounts || null;   // accounts (accounts.mjs): when on, a join whose key is not an account key is refused — guests are not let in
  // the teams of the players (teams.mjs, social.mjs): clans(nick) gives the team of an account — {id, tag, name} or null.
  // There are no sides: everybody fights for himself, and the members of one team are the only allies — their bullets,
  // grenades and fire spare each other, the team chat reaches them, they appear together, the storm is won by the last
  // team standing and a temple of the «Царь горы» is held for the whole team. The tag rides the board: [DVN] Nick.
  const clans = opts.clans || null;
  const sameClan = (a, b) => !!(a.clan && b.clan && a.clan.id === b.clan.id);
  // who is spared: the own team of the players. The siege draws its own lines: the
  // participants of one side spare each other whatever their teams, and the bystanders are spared by the event (and
  // spare it) — the reconstruction is a closed battle (siegeFight below)
  const ally = (a, b) => {
    if (a === b) return false;
    if (siegeFight()) { const sa = a.siege, sb = b.siege; if (sa && sb) return sa === sb; if (sa || sb) return true; }
    return sameClan(a, b);
  };
  const clanOf = p => { const c = clans && p.acct ? clans(p.acct) : null; return c ? { id: c.id, tag: c.tag, name: c.name } : null; };
  // the chosen character rides the board: a key of CHARS in src/game/avatar.js; empty — the operator
  const CHARS = ['soldier', 'spartan', 'alien', '2b'];
  const cleanChar = s => (typeof s === 'string' && CHARS.includes(s) ? s : '');
  const botChar = () => CHARS[Math.random() * CHARS.length | 0];
  // the Tab scoreboard reads more than the score: the round's damage and accuracy, the ping of a human (a bot has none),
  // and who is on their feet — so the held table shows the live round, not only the kills
  const board = () => [...players.values()].map(p => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, bot: !!p.bot, char: p.char, dmg: Math.round(p.st.dmg), acc: p.st.shots ? Math.round(100 * p.st.hitShots / p.st.shots) : 0, ping: p.bot ? undefined : Math.round(p.rtt), alive: p.alive, mark: p.markUntil > now() || undefined, tag: p.clan ? p.clan.tag : undefined, clan: p.clan ? p.clan.id : undefined }));
  const sendBoard = () => all({ t: 'board', board: board() });
  // a spot next to a living teammate of p's team (who passes ok), facing as he faces: the team appears together
  function besideMate(p, ok = () => true) {
    if (!p.clan) return null;
    const q = [...players.values()].find(q => q !== p && q.alive && sameClan(p, q) && ok(q)); if (!q) return null;
    const a = Math.random() * 6.283, r = 3 + Math.random() * 5, [x, z] = walkSpot(q.x + Math.cos(a) * r, q.z + Math.sin(a) * r);
    return [x, z, q.yaw];
  }
  // the teams changed (social.mjs): every human takes his team again; the board carries the new tags
  function refreshClans() {
    let changed = false;
    for (const p of players.values()) {
      if (p.bot || !p.acct) continue;
      const c = clanOf(p), was = p.clan ? p.clan.id + '/' + p.clan.tag : '', is = c ? c.id + '/' + c.tag : '';
      if (was !== is) { p.clan = c; changed = true; }
    }
    if (changed) sendBoard();
  }
  const newPlayer = () => ({ id: nextId++, conn: null, bot: null, name: '', char: '', joined: false, joinedAt: 0, x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, hp: 0, alive: false, kills: 0, deaths: 0, st: { shots: 0, hitShots: 0, dmg: 0, heads: 0 }, wep: 0, lastShot: 0, lastNade: 0, nades: 0, smokes: 0, napalms: 0, lastChat: 0, rwin: 0, rmsgs: 0, eye: 1.7, rtt: 80, hist: [], diedAt: 0, protectUntil: 0, t: 0, msgs: 0, win: now(),
    mag: WEAPONS.map(w => w.mag), reserve: RESERVE.slice(), meds: 0, reloadDone: 0, reloadW: 0, lastMed: 0, markUntil: 0,
    attach: WEAPONS.map(() => null),
    loadout: LOADOUT.slice(), pack: PACK.slice() });   // two equipped guns + the backpack (guns and stored items); one sight mounted per weapon
  // where the player stood at time t (the shooter saw the target 120 ms in the past plus half the round trip);
  // the eye height and the heading are rewound with the position, so a crouch or a turn back then counts as it looked
  function poseAt(p, t) {
    const cur = { x: p.x, y: p.y, z: p.z, eye: p.eye, yaw: p.yaw }, h = p.hist;
    if (!h.length || t >= h[h.length - 1][0]) return cur;
    const at = e => ({ x: e[1], y: e[2], z: e[3], eye: e[4] ?? 1.7, yaw: e[5] ?? 0 });
    if (t <= h[0][0]) return at(h[0]);
    for (let i = h.length - 1; i > 0; i--) if (h[i - 1][0] <= t) {
      const a = h[i - 1], b = h[i], k = (t - a[0]) / Math.max(1, b[0] - a[0]), l = (u, v) => u + (v - u) * k;
      let dy = (b[5] ?? 0) - (a[5] ?? 0); dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      return { x: l(a[1], b[1]), y: l(a[2], b[2]), z: l(a[3], b[3]), eye: l(a[4] ?? 1.7, b[4] ?? 1.7), yaw: (a[5] ?? 0) + dy * k };
    }
    return cur;
  }
  // where a player appears in an arena: the base point (they are everybody's) farthest from the enemies
  function basePoint(p) {
    const A = fieldArena();
    const pts = A.bases.flat(), foes = [...players.values()].filter(q => q.alive && q !== p && !ally(p, q));
    let best = pts[0], bd = -1; for (const [x, z] of pts) { const d = foes.length ? Math.min(...foes.map(q => Math.hypot(q.x - x, q.z - z))) : Math.random() * 100; if (d > bd) { bd = d; best = [x, z]; } }
    const a = Math.random() * 6.283, r = 2 + Math.random() * 10, [x, z] = walkSpot(best[0] + Math.cos(a) * r, best[1] + Math.sin(a) * r);
    return [x, z, Math.atan2(A.cx - x, A.cz - z) + Math.PI];   // facing the middle of the arena
  }
  function areaPoint() { for (let k = 0; k < 30; k++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * (area.r - 20), x = area.cx + Math.cos(a) * r, z = area.cz + Math.sin(a) * r; if (world.walkable(x, z)) return [x, z, Math.random() * 6.283]; } return [area.cx, area.cz, 0]; }
  function spawn(p, x, z, yaw, exact) {   // exact: the point stands (the circle of the storm), not the arena base or the bot's own pick
    if (p.bot && p.bot.pilgrim && (!holy || p.bot.pilgrim !== holy.id)) p.bot.pilgrim = 0;   // the race is over: the pilgrim is a bot of the city again
    if (exact) { /* as given */ } else if (fieldArena()) [x, z, yaw] = basePoint(p); else if (p.bot) [x, z, yaw] = p.bot.pilgrim ? hillSpot(p) : areaPoint();   // a pilgrim of the race comes back by the hill
    p.x = num(x, HX); p.z = num(z, HY); p.y = p.bot ? world.ground(p.x, p.z) + 1.7 : 1.7; p.yaw = num(yaw, 10); p.pitch = 0; p.hp = R.hp; p.alive = true; p.protectUntil = now() + R.protectMs; p.t = now(); p.free = true; p.hist.length = 0; p.nades = NADE.count; p.smokes = SMOKE.count; p.napalms = NAPALM.count; p.eye = 1.7; p.fallTop = p.y; if (p.bot) { p.bot.vy = 0; p.bot.fallTop = 0; }
    p.mag = WEAPONS.map(w => w.mag); p.reserve = RESERVE.slice(); p.meds = 0; p.reloadDone = 0; p.lastMed = 0;
    refill(p, 'med'); refill(p, 'nade'); refill(p, 'smoke'); refill(p, 'napalm');   // the kits and grenades stored in the pack top the ready belt up at once
    send(p, { t: 'spawn', x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, nades: p.nades, smokes: p.smokes, napalms: p.napalms, mag: p.mag, reserve: p.reserve, meds: p.meds, sights: looseSights(p), attach: p.attach, loadout: p.loadout, pack: p.pack }); all({ t: 'alive', id: p.id });   // the pack, the sights and the loadout stay with the player through a death
  }
  // damage dmg from attacker p to v (weapon w; zone 1 head, 0 torso, 2 legs; from = where it came from): the hit and
  // the hurt messages, and the kill
  const r3 = a => a && [+a[0].toFixed(3), +a[1].toFixed(3), +a[2].toFixed(3)];
  function hurt(p, v, dmg, zone, w, from, bd, vf) {
    if (!v.alive || dmg <= 0) return; const t0 = now(), head = zone === 1;
    if (v.bot && p !== v) v.bot.hurtFrom = { x: p.x, z: p.z, at: t0, id: p.id };   // the bot turns on an attacker it cannot see (think in bots.mjs)
    v.hp -= dmg; if (p !== v) { const d = dmg + Math.min(0, v.hp); p.st.dmg += d; if (p.prof) p.prof.add('dmg', d); } send(v, { t: 'hurt', by: p.id, hp: Math.max(0, v.hp), dx: from[0] - v.x, dz: from[2] - v.z, bd: r3(bd), vf: vf == null ? undefined : +vf.toFixed(3), fall: w === W_FALL ? 1 : undefined, fire: w === W_FIRE ? 1 : undefined, storm: w === W_STORM ? 1 : undefined }); if (p !== v) send(p, { t: 'hit', id: v.id, head, zone, kill: v.hp <= 0, dmg: Math.min(dmg, dmg + Math.min(0, v.hp)) });
    if (v.hp > 0) return;
    v.alive = false; v.deaths++; v.diedAt = t0; v.streak = 0; if (v.prof) v.prof.add('deaths');
    if (stormFight()) {   // the storm keeps the order of the fallen: the dead man's place goes to his page, and he is out of the match
      storm.deaths.push({ id: v.id, at: t0 }); if (v.mkey) match.out.add(v.mkey);
      if (v.conn) send(v, { t: 'stormDead', place: [...players.values()].filter(q => q.alive).length + 1, total: players.size, by: p === v ? (w === W_STORM ? 'storm' : '') : p.name, w });
    }
    if (v.markUntil) { v.markUntil = 0; all({ t: 'unmark', id: v.id }); }   // the cargo mark dies with its carrier
    if (p !== v) { p.kills++; if (head) p.st.heads++; if (p.prof) { p.prof.add('kills'); if (head) p.prof.add('heads'); p.streak = (p.streak || 0) + 1; p.prof.max('best', p.streak); } }
    all({ t: 'kill', killer: p.id, victim: v.id, kn: p.name, vn: v.name, head, w, zone: bd ? zone : undefined, bd: r3(bd), vf: vf == null ? undefined : +vf.toFixed(3), dx: +(from[0] - v.x).toFixed(2), dz: +(from[2] - v.z).toFixed(2) }); sendBoard();   // dx/dz: where the blow came from; bd: the bullet's own way at the hit — the body falls along it (ragdoll.js)
    if (siegeFight() && v.siege) siegeDrop(v);   // send the kill before the spawn: the client must not mark a freshly spawned player dead again
    if (p !== v && p.kills >= WIN) endRound(p);
  }
  // a fall from above the safe height hurts (FALL): the client reports the height it landed from — it knows the true
  // ground (the fortress ramparts, the bridges), the server's raw lidar does not. The report is capped by the drop the
  // server saw itself in the state stream (fallTop, the highest point since the last landing), so a number out of thin
  // air cannot kill; the bots fall in think() and report here the same way
  function fall(p, h) {
    if (!p.alive || (MATCH && roundOver)) return;   // the match is decided: no hurt until the next one
    const seen = Math.max(0, (p.fallTop ?? p.y) - p.y + 1);   // +1 m: the eye lowers on a crouch
    p.fallTop = p.y;
    const hh = Math.min(FALL.maxH, Math.max(0, h), seen);
    if (hh > FALL.safe) hurt(p, p, Math.round((hh - FALL.safe) * FALL.k), 0, W_FALL, [p.x, p.y, p.z]);
  }
  // the smoke and the napalm go off into a zone lying on the surface under them (the ground, or the roof they reached);
  // the zone lives in `zones` until its time is out — the fire burns whoever stands in its cells (stepZones), the smoke hides
  // the street from the bots' eyes (bots.mjs; its shape at a moment is smokeCore of combat.mjs, by t0 and dur). The page
  // draws both from the 'zone' message (src/game/nades.js); a late joiner gets durMs and what is left in 'hello'.
  // The fire's patch is its cells (napalmCells of combat.mjs: spread over the surface, stopped by the walls), sent as
  // [dx, dy, dz, on, off] from the burst; a cell a smoke puts out gets an earlier off ('fireOut' to the page).
  const surfaceAt = (x, y, z) => { const g = world.ground(x, z), b = world.buildingAt(x, z, y); return b && y > g + (b.top || 12) - 0.6 ? g + (b.top || 12) : g; };
  const cellsMsg = z => z.cells.map(c => [+(c.x - z.x).toFixed(2), +(c.y - z.y).toFixed(2), +(c.z - z.z).toFixed(2), c.on, c.off]);
  const zoneMsg = z => ({ id: z.id, kind: z.kind, x: z.x, y: z.y, z: z.z, r: z.r, durMs: z.dur, by: z.kind === 'fire' ? z.by : undefined, cells: z.cells ? cellsMsg(z) : undefined });
  function layZone(n) {
    const K = n.kind === 'smoke' ? SMOKE : NAPALM, y = surfaceAt(n.p[0], n.p[1], n.p[2]);
    const t0 = now(), z = { id: n.id, kind: n.kind === 'smoke' ? 'smoke' : 'fire', x: n.p[0], y, z: n.p[2], r: K.radius, t0, dur: K.durMs, until: t0 + K.durMs, by: n.by, lastTick: 0 };
    if (z.kind === 'fire') {
      z.cells = napalmCells(world, z.x, y, z.z);
      z.dur = Math.max(...z.cells.map(c => c.off)); z.until = t0 + z.dur;
    }
    zones.set(z.id, z);
    all({ t: 'zone', ...zoneMsg(z) });
    douse(t0);   // a screen laid into a burning patch starts putting it out at once, a patch laid into a screen fizzles at once
  }
  // the smoke puts the fire out: a cell under a screen's dense core (smokeCore, as it stands now — it swells out of the
  // canister, so a smoke thrown into the fire quenches it from the canister outward) goes out in douseMs and never
  // lights again; a cell not lit yet does not light. The patch ends when its last cell is out.
  function douse(t) {
    const cores = [];
    for (const s of zones.values()) if (s.kind === 'smoke') { const c = smokeCore(s.r, t - s.t0, s.dur); if (c) cores.push({ x: s.x, y: s.y, z: s.z, rc: c.rc, hc: c.hc }); }
    if (!cores.length) return;
    for (const z of zones.values()) {
      if (z.kind !== 'fire' || !z.cells) continue;
      const age = t - z.t0, out = [];
      z.cells.forEach((c, i) => {
        if (c.off <= age + NAPALM.douseMs) return;   // out already, or going out
        if (!cores.some(k => c.y > k.y - 1 && c.y < k.y + k.hc && Math.hypot(c.x - k.x, c.z - k.z) < k.rc + 0.3)) return;
        c.off = age < c.on ? c.on : Math.round(age + NAPALM.douseMs); out.push([i, c.off]);
      });
      if (!out.length) continue;
      z.dur = Math.max(...z.cells.map(c => c.off)); z.until = z.t0 + z.dur;
      all({ t: 'fireOut', id: z.id, cells: out });
    }
  }
  let lastDouse = 0;
  function stepZones() {
    const t = now();
    if (t - lastDouse >= NAPALM.tickMs) { lastDouse = t; douse(t); }
    for (const z of [...zones.values()]) {
      if (t >= z.until) { zones.delete(z.id); all({ t: 'zoneEnd', id: z.id }); continue; }
      if (z.kind !== 'fire' || roundOver || t - z.lastTick < NAPALM.tickMs) continue;
      z.lastTick = t;
      const thrower = players.get(z.by); if (!thrower) continue;
      const age = t - z.t0;
      for (const v of players.values()) {
        if (!v.alive) continue;
        if (ally(thrower, v)) continue;   // teammates walk through their own napalm unburnt
        if (v !== thrower && t <= v.protectUntil) continue;
        if (Math.hypot(v.x - z.x, v.z - z.z) >= z.r + NAPALM.cellR) continue;
        if (fireUnder(z.cells, age, v.x, v.y - v.eye, v.z) < NAPALM.hot) continue;   // the feet in a burning cell, on its surface, not above it
        hurt(thrower, v, Math.round(NAPALM.dps * NAPALM.tickMs / 1000), 0, W_FIRE, [z.x, z.y + 0.3, z.z]);
      }
    }
  }
  function explode(n) {
    nades.delete(n.id);
    if (n.kind === 'smoke' || n.kind === 'napalm') { layZone(n); return; }
    all({ t: 'boom', id: n.id, x: n.p[0], y: n.p[1], z: n.p[2] });
    if (roundOver) return; const thrower = players.get(n.by);
    const blocked = (o, pt) => { const bx = pt[0] - o[0], by = pt[1] - o[1], bz = pt[2] - o[2], l = Math.hypot(bx, by, bz); return l > 0.6 && world.freePath(o, [bx / l, by / l, bz / l], l) < l - 0.7; };
    for (const v of players.values()) {
      if (!v.alive || !thrower) continue; if (ally(thrower, v)) continue;   // the own side (the own team in the free-for-all) is spared
      const c = [v.x, v.y - 0.41 * v.eye, v.z], o = [n.p[0], n.p[1] + 0.3, n.p[2]], dx = c[0] - o[0], dy = c[1] - o[1], dz = c[2] - o[2], d = Math.hypot(dx, dy, dz);
      if (d >= NADE.radius || (v !== thrower && now() <= v.protectUntil)) continue;
      // two rays, chest and head: a corner that hides one leaves the other half the blow; only both closed is a bunker
      const cover = (blocked(o, c) ? 1 : 0) + (blocked(o, [v.x, v.y - HIT.headDrop, v.z]) ? 1 : 0);
      if (cover === 2) continue;
      const k = (1 - d / NADE.radius) * (cover ? 0.5 : 1), self = v === thrower ? NADE.self : 1;
      hurt(thrower, v, Math.round(NADE.dmg * k * self), 0, W_NADE, n.p);
      if (!v.alive) continue;   // the dead stay where they fell
      // the blast throws too: a velocity away from the blast, fading with the damage, plus a kick up (NADE.push).
      // The player's client adds it to the jump and a decaying slide ('push'), a bot slides here on the server.
      // Right at the blast the direction is undefined — throw up and aside at random.
      let ux, uy, uz;
      if (d < 0.5) { const a = Math.random() * 6.283, l = Math.hypot(1, 0.8); ux = Math.cos(a) / l; uz = Math.sin(a) / l; uy = 0.8 / l; }
      else { ux = dx / d; uy = dy / d; uz = dz / d; }
      const s = NADE.push * k * self, vx = ux * s, vz = uz * s, vy = Math.max(0, uy) * s + NADE.pushUp * k * self;
      if (v.bot) { v.bot.kx += vx; v.bot.kz += vz; v.bot.vy = (v.bot.vy || 0) + vy; }
      else send(v, { t: 'push', vx: +vx.toFixed(2), vy: +vy.toFixed(2), vz: +vz.toFixed(2) });
    }
  }
  // ---- the inventory: the server keeps the magazines and the reserve; a reload takes time and fills from the reserve ----
  const invMsg = p => send(p, { t: 'inv', mag: p.mag, reserve: p.reserve, nades: p.nades, smokes: p.smokes, napalms: p.napalms, meds: p.meds, sights: looseSights(p), attach: p.attach, loadout: p.loadout, pack: p.pack });
  // the sights ride in the backpack until mounted: the loose count the panel shows is what the pack holds
  const looseSights = p => ({ sight: p.pack.filter(k => k === 'sight').length, optic: p.pack.filter(k => k === 'optic').length });
  // the ready belt (med kits, grenades of each kind) refills from the pack as it is spent, up to the cap of its kind
  const beltOf = { med: ['meds', INV.medMax], nade: ['nades', INV.nadeMax], smoke: ['smokes', INV.nadeMax], napalm: ['napalms', INV.nadeMax] };
  function refill(p, kind) {
    const [field, cap] = beltOf[kind];
    let n = p[field];
    for (let i = 0; i < p.pack.length && n < cap; i++) if (p.pack[i] === kind) { p.pack[i] = null; n++; }
    p[field] = n;
  }
  // ---- the loadout: two equipped guns (loadout) and a backpack of 30 cells (pack). A weapon index lives in exactly one
  // place. A human swaps a pack cell with a loadout slot ('swap'); a bot equips a gun by pulling it into a slot (equip).
  const held = (p, w) => p.loadout.includes(w);
  function swapWeapon(p, w, slot) {
    if (!p.alive || !okWeapon(w) || slot !== 0 && slot !== 1) return false;
    const pi = p.pack.indexOf(w);
    if (pi < 0 || held(p, w)) return false;   // the gun must ride in the pack, not already be equipped
    const old = p.loadout[slot];
    p.loadout[slot] = w; p.pack[pi] = old;   // the old gun takes the pack cell the new one left
    invMsg(p); return true;
  }
  // make sure w is equipped (for bots, which may fight with any of the guns they own): if it is in the pack, pull it
  // into slot 0; the gun that was there drops into the pack cell w left. Returns the slot w now occupies, or -1.
  function equip(p, w) {
    if (held(p, w)) return p.loadout.indexOf(w);
    const pi = p.pack.indexOf(w); if (pi < 0) return -1;
    const slot = 0, old = p.loadout[slot];
    p.loadout[slot] = w; p.pack[pi] = old; return slot;
  }
  // mounting a sight from the backpack on a weapon (kind null takes it off): the pack cell the sight rode in is freed —
  // the old mounted sight, if any, takes that cell back (a swap needs no extra room); taking off needs a free cell of
  // its own, and a full pack refuses it
  function setSight(p, wi, kind) {
    if (!p.alive || kind === p.attach[wi]) return;
    if (p.conn && !held(p, wi)) return;   // a human mounts only on an equipped gun
    if (kind) {
      const pi = p.pack.indexOf(kind);
      if (pi < 0) return;   // no such sight in the backpack
      p.pack[pi] = p.attach[wi];   // the freed cell takes the old sight (null when there was none)
      p.attach[wi] = kind;
    } else {
      const fi = p.pack.indexOf(null);
      if (fi < 0) { if (p.conn) send(p, { t: 'chat', text: 'Рюкзак полон — прицел некуда снять' }); return; }
      p.pack[fi] = p.attach[wi]; p.attach[wi] = null;
    }
    invMsg(p); all({ t: 'attach', id: p.id, attach: p.attach });
  }
  function beginReload(p, wi, t0) {
    if (!p.alive || p.reloadDone > t0 || p.mag[wi] >= WEAPONS[wi].mag || p.reserve[wi] <= 0) return false;
    if (p.conn && !held(p, wi)) return false;   // a human reloads only an equipped gun
    p.reloadDone = t0 + RELOAD_MS[wi] * reloadMul(p); p.reloadW = wi; return true;
  }
  function useMed(p, t0) {
    if (!p.alive || p.meds <= 0 || p.hp >= R.hp || t0 - p.lastMed < INV.medGapMs) return false;
    p.lastMed = t0; p.meds--; p.hp = Math.min(R.hp, p.hp + ITEMS.med.heal);
    refill(p, 'med');   // a stored kit takes the spent one's place on the belt
    send(p, { t: 'heal', hp: p.hp, meds: p.meds }); invMsg(p); return true;
  }
  // ---- the bullets in the air: a shot is no longer applied at the click, it flies. Each pellet is a projectile stepped
  // forward in game time (advanceBullets, called by the 30 Hz clock and before every new shot). The geometry of the hit is
  // frozen at the click — every living enemy as the shooter saw them then (poseAt rewound by the shooter's lag), the same
  // lag compensation the instant shot used — so “shoot where you see” holds; but the damage and the report land only when
  // the bullet gets there. The path is the ballistic arc of combat.mjs (bulletAt/bulletDir): gravity pulls the bullet down
  // ½·g·t² while it flies, so a 400 m sniper shot sinks ~1.17 m and needs holdover. Each substep tests the body along the
  // arc's tangent at its start (over one 60 Hz substep the arc bends less than 2 mm — well inside HIT.grace). A wall or the
  // ground (freePath along the same arc at the muzzle) ends the flight. Pellets of one shot that hit the same body are
  // summed and reported once (the shotgun reads as one blow).
  function advanceBullets(to) {
    if (!bullets.size) return;
    const touched = new Set();
    for (const b of [...bullets.values()]) {
      const shooter = players.get(b.by);
      if (!shooter) { bullets.delete(b.bid); b.shot.pending--; touched.add(b.shot); continue; }   // the shooter left: the bullet dies with him
      const W = WEAPONS[b.w];
      let t = b.last, dist = b.dist, gone = false;
      while (t < to - 1e-4 && !gone) {   // the 1e-4 ms slack eats the float residual of the last substep, so it is not mistaken for the wall
        const nt = Math.min(to, t + 1000 / 60), seg = flightSeg(b, dist, (nt - t) / 1000), reach = Math.min(seg, b.max - dist);
        if (reach <= 1e-6) { gone = true; break; }
        const o = bulletAt(b.o, b.d, dist, b.speed, b.k), dir = bulletDir(b.d, dist, b.speed, b.k);   // where the arc is now, and the way it goes
        let best = null;
        if (!roundOver) {
          for (const { v, pose } of b.shot.poses) {   // the poses the shooter saw at the click, frozen
            if (!v.alive || nt <= v.protectUntil) continue;
            const h = rayHit(o, dir, reach + HIT.grace, pose);
            if (h && h.t <= reach + HIT.grace && (!best || h.t < best.t)) best = { t: Math.min(h.t, reach), zone: h.zone, v };
          }
          for (const n of nades.values()) {   // a grenade in the air can be shot down: the bullet detonates it where they meet
            const ta = (t - b.nadeLag - n.simT) / 1000, tb = (nt - b.nadeLag - n.simT) / 1000;   // rewound by the shooter's lag and swept over the substep
            const a = [n.p[0] + n.v[0] * ta, n.p[1] + n.v[1] * ta, n.p[2] + n.v[2] * ta];
            const c = [n.p[0] + n.v[0] * tb, n.p[1] + n.v[1] * tb, n.p[2] + n.v[2] * tb];
            const h = rayToSegment(o, dir, reach + HIT.grace, a, c);
            if (h.dist <= NADE.hitR && h.t <= reach + HIT.grace && (!best || h.t < best.t)) best = { t: Math.min(h.t, reach), nade: n };
          }
        }
        if (best && best.nade) {
          const total = dist + best.t, at = bulletAt(b.o, b.d, total, b.speed, b.k), s = b.shot;
          if (!s.hit) { s.hit = true; shooter.st.hitShots++; if (shooter.prof) shooter.prof.add('hits'); }
          all({ t: 'nshot', bid: b.bid, by: b.by, id: best.nade.id, d: +total.toFixed(2), at });   // the page cuts the tracer here and strikes sparks
          send(shooter, { t: 'hit', id: 0, head: false, zone: 0, kill: false, dmg: 0, nade: true });   // the shooter's hitmarker: the grenade is down
          best.nade.p = [at[0], at[1], at[2]];
          explode(best.nade);   // the blast stays the thrower's: the bullet only lit the fuse early
          gone = true;
        } else if (best) {
          const total = dist + best.t;
          let f = 1; for (const w of b.walls) if (w.at <= total + 1e-6) f = w.f;   // the walls punched before this body
          const vf = Math.exp(-b.k * total) * f;   // the speed fraction left: the air and the stone; damage goes as its square
          const dmg = (best.zone === 1 ? W.head : best.zone === 2 ? W.dmg * HIT.legMul : W.dmg) * vf * vf * dmgMul(shooter);
          const at = bulletAt(b.o, b.d, total, b.speed, b.k), bd = bulletDir(b.d, total, b.speed, b.k), s = b.shot;
          if (!s.hit) { s.hit = true; shooter.st.hitShots++; if (shooter.prof) shooter.prof.add('hits'); }
          const h = s.hits.get(best.v.id) || { v: best.v, dmg: 0, head: false, zone: 0, top: 0, bd: null, vf: 1 };
          h.dmg += dmg; h.head = h.head || best.zone === 1; if (dmg > h.top) { h.top = dmg; h.zone = best.zone; h.bd = bd; h.vf = vf; } s.hits.set(best.v.id, h);
          all({ t: 'bhit', bid: b.bid, by: b.by, d: +total.toFixed(2), v: best.v.id, zone: best.zone, at, bd: [+bd[0].toFixed(3), +bd[1].toFixed(3), +bd[2].toFixed(3)], vf: +vf.toFixed(3) });   // the page cuts the tracer here, shows the blood and flinches the body along bd
          gone = true;
        } else { dist += seg; if (dist >= b.max) gone = true; }
        t = nt;
      }
      if (gone) { b.shot.pending--; touched.add(b.shot); bullets.delete(b.bid); } else { b.last = to; b.dist = dist; }
    }
    for (const s of touched) if (s.pending <= 0 && s.hits.size) {   // every pellet of the shot has landed: report the summed blow
      const shooter = players.get(s.by);
      if (shooter) for (const { v, dmg, zone, bd, vf } of s.hits.values()) hurt(shooter, v, Math.round(dmg), zone, s.w, s.o, bd, vf);
      s.hits.clear();
    }
  }
  // a shot of p with weapon wi: rays [[dx, dy, dz], ...] (the page no longer claims a hit — the bullet judges for itself);
  // lagMs: how far back the targets are looked at along the flight (0 for a bot). The ray leaves the barrel, MUZZLE along
  // the view, not the eye: a wall nearer than that rests the muzzle on it and the shot dies at the face. The 'shot'
  // message carries the eye, the wall distance from the barrel and a bullet id per ray so the page can fly its tracer
  // from the muzzle and cut it at the body when 'bhit' comes.
  function shoot(p, wi, rays, lagMs) {
    const W = WEAPONS[wi], t0 = now(); if (!Array.isArray(rays) || !rays.length || !p.alive) return;
    if (MATCH && roundOver) return;   // the guns are cold after the storm, until the next match
    if (siege && siege.phase === 'prep' && p.siege) return;   // the dome's minutes: the guns are cold
    if (p.conn && !held(p, wi)) return;   // a human fires only an equipped gun
    if (t0 - p.lastShot < W.gapMs * rateMul(p)) return;
    if (t0 < p.reloadDone) return;   // still reloading
    if (p.mag[wi] <= 0) { if (p.bot) beginReload(p, wi, t0); return; }   // a bot reloads by itself; a player asks with 'reload'
    p.mag[wi]--; p.lastShot = t0;
    advanceBullets(t0);   // land the bullets already in the air before loosing new ones
    const eye = [p.x, p.y, p.z], out = [];
    // every living enemy as the shooter saw them at the click (lag-compensated), frozen for the whole flight: the page
    // aims at the same past, and a claim that drifted (lag, a crouch) must not cost a hit that was really there
    const foes = roundOver ? [] : [...players.values()].filter(v => v !== p && v.alive && !ally(p, v) && t0 > v.protectUntil);
    const shot = { by: p.id, w: wi, o: eye, hit: false, hits: new Map(), pending: 0, poses: foes.map(v => ({ v, pose: poseAt(v, t0 - lagMs) })) };
    for (const ray of rays.slice(0, W.pellets)) {   // a rifle shot is one ray, a shotgun shot is up to eight pellets
      if (!Array.isArray(ray)) continue;
      const d = [num(ray[0], 1), num(ray[1], 1), num(ray[2], 1)], l = Math.hypot(...d); if (l < 0.5) continue; d.forEach((x, i) => d[i] = x / l);
      const sp = world.shotPath(eye, d, W.range, W.vel || 560, W.drag || 0, W.pen || 0);   // the wall along the falling arc, thin walls punched by the budget; pressed to a wall the barrel rests on it, the flight is zero
      const wallEye = sp.dist, mz = Math.min(MUZZLE, wallEye);
      const o = [eye[0] + d[0] * mz, eye[1] + d[1] * mz, eye[2] + d[2] * mz], wall = wallEye - mz, bid = nextBid++;
      const walls = sp.walls.map(w => ({ at: w.at - mz, f: w.f }));   // the exit faces from the barrel, and the speed left after each
      // the grenade's copy on the page flies without the interpolation buffer the bodies have, so it is seen a whole rtt
      // in the past: lagMs is 120 + rtt/2, and 2·(lagMs − 120) gives that rtt back (0 for a bot, which sees the live world)
      const nadeLag = lagMs > 0 ? Math.min(600, Math.max(0, 2 * (lagMs - 120))) : 0;
      bullets.set(bid, { bid, by: p.id, w: wi, o, d, speed: W.vel || 560, k: W.drag || 0, walls, last: t0, dist: 0, max: wall, shot, nadeLag });
      shot.pending++;
      out.push([+d[0].toFixed(4), +d[1].toFixed(4), +d[2].toFixed(4), +wall.toFixed(1), bid]);
    }
    if (!out.length) return;
    p.st.shots++; if (p.prof) p.prof.add('shots');
    all({ t: 'shot', id: p.id, w: wi, o: eye, rays: out });
  }
  function throwNade(p, u, sp = NADE.speed, kind = 'nade') {
    if (!NADE_KINDS.includes(kind)) kind = 'nade';
    const [field] = beltOf[kind], t0 = now();
    if (!p.alive || p[field] <= 0 || t0 - p.lastNade < NADE.cooldownMs || roundOver || (siege && siege.phase === 'prep' && p.siege)) return;
    p[field]--; p.lastNade = t0; refill(p, kind); invMsg(p);   // a stored grenade takes the thrown one's place on the belt
    sp = Math.max(NADE.minSpeed, Math.min(NADE.maxSpeed, sp)); const id = nextNade++;   // the charged throw: the client sends the speed it gathered holding the mouse
    const fuse = kind === 'smoke' ? SMOKE.fuseMs : kind === 'napalm' ? NAPALM.fuseMs : NADE.fuseMs;
    const n = { id, by: p.id, kind, p: [p.x + u[0] * 0.6, p.y - 0.2 + u[1] * 0.6, p.z + u[2] * 0.6], v: [u[0] * sp, u[1] * sp + NADE.loft * sp, u[2] * sp], t: t0 + fuse, simT: t0 };
    nades.set(id, n); all({ t: 'nade', id, by: p.id, kind, p: n.p, v: n.v, fuse });
  }
  // the end of a round: the table of the round goes to everybody, ten seconds later the scores are cleared and the next round starts
  function endRound(winner) {
    if (holy) endHoly(now(), null, 'round');   // the race steps aside for the round's end
    if (siege) endSiege(now(), null, 'round');   // the siege steps aside too
    roundOver = true;
    for (const p of players.values()) if (p.prof) { p.prof.add('rounds'); if (p === winner) p.prof.add('wins'); }
    const rows = [...players.values()].map(p => ({ id: p.id, name: p.name, tag: p.clan ? p.clan.tag : undefined, kills: p.kills, deaths: p.deaths, heads: p.st.heads, dmg: Math.round(p.st.dmg), acc: p.st.shots ? Math.round(100 * p.st.hitShots / p.st.shots) : 0 }));
    rows.sort((a, b) => b.kills - a.kills || b.dmg - a.dmg || a.deaths - b.deaths);
    all({ t: 'win', mode: MODE, name: winner.name, rows, mvp: rows.length ? rows[0].id : 0, nextMs: 10000 });
    timers.push(setTimeout(() => { for (const p of players.values()) { p.kills = p.deaths = 0; p.st = { shots: 0, hitShots: 0, dmg: 0, heads: 0 }; if (p.markUntil) { p.markUntil = 0; all({ t: 'unmark', id: p.id }); } } roundOver = false; sendBoard(); all({ t: 'round' }); all({ t: 'chat', text: 'Новый раунд' }); for (const it of items.values()) { it.active = true; it.respawnAt = 0; all(itemMsg(it)); } for (const z of zones.values()) all({ t: 'zoneEnd', id: z.id }); zones.clear(); if (cargo) { all({ t: 'cargoEnd', id: cargo.id }); cargo = null; } nextCargoAt = now() + CARGO.firstMs; }, 10000));
  }
  // ---- the match (storm.mjs): two hours by the wall clock — the day of the game. The fight with respawns; the door open
  // for the first half hour (a reload or a dropped connection of one who already plays in it gets back in later); the
  // «Шторм» of the last twenty minutes: the circle that begins beyond the whole field and shrinks to a random point of
  // open ground, the burn outside, one life, the last one standing wins. The victory table stands until the next match;
  // at its start everybody still here is back on his feet with the scores cleared. The cycle is clock-driven
  // (tickMatch every 500 ms), so a restart of the server keeps the schedule.
  let match = null, storm = null;
  // the «Царь горы» event (HOLY, combat.mjs): Church Hill is called for a few minutes — four bell-tower altars, a buff
  // per taken temple, the grand prize for holding all. Nobody is carried there: the field stays as it was
  let holy = null, nextHolyAt = now() + HOLY.firstMs, holySeq = 1, areaRev = 0, holyWarned = false;
  let siege = null, siegeSeq = 1, nextSiegeAt = now() + SIEGE.firstMs, siegeWarned = false;   // the «Штурм Динабурга» event (SIEGE, combat.mjs)
  const fieldArena = () => arena;   // the arena in force: the chosen one, or none (the open city)
  const HILL_AREA = HOLY.hill;   // the field of the bots sent to the race (the pilgrims): the hill and its slopes
  const onHill = p => !!(p && p.bot && p.bot.pilgrim && Math.hypot(p.x - HILL_AREA.cx, p.z - HILL_AREA.cz) < HILL_AREA.r);   // a pilgrim on the hill fights there until he is brought home
  const arenaPub = a => a && { name: a.name, cx: a.cx, cz: a.cz, r: a.r, bases: a.bases };
  const bootAt = now();
  const fmtMin = ms => { const m = Math.round(ms / 60000); return m >= 60 && m % 60 === 0 ? m / 60 + ' ч' : m + ' мин'; };
  const fmtSpan = ms => ms < 60000 ? Math.round(ms / 1000) + ' с' : fmtMin(ms);   // an event's span in the chat: seconds under a minute
  const evOn = kind => !opts.events || opts.events.enabled(kind);   // the event's auto-run: the admin panel can pause the schedule (events.mjs)
  const stormFight = () => !!storm && (storm.phase === 'play' || storm.phase === 'sudden');
  const SIEGE_AREA = { name: 'Динабургская крепость', cx: SIEGE.cx, cz: SIEGE.cz, r: SIEGE.r };   // the field of the siege: the fortress and its approaches
  const siegeFight = () => !!siege && (siege.phase === 'prep' || siege.phase === 'assault');   // the dome is up or the assault runs
  const siegeCounts = () => { const c = { a: 0, d: 0 }; for (const p of players.values()) if (p.siege) c[p.siege]++; return c; };
  const stormAlive = () => [...players.values()].filter(p => p.alive);
  // the storm and the race are fought by units: a team of the players is one, everybody else is his own
  const unitOf = p => (p.clan ? 'c' + p.clan.id : 'p' + p.id);
  const units = list => new Set(list.map(unitOf)).size;
  const joinUntil = () => Math.max(match.joinUntil, bootAt + MATCH.grace);   // a restart opens the door for a few minutes: the players it dropped come back
  function matchPublic() {
    if (!match) return null;
    const t = now(), ju = joinUntil();
    return { n: match.n, phase: !storm ? 'fight' : storm.phase === 'end' ? 'over' : 'storm', len: match.len, left: Math.max(0, match.end - t), stormIn: Math.max(0, match.stormAt - t), stormMs: match.stormMs, joinLeft: Math.max(0, ju - t), joinMs: match.joinUntil - match.start, open: t < ju };
  }
  const broadcastMatch = () => all({ t: 'match', ...matchPublic() });
  function stormPublic() {
    if (!storm) return null;
    const t = now(), roundLeft = storm.phase === 'play' ? Math.max(0, storm.suddenAt + storm.suddenMs - t) : storm.phase === 'sudden' ? Math.max(0, storm.t1 - t) : 0;
    return { phase: storm.phase, pi: storm.pi, stages: storm.plan.length, kind: storm.kind, left: Math.max(0, storm.t1 - t), roundLeft, t0: storm.t0, t1: storm.t1, from: storm.from, to: storm.to, cur: storm.cur, dps: storm.dps, final: storm.final, alive: stormAlive().length, total: players.size, cycle: match.n };
  }
  const broadcastStorm = () => all({ t: 'storm', ...(stormPublic() || { phase: 'off' }) });   // 'off': the new match, the page takes the storm down
  function stormSpawnPoint() {   // a walkable spot inside the current circle: the late join appears in the fight, facing its middle
    const c = storm.cur;
    for (let k = 0; k < 40; k++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * Math.max(6, c.r * 0.8), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (world.walkable(x, z)) return [x, z, Math.atan2(c.x - x, c.z - z) + Math.PI]; }
    const [x, z] = walkSpot(c.x, c.z); return [x, z, Math.random() * 6.283];
  }
  function startMatch(s) {
    const first = !match;
    match = { ...s, roster: new Set(), out: new Set(), warned: new Set(), lastBeat: now(), closedSaid: false };   // roster: the keys that play this match; out: the keys the storm took
    storm = null; roundOver = false;
    if (first) return;   // the server's first match: nobody to bring back yet
    nades.clear(); bullets.clear();
    for (const z of zones.values()) all({ t: 'zoneEnd', id: z.id }); zones.clear();
    if (cargo) { all({ t: 'cargoEnd', id: cargo.id }); cargo = null; } nextCargoAt = now() + CARGO.firstMs;
    if (holy) { holy = null; all({ t: 'holyEnd', reason: 'match', arena: arenaPub(arena) }); } nextHolyAt = now() + HOLY.firstMs; holyWarned = false;
    if (siege) endSiege(now(), null, 'match'); nextSiegeAt = now() + SIEGE.firstMs; siegeWarned = false;
    for (const it of items.values()) { it.active = true; it.respawnAt = 0; all(itemMsg(it)); }
    for (const p of players.values()) {
      p.kills = p.deaths = 0; p.streak = 0; p.st = { shots: 0, hitShots: 0, dmg: 0, heads: 0 };
      if (p.markUntil) { p.markUntil = 0; all({ t: 'unmark', id: p.id }); }
      if (p.mkey) match.roster.add(p.mkey);   // whoever is here plays the new match: a reload brings him back after the door closes
      const [x, z, yaw] = besideMate(p, q => q.matchSeat === match.n) || areaPoint(); spawn(p, x, z, yaw); p.matchSeat = match.n;   // a team gathers in one place
    }
    sendBoard(); all({ t: 'round' }); broadcastStorm(); broadcastMatch();
    all({ t: 'chat', text: 'Новый раунд: ' + fmtMin(match.len) + ', вход открыт ' + fmtMin(match.joinUntil - match.start) + ', в конце — шторм на ' + fmtMin(match.stormMs) });
  }
  function startStorm(t) {
    const f = stormField(arena, HX, HY), final = pickFinal(world, f.fin), k = match.stormMs / STORMC.windowMs, plan = stormPlan(f.c, final, match.stormAt, undefined, f.r0, k), last = plan[plan.length - 1];
    storm = { phase: 'play', pi: 0, kind: 'hold', lastKind: 'hold', plan, final, k, suddenAt: last.tEnd, suddenMs: Math.round(STORMC.suddenMs * k), playStart: t, t0: plan[0].t0, t1: plan[0].tEnd, from: plan[0].from, to: plan[0].to, cur: { ...plan[0].from }, dps: plan[0].dps, deaths: [], lastTick: t, lastBeat: t, units0: 0 };
    // the fallen of the fight stand up for the storm: from here everybody has one life
    for (const p of players.values()) if (!p.alive) { if (p.bot) spawn(p); else { const [x, z] = walkSpot(p.x, p.z); spawn(p, x, z, p.yaw); } }
    storm.units0 = units(stormAlive());
    all({ t: 'chat', text: '⚡ Шторм! Последние ' + fmtMin(match.stormMs) + ' раунда: одна жизнь, зона сужается к случайной точке — последний выживший побеждает' });
    broadcastStorm(); broadcastMatch();
  }
  function endStorm() {
    const t = now(), alive = stormAlive(), dead = [...players.values()].filter(p => !p.alive).sort((a, b) => b.diedAt - a.diedAt);
    const order = [...alive, ...dead], winner = order[0] || null;   // the last fallen is the last survivor when the storm takes everybody
    const won = p => !!winner && unitOf(p) === unitOf(winner);   // the winner's whole team wins, the fallen members too
    const place = new Map(order.map((p, i) => [p.id, i + 1]));
    Object.assign(storm, { phase: 'end', kind: 'hold', t0: t, t1: match.end, dps: 0 });
    roundOver = true;
    const contest = storm.units0 >= 2;   // a win needs somebody to win against: alone (or one team alone) nobody takes a win
    for (const p of players.values()) if (p.prof) { p.prof.add('rounds'); if (contest && won(p)) p.prof.add('wins'); }
    const rows = order.map(p => ({ id: p.id, name: p.name, tag: p.clan ? p.clan.tag : undefined, kills: p.kills, deaths: p.deaths, heads: p.st.heads, dmg: Math.round(p.st.dmg), acc: p.st.shots ? Math.round(100 * p.st.hitShots / p.st.shots) : 0, place: place.get(p.id), alive: p.alive }));
    const squad = winner && winner.clan && [...players.values()].filter(won).length > 1 ? winner.clan : null;   // a team of the players won together
    const name = !winner ? 'Шторм' : squad ? '[' + squad.tag + '] ' + squad.name : winner.name;
    all({ t: 'win', mode: 'storm', name, clan: squad ? squad.id : undefined, rows, mvp: winner ? winner.id : 0, nextMs: Math.max(0, match.end - t) });
    all({ t: 'chat', text: !winner ? 'Шторм завершён: выживших нет' : squad ? 'Раунд завершён: победила команда [' + squad.tag + '] ' + squad.name + ' — последние выжившие' : 'Раунд завершён: победил ' + winner.name + ' — последний выживший' });
    broadcastStorm(); broadcastMatch();
  }
  function tickStorm(t) {
    if (storm.phase === 'end') return;
    if (storm.phase === 'play') {
      const plan = storm.plan;
      while (storm.pi < plan.length && t >= plan[storm.pi].tEnd) storm.pi++;
      if (storm.pi >= plan.length) {   // the stages are out: the last circle closes to nothing
        storm.cur = { ...plan[plan.length - 1].to };
        Object.assign(storm, { phase: 'sudden', kind: 'shrink', from: { ...storm.cur }, to: { x: storm.final.x, z: storm.final.z, r: 0 }, t0: storm.suddenAt, t1: storm.suddenAt + storm.suddenMs, dps: STORMC.suddenDps });
        all({ t: 'chat', text: 'Шторм: финал — зона исчезает!' }); broadcastStorm();
      } else {
        const ph = plan[storm.pi];
        storm.kind = t < ph.tShrink ? 'hold' : 'shrink';
        storm.t0 = ph.t0; storm.t1 = ph.tEnd; storm.from = ph.from; storm.to = ph.to; storm.dps = ph.dps;
        storm.cur = stageCircle(ph, t);
        if (storm.kind !== storm.lastKind) { storm.lastKind = storm.kind; if (storm.kind === 'shrink') all({ t: 'chat', text: 'Шторм: зона сужается — бегите в круг!' }); broadcastStorm(); }
      }
    }
    if (storm.phase === 'sudden') {
      const k = Math.max(0, Math.min(1, (t - storm.t0) / storm.suddenMs));
      storm.cur = { x: storm.from.x + (storm.to.x - storm.from.x) * k, z: storm.from.z + (storm.to.z - storm.from.z) * k, r: storm.from.r * (1 - k) };
    }
    if (t - storm.lastTick >= STORMC.tickMs) {   // the burn outside, twice a second — the napalm's own rhythm (stepZones)
      storm.lastTick = t; const c = storm.cur, dmg = Math.max(1, Math.round(storm.dps * STORMC.tickMs / 1000));
      for (const v of players.values()) {
        if (!v.alive || t <= v.protectUntil) continue;
        if (Math.hypot(v.x - c.x, v.z - c.z) < c.r) continue;
        hurt(v, v, dmg, 0, W_STORM, [c.x, v.y, c.z]);
      }
    }
    if (t - storm.lastBeat >= 2000) { storm.lastBeat = t; broadcastStorm(); }
    if (t > storm.playStart + 5000 && units(stormAlive()) <= 1) endStorm();   // the last survivor (the last team standing) takes the match
  }
  function tickMatch() {
    const t = now(), s = matchAt(t, MATCH.len, MATCH.off);
    if (!match || s.n !== match.n) startMatch(s);
    if (!storm) {
      for (const w of MATCHC.warnMs) if (!match.warned.has(w) && t < match.stormAt && t >= match.stormAt - w && match.stormAt - w > match.start) {
        match.warned.add(w); all({ t: 'chat', text: '⚡ Шторм через ' + fmtMin(w) + ': последние ' + fmtMin(match.stormMs) + ' раунда — одна жизнь, зона сужается' }); broadcastMatch();
      }
      if (t >= match.stormAt) { if (holy) endHoly(t, null, 'storm'); if (siege) endSiege(t, null, 'storm'); startStorm(t); }
    }
    if (storm) tickStorm(t);
    if (!match.closedSaid && t >= joinUntil()) { match.closedSaid = true; all({ t: 'chat', text: 'Вход в раунд закрыт: новые игроки — в следующем' }); broadcastMatch(); }
    if (t - match.lastBeat >= 10000) { match.lastBeat = t; broadcastMatch(); }
  }
  // ---- bots
  const enemyBase = () => { const A = fieldArena(); if (!A) return null; const pts = A.bases.flat(); return pts[Math.floor(Math.random() * pts.length)]; };   // any base point: the spawns are everybody's
  const brain = createBrain({ players, now, world, get area() { return siegeFight() ? SIEGE_AREA : (fieldArena() || area); }, areaOf: p => (siegeFight() ? SIEGE_AREA : fieldArena() || (onHill(p) ? HILL_AREA : area)), get field() { return !fieldArena(); }, get areaRev() { return areaRev; }, WEAPONS, R, shoot, throwNade, spawn, fall, roundOver: () => roundOver, enemyBase, reload: beginReload, equip, get items() { return items; }, get zones() { return zones; }, get cargo() { return cargo; }, get holy() { return holy; }, holyUnit: p => unitOf(p), speedMul: p => speedMul(p), ally: (a, b) => ally(a, b), get siege() { return siegeFight() ? siege : null; }, get dome() { return siege && siege.phase === 'prep' ? { cx: SIEGE.cx, cz: SIEGE.cz, r: SIEGE.domeR } : null; }, get storm() { return stormFight() ? { ...storm.cur, next: storm.phase === 'play' ? storm.to : null } : null; } });   // the safe circle and the next one: the bots roam towards where the storm is going   // items and cargo are declared below: getters read them once the game is built; storm: the safe circle the bots run into
  let botN = 0;
  function addBot(level) {
    if (players.size >= MAX) return null;
    const p = newPlayer(); let nm = botName(botN++); while ([...players.values()].some(q => q.name === nm)) nm = botName(botN++); p.name = nm; p.char = botChar(); p.joined = true; p.joinedAt = now(); brain.make(level || opts.level, p); players.set(p.id, p);
    spawn(p);
    if (siegeFight()) { const c = siegeCounts(); p.siege = c.a <= c.d ? 'a' : 'd'; siegeTeleport(p); }   // a bot added mid-siege joins the smaller side at once
    sendBoard(); all({ t: 'chat', text: p.name + ' в игре' }); return p;
  }
  function removeBot() { const b = [...players.values()].reverse().find(p => p.bot); if (!b) return false; players.delete(b.id); all({ t: 'left', id: b.id }); sendBoard(); return true; }
  // the admin panel (admin.mjs): a player is put out of the fight (a bot simply goes), and the server says a line to everybody
  function kick(id, why) {
    const p = players.get(+id); if (!p) return false;
    if (p.bot) { players.delete(p.id); all({ t: 'left', id: p.id }); sendBoard(); return true; }
    all({ t: 'chat', text: p.name + ' исключён администратором' + (why ? ': ' + String(why).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80) : '') });
    if (p.conn) p.conn.close();   // the close of the connection takes him out (handle.close below)
    return true;
  }
  function say(text) {
    const s = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!s) return false;
    all({ t: 'chat', text: s }); return true;
  }
  // ---- messages of a player
  function attach(conn) {
    const p = newPlayer(); p.conn = conn;
    const handle = {
      get joined() { return p.joined; }, get player() { return p; },
      close() { if (p.joined && players.delete(p.id)) { all({ t: 'left', id: p.id }); sendBoard(); all({ t: 'chat', text: p.name + ' вышел' }); } },
      message(raw) {
        const t0 = now(); if (t0 - p.win > 1000) { p.win = t0; p.msgs = 0; }
        let m; try { m = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw)); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t !== 'rtc' && ++p.msgs > 90) return;   // the handshake of the voice chat has its own, larger limit
        if (m.t === 'join' && !p.joined) {
          const who = acc ? acc.byKey(m.key) : null;
          if (acc && !who) { send(p, { t: 'auth-required' }); conn.close(); return; }   // an account is mandatory: the key must belong to an account of this server
          if (players.size >= MAX && !removeBot()) { send(p, { t: 'full' }); conn.close(); return; }
          const mkey = MATCH && validKey(m.key) ? m.key : '', out = !!mkey && stormFight() && match.out.has(mkey);
          if (MATCH && (out || (now() >= joinUntil() && !match.roster.has(mkey)))) { send(p, { t: 'closed', out: out ? 1 : undefined, ...matchPublic() }); conn.close(); return; }   // the door of the match: its first half hour; later only who plays in it comes back — not the one the storm took
          p.mkey = mkey; if (mkey) match.roster.add(mkey);
          if (lb && m.board !== false && validKey(m.key) && ![...players.values()].some(q => q.key === m.key)) { p.key = m.key; const r = lb.identify(m.key, nameBase(m.name), n => !taken(n)); p.name = r.name; p.prof = r.prof; } else p.name = cleanName(m.name);
          p.acct = who ? who.name : ''; p.clan = clanOf(p);
          p.char = cleanChar(m.char); p.joined = true; p.joinedAt = t0; players.set(p.id, p);
          send(p, { t: 'hello', mode: MODE, id: p.id, server: NAME, srv: opts.id || 1, name: p.name, win: WIN, clan: p.clan || undefined, now: now(), arena: arenaPub(fieldArena()), holy: holyPublic() || undefined, siege: siegePublic() || undefined, mySide: p.siege || undefined, rules: { hp: R.hp, range: R.range }, day: dayNow() || undefined, board: board(), items: [...items.values()].filter(i => i.active).map(i => ({ id: i.id, kind: i.kind, x: i.x, z: i.z })), zones: [...zones.values()].map(z => ({ ...zoneMsg(z), left: Math.max(0, z.until - now()) })), cargo: cargoMsg(), marks: marks(), attach: Object.fromEntries([...players.values()].map(q => [q.id, q.attach])), match: matchPublic() || undefined, storm: stormPublic() || undefined });
          const mate = besideMate(p);   // a team appears together: next to a living teammate (in an arena the base decides)
          if (stormFight()) { const [sx, sz, syaw] = mate || stormSpawnPoint(); spawn(p, sx, sz, syaw, true); }   // a join in the storm appears inside the circle
          else if (mate && !fieldArena()) spawn(p, mate[0], mate[1], mate[2]); else spawn(p, m.x, m.z, m.yaw);
          sendBoard(); all({ t: 'chat', text: (p.clan ? '[' + p.clan.tag + '] ' : '') + p.name + (stormFight() ? ' в шторме' : ' в игре') });
          return;
        }
        if (!p.joined) return;
        if (m.t === 'state' && p.alive) {
          const dt = Math.max(0.02, Math.min(0.5, (t0 - p.t) / 1000)); p.t = t0;
          const x = num(m.x, HX), z = num(m.z, HY), y = Math.max(-50, Math.min(400, num(m.y, 400)));
          const FA = siegeFight() && p.siege ? SIEGE_AREA : fieldArena();   // the siege keeps its own fighters within the fortress field
          if (FA && Math.hypot(x - FA.cx, z - FA.cz) > FA.r) { send(p, { t: 'correct', x: p.x, y: p.y, z: p.z, out: true }); return; }   // beyond the edge of the arena
          if (siege && siege.phase === 'prep') {   // the dome lets nobody across, in or out — the bystanders too
            const d0 = Math.hypot(p.x - SIEGE.cx, p.z - SIEGE.cz), d1 = Math.hypot(x - SIEGE.cx, z - SIEGE.cz);
            if ((d0 < SIEGE.domeR) !== (d1 < SIEGE.domeR)) { send(p, { t: 'correct', x: p.x, y: p.y, z: p.z, dome: true }); return; }
          }
          const far = Math.hypot(x - p.x, z - p.z), first = p.free && far < 80; p.free = false;   // right after a spawn the client may nudge itself off a wall or out of the water
          if (!first && far > R.runSpeed * speedMul(p) * dt * 1.6 + 3) send(p, { t: 'correct', x: p.x, y: p.y, z: p.z });   // too fast: put back
          else { p.x = x; p.z = z; p.y = y; }
          p.fallTop = Math.max(p.fallTop ?? p.y, p.y);   // the highest point since the last landing: the fall report is capped by it
          p.yaw = num(m.yaw, 100); p.pitch = num(m.pitch, 1.6); p.eye = Math.max(0.9, Math.min(1.8, num(m.h, 1.8) || 1.7)); p.wep = okWeapon(m.w) && held(p, m.w) ? m.w : p.loadout[0];   // the gun in hand must be one of the two equipped
          p.hist.push([t0, p.x, p.y, p.z, p.eye, p.yaw]); while (p.hist.length > 2 && t0 - p.hist[0][0] > 1000) p.hist.shift();
        } else if (m.t === 'shoot' && p.alive) shoot(p, okWeapon(m.w) && held(p, m.w) ? m.w : p.loadout[0], m.rays, 120 + Math.min(300, p.rtt / 2));
        else if (m.t === 'throw') { const d = [num(m.dx, 1), num(m.dy, 1), num(m.dz, 1)], l = Math.hypot(...d); if (l >= 0.5) throwNade(p, d.map(x => x / l), m.sp == null ? NADE.speed : num(m.sp, NADE.maxSpeed), m.kind); }
        else if (m.t === 'reload' && p.alive) beginReload(p, okWeapon(m.w) ? m.w : p.wep, t0);
        else if (m.t === 'use' && m.kind === 'med') useMed(p, t0);
        else if (m.t === 'ready' && p.alive && beltOf[m.kind]) {   // a stored item takes a free place on the ready belt
          const [field, cap] = beltOf[m.kind], pi = p.pack.indexOf(m.kind);
          if (pi >= 0 && p[field] < cap) { p.pack[pi] = null; p[field]++; invMsg(p); }
        }
        else if (m.t === 'fall' && p.alive) fall(p, num(m.h, FALL.maxH));   // the client landed from a height: the damage is the server's
        else if (m.t === 'attach') setSight(p, okWeapon(m.w) ? m.w : p.wep, m.kind === 'sight' || m.kind === 'optic' ? m.kind : null);
        else if (m.t === 'swap' && p.alive) swapWeapon(p, m.w, m.slot);   // exchange a backpack gun with an equipped slot
        else if (m.t === 'siegeJoin') {   // the registration of the siege: a side by hand, the balance keeps the sides even
          if (!siege || siege.phase !== 'reg') { send(p, { t: 'siegeDeny', reason: 'closed' }); return; }
          const side = m.side === 'a' || m.side === 'd' ? m.side : null;
          if (side) { const c = siegeCounts(); if (c[side] - c[side === 'a' ? 'd' : 'a'] >= SIEGE.balance) { send(p, { t: 'siegeDeny', reason: 'balance' }); return; } }
          p.siege = side; send(p, { t: 'siegeYou', side }); all({ t: 'siege', ...siegePublic() });
        }
        else if (m.t === 'chat') {
          const text = String(m.text || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
          if (!text || t0 - p.lastChat < 700) return; p.lastChat = t0;
          const say = { t: 'say', id: p.id, name: p.name, tag: p.clan ? p.clan.tag : undefined, text, teamOnly: !!m.team };
          if (m.team && p.clan) { for (const q of players.values()) if (q === p || ally(p, q)) send(q, say); } else all(say);   // the team chat: the own team of the players (without a team the line goes to everybody)
        } else if (m.t === 'rtc') {   // voice chat: the game only passes the WebRTC handshake between two players
          const q = players.get(+m.to); if (!q || q === p || q.bot || !m.d || typeof m.d !== 'object') return;
          if (t0 - p.rwin > 1000) { p.rwin = t0; p.rmsgs = 0; } if (++p.rmsgs > 400) return;
          send(q, { t: 'rtc', from: p.id, d: m.d });
        } else if (m.t === 'ping') { p.rtt = Math.max(0, Math.min(1000, num(m.rtt, 1000))); send(p, { t: 'pong', c: m.c });
        } else if (m.t === 'respawn' && !p.alive && !stormFight() && t0 - p.diedAt >= R.respawnMs) {   // the storm does not respawn: one life, the dead watch the end of the match
          const mates = m.mate ? [...players.values()].filter(q => q.alive && ally(p, q)) : [], own = mates.filter(q => sameClan(p, q)), mate = own.length ? own : mates;   // the own team first
          if (m.hill && holy && p.holyIn === holy.id && !hillOut()) { const [x, z, yaw] = hillSpot(p); spawn(p, x, z, yaw, true); }   // enlisted in the race: back beside the hill
          else if (mate.length) { const q = mate[Math.floor(Math.random() * mate.length)], a = Math.random() * 6.283, r = 6 + Math.random() * 8; spawn(p, q.x + Math.cos(a) * r, q.z + Math.sin(a) * r, q.yaw); }   // next to a teammate
          else spawn(p, m.x, m.z, m.yaw);
        }
      },
    };
    return handle;
  }
  // ---- the items on the map: ammo, grenades, med kits and the two sights; picked up by walking over, back after a while ----
  const items = new Map(); let nextItem = 1;
  function itemSpots() {
    const spots = [], N = opts.itemCount || INV.itemCount;
    const add = (x, z) => { if (Number.isFinite(x) && Number.isFinite(z) && world.walkable(x, z) && !spots.some(s => Math.hypot(s[0] - x, s[1] - z) < 18)) spots.push([x, z]); };
    if (arena) {
      for (const b of arena.bases) for (const [bx, bz] of b) { const a = Math.random() * 6.283, r = 6 + Math.random() * 12; add(bx + Math.cos(a) * r, bz + Math.sin(a) * r); }
      for (let k = 0; spots.length < N && k < 300; k++) { const a = Math.random() * 6.283, r = arena.r * (0.2 + Math.random() * 0.65); add(arena.cx + Math.cos(a) * r, arena.cz + Math.sin(a) * r); }
    } else for (let k = 0; spots.length < N && k < 400; k++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * (area.r - 25); add(area.cx + Math.cos(a) * r, area.cz + Math.sin(a) * r); }
    return spots;
  }
  const itemMsg = it => ({ t: 'item', id: it.id, kind: it.kind, x: it.x, z: it.z });
  itemSpots().forEach(([x, z], i) => { const it = { id: nextItem++, kind: ['ammo', 'nade', 'med', 'ammo', 'sight', 'optic', 'smoke', 'napalm'][i % 8], x, z, active: true, respawnAt: 0 }; items.set(it.id, it); });
  function tickItems(t) {
    for (const it of items.values()) {
      if (!it.active) { if (t >= it.respawnAt) { it.active = true; all(itemMsg(it)); } continue; }
      for (const p of players.values()) {
        if (!p.alive || Math.hypot(p.x - it.x, p.z - it.z) > INV.pickR) continue;
        let got = false;   // 'belt' — straight to the ready belt, 'pack' — stored in a free backpack cell
        if (it.kind === 'ammo') { for (let i = 0; i < WEAPONS.length; i++) { const add = Math.min(ITEMS.ammo.give[i], RESERVE[i] * INV.reserveCap - p.reserve[i]); if (add > 0) { p.reserve[i] += add; got = 'belt'; } } }
        else if (it.kind === 'med') { if (p.meds < INV.medMax) { p.meds++; got = 'belt'; } else { const fi = p.pack.indexOf(null); if (fi >= 0) { p.pack[fi] = 'med'; got = 'pack'; } } }
        else if (beltOf[it.kind]) { const [field, cap] = beltOf[it.kind]; if (p[field] < cap) { p[field]++; got = 'belt'; } else { const fi = p.pack.indexOf(null); if (fi >= 0) { p.pack[fi] = it.kind; got = 'pack'; } } }
        else if (it.kind === 'sight' || it.kind === 'optic') { const owned = p.pack.filter(k => k === it.kind).length + p.attach.filter(a => a === it.kind).length; if (owned < INV[it.kind + 'Max']) { const fi = p.pack.indexOf(null); if (fi >= 0) { p.pack[fi] = it.kind; got = 'pack'; } } }
        if (!got) continue;   // the belt and the pack are full: the item stays for someone else
        it.active = false; it.respawnAt = t + ITEMS[it.kind].respawnMs;
        all({ t: 'took', id: it.id, kind: it.kind, to: p.id, where: got === 'pack' ? 'pack' : undefined });
        if (p.conn) invMsg(p);
        if (p.bot) for (const k of ['sight', 'optic']) if (p.pack.includes(k)) setSight(p, p.wep, k);   // a bot mounts what it picked, on the weapon in hand
        break;
      }
    }
    for (const p of players.values()) {
      if (p.bot && p.alive && p.hp < 45 && p.meds > 0) useMed(p, t);   // a bot heals itself when hurt and having a kit
      if (p.reloadDone && t >= p.reloadDone) {   // the reload is over: fill the magazine from the reserve
        const wi = p.reloadW, k = Math.min(WEAPONS[wi].mag - p.mag[wi], p.reserve[wi]);
        p.mag[wi] += k; p.reserve[wi] -= k; p.reloadDone = 0;
        if (p.conn) invMsg(p);
      }
    }
  }
  timers.push(setInterval(() => tickItems(now()), 100));
  // ---- the cargo event: a supply crate parachutes into an open spot, a smoke beacon marks the landing, the loot goes
  // to whoever reaches it first — and that one is marked for everyone for a minute (CARGO, combat.mjs). The bait is the
  // fight around the crate: the bots converge on it too (bots.mjs) and hunt the marked carrier afterwards.
  let cargo = null, nextCargoAt = now() + CARGO.firstMs, cargoSeq = 1;
  const marks = () => [...players.values()].filter(p => p.markUntil > now()).map(p => ({ id: p.id, until: p.markUntil }));
  const cargoMsg = () => cargo && { id: cargo.id, x: cargo.x, z: cargo.z, y0: cargo.y0, gy: cargo.gy, t0: cargo.t0, landAt: cargo.landAt, speed: CARGO.speed, state: cargo.state, until: cargo.until };
  // an open spot: walkable ground with nothing overhead (no roof, no canopy) and not right under someone's feet —
  // the race to the crate is the point, so it lands at least 25 m from every living player
  function cargoSpot() {
    for (let k = 0; k < 80; k++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * (area.r - 30), x = area.cx + Math.cos(a) * r, z = area.cz + Math.sin(a) * r;
      if (!world.walkable(x, z) || world.buildingAt(x, z, 200)) continue;
      if ([...players.values()].some(p => p.alive && Math.hypot(p.x - x, p.z - z) < 25)) continue;
      return [x, z];
    }
    const [x, z] = areaPoint(); return [x, z];
  }
  function dropCargo() {
    const [x, z] = cargoSpot(), gy = world.ground(x, z), t0 = now();
    cargo = { id: cargoSeq++, x, z, gy, y0: gy + CARGO.alt, t0, landAt: t0 + CARGO.alt / CARGO.speed * 1000, state: 'fall', until: 0, zoneId: 0, tookBy: 0, tookName: '' };
    all({ t: 'cargo', ...cargoMsg() });
    all({ t: 'chat', text: '📦 Груз сброшен с парашютом — ищите дым-маяк' });
  }
  // the loot into the belt and the pack (the pickup rules of tickItems): what was given, empty when all is full
  function cargoLoot(p) {
    const got = [];
    for (let i = 0; i < WEAPONS.length; i++) { const add = Math.min(ITEMS.ammo.give[i], RESERVE[i] * INV.reserveCap - p.reserve[i]); if (add > 0) { p.reserve[i] += add; got.push('ammo'); } }
    for (const [kind, n] of CARGO.loot) for (let k = 0; k < n; k++) {
      if (kind === 'sight' || kind === 'optic') {
        const owned = p.pack.filter(x => x === kind).length + p.attach.filter(a => a === kind).length;
        if (owned >= INV[kind + 'Max']) continue;
        const fi = p.pack.indexOf(null); if (fi < 0) continue;
        p.pack[fi] = kind; got.push(kind);
      } else {
        const [field, cap] = beltOf[kind];
        if (p[field] < cap) { p[field]++; got.push(kind); }
        else { const fi = p.pack.indexOf(null); if (fi < 0) continue; p.pack[fi] = kind; got.push(kind); }
      }
    }
    return got;
  }
  function cargoGone(t, why) {
    if (!cargo) return;
    if (cargo.zoneId) { zones.delete(cargo.zoneId); all({ t: 'zoneEnd', id: cargo.zoneId }); }
    all({ t: why === 'took' ? 'cargoTook' : 'cargoEnd', id: cargo.id, to: cargo.tookBy || undefined, name: cargo.tookName || undefined });
    if (why === 'admin') all({ t: 'chat', text: '📦 Груз убран администратором' });
    cargo = null; nextCargoAt = t + CARGO.gapMs;
  }
  function stepCargo(t) {
    for (const p of players.values()) if (p.markUntil && t >= p.markUntil) { p.markUntil = 0; all({ t: 'unmark', id: p.id }); }
    if (roundOver) return;
    if (!cargo) { if (evOn('cargo') && t >= nextCargoAt && players.size && !storm && !holy && !siege) dropCargo(); return; }   // the storm, the race and the siege run their own fight: no new crate while they hold the field
    if (cargo.state === 'fall') {
      if (t < cargo.landAt) return;
      cargo.state = 'landed'; cargo.until = t + CARGO.groundMs;
      const z = { id: nextNade++, kind: 'beacon', x: cargo.x, y: cargo.gy, z: cargo.z, r: CARGO.beaconR, until: cargo.until, by: 0, lastTick: 0 };
      cargo.zoneId = z.id; zones.set(z.id, z);
      all({ t: 'zone', id: z.id, kind: 'beacon', x: z.x, y: z.y, z: z.z, r: z.r, durMs: CARGO.groundMs });
      all({ t: 'cargoLand', id: cargo.id });
      all({ t: 'chat', text: '📦 Груз приземлился — дым-маяк виден издалека' });
      return;
    }
    if (t >= cargo.until) { cargoGone(t, 'end'); all({ t: 'chat', text: 'Груз исчез — никто не забрал' }); return; }
    for (const p of players.values()) {
      if (!p.alive || Math.hypot(p.x - cargo.x, p.z - cargo.z) > CARGO.pickR) continue;
      if (Math.abs((p.y - p.eye) - cargo.gy) > 3) continue;   // on the ground next to the crate, not flying over it
      const got = cargoLoot(p);
      if (!got.length) continue;   // the belt and the pack are full: the crate stays for someone else
      cargo.tookBy = p.id; cargo.tookName = p.name;
      p.markUntil = t + CARGO.markMs;
      if (p.bot) for (const k of ['sight', 'optic']) if (p.pack.includes(k)) setSight(p, p.wep, k);   // a bot mounts the rare sight at once
      if (p.conn) invMsg(p);
      all({ t: 'marked', id: p.id, until: p.markUntil, name: p.name });
      cargoGone(t, 'took');
      all({ t: 'chat', text: '🎯 ' + p.name + ' забрал груз — теперь он мишень для всех (' + Math.round(CARGO.markMs / 1000) + ' с)' });
      sendBoard();
      return;
    }
  }
  timers.push(setInterval(() => stepCargo(now()), 200));
  // ---- the «Царь горы» event (HOLY, combat.mjs): the four temples of Church Hill become capture points. Nobody is
  // carried there: the field stays as it was, and the players make their own way to the beams over the hill. A taken
  // temple rings its bell across the city and grants its buff to the holding side; all four held three minutes win the
  // grand prize. The first altar a player takes enlists him (p.holyIn): after a death he may come back beside the hill.
  // Part of the bots (HOLY.hill.pilgrims) go there too: each is brought to the hill unseen or on his next respawn, and
  // home the same way after the race (bots.mjs fights within the hill while he is there). The page draws the altars,
  // the beams, the bells and the HUD (src/game/holy.js).
  const holyBuffs = p => {
    if (!holy) return null;
    const u = unitOf(p); let b = null;
    for (const pt of holy.points) if (pt.owner === u) (b = b || {})[HOLY.temples[pt.i].buff] = true;
    return b;
  };
  function dmgMul(p) { return holyBuffs(p)?.dmg ? HOLY.buffs.dmg : 1; }
  function speedMul(p) { return holyBuffs(p)?.speed ? HOLY.buffs.speed : 1; }
  function reloadMul(p) { return holyBuffs(p)?.reload ? HOLY.buffs.reload : 1; }
  function rateMul(p) { return holyBuffs(p)?.reload ? HOLY.buffs.rate : 1; }
  const plural = u => String(u).startsWith('c');   // a team of the players: «захватили», one player alone: «захватил»
  const sideName = u => {
    const p = [...players.values()].find(q => unitOf(q) === u);
    return p ? (p.clan ? p.clan.name : p.name) : u;
  };
  const holyPublic = () => {
    if (!holy) return null;
    const t = now(), H = HOLY.hill;
    return {
      id: holy.id, t0: holy.t0, until: holy.until, left: Math.max(0, holy.until - t), capMs: HOLY.capMs, capR: HOLY.capR, holdMs: HOLY.holdMs, buffs: { ...HOLY.buffs }, buffName: { ...HOLY.buffName },
      points: holy.points.map(pt => ({ i: pt.i, x: pt.x, z: pt.z, gy: pt.gy, owner: pt.owner, name: pt.name, prog: +pt.prog.toFixed(3), progSide: pt.progSide, ringAt: pt.ringAt, contest: pt.contest || undefined })),
      hold: holy.holdSide ? { side: holy.holdSide, name: sideName(holy.holdSide), left: Math.max(0, holy.holdStart + HOLY.holdMs - t) } : null,
      hill: { name: H.name, cx: H.cx, cz: H.cz, r: H.r },
    };
  };
  const hillOut = () => !!arena && Math.hypot(arena.cx - HOLY.hill.cx, arena.cz - HOLY.hill.cz) > arena.r - 40;   // an arena that leaves the hill out has no way there
  // the feet of p in the ring of the altar pt: on the ground by the temple, not flying over it
  const inRing = (p, pt) => p.alive && Math.hypot(p.x - pt.x, p.z - pt.z) <= HOLY.capR && Math.abs((p.y - p.eye) - pt.gy) <= 4;
  // where the race's own come back: a walkable spot in the ring round the middle of the hill, clear of the altars, the
  // farthest of a few from the foes — the fight is near, not on the spawn. Facing the middle
  function hillSpot(p) {
    const H = HOLY.hill, foes = p ? [...players.values()].filter(q => q.alive && q !== p && !ally(p, q)) : [];
    let best = null, bd = -1;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * 6.283, r = H.spawn[0] + Math.random() * (H.spawn[1] - H.spawn[0]), x = H.cx + Math.cos(a) * r, z = H.cz + Math.sin(a) * r;
      if (!world.walkable(x, z) || HOLY.temples.some(tp => Math.hypot(tp.x - x, tp.z - z) < HOLY.capR + 15)) continue;
      const d = foes.length ? Math.min(...foes.map(q => Math.hypot(q.x - x, q.z - z))) : Math.random() * 100;
      if (d > bd) { bd = d; best = [x, z]; }
      if (best && k >= 12) break;
    }
    const [x, z] = best || walkSpot(H.cx, H.cz);
    return [x, z, Math.atan2(H.cx - x, H.cz - z) + Math.PI];
  }
  function startHoly(t) {
    if (holy) return 'active';
    if (siege) return 'siege';
    if (storm) return 'storm';
    if (roundOver) return 'round';
    if (!players.size) return 'no-players';
    if (hillOut()) return 'arena';
    if (cargo) cargoGone(t, 'end');   // the crate steps aside: the bells are the fight now
    holy = { id: holySeq++, t0: t, until: t + HOLY.durMs, lastStep: t, lastBeat: t, holdSide: null, holdStart: 0,
      points: HOLY.temples.map((tp, i) => ({ i, x: tp.x, z: tp.z, gy: world.ground(tp.x, tp.z), owner: null, name: '', prog: 0, progSide: null, ringAt: 0 })) };
    // the pilgrims: a share of the bots goes to the hill, the rest keep the city
    const bots = [...players.values()].filter(p => p.bot && !p.siege);
    for (let i = bots.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bots[i], bots[j]] = [bots[j], bots[i]]; }
    const nPil = Math.round(bots.length * HOLY.hill.pilgrims);
    bots.forEach((p, i) => { if (i < nPil) p.bot.pilgrim = holy.id; });
    all({ t: 'holy', ...holyPublic() });
    all({ t: 'chat', text: '🔔 Царь горы на Церковной горке! Доберитесь туда сами — по лучам над храмами. Захватите четыре алтаря-колокольни и удержите все ' + fmtSpan(HOLY.holdMs) + ' — главный приз, хватит и одного игрока' });
    return 'ok';
  }
  // the first altar taken enlists the player in the race: from now on a death may bring him back beside the hill
  function enlist(p) {
    if (!holy || p.bot || p.holyIn === holy.id) return;
    p.holyIn = holy.id;
    send(p, { t: 'holyIn', id: holy.id });
  }
  function capture(pt, side, byName, t) {
    pt.owner = side.u; pt.name = side.name; pt.prog = 1; pt.progSide = side.u; pt.ringAt = t;
    for (const p of players.values()) if (unitOf(p) === side.u && inRing(p, pt)) enlist(p);   // whoever stood in the ring for his side
    all({ t: 'bell', i: pt.i, side: side.u, name: side.name, by: byName });
    all({ t: 'chat', text: '🔔 ' + side.name + (plural(side.u) ? ' захватили ' : ' захватил ') + HOLY.temples[pt.i].name + ' — ' + HOLY.buffName[HOLY.temples[pt.i].buff] });
  }
  function holyPrize(u, t) {
    const winners = [...players.values()].filter(p => unitOf(p) === u);
    for (const p of winners) {
      p.kills += HOLY.prizeKills;
      p.hp = R.hp; p.nades = NADE.count; p.smokes = SMOKE.count; p.napalms = NAPALM.count; p.meds = INV.medMax; p.reserve = RESERVE.slice(); p.mag = WEAPONS.map(w => w.mag); p.reloadDone = 0;
      if (!p.alive) { const [x, z, yaw] = hillSpot(p); spawn(p, x, z, yaw, true); }   // the fallen of the winning side stand up on the hill for the prize
      else { send(p, { t: 'heal', hp: p.hp, meds: p.meds, quiet: 1 }); invMsg(p); }
    }
    all({ t: 'holyWin', side: u, name: sideName(u) });
    all({ t: 'chat', text: '🏆 ' + sideName(u) + (plural(u) ? ' удержали все храмы ' + fmtSpan(HOLY.holdMs) + ' — главный приз! +' + HOLY.prizeKills + ' очков каждому, все живы и снаряжены' : ' удержал все храмы ' + fmtSpan(HOLY.holdMs) + ' в одиночку — главный приз! +' + HOLY.prizeKills + ' очков, полное здоровье и снаряжение') });
    sendBoard();
    endHoly(t, u, 'win');
    for (const p of winners) if (p.kills >= WIN) { endRound(p); break; }
  }
  function endHoly(t, winner, reason) {
    if (!holy) return;
    holy = null; holyWarned = false;
    nextHolyAt = t + HOLY.gapMs;
    for (const p of players.values()) p.holyIn = 0;   // nobody is carried anywhere: the players stay where the race left them
    all({ t: 'holyEnd', reason, winner: winner || undefined, arena: arenaPub(arena) });
    if (reason === 'time') all({ t: 'chat', text: 'Царь горы завершён — никто не удержал все храмы' });
    else if (reason === 'storm') all({ t: 'chat', text: 'Царь горы прерван штормом' });
    else if (reason === 'admin') all({ t: 'chat', text: 'Царь горы остановлен администратором' });
  }
  // the pilgrim bots: once a second those still away are brought where they belong — to the hill during the race, home
  // to the city after it — but only unseen: no player near where the bot stands nor where he appears. The rest get
  // there on their next respawn (spawn above). Their brains drop the old way and the old foe
  let pilgrimsAt = 0;
  const unseen = (x, z, r) => ![...players.values()].some(q => !q.bot && q.joined && Math.hypot(q.x - x, q.z - z) < r);
  function stepPilgrims(t) {
    if (t - pilgrimsAt < 1000 || stormFight() || siegeFight()) return;
    pilgrimsAt = t;
    const H = HOLY.hill;
    for (const p of players.values()) {
      if (!p.bot || !p.bot.pilgrim || !p.alive) continue;
      const there = Math.hypot(p.x - H.cx, p.z - H.cz) < H.r, wanted = !!holy && p.bot.pilgrim === holy.id;
      if (!wanted && !there) { p.bot.pilgrim = 0; continue; }   // a pilgrim of a past race already in the city
      if (wanted === there || !unseen(p.x, p.z, 160)) continue;
      const [x, z, yaw] = wanted ? hillSpot(p) : areaPoint();
      if (!unseen(x, z, 200)) continue;
      if (!wanted) p.bot.pilgrim = 0;
      spawn(p, x, z, yaw, true);
      const b = p.bot; b.path = null; b.target = 0; b.cover = null; b.alertCover = null; b.lastSeen = null; b.alert = null; b.hurtFrom = null;
    }
  }
  function stepHoly(t) {
    if (roundOver) return;
    stepPilgrims(t);
    if (!holy) {
      if (!evOn('holy') || hillOut()) { holyWarned = false; return; }   // the schedule is paused by the admin panel, or the arena has no hill
      if (!holyWarned && t >= nextHolyAt - HOLY.warnMs && t < nextHolyAt && players.size && !storm && !siege) { holyWarned = true; all({ t: 'chat', text: '⛪ Царь горы через ' + fmtSpan(HOLY.warnMs) + ' на Церковной горке — выдвигайтесь заранее, туда никого не переносят' }); }
      if (t >= nextHolyAt && players.size && !storm && !cargo && !siege) startHoly(t);
      return;
    }
    const dt = Math.max(0, Math.min(1, (t - holy.lastStep) / 1000)); holy.lastStep = t;
    for (const pt of holy.points) {
      const sides = new Map();
      for (const p of players.values()) {
        if (!inRing(p, pt)) continue;
        const u = unitOf(p);
        if (!sides.has(u)) sides.set(u, { u, name: p.clan ? p.clan.name : p.name, by: p.name });
      }
      // one side alone in the ring: an altar of another is first drained to nothing (it falls neutral, its buff with it),
      // then filled for the newcomer; the holder standing in his own ring brings a drained bar back. Two sides or more
      // stall it; left alone, the bar of a holder comes back by itself and the half-filled bar of nobody fades
      const rate = dt * 1000 / HOLY.capMs;
      pt.contest = sides.size > 1;
      if (sides.size === 1) {
        const s = [...sides.values()][0];
        if (pt.owner === s.u) { pt.prog = Math.min(1, pt.prog + rate); pt.progSide = s.u; }
        else if (pt.progSide && pt.progSide !== s.u && pt.prog > 0) {
          pt.prog = Math.max(0, pt.prog - rate);
          if (pt.prog <= 0) { if (pt.owner) { all({ t: 'chat', text: '⛪ ' + HOLY.temples[pt.i].name + ': алтарь снят — ' + pt.name + (plural(pt.owner) ? ' его потеряли' : ' его потерял') }); pt.owner = null; pt.name = ''; } pt.progSide = s.u; }
        } else {
          pt.progSide = s.u; pt.prog = Math.min(1, pt.prog + rate);
          if (pt.prog >= 1) capture(pt, s, s.by, t);
        }
      } else if (!sides.size) {
        if (pt.owner) { pt.prog = Math.min(1, pt.prog + rate * 0.5); pt.progSide = pt.owner; }
        else pt.prog = Math.max(0, pt.prog - rate);
      }
    }
    // all four in one hand: the three-minute hold begins
    const owned = holy.points.every(pt => pt.owner), one = owned && new Set(holy.points.map(pt => pt.owner)).size === 1 ? holy.points[0].owner : null;
    if (one) {
      if (holy.holdSide !== one) { holy.holdSide = one; holy.holdStart = t; all({ t: 'chat', text: '⛪ ' + sideName(one) + (plural(one) ? ' держат' : ' держит') + ' все храмы — пошёл отсчёт ' + fmtSpan(HOLY.holdMs) + '!' }); all({ t: 'holy', ...holyPublic() }); holy.lastBeat = t; }
      else if (t - holy.holdStart >= HOLY.holdMs) { holyPrize(one, t); return; }
    } else if (holy.holdSide) { holy.holdSide = null; all({ t: 'chat', text: 'Удержание прервано — храмы снова врозь' }); all({ t: 'holy', ...holyPublic() }); holy.lastBeat = t; }
    // the catholic regen: a little health each tick to the living of the holding side
    for (const p of players.values()) {
      if (!p.alive || p.hp >= R.hp || !holyBuffs(p)?.regen) continue;
      p.regenAcc = (p.regenAcc || 0) + HOLY.buffs.regen * dt;
      if (p.regenAcc >= 1) { const add = Math.floor(p.regenAcc); p.regenAcc -= add; p.hp = Math.min(R.hp, p.hp + add); send(p, { t: 'heal', hp: p.hp, meds: p.meds, quiet: 1 }); }
    }
    if (t >= holy.until) { endHoly(t, null, 'time'); return; }
    if (t - holy.lastBeat >= 1000) { holy.lastBeat = t; all({ t: 'holy', ...holyPublic() }); }
  }
  timers.push(setInterval(() => stepHoly(now()), 200));
  // ---- the «Штурм Динабурга» event (SIEGE, combat.mjs): the reconstruction of the 1812 siege — Napoleon besieged the
  // fortress and never took it. Registration opens regMs ahead (the sides by hand, the balance keeps them within
  // SIEGE.balance); then the registered are teleported in — the garrison inside the walls, the attackers to the staging
  // ground south of them — and the dome goes up for prepMs: nobody crosses it, the guns are cold. Then it falls and the
  // assault runs durMs. The altar is the cannon fountain in the garden: the attackers hold its ring alone holdMs to win;
  // the garrison wins by holding out (the historical outcome) or by wiping the attackers. The fallen teleport back to
  // the city at once; the survivors of the winning side take the rare loot. The page draws the dome, the altar ring and
  // the HUD (src/game/siege.js); the bots fight for the altar too (bots.mjs).
  const siegePublic = () => {
    if (!siege) return null;
    const t = now();
    return {
      id: siege.id, phase: siege.phase, left: Math.max(0, siege.until - t), end: siege.end, t0: siege.t0,
      counts: siegeCounts(), prog: +siege.prog.toFixed(3), contest: siege.contest, holdMs: SIEGE.holdMs, capR: SIEGE.capR, balance: SIEGE.balance,
      names: { ...SIEGE.names }, altar: { x: SIEGE.altar.x, z: SIEGE.altar.z, gy: world.ground(SIEGE.altar.x, SIEGE.altar.z) },
      area: { cx: SIEGE.cx, cz: SIEGE.cz, r: SIEGE.r }, dome: siege.phase === 'prep' ? { cx: SIEGE.cx, cz: SIEGE.cz, r: SIEGE.domeR } : null,
    };
  };
  // where a participant appears: the garrison by the altar and round the fortress inside the dome, the attackers on the
  // staging ground outside it (the south annulus, the dry land side). The spot must keep its side of the dome
  function siegeSpot(side) {
    const inside = (x, z) => Math.hypot(x - SIEGE.cx, z - SIEGE.cz) < SIEGE.domeR - 6;
    const outside = (x, z) => { const d = Math.hypot(x - SIEGE.cx, z - SIEGE.cz); return d > SIEGE.domeR + 6 && d < SIEGE.r - 10; };
    const ok = side === 'd' ? inside : outside;
    // the staging ground: flat ground underfoot and an open sight towards the fortress — the dome must be seen, not a wall
    const open = (x, z) => {
      const g0 = world.ground(x, z);
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (Math.abs(world.ground(x + dx, z + dz) - g0) > 2) return false;
      const dx = SIEGE.cx - x, dz = SIEGE.cz - z, l = Math.hypot(dx, dz) || 1;
      return world.freePath([x, g0 + 1.6, z], [dx / l, 0, dz / l], 30) >= 29;
    };
    if (side === 'd' && Math.random() < 0.45) {   // near the altar: the garden is the heart of the defence
      for (let k = 0; k < 24; k++) { const a = Math.random() * 6.283, r = 5 + Math.random() * 40, x = SIEGE.altar.x + Math.cos(a) * r, z = SIEGE.altar.z + Math.sin(a) * r; if (world.walkable(x, z) && ok(x, z)) return [x, z]; }
    }
    for (let k = 0; k < 60; k++) {
      const a = side === 'd' ? Math.random() * 6.283 : -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const r = side === 'd' ? 50 + Math.sqrt(Math.random()) * (SIEGE.domeR - 90) : SIEGE.domeR + 18 + Math.random() * (SIEGE.r - SIEGE.domeR - 43);
      const x = SIEGE.cx + Math.cos(a) * r, z = SIEGE.cz + Math.sin(a) * r;
      if (world.walkable(x, z) && ok(x, z) && (side === 'd' || open(x, z))) return [x, z];
    }
    const [x, z] = side === 'd' ? walkSpot(SIEGE.altar.x + 18, SIEGE.altar.z) : walkSpot(SIEGE.cx, SIEGE.cz + SIEGE.domeR + 30);
    return ok(x, z) ? [x, z] : [SIEGE.cx, SIEGE.cz + (side === 'd' ? 60 : SIEGE.domeR + 30)];
  }
  function startSiege(t) {
    if (siege) return 'active';
    if (storm) return 'storm';
    if (holy) return 'holy';
    if (roundOver) return 'round';
    if (!players.size) return 'no-players';
    if (cargo) cargoGone(t, 'end');   // the crate steps aside: the fortress is the whole fight now
    siege = { id: siegeSeq++, phase: 'reg', t0: t, until: t + SIEGE.regMs, end: 0, prog: 0, contest: null, lastStep: t, lastBeat: t, a0: 0, d0: 0 };
    all({ t: 'siege', ...siegePublic() });
    all({ t: 'chat', text: '🏰 Штурм Динабурга: регистрация открыта на ' + fmtSpan(SIEGE.regMs) + ' — выберите сторону в панели наверху: штурмующие или гарнизон' });
    return 'ok';
  }
  function siegeTeleport(p) {
    p.siegeBack = [p.x, p.z, p.yaw];   // where the siege found him: he goes back there when it ends (or falls)
    const [x, z] = siegeSpot(p.siege);
    const yaw = p.siege === 'a' ? Math.atan2(x - SIEGE.cx, z - SIEGE.cz) : Math.atan2(SIEGE.cx - x, SIEGE.cz - z);   // the attackers face the fortress, the garrison faces out
    spawn(p, x, z, yaw, true);
  }
  function startPrep(t) {
    for (const p of players.values()) if (p.bot) { const c = siegeCounts(); p.siege = c.a <= c.d ? 'a' : 'd'; }   // the bots even the sides out
    for (const p of players.values()) if (p.siege) siegeTeleport(p);   // the registered appear in one place, each side its own
    siege.phase = 'prep'; siege.t0 = t; siege.until = t + SIEGE.prepMs; siege.lastStep = t; areaRev++;
    all({ t: 'siege', ...siegePublic() });
    all({ t: 'chat', text: '🛡 Гарнизон занимает крепость, штурмующие — исходные позиции: защитный купол поднят на ' + fmtSpan(SIEGE.prepMs) + ', оружие на замке' });
  }
  function startAssault(t) {
    siege.phase = 'assault'; siege.t0 = t; siege.until = t + SIEGE.durMs; siege.end = siege.until; siege.prog = 0; siege.contest = null; siege.lastStep = t;
    const c = siegeCounts(); siege.a0 = c.a; siege.d0 = c.d;
    all({ t: 'siege', ...siegePublic() });
    all({ t: 'chat', text: '⚔ Купол пал — штурм Динабурга начался! ' + fmtSpan(SIEGE.durMs) + ' на штурм. Алтарь — пушка в саду крепости: штурмующим удержать его ' + fmtSpan(SIEGE.holdMs) + ', гарнизону — выстоять' });
  }
  function siegeDrop(p) {   // the fallen leaves the event at once: the human teleports back to the city, the bot waits out the event dead
    const back = p.siegeBack; p.siege = null; p.siegeBack = null;
    if (p.bot) return;
    send(p, { t: 'siegeOut', reason: 'dead' });
    const [x, z] = back && world.walkable(back[0], back[1]) ? [back[0], back[1]] : areaPoint();
    spawn(p, x, z, back ? back[2] : Math.random() * 6.283, true);
  }
  // the rare loot of the survivors: the 8× optic and the red dot (if not owned and the pack has room), double reserve,
  // the full belt and the full magazines — and prizeKills each
  function siegePrize(winners) {
    const got = new Set();
    for (const p of winners) {
      p.hp = R.hp; p.mag = WEAPONS.map(w => w.mag); p.reserve = RESERVE.map(r => r * INV.reserveCap);
      p.meds = INV.medMax; p.nades = INV.nadeMax; p.smokes = INV.nadeMax; p.napalms = INV.nadeMax; p.reloadDone = 0;
      for (const k of ['optic', 'sight']) {
        const owned = p.pack.filter(x => x === k).length + p.attach.filter(a => a === k).length;
        if (owned >= INV[k + 'Max']) continue;
        const fi = p.pack.indexOf(null); if (fi < 0) continue;
        p.pack[fi] = k; got.add(k);
      }
      p.kills += SIEGE.prizeKills;
      send(p, { t: 'heal', hp: p.hp, meds: p.meds, quiet: 1 }); invMsg(p);
    }
    return { winners: winners.length, loot: [...got] };
  }
  function siegeWin(side, reason, t) {
    const winners = [...players.values()].filter(p => p.siege === side && p.alive);
    endSiege(t, side, 'win');   // everyone goes back to his place first (the spawn tops the belt up anew)
    const prize = siegePrize(winners);   // the rare loot lands on top, so the teleport does not wipe it
    const line = side === 'a' ? (reason === 'wipe' ? 'Гарнизон выбит — крепость пала!' : 'Штурмующие удержали алтарь ' + fmtSpan(SIEGE.holdMs) + ' — пушка Динабурга их!') : (reason === 'wipe' ? 'Штурмующие выбиты — крепость выстояла!' : 'Гарнизон выстоял все ' + fmtSpan(SIEGE.durMs) + ' — Динабург не взят, как в 1812-м!');
    all({ t: 'siegeWin', side, name: SIEGE.names[side], reason, survivors: prize.winners, loot: prize.loot, prizeKills: SIEGE.prizeKills });
    all({ t: 'chat', text: '🏆 ' + line + ' Выжившие (' + prize.winners + ') получают редкий лут и +' + SIEGE.prizeKills + ' очков' });
    sendBoard();
    const w = [...players.values()].find(p => p.kills >= WIN); if (w) endRound(w);
  }
  function endSiege(t, winner, reason) {
    if (!siege) return;
    siege = null; areaRev++; siegeWarned = false;
    nextSiegeAt = t + SIEGE.gapMs;
    for (const p of players.values()) {
      const was = p.siege; p.siege = null;
      if (!was || !p.alive) { p.siegeBack = null; continue; }
      const back = p.siegeBack; p.siegeBack = null;
      if (back && world.walkable(back[0], back[1])) spawn(p, back[0], back[1], back[2], true);
      else { const [x, z] = areaPoint(); spawn(p, x, z, Math.random() * 6.283, true); }
    }
    all({ t: 'siegeEnd', reason, winner: winner || undefined });
    if (reason === 'storm') all({ t: 'chat', text: 'Штурм Динабурга прерван штормом' });
    else if (reason === 'admin') all({ t: 'chat', text: 'Штурм Динабурга остановлен администратором' });
    else if (reason === 'match') all({ t: 'chat', text: 'Штурм Динабурга прерван новым раундом' });
    else if (reason === 'round') all({ t: 'chat', text: 'Штурм Динабурга прерван концом раунда' });
  }
  function stepSiege(t) {
    if (roundOver) return;
    if (!siege) {
      if (!evOn('siege')) { siegeWarned = false; return; }   // the schedule is paused by the admin panel
      if (!siegeWarned && t >= nextSiegeAt - SIEGE.warnMs && t < nextSiegeAt && players.size && !storm && !holy) { siegeWarned = true; all({ t: 'chat', text: '🏰 Штурм Динабурга через ' + Math.round(SIEGE.warnMs / 1000) + ' с — откроется регистрация сторон' }); }
      if (t >= nextSiegeAt && players.size && !storm && !holy) startSiege(t);
      return;
    }
    if (siege.phase === 'reg') { if (t >= siege.until) startPrep(t); }
    else if (siege.phase === 'prep') { if (t >= siege.until) startAssault(t); }
    else {
      const dt = Math.max(0, Math.min(1, (t - siege.lastStep) / 1000)); siege.lastStep = t;
      const ax = SIEGE.altar.x, az = SIEGE.altar.z, gy = world.ground(ax, az);
      let na = 0, nd = 0;
      for (const p of players.values()) {
        if (!p.alive || !p.siege || Math.hypot(p.x - ax, p.z - az) > SIEGE.capR) continue;
        if (Math.abs((p.y - p.eye) - gy) > 4) continue;   // on the ground by the fountain, not flying over it
        if (p.siege === 'a') na++; else nd++;
      }
      const was = siege.prog;
      if (na && !nd) { siege.prog = Math.min(1, siege.prog + dt * 1000 / SIEGE.holdMs); siege.contest = 'a'; }   // the attackers alone: the minute fills
      else if (nd) { siege.prog = Math.max(0, siege.prog - dt * 1000 / SIEGE.holdMs * 2); siege.contest = 'd'; }   // the garrison in the ring: the hold is beaten back twice as fast
      else { siege.prog = Math.max(0, siege.prog - dt * 1000 / SIEGE.holdMs); siege.contest = null; }   // left alone: the progress fades
      if (was > 0.02 && siege.prog <= 0 && siege.contest === 'd') all({ t: 'chat', text: '🛡 Гарнизон отбил алтарь — удержание прервано' });
      if (siege.prog >= 1) { siegeWin('a', 'hold', t); return; }
      let la = 0, ld = 0; for (const p of players.values()) { if (p.alive && p.siege === 'a') la++; else if (p.alive && p.siege === 'd') ld++; }
      if (siege.d0 > 0 && ld === 0) { siegeWin('a', 'wipe', t); return; }   // the garrison wiped: the fortress falls
      if (siege.a0 > 0 && la === 0) { siegeWin('d', 'wipe', t); return; }   // the attackers wiped: the fortress stands
      if (t >= siege.until) { siegeWin('d', 'time', t); return; }   // the historical outcome: the siege runs out
    }
    if (t - siege.lastBeat >= 1000) { siege.lastBeat = t; all({ t: 'siege', ...siegePublic() }); }
  }
  timers.push(setInterval(() => stepSiege(now()), 200));
  // ---- the clock of the game: snapshots of the world, the grenades in the air, the bots
  let last = now();
  timers.push(setInterval(() => {
    const list = [...players.values()].filter(p => p.alive).map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), +p.eye.toFixed(2), p.wep]);
    if (players.size) all({ t: 'snap', now: now(), p: list });
  }, 1000 / R.tickHz));
  timers.push(setInterval(() => { for (const p of players.values()) if (p.prof) p.prof.add('secs'); }, 1000));   // the time played
  timers.push(setInterval(() => { if (players.size) sendBoard(); }, 2000));   // the held Tab keeps living: damage, accuracy, ping and the fallen refresh between kills
  function stepNades() {
    const t = now();
    for (const n of [...nades.values()]) {
      const bodies = [...players.values()].filter(v => v.alive && v.id !== n.by).map(v => ({ x: v.x, y: v.y, z: v.z, eye: v.eye }));   // the thrower's own body does not stop their grenade
      world.stepNade(n, 1 / 30, NADE.g, bodies); n.simT = t;
      if (n.bounce && n.bounce.kind === 'body') all({ t: 'nbounce', id: n.id, p: n.p, v: n.v });   // the page resyncs its copy onto the bounced flight
      if (t >= n.t) explode(n);
    }
  }
  const tickNades = () => { stepNades(); stepZones(); };   // the grenades in the air and the zones they left, one clock
  timers.push(setInterval(tickNades, 1000 / 30));
  timers.push(setInterval(() => advanceBullets(now()), 1000 / 30));   // the bullets in the air fly on the same clock
  function stepBots(dt) { for (const p of [...players.values()]) if (p.bot) brain.think(p, dt); }
  timers.push(setInterval(() => { const t = now(), dt = Math.min(0.2, (t - last) / 1000); last = t; stepBots(dt); }, 50));
  if (MATCH) { tickMatch(); timers.push(setInterval(tickMatch, STORMC.tickMs)); }
  return {
    attach, addBot, removeBot, kick, say, players, arena, world, mode: MODE, equip, refreshClans,   // refreshClans: the teams changed (social.mjs)   // world: the city's physics (freePath, shotPath, stepNade) — the tools and the headless checks probe it
    get items() { return items; },   // the map pickups: the tests place them at a player's feet
    get zones() { return zones; },   // the smoke screens and burning patches: the tests probe them too
    get nades() { return nades; },   // the grenades in the air: the admin panel's debug picture counts them
    get bullets() { return bullets; },   // and the bullets in flight
    get doorAt() { return MATCH ? joinUntil() : 0; },   // when the door of the match closes (with the restart grace)
    get cargo() { return cargo; },   // the supply drop in flight or on the ground: the tests drive it by their own clock
    stepCargo: () => stepCargo(now()),   // the drop, the landing, the pickup and the mark's minute, for the tests
    cargoDrop: () => dropCargo(),   // and a drop on demand, without waiting out the first minute
    cargoRemove: () => { if (!cargo) return false; cargoGone(now(), 'admin'); return true; },   // the admin takes the crate away
    cargoNext: ms => { if (cargo) return false; nextCargoAt = now() + Math.max(0, ms); return true; },   // the next drop rescheduled by the admin
    get cargoNextAt() { return nextCargoAt; },   // when the next crate is due: the admin panel's countdown
    cargoState: () => cargoMsg(),   // the public picture of the crate: the panel reads its state and place
    get holy() { return holy; },   // the race on the hill: the tests read the points and the hold
    stepHoly: () => stepHoly(now()),   // the capture, the bell, the buff and the prize, for the tests
    spawn: p => spawn(p),   // a respawn where the game itself would put him (a bot of the race comes back by the hill), for the tests
    holyStart: () => startHoly(now()),   // the call to the hill on demand: 'ok', or the reason it refused ('active', 'siege', 'storm', 'round', 'no-players', 'arena')
    holyStop: () => { if (!holy) return false; endHoly(now(), null, 'admin'); return true; },   // the admin ends the race: everyone stays where he is
    holyNext: ms => { if (holy) return false; nextHolyAt = now() + Math.max(0, ms); holyWarned = false; return true; },   // the next call rescheduled by the admin
    get holyNextAt() { return nextHolyAt; },   // when the next race is due: the admin panel's countdown
    holyState: () => holyPublic(),   // the public picture of the race: the panel reads the points and the hold
    get siege() { return siege; },   // the siege of the fortress: the tests read the phase, the counts and the altar progress
    stepSiege: () => stepSiege(now()),   // the registration, the dome, the assault and the prize, for the tests
    siegeStart: () => startSiege(now()),   // the call to registration on demand: 'ok', or the reason it refused ('active', 'storm', 'holy', 'round', 'no-players')
    siegeStop: () => { if (!siege) return false; endSiege(now(), null, 'admin'); return true; },   // the admin ends the siege: everyone goes back to his place
    siegeNext: ms => { if (siege) return false; nextSiegeAt = now() + Math.max(0, ms); siegeWarned = false; return true; },   // the next call rescheduled by the admin
    get siegeNextAt() { return nextSiegeAt; },   // when the next siege is due: the admin panel's countdown
    siegeState: () => siegePublic(),   // the public picture of the siege: the panel reads the phase and the altar
    stepBullets: () => advanceBullets(now()),   // the tests drive the flight by their own clock
    stepNades: tickNades,   // the tests drive the fuse and the zones by their own clock too
    stepBots,   // and the bots' think by the test clock, for the fall test
    stepItems: () => tickItems(now()),   // and the pickups and reload completion, for the bot-tactics tests
    stepMatch: () => { if (MATCH) tickMatch(); },   // the match's own clock: the door, the storm's stages, the burn outside and the end, for the tests
    get match() { return match; },   // the schedule of the match, its roster and the fallen of its storm
    get storm() { return storm; },   // the storm's state: the tests read the circle and the phase
    stop() { for (const t of timers) { clearInterval(t); clearTimeout(t); } timers.length = 0; },
    health() { return { ok: true, mode: MODE, id: opts.id || 1, name: NAME, players: humans().length, bots: players.size - humans().length, max: MAX, win: WIN === Infinity ? null : WIN, round: roundOver ? 'end' : 'play', arena: fieldArena() ? fieldArena().name : null, holy: holy ? { left: Math.max(0, holy.until - now()), held: holy.points.filter(pt => pt.owner).length, hold: holy.holdSide ? Math.max(0, holy.holdStart + HOLY.holdMs - now()) : 0 } : undefined, siege: siege ? { phase: siege.phase, left: Math.max(0, siege.until - now()), counts: siegeCounts(), prog: +siege.prog.toFixed(3) } : undefined, leaderboard: !!lb, day: dayNow(), match: matchPublic() || undefined, storm: storm ? { phase: storm.phase, pi: storm.pi, stages: storm.plan.length, kind: storm.kind, left: Math.max(0, storm.t1 - now()), alive: stormAlive().length, total: players.size } : undefined }; },
  };
}
export { LEVELS };
