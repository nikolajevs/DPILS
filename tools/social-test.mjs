/* The tests of the teams of the players, no browser needed: node tools/social-test.mjs (npm test runs it after the
   combat tests).
   1. The bookkeeping (server/teams.mjs): the name and the tag, the invitations (renewed, cancelled, declined, spent by
      an accepted one, expired after a week), the cap of members, leaving (the lead passes on, the last one out closes
      the team), the leader's kick, promotion and disbanding, the file kept and read back.
   2. The live side (server/social.mjs) over fake connections: the key proves the account, the invitation reaches the
      invited at once, the members see each other online and where they are, the team chat, the list of the online,
      the fights are told about every change.
   3. The fight (server/game.mjs with clans): a team joins one side and the bots even the sides out; a member on the
      other side crosses over at the respawn; in the free-for-all the team's bullets, grenades and chat spare each
      other and reach only them; the tag rides the board; the storm is won by the last team standing. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTeams, TEAM } from '../server/teams.mjs';
import { createSocial } from '../server/social.mjs';
import { createGame } from '../server/game.mjs';
import { makePhysics } from '../server/physics.mjs';
import { NADE } from '../server/combat.mjs';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

/* ---------- 1. the bookkeeping ---------- */
console.log('teams (teams.mjs):');
{
  let clock = 1e9;
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dpils-teams-')), 'teams.json');
  const T = createTeams({ file: tmp, now: () => clock });
  ok(T.create('Аня', 'ab', 'DV').error === 'bad-name', 'a name of two letters is refused');
  ok(T.create('Аня', 'Двинск', 'D').error === 'bad-tag', 'a tag of one letter is refused');
  const a = T.create('Аня', '  Двинские   волки ', 'dvn!');
  ok(a.team && a.team.name === 'Двинские волки' && a.team.tag === 'DVN' && a.team.leader === 'Аня', 'the team is made: the name tidied, the tag in capitals, the maker leads', JSON.stringify(a));
  ok(T.create('Аня', 'Другая', 'XX').error === 'in-team', 'one team per account');
  ok(T.create('Боря', 'двинские ВОЛКИ', 'ZZ').error === 'name-taken', 'the name is unique (any case)');
  ok(T.create('Боря', 'Крепость', 'dvn').error === 'tag-taken', 'the tag is unique');
  const id = a.team.id;
  ok(T.invite('Боря', 'Вика').error === 'no-team', 'only a member invites');
  ok(T.invite('Аня', null).error === 'no-user', 'no account — no invitation');
  ok(T.invite('Аня', 'аня').error === 'self', 'not oneself');
  const i1 = T.invite('Аня', 'Боря');
  ok(i1.invite && i1.invite.team === id && T.invitesOf('боря').length === 1, 'the invitation waits for Боря (any case)');
  clock += 1000; T.invite('Аня', 'Боря');
  ok(T.invitesOf('Боря').length === 1 && T.invitesOf('Боря')[0].at === clock, 'asked again: the old invitation is renewed, not doubled');
  ok(T.accept('Вика', id).error === 'no-invite', 'no invitation — no way in');
  const b = T.create('Вика', 'Крепость', 'KR'); T.invite('Вика', 'Боря');
  ok(T.invitesOf('Боря').length === 2, 'two teams invite the same player');
  const acc = T.accept('Боря', id);
  ok(acc.team && acc.team.members.join() === 'Аня,Боря' && T.of('боря').id === id, 'Боря accepts and is in the team');
  ok(T.invitesOf('Боря').length === 0, 'the other invitation is spent by the accepted one');
  ok(T.invite('Аня', 'Боря').error === 'already', 'a member is not invited again');
  // the cap of members
  for (let k = 0; k < TEAM.max - 2; k++) { T.invite('Аня', 'Игрок' + k); T.accept('Игрок' + k, id); }
  ok(T.of('Аня').members.length === TEAM.max, 'the team is full at ' + TEAM.max);
  ok(T.invite('Боря', 'Гоша').error === 'full', 'a full team invites nobody');
  T.kick('Аня', 'Игрок0');
  ok(T.kick('Боря', 'Игрок1').error === 'not-leader' && T.of('Аня').members.length === TEAM.max - 1, 'only the leader removes, and he did');
  // decline and cancel
  T.invite('Боря', 'Гоша');
  ok(T.invitesFrom(id).length === 1 && T.invitesFrom(id)[0].from === 'Боря', 'any member invites');
  ok(T.decline('Гоша', id).invite && T.invitesOf('Гоша').length === 0, 'the invitation is declined');
  T.invite('Боря', 'Гоша');
  ok(T.cancel('Аня', 'гоша').ok && T.invitesOf('Гоша').length === 0, 'a member cancels the invitation');
  // the week
  T.invite('Аня', 'Гоша'); clock += TEAM.inviteMs + 1;
  ok(T.invitesOf('Гоша').length === 0, 'an invitation dies after a week');
  // promotion and leaving
  ok(T.promote('Аня', 'Боря').team.leader === 'Боря', 'the lead is handed over');
  ok(T.disband('Аня').error === 'not-leader', 'only the leader disbands');
  const lv = T.leave('Боря');
  ok(!lv.closed && T.of('Аня').leader === 'Аня' && !T.of('Боря'), 'the leader left: the lead passes to the next member', JSON.stringify(lv));
  // moving to another team: the last member of his old one closes it
  T.invite('Вика', 'Гоша'); T.accept('Гоша', b.team.id);
  T.invite('Аня', 'Вика'); T.invite('Аня', 'Гоша');
  T.accept('Гоша', id);
  ok(T.of('Вика').members.join() === 'Вика' && T.of('Гоша').id === id, 'accepting leaves the old team');
  const mv = T.accept('Вика', id);
  ok(mv.left && mv.left.closed && !T.get(b.team.id) && T.count() === 1, 'the last one out closes his old team');
  // the file
  T.save();
  const T2 = createTeams({ file: tmp, now: () => clock });
  ok(T2.of('Вика') && T2.of('Вика').tag === 'DVN' && T2.of('Вика').members.length === T.of('Вика').members.length, 'the teams are kept in the file and read back');
  ok(T2.disband('Аня').team && !T2.of('Боря') && !T2.of('Вика') && T2.count() === 0, 'the leader disbands the team');
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
}

