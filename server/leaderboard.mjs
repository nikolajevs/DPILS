/* The leaderboard of a server: the results of the players for all the time and for the week, kept in a file. A player is
   known by a secret key his browser makes and sends at the join; the server keeps only a hash of it, so the results
   belong to the player and not to the nick, and nobody can take his nick (another key asking for it gets "nick#2").
   Bots and the training in the page are not in it. The table goes to the page through /leaderboard (index.mjs); it never
   carries the hashes. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FIELDS = ['kills', 'deaths', 'heads', 'shots', 'hits', 'dmg', 'rounds', 'wins', 'secs', 'best'];
const zero = () => Object.fromEntries(FIELDS.map(f => [f, 0]));
export const idOf = key => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32);   // the page makes the same id for "me"
export const validKey = k => typeof k === 'string' && /^[0-9a-f]{16,64}$/i.test(k);
export function isoWeek(t) { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); const y = d.getUTCFullYear(); return y + '-W' + String(Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0'); }

export function createBoard({ file, now = Date.now } = {}) {
  let data = { v: 1, profiles: {}, names: {} }, dirty = false;
  if (file) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.profiles && j.names) data = j; } catch (e) { /* no file yet, or a broken one: start empty */ } }
  const lower = s => s.toLowerCase();
  const week = pr => { const w = isoWeek(now()); if (pr.week.id !== w) pr.week = { id: w, ...zero() }; return pr.week; };
  // a player joins: returns his name (changed if another key owns it, or if it is in use now) and the handle to count with
  function identify(key, wanted, free = () => true) {
    const id = idOf(key); let pr = data.profiles[id], name = wanted;
    for (let k = 2; ; k++) { const owner = data.names[lower(name)]; if ((!owner || owner === id) && free(name)) break; name = wanted.slice(0, 13) + '#' + k; }
    if (!pr) pr = data.profiles[id] = { name, seen: now(), all: zero(), week: { id: isoWeek(now()), ...zero() } };
    if (lower(pr.name) !== lower(name) && data.names[lower(pr.name)] === id) delete data.names[lower(pr.name)];
    pr.name = name; data.names[lower(name)] = id; pr.seen = now(); dirty = true;
    return { name, prof: { add(f, n = 1) { pr.all[f] += n; week(pr)[f] += n; dirty = true; }, max(f, n) { pr.all[f] = Math.max(pr.all[f], n); const w = week(pr); w[f] = Math.max(w[f], n); dirty = true; } } };
  }
  // the table: period all | week, sort kills | kd | acc | wins; me: the id of the asker
  function top({ period = 'all', sort = 'kills', limit = 50, me = '' } = {}) {
    const cur = isoWeek(now());
    let rows = Object.entries(data.profiles).map(([id, p]) => { const s = period === 'week' ? (p.week.id === cur ? p.week : zero()) : p.all; return { id, name: p.name, ...s, kd: s.deaths ? s.kills / s.deaths : s.kills, acc: s.shots ? 100 * s.hits / s.shots : 0 }; });
    rows = rows.filter(r => r.kills > 0 || r.deaths > 0 || r.shots > 0);
    if (sort === 'kd') rows = rows.filter(r => r.kills >= 10); else if (sort === 'acc') rows = rows.filter(r => r.shots >= 100);   // a few lucky shots are not a place
    const key = ['kills', 'kd', 'acc', 'wins'].includes(sort) ? sort : 'kills';
    rows.sort((a, b) => b[key] - a[key] || b.kills - a.kills || a.deaths - b.deaths);
    const out = r => ({ name: r.name, kills: r.kills, deaths: r.deaths, kd: +r.kd.toFixed(2), acc: Math.round(r.acc), heads: r.heads, wins: r.wins, rounds: r.rounds, dmg: Math.round(r.dmg), secs: r.secs, best: r.best });
    const list = rows.slice(0, Math.max(1, Math.min(100, limit))).map((r, i) => ({ rank: i + 1, me: r.id === me, ...out(r) })), at = me ? rows.findIndex(r => r.id === me) : -1;
    return { period, sort: key, week: cur, total: rows.length, rows: list, me: at >= 0 ? { rank: at + 1, ...out(rows[at]) } : null };
  }
  // the admin panel (admin.mjs): the same table, but every row keeps its id and its last visit, the inactive ones too
  function list({ period = 'all', sort = 'kills', limit = 500 } = {}) {
    const cur = isoWeek(now());
    let rows = Object.entries(data.profiles).map(([id, p]) => { const s = period === 'week' ? (p.week.id === cur ? p.week : zero()) : p.all; return { id, name: p.name, seen: p.seen, ...s, kd: s.deaths ? s.kills / s.deaths : s.kills, acc: s.shots ? 100 * s.hits / s.shots : 0 }; });
    const key = ['kills', 'kd', 'acc', 'wins'].includes(sort) ? sort : 'kills';
    rows.sort((a, b) => b[key] - a[key] || b.kills - a.kills || a.deaths - b.deaths);
    return { period, sort: key, week: cur, total: rows.length, rows: rows.slice(0, Math.max(1, Math.min(1000, limit))).map(r => ({ ...r, kd: +r.kd.toFixed(2), acc: Math.round(r.acc), dmg: Math.round(r.dmg) })) };
  }
  // a profile goes (the admin), with the nick it owns
  function remove(id) {
    const p = data.profiles[id]; if (!p) return false;
    delete data.profiles[id]; if (data.names[lower(p.name)] === id) delete data.names[lower(p.name)];
    dirty = true; return true;
  }
  // the counters back to zero (the admin): one profile or all of them, the whole time or the week or both
  function reset(id, period = 'both') {
    const one = id ? [data.profiles[id]].filter(Boolean) : Object.values(data.profiles);
    for (const p of one) { if (period !== 'week') p.all = zero(); if (period !== 'all') p.week = { id: isoWeek(now()), ...zero() }; }
    if (one.length) dirty = true;
    return one.length;
  }
  // the players who have not come for four months and have few kills go, with their nicks
  function prune() { const old = now() - 120 * 86400000; for (const [id, p] of Object.entries(data.profiles)) if (p.seen < old && p.all.kills < 20) { delete data.profiles[id]; if (data.names[lower(p.name)] === id) delete data.names[lower(p.name)]; } }
  function save() {
    if (!file || !dirty) return; dirty = false; prune();
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); } catch (e) { dirty = true; console.error('leaderboard not saved:', e.message); }
  }
  return { identify, top, list, remove, reset, save, count: () => Object.keys(data.profiles).length };
}
