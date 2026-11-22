/* The game itself: team deathmatch (red against blue) or MODE=ffa (everybody against everybody), with or without an arena
   (a play area with a base for each team), with or without bots. It knows nothing of the network: a connection is any
   object with send(string) and close(); the Node server (index.mjs) gives it WebSockets, and the page gives it a local
   one for the game against bots with no server at all (src/game/local.js). Players move on their own machines (the game
   limits their speed and keeps them in the arena); the game owns health, shots, kills, scores and respawns. It reads the
   city through `world` (freePath, ground, walkable, buildingAt, stepNade): a shot that would pass through a building does
   not hit, and its tracer stops at the wall. Bullets are real projectiles: they fly at the weapon's muzzle velocity
   (WEAPONS.vel) and the damage lands when the bullet arrives, not at the click. The hit is still judged against the target
   as the shooter saw it at the click (the position rewound by the shooter's lag, frozen for the flight), so “shoot where
   you see” holds while the bullet takes its time to get there. */
import { CARGO, FALL, HIT, INV, ITEMS, LOADOUT, NADE, NADE_KINDS, NAPALM, PACK, RELOAD_MS, RESERVE, RULES as R, SMOKE, WEAPONS, W_FALL, W_FIRE, W_NADE, bulletAt, bulletDir, dragDist, dragTime, rayHit, rayToSegment } from './combat.mjs';
import { LEVELS, botName, createBrain } from './bots.mjs';
import { DAY_MS, dayPhase } from './daycycle.mjs';

