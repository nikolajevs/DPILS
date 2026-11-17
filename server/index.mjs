/* Daugavpils shooter: the game server. The rules are in game.mjs (team deathmatch, or MODE=ffa: everybody against
   everybody; an arena with bases for the teams, ARENA=center|fortress|station|park|church|pond|speedway|culture|griva; bots, BOTS=6 and BOT_LEVEL=easy|normal|hard,
   fill the empty places). This file is the network: WebSockets for the players and /health for the list of servers.
     PORT, SERVER_NAME, MODE, WIN_SCORE, ARENA, BOTS, BOT_LEVEL, LEADERBOARD (file of the leaderboard, default server/data/leaderboard.json; off = none) */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { loadWorld } from './world.mjs';
import { ARENAS } from './arenas.mjs';
import { createGame } from './game.mjs';
import { createBoard } from './leaderboard.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = +process.env.PORT || 8787, WORLD = loadWorld();
const LB = process.env.LEADERBOARD === 'off' ? null : createBoard({ file: process.env.LEADERBOARD || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'leaderboard.json') });
const game = createGame({ board: LB, world: WORLD, mode: process.env.MODE === 'ffa' ? 'ffa' : 'team', win: +process.env.WIN_SCORE || 0, name: String(process.env.SERVER_NAME || 'Даугавпилс').slice(0, 40), arena: ARENAS[process.env.ARENA] || null, level: process.env.BOT_LEVEL || 'normal' });
for (let i = 0; i < Math.max(0, Math.min(15, +process.env.BOTS || 0)); i++) game.addBot();
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(game.health())); return; }
  if (LB && req.url.startsWith('/leaderboard')) {   // ?period=all|week&sort=kills|kd|acc|wins&limit=50&me=<id: sha256 of the key, 32 hex>
    const q = new URL(req.url, 'http://x').searchParams, me = q.get('me');
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'max-age=5' });
    res.end(JSON.stringify(LB.top({ period: q.get('period') === 'week' ? 'week' : 'all', sort: q.get('sort') || 'kills', limit: +q.get('limit') || 50, me: /^[0-9a-f]{32}$/.test(me || '') ? me : '' }))); return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 16384 });
wss.on('connection', ws => {
  ws.since = Date.now(); ws.live = true;
  const h = game.attach({ send: s => { if (ws.readyState === 1) ws.send(s); }, close: () => ws.close() });
  ws.h = h;
  ws.on('pong', () => { ws.live = true; });
  ws.on('message', raw => h.message(raw.toString()));
  ws.on('close', () => h.close());
  ws.on('error', () => {});
});
setInterval(() => { for (const c of wss.clients) { if (!c.h.joined && Date.now() - c.since > 15000) { c.terminate(); continue; } if (!c.live) { c.terminate(); continue; } c.live = false; c.ping(); } }, 15000);
server.listen(PORT, () => console.log('Daugavpils shooter server on :' + PORT + (game.arena ? ', arena ' + game.arena.name : '') + (process.env.BOTS ? ', bots ' + process.env.BOTS : '')));

if (LB) {   // the table is saved every 20 s and when the server is stopped
  setInterval(() => LB.save(), 20000);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { LB.save(); process.exit(0); });
}
