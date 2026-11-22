import { SOC, onSocial, socialSend } from '../game/social.js';
import { account } from '../game/identity.js';
import { SET, keyName, onChange } from '../game/settings.js';
import { keys } from '../game/player.js';
import { addLine } from '../game/chat.js';

/* ---------- the team panel: make a team, invite friends, play together ----------
   The social side of the game over src/game/social.js. The panel opens from the start card (the «Команда» row under
   the account), from the lobby of the online fight and of the storm, and in the fight from the bar or by its key (P).
   Without a team it makes one (a name and a short tag) and lists the invitations to accept or decline; in a team it
   shows the members — online or not, and where: in the lobby, in a fight, in the storm (a teammate who fights can be
   joined: «К нему» opens the same door on the start card) — invites by nick or from the list of players online, keeps
   the invitations sent, the team chat, and the leader's tools (make leader, remove, disband).
   An invitation that arrives anywhere pops up as a card in the corner with Принять / Отклонить; in a fight the mouse is
   the gun's, so the card names the key that opens the panel. The team chat also runs through the fight's chat log.
   What a team does in the fight is the server's (server/game.mjs): one side in the team fight, allies in the
   free-for-all and the storm, the tag before the nick. */
const $ = id => document.getElementById(id);
const panel = $('teamPanel'), body = $('teamBody'), toasts = $('teamToasts');
const WHERE = { lobby: 'в лобби', train: 'на тренировке', game: 'в бою', storm: 'в шторме' };
const inGame = () => document.body.classList.contains('mp');
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return n + ' ' + (a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many); };
// a small builder: h('b', { class: 'x', onclick }, 'text', child…) — the text of the players goes in as text, never as markup
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null && c !== false) e.append(c);
  return e;
}
const tagChip = tag => h('span', { class: 'tm-tag', text: tag });

/* ---------- open / close ---------- */
let onlineTimer = 0, msgTimer = 0;
function openTeam() {
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear();   // the keys held when the panel came up must not keep the player running
  panel.hidden = false; SOC.unread = 0; badges();
  render(true);
  askOnline(); clearInterval(onlineTimer); onlineTimer = setInterval(askOnline, 15000);
}
function closeTeam() { panel.hidden = true; clearInterval(onlineTimer); onlineTimer = 0; }
const toggleTeam = () => (panel.hidden ? openTeam() : closeTeam());
function askOnline() { if (SOC.team && !panel.hidden) socialSend({ t: 'online' }); }
$('teamClose').onclick = closeTeam;
panel.addEventListener('click', e => { if (e.target === panel) closeTeam(); });
panel.addEventListener('keydown', e => { if (e.target instanceof HTMLInputElement) e.stopPropagation(); });   // typing a nick or a line does not walk the player
window.addEventListener('keydown', e => {
  if (!panel.hidden && e.code === 'Escape') { e.preventDefault(); closeTeam(); return; }
  if (e.code !== SET.keys.team || e.repeat || !inGame() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  e.preventDefault(); toggleTeam();
}, true);
for (const id of ['bTeamStart', 'bTeamLobby', 'bTeam']) { $(id).onclick = openTeam; $(id).disabled = false; }   // the code is here: the buttons wake up

/* ---------- the status line of the panel: the last answer of the server ---------- */
function status(text, kind) {
  const s = $('teamMsg'); if (!s) return;
  s.textContent = text; s.dataset.kind = kind || '';
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { if ($('teamMsg')) $('teamMsg').textContent = ''; }, 6000);
}
// a button that asks once more before a step that cannot be undone (remove, leave, disband)
function sure(label, again, act, cls = 'btn') {
  let armed = 0;
  const b = h('button', { class: cls + ' tm-sure', type: 'button', text: label });
  b.onclick = () => {
    if (armed) { clearTimeout(armed); armed = 0; act(); return; }
    b.textContent = again; b.classList.add('armed');
    armed = setTimeout(() => { armed = 0; b.textContent = label; b.classList.remove('armed'); }, 3500);
  };
  return b;
}

