import { STATE } from '../core/state.js';
import { prepareUi } from '../game/mp.js';
import { setTimePref, timePref } from '../render/lighting.js';
import { $ } from '../core/env.js';
import { openLobby, closeLobby } from './lobby.js';

/* ---------- the start card, in steps ----------
   First a choice: a training against bots or a game on a server (the city walk was removed — the city is the arena of
   the fight). Only then the settings of
   that choice, with a way back; and within them, a setting shows only when it means something: the team not in a
   training where everyone is for himself, the place to appear only in the open city (in an arena you appear on your
   base). There is one server — the page's own address (src/game/server.js) — so there is nothing to choose.
   The keys are folded under «Управление». The time of day is a setting of the training (авто, день, вечер, ночь),
   kept in localStorage; online the server's day runs (server/daycycle.mjs) and there is nothing to choose. */
const card = $('startCard'), home = $('stepHome'), form = $('play');
const STEPS = {
  train: { title: 'Тренировка с ботами', hint: 'Бой против ботов прямо в браузере, по правилам сервера. Выберите карту, режим и соперников.' },
  online: { title: 'Играть онлайн', hint: 'Командный бой или каждый сам за себя — режим выбирает сервер.' }
};
let came = null;   // the choice the card came back from, to put the focus on it again
function showStep(step) {
  card.dataset.step = step;
  home.hidden = step !== 'home'; form.hidden = step === 'home';
  for (const el of form.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(step);
  $('mpMsg').textContent = '';
  if (step === 'home') { closeLobby(); if (came) came.focus(); return; }
  prepareUi(); came = step === 'train' ? $('chTrain') : $('chOnline');
  $('stepTitle').textContent = STEPS[step].title; $('stepHint').textContent = STEPS[step].hint;
  follow();
  openLobby(step);
  $('stepTitle').focus({ preventScroll: true }); $('start').scrollTop = 0;
}
// the settings that depend on others
function follow() {
  const train = card.dataset.step === 'train';
  $('mpTeamRow').hidden = train && $('trMode').value === 'ffa';
  $('mpSpawnRow').hidden = train && $('trArena').value !== '';
}
$('trMode').addEventListener('change', follow); $('trArena').addEventListener('change', follow);
$('chTrain').onclick = () => showStep('train'); $('chOnline').onclick = () => showStep('online'); $('stepBack').onclick = () => showStep('home');
// the time of day of the training: remembered for the next visit and shown at once on the city behind the card
const timeSel = $('trTime');
timeSel.value = timePref();
timeSel.onchange = () => setTimePref(timeSel.value);
$('chTrain').disabled = $('chOnline').disabled = false;   // the code is here: the settings can be chosen while the city is still being built
/* The browser hint: Firefox's WebGL draws the city markedly slower than Chromium's on the same GPU (measured 20–28
   vs 60–80 fps on an RTX 3050), and auto quality already starts Firefox lower (src/render/lighting.js). Tell the
   visitor once, on the start card; the cross hides it for good (dpils-browser-hint). */
if (/firefox/i.test(navigator.userAgent)) {
  let dismissed = false; try { dismissed = localStorage.getItem('dpils-browser-hint') === 'off'; } catch (e) {}
  if (!dismissed) $('browserHint').hidden = false;
  $('browserHintX').onclick = () => { $('browserHint').hidden = true; try { localStorage.setItem('dpils-browser-hint', 'off'); } catch (e) {} };
}
window.addEventListener('keydown', e => { if (e.code === 'Escape' && !$('start').hidden && card.dataset.step !== 'home' && form.contains(document.activeElement)) { e.preventDefault(); showStep('home'); } });
// the "?" button: the card again, on its first step, with the keys unfolded
$('bHelp').onclick = () => {
  if (document.pointerLockElement) document.exitPointerLock();
  $('go').hidden = !STATE.started;   // «Вернуться в игру» — только когда бой уже идёт
  $('chTrain').hidden = $('chOnline').hidden = !!STATE.mp;   // in a game, not another game
  showStep('home'); $('keysBox').open = true; $('start').hidden = false; (STATE.started ? $('go') : $('chTrain')).focus();
};

export { showStep };