/* ---------- 2. the live side ---------- */
console.log('social hub (social.mjs):');
function fakeAccounts(names) {
  const keys = new Map(names.map((n, i) => [('k' + i).padEnd(32, '0'), n]));
  return { keyOf: n => [...keys].find(e => e[1] === n)[0], byKey: k => (keys.has(k) ? { name: keys.get(k) } : null), find: n => names.find(x => x.toLowerCase() === String(n || '').toLowerCase()) || null };
}
function conn() {
  const msgs = []; let closed = false;
  return { msgs, get closed() { return closed; }, send: m => msgs.push(JSON.parse(m)), close() { closed = true; }, last: t => [...msgs].reverse().find(m => m.t === t), all: t => msgs.filter(m => m.t === t) };
}
const say = (c, m) => c.h.message(JSON.stringify(m));
{
  let clock = 1e9, changes = 0;
  const A = fakeAccounts(['Аня', 'Боря', 'Вика']), T = createTeams({ now: () => clock });
  const S = createSocial({ accounts: A, teams: T, now: () => clock, onTeams: () => { changes++; } });
  const open = (name, where) => { const c = conn(); c.h = S.attach(c); say(c, { t: 'auth', key: name ? A.keyOf(name) : 'f'.repeat(32), where }); return c; };
  const bad = open(null);
  ok(bad.last('auth-required') && bad.closed, 'a key of no account is refused');
  const an = open('Аня'), bo = open('Боря');
  ok(an.last('state') && an.last('state').me === 'Аня' && !an.last('state').team, 'the account is known, no team yet');
  say(an, { t: 'create', name: 'Двинские волки', tag: 'DVN' });
  ok(an.last('state').team && an.last('state').team.tag === 'DVN' && changes === 1, 'the team is made and the fights are told');
  say(an, { t: 'create', name: 'Ещё', tag: 'EE' });
  ok(an.last('err') && an.last('err').code === 'in-team', 'an error comes back with its code');
  say(an, { t: 'invite', name: 'нет-такого' });
  ok(an.last('err').code === 'no-user', 'an invitation to no account fails');
  say(an, { t: 'invite', name: 'боря' });
  const inv = bo.last('invited');
  ok(inv && inv.tag === 'DVN' && inv.from === 'Аня', 'the invitation reaches Боря at once');
  ok(bo.last('state').invites.length === 1 && an.last('state').team.sent[0].name === 'Боря', 'his state lists it, the team sees it sent');
  say(bo, { t: 'accept', team: inv.team });
  const st = an.last('state').team;
  ok(st.members.length === 2 && st.members.find(m => m.name === 'Боря').where === 'lobby', 'Аня sees Боря in the team, online in the lobby');
  ok(an.all('note').some(n => n.text.includes('Боря вступил')), 'and a note about it');
  ok(changes === 2, 'the fights are told about the new member');
  say(bo, { t: 'where', where: 'storm' });
  ok(an.last('state').team.members.find(m => m.name === 'Боря').where === 'storm', 'Боря went to the storm: his team sees it');
  ok(bo.last('state').team.members.find(m => m.name === 'Боря').where === 'storm', 'and he sees himself there too');
  const bo2 = open('Боря', 'lobby');
  ok(an.last('state').team.members.find(m => m.name === 'Боря').where === 'storm', 'a second tab in the lobby: the busier one counts');
  bo2.h.close();
  say(an, { t: 'say', text: '  привет,   команда ' });
  ok(bo.last('say') && bo.last('say').text === 'привет, команда' && bo.last('say').from === 'Аня', 'the team chat reaches the members');
  say(an, { t: 'say', text: 'ещё' });
  ok(an.last('err') && an.last('err').code === 'rate', 'the chat has a pace');
  const vi = open('Вика');
  ok(vi.last('log') && vi.last('log').lines.length === 0 && !vi.all('say').length, 'the chat of a team is not heard by others');
  say(an, { t: 'online' });
  const on = an.last('online');
  ok(on && on.list.map(x => x.name).join() === 'Вика,Боря' && on.list[1].tag === 'DVN', 'the online list: the teamless first, the tag shown', JSON.stringify(on));
  say(bo, { t: 'kick', name: 'Аня' });
  ok(bo.last('err').code === 'not-leader', 'a member cannot remove the leader');
  say(an, { t: 'kick', name: 'Боря' });
  ok(!bo.last('state').team && bo.all('note').some(n => n.text.includes('исключили')), 'the leader removes Боря, he is told');
  bo.h.close();
  say(an, { t: 'invite', name: 'Боря' });
  ok(an.last('state').team.sent.length === 1, 'an offline account is invited too: the invitation waits');
  const bo3 = open('Боря');
  ok(bo3.last('state').invites.length === 1, 'and meets him at the next login');
  say(an, { t: 'disband' });
  ok(!an.last('state').team && bo3.last('state').invites.length === 0, 'the disbanded team takes its invitations away');
}

