import { STATE } from '../core/state.js';
import { bSV, updateHud } from '../ui/hud.js';
import { big, bigC, bigPpm, closeMap, openMap } from '../ui/map.js';
import { QUALITY, TIMES, qi, setQuality, setTime, timeI } from '../render/lighting.js';
import { P, freeSpot, keys, setFly, teleport, touch } from './player.js';
import { PERF } from './perf.js';
import { PLACES } from '../ui/places.js';
import { SPEEDS, TX, rigaNow, setClock, updateClockUI } from '../transit/transit.js';
import { camera, canvas } from '../render/renderer.js';
import { $ } from '../core/env.js';

/* ---------- input ---------- */
function tryLock() { try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
document.addEventListener('pointerlockchange', () => { STATE.locked = document.pointerLockElement === canvas; canvas.classList.toggle('locked', STATE.locked); $('cross').hidden = !STATE.locked; });
const look = (dx, dy, k) => { P.yaw -= dx * k; P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - dy * k)); };
let drag = false, joyId = null, lookId = null, jx = 0, jy = 0, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', e => {
  if (!STATE.started) return; canvas.focus();
  if (e.pointerType === 'touch') {
    if (e.clientX < window.innerWidth / 2 && joyId === null) { joyId = e.pointerId; jx = e.clientX; jy = e.clientY; const j = $('joy'); j.style.left = jx + 'px'; j.style.top = jy + 'px'; j.hidden = false; $('joyKnob').style.transform = ''; }
    else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; }
  } else { drag = true; if (!STATE.locked) tryLock(); }
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') {
    if (e.pointerId === joyId) { let dx = e.clientX - jx, dy = e.clientY - jy; const l = Math.hypot(dx, dy), m = 50; if (l > m) { dx *= m / l; dy *= m / l; } touch.mx = dx / m; touch.mz = -dy / m; $('joyKnob').style.transform = `translate(${dx}px,${dy}px)`; }
    else if (e.pointerId === lookId) { look(e.clientX - lx, e.clientY - ly, 0.005); lx = e.clientX; ly = e.clientY; }
  } else if (STATE.locked || drag) look(e.movementX || 0, e.movementY || 0, 0.0023 * (STATE.mp ? camera.fov / 66 : 1));   // zoomed in (the scope) the mouse turns slower
});
const up = e => { if (e.pointerId === joyId) { joyId = null; touch.mx = touch.mz = 0; $('joy').hidden = true; } if (e.pointerId === lookId) lookId = null; if (e.pointerType !== 'touch') drag = false; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;   // typing in a box (the chat) is not a command
  if ((e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) && (e.code === 'Space' || e.code === 'Enter')) return;
  if (!STATE.started) return;
  if (e.code === 'Escape' && !big.hidden) { closeMap(); return; }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (STATE.mp && e.code === 'KeyV') return;   // in the game V is push-to-talk, not Street View
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyF') setFly(!P.fly); else if (e.code === 'KeyN') setTime((timeI + 1) % TIMES.length); else if (e.code === 'KeyT') { TX.si = (TX.si + 1) % SPEEDS.length; if (TX.si) TX.live = false; updateClockUI(); } else if (e.code === 'KeyM') { big.hidden ? openMap() : closeMap(); } else if (e.code === 'KeyP') togglePlaces();
  else if (e.code === 'KeyV') { updateHud(); if (document.pointerLockElement) document.exitPointerLock(); keys.clear(); bSV.click(); }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
function togglePlaces() { const el = $('places'); el.hidden = !el.hidden; $('bPlaces').setAttribute('aria-pressed', !el.hidden); }
$('bPlaces').onclick = togglePlaces; $('bMap').onclick = openMap; $('bMapClose').onclick = closeMap; $('mini').onclick = openMap;
$('mini').onkeydown = e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); openMap(); } };
$('bFly').onclick = () => { setFly(!P.fly); canvas.focus(); }; $('bNight').onclick = () => { setTime((timeI + 1) % TIMES.length); canvas.focus(); };
$('clkSpeed').onclick = () => { TX.si = (TX.si + 1) % SPEEDS.length; if (TX.si) TX.live = false; updateClockUI(); canvas.focus(); };
$('clkBack').onclick = () => { setClock(TX.sec - 3600, false); canvas.focus(); };
$('clkFwd').onclick = () => { setClock(TX.sec + 3600, false); canvas.focus(); };
$('clkNow').onclick = () => { const n = rigaNow(); TX.day = n.day; TX.si = 0; setClock(n.sec, true); canvas.focus(); };
$('clkFirst').onclick = e => { const t = +e.currentTarget.dataset.t; if (!isNaN(t)) setClock(t - 120, false); canvas.focus(); };
$('bQuality').onclick = () => { PERF.auto = false; setQuality((qi + 1) % QUALITY.length); canvas.focus(); };
bSV.addEventListener('pointerdown', updateHud);
$('bHelp').onclick = () => { if (document.pointerLockElement) document.exitPointerLock(); $('start').hidden = false; $('go').textContent = 'Продолжить'; };
big.addEventListener('click', e => { if (e.target === big) closeMap(); });
bigC.addEventListener('click', e => { if (STATE.mp) return; const r = bigC.getBoundingClientRect(); teleport((e.clientX - r.left - r.width / 2) / bigPpm, (e.clientY - r.top - r.height / 2) / bigPpm, null); closeMap(); });
PLACES.forEach(p => { const li = document.createElement('li'), b = document.createElement('button'), s = document.createElement('small'); b.textContent = p[0]; s.textContent = p[1]; b.append(s); b.onclick = () => { teleport(p[2], p[3], p[4]); canvas.focus(); }; li.append(b); $('placeList').append(li); });
$('go').onclick = () => {
  $('start').hidden = true; $('hud').hidden = false;
  if (!STATE.started) { STATE.started = true; P.fly = false; P.y = 1.7; P.pitch = 0; P.yaw = 0.6; [P.x, P.z] = freeSpot(-1487, 1263); STATE.lodTimer = 0; if (window.innerWidth > 900) togglePlaces(); }
  canvas.focus(); if (matchMedia('(pointer: fine)').matches) tryLock();
};
