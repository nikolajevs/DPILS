import { ACTIONS, SET, keyName, onChange } from './settings.js';
import { $ } from '../core/env.js';

/* ---------- key hints ----------
   A strip with the main keys at the foot of the screen (for the first 25 seconds of the first two games, then only when
   asked) and the full table on F1 or the "Клавиши" button. Both show the keys as the player has set them. */
const strip = $('mpHints'), box = $('mpHelp'), body = $('mpHelpBody'); let timer = 0;
const k = a => keyName(SET.keys[a]);
function stripText() {
  return [`${k('forward')} ${k('left')} ${k('back')} ${k('right')} — идти`, `${k('run')} — бег`, `${k('jump')} — прыжок`, `${k('crouch')} — присесть`, 'ЛКМ — огонь', 'ПКМ — прицел (оптика / коллиматор)', `${k('reload')} — перезарядка`,
    `${k('grenade')} — граната (зажми ЛКМ — сила)`, `${k('smoke')} — дым`, `${k('napalm')} — напалм`, `${k('inv')} — инвентарь`, `${k('med')} — аптечка`, `${k('w1')} ${k('w2')} ${k('w3')} ${k('w4')} ${k('w5')} — оружие`, `${k('voice')} — рация`, `${k('chat')} ${k('teamChat')} — чат`, `${k('board')} — счёт`, 'O — настройки', 'F1 — все клавиши'];
}
function renderStrip() { strip.textContent = ''; for (const t of stripText()) { const s = document.createElement('span'); s.textContent = t; strip.append(s); } }
function showHints(ms = 25000) { renderStrip(); strip.hidden = false; clearTimeout(timer); timer = setTimeout(() => { strip.hidden = true; }, ms); }
// the first two games show the strip by themselves
function firstGames() {
  let n = 0; try { n = +localStorage.getItem('dpils.hints') || 0; localStorage.setItem('dpils.hints', String(n + 1)); } catch (e) {}
  if (n < 2) showHints();
}
function buildHelp() {
  body.textContent = '';
  const row = (name, key) => { const r = document.createElement('div'), a = document.createElement('span'), b = document.createElement('kbd'); r.className = 'help-row'; a.textContent = name; b.textContent = key; r.append(a, b); body.append(r); };
  for (const [a, label] of ACTIONS) row(label, k(a));
  row('Огонь', 'ЛКМ'); row('Прицел: встроенный / коллиматор / оптика', 'ПКМ'); row('Оптика 8×: кратность 4–8× (в прицеле)', 'колесо'); row('Коллиматор: короткий зум (в прицеле)', 'Shift'); row('Прицелы: хранятся в рюкзаке, ставятся на оружие', k('inv')); row('Граната: прицел мышью, сила броска', k('grenade') + ' → зажать ЛКМ'); row('Граната: бросок / отмена', 'отпустить ЛКМ / ПКМ'); row('Дымовая граната: завеса на 12 с, скрывает от врага', k('smoke') + ' → зажать ЛКМ'); row('Напалм: огонь на 8 с, выжигает всё в радиусе 4 м', k('napalm') + ' → зажать ЛКМ'); row('Аптечки и гранаты: готовы до 3 и до 2 каждого типа, излишки — в рюкзаке', k('inv')); row('Сменить оружие', 'колесо'); row('Чат (Shift — команде)', 'Enter'); row('Настройки', 'O'); row('Карта города', 'M'); row('Эта подсказка', 'F1'); row('Отпустить мышь', 'Esc');
  row('После смерти: другой игрок (виды от первого лица и из-за спины)', '← → · Q E · ЛКМ'); row('После смерти: камера — от первого лица / из-за спины / свободная', 'F');
  row('Свободная камера: лететь и смотреть', 'W A S D · мышь'); row('Свободная камера: выше / ниже / быстрее', 'Пробел или E · Q · Shift'); row('Возродиться', 'Пробел (в свободной камере — Enter)');
}
function toggleHelp(on = box.hidden) { if (on) { if (document.pointerLockElement) document.exitPointerLock(); buildHelp(); } box.hidden = !on; }
onChange(() => { if (!strip.hidden) renderStrip(); if (!box.hidden) buildHelp(); });
window.addEventListener('keydown', e => { if (e.code === 'F1' && document.body.classList.contains('mp')) { e.preventDefault(); toggleHelp(); } else if (e.code === 'Escape' && !box.hidden) toggleHelp(false); }, true);
$('bHint').onclick = () => toggleHelp(); $('mpHelpClose').onclick = () => toggleHelp(false); box.addEventListener('click', e => { if (e.target === box) toggleHelp(false); });

export { firstGames, showHints, toggleHelp };
