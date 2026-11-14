import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { LMB, LMWHITE } from './core.js';
import { lmBar, lmBoxW, lmLathe, lmWF, lmWall } from './helpers.js';
import { LMM, lmStd } from './index.js';
import { lmRegisterOutline } from './tv-tower.js';
import { flatPlain, flatRoof, tileOf } from '../buildings/walls.js';
import { ROOFPAL } from '../world/palette.js';
import { BLD, ROAD, inBuilding, onRoad } from '../world/data.js';
import { box, polyA } from '../core/geometry.js';
import { area2, bbox, hb, pick, pip, reversed, rnd } from '../core/util.js';
import { TERR, terrainH } from '../world/terrain.js';
import { mkCanvas, toTex } from '../render/textures.js';

/* ---------- supermarkets: Rimi, Maxima, Mego, Lidl and Beta; the Ditton nams and Solo shopping centres ----------
   Every store of the five chains in Daugavpils that OpenStreetMap knows (shop=supermarket|convenience with their
   name, 26 stores; Nominatim search in the city's bounds). The look of each chain is taken from Wikimedia Commons
   photographs of its stores in Latvia: Lidl's new stores (Ķīšezera iela and Bieriņi in Riga, Dobeles šoseja in
   Jelgava, 2021–25: a long box of light grey panels, the front glazed under a deep canopy on columns, the blue square
   sign on the corner and on a pylon by the car park), Rimi (the red board with the white name, Rimi Hyper in Jelgava),
   Maxima (white walls with blue bands, the white name on blue and the red squares with the X of the format), Mego
   (Tilta iela 1 in Riga, 2023: anthracite walls and yellow letters). No photograph of a Beta store was found: its
   board is a plain red name on white.
   - k 'box': the store is a building of its own; its cadastre part (the one holding p) is drawn here with the
     chain's walls, glazed front, canopy, board and, for the big ones, a pylon.
   - k 'osm': the same, but the building is missing from citydata (built after the cadastre extract), so its outline
     o comes from OSM; the canopy parts that citydata has for it are dropped.
   - k 'in': the store is a tenant of a larger building drawn by the generic generator: its glazed front and board
     are laid on the wall that faces its entrance e, or the car park pk, or the nearest street.
   - k 'ditton' / 'solo': the store is in one of the two shopping centres modelled below.
   p: the store (its OSM node or the centre of its outline); e: its main entrance; pk: the car park it faces. */
const SHOPS = [
  { id: 'w115788072', b: 'beta', n: 'Beta', a: 'Šaurā iela 31', k: 'box', p: [384, -1289.4], pk: [402.8, -1285] },
  { id: 'w628607721', b: 'beta', n: 'Beta', a: 'Puškina iela 14', k: 'box', p: [-94.3, 1078.2] },
  { id: 'n2455742945', b: 'beta', n: 'Beta', a: 'Ventspils iela 67', k: 'in', p: [-22.5, 537.3], e: [-16.4, 527.8] },
  { id: 'n3712549204', b: 'beta', n: 'Beta', a: 'Inženieru iela 1', k: 'in', p: [1313.5, -1186.9], e: [1311.3, -1198] },
  { id: 'w989692937', b: 'lidl', n: 'Lidl', a: '18. novembra iela 146', k: 'osm', p: [800.4, 505.6], pk: [791.6, 539.9], o: [[825.4, 453.8], [847.7, 475.7], [811.7, 512.7], [811.7, 516.7], [796.6, 532.5], [795.5, 533.5], [770.7, 509.7], [771.7, 508.6], [772.9, 507.4]] },
  { id: 'w1339342377', b: 'lidl', n: 'Lidl', a: 'Cietokšņa iela 74', k: 'box', p: [-1847.5, 430.6], pk: [-1849, 462.9] },
  { id: 'w132266129', b: 'maxima', n: 'Maxima X', a: 'Piekrastes iela 29', k: 'box', p: [-529, -1895], e: [-533.7, -1877.7], drop: [[-524.3, -1908.6]] },
  { id: 'w366850613', b: 'maxima', n: 'Maxima X', a: 'Smilšu iela 98A', k: 'box', p: [824.7, -760.3], pk: [811.9, -776.6] },
  { id: 'w817340088', b: 'maxima', n: 'Maxima X', a: 'Aveņu iela 35B', k: 'box', p: [-867.7, -2435.4], e: [-865.1, -2447.6] },
  { id: 'n7627429907', b: 'maxima', n: 'Maxima X', a: 'Arodu iela 15', k: 'in', p: [-59.5, 576], pk: [-5.8, 546.7] },
  { id: 'n460001555', b: 'maxima', n: 'Maxima X', a: 'Strādnieku iela 103', k: 'in', p: [1215.2, 153.3], e: [1204, 165.7] },
  { id: 'n4128737289', b: 'maxima', n: 'Maxima X', a: 'Arhitektu iela 3', k: 'box', p: [1230.9, -1012.4], e: [1257.4, -1029.1] },
  { id: 'n8746469346', b: 'maxima', n: 'Maxima X', a: 'Kandavas iela 5', k: 'in', p: [-1688, 991.4], pk: [-1676.6, 999.1] },
  { id: 'n1314059910', b: 'maxima', n: 'Maxima XX', a: 'Cietokšņa iela 60', k: 'box', p: [-1183.7, 844.8], pk: [-1151.2, 829.1] },
  { id: 'w115783101', b: 'mego', n: 'Mego', a: 'Inženieru iela 3', k: 'box', p: [1332.6, -1149.9], pk: [1331.7, -1211.1] },
  { id: 'w238279628', b: 'mego', n: 'Mego', a: 'Valkas iela 1A', k: 'box', p: [1295.4, 316.8], pk: [1280, 310.4] },
  { id: 'n9061242848', b: 'mego', n: 'Mego', a: 'Aveņu iela 26', k: 'osm', p: [-791.3, -2082.8], pk: [-823.8, -2101.3], o: [[-789.6, -2118], [-792.7, -2113.4], [-793.8, -2111.7], [-815.2, -2080.1], [-823.6, -2067.8], [-821.8, -2066.5], [-820.1, -2065.1], [-818.5, -2063.9], [-816.1, -2051], [-812, -2048.4], [-802.1, -2063.5], [-786.7, -2053.8], [-757.9, -2096.5], [-781.2, -2112.2], [-784.9, -2114.8], [-787.3, -2116.4]] },
  { id: 'n4141448659', b: 'mego', n: 'Mego', a: 'Vaļņu iela 27A', k: 'box', p: [-2071.9, -482.2], pk: [-2051.2, -488.9] },
  { id: 'n1707170884', b: 'mego', n: 'Mego', a: 'Viestura iela 60', k: 'in', p: [-992.5, 1158.7] },
  { id: 'n474748343', b: 'mego', n: 'Mego', a: 'Rīgas iela 9, Solo', k: 'solo', p: [-1382.5, 1183.3], e: [-1343.5, 1186.9] },
  { id: 'n2462543293', b: 'mego', n: 'Mego', a: 'Raipoles iela 11A, Aveņu centrs', k: 'in', p: [-864.6, -1984.2], e: [-857.4, -2003.2] },
  { id: 'n11943175157', b: 'rimi', n: 'Rimi Hyper', a: 'Cietokšņa iela 72A', k: 'box', p: [-1687.9, 483.9], e: [-1673.6, 516.8] },
  { id: 'n9296108168', b: 'rimi', n: 'Rimi Super', a: '18. novembra iela 136', k: 'box', p: [691, 622.1], e: [698.3, 594.6] },
  { id: 'n1707161675', b: 'rimi', n: 'Rimi', a: 'Cietokšņa iela 60, Ditton nams', k: 'ditton', p: [-1335.5, 1006.1], e: [-1321.6, 1047.4] },
  { id: 'n1707171536', b: 'rimi', n: 'mini Rimi', a: 'Viestura iela 10, autoosta', k: 'in', p: [-936.3, 1262.4], pk: [-928.9, 1285.5] },
  { id: 'n8365754782', b: 'rimi', n: 'Rimi', a: 'Smilšu iela 92B', k: 'box', p: [884.7, -488.5], e: [861.9, -482.1] },
];
// the walls of each chain: height to the top of the parapet, panels (wall texture 5) or render (1), bands [y from the top, height, colour]
const STY = {
  lidl: { h: 6.4, tex: 5, wall: '#dde0e3', plinth: '#62676b', glaze: 'all', gTop: 4.2, canopy: 4.2, pylon: 'lidl' },
  rimi: { h: 5.8, tex: 5, wall: '#eef0f0', plinth: '#73777b', glaze: 0.5, gTop: 3.4, bands: [[1.5, 0.9, '#d8202c']], canopy: 1.6, pylon: 'rimi' },
  maxima: { h: 5.4, tex: 5, wall: '#f1f2f0', plinth: '#73777b', glaze: 0.4, gTop: 3.2, bands: [[0.75, 0.45, '#1d3d8f']], gBand: '#1d3d8f', canopy: 1.3, pylon: 'maxima' },
  mego: { h: 5.4, tex: 5, wall: '#45474b', plinth: '#2f3134', glaze: 0.45, gTop: 3.3, canopy: 1.5, pylon: 'mego' },
  beta: { h: 4.6, tex: 1, wall: '#eee8dc', plinth: '#8c8174', glaze: 0.35, gTop: 3.0, bands: [[0.85, 0.3, '#c9252c']], canopy: 1.1 },
};
const signOf = S => S.b === 'rimi' ? (/Hyper/.test(S.n) ? 'rimiHyper' : /Super/.test(S.n) ? 'rimiSuper' : /mini/.test(S.n) ? 'miniRimi' : 'rimi') : S.b === 'maxima' ? (/XX/.test(S.n) ? 'maximaXX' : 'maximaX') : S.b;
// key points inside the cadastre parts of the two shopping centres
const MALL = { ditton: [[-1210, 915], [-1290, 960], [-1400, 980], [-1268, 993.5]], solo: [[-1390, 1175]] };

