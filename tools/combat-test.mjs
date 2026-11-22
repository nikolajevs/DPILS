/* The combat tests, no browser needed: node tools/combat-test.mjs (CI runs it after npm run check).
   1. The hitbox geometry (rayHit from server/combat.mjs): the zones, the crouch, the legs apart, the heading.
   2. The server rules (createGame over a fake flat world with a controlled clock): damage by zone, the shotgun,
      walls and hill slopes (the refined freePath), the spawn protection, teammates, and the lag compensation of
      the position, the eye height and the heading. The bullets fly (g.stepBullets drives them by the test clock),
      so each shot is given the time to reach its target before the hit is read.
   2c. The blast push (g.stepNades drives the fuse by the test clock): the explosion throws the living away and up,
      the push fades with distance, stops at walls, spares teammates and the dead; a bot slides on the server.
   2d. The grenade meets the players and the bullets: it bounces off a body (enemy or teammate, not the thrower)
      without hurting, and a bullet that meets it in the air detonates it — the blast stays the thrower's.
   2e. The fall damage: the client reports the height it landed from, the server caps it by the drop it saw itself;
      a jump is free, a long fall kills, the spawn protection does not shield from one's own fall; a bot walks off
      an edge and falls for real (g.stepBots drives its think by the test clock), a slope is walked without damage.
   2f. The wall chord (shotPath): a thin shed is punched through by the weapon's budget, the speed cut by the chord
      spent; a thick wall stays solid; the budget carries across houses; the kill carries the bullet's own vector.
   2g. The grenade bounces about the normal of the outline edge it crossed (a 45° bastion face), not the world axes.
   2h. The blast judges two rays, chest and head: one hidden is half the blow, both hidden is a bunker.
   2i. The drag: v(s) = v0·e^(−k·s), damage as v²/v0², the longer flight time, one formula for server, page and bots.
   2j. The player cap: 64 places, bot names stay unique past the name list, a human steps a bot out of a full
      server, and with no bots left the join is refused.
   2l. The ready belt and the backpack stores: three kits and two grenades of a kind are ready, the surplus rides
      in the pack and refills the belt as it is spent (also on respawn); the sights live in the pack — mounting
      frees the cell, a swap returns the old sight to it, a full pack refuses the take-off.
   3. A real bot fight on a flat arena (12 s of real time): with the small hitboxes the bots must still see,
      shoot and kill each other. */
