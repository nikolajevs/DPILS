/* The training bots: players of the game with no connection, run by the server (or by the page, in the game against
   bots). Every bot sees what a player could see (an enemy within its sight and no house between), turns to it at the
   speed of its level, waits its reaction time, and fires in bursts with the error of its level; the server then judges
   its shots as it judges everybody's. It walks to waypoints round the arena, goes round houses and keeps out of the water,
   strafes in a fight, falls back when hurt, throws a grenade now and then and comes back after the death by itself. */
import { FALL, HIT, bulletDrop } from './combat.mjs';
const NAMES = ['Андрис', 'Янис', 'Артур', 'Лиена', 'Виктор', 'Ольга', 'Эдгар', 'Дайна', 'Максим', 'Илзе', 'Роман', 'Кристап', 'Анна', 'Игорь', 'Мартиньш', 'Светлана'];
// sigma: the aim error in radians — tuned for the small hitboxes (a torso half a metre wide, a head 0.36 m), so the
// error is about half of what it was against the old metre-wide capsule; head: the share of shots aimed at the head
export const LEVELS = {
  easy: { react: 0.75, sigma: 0.018, turn: 3.2, burst: [2, 3], pause: 0.9, sight: 70, nades: 0, head: 0.4 },
  normal: { react: 0.4, sigma: 0.008, turn: 6, burst: [3, 5], pause: 0.55, sight: 100, nades: 0.003, head: 0.2 },
  hard: { react: 0.2, sigma: 0.004, turn: 10, burst: [4, 8], pause: 0.3, sight: 130, nades: 0.006, head: 0.1 },
};
const rnd = (a, b) => a + Math.random() * (b - a), gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += Math.random(); return (s - 2) * 1.7; };
// the server holds up to 64 players and the name list is shorter: past the first cycle a number keeps the names
// unique ("Андрис 2 (бот)"), so addBot never loops forever looking for a free one
export const botName = i => NAMES[i % NAMES.length] + (i < NAMES.length ? '' : ' ' + (1 + (i / NAMES.length | 0))) + ' (бот)';

