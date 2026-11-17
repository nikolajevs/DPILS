import { $ } from '../core/env.js';

/* ---------- the list of servers on the start card ----------
   The list is servers.json beside the page (the owner's servers), the servers the player has joined before (kept in
   the browser) and, on localhost, the local one. Each server is asked for /health (players, round, the time it takes to
   answer) every few seconds while the card is open; a click puts its address in the field below. */
const listEl = $('mpServers'), input = $('mpServer'), KEEP = 'dpils.servers';
let rows = [], timer = 0;
const wsUrl = u => { u = String(u || '').trim(); if (u && !/^wss?:\/\//.test(u)) u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + u; return u.replace(/\/+$/, ''); };
const healthUrl = u => u.replace(/^ws/, 'http') + '/health';
const blocked = u => location.protocol === 'https:' && u.startsWith('ws://') && !/^ws:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u);   // a page on https cannot reach a plain ws:// server
function remembered() { try { const a = JSON.parse(localStorage.getItem(KEEP) || '[]'); return Array.isArray(a) ? a.filter(x => x && typeof x.url === 'string').slice(0, 8) : []; } catch (e) { return []; } }
function rememberServer(url, name) {
  url = wsUrl(url); if (!url || rows.some(r => r.fixed && r.url === url)) return;
  try { const a = remembered().filter(x => x.url !== url); a.unshift({ name: name || url.replace(/^wss?:\/\//, ''), url }); localStorage.setItem(KEEP, JSON.stringify(a.slice(0, 8))); } catch (e) {}
}
async function load() {
  const out = [], seen = new Set(), add = (name, url, fixed) => { url = wsUrl(url); if (url && !seen.has(url)) { seen.add(url); out.push({ name, url, fixed }); } };
  try { const r = await fetch('servers.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); for (const s of j.servers || []) add(String(s.name || s.url), s.url, true); } } catch (e) {}
  const q = new URLSearchParams(location.search).get('server'); if (q) add('Из адреса страницы', q, true);
  if (['localhost', '127.0.0.1'].includes(location.hostname)) add('Локальный сервер', 'ws://localhost:8787', true);
  for (const s of remembered()) add(s.name, s.url, false);
  rows = out;
}
async function probe(row) {
  if (blocked(row.url)) { row.state = 'https'; return; }
  const c = new AbortController(), t = setTimeout(() => c.abort(), 4000), t0 = performance.now();
  try { const r = await fetch(healthUrl(row.url), { cache: 'no-store', signal: c.signal }), j = await r.json(); row.info = j; row.ping = Math.round(performance.now() - t0); row.state = 'up'; }
  catch (e) { row.state = 'down'; row.info = null; } finally { clearTimeout(t); }
}
function render() {
  listEl.textContent = '';
  if (!rows.length) { const e = document.createElement('div'); e.className = 'srv-empty'; e.textContent = 'Список пуст: введите адрес сервера ниже.'; listEl.append(e); return; }
  for (const r of rows) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'srv' + (wsUrl(input.value) === r.url ? ' on' : '') + ' ' + (r.state || 'wait'); b.dataset.url = r.url;
    const n = document.createElement('b'), s = document.createElement('span'), p = document.createElement('i');
    n.textContent = (r.info && r.info.name) || r.name;
    if (r.state === 'up') { s.textContent = r.info.players + ' / ' + r.info.max + (r.info.mode === 'ffa' ? ' · каждый сам за себя' : ' · команды') + (r.info.arena ? ' · ' + r.info.arena : '') + (r.info.bots ? ' · ботов ' + r.info.bots : '') + (r.info.round === 'end' ? ' · раунд окончен' : ''); p.textContent = r.ping + ' мс'; }
    else if (r.state === 'down') s.textContent = 'не отвечает'; else if (r.state === 'https') s.textContent = 'нужен wss:// (страница на https)'; else s.textContent = 'проверяю…';
    b.append(n, s, p); b.onclick = () => { input.value = r.url; render(); }; listEl.append(b);
  }
}
async function refresh() {
  render(); await Promise.all(rows.map(probe));
  if (!input.value.trim()) { const up = rows.find(r => r.fixed && r.state === 'up'); if (up) input.value = up.url; }   // an empty field takes the first working server of the list
  render();
}
async function start() { await load(); await refresh(); clearInterval(timer); timer = setInterval(() => { if (!$('start').hidden) refresh(); }, 8000); }
input.addEventListener('input', render); $('mpServersRefresh').onclick = () => { load().then(refresh); };
start();

export { rememberServer };
