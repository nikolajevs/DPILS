/* The combat tests, no browser needed: node tools/combat-test.mjs (CI runs it after npm run check).
   1. The hitbox geometry (rayHit from server/combat.mjs): the zones, the crouch, the legs apart, the heading.
   2. The server rules (createGame over a fake flat world with a controlled clock): damage by zone, the shotgun,
      walls and hill slopes (the refined freePath), the spawn protection, teammates, and the lag compensation of
      the position, the eye height and the heading. The bullets fly (g.stepBullets drives them by the test clock),
      so each shot is given the time to reach its target before the hit is read.
   2c. The blast push (g.stepNades drives the fuse by the test clock): the explosion throws the living away and up,
      the push fades with distance, stops at walls, spares teammates and the dead; a bot slides on the server.
   3. A real bot fight on a flat arena (12 s of real time): with the small hitboxes the bots must still see,
      shoot and kill each other. */
import { HIT, WEAPONS, NADE, rayHit } from '../server/combat.mjs';
import { createGame } from '../server/game.mjs';
import { makePhysics } from '../server/physics.mjs';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' вЂ” ' + extra : '')); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* ---------- 1. the geometry ---------- */
console.log('hitbox geometry (rayHit):');
{
  const stand = { x: 0, y: 1.7, z: 0, eye: 1.7, yaw: 0 }, o = [0, 1.7, 20];
  const at = (tx, ty, tz) => { const dx = tx - o[0], dy = ty - o[1], dz = tz - o[2], l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l]; };
  const hit = (p, tx, ty, tz, len = 100) => rayHit(o, at(tx, ty, tz), len, p);
  ok(hit(stand, 0, 1.6, 0)?.zone === 1, 'the head centre is a head hit');
  ok(hit(stand, 0, 1.1, 0)?.zone === 0, 'the chest is a torso hit');
  ok(hit(stand, HIT.legOff, 0.4, 0)?.zone === 2, 'the leg is a leg hit');
  ok(hit(stand, 0, 0.4, 0) === null, 'between the legs the ray passes');
  ok(hit(stand, 0.45, 1.1, 0) === null, '0.45 m beside the chest misses (the old capsule hit)');
  ok(hit(stand, 0.2, 1.1, 0)?.zone === 0, '0.2 m beside the chest still hits');
  ok(hit(stand, 0, 2.0, 0) === null, 'above the head misses');
  ok(hit(stand, 0, 1.1, 0, 5) === null, 'a ray shorter than the distance misses');
  const crouch = { x: 0, y: 1.1, z: 0, eye: 1.1, yaw: 0 };
  ok(hit(crouch, 0, 1.0, 0)?.zone === 1, 'the crouched head is lower and still a head');
  ok(hit(crouch, 0, 1.6, 0) === null, 'the standing head height misses a crouched player');
  ok(hit(crouch, 0, 0.7, 0)?.zone === 0, 'the crouched torso is shorter');
  const turned = { x: 0, y: 1.7, z: 0, eye: 1.7, yaw: Math.PI / 2 };
  ok(hit(turned, 0, 0.4, HIT.legOff)?.zone === 2, 'the legs turn with the heading');
  ok(hit(turned, HIT.legOff, 0.4, 0) === null, 'the old leg line is now the gap');
}

/* ---------- the helpers for the game tests ---------- */
function flatWorld(buildingAt = () => null, ground = () => 0) {
  const phys = makePhysics(buildingAt, ground);
  return { ...phys, ground, buildingAt, walkable: (x, z) => !buildingAt(x, z) && ground(x, z) > -2 };
}
function conn() {
  const msgs = [];
  return { msgs, send: m => msgs.push(JSON.parse(m)), close() {}, last: t => [...msgs].reverse().find(m => m.t === t), all: t => msgs.filter(m => m.t === t) };
}
const msg = (c, m) => c.handle.message(JSON.stringify(m));
const seat = (g, c) => { c.handle = g.attach(c); return c; };
const base = (cx, cz, r) => [[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]];