/* ---------- the panel's content ----------
   Drawn anew on every change of the state (a teammate came online, an invitation came); what the player was typing
   and where the caret stood are kept across the redraw. */
function render(first) {
  if (panel.hidden) return;
  const keep = {}, act = document.activeElement, focus = act && body.contains(act) && act.id ? { id: act.id, s: act.selectionStart, e: act.selectionEnd } : null;
  for (const i of body.querySelectorAll('input[id]')) keep[i.id] = i.value;
  const msg = $('teamMsg') ? $('teamMsg').textContent : '';
  body.textContent = '';
  $('teamTitle').textContent = SOC.team ? 'Команда' : 'Команды';
  if (!account()) body.append(h('p', { class: 'tm-empty', text: 'Войдите в аккаунт, чтобы создать команду или вступить в неё.' }));
  else if (SOC.off) body.append(h('p', { class: 'tm-empty', text: 'На этом сервере команды выключены.' }));
  else if (!SOC.on) body.append(h('p', { class: 'tm-empty', text: 'Подключаюсь к серверу команд…' }));
  else if (SOC.team) teamView(); else noTeamView();
  body.append(h('div', { class: 'tm-msg', id: 'teamMsg', role: 'status', text: msg }));
  for (const [id, v] of Object.entries(keep)) if ($(id)) $(id).value = v;
  if (focus && $(focus.id)) { const i = $(focus.id); i.focus({ preventScroll: true }); try { i.setSelectionRange(focus.s, focus.e); } catch (e) {} }
  else if (first) { const f = $('tmName') || $('tmInvite'); if (f && !inGame()) f.focus({ preventScroll: true }); }
  const log = $('tmLog'); if (log) log.scrollTop = log.scrollHeight;
}
const RULES = 'Команда играет вместе: в командном бою вы на одной стороне и появляетесь рядом, в «каждый сам за себя» и в «Шторме» вы союзники — свои пули, гранаты и напалм не ранят, чат команды (U) слышат только свои, а «Шторм» выигрывает последняя выжившая команда. Тег команды стоит перед ником.';
function invitesSec(title) {
  if (!SOC.invites.length) return null;
  const list = h('div', { class: 'tm-list' });
  for (const i of SOC.invites) {
    list.append(h('div', { class: 'tm-inv' },
      tagChip(i.tag),
      h('div', { class: 'tm-inv-t' }, h('b', { text: i.name }), h('small', { text: plural(i.size, 'игрок', 'игрока', 'игроков') + ' · приглашает ' + i.from })),
      h('button', { class: 'btn tm-yes', type: 'button', text: 'Принять', onclick: () => socialSend({ t: 'accept', team: i.team }) }),
      h('button', { class: 'btn', type: 'button', text: 'Отклонить', onclick: () => socialSend({ t: 'decline', team: i.team }) })));
  }
  return h('section', { class: 'tm-sec' }, h('h3', { text: title }), list);
}
function noTeamView() {
  const inv = invitesSec('Вас пригласили');
  if (inv) body.append(inv);
  const name = h('input', { id: 'tmName', maxlength: 24, autocomplete: 'off', spellcheck: 'false', placeholder: 'Двинские волки' });
  const tag = h('input', { id: 'tmTag', class: 'tm-tag-in', maxlength: 4, autocomplete: 'off', spellcheck: 'false', placeholder: 'DVN' });
  tag.oninput = () => { const p = tag.selectionStart; tag.value = tag.value.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase(); try { tag.setSelectionRange(p, p); } catch (e) {} };
  const form = h('form', { class: 'tm-create' },
    h('label', { class: 'tm-field' }, 'Название', name),
    h('label', { class: 'tm-field tm-field-tag' }, 'Тег', tag),
    h('button', { class: 'go', type: 'submit', text: 'Создать команду' }));
  form.onsubmit = e => {
    e.preventDefault();
    const n = name.value.trim(), t = tag.value.trim();
    if (n.length < 3) { status('Название: от 3 до 24 символов', 'err'); name.focus(); return; }
    if (t.length < 2) { status('Тег: 2–4 буквы или цифры', 'err'); tag.focus(); return; }
    socialSend({ t: 'create', name: n, tag: t });
  };
  body.append(h('section', { class: 'tm-sec' }, h('h3', { text: 'Создать команду' }), h('p', { class: 'tm-hint', text: RULES }), form,
    h('p', { class: 'tm-hint', text: 'Чтобы вступить в команду друга, попросите его пригласить ваш ник: ' }, h('b', { text: SOC.me }))));
}
function teamView() {
  const t = SOC.team, me = SOC.me.toLowerCase(), lead = t.leader.toLowerCase() === me;
  const on = t.members.filter(m => m.where).length;
  body.append(h('div', { class: 'tm-head' }, h('span', { class: 'tm-tag big', text: t.tag }),
    h('div', {}, h('b', { text: t.name }), h('small', { text: t.members.length + ' из ' + t.max + ' · в сети ' + on + ' · лидер ' + t.leader }))));
  const cols = h('div', { class: 'tm-cols' }), left = h('div', { class: 'tm-col' }), right = h('div', { class: 'tm-col' });
  cols.append(left, right); body.append(cols);
  // the members: online first, the leader on top
  const list = h('div', { class: 'tm-list' });
  const order = [...t.members].sort((a, b) => (b.leader - a.leader) || ((b.where ? 1 : 0) - (a.where ? 1 : 0)) || a.name.localeCompare(b.name, 'ru'));
  for (const m of order) {
    const self = m.name.toLowerCase() === me;
    const row = h('div', { class: 'tm-mem' + (m.where ? ' on' : '') + (self ? ' me' : '') },
      h('i', { class: 'tm-dot', 'data-where': m.where || 'off', title: m.where ? WHERE[m.where] : 'не в сети' }),
      h('div', { class: 'tm-mem-t' }, h('b', { text: m.name }, m.leader ? h('em', { class: 'tm-lead', text: '★ лидер', title: 'Лидер команды' }) : null, self ? h('em', { class: 'tm-you', text: 'вы' }) : null),
        h('small', { text: m.where ? WHERE[m.where] || 'в сети' : 'не в сети' })));
    if (!self && (m.where === 'game' || m.where === 'storm') && !inGame()) row.append(h('button', { class: 'btn tm-yes', type: 'button', text: 'К нему', title: m.where === 'storm' ? 'Открыть вход в «Шторм»' : 'Открыть онлайн-бой', onclick: () => { closeTeam(); window.dispatchEvent(new CustomEvent('dpils-step', { detail: m.where === 'storm' ? 'storm' : 'online' })); } }));
    if (lead && !self) row.append(h('button', { class: 'btn', type: 'button', text: 'Лидером', title: 'Передать лидерство', onclick: () => socialSend({ t: 'promote', name: m.name }) }), sure('Исключить', 'Точно?', () => socialSend({ t: 'kick', name: m.name })));
    list.append(row);
  }
  left.append(h('section', { class: 'tm-sec' }, h('h3', { text: 'Состав' }), list));
  // the invitation: by nick, or a click on a player online
  if (t.members.length < t.max) {
    const nick = h('input', { id: 'tmInvite', maxlength: 16, autocomplete: 'off', spellcheck: 'false', placeholder: 'Ник игрока' });
    const form = h('form', { class: 'tm-inline' }, nick, h('button', { class: 'go', type: 'submit', text: 'Пригласить' }));
    form.onsubmit = e => { e.preventDefault(); const n = nick.value.trim(); if (!n) { nick.focus(); return; } if (socialSend({ t: 'invite', name: n })) nick.value = ''; };
    const sec = h('section', { class: 'tm-sec' }, h('h3', { text: 'Пригласить' }), form);
    const free = SOC.online.filter(p => !t.members.some(m => m.name.toLowerCase() === p.name.toLowerCase()) && !t.sent.some(s => s.name.toLowerCase() === p.name.toLowerCase()));
    if (free.length) {
      const chips = h('div', { class: 'tm-chips' });
      for (const p of free.slice(0, 18)) chips.append(h('button', { class: 'tm-chip', type: 'button', title: 'Пригласить ' + p.name + (p.where ? ' · ' + (WHERE[p.where] || '') : ''), onclick: () => socialSend({ t: 'invite', name: p.name }) },
        p.tag ? h('span', { class: 'tm-tag sm', text: p.tag }) : null, h('span', { text: p.name }), h('i', { text: '+' })));
      sec.append(h('small', { class: 'tm-sub', text: 'Сейчас в сети' }), chips);
    } else sec.append(h('small', { class: 'tm-sub', text: 'Приглашение дойдёт, даже если игрок не в сети: он увидит его при входе.' }));
    left.append(sec);
  } else left.append(h('p', { class: 'tm-hint', text: 'В команде нет мест: максимум ' + t.max + ' игроков.' }));
  if (t.sent.length) {
    const sent = h('div', { class: 'tm-list' });
    for (const s of t.sent) sent.append(h('div', { class: 'tm-sent' }, h('span', { text: s.name }), h('small', { text: 'пригласил ' + s.from }),
      h('button', { class: 'btn', type: 'button', text: 'Отменить', onclick: () => socialSend({ t: 'cancel', name: s.name }) })));
    left.append(h('section', { class: 'tm-sec' }, h('h3', { text: 'Ждут ответа' }), sent));
  }
  const inv = invitesSec('Приглашения в другие команды');
  if (inv) { inv.append(h('p', { class: 'tm-hint', text: 'Приняв приглашение, вы перейдёте в ту команду и покинете [' + t.tag + '].' })); left.append(inv); }
  // the team chat
  const log = h('div', { class: 'tm-log', id: 'tmLog', 'aria-live': 'polite' });
  if (!SOC.log.length) log.append(h('p', { class: 'tm-empty sm', text: 'Пока тихо. Сообщения видят все участники команды — в лобби и в бою.' }));
  for (const l of SOC.log) log.append(chatLine(l));
  const say = h('input', { id: 'tmSay', maxlength: 200, autocomplete: 'off', placeholder: 'Написать команде…' });
  const sform = h('form', { class: 'tm-inline' }, say, h('button', { class: 'btn', type: 'submit', text: 'Отправить' }));
  sform.onsubmit = e => { e.preventDefault(); const v = say.value.trim(); if (v && socialSend({ t: 'say', text: v })) say.value = ''; };
  right.append(h('section', { class: 'tm-sec tm-chat' }, h('h3', { text: 'Чат команды' }), log, sform));
  body.append(h('div', { class: 'tm-foot' },
    h('p', { class: 'tm-hint', text: RULES }),
    h('div', { class: 'tm-foot-btns' },
      sure('Покинуть команду', 'Точно покинуть?', () => socialSend({ t: 'leave' })),
      lead ? sure('Распустить', 'Распустить навсегда?', () => socialSend({ t: 'disband' }), 'btn tm-danger') : null)));
}
function chatLine(l) {
  const mine = l.from.toLowerCase() === SOC.me.toLowerCase(), d = new Date(l.at || Date.now());
  return h('div', { class: 'tm-line' + (mine ? ' me' : '') }, h('time', { text: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }), h('b', { text: l.from }), h('span', { text: l.text }));
}

