/* The physics of the shots and the grenades, for the server and for the training game in the page: the same rules over
   two functions the caller brings, which house stands at a point (with its height in .top) and how high the ground is. */
export function makePhysics(buildingAt, ground) {
  // how far from o along d (unit) a shot flies before a roof line stops it; len if it does not
  function freePath(o, d, len) {
    for (let t = 2; t < len; t += 1.5) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t, b = buildingAt(x, z);
      if (b && y < ground(x, z) + (b.top || 12) - 1) return t;
    }
    return len;
  }
  // one step of a grenade n = { p: [x, y, z], v: [vx, vy, vz] }: gravity, bounces on the ground, the roofs and the walls of houses
  function stepNade(n, dt, g) {
    const [px, py, pz] = n.p; n.v[1] -= g * dt;
    let x = px + n.v[0] * dt, y = py + n.v[1] * dt, z = pz + n.v[2] * dt;
    const b = buildingAt(x, z), gr = ground(x, z);
    if (b) {
      const top = gr + (b.top || 12);
      if (py >= top - 0.05) { if (y < top + 0.1) { y = top + 0.1; if (n.v[1] < 0) n.v[1] *= -0.35; n.v[0] *= 0.8; n.v[2] *= 0.8; } }   // lands on the roof
      else {   // hits a wall: the axis that leads into the house is turned back
        if (!buildingAt(px, z)) { x = px; n.v[0] *= -0.4; } else if (!buildingAt(x, pz)) { z = pz; n.v[2] *= -0.4; } else { x = px; z = pz; n.v[0] *= -0.4; n.v[2] *= -0.4; }
      }
    } else if (y < gr + 0.12) { y = gr + 0.12; if (n.v[1] < 0) n.v[1] *= -0.4; n.v[0] *= 0.7; n.v[2] *= 0.7; if (Math.abs(n.v[1]) < 0.8) n.v[1] = 0; }   // on the ground
    n.p = [x, y, z];
  }
  // where a person can stand: no house, not in the river, a pond or a moat (the ground more than two metres under the square)
  const walkable = (x, z) => !buildingAt(x, z) && ground(x, z) > -2;
  return { freePath, stepNade, walkable };
}