/* ---------- 2. the server rules ---------- */
console.log('server rules (createGame, controlled clock):');
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'test' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'РЎС‚СЂРµР»РѕРє', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'РњРёС€РµРЅСЊ', team: 1, x: 0, z: -20, yaw: 0 });
  const bid = B.handle.player.id;
  ok(B.handle.player.team === 1, 'the second player got the other team');
  clock += 3000;   // past the spawn protection
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -20, yaw: 0, pitch: 0 });
  const aim = (tx, ty, tz) => { const dx = tx, dy = ty - 1.7, dz = tz, l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l, +l.toFixed(2), bid]; };
  const shootAt = (tx, ty, tz, w = 0) => { const n = A.all('hit').length; msg(A, { t: 'shoot', w, rays: [aim(tx, ty, tz)] }); clock += 120; g.stepBullets(); const h = A.all('hit'); return h.length > n ? h[h.length - 1] : null; };
  const hp = () => B.handle.player.hp;

  let h = shootAt(0, 1.6, -20);
  ok(h && h.head && h.zone === 1 && h.dmg === WEAPONS[0].head && hp() === 100 - WEAPONS[0].head, 'head shot: 40 damage', JSON.stringify(h));
  h = shootAt(0, 1.1, -20);
  ok(h && !h.head && h.dmg === WEAPONS[0].dmg && hp() === 100 - 40 - 22, 'torso shot: 22 damage', JSON.stringify(h));
  h = shootAt(HIT.legOff, 0.4, -20);
  ok(h && h.zone === 2 && h.dmg === Math.round(WEAPONS[0].dmg * HIT.legMul) && hp() === 100 - 40 - 22 - 17, 'leg shot: 75 % of the body damage', JSON.stringify(h));
  ok(shootAt(0.45, 1.1, -20) === null && hp() === 21, '0.45 m beside the body misses');
  ok(shootAt(0, 0.4, -20) === null, 'between the legs misses');
  h = shootAt(0, 1.1, -20);
  ok(h && h.kill, 'the killing blow is marked');
  ok(B.all('kill').some(m => m.victim === bid && !m.head), 'the kill went to everybody, not a headshot');
  clock += 3000;   // the respawn cooldown
  msg(B, { t: 'respawn' });
  ok(shootAt(0, 1.1, -20) === null, 'the spawn protection holds');
  clock += 3000;
  msg(B, { t: 'state', x: 0, y: 1.7, z: -20, yaw: 0, pitch: 0 });
  ok(shootAt(0, 1.1, -20) !== null, 'after the protection the hit counts');

  // the crouch: the server takes the eye height from the state and shrinks the boxes with it
  msg(B, { t: 'state', x: 0, y: 1.1, z: -20, h: 1.1, yaw: 0, pitch: 0 });
  clock += 300;   // let the lag-compensation window pass the crouch, so the shots see the crouched target
  ok(shootAt(0, 1.6, -20) === null, 'the standing head height misses the crouched target');
  h = shootAt(0, 1.0, -20);
  ok(h && h.head, 'the crouched head is hit at 1.0 m');
  msg(B, { t: 'state', x: 0, y: 1.7, z: -20, h: 1.7, yaw: 0, pitch: 0 });

  // a teammate between the shooter and the target does not stop the bullet
  const C = seat(g, conn());
  msg(C, { t: 'join', name: 'РЎРІРѕР№', team: 0, x: 0, z: -10, yaw: 0 });
  clock += 3000;
  h = shootAt(0, 1.1, -20);
  ok(h && h.id === bid, 'the bullet passes through a teammate');
  g.stop();
}
{
  // the wall: the refined freePath stops the ray at the face, the grace is 5 cm
  let clock = 1e6;
  const house = (x, z) => (Math.abs(x) < 3 && z > -13 && z < -7) ? { top: 12 } : null;
  const g = createGame({ world: flatWorld(house), area: { cx: 0, cz: 0 }, now: () => clock, name: 'wall' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'РЎС‚СЂРµР»РѕРє', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'РњРёС€РµРЅСЊ', team: 1, x: 0, z: -20, yaw: 0 });
  const bid = B.handle.player.id;
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  const aim = (tx, ty, tz) => { const dx = tx, dy = ty - 1.7, dz = tz, l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l, +l.toFixed(2), bid]; };
  const shootAt = (tx, ty, tz) => { const n = A.all('hit').length; msg(A, { t: 'shoot', w: 0, rays: [aim(tx, ty, tz)] }); clock += 120; g.stepBullets(); const h = A.all('hit'); return h.length > n ? h[h.length - 1] : null; };
  ok(shootAt(0, 1.1, -20) === null, 'the house stops the hit');
  const len = A.last('shot').rays[0][3];
  ok(near(len, 7, 0.15), 'the tracer stops at the wall face (~7 m)', String(len));
  msg(B, { t: 'state', x: 0, y: 1.7, z: -6.8, yaw: 0, pitch: 0 });
  ok(shootAt(0, 1.1, -6.8) !== null, 'a target just in front of the wall is hit');
  msg(B, { t: 'state', x: 0, y: 1.7, z: -7.4, yaw: 0, pitch: 0 });
  clock += 300;   // let the lag-compensation window pass the move, so the shot sees the target behind the wall
  ok(shootAt(0, 1.1, -7.4) === null, 'a target just behind the wall is not');
  g.stop();
}
{
  // the hill slope: the ground itself stops the ray now, and a target on top of the hill can be hit
  let clock = 1e6;
  const hill = (x, z) => z < -10 ? (-z - 10) * 0.5 : 0;
  const g = createGame({ world: flatWorld(() => null, hill), area: { cx: 0, cz: 0 }, now: () => clock, name: 'hill' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'РЎС‚СЂРµР»РѕРє', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'РњРёС€РµРЅСЊ', team: 1, x: 0, z: -20, yaw: 0 });
  const bid = B.handle.player.id;
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  const aim = (tx, ty, tz) => { const dx = tx, dy = ty - 1.7, dz = tz, l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l, +l.toFixed(2), bid]; };
  const shootAt = (tx, ty, tz) => { const n = A.all('hit').length; msg(A, { t: 'shoot', w: 0, rays: [aim(tx, ty, tz)] }); clock += 120; g.stepBullets(); const h = A.all('hit'); return h.length > n ? h[h.length - 1] : null; };
  ok(shootAt(0, 1.1, -20) === null, 'the hill slope stops a flat shot');
  const len = A.last('shot').rays[0][3];
  ok(near(len, 12.64, 0.2), 'the tracer stops on the slope (~12.6 m for the slightly downward aim)', String(len));
  msg(B, { t: 'state', x: 0, y: hill(0, -20) + 1.7, z: -20, yaw: 0, pitch: 0 });
  ok(shootAt(0, hill(0, -20) + 1.1, -20) !== null, 'a target on top of the hill is hit over the slope');
  g.stop();
}
{
  // the lag compensation: the position, the eye height and the heading are rewound, not taken as of now
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'lag' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'РЎС‚СЂРµР»РѕРє', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'РњРёС€РµРЅСЊ', team: 1, x: 0, z: -20, yaw: 0 });
  const bid = B.handle.player.id;
  msg(A, { t: 'ping', rtt: 60 });   // the lag becomes 120 + 30 = 150 ms
  clock += 3000;
  const aim = (tx, ty, tz) => { const dx = tx, dy = ty - 1.7, dz = tz, l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l, +l.toFixed(2), bid]; };
  const shootAt = (tx, ty, tz) => { const n = A.all('hit').length; msg(A, { t: 'shoot', w: 0, rays: [aim(tx, ty, tz)] }); clock += 120; g.stepBullets(); const h = A.all('hit'); return h.length > n ? h[h.length - 1] : null; };
  const two = (r1, r2) => { const n = A.all('hit').length; msg(A, { t: 'shoot', w: 0, rays: [r1, r2] }); clock += 120; g.stepBullets(); const h = A.all('hit'); return h.length > n ? h[h.length - 1] : null; };
  const t0 = clock;
  msg(B, { t: 'state', x: 0, y: 1.7, z: -20, yaw: 0, pitch: 0 });
  clock = t0 + 100;
  msg(B, { t: 'state', x: 3, y: 1.7, z: -20, yaw: 0, pitch: 0 });
  clock = t0 + 200;   // the shot looks back to t0 + 50: the target stood at x = 1.5
  let h = two(aim(1.5, 1.1, -20), aim(3, 1.1, -20));
  ok(h && h.dmg === WEAPONS[0].dmg && B.handle.player.hp === 100 - WEAPONS[0].dmg, 'only the ray at the rewound position hits, the one at the current position misses', JSON.stringify(h));
  // the eye height is rewound too: the target crouched back then, stands now
  const t1 = clock;
  msg(B, { t: 'state', x: 3, y: 1.1, z: -20, h: 1.1, yaw: 0, pitch: 0 });
  clock = t1 + 100;
  msg(B, { t: 'state', x: 3, y: 1.7, z: -20, h: 1.7, yaw: 0, pitch: 0 });
  clock = t1 + 200;   // back then the eye was at ~1.4: the head centre at ~1.3
  h = two(aim(3, 1.3, -20), aim(3, 1.6, -20));
  ok(h && h.head && h.dmg === WEAPONS[0].head, 'the crouch of 150 ms ago is honoured: the head at 1.3 m hits, the standing head height of now misses', JSON.stringify(h));
  g.stop();
}
{
  // the shotgun: every pellet is judged by itself, the falloff applies, the damages add up
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'shotgun' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'РЎС‚СЂРµР»РѕРє', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'РњРёС€РµРЅСЊ', team: 1, x: 0, z: -20, yaw: 0 });
  const bid = B.handle.player.id;
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -20, yaw: 0, pitch: 0 });
  const W = WEAPONS[1], l = Math.hypot(0.6, 20), d = [0, -0.6 / l, -20 / l];
  msg(A, { t: 'shoot', w: 1, rays: Array.from({ length: W.pellets }, () => [d[0], d[1], d[2], +l.toFixed(2), bid]) });
  clock += 120; g.stepBullets();   // let the pellets fly the 20 m and land
  const h = A.last('hit');
  const want = Math.round(W.pellets * W.dmg * (1 - W.falloff * l / W.range));
  ok(h && h.dmg === want && B.handle.player.hp === 100 - want, `eight pellets at 20 m: ${want} damage`, JSON.stringify(h));
  g.stop();
}
{
  // the flight time: nothing lands at the click; the bhit and the damage come when the bullet arrives (56 m at 560 m/s = 100 ms)
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'flight' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -56, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -56, yaw: 0, pitch: 0 });
  const L = Math.hypot(0.6, 56), d = [0, -0.6 / L, -56 / L];   // aim at the chest, not the head
  msg(A, { t: 'shoot', w: 0, rays: [d] });
  ok(A.all('hit').length === 0 && B.all('hurt').length === 0 && A.all('bhit').length === 0, 'at the click nothing has landed yet');
  clock += 50; g.stepBullets();   // halfway: 28 m of the 56
  ok(A.all('hit').length === 0 && A.all('bhit').length === 0, 'halfway (50 ms) the bullet is still in the air');
  clock += 60; g.stepBullets();   // past the 100 ms of flight
  const h = A.last('hit'), b = A.last('bhit');
  ok(h && h.dmg === WEAPONS[0].dmg && B.handle.player.hp === 100 - WEAPONS[0].dmg, 'the damage lands when the bullet arrives', JSON.stringify(h));
  ok(b && near(b.d, 56, 0.5) && b.v === B.handle.player.id, 'bhit reports the body at ~56 m', JSON.stringify(b));
  g.stop();
}
{
  // the refined freePath on its own
  const house = (x, z) => (Math.abs(x) < 3 && z > -13 && z < -7) ? { top: 12 } : null;
  const hill = (x, z) => z < -10 ? (-z - 10) * 0.5 : 0;
  ok(near(makePhysics(house, () => 0).freePath([0, 1.7, 0], [0, 0, -1], 160), 7, 0.05), 'freePath: the wall face to 5 cm');
  ok(near(makePhysics(() => null, hill).freePath([0, 1.7, 0], [0, 0, -1], 160), 13.4, 0.05), 'freePath: the slope to 5 cm');
  ok(makePhysics(() => null, () => 0).freePath([0, 1.7, 0], [0, 0, -1], 160) === 160, 'freePath: an open field stays open');
}

