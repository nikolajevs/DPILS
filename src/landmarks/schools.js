import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { LMB } from './core.js';
import { lmBar, lmBoxW, lmLathe, lmWF, lmWall } from './helpers.js';
import { LMM, lmStd } from './index.js';
import { lmFlag } from './university.js';
import { schGrounds } from './school-grounds.js';
import { band, flatRoof, roofFace, tileOf, vband } from '../buildings/walls.js';
import { ROOFPAL } from '../world/palette.js';
import { ROAD, inBuilding } from '../world/data.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { polyA } from '../core/geometry.js';
import { area2, bbox, edgeN, hb, insetOk, obb, offsetRing, pick, pip, rnd, sh } from '../core/util.js';

/* ---------- schools ----------
   The school and college buildings of the city (schools.js, from OpenStreetMap through tools/schools.js) are taken
   out of the general generator and drawn with school façades: the outline, storeys and height stay those of the
   cadastre parts that lie in each OSM school building, the façade follows one of three kits.

   - soviet: the typical schools of the 1960s–80s. Wide classroom windows in threes (2.6 × 1.9 m) in bays of about
     3.4 m, a narrow column of staircase windows on short walls, a high band of windows on a sports hall, a flat roof
     behind a parapet, the entrance in a glazed single-storey porch with a canopy and the school's name. The walls are
     either the pale sand-lime brick with the windows set in a band of red brick (11., 13. and Centra schools in the
     2000s, Commons photographs) or, after the thermal renovations of the 2010s–20s, white render with coloured
     panels: pastel squares under the windows and orange ends (13. school 2021), pink piers between the windows and a
     row of red columns along the ground floor (10. school), yellow, orange and green bands (Iespēju school from the
     air).
   - stalin: the schools of the 1950s (17. school): rendered walls with pilasters between the windows, a cornice and
     a hipped roof.
   - hist: the older buildings: the Polish gymnasium in red brick with arched windows, the State Gymnasium in white
     with arched windows over a grey plinth, the 6. school in ochre with white trim, Vienības school in cream render
     between piers of red brick.
   Which building gets which kit, and its colours, is in SPEC (by OSM id); buildings without a photograph get the
   brick soviet kit, the common look of the city's schools. */
const SD = window.SCHOOLS || null;

