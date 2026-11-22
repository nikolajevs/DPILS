import { account } from './identity.js';
import { serverReady, serverUrl } from './server.js';

/* ---------- the social connection: the teams of the players ----------
   One WebSocket on the server's path /social (server/social.mjs), open for as long as the page is and an account is
   signed in — in the lobby and in the fight alike, so an invitation to a team reaches the player wherever he is.
   It proves the account with its key, tells the server where the player is (the lobby, the training, a fight, the
   storm: his team sees it) and carries the actions of the team panel (src/ui/team.js). The server answers each
   change with the whole picture ('state': the team with its members online, the invitations); short events ('note',
   'invited', 'say', 'err') go to the listeners as they come. A dropped connection comes back by itself, every 2 s
   at first, then less often; a new login or a logout (auth.js fires 'dpils-account') starts it anew.
   The training against bots runs in the page and knows nothing of this: teams are for the server's fights. */
const SOC = { on: false, off: false, me: '', team: null, invites: [], online: [], log: [], max: 8, where: 'lobby', unread: 0 };
const subs = new Set();
let ws = null, wait = 2000, timer = 0;
const emit = (ev, m) => { for (const f of subs) { try { f(ev, m); } catch (e) { console.error(e); } } };
function onSocial(f) { subs.add(f); return () => subs.delete(f); }
function socialSend(m) { if (ws && ws.readyState === 1 && SOC.on) { ws.send(JSON.stringify(m)); return true; } return false; }
function setWhere(w) { if (SOC.where === w) return; SOC.where = w; socialSend({ t: 'where', where: w }); }

function retry() { clearTimeout(timer); timer = setTimeout(connect, wait); wait = Math.min(30000, wait * 2); }
function connect() {
  clearTimeout(timer);
  if (ws) { const old = ws; ws = null; try { old.close(); } catch (e) {} }
  SOC.on = false; SOC.team = null; SOC.invites = []; SOC.log = []; SOC.online = [];
  const a = account();
  if (!a || SOC.off) { emit('state'); return; }
  let s; try { s = new WebSocket(serverUrl() + '/social'); } catch (e) { retry(); return; }
  ws = s;
  s.onopen = () => s.send(JSON.stringify({ t: 'auth', key: a.key, where: SOC.where }));
  s.onmessage = e => { if (ws !== s) return; let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMsg(m); };
  s.onclose = () => { if (ws !== s) return; ws = null; SOC.on = false; emit('state'); if (!SOC.off) retry(); };
  s.onerror = () => {};
}
function onMsg(m) {
  switch (m.t) {
    case 'state': SOC.on = true; wait = 2000; SOC.me = m.me || ''; SOC.team = m.team || null; SOC.invites = m.invites || []; SOC.max = m.max || 8; emit('state', m); break;
    case 'log': SOC.log = Array.isArray(m.lines) ? m.lines.slice(-40) : []; emit('log', m); break;
    case 'say': SOC.log.push(m); if (SOC.log.length > 40) SOC.log.shift(); if (m.from !== SOC.me) SOC.unread++; emit('say', m); break;
    case 'online': SOC.online = Array.isArray(m.list) ? m.list : []; emit('online', m); break;
    case 'invited': case 'note': case 'err': emit(m.t, m); break;
    case 'off': SOC.off = true; emit('state'); break;   // the server keeps no teams: nothing to come back for
    case 'auth-required': SOC.off = true; emit('state'); break;   // the key is not an account here any more (auth.js asks to sign in again)
  }
}
window.addEventListener('dpils-account', () => { SOC.off = false; wait = 2000; connect(); });
serverReady.then(connect);

export { SOC, onSocial, setWhere, socialSend };
