import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { LMB, LMWHITE } from './core.js';
import { lmBar, lmBoxW, lmLathe, lmWF, lmWall } from './helpers.js';
import { LMM, lmStd } from './index.js';
import { lmRegisterOutline } from './tv-tower.js';
import { lmBench } from './heat-plant.js';
import { band, flatPlain, flatRoof, roofFace, tileOf } from '../buildings/walls.js';
import { ROOFPAL } from '../world/palette.js';
import { BLD, ROAD, inBuilding, onRoad } from '../world/data.js';
import { box, polyA } from '../core/geometry.js';
import { area2, bbox, edgeN, hb, insetOk, obb, offsetRing, pick, pip, reversed, rnd } from '../core/util.js';
import { TERR, terrainH } from '../world/terrain.js';
import { mkCanvas, toTex } from '../render/textures.js';

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
  { id: 'n1314059910', b: 'maxima', n: 'Maxima XX', a: 'Cietokšņa iela 60', k: 'box', style: 'maximaXX', p: [-1183.7, 844.8], e: [-1224.4, 804.6], pk: [-1151.2, 829.1] },
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
  // OSM shop point plus its separately mapped main door at the east end of the former PROMO trade centre.
  { id: 'n9987023862', b: 'jysk', n: 'JYSK', a: 'Stadiona iela 3G', k: 'in', model: 'jyskCentre', p: [-1401.46, 530.05], e: [-1388.02, 550.94] },
];
// the walls of each chain: height to the top of the parapet, panels (wall texture 5) or render (1), bands [y from the top, height, colour]
const STY = {
  lidl: { h: 7.2, tex: 5, wall: '#dde0e3', plinth: '#62676b', glaze: 'all', gTop: 4.2, canopy: 4.2, pylon: 'lidl' },
  rimi: { h: 6.2, tex: 5, wall: '#eef0f0', plinth: '#73777b', glaze: 0.5, gTop: 3.4, bands: [[1.5, 0.9, '#d8202c']], canopy: 1.6, pylon: 'rimi' },
  // Maxima XX on Cietokšņa iela 60 (Mapillary photographs, 2020–25): buff brick walls under a dark brown fascia, a deep dark blue canopy over the corner entrance,
  // the name in blue letters with a red X straight on the brown, and the white squares with the red X of the format
  maximaXX: { h: 6.6, tex: 6, wall: '#ffffff', plinth: '#6e6a62', glaze: 0.55, gTop: 3.7, bands: [[0, 2.3, '#4a3b36']], canopy: 0, pylon: 'maxima' },
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
const SH = { own: new Map(), host: new Map(), custom: new Map(), mall: { ditton: [] } };
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
const JYSK_H = 9.6;   // Stadiona 3G hall: roof drawn at claim time (the tile is meshed before landmarks), walls by jyskCentre
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
    if (S.k === 'in') { SH.host.set(S.id, part);
      if (S.model === 'jyskCentre') { SH.custom.set(S.id, part);
        const T = tileOf((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2), seed = Math.floor(rnd(id, 9) * 255);
        flatRoof(T.m.roof, rings, JYSK_H - 0.28, hb('#747a7d'), 5, seed); return true; }
      return false; }
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
    // Maxima XX on the brown fascia: blue letters in white outlines, the X of the name red; a white square with the red X (the format sign)
    ['xxName', 6.4, 1.4, () => {
      let sz = 1.4 * PX * 1.2; const f = () => `900 ${sz}px Arial, "Golos Text", sans-serif`, parts = [['MA', '#1e3f9a', '#3a66d8'], ['X', '#d8202c', '#ff3a3a'], ['IMA', '#1e3f9a', '#3a66d8']];
      g.font = f(); const W = parts.reduce((a, q) => a + g.measureText(q[0]).width, 0); if (W > 6.2 * PX) { sz *= 6.2 * PX / W; g.font = f(); }
      let x0 = X + (6.4 * PX - parts.reduce((a, q) => a + g.measureText(q[0]).width, 0)) / 2; const yb = Y + 1.3 * PX;
      for (const [t, col, glow] of parts) { const w = g.measureText(t).width;
        for (const [c, s2] of [[g, col], [e, glow], [o, ORM.gloss]]) { c.font = f(); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; if (c === g) { c.lineWidth = sz * 0.07; c.strokeStyle = '#ffffff'; c.lineJoin = 'round'; c.strokeText(t, x0, yb); } c.fillStyle = s2; c.fillText(t, x0, yb); }
        x0 += w; } }],
    ['xxSq', 1.4, 1.4, () => { R(0, 0, 1.4, 1.4, '#ffffff', 'gloss', '#ffffff'); text('X', 0.08, 0.05, 1.24, 1.3, '#d8202c', { wt: 900, glow: '#ff3a3a' }); }],
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
    ['dittonGallery', 5.4, 1.0, () => { R(0, 0, 5.4, 1.0, '#eceeed'); text('GALERIJA', 0.12, 0.05, 5.16, 0.9, '#303a40', { wt: 900, glow: '#303a40' }); }],
    ['dittonGallery2', 7.2, 1.0, () => { R(0, 0, 7.2, 1.0, '#eceeed'); text('GALERIJA · 2. STĀVS', 0.12, 0.05, 6.96, 0.9, '#303a40', { wt: 800, glow: '#303a40' }); }],
    ['dittonPassaza', 5.2, 1.0, () => { R(0, 0, 5.2, 1.0, '#eceeed'); text('PASĀŽA', 0.12, 0.05, 4.96, 0.9, '#303a40', { wt: 900, glow: '#303a40' }); }],
    ['dittonHanza', 4.8, 1.0, () => { R(0, 0, 4.8, 1.0, '#eceeed'); text('HANZA', 0.12, 0.05, 4.56, 0.9, '#303a40', { wt: 900, glow: '#303a40' }); }],
    ['dittonMarket', 6.4, 1.0, () => { R(0, 0, 6.4, 1.0, '#eceeed'); text('ZAĻAIS TIRGUS', 0.12, 0.05, 6.16, 0.9, '#303a40', { wt: 900, glow: '#303a40' }); }],
    ['jysk', 4.8, 1.6, () => { R(0, 0, 4.8, 1.6, '#174b91', 'gloss', '#3475cf'); text('JYSK', 0.18, 0.1, 4.44, 1.38, '#ffffff', { wt: 900, glow: '#ffffff' }); }],
    ['jyskSquare', 2.3, 2.3, () => { R(0, 0, 2.3, 2.3, '#174b91', 'gloss', '#3475cf'); text('JYSK', 0.12, 0.38, 2.06, 1.48, '#ffffff', { wt: 900, glow: '#ffffff' }); }],
    ['promo', 6.2, 2.1, () => { R(0, 0, 6.2, 2.1, '#f1f0eb'); text('PROMO', 0.12, 0.05, 5.96, 1.28, '#e3232c', { wt: 900, glow: '#ff4548' }); text('Cash&Carry', 0.2, 1.35, 5.8, 0.62, '#174b91', { wt: 800, glow: '#3475cf' }); }],
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
  const st = STY[S.style || S.b], G = K.plain, n = r.length >> 1, fi = frontEdge(r, S), wall = { tex: st.tex, col: hb(st.wall), plinth: 0.45, pcol: hb(st.plinth) };
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
    if (S.style === 'maximaXX') {   // the name and the two squares on the brown fascia over the canopy
      const yb = Math.min(H - 1.75, st.gTop + 1.0), t = CT.xxName, w = 1.4 * t.w / t.h, sx = Math.max(w / 2 + 6.7, Math.min(L - w / 2 - 1.5, sc + 3));   // seen from outside s runs right to left: the squares at the smaller s stand right of the name
      flat(Fw, sx - w / 2, sx + w / 2, yb, yb + 1.4, -0.1, t);
      for (const q of [0, 1.6]) flat(Fw, sx - w / 2 - 0.5 - 1.4 - q, sx - w / 2 - 0.5 - q, yb, yb + 1.4, -0.1, CT.xxSq);
    } else {
    lmBoxW(G, Fw, sc - gw / 2 - 0.3, sc + gw / 2 + 0.3, st.gTop + 0.05, st.gTop + 0.35, -st.canopy, 0, hb(S.b === 'mego' ? '#2e3033' : '#d6d9db'));
    const name = signOf(S), t = CT[name], yb = st.gTop + (S.b === 'maxima' && /XX/.test(S.n) ? 0.8 : 0.55), room = H - 0.3 - yb, h = Math.max(0.9, Math.min(t.h, room, (gw + 1) * t.h / t.w));
    board(K, Fw, name, sc, yb, h, 0.12, S.b === 'beta' ? '#c9252c' : null);
    }
  }
  // machines on the roof
  const [cx, cz] = inner(r); STATE.GBC = gbc;
  if (!st.pitched) for (const [a, b] of [[0, 0], [3.5, 1.5], [-3, -2]]) { const x = cx + Fw.tx * a - Fw.nx * b, z = cz + Fw.tz * a - Fw.nz * b; if (pip(x, z, r)) box(G, x, z, Fw.tx, Fw.tz, 1.1, 0.7, H - 0.45, H + 0.85, hb('#a7abae')); }
  if (S.slat) slatBlock(K, S);
  if (S.b === 'maxima' && /XX/.test(S.n)) maximaXX(K, S, r, H, front, gbc);
  if (st.pylon && (S.b !== 'maxima' || /XX/.test(S.n)) && (S.b !== 'rimi' || /Hyper|Super/.test(S.n) || L > 30)) pylon(K, S, r, fi, signOf(S), gbc);
}
/* Maxima XX on Cietokšņa iela 60, the big store next to Ditton nams: over the plain walls of storeBox a glazed
   vestibule of the entrance (two pairs of sliding doors, a white roof slab with a blue fascia), a shelter with the
   shopping trolleys, bollards along the glazing, a bin and a bike rack; 
   steel service doors, lamps and downpipes on the other walls; on the roof rooftop units, condensers, vent stacks, hatches and rows of skylights. */