/* ---------- 2b. the grenade step (stepNade): bounces, slopes, rolling, the touch events ---------- */
console.log('grenade physics (stepNade):');
{
  const run = (phys, n, steps) => { let ev = null; for (let i = 0; i < steps; i++) { phys.stepNade(n, 1 / 30, 18); if (n.bounce && !ev) ev = n.bounce; } return ev; };
  // flat: it bounces, reports the touch, and settles on the ground as before
  const F = makePhysics(() => null, () => 0);
  const f = { p: [0, 3, 0], v: [2, 0, 0] };
  const fe = run(F, f, 240);
  ok(fe && fe.kind === 'ground', 'flat: the touch reports a ground bounce', JSON.stringify(fe));
  ok(f.v[1] === 0 && Math.abs(f.v[0]) < 0.05 && near(f.p[1], 0.12, 0.01), 'flat: it settles on the ground', JSON.stringify(f.p));
  // a slope: the bounce reflects about the normal and the settled grenade rolls downhill
  const S = makePhysics(() => null, (x) => 0.5 * x);
  const s = { p: [2, 3, 2], v: [0, 0, 0] };
  const se = run(S, s, 90);
  ok(se && se.kind === 'ground', 'slope: the touch reports a ground bounce', JSON.stringify(se));
  ok(s.p[0] < 2 && s.v[0] <= 0.001, 'slope: it bounces and rolls downhill (-x)', JSON.stringify(s.p));
  // a wall turns the way back and reports a wall touch
  const W = makePhysics((x, z) => (x > 1 && x < 3 && z > -1 && z < 1) ? { top: 12 } : null, () => 0);
  const w = { p: [0, 1, 0], v: [10, 0, 0] };
  const we = run(W, w, 30);
  ok(we && we.kind === 'wall', 'wall: the touch reports a wall', JSON.stringify(we));
  ok(w.v[0] < 0, 'wall: the way is turned back');
  // a roof reports a roof touch
  const R = makePhysics((x, z) => (Math.abs(x) < 2 && Math.abs(z) < 2) ? { top: 12 } : null, () => 0);
  const r = { p: [0, 13, 0], v: [0, -5, 0] };
  const re = run(R, r, 30);
  ok(re && re.kind === 'roof', 'roof: the touch reports a roof', JSON.stringify(re));
}

