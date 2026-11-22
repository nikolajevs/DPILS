/* The social side of the server: who of the accounts is online and where, the teams (teams.mjs) as they live —
   the invitations arriving, the members coming and going — and the team chat. The page keeps one WebSocket on the
   path /social open for as long as it is open (src/game/social.js), in the lobby and in the fight alike, so an
   invitation reaches a player wherever he is. The connection proves the account with its key ({t:'auth', key});
   after that the page sends the actions of the team panel (src/ui/team.js) and its whereabouts ({t:'where'}: the
   lobby, the training, the fight, the storm), and the server answers every change with the whole picture of the
   player ({t:'state'}: his team with the members online, the invitations to him, the invitations his team sent)
   plus a short line for the event ({t:'note'}, {t:'invited'}). The team chat keeps its last lines in memory only.
   onTeams is called after every change of a team: the fights (game.mjs) take the new tags and allies from it. */
import { TEAM } from './teams.mjs';

const low = s => String(s || '').toLowerCase();
const WHERE = { lobby: 1, train: 2, game: 3, storm: 4 };   // a player with two tabs is where the busier one is
const ERR = { 'in-team': 'Вы уже в команде — сначала покиньте её', 'bad-name': 'Название: 3–24 символа — буквы, цифры, пробел, _ . -', 'bad-tag': 'Тег: 2–4 буквы или цифры',
  'name-taken': 'Команда с таким названием уже есть', 'tag-taken': 'Такой тег уже занят', 'no-team': 'Вы не в команде', 'no-user': 'Нет игрока с таким ником',
  self: 'Это вы сами', already: 'Игрок уже в команде', full: 'В команде нет мест (максимум ' + TEAM.max + ')', 'too-many': 'Слишком много приглашений ждут ответа',
  'no-invite': 'Приглашение больше не действует', 'not-leader': 'Это может только лидер команды', 'not-member': 'Игрок не в вашей команде', rate: 'Не так быстро', bad: 'Сервер не понял запрос' };

