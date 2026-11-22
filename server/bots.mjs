/* The training bots: players of the game with no connection, run by the server (or by the page, in the game against
   bots). Every bot sees what a player could see (an enemy within its sight and no house between), turns to it at the
   speed of its level, waits its reaction time, and fires in bursts with the error of its level; the server then judges
   its shots as it judges everybody's. It walks to waypoints round the arena, goes round houses and keeps out of the water.
   Each bot is born with a favourite gun (a role) and fights by it: a shotgunner rushes in, a sniper holds the far side
   and crouches, a gunner suppresses from the middle, a rifleman and a pistolero keep the middle distances. It keeps its
   distance, dances in a fight (irregular strafe, diagonal jukes, brief stops, a dodge hop now and then), falls back to
   cover when hurt or reloading a slow gun, crouches behind the wall and peeks out, chases an enemy that broke the line
   of sight to where it was last seen, turns on an unseen attacker that hit it, picks up the kits and ammo it needs,
   reloads when safe, throws a grenade at a cluster and comes back after the death by itself. */
import { FALL, HIT, INV, NADE, SMOKE, bulletDrop, smokeCore, smokeDepth } from './combat.mjs';
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

// ---- the guns and how each is fought (indices of WEAPONS: 0 rifle, 1 shotgun, 2 sniper, 3 pistol, 4 machine gun,
// 5 M4A1, 6 SCAR-L, 7 AR-15)
// want: the distance the gun likes to keep; core: where it is at its best; outer: past this it is a poor choice.
const WANT = [28, 8, 90, 14, 55, 26, 32, 45];
const CORE = [[12, 90], [0, 14], [60, 250], [4, 25], [25, 90], [10, 85], [12, 95], [20, 140]];
const OUTER = [[4, 150], [0, 30], [35, 400], [0, 60], [10, 140], [4, 140], [5, 150], [8, 190]];
// how well the gun fits the distance: 1 in its core, fading to 0.08 at the outer edge and past it
function fit(w, d) {
  const [a, b] = CORE[w], [c, e] = OUTER[w];
  if (d >= a && d <= b) return 1;
  if (d < a) return d <= c ? 0.08 : 0.08 + 0.92 * (d - c) / Math.max(1e-6, a - c);
  return d >= e ? 0.08 : 0.08 + 0.92 * (e - d) / Math.max(1e-6, e - b);
}
// the role a bot is born with: its favourite gun. The level leans the mix — recruits favour the simple guns, veterans
// take the sniper and the machine gun more often. Everybody still carries and can fall back on every weapon.
function pickRole(level) {
  const r = Math.random();
  if (level === 'easy') return r < 0.4 ? 0 : r < 0.6 ? 1 : r < 0.75 ? 3 : r < 0.88 ? 5 : 4;
  if (level === 'hard') return r < 0.2 ? 0 : r < 0.35 ? 4 : r < 0.5 ? 2 : r < 0.62 ? 6 : r < 0.74 ? 7 : r < 0.86 ? 1 : r < 0.95 ? 5 : 3;
  return r < 0.28 ? 0 : r < 0.42 ? 1 : r < 0.54 ? 2 : r < 0.66 ? 4 : r < 0.78 ? 5 : r < 0.88 ? 6 : r < 0.96 ? 7 : 3;
}
// the metres a second the bot moves: a jog between fights, a sprint when the coast is clear, a measured step in one,
// a sprint away from danger; a crouched bot creeps at the player's own crouch speed (JUMP.crouchSpeed in src/game/player.js)
const SPD = { roam: 7.5, sprint: 10, approach: 5.5, strafe: 4.6, retreat: 9.5, crouch: 1.8 };
const JUMP_V = 6.4;   // the dodge hop lifts the bot at the player's own jump speed (JUMP.v), gravity FALL.g brings it down