function maximaXX(K, S, r, H, front, gbc) {
  if (!front) return;
  const G = K.plain, { Fw, L, sc, gw, i: fi } = front, n = r.length >> 1, GR = hb('#a7abae'), DG = hb('#6c7074');
  let sd = 4177; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const freeAt = (F, s, d) => { const [x, , z] = F.at(s, 0, d); STATE.GBC = levelAt(x, z); return [x, z]; };
  // the vestibule over the middle of the glazing: a glass front in four modules with the doors in the two middle ones, solid white sides, a roof slab with a blue fascia
  const vw = Math.min(10, gw - 2), dp = 2.8, vh = 3.55, v0 = sc - vw / 2, v1 = sc + vw / 2, m = 4, mw = vw / m, NB = hb('#233a73'), cw = Math.min(L - 0.5, vw + 8), c0 = Math.max(-0.3, sc - cw / 2), c1 = Math.min(L + 0.3, sc + cw / 2), cd = 3.6, cy = 3.75;
  for (let k = 0; k < m; k++) flat(Fw, v0 + k * mw, v0 + (k + 1) * mw, 0.1, vh, -dp, k === 1 || k === 2 ? CT.door : CT.glass);
  for (const s of [v0, v1 - 0.25]) lmBoxW(G, Fw, s, s + 0.25, 0, vh, -dp - 0.05, -0.05, hb('#3a3f45'));
  for (let k = 1; k < m; k++) lmBoxW(G, Fw, v0 + k * mw - 0.05, v0 + k * mw + 0.05, 0, vh, -dp - 0.07, -dp, hb('#2d3135'), false);
  // the deep canopy over the entrance: a dark blue fascia, lights in its underside, louvres on the top of its outer end
  lmBoxW(G, Fw, c0, c1, cy, cy + 0.65, -cd, 0, NB);
  for (let s = c0 + 0.8; s < c1 - 0.5; s += 1.6) lmBoxW(G, Fw, s - 0.12, s + 0.12, cy - 0.03, cy, -cd + 0.5, -cd + 0.74, hb('#fff6e0'));
  for (let d = 0.2; d < cd - 0.3; d += 0.34) lmBoxW(G, Fw, c1 - 3.4, c1, cy + 0.65, cy + 0.75, -d - 0.14, -d, hb('#1b2d5e'), false);
  for (const q of [-2.2, 2.2]) { const [x, z] = freeAt(Fw, sc + q, -cd - 0.5); box(G, x, z, Fw.tx, Fw.tz, 0.12, 0.12, 0, 0.9, hb('#e0b020')); }
  // the shelter for the trolleys on the plain wall beside the glazing (the side with more room), the trolleys nested in a row; a bin and a rack for bikes by the vestibule
  { const room1 = L - (sc + gw / 2) - 1.5, room0 = sc - gw / 2 - 1.5, up = room1 >= room0, w = Math.min(7.5, Math.max(room0, room1)), a = up ? sc + gw / 2 + 0.7 : sc - gw / 2 - 0.7 - w, b = a + w;
    if (w > 3.5) {
      for (const [s, d] of [[a, -0.5], [b, -0.5], [a, -2.6], [b, -2.6]]) { const [x, z] = freeAt(Fw, s, d); lmLathe(G, x, z, 0, [[0.05, 0], [0.05, 1.85]], 6, GR); }
      STATE.GBC = gbc;
      lmBoxW(G, Fw, a - 0.15, b + 0.15, 1.85, 1.95, -2.75, -0.35, hb('#c6d4da'));
      lmBoxW(G, Fw, a - 0.15, b + 0.15, 1.95, 2.02, -2.75, -0.35, DG);
      for (let s = a + 0.4; s < b - 0.4; s += 0.62) { const [x, z] = freeAt(Fw, s, -1.6); box(G, x, z, Fw.tx, Fw.tz, 0.27, 0.48, 0.18, 0.88, GR); box(G, x, z, Fw.tx, Fw.tz, 0.27, 0.05, 0.88, 0.98, hb('#d8202c')); }
    } }
  { const [x, z] = freeAt(Fw, v0 - 3, -dp - 0.8); box(G, x, z, Fw.tx, Fw.tz, 0.3, 0.3, 0, 0.9, hb('#3a3d40'));
    for (const q of [-1.2, 0, 1.2]) { const [bx, bz] = freeAt(Fw, v0 - 6 + q, -dp - 0.3); lmBar(G, [bx, 0, bz], [bx, 0.85, bz], 0.05, GR); }
    lmBar(G, Fw.at(v0 - 7.2, 0.85, -dp - 0.3), Fw.at(v0 - 4.8, 0.85, -dp - 0.3), 0.05, GR); }
  // bollards along the glazing on both sides of the vestibule
  for (let s = sc - gw / 2; s <= sc + gw / 2; s += 3) { if (Math.abs(s - sc) < vw / 2 + 2.5) continue; const [x, z] = freeAt(Fw, s, -4.6); lmLathe(G, x, z, 0, [[0.09, 0], [0.09, 0.85], [0.07, 0.9]], 8, hb('#8b9095')); }
  STATE.GBC = gbc;
  // steel service doors, lamps and downpipes on the other walls
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, P = [r[2 * i], r[2 * i + 1]], Q = [r[2 * j], r[2 * j + 1]], F2 = lmWF(P, Q), L2 = F2.L; if (L2 < 8) continue;
    if (i !== fi && L2 > 12) {
      const s1 = 3 + rr() * (L2 - 8);
      lmBoxW(G, F2, s1, s1 + 1.1, 0, 2.15, -0.1, 0, hb('#7b8186')); lmBoxW(G, F2, s1 - 0.3, s1 + 1.4, 2.3, 2.45, -0.9, 0, hb('#9aa0a4')); lmBoxW(G, F2, s1 + 0.3, s1 + 0.7, 2.6, 2.75, -0.25, 0, hb('#fff1c8'));
      for (const s of [0.9, L2 - 0.9]) lmBar(G, F2.at(s, 0.1, -0.12), F2.at(s, H - 0.5, -0.12), 0.1, hb('#9ca1a5'));
    }
  }
  // the name again on a steel frame over the roof edge above the entrance (seen over the roofs in the photographs)
  { const t = CT.xxName, w = 5.4, hh = w * t.h / t.w, sn = Math.max(w / 2 + 1, Math.min(L - w / 2 - 1, sc)), yb = H + 0.5;
    for (const q of [sn - w * 0.35, sn + w * 0.35]) lmBar(G, Fw.at(q, H - 0.3, 0.5), Fw.at(q, yb + hh * 0.5, 0.5), 0.1, hb('#4a4f53'));
    lmBoxW(G, Fw, sn - w / 2 - 0.1, sn + w / 2 + 0.1, yb - 0.08, yb + hh + 0.08, 0.3, 0.55, hb('#4a3b36'));
    flat(Fw, sn - w / 2, sn + w / 2, yb, yb + hh, 0.28, t); }
  // the secondary entrance (OSM entrance=secondary) at the south end: glazed doors in the nearest wall under a small blue canopy
  { const q = [-1187.1, 897.4]; let bi = -1, bd = 1e9;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * j], bz = r[2 * j + 1], l = Math.hypot(bx - ax, bz - az); if (l < 3) continue;
      const t = Math.max(0, Math.min(1, ((q[0] - ax) * (bx - ax) + (q[1] - az) * (bz - az)) / (l * l))), d = Math.hypot(q[0] - ax - (bx - ax) * t, q[1] - az - (bz - az) * t); if (d < bd) { bd = d; bi = i; } }
    if (bi >= 0 && bd < 8 && bi !== fi) { const F2 = edgeF(r, bi), s0 = Math.max(1.6, Math.min(F2.L - 1.6, along(r, bi, q)));
      lmBoxW(G, F2, s0 - 1.6, s0 + 1.6, 0, 3.0, -0.12, 0, hb('#2d3135')); flat(F2, s0 - 1.4, s0 + 1.4, 0.1, 2.9, -0.14, CT.door);
      lmBoxW(G, F2, s0 - 2.0, s0 + 2.0, 3.1, 3.4, -1.8, 0, hb('#233a73')); const [x, z] = freeAt(F2, s0 + 2.4, -1.2); box(G, x, z, F2.tx, F2.tz, 0.3, 0.3, 0, 0.9, hb('#3a3d40')); STATE.GBC = gbc; } }
  // the roof: units on a grid at least 2–4 m inside the walls, of four kinds, and rows of skylights
  const yR = H - 0.45, [cx, cz] = inner(r); let inn = null;
  for (const d of [4, 3, 2]) { const q = offsetRing(r, -d); if (insetOk(r, q)) { inn = q; break; } }
  const okp = (x, z) => pip(x, z, r) && (!inn || pip(x, z, inn)), PL = (u, v) => [cx + Fw.tx * u - Fw.nx * v, cz + Fw.tz * u - Fw.nz * v];
  for (let u = -66; u <= 66; u += 12) for (let v = -44; v <= 44; v += 11) {
    const [x0, z0] = PL(u + (rr() - 0.5) * 3, v + (rr() - 0.5) * 3), k = rr(); if (!okp(x0, z0)) continue;
    if (k < 0.3) {
      const w = 2.1 + rr() * 0.4, l = 4 + rr() * 1.5; if (![[1, 1], [-1, 1], [1, -1], [-1, -1]].every(([a, b]) => okp(...PL(u + a * l / 2, v + b * w / 2)))) continue;
      box(G, x0, z0, Fw.tx, Fw.tz, l / 2, w / 2, yR, yR + 1.7, hb('#bfc3c6')); box(G, x0, z0, Fw.tx, Fw.tz, l / 2 + 0.05, w / 2 + 0.05, yR + 1.7, yR + 1.78, DG);
      const [lx, lz] = PL(u, v + w / 2 + 0.01); box(G, lx, lz, Fw.tx, Fw.tz, l * 0.35, 0.03, yR + 0.3, yR + 1.2, hb('#4a4f53'));
    } else if (k < 0.55) {
      box(G, x0, z0, Fw.tx, Fw.tz, 2.1, 1.1, yR, yR + 0.25, DG);
      for (const q of [-1.1, 1.1]) { const [fx, fz] = PL(u + q, v); lmLathe(G, fx, fz, yR + 0.25, [[0.95, 0], [0.95, 0.8], [0.04, 0.9]], 14, hb('#aeb2b5')); }
    } else if (k < 0.75) lmLathe(G, x0, z0, yR, [[0.3, 0], [0.3, 2.2], [0.55, 2.2], [0.55, 2.28], [0.02, 2.5]], 10, hb('#9ca1a5'));
    else if (k < 0.9) { box(G, x0, z0, Fw.tx, Fw.tz, 0.55, 0.55, yR, yR + 0.45, hb('#a7abae')); box(G, x0, z0, Fw.tx, Fw.tz, 0.48, 0.48, yR + 0.45, yR + 0.55, hb('#7c8184')); }
  }
  for (const v of [-18, 4, 26]) for (let u = -60; u <= 60; u += 3.2) {
    if (rr() < 0.15) continue; const [x, z] = PL(u, v); if (!okp(x, z) || !okp(...PL(u + 1.2, v + 1.2)) || !okp(...PL(u - 1.2, v - 1.2))) continue;
    box(G, x, z, Fw.tx, Fw.tz, 0.9, 0.9, yR, yR + 0.3, hb('#d5d9db')); box(G, x, z, Fw.tx, Fw.tz, 0.7, 0.7, yR + 0.3, yR + 0.45, hb('#bcd3dc'));
  }
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

