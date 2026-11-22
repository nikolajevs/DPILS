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
   The keys live in the fight («Клавиши», F1), not on the start card; the card's footer link opens the credits
   modal with the data sources and licences. The time of day is a setting of the training (авто, день, вечер, ночь),
   kept in localStorage; online the server's day runs (server/daycycle.mjs) and there is nothing to choose. */
const card = $('startCard'), home = $('stepHome'), form = $('play');
const STEPS = {
  train: { title: 'Тренировка с ботами', hint: 'Бой против ботов прямо в браузере, по правилам сервера. Выберите карту, режим и соперников.' },
  online: { title: 'Играть онлайн', hint: 'Командный бой или каждый сам за себя — режим выбирает сервер.' },
  storm: { title: 'Ивент «Шторм»', hint: 'Battle royale на сервере: безопасный круг сужается 30 минут, одна жизнь, побеждает последний выживший.' }
};
let came = null;   // the choice the card came back from, to put the focus on it again
function showStep(step) {
  card.dataset.step = step;
  home.hidden = step !== 'home'; form.hidden = step === 'home';
  for (const el of form.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(step);
  $('mpMsg').textContent = '';
  if (step === 'home') { closeLobby(); if (came) came.focus(); return; }
  prepareUi(); came = step === 'train' ? $('chTrain') : step === 'storm' ? $('chStorm') : $('chOnline');
  $('stepTitle').textContent = STEPS[step].title; $('stepHint').textContent = STEPS[step].hint;
  follow();
  openLobby(step);
  $('stepTitle').focus({ preventScroll: true }); $('start').scrollTop = 0;
}
// the settings that depend on others
function follow() {
  const step = card.dataset.step, train = step === 'train';
  $('mpTeamRow').hidden = step === 'storm' || (train && $('trMode').value === 'ffa');   // the storm: everybody for himself, the spawn is the circle's own
  $('mpSpawnRow').hidden = step === 'storm' || (train && $('trArena').value !== '');
}
$('trMode').addEventListener('change', follow); $('trArena').addEventListener('change', follow);
$('chTrain').onclick = () => showStep('train'); $('chOnline').onclick = () => showStep('online'); $('chStorm').onclick = () => showStep('storm'); $('stepBack').onclick = () => showStep('home');
// the time of day of the training: remembered for the next visit and shown at once on the city behind the card
const timeSel = $('trTime');
timeSel.value = timePref();
timeSel.onchange = () => setTimePref(timeSel.value);
$('chTrain').disabled = $('chOnline').disabled = $('chStorm').disabled = false;   // the code is here: the settings can be chosen while the city is still being built
// the credits: the quiet link at the bottom of the card opens a modal with the data sources and licences
const credits = $('credits');
const closeCredits = () => { credits.hidden = true; $('bCredits').focus(); };
$('bCredits').onclick = () => { credits.hidden = false; $('creditsClose').focus(); };
$('creditsClose').onclick = closeCredits;
credits.addEventListener('click', e => { if (e.target === credits) closeCredits(); });
window.addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  if (!credits.hidden) { e.preventDefault(); closeCredits(); return; }
  if (!$('start').hidden && card.dataset.step !== 'home' && form.contains(document.activeElement)) { e.preventDefault(); showStep('home'); }
});
// the "?" button: the card again, on its first step
$('bHelp').onclick = () => {
  if (document.pointerLockElement) document.exitPointerLock();
  $('go').hidden = !STATE.started;   // «Вернуться в игру» — только когда бой уже идёт
  $('chTrain').hidden = $('chOnline').hidden = $('chStorm').hidden = !!STATE.mp;   // in a game, not another game
  showStep('home'); $('start').hidden = false; (STATE.started ? $('go') : $('chTrain')).focus();
};

// the dead of the storm wake up in the lobby: mp.js sends them here with the hash #storm (stormGoLobby) — the event
// card opens at once, over the loading city; the hash is spent so a plain refresh lands on the home step again
if (location.hash === '#storm') { showStep('storm'); history.replaceState(null, '', location.pathname + location.search); }

export { showStep };