// ---- the buildings and their kits
const BRICK = { kit: 'soviet', wall: 'sil', accent: 'band' };
const SPEC = {
  w899622290: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS 11. PAMATSKOLA' },                                   // 11. pamatskola, Arhitektu iela 10
  r11094370: { kit: 'soviet', wall: 'sil', tint: '#efe2c6', accent: 'frame', sign: 'DAUGAVPILS CENTRA VIDUSSKOLA', signCol: 'white' },   // Kandavas iela 17
  w129143927: { kit: 'soviet', wall: 'ren', col: '#e9e8e3', accent: 'squares', cols: ['#e8d9a6', '#c9dce6', '#e7c7b6', '#cfe0c4', '#e3cfe0'], ends: '#e39a45', canopy: '#a63a2c', sign: 'DAUGAVPILS IESPĒJU VIDUSSKOLA', signCol: 'steel' },   // 18. novembra iela 197V (13. school)
  w129150675: { kit: 'soviet', wall: 'ren', col: '#f1f0ec', accent: 'stripes', cols: ['#f0c84a', '#ec8a3a', '#7fb35a', '#5f9fd0'], ends: '#f0c84a', sign: 'DAUGAVPILS IESPĒJU VIDUSSKOLA' },   // Valkas iela 4
  w129143933: { kit: 'soviet', wall: 'ren', col: '#f1f0ec', accent: 'stripes', cols: ['#ec8a3a', '#f0c84a', '#7fb35a'], ends: '#ec8a3a' },          // Valkas iela 4A
  r1748920: { kit: 'soviet', wall: 'ren', col: '#f3f2ee', accent: 'piers', cols: ['#d9a9a4'], columns: '#a8352f', sign: 'Daugavpils Valstspilsētas vidusskola', signCol: 'red', serif: true },   // Tautas iela 11 (10. school)
  w628599772: { kit: 'stalin', col: '#b9b2a2', trim: '#d8d3c6', roofCol: '#8b8f92', sign: 'DAUGAVPILS DRAUDZĪGĀ AICINĀJUMA VIDUSSKOLA' },             // Valmieras iela 5 (17. school)
  w186641203: { kit: 'hist', wall: 'brick', trim: '#9b4630', win: 'arch', winCol: 'brown', cornice: '#8e4330', roofCol: '#4d4f52', sign: null },      // Polish gymnasium, Varšavas iela 2
  w191199129: { kit: 'hist', wall: 'ren', col: '#f2f1ec', trim: '#ffffff', plinthCol: '#a9a6a0', plinthH: 1.3, win: 'archGround', winCol: 'brown', roofCol: '#6c7074', sign: 'DAUGAVPILS VALSTS ĢIMNĀZIJA', signCol: 'red' },
  w179008092: { kit: 'hist', wall: 'ren', col: '#e2b85e', trim: '#f4efe2', plinthCol: '#d9d2c2', win: 'rect', winCol: 'white', roofCol: '#55585b', sign: 'J. RAIŅA DAUGAVPILS 6. VIDUSSKOLA', signCol: 'dark' },   // Komunālā iela 2
  w191199127: { kit: 'hist', wall: 'ren', col: '#ede0bf', trim: '#f4eee0', piers: 'brick', win: 'archGround', winCol: 'white', roofCol: '#6e7377', sign: 'DAUGAVPILS VIENĪBAS PAMATSKOLA', signCol: 'dark' },   // Ģimnāzijas iela 32
  w130283112: { kit: 'hist', wall: 'ren', col: '#e9d7b8', trim: '#f6f1e6', win: 'rect', winCol: 'white' },                          // Saules skola, Muzeja iela 3
  w130283141: { kit: 'hist', wall: 'brick', trim: '#a9533a', win: 'seg', winCol: 'white' },                                         // Saules iela 8
  w893707840: { kit: 'soviet', wall: 'ren', col: '#f0efea', accent: 'squares', cols: ['#f2b84b', '#d9573b'], sign: 'SAULES SKOLA', signCol: 'dark' },   // Saules iela 2
  w893707841: { kit: 'soviet', wall: 'ren', col: '#f0efea', accent: 'squares', cols: ['#f2b84b', '#d9573b'] },
  w132759509: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS DRAUDZĪGĀ AICINĀJUMA VIDUSSKOLA' },              // Aveņu iela 40 (16. school)
  w628607811: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS VALSTSPILSĒTAS VIDUSSKOLA' },                     // Kauņas iela 8
  w180328966: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS ZINĀTŅU VIDUSSKOLA' },                          // Raiņa iela 30 (3. school)
  w814014335: { kit: 'soviet', wall: 'sil', accent: 'frame', sign: 'DAUGAVPILS ZINĀTŅU VIDUSSKOLA' },                         // 18. novembra iela 47 (9. school)
  w130278828: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS SASKAŅAS PAMATSKOLA' },                          // Parādes iela 7
  w179494904: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS 8. PAMATSKOLA' },                               // Ūdens iela 24
  w129150689: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS TEHNOLOĢIJU VIDUSSKOLA-LICEJS' },               // Tautas iela 59
  w129571404: { kit: 'soviet', wall: 'sil', accent: 'band' }, w129571405: { kit: 'soviet', wall: 'sil', accent: 'band' },     // Stropi
  w129571418: { kit: 'stalin', col: '#d9cfb8', trim: '#efe9dc', sign: 'DAUGAVPILS STROPU PAMATSKOLA' },                       // Abavas iela 1
  w628612275: { kit: 'soviet', wall: 'sil', accent: 'band' },                                                                 // Jelgavas iela 30A
  w115788071: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS BŪVNIECĪBAS TEHNIKUMS' },                       // Jātnieku iela 87
  w130274810: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS TIRDZNIECĪBAS PROFESIONĀLĀ VIDUSSKOLA' },        // Miera iela 57
  w628607655: { kit: 'soviet', wall: 'sil', accent: 'band', sign: 'DAUGAVPILS TEHNOLOĢIJU UN TŪRISMA TEHNIKUMS' },            // Strādnieku iela 16
  w366928859: { kit: 'soviet', wall: 'sil', accent: 'band' },                                                                 // Mendeļejeva iela 1
};

// ---- school buildings of schools.js; the cadastre parts that lie in them are claimed while the city is built
const SB = []; let sbInit = false;
function sbPrepare() {
  sbInit = true; if (!SD) return;
  for (const b of SD.buildings) {
    const spec = SPEC[b[1]] || ((b[2] === 'school' || b[2] === 'college') ? BRICK : null); if (!spec) continue;
    const r = b[5].slice(0, -2); SB.push({ s: b[0], id: b[1], ring: r, bb: bbox(r), spec, addr: b[4], parts: [] });
  }
}
// a point inside a ring: its centre if it is, else the middle of the widest run of the horizontal line through it
function inner(r) {
  const n = r.length >> 1; let cx = 0, cz = 0; for (let i = 0; i < r.length; i += 2) { cx += r[i]; cz += r[i + 1]; } cx /= n; cz /= n;
  if (pip(cx, cz, r)) return [cx, cz];
  const xs = []; for (let i = 0; i < n; i++) { const j = (i + 1) % n, az = r[2 * i + 1], bz = r[2 * j + 1]; if ((az > cz) !== (bz > cz)) xs.push(r[2 * i] + (r[2 * j] - r[2 * i]) * (cz - az) / (bz - az)); }
  xs.sort((a, b) => a - b); let best = [cx, cz], w = 0; for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > w) { w = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, cz]; }
  return best;
}
/* Called by buildBuildings for every building: a part of a school building is kept for lmSchools, which draws its
   walls; its roof is drawn now with the city's roof textures (flat behind a parapet, pitched ones as the generic
   generator draws them). */