import { BULLET_G, FALL, HIT, INV, WEAPONS, NADE, W_FALL, bulletAt, bulletDir, bulletDrop, dragDist, dragTime, dragVel, rayHit } from '../server/combat.mjs';
import { createGame, MUZZLE } from '../server/game.mjs';
import { makePhysics } from '../server/physics.mjs';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' вЂ” ' + extra : '')); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
// one pellet's damage at s metres from the barrel: the drag takes v²/v0² = e^(−2k·s), a punched wall its factor squared
const dmgAt = (w, s, zone = 0, f = 1) => Math.round((zone === 1 ? WEAPONS[w].head : zone === 2 ? WEAPONS[w].dmg * HIT.legMul : WEAPONS[w].dmg) * Math.exp(-2 * (WEAPONS[w].drag || 0) * s) * f * f);

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
// equip a gun for the test: only two weapons ride on the player (loadout), the rest in the pack — swap the wanted one in
const arm = (c, w, slot = 0) => { if (!c.handle.player.loadout.includes(w)) msg(c, { t: 'swap', w, slot }); };
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

  const s20 = 20 - MUZZLE, dH = dmgAt(0, s20, 1), dB = dmgAt(0, s20), dL = dmgAt(0, s20, 2);
  let h = shootAt(0, 1.6, -20);
  ok(h && h.head && h.zone === 1 && h.dmg === dH && hp() === 100 - dH, 'head shot: 40 at the muzzle, the drag takes its share at 20 m', JSON.stringify(h));
  h = shootAt(0, 1.1, -20);
  ok(h && !h.head && h.dmg === dB && hp() === 100 - dH - dB, 'torso shot: 22 at the muzzle, less downrange', JSON.stringify(h));
  h = shootAt(HIT.legOff, 0.4, -20);
  ok(h && h.zone === 2 && h.dmg === dL && hp() === 100 - dH - dB - dL, 'leg shot: 75 % of the body damage', JSON.stringify(h));
  ok(shootAt(0.45, 1.1, -20) === null && hp() === 100 - dH - dB - dL, '0.45 m beside the body misses');
  ok(shootAt(0, 0.4, -20) === null, 'between the legs misses');
  h = shootAt(0, 1.1, -20);
  ok(h && !h.kill && hp() === 100 - dH - 2 * dB - dL, 'the drag made the rifle one blow weaker at 20 m: the fourth leaves hp');
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
  ok(near(len, 7 - MUZZLE, 0.15), 'the tracer stops at the wall face, measured from the barrel (~6.4 m)', String(len));
  msg(B, { t: 'state', x: 0, y: 1.7, z: -6.8, yaw: 0, pitch: 0 });
  ok(shootAt(0, 1.1, -6.8) !== null, 'a target just in front of the wall is hit');
  msg(B, { t: 'state', x: 0, y: 1.7, z: -7.4, yaw: 0, pitch: 0 });
  clock += 300;   // let the lag-compensation window pass the move, so the shot sees the target behind the wall
  ok(shootAt(0, 1.1, -7.4) === null, 'a target just behind the wall is not');
  g.stop();
}
{
  // point-blank: the shooter leans on the wall (the face 0.4 m from the eye, nearer than the 0.6 m barrel).
  // The old scan started at 2 m and let such a wall shoot through; now the muzzle rests on the face and the flight is zero.
  let clock = 1e6;
  const house = (x, z) => (Math.abs(x) < 3 && z > -6 && z < -0.4) ? { top: 12 } : null;
  const g = createGame({ world: flatWorld(house), area: { cx: 0, cz: 0 }, now: () => clock, name: 'lean' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -2, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -2, yaw: 0, pitch: 0 });
  const n = A.all('hit').length;
  msg(A, { t: 'shoot', w: 0, rays: [[0, 0, -1]] });
  const len = A.last('shot').rays[0][3];
  clock += 120; g.stepBullets();
  ok(A.all('hit').length === n, 'leaning on the wall: the target behind it is not hit');
  ok(near(len, 0, 0.05), 'leaning on the wall: the muzzle rests on the face, the flight is zero', String(len));
  ok(near(makePhysics(house, () => 0).freePath([0, 1.7, 0], [0, 0, -1], 160), 0.4, 0.05), 'freePath: the near face to 5 cm');
  g.stop();
}
{
  // the corner clip: a 0.7 m slab the ray enters at 0.5 m and leaves at 1.2 m — both before the old first sample at 2 m,
  // so the old scan saw open air past it and shot straight through. The near scan must stop at the 0.5 m face.
  let clock = 1e6;
  const slab = (x, z) => (Math.abs(x) < 3 && z > -1.2 && z < -0.5) ? { top: 12 } : null;
  const g = createGame({ world: flatWorld(slab), area: { cx: 0, cz: 0 }, now: () => clock, name: 'clip' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -3, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -3, yaw: 0, pitch: 0 });
  const n = A.all('hit').length;
  msg(A, { t: 'shoot', w: 0, rays: [[0, 0, -1]] });
  const len = A.last('shot').rays[0][3];
  clock += 120; g.stepBullets();
  ok(A.all('hit').length === n, 'the corner clip no longer shoots through the slab');
  ok(near(len, 0, 0.05), 'the clip: the 0.6 m barrel is past the 0.5 m face, the flight is zero', String(len));
  ok(near(makePhysics(slab, () => 0).freePath([0, 1.7, 0], [0, 0, -1], 160), 0.5, 0.05), 'freePath: the slab face to 5 cm');
  ok(makePhysics(slab, () => 0).freePath([0, 1.7, -0.8], [0, 0, -1], 160) === 0, 'freePath: an origin inside stone dies at once');
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
  ok(near(len, 12.64 - MUZZLE, 0.2), 'the tracer stops on the slope (~12 m from the barrel for the slightly downward aim)', String(len));
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
  const dLag = dmgAt(0, Math.hypot(1.5, 0.6, 20) - MUZZLE);
  ok(h && h.dmg === dLag && B.handle.player.hp === 100 - dLag, 'only the ray at the rewound position hits, the one at the current position misses', JSON.stringify(h));
  // the eye height is rewound too: the target crouched back then, stands now
  const t1 = clock;
  msg(B, { t: 'state', x: 3, y: 1.1, z: -20, h: 1.1, yaw: 0, pitch: 0 });
  clock = t1 + 100;
  msg(B, { t: 'state', x: 3, y: 1.7, z: -20, h: 1.7, yaw: 0, pitch: 0 });
  clock = t1 + 200;   // back then the eye was at ~1.4: the head centre at ~1.3
  h = two(aim(3, 1.3, -20), aim(3, 1.6, -20));
  ok(h && h.head && h.dmg === dmgAt(0, Math.hypot(3, 0.4, 20) - MUZZLE, 1), 'the crouch of 150 ms ago is honoured: the head at 1.3 m hits, the standing head height of now misses', JSON.stringify(h));
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
  arm(A, 1);   // the shotgun rides in the pack by default: equip it first
  msg(A, { t: 'shoot', w: 1, rays: Array.from({ length: W.pellets }, () => [d[0], d[1], d[2], +l.toFixed(2), bid]) });
  clock += 120; g.stepBullets();   // let the pellets fly the 20 m and land
  const h = A.last('hit');
  const want = Math.round(W.pellets * W.dmg * Math.exp(-2 * W.drag * (l - MUZZLE)));
  ok(h && h.dmg === want && B.handle.player.hp === 100 - want, `eight pellets at 20 m: ${want} damage (the drag replaces the linear falloff)`, JSON.stringify(h));
  g.stop();
}
{
  // the flight time: nothing lands at the click; the bhit and the damage come when the bullet arrives (55.4 m from the barrel at 560 m/s ≈ 100 ms)
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
  const dFly = dmgAt(0, L - MUZZLE);
  ok(h && h.dmg === dFly && B.handle.player.hp === 100 - dFly, 'the damage lands when the bullet arrives, weakened by the drag', JSON.stringify(h));
  ok(b && near(b.d, 56 - MUZZLE, 0.5) && b.v === B.handle.player.id, 'bhit reports the body at ~55.4 m from the barrel', JSON.stringify(b));
  g.stop();
}
/* ---------- 2a. the bullet's fall: gravity on the arc, holdover, the ground catching a long flat shot ---------- */
console.log('bullet drop (gravity, holdover, determinism):');
{
  // the arc itself: a 7.62 at 400 m (820 m/s, 0.49 s) sinks ~1.17 m, and the tangent bends down with it
  ok(near(bulletDrop(400, 820), 0.5 * BULLET_G * (400 / 820) ** 2, 1e-9) && near(bulletDrop(400, 820), 1.167, 0.01), 'the sniper bullet falls ~1.17 m at 400 m', String(bulletDrop(400, 820)));
  const p = bulletAt([0, 1.7, 0], [0, 0, -1], 400, 820);
  ok(near(p[1], 1.7 - 1.167, 0.01) && p[2] === -400, 'bulletAt rides the arc, not the straight line', JSON.stringify(p));
  const t = bulletDir([0, 0, -1], 400, 820);
  ok(t[1] < -0.005 && near(Math.hypot(...t), 1, 1e-9), 'the tangent at 400 m points down and stays unit', JSON.stringify(t));
  ok(bulletDrop(20, 560) < 0.01, 'at 20 m the rifle drop is under a centimetre — close fights unchanged');
}
{
  // the sniper at 400 m: a flat aim at the chest hits the dirt; the same aim lifted by the drop hits the chest
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'drop' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -400, yaw: 0 });
  const bid = B.handle.player.id;
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -400, yaw: 0, pitch: 0 });
  const aim = (tx, ty, tz) => { const dx = tx, dy = ty - 1.7, dz = tz, l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l]; };
  const fly = (ray, w, ms) => { arm(A, w); const n = A.all('bhit').length; msg(A, { t: 'shoot', w, rays: [ray] }); clock += ms; g.stepBullets(); const b = A.all('bhit'); return b.length > n ? b[b.length - 1] : null; };
  ok(fly(aim(0, 1.1, -400), 2, 600) === null, 'a flat sniper aim at 400 m misses: the bullet is ~1.17 m low');
  const wall = A.last('shot').rays[0][3];
  ok(wall < 400, 'the fallen bullet meets the ground before 400 m', String(wall));
  clock += 1400;   // past the sniper's gapMs
  const hold = bulletDrop(400, 820, WEAPONS[2].drag);
  const b = fly(aim(0, 1.1 + hold, -400), 2, 600);
  ok(b && b.v === bid && near(b.d, 400, 1) && near(b.at[1], 1.1, 0.06), 'the holdover aim hits the chest at 400 m', JSON.stringify(b));
  const h = A.last('hit');
  ok(h && h.dmg === dmgAt(2, 400 - MUZZLE), 'the sniper body damage at 400 m: ~90 % left after the drag', JSON.stringify(h));
  clock += 1400;
  const hb = fly(aim(0, 1.6 + bulletDrop(400, 820, WEAPONS[2].drag), -400), 2, 600);
  ok(hb && hb.zone === 1 && A.last('hit').kill, 'the head holdover at 400 m kills', JSON.stringify(hb));
  g.stop();
}
{
  // the bot's formula: aim lifted by the drop of the straight distance hits at the hard bot's sniper range (130 m)
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'bothold' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -130, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -130, yaw: 0, pitch: 0 });
  const aimY = 1.7 - 0.56, dy2 = aimY - 1.7, d3 = Math.hypot(130, dy2), hold = bulletDrop(d3, 820, WEAPONS[2].drag);
  const pitch = Math.asin((dy2 + hold) / d3), cp = Math.cos(pitch);
  arm(A, 2);
  msg(A, { t: 'shoot', w: 2, rays: [[0, Math.sin(pitch), -cp]] });
  clock += 300; g.stepBullets();
  ok(A.last('hit') && A.last('hit').dmg === dmgAt(2, d3 - MUZZLE), 'the bots\' holdover formula (drag included) lands the 130 m chest shot', JSON.stringify(A.last('hit')));
  g.stop();
}
{
  // a long flat shot from low: the ground catches the arc sooner than the straight line (eye 1.0 m, 820 m/s → ~370 m)
  const phys = makePhysics(() => null, () => 0);
  const straight = phys.freePath([0, 1.0, 0], [0, 0, -1], 500);
  const arc = phys.freePath([0, 1.0, 0], [0, 0, -1], 500, 820);
  ok(straight === 500, 'the straight sight line stays open');
  ok(near(arc, 820 * Math.sqrt(2 * 1.0 / BULLET_G), 1.5), 'the falling arc meets the ground at ~370 m', String(arc));
}
{
  // determinism: the same shot in two identical games lands at the same point to the millimetre
  const run = () => {
    let clock = 1e6;
    const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'det' });
    const A = seat(g, conn()), B = seat(g, conn());
    msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
    msg(B, { t: 'join', name: 'Мишень', team: 1, x: 2, z: -300, yaw: 0.4 });
    clock += 3000;
    msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
    msg(B, { t: 'state', x: 2, y: 1.7, z: -300, yaw: 0.4, pitch: 0 });
    const ty = 1.2 + bulletDrop(300, 820, WEAPONS[2].drag), l = Math.hypot(2, ty - 1.7, 300);
    arm(A, 2);
    msg(A, { t: 'shoot', w: 2, rays: [[2 / l, (ty - 1.7) / l, -300 / l]] });
    for (let i = 0; i < 12; i++) { clock += 50; g.stepBullets(); }   // the same 30 Hz-ish stepping both times
    const b = A.last('bhit'); g.stop(); return b && JSON.stringify(b);
  };
  const r1 = run(), r2 = run();
  ok(r1 && r1 === r2, 'two identical games land the bullet at the identical point', r1 + ' / ' + r2);
}
{
  // the refined freePath on its own
  const house = (x, z) => (Math.abs(x) < 3 && z > -13 && z < -7) ? { top: 12 } : null;
  const hill = (x, z) => z < -10 ? (-z - 10) * 0.5 : 0;
  ok(near(makePhysics(house, () => 0).freePath([0, 1.7, 0], [0, 0, -1], 160), 7, 0.05), 'freePath: the wall face to 5 cm');
  ok(near(makePhysics(() => null, hill).freePath([0, 1.7, 0], [0, 0, -1], 160), 13.4, 0.05), 'freePath: the slope to 5 cm');
  ok(makePhysics(() => null, () => 0).freePath([0, 1.7, 0], [0, 0, -1], 160) === 160, 'freePath: an open field stays open');
}
{
  // the contour is solid at a height: a canopy on posts is open at the ground (a shot and a walker pass under),
  // its roof still stops a lofted grenade; a passage cut out of a footprint is walkable and shootable
  const canopy = (x, z, y = 1) => (Math.abs(x) < 3 && z > -13 && z < -7 && y >= 4.75) ? { top: 5, base: 4.75 } : null;
  const C = makePhysics(canopy, () => 0);
  ok(C.freePath([0, 1.7, 0], [0, 0, -1], 160) === 160, 'canopy: a shot at 1.7 m passes under the open roof');
  ok(C.walkable(0, -10), 'canopy: the ground under it is walkable');
  const cn = { p: [0, 6, -10], v: [0, -5, 0] }; let ce = null;
  for (let i = 0; i < 30 && !ce; i++) { C.stepNade(cn, 1 / 30, 18); if (cn.bounce) ce = cn.bounce; }
  ok(ce && ce.kind === 'roof', 'canopy: a grenade from above lands on the roof', JSON.stringify(ce));
  const passage = (x, z, y = 1) => (Math.abs(x) < 3 && z > -13 && z < -7 && Math.abs(x) >= 1) ? { top: 12 } : null;
  const P = makePhysics(passage, () => 0);
  ok(P.freePath([0, 1.7, 0], [0, 0, -1], 160) === 160, 'passage: a shot down the hole passes');
  ok(P.walkable(0, -10), 'passage: the hole is walkable');
  ok(!P.walkable(2, -10), 'passage: the wall beside the hole is not');
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

/* ---------- 2d. the grenade meets the players and the bullets ---------- */
console.log('grenade: the body bounce and the shot-down:');
{
  // the thrown grenade bounces off the player it meets, without hurting or pushing them
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'nadebody' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Thrower', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Target', team: 1, x: 0, z: -6, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -6, yaw: 0, pitch: 0 });
  msg(A, { t: 'throw', dx: 0, dy: 0, dz: -1, sp: 15 });
  let nb = null;
  for (let i = 0; i < 30 && !nb; i++) { clock += 1000 / 30; g.stepNades(); nb = A.last('nbounce'); }
  ok(nb && nb.v[2] > 2, 'the grenade bounces back off the body', JSON.stringify(nb));
  ok(nb && nb.p[2] > -6.5, 'it stopped at the body, not inside it', JSON.stringify(nb && nb.p));
  ok(B.handle.player.hp === 100 && B.all('hurt').length === 0 && B.all('push').length === 0, 'the touch neither hurts nor pushes');
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(A.all('boom').length === 1, 'the bounced grenade still goes off on its fuse');
  g.stop();
}
{
  // a teammate's body bounces it too, and the thrower's own body never stops their own grenade
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'nadeteam' });
  const A = seat(g, conn()), T = seat(g, conn());
  msg(A, { t: 'join', name: 'Thrower', team: 0, x: 0, z: 0, yaw: 0 });
  msg(T, { t: 'join', name: 'Mate', team: 0, x: 0, z: -6, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(T, { t: 'state', x: 0, y: 1.7, z: -6, yaw: 0, pitch: 0 });
  msg(A, { t: 'throw', dx: 0, dy: 0, dz: -1, sp: 15 });
  for (let i = 0; i < 30; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(A.last('nbounce'), 'a teammate\'s body bounces it too');
  g.stop();
}
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'nadeself' });
  const A = seat(g, conn());
  msg(A, { t: 'join', name: 'Thrower', team: 0, x: 0, z: 0, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(A, { t: 'throw', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });   // straight down at own feet: the old feel must hold
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(A.all('nbounce').length === 0 && A.all('boom').length === 1, 'the thrower\'s own body does not stop the grenade');
  g.stop();
}
{
  // the shot-down: a bullet that meets the grenade in the air detonates it at once
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'nadeshot' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Shooter', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Far', team: 1, x: 0, z: -40, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -40, yaw: 0, pitch: 0 });
  msg(A, { t: 'ping', rtt: 0, c: 1 });   // no lag: the test aims at the live grenade
  msg(A, { t: 'throw', dx: 0, dy: 0, dz: -1, sp: 15 });
  let gy = 1.5, gv = NADE.loft * 15, gz = -0.6;
  for (let i = 0; i < 9; i++) { clock += 1000 / 30; g.stepNades(); gv -= NADE.g / 30; gy += gv / 30; gz -= 15 / 30; }   // 0.3 s of flight, mirrored step by step
  const L = Math.hypot(gy - 1.7, gz);
  msg(A, { t: 'shoot', w: 0, rays: [[0, (gy - 1.7) / L, gz / L]] });
  clock += 60; g.stepBullets();
  const ns = A.last('nshot');
  ok(ns && near(ns.d, L - MUZZLE, 0.3), 'the bullet met the grenade in the air', JSON.stringify(ns));
  ok(A.all('boom').length === 1, 'the shot-down grenade detonates at once');
  ok(A.last('hit') && A.last('hit').nade === true, 'the shooter gets the hitmarker');
  ok(B.handle.player.hp === 100, 'the far player is untouched');
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(A.all('boom').length === 1, 'the grenade is gone: no second blast on the fuse');
  g.stop();
}
{
  // a bullet a metre aside misses: the grenade lives out its fuse
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'nademiss' });
  const A = seat(g, conn());
  msg(A, { t: 'join', name: 'Shooter', team: 0, x: 0, z: 0, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(A, { t: 'ping', rtt: 0, c: 1 });
  msg(A, { t: 'throw', dx: 0, dy: 0, dz: -1, sp: 15 });
  let gy = 1.5, gv = NADE.loft * 15, gz = -0.6;
  for (let i = 0; i < 9; i++) { clock += 1000 / 30; g.stepNades(); gv -= NADE.g / 30; gy += gv / 30; gz -= 15 / 30; }
  const L = Math.hypot(1, gy - 1.7, gz);
  msg(A, { t: 'shoot', w: 0, rays: [[1 / L, (gy - 1.7) / L, gz / L]] });
  clock += 60; g.stepBullets();
  ok(A.all('nshot').length === 0, 'a bullet a metre aside misses the grenade');
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(A.all('boom').length === 1, 'the missed grenade lives out its fuse');
  g.stop();
}
{
  // the shotgun: the first pellet detonates the grenade, the rest fly on — one blast, not eight
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'nadeshotgun' });
  const A = seat(g, conn());
  msg(A, { t: 'join', name: 'Shooter', team: 0, x: 0, z: 0, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(A, { t: 'ping', rtt: 0, c: 1 });
  msg(A, { t: 'throw', dx: 0, dy: 0, dz: -1, sp: 15 });
  let gy = 1.5, gv = NADE.loft * 15, gz = -0.6;
  for (let i = 0; i < 9; i++) { clock += 1000 / 30; g.stepNades(); gv -= NADE.g / 30; gy += gv / 30; gz -= 15 / 30; }
  const L = Math.hypot(gy - 1.7, gz), dir = [0, (gy - 1.7) / L, gz / L];
  arm(A, 1);
  msg(A, { t: 'shoot', w: 1, rays: Array.from({ length: 8 }, () => dir) });
  clock += 60; g.stepBullets();
  ok(A.all('nshot').length === 1 && A.all('boom').length === 1, 'one pellet detonates it, the rest fly on');
  g.stop();
}
{
  // the blast of a shot-down grenade stays the thrower's: a third player's bullet only lights the fuse early
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'nadecredit' });
  const A = seat(g, conn()), B = seat(g, conn()), C = seat(g, conn());
  msg(A, { t: 'join', name: 'Thrower', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Victim', team: 1, x: 0, z: -6, yaw: 0 });
  msg(C, { t: 'join', name: 'Shooter', team: 1, x: 8, z: -3, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -6, yaw: 0, pitch: 0 });
  msg(C, { t: 'state', x: 8, y: 1.7, z: -3, yaw: 0, pitch: 0 });
  msg(C, { t: 'ping', rtt: 0, c: 1 });
  const L0 = Math.hypot(0.6, 6);
  msg(A, { t: 'shoot', w: 0, rays: [[0, -0.6 / L0, -6 / L0]] });   // pre-damage the victim so the blast kills
  clock += 120; g.stepBullets();
  ok(B.handle.player.hp === 100 - WEAPONS[0].dmg, 'the pre-damage landed', String(B.handle.player.hp));
  msg(A, { t: 'throw', dx: 0, dy: 0, dz: -1, sp: 15 });
  let gy = 1.5, gv = NADE.loft * 15, gz = -0.6;
  for (let i = 0; i < 9; i++) { clock += 1000 / 30; g.stepNades(); gv -= NADE.g / 30; gy += gv / 30; gz -= 15 / 30; }
  const dx = 0 - 8, dy = gy - 1.7, dz = gz - (-3), L = Math.hypot(dx, dy, dz);
  msg(C, { t: 'shoot', w: 0, rays: [[dx / L, dy / L, dz / L]] });
  clock += 60; g.stepBullets();
  ok(C.last('nshot'), 'the third player shot the grenade down');
  const kill = A.all('kill').find(m => m.victim === B.handle.player.id);
  ok(kill && kill.killer === A.handle.player.id && kill.w === 9, 'the kill is the thrower\'s, by grenade', JSON.stringify(kill));
  g.stop();
}

/* ---------- 2e. the fall damage: a landing from above the safe height hurts ---------- */
console.log('fall damage (fall):');
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), now: () => clock, name: 'fall' });
  const A = seat(g, conn());
  msg(A, { t: 'join', name: 'Прыгун', team: 0, x: 0, z: 0, yaw: 0 });
  clock += 3000;   // past the spawn protection
  const p = A.handle.player, st = y => msg(A, { t: 'state', x: 0, y, z: 0, yaw: 0, pitch: 0 });
  // up on a 10 m wall (the server accepts the height: the ramparts are the client's knowledge), then the fall and the landing
  st(11.7);
  for (const y of [10.5, 8, 4.5, 1.7]) { clock += 100; st(y); }
  msg(A, { t: 'fall', h: 10 });
  ok(p.hp === 100 - Math.round((10 - FALL.safe) * FALL.k), 'a 10 m fall costs 56 hp', String(p.hp));
  const hu = A.last('hurt');
  ok(hu && hu.fall === 1 && hu.by === p.id, 'the hurt is marked as a fall, from oneself', JSON.stringify(hu));
  msg(A, { t: 'fall', h: 10 });
  ok(p.hp === 44, 'a second report without a new drop is free', String(p.hp));
  st(2.6); clock += 80; st(1.7);
  msg(A, { t: 'fall', h: 0.9 });
  ok(p.hp === 44, 'a jump landing (under 3 m) is free', String(p.hp));
  msg(A, { t: 'fall', h: 50 });
  ok(p.hp === 44, 'a fall report without a seen drop cannot hurt', String(p.hp));
  st(21.7);
  for (const y of [18, 12, 6, 1.7]) { clock += 120; st(y); }
  msg(A, { t: 'fall', h: 20 });
  ok(!p.alive && p.hp <= 0, 'a 20 m fall kills', String(p.hp));
  const k = A.last('kill');
  ok(k && k.w === W_FALL && k.killer === k.victim, 'the kill feed calls it a fall, no killer credited', JSON.stringify(k));
  // the spawn protection shields from the enemy, not from one's own fall (as the self blast)
  const B = seat(g, conn());
  msg(B, { t: 'join', name: 'Новичок', team: 1, x: 5, z: 0, yaw: 0 });
  msg(B, { t: 'state', x: 5, y: 11.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 5, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'fall', h: 10 });
  ok(B.handle.player.hp === 44, 'the spawn protection does not shield from one\'s own fall', String(B.handle.player.hp));
  g.stop();
}
{
  // a bot walks off a 10 m edge and falls for real: gravity in think(), the landing hurts by the same rule
  let clock = 1e6;
  const cliff = (x, z) => (x < 0 ? 10 : 0);
  const g = createGame({ world: flatWorld(() => null, cliff), arena: { cx: 0, cz: 0, r: 60, bases: [base(0, -25, 4), base(0, 25, 4)] }, now: () => clock, name: 'fallbot' });
  const bot = g.addBot('easy');
  bot.x = -2; bot.z = 0; bot.y = 11.7; bot.fallTop = 11.7;
  bot.bot.path = [[30, 0]]; bot.bot.pi = 0; bot.bot.wpAt = clock;   // far past the edge: the goal is not reached mid-fall (a reached goal picks a random new one)
  for (let i = 0; i < 60; i++) { clock += 50; g.stepBots(0.05); }
  ok(bot.alive && bot.hp === 44, 'the bot walked off the 10 m edge, fell and took 56', String(bot.hp));
  ok(Math.abs(bot.y - 1.7) < 0.01, 'the bot stands on the ground below the edge', String(bot.y));
  g.stop();
}
{
  // a slope is walked down as before: no false fall, no damage
  let clock = 1e6;
  const slope = (x, z) => -0.25 * x;
  const g = createGame({ world: flatWorld(() => null, slope), arena: { cx: 0, cz: 0, r: 60, bases: [base(0, -25, 4), base(0, 25, 4)] }, now: () => clock, name: 'fallslope' });
  const bot = g.addBot('easy');
  bot.x = -2; bot.z = 0; bot.y = slope(-2, 0) + 1.7; bot.fallTop = bot.y;
  bot.bot.path = [[6, 0]]; bot.bot.pi = 0; bot.bot.wpAt = clock;
  for (let i = 0; i < 60; i++) { clock += 50; g.stepBots(0.05); }
  ok(bot.hp === 100, 'a slope is walked down without fall damage', String(bot.hp));
  g.stop();
}

