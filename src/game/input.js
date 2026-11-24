import { STATE } from '../core/state.js';
import { big, closeMap, openMap } from '../ui/map.js';
import { QUALITY, qi, qAuto, onQuality, setQualityMode } from '../render/lighting.js';
import { P, keys, touch } from './player.js';
import { SET, check, onBuild, onChange, onReset, save } from './settings.js';
import { camera, canvas } from '../render/renderer.js';
import { $ } from '../core/env.js';

/* ---------- input ---------- */
function tryLock() { try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
document.addEventListener('pointerlockchange', () => { STATE.locked = document.pointerLockElement === canvas; canvas.classList.toggle('locked', STATE.locked); });   // the fight crosshair belongs to crossTick: settings and chat release the lock, but the fight goes on
const look = (dx, dy, k) => { if (STATE.cine) return; P.yaw -= dx * k; P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - dy * k * (SET.invertY ? -1 : 1))); };   // the collapse cinematic owns the lens
let drag = false, joyId = null, lookId = null, jx = 0, jy = 0, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', e => {
  if (!STATE.started) return; canvas.focus();
  if (e.pointerType === 'touch') {
    if (e.clientX < window.innerWidth / 2 && joyId === null) { joyId = e.pointerId; jx = e.clientX; jy = e.clientY; const j = $('joy'); j.style.left = jx + 'px'; j.style.top = jy + 'px'; j.hidden = false; $('joyKnob').style.transform = ''; }
    else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; }
  } else { drag = true; if (!STATE.locked && !STATE.mpDead) tryLock(); }   // the dead man's free camera locks by its own click (mp.js)
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') {
    if (e.pointerId === joyId) { let dx = e.clientX - jx, dy = e.clientY - jy; const l = Math.hypot(dx, dy), m = 50; if (l > m) { dx *= m / l; dy *= m / l; } touch.mx = dx / m; touch.mz = -dy / m; $('joyKnob').style.transform = `translate(${dx}px,${dy}px)`; }
    else if (e.pointerId === lookId) { look(e.clientX - lx, e.clientY - ly, 0.005); lx = e.clientX; ly = e.clientY; }
  } else if (STATE.locked || drag) look(e.movementX || 0, e.movementY || 0, 0.0023 * SET.sens * camera.fov / SET.fov);   // zoomed in (the scope) the mouse turns slower
});
const up = e => { if (e.pointerId === joyId) { joyId = null; touch.mx = touch.mz = 0; $('joy').hidden = true; } if (e.pointerId === lookId) lookId = null; if (e.pointerType !== 'touch') drag = false; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;   // typing in a box (the chat) is not a command
  if ((e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) && (e.code === 'Space' || e.code === 'Enter')) return;
  if (!STATE.started) return;
  if (!$('mpInv').hidden) return;   // the inventory panel is open: the keys go to it, not to the game
  if (e.code === 'Escape' && !big.hidden) { closeMap(); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3'].includes(e.code)) e.preventDefault();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === SET.keys.voice) return;   // V is push-to-talk (mp.js), not a command here
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyM') { big.hidden ? openMap() : closeMap(); }
  else if (e.code === 'F3') { SET.perfHud = !SET.perfHud; save(); }   // the performance line of the status
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
$('bMap').onclick = openMap; $('bMapClose').onclick = closeMap; $('mini').onclick = openMap;
$('mini').onkeydown = e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); openMap(); } };
/* Graphics quality: auto or a fixed level. The button cycles авто → высокая → средняя → низкая → минимум → авто;
   the same choice lives in the settings panel — the group fills the «Графика» tab through onBuild. */
$('bQuality').onclick = () => { setQualityMode(qAuto ? 0 : qi + 1 < QUALITY.length ? qi + 1 : 'auto'); canvas.focus(); };
let qSel = null, qCur = null;
const qShow = () => { if (qSel) qSel.value = qAuto ? 'auto' : String(qi); if (qCur) qCur.textContent = 'Сейчас: ' + QUALITY[qi].name + (qAuto ? ' · авто' : ' · фиксированное'); };
onQuality(qShow);
onReset(() => setQualityMode('auto'));
onBuild(panes => {
  const g = document.createElement('div'); g.className = 'set-group';
  const row = document.createElement('label'); row.className = 'set-row sel';
  const t = document.createElement('span'); t.textContent = 'Качество графики';
  const sel = document.createElement('select');
  const oA = document.createElement('option'); oA.value = 'auto'; oA.textContent = 'Авто'; sel.append(oA);
  QUALITY.forEach((q, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = q.name[0].toUpperCase() + q.name.slice(1); sel.append(o); });
  sel.onchange = () => setQualityMode(sel.value === 'auto' ? 'auto' : +sel.value);
  row.append(t, sel); g.append(row);
  const hint = document.createElement('p'); hint.className = 'set-hint';
  hint.textContent = 'Авто: разрешение подстраивается под FPS, уровень графики снижается при нехватке кадров и повышается, когда запас есть. Фиксированное: выбранный уровень и полное разрешение, без автоматических изменений.';
  const cur = document.createElement('p'); cur.className = 'set-hint';
  g.append(hint, cur); panes.video.append(g);
  const gp = document.createElement('div'); gp.className = 'set-group';
  gp.append(check('Счётчик производительности (F3)', 'perfHud'));
  const ph = document.createElement('p'); ph.className = 'set-hint';
  ph.textContent = 'Строка статуса внизу экрана: кадры/с, draw calls за кадр (сцена, тени, постобработка), среднее время кадра CPU и GPU. GPU замеряется, если браузер поддерживает EXT_disjoint_timer_query_webgl2, иначе «н/д».';
  gp.append(ph); panes.video.append(gp);
  qSel = sel; qCur = cur; qShow();
});
/* the performance line is shown while SET.perfHud is on; the checkbox and F3 both save, so onChange applies it */
const applyPerfHud = () => { $('stPerf').hidden = !SET.perfHud; };
onChange(applyPerfHud); applyPerfHud();
big.addEventListener('click', e => { if (e.target === big) closeMap(); });
/* «Вернуться в игру» on the card the «?» button opens: the fight goes on from the same spot */
$('go').onclick = () => {
  $('start').hidden = true; $('hud').hidden = false;
  canvas.focus(); if (matchMedia('(pointer: fine)').matches) tryLock();
};
