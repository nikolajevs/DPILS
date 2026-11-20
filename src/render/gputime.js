import { renderer } from './renderer.js';

/* ---------- GPU frame time ----------
   How long the video card worked on the frame, measured with EXT_disjoint_timer_query_webgl2: a query wraps
   renderFrame (the scene, the shadow map and the post-processing passes). The result arrives a few frames late,
   so gpuPoll reads whatever is ready without waiting; the HUD shows the average of the last second (perf.js).
   A disjoint event (the driver reset its counters — a mode switch, a lost context) invalidates the queries in
   flight: they are thrown away. Without the extension (Firefox, some drivers) gpuOk is false and the HUD says
   "н/д" instead of a number. */
const gl = renderer.getContext();
const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const gpuOk = !!ext;
const pending = [];
let active = null;
function gpuBegin() {
  if (!ext || active) return;
  active = gl.createQuery();
  gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
}
function gpuEnd() {
  if (!ext || !active) return;
  gl.endQuery(ext.TIME_ELAPSED_EXT);
  pending.push(active); active = null;
  while (pending.length > 4) gl.deleteQuery(pending.shift());   // the GPU is far behind: the oldest frames say nothing now
}
function gpuPoll() {   // milliseconds of the latest finished frame, or -1 when nothing is ready
  if (!ext) return -1;
  if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { for (const q of pending) gl.deleteQuery(q); pending.length = 0; return -1; }
  let ms = -1;
  while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = pending.shift();
    ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(q);
  }
  return ms;
}

export { gpuBegin, gpuEnd, gpuOk, gpuPoll };