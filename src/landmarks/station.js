import { lmHip, lmRegisterOutline } from './tv-tower.js';
import { lmDisc, lmFoot, lmWallTo } from './university.js';
import { lmSign } from './unity-house.js';
import { lmBar, lmBlock, lmBoxL, lmLit, lmOp, lmWF } from './helpers.js';
import { LMT, lr } from './tiles.js';
import { LMF, LMWHITE, lmW } from './core.js';
import { flatPlain, vband } from '../buildings/walls.js';
import { COL } from '../world/data.js';
import { walkSlab } from '../world/walkgrid.js';
import { polyA } from '../core/geometry.js';
import { area2, hb, reversed, sh } from '../core/util.js';

/* ---- Daugavpils railway station, Stacijas iela 44 (1951) ----
   OpenStreetMap maps the outline (way 115889829) with a canopy over the entrance inside it as a building:part; the data
   build let the part stand in for the whole building, so citydata.js had only the 11 × 3 m canopy. The plan is the OSM
   outline, the massing and the façades follow photographs (Wikimedia Commons, category "Daugavpils Railway Station"):
   ochre render on a red-brown plinth. In the middle a block running through the building under a gable roof with a
   pediment at each end; towards the station square a portico with two square pillars at the top of 17 steps, over it a
   deep round-arched niche with the winged wheel of the railway breaking into the pediment, the side piers with small
   windows; towards the platform a recessed bay with the big window over glazed doors, DAUGAVPILS in bronze letters and
   1951 in a lunette in the pediment. On each side the waiting hall with four tall windows between pilasters on both
   façades, then two-storey end blocks under hipped roofs. The low main platform runs along the tracks.
   Frame vk: u from the portico towards the tracks, v along the building from its north end. */
