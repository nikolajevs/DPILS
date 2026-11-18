import { STATE } from '../core/state.js';
import { bSV, updateHud } from '../ui/hud.js';
import { MAP, big, closeMap, openMap } from '../ui/map.js';
import { QUALITY, qi, qAuto, onQuality, setQualityMode } from '../render/lighting.js';
import { P, freeSpot, keys, setFly, teleport, touch } from './player.js';
import { PERF } from './perf.js';
import { SET, onBuild, onReset } from './settings.js';
import { PLACES } from '../ui/places.js';
import { SPEEDS, TX, rigaNow, setClock, updateClockUI } from '../transit/transit.js';
import { camera, canvas } from '../render/renderer.js';
import { $ } from '../core/env.js';

/* ---------- input ---------- */
function tryLock() { try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
document.addEventListener('pointerlockchange', () => { STATE.locked = document.pointerLockElement === canvas; canvas.classList.toggle('locked', STATE.locked); if (!STATE.mp) $('cross').hidden = !STATE.locked; });   // in the game the crosshair belongs to crossTick: settings and chat release the lock, but the fight goes on
const look = (dx, dy, k) => { P.yaw -= dx * k; P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - dy * k * (SET.invertY ? -1 : 1))); };
let drag = false, joyId = null, lookId = null, jx = 0, jy = 0, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', e => {
  if (!STATE.started) return; canvas.focus();
  if (e.pointerType === 'touch') {
    if (e.clientX < window.innerWidth / 2 && joyId === null) { joyId = e.pointerId; jx = e.clientX; jy = e.clientY; const j = $('joy'); j.style.left = jx + 'px'; j.style.top = jy + 'px'; j.hidden = false; $('joyKnob').style.transform = ''; }
    else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; }
  } else { drag = true; if (!STATE.locked && !STATE.mpDead) tryLock(); }
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') {
    if (e.pointerId === joyId) { let dx = e.clientX - jx, dy = e.clientY - jy; const l = Math.hypot(dx, dy), m = 50; if (l > m) { dx *= m / l; dy *= m / l; } touch.mx = dx / m; touch.mz = -dy / m; $('joyKnob').style.transform = `translate(${dx}px,${dy}px)`; }
    else if (e.pointerId === lookId) { look(e.clientX - lx, e.clientY - ly, 0.005); lx = e.clientX; ly = e.clientY; }
  } else if (STATE.locked || drag) look(e.movementX || 0, e.movementY || 0, 0.0023 * SET.sens * (STATE.mp ? camera.fov / SET.fov : 1));   // zoomed in (the scope) the mouse turns slower
});
const up = e => { if (e.pointerId === joyId) { joyId = null; touch.mx = touch.mz = 0; $('joy').hidden = true; } if (e.pointerId === lookId) lookId = null; if (e.pointerType !== 'touch') drag = false; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;   // typing in a box (the chat) is not a command
  if ((e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) && (e.code === 'Space' || e.code === 'Enter')) return;
  if (!STATE.started) return;
  if (STATE.mp && !$('mpInv').hidden) return;   // the inventory panel is open: the keys go to it, not to the walk
  if (e.code === 'Escape' && !big.hidden) { closeMap(); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (STATE.mp && e.code === SET.keys.voice) return;   // in the game V is push-to-talk, not Street View
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyF') setFly(!P.fly); else if (e.code === 'KeyT') { TX.si = (TX.si + 1) % SPEEDS.length; if (TX.si) TX.live = false; updateClockUI(); } else if (e.code === 'KeyM') { big.hidden ? openMap() : closeMap(); } else if (e.code === 'KeyP') togglePlaces();
  else if (e.code === 'KeyV') { updateHud(); if (document.pointerLockElement) document.exitPointerLock(); keys.clear(); bSV.click(); }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
function togglePlaces() { const el = $('places'); el.hidden = !el.hidden; $('bPlaces').setAttribute('aria-pressed', !el.hidden); }
$('bPlaces').onclick = togglePlaces; $('bMap').onclick = openMap; $('bMapClose').onclick = closeMap; $('mini').onclick = openMap;
$('mini').onkeydown = e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); openMap(); } };
$('bFly').onclick = () => { setFly(!P.fly); canvas.focus(); };
$('clkSpeed').onclick = () => { TX.si = (TX.si + 1) % SPEEDS.length; if (TX.si) TX.live = false; updateClockUI(); canvas.focus(); };
$('clkBack').onclick = () => { setClock(TX.sec - 3600, false); canvas.focus(); };
$('clkFwd').onclick = () => { setClock(TX.sec + 3600, false); canvas.focus(); };
$('clkNow').onclick = () => { const n = rigaNow(); TX.day = n.day; TX.si = 0; setClock(n.sec, true); canvas.focus(); };
$('clkFirst').onclick = e => { const t = +e.currentTarget.dataset.t; if (!isNaN(t)) setClock(t - 120, false); canvas.focus(); };
/* Graphics quality: auto or a fixed level. The button cycles авто → высокая → средняя → низкая → минимум → авто;
   the same choice lives in the settings panel — the group is added here through onBuild. */