/* ---------- the cards in the corner: an invitation, a note ---------- */
function toast(kind, parts, buttons = [], ms = 6000) {
  const box = h('div', { class: 'tm-toast ' + kind, role: kind === 'invite' ? 'alertdialog' : 'status' });
  const close = () => { box.classList.add('out'); setTimeout(() => box.remove(), 220); };
  box.append(h('div', { class: 'tm-toast-t' }, ...parts));
  if (buttons.length) {
    const row = h('div', { class: 'tm-toast-b' });
    for (const [label, cls, fn] of buttons) row.append(h('button', { class: cls, type: 'button', text: label, onclick: () => { fn(); close(); } }));
    if (inGame()) row.append(h('small', { text: keyName(SET.keys.team) + ' — панель команды' }));
    box.append(row);
  }
  box.append(h('button', { class: 'tm-toast-x', type: 'button', 'aria-label': 'Закрыть', text: '×', onclick: close }));
  toasts.prepend(box);
  while (toasts.children.length > 4) toasts.lastChild.remove();
  if (ms) setTimeout(close, ms);
}

/* ---------- the badges and the lines outside the panel ---------- */
function badges() {
  const n = SOC.invites.length, dot = !n && SOC.unread > 0;
  for (const id of ['teamBadge', 'teamBadgeHud', 'teamBadgeLobby']) { const b = $(id); if (!b) continue; b.hidden = !n && !dot; b.textContent = n ? String(n) : ''; b.classList.toggle('dot', dot); }
}
function rows() {
  const t = SOC.team, text = $('teamRowText'), lob = $('lobbyTeamText');
  text.textContent = ''; lob.textContent = '';
  if (!account()) { text.textContent = 'Команды: войдите, чтобы играть вместе с друзьями'; lob.textContent = 'Команда: нужен аккаунт'; }
  else if (SOC.off) { text.textContent = 'Команды на этом сервере выключены'; lob.textContent = ''; }
  else if (!SOC.on) { text.textContent = 'Команды: подключаюсь…'; lob.textContent = 'Команда: подключаюсь…'; }
  else if (t) {
    const on = t.members.filter(m => m.where).length;
    text.append(tagChip(t.tag), ' ', h('b', { text: t.name }), ' · в сети ' + on + ' из ' + t.members.length);
    lob.append(tagChip(t.tag), ' ', h('b', { text: t.name }), ' · в сети ' + on + ' из ' + t.members.length + ' — в бою вы на одной стороне, в «Шторме» союзники');
  } else if (SOC.invites.length) {
    const i = SOC.invites[0];
    text.append('Вас пригласили в команду ', tagChip(i.tag), ' ', h('b', { text: i.name }));
    lob.append('Вас пригласили в команду ', tagChip(i.tag), ' ', h('b', { text: i.name }));
  } else { text.textContent = 'Вы не в команде — создайте свою и пригласите друзей'; lob.textContent = 'Без команды: соберите друзей, чтобы играть на одной стороне'; }
  $('bTeamStartL').textContent = SOC.team ? 'Моя команда' : 'Команда';
}
function refresh() { rows(); badges(); render(); }

