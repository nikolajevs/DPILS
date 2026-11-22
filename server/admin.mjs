/* The admin panel of the server: the page /admin (admin.html) and its JSON doors — /admin/login, /admin/logout and
   /admin/api/*. It is off until ADMIN_PASS is set in the environment: without the password /admin answers as any
   unknown path, and nothing here runs. The password opens a session: a random token, twelve hours, kept in memory
   only (a restart of the server asks to log in again); every api call carries it in the x-admin-token header.
   The panel reads the fight (who plays, the match, the storm), puts a player out, says a line to everybody, sets the
   number of bots, drops the cargo on demand, and keeps the books: the accounts (a list, a new password, removal with
   the results and the team seat), the leaderboard (a list, a reset of one or all, removal) and the teams (a list, a
   member out, disband). The answers never carry a key, a password hash or a salt — only the public id of the results.
   The login is limited per address (10 tries in 10 minutes); the answers stay same-origin (no CORS headers), so a
   page on another address cannot read them. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { idOf } from './leaderboard.mjs';

const TTL = 12 * 3600 * 1000, MAX_SESSIONS = 64;

export function createAdmin({ pass, game, accounts = null, board = null, teams = null, social = null, clients = () => 0, files = [] }) {
  if (!pass) return { route: () => false };   // no password — no panel: the paths fall through to the usual 404
  const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin.html'), 'utf8');
  const want = crypto.createHash('sha256').update(String(pass)).digest();
  const sessions = new Map();   // token → { at, ip }
  const hits = new Map();       // ip → { n, t } — the login tries
  const bootAt = Date.now();

  function rateOk(ip) {
    const t = Date.now(); let h = hits.get(ip);
    if (!h || t - h.t > 600000) { h = { n: 0, t }; hits.set(ip, h); }
    if (hits.size > 4096) for (const [k, v] of hits) if (t - v.t > 600000) hits.delete(k);
    return ++h.n <= 10;
  }
  function reply(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(obj));
  }
  function sessionOf(req) {
    const s = sessions.get(String(req.headers['x-admin-token'] || ''));
    if (!s) return null;
    if (Date.now() - s.at > TTL) { sessions.delete(String(req.headers['x-admin-token'])); return null; }
    return s;
  }
  function body(req) {
    return new Promise(resolve => {
      let b = '';
      req.on('data', c => { b += c; if (b.length > 65536) { resolve(null); req.destroy(); } });
      req.on('end', () => { if (!b) return resolve({}); try { const m = JSON.parse(b); resolve(m && typeof m === 'object' ? m : null); } catch (e) { resolve(null); } });
      req.on('error', () => resolve(null));
    });
  }
  const humans = () => [...game.players.values()].filter(p => !p.bot);
  const saveAll = () => { if (accounts) accounts.save(); if (board) board.save(); if (teams) teams.save(); };

  // the doors: 'METHOD /name' → handler(body, query); a plain object is a 200, { code, error } is the refusal
  const api = {
    'GET /overview': () => {
      const mem = process.memoryUsage();
      return {
        server: game.health(), uptime: Math.round(process.uptime()), boot: bootAt, node: process.version,
        mem: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576), clients: clients(),
        counts: { accounts: accounts ? accounts.count() : null, board: board ? board.count() : null, teams: teams ? teams.count() : null, online: social ? social.online() : null },
        files: files.map(f => { try { const st = fs.statSync(f.path); return { name: f.name, size: st.size, mtime: st.mtimeMs }; } catch (e) { return { name: f.name, size: 0, mtime: 0 }; } }),
        env: { name: process.env.SERVER_NAME || 'Даугавпилс', mode: process.env.MODE === 'ffa' ? 'ffa' : 'team', arena: process.env.ARENA || '', bots: process.env.BOTS || '0', level: process.env.BOT_LEVEL || 'normal', match: process.env.MATCH === 'off' ? 'off' : 'on', day: process.env.DAY_MIN || '120' },
      };
    },
    'GET /players': () => ({
      rows: [...game.players.values()].map(p => ({
        id: p.id, name: p.name, acct: p.acct || '', tag: p.clan ? p.clan.tag : '', team: p.team, bot: !!p.bot, char: p.char,
        kills: p.kills, deaths: p.deaths, dmg: Math.round(p.st.dmg), acc: p.st.shots ? Math.round(100 * p.st.hitShots / p.st.shots) : 0,
        ping: p.bot ? null : Math.round(p.rtt), hp: Math.max(0, Math.round(p.hp)), alive: p.alive, x: Math.round(p.x), z: Math.round(p.z),
        wep: p.wep, mark: p.markUntil > Date.now(), since: p.joinedAt || 0,
      })).sort((a, b) => (a.bot ? 1 : 0) - (b.bot ? 1 : 0) || b.kills - a.kills || a.id - b.id),
    }),
    'POST /kick': m => game.kick(m.id, String(m.why || '')) ? { ok: true } : { code: 404, error: 'no-player' },
    'POST /say': m => {
      const t = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      return t && game.say('🛡 Админ: ' + t) ? { ok: true } : { code: 400, error: 'empty' };
    },
    'POST /bots': m => {
      const n = Math.max(0, Math.min(63, Math.round(+m.n || 0)));
      let bots = [...game.players.values()].filter(p => p.bot).length;
      while (bots < n && game.addBot()) bots++;
      while (bots > n && game.removeBot()) bots--;
      return { bots };
    },
    'POST /cargo': () => game.cargo ? { code: 409, error: 'active' } : (game.cargoDrop(), { ok: true }),
    'GET /accounts': (m, q) => {
      if (!accounts) return { code: 501, error: 'off' };
      const r = accounts.list({ q: q.get('q') || '', limit: +q.get('limit') || 200 });
      const inFight = new Set(humans().map(p => p.acct));
      return { total: r.total, rows: r.rows.map(u => ({ ...u, tag: teams ? (teams.of(u.name) || {}).tag || '' : '', fight: inFight.has(u.name), where: social ? social.whereOf(u.name) : null })) };
    },
    'POST /accounts/pass': m => {
      if (!accounts) return { code: 501, error: 'off' };
      const r = accounts.setPass(m.name, m.pass);
      if (r.error) return { code: r.error === 'no-user' ? 404 : 400, error: r.error };
      accounts.save(); return { ok: true, name: r.name };
    },
    'POST /accounts/delete': m => {
      if (!accounts) return { code: 501, error: 'off' };
      const r = accounts.remove(m.name);
      if (!r) return { code: 404, error: 'no-user' };
      for (const p of [...game.players.values()]) if (p.key === r.key) game.kick(p.id, 'аккаунт удалён');   // whoever plays with it now goes too
      if (teams && teams.of(r.name)) teams.leave(r.name);   // the team seat goes, the lead passes on
      if (board) board.remove(idOf(r.key));   // and the results of the key
      game.refreshClans(); saveAll();
      return { ok: true, name: r.name };
    },
    'GET /board': (m, q) => board ? board.list({ period: q.get('period') === 'week' ? 'week' : 'all', sort: q.get('sort') || 'kills', limit: +q.get('limit') || 500 }) : { code: 501, error: 'off' },
    'POST /board/delete': m => {
      if (!board) return { code: 501, error: 'off' };
      if (!board.remove(String(m.id || ''))) return { code: 404, error: 'no-profile' };
      board.save(); return { ok: true };
    },
    'POST /board/reset': m => {
      if (!board) return { code: 501, error: 'off' };
      const period = ['all', 'week', 'both'].includes(m.period) ? m.period : 'both';
      const n = board.reset(m.id ? String(m.id) : '', period);
      board.save(); return { ok: true, n };
    },
    'GET /teams': () => {
      if (!teams) return { code: 501, error: 'off' };
      const inFight = new Set(humans().map(p => p.acct));
      return { rows: teams.list().map(t => ({ ...t, fight: t.members.filter(x => inFight.has(x)).length, where: Object.fromEntries(t.members.map(x => [x, social ? social.whereOf(x) : null])) })) };
    },
    'POST /teams/delete': m => {
      if (!teams) return { code: 501, error: 'off' };
      const t = teams.remove(String(m.id || ''));
      if (!t) return { code: 404, error: 'no-team' };
      game.refreshClans(); teams.save(); return { ok: true, team: t };
    },
    'POST /teams/kick': m => {
      if (!teams) return { code: 501, error: 'off' };
      const r = teams.kickMember(String(m.id || ''), String(m.name || ''));
      if (r.error) return { code: 404, error: r.error };
      game.refreshClans(); teams.save(); return r;
    },
  };

  function finish(res, r) {
    if (r && r.code) reply(res, r.code, { ok: false, error: r.error || 'error' });
    else reply(res, 200, { ok: true, ...r });
  }

  // true when the request is one of ours and has been answered; false — let the server go on as usual
  function route(req, res) {
    let url; try { url = new URL(req.url, 'http://x'); } catch (e) { return false; }
    const p = url.pathname;
    if (p !== '/admin' && !p.startsWith('/admin/')) return false;
    if (p === '/admin' || p === '/admin/') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { reply(res, 405, { ok: false, error: 'method' }); return true; }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : page); return true;
    }
    if (p === '/admin/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '?';
      if (!rateOk(ip)) { reply(res, 429, { ok: false, error: 'rate' }); return true; }
      body(req).then(m => {
        const got = crypto.createHash('sha256').update(String((m && m.pass) || '')).digest();
        if (!crypto.timingSafeEqual(got, want)) { reply(res, 401, { ok: false, error: 'bad-pass' }); return; }
        const t = Date.now();
        for (const [k, v] of sessions) if (t - v.at > TTL) sessions.delete(k);
        if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
        const token = crypto.randomBytes(24).toString('hex');
        sessions.set(token, { at: t, ip });
        reply(res, 200, { ok: true, token, ttl: TTL });
      });
      return true;
    }
    if (p === '/admin/logout' && req.method === 'POST') { sessions.delete(String(req.headers['x-admin-token'] || '')); reply(res, 200, { ok: true }); return true; }
    if (!p.startsWith('/admin/api/')) { reply(res, 404, { ok: false, error: 'bad-request' }); return true; }
    if (!sessionOf(req)) { reply(res, 401, { ok: false, error: 'no-session' }); return true; }
    const h = api[req.method + ' /' + p.slice('/admin/api/'.length)];
    if (!h) { reply(res, 404, { ok: false, error: 'bad-request' }); return true; }
    if (req.method === 'GET') {
      let r; try { r = h({}, url.searchParams); } catch (e) { console.error('admin:', e); reply(res, 500, { ok: false, error: 'internal' }); return true; }
      finish(res, r); return true;
    }
    body(req).then(m => {
      if (!m) { reply(res, 400, { ok: false, error: 'bad-request' }); return; }
      let r; try { r = h(m, url.searchParams); } catch (e) { console.error('admin:', e); reply(res, 500, { ok: false, error: 'internal' }); return; }
      finish(res, r);
    });
    return true;
  }
  return { route };
}
