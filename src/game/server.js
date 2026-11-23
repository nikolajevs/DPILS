/* ---------- the game server and its list of servers ----------
   There is a single address: the one this page is served from — in production (STATIC=dist) one process gives out the
   page, /auth, /leaderboard and the game WebSocket, so the address of the page is the address of the server. That
   process holds the list of servers (server/index.mjs SERVERS): the same city, its matches started 30 minutes apart,
   each on its own WebSocket path /play/<n>. The lobby (src/ui/lobby.js) reads them from /health and picks one —
   setServerPick — and mp.js joins gameUrl(); the accounts, the leaderboard and the teams stay on the bare address. On localhost the page may instead come from the vite dev server, which has no game behind it:
   a /health probe beside the page tells the two apart, and the dev page falls back to the local server on 8787.
   serverReady settles once the address is known (at once off localhost): the connections opened by themselves at
   the page's start (the teams, src/game/social.js) wait for it. */
let url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
export const serverUrl = () => url;
export const serverHttp = () => url.replace(/^ws/, 'http');
// the chosen server of the list: its number (from 1) and the WebSocket of its game ('/' is the first)
let pick = 1;
export const serverPick = () => pick;
export const setServerPick = n => { pick = Math.max(1, Math.round(+n) || 1); };
export const gameUrl = () => url + (pick > 1 ? '/play/' + pick : '');
// the server and the match the player last joined: a reload comes back to it while that match runs (lobby.js)
export function lastServer() { try { const v = JSON.parse(localStorage.getItem('dpils.srv') || 'null'); return v && v.id ? v : null; } catch (e) { return null; } }
export function noteServer(id, n) { try { localStorage.setItem('dpils.srv', JSON.stringify({ id, n })); } catch (e) {} }
export const serverReady = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? fetch('health', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
    .then(j => { if (!(j && j.ok && j.mode)) url = 'ws://localhost:8787'; })
    .catch(() => { url = 'ws://localhost:8787'; })
  : Promise.resolve();
