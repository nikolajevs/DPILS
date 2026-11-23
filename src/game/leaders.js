import { $ } from '../core/env.js';
import { keyId, account } from './identity.js';

/* ---------- the leaderboard of a server ----------
   The table comes from the server (GET /leaderboard on the http address of its WebSocket): all the time or the week,
   sorted by kills, kills per death, accuracy or wins. The sort is also switched by clicking the column heads; the
   active column carries an arrow. A click on a row opens its details (headshots, best streak, rounds, damage, time
   in the game) — they used to hide in the title tooltip. The search field filters the shown rows by name. The table
   refreshes itself every 30 s while the window is open (and by the "Обновить" button); the player's own place is a
   card below the list when he is not in it. Opened with the "Таблица лидеров" buttons; in the training with bots
   there is none. */
const SORTS = [['kills', 'Убийства'], ['kd', 'К/Д'], ['acc', 'Точность'], ['wins', 'Победы']], PERIODS = [['all', 'За всё время'], ['week', 'За неделю']];
const COLS = [['rank', '#'], ['name', 'Игрок'], ['kills', 'Уб.'], ['deaths', 'См.'], ['kd', 'К/Д'], ['acc', 'Точн.'], ['wins', 'Поб.']];
const SORTABLE = ['kills', 'kd', 'acc', 'wins'], SORT_NAME = { kills: 'убийствам', kd: 'К/Д', acc: 'точности', wins: 'победам' };
const LIMIT = 50, REFRESH_MS = 30000;
let getUrl = () => '', period = 'all', sort = 'kills', seq = 0, timer = 0, lastOk = 0, data = null, ui = null;
const expanded = new Set();   // the names whose details are open: kept across refreshes
const httpOf = u => u.replace(/^ws/, 'http').replace(/\/+$/, '');
const dur = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' ч ' + m + ' мин' : m + ' мин'; };
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const cell = (t, c, role) => { const s = document.createElement('span'); s.textContent = t; s.className = 'c-' + c; if (role) s.setAttribute('role', role); return s; };
const note = t => Object.assign(document.createElement('p'), { className: 'lb-note', textContent: t });