// ---- claiming the buildings while buildBuildings runs
const SH = { own: new Map(), host: new Map(), mall: { ditton: [], solo: [] } };
const H_OF = S => STY[S.b].h;
function inner(r) {   // a point inside a ring (its centre, else the middle of the widest run through it)
  const n = r.length >> 1; let cx = 0, cz = 0; for (let i = 0; i < r.length; i += 2) { cx += r[i]; cz += r[i + 1]; } cx /= n; cz /= n;
  if (pip(cx, cz, r)) return [cx, cz];
  const xs = []; for (let i = 0; i < n; i++) { const j = (i + 1) % n, az = r[2 * i + 1], bz = r[2 * j + 1]; if ((az > cz) !== (bz > cz)) xs.push(r[2 * i] + (r[2 * j] - r[2 * i]) * (cz - az) / (bz - az)); }
  xs.sort((a, b) => a - b); let best = [cx, cz], w = 0; for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > w) { w = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, cz]; }
  return best;
}
let OSMR = null;   // the OSM outlines of the 'osm' stores as rings
const osmRings = () => OSMR || (OSMR = SHOPS.filter(S => S.k === 'osm').map(S => { let r = new Float32Array(S.o.flat()); if (area2(r) < 0) r = reversed(r); return { S, r, bb: bbox(r) }; }));
const near = (bb, [x, z], m = 0) => x >= bb[0] - m && x <= bb[2] + m && z >= bb[1] - m && z <= bb[3] + m;
/* Called by buildBuildings for every building. A store's own building is kept (its roof drawn now with the city's
   roof textures, its walls later by lmShops); the parts of the two shopping centres are kept for their models; the
   buildings that hold a store as a tenant are noted and left to the generic generator; the canopy parts of the stores
   whose outline comes from OSM are dropped. */
