import { $ } from '../core/env.js';
import { account, setAccount, clearAccount } from '../game/identity.js';

/* ---------- the login and registration page ----------
   A full-screen card over the city, in the style of the start card. It opens from the start card («Войти /
   регистрация» in the online section) or straight by the address of the page: #login or #register. The accounts live
   on the game server (server/accounts.mjs): the page asks /auth/login or /auth/register with the nick and the
   password, and the server answers with the secret key of the account — the same key the leaderboard knows the player
   by (identity.js), so the results follow the account to any browser. Without an account everything works as before.
   The server field offers the servers of servers.json and the ones the player joined before; an account belongs to
   the server it was made on. */
const overlay = $('auth'), form = $('authForm'), msg = $('authMsg'), title = $('authTitle'), hint = $('authHint'), goBtn = $('authGo');
const serverIn = $('authServer'), nameIn = $('authName'), passIn = $('authPass'), pass2In = $('authPass2'), pass2Row = $('authPass2Row');
const tabLogin = $('authTabLogin'), tabReg = $('authTabReg');
let mode = 'login';

const wsUrl = u => { u = String(u || '').trim(); if (u && !/^wss?:\/\//.test(u)) u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + u; return u.replace(/\/+$/, ''); };
const httpUrl = u => wsUrl(u).replace(/^ws/, 'http');
const ERRORS = {
  'bad-name': 'Ник: 2–16 символов — буквы, цифры, пробел, _ . -',
  'bad-pass': 'Пароль: от 6 до 128 символов.',
  taken: 'Этот ник уже занят на сервере.',
  'bad-login': 'Неверный ник или пароль.',
  'no-account': 'Аккаунт не найден — войдите заново.',
  rate: 'Слишком много попыток. Подождите несколько минут.',
  off: 'На этом сервере аккаунты выключены.',
  'bad-request': 'Сервер не понял запрос.'
};

function setMode(m) {
  mode = m === 'register' ? 'register' : 'login';
  const reg = mode === 'register';
  tabLogin.classList.toggle('on', !reg); tabReg.classList.toggle('on', reg);
  tabLogin.setAttribute('aria-pressed', String(!reg)); tabReg.setAttribute('aria-pressed', String(reg));
  title.textContent = reg ? 'Регистрация' : 'Вход';
  hint.textContent = reg ? 'Придумайте ник и пароль: ник будет вашим на этом сервере, а результаты боя — в его таблице лидеров.'
    : 'Аккаунт привязывает результаты таблицы лидеров к вам, а не к браузеру: войдите с любого устройства.';
  goBtn.textContent = reg ? 'Создать аккаунт' : 'Войти';
  pass2Row.hidden = !reg;
  passIn.autocomplete = reg ? 'new-password' : 'current-password';
  msg.textContent = '';
}
function open(m) {
  setMode(m);
  const a = account();
  if (!serverIn.value) serverIn.value = (a && a.url) || $('mpServer').value || '';
  if (!nameIn.value) nameIn.value = (a && a.name) || $('mpName').value || '';
  passIn.value = ''; pass2In.value = '';
  overlay.hidden = false;
  try { history.replaceState(null, '', '#' + mode); } catch (e) {}
  (nameIn.value ? passIn : nameIn).focus();
}
function close() {
  overlay.hidden = true;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
}

/* the account row of the start card */
function renderAcct() {
  const a = account(), state = $('acctState'), btn = $('bAuth');
  state.textContent = '';
  if (a) {
    const b = document.createElement('b'); b.textContent = a.name;
    state.append('Аккаунт: ', b, ' · ' + a.url.replace(/^wss?:\/\//, ''));
    btn.textContent = 'Выйти';
  } else {
    state.textContent = 'Без аккаунта: результаты привязаны к этому браузеру.';
    btn.textContent = 'Войти / регистрация';
  }
}

/* the servers to offer in the field: the owner's list and the remembered ones */
async function offerServers() {
  const dl = $('authServers'), seen = new Set();
  const add = u => { u = wsUrl(u); if (!u || seen.has(u)) return; seen.add(u); const o = document.createElement('option'); o.value = u; dl.append(o); };
  try { const r = await fetch('servers.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); for (const s of j.servers || []) add(s.url); } } catch (e) {}
  try { const a = JSON.parse(localStorage.getItem('dpils.servers') || '[]'); if (Array.isArray(a)) for (const s of a) if (s && typeof s.url === 'string') add(s.url); } catch (e) {}
  if (['localhost', '127.0.0.1'].includes(location.hostname)) add('ws://localhost:8787');
  if (!serverIn.value) { const first = dl.querySelector('option'); if (first) serverIn.value = first.value; }
}

/* is the saved account still valid on its server (only an explicit 401 drops it: an old server without /auth answers 404) */
async function verify() {
  const a = account(); if (!a) return;
  try {
    const r = await fetch(httpUrl(a.url) + '/auth/me?key=' + encodeURIComponent(a.key), { cache: 'no-store' });
    if (r.status === 401) { clearAccount(); renderAcct(); return; }
    if (r.ok) { const j = await r.json(); if (j && j.ok && j.name && j.name !== a.name) { setAccount({ ...a, name: j.name }); renderAcct(); } }
  } catch (e) { /* the server is not answering now: keep the account */ }
}

form.onsubmit = async e => {
  e.preventDefault();
  msg.textContent = '';
  const name = nameIn.value.trim(), pass = passIn.value, base = httpUrl(serverIn.value);
  if (!base) { msg.textContent = 'Укажите адрес сервера.'; return; }
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
    if (r.status === 404) { msg.textContent = 'Этот сервер ещё не поддерживает аккаунты — его нужно обновить. Играть можно и без аккаунта.'; return; }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) { msg.textContent = (j && ERRORS[j.error]) || 'Сервер ответил ошибкой (HTTP ' + r.status + ').'; return; }
    setAccount({ url: wsUrl(serverIn.value), name: j.name, key: j.key, at: Date.now() });
    $('mpName').value = j.name;
    renderAcct(); close();
    $('mpMsg').textContent = 'Вы вошли как ' + j.name + '. Результаты боя будут в таблице лидеров этого сервера.';
  } catch (err) {
    msg.textContent = 'Сервер не отвечает. Проверьте адрес: страница на https пускает только wss://.';
  } finally { goBtn.disabled = false; }
};

tabLogin.onclick = () => setMode('login');
tabReg.onclick = () => setMode('register');
$('authGuest').onclick = close;
$('authClose').onclick = close;
$('bAuth').onclick = () => {
  if (account()) { clearAccount(); renderAcct(); $('mpMsg').textContent = 'Вы вышли из аккаунта: результаты снова привязаны к этому браузеру.'; }
  else open('login');
};
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) close(); });

setMode('login'); renderAcct(); offerServers(); verify();
const hash = location.hash.replace('#', '');
if (hash === 'login' || hash === 'register') open(hash);
// a link to #login / #register on the already open page is a same-document navigation: no module runs again
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#', '');
  if (h === 'login' || h === 'register') open(h);
});