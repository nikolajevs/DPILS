import { STATE } from '../core/state.js';
import { PP } from '../render/post.js';
import { QUALITY, qi, setQuality } from '../render/lighting.js';
import { POST, renderer } from '../render/renderer.js';

/* ---------- frame rate ----------
   PERF.fps is the frame rate of the last second or so.

   The resolution of the picture follows the frame rate (city and game alike). When the frames take longer than
   1/45 s the scene is drawn at a smaller share of the drawing buffer (PP.scale, in steps of 5 %, down to 0.55 of a
   CSS pixel), and the last pass of the post-processing draws it up to the full canvas; when they keep up with the
   screen for three seconds the share goes back up by a step. A step down that does not make the frames faster — the
   page then waits for the processor, or the browser holds it at 30 frames a second — is undone and not tried again
   for half a minute (then longer); a step up that makes them too slow is undone the same way. Measured over windows
   of one second; the first seconds, those after a change of the graphics and windows with a stall (shaders, loading)
   are left out.

   In the game the graphics are lowered by themselves, one level at a time, when the page stays under 28 frames a
   second for two checks in a row (4 s each) and the resolution cannot help any more. The first seconds after the
   start and after each change are not counted: shaders compile then. A press on the "Графика" button hands the
   choice to the player and switches this off. */
// scale: the share of the resolution the scene is drawn at; dyn: whether it follows the frame rate (tools/shots.js
// switches it off: its frames take minutes, and a check of the picture wants it whole)
const PERF = { fps: 60, scale: 1, dyn: true, auto: true, lowered: 0, notice: null };
let frames = 0, span = 0, slow = 0, quiet = 6, fpsFrames = 0, fpsSpan = 0;
function perfTick(rdt) {   // rdt: the real time of the frame, seconds
  fpsFrames++; fpsSpan += rdt; if (fpsSpan >= 1) { PERF.fps = Math.round(fpsFrames / fpsSpan); fpsFrames = 0; fpsSpan = 0; }
  dynTick(rdt); PERF.scale = PP.scale;
  if (!STATE.mp || !PERF.auto) return;
  if (quiet > 0) { quiet -= rdt; frames = span = 0; return; }
  frames++; span += rdt;
  if (span < 4) return;
  const fps = frames / span; frames = span = 0;
  if (fps >= 28 || canLower()) { slow = 0; return; }
  if (++slow < 2) return;
  slow = 0;
  if (qi < QUALITY.length - 1) { setQuality(qi + 1); PERF.lowered++; quiet = 6; if (PERF.notice) PERF.notice('Графика снижена до «' + QUALITY[qi].name + '»: ' + Math.round(fps) + ' кадров в секунду'); }
}

/* ---------- dynamic resolution ---------- */
const SLOW = 1000 / 45, FAST = 1000 / 56, GOAL = 1000 / 55;   // frame times, ms
let dWin = 0, dN = 0, dMax = 0, dQuiet = 5, dFast = 0, dTry = null, dLowBlock = 0, dLowWait = 30, dUpBlock = 0, dUpWait = 15, dPr = 0, dQi = -1;
const minScale = () => Math.min(1, Math.ceil(0.55 / renderer.getPixelRatio() * 20 - 1e-6) / 20);   // a whole number of 5 % steps
const setScale = s => { PP.scale = Math.max(minScale(), Math.min(1, Math.round(s * 20) / 20)); };
const canLower = () => POST && PERF.dyn && PP.scale > minScale() + 1e-3 && dLowBlock <= 0;   // can the resolution still help?
function dynTick(rdt) {
  if (!POST) return;
  if (!PERF.dyn) { PP.scale = 1; dTry = null; return; }
  // another quality level or pixel ratio: start again from the full resolution
  if (renderer.getPixelRatio() !== dPr || qi !== dQi) { dPr = renderer.getPixelRatio(); dQi = qi; PP.scale = 1; dTry = null; dFast = 0; dQuiet = 5; }
  dLowBlock -= rdt; dUpBlock -= rdt;
  if (dQuiet > 0) { dQuiet -= rdt; dWin = dN = dMax = 0; return; }
  dWin += rdt; dN++; dMax = Math.max(dMax, rdt);
  if (dWin < 1) return;
  const ft = dWin / dN * 1000, stall = dMax > 0.5 && dMax * 1000 > 3 * ft; dWin = dN = dMax = 0;
  if (stall || document.hidden || !STATE.started || STATE.mapOpen) return;   // with the full map open the frames say nothing of the city
  if (dTry) {   // the window after a step: did it do what it was for?
    const t = dTry; dTry = null;
    if (t.down && ft > t.ft * 0.93) { setScale(t.from); dLowBlock = dLowWait; dLowWait = Math.min(240, dLowWait * 2); dQuiet = 1; return; }
    if (!t.down && ft > SLOW) { setScale(t.from); dUpBlock = dUpWait; dUpWait = Math.min(160, dUpWait * 2); dQuiet = 1; return; }
    if (t.down) dLowWait = 30;
  }
  if (ft > SLOW) {
    dFast = 0; if (!canLower()) return;
    const from = PP.scale; setScale(from * Math.max(0.7, Math.min(0.92, Math.sqrt(GOAL / ft))));
    if (PP.scale < from) { dTry = { down: true, from, ft }; dQuiet = 0.5; }
    return;
  }
  if (ft < FAST && PP.scale < 1) { if (++dFast >= 3 && dUpBlock <= 0) { dFast = 0; const from = PP.scale; setScale(from + 0.1); dTry = { down: false, from, ft }; dQuiet = 0.5; } }
  else dFast = 0;
}

export { PERF, perfTick };
