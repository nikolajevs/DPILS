import { lmRegisterOutline } from './tv-tower.js';
import { lmDisc, lmFoot, lmStrip, lmWallTo } from './university.js';
import { lmBar, lmBlock, lmBoxL, lmLit, lmOp } from './helpers.js';
import { LMF, lmW } from './core.js';
import { polyA } from '../core/geometry.js';
import { hb, sh } from '../core/util.js';

/* ---- Former cinema "Oktobris" (1978), later "Renesanse", Vienības iela 30; Daugavpils Innovation Centre since 2022 ----
   OpenStreetMap maps the building in building:part relations, which the data build did not download, so its outline
   is missing from citydata.js: the named outline left only its centre (the place "Daugavpils inovāciju centrs"), and
   the one part mapped as a way survived as a 27 × 2.5 m "building" in front, which is the canopy over the lobby. The plan
   is anchored on that canopy and laid square to Vienības iela; the massing follows photographs: Wikimedia Commons
   ("Daugavpils oktobris cinema", "Кинотеатр Ренесанс - panoramio"), LSM (2022). Buff brick throughout: the big hall on
   the west with its rounded corner and a louvred grille, the lobby with a band of upper windows over a thick rounded
   canopy, black-framed glazing with a frosted ornament and the LED sign of the Innovation Centre, the taller east block
   with a rounded front, the small hall and the service block behind; a terrace, steps and a ramp with steel railings.
   Frame ren: u from the front into the building, v east along it. */
