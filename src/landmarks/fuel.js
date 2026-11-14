import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { LMM, lmStd } from './index.js';
import { spwFlag } from './speedway.js';
import { lmRegisterOutline } from './tv-tower.js';
import { lmBar, lmLathe } from './helpers.js';
import { LMT, lr } from './tiles.js';
import { LMB, LMWHITE } from './core.js';
import { band, flatPlain, vband } from '../buildings/walls.js';
import { COL, M_ASPH, M_PAVE, ROAD, inBuilding } from '../world/data.js';
import { glowTex, mkCanvas, toTex } from '../render/textures.js';
import { TERR, subTris, terrainH } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { GB, box, polyA } from '../core/geometry.js';
import { area2, bbox, edgeN, hb, offsetRing, pip, reversed, sh, triangulate } from '../core/util.js';

/* ---------- fuel stations ----------
   All the filling stations of the city from OpenStreetMap: the amenity=fuel points with the canopies mapped round them
   as building=roof, the shops, car washes, totems, flagpoles, storage tanks, air posts and the covered lanes under the
   canopies; the few outlines OSM lacks come from the cadastre (both Virši-A at Cietokšņa iela, the canopy of Viada at
   18. novembra iela, the shop of Viada "Daugavpils 2"). In the cadastre most canopies are small houses, so they were
   drawn with windows; here they are canopies again. Each station is drawn in the colours of its brand, taken from
   photographs: Circle K red with an orange stripe, Neste blue with a lime stripe and green columns, Viada a red fascia
   leaning out over white round columns, Virši-A green over blue with a dark shop, Latvijas Propāna Gāze white with
   green, Intergaz white with blue and its gas tanks; the local Ingrīda stations, of which no photographs could be found,
   white with a dark blue band. The pump islands lie between the covered lanes mapped under each canopy (on both sides
   of a single lane; along the long side of a canopy without lanes), with a dispenser between two columns. The totems
   stand at the mapped totem nodes, turned to the nearest street; their prices are only for the look. Per station: b
   brand, at the node (world), c canopy, r other roofs, s shop, w car washes, p plot, i islands [x1, z1, x2, z2], t
   totems, fl flagpoles, air air posts, tk gas tanks (points) and tw tank yards, lpg the LPG dispenser beside the station,
   mini a station known only as a point, g LPG among the prices; all relative to the node, x east, z south. */
