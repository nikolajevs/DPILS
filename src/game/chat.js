import { keys } from './player.js';
import { canvas } from '../render/renderer.js';
import { $ } from '../core/env.js';

/* ---------- text chat of the game ----------
   Y (or Enter) writes to everybody, U (or Shift+Enter in the box) to the team only. The messages stay on the screen
   for a few seconds; while the box is open the whole log shows. Everything from the other players goes in as text. */
const CH = { open: false, send: null, team: false };
const box = $('mpChat'), log = $('mpChatLog'), inp = $('mpChatIn');
const SHOW_MS = 9000, KEEP = 40;
function addLine(m, myId) {
  const row = document.createElement('div'); row.className = 'line' + (m.teamOnly ? ' team' : '');
  const name = document.createElement('b'); name.className = m.clanChat || m.teamOnly ? 'clan' : 'tf';   // no sides: the own team's lines in green, the rest in one colour name.textContent = (m.teamOnly ? '[команда] ' : '') + (m.tag ? '[' + m.tag + '] ' : '') + m.name + ': ';   // clanChat: a line of the team panel's chat (src/ui/team.js)
  if (m.clanChat) row.classList.add('clan');
  const text = document.createElement('span'); text.textContent = m.text; if (m.id === myId) row.classList.add('me');
  row.append(name, text); log.append(row); while (log.children.length > KEEP) log.firstChild.remove(); log.scrollTop = log.scrollHeight;
  setTimeout(() => row.classList.add('old'), SHOW_MS);
}
function openChat(team) {
  if (CH.open) return; CH.open = true; CH.team = team; keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();
  box.classList.add('open'); inp.hidden = false; inp.placeholder = team ? 'Только команде…' : 'Всем… (Shift+Enter — только команде)'; inp.value = ''; inp.focus();
}
function closeChat(send) {
  if (!CH.open) return; CH.open = false; box.classList.remove('open'); const text = inp.value.trim(); inp.hidden = true; inp.value = '';
  if (send && text && CH.send) CH.send(text, CH.team);
  canvas.focus(); try { const p = canvas.requestPointerLock && canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
inp.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); if (e.shiftKey) CH.team = true; closeChat(true); }
  else if (e.code === 'Escape') { e.preventDefault(); closeChat(false); }
});
inp.addEventListener('blur', () => { if (CH.open) { CH.open = false; box.classList.remove('open'); inp.hidden = true; inp.value = ''; } });

export { CH, addLine, closeChat, openChat };
