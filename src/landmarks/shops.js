import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { LMB, LMWHITE } from './core.js';
import { lmBar, lmBoxW, lmLathe, lmWF, lmWall } from './helpers.js';
import { LMM, lmStd } from './index.js';
import { lmRegisterOutline } from './tv-tower.js';
import { lmBench } from './heat-plant.js';
import { band, flatPlain, flatRoof, roofFace, tileOf } from '../buildings/walls.js';
import { ROOFPAL } from '../world/palette.js';
import { BLD, M_ASPH, M_PAVE, ROAD, inBuilding, onRoad } from '../world/data.js';
import { GB, box, polyA } from '../core/geometry.js';
import { fortCar } from '../fortress/arsenals.js';
import { area2, bbox, edgeN, hb, insetOk, obb, offsetRing, pick, pip, reversed, rnd, triangulate } from '../core/util.js';
import { TERR, subTris, terrainH } from '../world/terrain.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { scene } from '../render/renderer.js';

/* ---------- supermarkets: Rimi, Maxima, Mego, Lidl and Beta; the Ditton nams and Solo shopping centres ----------
   Every store of the five chains in Daugavpils that OpenStreetMap knows (shop=supermarket|convenience with their
   name, 26 stores; Nominatim search in the city's bounds). The look of each chain is taken from Wikimedia Commons
   photographs of its stores in Latvia: Lidl's new stores (Ķīšezera iela and Bieriņi in Riga, Dobeles šoseja in
   Jelgava, 2021–25: a long box of light grey panels, the front glazed under a deep canopy on columns, the blue square
   sign on the corner and on a pylon by the car park), Rimi (the red board with the white name, Rimi Hyper in Jelgava),
   Maxima (white walls with blue bands, the white name on blue and the red squares with the X of the format). Mego and
   Beta follow photographs of their Daugavpils stores sent by the owner of the project (Mego on Inženieru iela 3, Beta
   on Šaurā iela 31).
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
  { id: 'w628607721', b: 'beta', n: 'Beta', a: 'Puškina iela 14', k: 'box', p: [-93.6, 1068] },
  { id: 'n2455742945', b: 'beta', n: 'Beta', a: 'Ventspils iela 67', k: 'in', p: [-22.5, 537.3], e: [-16.4, 527.8] },
  { id: 'n3712549204', b: 'beta', n: 'Beta', a: 'Inženieru iela 1', k: 'box', style: 'betaGlass', p: [1313.5, -1186.9], e: [1311.3, -1198] },
  { id: 'w989692937', b: 'lidl', n: 'Lidl', a: '18. novembra iela 146', k: 'osm', p: [800.4, 505.6], pk: [791.6, 539.9], o: [[825.4, 453.8], [847.7, 475.7], [811.7, 512.7], [811.7, 516.7], [796.6, 532.5], [795.5, 533.5], [770.7, 509.7], [771.7, 508.6], [772.9, 507.4]] },
  { id: 'w1339342377', b: 'lidl', n: 'Lidl', a: 'Cietokšņa iela 74', k: 'box', p: [-1847.5, 430.6], pk: [-1890, 440] },   // the long side on the car park
  { id: 'w132266129', b: 'maxima', n: 'Maxima X', a: 'Piekrastes iela 29', k: 'box', p: [-529, -1895], e: [-533.7, -1877.7], drop: [[-524.3, -1908.6]] },
  { id: 'w366850613', b: 'maxima', n: 'Maxima X', a: 'Smilšu iela 98A', k: 'box', p: [824.7, -760.3], pk: [811.9, -776.6] },
  { id: 'w817340088', b: 'maxima', n: 'Maxima X', a: 'Aveņu iela 35B', k: 'box', p: [-867.7, -2435.4], e: [-865.1, -2447.6] },
  { id: 'n7627429907', b: 'maxima', n: 'Maxima X', a: 'Arodu iela 15', k: 'in', p: [-59.5, 576], pk: [-5.8, 546.7] },
  { id: 'n460001555', b: 'maxima', n: 'Maxima X', a: 'Strādnieku iela 103', k: 'in', p: [1215.2, 153.3], e: [1204, 165.7] },
  { id: 'n4128737289', b: 'maxima', n: 'Maxima X', a: 'Arhitektu iela 3', k: 'box', p: [1230.9, -1012.4], e: [1257.4, -1029.1] },
  { id: 'n8746469346', b: 'maxima', n: 'Maxima X', a: 'Kandavas iela 5', k: 'in', p: [-1688, 991.4], pk: [-1676.6, 999.1] },
  { id: 'n1314059910', b: 'maxima', n: 'Maxima XX', a: 'Cietokšņa iela 60', k: 'box', p: [-1183.7, 844.8], pk: [-1151.2, 829.1] },
  { id: 'w115783101', b: 'mego', n: 'Mego', a: 'Inženieru iela 3', k: 'box', p: [1332.6, -1149.9], pk: [1358, -1134] },   // the long side on the street (photographs)
  { id: 'w238279628', b: 'mego', n: 'Mego', a: 'Valkas iela 1A', k: 'box', p: [1295.4, 316.8], pk: [1280, 310.4] },
  { id: 'n9061242848', b: 'mego', n: 'Mego', a: 'Aveņu iela 26', k: 'osm', p: [-791.3, -2082.8], pk: [-823.8, -2101.3], o: [[-789.6, -2118], [-792.7, -2113.4], [-793.8, -2111.7], [-815.2, -2080.1], [-823.6, -2067.8], [-821.8, -2066.5], [-820.1, -2065.1], [-818.5, -2063.9], [-816.1, -2051], [-812, -2048.4], [-802.1, -2063.5], [-786.7, -2053.8], [-757.9, -2096.5], [-781.2, -2112.2], [-784.9, -2114.8], [-787.3, -2116.4]] },
  { id: 'n4141448659', b: 'mego', n: 'Mego', a: 'Vaļņu iela 27A', k: 'box', p: [-2071.9, -482.2], pk: [-2051.2, -488.9] },
  { id: 'n1707170884', b: 'mego', n: 'Mego', a: 'Viestura iela 60', k: 'in', p: [-992.5, 1158.7] },
  { id: 'n474748343', b: 'mego', n: 'Mego', a: 'Rīgas iela 9, Solo', k: 'solo', p: [-1382.5, 1183.3], e: [-1343.5, 1186.9] },
  { id: 'n2462543293', b: 'mego', n: 'Mego', a: 'Raipoles iela 11A, Aveņu centrs', k: 'in', p: [-864.6, -1984.2], e: [-857.4, -2003.2] },
  { id: 'n11943175157', b: 'rimi', n: 'Rimi Hyper', a: 'Cietokšņa iela 72A', k: 'box', p: [-1687.9, 483.9], pk: [-1630, 460], slat: [[-1661.5, 530.3], [-1667.2, 532.7]], doors: [[-1671.0, 515.1], [-1676.4, 518.7]], drop: [[-1671.0, 520.9]] },   // several entrances: the glazed front on the car park, the main doors at the back of a recess (slat: its mouth)
  { id: 'n9296108168', b: 'rimi', n: 'Rimi Super', a: '18. novembra iela 136', k: 'box', p: [691, 622.1], e: [698.3, 594.6] },
  { id: 'n1707161675', b: 'rimi', n: 'Rimi', a: 'Cietokšņa iela 60, Ditton nams', k: 'ditton', p: [-1335.5, 1006.1], e: [-1321.6, 1047.4] },
  { id: 'n1707171536', b: 'rimi', n: 'mini Rimi', a: 'Viestura iela 10, autoosta', k: 'in', p: [-936.3, 1262.4], pk: [-928.9, 1285.5] },
  { id: 'n8365754782', b: 'rimi', n: 'Rimi', a: 'Smilšu iela 92B', k: 'box', p: [884.7, -488.5], e: [861.9, -482.1] },
];
// the walls of each chain: height to the top of the parapet, panels (wall texture 5) or render (1), bands [y from the top, height, colour]
const STY = {
  lidl: { h: 7.2, tex: 5, wall: '#dde0e3', plinth: '#62676b', glaze: 'all', gTop: 4.2, canopy: 4.2, pylon: 'lidl' },
  rimi: { h: 6.2, tex: 5, wall: '#eef0f0', plinth: '#73777b', glaze: 0.5, gTop: 3.4, bands: [[1.5, 0.9, '#d8202c']], canopy: 1.6, pylon: 'rimi' },
  maxima: { h: 5.8, tex: 5, wall: '#f1f2f0', plinth: '#73777b', glaze: 0.4, gTop: 3.2, bands: [[0.75, 0.45, '#1d3d8f']], gBand: '#1d3d8f', canopy: 1.3, pylon: 'maxima' },
  // Mego (Inženieru iela 3 in Ķīmiķu ciemats, photographs sent by the owner of the project): light grey panels, a deep dark blue canopy along the
  // front with the hours in yellow, the name in big yellow letters on the wall above it
  mego: { h: 7.6, tex: 5, wall: '#b9bdc1', plinth: '#6c7074', glaze: 0.5, gTop: 3.6, canopy: 3.0, pylon: 'mego' },
  // Beta (Šaurā iela 31, photographs sent by the owner of the project): buff brick, big windows in dark frames, a sloping canopy of blue profiled
  // sheet along the front, a low hipped roof of grey metal, the name in big letters on the roof
  // Beta on Inženieru iela 1 (photographs sent by the owner of the project): four storeys, the front a curtain wall of pale
  // green glass with white spandrels between red brick ends, a brick stair tower over the roof, brick walls behind
  betaGlass: { h: 12.6 },
  beta: { h: 4.2, tex: 6, wall: '#ffffff', plinth: '#7b6a5d', glaze: 0.85, gTop: 2.9, canopy: 1.9, pitched: '#6d7276' },
};
const signOf = S => S.b === 'rimi' ? (/Hyper/.test(S.n) ? 'rimiHyper' : /Super/.test(S.n) ? 'rimiSuper' : /mini/.test(S.n) ? 'miniRimi' : 'rimi') : S.b === 'maxima' ? (/XX/.test(S.n) ? 'maximaXX' : 'maximaX') : S.b;
// key points inside the cadastre parts of the two shopping centres
const MALL = { ditton: [[-1210, 915], [-1290, 960], [-1400, 980], [-1268, 993.5]] };

// ---- claiming the buildings while buildBuildings runs
const SH = { own: new Map(), host: new Map(), mall: { ditton: [] } };
const H_OF = S => STY[S.style || S.b].h;
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
    const T = tileOf((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2), seed = Math.floor(rnd(id, 9) * 255);
    if (!(STY[S.style || S.b].pitched && hipRoof(T, outer, rings, part.H, hb(STY[S.b].pitched), seed))) flatRoof(T.m.roof, rings, part.H - 0.45, pick(ROOFPAL[5], id, 2), 5, seed);
    return true;
  }
  return false;
}

// a low roof over the outline: slopes from the eaves (35 cm out) up to the outline drawn in, a flat top; false if it does not fit
function hipRoof(T, outer, rings, H, tint, seed) {
  if (rings.length !== 1) return false;
  const o = obb(outer), tanp = Math.tan(0.3), ov = 0.35; let d = Math.min(6, o ? o.b * 0.9 : 4), inn = null;
  for (let k = 0; k < 6 && d > 0.7; k++) { const q = offsetRing(outer, -d); if (insetOk(outer, q)) { inn = q; break; } d *= 0.7; }
  if (!inn) {   // a hipped roof over the box round the outline, if the outline fills it
    if (!o || o.fill < 0.82) return false;
    const a = o.a + ov, b = o.b + ov, r = Math.min(b, a) * 0.9, P = (su, sv, y) => [o.cx + o.ux * su - o.uz * sv, y, o.cz + o.uz * su + o.ux * sv], yE = H - ov * tanp, yT = yE + r * tanp;
    const c = [P(-a, -b, yE), P(a, -b, yE), P(a, b, yE), P(-a, b, yE)], t = [P(-a + r, -b + r * (b / Math.max(b, r)), yT), P(a - r, -b + r * (b / Math.max(b, r)), yT), P(a - r, b - r * (b / Math.max(b, r)), yT), P(-a + r, b - r * (b / Math.max(b, r)), yT)];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, mx = (c[i][0] + c[j][0]) / 2 - o.cx, mz = (c[i][2] + c[j][2]) / 2 - o.cz, l = Math.hypot(mx, mz) || 1; roofFace(T.m.roof, [c[i], c[j], t[j], t[i]], mx / l, mz / l, tint, 2, seed); }
    flatRoof(T.m.roof, [new Float32Array([t[0][0], t[0][2], t[1][0], t[1][2], t[2][0], t[2][2], t[3][0], t[3][2]])], yT, tint, 2, seed);
    return true;
  }
  const G = T.m, eave = offsetRing(outer, ov), yE = H - ov * tanp, yT = H + d * tanp, n = outer.length >> 1;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, ed = edgeN(outer, i); if (ed[2] < 0.05) continue; roofFace(G.roof, [[eave[2 * i], yE, eave[2 * i + 1]], [eave[2 * j], yE, eave[2 * j + 1]], [inn[2 * j], yT, inn[2 * j + 1]], [inn[2 * i], yT, inn[2 * i + 1]]], ed[0], ed[1], tint, 2, seed); }
  flatRoof(G.roof, [inn], yT, tint, 2, seed); band(G.plain, outer, eave, yE, hb('#5f6366'), true);
  return true;
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
  const betaName = (x, y, w, h, bcol = '#f2a020') => {   // an orange (or cream) b and a blue eta set together, in white outlines
    let sz = h * PX * 1.25; const f = () => `900 ${sz}px Arial, "Golos Text", sans-serif`; g.font = f(); const W = g.measureText('beta').width; if (W > w * PX) { sz *= w * PX / W; g.font = f(); }
    const wb = g.measureText('b').width, W2 = g.measureText('beta').width, x0 = X + x * PX + (w * PX - W2) / 2, yb = Y + (y + h) * PX - sz * 0.05;
    for (const [part, dx, col, glow] of [['b', 0, bcol, '#ffd890'], ['eta', wb * 0.97, '#2445b8', '#4a6ae8']]) for (const [c, s2] of [[g, col], [e, glow], [o, ORM.gloss]]) {
      c.font = f(); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; if (c === g) { c.lineWidth = sz * 0.09; c.strokeStyle = '#ffffff'; c.lineJoin = 'round'; c.strokeText(part, x0 + dx, yb); } c.fillStyle = s2; c.fillText(part, x0 + dx, yb); } };
  // text fitted into a box; glow: the colour it shines at night
  const text = (s, x, y, w, h, col, { font = '"Golos Text", Arial, sans-serif', wt = 800, italic = false, glow = col, align = 'center', outline = null } = {}) => {
    let sz = h * PX; const f = () => `${italic ? 'italic ' : ''}${wt} ${sz}px ${font}`; g.font = f(); const mw = g.measureText(s).width; if (mw > w * PX) { sz *= w * PX / mw; g.font = f(); }
    const tx = align === 'center' ? X + (x + w / 2) * PX : X + x * PX, ty = Y + (y + h / 2) * PX;
    for (const [c, s2] of [[g, col], [e, glow], [o, ORM.gloss]]) { c.font = f(); c.textAlign = align; c.textBaseline = 'middle'; if (outline && c === g) { c.lineWidth = sz * 0.08; c.strokeStyle = outline; c.strokeText(s, tx, ty + sz * 0.04); } c.fillStyle = s2; c.fillText(s, tx, ty + sz * 0.04); }
  };
  const defs = [
    // a module of a shop's curtain wall: aluminium frame, a transom, the shop inside (lit ceiling, shelves)
    ['glass', 3.0, 3.4, () => { glass(0, 0, 3, 3.4); R(0.06, 0.12, 2.88, 0.12, '#f4efe2', 'glass', '#fff4dc'); for (let k = 0; k < 5; k++) R(0.2 + k * 0.56, 2.0, 0.42, 1.2, ['#6f6253', '#56656d', '#7d5a4c', '#5e6a52', '#7c7461'][k], 'glass', ['#a07a50', '#6a8090', '#b06a4f', '#7a8e60', '#b8a070'][k]);
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
    ['mego', 4.2, 1.5, () => { R(0, 0, 4.2, 1.5, '#23408e', 'gloss', '#3050b0'); text('mego', 0.2, 0.05, 3.8, 1.3, '#f6d10f', { wt: 700, glow: '#ffe040' }); }],
    ['megoL', 4.4, 1.6, () => { text('mego', 0, 0, 4.4, 1.6, '#f6d10f', { wt: 700, glow: '#ffe040' }); }],
    ['h822', 1.8, 0.8, () => { text('8-22', 0, 0, 1.8, 0.8, '#f6d10f', { wt: 800, glow: '#ffe040' }); }],
    ['h822w', 3.6, 1.4, () => { text('8-22', 0, 0, 3.6, 1.4, '#ffffff', { wt: 800, glow: '#ffffff' }); }],
    // the name of Beta: an orange b and a blue eta in white outlines (cut out for the roof, on a white board for the tenants)
    ['betaL', 5.2, 2.2, () => { betaName(0.15, 0.1, 4.9, 2.0); }],
    ['betaL2', 5.2, 2.2, () => { betaName(0.15, 0.1, 4.9, 2.0, '#eee3c8'); }],
    // a module of the curtain wall of Beta on Inženieru iela: pale green glass over a white spandrel, green-grey frames
    ['cw', 1.6, 3.1, () => { glass(0, 0, 1.6, 2.15, ['#8fb2ad', '#c4dbd6', '#86a7a2'], '#fff0d0'); R(0, 2.15, 1.6, 0.95, '#ece9e0'); R(0, 0, 1.6, 0.07, '#7f9a96', 'metal'); R(0, 2.1, 1.6, 0.07, '#7f9a96', 'metal'); R(0, 0, 0.06, 3.1, '#7f9a96', 'metal'); R(1.54, 0, 0.06, 3.1, '#7f9a96', 'metal'); R(0, 1.05, 1.6, 0.05, '#9fb4b0', 'metal'); }],
    ['beta', 4.0, 1.5, () => { R(0, 0, 4.0, 1.5, '#ffffff', 'gloss', '#fff8ee'); betaName(0.3, 0.12, 3.4, 1.26); }],
    // a shop window in a dark frame, two by three panes (Beta)
    ['win2', 3.4, 2.6, () => { glass(0, 0, 3.4, 2.6); R(0.1, 0.1, 3.2, 0.1, '#f4efe2', 'glass', '#fff4dc'); for (let k = 0; k < 5; k++) R(0.3 + k * 0.6, 1.5, 0.45, 0.9, ['#6f6253', '#56656d', '#7d5a4c', '#5e6a52', '#7c7461'][k], 'glass', ['#a07a50', '#6a8090', '#b06a4f', '#7a8e60', '#b8a070'][k]);
      for (const x of [0, 1.66, 3.32]) R(x, 0, 0.08, 2.6, '#3a3d40', 'metal'); for (const y of [0, 0.9, 1.75, 2.52]) R(0, y, 3.4, 0.08, '#3a3d40', 'metal'); }],
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
const SHOP_TREES = [];   // trees planted by the stores [x, z, type, scale], added by buildTrees
const N_ = Fw => [Fw.nx, 0, Fw.nz];
const sh2 = (c, f) => c.map(v => Math.min(255, Math.round(v * f)));
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
    const j = (i + 1) % n, ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * j], bz = r[2 * j + 1], L = Math.hypot(bx - ax, bz - az); if (L < 6) continue;
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
      if (S.b === 'beta') { const m2 = Math.max(1, Math.round(gw / 4.2)), w2 = gw / m2; for (let k = 0; k < m2; k++) { const a = sc - gw / 2 + k * w2; ops.push(k === Math.floor(m2 / 2) ? { s0: a + w2 / 2 - 0.8, s1: a + w2 / 2 + 0.8, y0: 0.1, y1: st.gTop - 0.1, d: 0.25, tile: CT.door, det: KS.det, lit: 1 } : { s0: a + 0.45, s1: a + w2 - 0.45, y0: 0.35, y1: st.gTop - 0.1, d: 0.12, tile: CT.win2, det: KS.det, lit: 1 }); } }
      else for (let k = 0; k < m; k++) ops.push({ s0: sc - gw / 2 + k * mw, s1: sc - gw / 2 + (k + 1) * mw, y0: 0.1, y1: st.gTop, d: 0.15, tile: k === md ? CT.door : CT.glass, det: KS.det, lit: 1 });
      front = { Fw, L, sc, gw, i };
    }
    lmWall(K, P, Q, 0, H, ops, wall);
    for (const [top, hh, col] of st.bands || []) lmBoxW(G, Fw, -0.06, L + 0.06, H - top - hh, H - top, -0.07, 0, hb(col));
    if (!st.pitched) lmBoxW(G, Fw, -0.12, L + 0.12, H - 0.18, H, -0.12, 0.35, hb(st.b === 'mego' ? '#2e3033' : '#9aa0a4'));   // the coping of the parapet
  }
  if (!front) return;
  const { Fw, L, sc, gw } = front; { const [x, , z] = Fw.at(sc, 0, 0); SHV.push({ n: S.n, a: S.a, x, z, nx: Fw.nx, nz: Fw.nz }); }
  if (st.gBand) lmBoxW(G, Fw, sc - gw / 2 - 0.3, sc + gw / 2 + 0.3, st.gTop + 0.05, st.gTop + 0.5, -0.09, 0, hb(st.gBand));
  if (S.b === 'lidl') {   // the dark upper band of the front, the deep canopy on columns, the square board on the corner
    lmBoxW(G, Fw, -0.1, L + 0.1, st.gTop + 0.6, H - 0.18, -0.1, 0, hb('#53595e'));
    lmBoxW(G, Fw, sc - gw / 2 - 0.4, sc + gw / 2 + 0.4, st.gTop + 0.25, st.gTop + 0.85, -st.canopy, 0, hb('#5d6368'));
    const nc = Math.max(2, Math.round(gw / 7)); for (let k = 0; k <= nc; k++) { const [x, , z] = Fw.at(sc - gw / 2 + k * gw / nc, 0, -st.canopy + 0.4); lmLathe(G, x, z, 0, [[0.11, 0], [0.11, st.gTop + 0.25]], 8, hb('#8b9095')); }
    const s = Math.min(L - 1.6, sc + gw / 2 - 1.2); board(K, Fw, 'lidl', s, st.gTop + 1.0, Math.min(2.2, H - 0.3 - st.gTop - 1.0), 0.14, null);
  } else if (S.b === 'mego') {   // the deep dark blue canopy with the hours on its fascia, the yellow letters on the wall above
    const y0 = st.gTop + 0.2, y1 = st.gTop + 1.3, dp = -st.canopy, s0 = Math.max(-0.2, sc - gw / 2 - 1.5), s1 = Math.min(L + 0.2, sc + gw / 2 + 1.5);
    lmBoxW(G, Fw, s0, s1, y0, y1, dp, 0, hb('#23408e'));
    for (let s = s0 + 1.2; s < s1 - 0.6; s += 2.4) lmBoxW(G, Fw, s - 0.2, s + 0.2, y0 - 0.04, y0, dp + 1.0, dp + 1.4, hb('#fff6e0'));
    flat(Fw, sc - 1.1, sc + 1.1, y0 + 0.15, y0 + 1.0, dp - 0.012, CT.h822);
    const t = CT.megoL, hh = Math.min(2.3, H - y1 - 0.45), w = hh * t.w / t.h; flat(Fw, sc - w / 2, sc + w / 2, y1 + 0.35, y1 + 0.35 + hh, -0.03, t);
  } else if (S.b === 'beta') {   // the sloping blue canopy along the whole front, lights under it, the name on the roof
    const y0 = st.gTop + 0.25, y1 = st.gTop + 1.3, dp = -st.canopy, BLU = hb('#2c58ac');
    lmBoxW(G, Fw, -0.4, L + 0.4, y0 - 0.12, y0, dp, 0, hb('#d9dcde'));
    polyA(G, [Fw.at(-0.4, y0, dp), Fw.at(L + 0.4, y0, dp), Fw.at(L + 0.4, y1, 0.05), Fw.at(-0.4, y1, 0.05)], BLU, Fw.nx, 1, Fw.nz);
    for (const s of [-0.4, L + 0.4]) polyA(G, [Fw.at(s, y0, dp), Fw.at(s, y0, 0.05), Fw.at(s, y1, 0.05)], sh2(BLU, 0.85), s < 0 ? -Fw.tx : Fw.tx, 0, s < 0 ? -Fw.tz : Fw.tz);
    for (let s = 1.5; s < L - 1; s += 3) lmBoxW(G, Fw, s - 0.6, s + 0.6, y0 - 0.17, y0 - 0.12, dp + 0.4, dp + 0.55, hb('#fff6e0'));
    const t = CT.betaL, w = Math.min(7, L * 0.35), hh = w * t.h / t.w, s = Math.max(w / 2 + 0.5, Math.min(L - w / 2 - 0.5, sc - gw / 2 + w / 2)), yb = H + 0.15;
    for (const q of [s - w * 0.3, s + w * 0.3]) lmBar(G, Fw.at(q, H - 0.4, 0.4), Fw.at(q, yb + hh * 0.6, 0.4), 0.1, hb('#55595d'));
    flat(Fw, s - w / 2, s + w / 2, yb, yb + hh, 0.25, t);
  } else {
    lmBoxW(G, Fw, sc - gw / 2 - 0.3, sc + gw / 2 + 0.3, st.gTop + 0.05, st.gTop + 0.35, -st.canopy, 0, hb(S.b === 'mego' ? '#2e3033' : '#d6d9db'));
    const name = signOf(S), t = CT[name], room = H - 0.3 - (st.gTop + 0.55), h = Math.max(0.9, Math.min(t.h, room, (gw + 1) * t.h / t.w));
    board(K, Fw, name, sc, st.gTop + 0.55, h, 0.12, S.b === 'beta' ? '#c9252c' : null);
  }
  // machines on the roof
  const [cx, cz] = inner(r); STATE.GBC = gbc;
  if (!st.pitched) for (const [a, b] of [[0, 0], [3.5, 1.5], [-3, -2]]) { const x = cx + Fw.tx * a - Fw.nx * b, z = cz + Fw.tz * a - Fw.nz * b; if (pip(x, z, r)) box(G, x, z, Fw.tx, Fw.tz, 1.1, 0.7, H - 0.45, H + 0.85, hb('#a7abae')); }
  if (S.slat) slatBlock(K, S);
  if (st.pylon && (S.b !== 'maxima' || /XX/.test(S.n)) && (S.b !== 'rimi' || /Hyper|Super/.test(S.n) || L > 30)) pylon(K, S, r, fi, signOf(S), gbc);
}
/* Rimi Hyper on Cietokšņa iela (photographs sent by the owner of the project): over the mouth of the recess with the
   main doors a block clad in brown wooden slats, the red board with the name standing up over the roof, the hours in
   white letters on the slats, a deep canopy over the recess on a slender column. */