onSocial((ev, m) => {
  if (ev === 'state') { refresh(); return; }
  if (ev === 'log') { render(); return; }
  if (ev === 'online') { render(); return; }
  if (ev === 'say') {
    const log = $('tmLog');
    if (log && !panel.hidden) { const empty = log.querySelector('.tm-empty'); if (empty) empty.remove(); log.append(chatLine(m)); log.scrollTop = log.scrollHeight; SOC.unread = 0; }
    if (m.from !== SOC.me) {
      if (inGame()) addLine({ name: m.from, tag: m.tag, text: m.text, clanChat: true }, -1);   // the fight's chat log carries the team's lines too
      else if (panel.hidden) toast('say', [tagChip(m.tag), ' ', h('b', { text: m.from + ': ' }), m.text]);
    }
    badges(); return;
  }
  if (ev === 'invited') {
    toast('invite', [h('b', { text: m.from }), ' приглашает вас в команду ', tagChip(m.tag), ' ', h('b', { text: m.name })],
      [['Принять', 'go', () => socialSend({ t: 'accept', team: m.team })], ['Отклонить', 'btn', () => socialSend({ t: 'decline', team: m.team })]], 25000);
    return;
  }
  if (ev === 'note') { status(m.text, 'ok'); if (panel.hidden) toast('note', [m.text]); return; }
  if (ev === 'err') { if (!panel.hidden) status(m.text, 'err'); else toast('note err', [m.text]); }
});
onChange(() => { const k = $('bTeamKey'); if (k) k.textContent = keyName(SET.keys.team); });
$('bTeamKey').textContent = keyName(SET.keys.team);
refresh();

export { openTeam, closeTeam };