function tabs(list, cur, set) {
  const w = document.createElement('div'); w.className = 'lb-tabs'; w.setAttribute('role', 'group');
  for (const [v, t] of list) {
    const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = t;
    b.setAttribute('aria-pressed', v === cur());
    b.onclick = () => { if (cur() !== v) { set(v); load(); } };
    w.append(b);
  }
  w.sync = () => { [...w.children].forEach((b, i) => b.setAttribute('aria-pressed', list[i][0] === cur())); };
  return w;
}
function build() {
  const body = $('mpLeadersBody'); body.textContent = '';
  const top = document.createElement('div'); top.className = 'lb-top';
  const periods = tabs(PERIODS, () => period, v => period = v), sorts = tabs(SORTS, () => sort, v => sort = v);
  top.append(periods, sorts);
  const tools = document.createElement('div'); tools.className = 'lb-tools';
  const find = document.createElement('input'); find.type = 'search'; find.className = 'lb-find'; find.placeholder = 'Найти игрока в списке';
  find.setAttribute('aria-label', 'Поиск игрока в показанных строках'); find.addEventListener('input', render);
  const refresh = document.createElement('button'); refresh.className = 'btn lb-refresh'; refresh.type = 'button'; refresh.title = 'Обновить таблицу';
  refresh.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"/></svg>Обновить';
  refresh.onclick = () => load();
  tools.append(find, refresh);
  const scroll = document.createElement('div'); scroll.className = 'lb-scroll';
  const list = document.createElement('div'); list.className = 'lb'; list.setAttribute('role', 'table'); list.setAttribute('aria-label', 'Таблица лидеров сервера');
  scroll.append(list);
  const me = document.createElement('div'); me.className = 'lb-me'; me.hidden = true;
  const foot = document.createElement('p'); foot.className = 'lb-foot';
  body.append(top, tools, scroll, me, foot);
  ui = { periods, sorts, find, refresh, list, me, foot };
}
function headRow() {
  const d = document.createElement('div'); d.className = 'lb-row head'; d.setAttribute('role', 'row');
  for (const [k, t] of COLS) {
    if (SORTABLE.includes(k)) {
      const c = cell('', k, 'columnheader'), b = document.createElement('button');
      b.type = 'button'; b.className = 'lb-sort' + (sort === k ? ' on' : ''); b.title = 'Сортировать по ' + SORT_NAME[k];
      b.append(document.createTextNode(t));
      if (sort === k) { const a = document.createElement('span'); a.className = 'arr'; a.textContent = '▾'; b.append(a); c.setAttribute('aria-sort', 'descending'); }
      b.onclick = () => { if (sort !== k) { sort = k; load(); } };
      c.append(b); d.append(c);
    } else d.append(cell(t, k, 'columnheader'));
  }
  return d;
}
function row(r, i) {
  const d = document.createElement('div');
  d.className = 'lb-row data' + (i % 2 ? ' alt' : '') + (r.rank <= 3 ? ' r' + r.rank : '') + (r.me ? ' me' : '') + (expanded.has(r.name) ? ' open' : '');
  d.dataset.name = r.name; d.tabIndex = 0; d.setAttribute('role', 'row'); d.setAttribute('aria-expanded', expanded.has(r.name));
  const rank = document.createElement('span'); rank.className = 'c-rank'; const badge = document.createElement('span'); badge.className = 'lb-rank'; badge.textContent = r.rank; rank.append(badge);
  const nm = document.createElement('span'); nm.className = 'nm c-name';
  const nt = document.createElement('span'); nt.className = 'nm-t'; nt.textContent = r.name; nm.append(nt);
  if (r.me) { const you = document.createElement('i'); you.className = 'lb-you'; you.textContent = 'вы'; nm.append(you); }
  d.append(rank, nm, cell(r.kills, 'kills'), cell(r.deaths, 'deaths'), cell((+r.kd).toFixed(2), 'kd'), cell(r.acc + ' %', 'acc'), cell(r.wins, 'wins'));
  d.title = expanded.has(r.name) ? 'Свернуть подробности' : 'Раскрыть подробности: попадания в голову, серия, раунды, урон, время в игре';
  const toggle = () => {
    if (expanded.has(r.name)) expanded.delete(r.name); else expanded.add(r.name);
    render();
    for (const el of document.querySelectorAll('#mpLeaders .lb-row.data')) if (el.dataset.name === r.name) { el.focus(); break; }
  };
  d.onclick = toggle;
  d.onkeydown = e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); toggle(); } };
  return d;
}
function detail(r) {
  const d = document.createElement('div'); d.className = 'lb-detail'; d.setAttribute('role', 'note');
  for (const [t, v] of [['В голову', r.heads], ['Лучшая серия', r.best], ['Раундов', r.rounds], ['Урон', r.dmg], ['В игре', dur(r.secs)]]) {
    const s = document.createElement('span'); s.append(document.createTextNode(t + ' '));
    const b = document.createElement('b'); b.textContent = v; s.append(b); d.append(s);
  }
  return d;
}
function emptyText() {
  return sort === 'kd' ? 'В таблице К/Д — игроки с десятью и более убийствами.' : sort === 'acc' ? 'В таблице точности — игроки со ста и более выстрелами.' : 'Пока никого: сыграйте, и результаты появятся здесь.';
}
function render() {
  if (!ui || !data) return;
  ui.periods.sync(); ui.sorts.sync();
  const list = ui.list; list.textContent = ''; list.append(headRow());
  const q = ui.find.value.trim().toLowerCase();
  const rows = q ? data.rows.filter(r => r.name.toLowerCase().includes(q)) : data.rows;
  if (!data.rows.length) list.append(note(emptyText()));
  else if (!rows.length) list.append(note('По запросу «' + ui.find.value.trim() + '» никого нет среди показанных строк.'));
  else rows.forEach((r, i) => { list.append(row(r, i)); if (expanded.has(r.name)) list.append(detail(r)); });
  // the player's own place, when he is not in the shown list
  const box = ui.me; box.textContent = '';
  if (data.me && !data.rows.some(x => x.me)) {
    box.hidden = false;
    const t = document.createElement('div'); t.className = 'lb-me-t'; t.textContent = 'Ваше место — #' + data.me.rank + ' из ' + data.total; box.append(t);
    const sc = document.createElement('div'); sc.className = 'lb-scroll lb-me-scroll';
    const wrap = document.createElement('div'); wrap.className = 'lb'; wrap.append(row({ ...data.me, me: true }, 0));
    if (expanded.has(data.me.name)) wrap.append(detail(data.me));
    sc.append(wrap); box.append(sc);
    if (sort === 'kills' && data.rows.length >= LIMIT) {
      const need = data.rows[data.rows.length - 1].kills - data.me.kills + 1;
      if (need > 0) box.append(note('До топ-' + LIMIT + ' не хватает ' + need + ' ' + plural(need, 'убийства', 'убийств', 'убийств') + '.'));
    }
  } else box.hidden = true;
  // the footer: counts, the week, the moment of the last refresh and the account note
  const foot = ui.foot; foot.textContent = '';
  const parts = [q ? 'Показано ' + rows.length + ' из ' + data.total : 'Игроков в таблице: ' + data.total];
  if (period === 'week') parts.push('неделя ' + data.week);
  if (lastOk) parts.push('обновлено ' + new Date(lastOk).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  foot.append(document.createTextNode(parts.join(' · ')));
  const acc = document.createElement('span'); acc.className = 'lb-acc';
  acc.textContent = account() ? 'Результаты привязаны к аккаунту: войдите с ним на любом устройстве — таблица узнает вас.' : 'Войдите в аккаунт, чтобы ваши результаты попадали в таблицу.';
  foot.append(acc);
}
function skeleton() {
  const list = ui.list; list.textContent = ''; list.append(headRow());
  for (let i = 0; i < 10; i++) {
    const d = document.createElement('div'); d.className = 'lb-row skel'; d.setAttribute('aria-hidden', 'true');
    for (const [k] of COLS) { const s = document.createElement('span'); s.className = 'c-' + k; d.append(s); }
    list.append(d);
  }
  ui.me.hidden = true; ui.foot.textContent = 'Загружаю…';
}
function showMsg(text, retry) {
  data = null; ui.list.textContent = '';
  const p = Object.assign(document.createElement('p'), { className: 'hint', textContent: text }); ui.list.append(p);
  if (retry) { const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = 'Повторить'; b.onclick = () => load(); ui.list.append(b); }
  ui.me.hidden = true; ui.foot.textContent = '';
}
async function load(silent) {
  const url = getUrl(), mine = ++seq;
  if (!url) { showMsg('Таблица лидеров есть у онлайн-сервера. В тренировке с ботами таблицы нет.'); return; }
  if (!silent || !data) skeleton();
  ui.refresh.disabled = true; ui.refresh.classList.add('busy');
  try {
    const me = await keyId(), r = await fetch(httpOf(url) + '/leaderboard?period=' + period + '&sort=' + sort + '&limit=' + LIMIT + (me ? '&me=' + me : ''));
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); if (mine !== seq) return;
    data = j; lastOk = Date.now(); render();
  } catch (e) {
    if (mine !== seq) return;
    if (silent && data) { if (ui.foot.firstChild) ui.foot.firstChild.textContent += ' · сервер не ответил, данные могут устареть'; else render(); }
    else showMsg('Сервер не отвечает или без таблицы лидеров.', true);
  } finally { if (mine === seq) { ui.refresh.disabled = false; ui.refresh.classList.remove('busy'); } }
}
function open() {
  if (document.pointerLockElement) document.exitPointerLock();
  $('mpLeaders').hidden = false;
  load();
  if (!timer) timer = setInterval(() => { if (!$('mpLeaders').hidden) load(true); }, REFRESH_MS);
}
function close() { $('mpLeaders').hidden = true; seq++; if (timer) { clearInterval(timer); timer = 0; } }
export function initLeaders(urlGetter) {
  getUrl = urlGetter;
  build();
  $('mpLeadersClose').onclick = close; $('mpLeaders').addEventListener('click', e => { if (e.target === $('mpLeaders')) close(); });
  $('bLeaders').onclick = open; $('bLeadersStart').onclick = open;
  window.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('mpLeaders').hidden) { close(); e.stopImmediatePropagation(); } }, true);
}