function slatBlock(K, S) {
  const G = K.plain, [M1, M2] = S.slat, Fw = lmWF(M1, M2), L = Fw.L, BR = hb('#7a5236'), DK = hb('#5e3e29');
  lmBoxW(G, Fw, -2.8, L + 2.8, 4.5, 10.6, -0.7, 5, DK);
  for (let y = 4.7; y < 10.5; y += 0.32) { lmBoxW(G, Fw, -3.0, L + 3.0, y, y + 0.17, -0.9, -0.7, BR, false); for (const s of [-3.0, L + 2.8]) lmBoxW(G, Fw, s, s + 0.2, y, y + 0.17, -0.9, 5, BR, false); }
  lmBoxW(G, Fw, -2.8, L + 2.8, 4.25, 4.5, -3.6, 15, hb('#cfd3d6'));
  for (let s = -1.5; s < L + 2; s += 3) lmBoxW(G, Fw, s - 0.25, s + 0.25, 4.21, 4.25, -2.8, -2.4, hb('#fff6e0'));
  { const [x, , z] = Fw.at(L + 1.2, 0, -3.2); lmLathe(G, x, z, 0, [[0.1, 0], [0.1, 4.25]], 8, hb('#e6e8ea')); }
  const t = CT.rimiHyper, h = 3.6, w = h * t.w / t.h, sc = L / 2;
  lmBoxW(G, Fw, sc - w / 2 - 0.1, sc + w / 2 + 0.1, 9.9, 9.9 + h + 0.2, -1.25, -0.9, hb('#d8202c'));
  for (const q of [sc - w / 3, sc + w / 3]) lmBar(G, Fw.at(q, 9.9, -0.95), Fw.at(q, 9.9 + h, 1.0), 0.12, hb('#55595d'));
  flat(Fw, sc - w / 2, sc + w / 2, 10.0, 10.0 + h, -1.262, t);
  flat(Fw, sc - 0.6, sc + 3.0, 6.4, 7.8, -0.92, CT.h822w);
  if (S.doors) {   // the glazed doors at the back of the recess
    const D = lmWF(...S.doors), m = Math.max(1, Math.round(D.L / 3)), w = D.L / m;
    for (let k = 0; k < m; k++) flat(D, k * w, (k + 1) * w, 0.05, 3.6, -0.05, k === Math.floor(m / 2) ? CT.door : CT.glass);
  }
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

/* Beta on Inženieru iela 1: the glazed front (the edge facing the entrance) in curtain wall modules of 1.6 m a storey
   high between red brick ends, the brick stair tower at one end of it over the roof, a glass canopy over the doors,
   the name on the roof; brick walls with a few small windows elsewhere. */
function betaGlass(K, S, part) {
  const G = K.plain, r = part.outer, n = r.length >> 1, H = part.H, fi = frontEdge(r, S), BR = { tex: 3, col: LMWHITE, plinth: 0.4, pcol: hb('#6e6a66') }, MUL = hb('#7f9a96');
  let sd = 77; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const fl = Math.max(1, Math.round((H - 0.6) / 3.1)), fh = (H - 0.9) / fl, pt = k => [r[2 * (k % n)], r[2 * (k % n) + 1]];
  // the front: the edge facing the entrance and the edges in line with it on both sides
  const dir = k => { const a = pt(k), b = pt(k + 1), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }, d0 = dir(fi);
  const inLine = k => { const d = dir(k), a = pt(k), o = pt(fi); return d[0] * d0[0] + d[1] * d0[1] > 0.995 && Math.abs((a[0] - o[0]) * d0[1] - (a[1] - o[1]) * d0[0]) < 0.4; };
  let a = fi, b = fi; for (let k = 0; k < n && inLine((a - 1 + n) % n); k++) a = (a - 1 + n) % n; for (let k = 0; k < n && inLine((b + 1) % n); k++) b = (b + 1) % n;
  const front = new Set(); for (let k = a; ; k = (k + 1) % n) { front.add(k); if (k === b) break; }
  STATE.GBC = part.gbc;
  for (let i = 0; i < n; i++) {
    if (front.has(i)) continue;
    const P = pt(i), Q = pt(i + 1), Fw = lmWF(P, Q), L = Fw.L; if (L < 0.05) continue;
    const ops = [];
    if (L > 6) for (let x = 2.5; x < L - 2; x += 4.2) for (let f = 0; f < fl; f++) if (rr() < 0.45) ops.push({ s0: x - 0.32, s1: x + 0.32, y0: 0.3 + f * fh + 1.1, y1: 0.3 + f * fh + 1.85, d: 0.15, tile: CT.dark, det: KS.det, lit: rr() < 0.25 ? 1 : 0 });
    lmWall(K, P, Q, 0, H, ops, BR);
    lmBoxW(G, Fw, -0.1, L + 0.1, H - 0.15, H, -0.1, 0.3, hb('#8d8a86'));
  }
  // the front: the stair tower of brick at its right end (seen from outside), the curtain wall, a narrow brick end on the left
  const P = pt(a), Q = pt(b + 1), Fw = lmWF(P, Q), L = Fw.L, TW = 6.2, s0 = TW + 0.2, s1 = L - 1.4, m = Math.max(1, Math.round((s1 - s0) / 1.6)), mw = (s1 - s0) / m, ops = [];
  const pA = L - 5.4, cA = L - 11.6;   // the porch at the left end and the canopy from it over the doors in the glazing
  for (let k = 0; k < m; k++) for (let f = 0; f < fl; f++) { const mid = s0 + (k + 0.5) * mw; ops.push({ s0: s0 + k * mw, s1: s0 + (k + 1) * mw, y0: 0.3 + f * fh, y1: 0.3 + (f + 1) * fh, d: 0.06, tile: !f && mid > cA + 1.5 && mid < pA - 0.5 ? CT.door : CT.cw, det: KS.det, lit: f === 0 || rr() < 0.3 ? 1 : 0 }); }
  lmWall(K, P, Q, 0, H, ops, BR); lmBoxW(G, Fw, -0.1, L + 0.1, H - 0.15, H, -0.1, 0.3, hb('#8d8a86'));
  for (let k = 0; k <= m; k++) lmBar(G, Fw.at(s0 + k * mw, 0.3, -0.07), Fw.at(s0 + k * mw, 0.3 + fl * fh, -0.07), 0.12, MUL);
  { const [x, , z] = Fw.at((s0 + s1) / 2, 0, 0); SHV.push({ n: S.n, a: S.a, x, z, nx: Fw.nx, nz: Fw.nz }); }
  const c = [Fw.at(0, 0, 0), Fw.at(TW, 0, 0), Fw.at(TW, 0, TW), Fw.at(0, 0, TW)].map(p => [p[0], p[2]]);
  for (let k = 0; k < 4; k++) lmWall(K, c[k], c[(k + 1) % 4], H - 0.2, H + 2.2, [], BR);
  polyA(G, c.map(p => [p[0], H + 2.2, p[1]]), hb('#8d8a86'), 0, 1, 0);
  // the entrance: a low porch of brick with glass doors at the left end, a vaulted glass canopy from it on two posts
  { const pc = [Fw.at(pA, 0, -3.0), Fw.at(L + 0.3, 0, -3.0), Fw.at(L + 0.3, 0, 0), Fw.at(pA, 0, 0)].map(p => [p[0], p[2]]);
    lmWall(K, pc[0], pc[1], 0, 3.3, [{ s0: 1.4, s1: 3.6, y0: 0.1, y1: 2.6, d: 0.12, tile: CT.door, det: KS.det, lit: 1 }], BR); lmWall(K, pc[1], pc[2], 0, 3.3, [], BR); lmWall(K, pc[3], pc[0], 0, 3.3, [], BR);
    polyA(G, [pc[0], pc[1], pc[2], pc[3]].map(p => [p[0], 3.3, p[1]]), hb('#6d7174'), 0, 1, 0); lmBoxW(G, Fw, pA - 0.1, L + 0.4, 3.15, 3.35, -3.1, 0, hb('#8d8a86'));
    const GL = hb('#b7cfca'), prof = []; for (let k = 0; k <= 8; k++) { const t = k / 8; prof.push([-2.9 * t, 3.05 + 0.6 * Math.sin(Math.PI * (0.25 + 0.6 * t))]); }
    for (let k = 0; k < 8; k++) { const [d1, y1] = prof[k], [d2, y2] = prof[k + 1]; polyA(G, [Fw.at(cA, y1, d1), Fw.at(pA, y1, d1), Fw.at(pA, y2, d2), Fw.at(cA, y2, d2)], GL, Fw.nx, 1, Fw.nz); lmBar(G, Fw.at(cA, y1, d1), Fw.at(cA, y2, d2), 0.08, MUL); }
    lmBar(G, Fw.at(cA, prof[8][1], -2.9), Fw.at(pA, prof[8][1], -2.9), 0.1, MUL);
    for (const q of [cA + 0.3, pA - 0.3]) { const [x2, , z2] = Fw.at(q, 0, -2.8); lmLathe(G, x2, z2, 0, [[0.07, 0], [0.07, prof[8][1]]], 8, MUL); } }
  // the lawn in front: young trees, bushes by the tower, benches
  for (const [q, d, sc] of [[L * 0.36, -8.5, 0.55], [L * 0.5, -9.5, 0.6], [L * 0.63, -8.0, 0.5], [-3.5, -6, 0.75]]) { const [x2, , z2] = Fw.at(q, 0, d); SHOP_TREES.push([x2, z2, 1, sc]); }
  for (const [q, d] of [[1.5, -4.5], [3.5, -5.2], [5.5, -4.6], [-1.5, -5.5]]) { const [x2, , z2] = Fw.at(q, 0, d); SHOP_TREES.push([x2, z2, 1, 0.3]); }
  { const f = [P[0], P[1], Fw.nx, Fw.nz]; for (const q of [L * 0.3, L * 0.55]) lmBench(G, f, 11, q, -1); }
  const t = CT.betaL2, w = 5.6, hh = w * t.h / t.w, sn = Math.min(L - w / 2 - 1, Math.max(TW + w / 2 + 1, L * 0.55));
  for (const q of [sn - 1.6, sn + 1.6]) lmBar(G, Fw.at(q, H - 0.3, 0.5), Fw.at(q, H + hh * 0.6, 0.5), 0.1, hb('#55595d'));
  flat(Fw, sn - w / 2, sn + w / 2, H + 0.1, H + 0.1 + hh, 0.3, t);
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

/* ---- the Solo trade park (Rīgas iela 9). Its building is drawn by lmLatgola as the yellow shopping centre next to
   the hotel; added here from the photograph of 2011 (Wikimedia Commons, "Tirdzniecības parks Solo") is its entrance
   block on the cut corner: clad in horizontal wooden slats in a pale olive frame, with the Solo logo, the board of Mego
   (the ground floor hall, an iki in 2011), the glass canopy over the doors and a clock on the roof. */
function solo(K) {
  const G = K.plain, SL = hb('#8a5a35'), FR = hb('#c9c39a'), A = [-1342.45, 1181.5], B = [-1344.5, 1192.1], Fw = lmWF(A, B), L = Fw.L, T = 14.2;
  STATE.GBC = null;   // as the building, which follows the ground
  lmBoxW(G, Fw, -0.6, L + 0.6, 0, T, -1.4, 0.5, FR);
  lmBoxW(G, Fw, 0.6, L - 0.6, T - 0.4, T + 1.6, -1.0, 3.0, hb('#d4d6d7'));
  for (let y = 4.6; y < T - 0.5; y += 0.34) for (const [s0, s1] of [[0.4, 2.6], [L - 2.6, L - 0.4]]) lmBoxW(G, Fw, s0, s1, y, y + 0.22, -1.55, -1.4, SL, false);
  for (let y = 9.0; y < T - 0.5; y += 0.34) lmBoxW(G, Fw, 2.6, L - 2.6, y, y + 0.22, -1.55, -1.4, SL, false);
  board(K, Fw, 'solo', L / 2, 9.4, 4.2, 1.6, null);
  board(K, Fw, 'mego', L / 2, 6.0, 2.2, 1.5, '#23408e');
  for (let k = 0; k < 2; k++) flat(Fw, 1.5 + k * 3.9, 1.5 + (k + 1) * 3.9, 0.1, 3.9, -1.41, k ? CT.glass : CT.door);
  lmBoxW(G, Fw, -0.4, L + 0.4, 4.0, 4.2, -4.0, -1.4, hb('#b8c4c8'));
  for (const s of [0.6, L - 0.6]) { const [x, , z] = Fw.at(s, 0, -3.7); lmLathe(G, x, z, 0, [[0.09, 0], [0.09, 4.0]], 8, hb('#8b9095')); }
  const [x, , z] = Fw.at(L / 2, 0, 0.8); box(G, x, z, Fw.tx, Fw.tz, 1.6, 0.25, T + 1.6, T + 2.6, hb('#2a2b2d'));
  const c = lmWF([x - Fw.tx * 1.4, z - Fw.tz * 1.4], [x + Fw.tx * 1.4, z + Fw.tz * 1.4]);
  K.clk.q(c.at(0, T + 1.7, -0.26), c.at(2.8, T + 1.7, -0.26), c.at(2.8, T + 2.5, -0.26), c.at(0, T + 2.5, -0.26), N_(c), [1, 0, 0, 0, 0, 1, 1, 1], LMWHITE, 1);
}

/* ---- the car parks of the stores: the surface car parks of OSM within 90 m of them (the city data has none):
   asphalt, rows of stalls 2.6 × 5 m along the longer side of each with 6 m aisles between them, white lines, cars in
   about half of the stalls. */
const PARKS = [
  [[397.8, -1274], [407, -1274.7], [407.2, -1272.8], [412.5, -1273.3], [407.1, -1316.7], [398.7, -1303.5], [400.8, -1288.3], [396, -1287.6]],   // w838999586 428 m², Beta 31 Šaurā iela
  [[359.4, -1308.4], [361, -1300], [396.2, -1307.7], [402.7, -1319.8]],   // w838999587 378 m², Beta 31 Šaurā iela
  [[329.2, -1367.9], [335, -1344.5], [331.1, -1338.2], [323.9, -1366.6]],   // w1456236676 143 m², Beta 31 Šaurā iela
  [[-3, 558], [-5.2, 529.4], [-10.1, 529.8], [-7.9, 558.4]],   // w996857198 140 m², Beta 67 Ventspils iela
  [[-6.1, 523.9], [-7.7, 501.4], [-12.5, 498.5], [-10.7, 524.2]],   // w996857199 111 m², Beta 67 Ventspils iela
  [[-17.5, 522.4], [-37, 523.8], [-37.4, 518.7], [-17.9, 517.3]],   // w996857202 100 m², Beta 67 Ventspils iela
  [[1336.1, -1229.9], [1316.3, -1205.3], [1314, -1202.4], [1331.8, -1188.4], [1337.5, -1203.7], [1336.7, -1206.5], [1345.1, -1223]],   // w367307961 579 m², Beta 1 Inženieru iela
  [[738.8, 553.7], [760.3, 573.9], [763.3, 570.9], [764.6, 571.2], [772.1, 578.2], [769, 581.7], [781.2, 593.3], [792.2, 581.7], [778.3, 568.8], [779.7, 567.3], [783.1, 570.5], [805.3, 547.1], [801.9, 543.7], [803.7, 541.8], [807.1, 545.1], [829.6, 521.3], [826.2, 517.9], [827.7, 516.6], [832.4, 521], [867.9, 483.6], [863.6, 479.1], [851.5, 491.8], [842.9, 483.8], [812.5, 515.3], [820.1, 522.9], [800.6, 542.9], [773.4, 517], [769.9, 520.8], [768.7, 521.1], [764.5, 517.1], [738.5, 544.6], [742.3, 548.2], [742.6, 549.7]],   // w1024849312 3641 m², Lidl 146 18. novembra iela
  [[-1806.2, 461.7], [-1810.2, 457.1], [-1842.2, 477.6], [-1858.5, 453.8], [-1855.8, 451.4], [-1853, 449.4], [-1878, 411.1], [-1901.5, 426.9], [-1909.3, 431.8], [-1884.3, 469.3], [-1876.1, 464.1], [-1874.9, 465.3], [-1867.9, 470.2], [-1869.3, 476.7], [-1871.8, 485.6], [-1824.9, 506], [-1795.2, 485.5], [-1798.8, 477.2], [-1796.1, 476]],   // w1429727516 3998 m², Lidl 74 Cietokšņa iela
  [[-543.1, -1797.3], [-530.2, -1804.8], [-520.1, -1824.1], [-520.3, -1834.1], [-520.4, -1840.3]],   // w409293294 277 m², Maxima X 29 Piekrastes iela
  [[858, -751], [865.5, -743.2], [857.1, -735.2], [849.6, -743]],   // w366852836 126 m², Maxima X 98A Smilšu iela
  [[805, -776], [812, -783.1], [814, -786.6], [823.5, -784], [825.3, -782.4], [805.7, -761.6], [804.3, -763.2]],   // w366852842 238 m², Maxima X 98A Smilšu iela
  [[-868.1, -2462.6], [-852.9, -2460.2], [-854.6, -2449.4], [-869.8, -2451.9]],   // w1149765892 168 m², Maxima X 35B Aveņu iela
  [[1227.1, 204.4], [1251.8, 190.4], [1244.8, 178], [1223.8, 189.9], [1224.8, 191.7], [1221.1, 193.8]],   // w804694053 393 m², Maxima X 103 Strādnieku iela
  [[1184.1, 207.8], [1159.7, 236.7], [1171.2, 246.4], [1172.7, 244.7], [1178.5, 249.6], [1196, 228.9], [1200, 232.3], [1208.5, 222.2], [1200, 215.1], [1193.2, 215.6]],   // w942917921 950 m², Maxima X 103 Strādnieku iela
  [[1255.1, -984.8], [1263.8, -1000], [1260.6, -1001.9], [1260.4, -1003], [1261.1, -1004.1], [1265.5, -1011.5], [1266.1, -1012.5], [1267, -1012.4], [1270.3, -1010.3], [1274.4, -1016.8], [1270.5, -1019.3], [1270.3, -1020.4], [1271.6, -1022.9], [1272.7, -1022.9], [1276.6, -1020.7], [1281.6, -1029], [1276.9, -1032.2], [1279.7, -1035.4], [1271.5, -1044.2], [1268.5, -1040.4], [1267.3, -1040.2], [1265.1, -1041.7], [1265.1, -1043], [1267.4, -1046.7], [1252.4, -1055.8], [1250.2, -1052.4], [1245.6, -1045.1], [1243.5, -1041.8], [1258.7, -1032.5], [1261, -1036.1], [1264.7, -1033.9], [1266, -1032.4], [1266.7, -1031], [1266.9, -1029.3], [1266.6, -1027.2], [1263.9, -1023.1], [1259.8, -1025.7], [1239.7, -994.2]],   // w367307968 1167 m², Maxima X 3 Arhitektu iela
  [[-1668.1, 992.2], [-1692.3, 1002.7], [-1689.4, 1009.4], [-1665.2, 998.9]],   // w944742868 192 m², Maxima X 5 Kandavas iela
  [[-1228, 802.5], [-1199.3, 784.5], [-1207.4, 771.6], [-1235.4, 789.8]],   // w161665538 505 m², Maxima XX 60 Cietokšņa iela
  [[1270, 314.6], [1279.2, 322.4], [1294.8, 304], [1286.3, 296.7]],   // w1088936066 282 m², Mego 1A Valkas iela
  [[-820.4, -2121.4], [-840.2, -2078.1], [-831.2, -2073.3], [-819.8, -2096.4], [-811.1, -2117.1]],   // w409127397 506 m², Mego 26 Aveņu iela
  [[-787.9, -2050.2], [-778.1, -2044], [-794.5, -2020], [-819.2, -2036.6], [-816.7, -2040.7], [-798.8, -2039.5], [-792.1, -2050.3], [-789.2, -2048.4]],   // w409127401 560 m², Mego 26 Aveņu iela
  [[-758.8, -2124], [-752.3, -2133.4], [-762, -2140.1], [-768.5, -2130.7], [-765.2, -2128.4]],   // w814250730 134 m², Mego 26 Aveņu iela
  [[-2055.8, -474.8], [-2047, -488.4], [-2051.9, -491.6], [-2050.2, -494.2], [-2045.4, -491], [-2040.2, -499.1], [-2049.3, -505], [-2065.1, -480.8]],   // w1165041242 300 m², Mego 27A Vaļņu iela
  [[-1327.6, 1188.6], [-1328.7, 1186.8], [-1404.3, 1232], [-1403, 1234.1]],   // w836844874 200 m², Mego 9 Rīgas iela
  [[-1329.9, 1166.9], [-1365.4, 1109.1], [-1380.7, 1118.1], [-1377.1, 1124.2], [-1375.1, 1124], [-1373.4, 1125], [-1371.6, 1124.1], [-1369.9, 1124.3], [-1369, 1125.7], [-1370.7, 1130], [-1350.9, 1162.2], [-1347.6, 1160.2], [-1338.6, 1174.8], [-1342, 1176.8], [-1339.1, 1181.6], [-1336.3, 1182.1], [-1330.3, 1177.9], [-1334.6, 1171.7], [-1334.4, 1170]],   // w974761926 1073 m², Mego 9 Rīgas iela
  [[-1449, 1193.2], [-1443.1, 1189.7], [-1451.4, 1175.8], [-1457.3, 1179.3]],   // w974761928 111 m², Mego 9 Rīgas iela
  [[-858, -2015.5], [-903.3, -1947.6], [-914.7, -1956.1], [-875.8, -2011.9], [-872.4, -2015.2], [-859.9, -2032.1], [-855.8, -2035.5], [-850.7, -2036.5], [-844.2, -2034.8], [-809.7, -2011.9], [-822.7, -1992.1]],   // w38689291 2305 m², Mego 11A Raipoles iela
  [[-1721, 541.3], [-1711, 556.8], [-1679.6, 570.1], [-1669.6, 569.7], [-1690, 537.3], [-1696.4, 531.7], [-1700.8, 529.5], [-1704.8, 528.4]],   // w39498653 1053 m², Rimi Hyper 72A Cietokšņa iela
  [[-1610.9, 403.6], [-1638.1, 421.6], [-1620.6, 448], [-1644.9, 464.5], [-1658.7, 444.5], [-1667.7, 450.5], [-1628.3, 509.1], [-1627, 511.1], [-1623.1, 508.5], [-1617.3, 504.6], [-1609.5, 499.3], [-1604.2, 495.6], [-1605.4, 493.7], [-1597.1, 488.3], [-1597.4, 466.6], [-1609.1, 448.8], [-1602.8, 445], [-1597.8, 441.8], [-1597.7, 431.3], [-1601.6, 425.5], [-1597.3, 422.9], [-1609.5, 405.6]],   // w161652192 3641 m², Rimi Hyper 72A Cietokšņa iela
  [[707.4, 587.1], [701.8, 582], [709.3, 573.7], [714.6, 573.6], [714.6, 567.7], [716.3, 565.7], [745.6, 593.3], [727.2, 613.3], [703.5, 591.7]],   // w127382479 1038 m², Rimi Super 136 18. novembra iela
  [[643.5, 649.1], [654.9, 637.1], [676.4, 657.6], [665, 669.5]],   // w129150740 488 m², Rimi Super 136 18. novembra iela
  [[692.7, 668], [722, 636.8], [717.4, 632.5], [688.1, 663.7]],   // w998468900 269 m², Rimi Super 136 18. novembra iela
  [[-1326.1, 1063.8], [-1327, 1062.4], [-1330.6, 1064.9], [-1335.4, 1057.7], [-1305.5, 1038.5], [-1304, 1030.7], [-1300.6, 1028.4], [-1300.4, 1026.3], [-1297.7, 1024.6], [-1297.3, 1020.7], [-1273.8, 1001.6], [-1271.7, 1002.9], [-1268.6, 1003.7], [-1266.2, 1003.6], [-1261.2, 1011.1], [-1319.8, 1059.8]],   // w692805483 1050 m², Rimi 60 Cietokšņa iela
  [[-940.1, 1280.3], [-932.8, 1272.9], [-924.3, 1275], [-915.1, 1294.1], [-920.8, 1310.4]],   // w75683776 458 m², mini Rimi 10 Viestura iela
  [[-982, 1300.7], [-991.6, 1313.8], [-979.5, 1334.8], [-968.8, 1322]],   // w1240479437 378 m², mini Rimi 10 Viestura iela
];
function carParks(K) {
  const ag = new GB(false), lines = new GB(false), ASP = hb('#5c5d5e'), WHT = hb('#d9d9d5'), COLS = ['#e8e8e6', '#1d1f22', '#8d9196', '#5b6067', '#7a1f22', '#1f3f6e', '#c9c6bd', '#2f4a35', '#b8bcc0', '#3a3d42'];
  let seed = 4242; const rr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  STATE.GBC = null;
  for (const pts of PARKS) {
    let r = new Float32Array(pts.flat()); if (area2(r) < 0) r = reversed(r);
    const t0 = triangulate([r]), { flat: fl, tris } = TERR.on ? subTris(t0.flat, t0.tris, 0.25) : t0, v0 = ag.v; ag.ensure(fl.length / 2);
    for (let i = 0; i < fl.length; i += 2) ag.vert(fl[i], 0, fl[i + 1], 0, 1, 0, ASP); for (let i = 0; i < tris.length; i += 3) ag.triUp(v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2]);
    const o = obb(r); if (!o || o.b < 2.6) continue;
    const at = (u, v) => [o.cx + o.ux * u - o.uz * v, o.cz + o.uz * u + o.ux * v];
    const ok = (u, v) => { for (const [du, dv] of [[-1.25, -2.4], [1.25, -2.4], [1.25, 2.4], [-1.25, 2.4]]) { const [x, z] = at(u + du, v + dv); if (!pip(x, z, r)) return false; } const [x, z] = at(u, v); if (onRoad(x, z, 0.5)) return false; for (const [du, dv] of [[0, 0], [0, -3.6], [0, 3.6], [-2.4, 0], [2.4, 0]]) { const [x2, z2] = at(u + du, v + dv); if (inBuilding(x2, z2)) return false; } return true; };   // no stall within a few metres of a building (canopies, doors)
    // the rows: one along an edge, an aisle, two back to back, an aisle, ...
    const rows = []; let v = -o.b + 2.5, back = false; while (v <= o.b - 2.5) { rows.push(v); v += back ? 5 : 11; back = !back; }
    for (const rv of rows) {
      const n = Math.floor((2 * o.a - 1) / 2.6), u0 = -n * 1.3;
      for (let k = 0; k < n; k++) {
        const u = u0 + (k + 0.5) * 2.6; if (!ok(u, rv)) continue;
        for (const ue of [u - 1.3, u + 1.3]) { const A = at(ue, rv - 2.5), B = at(ue, rv + 2.5), nx = o.ux * 0.06, nz = o.uz * 0.06;
          const q = [[A[0] - nx, A[1] - nz], [B[0] - nx, B[1] - nz], [B[0] + nx, B[1] + nz], [A[0] + nx, A[1] + nz]].map(([x, z]) => lines.vert(x, 0, z, 0, 1, 0, WHT)); lines.triUp(q[0], q[1], q[2]); lines.triUp(q[0], q[2], q[3]); }
        if (rr() < 0.55) { const [x, z] = at(u, rv), sg = rr() < 0.5 ? 1 : -1; fortCar(K.plain, x, z, -o.uz * sg, o.ux * sg, hb(COLS[Math.floor(rr() * COLS.length)]), false); }
      }
    }
  }
  for (const [b, mat, order] of [[ag, M_ASPH, -34.4], [lines, M_PAVE, -33.9]]) { const m = b.mesh(mat); if (m) { m.renderOrder = order; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } }
}

/* Draws the stores: their own buildings, the tenants' fronts and boards, the two shopping centres. */
function lmShops(K, litPatch) {
  const [dc, dorm, dglow] = shAtlas();
  LMM.shDet = lmStd({ vertexColors: true, map: dc, alphaTest: 0.5, roughnessMap: dorm, metalnessMap: dorm, roughness: 1, metalness: 1, emissive: new THREE.Color(1, 1, 1), emissiveMap: dglow, emissiveIntensity: 0 }, 'lm-sh-det', litPatch);
  KS.det = new LMB();
  for (const S of SHOPS) {
    if (S.k === 'box') { const p = SH.own.get(S.id); if (!p) console.warn('shops: no building for', S.n, S.a); else if (S.style === 'betaGlass') betaGlass(K, S, p); else storeBox(K, S, p.outer, p.H, p.gbc); }
    else if (S.k === 'osm') {
      let r = new Float32Array(S.o.flat()); if (area2(r) < 0) r = reversed(r);
      lmRegisterOutline([0, 0, 1, 0], S.o, 4);
      let lo = 1e9, hi = -1e9; if (TERR.on) for (const [x, z] of S.o) { const t = terrainH(x, z); lo = Math.min(lo, t); hi = Math.max(hi, t); }
      const base = Math.min(hi - 0.15, lo + 2.5), gbc = TERR.on ? (x, y, z) => { const t = terrainH(x, z); return y <= 0.05 ? Math.min(base, t) - 0.25 - t - y : base - t; } : null, H = H_OF(S);
      STATE.GBC = gbc; flatPlain(K.plain, [r], H - 0.45, hb('#8d9194'), false);
      storeBox(K, S, r, H, gbc);
    } else if (S.k === 'in') tenant(K, S, SH.host.get(S.id));
  }
  ditton(K); solo(K); carParks(K);
  STATE.GBC = null;
  KS.det.mesh(LMM.shDet); KS.det = null;
}

export { SHOP_TREES, SHV, lmShops, shopClaim };