// g: the game's own tools: players, now(), world (freePath, ground, walkable), area { cx, cz, r }, bases, FFA, WEAPONS, R, shoot(p, w, rays, lagMs), throwNade(p, dir), spawn(p), roundOver()
export function createBrain(g) {
  const { world, area } = g;
  const inArea = (x, z) => Math.hypot(x - area.cx, z - area.cz) < area.r - 8;
  // ---- routes: A* over a grid of 4 m cells; a cell is free when its centre and its four corners can be stood on (about
  // 4 m clear of a wall), the route is then pulled straight where the straight line is free
  const CELL = 4, okMemo = new Map(); let lastRoute = 0;
  const cellOK = (i, j) => {
    const k = (i + 4096) * 8192 + (j + 4096); let v = okMemo.get(k); if (v !== undefined) return v;
    const x = i * CELL + CELL / 2, z = j * CELL + CELL / 2, h = 1.8;
    v = inArea(x, z) && world.walkable(x, z) && world.walkable(x + h, z + h) && world.walkable(x - h, z + h) && world.walkable(x + h, z - h) && world.walkable(x - h, z - h); okMemo.set(k, v); return v;
  };
  const lineFree = (x0, z0, x1, z1) => { const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 2); for (let i = 1; i < n; i++) if (!world.walkable(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n)) return false; return true; };
  function nearestFree(i, j) { if (cellOK(i, j)) return [i, j]; for (let r = 1; r <= 4; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && cellOK(i + di, j + dj)) return [i + di, j + dj]; return null; }
  function route(sx, sz, gx, gz) {   // a list of points [x, z] from here to the goal, or null
    const s0 = nearestFree(Math.floor(sx / CELL), Math.floor(sz / CELL)), g0 = nearestFree(Math.floor(gx / CELL), Math.floor(gz / CELL)); if (!s0 || !g0) return null;
    const key = (i, j) => (i + 4096) * 8192 + (j + 4096), heap = [], gs = new Map(), from = new Map(), closed = new Set();
    const push = (f, i, j) => { heap.push([f, i, j]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { let l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const hh = (i, j) => Math.hypot(i - g0[0], j - g0[1]); gs.set(key(s0[0], s0[1]), 0); push(hh(s0[0], s0[1]), s0[0], s0[1]);
    let n = 0, found = false;
    while (heap.length && n++ < 60000) {
      const [, i, j] = pop(), k = key(i, j); if (closed.has(k)) continue; closed.add(k);
      if (i === g0[0] && j === g0[1]) { found = true; break; }
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (!cellOK(ni, nj) || (di && dj && (!cellOK(i + di, j) || !cellOK(i, j + dj)))) continue;
        const nk = key(ni, nj), ng = gs.get(k) + (di && dj ? 1.41 : 1); if (ng < (gs.get(nk) ?? 1e9)) { gs.set(nk, ng); from.set(nk, k); push(ng + hh(ni, nj), ni, nj); }
      }
    }
    if (!found) return null;
    const cells = []; let k = key(g0[0], g0[1]); while (k !== undefined) { cells.push([(Math.floor(k / 8192) - 4096) * CELL + CELL / 2, ((k % 8192) - 4096) * CELL + CELL / 2]); k = from.get(k); }
    cells.reverse(); const out = []; let at = [sx, sz], idx = 0;   // pulled straight: from where we stand, jump to the farthest point that can be walked to in a line
    while (idx < cells.length) { let far = idx; for (let t = cells.length - 1; t > idx; t--) if (lineFree(at[0], at[1], cells[t][0], cells[t][1])) { far = t; break; } out.push(cells[far]); at = cells[far]; idx = far + 1; }
    return out;
  }
  function waypoint(p) {   // somewhere to walk: mostly towards the enemy half of the arena, sometimes anywhere
    for (let k = 0; k < 24; k++) {
      let x, z;
      const hunt = !g.enemyBase(p) && Math.random() < 0.7 && [...g.players.values()].filter(q => q !== p && q.alive && (g.FFA || q.team !== p.team));   // no bases: go where an enemy is
      if (hunt && hunt.length) { const q = hunt[Math.floor(Math.random() * hunt.length)]; x = q.x + rnd(-50, 50); z = q.z + rnd(-50, 50); }
      else if (Math.random() < 0.6 && g.enemyBase(p)) { const b = g.enemyBase(p); x = b[0] + rnd(-90, 90); z = b[1] + rnd(-90, 90); }
      else { const a = rnd(0, 6.283), r = Math.sqrt(Math.random()) * (area.r - 30); x = area.cx + Math.cos(a) * r; z = area.cz + Math.sin(a) * r; }
      if (inArea(x, z) && world.walkable(x, z)) return [x, z];
    }
    return [p.x, p.z];
  }
  // a step towards (hx, hz) at speed v: the heading is turned aside until the point ahead can be stood on
  function walk(p, hx, hz, v, dt) {
    const b = p.bot, want = Math.atan2(hz - p.z, hx - p.x);
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4]) {
      const a = want + off, nx = p.x + Math.cos(a) * v * dt * 2.5, nz = p.z + Math.sin(a) * v * dt * 2.5;
      if (world.walkable(nx, nz) && inArea(nx, nz)) { p.x += Math.cos(a) * v * dt; p.z += Math.sin(a) * v * dt; b.moving = true; return; }
    }
    b.moving = false;
  }
  function visible(p, q) {
    const dx = q.x - p.x, dz = q.z - p.z, dy = (q.y - 0.5) - p.y, d = Math.hypot(dx, dy, dz);
    return d < b0(p).sight && world.freePath([p.x, p.y, p.z], [dx / d, dy / d, dz / d], d) >= d - 1.5 ? d : 0;
  }
  const b0 = p => LEVELS[p.bot.level] || LEVELS.normal;
  function think(p, dt) {
    const b = p.bot, L = b0(p), now = g.now();
    if (!p.alive) {   // back to the game after the respawn time
      if (!g.roundOver() && now - p.diedAt >= g.R.respawnMs + b.respawnExtra) { g.spawn(p); b.target = 0; b.path = null; b.respawnExtra = rnd(0, 2500); }
      return;
    }
    if (g.roundOver()) return;
    if (b.kx || b.kz) {   // the blast knockback (explode in game.mjs): a decaying slide away from the explosion, over the bot's own walk
      const nx = p.x + b.kx * dt, nz = p.z + b.kz * dt;
      if (world.walkable(nx, nz) && inArea(nx, nz)) { p.x = nx; p.z = nz; } else { b.kx = b.kz = 0; }
      const kd = Math.exp(-5 * dt); b.kx *= kd; b.kz *= kd;
      if (Math.hypot(b.kx, b.kz) < 0.05) b.kx = b.kz = 0;
    }
    // look for the nearest enemy that can be seen (not every tick)
    if ((b.look -= dt) <= 0) {
      b.look = 0.25; let best = 0, bd = 1e9;
      for (const q of g.players.values()) { if (q === p || !q.alive || (!g.FFA && q.team === p.team) || now <= q.protectUntil) continue; const d = visible(p, q); if (d && d < bd) { bd = d; best = q.id; } }
      if (best !== b.target) { b.target = best; if (best) b.react = now + L.react * 1000 * rnd(0.7, 1.3); }
    }
    const q = b.target && g.players.get(b.target);
    if (q && !q.alive) b.target = 0;
    const speed = (q ? 3 : 6) * (b.retreatUntil > now ? 1.6 : 1);
    let aimYaw = p.yaw, aimPitch = 0, dist = 0;
    if (q && b.target) {
      b.path = null;   // after the fight a new route from the new place
      const dx = q.x - p.x, dz = q.z - p.z; dist = Math.hypot(dx, dz); aimYaw = Math.atan2(-dx, -dz); aimPitch = Math.atan2((q.y - 0.4) - p.y + bulletDrop(dist, (g.WEAPONS[p.wep] || {}).vel || 560, (g.WEAPONS[p.wep] || {}).drag || 0), dist);   // the barrel looks above the target by the bullet's drop
      if (b.retreatUntil > now) { walk(p, p.x - dx, p.z - dz, speed, dt); }   // away from the enemy
      else {
        const want = p.wep === 1 ? 8 : p.wep === 2 ? 90 : 28;   // the distance the weapon likes
        if (dist > want + 8) walk(p, q.x, q.z, speed, dt); else if (dist < want - 8) walk(p, p.x - dx, p.z - dz, speed, dt);
        else { if ((b.strafeT -= dt) <= 0) { b.strafeT = rnd(0.8, 2); b.strafe = -b.strafe; } walk(p, p.x + (-dz / dist) * b.strafe * 10, p.z + (dx / dist) * b.strafe * 10, speed * 0.9, dt); }
      }
      if (p.hp < 35 && b.retreatUntil < now && Math.random() < 0.02) b.retreatUntil = now + 3000;
    } else {   // roam
      const stale = !b.path || b.pi >= b.path.length || now - b.wpAt > 60000;
      if (stale && now - lastRoute >= 45) { lastRoute = now; b.path = null; for (let k = 0; k < 4 && !b.path; k++) b.path = route(p.x, p.z, ...waypoint(p)); b.pi = 0; b.wpAt = now; }   // one route a tick for all the bots: no hitch at the start
      const nx = b.path && b.path[b.pi]; if (nx) { walk(p, nx[0], nx[1], speed, dt); if (Math.hypot(nx[0] - p.x, nx[1] - p.z) < 3) b.pi++; if (b.moving) aimYaw = Math.atan2(-(nx[0] - p.x), -(nx[1] - p.z)); }
      aimPitch = 0;
      if ((b.stuckT -= dt) <= 0) { b.stuckT = 1.5; if (Math.hypot(p.x - b.sx, p.z - b.sz) < 0.6) b.path = null; b.sx = p.x; b.sz = p.z; }
    }
    // turn towards where we look, at the speed of the level
    let dy = aimYaw - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const step = L.turn * dt; p.yaw += Math.max(-step, Math.min(step, dy)); p.pitch += (aimPitch - p.pitch) * Math.min(1, dt * 6);
    // the ground under the feet: a slope is walked as before, but an edge (or a blast's kick up) is a real fall with
    // gravity, and a landing from above the safe height hurts (g.fall — the same rule as for the players)
    const gNow = world.ground(p.x, p.z); let feet = p.y - 1.7, landed = 0;
    if (b.vy || feet - gNow > 0.5 + 12 * dt) {
      b.fallTop = Math.max(b.fallTop || feet, feet);
      b.vy = (b.vy || 0) - FALL.g * dt; feet += b.vy * dt;
      if (feet <= gNow) { landed = Math.max(0, b.fallTop - gNow); feet = gNow; b.vy = 0; b.fallTop = 0; }
    } else { feet = gNow; b.vy = 0; b.fallTop = 0; }
    p.y = feet + 1.7; p.eye = 1.7;
    p.fallTop = Math.max(p.fallTop ?? p.y, p.y);
    if (landed > FALL.safe) g.fall(p, landed);
    p.hist.push([now, p.x, p.y, p.z, p.eye, p.yaw]); while (p.hist.length > 2 && now - p.hist[0][0] > 1000) p.hist.shift();
    if (!(q && b.target) || now < b.react || Math.abs(dy) > 0.25) return;
    fight(p, q, dist, now, L);
  }
  function fight(p, q, dist, now, L) {
    const b = p.bot;
    // the weapon of the distance: a shotgun close, the sniper rifle far, otherwise the rifle (the machine gun at the hard level in the middle)
    const w = dist < 11 ? 1 : dist > 105 ? 2 : (L === LEVELS.hard && dist > 35 && dist < 75) ? 4 : 0; p.wep = w;
    if (L.nades && p.nades > 0 && dist > 12 && dist < 26 && Math.random() < L.nades) { const d = [q.x - p.x, 0.28 * dist / 20, q.z - p.z], l = Math.hypot(...d); g.throwNade(p, d.map(x => x / l)); return; }
    if (now < b.pauseUntil || now < b.nextShot) return;
    const W = g.WEAPONS[w], aimY = q.y - (Math.random() < L.head ? HIT.headDrop : 0.56 * (q.eye / 1.7));   // the head centre, otherwise the chest (lower on a crouched target)
    const dx = q.x - p.x, dz = q.z - p.z, dy2 = aimY - p.y, d3 = Math.hypot(dx, dy2, dz), sig = L.sigma * (b.moving ? 1.3 : 1) * (w === 2 ? 0.5 : 1) * (1 + dist / 150);   // the hit is judged at the click (the bullet only delays the damage), so no lead is needed — but the bullet falls, so the aim is lifted by its drop
    const hold = bulletDrop(d3, W.vel || 560, W.drag || 0);   // the same arc the server flies (combat.mjs, drag included): aim this much above the target
    const rays = [];
    for (let i = 0; i < W.pellets; i++) {
      const e1 = gauss() * sig + (W.pellets > 1 ? gauss() * 0.03 : 0), e2 = gauss() * sig + (W.pellets > 1 ? gauss() * 0.03 : 0);
      const yaw = Math.atan2(-dx, -dz) + e1, pitch = Math.asin(Math.max(-1, Math.min(1, (dy2 + hold) / d3))) + e2, cp = Math.cos(pitch);
      rays.push([-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp, d3, q.id]);
    }
    g.shoot(p, w, rays, 0);
    b.nextShot = now + W.gapMs * (W.auto === false ? 1.3 : 1.1) + (w === 2 ? 400 : 0);
    if (--b.burstLeft <= 0) { b.burstLeft = Math.round(rnd(L.burst[0], L.burst[1])); b.pauseUntil = now + L.pause * 1000 * rnd(0.6, 1.4); }
  }
  const make = (level, p) => { p.bot = { level: LEVELS[level] ? level : 'normal', target: 0, react: 0, look: rnd(0, 0.25), nextShot: 0, pauseUntil: 0, burstLeft: 3, path: null, pi: 0, wpAt: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1, stuckT: 1.5, sx: 0, sz: 0, moving: false, retreatUntil: 0, respawnExtra: rnd(0, 2000), kx: 0, kz: 0, vy: 0, fallTop: 0 }; };
  return { think, make, route };
}
