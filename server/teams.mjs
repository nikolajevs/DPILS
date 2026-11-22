/* The teams of the players («команды»): a lasting group of accounts with a name and a short tag, kept in a file
   (server/data/teams.json by default, TEAMS=<file> in the environment, TEAMS=off disables them). A team is made by one
   account, who becomes its leader; any member invites other accounts by their nick, the invited accepts or declines.
   An account is in one team at most: accepting another team's invitation leaves the old one. The leader removes
   members, hands the leadership over and disbands the team; a leader who leaves passes the lead to the next member,
   and the last one to leave closes the team. Invitations wait a week.
   This module is the bookkeeping only: the live side (who is online, the invitations as they come, the team chat)
   is server/social.mjs, and the fight reads the tag and the allies through it (game.mjs: one side in the team
   fight, allies in the free-for-all and in the storm). Members are kept by their nick as the account has it; the
   comparison ignores the case, as the accounts do. */
import fs from 'node:fs';
import path from 'node:path';

export const TEAM = { max: 8, invitesPerTeam: 20, invitesPerUser: 20, inviteMs: 7 * 24 * 3600 * 1000 };
const low = s => String(s || '').toLowerCase();
// the name of a team: letters, digits, space, _ . - ; 3 to 24 characters, at least one letter or digit
export const cleanTeamName = s => String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
// the tag: 2 to 4 letters or digits, upper case — it stands before the nick in the fight: [DVN] Nick
export const cleanTag = s => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().slice(0, 4);