function lmStation(K) {
  const f = LMF.vk, G = K.plain, S = K.stone, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const rect = (u0, u1, v0, v1) => Float32Array.from([lmW(f, u0, v0), lmW(f, u1, v0), lmW(f, u1, v1), lmW(f, u0, v1)].flat());   // a tread's footprint, for the walk's slabs
  const OCH = hb('#bc9e6c'), TRIM = sh(OCH, 0.9), PIL = sh(OCH, 0.86), RED = hb('#8c5849'), ROOF = hb('#8b9295'), STONE = hb('#8f8a84'), WHITE = hb('#e8e6df');
  const PL = 2.2, FL = 2.4, CW = 11.0, CE = 11.2, CC = 12.6, APEX = 18.0, VC = 41.65, AS = 10.6, R = 3.0, DN = 1.4;
  const ops = [], win = () => ({ d: 0.25, sill: TRIM, lit: lmLit(0.45) }), wt = () => lr() < 0.2 ? 'vkWinB' : 'vkWin';
  const ENDS = [[0, 15.3, 6.0], [68.3, 83.7, 5.9]], HALLS = [[15.3, 30.3, 7.9], [53.8, 68.3, 7.6]];
  // end blocks: four bays on each face, two floors over the plinth with its cellar grilles; a door to the platform
  for (const [v0, v1, uf] of ENDS) {
    for (let k = 0; k < 4; k++) { const v = v0 + (k + 0.5) * (v1 - v0) / 4;
      lmOp(ops, uf, v, 1.3, 3.1, 5.3, wt(), win()); lmOp(ops, uf, v, 1.3, 7.0, 9.2, wt(), win()); lmOp(ops, uf, v, 1.0, 0.7, 1.3, 'vkGrille', { d: 0.1 });
      if (k === (v0 ? 1 : 2)) lmOp(ops, 21.6, v, 1.5, 0.4, 3.1, 'stDoor', { d: 0.3, lit: lmLit(0.5) }); else lmOp(ops, 21.6, v, 1.3, 1.8, 4.0, wt(), win());
      lmOp(ops, 21.6, v, 1.3, 7.0, 9.2, wt(), win()); }
    const ve = v0 ? v1 : v0; for (let k = 0; k < 4; k++) { const u = uf + (k + 0.5) * (21.6 - uf) / 4; lmOp(ops, u, ve, 1.3, 3.1, 5.3, wt(), win()); lmOp(ops, u, ve, 1.3, 7.0, 9.2, wt(), win()); }
  }
  // waiting halls: four tall windows on each façade
  for (const [v0, v1, uf] of HALLS) for (let k = 0; k < 4; k++) { const v = v0 + (k + 0.5) * (v1 - v0) / 4;
    lmOp(ops, uf, v, 2.0, 3.0, 9.6, 'vkTall', { d: 0.3, sill: TRIM, lit: lmLit(0.8) }); lmOp(ops, 21.6, v, 2.0, 1.6, 9.6, 'vkTall', { d: 0.3, sill: TRIM, lit: lmLit(0.8) }); lmOp(ops, uf, v, 1.0, 0.7, 1.3, 'vkGrille', { d: 0.1 }); }
  // central block towards the square: the portico, small windows in the piers, the niche cut into the top of the wall
  lmOp(ops, 0, 41.65, 10.9, FL, 10.4, null, { d: 3.1, noFloor: true });
  lmOp(ops, 0, VC, 2 * R, AS, CC, null, { d: 0 });
  for (const vp of [33.25, 50.45]) { for (let c = -1; c <= 1; c++) for (const y of [3.2, 5.7, 8.2]) lmOp(ops, 0, vp + c * 1.0, 0.6, y, y + 1.4, 'vkNarrow', { d: 0.2, lit: lmLit(0.4) });
    for (const c of [-0.6, 0.6]) lmOp(ops, 0, vp + c, 0.6, 11.3, 11.9, 'vkSq', { d: 0.15, lit: lmLit(0.3) }); }
  for (const [v, ue] of [[30.3, 7.9], [53.8, 7.6]]) for (const y of [3.2, 5.7, 8.2]) lmOp(ops, ue / 2, v, 0.6, y, y + 1.4, 'vkNarrow', { d: 0.2, lit: lmLit(0.4) });
  // central block towards the platforms: the recessed bay with doors, the big window and two side windows
  lmOp(ops, 20.4, VC, 5.0, 0.4, 3.3, 'vkDoors', { d: 0.25, lit: true }); lmOp(ops, 20.4, VC, 5.0, 4.0, 8.8, 'vkBig', { d: 0.3, lit: lmLit(0.9) });
  for (const v of [37.2, 46.1]) { lmOp(ops, 20.4, v, 1.1, 6.3, 8.5, 'vkWin', win()); lmOp(ops, 20.4, v, 1.1, 1.7, 3.1, 'vkWin', win()); }

  // walls: a plinth pass (red ashlar towards the square, a low red base towards the platform) and the walls above it
  const OUT = (a, b) => a[0] > 20.3 && b[0] > 20.3;
  const stP = (a, b) => OUT(a, b) ? { tex: 1, col: OCH, plinth: 0.9, pcol: RED } : { tex: 2, col: RED }, stW = { tex: 1, col: OCH };
  const CEN = [[0, 30.3], [0, 53.8], [7.6, 53.8], [21.6, 53.8], [21.6, 48.0], [20.4, 48.0], [20.4, 35.3], [21.6, 35.3], [21.6, 30.3], [7.9, 30.3]];
  const BLOCKS = [
    { poly: CEN, top: CC, foot: lmFoot([[[7.6, 53.8], [21.6, 53.8], CW], [[21.6, 30.3], [7.9, 30.3], CW]]) },
    { poly: [[6.0, 0], [6.0, 15.3], [7.9, 15.3], [21.6, 15.3], [21.6, 0]], top: CE, foot: lmFoot([[[7.9, 15.3], [21.6, 15.3], 99]]) },
    { poly: [[5.9, 68.3], [5.9, 83.7], [21.6, 83.7], [21.6, 68.3], [7.6, 68.3]], top: CE, foot: lmFoot([[[21.6, 68.3], [7.6, 68.3], 99]]) },
    { poly: [[7.9, 15.3], [7.9, 30.3], [21.6, 30.3], [21.6, 15.3]], top: CW, foot: lmFoot([[[7.9, 30.3], [21.6, 30.3], 99], [[21.6, 15.3], [7.9, 15.3], 99]]) },
    { poly: [[7.6, 53.8], [7.6, 68.3], [21.6, 68.3], [21.6, 53.8]], top: CW, foot: lmFoot([[[21.6, 53.8], [7.6, 53.8], 99], [[7.6, 68.3], [21.6, 68.3], 99]]) }];
  for (const b of BLOCKS) {
    lmBlock(K, f, { poly: b.poly, top: PL, st: stP, wy0: b.foot, trim: S, cornice: [[PL - 0.18, PL, 0.1, sh(RED, 1.05)]] }, ops);
    lmBlock(K, f, { poly: b.poly, y0: PL, top: b.top, st: stW, wy0: b.foot, cornice: b.top < CC ? [[b.top - 0.55, b.top - 0.3, 0.12, TRIM], [b.top - 0.3, b.top, 0.32, TRIM]] : null }, ops);
  }
  // pilasters between the tall windows, lesenes at the corners of the end blocks
  for (const [v0, v1, uf] of HALLS) for (let k = 0; k <= 4; k++) { const v = v0 + k * (v1 - v0) / 4;
    for (const [u, s] of [[uf, -1], [21.6, 1]]) { const a = Math.max(v0, v - 0.3), b = Math.min(v1, v + 0.3), uu = s < 0 ? [u - 0.12, u] : [u, u + 0.12]; lmBoxL(G, f, uu[0], uu[1], a, b, PL, CW - 0.55, PIL, false); lmBoxL(G, f, uu[0] - (s < 0 ? 0.08 : 0), uu[1] + (s > 0 ? 0.08 : 0), a - 0.05, b + 0.05, CW - 0.85, CW - 0.55, TRIM); } }
  for (const [v0, v1, uf] of ENDS) for (const v of [v0, v1 - 0.7]) for (const [u, s] of [[uf, -1], [21.6, 1]]) lmBoxL(G, f, s < 0 ? u - 0.1 : u, s < 0 ? u : u + 0.1, v, v + 0.7, PL, CE - 0.55, PIL, false);
  // little lozenges between the upper windows of the end blocks towards the square
  for (const [v0, v1, uf] of ENDS) for (let k = 1; k < 4; k++) { const v = v0 + k * (v1 - v0) / 4, c = at(uf - 0.05, v, 8.1), dv = [-f[3] * 0.22, 0, f[2] * 0.22];
    polyA(G, [[c[0], c[1] - 0.38, c[2]], [c[0] + dv[0], c[1], c[2] + dv[2]], [c[0], c[1] + 0.38, c[2]], [c[0] - dv[0], c[1], c[2] - dv[2]]], sh(TRIM, 1.05), -f[2], 0, -f[3]); }

  // ---- the central block towards the square
  const N0 = [-f[2], 0, -f[3]], W = K.walls[1];
  const fill = (u, n, va, vb, bot, top, col) => { const m = Math.max(1, Math.ceil((vb - va) / 0.3)); for (let k = 0; k < m; k++) { const a = va + (vb - va) * k / m, b = va + (vb - va) * (k + 1) / m;
    if (top(a) - bot(a) < 1e-3 && top(b) - bot(b) < 1e-3) continue; W.q(at(u, a, bot(a)), at(u, b, bot(b)), at(u, b, top(b)), at(u, a, top(a)), n, [a / 8, bot(a) / 8, b / 8, bot(b) / 8, b / 8, top(b) / 8, a / 8, top(a) / 8], col); } };
  const archY = v => AS + Math.sqrt(Math.max(0, R * R - (v - VC) * (v - VC))), slope = v => CC + (APEX - CC) * Math.max(0, 1 - Math.abs(v - VC) / (v < VC ? VC - 30.3 : 53.8 - VC));
  fill(0, N0, VC - R, VC + R, v => Math.min(CC, archY(v)), () => CC, OCH);                                  // the wall over the niche, below the cornice
  fill(0, N0, 30.3, 53.8, v => Math.abs(v - VC) < R ? Math.max(CC, archY(v)) : CC, slope, OCH);         // the tympanum around the head of the niche
  fill(21.6, [f[2], 0, f[3]], 30.3, 53.8, () => CC, slope, OCH);                                             // the pediment towards the platforms
  // the niche: its curved soffit, back and floor, an archivolt, the winged wheel
  for (let k = 0; k < 16; k++) { const t0 = Math.PI * k / 16, t1 = Math.PI * (k + 1) / 16, tm = (t0 + t1) / 2, p = (t, u) => at(u, VC + R * Math.cos(t), AS + R * Math.sin(t));
    W.q(p(t0, 0), p(t1, 0), p(t1, DN), p(t0, DN), [Math.cos(tm) * f[3], -Math.sin(tm), -Math.cos(tm) * f[2]], [t0, 0, t1, 0, t1, DN / 8, t0, DN / 8], sh(OCH, 0.8));
    W.q(at(DN, VC, AS), p(t0, DN), p(t1, DN), p(t1, DN), N0, [0.5, 0.5, 0.6, 0.6, 0.7, 0.7, 0.7, 0.7], sh(OCH, 0.74)); }
  W.q(at(0, VC - R, AS), at(0, VC + R, AS), at(DN, VC + R, AS), at(DN, VC - R, AS), [0, 1, 0], [0, 0, 0.75, 0, 0.75, 0.2, 0, 0.2], sh(OCH, 0.9));
  for (let k = 0; k < 18; k++) { const p = t => at(-0.12, VC + (R + 0.18) * Math.cos(t), AS + (R + 0.18) * Math.sin(t)); lmBar(G, p(Math.PI * k / 18), p(Math.PI * (k + 1) / 18), 0.3, TRIM); }
  lmBoxL(G, f, -0.3, 0.05, VC - 0.35, VC + 0.35, AS + R - 0.1, AS + R + 0.55, sh(TRIM, 1.04));
  { const c = at(DN - 0.04, VC, AS + 1.3), ev = [-f[3], 0, f[2]], RC = sh(TRIM, 1.08), q = (dv, dy, du) => [c[0] + ev[0] * dv - f[2] * du, c[1] + dy, c[2] + ev[2] * dv - f[3] * du];
    lmDisc(G, q(0, 0, 0.02), 0.8, ev, [0, 1, 0], RC, N0); lmDisc(G, q(0, 0, 0.05), 0.62, ev, [0, 1, 0], sh(OCH, 0.78), N0); lmDisc(G, q(0, 0, 0.1), 0.17, ev, [0, 1, 0], RC, N0);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; lmBar(G, q(0, 0, 0.08), q(Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0.08), 0.07, RC); }
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) lmBar(G, q(s * 0.75, 0.15 - k * 0.12, 0.06), q(s * (1.55 + 0.16 * k), 0.75 - k * 0.27, 0.06), 0.15, RC); }
  // the portico: floor, back wall with doors and the tall window, two square pillars, the entablature band
  lmBoxL(S, f, 0, 3.1, 36.2, 47.1, FL - 0.12, FL, STONE, false);
  { const back = []; lmOp(back, 3.1, VC, 3.0, FL, FL + 2.4, 'vkPortDoor', { d: 0.15, lit: true }); lmOp(back, 3.1, VC, 3.0, 5.2, 9.6, 'vkPortWin', { d: 0.15, lit: lmLit(0.9) });
    lmWallTo(K, f, [3.1, 36.2], [3.1, 47.1], [-5, VC], FL, 10.4, back, stW); }
  for (const v of [39.1, 44.2]) { lmBoxL(G, f, -0.05, 1.05, v - 0.6, v + 0.6, FL, FL + 0.35, sh(TRIM, 0.97)); lmBoxL(G, f, 0, 1.0, v - 0.5, v + 0.5, FL + 0.35, 9.95, OCH); lmBoxL(G, f, -0.08, 1.08, v - 0.62, v + 0.62, 9.95, 10.4, TRIM); }
  lmBoxL(G, f, -0.2, 0.0, 30.3, 53.8, 10.4, AS, TRIM);
  // cornices and the raking cornices of both pediments; the soffit over the recessed bay
  for (const [a, b] of [[30.3, VC - R - 0.3], [VC + R + 0.3, 53.8]]) { lmBoxL(G, f, -0.35, 0.0, a, b, CC - 0.3, CC, TRIM); lmBoxL(G, f, -0.15, 0.0, a, b, CC - 0.55, CC - 0.3, TRIM); }
  lmBoxL(G, f, 21.6, 21.95, 30.3, 53.8, CC - 0.3, CC, TRIM); lmBoxL(G, f, 21.6, 21.75, 30.3, 53.8, CC - 0.55, CC - 0.3, TRIM);
  for (const [u0, u1] of [[0, 7.9], [7.9, 21.6]]) for (const v of [30.3, 53.8]) { const s = v < 40 ? -1 : 1; lmBoxL(G, f, u0, u1, s < 0 ? v - 0.35 : v, s < 0 ? v : v + 0.35, CC - 0.3, CC, TRIM); }
  for (const u of [-0.25, 21.85]) { lmBar(G, at(u, 29.9, CC + 0.05), at(u, VC, APEX + 0.25), 0.42, TRIM); lmBar(G, at(u, VC, APEX + 0.25), at(u, 54.2, CC + 0.05), 0.42, TRIM); }
  polyA(G, [at(20.4, 35.3, CC), at(21.6, 35.3, CC), at(21.6, 48.0, CC), at(20.4, 48.0, CC)], sh(OCH, 0.8), 0, -1, 0);
  // towards the platforms: the lunette with the year, the name over the big window
  for (let k = 0; k < 12; k++) { const t0 = Math.PI * k / 12, t1 = Math.PI * (k + 1) / 12, p = (t, r) => at(21.66, VC + r * Math.cos(t), CC + r * Math.sin(t));
    W.q(at(21.66, VC, CC), p(t0, 2.4), p(t1, 2.4), p(t1, 2.4), [f[2], 0, f[3]], [0.5, 0.5, 0.6, 0.6, 0.7, 0.7, 0.7, 0.7], sh(OCH, 1.05));
    lmBar(G, at(21.75, VC + 2.5 * Math.cos(t0), CC + 2.5 * Math.sin(t0)), at(21.75, VC + 2.5 * Math.cos(t1), CC + 2.5 * Math.sin(t1)), 0.16, TRIM); }
  lmSign(K, f, [21.7, VC + 1.25], [21.7, VC - 1.25], CC + 0.35, CC + 1.3, 'vk1951', 0);
  lmSign(K, f, [20.45, 46.8], [20.45, 36.5], 9.2, 10.05, 'vkName', 0);
  // roofs: the gable over the central block, gables over the halls, hips over the end blocks; chimneys and dormers
  { const e0 = 29.85, e1 = 54.25, y = CC - 0.05;
    polyA(G, [at(-0.5, e0, y), at(22.1, e0, y), at(22.1, VC, APEX + 0.05), at(-0.5, VC, APEX + 0.05)], sh(ROOF, 0.95), f[3], 1.5, -f[2]);
    polyA(G, [at(22.1, e1, y), at(-0.5, e1, y), at(-0.5, VC, APEX + 0.05), at(22.1, VC, APEX + 0.05)], sh(ROOF, 1.04), -f[3], 1.5, f[2]); }
  for (const [v0, v1, uf] of HALLS) { const um = (uf + 21.6) / 2, y0 = CW - 0.05, y1 = CW + 1.2;
    polyA(G, [at(uf - 0.35, v0, y0), at(uf - 0.35, v1, y0), at(um, v1, y1), at(um, v0, y1)], sh(ROOF, 0.97), -f[2], 2, -f[3]); polyA(G, [at(21.95, v1, y0), at(21.95, v0, y0), at(um, v0, y1), at(um, v1, y1)], sh(ROOF, 1.03), f[2], 2, f[3]);
    for (const v of [v0, v1]) polyA(G, [at(uf, v, CW), at(21.6, v, CW), at(um, v, y1 - 0.05)], OCH, 0, 0, 1);
    const vd = v0 < 40 ? v0 + 2.0 : v1 - 2.0, ud = uf + 1.4, yb = y0 + (y1 - y0) * (ud - uf + 0.35) / (um - uf + 0.35);
    lmBoxL(G, f, ud - 0.5, ud + 0.7, vd - 0.7, vd + 0.7, yb - 0.3, yb + 1.1, OCH); polyA(G, [at(ud - 0.55, vd - 0.8, yb + 1.1), at(ud - 0.55, vd + 0.8, yb + 1.1), at(ud - 0.55, vd, yb + 1.6)], OCH, -f[2], 0, -f[3]);
    polyA(G, [at(ud - 0.6, vd - 0.85, yb + 1.05), at(ud + 0.8, vd - 0.85, yb + 1.05), at(ud + 0.8, vd, yb + 1.65), at(ud - 0.6, vd, yb + 1.65)], ROOF, f[3], 1, -f[2]); polyA(G, [at(ud - 0.6, vd + 0.85, yb + 1.05), at(ud + 0.8, vd + 0.85, yb + 1.05), at(ud + 0.8, vd, yb + 1.65), at(ud - 0.6, vd, yb + 1.65)], ROOF, -f[3], 1, f[2]);
    const t = LMT.vkSq, P = lmW(f, ud - 0.56, vd + 0.35), Q = lmW(f, ud - 0.56, vd - 0.35), F = lmWF(P, Q); K.det.q(F.at(0, yb + 0.2, 0), F.at(F.L, yb + 0.2, 0), F.at(F.L, yb + 0.9, 0), F.at(0, yb + 0.9, 0), [F.nx, 0, F.nz], [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, lmLit(0.3) ? 1 : 0); }
  for (const [v0, v1, uf] of ENDS) { lmHip(G, f, uf, 21.6, v0, v1, CE - 0.05, 3.4, ROOF, 0.45); const vc = v0 ? v1 - 3.0 : v0 + 3.0; lmBoxL(G, f, 16.2, 17.1, vc - 0.35, vc + 0.35, CE + 1.5, CE + 4.6, sh(OCH, 0.92)); lmBoxL(G, f, 16.1, 17.2, vc - 0.45, vc + 0.45, CE + 4.6, CE + 4.8, sh(OCH, 0.85)); }
  // the steps to the portico: 17 steps between handrails, a side landing on the south
  for (let k = 0; k < 17; k++) { lmBoxL(S, f, -7.4 + 0.435 * k, 0.02, 36.6, 46.7, k * FL / 17, (k + 1) * FL / 17, sh(STONE, 0.96 + (k % 2) * 0.05), false); walkSlab(rect(-7.4 + 0.435 * k, -7.4 + 0.435 * (k + 1), 36.6, 46.7), (k + 1) * FL / 17); }
  lmBoxL(S, f, -3.6, 0.0, 46.7, 49.6, 0, FL, sh(STONE, 0.92)); walkSlab(rect(-3.6, 0, 46.7, 49.6), FL);   // the side landing
  { const IRON = hb('#2f3236'); for (const v of [36.8, 41.65, 46.5]) { lmBar(G, at(-7.4, v, 0.95), at(0, v, FL + 0.95), 0.06, IRON); for (let k = 0; k <= 4; k++) { const u = -7.4 + 7.4 * k / 4, y = FL * k / 4; lmBar(G, at(u, v, y), at(u, v, y + 0.95), 0.05, IRON); } } }
  { const s0 = lmW(f, -7.4, 36.6), s1 = lmW(f, -7.4, 46.7), s2 = lmW(f, 0, 36.6), s3 = lmW(f, -3.6, 49.6), s4 = lmW(f, 0, 49.6), s5 = lmW(f, -3.6, 46.7);
    COL.add(s0[0], s0[1], s1[0], s1[1], 0, 0); COL.add(s0[0], s0[1], s2[0], s2[1], 0, 0); COL.add(s1[0], s1[1], s5[0], s5[1], 0, 0); COL.add(s5[0], s5[1], s3[0], s3[1], 0, 0); COL.add(s3[0], s3[1], s4[0], s4[1], 0, 0); }
  // the main platform along the building, as mapped in OSM: low, asphalt, a white edge towards the tracks
  { const PLAT = [[27.1, -37.9], [21.2, -37.9], [21.1, -27.2], [21.6, 0], [21.6, 35.3], [20.4, 35.3], [20.4, 48.0], [21.6, 48.0], [21.6, 83.7], [21.8, 87.9], [24.9, 87.8], [24.8, 253.0], [29.4, 252.7], [29.5, -110.8], [27.3, -110.7]];
    let r = []; for (const [u, v] of PLAT) r.push(...lmW(f, u, v)); r = new Float32Array(r); if (area2(r) < 0) r = reversed(r);
    flatPlain(G, [r], 0.35, hb('#77787a'), false); vband(G, r, 0, 0.35, hb('#8a8a87')); walkSlab(r, 0.35);   // the body stands on the platform
    lmBoxL(G, f, 29.1, 29.5, -110.7, 252.7, 0.35, 0.37, WHITE, false); }
  lmRegisterOutline(f, [[0, 30.3], [0, 53.8], [7.6, 53.8], [7.6, 68.3], [5.9, 68.3], [5.9, 83.7], [21.6, 83.7], [21.6, 48.0], [20.4, 48.0], [20.4, 35.3], [21.6, 35.3], [21.6, 0], [6.0, 0], [6.0, 15.3], [7.9, 15.3], [7.9, 30.3]]);
}

export { lmStation };