const TEAMS = ['Красные', 'Синие'], HX = 5200, HY = 4200;   // bounds a bit wider than the city
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
  const world = opts.world, FFA = opts.mode === 'ffa', MODE = FFA ? 'ffa' : 'team', WIN = opts.win || (FFA ? 20 : 30), NAME = opts.name || 'Даугавпилс', MAX = opts.maxPlayers || R.maxPlayers;
  const now = opts.now || (() => Date.now()), teamScore = [0, 0], players = new Map();
  // the day of the game (daycycle.mjs): its length; null — no clock, the page keeps the time of day it has
  const DAY = opts.day ? { len: Math.max(60000, +opts.day.len || DAY_MS) } : null;
  const dayNow = () => DAY && { f: +dayPhase(now(), DAY.len).toFixed(6), len: DAY.len };
  let nextId = 1, roundOver = false, nextNade = 1, nextBid = 1;
  const nades = new Map(), bullets = new Map(), zones = new Map(), timers = [];   // zones: the smoke screens and the burning patches left by the special grenades
  // the arena: its bases stood on something walkable; without an arena bots roam round the square
  const walkSpot = (x, z) => { if (world.walkable(x, z)) return [x, z]; for (let r = 4; r < 80; r += 4) for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r; if (world.walkable(nx, nz)) return [nx, nz]; } return [x, z]; };
  const arena = opts.arena ? { ...opts.arena, bases: opts.arena.bases.map(b => b.map(([x, z]) => walkSpot(x, z))) } : null;
  const area = arena || { cx: -1487, cz: 1263, r: 450 };
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
  // the chosen character rides the board: a key of CHARS in src/game/avatar.js; empty — the operator
  const CHARS = ['soldier', 'spartan', 'alien', '2b'];
  const cleanChar = s => (typeof s === 'string' && CHARS.includes(s) ? s : '');
  const botChar = () => CHARS[Math.random() * CHARS.length | 0];
  // the Tab scoreboard reads more than the score: the round's damage and accuracy, the ping of a human (a bot has none),
  // and who is on their feet — so the held table shows the live round, not only the kills
  const board = () => [...players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, bot: !!p.bot, char: p.char, dmg: Math.round(p.st.dmg), acc: p.st.shots ? Math.round(100 * p.st.hitShots / p.st.shots) : 0, ping: p.bot ? undefined : Math.round(p.rtt), alive: p.alive, mark: p.markUntil > now() || undefined }));
  const sendBoard = () => all({ t: 'board', board: board(), score: FFA ? [] : teamScore });
  const count = k => [...players.values()].filter(p => p.team === k).length;
  function pickTeam(want, id) {
    if (FFA) return id; const a = count(0), b = count(1); if (a !== b) return a < b ? 0 : 1; return want === 0 || want === 1 ? want : Math.random() < 0.5 ? 0 : 1;
  }
  const newPlayer = () => ({ id: nextId++, conn: null, bot: null, name: '', char: '', team: 0, joined: false, x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, hp: 0, alive: false, kills: 0, deaths: 0, st: { shots: 0, hitShots: 0, dmg: 0, heads: 0 }, wep: 0, lastShot: 0, lastNade: 0, nades: 0, smokes: 0, napalms: 0, lastChat: 0, rwin: 0, rmsgs: 0, eye: 1.7, rtt: 80, hist: [], diedAt: 0, protectUntil: 0, t: 0, msgs: 0, win: now(),
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
  // where a player appears in an arena: the base point of the team (of everybody in the free-for-all) farthest from the enemies
  function basePoint(p) {
    const pts = FFA ? arena.bases.flat() : arena.bases[p.team === 1 ? 1 : 0], foes = [...players.values()].filter(q => q.alive && q !== p && (FFA || q.team !== p.team));
    let best = pts[0], bd = -1; for (const [x, z] of pts) { const d = foes.length ? Math.min(...foes.map(q => Math.hypot(q.x - x, q.z - z))) : Math.random() * 100; if (d > bd) { bd = d; best = [x, z]; } }
    const a = Math.random() * 6.283, r = 2 + Math.random() * 10, [x, z] = walkSpot(best[0] + Math.cos(a) * r, best[1] + Math.sin(a) * r);
    return [x, z, Math.atan2(arena.cx - x, arena.cz - z) + Math.PI];   // facing the middle of the arena
  }
  function areaPoint() { for (let k = 0; k < 30; k++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * (area.r - 20), x = area.cx + Math.cos(a) * r, z = area.cz + Math.sin(a) * r; if (world.walkable(x, z)) return [x, z, Math.random() * 6.283]; } return [area.cx, area.cz, 0]; }
  function spawn(p, x, z, yaw) {
    if (arena) [x, z, yaw] = basePoint(p); else if (p.bot) [x, z, yaw] = areaPoint();
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
    v.hp -= dmg; if (p !== v) { const d = dmg + Math.min(0, v.hp); p.st.dmg += d; if (p.prof) p.prof.add('dmg', d); } send(v, { t: 'hurt', by: p.id, hp: Math.max(0, v.hp), dx: from[0] - v.x, dz: from[2] - v.z, bd: r3(bd), vf: vf == null ? undefined : +vf.toFixed(3), fall: w === W_FALL ? 1 : undefined, fire: w === W_FIRE ? 1 : undefined }); if (p !== v) send(p, { t: 'hit', id: v.id, head, zone, kill: v.hp <= 0, dmg: Math.min(dmg, dmg + Math.min(0, v.hp)) });
    if (v.hp > 0) return;
    v.alive = false; v.deaths++; v.diedAt = t0; v.streak = 0; if (v.prof) v.prof.add('deaths');
    if (v.markUntil) { v.markUntil = 0; all({ t: 'unmark', id: v.id }); }   // the cargo mark dies with its carrier
    if (p !== v) { p.kills++; if (!FFA) teamScore[p.team]++; if (head) p.st.heads++; if (p.prof) { p.prof.add('kills'); if (head) p.prof.add('heads'); p.streak = (p.streak || 0) + 1; p.prof.max('best', p.streak); } }
    all({ t: 'kill', killer: p.id, victim: v.id, kn: p.name, vn: v.name, kt: p.team, vt: v.team, head, w, zone: bd ? zone : undefined, bd: r3(bd), vf: vf == null ? undefined : +vf.toFixed(3), dx: +(from[0] - v.x).toFixed(2), dz: +(from[2] - v.z).toFixed(2) }); sendBoard();   // dx/dz: where the blow came from; bd: the bullet's own way at the hit — the body falls along it (ragdoll.js)
    if (p !== v && (FFA ? p.kills : teamScore[p.team]) >= WIN) endRound(p.team, p);
  }
  // a fall from above the safe height hurts (FALL): the client reports the height it landed from — it knows the true
  // ground (the fortress ramparts, the bridges), the server's raw lidar does not. The report is capped by the drop the
  // server saw itself in the state stream (fallTop, the highest point since the last landing), so a number out of thin
  // air cannot kill; the bots fall in think() and report here the same way
  function fall(p, h) {
    if (!p.alive) return;
    const seen = Math.max(0, (p.fallTop ?? p.y) - p.y + 1);   // +1 m: the eye lowers on a crouch
    p.fallTop = p.y;
    const hh = Math.min(FALL.maxH, Math.max(0, h), seen);
    if (hh > FALL.safe) hurt(p, p, Math.round((hh - FALL.safe) * FALL.k), 0, W_FALL, [p.x, p.y, p.z]);
  }
  // the smoke and the napalm go off into a zone lying on the surface under them (the ground, or the roof they reached);
  // the zone lives in `zones` until its time is out — the fire burns whoever stands in it (stepZones), the smoke hides
  // the street from the bots' eyes (bots.mjs). The page draws both from the 'zone' message (src/game/nades.js).
  const surfaceAt = (x, y, z) => { const g = world.ground(x, z), b = world.buildingAt(x, z, y); return b && y > g + (b.top || 12) - 0.6 ? g + (b.top || 12) : g; };
  function layZone(n) {
    const K = n.kind === 'smoke' ? SMOKE : NAPALM, y = surfaceAt(n.p[0], n.p[1], n.p[2]);
    const z = { id: n.id, kind: n.kind === 'smoke' ? 'smoke' : 'fire', x: n.p[0], y, z: n.p[2], r: K.radius, until: now() + K.durMs, by: n.by, lastTick: 0 };
    zones.set(z.id, z);
    all({ t: 'zone', id: z.id, kind: z.kind, x: z.x, y: z.y, z: z.z, r: z.r, durMs: K.durMs });
  }
  function stepZones() {
    const t = now();
    for (const z of [...zones.values()]) {
      if (t >= z.until) { zones.delete(z.id); all({ t: 'zoneEnd', id: z.id }); continue; }
      if (z.kind !== 'fire' || roundOver || t - z.lastTick < NAPALM.tickMs) continue;
      z.lastTick = t;
      const thrower = players.get(z.by); if (!thrower) continue;
      for (const v of players.values()) {
        if (!v.alive) continue;
        if (v.team === thrower.team && v !== thrower) continue;   // teammates walk through their own napalm unburnt
        if (v !== thrower && t <= v.protectUntil) continue;
        if (Math.hypot(v.x - z.x, v.z - z.z) >= z.r) continue;
        const feet = v.y - v.eye; if (feet < z.y - 1 || feet > z.y + 2.5) continue;   // on the burning surface, not above it
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
      if (!v.alive || !thrower) continue; if (v.team === thrower.team && v !== thrower) continue;
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
    p.reloadDone = t0 + RELOAD_MS[wi]; p.reloadW = wi; return true;
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
          const dmg = (best.zone === 1 ? W.head : best.zone === 2 ? W.dmg * HIT.legMul : W.dmg) * vf * vf;
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
    if (p.conn && !held(p, wi)) return;   // a human fires only an equipped gun
    if (t0 - p.lastShot < W.gapMs) return;
    if (t0 < p.reloadDone) return;   // still reloading
    if (p.mag[wi] <= 0) { if (p.bot) beginReload(p, wi, t0); return; }   // a bot reloads by itself; a player asks with 'reload'
    p.mag[wi]--; p.lastShot = t0;
    advanceBullets(t0);   // land the bullets already in the air before loosing new ones
    const eye = [p.x, p.y, p.z], out = [];
    // every living enemy as the shooter saw them at the click (lag-compensated), frozen for the whole flight: the page
    // aims at the same past, and a claim that drifted (lag, a crouch) must not cost a hit that was really there
    const foes = roundOver ? [] : [...players.values()].filter(v => v !== p && v.alive && (FFA || v.team !== p.team) && t0 > v.protectUntil);
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
    if (!p.alive || p[field] <= 0 || t0 - p.lastNade < NADE.cooldownMs || roundOver) return;
    p[field]--; p.lastNade = t0; refill(p, kind); invMsg(p);   // a stored grenade takes the thrown one's place on the belt
    sp = Math.max(NADE.minSpeed, Math.min(NADE.maxSpeed, sp)); const id = nextNade++;   // the charged throw: the client sends the speed it gathered holding the mouse
    const fuse = kind === 'smoke' ? SMOKE.fuseMs : kind === 'napalm' ? NAPALM.fuseMs : NADE.fuseMs;
    const n = { id, by: p.id, kind, p: [p.x + u[0] * 0.6, p.y - 0.2 + u[1] * 0.6, p.z + u[2] * 0.6], v: [u[0] * sp, u[1] * sp + NADE.loft * sp, u[2] * sp], t: t0 + fuse, simT: t0 };
    nades.set(id, n); all({ t: 'nade', id, by: p.id, kind, p: n.p, v: n.v, fuse });
  }
  // the end of a round: the table of the round goes to everybody, ten seconds later the scores are cleared and the next round starts
  function endRound(team, winner) {
    roundOver = true;
    for (const p of players.values()) if (p.prof) { p.prof.add('rounds'); if (FFA ? p === winner : p.team === team) p.prof.add('wins'); }
    const rows = [...players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, heads: p.st.heads, dmg: Math.round(p.st.dmg), acc: p.st.shots ? Math.round(100 * p.st.hitShots / p.st.shots) : 0 }));
    rows.sort((a, b) => b.kills - a.kills || b.dmg - a.dmg || a.deaths - b.deaths);
    all({ t: 'win', mode: MODE, team, name: FFA ? winner.name : TEAMS[team], score: FFA ? [] : teamScore, rows, mvp: rows.length ? rows[0].id : 0, nextMs: 10000 });
    timers.push(setTimeout(() => { teamScore[0] = teamScore[1] = 0; for (const p of players.values()) { p.kills = p.deaths = 0; p.st = { shots: 0, hitShots: 0, dmg: 0, heads: 0 }; if (p.markUntil) { p.markUntil = 0; all({ t: 'unmark', id: p.id }); } } roundOver = false; sendBoard(); all({ t: 'round' }); all({ t: 'chat', text: 'Новый раунд' }); for (const it of items.values()) { it.active = true; it.respawnAt = 0; all(itemMsg(it)); } for (const z of zones.values()) all({ t: 'zoneEnd', id: z.id }); zones.clear(); if (cargo) { all({ t: 'cargoEnd', id: cargo.id }); cargo = null; } nextCargoAt = now() + CARGO.firstMs; }, 10000));
  }
  // ---- bots
  const enemyBase = p => (arena ? (FFA ? arena.bases.flat()[Math.floor(Math.random() * arena.bases.flat().length)] : arena.bases[p.team === 1 ? 0 : 1][Math.floor(Math.random() * arena.bases[p.team === 1 ? 0 : 1].length)]) : null);
  const brain = createBrain({ players, now, world, area, FFA, WEAPONS, R, shoot, throwNade, spawn, fall, roundOver: () => roundOver, enemyBase, reload: beginReload, equip, get items() { return items; }, get zones() { return zones; }, get cargo() { return cargo; } });   // items and cargo are declared below: getters read them once the game is built
  let botN = 0;
  function addBot(level) {
    if (players.size >= MAX) return null;
    const p = newPlayer(); let nm = botName(botN++); while ([...players.values()].some(q => q.name === nm)) nm = botName(botN++); p.name = nm; p.char = botChar(); p.team = pickTeam(-1, p.id); p.joined = true; brain.make(level || opts.level, p); players.set(p.id, p);
    spawn(p); sendBoard(); all({ t: 'chat', text: p.name + ' в игре' }); return p;
  }
  function removeBot() { const b = [...players.values()].reverse().find(p => p.bot); if (!b) return false; players.delete(b.id); all({ t: 'left', id: b.id }); sendBoard(); return true; }
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
          if (acc && !acc.byKey(m.key)) { send(p, { t: 'auth-required' }); conn.close(); return; }   // an account is mandatory: the key must belong to an account of this server
          if (players.size >= MAX && !removeBot()) { send(p, { t: 'full' }); conn.close(); return; }
          if (lb && m.board !== false && validKey(m.key) && ![...players.values()].some(q => q.key === m.key)) { p.key = m.key; const r = lb.identify(m.key, nameBase(m.name), n => !taken(n)); p.name = r.name; p.prof = r.prof; } else p.name = cleanName(m.name);
          p.team = pickTeam(m.team, p.id); p.char = cleanChar(m.char); p.joined = true; players.set(p.id, p);
          send(p, { t: 'hello', mode: MODE, id: p.id, server: NAME, name: p.name, team: p.team, teams: TEAMS, win: WIN, now: now(), arena: arena && { name: arena.name, cx: arena.cx, cz: arena.cz, r: arena.r, bases: arena.bases }, rules: { hp: R.hp, range: R.range }, day: dayNow() || undefined, board: board(), score: FFA ? [] : teamScore, items: [...items.values()].filter(i => i.active).map(i => ({ id: i.id, kind: i.kind, x: i.x, z: i.z })), zones: [...zones.values()].map(z => ({ id: z.id, kind: z.kind, x: z.x, y: z.y, z: z.z, r: z.r, left: Math.max(0, z.until - now()) })), cargo: cargoMsg(), marks: marks(), attach: Object.fromEntries([...players.values()].map(q => [q.id, q.attach])) });
          spawn(p, m.x, m.z, m.yaw); sendBoard(); all({ t: 'chat', text: p.name + (FFA ? ' в игре' : ' в игре, ' + TEAMS[p.team]) });
          return;
        }
        if (!p.joined) return;
        if (m.t === 'state' && p.alive) {
          const dt = Math.max(0.02, Math.min(0.5, (t0 - p.t) / 1000)); p.t = t0;
          const x = num(m.x, HX), z = num(m.z, HY), y = Math.max(-50, Math.min(400, num(m.y, 400)));
          if (arena && Math.hypot(x - arena.cx, z - arena.cz) > arena.r) { send(p, { t: 'correct', x: p.x, y: p.y, z: p.z, out: true }); return; }   // beyond the edge of the arena
          const far = Math.hypot(x - p.x, z - p.z), first = p.free && far < 80; p.free = false;   // right after a spawn the client may nudge itself off a wall or out of the water
          if (!first && far > R.runSpeed * dt * 1.6 + 3) send(p, { t: 'correct', x: p.x, y: p.y, z: p.z });   // too fast: put back
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
        else if (m.t === 'chat') {
          const text = String(m.text || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
          if (!text || t0 - p.lastChat < 700) return; p.lastChat = t0;
          const say = { t: 'say', id: p.id, name: p.name, team: p.team, text, teamOnly: !!m.team };
          if (m.team && !FFA) { for (const q of players.values()) if (q.team === p.team) send(q, say); } else all(say);
        } else if (m.t === 'rtc') {   // voice chat: the game only passes the WebRTC handshake between two players
          const q = players.get(+m.to); if (!q || q === p || q.bot || !m.d || typeof m.d !== 'object') return;
          if (t0 - p.rwin > 1000) { p.rwin = t0; p.rmsgs = 0; } if (++p.rmsgs > 400) return;
          send(q, { t: 'rtc', from: p.id, d: m.d });
        } else if (m.t === 'ping') { p.rtt = Math.max(0, Math.min(1000, num(m.rtt, 1000))); send(p, { t: 'pong', c: m.c });
        } else if (m.t === 'respawn' && !p.alive && t0 - p.diedAt >= R.respawnMs) {
          const mate = m.mate && [...players.values()].filter(q => q.alive && q.team === p.team && q !== p);
          if (mate && mate.length) { const q = mate[Math.floor(Math.random() * mate.length)], a = Math.random() * 6.283, r = 6 + Math.random() * 8; spawn(p, q.x + Math.cos(a) * r, q.z + Math.sin(a) * r, q.yaw); }   // next to a teammate
          else spawn(p, m.x, m.z, m.yaw);
        }
      },
    };
    return handle;
  }
  // ---- the items on the map: ammo, grenades, med kits and the two sights; picked up by walking over, back after a while ----
  const items = new Map(); let nextItem = 1;
  function itemSpots() {
    const spots = [], N = INV.itemCount;
    const add = (x, z) => { if (world.walkable(x, z) && !spots.some(s => Math.hypot(s[0] - x, s[1] - z) < 18)) spots.push([x, z]); };
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
    cargo = null; nextCargoAt = t + CARGO.gapMs;
  }
  function stepCargo(t) {
    for (const p of players.values()) if (p.markUntil && t >= p.markUntil) { p.markUntil = 0; all({ t: 'unmark', id: p.id }); }
    if (roundOver) return;
    if (!cargo) { if (t >= nextCargoAt && players.size) dropCargo(); return; }
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
      all({ t: 'chat', text: '🎯 ' + p.name + ' забрал груз — теперь он мишень для всех (60 с)' });
      sendBoard();
      return;
    }
  }
  timers.push(setInterval(() => stepCargo(now()), 200));
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
  return {
    attach, addBot, removeBot, players, arena, world, mode: MODE, equip,   // world: the city's physics (freePath, shotPath, stepNade) — the tools and the headless checks probe it
    get items() { return items; },   // the map pickups: the tests place them at a player's feet
    get zones() { return zones; },   // the smoke screens and burning patches: the tests probe them too
    get cargo() { return cargo; },   // the supply drop in flight or on the ground: the tests drive it by their own clock
    stepCargo: () => stepCargo(now()),   // the drop, the landing, the pickup and the mark's minute, for the tests
    cargoDrop: () => dropCargo(),   // and a drop on demand, without waiting out the first minute
    stepBullets: () => advanceBullets(now()),   // the tests drive the flight by their own clock
    stepNades: tickNades,   // the tests drive the fuse and the zones by their own clock too
    stepBots,   // and the bots' think by the test clock, for the fall test
    stepItems: () => tickItems(now()),   // and the pickups and reload completion, for the bot-tactics tests
    stop() { for (const t of timers) { clearInterval(t); clearTimeout(t); } timers.length = 0; },
    health() { return { ok: true, mode: MODE, name: NAME, players: humans().length, bots: players.size - humans().length, max: MAX, score: teamScore, win: WIN, teams: TEAMS, round: roundOver ? 'end' : 'play', arena: arena ? arena.name : null, leaderboard: !!lb, day: dayNow() }; },
  };
}
export { LEVELS };
