import { ACTIONS, SET, keyName, onChange } from './settings.js';
import { $ } from '../core/env.js';

/* ---------- key hints ----------
   A strip with the main keys at the foot of the screen (for the first 25 seconds of the first two games, then only when
   asked) and the full table on F1 or the "Клавиши" button. Both show the keys as the player has set them. */
const strip = $('mpHints'), box = $('mpHelp'), body = $('mpHelpBody'); let timer = 0;
const k = a => keyName(SET.keys[a]);
function stripText() {
  return [`${k('forward')} ${k('left')} ${k('back')} ${k('right')} — идти`, `${k('run')} — бег`, `${k('jump')} — прыжок`, `${k('crouch')} — присесть`, 'ЛКМ — огонь', 'ПКМ — прицел снайперской', `${k('reload')} — перезарядка`,
    `${k('grenade')} — граната`, `${k('w1')} ${k('w2')} ${k('w3')} ${k('w4')} ${k('w5')} — оружие`, `${k('voice')} — рация`, `${k('chat')} ${k('teamChat')} — чат`, `${k('board')} — счёт`, 'O — настройки', 'F1 — все клавиши'];
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
  row('Огонь', 'ЛКМ'); row('Прицел (снайперская)', 'ПКМ'); row('Сменить оружие', 'колесо'); row('Чат (Shift — команде)', 'Enter'); row('Настройки', 'O'); row('Карта города', 'M'); row('Эта подсказка', 'F1'); row('Отпустить мышь', 'Esc');
  row('После смерти: другой игрок', '← → · Q E · ЛКМ'); row('Возродиться', 'Пробел');
}
function toggleHelp(on = box.hidden) { if (on) { if (document.pointerLockElement) document.exitPointerLock(); buildHelp(); } box.hidden = !on; }
onChange(() => { if (!strip.hidden) renderStrip(); if (!box.hidden) buildHelp(); });
window.addEventListener('keydown', e => { if (e.code === 'F1' && document.body.classList.contains('mp')) { e.preventDefault(); toggleHelp(); } else if (e.code === 'Escape' && !box.hidden) toggleHelp(false); }, true);
$('bHint').onclick = () => toggleHelp(); $('mpHelpClose').onclick = () => toggleHelp(false); box.addEventListener('click', e => { if (e.target === box) toggleHelp(false); });

export { firstGames, showHints, toggleHelp };
