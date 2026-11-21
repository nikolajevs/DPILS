/* The day of the game: 45 minutes from midnight to midnight, with the sun and the moon moving across the sky. Its clock
   is the wall clock — a day starts at every whole multiple of its length since 1970 — so a restart of the server keeps
   the time of day, and the page and the training in the browser («авто») show the same sky as the server. The server
   only counts the time and sends the share of the day gone to every player that joins (game.mjs, `hello.day`); the page
   draws the sun, the moon and the light of that moment (src/render/lighting.js). DAY_MIN of the server changes the
   length, DAY_MIN=0 stops the clock (server/index.mjs). */
export const DAY_MS = 45 * 60 * 1000;
// the share of the day gone at t (ms since 1970): 0 midnight, 0.25 six in the morning, 0.5 noon
export const dayPhase = (t, len = DAY_MS) => (((t / len) % 1) + 1) % 1;