function schClaim(id, rec, rings, outer, bb) {
  if (!sbInit) sbPrepare();
  for (const b of SB) {
    if (bb[2] < b.bb[0] || bb[0] > b.bb[2] || bb[3] < b.bb[1] || bb[1] > b.bb[3]) continue;
    const p = inner(outer); if (!pip(p[0], p[1], b.ring)) continue;
    const h = rec[1] / 10, floors = Math.max(1, rec[5]), pitched = rec[4] >= 16 && b.spec.kit !== 'soviet';
    const part = { id, rings, outer, bb, h, floors, pitched, gbc: STATE.GBC, b };
    b.parts.push(part); schRoof(part, rec); return true;
  }
  return false;
}
function schRoof(e, rec) {
  const { outer, rings, h, id } = e, cx = (e.bb[0] + e.bb[2]) / 2, cz = (e.bb[1] + e.bb[3]) / 2, T = tileOf(cx, cz), G = T.m, seed = Math.floor(rnd(id, 9) * 255);
  let mat = rec[4] & 15;
  if (e.pitched) {
    if (!mat) mat = 2; const tint = e.b.spec.roofCol ? hb(e.b.spec.roofCol) : pick(ROOFPAL[mat], id, 2), tanp = Math.tan(0.5), ov = 0.35, o = obb(outer);
    let d = Math.min(6, o ? o.b * 0.95 : 4), inn = null;
    for (let k = 0; k < 5 && d > 0.7; k++) { const q = offsetRing(outer, -d); if (insetOk(outer, q)) { inn = q; break; } d *= 0.6; }
    if (inn && rings.length === 1) {
      const eave = offsetRing(outer, ov), yE = h - ov * tanp, yT = h + d * tanp, n = outer.length >> 1;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, ed = edgeN(outer, i); if (ed[2] < 0.05) continue; roofFace(G.roof, [[eave[2 * i], yE, eave[2 * i + 1]], [eave[2 * j], yE, eave[2 * j + 1]], [inn[2 * j], yT, inn[2 * j + 1]], [inn[2 * i], yT, inn[2 * i + 1]]], ed[0], ed[1], tint, mat, seed); }
      flatRoof(G.roof, [inn], yT, tint, mat, seed); band(G.plain, outer, eave, yE, hb('#6f6a63'), true);
      return;
    }
    e.pitched = false;
  }
  flatRoof(G.roof, rings, h + 0.05, pick(ROOFPAL[5], id, 2), 5, seed);
}

