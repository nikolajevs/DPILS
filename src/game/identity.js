/* ---------- who the player is for the leaderboard of a server ----------
   Without an account the browser makes a secret key once (16 random bytes, kept in localStorage) and sends it when it
   joins a server. The server keeps only a hash of it, so the results belong to this browser and nobody can take its
   nick. The same hash (sha256, the first 32 characters) tells the server which row of the table is "me". The player
   may keep the results out of the table (the join then carries board:false); the account key itself is always sent:
   an account is mandatory, the server refuses a join without one.
   With an account (the login page, src/ui/auth.js) the key is the one the server gave at the registration: it is kept
   in dpils.account together with the nick and the server, and the results follow the account to any browser. */
const KEY = 'dpils.key', OPT = 'dpils.board', ACC = 'dpils.account';
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export const boardOn = () => { try { return localStorage.getItem(OPT) !== 'off'; } catch (e) { return true; } };
export const setBoardOn = on => { try { localStorage.setItem(OPT, on ? 'on' : 'off'); } catch (e) {} };
export function account() {
  try { const a = JSON.parse(localStorage.getItem(ACC) || 'null'); if (a && typeof a.name === 'string' && typeof a.url === 'string' && typeof a.key === 'string' && /^[0-9a-f]{32}$/.test(a.key)) return a; } catch (e) {}
  return null;
}
export function setAccount(a) { try { localStorage.setItem(ACC, JSON.stringify(a)); } catch (e) {} }
export function clearAccount() { try { localStorage.removeItem(ACC); } catch (e) {} }
let mem = '';   // when the storage is not available the key lives until the page is closed
export function playerKey() {
  const a = account(); if (a) return a.key;   // the account's key is the entry ticket: sent even with the board opt-out
  if (!boardOn()) return '';
  try { const k = localStorage.getItem(KEY); if (/^[0-9a-f]{32}$/.test(k || '')) return k; } catch (e) {}
  if (!mem) { mem = hex(crypto.getRandomValues(new Uint8Array(16))); try { localStorage.setItem(KEY, mem); } catch (e) {} }
  return mem;
}
export async function keyId() {
  const k = playerKey(); if (!k || !crypto.subtle) return '';
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(k))).slice(0, 32);
}
