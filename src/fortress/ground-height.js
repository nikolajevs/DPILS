import { FORT_FOUNTAIN } from './monuments.js';
import { fortBldHulls, fortNearBld } from './arsenals.js';
import { FH, FORT, FT, fortGates, fortIn, fss } from './index.js';
import { konPoint, konZone } from './konstantin.js';
import { lmL } from '../landmarks/core.js';
import { BLD, LINES } from '../world/data.js';
import { SegGrid } from '../core/geometry.js';
import { area2, bbox, pip } from '../core/util.js';

/* ---- the height of the ground at a point (used for the mesh, the walls, trees and walking) ---- */
const FS = { segs: [], SEG: null, DSEG: null, RSEG: null, BSEG: null, rings: [], moats: [], bridge: null };
function fortPrep() {
  const SEG = new SegGrid(16), DSEG = new SegGrid(16), RSEG = new SegGrid(20), segs = FS.segs, lines = [];
  // segs: [x1, z1, x2, z2, kind, line, start is a free end, end is a free end]
  const addLine = (p, kind, open) => { const n = p.length >> 1, line = lines.length; lines.push(p); for (let i = 0; i < n - 1; i++) {
    const x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * i + 2], z2 = p[2 * i + 3]; if (Math.hypot(x2 - x1, z2 - z1) < 0.05 || !fortIn((x1 + x2) / 2, (z1 + z2) / 2)) continue;
    SEG.add(x1, z1, x2, z2, kind, segs.length); segs.push([x1, z1, x2, z2, kind, line, open && i === 0, open && i === n - 2]); } };
  // closed walls under 100 m² are plinths and casemate entrances, not raised works
  for (const [, , p] of FT.rings) { if (Math.abs(area2(p)) < 100) continue; addLine(p, 0, false); const bb = bbox(p); if (fortIn((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)) FS.rings.push({ r: p, bb }); }
  addLine(FT.main, 0, true); for (const p of FT.walls) addLine(p, 0, true);
  for (const [, p] of FT.banks) { let ok = true; for (let i = 0; i < p.length; i += 2) if (!fortIn(p[i], p[i + 1], 60)) { ok = false; break; } if (ok) addLine(p, 1, true); }
  // an open end is free unless another line has a vertex within 3 m of it
  for (const s of segs) for (const e of [0, 1]) if (s[6 + e]) { const x = s[2 * e], z = s[2 * e + 1];
    SEG.near(x, z, 3, id => { if (segs[SEG.s[id * 6 + 5]][5] !== s[5]) s[6 + e] = false; }); }
  FS.main = FT.main; FS.mainBB = bbox(FT.main);
  for (const p of FT.ditches) { const n = p.length >> 1; for (let i = 0; i < n - 1; i++) if (fortIn(p[2 * i], p[2 * i + 1], 30)) DSEG.add(p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3], 0, 0); }
  for (const [k, p] of FT.moats) { const bb = bbox(p); if (fortIn((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, 40)) FS.moats.push({ k, r: p, bb }); }
  for (const l of LINES) { if (l.cls > 4) continue; const p = l.pts, n = p.length >> 1;
    for (let i = 0; i < n - 1; i++) if (fortIn(p[2 * i], p[2 * i + 1], 40)) RSEG.add(p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3], l.w / 2, 0); }
  for (const [m, p] of FT.bridges) if (m === 'wood') FS.bridge = p;
  // buildings keep the town level around them: houses, sheds and garages built into the ramparts or the moats stand in cuts
  const BSEG = new SegGrid(16);
  const rings = BLD.map(b => b.ring).concat(fortBldHulls().map(h => h.r)); FS.brings = rings;
  rings.forEach((r, id) => { const bb = bbox(r); if (!fortIn((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, 20)) return; const n = r.length >> 1;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; BSEG.add(r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1], id, 0); } });
  Object.assign(FS, { SEG, DSEG, RSEG, BSEG });
}
const inBB = (bb, x, z) => x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3];
// h: visible ground; w: where one walks; b: bits 1 raised, 2 moat, 4 wet moat, 8 gate block, 16 berm behind a wall, 32 cut or road
function fortPoint(x, z) {
  const o = { h: 0, w: 0, b: 0 }; if (!FORT.ok || !FS.SEG || !fortIn(x, z, 30)) return o;
  // the nearest wall or bank, and the nearest one that does not end in a free end right there: beyond the free end of
  // a wall the side of its line says little, so the other one is taken when it raises the ground higher
  let best = 1e9, bid = -1, bx = 0, bz = 0, bestI = 1e9, bidI = -1;
  const atEnd = (s, px, pz) => (s[6] && px === s[0] && pz === s[1]) || (s[7] && px === s[2] && pz === s[3]);
  FS.SEG.near(x, z, 32, (id, d, px, pz) => { if (d < best) { best = d; bid = id; bx = px; bz = pz; }
    if (d < bestI && !atEnd(FS.segs[FS.SEG.s[id * 6 + 5]], px, pz)) { bestI = d; bidI = id; } });
  let raised = false, kind = -1, d = best, endF = 1;
  const judge = (id, dd, end) => {
    const s = FS.segs[FS.SEG.s[id * 6 + 5]], r = (s[2] - s[0]) * (z - s[1]) - (s[3] - s[1]) * (x - s[0]) < 0; let e = 1;
    // beyond the free end of a wall or bank the raised ground rounds off instead of running on as a half disc
    if (r && end) e = 1 - fss((dd - 1) / 9);
    // far from any wall, outside the works, the raised ground falls away instead of ending in a cliff
    if (r && s[4] === 0 && dd > 22 && !(inBB(FS.mainBB, x, z) && pip(x, z, FS.main)) && !FS.rings.some(q => inBB(q.bb, x, z) && pip(x, z, q.r))) e = Math.min(e, 1 - fss((dd - 22) / 9));
    return { r, kind: s[4], d: dd, e: r ? e : 0 };
  };
  if (bid >= 0) {
    let J = judge(bid, best, atEnd(FS.segs[FS.SEG.s[bid * 6 + 5]], bx, bz));
    if (J.e < 1 && bidI >= 0 && bidI !== bid) { const J2 = judge(bidI, bestI, false); if (J2.e > J.e) J = J2; }
    raised = J.r; kind = J.kind; d = J.d; endF = J.r ? J.e : 1;
  }
  else for (const r of FS.rings) if (inBB(r.bb, x, z) && pip(x, z, r.r)) { raised = true; kind = 0; d = 30; break; }
  let mt = 0; for (const m of FS.moats) if (inBB(m.bb, x, z) && pip(x, z, m.r)) { mt = m.k; break; }
  let dd = 1e9; FS.DSEG.near(x, z, 24, (id, dist) => { if (dist < dd) dd = dist; });
  const moatF = mt ? 1 : 1 - fss((dd - 16) / 8), base = FH.moat * moatF;
  let h, w;
  if (raised) {
    if (kind === 0) h = d < FH.berm ? FH.cap : d < 7.5 ? FH.cap + (FH.crest - FH.cap) * fss((d - FH.berm) / 5) : d < 8.5 ? FH.crest : d < 11.5 ? FH.crest - (FH.crest - FH.terre) * fss((d - 8.5) / 3) : FH.terre;
    else h = d < 22 ? FH.bank : FH.bank + (base - FH.bank) * fss((d - 22) / 8);
    h = base + (h - base) * endF; w = h; if (endF >= 0.5) o.b |= 1;
    if (kind === 0 && d < FH.berm && endF === 1) { h = base; o.b |= 16; }       // the ground steps down behind the wall; the coping covers the gap
  } else { h = kind === 1 && d < 8 ? FH.bank + (base - FH.bank) * fss(d / 8) : base; w = h; }
  if (moatF > 0.5 && !(o.b & 1)) o.b |= 2; if (mt === 1 && !(o.b & 1)) o.b |= 4;
  // roads keep their level, with earth slopes up the ramparts and down into the moats
  let rd = 1e9; FS.RSEG.near(x, z, 14, (id, dist) => { const e = dist - FS.RSEG.s[id * 6 + 4]; if (e < rd) rd = e; });
  let inB = false; FS.BSEG.near(x, z, 12, (id, dist) => { if (dist + 1 < rd) rd = dist + 1; if (!inB && pip(x, z, FS.brings[FS.BSEG.s[id * 6 + 4]])) inB = true; });
  if (inB) rd = 0;
  // gates: the block over the passage, the flat cut on the town side, causeways across the moat
  for (const g of fortGates()) {
    const [u, v] = lmL(g.f, x, z); if (u < -80 || u > 60 || Math.abs(v) > 40) continue;
    if (u > -g.a - 0.6 && u < g.a2 + 0.6 && Math.abs(v) < g.b + 0.6) { o.b |= 8; h = 0; w = FH.floor; }
    for (const [u0, u1, w0, w1] of g.cuts) { const t = (u - u0) / (u1 - u0), hw = w0 + (w1 - w0) * Math.max(0, Math.min(1, t)) + 2; if (u > u0 - 0.6 && u < u1 && Math.abs(v) < hw) { h = 0; w = 0; o.b |= 32; o.b &= ~(1 | 2 | 16); } }
    for (const [u0, u1, hw] of g.ways) { const du = u < u0 ? u0 - u : u > u1 ? u - u1 : 0, e = Math.hypot(du, Math.max(0, Math.abs(v) - hw)); if (e < rd) rd = e; }
    // the earth behind the curved wing walls of the Michael gate falls with their tops
    if (g.kind === 'mih' && u < g.a - 0.6 && u > g.a - 30 && Math.abs(v) > g.b + 0.6 && Math.abs(v) < 21) {
      const t = Math.min(1, Math.max(0, (Math.abs(v) - 5) / 14)), top = fortWingTop(t) - 0.15 + (g.a - 0.6 - u) * 0.7; if (h > top) h = w = top;
    }
  }
  if (rd < 2.5) { h = 0; w = 0; o.b |= 32; o.b &= ~(2 | 4 | 16); }
  else if (rd < 10.5 && !(o.b & 8)) { const lim = (rd - 2.5) * 0.9; h = Math.max(-lim, Math.min(lim, h)); w = Math.max(-lim, Math.min(lim, w)); }
  if (FS.bridge && pip(x, z, FS.bridge)) w = FH.floor;
  [h, w] = konPoint(x, z, o, h, w);   // the walls of the Konstantin gate and the earth they hold
  o.h = h; o.w = w; return o;
}
const fortWingTop = t => 1.0 + 6.6 * Math.sqrt(Math.max(0, 1 - t * t));
function fortGround(x, z) { return fortIn(x, z, 30) && FS.SEG ? fortPoint(x, z).w : 0; }
// the height of the terrain mesh itself (its triangles), for trees and paths laid on it
function fortGridH(x, z) {
  const G = FORT.grid; if (!G) return 0; const fx0 = (x - G.X0) / G.c, fz0 = (z - G.Z0) / G.c, i = Math.floor(fx0), j = Math.floor(fz0);
  if (i < 0 || j < 0 || i >= G.N - 1 || j >= G.N - 1) return 0;
  const fx = fx0 - i, fz = fz0 - j, k = j * G.N + i, H = G.H, a = H[k], b = H[k + 1], d = H[k + G.N], e = H[k + G.N + 1];
  return fx + fz <= 1 ? a + fx * (b - a) + fz * (d - a) : e + (1 - fx) * (d - e) + (1 - fz) * (b - e);
}
function fortNoTree(x, z) { if (!fortIn(x, z, 30) || !FS.SEG) return false; if (konZone(x, z) || fortNearBld(x, z, 2) || Math.hypot(x - FORT_FOUNTAIN[0], z - FORT_FOUNTAIN[1]) < 9) return true; const p = fortPoint(x, z); return (p.b & (8 | 16 | 32)) !== 0 || Math.abs(p.h - p.w) > 0.5; }

export { FS, fortGridH, fortGround, fortNoTree, fortPoint, fortPrep, fortWingTop, inBB };
