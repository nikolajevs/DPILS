/* The admin panel of the server: the page /admin (admin.html) and its JSON doors — /admin/login, /admin/logout and
   /admin/api/*. It is off until ADMIN_PASS is set in the environment: without the password /admin answers as any
   unknown path, and nothing here runs. The password opens a session: a random token, twelve hours, kept in memory
   only (a restart of the server asks to log in again); every api call carries it in the x-admin-token header.
   The panel reads the fight (who plays, the match, the storm), puts a player out, says a line to everybody, sets the
   number of bots, drops the cargo on demand, and keeps the books: the accounts (a list, a new password, removal with
   the results and the team seat), the leaderboard (a list, a reset of one or all, removal) and the teams (a list, a
   member out, disband). The answers never carry a key, a password hash or a salt — only the public id of the results.
   The login is limited per address (10 tries in 10 minutes); the answers stay same-origin (no CORS headers), so a
   page on another address cannot read them.
   Debug side (the «Отладка» and «Журнал» tabs): while the panel is on it keeps a ring of the server's own console
   (log/info/warn/error, the last 1000 lines), the process warnings and the uncaught errors, and an audit line for
   every admin action and every refused login; /admin/api/logs reads the ring (incrementally, by id), /logs/clear
   empties it. /admin/api/debug is the live picture of the process: cpu and memory, the event-loop lag (a 500 ms
   probe), the http counters (index.mjs calls note() on every answered request), the WebSocket crowd, the insides of
   the fight (grenades and bullets in the air, the zones, the cargo, the marks, the match roster, the storm circles)
   and the whitelisted environment (never ADMIN_PASS itself). /admin/api/player?id= is the full safe dump of one
   player: the inventory, the reload and protection timers, the pose history length, the message rate.
   Events side (the «Ивенты» tab): /admin/api/events reads the settings and the live state of the three events — the
   «Царь горы» race, the cargo drop and the storm; /events/<kind> tunes the rules and the auto-run flag (events.mjs
   keeps them in server/data/events.json), /events/holy/start|stop|next and /events/cargo/drop|remove|next drive the
   events by hand, /events/reset restores the defaults. The storm settings apply to the next match. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { idOf } from './leaderboard.mjs';
import { CARGO, HOLY, SIEGE } from './combat.mjs';

const TTL = 12 * 3600 * 1000, MAX_SESSIONS = 64, LOG_CAP = 1000;
const ENV_KEYS = ['PORT', 'SERVER_NAME', 'MODE', 'ARENA', 'BOTS', 'BOT_LEVEL', 'WIN_SCORE', 'MATCH', 'DAY_MIN', 'LEADERBOARD', 'ACCOUNTS', 'TEAMS', 'EVENTS', 'STATIC', 'NODE_ENV'];
const mb = b => Math.round(b / 1048576 * 10) / 10;

export function createAdmin({ pass, game, accounts = null, board = null, teams = null, social = null, events = null, clients = () => 0, sockets = () => [], files = [] }) {
  if (!pass) return { route: () => false, note: () => {} };   // no password — no panel: the paths fall through to the usual 404
  const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin.html'), 'utf8');
  const want = crypto.createHash('sha256').update(String(pass)).digest();
  const sessions = new Map();   // token → { at, ip }
  const hits = new Map();       // ip → { n, t } — the login tries
  const bootAt = Date.now();

  /* ---- the journal: the server's console, the process warnings, the audit of the panel ---- */
  const logs = []; let logSeq = 1;
  const totals = { log: 0, info: 0, warn: 0, error: 0 };
  function push(level, text) {
    logs.push({ id: logSeq++, t: Date.now(), level, text: String(text).slice(0, 4000) });
    if (logs.length > LOG_CAP) logs.splice(0, logs.length - LOG_CAP);
    totals[level]++;
  }
  const fmt = args => args.map(x => typeof x === 'string' ? x : x instanceof Error ? (x.stack || x.message) : util.inspect(x, { depth: 3, breakLength: 140 })).join(' ');
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...a) => { push(level, fmt(a)); orig(...a); };
  }
  process.on('warning', w => push('warn', 'process warning: ' + (w.stack || w.message)));
  process.on('uncaughtExceptionMonitor', e => push('error', 'uncaughtException: ' + (e && e.stack || e)));
  process.on('unhandledRejection', r => { push('error', 'unhandledRejection: ' + (r && r.stack || r)); throw r; });   // logged, then the usual crash

  /* ---- the event-loop probe and the cpu meter ---- */
  let lagLast = 0, lagMax = 0, lagPrev = Date.now(); const lagRing = [];
  const lagTimer = setInterval(() => {
    const t = Date.now(), lag = Math.max(0, t - lagPrev - 500); lagPrev = t;
    lagLast = lag; if (lag > lagMax) lagMax = lag;
    lagRing.push(lag); if (lagRing.length > 120) lagRing.shift();
  }, 500);
  if (lagTimer.unref) lagTimer.unref();
  let cpuPrev = process.cpuUsage(), cpuPrevT = Date.now();
  function cpuPct() {
    const u = process.cpuUsage(cpuPrev), t = Date.now(), dt = Math.max(1, t - cpuPrevT);
    cpuPrev = process.cpuUsage(); cpuPrevT = t;
    return Math.round((u.user + u.system) / 1000 / dt * 100);   // percent of one core
  }

  /* ---- the http counters (index.mjs notes every answered request) ---- */
  const http = { total: 0, s2: 0, s3: 0, s4: 0, s5: 0, buckets: new Map() };
  function note(code) {
    http.total++; const k = 's' + Math.floor(code / 100); if (k in http) http[k]++;
    const sec = Math.floor(Date.now() / 1000);
    http.buckets.set(sec, (http.buckets.get(sec) || 0) + 1);
    if (http.buckets.size > 90) for (const s of http.buckets.keys()) if (s < sec - 60) http.buckets.delete(s);
  }
  function perMin() { const sec = Math.floor(Date.now() / 1000); let n = 0; for (const [s, c] of http.buckets) if (s > sec - 60) n += c; return n; }

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
  const envView = () => { const e = {}; for (const k of ENV_KEYS) if (process.env[k] !== undefined) e[k] = String(process.env[k]); e.ADMIN_PASS = '(задан)'; return e; };
  const circle = c => c && { x: Math.round(c.x), z: Math.round(c.z), r: c.r == null ? 0 : Math.round(c.r) };

  // the doors: 'METHOD /name' → handler(body, query); a plain object is a 200, { code, error } is the refusal
  const api = {
    'GET /overview': () => {
      const mem = process.memoryUsage();
      return {
        server: game.health(), uptime: Math.round(process.uptime()), boot: bootAt, node: process.version,
        mem: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576), clients: clients(),
        loop: { last: lagLast, max: lagMax }, journal: { errors: totals.error, warns: totals.warn, held: logs.length },
        http: { total: http.total, perMin: perMin(), s4: http.s4, s5: http.s5 },
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
    // the events: the settings and the auto-run flag (events.mjs), the live state from the game
    'GET /events': () => {
      if (!events) return { code: 501, error: 'off' };
      const t = Date.now(), h = game.holyState(), c = game.cargoState(), sg = game.siegeState(), hs = game.health();
      return {
        ...events.view(),
        state: {
          holy: h ? { active: true, id: h.id, left: h.left, until: h.until, held: h.points.filter(p => p.owner).length, hold: h.hold, points: h.points.map(p => ({ i: p.i, temple: HOLY.temples[p.i].short, owner: p.owner, name: p.name, prog: p.prog })) } : { active: false, nextIn: Math.max(0, game.holyNextAt - t) },
          cargo: c ? { active: true, id: c.id, state: c.state, x: Math.round(c.x), z: Math.round(c.z), left: Math.max(0, (c.until || c.landAt) - t) } : { active: false, nextIn: Math.max(0, game.cargoNextAt - t) },
          storm: { match: hs.match || null, live: hs.storm || null },
          siege: sg ? { active: true, id: sg.id, phase: sg.phase, left: sg.left, counts: sg.counts, prog: sg.prog, contest: sg.contest } : { active: false, nextIn: Math.max(0, game.siegeNextAt - t) },
        },
      };
    },
    'POST /events/holy': m => evSet('holy', m),
    'POST /events/cargo': m => evSet('cargo', m),
    'POST /events/storm': m => evSet('storm', m),
    'POST /events/siege': m => evSet('siege', m),
    'POST /events/siege/start': () => { const r = game.siegeStart(); return r === 'ok' ? { ok: true } : { code: 409, error: r }; },
    'POST /events/siege/stop': () => game.siegeStop() ? { ok: true } : { code: 409, error: 'idle' },
    'POST /events/siege/next': m => game.siegeNext(clampMs(m.inMs, SIEGE.gapMs)) ? { ok: true } : { code: 409, error: 'active' },
    'POST /events/holy/start': () => { const r = game.holyStart(); return r === 'ok' ? { ok: true } : { code: 409, error: r }; },
    'POST /events/holy/stop': () => game.holyStop() ? { ok: true } : { code: 409, error: 'idle' },
    'POST /events/holy/next': m => game.holyNext(clampMs(m.inMs, HOLY.gapMs)) ? { ok: true } : { code: 409, error: 'active' },
    'POST /events/cargo/drop': () => game.cargo ? { code: 409, error: 'active' } : (game.cargoDrop(), { ok: true }),
    'POST /events/cargo/remove': () => game.cargoRemove() ? { ok: true } : { code: 409, error: 'idle' },
    'POST /events/cargo/next': m => game.cargoNext(clampMs(m.inMs, CARGO.gapMs)) ? { ok: true } : { code: 409, error: 'active' },
    'POST /events/reset': m => { const k = ['holy', 'cargo', 'storm', 'siege', 'all'].includes(m.kind) ? m.kind : 'all'; events.reset(k); return { ok: true, kind: k }; },
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
    // the journal: the ring of the console and the audit, read incrementally (?after=<last id>), filtered by level and text
    'GET /logs': (m, q) => {
      const after = +q.get('after') || 0, level = q.get('level') || '', needle = (q.get('q') || '').toLowerCase();
      let rows = logs.filter(e => e.id > after);
      if (level) rows = rows.filter(e => e.level === level);
      if (needle) rows = rows.filter(e => e.text.toLowerCase().includes(needle));
      return { entries: rows.slice(-500), last: logSeq - 1, totals: { ...totals }, cap: LOG_CAP, held: logs.length };
    },
    'POST /logs/clear': () => { logs.length = 0; return { ok: true }; },
    // the live debug picture: the process, the event loop, the network, the insides of the fight, the environment
    'GET /debug': () => {
      const t = Date.now(), mem = process.memoryUsage(), cpus = os.cpus();
      const m = game.match, s = game.storm, hs = game.health().storm;
      return {
        process: {
          pid: process.pid, node: process.version, platform: process.platform + ' ' + process.arch,
          cpus: cpus.length, cpuModel: (cpus[0] || {}).model || '', loadavg: os.loadavg().map(x => +x.toFixed(2)),
          uptime: Math.round(process.uptime()), boot: bootAt, cpu: cpuPct(),
          mem: { rss: mb(mem.rss), heapTotal: mb(mem.heapTotal), heapUsed: mb(mem.heapUsed), external: mb(mem.external), arrayBuffers: mb(mem.arrayBuffers) },
          handles: process._getActiveHandles ? process._getActiveHandles().length : null,
          requests: process._getActiveRequests ? process._getActiveRequests().length : null,
        },
        loop: { last: lagLast, max: lagMax, avg: Math.round(lagRing.reduce((a, b) => a + b, 0) / Math.max(1, lagRing.length)), samples: lagRing.slice(-60) },
        net: { http: { total: http.total, s2: http.s2, s3: http.s3, s4: http.s4, s5: http.s5, perMin: perMin() }, ws: { clients: clients() } },
        sockets: sockets(),
        world: {
          players: game.players.size, bots: [...game.players.values()].filter(p => p.bot).length,
          nades: game.nades.size, bullets: game.bullets.size,
          items: { active: [...game.items.values()].filter(i => i.active).length, total: game.items.size },
          zones: [...game.zones.values()].map(z => ({ id: z.id, kind: z.kind, x: Math.round(z.x), z: Math.round(z.z), r: z.r, left: Math.max(0, z.until - t) })),
          marks: [...game.players.values()].filter(p => p.markUntil > t).map(p => ({ id: p.id, name: p.name, left: p.markUntil - t })),
          cargo: game.cargo ? { id: game.cargo.id, state: game.cargo.state, x: Math.round(game.cargo.x), z: Math.round(game.cargo.z), left: Math.max(0, (game.cargo.until || game.cargo.landAt) - t) } : null,
        },
        match: m ? { n: m.n, start: m.start, end: m.end, stormAt: m.stormAt, doorAt: game.doorAt, roster: m.roster.size, out: m.out.size, warned: [...m.warned], closedSaid: m.closedSaid } : null,
        storm: s ? { phase: s.phase, kind: s.kind, pi: s.pi, stages: s.plan.length, dps: s.dps, cur: circle(s.cur), from: circle(s.from), to: circle(s.to), final: circle(s.final), t0: s.t0, t1: s.t1, left: Math.max(0, s.t1 - t), alive: hs ? hs.alive : null, total: hs ? hs.total : null } : null,
        env: envView(),
      };
    },
    // the full safe dump of one player: everything the server knows of him, without the key and the account key
    'GET /player': (m, q) => {
      const p = game.players.get(+q.get('id')); if (!p) return { code: 404, error: 'no-player' };
      const t = Date.now(), r2 = v => Math.round(v * 100) / 100;
      return { player: {
        id: p.id, name: p.name, acct: p.acct || '', clan: p.clan || null, team: p.team, bot: !!p.bot, char: p.char,
        joinedAt: p.joinedAt, alive: p.alive, hp: r2(p.hp), diedAt: p.diedAt,
        x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch), eye: p.eye, free: !!p.free, fallTop: p.fallTop == null ? null : r2(p.fallTop),
        wep: p.wep, loadout: p.loadout, attach: p.attach, mag: p.mag, reserve: p.reserve, pack: p.pack,
        meds: p.meds, nades: p.nades, smokes: p.smokes, napalms: p.napalms,
        reloadW: p.reloadW, reloadLeft: Math.max(0, p.reloadDone - t), protectLeft: Math.max(0, p.protectUntil - t), markLeft: Math.max(0, p.markUntil - t),
        kills: p.kills, deaths: p.deaths, st: { ...p.st, dmg: Math.round(p.st.dmg) }, streak: p.streak || 0,
        ping: p.bot ? null : Math.round(p.rtt), msgs: p.msgs, hist: p.hist.length, histLast: p.hist.slice(-3),
        lastShotAgo: p.lastShot ? t - p.lastShot : null, lastNadeAgo: p.lastNade ? t - p.lastNade : null, lastChatAgo: p.lastChat ? t - p.lastChat : null,
        board: !!p.prof,
      } };
    },
  };

  // the events: a patch of settings and/or the auto-run flag; the store clamps the values and keeps them between restarts
  function evSet(kind, m) {
    if (!events) return { code: 501, error: 'off' };
    if (m.enabled !== undefined) events.setEnabled(kind, !!m.enabled);
    if (m.cfg !== undefined) { const r = events.set(kind, m.cfg); if (r.error) return { code: 400, error: r.error }; }
    return { ok: true };
  }
  const clampMs = (v, def) => { const n = +v; return Number.isFinite(n) ? Math.max(0, Math.min(86400000, n)) : def; };

  function finish(res, r) {
    if (r && r.code) reply(res, r.code, { ok: false, error: r.error || 'error' });
    else reply(res, 200, { ok: true, ...r });
  }
  // the audit line of an action: the body without the passwords, short
  const audit = (name, m, ip) => { const c = { ...m }; delete c.pass; push('info', 'admin: ' + name + ' ' + JSON.stringify(c).slice(0, 200) + ' ip=' + ip); };

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
      if (!rateOk(ip)) { push('warn', 'admin: лимит попыток входа, ip=' + ip); reply(res, 429, { ok: false, error: 'rate' }); return true; }
      body(req).then(m => {
        const got = crypto.createHash('sha256').update(String((m && m.pass) || '')).digest();
        if (!crypto.timingSafeEqual(got, want)) { push('warn', 'admin: неверный пароль, ip=' + ip); reply(res, 401, { ok: false, error: 'bad-pass' }); return; }
        const t = Date.now();
        for (const [k, v] of sessions) if (t - v.at > TTL) sessions.delete(k);
        if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
        const token = crypto.randomBytes(24).toString('hex');
        sessions.set(token, { at: t, ip });
        push('info', 'admin: вход, ip=' + ip);
        reply(res, 200, { ok: true, token, ttl: TTL });
      });
      return true;
    }
    if (p === '/admin/logout' && req.method === 'POST') { sessions.delete(String(req.headers['x-admin-token'] || '')); reply(res, 200, { ok: true }); return true; }
    if (!p.startsWith('/admin/api/')) { reply(res, 404, { ok: false, error: 'bad-request' }); return true; }
    if (!sessionOf(req)) { reply(res, 401, { ok: false, error: 'no-session' }); return true; }
    const name = p.slice('/admin/api/'.length), h = api[req.method + ' /' + name];
    if (!h) { reply(res, 404, { ok: false, error: 'bad-request' }); return true; }
    const ip = req.socket.remoteAddress || '?';
    if (req.method === 'GET') {
      let r; try { r = h({}, url.searchParams); } catch (e) { console.error('admin:', e); reply(res, 500, { ok: false, error: 'internal' }); return true; }
      finish(res, r); return true;
    }
    body(req).then(m => {
      if (!m) { reply(res, 400, { ok: false, error: 'bad-request' }); return; }
      let r; try { r = h(m, url.searchParams); } catch (e) { console.error('admin:', e); reply(res, 500, { ok: false, error: 'internal' }); return; }
      if (!(r && r.code)) audit(name, m, ip);
      finish(res, r);
    });
    return true;
  }
  return { route, note };
}