const lmArc = (cu, cv, r, t0, t1, n) => { const p = []; for (let k = 0; k <= n; k++) { const t = t0 + (t1 - t0) * k / n; p.push([cu + r * Math.cos(t), cv + r * Math.sin(t)]); } return p; };
function lmRenesanse(K) {
  const f = LMF.ren, G = K.plain, GS = K.stone, at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const buff = { tex: 6, col: [244, 238, 230] }, GREY = hb('#8f8c86'), METAL = hb('#8e9195'), CANOPY = hb('#7b7e81'), CONC = hb('#9b9893'), RAIL = hb('#c3c7ca'), FLAT = hb('#5a5c5e');
  const trim = top => [[0, 0.9, 0.04, GREY], [top - 0.15, top, 0.07, METAL]];
  const H = { hall: 12.0, lobby: 9.8, east: 12.6, small: 10.6, rear: 7.0 };
  const UF = -7.6, UG = -5.4, UB = 44, V0 = 26.9, V1 = 48, V2 = 59.8, CV1 = 54.3;     // lobby front and glazing, back; lobby west and east, east block, canopy end
  const WA = lmArc(UF + 12, 16, 12, Math.PI, 1.5 * Math.PI, 8), EA = lmArc(UG + 6, V2 - 6, 6, Math.PI, Math.PI / 2, 6);   // rounded corners
  const west = [[UF, V0], ...WA, [UB, 4], [UB, V0], [5, V0]];   // WA runs from (UF, 16) to (UF + 12, 4)
  const lobby = [[UF, V0], [UF, V1], [UG, V1], [5, V1], [5, V0]];
  const east = [[UG, V1], ...EA, [18, V2], [18, V1], [5, V1]];
  const small = [[5, V0], [5, V1], [18, V1], [36, V1], [UB, V1], [UB, V0]], rear = [[18, V1], [18, V2], [36, V2], [36, V1]];
  // big hall: the grille high on its front, a service door at the back
  { const o = []; lmOp(o, UF, 21.5, 3.2, 9.9, 10.7, 'dicGrille', { d: 0.08 }); lmOp(o, UB, 14, 1.5, 0, 2.9, 'vnSideDoor', { d: 0.2 });
    lmBlock(K, f, { poly: west, top: H.hall, st: buff, roof: FLAT, roofY: H.hall, cornice: trim(H.hall), wy0: lmFoot([[[UB, V0], [5, V0], H.small], [[5, V0], [UF, V0], H.lobby]]) }, o); }
  // east block: a tall stair window on its side
  { const o = []; lmOp(o, 10, V2, 1.2, 1.6, 9.6, 'dicStrip', { d: 0.2, lit: lmLit(0.6) });
    lmBlock(K, f, { poly: east, top: H.east, st: buff, roof: FLAT, roofY: H.east, cornice: trim(H.east), wy0: lmFoot([[[18, V1], [5, V1], H.small], [[5, V1], [UG, V1], H.lobby], [[18, V2], [18, V1], H.rear]]) }, o); }
  lmBlock(K, f, { poly: small, top: H.small, st: buff, roof: FLAT, roofY: H.small, cornice: trim(H.small),
    wy0: lmFoot([[[5, V0], [5, V1], H.lobby], [[5, V1], [18, V1], 99], [[18, V1], [36, V1], H.rear], [[UB, V0], [5, V0], 99]]) }, []);
  { const o = []; lmOp(o, 36, 54, 1.5, 0, 2.9, 'vnSideDoor', { d: 0.2 });
    lmBlock(K, f, { poly: rear, top: H.rear, st: buff, roof: FLAT, roofY: H.rear, cornice: trim(H.rear), wy0: lmFoot([[[18, V1], [18, V2], 99], [[36, V1], [18, V1], 99]]) }, o); }
  // lobby: the ground floor recessed 2.2 m under the canopy, a band of upper windows on the west half of the front
  { const o = [], a = [UF, V0], b = [UF, V1], wo = () => ({ d: 0.18, lit: lmLit(0.6) }), vm = (V0 + V1) / 2;
    lmOp(o, UF, vm, V1 - V0 - 0.6, 0, 3.4, null, { d: UG - UF, noFloor: true });
    lmStrip(o, a, b, 0.6, 2.0, 1.4, 4.9, 6.3, 'dicWin', wo); lmStrip(o, a, b, 2.8, 7.6, 1.6, 4.9, 6.3, 'dicWin', wo); lmStrip(o, a, b, 8.6, 13.4, 1.6, 4.9, 6.3, 'dicWin', wo);
    lmBlock(K, f, { poly: lobby, top: H.lobby, st: buff, roof: FLAT, roofY: H.lobby, cornice: [[H.lobby - 0.15, H.lobby, 0.07, METAL]], wy0: lmFoot([[[UG, V1], [5, V1], 99], [[5, V1], [5, V0], 99], [[5, V0], [UF, V0], 99]]) }, o);
    const g = [], ga = [UG, V0 + 0.3], gb = [UG, V1 - 0.3]; lmStrip(g, ga, gb, 0, 12, 2.0, 0.9, 3.4, k => k === 2 || k === 3 ? 'dicDoor' : 'dicGlass', { d: 0.05, lit: true });
    lmOp(g, UG, V1 - 4.6, 4.0, 0.95, 3.4, 'dicLED', { d: 0.03, lit: true });
    lmWallTo(K, f, ga, gb, [UF - 5, vm], 0.9, 3.4, g, { tex: 5, col: hb('#2c2e31') }); }
  // the canopy: a thick slab with a rounded nose, downlights in its soffit; it runs on in front of the east block
  { const u1 = UG, v0 = V0, v1 = CV1, y0 = 3.4, y1 = 4.3, r = (y1 - y0) / 2, yc = (y0 + y1) / 2, u0 = -10.1 + r;
    lmBoxL(G, f, u0, u1, v0, v1, y0, y1, CANOPY);
    for (let k = 0; k < 10; k++) { const a0 = Math.PI / 2 + k / 10 * Math.PI, a1 = Math.PI / 2 + (k + 1) / 10 * Math.PI, am = (a0 + a1) / 2, P = (a, v) => at(u0 + r * Math.cos(a), v, yc + r * Math.sin(a));
      polyA(G, [P(a0, v0), P(a1, v0), P(a1, v1), P(a0, v1)], sh(CANOPY, 0.95 + 0.1 * Math.sin(am)), f[2] * Math.cos(am), Math.sin(am), f[3] * Math.cos(am));
      for (const [v, s] of [[v0, -1], [v1, 1]]) polyA(G, [at(u0, v, yc), P(a0, v), P(a1, v)], CANOPY, -f[3] * s, 0, f[2] * s); }
    for (let v = 28; v < v1 - 0.5; v += 2.4) for (const u of [-9.0, -6.6]) lmDisc(K.globe, at(u, v, y0 - 0.01), 0.09, [f[2], 0, f[3]], [-f[3], 0, f[2]], hb('#fff6e6'), [0, -1, 0]); }
  // forecourt: a granite terrace at the lobby floor, steps at its west end, a ramp with steel railings along the front
  { const ut = -13.4; lmBoxL(GS, f, ut, UG, V0 - 0.9, CV1 + 0.7, 0, 0.9, CONC, false);
    for (let k = 0; k < 6; k++) lmBoxL(GS, f, ut - 0.32 * (6 - k), ut + 0.02, V0 - 0.8, V0 + 3.2, k * 0.15, (k + 1) * 0.15, sh(CONC, 0.95 + (k % 2) * 0.06), false);
    const ua = ut - 2.1, ub = ut, va = V0 + 3.6, vb = V1, yr = v => 0.9 * (vb - v) / (vb - va);
    polyA(GS, [at(ua, va, 0.9), at(ub, va, 0.9), at(ub, vb, 0), at(ua, vb, 0)], sh(CONC, 1.04), 0, 1, 0);
    polyA(GS, [at(ua, va, 0), at(ua, va, 0.9), at(ua, vb, 0)], sh(CONC, 0.9), -f[2], 0, -f[3]); polyA(GS, [at(ua, va, 0), at(ub, va, 0), at(ub, va, 0.9), at(ua, va, 0.9)], sh(CONC, 0.85), f[3], 0, -f[2]);
    const rails = (u, base) => { for (let v = va; v <= vb + 0.01; v += (vb - va) / 12) lmBar(G, at(u, v, base(v)), at(u, v, base(v) + 0.95), 0.05, RAIL);
      for (const h of [0.5, 0.95]) lmBar(G, at(u, va, base(va) + h), at(u, vb, base(vb) + h), 0.045, RAIL); };
    rails(ua + 0.08, yr); rails(ub + 0.06, () => 0.9);
    const us = ut - 1.92; for (const v of [V0 - 0.65, V0 + 3.05]) { lmBar(G, at(us, v, 0.95), at(ut, v, 1.85), 0.045, RAIL); lmBar(G, at(us, v, 0), at(us, v, 0.95), 0.05, RAIL); lmBar(G, at(ut, v, 0.9), at(ut, v, 1.85), 0.05, RAIL); } }
  // plant on the roofs
  for (const [u, v, w, d, y, h] of [[24, 14, 4, 3, H.hall, 1.4], [24, 38, 5, 3, H.small, 1.2], [6, 54, 2.4, 2.4, H.east, 1.0]]) lmBoxL(G, f, u - w / 2, u + w / 2, v - d / 2, v + d / 2, y, y + h, hb('#8d9091'));
  // the building is missing from the data, so it registers its own outline
  lmRegisterOutline(f, [...WA, [UB, 4], [UB, V1], [36, V1], [36, V2], ...EA.slice().reverse(), [UG, V1], [UF, V1], [UF, V0]]);
}

export { lmRenesanse };
