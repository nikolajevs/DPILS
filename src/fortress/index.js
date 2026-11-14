import { fortNearBld } from './arsenals.js';
import { lmL } from '../landmarks/core.js';
import { PB, obb, pip } from '../core/util.js';

/* ---------- Daugavpils fortress: ramparts, moats and gates ----------
   The earthworks come from OpenStreetMap through fortress.js (tools/fortress.js). Retaining walls and embankments
   there have their high side on the left, so closed walls outline raised works (bastions, curtain lunettes,
   counterguards) and the inner rampart is a band between two walls. The ground is raised on the high side of the
   nearest wall or embankment and dug down to the moat bottom along the ditches that OSM draws at the bottom of the
   moats. Heights follow the photographs of the Nicholas gate: the moat bottom 4 m below the town, a fieldstone
   escarp to 1.6 m with a berm behind it, the parapet crest at 5.2 m. The gates are modelled from photographs. */
const FT = window.FORTRESS || null;
const FORT = { cx: -2790, cz: -390, R: 560, ok: !!(FT && FT.rings) };
const FH = { moat: -4.0, cap: 1.6, crest: 5.2, terre: 4.2, bank: 3.6, berm: 2.5, floor: 0.15 };
const fortIn = (x, z, m = 0) => FORT.ok && Math.hypot(x - FORT.cx, z - FORT.cz) < FORT.R + m;
const fss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
/* gates: the passage of each runs along u from the field (u < 0) into the town (u > 0); a = half its length,
   b = half the width of the gate block across it. Recognised by the centre of the OSM tunnel outline. */
// rendered buildings of the fortress (barracks, stores, officers' houses): ochre, yellow and salmon as on the photographs
const FORT_PAL = PB(['#d9c38a', '#e0c98f', '#d6b77c', '#e6cf9b', '#cfae78', '#dba98a', '#d39a7c', '#e3d2a8']);
const FORT_GATE_KEYS = [['nik', -2754.9, -115.2, 1], ['mih', -2552.7, -97.3, 0], ['ale', -2468.4, -484.5, 0], ['pst', -2505.7, -114.9, 0], ['pst', -2419.6, -180.4, 0], ['pst', -2401.0, -272.8, 0]];
let FG = null;
function fortGates() {
  if (FG) return FG; FG = [];
  if (!FORT.ok) return FG;
  for (const [, ring] of FT.tunnels) {
    const o = obb(ring); if (!o) continue;
    const k = FORT_GATE_KEYS.find(q => Math.hypot(q[1] - o.cx, q[2] - o.cz) < 6); if (!k) continue;
    let ux = o.ux, uz = o.uz, a = o.a, b = o.b;
    if (k[3]) { ux = -o.uz; uz = o.ux; a = o.b; b = o.a; }          // the Nicholas gate is crossed along its short side
    if ((FORT.cx - o.cx) * ux + (FORT.cz - o.cz) * uz < 0) { ux = -ux; uz = -uz; }
    // a2: the town end of the passage. Behind the outer gate block of the Nicholas gate stands the gate house
    // (Nikolaja iela 3A, a building with a passage in OSM); its façade to the town is 14.8 m from the tunnel's axis
    const g = { kind: k[0], f: [o.cx, o.cz, ux, uz], a, a2: k[0] === 'nik' ? 14.8 : a, b, cuts: [], ways: [], W: k[0] === 'nik' ? 13 : k[0] === 'mih' ? 5.8 : k[0] === 'ale' ? 5.6 : Math.min(b + 0.7, 4.5) };
    // flat ground cut through the rampart [u0, u1, half width at u0, at u1] and causeways across the moat
    if (g.kind === 'nik') g.cuts.push([g.a2, g.a2 + 10, 7.8, 9]);
    if (g.kind === 'mih') { g.cuts.push([a, a + 8, 19, 19]); g.ways.push([-a - 32, -a, 3.5]); }
    if (g.kind === 'ale') { g.cuts.push([a, a + 10, 6, 8]); g.ways.push([-a - 34, -a, 4.5]); }
    if (g.kind === 'pst') { g.cuts.push([a, a + 6, 3, 3]); g.ways.push([-a - 26, -a, 2.5]); }
    FG.push(g);
  }
  return FG;
}
// cadastre or OSM buildings standing for a gate are replaced by the gate models
function fortDrops(ring, bb) {
  if (!FORT.ok) return false; const cx = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2; if (!fortIn(cx, cz)) return false;
  // most of its corners on or by a modelled building (the outline of a U has its centre in the courtyard)
  const n = ring.length >> 1; let k = 0; for (let i = 0; i < n; i++) if (fortNearBld(ring[2 * i], ring[2 * i + 1], 2.5)) k++; if (k >= n * 0.6) return true;
  for (const g of fortGates()) { const [u, v] = lmL(g.f, cx, cz); if (u > -g.a - 2 && u < g.a2 + 2 && Math.abs(v) < g.b + 2) return true; }
  return false;
}
// walls, city walls and embankments of the fortress are drawn here instead of as generic lines
function fortSkipLine(cls, pts) { if (!FORT.ok || cls < 12 || cls > 14) return false; for (let i = 0; i < pts.length; i += 2) if (fortIn(pts[i], pts[i + 1], 40)) return true; return false; }
function fortBridgeLine(pts) {
  if (!FORT.ok) return false; const n = pts.length >> 1, x = (pts[0] + pts[2 * n - 2]) / 2, z = (pts[1] + pts[2 * n - 1]) / 2;
  for (const [m, p] of FT.bridges) if (m === 'wood' && pip(x, z, p)) return true; return false;
}

export { FH, FORT, FORT_PAL, FT, fortBridgeLine, fortDrops, fortGates, fortIn, fortSkipLine, fss };
