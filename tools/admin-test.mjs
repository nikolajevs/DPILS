/* The tests of the admin panel, no browser needed: node tools/admin-test.mjs (npm test runs it after the social tests).
   1. The books (accounts.mjs, leaderboard.mjs, teams.mjs): the lists the panel reads, the new password (the key and the
      results stay), the removal of an account, the reset and removal of a profile, the disband and the member kick.
   2. The doors (admin.mjs on a live server/index.mjs): the page /admin and its headers, the login (a wrong password,
      the rate limit), the session token, the overview, the players, the bots, the kick over a real WebSocket, the
      server line in the chat, the cargo on demand, the accounts and the leaderboard and the teams through the api,
      the restart (the process exits cleanly, the test respawns it as pm2/systemd would: the books survive, the
      sessions and the login tries die with the old process), the logout; without ADMIN_PASS the panel is off. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createAccounts } from '../server/accounts.mjs';
import { createBoard, idOf } from '../server/leaderboard.mjs';
import { createTeams } from '../server/teams.mjs';
import { createAdmin } from '../server/admin.mjs';
import { createEvents } from '../server/events.mjs';
import { CARGO, HOLY } from '../server/combat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 1. the books ---------- */
console.log('admin books (accounts, leaderboard, teams):');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpils-admin-'));
  const A = createAccounts({ file: path.join(dir, 'accounts.json') });
  const B = createBoard({ file: path.join(dir, 'leaderboard.json') });
  const T = createTeams({ file: path.join(dir, 'teams.json') });
  const r1 = A.register('Аня', 'parol123'), r2 = A.register('Боря', 'parol123');
  ok(r1.key && r2.key, 'two accounts made');
  const l = A.list({});
  ok(l.total === 2 && l.rows.every(u => u.name && u.created && u.seen && /^[0-9a-f]{32}$/.test(u.id)) && !JSON.stringify(l).includes(r1.key), 'the list: nicks, dates, public ids — never the keys');
  ok(A.list({ q: 'аня' }).rows.length === 1 && A.list({ q: 'аня' }).rows[0].name === 'Аня', 'the search by nick (any case)');
  ok(A.setPass('Аня', 'short').error === 'bad-pass' && A.setPass('Никого', 'parol123').error === 'no-user', 'a short password and a missing nick refused');
  ok(A.setPass('Аня', 'novyj-parol').name === 'Аня', 'the password reset');
  ok(A.login('Аня', 'parol123').error === 'bad-login' && A.login('Аня', 'novyj-parol').key === r1.key, 'the old password is out, the new one opens — the key stayed');
  B.identify(r1.key, 'Аня'); B.identify(r2.key, 'Боря');
  const bl = B.list({});
  ok(bl.total === 2 && bl.rows.every(r => /^[0-9a-f]{32}$/.test(r.id)), 'the board list keeps the ids');
  ok(B.reset(idOf(r1.key), 'all') === 1 && B.list({}).rows.find(r => r.id === idOf(r1.key)).kills === 0, 'one profile reset');
  ok(B.reset('', 'both') === 2, 'all profiles reset');
  ok(B.remove(idOf(r2.key)) && !B.remove(idOf(r2.key)) && B.list({}).total === 1, 'a profile removed, twice is false');
  T.create('Аня', 'Двинские волки', 'DVN'); T.invite('Аня', 'Боря'); T.accept('Боря', T.of('Аня').id);
  const tid = T.of('Аня').id;
  ok(T.list().length === 1 && T.list()[0].members.length === 2, 'the teams list');
  const kicked = T.kickMember(tid, 'Боря');
  ok(!kicked.error && T.of('Боря') === null && T.of('Аня').members.length === 1, 'the admin takes a member out');
  ok(T.remove(tid).tag === 'DVN' && T.list().length === 0 && T.remove(tid) === null, 'the admin disbands');
  const gone = A.remove('Аня');
  ok(gone && gone.key === r1.key && A.list({}).total === 1 && A.remove('Аня') === null, 'the account removed, its key returned for the kick');
  ok(createAdmin({ pass: '' }).route({}, {}) === false, 'without a password the panel is off: the paths fall through');
  ok(typeof createAdmin({ pass: '' }).note === 'function', 'the disabled panel still answers the http note()');
}

