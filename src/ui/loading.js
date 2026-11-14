/* The loading bar of the start card.

   Most of the build runs in long synchronous steps that keep the page busy, so the bar cannot be redrawn from script
   while a step runs. Instead, when a step begins, the bar is sent towards the end of that step with a CSS transition
   lasting as long as the step is expected to take: a transform transition runs on the compositor, so the bar keeps
   moving while the main thread is busy. The expected time is the step's weight (its time on a reference machine)
   times how fast the steps so far ran on this one. The bar eases out towards the end of a step and jumps there as
   soon as the step is done, so a slow step never overshoots and a fast one never waits. */
const $ = id => document.getElementById(id);
const box = $('load'), fill = $('loadFill'), label = $('progress'), pct = $('loadPct');

let shown = 0;              // fraction the bar shows (or is heading to)
let step = null;            // the running step: { a, b, w, t0 }
let speed = 0.6;            // seconds per weight unit on this machine, relative to the reference (refined as steps finish)
let spentW = 0, spentT = 0;

const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // after the next frame is drawn
function bar(f, ms, ease) {
  fill.style.transition = ms > 0 ? `transform ${Math.round(ms)}ms ${ease || 'linear'}` : 'none';
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, f)).toFixed(4)})`;
  shown = f;
}
const percent = f => { pct.textContent = Math.floor(Math.max(0, Math.min(1, f)) * 100) + ' %'; };

function finishStep() {
  if (!step) return;
  const t = performance.now() - step.t0;
  if (step.w > 0) { spentW += step.w; spentT += t; speed = spentT / spentW; }
  step = null;
}

// the parts of the bar: downloading the data, loading the code, building the city (main.js splits it into steps)
const PHASE = { data: [0, 0.2], code: [0.2, 0.23], build: [0.23, 1] };

const loading = {
  /** A step from fraction a to b with a weight in reference milliseconds; resolves once the bar has started moving.
      A step that reports its own progress (reported: true) moves the bar only through part(). */
  async step(text, a, b, w, reported = false) {
    finishStep();
    label.textContent = text; percent(a);
    bar(Math.max(shown, a), 120);
    await frame();
    step = { a, b, w: reported ? 0 : w, t0: performance.now() };
    // most of the way there over the expected time, then slowly the rest: the bar never stops dead in a long step
    if (!reported && b > a) bar(a + (b - a) * 0.96, Math.max(150, w * speed), 'cubic-bezier(.3,.55,.45,1)');
    await frame();
  },
  /** Progress inside a step that reports it (downloads, shader batches): f from 0 to 1 of the current step. */
  part(f, text) {
    if (text != null) label.textContent = text;
    if (!step) return;
    const v = step.a + (step.b - step.a) * Math.max(0, Math.min(1, f));
    if (v > shown) { bar(v, 160); percent(v); }
  },
  done(text) {
    finishStep(); bar(1, 200); percent(1); label.textContent = text;
    box.classList.add('done');
  },
  fail(text) {
    finishStep(); fill.style.transition = 'none'; label.textContent = text;
    box.classList.add('failed');
  },
  frame,
};

export { PHASE, loading };