// g: the game's own tools: players, now(), world (freePath, ground, walkable), area { cx, cz, r }, bases, FFA, WEAPONS,
// R, shoot(p, w, rays, lagMs), throwNade(p, dir), spawn(p), roundOver(), reload(p, w, t0), items (the map pickups)
export function createBrain(g) {
  const { world, area } = g;
  // the storm of the match (game.mjs) opens the whole field to the bots of the open city: they follow the circle wherever
  // its final point lies; an arena keeps its edge (the circle lies inside it)
  const roam = () => !!(g.field && g.storm);
  let roamMemo = false;
  const inArea = (x, z) => roam() || Math.hypot(x - area.cx, z - area.cz) < area.r - 8;
  // ---- routes: A* over a grid of 4 m cells; a cell is free when its centre and its four corners can be stood on (about
  // 4 m clear of a wall), the route is then pulled straight where the straight line is free
  const CELL = 4, okMemo = new Map(); let lastRoute = 0;
  const cellOK = (i, j) => {
    if (okMemo.size > 200000) okMemo.clear();   // the storm roams the whole city: the memo must not grow without bound
    if (roam() !== roamMemo) { roamMemo = roam(); okMemo.clear(); }   // the storm opened (or closed) the field: the cells are judged anew
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
  const lowAmmo = p => p.reserve[p.wep] <= 0 || p.reserve.reduce((a, b) => a + b, 0) < 40;
  // a pickup the bot wants and can reach: a kit when hurt and the belt not full, ammo when dry, a grenade when the belt
  // is short, a smoke when it has none to cover a retreat with. The nearest within 45 m.
  function needItem(p) {
    if (!g.items) return null; let best = null, bd = 1e9;
    for (const it of g.items.values()) {
      if (!it.active) continue;
      const want = (it.kind === 'med' && p.hp < 65 && p.meds < INV.medMax) || (it.kind === 'ammo' && lowAmmo(p)) || (it.kind === 'nade' && p.nades < INV.nadeMax) || (it.kind === 'smoke' && !(p.smokes > 0));
      if (!want) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < 45 && d < bd && inArea(it.x, it.z) && world.walkable(it.x, it.z)) { bd = d; best = [it.x, it.z]; }
    }
    return best;
  }
  function waypoint(p) {   // somewhere to walk: mostly towards the enemy half of the arena, sometimes anywhere
    const sz = g.storm;
    if (sz) {   // the storm: roam inside the next circle (it lies inside the safe one), towards its middle — the fight comes to you
      const c = sz.next || sz;
      for (let k = 0; k < 24; k++) { const a = rnd(0, 6.283), r = Math.sqrt(Math.random()) * Math.max(8, c.r * 0.75), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (inArea(x, z) && world.walkable(x, z)) return [x, z]; }
      return [c.x, c.z];
    }
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
  // a walkable spot near the bot that the threat at (tx, tz) cannot see: a wall between. The nearest ring first, so the
  // bot ducks behind the closest cover rather than running far. null when nothing hides it (an open square).
  function findCover(p, tx, tz) {
    const te = world.ground(tx, tz) + 1.6;
    for (const r of [5, 10, 15]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 6.283 + (p.id % 8) * 0.4;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (!inArea(x, z) || !world.walkable(x, z) || !lineFree(p.x, p.z, x, z)) continue;
        const ce = world.ground(x, z) + 1.6, dx = x - tx, dy = ce - te, dz = z - tz, d = Math.hypot(dx, dy, dz);
        if (d < 6) continue;   // not right next to the enemy
        if (world.freePath([tx, te, tz], [dx / d, dy / d, dz / d], d) < d - 1) return [x, z];
      }
    }
    return null;
  }
  // the gun for the distance and the bot's role, with ammo. The role is preferred (×2) and the gun in hand is kept a
  // little longer (×1.2) so the choice does not flicker at a band edge; a switch takes a moment (switchAt). A dry gun
  // is dropped at once for one that has rounds.
  function selectWeapon(p, dist, now) {
    const b = p.bot, ammo = w => p.mag[w] > 0 || p.reserve[w] > 0;
    // the gun in hand must be one of the two equipped: if a role or a test put a pack gun there, pull it into a slot first
    if (!p.loadout.includes(p.wep)) g.equip(p, p.wep);
    let best = -1, bs = -1;
    for (let w = 0; w < g.WEAPONS.length; w++) {
      if (!ammo(w)) continue;
      const s = fit(w, dist) * (w === b.role ? 2 : 1) * (w === p.wep ? 1.2 : 1);
      if (s > bs) { bs = s; best = w; }
    }
    if (best >= 0 && best !== p.wep && now >= b.switchAt) {
      const dry = !ammo(p.wep);
      if (!p.loadout.includes(best)) {   // the better gun rides in the pack: exchange it with the slot the current gun holds
        const slot = p.loadout.indexOf(p.wep); if (slot >= 0) g.equip(p, best);   // equip drops the old gun into the pack cell best left
      }
      p.wep = best; b.switchAt = now + (dry ? 250 : 420 + rnd(0, 180));   // a dry gun is dropped quicker
    }
  }
  // a step towards (hx, hz) at speed v: the heading is turned aside until the point ahead can be stood on. Bodies pressed
  // against the bot nudge it apart so a squad does not stack into one man; the wider offsets let it slip round a corner.
  function walk(p, hx, hz, v, dt) {
    const b = p.bot; let sx = 0, sz = 0;
    for (const q of g.players.values()) {
      if (q === p || !q.alive) continue;
      const dx = p.x - q.x, dz = p.z - q.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.44 && d2 > 1e-6) { const d = Math.sqrt(d2); sx += dx / d * (1.2 - d); sz += dz / d * (1.2 - d); }
    }
    hx += sx * 2; hz += sz * 2;
    const want = Math.atan2(hz - p.z, hx - p.x);
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, 3, -3]) {
      const a = want + off, nx = p.x + Math.cos(a) * v * dt * 2.5, nz = p.z + Math.sin(a) * v * dt * 2.5;
      if (world.walkable(nx, nz) && inArea(nx, nz)) { p.x += Math.cos(a) * v * dt; p.z += Math.sin(a) * v * dt; b.moving = true; return; }
    }
    b.moving = false;
  }
  // a smoke screen between the eyes hides what is beyond it: the sight line goes through SMOKE.hide metres or more of
  // the screens' dense cores as they stand now (smokeCore of combat.mjs — the page draws the same screen, src/game/nades.js,
  // and hides the name tags by the same rule). A bot inside the screen is as blind as one looking into it
  function smokeCores(now) {
    const out = [];
    for (const z of g.zones.values()) {
      if (z.kind !== 'smoke') continue;
      const c = smokeCore(z.r, now - (z.t0 ?? now), z.dur ?? SMOKE.durMs);
      if (c) out.push({ x: z.x, y: z.y, z: z.z, rc: c.rc, hc: c.hc });
    }
    return out;
  }
  const smoked = (cores, ax, ay, az, bx, by, bz) => cores.length > 0 && smokeDepth(cores, [ax, ay, az], [bx, by, bz]) >= SMOKE.hide;
  // the burning patch under the bot's feet, if any (napalm, game.mjs stepZones)
  function fireAt(p) {
    for (const z of g.zones.values()) if (z.kind === 'fire' && Math.hypot(p.x - z.x, p.z - z.z) < z.r + 0.5 && Math.abs((p.y - 1.7) - z.y) < 2.5) return z;
    return null;
  }
  function visible(p, q, cores = smokeCores(g.now())) {
    const dx = q.x - p.x, dz = q.z - p.z, dy = (q.y - 0.5) - p.y, d = Math.hypot(dx, dy, dz);
    return d < b0(p).sight && world.freePath([p.x, p.y, p.z], [dx / d, dy / d, dz / d], d) >= d - 1.5 && !smoked(cores, p.x, p.y, p.z, q.x, q.y - 0.5, q.z) ? d : 0;
  }
  const b0 = p => LEVELS[p.bot.level] || LEVELS.normal;
  const safeReload = (p, now) => { if (g.reload && p.reloadDone <= now && p.mag[p.wep] < g.WEAPONS[p.wep].mag * 0.4 && p.reserve[p.wep] > 0) g.reload(p, p.wep, now); };
  function think(p, dt) {
    const b = p.bot, L = b0(p), now = g.now();
    if (!p.alive) {   // back to the game after the respawn time, the favourite gun in hand again
      if (g.storm) return;   // the storm does not respawn: the fallen wait for the next match
      if (!g.roundOver() && now - p.diedAt >= g.R.respawnMs + b.respawnExtra) { g.spawn(p); b.target = 0; b.path = null; b.cover = null; b.lastSeen = null; b.alert = null; g.equip(p, b.role); p.wep = b.role; b.switchAt = now + 400; b.lastHp = p.hp; b.respawnExtra = rnd(0, 2500); }
      return;
    }
    if (g.roundOver()) return;
    if (b.kx || b.kz) {   // the blast knockback (explode in game.mjs): a decaying slide away from the explosion, over the bot's own walk
      const nx = p.x + b.kx * dt, nz = p.z + b.kz * dt;
      if (world.walkable(nx, nz) && inArea(nx, nz)) { p.x = nx; p.z = nz; } else { b.kx = b.kz = 0; }
      const kd = Math.exp(-5 * dt); b.kx *= kd; b.kz *= kd;
      if (Math.hypot(b.kx, b.kz) < 0.05) b.kx = b.kz = 0;
    }
    const fz = fireAt(p);
    if (fz) {   // napalm underfoot: run out of the fire before anything else — the fight waits
      const dx = p.x - fz.x, dz = p.z - fz.z, d = Math.hypot(dx, dz) || 1;
      walk(p, p.x + dx / d * 12, p.z + dz / d * 12, SPD.retreat, dt);
      p.yaw = Math.atan2(-dx / d, -dz / d);
      b.path = null; b.cover = null; b.target = 0;
      return;
    }
    // the storm outside the safe circle: run in before anything else — the fight waits (the «Шторм» event, storm.mjs)
    const sz = g.storm;
    const stormRun = !!sz && Math.hypot(p.x - sz.x, p.z - sz.z) > sz.r * 0.9;
    if (stormRun) { b.target = 0; b.cover = null; b.alertCover = null; b.crouch = false; }
    // a hit taken: remember the moment (the dodge hop comes sooner), snap the strafe the other way, and turn on an
    // attacker we cannot see — hurtFrom is written by the game when the blow lands (hurt in game.mjs)
    if (b.lastHp == null) b.lastHp = p.hp;   // make() runs before the first spawn (hp 0): take the real hp on the first think
    if (p.hp < b.lastHp) {
      b.hurtAt = now; b.strafe = -b.strafe;
      if (b.hurtFrom && b.hurtFrom.id !== b.target && now - b.hurtFrom.at < 600) b.alert = { x: b.hurtFrom.x, z: b.hurtFrom.z, at: now };
    }
    b.lastHp = p.hp;
    // look for the nearest enemy that can be seen (not every tick); remember where it was last seen to chase it round a corner
    if (!stormRun && (b.look -= dt) <= 0) {   // the storm run ignores the fight: the circle first
      b.look = 0.25; let best = 0, bd = 1e9, markedAt = null; const cores = smokeCores(now);
      for (const q of g.players.values()) {
        if (q === p || !q.alive || (!g.FFA && q.team === p.team) || now <= q.protectUntil) continue;
        if (q.markUntil > now) {   // the cargo carrier is marked for everyone: the position is known even through walls
          const dm = Math.hypot(q.x - p.x, q.z - p.z);
          if (dm < L.sight * 1.8) markedAt = { x: q.x, z: q.z, at: now };
          const d = visible(p, q, cores); if (d && d * 0.5 < bd) { bd = d * 0.5; best = q.id; }   // in sight: the mark doubles the priority
          continue;
        }
        const d = visible(p, q, cores); if (d && d < bd) { bd = d; best = q.id; }
      }
      if (markedAt) b.lastSeen = markedAt;   // the mark tells where the carrier is: chase it round the corners
      if (best !== b.target) { b.target = best; if (best) b.react = now + L.react * 1000 * rnd(0.7, 1.3) * (b.alert && now - b.alert.at < 2200 ? 0.5 : 1); }   // an alerted bot snaps round quicker
    }
    const q = b.target && g.players.get(b.target);
    if (q && !q.alive) b.target = 0;
    const engaged = !!(q && b.target);
    if (engaged || (b.alert && now - b.alert.at < 2200)) b.threatAt = now;
    let aimYaw = p.yaw, aimPitch = 0, dist = 0;
    if (stormRun) {   // the sprint into the circle: the route is chained (A* reaches ~600 m), the walk slips round the houses
      const dx = sz.x - p.x, dz = sz.z - p.z, d = Math.hypot(dx, dz) || 1;
      const gx = sz.x - dx / d * sz.r * 0.5, gz = sz.z - dz / d * sz.r * 0.5;   // the goal: well inside, on our side of the middle
      if (!b.path || b.pi >= b.path.length || now - (b.stormRouteAt || 0) > 2500) {
        b.stormRouteAt = now; b.path = null; b.pi = 0;
        const far = d > 600, tx = far ? p.x + dx / d * 500 : gx, tz = far ? p.z + dz / d * 500 : gz;
        if (now - lastRoute >= 45) { lastRoute = now; b.path = route(p.x, p.z, tx, tz); }
      }
      const nx = b.path && b.path[b.pi];
      const hx = nx ? nx[0] : gx, hz = nx ? nx[1] : gz;
      walk(p, hx, hz, SPD.sprint, dt);
      if (nx && Math.hypot(nx[0] - p.x, nx[1] - p.z) < 3) b.pi++;
      aimYaw = Math.atan2(-(hx - p.x), -(hz - p.z)); aimPitch = 0;
      safeReload(p, now);
    } else if (engaged) {
      b.path = null;   // after the fight a new route from the new place (the cover is kept while we fall back to it)
      const dx = q.x - p.x, dz = q.z - p.z; dist = Math.hypot(dx, dz);
      b.lastSeen = { x: q.x, z: q.z, at: now };
      selectWeapon(p, dist, now);
      aimYaw = Math.atan2(-dx, -dz); aimPitch = Math.atan2((q.y - 0.4) - p.y + bulletDrop(dist, (g.WEAPONS[p.wep] || {}).vel || 560, (g.WEAPONS[p.wep] || {}).drag || 0), dist);   // the barrel looks above the target by the bullet's drop
      // fall back to cover when hurt, or when a slow gun is reloading with the enemy close: duck behind a wall, crouch,
      // reload and heal, then come back out. With no cover nearby it is the old straight retreat.
      if (b.retreatUntil < now && ((p.hp < 35 && Math.random() < 0.02) || (p.reloadDone > now && dist < 40 && (p.wep === 2 || p.wep === 4)))) {
        b.retreatUntil = now + (p.hp < 35 ? 3000 : 2500); b.retreatAt = now; b.cover = findCover(p, q.x, q.z);
        if (p.hp < 35) coverSmoke(p, q, dist, now, L);
      }
      if (b.retreatUntil > now) {
        if (b.cover) {
          walk(p, b.cover[0], b.cover[1], SPD.retreat, dt);
          b.crouch = Math.hypot(b.cover[0] - p.x, b.cover[1] - p.z) < 2.5;   // crouched behind the wall
          if (b.crouch) safeReload(p, now);
          if (p.hp >= 55 && p.reloadDone <= now && now - b.retreatAt > 1200) b.retreatUntil = now;   // recovered and loaded: peek back out
        } else { walk(p, p.x - dx, p.z - dz, SPD.retreat, dt); b.crouch = false; }
      } else {
        b.cover = null;   // back in the fight: the cover is left behind
        const want = WANT[p.wep];
        if (dist > want + 8) {   // close in — from an angle when far, so a squad spreads round the target instead of conga-lining into it
          b.crouch = false;
          let hx = q.x, hz = q.z;
          if (dist > want + 22) {
            if ((b.flankT -= dt) <= 0) { b.flankT = rnd(3, 6); b.flankSide = Math.random() < 0.5 ? 1 : -1; }
            const px = -dz / dist, pz = dx / dist, off = Math.min(20, dist * 0.3) * b.flankSide;
            hx = q.x + px * off; hz = q.z + pz * off;
            if (!lineFree(p.x, p.z, hx, hz) && now - lastRoute >= 45) { lastRoute = now; const r = route(p.x, p.z, hx, hz); if (r && r.length) { hx = r[0][0]; hz = r[0][1]; } }
          }
          walk(p, hx, hz, SPD.approach, dt);
        } else if (dist < want - 8) { b.crouch = false; walk(p, p.x - dx, p.z - dz, SPD.approach, dt); }
        else {   // at the gun's distance: dance. The sniper and the gunner hold and crouch to steady the aim, the rest juke
          const hold = p.wep === 2 || p.wep === 4;
          b.crouch = hold && dist > (p.wep === 2 ? 45 : 48);
          if ((b.strafeT -= dt) <= 0) { b.strafeT = rnd(0.5, 1.6); b.strafe = -b.strafe; }
          // the footwork mode changes on its own clock: mostly lateral, sometimes a diagonal step in or out, sometimes a
          // brief stop to steady the shot — never the same metronome slide
          if ((b.danceT -= dt) <= 0) {
            b.danceT = rnd(0.45, 1.3);
            const r = Math.random(), inW = p.wep === 1 ? 0.4 : 0.18, outW = p.wep === 2 ? 0.08 : 0.17, stopW = p.wep === 2 ? 0.3 : 0.1;
            b.dance = r < stopW ? 3 : r < stopW + inW ? 1 : r < stopW + inW + outW ? 2 : 0;
          }
          const px = -dz / dist, pz = dx / dist, rx = dx / dist, rz = dz / dist;
          const sf = p.wep === 2 ? 0.35 : p.wep === 4 ? 0.5 : p.wep === 1 ? 1.2 : 1;
          const sv = (b.crouch ? SPD.crouch : SPD.strafe) * sf;
          if (b.dance === 3 && !b.crouch) b.moving = false;   // a planted shot: still, and steadier for it
          else {
            const radial = b.dance === 1 ? 5 : b.dance === 2 ? -5 : 0;
            walk(p, p.x + px * b.strafe * 10 + rx * radial, p.z + pz * b.strafe * 10 + rz * radial, sv, dt);
          }
          // a dodge hop now and then — sooner when just hit, rarely for a planted sniper: the player's own jump, the
          // gravity below brings it down, the page shows the air pose. A crouched gunner stands up into the hop.
          const hopW = (p.wep === 2 ? 0.3 : p.wep === 4 ? 0.6 : 1) * (now - b.hurtAt < 1200 ? 0.04 : 0.012);
          if (!b.vy && dist < 65 && now > b.jumpAt && Math.random() < hopW) { b.crouch = false; b.vy = JUMP_V; b.jumpAt = now + rnd(1800, 3800); }
        }
      }
    } else {   // no enemy in sight: turn on an unseen attacker, chase the last seen, pick up what is needed, otherwise roam
      b.crouch = false; b.cover = null;
      safeReload(p, now);
      if (b.alert && now - b.alert.at < 2200) {   // shot from somewhere we cannot see: face it and duck behind the nearest cover
        const ax = b.alert.x - p.x, az = b.alert.z - p.z; aimYaw = Math.atan2(-ax, -az);
        if (!b.alertCover) b.alertCover = findCover(p, b.alert.x, b.alert.z);
        if (b.alertCover) { walk(p, b.alertCover[0], b.alertCover[1], SPD.retreat, dt); b.crouch = Math.hypot(b.alertCover[0] - p.x, b.alertCover[1] - p.z) < 2.5; }
        else { const d = Math.hypot(ax, az) || 1; walk(p, p.x + (-az / d) * b.strafe * 10, p.z + (ax / d) * b.strafe * 10, SPD.strafe, dt); }
        aimPitch = 0;
      } else {
        b.alertCover = null;
        const stale = !b.path || b.pi >= b.path.length || now - b.wpAt > 60000;
        if (stale && now - lastRoute >= 45) {
          lastRoute = now; b.path = null;
          let goal = needItem(p);   // a kit or ammo first
          const cg = g.cargo;
          if (!goal && cg) {   // the supply drop draws the bots in: the bait of the event (the fight around the crate)
            const d = Math.hypot(cg.x - p.x, cg.z - p.z);
            if (cg.state === 'landed' ? d < 280 : d < 90) goal = [cg.x + rnd(-1.5, 1.5), cg.z + rnd(-1.5, 1.5)];
          }
          if (!goal && b.lastSeen && now - b.lastSeen.at < 6000) goal = [b.lastSeen.x, b.lastSeen.z];   // then where the enemy went
          for (let k = 0; k < 4 && !b.path; k++) { const t = k === 0 && goal ? goal : waypoint(p); b.path = route(p.x, p.z, t[0], t[1]); }
          b.pi = 0; b.wpAt = now;
        }
        const speed = now - b.threatAt > 5000 ? SPD.sprint : SPD.roam;   // a clear coast: a sprint; near a fight: a jog
        const nx = b.path && b.path[b.pi]; if (nx) { walk(p, nx[0], nx[1], speed, dt); if (Math.hypot(nx[0] - p.x, nx[1] - p.z) < 3) b.pi++; if (b.moving) aimYaw = Math.atan2(-(nx[0] - p.x), -(nx[1] - p.z)); }
        aimPitch = 0;
        if ((b.stuckT -= dt) <= 0) { b.stuckT = 1.5; if (Math.hypot(p.x - b.sx, p.z - b.sz) < 0.6) b.path = null; b.sx = p.x; b.sz = p.z; }
      }
    }
    // turn towards where we look, at the speed of the level
    let dy = aimYaw - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const step = L.turn * dt; p.yaw += Math.max(-step, Math.min(step, dy)); p.pitch += (aimPitch - p.pitch) * Math.min(1, dt * 6);
    // the ground under the feet: a slope is walked as before, but an edge (or a blast's kick up, or a dodge hop) is a
    // real fall with gravity, and a landing from above the safe height hurts (g.fall — the same rule as for the players).
    // A crouch lowers the eyes (1.1 m, the player's JUMP.eyeCrouch); a fall stands the bot back up.
    const gNow = world.ground(p.x, p.z); let feet = p.y - (p.eye || 1.7), landed = 0;
    if (b.vy || feet - gNow > 0.5 + 12 * dt) {
      b.crouch = false;
      b.fallTop = Math.max(b.fallTop || feet, feet);
      b.vy = (b.vy || 0) - FALL.g * dt; feet += b.vy * dt;
      if (feet <= gNow) { landed = Math.max(0, b.fallTop - gNow); feet = gNow; b.vy = 0; b.fallTop = 0; }
    } else { feet = gNow; b.vy = 0; b.fallTop = 0; }
    p.eye = b.crouch ? 1.1 : 1.7;
    p.y = feet + p.eye;
    p.fallTop = Math.max(p.fallTop ?? p.y, p.y);
    if (landed > FALL.safe) g.fall(p, landed);
    p.hist.push([now, p.x, p.y, p.z, p.eye, p.yaw]); while (p.hist.length > 2 && now - p.hist[0][0] > 1000) p.hist.shift();
    if (!engaged || now < b.react || Math.abs(dy) > 0.25) return;
    fight(p, q, dist, now, L);
  }
  // a hurt bot falling back covers itself with a smoke (the normal and hard levels, if it has one): thrown towards the
  // enemy so that it lands a little under half the way there, the screen between them while the bot runs for cover.
  // The flight is the server's (g 18, loft 0.17): aimed 20° up, a throw of speed sp carries ≈ 0.053·sp² metres
  function coverSmoke(p, q, dist, now, L) {
    if (!L.nades || !(p.smokes > 0) || dist < 8 || dist > 55 || now - p.lastNade < NADE.cooldownMs) return false;
    const X = Math.min(14, dist * 0.42), sp = Math.max(NADE.minSpeed, Math.min(NADE.maxSpeed, Math.sqrt(X / 0.053) * 0.9));   // short of the mark: it bounces on
    const dx = (q.x - p.x) / dist, dz = (q.z - p.z) / dist, l = Math.hypot(1, 0.36);
    g.throwNade(p, [dx / l, 0.36 / l, dz / l], sp, 'smoke');
    return true;
  }
  function fight(p, q, dist, now, L) {
    const b = p.bot, w = p.wep, W = g.WEAPONS[w];
    if (now < b.switchAt) return;   // still bringing the new gun up
    // a grenade at a cluster of enemies (or now and then at one), never into one's own feet
    if (L.nades && p.nades > 0 && dist > 10 && dist < 28 && now - p.lastNade > NADE.cooldownMs) {
      let cluster = 0; for (const r of g.players.values()) if (r !== p && r.alive && (g.FFA || r.team !== p.team) && Math.hypot(r.x - q.x, r.z - q.z) < 6) cluster++;
      if (cluster >= 2 || Math.random() < L.nades * 3) { const d = [q.x - p.x, 0.28 * dist / 20, q.z - p.z], l = Math.hypot(...d); g.throwNade(p, d.map(x => x / l)); return; }
    }
    if (now < b.pauseUntil || now < b.nextShot) return;
    const aimY = q.y - (Math.random() < L.head ? HIT.headDrop : 0.56 * (q.eye / 1.7));   // the head centre, otherwise the chest (lower on a crouched target)
    const dx = q.x - p.x, dz = q.z - p.z, dy2 = aimY - p.y, d3 = Math.hypot(dx, dy2, dz);
    // the hit is judged at the click (the bullet only delays the damage), so no lead is needed — but the bullet falls, so
    // the aim is lifted by its drop. Crouching steadies it, moving and a dodge hop spoil it; the machine gun is hard to hold on the move.
    const sig = L.sigma * (b.moving ? 1.3 : 1) * (b.crouch ? 0.6 : 1) * (b.vy ? 1.6 : 1) * (w === 2 ? 0.5 : 1) * (w === 4 && b.moving ? 1.2 : 1) * (1 + dist / 150);
    const hold = bulletDrop(d3, W.vel || 560, W.drag || 0);   // the same arc the server flies (combat.mjs, drag included): aim this much above the target
    const rays = [];
    for (let i = 0; i < W.pellets; i++) {
      const e1 = gauss() * sig + (W.pellets > 1 ? gauss() * 0.03 : 0), e2 = gauss() * sig + (W.pellets > 1 ? gauss() * 0.03 : 0);
      const yaw = Math.atan2(-dx, -dz) + e1, pitch = Math.asin(Math.max(-1, Math.min(1, (dy2 + hold) / d3))) + e2, cp = Math.cos(pitch);
      rays.push([-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp, d3, q.id]);
    }
    g.shoot(p, w, rays, 0);
    b.nextShot = now + W.gapMs * (W.auto === false ? 1.3 : 1.1) + (w === 2 ? 400 : 0);
    // the burst and the pause are the gun's: the sniper takes one or two measured shots, the shotgun a quick pair, the
    // machine gun a long burst, the rifle and the pistol the level's own
    const burstMul = w === 2 ? 0.35 : w === 1 ? 0.5 : w === 4 ? 2.5 : w === 3 ? 0.8 : 1;
    const pauseMul = w === 2 ? 1.6 : w === 1 ? 0.7 : w === 4 ? 0.6 : 1;
    if (--b.burstLeft <= 0) { b.burstLeft = Math.max(1, Math.round(rnd(L.burst[0], L.burst[1]) * burstMul)); b.pauseUntil = now + L.pause * 1000 * rnd(0.6, 1.4) * pauseMul; }
  }
  const make = (level, p) => {
    const lv = LEVELS[level] ? level : 'normal', role = pickRole(lv);
    g.equip(p, role); p.wep = role;   // born with the favourite gun equipped and in hand, so the variety shows from the first step
    p.bot = { level: lv, role, target: 0, react: 0, look: rnd(0, 0.25), nextShot: 0, pauseUntil: 0, burstLeft: 3, path: null, pi: 0, wpAt: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1, dance: 0, danceT: rnd(0.2, 1), stuckT: 1.5, sx: 0, sz: 0, moving: false, retreatUntil: 0, retreatAt: 0, respawnExtra: rnd(0, 2000), kx: 0, kz: 0, vy: 0, fallTop: 0, crouch: false, cover: null, alertCover: null, lastSeen: null, alert: null, hurtFrom: null, hurtAt: -1e9, lastHp: null, threatAt: -1e9, jumpAt: 0, flankSide: Math.random() < 0.5 ? 1 : -1, flankT: rnd(1, 4), switchAt: 0 };
  };
  return { think, make, route };
}