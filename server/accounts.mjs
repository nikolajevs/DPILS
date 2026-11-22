/* Accounts of a server: a nick and a password, kept in a file (server/data/accounts.json by default, ACCOUNTS=<file>
   in the environment, ACCOUNTS=off disables them). The password is stored only as a scrypt hash with a random salt.
   On registration the server makes a secret key for the account — the same key the leaderboard knows a player by
   (leaderboard.mjs, src/game/identity.js): the page sends it at the join, so the results follow the account to any
   browser, and the nick belongs to the account. An account is mandatory: with accounts on, the game refuses a join
   whose key is not an account key (game.mjs). The HTTP routes (/auth/register, /auth/login, /auth/me) are in index.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { idOf } from './leaderboard.mjs';

export const validKey = k => typeof k === 'string' && /^[0-9a-f]{32}$/i.test(k);
// the nick rules of the game (nameBase in game.mjs): letters, digits, space, _ . - ; 2 to 16 characters
export const cleanName = s => String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
const hash = (pass, salt) => crypto.scryptSync(String(pass), salt, 32);

export function createAccounts({ file, now = Date.now } = {}) {
  let data = { v: 1, users: {} }, dirty = false;
  if (file) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.users) data = j; } catch (e) { /* no file yet, or a broken one: start empty */ } }
  const lower = s => s.toLowerCase();

  function register(name, pass) {
    name = cleanName(name);
    if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name)) return { error: 'bad-name' };
    if (typeof pass !== 'string' || pass.length < 6 || pass.length > 128) return { error: 'bad-pass' };
    if (data.users[lower(name)]) return { error: 'taken' };
    const salt = crypto.randomBytes(16), key = crypto.randomBytes(16).toString('hex');
    data.users[lower(name)] = { name, salt: salt.toString('hex'), hash: hash(pass, salt).toString('hex'), key, created: now(), seen: now() };
    dirty = true;
    return { name, key };
  }

  function login(name, pass) {
    const u = data.users[lower(cleanName(name))];
    if (!u || typeof pass !== 'string' || pass.length > 128) return { error: 'bad-login' };
    const got = hash(pass, Buffer.from(u.salt, 'hex')), want = Buffer.from(u.hash, 'hex');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return { error: 'bad-login' };   // one answer for a wrong nick and a wrong password
    u.seen = now(); dirty = true;
    return { name: u.name, key: u.key };
  }

  function byKey(key) {   // /auth/me: is the key of an account still valid
    if (!validKey(key)) return null;
    const u = Object.values(data.users).find(x => x.key === key);
    if (!u) return null;
    u.seen = now(); dirty = true;
    return { name: u.name };
  }

  // the nick of an account as it was registered (the teams invite by nick, any case): null when there is no such account
  function find(name) { const u = data.users[lower(cleanName(name))]; return u ? u.name : null; }

  // the admin panel (admin.mjs): the accounts as a list — the nick, when it was made and last seen, and the id the
  // leaderboard knows it by (never the key itself); the last activity first, q searches the nick
  function list({ q = '', limit = 200 } = {}) {
    const needle = lower(cleanName(q));
    let rows = Object.values(data.users).map(u => ({ name: u.name, created: u.created, seen: u.seen, id: idOf(u.key) }));
    if (needle) rows = rows.filter(r => lower(r.name).includes(needle));
    rows.sort((a, b) => b.seen - a.seen);
    return { total: rows.length, rows: rows.slice(0, Math.max(1, Math.min(500, limit))) };
  }
  // a new password for an account (the admin resets a lost one): the key stays, so the results stay with it too
  function setPass(name, pass) {
    const u = data.users[lower(cleanName(name))];
    if (!u) return { error: 'no-user' };
    if (typeof pass !== 'string' || pass.length < 6 || pass.length > 128) return { error: 'bad-pass' };
    const salt = crypto.randomBytes(16);
    u.salt = salt.toString('hex'); u.hash = hash(pass, salt).toString('hex'); dirty = true;
    return { name: u.name };
  }
  // the account goes (the admin): its key comes back so the fight can put out whoever plays with it now
  function remove(name) {
    const k = lower(cleanName(name)), u = data.users[k];
    if (!u) return null;
    delete data.users[k]; dirty = true;
    return { name: u.name, key: u.key };
  }

  function save() {
    if (!file || !dirty) return; dirty = false;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); } catch (e) { dirty = true; console.error('accounts not saved:', e.message); }
  }
  return { register, login, byKey, find, list, setPass, remove, save, count: () => Object.keys(data.users).length };
}