/* ---------- 2f. the wall chord: thin walls are punched through, thick ones stay solid ---------- */
console.log('wall chord (shotPath penetration):');
{
  // a 0.3 m shed at z −10…−10.3: the rifle (budget 0.45) punches it, the shotgun (0) does not, the sniper (1.2) spends less
  const shed = (x, z) => (Math.abs(x) < 3 && z > -10.3 && z < -10) ? { top: 12 } : null;
  const P = makePhysics(shed, () => 0);
  const sp = P.shotPath([0, 1.7, 0], [0, 0, -1], 160, 560, 0.0012, 0.45);
  ok(sp.dist === 160 && sp.walls.length === 1 && near(sp.walls[0].f, 1 - 0.3 / 0.45, 0.03), 'the rifle punches the 0.3 m shed: the chord is spent, the factor left', JSON.stringify(sp.walls));
  ok(near(sp.walls[0].at, 10.3, 0.05), 'the exit face is the far side of the shed', String(sp.walls[0] && sp.walls[0].at));
  const sp0 = P.shotPath([0, 1.7, 0], [0, 0, -1], 160, 380, 0.01, 0);
  ok(near(sp0.dist, 10, 0.05) && !sp0.walls.length, 'the shotgun (budget 0) dies at the entry face', String(sp0.dist));
  const sp2 = P.shotPath([0, 1.7, 0], [0, 0, -1], 160, 820, 0.00013, 1.2);
  ok(sp2.dist === 160 && near(sp2.walls[0].f, 1 - 0.3 / 1.2, 0.03), 'the sniper spends less of its bigger budget', JSON.stringify(sp2.walls));
  ok(near(P.freePath([0, 1.7, 0], [0, 0, -1], 160), 10, 0.05), 'the sight line (no budget) still sees a solid wall');
  // a 0.6 m wall is past the rifle budget, 0.7 m past the machine gun's — both die at the face; 0.5 m the MG punches
  const thick = (x, z) => (Math.abs(x) < 3 && z > -10.6 && z < -10) ? { top: 12 } : null;
  ok(near(makePhysics(thick, () => 0).shotPath([0, 1.7, 0], [0, 0, -1], 160, 560, 0.0012, 0.45).dist, 10, 0.05), 'a 0.6 m wall is past the rifle budget: dies at the face');
  const over = (x, z) => (Math.abs(x) < 3 && z > -10.7 && z < -10) ? { top: 12 } : null;
  ok(near(makePhysics(over, () => 0).shotPath([0, 1.7, 0], [0, 0, -1], 140, 560, 0.001, 0.6).dist, 10, 0.05), 'a 0.7 m wall is past the machine gun budget too');
  const half = (x, z) => (Math.abs(x) < 3 && z > -10.5 && z < -10) ? { top: 12 } : null;
  const spm = makePhysics(half, () => 0).shotPath([0, 1.7, 0], [0, 0, -1], 140, 560, 0.001, 0.6);
  ok(spm.dist === 140 && near(spm.walls[0].f, 1 - 0.5 / 0.6, 0.03), 'the machine gun punches 0.5 m of its 0.6 budget', JSON.stringify(spm.walls));
  // the budget carries across two sheds: 0.2 + 0.2 = 0.4 of 0.45 — through both, barely; a third stops the bullet
  const two = (x, z) => ((Math.abs(x) < 3 && z > -8.2 && z < -8) || (Math.abs(x) < 3 && z > -12.2 && z < -12)) ? { top: 12 } : null;
  const spt = makePhysics(two, () => 0).shotPath([0, 1.7, 0], [0, 0, -1], 160, 560, 0.0012, 0.45);
  ok(spt.dist === 160 && spt.walls.length === 2 && near(spt.walls[1].f, 1 - 0.4 / 0.45, 0.04), 'two thin sheds: the budget carries, the factors multiply down', JSON.stringify(spt.walls));
}
{
  // the game: a target behind the shed is hit, weakly and later; the kill carries the bullet's own vector
  let clock = 1e6;
  const shed = (x, z) => (Math.abs(x) < 3 && z > -10.3 && z < -10) ? { top: 12 } : null;
  const g = createGame({ world: flatWorld(shed), area: { cx: 0, cz: 0 }, now: () => clock, name: 'chord' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -20, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -20, yaw: 0, pitch: 0 });
  const L = Math.hypot(0.6, 20), d = [0, -0.6 / L, -20 / L];
  msg(A, { t: 'shoot', w: 0, rays: [d] });
  const len = A.last('shot').rays[0][3];
  ok(len > 30, 'the tracer flies through the shed: the downward aim ends on the ground far beyond, not at the shed face', String(len));
  clock += 50; g.stepBullets();
  ok(A.all('bhit').length === 0, 'at 50 ms the punched bullet is still in the air (the wall cut its speed)');
  clock += 100; g.stepBullets();
  const f = 1 - 0.3 / 0.45, want = dmgAt(0, 20 - MUZZLE, 0, f);
  const h = A.last('hit'), bh = A.last('bhit');
  ok(h && h.dmg === want && want > 0 && want < dmgAt(0, 20 - MUZZLE), `the target behind the shed takes the punched damage (${want})`, JSON.stringify(h));
  ok(bh && bh.bd && near(Math.hypot(...bh.bd), 1, 0.01) && bh.bd[2] < -0.9, 'bhit carries the bullet tangent at the hit', JSON.stringify(bh && bh.bd));
  ok(bh && bh.vf < 0.4 && bh.vf > 0.2, 'bhit carries the speed fraction left after drag and stone', String(bh && bh.vf));
  const hu = B.last('hurt');
  ok(hu && hu.bd && hu.vf != null, 'the hurt tells the victim the blow\'s vector too', JSON.stringify(hu && hu.bd));
  // the kill: pre-damage the target, one sniper shot through the shed finishes it — the kill feed carries bd and zone
  B.handle.player.hp = 5;
  clock += 1400;
  arm(A, 2);
  msg(A, { t: 'shoot', w: 2, rays: [d] });
  clock += 300; g.stepBullets();
  const kill = A.all('kill').find(m => m.victim === B.handle.player.id);
  ok(kill && kill.bd && kill.zone === 0 && near(Math.hypot(...kill.bd), 1, 0.01), 'the kill carries the bullet vector and the zone for the ragdoll', JSON.stringify(kill && kill.bd));
  g.stop();
}