function shopClaim(id, rec, rings, outer, bb) {
  const p = inner(outer);
  for (const { r, bb: ob } of osmRings()) if (near(ob, p) && pip(p[0], p[1], r)) return true;
  for (const S of SHOPS) for (const d of S.drop || []) if (near(bb, d) && pip(d[0], d[1], outer)) return true;
  for (const [m, keys] of Object.entries(MALL)) for (const q of keys) if (near(bb, q) && pip(q[0], q[1], outer)) { SH.mall[m].push({ id, rings, outer, bb, h: rec[1] / 10, gbc: STATE.GBC, key: q }); return true; }
  for (const S of SHOPS) {
    if ((S.k !== 'box' && S.k !== 'in') || !near(bb, S.p) || !pip(S.p[0], S.p[1], outer)) continue;
    const part = { id, rings, outer, bb, h: rec[1] / 10, floors: Math.max(1, rec[5]), gbc: STATE.GBC };
    if (S.k === 'in') { SH.host.set(S.id, part); return false; }
    part.H = Math.max(part.h, H_OF(S)); SH.own.set(S.id, part);
    const T = tileOf((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2); flatRoof(T.m.roof, rings, part.H - 0.45, pick(ROOFPAL[5], id, 2), 5, Math.floor(rnd(id, 9) * 255));
    return true;
  }
  return false;
}

// ---- the atlas: glazing (colour, ORM, night light) and the boards of the chains (with alpha for cut-out letters)
const CT = {};
function shAtlas() {
  const PX = 64, AW = 2048, AH = 2048, cv = mkCanvas(AW, AH), om = mkCanvas(AW, AH), gm = mkCanvas(AW, AH), g = cv.getContext('2d'), o = om.getContext('2d'), e = gm.getContext('2d');
  o.fillStyle = 'rgb(0,225,0)'; o.fillRect(0, 0, AW, AH); e.fillStyle = '#000'; e.fillRect(0, 0, AW, AH);
  let X = 0, Y = 0;
  const ORM = { matte: 'rgb(0,225,0)', glass: 'rgb(0,26,0)', metal: 'rgb(0,90,140)', gloss: 'rgb(0,120,0)' };
  const R = (x, y, w, h, col, k = 'matte', glow = '#000') => { g.fillStyle = col; g.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); o.fillStyle = ORM[k]; o.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); e.fillStyle = glow; e.fillRect(X + x * PX, Y + y * PX, w * PX, h * PX); };
  const RR = (x, y, w, h, r, col, glow = '#000') => { for (const [c, s] of [[g, col], [o, ORM.gloss], [e, glow]]) { c.fillStyle = s; c.beginPath(); c.roundRect(X + x * PX, Y + y * PX, w * PX, h * PX, r * PX); c.fill(); } };
  const glass = (x, y, w, h, c = ['#3a454d', '#64737d', '#30393f'], glow = '#ffe6bd') => {
    const a = X + x * PX, b = Y + y * PX, gr = g.createLinearGradient(0, b, 0, b + h * PX); gr.addColorStop(0, c[0]); gr.addColorStop(0.45, c[1]); gr.addColorStop(0.55, c[2]); gr.addColorStop(1, c[0]);
    g.fillStyle = gr; g.fillRect(a, b, w * PX, h * PX); o.fillStyle = ORM.glass; o.fillRect(a, b, w * PX, h * PX); e.fillStyle = glow; e.fillRect(a, b, w * PX, h * PX);
  };
  // text fitted into a box; glow: the colour it shines at night
  const text = (s, x, y, w, h, col, { font = '"Golos Text", Arial, sans-serif', wt = 800, italic = false, glow = col, align = 'center', outline = null } = {}) => {
    let sz = h * PX; const f = () => `${italic ? 'italic ' : ''}${wt} ${sz}px ${font}`; g.font = f(); const mw = g.measureText(s).width; if (mw > w * PX) { sz *= w * PX / mw; g.font = f(); }
    const tx = align === 'center' ? X + (x + w / 2) * PX : X + x * PX, ty = Y + (y + h / 2) * PX;
    for (const [c, s2] of [[g, col], [e, glow], [o, ORM.gloss]]) { c.font = f(); c.textAlign = align; c.textBaseline = 'middle'; if (outline && c === g) { c.lineWidth = sz * 0.08; c.strokeStyle = outline; c.strokeText(s, tx, ty + sz * 0.04); } c.fillStyle = s2; c.fillText(s, tx, ty + sz * 0.04); }
  };
  const defs = [
    // a module of a shop's curtain wall: aluminium frame, a transom, the shop inside (lit ceiling, shelves)
    ['glass', 3.0, 3.4, () => { glass(0, 0, 3, 3.4); R(0.06, 0.12, 2.88, 0.12, '#f4efe2', 'glass', '#fff4dc'); for (let k = 0; k < 5; k++) R(0.2 + k * 0.56, 2.0, 0.42, 1.2, ['#8a6b4f', '#5f7d8c', '#b0563f', '#6c8a52', '#a99a6a'][k], 'glass', ['#a07a50', '#5a7a88', '#c0603f', '#6e8e50', '#b8a46a'][k]);
      for (const x of [0, 1.47, 2.94]) R(x, 0, 0.06, 3.4, '#b9bdc1', 'metal'); for (const y of [0, 0.62, 3.34]) R(0, y, 3, 0.06, '#b9bdc1', 'metal'); }],
    // sliding entrance doors under a fanlight
    ['door', 3.0, 3.4, () => { glass(0, 0, 3, 3.4, ['#2f383e', '#5d6c76', '#283035'], '#fff0d0'); R(0, 0, 3, 0.62, '#9aa0a5', 'metal'); glass(0.08, 0.08, 2.84, 0.46); for (const x of [0, 1.47, 2.94]) R(x, 0.6, 0.06, 2.8, '#b9bdc1', 'metal'); R(0, 0.58, 3, 0.06, '#b9bdc1', 'metal'); R(0, 3.34, 3, 0.06, '#8d9296', 'metal');
      R(0.75, 0.8, 0.05, 2.5, '#c5c9cc', 'metal'); R(2.2, 0.8, 0.05, 2.5, '#c5c9cc', 'metal'); }],
    // tinted glass of upper floors and the glazed drum of Ditton nams
    ['dark', 2.0, 2.0, () => { glass(0, 0, 2, 2, ['#27333b', '#4b5d68', '#222c33'], '#ffd9a0'); R(0, 0, 2, 0.05, '#aab0b5', 'metal'); R(0, 0, 0.05, 2, '#aab0b5', 'metal'); R(0.98, 0, 0.04, 2, '#aab0b5', 'metal'); }],
    // the boards
    ['rimi', 4.0, 1.6, () => { RR(0, 0, 4, 1.6, 0.18, '#d8202c', '#ff3a3a'); text('Rimi', 0.25, 0.22, 2.9, 1.1, '#ffffff', { italic: true, wt: 900, glow: '#ffffff' }); R(3.25, 0.45, 0.16, 0.7, '#2d66b8', 'gloss', '#4f8ae0'); R(3.5, 0.45, 0.16, 0.7, '#ffffff', 'gloss', '#ffffff'); }],
    ['rimiHyper', 5.0, 2.2, () => { RR(0, 0, 5, 2.2, 0.2, '#d8202c', '#ff3a3a'); text('Rimi', 0.3, 0.2, 3.6, 1.25, '#ffffff', { italic: true, wt: 900, glow: '#ffffff' }); R(4.1, 0.45, 0.18, 0.8, '#2d66b8', 'gloss', '#4f8ae0'); R(4.38, 0.45, 0.18, 0.8, '#ffffff', 'gloss', '#ffffff'); text('HYPER', 0.6, 1.5, 3.0, 0.5, '#ffffff', { wt: 700 }); }],
    ['rimiSuper', 5.0, 2.2, () => { RR(0, 0, 5, 2.2, 0.2, '#d8202c', '#ff3a3a'); text('Rimi', 0.3, 0.2, 3.6, 1.25, '#ffffff', { italic: true, wt: 900, glow: '#ffffff' }); R(4.1, 0.45, 0.18, 0.8, '#2d66b8', 'gloss', '#4f8ae0'); R(4.38, 0.45, 0.18, 0.8, '#ffffff', 'gloss', '#ffffff'); text('SUPER', 0.6, 1.5, 3.0, 0.5, '#ffffff', { wt: 700 }); }],
    ['miniRimi', 3.6, 1.6, () => { RR(0, 0, 3.6, 1.6, 0.16, '#d8202c', '#ff3a3a'); text('mini', 0.25, 0.1, 1.2, 0.5, '#ffffff', { italic: true, wt: 800, align: 'left' }); text('Rimi', 0.25, 0.48, 2.7, 1.0, '#ffffff', { italic: true, wt: 900 }); R(3.05, 0.6, 0.14, 0.6, '#2d66b8', 'gloss', '#4f8ae0'); R(3.27, 0.6, 0.14, 0.6, '#ffffff', 'gloss', '#ffffff'); }],
    ['maximaX', 6.0, 1.3, () => { R(0, 0, 6, 1.3, '#1d3d8f', 'gloss', '#2d5ad0'); text('MAXIMA', 0.25, 0.15, 4.3, 1.0, '#ffffff', { wt: 900 }); R(4.75, 0.15, 1.0, 1.0, '#e0202a', 'gloss', '#ff3030'); text('X', 4.75, 0.17, 1.0, 0.95, '#ffffff', { wt: 900 }); }],
    ['maximaXX', 7.0, 1.3, () => { R(0, 0, 7, 1.3, '#1d3d8f', 'gloss', '#2d5ad0'); text('MAXIMA', 0.25, 0.15, 4.3, 1.0, '#ffffff', { wt: 900 }); for (const x of [4.7, 5.8]) { R(x, 0.15, 1.0, 1.0, '#e0202a', 'gloss', '#ff3030'); text('X', x, 0.17, 1.0, 0.95, '#ffffff', { wt: 900 }); } }],
    ['lidl', 2.6, 2.6, () => { R(0, 0, 2.6, 2.6, '#0a50a8', 'gloss', '#2a70d8'); for (const [c, s] of [[g, '#fff100'], [e, '#fff36a'], [o, ORM.gloss]]) { c.fillStyle = s; c.beginPath(); c.arc(X + 1.3 * PX, Y + 1.3 * PX, 1.08 * PX, 0, 7); c.fill(); }
      for (const [c, s] of [[g, '#e0101c'], [e, '#ff3030']]) { c.strokeStyle = s; c.lineWidth = 0.07 * PX; c.beginPath(); c.arc(X + 1.3 * PX, Y + 1.3 * PX, 1.0 * PX, 0, 7); c.stroke(); }
      text('LIDL', 0.4, 0.92, 1.8, 0.78, '#0a50a8', { wt: 900, glow: '#0a3a90' }); }],
    ['mego', 4.2, 1.5, () => { R(0, 0, 4.2, 1.5, '#3a3c40'); text('mego', 0.2, 0.1, 3.8, 1.2, '#f5b400', { wt: 800, glow: '#ffc830' }); }],
    ['beta', 3.8, 1.3, () => { R(0, 0, 3.8, 1.3, '#ffffff', 'gloss', '#fff8ee'); R(0.06, 0.06, 3.68, 0.08, '#c9252c'); R(0.06, 1.16, 3.68, 0.08, '#c9252c'); text('BETA', 0.2, 0.22, 3.4, 0.9, '#c9252c', { wt: 900, glow: '#e03030' }); }],
    // the cut-out letters on the drum of Ditton nams (alpha), the board of the Solo trade park with its logo
    ['ditton', 13.0, 2.4, () => { text('DITTON NAMS', 0, 0.1, 13, 2.2, '#e9bb3a', { font: 'Georgia, "Times New Roman", serif', wt: 700, glow: '#ffd25a', outline: '#5a4410' }); }],
    ['solo', 5.0, 4.4, () => { R(0, 0, 5, 4.4, '#e7dfc6'); for (const [c, s] of [[g, '#1f4fa3'], [e, '#3070e0']]) { c.fillStyle = s; c.beginPath(); c.roundRect(X + 1.45 * PX, Y + 0.2 * PX, 2.1 * PX, 1.7 * PX, 0.7 * PX); c.fill(); }
      g.fillStyle = '#e7dfc6'; g.beginPath(); g.roundRect(X + 1.85 * PX, Y + 0.55 * PX, 1.3 * PX, 1.0 * PX, 0.4 * PX); g.fill();
      for (const [c, s] of [[g, '#3a9a3a'], [e, '#50c050']]) { c.fillStyle = s; c.beginPath(); c.ellipse(X + 2.9 * PX, Y + 0.95 * PX, 1.0 * PX, 0.22 * PX, -0.25, 0, 7); c.fill(); }
      text('SOLO', 0.4, 2.1, 4.2, 1.2, '#1f4fa3', { wt: 900, glow: '#3a74e0' }); R(0.4, 3.4, 4.2, 0.5, '#ffffff'); text('TIRDZNIECĪBAS PARKS', 0.5, 3.45, 4.0, 0.4, '#333333', { wt: 600, glow: '#000' }); }],
  ];
  // the tiles with alpha are drawn on a cleared canvas; the others fill their box
  let x0 = 2, rowY = 2, rowH = 0;
  for (const [name, w, h, draw] of defs.sort((a, b) => b[2] - a[2])) {
    const pw = Math.ceil(w * PX), ph = Math.ceil(h * PX); if (x0 + pw > AW) { x0 = 2; rowY += rowH + 6; rowH = 0; }
    X = x0; Y = rowY; for (const c of [g, o, e]) { c.save(); c.beginPath(); c.rect(X, Y, pw, ph); c.clip(); } draw(); for (const c of [g, o, e]) c.restore();
    CT[name] = { u0: (X + 0.5) / AW, u1: (X + pw - 0.5) / AW, v0: 1 - (Y + ph - 0.5) / AH, v1: 1 - (Y + 0.5) / AH, w, h };
    x0 += pw + 6; rowH = Math.max(rowH, ph);
  }
  const mk = (c, srgb) => { const t = toTex(c, srgb, false); t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  return [mk(cv, true), mk(om, false), mk(gm, true)];
}

