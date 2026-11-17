/* Daugavpils shooter: the game server. Players move on their own machines (the server limits speed and keeps them in
   the city box); the server owns health, shots, kills, scores and respawns. Whether a wall stands between the
   shooter and the target is decided by the shooter's client, which has the city: the server only checks that the
   shot is plausible (fire rate, range, ray passes by the target's position as the server knows it). */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { RULES as R, rayToSegment } from './combat.mjs';

const PORT = +process.env.PORT || 8787, HX = 5200, HY = 4200;   // bounds a bit wider than the city
let nextId = 1; const players = new Map(), now = () => Date.now();
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ ok: true, players: players.size, max: R.maxPlayers })); return; }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });
const send = (p, m) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); };
const all = m => { const s = JSON.stringify(m); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
const num = (v, lim) => (typeof v === 'number' && isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
function cleanName(s) {
  let n = String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Игрок', base = n, k = 2;
  while ([...players.values()].some(p => p.name === n)) n = base.slice(0, 13) + '#' + k++;
  return n;
}
const board = () => [...players.values()].map(p => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths }));
function spawn(p, x, z, yaw) {
  p.x = num(x, HX); p.z = num(z, HY); p.y = 1.7; p.yaw = num(yaw, 10); p.pitch = 0; p.hp = R.hp; p.alive = true; p.protectUntil = now() + R.protectMs; p.t = now(); p.free = true;
  send(p, { t: 'spawn', x: p.x, z: p.z, yaw: p.yaw, hp: p.hp }); all({ t: 'alive', id: p.id });
}
wss.on('connection', ws => {
  ws.since = Date.now(); ws.joined = false;
  const p = { id: nextId++, ws, name: '', joined: false, x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, hp: 0, alive: false, kills: 0, deaths: 0, lastShot: 0, diedAt: 0, protectUntil: 0, t: 0, msgs: 0, win: now(), live: true };
  ws.on('pong', () => { p.live = true; });
  ws.on('message', raw => {
    const t0 = now(); if (t0 - p.win > 1000) { p.win = t0; p.msgs = 0; } if (++p.msgs > 90) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join' && !p.joined) {
      if (players.size >= R.maxPlayers) { send(p, { t: 'full' }); ws.close(); return; }
      p.name = cleanName(m.name); p.joined = ws.joined = true; players.set(p.id, p);
      send(p, { t: 'hello', id: p.id, name: p.name, rules: { hp: R.hp, range: R.range }, board: board() });
      spawn(p, m.x, m.z, m.yaw); all({ t: 'board', board: board() }); all({ t: 'chat', text: p.name + ' в игре' });
      return;
    }
    if (!p.joined) return;
    if (m.t === 'state' && p.alive) {
      const dt = Math.max(0.02, Math.min(0.5, (t0 - p.t) / 1000)); p.t = t0;
      const x = num(m.x, HX), z = num(m.z, HY), y = Math.max(-50, Math.min(400, num(m.y, 400)));
      const far = Math.hypot(x - p.x, z - p.z), first = p.free && far < 80; p.free = false;   // right after a spawn the client may nudge itself off a wall or out of the water
      if (!first && far > R.runSpeed * dt * 1.6 + 3) send(p, { t: 'correct', x: p.x, y: p.y, z: p.z });   // too fast: put back
      else { p.x = x; p.z = z; p.y = y; }
      p.yaw = num(m.yaw, 100); p.pitch = num(m.pitch, 1.6);
    } else if (m.t === 'shoot' && p.alive) {
      if (t0 - p.lastShot < R.fireGapMs) return; p.lastShot = t0;
      const d = [num(m.dx, 1), num(m.dy, 1), num(m.dz, 1)], l = Math.hypot(...d); if (l < 0.5) return; d.forEach((v, i) => d[i] = v / l);
      const o = [p.x, p.y, p.z], len = Math.min(R.range, Math.max(1, num(m.len, R.range)));
      all({ t: 'shot', id: p.id, o, d, len });
      const v = m.hit && players.get(+m.hit);
      if (v && v !== p && v.alive && t0 > v.protectUntil) {
        const a = [v.x, v.y - R.bodyBottom, v.z], b = [v.x, v.y + R.bodyTop, v.z], r = rayToSegment(o, d, len, a, b);
        if (r.dist <= R.tolerance) {
          const head = rayToSegment(o, d, len, [v.x, v.y - 0.1, v.z], [v.x, v.y + 0.1, v.z]).dist <= R.headTolerance, dmg = head ? R.headDmg : R.bodyDmg;
          v.hp -= dmg; send(v, { t: 'hurt', by: p.id, hp: Math.max(0, v.hp), dx: o[0] - v.x, dz: o[2] - v.z }); send(p, { t: 'hit', id: v.id, head, kill: v.hp <= 0 });
          if (v.hp <= 0) { v.alive = false; v.deaths++; p.kills++; v.diedAt = t0; all({ t: 'kill', killer: p.id, victim: v.id, kn: p.name, vn: v.name, head }); all({ t: 'board', board: board() }); }
        }
      }
    } else if (m.t === 'respawn' && !p.alive && t0 - p.diedAt >= R.respawnMs) spawn(p, m.x, m.z, m.yaw);
  });
  ws.on('close', () => { if (p.joined && players.delete(p.id)) { all({ t: 'left', id: p.id }); all({ t: 'board', board: board() }); all({ t: 'chat', text: p.name + ' вышел' }); } });
  ws.on('error', () => {});
});
setInterval(() => {
  const list = [...players.values()].filter(p => p.alive).map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3)]);
  if (players.size) all({ t: 'snap', now: now(), p: list });
}, 1000 / R.tickHz);
setInterval(() => { for (const c of wss.clients) if (!c.joined && Date.now() - c.since > 15000) c.terminate(); for (const p of players.values()) { if (!p.live) { p.ws.terminate(); continue; } p.live = false; p.ws.ping(); } }, 15000);
server.listen(PORT, () => console.log('Daugavpils shooter server on :' + PORT));
