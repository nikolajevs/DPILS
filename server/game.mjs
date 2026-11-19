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
import { HIT, INV, ITEMS, NADE, RELOAD_MS, RESERVE, RULES as R, WEAPONS, W_NADE, rayHit } from './combat.mjs';
import { LEVELS, botName, createBrain } from './bots.mjs';

const TEAMS = ['Красные', 'Синие'], HX = 5200, HY = 4200;   // bounds a bit wider than the city
const num = (v, lim) => (typeof v === 'number' && isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
const okWeapon = w => Number.isInteger(w) && w >= 0 && w < WEAPONS.length;
export const MUZZLE = 0.6;   // the barrel stands this far along the ray from the eye; a wall nearer rests the muzzle on it (keep src/game/mp.js in step)

export function createGame(opts) {
  const world = opts.world, FFA = opts.mode === 'ffa', MODE = FFA ? 'ffa' : 'team', WIN = opts.win || (FFA ? 20 : 30), NAME = opts.name || 'Даугавпилс', MAX = opts.maxPlayers || R.maxPlayers;
  const now = opts.now || (() => Date.now()), teamScore = [0, 0], players = new Map();
  let nextId = 1, roundOver = false, nextNade = 1, nextBid = 1;
  const nades = new Map(), bullets = new Map(), timers = [];
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
  // the chosen character rides the board: a key of CHARS in src/game/avatar.js; empty — the operator
  const CHARS = ['soldier', 'spartan', 'alien', '2b'];
  const cleanChar = s => (typeof s === 'string' && CHARS.includes(s) ? s : '');
  const botChar = () => CHARS[Math.random() * CHARS.length | 0];
  const board = () => [...players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, bot: !!p.bot, char: p.char }));
  const sendBoard = () => all({ t: 'board', board: board(), score: FFA ? [] : teamScore });
  const count = k => [...players.values()].filter(p => p.team === k).length;
  function pickTeam(want, id) {
    if (FFA) return id; const a = count(0), b = count(1); if (a !== b) return a < b ? 0 : 1; return want === 0 || want === 1 ? want : Math.random() < 0.5 ? 0 : 1;
  }
  const newPlayer = () => ({ id: nextId++, conn: null, bot: null, name: '', char: '', team: 0, joined: false, x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, hp: 0, alive: false, kills: 0, deaths: 0, st: { shots: 0, hitShots: 0, dmg: 0, heads: 0 }, wep: 0, lastShot: 0, lastNade: 0, nades: 0, lastChat: 0, rwin: 0, rmsgs: 0, eye: 1.7, rtt: 80, hist: [], diedAt: 0, protectUntil: 0, t: 0, msgs: 0, win: now(),
    mag: WEAPONS.map(w => w.mag), reserve: RESERVE.slice(), meds: 0, reloadDone: 0, reloadW: 0, lastMed: 0,
    sights: { sight: 0, optic: 0 }, attach: WEAPONS.map(() => null) });   // loose sights in the pocket and the one mounted on each weapon
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
    p.x = num(x, HX); p.z = num(z, HY); p.y = p.bot ? world.ground(p.x, p.z) + 1.7 : 1.7; p.yaw = num(yaw, 10); p.pitch = 0; p.hp = R.hp; p.alive = true; p.protectUntil = now() + R.protectMs; p.t = now(); p.free = true; p.hist.length = 0; p.nades = NADE.count; p.eye = 1.7;
    p.mag = WEAPONS.map(w => w.mag); p.reserve = RESERVE.slice(); p.meds = 0; p.reloadDone = 0; p.lastMed = 0;
    send(p, { t: 'spawn', x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, nades: p.nades, mag: p.mag, reserve: p.reserve, meds: p.meds, sights: p.sights, attach: p.attach }); all({ t: 'alive', id: p.id });   // the sights stay with the player through a death
  }
  // damage dmg from attacker p to v (weapon w; zone 1 head, 0 torso, 2 legs; from = where it came from): the hit and
  // the hurt messages, and the kill
  function hurt(p, v, dmg, zone, w, from) {
    if (!v.alive || dmg <= 0) return; const t0 = now(), head = zone === 1;
    v.hp -= dmg; if (p !== v) { const d = dmg + Math.min(0, v.hp); p.st.dmg += d; if (p.prof) p.prof.add('dmg', d); } send(v, { t: 'hurt', by: p.id, hp: Math.max(0, v.hp), dx: from[0] - v.x, dz: from[2] - v.z }); if (p !== v) send(p, { t: 'hit', id: v.id, head, zone, kill: v.hp <= 0, dmg: Math.min(dmg, dmg + Math.min(0, v.hp)) });
    if (v.hp > 0) return;
    v.alive = false; v.deaths++; v.diedAt = t0; v.streak = 0; if (v.prof) v.prof.add('deaths');
    if (p !== v) { p.kills++; if (!FFA) teamScore[p.team]++; if (head) p.st.heads++; if (p.prof) { p.prof.add('kills'); if (head) p.prof.add('heads'); p.streak = (p.streak || 0) + 1; p.prof.max('best', p.streak); } }
    all({ t: 'kill', killer: p.id, victim: v.id, kn: p.name, vn: v.name, kt: p.team, vt: v.team, head, w }); sendBoard();
    if (p !== v && (FFA ? p.kills : teamScore[p.team]) >= WIN) endRound(p.team, p);
  }
  function explode(n) {
    nades.delete(n.id); all({ t: 'boom', id: n.id, x: n.p[0], y: n.p[1], z: n.p[2] });
    if (roundOver) return; const thrower = players.get(n.by);
    for (const v of players.values()) {
      if (!v.alive || !thrower) continue; if (v.team === thrower.team && v !== thrower) continue;
      const c = [v.x, v.y - 0.41 * v.eye, v.z], o = [n.p[0], n.p[1] + 0.3, n.p[2]], dx = c[0] - o[0], dy = c[1] - o[1], dz = c[2] - o[2], d = Math.hypot(dx, dy, dz);
      if (d >= NADE.radius || (v !== thrower && now() <= v.protectUntil)) continue;
      if (d > 0.6 && world.freePath(o, [dx / d, dy / d, dz / d], d) < d - 0.7) continue;   // a wall between the blast and the player
      const k = 1 - d / NADE.radius, self = v === thrower ? NADE.self : 1;
      hurt(thrower, v, Math.round(NADE.dmg * k * self), 0, W_NADE, n.p);
      if (!v.alive) continue;   // the dead stay where they fell
      // the blast throws too: a velocity away from the blast, fading with the damage, plus a kick up (NADE.push).
      // The player's client adds it to the jump and a decaying slide ('push'), a bot slides here on the server.
      // Right at the blast the direction is undefined — throw up and aside at random.
      let ux, uy, uz;
      if (d < 0.5) { const a = Math.random() * 6.283, l = Math.hypot(1, 0.8); ux = Math.cos(a) / l; uz = Math.sin(a) / l; uy = 0.8 / l; }
      else { ux = dx / d; uy = dy / d; uz = dz / d; }
      const s = NADE.push * k * self, vx = ux * s, vz = uz * s, vy = Math.max(0, uy) * s + NADE.pushUp * k * self;
      if (v.bot) { v.bot.kx += vx; v.bot.kz += vz; }
      else send(v, { t: 'push', vx: +vx.toFixed(2), vy: +vy.toFixed(2), vz: +vz.toFixed(2) });
    }
  }
  // ---- the inventory: the server keeps the magazines and the reserve; a reload takes time and fills from the reserve ----
  const invMsg = p => send(p, { t: 'inv', mag: p.mag, reserve: p.reserve, nades: p.nades, meds: p.meds, sights: p.sights, attach: p.attach });
  // mounting a picked-up sight on a weapon (kind null takes it off): the pocket pays, the old one comes back loose
  function setSight(p, wi, kind) {
    if (!p.alive || kind === p.attach[wi]) return;
    if (kind && p.sights[kind] <= 0) return;
    if (kind) p.sights[kind]--;
    if (p.attach[wi]) p.sights[p.attach[wi]]++;
    p.attach[wi] = kind;
    invMsg(p); all({ t: 'attach', id: p.id, attach: p.attach });
  }
  function beginReload(p, wi, t0) {
    if (!p.alive || p.reloadDone > t0 || p.mag[wi] >= WEAPONS[wi].mag || p.reserve[wi] <= 0) return false;
    p.reloadDone = t0 + RELOAD_MS[wi]; p.reloadW = wi; return true;
  }
  function useMed(p, t0) {
    if (!p.alive || p.meds <= 0 || p.hp >= R.hp || t0 - p.lastMed < INV.medGapMs) return false;
    p.lastMed = t0; p.meds--; p.hp = Math.min(R.hp, p.hp + ITEMS.med.heal);
    send(p, { t: 'heal', hp: p.hp, meds: p.meds }); return true;
  }
  // ---- the bullets in the air: a shot is no longer applied at the click, it flies. Each pellet is a projectile stepped
  // forward in game time (advanceBullets, called by the 30 Hz clock and before every new shot). The geometry of the hit is
  // frozen at the click — every living enemy as the shooter saw them then (poseAt rewound by the shooter's lag), the same
  // lag compensation the instant shot used — so “shoot where you see” holds; but the damage and the report land only when
  // the bullet gets there. A wall (freePath at the muzzle) ends the flight. Pellets of one shot that hit the same body are
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
        const nt = Math.min(to, t + 1000 / 60), seg = b.speed * (nt - t) / 1000, reach = Math.min(seg, b.max - dist);
        if (reach <= 1e-6) { gone = true; break; }
        const o = [b.o[0] + b.d[0] * dist, b.o[1] + b.d[1] * dist, b.o[2] + b.d[2] * dist];
        let best = null;
        if (!roundOver) for (const { v, pose } of b.shot.poses) {   // the poses the shooter saw at the click, frozen
          if (!v.alive || nt <= v.protectUntil) continue;
          const h = rayHit(o, b.d, reach + HIT.grace, pose);
          if (h && h.t <= reach + HIT.grace && (!best || h.t < best.t)) best = { t: Math.min(h.t, reach), zone: h.zone, v };
        }
        if (best) {
          const total = dist + best.t, k = 1 - W.falloff * Math.min(1, total / W.range);
          const dmg = (best.zone === 1 ? W.head : best.zone === 2 ? W.dmg * HIT.legMul : W.dmg) * k;
          const at = [b.o[0] + b.d[0] * total, b.o[1] + b.d[1] * total, b.o[2] + b.d[2] * total], s = b.shot;
          if (!s.hit) { s.hit = true; shooter.st.hitShots++; if (shooter.prof) shooter.prof.add('hits'); }
          const h = s.hits.get(best.v.id) || { v: best.v, dmg: 0, head: false, zone: 0, top: 0 };
          h.dmg += dmg; h.head = h.head || best.zone === 1; if (dmg > h.top) { h.top = dmg; h.zone = best.zone; } s.hits.set(best.v.id, h);
          all({ t: 'bhit', bid: b.bid, by: b.by, d: +total.toFixed(2), v: best.v.id, zone: best.zone, at });   // the page cuts the tracer here and shows the blood
          gone = true;
        } else { dist += seg; if (dist >= b.max) gone = true; }
        t = nt;
      }
      if (gone) { b.shot.pending--; touched.add(b.shot); bullets.delete(b.bid); } else { b.last = to; b.dist = dist; }
    }
    for (const s of touched) if (s.pending <= 0 && s.hits.size) {   // every pellet of the shot has landed: report the summed blow
      const shooter = players.get(s.by);
      if (shooter) for (const { v, dmg, zone } of s.hits.values()) hurt(shooter, v, Math.round(dmg), zone, s.w, s.o);
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
      const wallEye = world.freePath(eye, d, W.range), mz = Math.min(MUZZLE, wallEye);   // pressed to a wall: the barrel rests on it, the flight is zero
      const o = [eye[0] + d[0] * mz, eye[1] + d[1] * mz, eye[2] + d[2] * mz], wall = wallEye - mz, bid = nextBid++;
      bullets.set(bid, { bid, by: p.id, w: wi, o, d, speed: W.vel || 560, last: t0, dist: 0, max: wall, shot });
      shot.pending++;
      out.push([+d[0].toFixed(4), +d[1].toFixed(4), +d[2].toFixed(4), +wall.toFixed(1), bid]);
    }
    if (!out.length) return;
    p.st.shots++; if (p.prof) p.prof.add('shots');
    all({ t: 'shot', id: p.id, w: wi, o: eye, rays: out });
  }
  function throwNade(p, u, sp = NADE.speed) {
    const t0 = now(); if (!p.alive || p.nades <= 0 || t0 - p.lastNade < NADE.cooldownMs || roundOver) return;
    p.nades--; p.lastNade = t0; sp = Math.max(NADE.minSpeed, Math.min(NADE.maxSpeed, sp)); const id = nextNade++;   // the charged throw: the client sends the speed it gathered holding the mouse
    const n = { id, by: p.id, p: [p.x + u[0] * 0.6, p.y - 0.2 + u[1] * 0.6, p.z + u[2] * 0.6], v: [u[0] * sp, u[1] * sp + NADE.loft * sp, u[2] * sp], t: t0 + NADE.fuseMs };
    nades.set(id, n); all({ t: 'nade', id, by: p.id, p: n.p, v: n.v, fuse: NADE.fuseMs });
  }
  // the end of a round: the table of the round goes to everybody, ten seconds later the scores are cleared and the next round starts
  function endRound(team, winner) {
    roundOver = true;
    for (const p of players.values()) if (p.prof) { p.prof.add('rounds'); if (FFA ? p === winner : p.team === team) p.prof.add('wins'); }
    const rows = [...players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, heads: p.st.heads, dmg: Math.round(p.st.dmg), acc: p.st.shots ? Math.round(100 * p.st.hitShots / p.st.shots) : 0 }));
    rows.sort((a, b) => b.kills - a.kills || b.dmg - a.dmg || a.deaths - b.deaths);
    all({ t: 'win', mode: MODE, team, name: FFA ? winner.name : TEAMS[team], score: FFA ? [] : teamScore, rows, mvp: rows.length ? rows[0].id : 0, nextMs: 10000 });
    timers.push(setTimeout(() => { teamScore[0] = teamScore[1] = 0; for (const p of players.values()) { p.kills = p.deaths = 0; p.st = { shots: 0, hitShots: 0, dmg: 0, heads: 0 }; } roundOver = false; sendBoard(); all({ t: 'round' }); all({ t: 'chat', text: 'Новый раунд' }); for (const it of items.values()) { it.active = true; it.respawnAt = 0; all(itemMsg(it)); } }, 10000));
  }
  // ---- bots
  const enemyBase = p => (arena ? (FFA ? arena.bases.flat()[Math.floor(Math.random() * arena.bases.flat().length)] : arena.bases[p.team === 1 ? 0 : 1][Math.floor(Math.random() * arena.bases[p.team === 1 ? 0 : 1].length)]) : null);
  const brain = createBrain({ players, now, world, area, FFA, WEAPONS, R, shoot, throwNade, spawn, roundOver: () => roundOver, enemyBase });
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
          if (players.size >= MAX && !removeBot()) { send(p, { t: 'full' }); conn.close(); return; }
          if (lb && validKey(m.key) && ![...players.values()].some(q => q.key === m.key)) { p.key = m.key; const r = lb.identify(m.key, nameBase(m.name), n => !taken(n)); p.name = r.name; p.prof = r.prof; } else p.name = cleanName(m.name);
          p.team = pickTeam(m.team, p.id); p.char = cleanChar(m.char); p.joined = true; players.set(p.id, p);
          send(p, { t: 'hello', mode: MODE, id: p.id, server: NAME, name: p.name, team: p.team, teams: TEAMS, win: WIN, arena: arena && { name: arena.name, cx: arena.cx, cz: arena.cz, r: arena.r, bases: arena.bases }, rules: { hp: R.hp, range: R.range }, board: board(), score: FFA ? [] : teamScore, items: [...items.values()].filter(i => i.active).map(i => ({ id: i.id, kind: i.kind, x: i.x, z: i.z })), attach: Object.fromEntries([...players.values()].map(q => [q.id, q.attach])) });
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
          p.yaw = num(m.yaw, 100); p.pitch = num(m.pitch, 1.6); p.eye = Math.max(0.9, Math.min(1.8, num(m.h, 1.8) || 1.7)); p.wep = okWeapon(m.w) ? m.w : 0;
          p.hist.push([t0, p.x, p.y, p.z, p.eye, p.yaw]); while (p.hist.length > 2 && t0 - p.hist[0][0] > 1000) p.hist.shift();
        } else if (m.t === 'shoot' && p.alive) shoot(p, okWeapon(m.w) ? m.w : 0, m.rays, 120 + Math.min(300, p.rtt / 2));
        else if (m.t === 'throw') { const d = [num(m.dx, 1), num(m.dy, 1), num(m.dz, 1)], l = Math.hypot(...d); if (l >= 0.5) throwNade(p, d.map(x => x / l), m.sp == null ? NADE.speed : num(m.sp, NADE.maxSpeed)); }
        else if (m.t === 'reload' && p.alive) beginReload(p, okWeapon(m.w) ? m.w : p.wep, t0);
        else if (m.t === 'use' && m.kind === 'med') useMed(p, t0);
        else if (m.t === 'attach') setSight(p, okWeapon(m.w) ? m.w : p.wep, m.kind === 'sight' || m.kind === 'optic' ? m.kind : null);
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
  itemSpots().forEach(([x, z], i) => { const it = { id: nextItem++, kind: ['ammo', 'nade', 'med', 'ammo', 'sight', 'optic'][i % 6], x, z, active: true, respawnAt: 0 }; items.set(it.id, it); });
  function tickItems(t) {
    for (const it of items.values()) {
      if (!it.active) { if (t >= it.respawnAt) { it.active = true; all(itemMsg(it)); } continue; }
      for (const p of players.values()) {
        if (!p.alive || Math.hypot(p.x - it.x, p.z - it.z) > INV.pickR) continue;
        let got = false;
        if (it.kind === 'ammo') { for (let i = 0; i < WEAPONS.length; i++) { const add = Math.min(ITEMS.ammo.give[i], RESERVE[i] * INV.reserveCap - p.reserve[i]); if (add > 0) { p.reserve[i] += add; got = true; } } }
        else if (it.kind === 'nade') { if (p.nades < INV.nadeMax) { p.nades++; got = true; } }
        else if (it.kind === 'med') { if (p.meds < INV.medMax) { p.meds++; got = true; } }
        else if (it.kind === 'sight' || it.kind === 'optic') { if (p.sights[it.kind] + p.attach.filter(a => a === it.kind).length < INV[it.kind + 'Max']) { p.sights[it.kind]++; got = true; } }
        if (!got) continue;   // the pockets are full: the item stays for someone else
        it.active = false; it.respawnAt = t + ITEMS[it.kind].respawnMs;
        all({ t: 'took', id: it.id, kind: it.kind, to: p.id });
        if (p.conn) invMsg(p);
        if (p.bot) for (const k of ['sight', 'optic']) if (p.sights[k] > 0) setSight(p, p.wep, k);   // a bot mounts what it picked, on the weapon in hand
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
  // ---- the clock of the game: snapshots of the world, the grenades in the air, the bots
  let last = now();
  timers.push(setInterval(() => {
    const list = [...players.values()].filter(p => p.alive).map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), +p.eye.toFixed(2), p.wep]);
    if (players.size) all({ t: 'snap', now: now(), p: list });
  }, 1000 / R.tickHz));
  timers.push(setInterval(() => { for (const p of players.values()) if (p.prof) p.prof.add('secs'); }, 1000));   // the time played
  function stepNades() { const t = now(); for (const n of [...nades.values()]) { world.stepNade(n, 1 / 30, NADE.g); if (t >= n.t) explode(n); } }
  timers.push(setInterval(stepNades, 1000 / 30));
  timers.push(setInterval(() => advanceBullets(now()), 1000 / 30));   // the bullets in the air fly on the same clock
  timers.push(setInterval(() => { const t = now(), dt = Math.min(0.2, (t - last) / 1000); last = t; for (const p of [...players.values()]) if (p.bot) brain.think(p, dt); }, 50));
  return {
    attach, addBot, removeBot, players, arena, mode: MODE,
    stepBullets: () => advanceBullets(now()),   // the tests drive the flight by their own clock
    stepNades,   // the tests drive the fuse by their own clock too
    stop() { for (const t of timers) { clearInterval(t); clearTimeout(t); } timers.length = 0; },
    health() { return { ok: true, mode: MODE, name: NAME, players: humans().length, bots: players.size - humans().length, max: MAX, score: teamScore, win: WIN, teams: TEAMS, round: roundOver ? 'end' : 'play', arena: arena ? arena.name : null, leaderboard: !!lb }; },
  };
}
export { LEVELS };
