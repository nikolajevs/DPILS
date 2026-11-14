import { lmDisc } from './university.js';
import { lmBar, lmBoxW, lmLit, lmWF, lmWall } from './helpers.js';
import { LMT, lr } from './tiles.js';
import { LMWHITE, LM_KEYS } from './core.js';
import { flatPlain } from '../buildings/walls.js';
import { ribbon } from '../world/streets.js';
import { LINES, M_PAVE, ROAD, inBuilding } from '../world/data.js';
import { scene } from '../render/renderer.js';
import { GB, box, polyA } from '../core/geometry.js';
import { hb, pip, sh } from '../core/util.js';
import { NAMES } from '../core/env.js';

/* ---------- Rīgas iela: historic street houses from short descriptions ----------
   The pedestrian Rīgas iela between Vienības laukums and the station is lined with two- to four-storey houses of
   the 1880s–1910s: rendered in pastel colours or in red facing brick, shops on the ground floor, windows with
   architraves, hoods and panels, rusticated ground floors, string courses, cornices on brackets, metal roofs sloping to
   the street. Each house is described in RIG_HOUSES (a point inside its cadastre outline, floors and heights from the
   cadastre, the rest from photographs of the street) and built here on that outline: the edges facing Rīgas iela get
   the full façade, edges on other streets the same façade with windows on the ground floor, courtyard walls plain
   windows, party walls stay blank. Owned outlines keep their collisions. */
