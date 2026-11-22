/* Daugavpils shooter: the game server. The rules are in game.mjs (team deathmatch, or MODE=ffa: everybody against
   everybody; an arena with bases for the teams, ARENA=center|fortress|station|park|church|pond|speedway|culture|griva; bots, BOTS=6 and BOT_LEVEL=easy|normal|hard,
   fill the empty places). The fight goes in matches of two hours — the day of the game — with the door open for the
   first half hour and the «Шторм» in the last twenty minutes to find the winner (server/storm.mjs). This file is the
   network: WebSockets for the players and /health for the page (the lobby reads the match from it).
     PORT, SERVER_NAME, MODE, WIN_SCORE (only with MATCH=off: a match has no kill target), ARENA, BOTS, BOT_LEVEL, LEADERBOARD (file of the leaderboard, default server/data/leaderboard.json; off = none),
     ACCOUNTS (file of the accounts, default server/data/accounts.json; off = none: joins are not checked, but the page's mandatory gate cannot register on such a server),
     TEAMS (file of the teams of the players, default server/data/teams.json; off = no teams; they need the accounts — teams.mjs,
       the live side on the WebSocket path /social — social.mjs),
     STATIC (a folder, e.g. dist after npm run build: the server also gives out the page, so the city and its server live on one address;
       unchanged files are answered 304, the text and the models go compressed in brotli or gzip — compress.mjs),
     DAY_MIN (the length of the day of the game in minutes, default 120: the sun rises and sets over the city; 0 = no clock, see daycycle.mjs;
       the match lasts one day — 120 minutes without the clock),
     MATCH (off = no matches: endless rounds to the kill target, no storm),
     ADMIN_PASS (the password of the admin panel /admin — admin.mjs, admin.html; without it the panel is off: players, accounts,
       the leaderboard, the teams, the bots and the cargo from one page) */
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { loadWorld } from './world.mjs';
import { ARENAS } from './arenas.mjs';
import { createGame } from './game.mjs';
import { createBoard } from './leaderboard.mjs';
import { createAccounts } from './accounts.mjs';
import { createTeams } from './teams.mjs';
import { createSocial } from './social.mjs';
import { createAdmin } from './admin.mjs';
import { compressible, encodingFor, packed, warm } from './compress.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = +process.env.PORT || 8787, WORLD = loadWorld();
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const LB_FILE = process.env.LEADERBOARD || path.join(DATA, 'leaderboard.json');
const ACC_FILE = process.env.ACCOUNTS || path.join(DATA, 'accounts.json');
const TM_FILE = process.env.TEAMS || path.join(DATA, 'teams.json');
const LB = process.env.LEADERBOARD === 'off' ? null : createBoard({ file: LB_FILE });
const ACC = process.env.ACCOUNTS === 'off' ? null : createAccounts({ file: ACC_FILE });
// the teams of the players (teams.mjs) live on the accounts: a fight reads the tag and the allies of a nick through clans
const TM = !ACC || process.env.TEAMS === 'off' ? null : createTeams({ file: TM_FILE });
const clans = TM ? name => { const t = TM.of(name); return t && { id: t.id, tag: t.tag, name: t.name }; } : null;
const DAY_LEN = (+process.env.DAY_MIN || 120) * 60000;   // one match is one day of the game: midnight to midnight
const game = createGame({ board: LB, accounts: ACC, clans, world: WORLD, mode: process.env.MODE === 'ffa' ? 'ffa' : 'team', win: +process.env.WIN_SCORE || 0, name: String(process.env.SERVER_NAME || 'Даугавпилс').slice(0, 40), arena: ARENAS[process.env.ARENA] || null, level: process.env.BOT_LEVEL || 'normal',
  day: process.env.DAY_MIN === '0' ? null : { len: DAY_LEN }, match: process.env.MATCH === 'off' ? null : { len: DAY_LEN } });
for (let i = 0; i < Math.max(0, Math.min(63, +process.env.BOTS || 0)); i++) game.addBot();   // up to 63 bots: with one human that fills the 64 places

