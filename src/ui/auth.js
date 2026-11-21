import { $ } from '../core/env.js';
import { account, setAccount, clearAccount } from '../game/identity.js';
import { serverUrl, serverHttp } from '../game/server.js';

/* ---------- the login and registration page ----------
   A full-screen card over the city, in the style of the start card. It opens from the start card («Войти /
   регистрация» in the online section) or straight by the address of the page: #login or #register. The accounts live
   on the game server (server/accounts.mjs): the page asks /auth/login or /auth/register with the nick and the
   password, and the server answers with the secret key of the account — the same key the leaderboard knows the player
   by (identity.js), so the results follow the account to any browser. An account is mandatory: without one the page
   opens this card as a gate — no guest button, no close, no Escape — and every game starts only after a login or a
   registration; the server too refuses a join whose key is not an account key (server/game.mjs). There is one server,
   the page's own address (src/game/server.js): registration and login always go to it, there is no server field. */
const overlay = $('auth'), form = $('authForm'), msg = $('authMsg'), title = $('authTitle'), hint = $('authHint'), goBtn = $('authGo');
const nameIn = $('authName'), passIn = $('authPass'), pass2In = $('authPass2'), pass2Row = $('authPass2Row');
const tabLogin = $('authTabLogin'), tabReg = $('authTabReg');
let mode = 'login', mandatory = false;   // mandatory: the gate over the start card, closed only by a successful auth

const ERRORS = {
  'bad-name': 'Ник: 2–16 символов — буквы, цифры, пробел, _ . -',
  'bad-pass': 'Пароль: от 6 до 128 символов.',
  taken: 'Этот ник уже занят на сервере.',
  'bad-login': 'Неверный ник или пароль.',
  'no-account': 'Аккаунт не найден — войдите заново.',
  rate: 'Слишком много попыток. Подождите несколько минут.',
  off: 'На сервере выключены аккаунты — играть нельзя, пока владелец их не включит.',
  'bad-request': 'Сервер не понял запрос.'
};

function setMode(m) {
  mode = m === 'register' ? 'register' : 'login';
  const reg = mode === 'register';
  tabLogin.classList.toggle('on', !reg); tabReg.classList.toggle('on', reg);
  tabLogin.setAttribute('aria-pressed', String(!reg)); tabReg.setAttribute('aria-pressed', String(reg));
  title.textContent = reg ? 'Регистрация' : 'Вход';
  hint.textContent = (mandatory ? 'Аккаунт обязателен: без него игра не начнётся. ' : '') + (reg
    ? 'Придумайте ник и пароль: ник будет вашим на этом сервере, а результаты боя — в его таблице лидеров.'
    : 'Войдите с любого устройства — результаты боя останутся в таблице лидеров этого сервера.');
  goBtn.textContent = reg ? 'Создать аккаунт' : 'Войти';
  pass2Row.hidden = !reg;
  passIn.autocomplete = reg ? 'new-password' : 'current-password';
  msg.textContent = '';
}
function open(m, force) {
  mandatory = !!force;
  $('authBtns').hidden = mandatory;
  setMode(m);
  const a = account();
  if (!nameIn.value) nameIn.value = (a && a.name) || $('mpName').value || '';
  passIn.value = ''; pass2In.value = '';
  overlay.hidden = false;
  try { history.replaceState(null, '', '#' + mode); } catch (e) {}
  (nameIn.value ? passIn : nameIn).focus();
}
function close() {
  if (mandatory) return;   // the gate has no way out except a successful login or registration
  overlay.hidden = true;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
}

/* the account row of the start card */
function renderAcct() {
  const a = account(), state = $('acctState'), btn = $('bAuth');
  state.textContent = '';
  if (a) {
    const b = document.createElement('b'); b.textContent = a.name;
    state.append('Аккаунт: ', b);
    btn.textContent = 'Выйти';
  } else {
    state.textContent = 'Аккаунт обязателен: создайте его или войдите, чтобы играть.';
    btn.textContent = 'Войти / регистрация';
  }
}

/* is the saved account still valid on the server (only an explicit 401 drops it: an old server without /auth answers 404) */
async function verify() {
  const a = account(); if (!a) return;
  try {
    const r = await fetch(serverHttp() + '/auth/me?key=' + encodeURIComponent(a.key), { cache: 'no-store' });
    if (r.status === 401) { clearAccount(); renderAcct(); open('login', true); return; }
    if (r.ok) { const j = await r.json(); if (j && j.ok && j.name && j.name !== a.name) { setAccount({ ...a, name: j.name }); renderAcct(); } }
  } catch (e) { /* the server is not answering now: keep the account */ }
}

form.onsubmit = async e => {
  e.preventDefault();
  msg.textContent = '';
  const name = nameIn.value.trim(), pass = passIn.value, base = serverHttp();
  if (!name) { msg.textContent = 'Введите ник.'; nameIn.focus(); return; }
  if (mode === 'register') {
    if (pass.length < 6) { msg.textContent = ERRORS['bad-pass']; passIn.focus(); return; }
    if (pass !== pass2In.value) { msg.textContent = 'Пароли не совпадают.'; pass2In.focus(); return; }
  } else if (!pass) { msg.textContent = 'Введите пароль.'; passIn.focus(); return; }
  goBtn.disabled = true; msg.textContent = mode === 'register' ? 'Создаю аккаунт…' : 'Вхожу…';
  try {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 10000);
    let r;
    try { r = await fetch(base + (mode === 'register' ? '/auth/register' : '/auth/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, pass }), signal: c.signal }); }
    finally { clearTimeout(t); }
    if (r.status === 404) { msg.textContent = 'Сервер ещё не поддерживает аккаунты — его нужно обновить.'; return; }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) { msg.textContent = (j && ERRORS[j.error]) || 'Сервер ответил ошибкой (HTTP ' + r.status + ').'; return; }
    setAccount({ url: serverUrl(), name: j.name, key: j.key, at: Date.now() });
    $('mpName').value = j.name;
    renderAcct(); mandatory = false; close();
    $('mpMsg').textContent = 'Вы вошли как ' + j.name + '. Результаты боя будут в таблице лидеров этого сервера.';
  } catch (err) {
    msg.textContent = 'Сервер не отвечает. Попробуйте ещё раз через минуту.';
  } finally { goBtn.disabled = false; }
};

tabLogin.onclick = () => setMode('login');
tabReg.onclick = () => setMode('register');
$('authClose').onclick = close;
$('bAuth').onclick = () => {
  if (account()) { clearAccount(); renderAcct(); $('mpMsg').textContent = 'Вы вышли из аккаунта. Чтобы играть, войдите снова или создайте новый аккаунт.'; open('login', true); }
  else open('login', true);
};
/* the game calls this when the server refused the key (mp.js) */
export function requireAccount() {
  open(account() ? 'login' : 'register', true);
}
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) close(); });

setMode('login'); renderAcct(); verify();
const hash = location.hash.replace('#', '');
if (hash === 'login' || hash === 'register') open(hash, !account());
else if (!account()) open('register', true);   // a new visitor creates an account before any game
// a link to #login / #register on the already open page is a same-document navigation: no module runs again
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#', '');
  if (h === 'login' || h === 'register') open(h, !account());
});