const LM_OWNED = [];
const RIG_HOUSES = [
  // first block from Vienības laukums, south side, facing the hotel Latgola
  { key: [-1395.9, 1261.1], fl: 3, gh: 4.2, uh: 3.7, col: '#efe0b8', trim: '#f4efe2', bays: 6, gnd: 'shops', doors: [2], rust: 1, win: 'rect', hoods: ['flat', 'cap'], frame: 1, panels: 1, quoins: 1, cornice: 'bracket', roof: '#6a4537' },
  { key: [-1378.7, 1251.9], fl: 3, gh: 4.2, uh: 3.7, col: '#eecdbb', trim: '#f6efe6', bays: 4, gnd: 'shops', doors: [1], win: 'seg', hoods: [null, null], frame: 1, pil: 1, band: 1, cornice: 'dentil', roof: '#5b5e61' },
  { key: [-1368.2, 1245.0], fl: 3, gh: 3.6, uh: 2.85, col: '#e6dfd0', trim: '#eeebe4', bays: 3, gnd: 'shops', doors: [], win: 'rect', hoods: [null, null], cornice: 'plain', roof: '#62676a', plainWin: 1 },
  { key: [-1357.0, 1240.3], fl: 4, gh: 4.3, uh: 3.75, col: '#f1d993', trim: '#f7f2e4', bays: 4, gnd: 'shops', doors: [3], rust: 1, win: 'rect', hoods: ['ped', 'flat', null], frame: 1, panels: 1, balc: [{ bay: 1, fl: 1 }, { bay: 2, fl: 1 }], cornice: 'bracket', attic: [1, 2], roof: '#6d4a3a' },
  { key: [-1309.7, 1211.1], fl: 4, gh: 3.6, uh: 2.9, col: '#e3ddcf', trim: '#e9e6de', gnd: 'shops', doors: [3, 9], win: 'rect', hoods: [null, null, null], frame: 1, band: 1, cornice: 'plain', roof: '#5d6164', plainWin: 1 },
  // second block, south side, facing the square by Cietokšņa iela
  { key: [-1284.6, 1196.2], fl: 4, gh: 3.6, uh: 2.9, col: '#e9dfc8', trim: '#efe9dc', bays: 6, gnd: 'shops', doors: [0], win: 'rect', hoods: ['cap', null, null], frame: 1, band: 1, cornice: 'plain', roof: '#5f6265' },
  { key: [-1264.4, 1182.4], fl: 3, gh: 4.2, uh: 3.7, brick: 1, trim: '#a5472c', bays: 5, gnd: 'shops', doors: [3], gate: 4, win: 'arch', hoods: [null, null], frame: 1, panels: 1, band: 1, cornice: 'dentil', roof: '#5b5e61' },
  { key: [-1248.5, 1173.8], fl: 4, gh: 4.3, uh: 3.75, col: '#eeece5', gcol: '#efdc95', trim: '#f6f4ee', bays: 5, gnd: 'arch', doors: [2], win: 'arch', hoods: [null, null, null], frame: 1, panels: 1, rust: 1, band: 1, cornice: 'bracket', roof: '#5c6063' },
  { key: [-1233.8, 1164.2], fl: 4, gh: 4.3, uh: 3.75, col: '#f4e6c6', trim: '#f8f3e7', bays: 6, gnd: 'shops', doors: [2], win: 'rect', topWin: 'arch', hoods: ['ped', 'flat', null], frame: 1, pil: 1, band: 1, cornice: 'bracket', attic: [2, 3], roof: '#6b4636' }
];
for (const h of RIG_HOUSES) LM_KEYS.push(h.key);
let RIG_NAME = -1;
// the nearest named street within r of a point: [distance, unit direction, name]
function nearStreet(x, z, r) {
  let best = null; ROAD.near(x, z, r, (id, d) => { const s = ROAD.s, o = id * 6; if (s[o + 5] < 0) return; if (!best || d < best[0]) { const dx = s[o + 2] - s[o], dz = s[o + 3] - s[o + 1], L = Math.hypot(dx, dz) || 1; best = [d, [dx / L, dz / L], s[o + 5]]; } });
  return best;
}
function lmRigas(K) {
  RIG_NAME = NAMES.indexOf('Rīgas iela');
  const used = new Set();
  for (const S of RIG_HOUSES) { const o = LM_OWNED.find(o => !used.has(o) && pip(S.key[0], S.key[1], o.ring)); if (!o) continue; used.add(o); lmStreetHouse(K, o.ring, S); }
  lmRigasPaving();
}
/* the pedestrian street: red concrete pavers with a granite line down the middle, granite slabs along the houses */
function lmRigasPaving() {
  const b = new GB(false), lines = LINES.filter(l => l.name === RIG_NAME && l.cls === 5 && l.pts.length >= 4 && Math.hypot(l.pts[0] + 1438, l.pts[1] - 1260) > 30);
  const RED = hb('#8f5d4a'), GRAN = hb('#a7a49e'), MID = hb('#7f7d79');
  for (const l of lines) { ribbon(b, l.pts, 0, 4.2, RED); ribbon(b, l.pts, 6.6, 2.4, GRAN); ribbon(b, l.pts, -6.6, 2.4, GRAN); }
  const m = b.mesh(M_PAVE); if (m) { m.renderOrder = -36.8; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); }
  const c = new GB(false); for (const l of lines) ribbon(c, l.pts, 0, 0.18, MID);
  const cm = c.mesh(M_PAVE); if (cm) { cm.renderOrder = -36.7; cm.frustumCulled = false; cm.receiveShadow = true; scene.add(cm); }
}
function lmStreetHouse(K, ring, S) {
  const G = K.plain, n = ring.length >> 1, uh = S.uh, gh = S.gh, H = gh + (S.fl - 1) * uh, top = H + 0.62;
  const COL = S.brick ? [246, 240, 234] : hb(S.col), GCOL = S.gcol ? hb(S.gcol) : COL, TRIM = hb(S.trim), DEC = S.brick ? TRIM : TRIM, ROOF = hb(S.roof || '#5d6164');
  const stU = S.brick ? { tex: 3, col: COL, plinth: 0.45, pcol: [200, 194, 186] } : { tex: 1, col: COL };
  const stG = S.brick ? stU : { tex: 1, col: GCOL, plinth: 0.45, pcol: sh(GCOL, 0.72) };
  const ww = S.ww || 1.25, wh = Math.min(S.wh || 2.0, uh - 1.15), glassT = LMT.stGlass, darkT = LMT.stGlassDk;
  const winTile = () => S.plainWin ? 'stWin' : (lr() < 0.2 ? 'stWinC' : lr() < 0.15 ? 'stWinE' : 'stWin');
  // a fan of triangles in the wall plane (arched heads), drawn with a patch of the glass tile
  const fan = (F, s, y, r, rise, d, t, lit) => { const N = 10, uc = (t.u0 + t.u1) / 2, vc = (t.v0 + t.v1) / 2; for (let k = 0; k < N; k++) { const a0 = k / N, a1 = (k + 1) / N, P = a => { const x = (a - 0.5) * 2; return F.at(s + x * r, y + rise * Math.sqrt(Math.max(0, 1 - x * x)), d); };
    K.det.q(F.at(s, y, d), P(a0), P(a1), P(a1), [F.nx, 0, F.nz], [uc, vc, uc, vc, uc, vc, uc, vc], LMWHITE, lit ? 1 : 0); } };
  const arcFrame = (F, s, y, r, rise, col) => { const N = 9; for (let k = 0; k < N; k++) { const p = a => { const x = Math.cos(Math.PI * a); return F.at(s - x * (r + 0.08), y + (rise + 0.08) * Math.sin(Math.PI * a), -0.05); }; lmBar(G, p(k / N), p((k + 1) / N), 0.13, col); }
    lmBoxW(G, F, s - 0.1, s + 0.1, y + rise - 0.05, y + rise + 0.22, -0.1, 0, col); };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, P = [ring[2 * i], ring[2 * i + 1]], Q = [ring[2 * j], ring[2 * j + 1]], F = lmWF(P, Q), L = F.L; if (L < 0.3) continue;
    const mx = (P[0] + Q[0]) / 2, mz = (P[1] + Q[1]) / 2, out = [mx + F.nx * 0.7, mz + F.nz * 0.7];
    if (inBuilding(out[0], out[1])) { lmWall(K, P, Q, 0, top, [], stU); continue; }                // party wall: blank
    const st = nearStreet(mx + F.nx * 3, mz + F.nz * 3, 16), par = st && Math.abs(st[1][0] * F.tx + st[1][1] * F.tz) > 0.9;
    const isMain = par && st[2] === RIG_NAME, isStreet = par && !isMain, ops = [], gops = [];
    if (!isMain && !isStreet) {                                                                   // courtyard: plain windows
      if (L >= 3) for (let f = 0; f < S.fl; f++) { const y = (f ? gh + (f - 1) * uh : 0) + (f ? 0.9 : 1.0), nb = Math.floor(L / 3.2); for (let k = 0; k < nb; k++) { const s = (k + 0.5) * L / nb; (f ? ops : gops).push({ s0: s - ww / 2, s1: s + ww / 2, y0: y, y1: y + Math.min(wh, 1.9), d: 0.2, tile: 'stWin', sill: TRIM, lit: lmLit(0.35) }); } }
      lmWall(K, P, Q, 0, gh, gops, stG); lmWall(K, P, Q, gh, top, ops, stU); continue;
    }
    const nb = Math.max(1, S.bays && isMain ? S.bays : Math.round(L / 3.3)), bw = L / nb, sc = k => (k + 0.5) * bw;
    // upper floors
    for (let f = 1; f < S.fl; f++) {
      const y0 = gh + (f - 1) * uh, sill = y0 + 0.85, kind = f === S.fl - 1 && S.topWin ? S.topWin : S.win, hood = (S.hoods || [])[f - 1], rise = kind === 'arch' ? ww / 2 : kind === 'seg' ? 0.26 : 0, yt = sill + wh - rise;
      for (let k = 0; k < nb; k++) {
        const s = sc(k), balc = isMain && (S.balc || []).find(b => b.bay === k && b.fl === f), w2 = ww / 2;
        ops.push({ s0: s - w2, s1: s + w2, y0: balc ? y0 + 0.1 : sill, y1: yt, d: 0.25, tile: balc ? 'stBalc' : winTile(), sill: balc ? null : TRIM, lit: lmLit(0.45) });
        if (rise) { fan(F, s, yt, w2, rise, -0.012, glassT, lmLit(0.3)); if (S.frame) arcFrame(F, s, yt, w2, rise, DEC); }
        if (S.frame) { for (const e of [-1, 1]) lmBoxW(G, F, s + e * w2 - (e < 0 ? 0.13 : 0), s + e * w2 + (e > 0 ? 0.13 : 0), (balc ? y0 + 0.1 : sill) - 0.06, yt + (rise ? 0 : 0.13), -0.06, 0, DEC); if (!rise) lmBoxW(G, F, s - w2 - 0.13, s + w2 + 0.13, yt, yt + 0.13, -0.06, 0, DEC); }
        if (S.panels && !balc && sill - y0 > 0.6) lmBoxW(G, F, s - w2, s + w2, y0 + 0.2, sill - 0.14, -0.02, 0, sh(S.brick ? TRIM : COL, S.brick ? 1 : 0.98));
        if (hood === 'flat') { lmBoxW(G, F, s - w2 - 0.22, s + w2 + 0.22, yt + 0.14, yt + 0.3, -0.22, 0, DEC); lmBoxW(G, F, s - w2 - 0.13, s + w2 + 0.13, yt + 0.13, yt + 0.14, -0.1, 0, DEC); }
        if (hood === 'cap') lmBoxW(G, F, s - w2 - 0.18, s + w2 + 0.18, yt + 0.14, yt + 0.24, -0.14, 0, DEC);
        if (hood === 'ped') { const a = F.at(s - w2 - 0.25, yt + 0.16, -0.16), b = F.at(s + w2 + 0.25, yt + 0.16, -0.16), c = F.at(s, yt + 0.62, -0.16);
          polyA(G, [a, b, c], DEC, -F.nx, 0, -F.nz); lmBar(G, a, c, 0.12, sh(DEC, 1.03)); lmBar(G, c, b, 0.12, sh(DEC, 1.03)); lmBoxW(G, F, s - w2 - 0.28, s + w2 + 0.28, yt + 0.12, yt + 0.2, -0.2, 0, DEC); }
        if (balc) { lmBoxW(G, F, s - 1.05, s + 1.05, y0 - 0.06, y0 + 0.12, -0.95, 0, sh(DEC, 0.95)); const IRON = hb('#26292c');
          for (const [a, b] of [[[s - 1.0, -0.9], [s + 1.0, -0.9]], [[s - 1.0, -0.9], [s - 1.0, 0]], [[s + 1.0, -0.9], [s + 1.0, 0]]]) { lmBar(G, F.at(a[0], y0 + 1.0, a[1]), F.at(b[0], y0 + 1.0, b[1]), 0.05, IRON); lmBar(G, F.at(a[0], y0 + 0.2, a[1]), F.at(b[0], y0 + 0.2, b[1]), 0.03, IRON); }
          for (let x = s - 1.0; x <= s + 1.0 + 1e-3; x += 0.15) lmBar(G, F.at(x, y0 + 0.12, -0.9), F.at(x, y0 + 1.0, -0.9), 0.02, IRON); }
      }
    }
    // ground floor: shop fronts and doors on Rīgas iela, windows elsewhere; a gateway with its gate
    const gspans = [];
    for (let k = 0; k < nb; k++) {
      const s = sc(k), isDoor = isMain && (S.doors || []).includes(k), isGate = isMain && S.gate === k;
      if (isGate) { gops.push({ s0: s - 1.5, s1: s + 1.5, y0: 0, y1: 3.4, d: 3.0, tile: 'stGate', lit: 0, noFloor: true }); gspans.push([s - 1.5, s + 1.5]); continue; }
      if (isDoor) { const w = S.gnd === 'shops' ? 1.4 : 1.5; gops.push({ s0: s - w / 2, s1: s + w / 2, y0: 0.15, y1: 3.1, d: 0.3, tile: S.gnd === 'shops' ? 'stShopDoor' : 'stDoor', lit: 1 }); gspans.push([s - w / 2, s + w / 2]); continue; }
      if (isMain && S.gnd === 'shops') { const w = Math.min(bw - 0.7, 2.8); gops.push({ s0: s - w / 2, s1: s + w / 2, y0: 0.35, y1: Math.min(gh - 0.5, 3.35), d: 0.3, tile: 'stShop' + Math.floor(lr() * 6), lit: lmLit(0.85) }); gspans.push([s - w / 2, s + w / 2]); continue; }
      const arch = isMain && S.gnd === 'arch', w2 = ww / 2, rise = arch ? w2 : 0, y0 = 1.0, yt = Math.min(gh - 0.55, 3.2) - rise;
      gops.push({ s0: s - w2, s1: s + w2, y0, y1: yt, d: 0.25, tile: winTile(), sill: TRIM, lit: lmLit(0.4) }); gspans.push([s - w2, s + w2]);
      if (arch) { fan(F, s, yt, w2, rise, -0.012, glassT, 0); arcFrame(F, s, yt, w2, rise, DEC); }
    }
    lmWall(K, P, Q, 0, gh, gops, stG); lmWall(K, P, Q, gh, top, ops, stU);
    // rustication: grooves on the piers of the ground floor
    if (S.rust) { gspans.sort((a, b) => a[0] - b[0]); let s0 = 0; const piers = []; for (const [a, b] of gspans) { if (a > s0 + 0.1) piers.push([s0, a]); s0 = Math.max(s0, b); } if (L > s0 + 0.1) piers.push([s0, L]);
      for (const [a, b] of piers) for (let y = 0.95; y < gh - 0.3; y += 0.48) lmBoxW(G, F, a, b, y, y + 0.035, -0.012, 0, sh(GCOL, 0.78)); }
    // string course, quoins, pilasters, the cornice
    if (S.band || S.rust) lmBoxW(G, F, 0, L, gh - 0.1, gh + 0.16, -0.14, 0, DEC);
    if (S.quoins) for (const e of [0, 1]) for (let y = gh + 0.2, k = 0; y < H - 0.3; y += 0.44, k++) { const w = k % 2 ? 0.45 : 0.72; lmBoxW(G, F, e ? L - w : 0, e ? L : w, y, y + 0.38, -0.06, 0, sh(COL, 1.05)); }
    if (S.pil) for (let k = 0; k <= nb; k++) { const s = k * bw, w = k === 0 || k === nb ? 0.5 : 0.36; const a = Math.max(0, s - w / 2), b = Math.min(L, s + w / 2); lmBoxW(G, F, a, b, gh + 0.16, H, -0.08, 0, sh(COL, 1.05)); lmBoxW(G, F, a - 0.05, b + 0.05, H - 0.2, H, -0.12, 0, DEC); }
    lmBoxW(G, F, 0, L, top - 0.12, top, -0.18, 0, DEC);
    lmBoxW(G, F, 0, L, top, top + 0.18, -0.58, 0, DEC); lmBoxW(G, F, 0, L, top + 0.18, top + 0.3, -0.64, 0, sh(DEC, 1.04));
    if (S.cornice === 'bracket') for (let s = 0.4; s < L - 0.2; s += 0.78) lmBoxW(G, F, s - 0.07, s + 0.07, H + 0.2, top, -0.46, 0, DEC);
    if (S.cornice === 'dentil') for (let s = 0.2; s < L - 0.1; s += 0.26) lmBoxW(G, F, s - 0.06, s + 0.06, top - 0.24, top - 0.12, -0.3, 0, DEC);
    // the roof slope over this façade, a gable in the attic, chimneys
    const k = 4.2, rise = 2.4, e0 = F.at(0, top + 0.3, -0.64), e1 = F.at(L, top + 0.3, -0.64), r0 = F.at(0, top + 0.3 + rise, k), r1 = F.at(L, top + 0.3 + rise, k);
    polyA(G, [e0, e1, r1, r0], ROOF, -F.nx, 1.2, -F.nz);
    for (const [e, r, s] of [[e0, r0, 0], [e1, r1, L]]) polyA(G, [F.at(s, top + 0.3, 0), r, F.at(s, top + 0.3, k)], sh(COL, 0.85), (s ? 1 : -1) * F.tx, 0, (s ? 1 : -1) * F.tz);
    if (isMain && S.attic) { const a = S.attic[0] * bw, b = (S.attic[1] + 1) * bw, m = (a + b) / 2, hh = (b - a) * 0.28, A = F.at(a, top + 0.3, -0.05), B = F.at(b, top + 0.3, -0.05), Cc = F.at(m, top + 0.3 + hh, -0.05);
      polyA(G, [A, B, Cc], COL, -F.nx, 0, -F.nz); polyA(G, [F.at(a, top + 0.3, 0.3), F.at(b, top + 0.3, 0.3), F.at(m, top + 0.3 + hh, 0.3)], sh(COL, 0.8), F.nx, 0, F.nz);
      lmBar(G, F.at(a - 0.2, top + 0.28, -0.12), F.at(m, top + 0.4 + hh, -0.12), 0.18, DEC); lmBar(G, F.at(m, top + 0.4 + hh, -0.12), F.at(b + 0.2, top + 0.28, -0.12), 0.18, DEC);
      lmDisc(G, F.at(m, top + 0.3 + hh * 0.45, -0.07), Math.min(0.45, hh * 0.3), [F.tx, 0, F.tz], [0, 1, 0], sh(DEC, 0.92), [-F.nx, 0, -F.nz]); }
    if (L > 8) for (const s of [L * 0.22, L * 0.78]) { const c = F.at(s, 0, k + 0.3); box(G, c[0], c[2], F.tx, F.tz, 0.35, 0.3, top + 0.3, top + 0.3 + rise + 1.0, sh(COL, 0.8)); }
  }
  flatPlain(G, [ring], top + 0.28, sh(ROOF, 0.85), false);
}

export { LM_OWNED, lmRigas };
