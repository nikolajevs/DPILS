/* The physics of the shots and the grenades, for the server and for the training game in the page: the same rules over
   two functions the caller brings, which house stands at a point (with its height in .top) and how high the ground is. */
import { NADE, bulletDrop, segToSegment } from './combat.mjs';
export function makePhysics(buildingAt, ground) {
  // how far from o along d (unit) a shot flies before the ground, a hill slope or a roof line stops it; len if it does
  // not. The scan steps 0.2 m all the way (the old 1.5 m coarse step jumped clean over a half-metre shed at distance,
  // and a wall the shooter leans on must stop the shot too); 0.2 m is the smallest penetration budget, so no punchable
  // wall is skipped. Once a step is blocked, the face is bisected to ~3 mm, so a hit just in front of the wall counts
  // and one just behind it does not (the grace is HIT.grace in combat.mjs). An origin already inside stone returns 0:
  // the shot dies there. The samples are grid lookups (world.mjs), so the fine step costs little.
  // v (m/s), when given, bends the path down by the bullet's gravity and drag (combat.mjs bulletDrop): the scan follows
  // the same arc the bullet flies, so a long shot meets the ground sooner than the straight line would. Sight lines and
  // blast rays pass no v and no budget: for them any wall is solid.
  // pen (m, shotPath only): the weapon's penetration budget. A building is not a solid column — the chord the arc cuts
  // through its outline is measured (walk the contour until buildingAt lets go), and a chord under the budget is punched
  // through: the bullet flies on, its speed cut by (1 − chords/pen). Too thick a chord dies at the entry face; the ground
  // always stops. Returns { dist, spent, walls: [{ at, f }] } — at: the exit face, f: the speed factor left after it.
  function scan(o, d, len, v, k, pen) {
    const walls = []; let spent = 0, budget = pen || 0;
    const block = t => {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t - (v ? bulletDrop(t, v, k) : 0), z = o[2] + d[2] * t, gr = ground(x, z, y);
      if (y < gr) return 1;   // the ground itself, a hill slope included
      const b = buildingAt(x, z, y);   // solid at this height: a canopy on posts is open at the ground, its roof still stops
      return (b && y < gr + (b.top || 12) - 1) ? 2 : 0;
    };
    if (block(0)) return { dist: 0, spent, walls };
    let prev = 0, t = 0.2;
    while (t < len) {
      const bl = block(t);
      if (!bl) { prev = t; t += 0.2; continue; }
      let lo = prev, hi = t;
      for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (block(m)) hi = m; else lo = m; }
      if (bl === 1 || !budget) return { dist: hi, spent, walls };   // the ground, or no budget: dies at the face
      // the chord: walk the arc through the outline until it lets go (a touching neighbour is one thick wall)
      let exit = -1, gHit = -1;
      for (let s = hi + 0.25; s < len; s += 0.25) {
        const b2 = block(s);
        if (b2 === 1) { gHit = s; break; }
        if (!b2) { exit = s; break; }
      }
      if (gHit >= 0) {   // the ground catches the arc inside the outline
        let lo2 = gHit - 0.25, hi2 = gHit;
        for (let i = 0; i < 6; i++) { const m = (lo2 + hi2) / 2; if (block(m) === 1) hi2 = m; else lo2 = m; }
        return { dist: hi2, spent, walls };
      }
      if (exit < 0) return { dist: hi, spent, walls };   // the outline holds past the range: no confirmed exit, no punch
      let lo2 = exit - 0.25, hi2 = exit;
      for (let i = 0; i < 6; i++) { const m = (lo2 + hi2) / 2; if (block(m)) lo2 = m; else hi2 = m; }
      const chord = hi2 - hi;
      if (chord >= budget - 1e-6) return { dist: hi, spent, walls };   // too thick: the bullet dies at the entry face
      spent += chord; budget -= chord;
      walls.push({ at: hi2, f: 1 - spent / pen });
      prev = hi2; t = hi2 + 0.2;   // out of the wall: scan on, the budget carries to the next house
    }
    return { dist: len, spent, walls };
  }
  const freePath = (o, d, len, v) => scan(o, d, len, v, 0, 0).dist;
  const shotPath = (o, d, len, v, k, pen) => scan(o, d, len, v, k || 0, pen || 0);
  // the first edge of the outline r the segment a→b crosses: { t, x, z, nx, nz } (the normal faces the motion), or null
  function ringHit(r, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az; let best = null;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const cx = r[j], cz = r[j + 1], ex = r[i] - cx, ez = r[i + 1] - cz;
      const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
      const wx = cx - ax, wz = cz - az;
      const t = (wx * ez - wz * ex) / den, s = (wx * dz - wz * dx) / den;
      if (t < 0 || t > 1 || s < 0 || s > 1 || (best && t >= best.t)) continue;
      const L = Math.hypot(ex, ez); let nx = ez / L, nz = -ex / L;
      if (nx * dx + nz * dz > 0) { nx = -nx; nz = -nz; }
      best = { t, x: ax + dx * t, z: az + dz * t, nx, nz };
    }
    return best;
  }
  // one step of a grenade n = { p: [x, y, z], v: [vx, vy, vz] }: gravity, bounces on the ground, the roofs and the walls of
  // houses. On a slope the bounce reflects about the ground's normal and the settled grenade rolls downhill, so a rampart
  // throws it back the way it should instead of straight up. A real touch sets n.bounce = { sp, kind } (the impact speed and
  // 'ground' | 'roof' | 'wall' | 'body') for the page to clink; flat ground keeps exactly the old feel.
  // bodies, when given, are the living players the grenade can bounce off: { x, y, z, eye } (y at the eyes), each a capsule
  // from the feet to the crown. The caller leaves the thrower out — one's own body does not stop one's own grenade. The
  // bounce is physical only: no damage, no push; the server reports it ('nbounce') so the page can resync its copy.
  function stepNade(n, dt, g, bodies) {
    const [px, py, pz] = n.p; n.v[1] -= g * dt;
    let x = px + n.v[0] * dt, y = py + n.v[1] * dt, z = pz + n.v[2] * dt;
    const b = buildingAt(x, z, y), gr = ground(x, z, y);
    n.bounce = null;
    if (b) {
      const top = gr + (b.top || 12);
      if (py >= top - 0.05) {   // lands on the roof
        if (y < top + 0.1) {
          y = top + 0.1;
          if (n.v[1] < 0) { const sp = -n.v[1]; n.v[1] *= -0.35; n.v[0] *= 0.8; n.v[2] *= 0.8; if (sp > 1.2) n.bounce = { sp, kind: 'roof' }; if (Math.abs(n.v[1]) < 0.8) n.v[1] = 0; }
        }
      } else {   // hits a wall: reflect about the normal of the edge actually crossed (the bastion, the diagonal street),
        // not about the world axes — the normal takes 0.4, the slide along the face keeps 0.7, as the ground bounce does
        let sp = 0;
        const h = b.ring && !buildingAt(px, pz, py) ? ringHit(b.ring, px, pz, x, z) : null;
        if (h) {
          const vn = n.v[0] * h.nx + n.v[2] * h.nz;
          if (vn < 0) {
            sp = -vn;
            const tx = n.v[0] - vn * h.nx, tz = n.v[2] - vn * h.nz;
            n.v[0] = tx * 0.7 - 0.4 * vn * h.nx; n.v[2] = tz * 0.7 - 0.4 * vn * h.nz;
            x = h.x + h.nx * 0.03; z = h.z + h.nz * 0.03;   // stand it just off the face, outside
          } else { x = px; z = pz; sp = Math.hypot(n.v[0], n.v[2]); n.v[0] *= -0.4; n.v[2] *= -0.4; }
        } else {   // already inside (a fast step jumped the face) or a vertex graze: the old axis turn
          if (!buildingAt(px, z, y)) { x = px; sp = Math.abs(n.v[0]); n.v[0] *= -0.4; }
          else if (!buildingAt(x, pz, y)) { z = pz; sp = Math.abs(n.v[2]); n.v[2] *= -0.4; }
          else { x = px; z = pz; sp = Math.hypot(n.v[0], n.v[2]); n.v[0] *= -0.4; n.v[2] *= -0.4; }
        }
        if (sp > 1.2) n.bounce = { sp, kind: 'wall' };
      }
    } else if (y < gr + 0.12) {
      y = gr + 0.12;
      const e = 0.5, hx = (ground(x + e, z) - ground(x - e, z)) / (2 * e), hz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
      if (hx * hx + hz * hz > 0.0064) {   // a slope: reflect about its normal, then roll downhill
        const L = Math.hypot(hx, 1, hz), nx = -hx / L, ny = 1 / L, nz = -hz / L;
        const vn = n.v[0] * nx + n.v[1] * ny + n.v[2] * nz;
        if (vn < 0) {
          const sp = -vn, tx = n.v[0] - vn * nx, ty = n.v[1] - vn * ny, tz = n.v[2] - vn * nz;
          let rn = sp * 0.4; if (rn < 0.8) rn = 0; else if (sp > 1.2) n.bounce = { sp, kind: 'ground' };
          n.v[0] = tx * 0.7 + rn * nx; n.v[1] = ty * 0.7 + rn * ny; n.v[2] = tz * 0.7 + rn * nz;
        }
        const k = g / (1 + hx * hx + hz * hz);   // gravity along the slope, into the horizontal
        n.v[0] -= hx * k * dt; n.v[2] -= hz * k * dt;
      } else if (n.v[1] < 0) {   // flat: the old bounce
        const sp = -n.v[1]; n.v[1] *= -0.4; n.v[0] *= 0.7; n.v[2] *= 0.7; if (sp > 1.2) n.bounce = { sp, kind: 'ground' }; if (Math.abs(n.v[1]) < 0.8) n.v[1] = 0;
      } else { n.v[0] *= 0.7; n.v[2] *= 0.7; }
    }
    if (bodies) for (const bd of bodies) {   // a player: the swept path of the grenade against the body's capsule
      const f = bd.y - (bd.eye || 1.7), R = NADE.bodyR + NADE.r;
      const h = segToSegment([px, py, pz], [x, y, z], [bd.x, f + 0.05, bd.z], [bd.x, bd.y + 0.12, bd.z]);
      if (h.dist >= R) continue;
      let nx, ny, nz;   // the normal points from the body to the grenade
      if (h.dist > 1e-6) { nx = (h.pa[0] - h.pb[0]) / h.dist; ny = (h.pa[1] - h.pb[1]) / h.dist; nz = (h.pa[2] - h.pb[2]) / h.dist; }
      else {   // the step crossed the capsule's axis (a fast throw jumps half a metre): the side it came from is the normal,
        const dx = px - h.pb[0], dy = py - h.pb[1], dz = pz - h.pb[2], l = Math.hypot(dx, dy, dz);   // else it would be pushed on through
        if (l > 1e-6) { nx = dx / l; ny = dy / l; nz = dz / l; }
        else { const vl = Math.hypot(n.v[0], n.v[1], n.v[2]) || 1; nx = -n.v[0] / vl; ny = -n.v[1] / vl; nz = -n.v[2] / vl; }   // dropped right onto the crown: bounce straight back
      }
      x = h.pb[0] + nx * R; y = h.pb[1] + ny * R; z = h.pb[2] + nz * R;
      const vn = n.v[0] * nx + n.v[1] * ny + n.v[2] * nz;
      if (vn < 0) {   // moving into the body: reflect about the normal, the slide along it damped
        const sp = -vn, tx = n.v[0] - vn * nx, ty = n.v[1] - vn * ny, tz = n.v[2] - vn * nz;
        n.v[0] = tx * 0.85 - 0.45 * vn * nx; n.v[1] = ty * 0.85 - 0.45 * vn * ny; n.v[2] = tz * 0.85 - 0.45 * vn * nz;
        if (sp > 1.2) n.bounce = { sp, kind: 'body' };
      }
    }
    n.p = [x, y, z];
  }
  // where a person can stand: no house, not in the river, a pond or a moat (the ground more than two metres under the square)
  const walkable = (x, z) => !buildingAt(x, z, 1) && ground(x, z) > -2;   // a standing body: open canopies and passages are walkable
  return { freePath, shotPath, stepNade, walkable };
}
