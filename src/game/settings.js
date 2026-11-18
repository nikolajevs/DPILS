import { $ } from '../core/env.js';

/* ---------- player settings ----------
   Mouse sensitivity, field of view, the volume of the sounds and of the voices, inverted look, and the keys of the
   game. Kept in localStorage (the page works without it). The panel opens with the "Настройки" button or O.
   Other modules add their own groups to the panel through onBuild (the graphics quality does, see game/input.js)
   and hear the reset through onReset. */
const ACTIONS = [
  ['forward', 'Вперёд', 'KeyW'], ['back', 'Назад', 'KeyS'], ['left', 'Влево', 'KeyA'], ['right', 'Вправо', 'KeyD'], ['run', 'Бег', 'ShiftLeft'],
  ['jump', 'Прыжок', 'Space'], ['crouch', 'Присесть', 'KeyC'], ['reload', 'Перезарядка', 'KeyR'], ['grenade', 'Граната', 'KeyG'],
  ['w1', 'Автомат', 'Digit1'], ['w2', 'Дробовик', 'Digit2'], ['w3', 'Снайперская', 'Digit3'], ['w4', 'Пистолет', 'Digit4'], ['w5', 'Пулемёт', 'Digit5'],
  ['inv', 'Инвентарь', 'KeyI'], ['med', 'Аптечка (использовать)', 'KeyH'],
  ['voice', 'Рация (удерживать)', 'KeyV'], ['chat', 'Чат всем', 'KeyY'], ['teamChat', 'Чат команде', 'KeyU'], ['board', 'Таблица очков', 'Tab'],
];
const DEFAULTS = { sens: 1, fov: 66, vol: 0.8, voiceVol: 1, ambVol: 0.6, invertY: false, crossCol: '#ffffff', crossDot: true, crossDyn: true };
const CROSS_COLS = ['#ffffff', '#8dff7a', '#5ad7ff', '#ffd75a', '#ff6a5a', '#ff7ad9'];
const SET = { ...DEFAULTS, v: 3, keys: Object.fromEntries(ACTIONS.map(a => [a[0], a[2]])) };
const listeners = [], buildHooks = [], resetHooks = [];
const onBuild = f => { buildHooks.push(f); };
const onReset = f => { resetHooks.push(f); };
try {
  const s = JSON.parse(localStorage.getItem('dpils.settings') || '{}'), num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  SET.sens = num(s.sens, 0.2, 3, 1); SET.fov = num(s.fov, 60, 100, 66); SET.vol = num(s.vol, 0, 1, 0.8); SET.voiceVol = num(s.voiceVol, 0, 1, 1); SET.ambVol = num(s.ambVol, 0, 1, 0.6); SET.invertY = s.invertY === true;
  SET.crossCol = CROSS_COLS.includes(s.crossCol) ? s.crossCol : '#ffffff'; SET.crossDot = s.crossDot !== false; SET.crossDyn = s.crossDyn !== false;
  if (s.keys && typeof s.keys === 'object') for (const [a, , d] of ACTIONS) if (typeof s.keys[a] === 'string' && /^[A-Za-z0-9]{1,16}$/.test(s.keys[a])) SET.keys[a] = s.keys[a];
  if ((s.v || 1) < 3 && /^Control/.test(SET.keys.crouch)) { SET.keys.crouch = 'KeyC'; save(); }   // v3: crouch returns from Ctrl to C — Ctrl combos belong to the browser; a saved Ctrl default follows once
} catch (e) {}
function save() { try { localStorage.setItem('dpils.settings', JSON.stringify(SET)); } catch (e) {} for (const f of listeners) f(); }
const onChange = f => { listeners.push(f); };
const NAMES = { Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: 'Shift (прав.)', ControlLeft: 'Ctrl', ControlRight: 'Ctrl (прав.)', Tab: 'Tab', Enter: 'Enter', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'Caps', Backspace: '⌫' };
const keyName = c => NAMES[c] || c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');

