import { $ } from '../core/env.js';
import { keyId } from './identity.js';

/* ---------- the leaderboard of a server ----------
   The table comes from the server (GET /leaderboard on the http address of its WebSocket): all the time or the week,
   sorted by kills, kills per death, accuracy or wins; the row of this player is shown below the list when he is not in
   it. Opened with the "Таблица лидеров" buttons; in the training with bots there is none. */
const SORTS = [['kills', 'Убийства'], ['kd', 'К/Д'], ['acc', 'Точность'], ['wins', 'Победы']], PERIODS = [['all', 'За всё время'], ['week', 'За неделю']];
let getUrl = () => '', period = 'all', sort = 'kills', seq = 0;
const httpOf = u => u.replace(/^ws/, 'http').replace(/\/+$/, '');
const dur = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' ч ' + m + ' мин' : m + ' мин'; };
const cell = (t, c) => { const s = document.createElement('span'); s.textContent = t; if (c) s.className = c; return s; };
function line(r, head) {
  const d = document.createElement('div'); d.className = 'lb-row' + (head ? ' head' : '') + (r && r.me ? ' me' : '');
  if (head) for (const t of ['#', 'Игрок', 'Уб.', 'См.', 'К/Д', 'Точн.', 'Поб.']) d.append(cell(t));
  else d.append(cell(r.rank), cell(r.name, 'nm'), cell(r.kills), cell(r.deaths), cell(r.kd), cell(r.acc + ' %'), cell(r.wins));
  d.title = head ? '' : 'В голову: ' + r.heads + ' · лучшая серия: ' + r.best + ' · раундов: ' + r.rounds + ' · в игре: ' + dur(r.secs);
  return d;
}
function tabs(list, cur, set) {
  const w = document.createElement('div'); w.className = 'lb-tabs';
  for (const [v, t] of list) { const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', v === cur); b.onclick = () => { set(v); load(); }; w.append(b); }
  return w;
}
function frame(...n) {
  const body = $('mpLeadersBody'); body.textContent = '';
  body.append(tabs(PERIODS, period, v => period = v), tabs(SORTS, sort, v => sort = v), ...n);
}
async function load() {
  const url = getUrl(), mine = ++seq;
  if (!url) { frame(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Таблица лидеров есть у онлайн-сервера. Выберите сервер в списке или введите его адрес, затем откройте таблицу снова. В тренировке с ботами таблицы нет.' })); return; }
  frame(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Загружаю…' }));
  try {
    const me = await keyId(), r = await fetch(httpOf(url) + '/leaderboard?period=' + period + '&sort=' + sort + '&limit=50' + (me ? '&me=' + me : ''));
    if (!r.ok) throw new Error(r.status); const j = await r.json(); if (mine !== seq) return;
    const list = document.createElement('div'); list.className = 'lb'; list.append(line(null, true)); for (const row of j.rows) list.append(line(row));
    const out = [list];
    if (!j.rows.length) out[0] = Object.assign(document.createElement('p'), { className: 'hint', textContent: sort === 'kd' ? 'В таблице К/Д — игроки с десятью и более убийствами.' : sort === 'acc' ? 'В таблице точности — игроки со ста и более выстрелами.' : 'Пока никого: сыграйте, и результаты появятся здесь.' });
    if (j.me && !j.rows.some(x => x.me)) { const s = document.createElement('div'); s.className = 'lb'; s.append(line({ ...j.me, me: true })); out.push(Object.assign(document.createElement('h3'), { textContent: 'Ваше место' }), s); }
    out.push(Object.assign(document.createElement('div'), { className: 'st-since', textContent: 'Игроков в таблице: ' + j.total + (period === 'week' ? ' · неделя ' + j.week : '') + '. Результаты привязаны к этому браузеру, регистрация не нужна.' }));
    frame(...out);
  } catch (e) { if (mine === seq) frame(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Сервер не отвечает или без таблицы лидеров.' })); }
}
function open() { if (document.pointerLockElement) document.exitPointerLock(); $('mpLeaders').hidden = false; load(); }
const close = () => { $('mpLeaders').hidden = true; };
export function initLeaders(urlGetter) {
  getUrl = urlGetter;
  $('mpLeadersClose').onclick = close; $('mpLeaders').addEventListener('click', e => { if (e.target === $('mpLeaders')) close(); });
  $('bLeaders').onclick = open; $('bLeadersStart').onclick = open;
  window.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('mpLeaders').hidden) { close(); e.stopImmediatePropagation(); } }, true);
}