/* ---------- 2g. the grenade bounces about the crossed edge's normal, not the world axes ---------- */
console.log('grenade: the edge normal bounce:');
{
  // a 45° face: the diamond |x−2| + |z| < 1; a grenade along +x at z 0.2 meets the face (1,0)→(2,1)
  const ring = new Float32Array([2, -1, 3, 0, 2, 1, 1, 0]);
  const dia = (x, z) => (Math.abs(x - 2) + Math.abs(z) < 1) ? { top: 12, ring } : null;
  const P = makePhysics(dia, () => 0);
  const n = { p: [0, 1, 0.2], v: [10, 0, 0] };
  let ev = null;
  for (let i = 0; i < 30 && !ev; i++) { P.stepNade(n, 1 / 30, 18); if (n.bounce) ev = n.bounce; }
  ok(ev && ev.kind === 'wall', 'the diagonal face reports a wall bounce', JSON.stringify(ev));
  ok(n.v[2] > 2 && n.v[0] > 0, 'the bounce slides along the 45° face (+z), not back along −x', JSON.stringify(n.v));
  ok(!dia(n.p[0], n.p[2]), 'the grenade stands outside the outline after the bounce', JSON.stringify(n.p));
  // the normal takes 0.4, the tangent keeps 0.7: |v'| = sqrt((0.7·vt)² + (0.4·vn)²) of the 45° hit
  ok(near(Math.hypot(n.v[0], n.v[2]), Math.hypot(0.7 * 7.071, 0.4 * 7.071), 0.35), 'the bounce keeps the agreed numbers (0.4 normal, 0.7 tangent)', String(Math.hypot(n.v[0], n.v[2])));
}