/* ---------- 1b. the event settings store ---------- */
console.log('admin events (the settings store):');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpils-events-'));
  const file = path.join(dir, 'events.json');
  const E = createEvents({ file });
  ok(E.view().holy.cfg.durMs === 600000 && E.view().cargo.cfg.loot.med === 2 && E.view().storm.cfg.rEnd === 22 && E.enabled('holy'), 'the defaults: the rules as written, the auto-run on');
  ok(E.set('holy', { durMs: 300000, buffs: { dmg: 1.5 } }).ok && HOLY.durMs === 300000 && HOLY.buffs.dmg === 1.5 && HOLY.buffs.speed === 1.2, 'a patch applied to the rules at once, the rest kept');
  ok(HOLY.buffName.dmg === 'Урон +50%', 'the buff label follows the value');
  ok(E.set('cargo', { alt: 99999, speed: -5 }).ok && CARGO.alt === 500 && CARGO.speed === 1, 'out-of-range values clamped');
  ok(E.set('holy', { nope: 1 }).error === 'bad-cfg' && E.set('holy', { durMs: 'x' }).error === 'bad-cfg', 'an unknown key and a non-number refused');
  E.setEnabled('cargo', false);
  const E2 = createEvents({ file });
  ok(E2.view().holy.cfg.durMs === 300000 && E2.view().holy.cfg.buffs.dmg === 1.5 && !E2.enabled('cargo') && E2.enabled('holy'), 'the settings and the flag survive a reload');
  ok(E2.reset('all').ok && HOLY.durMs === 600000 && CARGO.alt === 130 && HOLY.buffs.dmg === 1.25 && E2.enabled('cargo'), 'reset: the defaults and the auto-run back');
  ok(HOLY.buffName.dmg === 'Урон +25%', 'the default buff label back');
  const E3 = createEvents({ file: null });
  ok(E3.set('holy', { capMs: 5000 }).ok && HOLY.capMs === 5000, 'a fileless store works in memory');
  E3.reset('holy');
}