// ---- the atlas of school windows, doors and porch glazing (colour, ORM, night light), and the signs
const SCHT = {}, SCHS = {};
function schAtlas() {
  const PX = 48, AW = 1024, AH = 512, cv = mkCanvas(AW, AH), om = mkCanvas(AW, AH), gm = mkCanvas(AW, AH), g = cv.getContext('2d'), o = om.getContext('2d'), e = gm.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, AW, AH); o.fillStyle = 'rgb(0,225,0)'; o.fillRect(0, 0, AW, AH); e.fillStyle = '#000'; e.fillRect(0, 0, AW, AH);
  let X = 0, Y = 0, rowY = 2, rowH = 0, x0 = 2;
  const ORM = { matte: 'rgb(0,225,0)', metal: 'rgb(0,110,110)', glass: 'rgb(0,26,0)' };
  const R = (x, y, w, h, col, k = 'matte') => { g.fillStyle = col; g.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); o.fillStyle = ORM[k]; o.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); e.fillStyle = '#000'; e.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); };
  const glass = (x, y, w, h, tone = 0, glow = '#ffcf94') => {
    const a = X + x * PX, b = Y + y * PX, gr = g.createLinearGradient(0, b, 0, b + h * PX), c = [['#3a4650', '#62717d', '#2c353d'], ['#4a6b7c', '#8fb0c0', '#3a5a6c']][tone];
    gr.addColorStop(0, c[0]); gr.addColorStop(0.45, c[1]); gr.addColorStop(0.52, c[2]); gr.addColorStop(1, c[0]); g.fillStyle = gr; g.fillRect(a, b, w * PX, h * PX);
    o.fillStyle = ORM.glass; o.fillRect(a, b, w * PX, h * PX); e.fillStyle = glow; e.fillRect(a, b, w * PX, h * PX);
  };
  // a frame with panes: columns of widths (fractions), each column split at the given heights (fractions from the top)
  const win = (w, h, f, cols, splits, frame, tone) => {
    R(0, 0, w, h, frame, 'matte'); let x = f;
    cols.forEach((cw, k) => { const pw = (w - f * (cols.length + 1)) * cw, sp = [0, ...(splits[k] || []), 1]; let y = f;
      for (let j = 0; j < sp.length - 1; j++) { const ph = (h - f * (sp.length)) * (sp[j + 1] - sp[j]); glass(x, y, pw, ph, tone); y += ph + f; }
      x += pw + f; });
  };
  const defs = [
    ['cls', 2.6, 1.9, () => win(2.6, 1.9, 0.07, [0.34, 0.32, 0.34], [[0.3], [0.3], [0.3]], '#f2f2ef', 0)],        // classroom window, white PVC
    ['clsT', 2.6, 1.9, () => win(2.6, 1.9, 0.07, [0.34, 0.32, 0.34], [[0.3], [0.3], [0.3]], '#f2f2ef', 1)],
    ['stair', 1.2, 1.5, () => win(1.2, 1.5, 0.07, [0.5, 0.5], [[0.35], [0.35]], '#f2f2ef', 0)],
    ['gym', 3.0, 1.5, () => win(3.0, 1.5, 0.08, [0.25, 0.25, 0.25, 0.25], [[0.5], [0.5], [0.5], [0.5]], '#e9e9e4', 0)],
    ['histB', 1.3, 2.3, () => win(1.3, 2.3, 0.08, [0.5, 0.5], [[0.28], [0.28]], '#5b3b26', 0)],                       // wooden casements with a transom
    ['histW', 1.3, 2.3, () => win(1.3, 2.3, 0.08, [0.5, 0.5], [[0.28], [0.28]], '#efede6', 0)],
    ['door', 2.0, 2.5, () => { win(2.0, 2.5, 0.09, [0.5, 0.5], [[0.22], [0.22]], '#7d8389', 0); R(0.93, 1.25, 0.04, 0.3, '#c9cdd1', 'metal'); R(1.03, 1.25, 0.04, 0.3, '#c9cdd1', 'metal'); }],
    ['doorW', 1.8, 2.9, () => { R(0, 0, 1.8, 2.9, '#5a3a26'); glass(0.1, 0.1, 1.6, 0.55, 0); for (const x of [0.1, 0.95]) { R(x, 0.75, 0.75, 2.05, '#6b4630'); for (let k = 0; k < 3; k++) R(x + 0.12, 0.9 + k * 0.65, 0.51, 0.5, '#5a3a26'); } }],
    ['curtain', 1.5, 3.3, () => win(1.5, 3.3, 0.06, [1], [[0.32, 0.7]], '#8a9096', 1)],
  ];
  defs.sort((a, b) => b[2] - a[2]);
  for (const [name, w, h, draw] of defs) {
    const pw = Math.ceil(w * PX), ph = Math.ceil(h * PX);
    if (x0 + pw > AW) { x0 = 2; rowY += rowH + 4; rowH = 0; }
    X = x0; Y = rowY; for (const c of [g, o, e]) { c.save(); c.beginPath(); c.rect(X, Y, pw, ph); c.clip(); } draw(); for (const c of [g, o, e]) c.restore();
    SCHT[name] = { u0: (X + 0.5) / AW, u1: (X + pw - 0.5) / AW, v0: 1 - (Y + ph - 0.5) / AH, v1: 1 - (Y + 0.5) / AH };
    x0 += pw + 4; rowH = Math.max(rowH, ph);
  }
  const mk = (c, srgb) => { const t = toTex(c, srgb, false); t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  return [mk(cv, true), mk(om, false), mk(gm, true)];
}
// the names in letters on a transparent canvas, red, white, steel or dark, sans-serif or serif; packed in rows
function schSigns(list) {
  const W = 2048, LH = 64, H = 2048, cv = mkCanvas(W, H), g = cv.getContext('2d'), gm = mkCanvas(W, H), e = gm.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const COL = { red: '#b02a2c', white: '#f6f4ee', steel: '#a7adb2', dark: '#2a2d30' };
  let x = 0, y = 4;
  for (const s of list) {
    const key = s.text + '|' + s.col + '|' + (s.serif ? 1 : 0); if (SCHS[key]) continue;
    g.font = s.serif ? `700 ${LH * 0.74}px Georgia, "Times New Roman", serif` : `700 ${LH * 0.74}px "Golos Text", "Trebuchet MS", sans-serif`;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    const w = Math.min(W - 8, Math.ceil(g.measureText(s.text).width) + 8);
    if (x + w > W) { x = 0; y += LH + 4; } if (y + LH > H) { console.warn('school signs overflow'); break; }
    g.fillStyle = COL[s.col] || COL.dark; g.fillText(s.text, x + 4, y + LH / 2, W - 16);
    SCHS[key] = { u0: (x + 2) / W, u1: (x + w + 2) / W, v0: 1 - (y + LH - 2) / H, v1: 1 - (y + 2) / H, aspect: w / LH };
    x += w + 8;
  }
  const t = toTex(cv, true, false), te = toTex(gm, true, false); t.minFilter = te.minFilter = THREE.LinearMipmapLinearFilter; return [t, te];
}

// ---- helpers
const KS = { det: null, txt: null };
const lit = p => Math.random() < p;
// distance from a point to the nearest named street
function streetD(x, z, r) { let best = 1e9; ROAD.near(x, z, r, (id, d) => { if (ROAD.s[id * 6 + 5] >= 0 && d < best) best = d; }); return best; }
// a quad of the sign atlas on a wall: letters of height lh centred at s, their foot at y, standing proud of the wall by d
function signOn(F, s, y, lh, maxW, sg, d = -0.06) {
  const t = SCHS[sg.text + '|' + sg.col + '|' + (sg.serif ? 1 : 0)]; if (!t) return;
  let w = lh * t.aspect; if (w > maxW) { lh *= maxW / w; w = maxW; }
  KS.txt.q(F.at(s + w / 2, y, d), F.at(s - w / 2, y, d), F.at(s - w / 2, y + lh, d), F.at(s + w / 2, y + lh, d), [F.nx, 0, F.nz], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], [255, 255, 255], 0);
}

