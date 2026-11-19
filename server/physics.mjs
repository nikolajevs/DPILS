/* The physics of the shots and the grenades, for the server and for the training game in the page: the same rules over
   two functions the caller brings, which house stands at a point (with its height in .top) and how high the ground is. */
export function makePhysics(buildingAt, ground) {
  // how far from o along d (unit) a shot flies before the ground, a hill slope or a roof line stops it; len if it does
  // not. The scan starts at 0.3 m and steps 0.5 m through the first three metres, so a wall the shooter leans on stops
  // the shot too (a 2 m start let point-blank walls and corner clips through); beyond that the step widens to 1.5 m.
  // Once a step is blocked, the wall is bisected to ~2 cm, so a hit just in front of the wall counts and one just behind
  // it does not (the grace is HIT.grace in combat.mjs). An origin already inside stone returns 0: the shot dies there.
  function freePath(o, d, len) {
    const block = t => {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t, gr = ground(x, z);
      if (y < gr) return true;   // the ground itself, a hill slope included
      const b = buildingAt(x, z);
      return !!(b && y < gr + (b.top || 12) - 1);
    };
    if (block(0)) return 0;
    for (let t = 0.3, step = 0.5; t < len; t += step) {
      if (!block(t)) { if (t >= 3) step = 1.5; continue; }
      let lo = Math.max(0, t - step), hi = t;
      for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (block(m)) hi = m; else lo = m; }
      return hi;
    }
    return len;
  }
  // one step of a grenade n = { p: [x, y, z], v: [vx, vy, vz] }: gravity, bounces on the ground, the roofs and the walls of
  // houses. On a slope the bounce reflects about the ground's normal and the settled grenade rolls downhill, so a rampart
  // throws it back the way it should instead of straight up. A real touch sets n.bounce = { sp, kind } (the impact speed and
  // 'ground' | 'roof' | 'wall') for the page to clink; flat ground keeps exactly the old feel.
  function stepNade(n, dt, g) {
    const [px, py, pz] = n.p; n.v[1] -= g * dt;
    let x = px + n.v[0] * dt, y = py + n.v[1] * dt, z = pz + n.v[2] * dt;
    const b = buildingAt(x, z), gr = ground(x, z);
    n.bounce = null;
    if (b) {
      const top = gr + (b.top || 12);
      if (py >= top - 0.05) {   // lands on the roof
        if (y < top + 0.1) {
          y = top + 0.1;
          if (n.v[1] < 0) { const sp = -n.v[1]; n.v[1] *= -0.35; n.v[0] *= 0.8; n.v[2] *= 0.8; if (sp > 1.2) n.bounce = { sp, kind: 'roof' }; if (Math.abs(n.v[1]) < 0.8) n.v[1] = 0; }
        }
      } else {   // hits a wall: the axis that leads into the house is turned back
        let sp;
        if (!buildingAt(px, z)) { x = px; sp = Math.abs(n.v[0]); n.v[0] *= -0.4; }
        else if (!buildingAt(x, pz)) { z = pz; sp = Math.abs(n.v[2]); n.v[2] *= -0.4; }
        else { x = px; z = pz; sp = Math.hypot(n.v[0], n.v[2]); n.v[0] *= -0.4; n.v[2] *= -0.4; }
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
    n.p = [x, y, z];
  }
  // where a person can stand: no house, not in the river, a pond or a moat (the ground more than two metres under the square)
  const walkable = (x, z) => !buildingAt(x, z) && ground(x, z) > -2;
  return { freePath, stepNade, walkable };
}
