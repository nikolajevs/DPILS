/* The game itself: team deathmatch (red against blue) or MODE=ffa (everybody against everybody), with or without an arena
   (a play area with a base for each team), with or without bots. It knows nothing of the network: a connection is any
   object with send(string) and close(); the Node server (index.mjs) gives it WebSockets, and the page gives it a local
   one for the game against bots with no server at all (src/game/local.js). Players move on their own machines (the game
   limits their speed and keeps them in the arena); the game owns health, shots, kills, scores and respawns. It reads the
   city through `world` (freePath, ground, walkable, buildingAt, stepNade): a shot that would pass through a building does
   not hit, and its tracer stops at the wall. Hits are checked against fire rate, range and the target's position as the
   game knows it. */
import { NADE, RULES as R, WEAPONS, W_NADE, rayToSegment } from './combat.mjs';
import { LEVELS, botName, createBrain } from './bots.mjs';
import { validKey } from './leaderboard.mjs';

const TEAMS = ['Красные', 'Синие'], HX = 5200, HY = 4200;   // bounds a bit wider than the city
const num = (v, lim) => (typeof v === 'number' && isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
const okWeapon = w => Number.isInteger(w) && w >= 0 && w < WEAPONS.length;

export function createGame(opts) {
  const world = opts.world, FFA = opts.mode === 'ffa', MODE = FFA ? 'ffa' : 'team', WIN = opts.win || (FFA ? 20 : 30), NAME = opts.name || 'Даугавпилс', MAX = opts.maxPlayers || R.maxPlayers;
  const now = opts.now || (() => Date.now()), teamScore = [0, 0], players = new Map();
  let nextId = 1, roundOver = false, nextNade = 1;
  const nades = new Map(), timers = [];
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
  const lb = opts.board || null;   // the leaderboard (leaderboard.mjs): only the humans who sent a key are in it
  const board = () => [...players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, bot: !!p.bot }));
  const sendBoard = () => all({ t: 'board', board: board(), score: FFA ? [] : teamScore });
  const count = k => [...players.values()].filter(p => p.team === k).length;
  function pickTeam(want, id) {
    if (FFA) return id; const a = count(0), b = count(1); if (a !== b) return a < b ? 0 : 1; return want === 0 || want === 1 ? want : Math.random() < 0.5 ? 0 : 1;
  }
  const newPlayer = () => ({ id: nextId++, conn: null, bot: null, name: '', team: 0, joined: false, x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, hp: 0, alive: false, kills: 0, deaths: 0, st: { shots: 0, hitShots: 0, dmg: 0, heads: 0 }, wep: 0, lastShot: 0, lastNade: 0, nades: 0, lastChat: 0, rwin: 0, rmsgs: 0, eye: 1.7, rtt: 80, hist: [], diedAt: 0, protectUntil: 0, t: 0, msgs: 0, win: now() });
  // where the player stood at time t (the shooter saw the target 120 ms in the past plus half the round trip)
  function poseAt(p, t) {
    const h = p.hist; if (!h.length || t >= h[h.length - 1][0]) return [p.x, p.y, p.z];
    if (t <= h[0][0]) return [h[0][1], h[0][2], h[0][3]];
    for (let i = h.length - 1; i > 0; i--) if (h[i - 1][0] <= t) { const a = h[i - 1], b = h[i], k = (t - a[0]) / Math.max(1, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k]; }
    return [p.x, p.y, p.z];
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
    send(p, { t: 'spawn', x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, nades: p.nades }); all({ t: 'alive', id: p.id });
  }
  // damage dmg from attacker p to v (weapon w; from = where it came from): the hit and the hurt messages, and the kill
  function hurt(p, v, dmg, head, w, from) {
    if (!v.alive || dmg <= 0) return; const t0 = now();
    v.hp -= dmg; if (p !== v) { const d = dmg + Math.min(0, v.hp); p.st.dmg += d; if (p.prof) p.prof.add('dmg', d); } send(v, { t: 'hurt', by: p.id, hp: Math.max(0, v.hp), dx: from[0] - v.x, dz: from[2] - v.z }); if (p !== v) send(p, { t: 'hit', id: v.id, head, kill: v.hp <= 0, dmg: Math.min(dmg, dmg + Math.min(0, v.hp)) });
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
      const c = [v.x, v.y - 0.7, v.z], o = [n.p[0], n.p[1] + 0.3, n.p[2]], dx = c[0] - o[0], dy = c[1] - o[1], dz = c[2] - o[2], d = Math.hypot(dx, dy, dz);
      if (d >= NADE.radius || (v !== thrower && now() <= v.protectUntil)) continue;
      if (d > 0.6 && world.freePath(o, [dx / d, dy / d, dz / d], d) < d - 0.7) continue;   // a wall between the blast and the player
      hurt(thrower, v, Math.round(NADE.dmg * (1 - d / NADE.radius) * (v === thrower ? NADE.self : 1)), false, W_NADE, n.p);
    }
  }
  // a shot of p with weapon wi: rays [[dx, dy, dz, length, claimed target id], ...]; lagMs: how far back the targets are looked at (0 for a bot)
  function shoot(p, wi, rays, lagMs) {
    const W = WEAPONS[wi], t0 = now(); if (!Array.isArray(rays) || !rays.length || !p.alive) return;
    if (t0 - p.lastShot < W.gapMs) return; p.lastShot = t0;
    const o = [p.x, p.y, p.z], out = [], hits = new Map(), lag = t0 - lagMs;
    for (const ray of rays.slice(0, W.pellets)) {   // a rifle shot is one ray, a shotgun shot is up to eight pellets
      if (!Array.isArray(ray)) continue;
      const d = [num(ray[0], 1), num(ray[1], 1), num(ray[2], 1)], l = Math.hypot(...d); if (l < 0.5) continue; d.forEach((x, i) => d[i] = x / l);
      const wall = world.freePath(o, d, W.range), len = Math.min(wall, Math.max(1, num(ray[3], W.range))); out.push([+d[0].toFixed(4), +d[1].toFixed(4), +d[2].toFixed(4), +len.toFixed(1)]);
      const v = ray[4] && players.get(+ray[4]);
      if (!v || v === p || v.team === p.team || !v.alive || t0 <= v.protectUntil || roundOver) continue;
      const [vx, vy, vz] = poseAt(v, lag), r = rayToSegment(o, d, W.range, [vx, vy - v.eye + 0.1, vz], [vx, vy + R.bodyTop, vz]);
      if (r.dist > R.tolerance || r.t > wall + 0.5) continue;
      const head = rayToSegment(o, d, len, [vx, vy - 0.1, vz], [vx, vy + 0.1, vz]).dist <= R.headTolerance, k = 1 - W.falloff * Math.min(1, r.t / W.range), h = hits.get(v.id) || { v, dmg: 0, head: false };
      h.dmg += (head ? W.head : W.dmg) * k; h.head = h.head || head; hits.set(v.id, h);
    }
    if (!out.length) return;
    p.st.shots++; if (hits.size) p.st.hitShots++; if (p.prof) { p.prof.add('shots'); if (hits.size) p.prof.add('hits'); }
    all({ t: 'shot', id: p.id, w: wi, o, rays: out });
    for (const { v, dmg, head } of hits.values()) hurt(p, v, Math.round(dmg), head, wi, o);
  }
  function throwNade(p, u) {
    const t0 = now(); if (!p.alive || p.nades <= 0 || t0 - p.lastNade < NADE.cooldownMs || roundOver) return;
    p.nades--; p.lastNade = t0; const sp = NADE.speed, id = nextNade++;
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
    timers.push(setTimeout(() => { teamScore[0] = teamScore[1] = 0; for (const p of players.values()) { p.kills = p.deaths = 0; p.st = { shots: 0, hitShots: 0, dmg: 0, heads: 0 }; } roundOver = false; sendBoard(); all({ t: 'round' }); all({ t: 'chat', text: 'Новый раунд' }); }, 10000));
  }
  // ---- bots
  const enemyBase = p => (arena ? (FFA ? arena.bases.flat()[Math.floor(Math.random() * arena.bases.flat().length)] : arena.bases[p.team === 1 ? 0 : 1][Math.floor(Math.random() * arena.bases[p.team === 1 ? 0 : 1].length)]) : null);
  const brain = createBrain({ players, now, world, area, FFA, WEAPONS, R, shoot, throwNade, spawn, roundOver: () => roundOver, enemyBase });
  let botN = 0;
  function addBot(level) {
    if (players.size >= MAX) return null;
    const p = newPlayer(); let nm = botName(botN++); while ([...players.values()].some(q => q.name === nm)) nm = botName(botN++); p.name = nm; p.team = pickTeam(-1, p.id); p.joined = true; brain.make(level || opts.level, p); players.set(p.id, p);
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
          p.team = pickTeam(m.team, p.id); p.joined = true; players.set(p.id, p);
          send(p, { t: 'hello', mode: MODE, id: p.id, server: NAME, name: p.name, team: p.team, teams: TEAMS, win: WIN, arena: arena && { name: arena.name, cx: arena.cx, cz: arena.cz, r: arena.r, bases: arena.bases }, rules: { hp: R.hp, range: R.range }, board: board(), score: FFA ? [] : teamScore });
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
          p.hist.push([t0, p.x, p.y, p.z]); while (p.hist.length > 2 && t0 - p.hist[0][0] > 1000) p.hist.shift();
        } else if (m.t === 'shoot' && p.alive) shoot(p, okWeapon(m.w) ? m.w : 0, m.rays, 120 + Math.min(300, p.rtt / 2));
        else if (m.t === 'throw') { const d = [num(m.dx, 1), num(m.dy, 1), num(m.dz, 1)], l = Math.hypot(...d); if (l >= 0.5) throwNade(p, d.map(x => x / l)); }
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
  // ---- the clock of the game: snapshots of the world, the grenades in the air, the bots
  let last = now();
  timers.push(setInterval(() => {
    const list = [...players.values()].filter(p => p.alive).map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), +p.eye.toFixed(2), p.wep]);
    if (players.size) all({ t: 'snap', now: now(), p: list });
  }, 1000 / R.tickHz));
  timers.push(setInterval(() => { for (const p of players.values()) if (p.prof) p.prof.add('secs'); }, 1000));   // the time played
  timers.push(setInterval(() => { const t = now(); for (const n of [...nades.values()]) { world.stepNade(n, 1 / 30, NADE.g); if (t >= n.t) explode(n); } }, 1000 / 30));
  timers.push(setInterval(() => { const t = now(), dt = Math.min(0.2, (t - last) / 1000); last = t; for (const p of [...players.values()]) if (p.bot) brain.think(p, dt); }, 50));
  return {
    attach, addBot, removeBot, players, arena, mode: MODE,
    stop() { for (const t of timers) { clearInterval(t); clearTimeout(t); } timers.length = 0; },
    health() { return { ok: true, mode: MODE, name: NAME, players: humans().length, bots: players.size - humans().length, max: MAX, score: teamScore, win: WIN, teams: TEAMS, round: roundOver ? 'end' : 'play', arena: arena ? arena.name : null, leaderboard: !!lb }; },
  };
}
export { LEVELS };
