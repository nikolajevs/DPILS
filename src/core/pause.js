import { STATE } from './state.js';

/* Pauses inside the long steps of the build. The city is built on the main thread, and a step that ran in one piece
   (up to 2–3 s: the ground, the landmarks, the trees, the transit) kept the page from answering clicks and from
   drawing, so the start card froze while the city was being built: its settings, the time of day, the keys. The loops
   of those steps now ask `due()` now and then and, once they have run for SLICE ms, `await pause()`: the browser
   handles the input and draws a frame (it does both before a task posted after them), and the loop goes on.
   A pause is a message to the page itself, not a timer: timers of a hidden tab are slowed down to one a second.
   While paused, the height compensation of the geometry being built (STATE.GBC) is put aside: what runs in the pause
   (a model file that came in) builds geometry of its own. */
const SLICE = 40;
let t0 = performance.now();
const queue = [], ch = new MessageChannel();
ch.port1.onmessage = () => queue.shift()();
const due = () => performance.now() - t0 > SLICE;
async function pause() {
  const gbc = STATE.GBC; STATE.GBC = null;
  await new Promise(r => { queue.push(r); ch.port2.postMessage(0); });
  STATE.GBC = gbc; t0 = performance.now();
}
// for the places between the parts of a step: a pause if the slice is used up
const rest = () => (due() ? pause() : undefined);

export { due, pause, rest };