/* Stadiona 3G is a one-storey corrugated-metal retail hall shared by JYSK and PROMO. The mapped JYSK door is on
   the Stadiona-side end wall; PROMO's sliding door is on the long south frontage. Replace the generic two-storey
   cadastre facade with the photographed cladding, the two real door positions, the JYSK corner sign and PROMO's
   raised sign frame from the 2022 facade drawings. */
function jyskCentre(K, S, part) {
  if (!part) return;
  const r = part.outer, n = r.length >> 1, H = JYSK_H, G = K.plain, J = { i: frontEdge(r, S) };
  J.Fw = edgeF(r, J.i); J.s = Math.max(3, Math.min(J.Fw.L - 3, along(r, J.i, S.e)));
  const P = { p: [-1442.4, 530.7], e: [-1417.17, 555.08] }, M = { i: frontEdge(r, P) };
  M.Fw = edgeF(r, M.i); M.s = Math.max(4, Math.min(M.Fw.L - 4, along(r, M.i, P.e)));
  let glassI = -1, glassL = 0;
  for (let i = 0; i < n; i++) { const L = edgeF(r, i).L; if (i !== J.i && i !== M.i && L > glassL) { glassI = i; glassL = L; } }
  const openings = new Map(), door = (i, s, width) => {
    let list = openings.get(i); if (!list) openings.set(i, list = []);
    const s0 = Math.max(0.3, s - width / 2), s1 = Math.min(edgeF(r, i).L - 0.3, s + width / 2);
    list.push({ s0, s1, y0: 0.08, y1: 3.2, d: 0.16, tile: CT.door, det: KS.det, lit: 1 });
    list.push({ s0, s1, y0: 3.2, y1: 3.9, d: 0.16, tile: CT.glass, det: KS.det, lit: 1 });
  };
  door(J.i, J.s, 4.4); door(M.i, M.s, 4.8);
  if (glassI >= 0 && glassL > 30) {
    const Fw = edgeF(r, glassI), w = Math.min(17, Fw.L - 8), s = Fw.L * 0.56, list = openings.get(glassI) || [];
    list.push({ s0: s - w / 2, s1: s + w / 2, y0: 7.2, y1: 8.55, d: 0.12, tile: CT.glass, det: KS.det, lit: 1 }); openings.set(glassI, list);
  }
  STATE.GBC = part.gbc;
  const wall = { tex: 5, col: hb('#b9bec1'), plinth: 0.42, pcol: hb('#646a6d') }, rib = hb('#d1d4d5'), rib2 = hb('#9da4a7'), seam = hb('#a2a8ab');
  for (let i = 0; i < n; i++) {
    const Fw = edgeF(r, i), L = Fw.L, ops = openings.get(i) || [];
    lmWall(K, Fw.P, [Fw.P[0] + Fw.tx * L, Fw.P[1] + Fw.tz * L], 0, H, ops, wall);
    // Fine horizontal ribs and regular sheet joints match the silver metal cladding in the street photographs.
    for (let y = 0.42; y < H - 0.12; y += 0.24) {
      const spans = [[0, L]];
      for (const o of ops) if (y < o.y1 && y + 0.022 > o.y0) {
        for (let k = spans.length - 1; k >= 0; k--) { const [a, b] = spans[k]; if (o.s1 <= a || o.s0 >= b) continue; spans.splice(k, 1, ...(o.s0 > a ? [[a, o.s0]] : []), ...(o.s1 < b ? [[o.s1, b]] : [])); }
      }
      for (const [a, b] of spans) if (b - a > 0.08) lmBoxW(G, Fw, a, b, y, y + 0.022, -0.065, -0.035, Math.round(y * 10) % 2 ? rib : rib2, false);
    }
    for (let s = 3.2; s < L - 1; s += 4.2) if (!ops.some(o => s > o.s0 - 0.12 && s < o.s1 + 0.12)) lmBoxW(G, Fw, s - 0.022, s + 0.022, 0.48, H - 0.18, -0.07, -0.035, seam, false);
  }
  const canopy = (Fw, s, width, depth, y, color = '#aeb4b7') => {
    lmBoxW(G, Fw, s - width / 2, s + width / 2, y, y + 0.24, -depth, -0.12, hb(color));
    lmBoxW(G, Fw, s - width / 2, s + width / 2, y - 0.12, y, -depth, -depth + 0.12, hb('#72797d'));
  };
  // JYSK's entrance, small canopy, sign and open cross-braced corner frame.
  canopy(J.Fw, J.s, 5.5, 1.65, 3.55, '#c3c7c9');
  board(K, J.Fw, 'jysk', J.s, 5.95, 1.45, 0.14, null);
  const towerS = Math.max(1.7, Math.min(J.Fw.L - 1.7, J.s - 4.2)), y0 = H - 0.1, y1 = H + 3.55, tw = 2.25, td = -0.35, steel = hb('#879095');
  for (const q of [-tw / 2, tw / 2]) {
    lmBar(G, J.Fw.at(towerS + q, y0, td), J.Fw.at(towerS + q, y1, td), 0.13, steel);
    lmBar(G, J.Fw.at(towerS + q, y0, td), J.Fw.at(towerS - q, y1, td), 0.1, steel);
  }
  for (const y of [y0, H + 1.65, y1]) lmBar(G, J.Fw.at(towerS - tw / 2, y, td), J.Fw.at(towerS + tw / 2, y, td), 0.11, steel);
  board(K, J.Fw, 'jyskSquare', towerS, H + 0.2, 2.05, 0.2, null);
  // PROMO remains the neighbouring tenant on the long frontage; its wide awning and raised sign match the approved plan.
  lmBoxW(G, M.Fw, 0.55, M.Fw.L - 0.55, 3.45, 3.78, -2.1, -0.18, hb('#aab0b3'));
  for (let s = 3; s < M.Fw.L - 2; s += 6) lmBar(G, M.Fw.at(s, 0.3, -1.9), M.Fw.at(s, 3.45, -1.9), 0.1, hb('#888f92'));
  const promoTower = Math.max(3.6, Math.min(M.Fw.L - 3.6, M.s - 5.2)), pw = 6.4, py0 = H - 0.1, py1 = H + 3.15, psteel = hb('#747c80');
  for (const q of [-pw / 2, pw / 2]) {
    lmBar(G, M.Fw.at(promoTower + q, py0, -0.28), M.Fw.at(promoTower + q, py1, -0.28), 0.14, psteel);
    lmBar(G, M.Fw.at(promoTower + q, py0, -0.28), M.Fw.at(promoTower - q, py1, -0.28), 0.1, psteel);
  }
  for (const y of [py0, py1]) lmBar(G, M.Fw.at(promoTower - pw / 2, y, -0.28), M.Fw.at(promoTower + pw / 2, y, -0.28), 0.12, psteel);
  board(K, M.Fw, 'promo', promoTower, H + 0.25, 2.2, 0.3, null);
  for (const [Fw, s, w] of [[J.Fw, J.s, 5.5], [M.Fw, M.s, 6]]) {
    const apron = [Fw.at(s - w / 2, 0, -0.4), Fw.at(s + w / 2, 0, -0.4), Fw.at(s + w / 2, 0, -4.5), Fw.at(s - w / 2, 0, -4.5)].map(p => [p[0], p[2]]);
    flatPlain(G, [new Float32Array(apron.flat())], 0.04, hb('#b9b9b5'), false);
  }
  STATE.GBC = null;
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
  // The entrance list and placement follow the centre's 2021 visitor notice and OSM's mapped Hanza/Passāža doors.
  // Each sign sits on the wall, with a glazed door, a shallow canopy, a paved apron and (at the Kandavas upper door) stairs.
  const part = key => SH.mall.ditton.find(p => p.key[0] === key);
  const wallAt = (r, q, minL) => {
    const n = r.length >> 1; let best = null;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * j], bz = r[2 * j + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < minL) continue;
      const s = Math.max(0, Math.min(L, ((q[0] - ax) * dx + (q[1] - az) * dz) / L)), d = Math.hypot(q[0] - ax - dx / L * s, q[1] - az - dz / L * s);
      if (!best || d < best.d) best = { Fw: lmWF([ax, az], [bx, bz]), s, d };
    }
    return best;
  };
  const portal = (Fw, s, label, { width = 4.2, floor = 0, height = 3.15, signHeight = 0.9, stairs = false, beige = true } = {}) => {
    s = Math.max(width / 2 + 0.15, Math.min(Fw.L - width / 2 - 0.15, s));
    const s0 = s - width / 2, s1 = s + width / 2, frameCol = beige ? BEIGE : hb('#aeb4b7');
    flat(Fw, s0 + 0.12, s1 - 0.12, floor + 0.05, floor + height, -0.17, CT.door, 1);
    frame(G, Fw, s0, s1, floor, floor + height + 0.1, 0.2, 0.3, frameCol);
    lmBoxW(G, Fw, s0, s1, floor + height, floor + height + 0.18, -0.35, 0.15, hb('#b7bdc0'));
    const canopyY = floor + height + 0.2;
    lmBoxW(G, Fw, s0 - 0.9, s1 + 0.9, canopyY, canopyY + 0.24, -2.15, 0.2, hb('#c6c9ca'));
    for (const q of [s0 - 0.48, s1 + 0.48]) { const [x, , z] = Fw.at(q, 0, -1.7); lmLathe(G, x, z, 0, [[0.12, 0], [0.12, canopyY]], 8, frameCol); }
    board(K, Fw, label, s, canopyY + 0.32, signHeight, 0.32, '#e9ebea');
    const apron = [Fw.at(s0 - 0.7, 0, -0.5), Fw.at(s1 + 0.7, 0, -0.5), Fw.at(s1 + 0.7, 0, -3.8), Fw.at(s0 - 0.7, 0, -3.8)].map(p => [p[0], p[2]]);
    flatPlain(G, [new Float32Array(apron.flat())], 0.035, hb('#b5b4ae'), false);
    if (stairs) {
      const n = Math.ceil(floor / 0.19), tread = 0.31, stepW = width + 0.8, stairCol = hb('#aaa9a3');
      for (let k = 0; k < n; k++) { const y = k * floor / n, d = -(n - k) * tread, [x, , z] = Fw.at(s, 0, d); box(G, x, z, Fw.tx, Fw.tz, stepW / 2, tread * 0.58, y, y + 0.16, stairCol); }
      for (const edge of [-stepW / 2, stepW / 2]) {
        const A = Fw.at(s + edge, 0.85, -n * tread), B = Fw.at(s + edge, floor + 0.9, -0.55);
        lmBar(G, A, B, 0.09, hb('#73797c'));
        for (let k = 1; k < 6; k++) { const t = k / 6, x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t, z = A[2] + (B[2] - A[2]) * t; lmBar(G, [x, y - 0.75, z], [x, y, z], 0.065, hb('#73797c')); }
      }
    }
  };
  // Main Galerija entrance on the rounded Cietokšņa face, centred with the DITTON NAMS drum and sign.
  {
    STATE.GBC = hall?.gbc || null;
    const d = [Math.cos(a0), Math.sin(a0)], t = [-d[1], d[0]], rr = RC + 0.1, P = [cx + d[0] * rr - t[0] * 6.2, cz + d[1] * rr - t[1] * 6.2], Q = [cx + d[0] * rr + t[0] * 6.2, cz + d[1] * rr + t[1] * 6.2], Fw = lmWF(P, Q);
    portal(Fw, Fw.L / 2, 'dittonGallery', { width: 5.4 });
  }
  // Upper Galerija access from Kandavas; a short exterior stair and rail make the second-floor door legible from the street.
  {
    const p = part(-1400), w = p && wallAt(p.outer, [-1428, 900], 8); if (p && w) { STATE.GBC = p.gbc; portal(w.Fw, w.s, 'dittonGallery2', { width: 4.6, floor: 4.35, height: 2.8, stairs: true }); }
  }
  // Separate public entrances into Pasāža and Hanza, plus the outdoor Green Market entrance facing Cietokšņa.
  for (const [key, q, label, width] of [
    [-1268, [-1265.3, 996.5], 'dittonPassaza', 3.5],
    [-1210, [-1187.1, 897.4], 'dittonHanza', 3.7],
    [-1400, [-1428.8, 966.0], 'dittonMarket', 4.1],
  ]) {
    const p = part(key), w = p && wallAt(p.outer, q, width + 0.5); if (p && w) { STATE.GBC = p.gbc; portal(w.Fw, w.s, label, { width, height: 2.9, signHeight: key === -1268 ? 0.68 : 0.9, beige: key !== -1268 }); }
  }
  // Keep the existing tenant entrance at the Rimi forecourt, but make the sliding doors visible beneath its sign.
  if (hall) { const p = wallAt(hall.outer, [-1321.6, 1047.4], 6); if (p) { STATE.GBC = hall.gbc; portal(p.Fw, p.s, 'rimi', { width: 4.4, height: 3.2, beige: false }); } }
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
    } else if (S.k === 'in') { if (S.model === 'jyskCentre') jyskCentre(K, S, SH.custom.get(S.id)); else tenant(K, S, SH.host.get(S.id)); }
  }
  ditton(K); solo(K);
  STATE.GBC = null;
  KS.det.mesh(LMM.shDet); KS.det = null;
}

export { SHOP_TREES, SHV, lmShops, shopClaim };