export function createSocial({ accounts, teams, now = Date.now, onTeams = () => {}, maxSessions = 6 }) {
  const users = new Map();   // lower nick → { name, sessions: Set }
  const logs = new Map();    // team id → the last lines of its chat
  const enc = m => JSON.stringify(m);
  const sendTo = (name, m) => { const u = users.get(low(name)); if (!u) return; const s = enc(m); for (const x of u.sessions) x.conn.send(s); };
  const online = name => users.has(low(name));
  function whereOf(name) {
    const u = users.get(low(name)); if (!u) return null;
    let best = 'lobby'; for (const s of u.sessions) if ((WHERE[s.where] || 0) > WHERE[best]) best = s.where;
    return best;
  }
  const tagOf = name => { const t = teams.of(name); return t ? t.tag : ''; };
  function stateOf(name) {
    const t = teams.of(name);
    const team = t && {
      id: t.id, name: t.name, tag: t.tag, leader: t.leader, max: TEAM.max,
      members: t.members.map(m => ({ name: m, leader: low(m) === low(t.leader), where: whereOf(m) })),
      sent: teams.invitesFrom(t.id).map(i => ({ name: i.to, from: i.from, at: i.at })),
    };
    const invites = teams.invitesOf(name).map(i => { const x = teams.get(i.team); return x && { team: x.id, name: x.name, tag: x.tag, size: x.members.length, from: i.from, at: i.at }; }).filter(Boolean);
    return { t: 'state', me: name, max: TEAM.max, team, invites };
  }
  const push = name => { if (online(name)) sendTo(name, stateOf(name)); };
  const pushTeam = t => { if (t) for (const m of t.members) push(m); };
  const noteTeam = (t, text, but) => { if (t) for (const m of t.members) if (low(m) !== low(but)) sendTo(m, { t: 'note', text }); };
  const changed = () => { try { onTeams(); } catch (e) { console.error(e); } };
  const logOf = id => logs.get(id) || [];
  const waiting = name => { const t = teams.of(name); return t ? teams.invitesFrom(t.id).map(i => i.to) : []; };   // who waits on an invitation of name's team
  // a member came online, went away or moved between the lobby and a fight: his team sees it
  function presence(name) { const t = teams.of(name); if (t) for (const m of t.members) if (low(m) !== low(name)) push(m); }

  function act(s, m) {
    const me = s.name, fail = code => s.conn.send(enc({ t: 'err', code, text: ERR[code] || ERR.bad, act: m.t }));
    switch (m.t) {
      case 'create': {
        const r = teams.create(me, m.name, m.tag); if (r.error) return fail(r.error);
        push(me); sendTo(me, { t: 'note', text: 'Команда [' + r.team.tag + '] ' + r.team.name + ' создана. Пригласите друзей по нику.' }); sendTo(me, { t: 'log', lines: [] }); changed(); return;
      }
      case 'invite': {
        const to = accounts.find(m.name), r = teams.invite(me, to); if (r.error) return fail(r.error);
        const t = teams.of(me);
        pushTeam(t); push(to);
        sendTo(to, { t: 'invited', team: t.id, name: t.name, tag: t.tag, from: me });
        noteTeam(t, me + ' пригласил ' + to + ' в команду', '');
        return;
      }
      case 'cancel': { const r = teams.cancel(me, m.name); if (r.error) return fail(r.error); pushTeam(teams.of(me)); const to = accounts.find(m.name); if (to) push(to); return; }
      case 'accept': {
        const r = teams.accept(me, String(m.team || '')); if (r.error) { push(me); return fail(r.error); }
        if (r.left && r.left.closed) logs.delete(r.left.team.id);   // he was the last one of his old team: it is closed
        else if (r.left) { const old = teams.get(r.left.team.id); pushTeam(old); noteTeam(old, me + ' перешёл в команду [' + r.team.tag + ']', me); }
        pushTeam(r.team);
        noteTeam(r.team, me + ' вступил в команду', me);
        sendTo(me, { t: 'note', text: 'Вы в команде [' + r.team.tag + '] ' + r.team.name });
        sendTo(me, { t: 'log', lines: logOf(r.team.id) });
        changed(); return;
      }
      case 'decline': {
        const r = teams.decline(me, String(m.team || '')); if (r.error) { push(me); return fail(r.error); }
        push(me); const t = teams.get(r.invite.team); pushTeam(t);
        if (t) sendTo(r.invite.from, { t: 'note', text: me + ' отклонил приглашение в команду' });
        return;
      }
      case 'leave': {
        const pend = waiting(me), r = teams.leave(me); if (r.error) return fail(r.error);
        push(me); sendTo(me, { t: 'note', text: 'Вы покинули команду [' + r.team.tag + ']' });
        if (!r.closed) { const t = teams.get(r.team.id); pushTeam(t); noteTeam(t, me + ' покинул команду' + (low(r.leader) !== low(r.team.leader) ? ' · лидер теперь ' + r.leader : ''), ''); }
        else { logs.delete(r.team.id); for (const n of pend) push(n); }   // the closed team's invitations are gone
        changed(); return;
      }
      case 'kick': {
        const r = teams.kick(me, m.name); if (r.error) return fail(r.error);
        push(r.kicked); sendTo(r.kicked, { t: 'note', text: 'Вас исключили из команды [' + r.team.tag + ']' });
        pushTeam(teams.get(r.team.id)); noteTeam(r.team, r.kicked + ' исключён из команды', '');
        changed(); return;
      }
      case 'promote': {
        const r = teams.promote(me, m.name); if (r.error) return fail(r.error);
        pushTeam(r.team); noteTeam(r.team, r.team.leader + ' — новый лидер команды', '');
        return;
      }
      case 'disband': {
        const pend = waiting(me), r = teams.disband(me); if (r.error) return fail(r.error);
        for (const n of r.team.members) { push(n); sendTo(n, { t: 'note', text: 'Команда [' + r.team.tag + '] распущена' }); }
        for (const n of pend) push(n);   // its invitations are gone too
        logs.delete(r.team.id);
        changed(); return;
      }
      case 'say': {   // the team chat: the members online hear it, the last lines wait for whoever opens the panel
        const t = teams.of(me); if (!t) return fail('no-team');
        const text = String(m.text || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text) return;
        const at = now(); if (at - s.lastSay < 600) return fail('rate'); s.lastSay = at;
        const line = { from: me, text, at }, log = logOf(t.id); log.push(line); while (log.length > 40) log.shift(); logs.set(t.id, log);
        for (const n of t.members) sendTo(n, { t: 'say', team: t.id, tag: t.tag, ...line });
        return;
      }
      case 'where': {
        const w = WHERE[m.where] ? m.where : 'lobby'; if (w === s.where) return;
        s.where = w; presence(me); return;
      }
      case 'online': {   // who to invite: the accounts online now, with their team and where they are
        const list = [...users.values()].filter(u => low(u.name) !== low(me)).slice(0, 200).map(u => ({ name: u.name, tag: tagOf(u.name), where: whereOf(u.name) }))
          .sort((a, b) => (a.tag ? 1 : 0) - (b.tag ? 1 : 0) || a.name.localeCompare(b.name, 'ru')).slice(0, 40);
        s.conn.send(enc({ t: 'online', list, total: users.size })); return;
      }
      default: return fail('bad');
    }
  }

  function attach(conn) {
    const s = { conn, name: '', where: 'lobby', win: 0, msgs: 0, lastSay: 0, since: now() };
    return {
      get joined() { return !!s.name; },
      get name() { return s.name; },
      message(raw) {
        const t = now(); if (t - s.win > 1000) { s.win = t; s.msgs = 0; }
        if (++s.msgs > 20) return;
        let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
        if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
        if (!s.name) {
          if (m.t !== 'auth') return;
          const who = accounts && accounts.byKey(m.key);
          if (!who) { conn.send(enc({ t: 'auth-required' })); conn.close(); return; }
          s.name = who.name; s.where = WHERE[m.where] ? m.where : 'lobby';
          let u = users.get(low(s.name)); const first = !u;
          if (!u) { u = { name: s.name, sessions: new Set() }; users.set(low(s.name), u); }
          u.sessions.add(s);
          if (u.sessions.size > maxSessions) { const old = u.sessions.values().next().value; u.sessions.delete(old); old.conn.close(); }
          conn.send(enc(stateOf(s.name)));
          const tm = teams.of(s.name); conn.send(enc({ t: 'log', lines: tm ? logOf(tm.id) : [] }));
          if (first || s.where !== 'lobby') presence(s.name);
          return;
        }
        act(s, m);
      },
      close() {
        if (!s.name) return;
        const u = users.get(low(s.name)); if (!u) return;
        u.sessions.delete(s);
        if (!u.sessions.size) users.delete(low(s.name));
        presence(s.name);
      },
    };
  }
  return { attach, online: () => users.size, whereOf };
}
