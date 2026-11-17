/* Daugavpils shooter: the game server. The rules are in game.mjs (team deathmatch, or MODE=ffa: everybody against
   everybody; an arena with bases for the teams, ARENA=center|fortress|station|park|church|pond|speedway|culture|griva; bots, BOTS=6 and BOT_LEVEL=easy|normal|hard,
   fill the empty places). This file is the network: WebSockets for the players and /health for the list of servers.
     PORT, SERVER_NAME, MODE, WIN_SCORE, ARENA, BOTS, BOT_LEVEL, LEADERBOARD (file of the leaderboard, default server/data/leaderboard.json; off = none),
     ACCOUNTS (file of the accounts, default server/data/accounts.json; off = none: the page then plays without accounts only),
     STATIC (a folder, e.g. dist after npm run build: the server also gives out the page, so the city and its server live on one address) */
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { loadWorld } from './world.mjs';
import { ARENAS } from './arenas.mjs';
import { createGame } from './game.mjs';
import { createBoard } from './leaderboard.mjs';
import { createAccounts } from './accounts.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = +process.env.PORT || 8787, WORLD = loadWorld();
const LB = process.env.LEADERBOARD === 'off' ? null : createBoard({ file: process.env.LEADERBOARD || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'leaderboard.json') });
const ACC = process.env.ACCOUNTS === 'off' ? null : createAccounts({ file: process.env.ACCOUNTS || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'accounts.json') });
const game = createGame({ board: LB, world: WORLD, mode: process.env.MODE === 'ffa' ? 'ffa' : 'team', win: +process.env.WIN_SCORE || 0, name: String(process.env.SERVER_NAME || 'Даугавпилс').slice(0, 40), arena: ARENAS[process.env.ARENA] || null, level: process.env.BOT_LEVEL || 'normal' });
for (let i = 0; i < Math.max(0, Math.min(15, +process.env.BOTS || 0)); i++) game.addBot();

/* the page itself (STATIC=dist): files of the folder, / is index.html; the bundle in assets/ has hashes in its names
   and is cached for long, the rest (the page, the city data, servers.json) is checked every time */
const STATIC = process.env.STATIC ? path.resolve(process.env.STATIC) : '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' };
function serveFile(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(STATIC, rel);
  if (file !== STATIC && !file.startsWith(STATIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size,
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'last-modified': st.mtime.toUTCString() });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

/* accounts: /auth/register and /auth/login take {name, pass} and answer {ok, name, key}; /auth/me?key= checks a key.
   The page lives on another address (GitHub Pages), so the answers carry the CORS headers; OPTIONS is the preflight.
   A simple limit per address: 30 attempts in 10 minutes, so a password cannot be guessed fast. */
const hits = new Map();
function rateOk(ip) {
  const t = Date.now(); let h = hits.get(ip);
  if (!h || t - h.t > 600000) { h = { n: 0, t }; hits.set(ip, h); }
  if (hits.size > 4096) for (const [k, v] of hits) if (t - v.t > 600000) hits.delete(k);
  return ++h.n <= 30;
}
function authReply(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
function authRoute(req, res) {
  const url = new URL(req.url, 'http://x');
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }); res.end(); return; }
  if (!ACC) { authReply(res, 501, { ok: false, error: 'off' }); return; }
  if (url.pathname === '/auth/me' && req.method === 'GET') {
    const r = ACC.byKey(url.searchParams.get('key') || '');
    if (!r) { authReply(res, 401, { ok: false, error: 'no-account' }); return; }
    authReply(res, 200, { ok: true, name: r.name }); return;
  }
  if ((url.pathname === '/auth/register' || url.pathname === '/auth/login') && req.method === 'POST') {
    if (!rateOk(req.socket.remoteAddress || '?')) { authReply(res, 429, { ok: false, error: 'rate' }); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) { authReply(res, 413, { ok: false, error: 'bad-request' }); req.destroy(); } });
    req.on('end', () => {
      if (res.writableEnded) return;
      let m; try { m = JSON.parse(body || '{}'); } catch (e) { authReply(res, 400, { ok: false, error: 'bad-request' }); return; }
      const r = url.pathname === '/auth/register' ? ACC.register(m.name, m.pass) : ACC.login(m.name, m.pass);
      if (r.error) { authReply(res, r.error === 'taken' ? 409 : r.error === 'bad-login' ? 401 : 400, { ok: false, error: r.error }); return; }
      ACC.save();
      authReply(res, 200, { ok: true, name: r.name, key: r.key });
    });
    return;
  }
  authReply(res, 404, { ok: false, error: 'bad-request' });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(game.health())); return; }
  if (req.url.split('?')[0].startsWith('/auth/')) { authRoute(req, res); return; }
  if (LB && req.url.startsWith('/leaderboard')) {   // ?period=all|week&sort=kills|kd|acc|wins&limit=50&me=<id: sha256 of the key, 32 hex>
    const q = new URL(req.url, 'http://x').searchParams, me = q.get('me');
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'max-age=5' });
    res.end(JSON.stringify(LB.top({ period: q.get('period') === 'week' ? 'week' : 'all', sort: q.get('sort') || 'kills', limit: +q.get('limit') || 50, me: /^[0-9a-f]{32}$/.test(me || '') ? me : '' }))); return;
  }
  if (STATIC && (req.method === 'GET' || req.method === 'HEAD')) { serveFile(req, res); return; }
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

if (LB || ACC) {   // the table and the accounts are saved every 20 s and when the server is stopped
  setInterval(() => { if (LB) LB.save(); if (ACC) ACC.save(); }, 20000);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (LB) LB.save(); if (ACC) ACC.save(); process.exit(0); });
}
