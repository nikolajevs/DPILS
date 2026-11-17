import { STATE } from '../core/state.js';
import { P } from '../game/player.js';
import { PERF } from '../game/perf.js';
import { ROAD, buildingAt, inWater } from './data.js';
import { walkLift } from './terrain.js';
import { loadHumans, makeAvatar, randomLook } from '../game/avatar.js';
import { timeI } from '../render/lighting.js';
import { scene } from '../render/renderer.js';

/* ---------- the people of the streets ----------
   A few citizens walk the footways of the streets near the player: they are the same Quaternius models as the players
   (src/game/avatar.js), but unarmed — the whole walk clip, no team gear. They keep to the side of the carriageway (the
   half width of ROAD includes the footway), turn back at the ends of a street or before a wall, and are fewer at night.
   The pool is small and follows the player: anyone farther than 160 m is hidden and, when needed, moved to a street
   nearer by. Only the near ones animate every frame; the far ones take their steps in batches of a quarter second.
   In the online game the streets are empty of civilians: there every person is a player. */
const peds = [];
let hState = 0, reviewAt = 0;   // hState: 0 not asked, 1 loading, 2 ready, 3 the files did not come
const MAX_PEDS = 12;
// a point on the footway of a street 40…150 m from the player, with the direction along it
function spawnSpot() {
  const cands = [];
  ROAD.near(P.x, P.z, 150, (id, d) => { if (d > 40 && ROAD.s[id * 6 + 4] >= 2) cands.push(id); });
  if (!cands.length) return null;
  const s = ROAD.s, o = cands[(Math.random() * cands.length) | 0] * 6;
  const x1 = s[o], z1 = s[o + 1], x2 = s[o + 2], z2 = s[o + 3], hw = s[o + 4];
  const L = Math.hypot(x2 - x1, z2 - z1); if (L < 10) return null;
  const ux = (x2 - x1) / L, uz = (z2 - z1) / L, t = 0.1 + Math.random() * 0.8, side = Math.random() < 0.5 ? 1 : -1;
  const off = Math.max(1.3, hw - 1.2) * side, x = x1 + (x2 - x1) * t - uz * off, z = z1 + (z2 - z1) * t + ux * off;
  if (buildingAt(x, z) || inWater(x, z)) return null;
  const dir = Math.random() < 0.5 ? 1 : -1;
  return { x, z, ux: ux * dir, uz: uz * dir, x1, z1, x2, z2 };
}
function place(p) {
  const s = spawnSpot(); if (!s) return false;
  p.x = s.x; p.z = s.z; p.ux = s.ux; p.uz = s.uz; p.x1 = s.x1; p.z1 = s.z1; p.x2 = s.x2; p.z2 = s.z2;
  p.speed = 1.1 + Math.random() * 0.7; p.turnT = 6 + Math.random() * 10; p.acc = 0;
  p.av.root.visible = true; return true;
}
function pedTick(dt) {
  if (STATE.mp || !STATE.started) { for (const p of peds) p.av.root.visible = false; return; }
  if (hState === 0) { hState = 1; loadHumans().then(h => { hState = h ? 2 : 3; }); return; }
  if (hState !== 2) return;
  const target = Math.min(MAX_PEDS, Math.round((PERF.fps < 30 ? 4 : PERF.fps < 45 ? 7 : 10) * (timeI >= 2 ? 0.4 : 1)));
  const now = performance.now() / 1000;   // the review keeps real time: the frame dt is clamped, and on slow frames the streets would otherwise stay empty for minutes
  if (now >= reviewAt) {
    reviewAt = now + 0.5;
    for (const p of peds) if (Math.hypot(p.x - P.x, p.z - P.z) > 180) place(p);   // the far ones move nearer by
    if (peds.length < target) { const av = makeAvatar(-1, randomLook(), true); if (av) { scene.add(av.root); const p = { av }; if (place(p)) { peds.push(p); } else { scene.remove(av.root); } } }
    while (peds.length > target + 2) { const p = peds.pop(); scene.remove(p.av.root); p.av.root.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }); }   // the pool shrinks quietly
  }
  for (const p of peds) {
    const d = Math.hypot(p.x - P.x, p.z - P.z);
    if (d > 160) { p.av.root.visible = false; continue; }
    p.av.root.visible = true;
    // walk along the street; turn back at its end, before a wall, or now and then for no reason
    p.turnT -= dt;
    const nx = p.x + p.ux * p.speed * dt, nz = p.z + p.uz * p.speed * dt;
    const along = (nx - p.x1) * (p.x2 - p.x1) + (nz - p.z1) * (p.z2 - p.z1);
    const L2 = (p.x2 - p.x1) ** 2 + (p.z2 - p.z1) ** 2;
    if (p.turnT <= 0 || along < 0 || along > L2 || buildingAt(nx + p.ux * 0.6, nz + p.uz * 0.6) || inWater(nx, nz)) {
      p.ux = -p.ux; p.uz = -p.uz; p.turnT = 6 + Math.random() * 10;
      if (along < 0 || along > L2) place(p);   // a new street altogether
    } else { p.x = nx; p.z = nz; }
    const y = walkLift(p.x, p.z);
    p.av.root.position.set(p.x, y, p.z);
    p.av.root.rotation.y = Math.atan2(-p.ux, -p.uz);
    if (d < 70) p.av.update(dt, { speed: p.speed, air: false, dead: false, shot: false });
    else { p.acc += dt; if (p.acc > 0.25) { p.av.update(p.acc, { speed: p.speed, air: false, dead: false, shot: false }); p.acc = 0; } }
  }
}
export { pedTick };
