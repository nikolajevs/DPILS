import { STATE } from '../core/state.js';
import { P } from '../game/player.js';
import { ROAD, inWater } from '../world/data.js';
import { $, C, NAMES } from '../core/env.js';

/* ---------- HUD ---------- */
const elStreet = $('street'), elNear = $('near'), stMode = $('stMode'), stHead = $('stHead'), stPos = $('stPos'), bSV = $('bSV'); STATE.hudTimer = 0;
const WIND = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
function updateHud() {
  let best = 1e9, name = -1;
  ROAD.near(P.x, P.z, 38, (id, d) => { const n = ROAD.s[id * 6 + 5]; if (n >= 0 && d < best) { best = d; name = n; } });
  elStreet.textContent = P.fly ? 'Daugavpils' : name >= 0 ? NAMES[name] : inWater(P.x, P.z) ? 'Daugava' : '—';
  let nb = 80 * 80, nn = -1; for (const p of C.p) { const d = (p[1] - P.x) ** 2 + (p[2] - P.z) ** 2; if (d < nb) { nb = d; nn = p[0]; } }
  if (nn >= 0 && !P.fly) { elNear.hidden = false; elNear.innerHTML = ''; elNear.append('рядом: '); const b = document.createElement('b'); b.textContent = NAMES[nn]; elNear.append(b, ' · ' + Math.round(Math.sqrt(nb)) + ' м'); } else elNear.hidden = true;
  const deg = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360;
  stHead.textContent = 'курс ' + String(Math.round(deg) % 360).padStart(3, '0') + '° ' + WIND[Math.round(deg / 45) % 8];
  stMode.textContent = P.fly ? 'полёт, ' + Math.round(P.y) + ' м' : 'пешком, ' + (P.walked < 1000 ? Math.round(P.walked) + ' м' : (P.walked / 1000).toFixed(2) + ' км');
  const lat = C.lat0 - P.z / C.ky, lon = C.lon0 + P.x / C.kx;
  stPos.textContent = lat.toFixed(4) + '° с. ш., ' + lon.toFixed(4) + '° в. д.';
  bSV.href = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + lat.toFixed(6) + ',' + lon.toFixed(6) + '&heading=' + Math.round(deg) + '&pitch=' + Math.round(P.pitch * 57.3) + '&fov=90';
}

export { bSV, updateHud };