// ---- pieces
const KS = { det: null };
const SHV = [];   // where each store's front is: its name, a point on the front, the outward normal (for views)
const N_ = Fw => [Fw.nx, 0, Fw.nz];
// a tile laid flat on the frame Fw from s0..s1, y0..y1 at depth d (negative: in front of the wall)
function flat(Fw, s0, s1, y0, y1, d, t, lit = 1) { KS.det.q(Fw.at(s0, y0, d), Fw.at(s1, y0, d), Fw.at(s1, y1, d), Fw.at(s0, y1, d), N_(Fw), [t.u1, t.v0, t.u0, t.v0, t.u0, t.v1, t.u1, t.v1], LMWHITE, lit); }
// a board centred at s with its lower edge at y, h high (its width by the tile), on a backing box d deep
function board(K, Fw, name, s, y, h, d = 0.12, back = '#2e3033') { const t = CT[name], w = h * t.w / t.h; if (back) lmBoxW(K.plain, Fw, s - w / 2 - 0.04, s + w / 2 + 0.04, y - 0.04, y + h + 0.04, -d, 0, hb(back)); flat(Fw, s - w / 2, s + w / 2, y, y + h, -d - 0.012, t); return w; }
// a frame round s0..s1, y0..y1 of the bar width t standing d out of the wall
const frame = (G, Fw, s0, s1, y0, y1, t, d, col) => { lmBoxW(G, Fw, s0, s1, y1 - t, y1, -d, 0, col); lmBoxW(G, Fw, s0, s1, y0, y0 + t, -d, 0, col); lmBoxW(G, Fw, s0, s0 + t, y0 + t, y1 - t, -d, 0, col); lmBoxW(G, Fw, s1 - t, s1, y0 + t, y1 - t, -d, 0, col); };
// the level of the ground under a free-standing thing at (x, z), as GBC
const levelAt = (x, z) => { if (!TERR.on) return null; const b = terrainH(x, z); return (X, y, Z) => { const t = terrainH(X, Z); return y <= 0.05 ? Math.min(b, t) - 0.25 - t - y : b - t; }; };
// the edge of the ring r that faces the entrance e, else the car park pk, else the nearest street; returns its index
function frontEdge(r, S, from = S.p) {
  const n = r.length >> 1; let best = 0, bs = 1e9;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * j], bz = r[2 * j + 1], L = Math.hypot(bx - ax, bz - az); if (L < 3) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, nx = tz, nz = -tx, mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let s;
    if (S.e) { const t = Math.max(0, Math.min(1, ((S.e[0] - ax) * tx + (S.e[1] - az) * tz) / L)); s = Math.hypot(S.e[0] - ax - tx * L * t, S.e[1] - az - tz * L * t); }
    else if (S.pk) { const dx = S.pk[0] - mx - nx * 4, dz = S.pk[1] - mz - nz * 4, d = Math.hypot(dx, dz) || 1; s = d - 30 * (dx * nx + dz * nz) / d - 0.25 * Math.min(L, 40); }
    else { let rd = 60; ROAD.near(mx + nx * 5, mz + nz * 5, 60, (id, d) => { if (d < rd) rd = d; }); s = rd - 0.25 * Math.min(L, 40) + 0.2 * Math.hypot(from[0] - mx, from[1] - mz); }
    if (s < bs) { bs = s; best = i; }
  }
  return best;
}
// the place along the edge i of r closest to the point q
const along = (r, i, q) => { const n = r.length >> 1, j = (i + 1) % n, ax = r[2 * i], az = r[2 * i + 1], L = Math.hypot(r[2 * j] - ax, r[2 * j + 1] - az); return ((q[0] - ax) * (r[2 * j] - ax) + (q[1] - az) * (r[2 * j + 1] - az)) / L; };
const edgeF = (r, i) => { const n = r.length >> 1, j = (i + 1) % n; return lmWF([r[2 * i], r[2 * i + 1]], [r[2 * j], r[2 * j + 1]]); };
// a pylon with the chain's board on both faces, standing out from the front edge in front of the car park
function pylon(K, S, r, i, name, gbc) {
  const Fw = edgeF(r, i), L = Fw.L, ends = [L + 4, -4, L + 8, -8, L * 0.85, L * 0.15];
  for (const s of ends) for (const d of [-9, -12, -6, -15]) {
    const [x, , z] = Fw.at(s, 0, d); if (inBuilding(x, z) || onRoad(x, z, 1.2)) continue;
    STATE.GBC = levelAt(x, z); const t = CT[name], w = Math.min(2.4, 2.0 * t.w / t.h), h = w * t.h / t.w, H = Math.max(5.5, h + 3.4), G = K.plain;
    box(G, x, z, Fw.tx, Fw.tz, w / 2 + 0.15, 0.25, 0, H, hb('#4a4e52'));
    const P = lmWF([x - Fw.tx * w / 2, z - Fw.tz * w / 2], [x + Fw.tx * w / 2, z + Fw.tz * w / 2]), Q = lmWF([x + Fw.tx * w / 2, z + Fw.tz * w / 2], [x - Fw.tx * w / 2, z - Fw.tz * w / 2]);
    flat(P, 0, w, H - h - 0.3, H - 0.3, -0.26, t); flat(Q, 0, w, H - h - 0.3, H - 0.3, -0.26, t);
    STATE.GBC = gbc; return;
  }
}
/* A store with a building of its own: the chain's walls round its outline r (the parapet at H), the front edge
   glazed (the whole of it for Lidl), the doors in the middle of the glazing, a canopy over it, the board above it. */
