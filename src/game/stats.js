import { $ } from '../core/env.js';

/* ---------- the statistics of the player, for all the time ----------
   Kept in the browser (localStorage, on this device only): one set of numbers for everything, one for the training with
   bots. Counted: shots and hits, kills (by weapon, in the head, with a grenade), deaths, damage given and taken, the
   best series of kills without a death, rounds and wins, the best round, the time in the game. The window opens with the
   "Статистика" buttons. */
const KEY = 'dpils.stats', WEAPON_NAMES = { 0: 'Автомат', 1: 'Дробовик', 2: 'Снайперская', 3: 'Пистолет', 4: 'Пулемёт', 5: 'M4A1', 6: 'SCAR-L', 7: 'AR-15', 9: 'Граната' };
const zero = () => ({ kills: 0, deaths: 0, heads: 0, shots: 0, hits: 0, dmg: 0, taken: 0, rounds: 0, wins: 0, secs: 0, best: 0, bestRound: 0, by: {} });
let S = { all: zero(), train: zero(), since: Date.now() }, streak = 0, dirty = false, saveT = 0;
try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && j.all && j.train) { S = { all: { ...zero(), ...j.all }, train: { ...zero(), ...j.train }, since: j.since || Date.now() }; } } catch (e) {}
function save() { if (!dirty) return; dirty = false; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
window.addEventListener('pagehide', save); window.addEventListener('beforeunload', save);

// one event of the game: shot, hit { head, dmg }, kill { w, head }, death, taken { dmg }, round { win, kills }, tick { dt }; train: in the game against bots
function statEvent(type, d = {}, train = false) {
  for (const T of train ? [S.all, S.train] : [S.all]) {
    if (type === 'shot') T.shots++;
    else if (type === 'hit') { T.hits++; T.dmg += d.dmg || 0; }
    else if (type === 'kill') { T.kills++; if (d.head) T.heads++; T.by[d.w] = (T.by[d.w] || 0) + 1; }
    else if (type === 'death') T.deaths++;
    else if (type === 'taken') T.taken += d.dmg || 0;
    else if (type === 'round') { T.rounds++; if (d.win) T.wins++; T.bestRound = Math.max(T.bestRound, d.kills || 0); }
    else if (type === 'tick') T.secs += d.dt;
  }
  if (type === 'kill') { streak++; for (const T of train ? [S.all, S.train] : [S.all]) T.best = Math.max(T.best, streak); }
  if (type === 'death') streak = 0;
  dirty = true; if (type === 'tick') { if ((saveT -= d.dt) <= 0) { saveT = 10; save(); } } else if (type === 'round' || type === 'death') save();
}
const pct = (a, b) => (b ? Math.round(100 * a / b) + ' %' : '—');
const dur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' ч ' + m + ' мин' : m ? m + ' мин ' + (s % 60) + ' с' : s + ' с'; };
function rows(T) {
  const fav = Object.entries(T.by).sort((a, b) => b[1] - a[1])[0];
  return [['Убийств', T.kills], ['Смертей', T.deaths], ['Убийств на смерть', T.deaths ? (T.kills / T.deaths).toFixed(2) : T.kills ? '∞' : '—'], ['Точность стрельбы', pct(T.hits, T.shots)], ['Выстрелов', T.shots],
    ['Попаданий в голову (от убийств)', pct(T.heads, T.kills)], ['Урона нанесено', Math.round(T.dmg)], ['Урона получено', Math.round(T.taken)], ['Лучшая серия без смерти', T.best],
    ['Раундов', T.rounds], ['Побед', T.wins + (T.rounds ? ' (' + pct(T.wins, T.rounds) + ')' : '')], ['Лучший раунд, убийств', T.bestRound], ['Любимое оружие', fav ? (WEAPON_NAMES[fav[0]] || '?') + ' · ' + fav[1] : '—'], ['Время в игре', dur(T.secs)]];
}
function render() {
  const body = $('mpStatsBody'); body.textContent = '';
  const head = document.createElement('div'); head.className = 'st-row head'; for (const t of ['', 'Всего', 'Тренировка']) { const s = document.createElement('span'); s.textContent = t; head.append(s); } body.append(head);
  const a = rows(S.all), b = rows(S.train);
  a.forEach(([k, v], i) => { const r = document.createElement('div'); r.className = 'st-row'; for (const t of [k, v, b[i][1]]) { const s = document.createElement('span'); s.textContent = t; r.append(s); } body.append(r); });
  const w = document.createElement('div'); w.className = 'st-weapons'; const max = Math.max(1, ...Object.values(S.all.by));
  for (const [id, name] of Object.entries(WEAPON_NAMES)) { const n = S.all.by[id] || 0, r = document.createElement('div'); r.className = 'st-w'; const l = document.createElement('span'), bar = document.createElement('i'), c = document.createElement('b'); l.textContent = name; bar.style.width = Math.round(100 * n / max) + '%'; c.textContent = n; r.append(l, bar, c); w.append(r); }
  const h2 = document.createElement('h3'); h2.textContent = 'Убийства по оружию'; body.append(h2, w);
  const since = document.createElement('div'); since.className = 'st-since'; since.textContent = 'Считается с ' + new Date(S.since).toLocaleDateString('ru') + ' на этом устройстве.'; body.append(since);
}
let armed = false;
function openStats() { if (document.pointerLockElement) document.exitPointerLock(); save(); armed = false; $('mpStatsReset').textContent = 'Сбросить статистику'; render(); $('mpStats').hidden = false; }
function closeStats() { $('mpStats').hidden = true; }
$('mpStatsClose').onclick = closeStats; $('mpStats').addEventListener('click', e => { if (e.target === $('mpStats')) closeStats(); });
$('mpStatsReset').onclick = () => { if (!armed) { armed = true; $('mpStatsReset').textContent = 'Нажмите ещё раз: всё будет стёрто'; return; } S = { all: zero(), train: zero(), since: Date.now() }; streak = 0; dirty = true; save(); armed = false; $('mpStatsReset').textContent = 'Сбросить статистику'; render(); };
$('bStats').onclick = openStats; $('bStatsStart').onclick = openStats;
window.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('mpStats').hidden) { closeStats(); e.stopImmediatePropagation(); } }, true);
const statsOf = () => S;
export { closeStats, openStats, statEvent, statsOf };