/* ---------- 3. the fight ---------- */
console.log('teams in the fight (game.mjs with clans):');
function flatWorld() {
  const ground = () => 0, buildingAt = () => null;
  return { ...makePhysics(buildingAt, ground), ground, buildingAt, walkable: () => true };
}
const seat = (g, c) => { c.handle = g.attach(c); return c; };
const msg = (c, m) => c.handle.message(JSON.stringify(m));
function setup(mode, extra = {}) {
  let clock = 1e6;
  const names = ['Аня', 'Боря', 'Вика', 'Гоша'], A = fakeAccounts(names), team = new Map([['Аня', 'DVN'], ['Боря', 'DVN']]);
  const clans = n => (team.has(n) ? { id: 't-' + team.get(n), tag: team.get(n), name: 'Команда ' + team.get(n) } : null);
  const g = createGame({ world: flatWorld(), accounts: A, clans, mode, area: { cx: 0, cz: 0, r: 3300 }, now: () => clock, name: 'clans', itemCount: 0, ...extra });
  g.stop();
  const join = (name, m = {}) => { const c = seat(g, conn()); msg(c, { t: 'join', name, key: A.keyOf(name), x: 0, z: 0, yaw: 0, ...m }); return c; };
  return { g, join, team, tick: ms => { clock += ms; }, get clock() { return clock; } };
}
// p shoots q, both standing still 20 m apart: true when q was hurt
function shootAt(T, a, b) {
  const pa = a.handle.player, pb = b.handle.player;
  pa.x = 0; pa.z = 0; pa.y = 1.7; pb.x = 0; pb.z = -20; pb.y = 1.7; pa.hist.length = pb.hist.length = 0;
  const hp = pb.hp, d = [0, (1.1 - 1.7) / 20, -1], l = Math.hypot(...d);
  T.tick(400); msg(a, { t: 'shoot', w: 0, rays: [[d[0] / l, d[1] / l, d[2] / l]] }); T.tick(120); T.g.stepBullets();
  return pb.hp < hp;
}
{
  // the team fight: Аня and Боря are one team; Вика and Гоша have none
  const T = setup('team');
  const an = T.join('Аня', { team: 0 }), vi = T.join('Вика'), go = T.join('Гоша');
  ok(an.handle.player.team === 0 && vi.handle.player.team === 1, 'the sides by the balance');
  const bo = T.join('Боря', { team: 1 });
  ok(bo.handle.player.team === 0, 'Боря joins the side of his team, not the one he asked for');
  ok(bo.last('hello').clan && bo.last('hello').clan.tag === 'DVN', 'hello carries his team');
  const row = bo.last('board').board.find(e => e.name === 'Боря');
  ok(row.tag === 'DVN' && row.clan === 't-DVN' && !bo.last('board').board.find(e => e.name === 'Вика').tag, 'the board carries the tag of the team members only');
  const pa = an.handle.player, pb = bo.handle.player;
  ok(Math.hypot(pa.x - pb.x, pa.z - pb.z) < 12, 'Боря appears next to Аня');
  ok(go.handle.player.team === 0 || go.handle.player.team === 1, 'Гоша has a side');
  // bots even the sides out after a team took one
  const T2 = setup('team');
  T2.g.addBot(); T2.g.addBot();
  const a2 = T2.join('Аня', { team: 0 }), b2 = T2.join('Боря', { team: 1 }), v2 = T2.join('Вика'); void a2; void b2; void v2;
  const side = k => [...T2.g.players.values()].filter(p => p.team === k).length;
  ok(Math.abs(side(0) - side(1)) <= 1, 'the bots cross so the sides differ by one at most', side(0) + ' : ' + side(1));
  // the crossing at the respawn: Вика joins a team on the other side, dies, comes back on her team's side
  T.team.set('Вика', 'DVN'); T.g.refreshClans();
  ok(vi.last('board').board.find(e => e.name === 'Вика').tag === 'DVN', 'refreshClans puts the new tag on the board');
  const pv = vi.handle.player; pv.hp = 1; T.tick(3000);
  msg(go, { t: 'state', x: go.handle.player.x, y: 1.7, z: go.handle.player.z, yaw: 0, pitch: 0 });
  pv.alive = false; pv.diedAt = T.clock; T.tick(5000);
  msg(vi, { t: 'respawn' });
  ok(pv.team === 0 && vi.last('side') && vi.last('side').team === 0 && pv.alive, 'at the respawn she crosses to her team', 'team ' + pv.team);
  // the team chat of the side still reaches the whole side (the team is inside it)
  msg(an, { t: 'chat', text: 'вперёд', team: true });
  ok(bo.last('say') && bo.last('say').tag === 'DVN' && [an, bo, vi, go].every(c => c.all('say').some(s => s.text === 'вперёд') === (c.handle.player.team === 0)), 'the team chat goes to the whole side, the tag with it');
}
{
  // the free-for-all: the team is one, the others are foes
  const T = setup('ffa');
  const an = T.join('Аня'), bo = T.join('Боря'), vi = T.join('Вика');
  T.tick(3000);
  ok(!shootAt(T, an, bo), 'a teammate is not hurt by her bullet');
  ok(shootAt(T, an, vi), 'a foe is');
  // the grenade spares the teammate
  const pa = an.handle.player, pb = bo.handle.player, pv = vi.handle.player;
  pb.hp = pv.hp = 100; pa.x = 0; pa.z = 0; pb.x = 2; pb.z = 0; pv.x = -2; pv.z = 0; pa.lastNade = 0;
  msg(an, { t: 'throw', dx: 0, dy: -1, dz: 0.001, sp: NADE.minSpeed });
  for (let i = 0; i < 120; i++) { T.tick(1000 / 30); T.g.stepNades(); }
  ok(pb.hp === 100 && pv.hp < 100, 'the grenade spares the teammate and hurts the foe', pb.hp + ' / ' + pv.hp);
  msg(an, { t: 'chat', text: 'наши', team: true });
  ok(bo.last('say') && bo.last('say').text === 'наши' && !vi.all('say').some(s => s.text === 'наши'), 'the team chat reaches the team only');
  msg(vi, { t: 'chat', text: 'я одна', team: true });
  ok(an.last('say') && an.last('say').text === 'я одна', 'without a team the team chat goes to everybody');
}
{
  // the storm: the last team standing wins
  const T = setup('storm');
  const an = T.join('Аня'), bo = T.join('Боря');
  T.tick(61000); T.g.stepStorm();
  ok(T.g.storm.phase === 'wait', 'one team alone does not start the storm');
  const vi = T.join('Вика');
  const pa = an.handle.player, pb = bo.handle.player;
  ok(Math.hypot(pa.x - pb.x, pa.z - pb.z) < 12, 'the team gathers in one place');
  T.tick(20000); T.g.stepStorm();
  ok(T.g.storm.phase === 'play', 'with a foe the storm begins');
  T.tick(6000); vi.handle.player.hp = 1;
  const c = T.g.storm.cur; vi.handle.player.x = c.x + c.r + 50; vi.handle.player.z = c.z; pa.x = pb.x = c.x; pa.z = pb.z = c.z;
  T.tick(600); T.g.stepStorm();
  const win = an.last('win');
  ok(T.g.storm.phase === 'end' && win && win.clan === 't-DVN' && win.name.startsWith('[DVN]'), 'the last team standing wins together', JSON.stringify(win && { name: win.name, clan: win.clan }));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall ${pass} tests passed`);
process.exit(fail ? 1 : 0);