/* ---- the soviet kit ---- */
function wallStyle(sp) {
  if (sp.wall === 'sil') return { tex: 7, col: sp.tint ? hb(sp.tint) : [255, 255, 255] };
  if (sp.wall === 'brick') return { tex: 3, col: [255, 255, 255] };
  return { tex: 1, col: hb(sp.col || '#efeeea') };
}
function schSoviet(K, b, e, main) {
  const sp = b.spec, G = K.plain, h = e.h, floors = e.floors, yb = 0.5, fh = (h - yb) / floors, gym = fh > 4.6 && floors <= 2, top = h + (e.pitched ? 0 : 0.55);
  const ST = wallStyle(sp), RED = { tex: 3, col: [206, 186, 180] }, PL = { tex: 1, col: hb(sp.plinth || (sp.wall === 'ren' ? '#8e8a83' : '#9a958c')) };
  const ww = 2.6, wh = Math.min(1.9, fh - 1.1), sillH = Math.max(0.8, Math.min(0.95, fh - wh - 0.35)), bay = sp.bay || 3.4, SILL = hb('#d7d6d1');
  const tileCls = sp.wall === 'ren' ? SCHT.clsT : SCHT.cls, cols = (sp.cols || []).map(hb), ends = sp.ends ? hb(sp.ends) : null;
  e.rings.forEach((r, ri) => {
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, P = [r[2 * i], r[2 * i + 1]], Q = [r[2 * j], r[2 * j + 1]], F = lmWF(P, Q), L = F.L; if (L < 0.3) continue;
      const mx = (P[0] + Q[0]) / 2, mz = (P[1] + Q[1]) / 2;
      if (inBuilding(mx + F.nx * 0.7, mz + F.nz * 0.7)) { lmWall(K, P, Q, 0, top, [], ST); continue; }   // against another part: blank
      const isMain = main && main.e === e && main.i === i && main.ri === ri;
      const endWall = L < 9.5, st = endWall && ends ? { tex: 1, col: ends } : ST;
      const ops = [], bands = [];
      if (gym && !endWall) {                                                                  // a sports hall: a band of high windows
        const nb = Math.max(1, Math.round(L / 3.6)), bw = L / nb;
        for (let k = 0; k < nb; k++) { const s = (k + 0.5) * bw; ops.push({ s0: s - 1.5, s1: s + 1.5, y0: h - 2.3, y1: h - 0.8, d: 0.14, tile: SCHT.gym, det: KS.det, lit: lit(0.1), sill: SILL }); }
      } else if (endWall) {                                                                   // a staircase: a column of narrow windows between the floors
        if (L >= 2.6) for (let f = 0; f < floors; f++) { const y = yb + f * fh + (f ? -0.3 : 1.0); if (y + 1.5 < h - 0.3) ops.push({ s0: L / 2 - 0.6, s1: L / 2 + 0.6, y0: y, y1: y + 1.5, d: 0.14, tile: SCHT.stair, det: KS.det, lit: lit(0.2), sill: SILL }); }
      } else {
        const nb = Math.max(1, Math.round(L / bay)), bw = L / nb, w2 = Math.min(ww, bw - 0.7) / 2;
        for (let f = 0; f < floors; f++) {
          const y0 = yb + f * fh + sillH, y1 = y0 + wh;
          for (let k = 0; k < nb; k++) {
            const s = (k + 0.5) * bw;
            if (isMain && f === 0 && Math.abs(s - main.s) < main.w / 2 + 0.5) continue;      // behind the porch
            ops.push({ s0: s - w2, s1: s + w2, y0, y1, d: 0.16, tile: tileCls, det: KS.det, lit: lit(0.12), sill: SILL });
          }
          bands.push([y0 - 0.12, y1 + 0.18]);
        }
        // accents: brick bands or frames, coloured squares, piers or stripes
        if (sp.accent === 'frame' || sp.accent === 'piers') for (const o of ops) {
          const c = sp.accent === 'frame' ? hb('#a24a33') : cols[0];
          if (sp.accent === 'frame') { const fw = 0.13; lmBoxW(G, F, o.s0 - fw, o.s1 + fw, o.y1, o.y1 + 0.2, -0.04, 0, c); lmBoxW(G, F, o.s0 - fw, o.s1 + fw, o.y0 - 0.26, o.y0, -0.04, 0, c);
            for (const sgn of [-1, 1]) lmBoxW(G, F, sgn < 0 ? o.s0 - fw : o.s1, sgn < 0 ? o.s0 : o.s1 + fw, o.y0, o.y1, -0.04, 0, c); }
        }
        if (sp.accent === 'piers') for (let f = 0; f < floors; f++) for (let k = 0; k <= nb; k++) {
          const s = k * bw, y0 = yb + f * fh + sillH, a = Math.max(0, s - (bw / 2 - w2)), c2 = Math.min(L, s + (bw / 2 - w2)); if (c2 - a > 0.1) lmBoxW(G, F, a, c2, y0, y0 + wh, -0.025, 0, cols[0]);
        }
        if (sp.accent === 'squares') for (let f = 1; f < floors; f++) for (let k = 0; k < nb; k++) {
          if (rnd(e.id * 7 + i * 31 + k, f) > 0.35) continue; const s = (k + 0.5) * bw, y0 = yb + f * fh + 0.12;
          lmBoxW(G, F, s - 0.55, s + 0.55, y0, y0 + sillH - 0.3, -0.025, 0, cols[Math.floor(rnd(e.id + k * 13, f + i) * cols.length)]);
        }
        if (sp.accent === 'stripes') { const c = cols[(i + ri * 3 + e.id) % cols.length];   // a coloured band along the top floor and at the ends
          const y0 = yb + (floors - 1) * fh + sillH + wh + 0.2; if (y0 + 0.4 < h) lmBoxW(G, F, 0, L, y0, Math.min(h, y0 + 0.6), -0.03, 0, c);
          lmBoxW(G, F, 0, Math.min(1.6, L / 6), yb, h, -0.03, 0, c); }
        if (sp.columns && isMain) {                                                           // red columns along the ground floor
          const c = hb(sp.columns), y1 = yb + fh; for (let k = 0; k <= nb; k++) { const s = Math.max(0.3, Math.min(L - 0.3, k * bw)); lmBoxW(G, F, s - 0.22, s + 0.22, 0, y1, -1.6, -1.16, c); }
          lmBoxW(G, F, 0, L, y1, y1 + 0.35, -1.9, 0, hb(sp.col || '#efeeea'));
        }
      }
      // horizontal bands of the wall: plinth, the window bands in red brick on the brick kit, the rest in the wall
      const ys = [0, yb]; for (const [a, c] of bands) if (sp.accent === 'band') ys.push(a, c); ys.push(top);
      for (let k = 0; k < ys.length - 1; k++) {
        const a = ys[k], c = ys[k + 1]; if (c <= a + 0.01) continue;
        const s2 = k === 0 ? PL : (sp.accent === 'band' && k % 2 === 0 && k < ys.length - 2) ? RED : st;
        lmWall(K, P, Q, a, c, ops.filter(o => o.y0 >= a - 1e-3 && o.y1 <= c + 1e-3), s2);
      }
    }
  });
  if (!e.pitched) { const q = offsetRing(e.outer, -0.25); vband(G, q, h, top, sh(ST.col, 0.8), -1); band(G, e.outer, q, top, hb('#8e9195'), false); }
}

