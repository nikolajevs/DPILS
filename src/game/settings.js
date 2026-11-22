import { $ } from '../core/env.js';

/* ---------- player settings ----------
   Mouse sensitivity, field of view, the volume of the sounds and of the voices, inverted look, and the keys of the
   game. Kept in localStorage (the page works without it). The panel opens with the "Настройки" button or O.
   The panel is split into tabs: Игра, Графика, Звук, Прицел, Клавиши. The active tab is remembered between visits
   (dpils.setTab); the arrows move between tabs when one is focused. Other modules fill their tab through onBuild:
   the hook receives the map of tab panes (the graphics quality fills 'video', see game/input.js) and hears the
   reset through onReset. */
const ACTIONS = [
  ['forward', 'Вперёд', 'KeyW'], ['back', 'Назад', 'KeyS'], ['left', 'Влево', 'KeyA'], ['right', 'Вправо', 'KeyD'], ['run', 'Бег', 'ShiftLeft'],
  ['jump', 'Прыжок', 'Space'], ['crouch', 'Присесть', 'KeyC'], ['reload', 'Перезарядка', 'KeyR'], ['grenade', 'Граната', 'KeyG'],
  ['smoke', 'Дымовая граната', 'KeyB'], ['napalm', 'Напалм (зажигательная)', 'KeyN'],
  ['w1', 'Автомат', 'Digit1'], ['w2', 'Дробовик', 'Digit2'], ['w3', 'Снайперская', 'Digit3'], ['w4', 'Пистолет', 'Digit4'], ['w5', 'Пулемёт', 'Digit5'],
  ['inv', 'Инвентарь', 'KeyI'], ['med', 'Аптечка (использовать)', 'KeyH'],
  ['voice', 'Рация (удерживать)', 'KeyV'], ['chat', 'Чат всем', 'KeyY'], ['teamChat', 'Чат команде', 'KeyU'], ['board', 'Таблица очков', 'Tab'],
];
const DEFAULTS = { sens: 1, fov: 66, vol: 0.8, voiceVol: 1, ambVol: 0.6, invertY: false, crossCol: '#ffffff', crossDot: true, crossDyn: true, perfHud: true };
const CROSS_COLS = ['#ffffff', '#8dff7a', '#5ad7ff', '#ffd75a', '#ff6a5a', '#ff7ad9'];
const SET = { ...DEFAULTS, v: 3, keys: Object.fromEntries(ACTIONS.map(a => [a[0], a[2]])) };
const listeners = [], buildHooks = [], resetHooks = [];
const onBuild = f => { buildHooks.push(f); };
const onReset = f => { resetHooks.push(f); };
try {
  const s = JSON.parse(localStorage.getItem('dpils.settings') || '{}'), num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  SET.sens = num(s.sens, 0.2, 3, 1); SET.fov = num(s.fov, 60, 100, 66); SET.vol = num(s.vol, 0, 1, 0.8); SET.voiceVol = num(s.voiceVol, 0, 1, 1); SET.ambVol = num(s.ambVol, 0, 1, 0.6); SET.invertY = s.invertY === true;
  SET.crossCol = CROSS_COLS.includes(s.crossCol) ? s.crossCol : '#ffffff'; SET.crossDot = s.crossDot !== false; SET.crossDyn = s.crossDyn !== false;
  SET.perfHud = s.perfHud !== false;   // the performance line of the walk status (draw calls, CPU/GPU frame time); F3 toggles it
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
function hint(text) { const p = document.createElement('p'); p.className = 'set-hint'; p.textContent = text; return p; }
function head(text) { const h = document.createElement('h3'); h.textContent = text; return h; }
function group(...rows) { const g = document.createElement('div'); g.className = 'set-group'; g.append(...rows); return g; }

/* the tabs: id, the label, a small stroke icon; the active tab carries the brick underline */
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const TABS = [
  ['game', 'Игра', ICON + '<path d="M7.5 7.5h9a4.5 4.5 0 0 1 4.4 5.4l-.5 2.6a2.7 2.7 0 0 1-4.6 1.3L14 15h-4l-1.8 1.8a2.7 2.7 0 0 1-4.6-1.3l-.5-2.6a4.5 4.5 0 0 1 4.4-5.4z"/><path d="M8.2 10.2v3M6.7 11.7h3M15.4 10.4h.01M17.4 12.4h.01"/></svg>'],
  ['video', 'Графика', ICON + '<rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M9 21h6M12 17v4"/></svg>'],
  ['sound', 'Звук', ICON + '<path d="M4 9.5v5h3.5l5 4v-13l-5 4H4z"/><path d="M16 9a4.5 4.5 0 0 1 0 6M18.6 6.5a8 8 0 0 1 0 11"/></svg>'],
  ['cross', 'Прицел', ICON + '<circle cx="12" cy="12" r="6"/><path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M12 12h.01"/></svg>'],
  ['keys', 'Клавиши', ICON + '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9.5 14h5"/></svg>'],
];
const KEY_GROUPS = [
  ['Движение', ['forward', 'back', 'left', 'right', 'run', 'jump', 'crouch']],
  ['Бой', ['reload', 'grenade', 'w1', 'w2', 'w3', 'w4', 'w5', 'inv', 'med']],
  ['Общение', ['voice', 'chat', 'teamChat', 'board']],
];
const LABELS = Object.fromEntries(ACTIONS.map(a => [a[0], a[1]]));
const tabEls = {}, paneEls = {};
let active = 'game';
try { const t = localStorage.getItem('dpils.setTab'); if (TABS.some(x => x[0] === t)) active = t; } catch (e) {}
function selectTab(id) {
  active = id;
  for (const [t] of TABS) {
    const b = tabEls[t]; if (!b) continue;
    const on = t === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    if (paneEls[t]) paneEls[t].hidden = !on;
  }
  try { localStorage.setItem('dpils.setTab', id); } catch (e) {}
}
const tabsBar = $('mpSetTabs');
for (const [id, label, icon] of TABS) {
  const b = document.createElement('button'); b.className = 'set-tab'; b.type = 'button'; b.id = 'setTab-' + id;
  b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'setPane-' + id); b.innerHTML = icon + '<span>' + label + '</span>';
  b.onclick = () => selectTab(id);
  tabsBar.append(b); tabEls[id] = b;
}
selectTab(active);