const FUEL_BRANDS = {
  ck: { sign: 'fuCK', bands: [['#d42a1f', 1]], stripe: ['#f4821f', 0.14], post: '#dcdddd', disp: '#d42a1f', wall: '#55595e', band: '#d42a1f', totem: '#d42a1f' },
  neste: { sign: 'fuNeste', bands: [['#163f9b', 1]], stripe: ['#7dc242', 0.2], post: '#79bd41', disp: '#7dc242', wall: '#eef0f1', band: '#163f9b', totem: '#163f9b' },
  viada: { sign: 'fuViada', bands: [['#d7202a', 1]], wedge: 0.4, round: true, post: '#f2f2f0', disp: '#d7202a', wall: '#f1f1ee', band: '#d7202a', totem: '#d7202a' },
  virsi: { sign: 'fuVirsi', bands: [['#3aa935', 0.62], ['#0e4c9d', 0.38]], post: '#e9eaea', disp: '#0e4c9d', wall: '#3b3633', band: '#0e4c9d', totem: '#0e4c9d' },
  ingrida: { sign: 'fuIngrida', ink: true, bands: [['#f2f2ef', 0.66], ['#24456f', 0.34]], post: '#dcdcd8', disp: '#24456f', wall: '#e6e3dc', band: '#24456f', totem: '#24456f' },
  intergaz: { sign: 'fuIntergaz', ink: true, bands: [['#f4f4f1', 0.66], ['#1e4f9f', 0.34]], post: '#e3e4e4', disp: '#1e4f9f', wall: '#ece9e2', band: '#1e4f9f', totem: '#1e4f9f' },
  lpg: { sign: 'fuLPG', ink: true, bands: [['#f5f5f2', 0.62], ['#2ba64a', 0.38]], post: '#e8e9e9', disp: '#2ba64a', wall: '#f1f1ee', band: '#2ba64a', totem: '#2ba64a' },
  plain: { sign: null, bands: [['#ebebe7', 0.75], ['#6b7680', 0.25]], post: '#d6d6d2', disp: '#5f6b75', wall: '#e4e1da', band: '#6b7680', totem: '#6b7680' }
};
const FUEL = [
  { b: 'ck', at: [314.6,896.2], g: 4, c: [[8.6,-2.9],[7,-1.2],[5.6,0.4],[13.9,8],[9.8,12.5],[8.4,14.1],[-10.2,-2.7],[-8.7,-4.3],[-4.7,-8.8],[-2,-6.3],[-0.5,-8.1],[1,-9.7]], s: [[-7,-17.4],[1,-26],[19.2,-9.1],[11.2,-0.5],[8.6,-2.9],[1,-9.7]], w: [[[8.3,-51.4],[39.3,-22],[34.6,-17],[3.5,-46.3]]], p: [[55.2,-15.4],[18.7,23.3],[4.7,13.3],[-53.3,-40.9],[-16.2,-80.1],[12.2,-55.2],[40.3,-29]], i: [[1,-1.1,5.7,3.2]], t: [[16,19.4]] },   // node283639209 Circle K
  { b: 'neste', at: [154.4,303.6], c: [[9.1,7],[8.5,4.9],[7.9,2.9],[10.1,2.3],[7.6,-6.4],[-9.4,-1.7],[-6.9,7.2],[1.1,4.9],[1.7,6.9],[2.2,9]], s: [[16.6,4.9],[18.2,11.2],[10.5,19.2],[7.6,20.2],[-0.4,12],[2.2,9],[9.1,7]], p: [[4.3,30.9],[26.5,7.8],[-8.5,-25.5],[-30.5,-2.4]], i: [[4.3,2.4,-1.8,4.2]] },   // node460016743 Neste
  { b: 'intergaz', at: [-2060.2,436.4], c: [[-7.3,-9.2],[1.1,-8.6],[2.9,-3.4],[4.9,2.3],[6.9,8.3],[7.6,10.3],[-0.7,9.6],[-1.3,7.7],[-3.4,1.7],[-5.4,-3.9]], s: [[2.3,-20.3],[-1.6,-20.6],[-5.6,-20.9],[-5.5,-22.2],[-8.9,-22.4],[-8.3,-30.8],[3,-30]], p: [[-22.3,-42.6],[5.9,-34.9],[12.7,-13.9],[40.1,-11.6],[38.9,5.3],[28.7,4.8],[24.1,15.8],[-3.1,13.1],[-9.4,11.6],[-14.7,8.5],[-18.5,3],[-20.2,-2.6]], i: [[-2.9,-1,3.5,-0.6],[-3.3,4.7,3.1,5.1]], t: [[6.2,17.5]], fl: [[-12.8,6.1],[-14,3.9],[-15.1,1.7]], tk: [[35,2.4],[35,0.3],[35.1,-1.8],[35.1,-4.1]] },   // node473143130 Intergaz
  { b: 'plain', at: [207,3029], mini: true },   // node1327794885 —
  { b: 'ingrida', at: [1605.9,-183.6], c: [[-7.8,-5.9],[-1,-9.9],[1,-6.5],[4.6,-0.4],[8,5.4],[1.2,9.4],[-2.3,3.5],[-5.8,-2.5]], s: [[-15,-10.1],[-11,-3.2],[2.1,-10.8],[-1.9,-17.7]], p: [[-4.6,-23.9],[-5.3,-18.6],[-29.3,-4.4],[-11.9,25.5],[30.1,0.7],[28.2,-7.8],[15.1,-28.9],[5.4,-23.6]], i: [[2.1,-3,-3.3,0]] },   // node1410181687 Ingrida
  { b: 'viada', at: [-1376.3,86.9], c: [[9.1,3.8],[4.2,-2.9],[10,-7.5],[4.5,-14.6],[-8.9,-4.8],[1.8,9.1]], i: [[5.6,-8.7,9.5,-3.5],[1.2,-5.3,5,-0.2],[-3.3,-2,0.6,3.2]] },   // node1704258911 Viada
  { b: 'viada', at: [443.8,757.2], g: 4, c: [[5.8,-10.4],[3,-7.3],[1.4,-5.5],[-2,-8.5],[-8.2,-1.6],[-9.3,-0.3],[3.1,10.8],[4.3,9.4],[10.4,2.7],[5.3,-1.8],[7,-3.7],[9.9,-6.8]], s: [[-1.9,-26.4],[14.3,-11.7],[9.9,-6.8],[5.8,-10.4],[-6.4,-21.5]], p: [[32,4.6],[-2,-27.1],[-25.9,-2.3],[7.9,30.3]], i: [[-0.5,-2.5,4.3,1.7]], t: [[8.4,26.6]] },   // node1889511240 Viada
  { b: 'lpg', at: [2036,1783.3], c: [[-6.7,0.8],[-3,-6.2],[-0.1,-4.6],[4.7,-2],[6.8,-0.9],[3.1,6.1],[0.9,4.9],[-3.9,2.3]], s: [[-5.4,-8.7],[-2.7,-7.2],[-6.8,0.4],[-9.5,-1.1],[-6.9,-5.9]], p: [[23,29.4],[31,7.2],[23.9,-11.4],[3.6,-22.5],[-5.4,-8.7],[-6.9,-5.9],[-9.5,-1.1],[-13,5.5],[-14.7,12.6]], i: [[1.8,-2.4,-1,2.8]], t: [[-1.6,15.3]] },   // node1889513772 Latvijas Propāna Gāze
  { b: 'neste', at: [-2383.9,1930.3], c: [[6.8,-2.7],[5.8,4.5],[4,4.3],[-0.7,3.7],[-4.9,3.1],[-6.8,2.9],[-5.9,-4.3],[-4,-4.1],[0.1,-3.5],[4.7,-2.9]], w: [[[-41,-20.5],[-39.6,-18.5],[-36.7,-14.3],[-35.3,-12.1],[-40.4,-8.7],[-41.9,-10.9],[-44.7,-15],[-46.1,-17.1]]], p: [[-20.4,25.7],[30.1,24.5],[27.1,-31.9],[6.7,-31.5],[0.7,-28.7],[-31.6,-23.2],[-34.8,-27.8],[-56.2,-13.1]], i: [[2.4,-2.3,1.7,3],[-2.1,-2.9,-2.7,2.5]], t: [[26.6,21.7],[26.5,18.1]], lpg: [15.5,-22.8] },   // node1889516192 Neste Daugavpils II
  { b: 'viada', at: [2575.3,1965.2], c: [[5.8,6.9],[-6.3,6.1],[-5.7,-2.5],[-5.5,-6.3],[-4.3,-6.2],[5.7,-5.5],[6.6,-5.5],[6.3,-1.7]], s: [[-4.1,-11],[-4.3,-6.2],[-4.4,-5],[5.6,-4.4],[5.7,-5.5],[6,-10.4]], p: [[-17.8,7.6],[-16.7,-5.1],[-6,-4.3],[-5.3,-13.1],[7.4,-12.5],[7.7,-17.4],[23.7,-16.3],[22.6,2.9],[33.6,3.5],[22,14.4],[-6.3,12.2]], i: [[-3.1,1.3,3.3,1.7]] },   // node1942498573 Viada
  { b: 'viada', at: [-3539,-3547.8], c: [[-5.5,-15.1],[2,-5.7],[7.2,-9.7],[14.4,-1.5],[8.6,3.2],[10.3,5.2],[4,10.2],[-12,-9.9]], r: [[[23.6,11.6],[27.9,16.5],[19.4,24],[15.1,19]]], s: [[13.5,-16.8],[6.4,-10.6],[7.2,-9.7],[14.4,-1.5],[15.9,0.3],[23,-5.9]], p: [[-23.7,67.9],[59.8,3.4],[27,-36.7],[23.7,-33.8],[16.5,-41.8],[-0.4,-62.1],[-16.4,-69.4],[-22.1,-65.8],[-82.5,-8.4],[-81.6,-0.9],[-68.1,20.5],[-36.4,54.8]], i: [[0.9,0.3,-3.1,-4.7],[6.9,-4.6,2.9,-9.5]], t: [[-61.3,-13.1]], fl: [[-45.5,-24.6],[-44,-25.8],[-42.7,-26.9],[-41.2,-28.1],[-39.9,-29.1]] },   // node2417779392 Viada
  { b: 'ingrida', at: [-369.4,926.1], c: [[-8.7,-3.6],[-2.9,-3.8],[3.3,-4],[8.4,-4.1],[8.7,4.5],[3.7,4.6],[-2.6,4.8],[-8.4,5]], s: [[-15.5,-7],[-6,-7.3],[-5.5,8.3],[-15,8.6]], p: [[20.9,-35.6],[4.9,-20],[-0.9,-16.5],[-24.1,-15.2],[-21.9,22.3],[12.5,19.8],[29,26.1]], i: [[0.2,-2.8,0.5,3.6]], t: [[21,-11.9]] },   // node7792275721 Ingrīda
  { b: 'ingrida', at: [-1113.4,425.3], c: [[-0.5,-8.1],[-3.5,-5.7],[-8.3,-1.9],[0,8.5],[4.6,4.9],[7.8,2.2]], s: [[1.8,-12.8],[12.7,1.4],[7.6,5.2],[-3.2,-8.9]], p: [[-20.8,-12],[-1.1,-25.9],[22.1,4.1],[11.4,29.2]], i: [[-4.3,-0.8,-0.4,4.3]] },   // node9190133483 Ingrida
  { b: 'viada', at: [-1189.7,-1352], g: 4, c: [[13.7,-15.4],[12.2,-15],[9.3,-12.8],[4.3,-9.1],[-0.5,-5.5],[-5.4,-1.8],[-9,0.8],[-10.8,1.4],[-18,3.7],[-14.8,13.5],[-7.9,11.3],[-4.2,10.1],[-2.4,8.6],[2.4,4.9],[7.2,1],[12.2,-2.8],[14.8,-5],[16.4,-5.4]], s: [[-29.9,5.6],[-26.4,15.7],[-19,13.1],[-18.3,15.2],[-14.9,14],[-14.1,11.6],[-16.2,5.1],[-13,4.1],[-14.2,0.4],[-15.7,-0.4],[-19.6,0.7],[-19.3,1.5],[-25.4,3.3],[-26,1.3],[-29,2.1],[-29.8,3.7]], p: [[37.8,27.6],[-0.9,30.6],[-7.4,27.9],[-28.7,34.8],[-31.8,34.1],[-37.1,20.2],[-35.5,17.5],[-45.1,-10.8],[-4.3,-40.7],[4.4,-38.4],[14.6,-40],[19.8,-45.4],[25.8,-31]], i: [[8,-6.8,9.8,-0.6],[2.5,-5.2,4.3,1],[-3,-3.6,-1.2,2.5],[-8.6,-2,-6.8,4.2]], t: [[24.4,-24]] },   // node9437534629 DUS "Daugavpils 2"
  { b: 'ck', at: [-989.9,694.6], c: [[0.3,-12.5],[-12.5,-2.6],[-0.5,12.8],[12.3,2.8]], s: [[-7.1,17.1],[0.2,26.5],[19.6,11.5],[12.4,2.1]], i: [[1.1,-4.9,5.1,0.2],[-5.3,0.1,-1.3,5.1]], t: [[-53.2,-32.2]], air: [[-3.3,24]] },   // node9702810088 Circle K
  { b: 'viada', at: [-2150.5,394.4], g: 4, c: [[-11.4,-6.5],[-12.4,4.9],[-9.4,5.1],[-9.8,9.3],[-3.3,9.9],[-2.9,5.9],[4.9,6.5],[12.8,7.3],[13.8,-4.2],[6,-4.9],[-2.6,-5.7]], s: [[3,14.7],[1.8,27.8],[-19.2,25.6],[-17.8,12.5],[-8.7,13.5]], p: [[18.5,49.9],[-27.1,48.6],[-21.8,-16.6],[14.8,-37.8],[24,-26.8]], i: [[1.3,-0.8,0.7,5.6]], t: [[12.6,46.8],[35.6,-28.8]] },   // node10018929478 Viada
  { b: 'virsi', at: [6003.3,-5231.8], c: [[8,-6.6],[6.2,-6.1],[-0.1,-4.6],[-6.9,-2.9],[-9.6,-2.2],[-7.4,6.7],[-4.7,6.1],[2.1,4.4],[8.4,2.8],[10.3,2.4]], s: [[-21.1,-1.9],[-11.7,-4.2],[-10.6,-1.9],[-9.1,-1.3],[-7.6,4.9],[-8.6,6.3],[-8.6,9.1],[-17.7,11.5],[-19.7,9.2],[-21.1,6.6],[-21.8,3.8],[-21.6,1]], p: [[-50,58.9],[14.7,98.9],[18,75.7],[28.6,43.5],[46.3,34.6],[61.5,8.4],[62.2,0.3],[58,-8.1],[50.4,-16],[38,-24.2],[30.5,-31.5],[-19.7,-64.4],[-62.2,13.8],[-57.2,36.7],[-50.1,49]], i: [[3.4,-4,4.9,2.3],[-3.2,-2.4,-1.6,3.9]], t: [[34.5,36.3]], fl: [[54.2,-0.6],[55,1.9],[55.8,4.7]], air: [[-20.1,9.7]] },   // node10157783119 Virši-A
  { b: 'viada', at: [4033.1,-1417.2], c: [[-10.5,-13.4],[-0.5,-18.8],[2.5,-13.2],[3.9,-10.7],[4.3,-7.1],[5.3,0.2],[6.3,7.5],[6.9,11.7],[8.4,14.6],[-1.4,19.9],[-3.2,16.4],[-3.7,12.8],[-4.7,5.6],[-5.8,-1.6],[-6.4,-5.8],[-7.4,-7.8]], s: [[-17.7,-24],[-7.2,-29.6],[-3.6,-22.9],[-2.2,-23.6],[-0.5,-20.4],[-0.5,-19.2],[-1.3,-18.5],[-7.4,-15.3],[-6.4,-13.5],[-6.5,-12.1],[-7.4,-10.8],[-9,-10.5],[-10.7,-11.3],[-12.6,-14.5],[-11.9,-14.9],[-15.1,-20.4],[-17,-19.3],[-18.3,-21.5],[-18.3,-22.8]], p: [[-41.9,-29.8],[-37.3,-19.6],[-43.8,-16.6],[-12.5,51.3],[62.5,14.2],[41.9,3],[27.5,-12],[4.3,-54.8]], i: [[4.8,4.3,-0.8,7.4],[1.5,-1.7,-4.1,1.4],[-1.7,-7.4,-7.3,-4.3]], t: [[35.5,23.4]], fl: [[21.4,29.1],[18.4,30.2],[15.8,31.1]], tw: [[[-32.7,-15.8],[-38.9,-12.5],[-25.8,12],[-19.6,8.6]]] },   // node11823048265 Viada
  { b: 'virsi', at: [-1235.6,-613], c: [[-6.5,-19.6],[-0.6,-11.8],[-16,-0.2],[-21.9,-8]], s: [[2.3,-7.6],[8.9,0.8],[6.2,2.8],[6.5,3.3],[5.3,4.2],[5,3.8],[-5.9,12],[-12.4,3.4]], p: [[-16.5,-43.6],[-26.4,-36.7],[-31.9,4.6],[-17.7,28.9],[10,24.5],[27.7,15.1]], i: [[-7.3,-9.9,-12.4,-6.1],[-10.2,-13.8,-15.3,-10]] },   // node12718556339 Virši-A
  { b: 'viada', at: [350.9,-1356], wb: 'plain', c: [[6.3,-2.5],[10.5,13],[-1.3,16.2],[-5.5,0.6]], s: [[15.6,0.4],[18.3,10.6],[24.9,8.8],[22.2,-1.3]], w: [[[-57.9,9.1],[-55.8,15.8],[-66.9,18.7],[-74.2,20.5],[-76,14],[-68.7,12]]], p: [[-84,4.6],[-75.9,36.2],[-3.5,22.6],[22.6,15.7],[17,-5.6],[12.4,-22.6],[5.7,-20.8],[-22.6,-13.3],[-83.2,4.4]], i: [[0.4,10.7,-1.3,4.5],[6.3,9.1,4.6,3]] },   // way1456236682 Viada
];
const fuelW = (S, p) => [S.at[0] + p[0], S.at[1] + p[1]];
function fuelRing(S, pts) { let r = []; for (const p of pts) r.push(...fuelW(S, p)); r = new Float32Array(r); return area2(r) < 0 ? reversed(r) : r; }
const fuelCen = r => { let x = 0, z = 0; const n = r.length >> 1; for (let i = 0; i < n; i++) { x += r[2 * i]; z += r[2 * i + 1]; } return [x / n, z / n]; };
// the cadastre outlines under the canopies, shops and washes drawn here, and the plots where no tree grows
let FUEL_KEYS = null, FUEL_PLOTS = null;
function fuelPrep() {
  if (FUEL_KEYS) return; FUEL_KEYS = []; FUEL_PLOTS = [];
  for (const S of FUEL) {
    for (const pts of [S.c, S.s, ...(S.w || []), ...(S.r || [])]) if (pts) FUEL_KEYS.push(fuelCen(fuelRing(S, pts)));
    if (S.p) { const r = fuelRing(S, S.p); FUEL_PLOTS.push({ r, bb: bbox(r) }); }
    else if (S.c) { const r = offsetRing(fuelRing(S, S.c), 4); FUEL_PLOTS.push({ r, bb: bbox(r) }); }
  }
}
function fuelDrops(ring, bb, style) {
  fuelPrep(); for (const [x, z] of FUEL_KEYS) if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pip(x, z, ring)) return true;
  if (style === 13) {   // the cadastre's fuel tanks of a station lie underground, not 9 m silos on the forecourt
    const [cx, cz] = fuelCen(ring); for (const S of FUEL) if (Math.hypot(cx - S.at[0], cz - S.at[1]) < 40) return true;
    for (const P of FUEL_PLOTS) if (cx >= P.bb[0] - 6 && cx <= P.bb[2] + 6 && cz >= P.bb[1] - 6 && cz <= P.bb[3] + 6 && pip(cx, cz, offsetRing(P.r, 6))) return true;
  }
  return false;
}
function fuelNoTree(x, z) { fuelPrep(); for (const P of FUEL_PLOTS) if (x >= P.bb[0] && x <= P.bb[2] && z >= P.bb[1] && z <= P.bb[3] && pip(x, z, P.r)) return true; return false; }
// the brand names and the price boards of the totems, on their own atlas
const FUS = {};
function fuelSigns() {
  const W = 2048, H = 2048, cv = mkCanvas(W, H), g = cv.getContext('2d'), gm = mkCanvas(W, H), e = gm.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  let x = 0, y = 0, rowH = 0;
  const add = (name, w, h, draw) => { if (x + w > W) { x = 0; y += rowH + 8; rowH = 0; } for (const c of [g, e]) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); } draw(x, y, w, h); g.restore(); e.restore();
    FUS[name] = { u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H, a: w / h }; x += w + 8; rowH = Math.max(rowH, h); if (y + h > H) console.warn('fuel sign atlas overflow'); };
  const word = (name, text, col, glow, fam = '"Arial Black", "Helvetica Neue", Arial, sans-serif', wt = '900') => add(name, 1000, 200, (x0, y0, w, h) => {
    g.font = `${wt} 100px ${fam}`; const k = Math.min(1.5, w * 0.92 / g.measureText(text).width), px = Math.round(100 * k);
    for (const [c, f] of [[g, col], [e, glow]]) { c.font = `${wt} ${px}px ${fam}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = f; c.fillText(text, x0 + w / 2, y0 + h / 2 + px * 0.04); } });
  word('fuCK', 'CIRCLE K', '#ffffff', '#fff2e8'); word('fuNeste', 'NESTE', '#ffffff', '#eef4ff'); word('fuViada', 'VIADA', '#ffffff', '#fff0f0');
  word('fuVirsi', 'VIRŠI-A', '#ffffff', '#f0fff0'); word('fuIngrida', 'INGRĪDA', '#24456f', '#9fc0ff'); word('fuIntergaz', 'intergaz', '#1e4f9f', '#a8c6ff');
  word('fuLPG', 'LPG AUTOGĀZE', '#262626', '#b8f0c4');
  // price boards: grades in white boxes, LED digits; the prices only look plausible
  const board = (name, rows) => add(name, 340, 620, (x0, y0, w, h) => {
    g.fillStyle = '#15171a'; g.fillRect(x0, y0, w, h); const rh = h / 4, oy = y0 + (4 - rows.length) * rh / 2;
    rows.forEach(([lab, val], k) => { const cy = oy + rh * (k + 0.5);
      g.fillStyle = '#f2f2ee'; g.fillRect(x0 + 14, cy - rh * 0.3, w * 0.3, rh * 0.6); g.fillStyle = '#1a1a1a'; g.font = `800 ${lab.length > 2 ? 40 : 58}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(lab, x0 + 14 + w * 0.15, cy + 2);
      for (const [c, f] of [[g, '#ffb22e'], [e, '#ffb22e']]) { c.font = '700 64px "Courier New", monospace'; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillStyle = f; c.fillText(val, x0 + w - 12, cy + 2); } });
    e.fillStyle = '#3a3a3a'; for (let k = 0; k < rows.length; k++) e.fillRect(x0 + 14, oy + rh * (k + 0.2), w * 0.3, rh * 0.6);
  });
  board('fuP3', [['95', '1.629'], ['98', '1.699'], ['D', '1.589']]); board('fuP4', [['95', '1.629'], ['98', '1.699'], ['D', '1.589'], ['LPG', '0.799']]); board('fuP1', [['LPG', '0.799']]);
  const t = toTex(cv, true, false), te = toTex(gm, true, false); t.minFilter = te.minFilter = THREE.LinearMipmapLinearFilter; return [t, te];
}
function lmFuel(K, litPatch) {
  const [ft, fg] = fuelSigns();
  LMM.fuTxt = lmStd({ vertexColors: true, map: ft, alphaTest: 0.5, roughness: 0.4, metalness: 0, emissive: new THREE.Color(1, 1, 1), emissiveMap: fg, emissiveIntensity: 0 }, 'fu-txt', litPatch);
  LMM.fuLamp = lmStd({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: new THREE.Color(1, 0.97, 0.9), emissiveIntensity: 0 }, 'fu-lamp');
  // fascias, canopy ceilings and totems are lit panels: they glow a little in their own colour by day, more at night
  const glow = { value: 0.28 }; LMM.fuFascia = lmStd({ vertexColors: true, roughness: 0.45, metalness: 0 }, 'fu-fascia', s => { s.uniforms.uFuGlow = glow;
    s.fragmentShader = 'uniform float uFuGlow;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uFuGlow;'); }); LMM.fuFascia.userData.glow = glow;
  const G = K.plain, FA = new GB(false), TX = new LMB(), L = new GB(false), asph = new GB(false), conc = new GB(false), pools = [];
  const GREY = hb('#a4a6a8'), CON = hb('#b9b6ae'), DARK = hb('#2c3034'), WHITE = hb('#f2f2ef'), LAMP = hb('#fbfaf4'), YEL = hb('#e8c21a');
  const nrm = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };
  // a quad of the sign atlas: corners bottom-left, bottom-right, top-right, top-left as seen by the viewer
  const sign = (name, A, B, Cc, D, n, lit = 1) => { const t = FUS[name]; TX.q(A, B, Cc, D, nrm(n), [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, lit); };
  const tile = (name, P, Q, y0, y1, n, lit) => { const t = LMT[name], right = [n[1], -n[0]], lft = (Q[0] - P[0]) * right[0] + (Q[1] - P[1]) * right[1] > 0, a = lft ? P : Q, b = lft ? Q : P;
    K.det.q([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [n[0], 0, n[1]], [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1], LMWHITE, lit ? 1 : 0); };
  const ground = (b, ring, col) => { const t0 = triangulate([ring]), { flat, tris } = TERR.on ? subTris(t0.flat, t0.tris, 0.25) : t0, v = b.v; b.ensure(flat.length / 2);
    for (let i = 0; i < flat.length; i += 2) b.vert(flat[i], 0, flat[i + 1], 0, 1, 0, col); for (let i = 0; i < tris.length; i += 3) b.triUp(v + tris[i], v + tris[i + 1], v + tris[i + 2]); };
  const ext = r => { let best = 0, bw = 1e9; const n = r.length >> 1, e = a => { const ca = Math.cos(a), sa = Math.sin(a); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (let i = 0; i < n; i++) { const u = r[2 * i] * ca + r[2 * i + 1] * sa, v = -r[2 * i] * sa + r[2 * i + 1] * ca; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } return [u0, u1, v0, v1]; };
    for (let k = 0; k < 90; k++) { const q = e(k * Math.PI / 180); if ((q[1] - q[0]) * (q[3] - q[2]) < bw) { bw = (q[1] - q[0]) * (q[3] - q[2]); best = k * Math.PI / 180; } }
    let q = e(best); if (q[1] - q[0] < q[3] - q[2]) { best += Math.PI / 2; q = e(best); } return { a: best, tu: [Math.cos(best), Math.sin(best)], tn: [-Math.sin(best), Math.cos(best)], u0: q[0], u1: q[1], v0: q[2], v1: q[3] }; };
  const rectRing = (c, tu, hu, hv) => { const tn = [-tu[1], tu[0]], r = []; for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) r.push(c[0] + tu[0] * a * hu + tn[0] * b * hv, c[1] + tu[1] * a * hu + tn[1] * b * hv);
    const f = new Float32Array(r); return area2(f) < 0 ? reversed(f) : f; };
  const cyl = (A, B, r, col, seg = 16) => { const d = nrm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]), up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], s1 = nrm(cr(d, up)), s2 = cr(s1, d), p = (P, k) => { const a = k * 2 * Math.PI / seg, c = Math.cos(a) * r, s = Math.sin(a) * r; return [P[0] + s1[0] * c + s2[0] * s, P[1] + s1[1] * c + s2[1] * s, P[2] + s1[2] * c + s2[2] * s]; };
    for (let k = 0; k < seg; k++) { const am = (k + 0.5) * 2 * Math.PI / seg, h = [s1[0] * Math.cos(am) + s2[0] * Math.sin(am), s1[1] * Math.cos(am) + s2[1] * Math.sin(am), s1[2] * Math.cos(am) + s2[2] * Math.sin(am)];
      polyA(G, [p(A, k), p(A, k + 1), p(B, k + 1), p(B, k)], col, h[0], h[1], h[2]); polyA(G, [A, p(A, k), p(A, k + 1)], sh(col, 0.92), -d[0], -d[1], -d[2]); polyA(G, [B, p(B, k), p(B, k + 1)], sh(col, 0.92), d[0], d[1], d[2]); } };

  // a canopy: the slab with the brand's fascia (leaning out for Viada), the brand on its free sides, lights under it and
  // a pool of light on the ground at night
  function canopy(r, B, y0, T, avoid, signs = true) {
    const rows = []; let yt = y0 + T; const yb = y0 + (B.stripe ? B.stripe[1] : 0), wedge = B.wedge || 0, off = y => wedge * (y - y0) / T, at = y => off(y) > 0.001 ? offsetRing(r, off(y)) : r, n = r.length >> 1;
    for (const [col, share] of B.bands) { const h = (y0 + T - yb) * share; rows.push([yt - h, yt, col]); yt -= h; }
    if (B.stripe) rows.push([y0, yb, B.stripe[0]]);
    for (const [ya, yb2, col] of rows) { const A = at(ya), Q = at(yb2), c = hb(col);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, e = edgeN(r, i); if (e[2] < 0.05) continue; polyA(FA, [[A[2 * i], ya, A[2 * i + 1]], [A[2 * j], ya, A[2 * j + 1]], [Q[2 * j], yb2, Q[2 * j + 1]], [Q[2 * i], yb2, Q[2 * i + 1]]], c, e[0], -0.3 * Math.sign(wedge), e[1]); } }
    flatPlain(G, [at(y0 + T)], y0 + T, hb('#8e9092'), false); flatPlain(FA, [r], y0, hb('#d8d9d7'), true);
    if (signs && B.sign) {   // on the band at the top of every side at least 5 m long that the shop is not built against
      const t = FUS[B.sign], ya = rows[0][0] + (rows[0][1] - rows[0][0]) * 0.16, yb3 = rows[0][1] - (rows[0][1] - rows[0][0]) * 0.16, es = [];
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, e = edgeN(r, i), mx = (r[2 * i] + r[2 * j]) / 2, mz = (r[2 * i + 1] + r[2 * j + 1]) / 2; if (avoid && pip(mx + e[0] * 1.2, mz + e[1] * 1.2, avoid)) continue; es.push([e[2], mx, mz, e]); }
      es.sort((a, b) => b[0] - a[0]);
      for (const [len, mx, mz, e] of es.slice(0, 4)) { if (len < 5) continue; const w = Math.min(len * 0.62, (yb3 - ya) * t.a), rt = [e[1], -e[0]], o0 = off(ya) + 0.03, o1 = off(yb3) + 0.03;
        const P = (s, o, y) => [mx + rt[0] * s + e[0] * o, y, mz + rt[1] * s + e[1] * o]; sign(B.sign, P(-w / 2, o0, ya), P(w / 2, o0, ya), P(w / 2, o1, yb3), P(-w / 2, o1, yb3), [e[0], -0.3 * Math.sign(wedge), e[1]]); }
    }
    const E = ext(r), q = (u, v) => [E.tu[0] * u + E.tn[0] * v, E.tu[1] * u + E.tn[1] * v];
    for (let u = E.u0 + 1.6; u < E.u1 - 1.2; u += 3) for (let v = E.v0 + 1.4; v < E.v1 - 1.0; v += 2.6) { const c = q(u, v); if (!pip(c[0], c[1], r)) continue;
      const P = (du, dv) => { const d = q(du, dv); return [c[0] + d[0], y0 - 0.02, c[1] + d[1]]; }; polyA(L, [P(-0.6, -0.3), P(0.6, -0.3), P(0.6, 0.3), P(-0.6, 0.3)], LAMP, 0, -1, 0); }
    const cc = fuelCen(r); pools.push([cc[0], cc[1], Math.max(E.u1 - E.u0, E.v1 - E.v0) / 2 + 3]);
    lmRegisterOutline([0, 0, 1, 0], Array.from({ length: n }, (_, i) => [r[2 * i], r[2 * i + 1]]), 12, false);
    return E;
  }
  // a pump island: a kerbed island, the dispenser between two columns that carry the canopy, bollards, a bin
  function island(A, Bp, B, y0, cols = true) {
    const L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), tu = [(Bp[0] - A[0]) / L, (Bp[1] - A[1]) / L], tn = [-tu[1], tu[0]], cx = (A[0] + Bp[0]) / 2, cz = (A[1] + Bp[1]) / 2;
    box(G, cx, cz, tu[0], tu[1], L / 2 + 0.35, 0.65, 0, 0.18, CON); box(G, cx, cz, tu[0], tu[1], L / 2 + 0.3, 0.6, 0.18, 0.2, sh(CON, 1.06));
    const D = hb(B.disp); box(G, cx, cz, tu[0], tu[1], 0.55, 0.27, 0.2, 1.2, D); box(G, cx, cz, tu[0], tu[1], 0.55, 0.25, 1.2, 1.95, WHITE); box(G, cx, cz, tu[0], tu[1], 0.58, 0.3, 1.95, 2.18, D);
    for (const s of [-1, 1]) { const P = (a, b, y) => [cx + tu[0] * a + tn[0] * b * s, y, cz + tu[1] * a + tn[1] * b * s];
      polyA(G, [P(-0.3, 0.26, 1.42), P(0.3, 0.26, 1.42), P(0.3, 0.26, 1.82), P(-0.3, 0.26, 1.82)], hb('#1b2a33'), tn[0] * s, 0, tn[1] * s);
      for (const a of [-0.38, 0.38]) { lmBar(G, P(a, 0.27, 1.25), P(a, 0.36, 0.95), 0.05, DARK); lmBar(G, P(a, 0.36, 0.95), P(a, 0.3, 0.55), 0.04, DARK); } }
    for (const s of [-1, 1]) { const x = cx + tu[0] * s * (L / 2 + 0.15), z = cz + tu[1] * s * (L / 2 + 0.15); lmLathe(G, x, z, 0.2, [[0.09, 0], [0.09, 0.7], [0.07, 0.75]], 8, YEL); lmLathe(G, x, z, 0.95, [[0.07, 0], [0.07, 0.12], [0, 0.14]], 8, DARK); }
    box(G, cx + tu[0] * (L / 2 - 0.5), cz + tu[1] * (L / 2 - 0.5), tu[0], tu[1], 0.2, 0.2, 0.2, 1.0, hb('#4c5156'));
    if (cols) for (const s of L > 4 ? [-1, 1] : [0]) { const a = s * Math.max(0, L / 2 - 1.1), x = cx + tu[0] * a, z = cz + tu[1] * a;
      if (B.round) lmLathe(G, x, z, 0.2, [[0.21, 0], [0.21, y0 - 0.2]], 12, hb(B.post)); else box(G, x, z, tu[0], tu[1], 0.22, 0.22, 0.2, y0, hb(B.post)); COL.add(x, z, x + 0.01, z, 0.25, 0); }
    return [tu, tn];
  }
  // the shop: glazed towards the forecourt with the door, walls in the brand's colour elsewhere, a fascia with the name
  function shop(r, B, toward) {
    const n = r.length >> 1, H = 4.3, W = hb(B.wall), es = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, e = edgeN(r, i), mx = (r[2 * i] + r[2 * j]) / 2, mz = (r[2 * i + 1] + r[2 * j + 1]) / 2, dx = toward[0] - mx, dz = toward[1] - mz, dl = Math.hypot(dx, dz) || 1;
      es.push({ i, j, e, mx, mz, face: (e[0] * dx + e[1] * dz) / dl }); }
    const front = es.filter(o => o.e[2] > 2.5).sort((a, b) => b.face - a.face)[0], glazed = o => o.e[2] > 2.5 && (o === front || (o.face > 0.55 && o.e[2] > 4));
    for (const o of es) { const P = [r[2 * o.i], r[2 * o.i + 1]], Q = [r[2 * o.j], r[2 * o.j + 1]], e = o.e, quad = (y0, y1, c) => polyA(G, [[P[0], y0, P[1]], [Q[0], y0, Q[1]], [Q[0], y1, Q[1]], [P[0], y1, P[1]]], c, e[0], 0, e[1]);
      if (o.e[2] < 0.05) continue;
      if (!glazed(o)) { quad(0, H, W); continue; }
      quad(3.05, H, W); quad(0, 0.15, sh(W, 0.8));
      const m = Math.max(1, Math.round((e[2] - 0.4) / 1.5)), dpanel = o === front ? Math.round((m - 1) / 2) : -1;
      for (let k = 0; k < m; k++) { const a = 0.2 + (e[2] - 0.4) * k / m, b = 0.2 + (e[2] - 0.4) * (k + 1) / m, pa = [P[0] + (Q[0] - P[0]) * a / e[2] + e[0] * 0.01, P[1] + (Q[1] - P[1]) * a / e[2] + e[1] * 0.01], pb = [P[0] + (Q[0] - P[0]) * b / e[2] + e[0] * 0.01, P[1] + (Q[1] - P[1]) * b / e[2] + e[1] * 0.01];
        tile(k === dpanel ? 'stShopDoor' : 'mallGlass', pa, pb, 0.15, 3.05, [e[0], e[1]], k === dpanel || lr() < 0.85);
        lmBar(G, [pa[0] + e[0] * 0.03, 0.15, pa[1] + e[1] * 0.03], [pa[0] + e[0] * 0.03, 3.05, pa[1] + e[1] * 0.03], 0.07, DARK); }
      quad(0.15, 3.05, sh(W, 0.6));
    }
    const fr = offsetRing(r, 0.07); vband(FA, fr, H - 0.85, H + 0.3, B.ink ? WHITE : hb(B.band)); if (B.ink) vband(FA, offsetRing(r, 0.075), H - 0.85, H - 0.65, hb(B.band));
    band(G, r, fr, H - 0.85, sh(W, 0.7), true); flatPlain(G, [r], H + 0.15, hb('#7d7f81'), false); band(G, offsetRing(r, -0.02), fr, H + 0.3, hb('#9a9c9e'), false);
    if (B.sign && front) { const t = FUS[B.sign], e = front.e, w = Math.min(e[2] * 0.7, 0.55 * t.a), rt = [e[1], -e[0]], o = 0.1, ya = H - 0.62 + (B.ink ? 0.04 : 0), yb = ya + Math.min(0.55, w / t.a);
      const P = (s, y) => [front.mx + rt[0] * s + e[0] * o, y, front.mz + rt[1] * s + e[1] * o]; sign(B.sign, P(-w / 2, ya), P(w / 2, ya), P(w / 2, yb), P(-w / 2, yb), [e[0], 0, e[1]]); }
    const c = fuelCen(r); box(G, c[0], c[1], 1, 0, 0.7, 0.5, H + 0.15, H + 0.85, hb('#b5b7b9'));
    lmRegisterOutline([0, 0, 1, 0], Array.from({ length: n }, (_, i) => [r[2 * i], r[2 * i + 1]]), 2, true);
  }
  // the totem: plinth, the brand on top, the price board, turned to face along the nearest street
  function totem(x, z, B, board) {
    let best = null, bd = 1e9; for (const big of [true, false]) { if (best) break; ROAD.near(x, z, 60, (id, d) => { if (big && ROAD.s[id * 6 + 4] < 4) return; if (d < bd) { bd = d; best = id; } }); }
    let f = [1, 0]; if (best !== null) { const s = ROAD.s, dx = s[best * 6 + 2] - s[best * 6], dz = s[best * 6 + 3] - s[best * 6 + 1], l = Math.hypot(dx, dz) || 1; f = [dx / l, dz / l]; }
    const rt = [f[1], -f[0]], Wd = 2.0, Dp = 0.42, Ht = 6.4, C0 = hb(B.totem);
    box(G, x, z, rt[0], rt[1], Wd / 2 + 0.12, Dp / 2 + 0.1, 0, 0.45, GREY); box(FA, x, z, rt[0], rt[1], Wd / 2, Dp / 2, 0.45, Ht, C0);
    if (B.ink) box(FA, x, z, rt[0], rt[1], Wd / 2 - 0.08, Dp / 2 + 0.02, Ht - 1.25, Ht - 0.12, WHITE);
    for (const s of [-1, 1]) { const n = [f[0] * s, f[1] * s], r2 = [n[1], -n[0]], o = Dp / 2 + 0.04, P = (a, y) => [x + r2[0] * a + n[0] * o, y, z + r2[1] * a + n[1] * o];
      if (B.sign) { const t = FUS[B.sign], w = Wd - 0.3, h = w / t.a, y = Ht - 0.7 - h / 2; sign(B.sign, P(-w / 2, y), P(w / 2, y), P(w / 2, y + h), P(-w / 2, y + h), [n[0], 0, n[1]]); }
      const t = FUS[board], bw = 1.6, bh = bw / t.a, y0 = Ht - 1.45 - bh; sign(board, P(-bw / 2, y0), P(bw / 2, y0), P(bw / 2, y0 + bh), P(-bw / 2, y0 + bh), [n[0], 0, n[1]]); }
    COL.add(x - rt[0] * Wd / 2, z - rt[1] * Wd / 2, x + rt[0] * Wd / 2, z + rt[1] * Wd / 2, Dp / 2, 0);
  }
  // self-service car wash bays under a canopy: partitions across, a lance post in each bay
  function wash(r, B) {
    const E = canopy(r, B, 3.5, 0.7, null), q = (u, v) => [E.tu[0] * u + E.tn[0] * v, E.tu[1] * u + E.tn[1] * v], Lu = E.u1 - E.u0, bays = Math.max(1, Math.round(Lu / 4.8));
    for (let k = 0; k <= bays; k++) { const u = E.u0 + 0.1 + (Lu - 0.2) * k / bays, c = q(u, (E.v0 + E.v1) / 2); box(G, c[0], c[1], E.tn[0], E.tn[1], (E.v1 - E.v0) / 2 - 0.3, 0.08, 0, 3.45, hb('#d7d8d6')); }
    for (let k = 0; k < bays; k++) { const u = E.u0 + (Lu) * (k + 0.5) / bays, c = q(u + Lu / bays * 0.38, E.v0 + 0.8); box(G, c[0], c[1], E.tu[0], E.tu[1], 0.18, 0.15, 0, 1.6, hb(B.disp)); }
  }
  for (const S of FUEL) {
    const B = FUEL_BRANDS[S.b], cv = S.c ? fuelRing(S, S.c) : null, sr = S.s ? fuelRing(S, S.s) : null;
    if (S.p) ground(asph, fuelRing(S, S.p), hb('#5d5e60')); else if (cv) ground(asph, offsetRing(cv, 7), hb('#5d5e60'));   // no plot mapped: the forecourt round the canopy
    if (cv) ground(conc, cv, hb('#a19e97'));
    // everything above the ground stands level at the highest ground under the canopy (or at the node), like the houses
    let base = TERR.on ? terrainH(S.at[0], S.at[1]) : 0; if (TERR.on && cv) for (let k = 0; k < cv.length; k += 2) base = Math.max(base, terrainH(cv[k], cv[k + 1]));
    STATE.GBC = TERR.on ? (x, y, z) => y <= 0.05 ? 0 : base - terrainH(x, z) : null;
    const y0 = 4.7;
    if (cv) { canopy(cv, B, y0, 1.0, sr); for (const isl of S.i || []) island(fuelW(S, [isl[0], isl[1]]), fuelW(S, [isl[2], isl[3]]), B, y0); }
    if (S.mini) {   // only a point in OSM, on the corner of a building: one island under a small canopy between it and the street
      const cand = []; ROAD.near(S.at[0], S.at[1], 60, (id, d, px, pz) => { const s = ROAD.s, dx = s[id * 6 + 2] - s[id * 6], dz = s[id * 6 + 3] - s[id * 6 + 1], l = Math.hypot(dx, dz) || 1; cand.push([d, px, pz, dx / l, dz / l]); });
      cand.sort((a, b) => a[0] - b[0]); const at = (q, k) => [S.at[0] + (q[1] - S.at[0]) * k, S.at[1] + (q[2] - S.at[1]) * k];
      const q = cand.find(o => o[0] > 6 && !inBuilding(...at(o, 0.5)) && !inBuilding(...at(o, Math.min(7.5, o[0] - 5) / o[0]))) || cand[0] || [10, S.at[0] + 10, S.at[1], 1, 0];
      const f = [q[3], q[4]], c = at(q, Math.min(7.5, Math.max(0, q[0] - 5)) / (q[0] || 1));
      const r = rectRing(c, f, 3.5, 2.6); canopy(r, B, 4.3, 0.8, null, false); ground(conc, r, hb('#a19e97')); island([c[0] - f[0] * 2.2, c[1] - f[1] * 2.2], [c[0] + f[0] * 2.2, c[1] + f[1] * 2.2], B, 4.3);
    }
    if (sr) shop(sr, B, cv ? fuelCen(cv) : S.at);
    for (const w of S.w || []) wash(fuelRing(S, w), FUEL_BRANDS[S.wb || S.b]);   // wb: a wash run by someone else
    for (const rr of S.r || []) { const r = fuelRing(S, rr), E = canopy(r, B, 3.2, 0.5, null, false), q = (u, v) => [E.tu[0] * u + E.tn[0] * v, E.tu[1] * u + E.tn[1] * v];
      for (const [u, v] of [[E.u0 + 0.4, E.v0 + 0.4], [E.u1 - 0.4, E.v0 + 0.4], [E.u1 - 0.4, E.v1 - 0.4], [E.u0 + 0.4, E.v1 - 0.4]]) { const c = q(u, v); box(G, c[0], c[1], 1, 0, 0.09, 0.09, 0, 3.2, hb(B.post)); } }
    if (S.lpg) {   // the self-service LPG dispenser of Latvijas Propāna Gāze beside the station, under its own small canopy
      const P = fuelW(S, S.lpg), I = S.i && S.i[0], f = I ? nrm([I[2] - I[0], I[3] - I[1]]) : [1, 0], r = rectRing(P, f, 1.9, 1.6), BL = FUEL_BRANDS.lpg;
      canopy(r, BL, 3.7, 0.6, null, false); ground(conc, r, hb('#a19e97')); island([P[0] - f[0] * 1.1, P[1] - f[1] * 1.1], [P[0] + f[0] * 1.1, P[1] + f[1] * 1.1], BL, 3.7, false);
      for (const s of [-1, 1]) box(G, P[0] + f[0] * s * 1.6, P[1] + f[1] * s * 1.6, f[0], f[1], 0.08, 0.08, 0, 3.7, hb(BL.post));
    }
    for (const t of S.t || []) { const [x, z] = fuelW(S, t); totem(x, z, B, S.b === 'lpg' || S.b === 'intergaz' ? 'fuP1' : S.g ? 'fuP4' : 'fuP3'); }
    const flagF = B.stripe ? [...B.bands.map(([c, s]) => [c, s * 0.7]), [B.stripe[0], 0.3]] : B.bands;
    for (const p of S.fl || []) { const [x, z] = fuelW(S, p); lmBar(G, [x, 0, z], [x, 8.6, z], 0.08, hb('#e2e2de')); lmLathe(G, x, z, 8.6, [[0, 0], [0.07, 0.04], [0.05, 0.11], [0, 0.15]], 8, hb('#c9cbcc')); spwFlag(G, x, z, 8.5, [0.94, 0.34], flagF); }
    for (const p of S.air || []) { const [x, z] = fuelW(S, p); box(G, x, z, 1, 0, 0.22, 0.17, 0, 1.25, hb(B.disp)); box(G, x, z, 1, 0, 0.24, 0.19, 1.25, 1.45, WHITE); }
    // gas tanks: horizontal white cylinders on saddles, Intergaz's in a fenced row; a yard of fuel tanks
    if (S.tk && S.tk.length) { const P = S.tk.map(p => fuelW(S, p)), d = nrm([P[P.length - 1][0] - P[0][0], P[P.length - 1][1] - P[0][1]]), a = [-d[1], d[0]];
      for (const [x, z] of P) { cyl([x - a[0] * 2.6, 1.25, z - a[1] * 2.6], [x + a[0] * 2.6, 1.25, z + a[1] * 2.6], 0.8, hb('#eef0ef')); for (const s of [-1.6, 1.6]) box(G, x + a[0] * s, z + a[1] * s, a[0], a[1], 0.2, 0.6, 0, 0.6, CON); }
      const c = [(P[0][0] + P[P.length - 1][0]) / 2, (P[0][1] + P[P.length - 1][1]) / 2], hl = Math.hypot(P[P.length - 1][0] - P[0][0], P[P.length - 1][1] - P[0][1]) / 2 + 1.6, fr = rectRing(c, d, hl, 3.6), m = fr.length >> 1;
      for (let i = 0; i < m; i++) { const j = (i + 1) % m, A = [fr[2 * i], fr[2 * i + 1]], Bq = [fr[2 * j], fr[2 * j + 1]], k = Math.max(1, Math.round(Math.hypot(Bq[0] - A[0], Bq[1] - A[1]) / 2.5));
        for (const y of [0.15, 1.1, 2.0]) lmBar(G, [A[0], y, A[1]], [Bq[0], y, Bq[1]], 0.04, hb('#8c9196')); for (let s = 0; s < k; s++) { const x = A[0] + (Bq[0] - A[0]) * s / k, z = A[1] + (Bq[1] - A[1]) * s / k; lmBar(G, [x, 0, z], [x, 2.05, z], 0.06, hb('#8c9196')); } COL.add(A[0], A[1], Bq[0], Bq[1], 0, 0); } }
    for (const tw of S.tw || []) { const r = fuelRing(S, tw), E = ext(r), q = (u, v) => { const c = fuelCen(r); return [c[0] + E.tu[0] * u + E.tn[0] * v, c[1] + E.tu[1] * u + E.tn[1] * v]; }, hu = (E.u1 - E.u0) / 2 - 0.6, rows = E.v1 - E.v0 > 5.5 ? [-(E.v1 - E.v0) / 4, (E.v1 - E.v0) / 4] : [0], rad = Math.min(1.35, (E.v1 - E.v0) / rows.length * 0.36);
      for (const v of rows) { const A = q(-hu, v), Bq = q(hu, v); cyl([A[0], rad + 0.5, A[1]], [Bq[0], rad + 0.5, Bq[1]], rad, hb('#e9ebea')); for (const s of [-0.7, 0, 0.7]) { const c = q(hu * s, v); box(G, c[0], c[1], E.tn[0], E.tn[1], rad * 0.8, 0.25, 0, 0.6, CON); } } }
    STATE.GBC = null;
  }
  const gm = (b, mat, order) => { const m = b.mesh(mat); if (m) { m.renderOrder = order; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } };
  gm(asph, M_ASPH, -37.4); gm(conc, M_PAVE, -33.9);   // the plots under the sidewalks and service roads, the slabs under the canopies over them
  TX.mesh(LMM.fuTxt, false); { const m = L.mesh(LMM.fuLamp); if (m) scene.add(m); } { const m = FA.mesh(LMM.fuFascia); if (m) { m.castShadow = m.receiveShadow = true; scene.add(m); } }
  { const pos = [], uv = [], idx = []; for (const [x, z, h] of pools) { const k = pos.length / 3; pos.push(x - h, 0.07, z - h, x + h, 0.07, z - h, x + h, 0.07, z + h, x - h, 0.07, z + h); uv.push(0, 0, 1, 0, 1, 1, 0, 1); idx.push(k, k + 2, k + 1, k, k + 3, k + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(1.0, 0.94, 0.82), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.renderOrder = 5; m.frustumCulled = false; m.visible = false; scene.add(m); FUEL_POOLS = m; }
}
let FUEL_POOLS = null;

export { FUEL_POOLS, fuelCen, fuelDrops, fuelNoTree, lmFuel };