/* ---- the stalin and historic kits ---- */
function schHist(K, b, e) {
  const sp = b.spec, G = K.plain, h = e.h, floors = e.floors, stalin = sp.kit === 'stalin';
  const plH = sp.plinthH || (stalin ? 0.9 : 0.8), fh = (h - plH) / floors, TR = hb(sp.trim || '#f2efe6');
  const ST = sp.wall === 'brick' ? { tex: 3, col: [255, 255, 255] } : { tex: 1, col: hb(sp.col || '#e8dcc4') }, PL = { tex: 1, col: hb(sp.plinthCol || '#8f8a82') };
  const ww = stalin ? 1.4 : 1.3, bay = stalin ? 3.0 : 3.2, top = h + (e.pitched ? 0 : 0.7), tile = sp.winCol === 'brown' ? SCHT.histB : SCHT.histW;
  e.rings.forEach(r => {
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, P = [r[2 * i], r[2 * i + 1]], Q = [r[2 * j], r[2 * j + 1]], F = lmWF(P, Q), L = F.L; if (L < 0.3) continue;
      const mx = (P[0] + Q[0]) / 2, mz = (P[1] + Q[1]) / 2;
      if (inBuilding(mx + F.nx * 0.7, mz + F.nz * 0.7)) { lmWall(K, P, Q, 0, top, [], ST); continue; }
      const ops = [], nb = L >= 2.4 ? Math.max(1, Math.round(L / bay)) : 0, bw = nb ? L / nb : L;
      for (let f = 0; f < floors; f++) {
        const yf = plH + f * fh, wh = Math.min(2.3, fh - 1.1), y0 = yf + Math.max(0.7, (fh - wh) * 0.55), arch = sp.win === 'arch' || (sp.win === 'archGround' && f === 0), seg = sp.win === 'seg';
        for (let k = 0; k < nb; k++) {
          const s = (k + 0.5) * bw, rr = ww / 2, yt = y0 + wh - (arch ? rr : 0);
          ops.push({ s0: s - rr, s1: s + rr, y0, y1: y0 + wh, d: 0.22, tile, det: KS.det, lit: lit(0.15), sill: TR });
          if (arch) {   // a round head: the wall fills the corners over the arch, a moulding runs round it
            const N = 9, p = (t, g) => { const x = Math.cos(Math.PI * t); return F.at(s - x * (rr + g), yt + (rr + g) * Math.sin(Math.PI * t), g ? -0.05 : 0); };
            for (let a = 0; a < N; a++) {
              lmBar(G, p(a / N, 0.1), p((a + 1) / N, 0.1), 0.16, TR);
              const P1 = p(a / N, 0), P2 = p((a + 1) / N, 0), left = (a + 0.5) / N < 0.5, corner = F.at(left ? s - rr : s + rr, yt + rr, 0);
              polyA(G, [corner, P1, P2], sh(ST.col, sp.wall === 'brick' ? 0.62 : 0.96), F.nx, 0, F.nz);
            }
          } else { lmBoxW(G, F, s - rr - 0.14, s + rr + 0.14, yt, yt + (seg ? 0.3 : 0.18), -0.07, 0, TR);
            if (!stalin) for (const sg of [-1, 1]) lmBoxW(G, F, sg < 0 ? s - rr - 0.14 : s + rr, sg < 0 ? s - rr : s + rr + 0.14, y0, yt, -0.05, 0, TR); }
        }
        if (f) lmBoxW(G, F, 0, L, yf - 0.1, yf + 0.12, -0.08, 0, TR);                          // a belt course at each floor
      }
      if (stalin || sp.piers) for (let k = 0; k <= nb; k++) {                                      // pilasters, or piers of red brick
        const s = Math.max(0.25, Math.min(L - 0.25, k * bw)), c = sp.piers ? hb('#a9533a') : TR; lmBoxW(G, F, s - 0.25, s + 0.25, plH, h - 0.5, -0.09, 0, c); }
      lmBoxW(G, F, -0.3, L + 0.3, h - 0.55, h, -0.3, 0, hb(sp.cornice || sp.trim || '#efeadf'));   // the cornice
      lmWall(K, P, Q, 0, plH, [], PL); lmWall(K, P, Q, plH, top, ops, ST);
    }
  });
  if (!e.pitched) { const q = offsetRing(e.outer, -0.25); vband(G, q, h, top, sh(ST.col, 0.78), -1); band(G, e.outer, q, top, hb('#7b7e82'), false); }
}

