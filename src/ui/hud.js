import { STATE } from '../core/state.js';
import { PERF } from '../game/perf.js';
import { P } from '../game/player.js';
import { ROAD, inWater } from '../world/data.js';
import { $, C, NAMES } from '../core/env.js';

/* ---------- HUD ----------
   The street plate over the corner, the compass, the coordinates and the performance line of the status (F3). */
const elStreet = $('street'), stHead = $('stHead'), stPos = $('stPos'), stPerf = $('stPerf'); STATE.hudTimer = 0;
const WIND = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
function updateHud() {
  let best = 1e9, name = -1;
  ROAD.near(P.x, P.z, 38, (id, d) => { const n = ROAD.s[id * 6 + 5]; if (n >= 0 && d < best) { best = d; name = n; } });
  elStreet.textContent = P.fly ? 'Daugavpils' : name >= 0 ? NAMES[name] : inWater(P.x, P.z) ? 'Daugava' : '—';
  const deg = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360;
  stHead.textContent = 'курс ' + String(Math.round(deg) % 360).padStart(3, '0') + '° ' + WIND[Math.round(deg / 45) % 8];
  const lat = C.lat0 - P.z / C.ky, lon = C.lon0 + P.x / C.kx;
  stPos.textContent = lat.toFixed(4) + '° с. ш., ' + lon.toFixed(4) + '° в. д.';
  // the performance line (settings or F3): frame rate, draw calls of the last frame, average CPU and GPU frame time
  stPerf.textContent = PERF.fps + ' кадр/с · ' + PERF.calls + ' вызовов · CPU ' + PERF.cpu.toFixed(1) + ' мс · GPU ' + (PERF.gpuOk && PERF.gpuSeen ? PERF.gpu.toFixed(1) + ' мс' : 'н/д') + (PERF.scale < 1 ? ' · разрешение ' + Math.round(PERF.scale * 100) + ' %' : '');
}

export { updateHud };