function storeBox(K, S, r, H, gbc) {
  const st = STY[S.b], G = K.plain, n = r.length >> 1, fi = frontEdge(r, S), wall = { tex: st.tex, col: hb(st.wall), plinth: 0.45, pcol: hb(st.plinth) };
  STATE.GBC = gbc;
  let front = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, P = [r[2 * i], r[2 * i + 1]], Q = [r[2 * j], r[2 * j + 1]], Fw = lmWF(P, Q), L = Fw.L; if (L < 0.05) continue;
    const ops = [];
    if (i === fi && L > 4) {
      const gw = st.glaze === 'all' ? L - 1.4 : Math.min(L - 2, Math.max(6, L * st.glaze)), q = S.e || S.pk || S.p;
      const sc = Math.max(gw / 2 + 0.7, Math.min(L - gw / 2 - 0.7, st.glaze === 'all' ? L / 2 : along(r, i, q))), m = Math.max(1, Math.round(gw / 3)), mw = gw / m, md = Math.floor(m / 2);
      for (let k = 0; k < m; k++) ops.push({ s0: sc - gw / 2 + k * mw, s1: sc - gw / 2 + (k + 1) * mw, y0: 0.1, y1: st.gTop, d: 0.15, tile: k === md ? CT.door : CT.glass, det: KS.det, lit: 1 });
      front = { Fw, L, sc, gw, i };
    }
    lmWall(K, P, Q, 0, H, ops, wall);
    for (const [top, hh, col] of st.bands || []) lmBoxW(G, Fw, -0.06, L + 0.06, H - top - hh, H - top, -0.07, 0, hb(col));
    lmBoxW(G, Fw, -0.12, L + 0.12, H - 0.18, H, -0.12, 0.35, hb(st.b === 'mego' ? '#2e3033' : '#9aa0a4'));   // the coping of the parapet
  }
  if (!front) return;
  const { Fw, L, sc, gw } = front; { const [x, , z] = Fw.at(sc, 0, 0); SHV.push({ n: S.n, a: S.a, x, z, nx: Fw.nx, nz: Fw.nz }); }
  if (st.gBand) lmBoxW(G, Fw, sc - gw / 2 - 0.3, sc + gw / 2 + 0.3, st.gTop + 0.05, st.gTop + 0.5, -0.09, 0, hb(st.gBand));
  if (S.b === 'lidl') {   // the dark upper band of the front, the deep canopy on columns, the square board on the corner
    lmBoxW(G, Fw, -0.1, L + 0.1, st.gTop + 0.6, H - 0.18, -0.1, 0, hb('#53595e'));
    lmBoxW(G, Fw, sc - gw / 2 - 0.4, sc + gw / 2 + 0.4, st.gTop + 0.25, st.gTop + 0.85, -st.canopy, 0, hb('#5d6368'));
    const nc = Math.max(2, Math.round(gw / 7)); for (let k = 0; k <= nc; k++) { const [x, , z] = Fw.at(sc - gw / 2 + k * gw / nc, 0, -st.canopy + 0.4); lmLathe(G, x, z, 0, [[0.11, 0], [0.11, st.gTop + 0.25]], 8, hb('#8b9095')); }
    const s = Math.min(L - 1.8, sc + gw / 2 - 1.4); board(K, Fw, 'lidl', s, H - 0.18 - 2.5, 2.5, 0.14, null);
  } else {
    lmBoxW(G, Fw, sc - gw / 2 - 0.3, sc + gw / 2 + 0.3, st.gTop + 0.05, st.gTop + 0.35, -st.canopy, 0, hb(S.b === 'mego' ? '#2e3033' : '#d6d9db'));
    const name = signOf(S), t = CT[name], room = H - 0.3 - (st.gTop + 0.55), h = Math.max(0.9, Math.min(t.h, room, (gw + 1) * t.h / t.w));
    board(K, Fw, name, sc, st.gTop + 0.55, h, 0.12, S.b === 'beta' ? '#c9252c' : null);
  }
  // machines on the roof
  const [cx, cz] = inner(r); STATE.GBC = gbc;
  for (const [a, b] of [[0, 0], [3.5, 1.5], [-3, -2]]) { const x = cx + Fw.tx * a - Fw.nx * b, z = cz + Fw.tz * a - Fw.nz * b; if (pip(x, z, r)) box(G, x, z, Fw.tx, Fw.tz, 1.1, 0.7, H - 0.45, H + 0.85, hb('#a7abae')); }
  if (st.pylon && (S.b !== 'maxima' || /XX/.test(S.n)) && (S.b !== 'rimi' || /Hyper|Super/.test(S.n) || L > 30)) pylon(K, S, r, fi, signOf(S), gbc);
}
// a store that is a tenant: glazing and a board on the wall of its host that faces its entrance
function tenant(K, S, host) {
  let r = host && host.outer, h = host ? host.h : 7, floors = host ? host.floors : 2, gbc = host ? host.gbc : levelAt(S.p[0], S.p[1]);
  if (!r) { for (const b of BLD) if (near(b.bb, S.p) && pip(S.p[0], S.p[1], b.ring)) { r = b.ring; break; } if (!r) return; }
  STATE.GBC = gbc;
  const i = frontEdge(r, S), Fw = edgeF(r, i), L = Fw.L, gw = Math.min(L - 1, S.b === 'maxima' || S.b === 'mego' ? 9 : 6.2), sc = Math.max(gw / 2 + 0.5, Math.min(L - gw / 2 - 0.5, along(r, i, S.e || S.p)));
  const top = Math.min(floors >= 3 ? 3.1 : h - 0.6, 3.2), m = Math.max(1, Math.round(gw / 3)), mw = gw / m;
  { const [x, , z] = Fw.at(sc, 0, 0); SHV.push({ n: S.n, a: S.a, x, z, nx: Fw.nx, nz: Fw.nz }); }
  for (let k = 0; k < m; k++) flat(Fw, sc - gw / 2 + k * mw, sc - gw / 2 + (k + 1) * mw, 0.15, top - 0.35, -0.05, k === Math.floor(m / 2) ? CT.door : CT.glass);
  const name = signOf(S), t = CT[name], bh = Math.min(t.h, floors >= 3 ? 0.95 : 1.3), y = floors >= 3 ? top - 0.25 : Math.max(top - 0.2, h - 0.5 - bh);
  lmBoxW(K.plain, Fw, sc - gw / 2 - 0.15, sc + gw / 2 + 0.15, top - 0.35, top - 0.25, -0.9, 0, hb('#cfd2d4'));
  board(K, Fw, name, sc, y, bh, 0.12, S.b === 'beta' ? '#c9252c' : null);
}