/* ---------- 2h. the blast judges two rays: chest and head ---------- */
console.log('blast: two rays, chest and head:');
{
  // a low wall hides the chest but not the head: half the blow and half the push, not a bunker
  let clock = 1e6;
  const low = (x, z) => (Math.abs(x) < 4 && z > -5.5 && z < -5) ? { top: 2.2 } : null;   // solid under gr + 1.2 m: the chest ray (0.91…0.96 m there) is hidden, the head ray (1.40…1.50 m) passes over
  const g = createGame({ world: flatWorld(low), area: { cx: 0, cz: 0 }, now: () => clock, name: 'cover' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -6, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -6, yaw: 0, pitch: 0 });
  msg(A, { t: 'throw', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });
  for (let i = 0; i < 90; i++) { clock += 1000 / 30; g.stepNades(); }
  const d = Math.hypot(1.7 - 0.41 * 1.7 - 0.42, 6), want = Math.round(NADE.dmg * (1 - d / NADE.radius) * 0.5);
  const hu = B.last('hurt');
  ok(hu && hu.hp === 100 - want, `the corner hides the chest only: half the damage (${want})`, JSON.stringify(hu));
  ok(B.last('push'), 'the half-covered target is still pushed');
  g.stop();
}

/* ---------- 2i. the drag: v²/v0² damage, longer flight, one formula ---------- */
console.log('bullet drag (v(s), damage, flight time):');
{
  ok(near(dragVel(160, 560, 0.0012), 560 * Math.exp(-0.0012 * 160), 1e-9), 'v(s) = v0·e^(−k·s) — the integral of v0/(1+k·v0·t)');
  ok(near(dragDist(dragTime(100, 560, 0.0012), 560, 0.0012), 100, 1e-6), 'dragDist and dragTime are inverses');
  ok(near(bulletDrop(20, 560), bulletDrop(20, 560, 0), 1e-12) && near(bulletDrop(20, 560, 0), 0.5 * BULLET_G * (20 / 560) ** 2, 1e-12), 'k = 0 keeps the old no-drag arc');
  ok(bulletDrop(400, 820, 0.00013) > bulletDrop(400, 820), 'the drag lengthens the flight and deepens the drop');
  const t = bulletDir([0, 0, -1], 400, 820, 0.00013);
  ok(t[1] < -0.006 && near(Math.hypot(...t), 1, 1e-9), 'the tangent bends down by g·t(s)/v(s) and stays unit', JSON.stringify(t));
  ok(near(Math.exp(-2 * WEAPONS[0].drag * 160), 0.68, 0.02), 'the rifle keeps ~68 % damage at its 160 m range');
  ok(near(Math.exp(-2 * WEAPONS[1].drag * 45), 0.4, 0.02), 'the shotgun keeps ~40 % at 45 m, as the old falloff did');
  ok(near(Math.exp(-2 * WEAPONS[3].drag * 90), 0.7, 0.02), 'the pistol keeps ~70 % at 90 m');
  ok(near(Math.exp(-2 * WEAPONS[4].drag * 140), 0.75, 0.02), 'the machine gun keeps ~75 % at 140 m');
}
{
  // the flight time: the 56 m rifle shot lands after ~102 ms now, not the 99 ms of the constant speed
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'dragtime' });
  const A = seat(g, conn()), B = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -56, yaw: 0 });
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  msg(B, { t: 'state', x: 0, y: 1.7, z: -56, yaw: 0, pitch: 0 });
  const L = Math.hypot(0.6, 56), d = [0, -0.6 / L, -56 / L];
  msg(A, { t: 'shoot', w: 0, rays: [d] });
  clock += 90; g.stepBullets();
  ok(A.all('bhit').length === 0, 'at 90 ms the dragged bullet has not reached 56 m yet');
  clock += 30; g.stepBullets();
  ok(A.all('bhit').length === 1, 'by 120 ms it has');
  g.stop();
}