function build() {
  body.textContent = '';
  for (const [id] of TABS) {
    const p = document.createElement('div'); p.className = 'set-pane'; p.id = 'setPane-' + id;
    p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', 'setTab-' + id);
    paneEls[id] = p; body.append(p);
  }
  paneEls.game.append(group(
    slider('Чувствительность мыши', 'sens', 0.2, 3, 0.05, v => '×' + v.toFixed(2)),
    slider('Поле зрения', 'fov', 60, 100, 1, v => Math.round(v) + '°'),
    check('Инвертировать вертикаль мыши', 'invertY')));
  paneEls.sound.append(group(
    slider('Громкость звуков', 'vol', 0, 1, 0.05, v => Math.round(v * 100) + ' %'),
    slider('Громкость голосов', 'voiceVol', 0, 1, 0.05, v => Math.round(v * 100) + ' %'),
    slider('Громкость окружения', 'ambVol', 0, 1, 0.05, v => Math.round(v * 100) + ' %')),
    hint('Звуки — выстрелы, шаги и действия. Голоса — рация и голосовой чат в сетевой игре. Окружение — шум города и природа.'));
  const gc = document.createElement('div'); gc.className = 'set-group';
  const cr = document.createElement('div'); cr.className = 'set-row swatches'; const ct = document.createElement('span'); ct.textContent = 'Цвет прицела'; const sw = document.createElement('div'); sw.className = 'sw-row';
  for (const c of CROSS_COLS) { const b = document.createElement('button'); b.className = 'sw'; b.type = 'button'; b.style.background = c; b.title = c; b.setAttribute('aria-pressed', String(SET.crossCol === c)); b.onclick = () => { SET.crossCol = c; save(); for (const x of sw.children) x.setAttribute('aria-pressed', String(x === b)); }; sw.append(b); }
  cr.append(ct, sw); gc.append(cr, check('Точка в центре', 'crossDot'), check('Показывать разброс (динамический прицел)', 'crossDyn'));
  paneEls.cross.append(gc);
  paneEls.keys.append(hint('Щёлкните кнопку и нажмите новую клавишу. Esc — отмена. Если клавиша уже занята, она меняется местами с прежним владельцем.'));
  for (const [title, acts] of KEY_GROUPS) {
    const keys = document.createElement('div'); keys.className = 'set-keys';
    for (const a of acts) {
      const row = document.createElement('div'), n = document.createElement('span'), b = document.createElement('button'); row.className = 'set-key'; n.textContent = LABELS[a]; b.className = 'btn'; b.type = 'button'; b.textContent = keyName(SET.keys[a]); b.dataset.action = a;
      b.onclick = () => { if (waiting) { waiting.b.textContent = keyName(SET.keys[waiting.a]); waiting.b.classList.remove('waiting'); } waiting = { a, b }; b.textContent = 'нажмите клавишу…'; b.classList.add('waiting'); };
      row.append(n, b); keys.append(row);
    }
    paneEls.keys.append(head(title), keys);
  }
  for (const f of buildHooks) f(paneEls);   // other modules fill their pane (graphics quality → 'video')
  selectTab(active);
}
function refreshKeys() { for (const b of body.querySelectorAll('.set-key .btn')) { b.textContent = keyName(SET.keys[b.dataset.action]); b.classList.remove('waiting'); } }
// the next key goes to the key being set: this listener sees it before the game does
window.addEventListener('keydown', e => {
  if (box.hidden) return;
  if (e.code === 'Escape' && !waiting) { closeSettings(); e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (!waiting && e.target instanceof HTMLElement && e.target.classList.contains('set-tab')) {   // arrows walk the tabs
    const ids = TABS.map(t => t[0]); let i = ids.indexOf(active);
    if (e.code === 'ArrowRight') i = (i + 1) % ids.length; else if (e.code === 'ArrowLeft') i = (i + ids.length - 1) % ids.length; else if (e.code === 'Home') i = 0; else if (e.code === 'End') i = ids.length - 1; else i = -1;
    if (i >= 0) { selectTab(ids[i]); tabEls[ids[i]].focus(); e.preventDefault(); e.stopImmediatePropagation(); return; }
  }
  e.stopImmediatePropagation(); if (!waiting) return; e.preventDefault();
  const { a, b } = waiting; waiting = null;
  if (e.code === 'Escape' || /^(Control|Alt|Meta)/.test(e.code) || e.code === 'KeyO') { b.textContent = keyName(SET.keys[a]); b.classList.remove('waiting'); return; }   // Ctrl, Alt and Meta keep their browser meaning
  const other = Object.keys(SET.keys).find(k => k !== a && SET.keys[k] === e.code); if (other) SET.keys[other] = SET.keys[a];   // a key in use swaps places
  SET.keys[a] = e.code; save(); refreshKeys();
}, true);
function openSettings() { if (document.pointerLockElement) document.exitPointerLock(); build(); box.hidden = false; tabEls[active].focus({ preventScroll: true }); }
function closeSettings() { box.hidden = true; waiting = null; }
$('mpSetClose').onclick = closeSettings;
$('mpSetReset').onclick = () => { waiting = null; Object.assign(SET, DEFAULTS); SET.keys = Object.fromEntries(ACTIONS.map(a => [a[0], a[2]])); save(); for (const f of resetHooks) f(); build(); };
$('bSet').onclick = openSettings; $('bSetStart').onclick = openSettings;
window.addEventListener('keydown', e => { if (e.code === 'KeyO' && box.hidden && !(e.target instanceof HTMLInputElement) && !e.ctrlKey && !e.metaKey && !e.altKey && document.body.classList.contains('mp')) { e.preventDefault(); openSettings(); } });
box.addEventListener('click', e => { if (e.target === box) closeSettings(); });

export { ACTIONS, SET, check, closeSettings, keyName, onBuild, onChange, onReset, openSettings, save };