// the live side of the teams (social.mjs): a team changed — the fight takes the new tags and allies at once
const social = TM ? createSocial({ accounts: ACC, teams: TM, onTeams: () => game.refreshClans() }) : null;
// the admin panel (admin.mjs): the page /admin and its api; off until ADMIN_PASS is set. clients() reads the WebSocket
// crowd lazily — wss below is ready by the time the first request comes
const ADMIN = createAdmin({ pass: process.env.ADMIN_PASS || '', game, accounts: ACC, board: LB, teams: TM, social, clients: () => wss.clients.size,
  files: [{ name: 'accounts.json', path: ACC_FILE }, { name: 'leaderboard.json', path: LB_FILE }, { name: 'teams.json', path: TM_FILE }] });

/* the page itself (STATIC=dist): files of the folder, / is index.html; the bundle in assets/ has hashes in its names
   and is cached for long, the rest (the page, the city data) is checked every time */
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
    // no-cache: the browser asks every time whether its copy is still good; a file that has not changed is answered
    // 304 without its body. Without that every visit downloaded the city data and the models (~25 MB) again.
    // The text and the models go compressed (compress.mjs); the tag of a compressed copy has its encoding at the end,
    // and any copy of an unchanged file is still good.
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const cache = { 'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'last-modified': st.mtime.toUTCString(), etag };
    if (compressible(file)) cache.vary = 'Accept-Encoding';
    const inm = req.headers['if-none-match'], ims = Date.parse(req.headers['if-modified-since'] || '');
    const good = inm && inm.split(',').map(t => t.trim()).find(t => t === '*' || t.replace(/-(br|gzip)"$/, '"') === etag);
    if (inm ? good : Math.floor(st.mtimeMs / 1000) <= Math.floor(ims / 1000)) { res.writeHead(304, { ...cache, etag: good && good !== '*' ? good : etag }); res.end(); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const plain = () => {
      res.writeHead(200, { 'content-type': type, 'content-length': st.size, ...cache });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    };
    const enc = encodingFor(file, req.headers['accept-encoding']);
    if (!enc) { plain(); return; }
    packed(file, st, enc).then(z => {
      if (!z) { plain(); return; }
      res.writeHead(200, { 'content-type': type, 'content-encoding': enc, 'content-length': z.length, ...cache, etag: etag.slice(0, -1) + '-' + enc + '"' });
      res.end(req.method === 'HEAD' ? undefined : z);
    });
  });
}

/* accounts: /auth/register and /auth/login take {name, pass} and answer {ok, name, key}; /auth/me?key= checks a key.
   The page may live on another address (legacy GitHub Pages), so the answers carry the CORS headers; OPTIONS is the preflight.
   Production (dvinsk.lat) serves the page from this same process (STATIC=dist).
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
  if (ADMIN.route(req, res)) return;
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
wss.on('connection', (ws, req) => {
  ws.since = Date.now(); ws.live = true;
  const where = req.url.split('?')[0], conn = { send: s => { if (ws.readyState === 1) ws.send(s); }, close: () => ws.close() };
  // the social side has its own door, /social: the teams and who is online (social.mjs); without teams it says so and closes
  if (where === '/social' && !social) { ws.h = { joined: false }; conn.send(JSON.stringify({ t: 'off' })); ws.close(); return; }
  const g = where === '/social' ? social : game;   // the teams have their own door: the path /social
  const h = g.attach(conn);
  ws.h = h;
  ws.on('pong', () => { ws.live = true; });
  ws.on('message', raw => h.message(raw.toString()));
  ws.on('close', () => h.close());
  ws.on('error', () => {});
});
setInterval(() => { for (const c of wss.clients) { if (!c.h.joined && Date.now() - c.since > 15000) { c.terminate(); continue; } if (!c.live) { c.terminate(); continue; } c.live = false; c.ping(); } }, 15000);
server.listen(PORT, () => console.log('Daugavpils shooter server on :' + PORT + (game.arena ? ', arena ' + game.arena.name : '') + (process.env.BOTS ? ', bots ' + process.env.BOTS : '') + (process.env.MATCH === 'off' ? '' : ', matches of ' + DAY_LEN / 60000 + ' min with the storm at the end')));
if (STATIC) warm(STATIC);   // the compressed copies of the page's files, made in the background (compress.mjs)

if (LB || ACC) {   // the table, the accounts and the teams are saved every 20 s and when the server is stopped
  const saveAll = () => { if (LB) LB.save(); if (ACC) ACC.save(); if (TM) TM.save(); };
  setInterval(saveAll, 20000);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveAll(); process.exit(0); });
}