/* ---- the entrance: a glazed porch with a canopy on the wall nearest a street, or by the main entrance of OSM ---- */
function chooseMain(b) {
  let best = null, bd = 1e9;
  const ent = SD.entrances.filter(x => SD.buildings[x[0]][1] === b.id), want = ent.find(x => x[1] === 'main') || null;
  for (const e of b.parts) e.rings.forEach((r, ri) => { if (ri) return; const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, P = [r[2 * i], r[2 * i + 1]], Q = [r[2 * j], r[2 * j + 1]], F = lmWF(P, Q), L = F.L; if (L < 9.5 || e.h / e.floors > 4.6) continue;
      const mx = (P[0] + Q[0]) / 2, mz = (P[1] + Q[1]) / 2; if (inBuilding(mx + F.nx * 0.7, mz + F.nz * 0.7)) continue;
      let d, s = L / 2;
      if (want) { const [x, z] = want[2], t = (x - P[0]) * F.tx + (z - P[1]) * F.tz, off = Math.abs((x - P[0]) * F.nx + (z - P[1]) * F.nz); if (t < 2 || t > L - 2) continue; d = off; s = t; }
      else d = streetD(mx + F.nx * 6, mz + F.nz * 6, 60) - L * 0.15;
      if (d < bd) { bd = d; best = { e, i, ri, s, w: Math.min(8.5, L * 0.45), F, P, Q }; }
    } });
  return best;
}
function schPorch(K, b, m) {
  const G = K.plain, F = m.F, sp = b.spec, s = m.s, w2 = m.w / 2, D = 3.2, H = 3.5, GL = SCHT.curtain;
  const CAN = hb(sp.canopy || (sp.wall === 'ren' ? '#7d858c' : '#5c6166')), FR = hb('#8a9096');
  // glazed front and sides in curtain-wall modules
  const face = (A, B, n) => { const L = Math.hypot(B[0] - A[0], B[2] - A[2]), k = Math.max(1, Math.round(L / 1.5));
    for (let q = 0; q < k; q++) { const t0 = q / k, t1 = (q + 1) / k, p = (t, y) => [A[0] + (B[0] - A[0]) * t, y, A[2] + (B[2] - A[2]) * t];
      KS.det.q(p(t0, 0.15), p(t1, 0.15), p(t1, H - 0.2), p(t0, H - 0.2), n, [GL.u1, GL.v0, GL.u0, GL.v0, GL.u0, GL.v1, GL.u1, GL.v1], [255, 255, 255], lit(0.5) ? 1 : 0); } };
  face(F.at(s + w2, 0, -D), F.at(s - w2, 0, -D), [F.nx, 0, F.nz]);
  face(F.at(s - w2, 0, -D), F.at(s - w2, 0, 0), [-F.tx, 0, -F.tz]);
  face(F.at(s + w2, 0, 0), F.at(s + w2, 0, -D), [F.tx, 0, F.tz]);
  const dr = SCHT.door; KS.det.q(F.at(s + 1.0, 0.15, -D - 0.02), F.at(s - 1.0, 0.15, -D - 0.02), F.at(s - 1.0, 2.65, -D - 0.02), F.at(s + 1.0, 2.65, -D - 0.02), [F.nx, 0, F.nz], [dr.u1, dr.v0, dr.u0, dr.v0, dr.u0, dr.v1, dr.u1, dr.v1], [255, 255, 255], 0);
  lmBoxW(G, F, s - w2, s + w2, 0, 0.15, -D, 0, hb('#9d9a94'));                                      // floor slab
  lmBoxW(G, F, s - w2 - 0.6, s + w2 + 0.6, H - 0.2, H + 0.35, -D - 1.4, 0, CAN);                    // roof and canopy
  for (const t of [-1, 1]) lmBar(G, F.at(s + t * (w2 + 0.3), 0, -D - 1.1), F.at(s + t * (w2 + 0.3), H - 0.2, -D - 1.1), 0.14, FR);
  for (let k = 0; k < 3; k++) lmBoxW(G, F, s - 1.6 - k * 0.3, s + 1.6 + k * 0.3, -0.15, 0.15 - k * 0.1, -D - 1.6 - k * 0.32, -D - 1.3 - k * 0.32, hb('#a5a29b'));   // steps
  if (sp.sign !== null) {
    const sg = schSignOf(b); if (sg) { if (!sp.signCol) sg.col = 'white';   // light letters on the dark fascia unless the photograph says otherwise
      signOn(F, s, H - 0.1, 0.42, m.w + 1.0, sg, -D - 1.42); }
  }
}
function schSignOf(b) {
  const sp = b.spec, text = sp.sign || null; if (!text) return null;
  return { text, col: sp.signCol || 'dark', serif: !!sp.serif };
}

