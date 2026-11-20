import { mieraHoles, mieraOf } from './miera.js';

/* ---------- through-passages (проезды): the collision stays open where a model opens the wall ----------
   A block drawn with a covered way through it (Miera iela 143, src/buildings/miera.js) leaves each opening as a hole
   in its footprint: buildingAt / inBuilding already treat the hole as open, so bullets, grenades, bots and tree
   planting pass through. But the walking collision (COL) is built from the raw cadastre outline, and the outline's
   recess notch still has a back wall across the mouth — the body was stopped at the passage although the wall was
   drawn open. Here the very same holes clip the outline collision, and the two jamb walls of each opening are added,
   so the body walks (and drives) through exactly where the model opens the wall, between the piers it leaves standing.

   RULE: every through-passage in a building must be passable — see README «Проезды сквозь здания» and CLAUDE.md. The
   model cuts the opening and registers it as a footprint hole; passageHolesOf returns those holes and addHoledCollision
   opens the collision to match. When a new block with a passage is modelled, register its holes in passageHolesOf. */

// the footprint holes of the through-passages of a building (empty if it has none)
function passageHolesOf(id, outer) {
  if (mieraOf(outer)) return mieraHoles();
  return [];
}

// frame of a rectangular hole: centre, width axis (ex,ez) with half hw, depth axis (fx,fz) with half hd
function holeFrame(h) {
  const cx = (h[0] + h[2] + h[4] + h[6]) / 4, cz = (h[1] + h[3] + h[5] + h[7]) / 4;
  let ex = h[2] - h[0], ez = h[3] - h[1]; const hw = Math.hypot(ex, ez) / 2 || 1; ex /= 2 * hw; ez /= 2 * hw;
  let fx = h[6] - h[0], fz = h[7] - h[1]; const hd = Math.hypot(fx, fz) / 2 || 1; fx /= 2 * hd; fz /= 2 * hd;
  return { cx, cz, ex, ez, fx, fz, hw, hd };
}
// the parameter interval [t0,t1] of a segment inside the rectangle |u| <= hw, |v| <= hd, or null
function insideRect(ua, va, du, dv, hw, hd) {
  let t0 = 0, t1 = 1;
  if (Math.abs(du) < 1e-9) { if (ua < -hw || ua > hw) return null; }
  else { let a = (-hw - ua) / du, b = (hw - ua) / du; if (a > b) { const t = a; a = b; b = t; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null; }
  if (Math.abs(dv) < 1e-9) { if (va < -hd || va > hd) return null; }
  else { let a = (-hd - va) / dv, b = (hd - va) / dv; if (a > b) { const t = a; a = b; b = t; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null; }
  return [t0, t1];
}
// collision: the outline edges clipped around every opening, plus the two jamb walls of each opening at the width the
// model draws them. The clip rectangle is grown a little along the depth so it also clears the recess back wall of the
// cadastre notch, which sits a hand's breadth mouth-side of the hole (the hole is inset 0.01 m from the bridge face).
// COL is passed in so this module does not import world/data.js.
const GROW_D = 0.7, GROW_W = 0.4;
function addHoledCollision(rings, holes, COL) {
  const frames = holes.map(holeFrame);
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x1 = r[2 * i], z1 = r[2 * i + 1], dx = r[2 * j] - x1, dz = r[2 * j + 1] - z1;
      let pieces = [[0, 1]];
      for (const f of frames) {
        const ua = (x1 - f.cx) * f.ex + (z1 - f.cz) * f.ez, va = (x1 - f.cx) * f.fx + (z1 - f.cz) * f.fz;
        const iv = insideRect(ua, va, dx * f.ex + dz * f.ez, dx * f.fx + dz * f.fz, f.hw + GROW_W, f.hd + GROW_D);
        if (!iv) continue; const [a, b] = iv, next = [];
        for (const [s, e] of pieces) { if (b <= s || a >= e) { next.push([s, e]); continue; } if (a > s) next.push([s, a]); if (b < e) next.push([b, e]); }
        pieces = next;
      }
      for (const [s, e] of pieces) { if (e - s < 1e-4) continue; COL.add(x1 + dx * s, z1 + dz * s, x1 + dx * e, z1 + dz * e, 0, 0); }
    }
  }
  for (const f of frames) {   // the jambs at the drawn opening width, reaching through the recesses to seal the mouth
    const reach = f.hd + GROW_D;
    for (const s of [-1, 1]) {
      const bx = f.cx + f.ex * s * f.hw, bz = f.cz + f.ez * s * f.hw;
      COL.add(bx - f.fx * reach, bz - f.fz * reach, bx + f.fx * reach, bz + f.fz * reach, 0, 0);
    }
  }
}

export { addHoledCollision, passageHolesOf };
