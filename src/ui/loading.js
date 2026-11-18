/* The loading bar of the start card.

   Most of the build runs in long synchronous steps that keep the page busy, so the bar cannot be redrawn from script
   while a step runs. Instead, when a step begins, the bar is given its whole path through the step as an animation
   of its transform (Web Animations): such an animation runs on the compositor, so the bar keeps moving while the main
   thread is busy. The expected time of a step is its weight (its time on a reference machine, src/main.js) times how
   fast the steps of the city so far ran on this one. The bar reaches 75 % of the step by the expected time and then
   goes on, slower, towards 99 % by two and a half times it: a step longer than expected slows the bar down but does
   not stop it. Every step starts from where the bar visibly stands, and the bar never moves faster than 12 % of its
   length a second, so a step that ends early does not make it jump: it catches up over the next ones. */
const $ = id => document.getElementById(id);
const box = $('load'), fill = $('loadFill'), label = $('progress'), pct = $('loadPct');

const RATE = 0.12, K1 = 0.75, T2 = 2.5;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let anim = null;            // the running animation of the bar
let track = null;           // its path: { t0 (ms), p0, stops: [[seconds, fraction], …] }
let shown = 0;              // fraction the bar is heading to
let step = null;            // the running step: { a, b, w, t0, cal }
let speed = 1;              // real milliseconds per reference millisecond on this machine (refined as steps finish)
let spentW = 0, spentT = 0;

const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // after the next frame is drawn
/* where the bar stands on the screen now, from its path and the clock: not from its computed style, whose animation
   clock stands still while a long step keeps the page from drawing (right after such a step it would tell where the
   bar was when the step began, and the next step would send the bar back there) */
function at() {
  if (!track) return shown;
  let t = (performance.now() - track.t0) / 1000, from = [0, track.p0];
  for (const s of track.stops) { if (t <= s[0]) return s[0] > from[0] ? from[1] + (s[1] - from[1]) * (t - from[0]) / (s[0] - from[0]) : s[1]; from = s; }
  return from[1];
}
/* the bar from where it stands through points [seconds, fraction], straight between them; each leg takes at least as
   long as RATE allows (fast: the last fill, which may take its time from the points alone) */
function move(points, fast) {
  const p0 = at(); if (anim) anim.cancel();
  const frames = [{ transform: `scaleX(${p0.toFixed(4)})`, offset: 0 }], stops = []; let t = 0, v = p0;
  for (const [d, f] of points) { const to = Math.max(v, Math.min(1, f)); t += fast ? d : Math.max(d, (to - v) / RATE); stops.push([t, to]); v = to; }
  fill.style.transform = `scaleX(${v.toFixed(4)})`; shown = v;   // where the bar ends up (under the animation)
  track = null; if (still || t <= 0) return;
  track = { t0: performance.now(), p0, stops };
  for (const [tt, f] of stops) frames.push({ transform: `scaleX(${f.toFixed(4)})`, offset: tt / t });
  anim = fill.animate(frames, { duration: t * 1000, easing: 'linear' });
}
const percent = f => { pct.textContent = Math.floor(Math.max(0, Math.min(1, f)) * 100) + ' %'; };

function finishStep() {
  if (!step) return;
  const t = performance.now() - step.t0;
  if (step.cal) { spentW += step.w; spentT += t; speed = spentT / spentW; }
  step = null;
}

// the parts of the bar: downloading the data, loading the code, building the city (main.js splits it into steps)
const PHASE = { data: [0, 0.1], code: [0.1, 0.13], build: [0.13, 1] };

const loading = {
  /** A step from fraction a to b with a weight in reference milliseconds; resolves once the bar has started moving.
      A step that reports its own progress (reported: true) moves the bar only through part(). Only the steps of the
      city tell the speed of the machine: loading the code is mostly the network. */
  async step(text, a, b, w, reported = false) {
    finishStep();
    label.textContent = text; percent(at());
    step = { a, b, w: reported ? 0 : w, t0: performance.now(), cal: !reported && w > 0 && a >= PHASE.build[0] };
    if (reported || !(b > a)) move([[0, a]]);
    else { const E = Math.max(0.15, w * speed / 1000); move([[E, a + K1 * (b - a)], [(T2 - 1) * E, a + 0.99 * (b - a)]]); }
    step.t0 = performance.now();
    await frame();
  },
  /** Progress inside a step that reports it (downloads, shader batches): f from 0 to 1 of the current step. */
  part(f, text) {
    if (text != null) label.textContent = text;
    if (!step) return;
    const v = step.a + (step.b - step.a) * Math.max(0, Math.min(1, f));
    if (v > shown) { move([[0.25, v]]); percent(at()); }
  },
  done(text) {
    finishStep(); move([[0.35, 1]], true); percent(1); label.textContent = text;
    box.classList.add('done');
  },
  fail(text) {
    finishStep(); const p = at(); if (anim) anim.cancel(); track = null; shown = p; fill.style.transform = `scaleX(${p.toFixed(4)})`; label.textContent = text;
    box.classList.add('failed');
  },
  frame,
};

export { PHASE, loading };
