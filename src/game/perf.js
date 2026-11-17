import { STATE } from '../core/state.js';
import { QUALITY, qi, setQuality } from '../render/lighting.js';

/* ---------- frame rate ----------
   PERF.fps is the frame rate of the last second or so. In the game the graphics are lowered by themselves, one level at
   a time, when the page stays under 28 frames a second for two checks in a row (4 s each) — the first seconds after
   the start and after each change are not counted: shaders compile then. A press on the "Графика" button hands the
   choice to the player and switches this off. */
const PERF = { fps: 60, auto: true, lowered: 0, notice: null };
let frames = 0, span = 0, slow = 0, quiet = 6, fpsFrames = 0, fpsSpan = 0;
function perfTick(rdt) {   // rdt: the real time of the frame, seconds
  fpsFrames++; fpsSpan += rdt; if (fpsSpan >= 1) { PERF.fps = Math.round(fpsFrames / fpsSpan); fpsFrames = 0; fpsSpan = 0; }
  if (!STATE.mp || !PERF.auto) return;
  if (quiet > 0) { quiet -= rdt; frames = span = 0; return; }
  frames++; span += rdt;
  if (span < 4) return;
  const fps = frames / span; frames = span = 0;
  if (fps >= 28) { slow = 0; return; }
  if (++slow < 2) return;
  slow = 0;
  if (qi < QUALITY.length - 1) { setQuality(qi + 1); PERF.lowered++; quiet = 6; if (PERF.notice) PERF.notice('Графика снижена до «' + QUALITY[qi].name + '»: ' + Math.round(fps) + ' кадров в секунду'); }
}
export { PERF, perfTick };
