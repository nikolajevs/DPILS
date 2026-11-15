import { C } from '../core/env.js';

/* ---------- heights and roofs from the LGIA lidar ----------
   lidar.js (built by tools/lidar.js from the LGIA lidar point clouds) holds for each building of citydata.js the
   height of its eaves and of its top over the ground and the shape of its roof: 1 flat, 2 a gable with the ridge
   along the long side of its outline, 3 a gable across it, 4 a hip, 5 a pitched roof on an outline too irregular for
   those. It is read only when it was built for this citydata.js (the same number of buildings and the same key). */
let D;
function lidarInit() {
  D = null; const L = window.LIDAR; if (!L || L.n !== C.b.length) return;
  let key = 0; for (let id = 0; id < C.b.length; id++) { const r = C.b[id][7]; key = (key + r[0] * 7 + r[1] * 13 + id) % 1000000007; }
  if (key !== L.key) { console.warn('lidar.js was built for another citydata.js: rebuild it with tools/lidar.js'); return; }
  const s = atob(L.d); D = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) D[i] = s.charCodeAt(i);
}
// { eave, top, type } in metres over the ground, or null where the lidar has nothing for the building
function lidarOf(id) {
  if (D === undefined) lidarInit(); if (!D) return null;
  const o = id * 5, type = D[o + 4]; if (!type) return null;
  return { eave: (D[o] | D[o + 1] << 8) / 10, top: (D[o + 2] | D[o + 3] << 8) / 10, type };
}

export { lidarOf };