/* ---------- 2k. the loadout: two equipped guns, a ten-slot backpack, swapping ---------- */
console.log('the loadout (two guns + the backpack):');
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'loadout' });
  const A = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  const p = A.handle.player;
  ok(p.loadout.length === 2 && p.loadout.join() === '0,3', 'the player spawns with two guns equipped (rifle + pistol)', p.loadout.join());
  ok(p.pack.length === 10 && p.pack.filter(w => w !== null).length === 3 && p.pack.filter(w => w === null).length === 7, 'the backpack has ten cells: three guns and seven empty', JSON.stringify(p.pack));
  const sp = A.last('spawn');
  ok(sp && Array.isArray(sp.loadout) && Array.isArray(sp.pack), 'the spawn message carries the loadout and the pack');
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, w: 1 });
  ok(p.wep === p.loadout[0], 'a state claiming a pack gun falls back to an equipped one', String(p.wep));
  // swap the shotgun (pack) into slot 0: the rifle drops into the cell the shotgun left
  msg(A, { t: 'swap', w: 1, slot: 0 });
  ok(p.loadout[0] === 1 && p.pack.includes(0) && !p.pack.includes(1), 'the swap exchanges the pack gun with the equipped slot', p.loadout.join() + ' / ' + JSON.stringify(p.pack));
  ok(A.last('inv') && A.last('inv').loadout[0] === 1, 'the swap is reported in the inv message');
  ok(new Set([...p.loadout, ...p.pack.filter(w => w !== null)]).size === 5, 'every gun lives in exactly one place after the swap');
  msg(A, { t: 'swap', w: 1, slot: 1 });   // already equipped: ignored
  ok(p.loadout[1] === 3, 'swapping an already-equipped gun does nothing', p.loadout.join());
  msg(A, { t: 'swap', w: 9, slot: 0 });   // not a weapon: ignored
  ok(p.loadout[0] === 1, 'swapping an unknown index does nothing');
  // the loadout survives a death: die, respawn, still the swapped guns
  p.hp = 0; p.alive = false; p.diedAt = clock;
  clock += 3100;
  msg(A, { t: 'respawn' });
  ok(p.alive && p.loadout[0] === 1 && p.pack.includes(0), 'the loadout and the pack survive the respawn', p.loadout.join());
  g.stop();
}

/* ---------- 2l. the ready belt and the backpack stores ---------- */
console.log('the ready belt and the backpack stores:');
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'belt' });
  const A = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  const p = A.handle.player;
  clock += 3000;
  ok(INV.medMax === 3 && INV.nadeMax === 2, 'the belt caps: three kits, two grenades of a kind');
  ok(p.nades === 2 && p.meds === 0, 'the spawn belt: two grenades ready, no kits', p.nades + '/' + p.meds);
  // place an item at the player's feet and let the pickup tick take it
  const pick = kind => { const it = [...g.items.values()].find(i => i.kind === kind); it.x = p.x; it.z = p.z; it.active = true; g.stepItems(); return it; };
  pick('med'); pick('med'); pick('med');
  ok(p.meds === 3, 'three kits are ready (the belt cap)', String(p.meds));
  pick('med'); pick('med');
  ok(p.meds === 3 && p.pack.filter(k => k === 'med').length === 2, 'the surplus kits ride in the pack', JSON.stringify(p.pack));
  ok(A.all('took').some(m => m.kind === 'med' && m.where === 'pack'), 'a stored pickup is reported as going to the pack');
  p.hp = 40;
  msg(A, { t: 'use', kind: 'med' });
  ok(p.hp === 90 && p.meds === 3 && p.pack.filter(k => k === 'med').length === 1, 'a spent kit is replaced from the pack at once', p.hp + '/' + p.meds);
  pick('nade'); pick('nade');   // the belt is full: both go to the pack
  ok(p.nades === 2 && p.pack.filter(k => k === 'nade').length === 2, 'the surplus grenades ride in the pack', JSON.stringify(p.pack));
  msg(A, { t: 'throw', dx: 0, dy: 0.3, dz: -1 });
  ok(p.nades === 2 && p.pack.filter(k => k === 'nade').length === 1, 'a thrown grenade is replaced from the pack', p.nades + ' / ' + JSON.stringify(p.pack));
  ok(A.last('inv') && A.last('inv').nades === 2 && A.last('inv').pack.filter(k => k === 'nade').length === 1, 'the throw reports the refilled belt and the pack');
  // the sights ride in the pack: mounting frees the cell, taking off returns the sight
  const free0 = p.pack.filter(k => k === null).length;
  pick('sight');
  ok(p.pack.includes('sight') && p.attach[0] === null, 'the picked sight rides in the pack');
  ok(A.last('inv').sights.sight === 1, 'the inv message counts the loose sight from the pack');
  msg(A, { t: 'attach', w: 0, kind: 'sight' });
  ok(p.attach[0] === 'sight' && !p.pack.includes('sight') && p.pack.filter(k => k === null).length === free0, 'mounting takes the sight out of the pack and frees the cell');
  msg(A, { t: 'attach', w: 0, kind: null });
  ok(p.attach[0] === null && p.pack.includes('sight'), 'taking off returns the sight to the pack');
  msg(A, { t: 'attach', w: 0, kind: 'sight' });
  pick('optic');
  msg(A, { t: 'attach', w: 0, kind: 'optic' });
  ok(p.attach[0] === 'optic' && p.pack.includes('sight') && !p.pack.includes('optic'), 'swapping the sight returns the old one to the cell the new one left');
  const sIt = pick('sight');   // one of a kind is owned (in the pack): the second is refused
  ok(sIt.active && p.pack.filter(k => k === 'sight').length === 1, 'a second collimator is refused while one is owned');
  // a full pack refuses the take-off
  let guard = 0;
  while (p.pack.includes(null) && guard++ < 12) pick('med');
  ok(!p.pack.includes(null), 'the pack is full of stored kits', JSON.stringify(p.pack));
  msg(A, { t: 'attach', w: 0, kind: null });
  ok(p.attach[0] === 'optic' && A.last('chat') && /Рюкзак полон/.test(A.last('chat').text), 'a full pack refuses the take-off with a notice');
  // the ready message takes a stored item when the belt has room
  const mBefore = p.pack.filter(k => k === 'med').length;
  p.meds = 1;
  msg(A, { t: 'ready', kind: 'med' });
  ok(p.meds === 2 && p.pack.filter(k => k === 'med').length === mBefore - 1, 'the ready message moves a stored kit to the belt');
  // the respawn tops the belt up from the pack
  p.hp = 0; p.alive = false; p.diedAt = clock;
  clock += 3100;
  msg(A, { t: 'respawn' });
  ok(p.alive && p.meds === 3 && p.nades === 2, 'the respawn tops the belt up from the pack', p.meds + '/' + p.nades);
  ok(p.attach[0] === 'optic' && p.pack.includes('sight'), 'the mounted sight and the stored one survive the death');
  g.stop();
}

