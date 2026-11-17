/* ---------- who the player is for the leaderboard of a server ----------
   No accounts: the browser makes a secret key once (16 random bytes, kept in localStorage) and sends it when it joins a
   server. The server keeps only a hash of it, so the results belong to this browser and nobody can take its nick. The
   same hash (sha256, the first 32 characters) tells the server which row of the table is "me". The player may refuse:
   then no key is sent and the results stay out of the table. */
const KEY = 'dpils.key', OPT = 'dpils.board';
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export const boardOn = () => { try { return localStorage.getItem(OPT) !== 'off'; } catch (e) { return true; } };
export const setBoardOn = on => { try { localStorage.setItem(OPT, on ? 'on' : 'off'); } catch (e) {} };
let mem = '';   // when the storage is not available the key lives until the page is closed
export function playerKey() {
  if (!boardOn()) return '';
  try { const k = localStorage.getItem(KEY); if (/^[0-9a-f]{32}$/.test(k || '')) return k; } catch (e) {}
  if (!mem) { mem = hex(crypto.getRandomValues(new Uint8Array(16))); try { localStorage.setItem(KEY, mem); } catch (e) {} }
  return mem;
}
export async function keyId() {
  const k = playerKey(); if (!k || !crypto.subtle) return '';
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(k))).slice(0, 32);
}
