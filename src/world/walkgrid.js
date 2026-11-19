import { SegGrid } from '../core/geometry.js';

/* ---------- raised sidewalks ----------
   The sidewalks are slabs WH above the road (src/world/streets.js lays them, with a kerb along the road edge).
   Everything that walks or stands on them finds the extra height here: walkLift adds it for the player and the
   walkers, the lamps, the signal posts, the stop shelters and the tram poles add it where they stand. The strips
   are registered per segment of the laid sidewalk, shifted to its own centre line, with the half width as the
   lateral bounds, so a query is a short lateral test. The bounds ride in the segment's extra fields. */
const WH = 0.13;
const G = new SegGrid(20);
// a sidewalk of constant offset and half width along p
function walkStrip(p, off, hw) {
  const n = p.length >> 1;
  for (let i = 0; i < n - 1; i++) {
    const x1 = p[2 * i], z1 = p[2 * i + 1], dx = p[2 * i + 2] - x1, dz = p[2 * i + 3] - z1, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * off, nz = dx / l * off;
    G.add(x1 + nx, z1 + nz, p[2 * i + 2] + nx, p[2 * i + 3] + nz, -hw - 0.06, hw + 0.06);
  }
}
// a sidewalk whose edges A[i], B[i] change along p (a carriageway of a pair, four lanes)
function walkStripV(p, A, B) {
  const n = p.length >> 1;
  for (let i = 0; i < n - 1; i++) {
    const x1 = p[2 * i], z1 = p[2 * i + 1], dx = p[2 * i + 2] - x1, dz = p[2 * i + 3] - z1, l = Math.hypot(dx, dz) || 1;
    const c = (A[i] + B[i]) / 2, hw = Math.abs(B[i] - A[i]) / 2 + 0.06, nx = -dz / l * c, nz = dx / l * c;
    G.add(x1 + nx, z1 + nz, p[2 * i + 2] + nx, p[2 * i + 3] + nz, -hw, hw);
  }
}
function walkH(x, z) {
  let h = 0; const s = G.s;
  G.near(x, z, 2.2, id => {
    if (h) return;
    const k = id * 6, dx = s[k + 2] - s[k], dz = s[k + 3] - s[k + 1], l = Math.hypot(dx, dz) || 1;
    const L = ((x - s[k]) * -dz + (z - s[k + 1]) * dx) / l;
    if (L >= s[k + 4] && L <= s[k + 5]) h = WH;
  });
  return h;
}

export { WH, walkH, walkStrip, walkStripV };
