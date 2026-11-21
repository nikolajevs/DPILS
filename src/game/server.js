/* ---------- the one game server ----------
   There is a single server: the one this page is served from — in production (STATIC=dist) one process gives out the
   page, /auth, /leaderboard and the game WebSocket, so the address of the page is the address of the server and there
   is nothing to choose. On localhost the page may instead come from the vite dev server, which has no game behind it:
   a /health probe beside the page tells the two apart, and the dev page falls back to the local server on 8787. */
let url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
export const serverUrl = () => url;
export const serverHttp = () => url.replace(/^ws/, 'http');
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  fetch('health', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
    .then(j => { if (!(j && j.ok && j.mode)) url = 'ws://localhost:8787'; })
    .catch(() => { url = 'ws://localhost:8787'; });
}