$('bQuality').onclick = () => { setQualityMode(qAuto ? 0 : qi + 1 < QUALITY.length ? qi + 1 : 'auto'); canvas.focus(); };
let qSel = null, qCur = null;
const qShow = () => { if (qSel) qSel.value = qAuto ? 'auto' : String(qi); if (qCur) qCur.textContent = 'Сейчас: ' + QUALITY[qi].name + (qAuto ? ' · авто' : ' · фиксированное'); };
onQuality(qShow);
onReset(() => setQualityMode('auto'));
onBuild(body => {
  const h = document.createElement('h3'); h.textContent = 'Графика'; body.append(h);
  const g = document.createElement('div'); g.className = 'set-group';
  const row = document.createElement('label'); row.className = 'set-row sel';
  const t = document.createElement('span'); t.textContent = 'Качество графики';
  const sel = document.createElement('select');
  const oA = document.createElement('option'); oA.value = 'auto'; oA.textContent = 'Авто'; sel.append(oA);
  QUALITY.forEach((q, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = q.name[0].toUpperCase() + q.name.slice(1); sel.append(o); });
  sel.onchange = () => setQualityMode(sel.value === 'auto' ? 'auto' : +sel.value);
  row.append(t, sel); g.append(row);
  const hint = document.createElement('p'); hint.className = 'set-hint';
  hint.textContent = 'Авто: разрешение подстраивается под FPS, в бою уровень графики снижается при нехватке кадров и повышается, когда запас есть. Фиксированное: выбранный уровень и полное разрешение, без автоматических изменений.';
  const cur = document.createElement('p'); cur.className = 'set-hint';
  g.append(hint, cur); body.append(g);
  qSel = sel; qCur = cur; qShow();
});
bSV.addEventListener('pointerdown', updateHud);
big.addEventListener('click', e => { if (e.target === big) closeMap(); });
MAP.pick = (x, z) => { teleport(x, z, null); closeMap(); };
PLACES.forEach(p => { const li = document.createElement('li'), b = document.createElement('button'), s = document.createElement('small'); b.textContent = p[0]; s.textContent = p[1]; b.append(s); b.onclick = () => { teleport(p[2], p[3], p[4]); canvas.focus(); }; li.append(b); $('placeList').append(li); });
$('go').onclick = () => {
  $('start').hidden = true; $('hud').hidden = false;
  if (!STATE.started) { STATE.started = true; P.fly = false; P.y = 1.7; P.pitch = 0; P.yaw = 0.6; [P.x, P.z] = freeSpot(-1487, 1263); STATE.lodTimer = 0; if (window.innerWidth > 900) togglePlaces(); }
  canvas.focus(); if (matchMedia('(pointer: fine)').matches) tryLock();
};