/* ---- Ditton nams (Cietokšņa iela 60), from the photograph of 2011 (Wikimedia Commons, "Ditton nams - panoramio"):
   the long building of silver-grey panels along the tram line, its rounded north corner a glazed drum in a cage of
   red steel braces under a ring of a canopy with the gilded letters DITTON NAMS on top; along the other side a
   colonnade of round columns under a canopy; red frames round the windows of the upper floor; shop windows below.
   The parts: Galerija (the main hall with the corner), Pasāža, Hanza and the glass porch. Rimi is in the hall. */
function ditton(K) {
  const G = K.plain, PAN = { tex: 5, col: hb('#c3c7cb'), plinth: 0.5, pcol: hb('#6f7377') }, RED = hb('#c8262c'), BEIGE = hb('#e2d3b2');
  const C = [-1360.3, 1064.0], RC = 8.3;   // the rounded corner of the hall
  const H = { [-1210]: 8.0, [-1290]: 8.6, [-1400]: 10.2, [-1268]: 6.2 };
  for (const part of SH.mall.ditton) {
    const r = part.outer, n = r.length >> 1, top = H[part.key[0]] || 8, glassPart = part.key[0] === -1268; STATE.GBC = part.gbc;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, P = [r[2 * i], r[2 * i + 1]], Q = [r[2 * j], r[2 * j + 1]], Fw = lmWF(P, Q), L = Fw.L; if (L < 0.05) continue;
      const mid = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2], corner = Math.hypot(mid[0] - C[0], mid[1] - C[1]) < RC + 1.5;
      const ops = [];
      if (glassPart || corner) { ops.push({ s0: 0, s1: L, y0: 0, y1: top, d: 0.05, tile: CT.dark, det: KS.det, lit: 1 }); lmWall(K, P, Q, 0, top, ops, PAN); continue; }
      if (L > 6) {   // shop windows in the ground floor, square windows in red frames above
        const m = Math.max(1, Math.floor((L - 1) / 3.2)), mw = (L - 1) / m;
        for (let k = 0; k < m; k++) ops.push({ s0: 0.5 + k * mw + 0.1, s1: 0.5 + (k + 1) * mw - 0.1, y0: 0.5, y1: 3.6, d: 0.2, tile: k % 4 === 1 ? CT.door : CT.glass, det: KS.det, lit: 1 });
        if (top > 8) { const w = Math.floor((L - 4) / 12); for (let k = 0; k < w; k++) { const s = 2 + (k + 0.5) * (L - 4) / w; ops.push({ s0: s - 1.3, s1: s + 1.3, y0: 5.2, y1: 7.6, d: 0.2, tile: CT.dark, det: KS.det, lit: 0 }); frame(G, Fw, s - 1.9, s + 1.9, 4.6, 8.2, 0.6, 0.25, RED); } }
      }
      lmWall(K, P, Q, 0, top, ops, PAN);
      lmBoxW(G, Fw, -0.1, L + 0.1, top - 0.3, top, -0.15, 0.3, hb('#9da2a6')); lmBoxW(G, Fw, -0.05, L + 0.05, 3.9, 4.25, -0.35, 0, hb('#b3b7bb'));
    }
    flatPlain(G, part.rings, top - 0.25, hb('#8b8f92'), false);
  }
  // the glazed drum on the corner, the cage of red braces, the ring canopy and the letters
  STATE.GBC = (SH.mall.ditton.find(p => p.key[0] === -1400) || {}).gbc || null;
  const [cx, cz] = C, R0 = RC - 0.6, R1 = RC + 1.4, Y = 11.6, seg = 16, a0 = Math.atan2(C[1] - 989.5, C[0] + 1363.5);
  for (let k = 0; k < seg; k++) {   // the drum above the hall, as far round as the corner reaches
    const t0 = a0 - Math.PI * 0.55 + k * Math.PI * 1.1 / seg, t1 = t0 + Math.PI * 1.1 / seg, A = [cx + Math.cos(t0) * R0, cz + Math.sin(t0) * R0], B = [cx + Math.cos(t1) * R0, cz + Math.sin(t1) * R0];
    const Fw = lmWF(A, B); flat(Fw, 0, Fw.L, 10.2, Y, 0, CT.dark, 1);
  }
  for (let k = 0; k <= 8; k++) {   // the braces: posts and the diagonals between them
    const t = a0 - Math.PI * 0.5 + k * Math.PI / 8, x = cx + Math.cos(t) * R1, z = cz + Math.sin(t) * R1;
    lmBar(G, [x, 0, z], [x, Y, z], 0.32, RED);
    if (k < 8) { const t2 = t + Math.PI / 8, x2 = cx + Math.cos(t2) * R1, z2 = cz + Math.sin(t2) * R1; lmBar(G, [x, 4.2, z], [x2, Y, z2], 0.2, RED); lmBar(G, [x2, 4.2, z2], [x, Y, z], 0.2, RED); }
    lmLathe(G, x, z, 0, [[0.4, 0], [0.4, 3.9]], 10, BEIGE);
  }
  for (const [y0, y1, rr, col] of [[Y, Y + 0.35, R1 + 0.9, hb('#d8dadc')], [Y + 0.35, Y + 0.75, R1 + 0.5, hb('#c8262c')]]) {
    lmLathe(G, cx, cz, y0, [[R0 - 1.5, 0], [rr, 0], [rr, y1 - y0], [R0 - 1.5, y1 - y0]], 32, col);
  }
  { const d = [Math.cos(a0), Math.sin(a0)], tx = -d[1], tz = d[0], w = 13, P = [cx + d[0] * (R0 - 1) - tx * w / 2, cz + d[1] * (R0 - 1) - tz * w / 2], Q = [cx + d[0] * (R0 - 1) + tx * w / 2, cz + d[1] * (R0 - 1) + tz * w / 2], Fw = lmWF(P, Q);
    for (const s of [1, 6.5, 12]) lmBar(G, Fw.at(s, Y + 0.75, 0.2), Fw.at(s, Y + 3.4, 0.2), 0.12, hb('#6d7276'));
    flat(Fw, 0, w, Y + 0.85, Y + 0.85 + 2.4, 0, CT.ditton, 1); }
  // the colonnade along the north-east side of the hall, the Rimi board over its entrance
  const hall = SH.mall.ditton.find(p => p.key[0] === -1400);
  if (hall) {
    const r = hall.outer, S = SHOPS.find(s => s.k === 'ditton'), i = frontEdge(r, S), Fw = edgeF(r, i);
    for (let s = 2; s < Fw.L - 1; s += 4.5) { const [x, , z] = Fw.at(s, 0, -3); lmLathe(G, x, z, 0, [[0.36, 0], [0.36, 3.9]], 10, BEIGE); }
    lmBoxW(G, Fw, 0.5, Fw.L - 0.5, 3.9, 4.3, -3.6, 0, hb('#b3b7bb'));
    board(K, Fw, 'rimi', Math.max(3, Math.min(Fw.L - 3, along(r, i, S.p))), 5.4, 1.8, 0.12, null);
  }
}