/* ---------- 2. the live doors ---------- */
console.log('admin doors (a live server):');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpils-admin-live-'));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const PORT = await freePort();
const BASE = 'http://127.0.0.1:' + PORT;
let child = null, serverLog = '';
function startServer() {
  child = spawn(process.execPath, ['server/index.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ADMIN_PASS: 'test-admin-pass', BOTS: '2', SERVER_NAME: 'Тест', ACCOUNTS: path.join(dir, 'accounts.json'), LEADERBOARD: path.join(dir, 'leaderboard.json'), TEAMS: path.join(dir, 'teams.json'), EVENTS: path.join(dir, 'events.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { serverLog += d; }); child.stderr.on('data', d => { serverLog += d; });
  return child;
}
startServer();
const req = async (p, { method = 'GET', body, token, q = '' } = {}) => {
  const h = {}; if (token) h['x-admin-token'] = token; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(BASE + p + q, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* html or empty */ }
  return { status: r.status, headers: r.headers, j };
};
const waitFor = (ws, pred, ms = 5000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout waiting for a message')), ms);
  const h = raw => { let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; } if (pred(m)) { clearTimeout(t); ws.off('message', h); res(m); } };
  ws.on('message', h);
});
const join = async (name, key) => {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const hello = waitFor(ws, m => m.t === 'hello');
  ws.send(JSON.stringify({ t: 'join', name, key, char: 'soldier', x: -1487, z: 1263, yaw: 0, board: true }));
  await hello;
  return ws;
};
try {
  let up = false;
  for (let k = 0; k < 60 && !up; k++) { try { up = (await req('/health')).j.ok === true; } catch (e) { await sleep(250); } }
  ok(up, 'the server is up', serverLog.slice(0, 400));
  if (!up) throw new Error('server did not start');

  const page = await fetch(BASE + '/admin');
  const html = await page.text();
  ok(page.status === 200 && html.includes('админ-панель'), 'GET /admin gives the page');
  ok(page.headers.get('x-frame-options') === 'DENY' && (page.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'the page cannot be framed');
  ok((await req('/admin/api/overview')).status === 401, 'the api without a token is refused');
  ok((await req('/admin/api/overview', { token: 'deadbeef' })).status === 401, 'a wrong token is refused');
  ok((await req('/admin/api/restart', { method: 'POST', body: {} })).status === 401, 'the restart without a token is refused');
  ok((await req('/admin/login', { method: 'POST', body: { pass: 'wrong' } })).status === 401, 'a wrong password is refused');
  const login = await req('/admin/login', { method: 'POST', body: { pass: 'test-admin-pass' } });
  ok(login.status === 200 && login.j.ok && /^[0-9a-f]{48}$/.test(login.j.token), 'the right password opens a session');
  let tok = login.j.token;
  const api = (p, o = {}) => req('/admin/api/' + p, { ...o, token: tok });

  const ov = await api('overview');
  ok(ov.j.ok && ov.j.server.bots === 2 && ov.j.counts.accounts === 0 && ov.j.server.match && ov.j.env.name === 'Тест' && ov.j.files.length === 4, 'the overview: the fight, the counts, the match, the files');
  ok(ov.j.loop && typeof ov.j.loop.last === 'number' && ov.j.journal && typeof ov.j.journal.errors === 'number' && typeof ov.j.http.total === 'number', 'the overview carries the loop lag, the journal counters and the http counters');
  // the journal: the startup line of the console and the refused login are in it
  let lg = (await api('logs')).j;
  ok(lg.ok && lg.entries.some(e => e.level === 'log' && e.text.includes('server on')) && lg.entries.some(e => e.level === 'warn' && e.text.includes('неверный пароль')), 'the journal holds the console startup line and the refused login');
  // the debug picture
  const dbg = (await api('debug')).j;
  ok(dbg.ok && dbg.process.pid > 0 && dbg.loop.last >= 0 && dbg.net.http.total > 0 && Array.isArray(dbg.sockets) && typeof dbg.world.nades === 'number' && typeof dbg.world.bullets === 'number', 'the debug picture: process, loop, http, sockets, fight insides');
  ok(dbg.env.ADMIN_PASS === '(задан)' && !JSON.stringify(dbg).includes('test-admin-pass'), 'the environment is whitelisted, the password never leaves');
  ok(dbg.match && typeof dbg.match.roster === 'number' && dbg.match.doorAt > 0 && (dbg.storm === null || typeof dbg.storm.pi === 'number'), 'the match debug: the roster and the door; the storm either absent or described');   // the match runs by the wall clock: the test may land in its storm
  ok((await api('players')).j.rows.length === 2 && (await api('players')).j.rows.every(r => r.bot), 'the players: two bots');
  ok((await api('bots', { method: 'POST', body: { n: 4 } })).j.bots === 4 && (await api('bots', { method: 'POST', body: { n: 1 } })).j.bots === 1, 'the bots set to 4 and back to 1');
  ok((await api('no-such-door')).status === 404, 'an unknown door is a 404');

  // a human comes in over a real WebSocket: the account, the fight, the kick, the chat
  const reg = await req('/auth/register', { method: 'POST', body: { name: 'Аня', pass: 'parol123' } });
  ok(reg.j.ok && reg.j.key, 'an account registered');
  const ws = await join('Аня', reg.j.key);
  let pl = (await api('players')).j.rows;
  const anya = pl.find(r => !r.bot);
  ok(anya && anya.name === 'Аня' && anya.acct === 'Аня' && anya.since > 0 && anya.alive, 'the human in the players list, with the account and the join time');
  ok((await api('debug')).j.sockets.some(s => s.joined && s.path === '/'), 'the socket list shows the joined player on his door');
  const pd = (await api('player', { q: '?id=' + anya.id })).j;
  ok(pd.ok && Array.isArray(pd.player.mag) && pd.player.mag.length === 8 && pd.player.reloadLeft >= 0 && !('key' in pd.player) && !JSON.stringify(pd).includes(reg.j.key), 'the player dump: the inventory and the timers, never the key');
  ok((await api('player', { q: '?id=99999' })).status === 404, 'a dump of nobody is a 404');
  const said = waitFor(ws, m => m.t === 'chat' && m.text.includes('Админ'));
  ok((await api('say', { method: 'POST', body: { text: 'проверка связи' } })).j.ok, 'the server line sent');
  ok((await said).text.includes('проверка связи'), 'the line reached the player');
  lg = (await api('logs')).j;
  ok(lg.entries.some(e => e.level === 'info' && e.text.includes('admin: say')), 'the audit line of the action is in the journal');
  const inc = (await api('logs', { q: '?after=' + lg.last })).j;
  ok(inc.entries.length === 0 && inc.last === lg.last, 'the incremental read returns nothing new');
  ok((await api('logs', { q: '?level=warn' })).j.entries.every(e => e.level === 'warn'), 'the level filter of the journal');
  ok((await api('say', { method: 'POST', body: { text: '   ' } })).status === 400, 'an empty line refused');
  const closed = new Promise(res => ws.once('close', res));
  const kickMsg = waitFor(ws, m => m.t === 'chat' && m.text.includes('исключён администратором'));
  ok((await api('kick', { method: 'POST', body: { id: anya.id } })).j.ok, 'the kick accepted');
  await kickMsg; await closed;
  ok(!(await api('players')).j.rows.some(r => !r.bot), 'the kicked human is out');
  ok((await api('kick', { method: 'POST', body: { id: 99999 } })).status === 404, 'kicking nobody is a 404');

  // the list of servers: four games in one process, their matches 15 minutes apart, each on its own door /play/<n>
  const hl = (await req('/health')).j;
  ok(hl.servers && hl.servers.length === 4 && hl.servers.map(v => v.name).join() === 'Тест 1,Тест 2,Тест 3,Тест 4' && hl.name === 'Тест 1' && hl.servers.every((v, i) => v.id === i + 1 && v.bots === (i ? 2 : 1) && v.match), 'the health lists four servers with their matches and bots (the first one set to 1 above), the first one on top');
  const L = hl.servers.map(v => v.match.left), mlen = hl.servers[0].match.len;
  ok(L.every((x, i) => !i || Math.abs((((x - L[i - 1]) % mlen) + mlen) % mlen - 900000) < 3000), 'each next server ends its match 15 minutes after the one before', L.join());
  ok(hl.servers.every((v, i) => !i || Math.abs((((hl.servers[i - 1].day.f - v.day.f) % 1) + 1) % 1 - 0.125) < 0.001), 'and its day runs 15 minutes behind: the midnight comes with its match');
  ok((await api('overview')).j.servers.length === 4, 'the admin overview lists the servers');
  const ws3 = new WebSocket('ws://127.0.0.1:' + PORT + '/play/3');
  await new Promise((res, rej) => { ws3.once('open', res); ws3.once('error', rej); });
  const hello3 = waitFor(ws3, m => m.t === 'hello');
  ws3.send(JSON.stringify({ t: 'join', name: 'Аня', key: reg.j.key, char: 'soldier', x: -1487, z: 1263, yaw: 0, board: true }));
  const h3 = await hello3;
  ok(h3.srv === 3 && h3.server === 'Тест 3', 'the door /play/3 joins the third server');
  ok((await api('players', { q: '?srv=3' })).j.rows.some(r => r.name === 'Аня') && !(await api('players')).j.rows.some(r => !r.bot), 'the admin reads the server of ?srv=: the human on the third, nobody on the first');
  ok((await req('/health')).j.servers[2].players === 1 && (await req('/health')).j.servers[0].players === 0, 'the health counts the human on his server');
  const gone3 = new Promise(res => ws3.once('close', res)); ws3.close(); await gone3;
  const ws9 = new WebSocket('ws://127.0.0.1:' + PORT + '/play/9');
  const no9 = await new Promise((res, rej) => { ws9.once('message', raw => res(JSON.parse(raw.toString()))); ws9.once('error', rej); });
  ok(no9.t === 'noserver', 'a door beyond the list is no game');
  ws9.close();

  // the cargo on demand
  ok((await api('cargo', { method: 'POST', body: {} })).j.ok, 'the cargo dropped');
  ok((await api('cargo', { method: 'POST', body: {} })).status === 409, 'a second crate while one is live refused');

  // the events: the settings, the auto-run flag, the manual control of the race and the crate
  const ev0 = (await api('events')).j;
  ok(ev0.ok && ev0.holy.cfg.durMs === 600000 && ev0.holy.enabled === true && ev0.cargo.cfg.loot.optic === 1 && ev0.storm.cfg.rEnd === 22 && ev0.holy.defaults.durMs === 600000, 'the events view: the settings, the defaults, the auto-run');
  ok(ev0.state && typeof ev0.state.holy.nextIn === 'number' && ev0.state.storm.match, 'the events state: the countdowns and the match');
  ok((await api('events/holy', { method: 'POST', body: { cfg: { durMs: 300000, capMs: 5000, buffs: { dmg: 1.5 } } } })).j.ok, 'the race settings applied');
  const ev1 = (await api('events')).j;
  ok(ev1.holy.cfg.durMs === 300000 && ev1.holy.cfg.capMs === 5000 && ev1.holy.cfg.buffs.dmg === 1.5 && ev1.holy.cfg.buffs.speed === 1.2, 'a partial patch keeps the rest');
  ok((await api('events/holy', { method: 'POST', body: { cfg: { bogus: 1 } } })).status === 400, 'an unknown setting refused');
  ok((await api('events/cargo', { method: 'POST', body: { enabled: false } })).j.ok && !(await api('events')).j.cargo.enabled, 'the cargo auto-run paused');
  // the race by hand: start, the live picture, stop (during the storm the hill cannot be taken)
  const stormLive = !!(ev1.state.storm && ev1.state.storm.live);
  if (stormLive) {
    ok((await api('events/holy/start', { method: 'POST', body: {} })).status === 409, 'the race start refused during the storm');
  } else {
    ok((await api('events/holy/start', { method: 'POST', body: {} })).j.ok, 'the race started on demand');
    const evA = (await api('events')).j;
    ok(evA.state.holy.active && evA.state.holy.left > 0 && evA.state.holy.points.length === 4 && evA.state.holy.points[0].temple, 'the race live: four points with names');
    ok((await api('events/holy/start', { method: 'POST', body: {} })).status === 409, 'a second start refused');
    ok((await api('events/holy/next', { method: 'POST', body: {} })).status === 409, 'rescheduling a running race refused');
    ok((await api('events/holy/stop', { method: 'POST', body: {} })).j.ok && !(await api('events')).j.state.holy.active, 'the race stopped, idle again');
    ok((await api('events/holy/stop', { method: 'POST', body: {} })).status === 409, 'stopping an idle race refused');
    ok((await api('events/holy/next', { method: 'POST', body: { inMs: 600000 } })).j.ok, 'the next race rescheduled');
  }
  // the crate dropped above: take it away (a bot may have carried it off already)
  const cActive = (await api('events')).j.state.cargo.active;
  const rm = await api('events/cargo/remove', { method: 'POST', body: {} });
  ok(cActive ? rm.j.ok : rm.status === 409, 'the crate removed (or already gone)');
  ok((await api('events/cargo/remove', { method: 'POST', body: {} })).status === 409, 'removing nothing refused');
  ok((await api('events/cargo/next', { method: 'POST', body: {} })).j.ok, 'the next drop rescheduled');
  ok((await api('events/cargo/drop', { method: 'POST', body: {} })).j.ok && (await api('events/cargo/drop', { method: 'POST', body: {} })).status === 409, 'a drop on demand and a second refused');
  ok((await api('events/cargo/remove', { method: 'POST', body: {} })).j.ok, 'the second crate removed too');
  // the storm settings and the reset of everything
  ok((await api('events/storm', { method: 'POST', body: { cfg: { rEnd: 30 } } })).j.ok && (await api('events')).j.storm.cfg.rEnd === 30, 'the storm settings applied');
  ok((await api('events/reset', { method: 'POST', body: { kind: 'all' } })).j.ok, 'the reset of all events');
  const evR = (await api('events')).j;
  ok(evR.holy.cfg.durMs === 600000 && evR.cargo.cfg.alt === 130 && evR.cargo.enabled === true && evR.storm.cfg.rEnd === 22, 'the defaults back after the reset');
  const savedEv = JSON.parse(fs.readFileSync(path.join(dir, 'events.json'), 'utf8'));
  ok(savedEv.holy.cfg.durMs === 600000 && savedEv.cargo.enabled === true, 'the settings saved to the file');

  // the accounts through the api
  let acc = (await api('accounts')).j;
  ok(acc.total === 1 && acc.rows[0].name === 'Аня' && !JSON.stringify(acc).includes(reg.j.key), 'the accounts list, without the keys');
  ok((await api('accounts?q=' + encodeURIComponent('аня'))).j.rows.length === 1, 'the search works over http');
  ok((await api('accounts/pass', { method: 'POST', body: { name: 'Аня', pass: 'novyj-parol' } })).j.ok, 'the password reset over http');
  ok((await req('/auth/login', { method: 'POST', body: { name: 'Аня', pass: 'novyj-parol' } })).j.key === reg.j.key, 'the new password opens, the key stayed');
  // the leaderboard: the join wrote the profile
  let board = (await api('board')).j;
  const prof = board.rows.find(r => r.name === 'Аня');
  ok(board.total >= 1 && prof && /^[0-9a-f]{32}$/.test(prof.id), 'the board list with the profile of the join');
  ok((await api('board/reset', { method: 'POST', body: { id: prof.id, period: 'both' } })).j.n === 1, 'one profile reset over http');
  ok((await api('board/reset', { method: 'POST', body: { period: 'week' } })).j.n >= 1, 'the week reset for all');

  // the teams over the social door, then the admin takes them apart
  const reg2 = await req('/auth/register', { method: 'POST', body: { name: 'Боря', pass: 'parol123' } });
  const soc = new WebSocket('ws://127.0.0.1:' + PORT + '/social');
  await new Promise((res, rej) => { soc.once('open', res); soc.once('error', rej); });
  const socState = waitFor(soc, m => m.t === 'state');
  soc.send(JSON.stringify({ t: 'auth', key: reg.j.key, where: 'lobby' }));
  await socState;
  const socNote = waitFor(soc, m => m.t === 'note');
  soc.send(JSON.stringify({ t: 'create', name: 'Двинские волки', tag: 'DVN' }));
  await socNote;
  let teams = (await api('teams')).j;
  const team = teams.rows.find(t => t.tag === 'DVN');
  ok(team && team.leader === 'Аня' && team.members.length === 1, 'the team in the admin list');
  // Боря joins the team through the social door of his own
  const soc2 = new WebSocket('ws://127.0.0.1:' + PORT + '/social');
  await new Promise((res, rej) => { soc2.once('open', res); soc2.once('error', rej); });
  const st2 = waitFor(soc2, m => m.t === 'state');
  soc2.send(JSON.stringify({ t: 'auth', key: reg2.j.key, where: 'lobby' }));
  await st2;
  const inv = waitFor(soc2, m => m.t === 'invited');
  const invState = waitFor(soc, m => m.t === 'state' && m.team && m.team.sent && m.team.sent.length === 1);
  soc.send(JSON.stringify({ t: 'invite', name: 'Боря' }));
  await inv; await invState;
  const acc2 = waitFor(soc2, m => m.t === 'state' && m.team);
  soc2.send(JSON.stringify({ t: 'accept', team: team.id }));
  await acc2;
  teams = (await api('teams')).j;
  ok(teams.rows.find(t => t.id === team.id).members.length === 2, 'two members now');
  ok((await api('teams/kick', { method: 'POST', body: { id: team.id, name: 'Боря' } })).j.ok, 'the admin takes Боря out');
  ok((await api('teams')).j.rows.find(t => t.id === team.id).members.length === 1, 'one member left');
  ok((await api('teams/delete', { method: 'POST', body: { id: team.id } })).j.ok && (await api('teams')).j.rows.length === 0, 'the admin disbands');
  soc.close(); soc2.close();

  // the account removal takes the profile and the seat, and kicks whoever plays with the key
  const ws2 = await join('Аня', reg.j.key);
  const closed2 = new Promise(res => ws2.once('close', res));
  ok((await api('accounts/delete', { method: 'POST', body: { name: 'Аня' } })).j.ok, 'the account removed over http');
  await closed2;
  ok((await api('accounts')).j.total === 1 && !(await api('board')).j.rows.some(r => r.name === 'Аня'), 'the account and its results are gone');
  ok((await req('/auth/me?key=' + reg.j.key)).status === 401, 'the key of the removed account is dead');
  ok((await api('accounts/delete', { method: 'POST', body: { name: 'Аня' } })).status === 404, 'removing twice is a 404');

  // the journal clear: the buffer empties, the audit of the clear itself stays
  ok((await api('logs/clear', { method: 'POST', body: {} })).j.ok, 'the journal cleared');
  ok((await api('logs')).j.held === 1, 'after the clear only the audit of the clear itself');

  // the restart: the panel stops the process; the supervisor (pm2/systemd) brings it back. Here the test plays
  // the supervisor: it respawns the server and checks that the books survived while the sessions and the login
  // tries (both live in the process memory) are gone
  const bootBefore = (await api('overview')).j.boot;
  const exited = new Promise(res => child.once('exit', (code, sig) => res({ code, sig })));
  ok((await api('restart', { method: 'POST', body: {} })).j.ok, 'the restart accepted');
  ok((await api('restart', { method: 'POST', body: {} })).status === 409, 'a second restart while one is pending refused');
  const ex = await Promise.race([exited, sleep(6000).then(() => null)]);
  ok(ex && ex.code === 0, 'the process exited cleanly for the supervisor', JSON.stringify(ex));
  if (!ex) child.kill();
  startServer();
  let back = false;
  for (let k = 0; k < 60 && !back; k++) { try { back = (await req('/health')).j.ok === true; } catch (e) { await sleep(250); } }
  ok(back, 'the server is back up', serverLog.slice(-400));
  ok((await api('overview')).status === 401, 'the old session died with the process');
  const login2 = await req('/admin/login', { method: 'POST', body: { pass: 'test-admin-pass' } });
  ok(login2.status === 200 && login2.j.ok, 'the login tries cleared: a fresh login opens');
  tok = login2.j.token;
  const ov2 = await api('overview');
  ok(ov2.j.boot > bootBefore && ov2.j.server.bots === 2 && ov2.j.counts.accounts === 1, 'a new process: fresh boot, the env bots back, the accounts kept');
  ok(!(await api('board')).j.rows.some(r => r.name === 'Аня'), 'the leaderboard kept: the removed account stays removed');

  // the logout closes the session
  ok((await req('/admin/logout', { method: 'POST', token: tok })).j.ok, 'the logout');
  ok((await api('overview')).status === 401, 'the token is dead after the logout');

  // the rate limit: ten tries in ten minutes (the fresh process counts from the re-login above)
  let limited = false;
  for (let k = 0; k < 12 && !limited; k++) limited = (await req('/admin/login', { method: 'POST', body: { pass: 'wrong' } })).status === 429;
  ok(limited, 'the login is rate-limited');
} catch (e) {
  fail++; console.log('  FAIL live doors — ' + e.message);
} finally {
  child.kill();
  await sleep(300);
}

console.log(`\nadmin: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