/* ---------- 2m. the smoke and the napalm: zones, belts, the fire's damage, the bots' reactions ---------- */
console.log('smoke and napalm (zones):');
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'zones' });
  const A = seat(g, conn()), B = seat(g, conn()), C = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Мишень', team: 1, x: 0, z: -2, yaw: 0 });
  msg(C, { t: 'join', name: 'Товарищ', team: 0, x: 2, z: 0, yaw: 0 });
  const p = A.handle.player, q = B.handle.player, r = C.handle.player;
  clock += 3000;
  for (const c of [A, B, C]) msg(c, { t: 'state', x: c.handle.player.x, y: 1.7, z: c.handle.player.z, yaw: 0, pitch: 0 });
  ok(p.nades === 2 && p.smokes === 1 && p.napalms === 1, 'the spawn belt: two frags, one smoke, one napalm', p.nades + '/' + p.smokes + '/' + p.napalms);
  // the smoke: a screen of radius 6, no damage, out after its 12 s
  msg(A, { t: 'throw', kind: 'smoke', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });
  ok(p.smokes === 0, 'the smoke throw spends the smoke');
  ok(A.last('nade') && A.last('nade').kind === 'smoke' && A.last('nade').fuse === 2000, 'the smoke flies with its own kind and fuse');
  for (let i = 0; i < 70; i++) { clock += 1000 / 30; g.stepNades(); }   // past the 2 s fuse
  const sz = A.last('zone');
  ok(sz && sz.kind === 'smoke' && sz.r === 6 && g.zones.size === 1, 'the smoke lays a screen of radius 6', JSON.stringify(sz));
  ok(q.hp === 100 && r.hp === 100 && !A.all('boom').length, 'the smoke neither hurts nor blasts');
  clock += 12100; g.stepNades();
  ok(g.zones.size === 0 && A.last('zoneEnd'), 'the screen is out after its 12 s');
  // the napalm: a burning patch of radius 4 — the enemy and the thrower burn, the teammate does not
  msg(A, { t: 'throw', kind: 'napalm', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });
  ok(p.napalms === 0, 'the napalm throw spends the napalm');
  for (let i = 0; i < 70; i++) { clock += 1000 / 30; g.stepNades(); }
  const fz = A.last('zone');
  ok(fz && fz.kind === 'fire' && fz.r === 4, 'the napalm lays a burning patch of radius 4', JSON.stringify(fz));
  const hpB = q.hp, hpA = p.hp;
  for (let i = 0; i < 30; i++) { clock += 1000 / 30; g.stepNades(); }   // a second in the fire
  ok(q.hp < hpB && q.hp >= hpB - 40, 'the enemy standing in the fire burns (~30 HP/s)', hpB + '->' + q.hp);
  ok(p.hp < hpA, 'the thrower burns in their own napalm too', hpA + '->' + p.hp);
  ok(r.hp === 100, 'the teammate walks through the fire unburnt');
  ok(B.all('hurt').some(m => m.fire), 'the burn is reported as fire (the page shows the orange edge, no aim punch)');
  for (let i = 0; i < 240; i++) { clock += 1000 / 30; g.stepNades(); }   // the rest of the 8 s
  ok(!q.alive && A.all('kill').some(m => m.w === 11), 'the fire kills and the kill feed names the napalm (w 11)');
  ok(g.zones.size === 0, 'the patch is out after its 8 s');
  // the belts of the new kinds: pickup, surplus in the pack, refill, the ready message
  // (the thrower burnt in their own fire above — come back to life to pick the items up)
  if (!p.alive) { p.diedAt = clock; clock += 3100; msg(A, { t: 'respawn' }); clock += 3000; }
  const pick = kind => { const it = [...g.items.values()].find(i => i.kind === kind); it.x = p.x; it.z = p.z; it.active = true; g.stepItems(); return it; };
  p.smokes = 0;
  pick('smoke'); pick('smoke'); pick('smoke');
  ok(p.smokes === 2 && p.pack.filter(k => k === 'smoke').length === 1, 'the smoke belt caps at 2, the surplus rides in the pack', JSON.stringify(p.pack));
  msg(A, { t: 'throw', kind: 'smoke', dx: 0, dy: 0.3, dz: -1 });
  ok(p.smokes === 2 && p.pack.filter(k => k === 'smoke').length === 0, 'a thrown smoke is replaced from the pack');
  p.napalms = 0; pick('napalm');
  ok(p.napalms === 1, 'the napalm pickup goes to the belt');
  msg(A, { t: 'ready', kind: 'napalm' });
  ok(p.napalms === 1, 'the ready message refuses a full belt');
  g.stop();
}
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'zonebots' });
  const A = seat(g, conn());
  msg(A, { t: 'join', name: 'Стрелок', team: 0, x: 0, z: 0, yaw: 0 });
  const bot = g.addBot('easy');
  bot.x = 0; bot.z = -15; bot.y = 1.7; bot.hist = [];
  const p = A.handle.player;
  clock += 3000;
  msg(A, { t: 'state', x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 });
  g.stepBots(0.3); g.stepBots(0.3);
  ok(bot.bot.target === p.id, 'the bot sees the enemy across the open square');
  msg(A, { t: 'throw', kind: 'smoke', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });
  for (let i = 0; i < 70; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(g.zones.size === 1, 'the screen lies between the bot and the enemy');
  bot.bot.look = 0; g.stepBots(0.3); bot.bot.look = 0; g.stepBots(0.3);
  ok(bot.bot.target === 0, 'the smoke hides the enemy from the bot');
  clock += 1000;
  msg(A, { t: 'throw', kind: 'napalm', dx: 0, dy: -1, dz: 0, sp: NADE.minSpeed });
  for (let i = 0; i < 70; i++) { clock += 1000 / 30; g.stepNades(); }
  ok([...g.zones.values()].some(z => z.kind === 'fire'), 'the napalm burns at the square');
  bot.x = 0.5; bot.z = 0.5; bot.y = 1.7; bot.bot.target = 0;
  g.stepBots(0.1);
  ok(Math.hypot(bot.x, bot.z) > 0.6, 'the bot runs out of the fire before anything else', bot.x.toFixed(2) + '/' + bot.z.toFixed(2));
  const hp0 = bot.hp;
  for (let i = 0; i < 30; i++) { clock += 1000 / 30; g.stepNades(); }
  ok(bot.hp < hp0, 'the fire burns the bot too');
  g.stop();
}

/* ---------- 2j. the player cap ---------- */
console.log('the player cap (64):');
{
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'cap' });
  ok(g.health().max === 64, 'the server holds up to 64 players');
  const bots = [];
  for (let i = 0; i < 64; i++) bots.push(g.addBot('easy'));
  ok(bots.every(b => b), '64 bots fit');
  ok(g.addBot('easy') === null, 'the 65th bot is refused');
  ok(new Set(bots.map(b => b.name)).size === 64, 'the bot names stay unique past the 16-name list');
  const H = seat(g, conn());
  msg(H, { t: 'join', name: 'Игрок', team: 0, x: 0, z: 0, yaw: 0 });
  ok(H.last('hello') && g.health().players === 1 && g.health().bots === 63, 'a human joins the full server: a bot steps aside');
  g.stop();
  // a small server of two humans and no bots: the third join is refused for real
  const g2 = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'full', maxPlayers: 2 });
  const A = seat(g2, conn()), B = seat(g2, conn()), C = seat(g2, conn());
  msg(A, { t: 'join', name: 'Первый', team: 0, x: 0, z: 0, yaw: 0 });
  msg(B, { t: 'join', name: 'Второй', team: 1, x: 0, z: 0, yaw: 0 });
  msg(C, { t: 'join', name: 'Третий', team: 0, x: 0, z: 0, yaw: 0 });
  ok(C.last('full') && !C.last('hello'), 'with no bots to step aside the server is full');
  g2.stop();
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