/* ---- the Solo trade park (Rīgas iela 9), from the photograph of 2011 (Wikimedia Commons, "Tirdzniecības parks
   Solo"): the entrance block on the cut corner clad in horizontal wooden slats in a pale olive frame, with the Solo
   logo, the glass canopy over the doors and a clock on the roof; glass curtain walls on each side of it; down one
   side grey corrugated cladding with tall steel fins, the other side a second slatted block; cream panels round the
   rest. The ground floor hall is a Mego (an iki in 2011). */
function solo(K) {
  const part = SH.mall.solo[0]; if (!part) return;
  const G = K.plain, r = part.outer, n = r.length >> 1, H = 9.2, CREAM = { tex: 5, col: hb('#e9dfba'), plinth: 0.5, pcol: hb('#7b776c') }, GREY = { tex: 5, col: hb('#9fa5aa'), plinth: 0.5, pcol: hb('#6c7175') };
  const SL = hb('#8a5a35'), FR = hb('#c9c39a'), A = [-1342.4, 1181.5], B = [-1344.5, 1192.1];
  STATE.GBC = part.gbc;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, P = [r[2 * i], r[2 * i + 1]], Q = [r[2 * j], r[2 * j + 1]], Fw = lmWF(P, Q), L = Fw.L; if (L < 0.05) continue;
    const m = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2], cut = Math.hypot(m[0] - (A[0] + B[0]) / 2, m[1] - (A[1] + B[1]) / 2) < 6;
    if (cut) { lmWall(K, P, Q, 0, H, [], CREAM); continue; }
    const nr = (U, V) => Math.hypot(U[0] - V[0], U[1] - V[1]) < 3, atB = nr(P, B) || nr(Q, B), atA = nr(P, A) || nr(Q, A), cutAtP = nr(P, A) || nr(P, B);
    const ops = [], sAt = x => cutAtP ? x : L - x;   // a distance from the cut corner as a place along the edge
    if (atA || atB) {   // the long sides from the entrance: glass first, then grey cladding with fins (by B) or a second slatted block (by A)
      for (let k = 0; k < 3; k++) { const u = sAt(k * 3), v = sAt((k + 1) * 3); ops.push({ s0: Math.min(u, v), s1: Math.max(u, v), y0: 0.4, y1: H - 0.6, d: 0.1, tile: CT.dark, det: KS.det, lit: 1 }); }
      lmWall(K, P, Q, 0, H, ops, atB ? GREY : CREAM);
      if (atB) for (let x = 13; x < L - 4; x += 3.2) for (const ds of [0, 0.5, 1.0]) lmBar(G, Fw.at(sAt(x + ds), 1.5, -0.35), Fw.at(sAt(x + ds), H + 2.4, -0.35), 0.1, hb('#b9bec2'));
      else { const u = sAt(9), v = sAt(20), s0 = Math.min(u, v), s1 = Math.max(u, v); lmBoxW(G, Fw, s0 - 0.4, s1 + 0.4, 0, H + 2.2, -0.9, 0, FR); for (let y = 0.6; y < H + 1.6; y += 0.32) lmBoxW(G, Fw, s0, s1, y, y + 0.2, -1.05, -0.9, SL, false); }
    } else lmWall(K, P, Q, 0, H, [], CREAM);
    lmBoxW(G, Fw, -0.1, L + 0.1, H - 0.25, H, -0.15, 0.3, hb('#c2bb95'));
  }
  flatPlain(G, part.rings, H - 0.3, hb('#8f9294'), false);
  // the entrance block on the cut corner: frame, slats, the Solo board, the banner of Mego, the glass canopy, the doors, the clock
  const Fw = lmWF(A, B), L = Fw.L, T = 14.2;
  lmBoxW(G, Fw, -0.6, L + 0.6, 0, T, -1.4, 0.5, FR);
  lmBoxW(G, Fw, 0.6, L - 0.6, T - 0.4, T + 1.6, -1.0, 3.0, hb('#d4d6d7'));
  for (let y = 4.6; y < T - 0.5; y += 0.34) for (const [s0, s1] of [[0.4, 2.6], [L - 2.6, L - 0.4]]) lmBoxW(G, Fw, s0, s1, y, y + 0.22, -1.55, -1.4, SL, false);
  for (let y = 9.0; y < T - 0.5; y += 0.34) lmBoxW(G, Fw, 2.6, L - 2.6, y, y + 0.22, -1.55, -1.4, SL, false);
  board(K, Fw, 'solo', L / 2, 9.4, 4.2, 1.6, null);
  board(K, Fw, 'mego', L / 2, 6.0, 2.2, 1.5, '#3a3c40');
  for (let k = 0; k < 2; k++) flat(Fw, 1.5 + k * 3.9, 1.5 + (k + 1) * 3.9, 0.1, 3.9, -1.41, k ? CT.glass : CT.door);
  lmBoxW(G, Fw, -0.4, L + 0.4, 4.0, 4.2, -4.0, -1.4, hb('#b8c4c8'));
  for (const s of [0.6, L - 0.6]) { const [x, , z] = Fw.at(s, 0, -3.7); lmLathe(G, x, z, 0, [[0.09, 0], [0.09, 4.0]], 8, hb('#8b9095')); }
  { const [x, , z] = Fw.at(L / 2, 0, 0.8); box(K.plain, x, z, Fw.tx, Fw.tz, 1.6, 0.25, T + 1.6, T + 2.6, hb('#2a2b2d'));
    const c = lmWF([x - Fw.tx * 1.4, z - Fw.tz * 1.4], [x + Fw.tx * 1.4, z + Fw.tz * 1.4]);
    K.clk.q(c.at(0, T + 1.7, -0.26), c.at(2.8, T + 1.7, -0.26), c.at(2.8, T + 2.5, -0.26), c.at(0, T + 2.5, -0.26), N_(c), [1, 0, 0, 0, 0, 1, 1, 1], LMWHITE, 1); }
}