export function createTeams({ file, now = Date.now } = {}) {
  let data = { v: 1, seq: 1, teams: {}, invites: [] }, dirty = false;
  if (file) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.teams && Array.isArray(j.invites)) data = j; } catch (e) { /* no file yet, or a broken one: start empty */ } }
  const touch = () => { dirty = true; };
  const teams = () => Object.values(data.teams);
  const isMember = (t, n) => t.members.some(m => low(m) === low(n));
  function of(name) { const n = low(name); return n ? teams().find(t => t.members.some(m => low(m) === n)) || null : null; }
  function get(id) { return data.teams[id] || null; }
  // the invitations still alive (the old ones go when the list is read)
  function live() {
    const t = now(), before = data.invites.length;
    data.invites = data.invites.filter(i => t - i.at < TEAM.inviteMs && data.teams[i.team]);
    if (data.invites.length !== before) touch();
    return data.invites;
  }
  function view(t) { return t && { id: t.id, name: t.name, tag: t.tag, leader: t.leader, members: t.members.slice(), created: t.created }; }

  function create(by, name, tag) {
    if (of(by)) return { error: 'in-team' };
    name = cleanTeamName(name); tag = cleanTag(tag);
    if (name.length < 3 || !/[\p{L}\p{N}]/u.test(name)) return { error: 'bad-name' };
    if (tag.length < 2) return { error: 'bad-tag' };
    if (teams().some(t => low(t.name) === low(name))) return { error: 'name-taken' };
    if (teams().some(t => t.tag === tag)) return { error: 'tag-taken' };
    const id = 't' + (data.seq++).toString(36);
    data.teams[id] = { id, name, tag, leader: by, members: [by], created: now() };
    data.invites = data.invites.filter(i => low(i.to) !== low(by));   // in a team now: the old invitations are spent
    touch();
    return { team: view(data.teams[id]) };
  }

  // an invitation from a member of a team to an account (exists: the nick as the account has it, or null)
  function invite(by, to) {
    const t = of(by); if (!t) return { error: 'no-team' };
    if (!to) return { error: 'no-user' };
    if (low(to) === low(by)) return { error: 'self' };
    if (isMember(t, to)) return { error: 'already' };
    if (t.members.length >= TEAM.max) return { error: 'full' };
    const list = live(), had = list.find(i => i.team === t.id && low(i.to) === low(to));
    if (had) { had.at = now(); had.from = by; touch(); return { invite: { ...had } }; }   // asked again: the old one is renewed
    if (list.filter(i => i.team === t.id).length >= TEAM.invitesPerTeam) return { error: 'too-many' };
    const mine = list.filter(i => low(i.to) === low(to));
    if (mine.length >= TEAM.invitesPerUser) data.invites.splice(data.invites.indexOf(mine[0]), 1);   // the oldest makes room
    const inv = { team: t.id, to, from: by, at: now() };
    data.invites.push(inv); touch();
    return { invite: { ...inv } };
  }
  function cancel(by, to) {
    const t = of(by); if (!t) return { error: 'no-team' };
    const i = live().findIndex(x => x.team === t.id && low(x.to) === low(to));
    if (i < 0) return { error: 'no-invite' };
    data.invites.splice(i, 1); touch();
    return { ok: true };
  }
  function invitesOf(name) { return live().filter(i => low(i.to) === low(name)).map(i => ({ ...i })); }
  function invitesFrom(id) { return live().filter(i => i.team === id).map(i => ({ ...i })); }

  // out of a team: the lead goes to the next member, the last one out closes the team
  function drop(t, name) {
    t.members = t.members.filter(m => low(m) !== low(name));
    if (!t.members.length) { delete data.teams[t.id]; data.invites = data.invites.filter(i => i.team !== t.id); touch(); return { closed: true }; }
    if (low(t.leader) === low(name)) t.leader = t.members[0];
    touch(); return { closed: false, leader: t.leader };
  }
  function accept(by, id) {
    const t = data.teams[id], inv = live().find(i => i.team === id && low(i.to) === low(by));
    if (!t || !inv) return { error: 'no-invite' };
    if (isMember(t, by)) { data.invites.splice(data.invites.indexOf(inv), 1); touch(); return { error: 'already' }; }
    if (t.members.length >= TEAM.max) return { error: 'full' };
    const old = of(by); let left = null;
    if (old) left = { team: view(old), ...drop(old, by) };
    t.members.push(by);
    data.invites = data.invites.filter(i => low(i.to) !== low(by));   // one team at a time: the other invitations are spent
    touch();
    return { team: view(t), left };
  }
  function decline(by, id) {
    const i = live().findIndex(x => x.team === id && low(x.to) === low(by));
    if (i < 0) return { error: 'no-invite' };
    const inv = data.invites[i]; data.invites.splice(i, 1); touch();
    return { invite: { ...inv } };
  }
  function leave(by) {
    const t = of(by); if (!t) return { error: 'no-team' };
    const was = view(t);
    return { team: was, ...drop(t, by) };
  }
  function kick(by, who) {
    const t = of(by); if (!t) return { error: 'no-team' };
    if (low(t.leader) !== low(by)) return { error: 'not-leader' };
    if (low(who) === low(by)) return { error: 'self' };
    const m = t.members.find(x => low(x) === low(who)); if (!m) return { error: 'not-member' };
    drop(t, m);
    return { team: view(t), kicked: m };
  }
  function promote(by, who) {
    const t = of(by); if (!t) return { error: 'no-team' };
    if (low(t.leader) !== low(by)) return { error: 'not-leader' };
    const m = t.members.find(x => low(x) === low(who)); if (!m) return { error: 'not-member' };
    if (low(m) === low(by)) return { error: 'self' };
    t.leader = m; touch();
    return { team: view(t) };
  }
  function disband(by) {
    const t = of(by); if (!t) return { error: 'no-team' };
    if (low(t.leader) !== low(by)) return { error: 'not-leader' };
    const was = view(t);
    delete data.teams[t.id]; data.invites = data.invites.filter(i => i.team !== t.id); touch();
    return { team: was };
  }

  function save() {
    if (!file || !dirty) return; dirty = false;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); } catch (e) { dirty = true; console.error('teams not saved:', e.message); }
  }
  return { of: n => view(of(n)), get: id => view(get(id)), create, invite, cancel, invitesOf, invitesFrom, accept, decline, leave, kick, promote, disband, save, count: () => teams().length };
}