/* ---------- the panel ---------- */
const box = $('mpSet'), body = $('mpSetBody'); let waiting = null;
function slider(label, key, lo, hi, step, show) {
  const row = document.createElement('label'); row.className = 'set-row'; const t = document.createElement('span'), v = document.createElement('b'), i = document.createElement('input');
  t.textContent = label; i.type = 'range'; i.min = lo; i.max = hi; i.step = step; i.value = SET[key]; v.textContent = show(SET[key]);
  i.oninput = () => { SET[key] = +i.value; v.textContent = show(SET[key]); save(); }; row.append(t, i, v); return row;
}
function check(label, key) {
  const row = document.createElement('label'); row.className = 'set-row check'; const c = document.createElement('input'); c.type = 'checkbox'; c.checked = SET[key]; c.onchange = () => { SET[key] = c.checked; save(); };
  const t = document.createElement('span'); t.textContent = label; row.append(c, t); return row;
}
function build() {
  body.textContent = '';
  const g = document.createElement('div'); g.className = 'set-group';
  g.append(slider('Чувствительность мыши', 'sens', 0.2, 3, 0.05, v => '×' + v.toFixed(2)), slider('Поле зрения', 'fov', 60, 100, 1, v => Math.round(v) + '°'), slider('Громкость звуков', 'vol', 0, 1, 0.05, v => Math.round(v * 100) + ' %'), slider('Громкость голосов', 'voiceVol', 0, 1, 0.05, v => Math.round(v * 100) + ' %'), slider('Громкость окружения', 'ambVol', 0, 1, 0.05, v => Math.round(v * 100) + ' %'));
  g.append(check('Инвертировать вертикаль мыши', 'invertY')); body.append(g);
  const hc = document.createElement('h3'); hc.textContent = 'Прицел'; body.append(hc);
  const gc = document.createElement('div'); gc.className = 'set-group';
  const cr = document.createElement('div'); cr.className = 'set-row swatches'; const ct = document.createElement('span'); ct.textContent = 'Цвет прицела'; const sw = document.createElement('div'); sw.className = 'sw-row';
  for (const c of CROSS_COLS) { const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.title = c; b.setAttribute('aria-pressed', String(SET.crossCol === c)); b.onclick = () => { SET.crossCol = c; save(); build(); }; sw.append(b); }
  cr.append(ct, sw); gc.append(cr, check('Точка в центре', 'crossDot'), check('Показывать разброс (динамический прицел)', 'crossDyn')); body.append(gc);
  const h = document.createElement('h3'); h.textContent = 'Клавиши (щёлкните и нажмите новую; Esc — отмена)'; body.append(h);
  const keys = document.createElement('div'); keys.className = 'set-keys';
  for (const [a, label] of ACTIONS) {
    const row = document.createElement('div'), n = document.createElement('span'), b = document.createElement('button'); row.className = 'set-key'; n.textContent = label; b.className = 'btn'; b.textContent = keyName(SET.keys[a]); b.dataset.action = a;
    b.onclick = () => { if (waiting) waiting.b.textContent = keyName(SET.keys[waiting.a]); waiting = { a, b }; b.textContent = 'нажмите клавишу…'; }; row.append(n, b); keys.append(row);
  }
  body.append(keys);
  for (const f of buildHooks) f(body);
}
// the next key goes to the key being set: this listener sees it before the game does
window.addEventListener('keydown', e => {
  if (box.hidden) return;
  if (e.code === 'Escape' && !waiting) { closeSettings(); e.preventDefault(); e.stopImmediatePropagation(); return; }
  e.stopImmediatePropagation(); if (!waiting) return; e.preventDefault();
  const { a, b } = waiting; waiting = null;
  if (e.code === 'Escape' || /^(Control|Alt|Meta)/.test(e.code) || e.code === 'KeyO') { b.textContent = keyName(SET.keys[a]); return; }   // not these: they have their own meaning (Ctrl and Alt belong to the browser)
  const other = Object.keys(SET.keys).find(k => k !== a && SET.keys[k] === e.code); if (other) SET.keys[other] = SET.keys[a];   // a key in use swaps places
  SET.keys[a] = e.code; save(); build();
}, true);
function openSettings() { if (document.pointerLockElement) document.exitPointerLock(); build(); box.hidden = false; }
function closeSettings() { box.hidden = true; waiting = null; }
$('mpSetClose').onclick = closeSettings;
$('mpSetReset').onclick = () => { Object.assign(SET, DEFAULTS); SET.keys = Object.fromEntries(ACTIONS.map(a => [a[0], a[2]])); save(); for (const f of resetHooks) f(); build(); };
$('bSet').onclick = openSettings; $('bSetStart').onclick = openSettings;
window.addEventListener('keydown', e => { if (e.code === 'KeyO' && box.hidden && !(e.target instanceof HTMLInputElement) && !e.ctrlKey && !e.metaKey && !e.altKey && document.body.classList.contains('mp')) { e.preventDefault(); openSettings(); } });
box.addEventListener('click', e => { if (e.target === box) closeSettings(); });

export { ACTIONS, SET, closeSettings, keyName, onBuild, onChange, onReset, openSettings };