/* ---------- 2c. the blast push: the explosion throws the living ---------- */
console.log('blast push (explode):');
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'push' });
  const A = seat(g, conn()), B = seat(g, conn()), E = seat(g, conn()), T = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -3, yaw: 0 });
  msg(E, { t: 'join', name: 'Далеко', team: 1, x: 0, z: -6.5, yaw: 0 });
  msg(T, { t: 'join', name: 'Свой', team: 0, x: 1, z: -1, yaw: 0 });
  clock += 3000;   // past the spawn protection
  for (const [c, x, z] of [[A, 0, 0], [B, 0, -3], [E, 0, -6.5], [T, 1, -1]]) msg(c, { t: 'state', x, y: 1.7, z, yaw: 0, pitch: 0 });
  msg(A, { t: 'throw', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });   // straight down: it settles at the thrower's feet
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }   // 3 s: past the 2.5 s fuse
  const pb = B.last('push'), pa = A.last('push'), pe = E.last('push');
  ok(pb && pb.vz < -5 && pb.vy > 1, 'the blast 3 m away throws away and up', JSON.stringify(pb));
  ok(pa && pa.vy > 4, 'the thrower is thrown up too (the self blast, half force)', JSON.stringify(pa));
  ok(pe && Math.hypot(pe.vx, pe.vy, pe.vz) < Math.hypot(pb.vx, pb.vy, pb.vz), 'the push fades with distance', JSON.stringify(pe));
  ok(T.all('push').length === 0 && T.all('hurt').length === 0, 'the teammate is not pushed');
  ok(B.handle.player.hp > 0 && B.handle.player.hp < 100, 'the blast at 3 m hurts but does not kill', String(B.handle.player.hp));
  g.stop();
}
{
  // the wall shields from the push as from the damage
  let clock = 1e6;
  const house = (x, z) => (Math.abs(x) < 4 && z > -4 && z < -2) ? { top: 12 } : null;
  const g = createGame({ world: flatWorld(house), area: { cx: 0, cz: 0 }, now: () => clock, name: 'pushwall' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -6, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -6, yaw: 0, pitch: 0 });
  msg(A, { t: 'throw', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(B.all('push').length === 0 && B.all('hurt').length === 0, 'the wall shields from the push as from the damage');
  g.stop();
}
{
  // the dead are not thrown: a pre-damaged target dies to the blast and gets no push
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'pushdead' });
  const A = seat(g, conn()), D = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(D, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -1, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(D, { t: 'state', x: 0, y: 1.7, z: -1, yaw: 0, pitch: 0 });
  const L = Math.hypot(0.6, 1);
  msg(A, { t: 'shoot', w: 0, rays: [[0, -0.6 / L, -1 / L]] });
  clock += 120; g.stepBullets();
  ok(D.handle.player.hp === 100 - WEAPONS[0].dmg, 'the pre-damage landed', String(D.handle.player.hp));
  msg(A, { t: 'throw', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(!D.handle.player.alive && D.all('push').length === 0, 'the dead are not thrown');
  g.stop();
}
{
  // a bot slides on the server: the knockback lands in its brain and decays as it slides
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, arena: { cx: 0, cz: 0, r: 60, bases: [base(0, -25, 4), base(0, 25, 4)] }, mode: 'team', now: () => clock, name: 'pushbot' });
  const A = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  const bot = g.addBot('easy');   // easy: no grenades of its own
  bot.x = 0; bot.z = -3; bot.y = 1.7;
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(A, { t: 'throw', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }
  const k0 = Math.hypot(bot.bot.kx, bot.bot.kz);
  ok(bot.alive && k0 > 2, 'the bot got the knockback', String(k0));
  clock += 300;   // the think tick takes dt 0.2 of it: the bot slides and the push decays
  await new Promise(r => setTimeout(r, 250));   // let the real think clock fire
  ok(Math.hypot(bot.bot.kx, bot.bot.kz) < k0, 'the bot slide decays');
  g.stop();
}

/* ---------- 3. a real bot fight ---------- */
console.log('bot fight (8 hard bots, 12 s of real time):');
{
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, arena: { cx: 0, cz: 0, r: 60, bases: [base(0, -25, 4), base(0, 25, 4)] }, mode: 'team', botLevel: 'hard', name: 'bots' });
  const S = seat(g, conn());
  msg(S, { t: 'join', name: 'Р—СЂРёС‚РµР»СЊ', team: 0, x: 0, z: 0, yaw: 0 });
  for (let i = 0; i < 4; i++) { g.addBot(0); g.addBot(1); }
  await new Promise(r => setTimeout(r, 12000));
  const kills = S.all('kill'), heads = kills.filter(m => m.head).length, shots = S.all('shot').length;
  g.stop();
  console.log(`  bots: ${shots} shots, ${kills.length} kills (${heads} headshots)`);
  ok(shots > 20, 'the bots shoot');
  ok(kills.length >= 2, 'the bots kill with the small hitboxes', String(kills.length));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall ${pass} tests passed`);
process.exit(fail ? 1 : 0);
