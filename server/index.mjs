/* Daugavpils shooter: the game server (team deathmatch, red against blue). Players move on their own machines (the server limits speed and keeps them in
   the city box); the server owns health, shots, kills, scores and respawns. The server also reads the
   city (server/world.mjs): a shot that would have to pass through a building does not hit, and its tracer stops at
   the wall. Hits are checked against fire rate, range and the target's position as the server knows it. */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { NADE, RULES as R, WEAPONS, rayToSegment } from './combat.mjs';
import { loadWorld } from './world.mjs';

const PORT = +process.env.PORT || 8787, HX = 5200, HY = 4200;   // bounds a bit wider than the city
const WORLD = loadWorld(), WIN = 30, TEAMS = ['Красные', 'Синие'], teamScore = [0, 0];
let nextId = 1, roundOver = false; const players = new Map(), now = () => Date.now();
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: true, players: players.size, max: R.maxPlayers })); return; }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 16384 });
const send = (p, m) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); };
const all = m => { const s = JSON.stringify(m); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
const num = (v, lim) => (typeof v === 'number' && isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
function cleanName(s) {
  let n = String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Игрок', base = n, k = 2;
  while ([...players.values()].some(p => p.name === n)) n = base.slice(0, 13) + '#' + k++;
  return n;
}
const board = () => [...players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths }));
const sendBoard = () => all({ t: 'board', board: board(), score: teamScore });
const count = k => [...players.values()].filter(p => p.team === k).length;
function pickTeam(want) { const a = count(0), b = count(1); if (a !== b) return a < b ? 0 : 1; return want === 0 || want === 1 ? want : Math.random() < 0.5 ? 0 : 1; }
// where the player stood at time t (the shooter saw the target 120 ms in the past plus half the round trip)
function poseAt(p, t) {
  const h = p.hist; if (!h.length || t >= h[h.length - 1][0]) return [p.x, p.y, p.z];
  if (t <= h[0][0]) return [h[0][1], h[0][2], h[0][3]];
  for (let i = h.length - 1; i > 0; i--) if (h[i - 1][0] <= t) { const a = h[i - 1], b = h[i], k = (t - a[0]) / Math.max(1, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k]; }
  return [p.x, p.y, p.z];
}
function spawn(p, x, z, yaw) {
  p.x = num(x, HX); p.z = num(z, HY); p.y = 1.7; p.yaw = num(yaw, 10); p.pitch = 0; p.hp = R.hp; p.alive = true; p.protectUntil = now() + R.protectMs; p.t = now(); p.free = true; p.hist.length = 0; p.nades = NADE.count;
  send(p, { t: 'spawn', x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, nades: p.nades }); all({ t: 'alive', id: p.id });
}
// damage dmg from attacker p to v (weapon w; from = where it came from): the hit and the hurt messages, and the kill
function hurt(p, v, dmg, head, w, from) {
  if (!v.alive || dmg <= 0) return; const t0 = now();
  v.hp -= dmg; send(v, { t: 'hurt', by: p.id, hp: Math.max(0, v.hp), dx: from[0] - v.x, dz: from[2] - v.z }); if (p !== v) send(p, { t: 'hit', id: v.id, head, kill: v.hp <= 0 });
  if (v.hp > 0) return;
  v.alive = false; v.deaths++; v.diedAt = t0; if (p !== v) { p.kills++; teamScore[p.team]++; }
  all({ t: 'kill', killer: p.id, victim: v.id, kn: p.name, vn: v.name, kt: p.team, vt: v.team, head, w }); sendBoard();
  if (p !== v && teamScore[p.team] >= WIN) endRound(p.team);
}
// grenades in the air: the server flies them (the clients draw their own copy) and decides where and when they go off
const nades = new Map(); let nextNade = 1;
function explode(n) {
  nades.delete(n.id); all({ t: 'boom', id: n.id, x: n.p[0], y: n.p[1], z: n.p[2] });
  if (roundOver) return; const thrower = players.get(n.by);
  for (const v of players.values()) {
    if (!v.alive || !thrower) continue; if (v.team === thrower.team && v !== thrower) continue;
    const c = [v.x, v.y - 0.7, v.z], o = [n.p[0], n.p[1] + 0.3, n.p[2]], dx = c[0] - o[0], dy = c[1] - o[1], dz = c[2] - o[2], d = Math.hypot(dx, dy, dz);
    if (d >= NADE.radius || (v !== thrower && now() <= v.protectUntil)) continue;
    if (d > 0.6 && WORLD.freePath(o, [dx / d, dy / d, dz / d], d) < d - 0.7) continue;   // a wall between the blast and the player
    hurt(thrower, v, Math.round(NADE.dmg * (1 - d / NADE.radius) * (v === thrower ? NADE.self : 1)), false, 3, n.p);
  }
}
wss.on('connection', ws => {
  ws.since = Date.now(); ws.joined = false;
  const p = { id: nextId++, ws, name: '', team: 0, joined: false, x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, hp: 0, alive: false, kills: 0, deaths: 0, lastShot: 0, lastNade: 0, nades: 0, lastChat: 0, rwin: 0, rmsgs: 0, eye: 1.7, rtt: 80, hist: [], diedAt: 0, protectUntil: 0, t: 0, msgs: 0, win: now(), live: true };
  ws.on('pong', () => { p.live = true; });
  ws.on('message', raw => {
    const t0 = now(); if (t0 - p.win > 1000) { p.win = t0; p.msgs = 0; }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t !== 'rtc' && ++p.msgs > 90) return;   // the handshake of the voice chat has its own, larger limit
    if (m.t === 'join' && !p.joined) {
      if (players.size >= R.maxPlayers) { send(p, { t: 'full' }); ws.close(); return; }
      p.name = cleanName(m.name); p.team = pickTeam(m.team); p.joined = ws.joined = true; players.set(p.id, p);
      send(p, { t: 'hello', id: p.id, name: p.name, team: p.team, teams: TEAMS, win: WIN, rules: { hp: R.hp, range: R.range }, board: board(), score: teamScore });
      spawn(p, m.x, m.z, m.yaw); sendBoard(); all({ t: 'chat', text: p.name + ' в игре, ' + TEAMS[p.team] });
      return;
    }
    if (!p.joined) return;
    if (m.t === 'state' && p.alive) {
      const dt = Math.max(0.02, Math.min(0.5, (t0 - p.t) / 1000)); p.t = t0;
      const x = num(m.x, HX), z = num(m.z, HY), y = Math.max(-50, Math.min(400, num(m.y, 400)));
      const far = Math.hypot(x - p.x, z - p.z), first = p.free && far < 80; p.free = false;   // right after a spawn the client may nudge itself off a wall or out of the water
      if (!first && far > R.runSpeed * dt * 1.6 + 3) send(p, { t: 'correct', x: p.x, y: p.y, z: p.z });   // too fast: put back
      else { p.x = x; p.z = z; p.y = y; }
      p.yaw = num(m.yaw, 100); p.pitch = num(m.pitch, 1.6); p.eye = Math.max(0.9, Math.min(1.8, num(m.h, 1.8) || 1.7));
      p.hist.push([t0, p.x, p.y, p.z]); while (p.hist.length > 2 && t0 - p.hist[0][0] > 1000) p.hist.shift();
    } else if (m.t === 'shoot' && p.alive) {
      const wi = m.w === 1 || m.w === 2 ? m.w : 0, W = WEAPONS[wi]; if (!Array.isArray(m.rays) || !m.rays.length) return;
      if (t0 - p.lastShot < W.gapMs) return; p.lastShot = t0;
      const o = [p.x, p.y, p.z], out = [], hits = new Map(), lag = t0 - 120 - Math.min(300, p.rtt / 2);
      for (const ray of m.rays.slice(0, W.pellets)) {   // a rifle shot is one ray, a shotgun shot is up to eight pellets
        if (!Array.isArray(ray)) continue;
        const d = [num(ray[0], 1), num(ray[1], 1), num(ray[2], 1)], l = Math.hypot(...d); if (l < 0.5) continue; d.forEach((x, i) => d[i] = x / l);
        const wall = WORLD.freePath(o, d, W.range), len = Math.min(wall, Math.max(1, num(ray[3], W.range))); out.push([+d[0].toFixed(4), +d[1].toFixed(4), +d[2].toFixed(4), +len.toFixed(1)]);
        const v = ray[4] && players.get(+ray[4]);
        if (!v || v === p || v.team === p.team || !v.alive || t0 <= v.protectUntil || roundOver) continue;
        const [vx, vy, vz] = poseAt(v, lag), r = rayToSegment(o, d, W.range, [vx, vy - v.eye + 0.1, vz], [vx, vy + R.bodyTop, vz]);
        if (r.dist > R.tolerance || r.t > wall + 0.5) continue;
        const head = rayToSegment(o, d, len, [vx, vy - 0.1, vz], [vx, vy + 0.1, vz]).dist <= R.headTolerance, k = 1 - W.falloff * Math.min(1, r.t / W.range), h = hits.get(v.id) || { v, dmg: 0, head: false };
        h.dmg += (head ? W.head : W.dmg) * k; h.head = h.head || head; hits.set(v.id, h);
      }
      if (!out.length) return;
      all({ t: 'shot', id: p.id, w: wi, o, rays: out });
      for (const { v, dmg, head } of hits.values()) hurt(p, v, Math.round(dmg), head, wi, o);
    } else if (m.t === 'throw' && p.alive && p.nades > 0 && t0 - p.lastNade >= NADE.cooldownMs && !roundOver) {
      const d = [num(m.dx, 1), num(m.dy, 1), num(m.dz, 1)], l = Math.hypot(...d); if (l < 0.5) return;
      p.nades--; p.lastNade = t0; const u = d.map(x => x / l), sp = NADE.speed, id = nextNade++;
      const n = { id, by: p.id, p: [p.x + u[0] * 0.6, p.y - 0.2 + u[1] * 0.6, p.z + u[2] * 0.6], v: [u[0] * sp, u[1] * sp + NADE.loft * sp, u[2] * sp], t: t0 + NADE.fuseMs };
      nades.set(id, n); all({ t: 'nade', id, by: p.id, p: n.p, v: n.v, fuse: NADE.fuseMs });
    } else if (m.t === 'chat') {
      const text = String(m.text || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (!text || t0 - p.lastChat < 700) return; p.lastChat = t0;
      const say = { t: 'say', id: p.id, name: p.name, team: p.team, text, teamOnly: !!m.team };
      if (m.team) { for (const q of players.values()) if (q.team === p.team) send(q, say); } else all(say);
    } else if (m.t === 'rtc') {   // voice chat: the server only passes the WebRTC handshake between two players
      const q = players.get(+m.to); if (!q || q === p || !m.d || typeof m.d !== 'object') return;
      if (t0 - p.rwin > 1000) { p.rwin = t0; p.rmsgs = 0; } if (++p.rmsgs > 400) return;
      send(q, { t: 'rtc', from: p.id, d: m.d });
    } else if (m.t === 'ping') { p.rtt = Math.max(0, Math.min(1000, num(m.rtt, 1000))); send(p, { t: 'pong', c: m.c });
    } else if (m.t === 'respawn' && !p.alive && t0 - p.diedAt >= R.respawnMs) {
      const mate = m.mate && [...players.values()].filter(q => q.alive && q.team === p.team && q !== p);
      if (mate && mate.length) { const q = mate[Math.floor(Math.random() * mate.length)], a = Math.random() * 6.283, r = 6 + Math.random() * 8; spawn(p, q.x + Math.cos(a) * r, q.z + Math.sin(a) * r, q.yaw); }   // next to a teammate
      else spawn(p, m.x, m.z, m.yaw);
    }
  });
  ws.on('close', () => { if (p.joined && players.delete(p.id)) { all({ t: 'left', id: p.id }); sendBoard(); all({ t: 'chat', text: p.name + ' вышел' }); } });
  ws.on('error', () => {});
});
function endRound(team) {
  roundOver = true; all({ t: 'win', team, name: TEAMS[team], score: teamScore });
  setTimeout(() => { teamScore[0] = teamScore[1] = 0; for (const p of players.values()) { p.kills = p.deaths = 0; } roundOver = false; sendBoard(); all({ t: 'chat', text: 'Новый раунд' }); }, 10000);
}
setInterval(() => {
  const list = [...players.values()].filter(p => p.alive).map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), +p.eye.toFixed(2)]);
  if (players.size) all({ t: 'snap', now: now(), p: list });
}, 1000 / R.tickHz);
setInterval(() => { const t = now(); for (const n of [...nades.values()]) { WORLD.stepNade(n, 1 / 30, NADE.g); if (t >= n.t) explode(n); } }, 1000 / 30);
setInterval(() => { for (const c of wss.clients) if (!c.joined && Date.now() - c.since > 15000) c.terminate(); for (const p of players.values()) { if (!p.live) { p.ws.terminate(); continue; } p.live = false; p.ws.ping(); } }, 15000);
server.listen(PORT, () => console.log('Daugavpils shooter server on :' + PORT));