/* ---------- 3b. bot tactics: roles, weapons, footwork, cover, reaction (controlled clock) ---------- */
console.log('bot tactics (roles, weapons, footwork, cover, reaction):');
{
  // roles: a squad is born with different favourite guns, each in hand from the first step
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, arena: { cx: 0, cz: 0, r: 80, bases: [base(0, -40, 5), base(0, 40, 5)] }, mode: 'team', now: () => clock, name: 'roles' });
  const bots = []; for (let i = 0; i < 24; i++) bots.push(g.addBot(i % 2 ? 'hard' : 'normal'));
  const roles = new Set(bots.map(b => b.bot.role));
  ok(roles.size >= 3, 'a squad carries at least three different favourite guns', [...roles].join(','));
  ok(bots.every(b => b.wep === b.bot.role), 'every bot spawns holding its favourite gun');
  g.stop();
}
{
  // every role fights with its own gun (forced roles, free-for-all so all distances occur), and the footwork shows
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, arena: { cx: 0, cz: 0, r: 80, bases: [[[0, -60]], [[0, 60]]] }, mode: 'ffa', now: () => clock, name: 'guns' });
  const S = seat(g, conn()); msg(S, { t: 'join', name: 'Р—СЂРёС‚РµР»СЊ', team: 0, x: 0, z: 0, yaw: 0 });
  const bots = [];
  for (let role = 0; role < 5; role++) { const b = g.addBot('hard'); b.bot.role = role; b.wep = role; b.bot.switchAt = 0; const a = role / 5 * 6.283; b.x = Math.cos(a) * 30; b.z = Math.sin(a) * 30; b.y = 1.7; bots.push(b); }
  clock += 3000;
  const shots = bots.map(() => [0, 0, 0, 0, 0]); let idx = 0, air = 0, crouch = 0, reloads = 0; const lastReload = bots.map(() => 0);
  for (let i = 0; i < 50 * 20; i++) {
    clock += 50; g.stepBots(0.05); g.stepBullets(); g.stepNades(); g.stepItems();
    const sm = S.all('shot'); for (; idx < sm.length; idx++) { const bi = bots.findIndex(b => b.id === sm[idx].id); if (bi >= 0) shots[bi][sm[idx].w]++; }
    bots.forEach((b, bi) => { if (!b.alive) return; if (b.y - (b.eye || 1.7) > 0.3) air++; if ((b.eye || 1.7) < 1.5) crouch++; if (b.reloadDone > lastReload[bi]) { reloads++; lastReload[bi] = b.reloadDone; } });
  }
  // a safe tactical reload, deterministic: a bot parked out of everyone's sight with a nearly empty magazine
  const rb = bots[0]; rb.alive = true; rb.hp = 100; rb.x = 200; rb.z = 200; rb.y = 1.7;
  rb.bot.target = 0; rb.bot.look = 5; rb.bot.alert = null; rb.bot.retreatUntil = 0; rb.bot.lastSeen = null;
  rb.wep = rb.bot.role; rb.mag[rb.bot.role] = 1; rb.reserve[rb.bot.role] = 50; rb.reloadDone = 0;
  for (let i = 0; i < 4; i++) { clock += 50; g.stepBots(0.05); g.stepItems(); }
  const safeReloaded = rb.reloadDone > clock;
  g.stop();
  bots.forEach((b, i) => ok(shots[i][b.bot.role] > 0, `the ${['rifle', 'shotgun', 'sniper', 'pistol', 'machine gun'][i]} role fires its own gun`, shots[i].join('/')));
  ok(air > 0, 'a bot dodge-hops in a fight (air time)', String(air));
  ok(crouch > 0, 'a bot crouches to steady a long gun', String(crouch));
  ok(safeReloaded, 'a bot reloads when safe with a nearly empty magazine', `natural reloads in the fight: ${reloads}`);
}
{
  // an unseen attacker: a bot shot from beyond its sight remembers the blow, turns on it and is alerted
  let clock = 1e6;
  const g = createGame({ world: flatWorld(), area: { cx: 0, cz: 0 }, now: () => clock, name: 'alert' });
  const S = seat(g, conn()); msg(S, { t: 'join', name: 'Р—СЂРёС‚РµР»СЊ', team: 0, x: 300, z: 300, yaw: 0 });   // the spectator stands aside, out of the line of fire
  const B = seat(g, conn()); msg(B, { t: 'join', name: 'РЎС‚СЂРµР»РѕРє', team: 1, x: 0, z: 140, yaw: 0 });
  const bot = g.addBot('hard'); bot.team = 0; bot.x = 0; bot.z = 0; bot.y = 1.7; bot.yaw = 0;   // looks toward -z; the shooter is behind at +z, 140 m > sight 130
  clock += 3000;
  for (let i = 0; i < 4; i++) { clock += 50; g.stepBots(0.05); }   // let the bot settle and take its full hp into lastHp before the blow
  msg(B, { t: 'state', x: 0, y: 1.7, z: 140, yaw: 0, pitch: 0 });
  const bid = bot.id, L = 140;
  msg(B, { t: 'shoot', w: 0, rays: [[0, (1.1 - 1.7) / L, -140 / L, L, bid]] });
  for (let i = 0; i < 12; i++) { clock += 50; g.stepBullets(); }   // the bullet flies the 140 m (~0.25 s)
  ok(bot.bot.hurtFrom && bot.bot.hurtFrom.id === B.handle.player.id, 'the bot remembers who hit it');
  ok(bot.hp < 100, 'the unseen shot lands', String(bot.hp));
  const yaw0 = bot.yaw;
  for (let i = 0; i < 30; i++) { clock += 50; g.stepBots(0.05); }   // 1.5 s: the bot turns on the alert
  ok(bot.bot.alert, 'the bot is alerted by the unseen attacker');
  ok(Math.abs(bot.yaw - yaw0) > 0.5, 'the bot turns toward the blow', `${yaw0.toFixed(2)} -> ${bot.yaw.toFixed(2)}`);
  g.stop();
}
{
  // reloading a slow gun with the enemy close: the bot falls back behind the nearest wall and crouches there
  let clock = 1e6;
  const house = (x, z) => (x > 2 && x < 10 && z > -3 && z < 3) ? { top: 9 } : null;   // a wall to the side: the bot can step behind it straight on
  const g = createGame({ world: flatWorld(house), arena: { cx: 0, cz: 0, r: 60, bases: [base(0, -25, 4), base(0, 25, 4)] }, mode: 'team', now: () => clock, name: 'cover' });
  const S = seat(g, conn()); msg(S, { t: 'join', name: 'Р—СЂРёС‚РµР»СЊ', team: 0, x: 0, z: 0, yaw: 0 });
  const E = seat(g, conn()); msg(E, { t: 'join', name: 'Р’СЂР°Рі', team: 1, x: 0, z: -20, yaw: 0 });
  const bot = g.addBot('hard'); bot.team = 0; bot.x = 0; bot.z = 0; bot.y = 1.7; bot.wep = 4; bot.bot.role = 4; bot.reloadW = 4; bot.mag[4] = 1;
  clock += 3000;
  msg(E, { t: 'state', x: 0, y: 1.7, z: -20, yaw: 0, pitch: 0 });
  bot.bot.target = E.handle.player.id; bot.bot.react = 0; bot.bot.look = 1;   // engaged at once: the gun fires its last round and reloads under the enemy's nose
  let retreated = false, covered = false, crouched = false;
  for (let i = 0; i < 80; i++) { clock += 50; g.stepBots(0.05); g.stepItems(); if (bot.bot.retreatUntil > clock) retreated = true; if (bot.bot.cover) covered = true; if ((bot.eye || 1.7) < 1.5) crouched = true; }
  ok(retreated, 'the bot falls back while its slow gun reloads with the enemy close');
  ok(covered, 'the bot finds a wall to hide behind');
  ok(crouched, 'the bot crouches behind the cover');
  g.stop();
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall ${pass} tests passed`);
process.exit(fail ? 1 : 0);