/* Draws the stores: their own buildings, the tenants' fronts and boards, the two shopping centres. */
function lmShops(K, litPatch) {
  const [dc, dorm, dglow] = shAtlas();
  LMM.shDet = lmStd({ vertexColors: true, map: dc, alphaTest: 0.5, roughnessMap: dorm, metalnessMap: dorm, roughness: 1, metalness: 1, emissive: new THREE.Color(1, 1, 1), emissiveMap: dglow, emissiveIntensity: 0 }, 'lm-sh-det', litPatch);
  KS.det = new LMB();
  for (const S of SHOPS) {
    if (S.k === 'box') { const p = SH.own.get(S.id); if (p) storeBox(K, S, p.outer, p.H, p.gbc); else console.warn('shops: no building for', S.n, S.a); }
    else if (S.k === 'osm') {
      let r = new Float32Array(S.o.flat()); if (area2(r) < 0) r = reversed(r);
      lmRegisterOutline([0, 0, 1, 0], S.o, 4);
      let lo = 1e9, hi = -1e9; if (TERR.on) for (const [x, z] of S.o) { const t = terrainH(x, z); lo = Math.min(lo, t); hi = Math.max(hi, t); }
      const base = Math.min(hi - 0.15, lo + 2.5), gbc = TERR.on ? (x, y, z) => { const t = terrainH(x, z); return y <= 0.05 ? Math.min(base, t) - 0.25 - t - y : base - t; } : null, H = H_OF(S);
      STATE.GBC = gbc; flatPlain(K.plain, [r], H - 0.45, hb('#8d9194'), false);
      storeBox(K, S, r, H, gbc);
    } else if (S.k === 'in') tenant(K, S, SH.host.get(S.id));
  }
  ditton(K); solo(K);
  STATE.GBC = null;
  KS.det.mesh(LMM.shDet); KS.det = null;
}

export { SHV, lmShops, shopClaim };