/* ---- flagpoles: Latvia in the middle, the European Union and the city on either side ---- */
function schFlags(G) {
  if (!SD) return;
  const poles = SD.points.filter(p => p[1] === 'flagpole');
  const bySchool = new Map(); for (const p of poles) { if (!bySchool.has(p[0])) bySchool.set(p[0], []); bySchool.get(p[0]).push(p); }
  for (const list of bySchool.values()) list.forEach((p, k) => {
    const x = p[2], z = p[3], dir = [1, 0];
    if (k === 1 || list.length === 1) { lmFlag(G, x, z, 0, 9, dir, 1.8); return; }
    lmBar(G, [x, 0, z], [x, 9, z], 0.09, hb('#d9d9d6')); lmLathe(G, x, z, 9, [[0, 0], [0.09, 0.05], [0, 0.15]], 8, hb('#c9cdd1'));
    const eu = k === 0, A = [x, 8.9, z], B = [x + 1.8, 8.85, z], Cc = [x + 1.8, 7.7, z], D = [x, 7.75, z];
    for (const s of [1, -1]) polyA(G, [A, B, Cc, D], hb(eu ? '#1f3f99' : '#2a5aa8'), 0, 0, s);
    if (eu) for (let a = 0; a < 12; a++) { const t = a / 12 * Math.PI * 2, cx = x + 0.9 + Math.cos(t) * 0.36, cy = 8.3 + Math.sin(t) * 0.36;
      for (const s of [1, -1]) polyA(G, [[cx - 0.04, cy - 0.04, z + s * 0.01], [cx + 0.04, cy - 0.04, z + s * 0.01], [cx + 0.04, cy + 0.04, z + s * 0.01], [cx - 0.04, cy + 0.04, z + s * 0.01]], hb('#f2c83a'), 0, 0, s); }
    else polyA(G, [[x, 8.3, z + 0.01], [x + 1.8, 8.27, z + 0.01], [x + 1.8, 7.7, z + 0.01], [x, 7.75, z + 0.01]], hb('#f2f1ec'), 0, 0, 1);
  });
}

/* Draws the claimed school buildings (and through schGrounds, their sports grounds). */
function lmSchools(K, litPatch) {
  if (!sbInit) sbPrepare();
  if (!SB.length) { schGrounds(K.plain); return; }
  const signs = []; for (const b of SB) { const sg = schSignOf(b); if (sg) { signs.push(sg); if (!b.spec.signCol) signs.push(Object.assign({}, sg, { col: 'white' })); } }
  const [dc, dorm, dglow] = schAtlas(), [sc, sglow] = schSigns(signs);
  LMM.schDet = lmStd({ vertexColors: true, map: dc, roughnessMap: dorm, metalnessMap: dorm, roughness: 1, metalness: 1, emissive: new THREE.Color(1, 1, 1), emissiveMap: dglow, emissiveIntensity: 0 }, 'lm-sch-det', litPatch);
  LMM.schTxt = lmStd({ vertexColors: true, map: sc, alphaTest: 0.5, roughness: 0.4, metalness: 0.35, emissive: new THREE.Color(1, 1, 1), emissiveMap: sglow, emissiveIntensity: 0 }, 'lm-sch-txt', litPatch);
  KS.det = new LMB(); KS.txt = new LMB();
  for (const b of SB) {
    if (!b.parts.length) continue;
    const main = b.spec.kit === 'soviet' ? chooseMain(b) : null; b.main = main;
    for (const e of b.parts) { STATE.GBC = e.gbc; if (b.spec.kit === 'soviet') schSoviet(K, b, e, main); else schHist(K, b, e); }
    if (main) { STATE.GBC = main.e.gbc; schPorch(K, b, main); }
    else if (b.spec.sign) {   // the older buildings: the name on the wall nearest a street, over the middle of it
      let best = null, bd = 1e9;
      for (const e of b.parts) { const r = e.outer, n = r.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n, P = [r[2 * i], r[2 * i + 1]], Q = [r[2 * j], r[2 * j + 1]], F = lmWF(P, Q); if (F.L < 8) continue;
        const d = streetD((P[0] + Q[0]) / 2 + F.nx * 6, (P[1] + Q[1]) / 2 + F.nz * 6, 60); if (d < bd && !inBuilding((P[0] + Q[0]) / 2 + F.nx * 0.7, (P[1] + Q[1]) / 2 + F.nz * 0.7)) { bd = d; best = { e, F }; } } }
      if (best) { STATE.GBC = best.e.gbc; const fh = (best.e.h - 0.8) / best.e.floors; signOn(best.F, best.F.L / 2, 0.8 + fh - 0.55, 0.42, best.F.L * 0.6, schSignOf(b), -0.1); }
    }
  }
  STATE.GBC = null;
  schFlags(K.plain); schGrounds(K.plain);
  KS.det.mesh(LMM.schDet); KS.txt.mesh(LMM.schTxt, false);
}

export { SB, lmSchools, schClaim };
