/* The tests of the admin panel, no browser needed: node tools/admin-test.mjs (npm test runs it after the social tests).
   1. The books (accounts.mjs, leaderboard.mjs, teams.mjs): the lists the panel reads, the new password (the key and the
      results stay), the removal of an account, the reset and removal of a profile, the disband and the member kick.
   2. The doors (admin.mjs on a live server/index.mjs): the page /admin and its headers, the login (a wrong password,
      the rate limit), the session token, the overview, the players, the bots, the kick over a real WebSocket, the
      server line in the chat, the cargo on demand, the accounts and the leaderboard and the teams through the api,
      the logout; without ADMIN_PASS the panel is off. */
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
}

/* ---------- 2. the live doors ---------- */
console.log('admin doors (a live server):');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpils-admin-live-'));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const PORT = await freePort();
const BASE = 'http://127.0.0.1:' + PORT;
const child = spawn(process.execPath, ['server/index.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ADMIN_PASS: 'test-admin-pass', BOTS: '2', SERVER_NAME: 'Тест', ACCOUNTS: path.join(dir, 'accounts.json'), LEADERBOARD: path.join(dir, 'leaderboard.json'), TEAMS: path.join(dir, 'teams.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
child.stdout.on('data', d => { serverLog += d; }); child.stderr.on('data', d => { serverLog += d; });
const req = async (p, { method = 'GET', body, token } = {}) => {
  const h = {}; if (token) h['x-admin-token'] = token; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(BASE + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
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
  ws.send(JSON.stringify({ t: 'join', name, key, team: 0, char: 'soldier', x: -1487, z: 1263, yaw: 0, board: true }));
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
  ok((await req('/admin/login', { method: 'POST', body: { pass: 'wrong' } })).status === 401, 'a wrong password is refused');
  const login = await req('/admin/login', { method: 'POST', body: { pass: 'test-admin-pass' } });
  ok(login.status === 200 && login.j.ok && /^[0-9a-f]{48}$/.test(login.j.token), 'the right password opens a session');
  const tok = login.j.token;
  const api = (p, o = {}) => req('/admin/api/' + p, { ...o, token: tok });

  const ov = await api('overview');
  ok(ov.j.ok && ov.j.server.bots === 2 && ov.j.counts.accounts === 0 && ov.j.server.match && ov.j.env.name === 'Тест' && ov.j.files.length === 3, 'the overview: the fight, the counts, the match, the files');
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
  const said = waitFor(ws, m => m.t === 'chat' && m.text.includes('Админ'));
  ok((await api('say', { method: 'POST', body: { text: 'проверка связи' } })).j.ok, 'the server line sent');
  ok((await said).text.includes('проверка связи'), 'the line reached the player');
  ok((await api('say', { method: 'POST', body: { text: '   ' } })).status === 400, 'an empty line refused');
  const closed = new Promise(res => ws.once('close', res));
  const kickMsg = waitFor(ws, m => m.t === 'chat' && m.text.includes('исключён администратором'));
  ok((await api('kick', { method: 'POST', body: { id: anya.id } })).j.ok, 'the kick accepted');
  await kickMsg; await closed;
  ok(!(await api('players')).j.rows.some(r => !r.bot), 'the kicked human is out');
  ok((await api('kick', { method: 'POST', body: { id: 99999 } })).status === 404, 'kicking nobody is a 404');

  // the cargo on demand
  ok((await api('cargo', { method: 'POST', body: {} })).j.ok, 'the cargo dropped');
  ok((await api('cargo', { method: 'POST', body: {} })).status === 409, 'a second crate while one is live refused');

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

  // the logout closes the session
  ok((await req('/admin/logout', { method: 'POST', token: tok })).j.ok, 'the logout');
  ok((await api('overview')).status === 401, 'the token is dead after the logout');

  // the rate limit: ten tries in ten minutes (two were spent above: the wrong password and the right one)
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
