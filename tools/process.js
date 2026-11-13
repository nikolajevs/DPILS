// Turns raw OpenStreetMap (Overpass JSON) + Latvian cadastre buildings into the compact city file
// the 3D viewer loads (citydata.js).
// usage: node process.js <osmDir> <cadastre.json|-> <out citydata.js>
const fs = require('fs');
const [dir, cadFile, outFile] = process.argv.slice(2);

let B = JSON.parse(fs.readFileSync(dir + '/build.json', 'utf8')).elements;
let R = JSON.parse(fs.readFileSync(dir + '/rest.json', 'utf8')).elements;
// relations downloaded separately with full member geometry replace the member-less copies
if (fs.existsSync(dir + '/rel.json')) {
  const REL = JSON.parse(fs.readFileSync(dir + '/rel.json', 'utf8')).elements;
  // building:part relations too: without them a building mapped only in parts (the former cinema Renesanse) vanishes
  const isB = e => e.tags && (e.tags.building || e.tags['building:part']);
  B = B.filter(e => e.type !== 'relation').concat(REL.filter(isB));
  R = R.filter(e => e.type !== 'relation').concat(REL.filter(e => e.tags && !isB(e)));
}
const CAD = cadFile && cadFile !== '-' ? JSON.parse(fs.readFileSync(cadFile, 'utf8')) : [];

const BB = { s: 55.825, w: 26.44, n: 55.94, e: 26.64 };
const LAT0 = (BB.s + BB.n) / 2, LON0 = (BB.w + BB.e) / 2;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110574 * 1.0065;
const px = lon => (lon - LON0) * KX;          // east  +x
const py = lat => -(lat - LAT0) * KY;         // south +z (stored as y)
const HX = (BB.e - LON0) * KX, HY = (BB.n - LAT0) * KY;
const proj = g => g.map(p => [px(p.lon), py(p.lat)]);

// ---------- helpers ----------
const names = [], nameIdx = new Map();
function nm(tags) {
  // streets keep the Latvian name that is on the street plates; other places prefer Russian
  const n = tags && (tags.highway ? tags.name : (tags['name:ru'] || tags.name));
  if (!n) return -1;
  if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); }
  return nameIdx.get(n);
}
function area(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; }
function centroid(r) { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; }
function bboxOf(r) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of r) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; }
function pip(pt, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function innerPoint(r) { // a point surely inside the polygon (centroid, or a scanline midpoint)
  const c = centroid(r); if (pip(c, r)) return c;
  const bb = bboxOf(r), y = (bb[1] + bb[3]) / 2, xs = [];
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
  xs.sort((a, b) => a - b); return xs.length >= 2 ? [(xs[0] + xs[1]) / 2, y] : c;
}
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let t = l2 ? ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const ex = pts[i][0] - ax - t * dx, ey = pts[i][1] - ay - t * dy, d = ex * ex + ey * ey;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol * tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function closedRing(pts) {
  if (pts.length > 1) { const a = pts[0], b = pts[pts.length - 1]; if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01) return pts.slice(0, -1); }
  return pts;
}
function simplifyRing(r, tol) {
  if (r.length < 5 || !tol) return r;
  let far = 0, fd = 0; for (let i = 1; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = dp(r.slice(0, far + 1), tol), b = dp(r.slice(far).concat([r[0]]), tol);
  const out = a.concat(b.slice(1, -1));
  return out.length >= 3 ? out : r;
}
function clipRing(r, x0, y0, x1, y1) { // Sutherland–Hodgman against a rectangle
  const edges = [[p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
  [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
  [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
  [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
  let out = r;
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (out.length < 3) return [];
  }
  return out;
}
function enc(r) { // delta-encoded decimetres
  const o = []; let lx = 0, ly = 0, first = true;
  for (const p of r) {
    const x = Math.round(p[0] * 10), y = Math.round(p[1] * 10);
    if (!first && x === lx && y === ly) continue;
    o.push(x - lx, y - ly); lx = x; ly = y; first = false;
  }
  return o;
}
function encRing(r) {
  const o = enc(r); const n = o.length / 2;
  if (n > 3) { let sx = 0, sy = 0; for (let i = 2; i < o.length; i += 2) { sx += o[i]; sy += o[i + 1]; } if (sx === 0 && sy === 0) o.length -= 2; }
  return o;
}
function stitch(ways) {
  const rings = []; const pool = ways.map(w => w.slice());
  const key = p => p[0].toFixed(2) + ',' + p[1].toFixed(2);
  while (pool.length) {
    let cur = pool.pop(), guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 5000) {
      const end = key(cur[cur.length - 1]); let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) { if (key(pool[i][0]) === end) { found = i; break; } if (key(pool[i][pool[i].length - 1]) === end) { found = i; rev = true; break; } }
      if (found < 0) break;
      const w = pool.splice(found, 1)[0]; if (rev) w.reverse();
      cur = cur.concat(w.slice(1));
    }
    if (cur.length >= 4) rings.push(closedRing(cur));
  }
  return rings;
}
function polysOf(e) {
  if (e.type === 'way') {
    if (!e.geometry || e.geometry.length < 4) return [];
    const g = e.geometry, a = g[0], b = g[g.length - 1];
    if (a.lat !== b.lat || a.lon !== b.lon) return [];
    return [{ outer: closedRing(proj(g)), holes: [] }];
  }
  if (e.type === 'relation' && e.members) {
    const o = [], inn = [];
    for (const m of e.members) { if (m.type !== 'way' || !m.geometry) continue; (m.role === 'inner' ? inn : o).push(proj(m.geometry)); }
    const outers = stitch(o).map(r => ({ outer: r, holes: [] })), inners = stitch(inn);
    for (const h of inners) { const c = h[0]; const host = outers.find(p => pip(c, p.outer)); if (host) host.holes.push(h); }
    return outers;
  }
  return [];
}
function obbAspect(r) {
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length]; let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy); if (l < 0.5) continue; dx /= l; dy /= l;
    let mnU = 1e9, mxU = -1e9, mnV = 1e9, mxV = -1e9;
    for (const p of r) { const u = p[0] * dx + p[1] * dy, v = -p[0] * dy + p[1] * dx; mnU = Math.min(mnU, u); mxU = Math.max(mxU, u); mnV = Math.min(mnV, v); mxV = Math.max(mxV, v); }
    const w = mxU - mnU, h = mxV - mnV; if (!best || w * h < best[0] * best[1]) best = [w, h];
  }
  return best ? [Math.min(best[0], best[1]), Math.max(best[0], best[1])] : [1, 1];
}
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }
const strHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ---------- cadastre index ----------
const cad = [];
for (const c of CAD) {
  if (/Ielas|ceļi|laukumi|cauruļvad|tīkli|Ūdensvad|Kanalizācija|tilti|Žog|žog|Estakād|Caurteka/.test((c.kind || '') + ' ' + (c.name || ''))) continue;
  const outer = closedRing(c.rings[0].map(([lon, lat]) => [px(lon), py(lat)]));
  if (outer.length < 3) continue;
  const A = Math.abs(area(outer)); if (A < 3) continue;
  const holes = c.rings.slice(1).map(r => closedRing(r.map(([lon, lat]) => [px(lon), py(lat)]))).filter(r => r.length >= 3 && Math.abs(area(r)) > 3);
  cad.push({ c, outer, holes, A, bb: bboxOf(outer), ip: innerPoint(outer), used: false });
}
const CG = 40, cgrid = new Map();
const ck = (i, j) => (i + 1000) * 4000 + (j + 1000);
cad.forEach((o, id) => { for (let i = Math.floor(o.bb[0] / CG); i <= Math.floor(o.bb[2] / CG); i++) for (let j = Math.floor(o.bb[1] / CG); j <= Math.floor(o.bb[3] / CG); j++) { let l = cgrid.get(ck(i, j)); if (!l) cgrid.set(ck(i, j), l = []); l.push(id); } });
function cadNear(bb) { const s = new Set(); for (let i = Math.floor(bb[0] / CG); i <= Math.floor(bb[2] / CG); i++) for (let j = Math.floor(bb[1] / CG); j <= Math.floor(bb[3] / CG); j++) { const l = cgrid.get(ck(i, j)); if (l) for (const id of l) s.add(id); } return s; }

// ---------- building classification ----------
// facade styles: 0 plaster (historic), 1 red brick, 2 silicate brick, 3 concrete panel, 4 modern / renovated plaster,
// 5 wood, 6 industrial, 7 plain outbuilding, 8 orthodox church, 9 catholic, 10 lutheran, 11 other worship,
// 12 canopy, 13 tank / silo, 14 greenhouse
// roof = shape * 16 + material. shape: 0 flat, 1 pitched. material: 0 unknown, 1 asbestos slate, 2 metal sheet,
// 3 clay tiles, 4 bitumen shingles, 5 flat membrane, 6 glass, 7 wooden shingles
// flags: 1 shop ground floor, 2 apartment block, 4 small outbuilding, 8 from cadastre only
const CENTER = [-1300, 1250];
function roofMat(s) {
  if (!s) return 0;
  if (/Azbest|Šķiedrcement/.test(s)) return 1;
  if (/Metāl|Tērauda|skārd/i.test(s)) return 2;
  if (/kārniņi/.test(s)) return 3;
  if (/Bitumena loksnes|šindeļ/.test(s)) return 4;
  if (/Ruberoīd|Polimēru|Sintētisko|bitumen|Bitumen/.test(s)) return 5;
  if (/Stikl/.test(s)) return 6;
  if (/Koka jumst|lubas|skaidas/.test(s)) return 7;
  return 0;
}
function classifyCad(a, A, seed) {
  const nk = (a.name || '') + ' | ' + (a.kind || ''), wall = a.wall || '', year = a.year || 0;
  let floors = a.floors > 0 ? a.floors : 1, style, flags = 0, fh = 2.9;
  const r = hash(seed), r2 = hash(seed + 7);
  const small = /šķūn|Šķūn|Garāž|garāž|Ateja|ateja|Siltumnīc|siltumnīc|Nojum|nojum|Pirts|pirts|Kūts|kūts|Pagrab|pagrab|Lapene|lapene|Malkas|Sarajs|saimniecības ēka|Saimniecības ēka|Dārza māj|dārza māj|Transformator|Kiosk|Tualet|Sūkņu/.test(nk) && floors <= 2;
  if (/Siltumnīc|siltumnīc/.test(a.name || '') || (/Stikla konstr/.test(wall) && A < 200)) return { style: 14, floors: 1, h: 2.6, roof: 16 + 6, flags: 4 };
  if (/Nojum|nojum|Lapene|lapene/.test(a.name || '') || /^Nojumes/.test(a.kind || '')) return { style: 12, floors: 1, h: 3, roof: 16 + roofMat(a.roof), flags: 4 };
  if (/rezervuār|tvertn|Tvertn|Rezervuār|Silos|silos/.test(nk)) return { style: 13, floors: 1, h: Math.max(6, a.height || 9), roof: 0, flags: 0 };
  if (/Kulta|baznīc|Baznīc|katedr|Katedr|Lūgšanu|lūgšanu/.test(nk)) return null; // let OSM tagging decide
  if (/Daudzdzīvokļu|dzīvokļu mājas|Dvīņu, rindu/.test(nk) && floors >= 2) flags |= 2;
  if (/Koka|Koks|koka/.test(wall) && !/Metāla/.test(wall)) { style = 5; fh = 2.9; }
  else if (/paneļ/.test(wall)) { style = r < 0.22 ? 4 : 3; fh = 2.8; }
  else if (/Ķieģeļ|Akmens|ķieģeļ/.test(wall)) {
    if (year && year < 1945) { style = r < 0.55 ? 1 : 0; fh = floors > 1 ? 3.8 : 3.4; }
    else if (floors >= 3) { style = r < 0.62 ? 2 : r < 0.8 ? 1 : 4; fh = 2.9; }
    else { style = r < 0.45 ? 0 : r < 0.72 ? 2 : 1; fh = 3.0; }
  }
  else if (/Vieglbetona|Arbolīt|gāzbeton|keramzīt/.test(wall)) { style = year >= 1995 ? 4 : (r < 0.5 ? 0 : 2); fh = 3.0; }
  else if (/Metāla karkas|Metāl/.test(wall)) { style = 6; fh = 4.5; }
  else if (/Stikl/.test(wall)) { style = 4; fh = 3.6; }
  else if (/Dzelzsbeton|betona|Monolīt|Betona/.test(wall)) { style = year >= 1995 ? 4 : floors >= 3 ? 3 : 6; fh = floors >= 3 ? 2.8 : 4; }
  else style = floors >= 3 ? (r < 0.5 ? 3 : 2) : (r < 0.5 ? 0 : 5);
  if (/Ražošanas|Noliktav|noliktav|Rūpnī|Darbnīc|darbnīc|Katlumāj|Smagās tehnikas|Dzelzceļa transporta|Angār/.test(nk) && style !== 5) { style = 6; fh = /lielāks par 6/.test(nk) ? 7.5 : 4.8; }
  if (small) { flags |= 4; if (style !== 5 && style !== 14) style = 7; fh = /Garāž|garāž/.test(nk) ? 2.7 : 2.6; }
  let h = floors * fh + (small ? 0 : 0.6);
  if (style === 6 && a.height > 3 && a.height < 40) h = a.height;
  const rm = roofMat(a.roof);
  let pitched;
  if (rm === 5) pitched = false;
  else if (rm) pitched = !((style === 3 || style === 2) && floors >= 4) && !(style === 6 && A > 1500);
  else pitched = style === 5 || style === 0 || style === 1 ? floors <= 4 : style === 7 ? r2 < 0.5 : false;
  if (style === 3 || (flags & 2 && floors >= 5)) pitched = rm === 1 || rm === 2 ? floors <= 5 && r2 < 0.25 : false;
  return { style, floors, h, roof: (pitched ? 16 : 0) + rm, flags };
}

// ---------- OSM buildings ----------
const SMALL = new Set(['garages', 'garage', 'shed', 'hut', 'kiosk', 'carport', 'service', 'bunker', 'toilets', 'container', 'cabin']);
const HOUSE = new Set(['house', 'detached', 'residential', 'semidetached_house', 'bungalow', 'terrace', 'farm', 'farm_auxiliary', 'barn', 'allotment_house']);
const INDUS = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'hangar', 'depot']);
const PUBLIC = new Set(['school', 'kindergarten', 'university', 'college', 'hospital', 'public', 'office', 'hotel', 'civic', 'government', 'dormitory', 'retail', 'commercial', 'supermarket', 'train_station', 'sports_hall', 'sports_centre', 'theatre', 'museum', 'fire_station', 'stadium', 'grandstand']);
const WORSHIP = new Set(['church', 'cathedral', 'chapel', 'temple', 'synagogue', 'mosque', 'monastery']);

const parts = [], outlines = [];
for (const e of B) {
  const t = e.tags || {}; const isPart = !!t['building:part'] && !t.building;
  for (const p of polysOf(e)) { if (Math.abs(area(p.outer)) < 4) continue; (isPart ? parts : outlines).push({ e, t, p, isPart }); }
}
const skip = new Set();
for (const pt of parts) { const c = centroid(pt.p.outer); for (const o of outlines) { if (!skip.has(o) && pip(c, o.p.outer)) { o.childParts = (o.childParts || 0) + 1; pt.parent = o; } } }
for (const o of outlines) if (o.childParts) skip.add(o);

function osmGuess(it, A, sh, lg, seed) {
  const t = it.isPart && it.parent ? Object.assign({}, it.parent.t, it.t) : it.t;
  const typ = t.building || t['building:part'] || 'yes', r = hash(seed), r2 = hash(seed + 3);
  let style = 0, floors = 1, flags = 0, fh = 3, pitched = false;
  if (t.amenity === 'place_of_worship' || WORSHIP.has(typ)) {
    const d = (t.denomination || '') + ' ' + (t.religion || '');
    style = /orthodox|old_believ/.test(d) ? 8 : /catholic/.test(d) ? 9 : /luther/.test(d) ? 10 : 11;
    return { style, floors: 1, h: Math.max(8, Math.min(17, sh * 0.8)), roof: 16 + 2, flags: 0, worship: true };
  }
  if (typ === 'roof') return { style: 12, floors: 1, h: 4.5, roof: 0, flags: 0 };
  if (typ === 'greenhouse') return { style: 14, floors: 1, h: 2.6, roof: 16 + 6, flags: 4 };
  if (typ === 'storage_tank' || typ === 'silo' || t.man_made === 'storage_tank') return { style: 13, floors: 1, h: typ === 'silo' ? 16 : 9, roof: 0, flags: 0 };
  if (SMALL.has(typ) || typ === 'transformer_tower') { style = 7; floors = 1; fh = typ === 'transformer_tower' ? 6 : 2.7; flags = 4; pitched = r < 0.3; }
  else if (HOUSE.has(typ)) { style = r < 0.45 ? 5 : r < 0.75 ? 0 : 2; floors = A > 140 && r2 < 0.4 ? 2 : 1; fh = 3; pitched = true; }
  else if (typ === 'apartments') { style = r < 0.5 ? 3 : 2; floors = lg > 60 && r2 < 0.2 ? 9 : 5; fh = 2.8; flags = 2; }
  else if (INDUS.has(typ)) { style = 6; floors = 1; fh = 6 + Math.floor(r * 4); }
  else if (PUBLIC.has(typ)) { style = r < 0.4 ? 2 : r < 0.7 ? 0 : 4; floors = typ === 'retail' || typ === 'supermarket' ? 1 : 3; fh = typ === 'retail' || typ === 'supermarket' ? 5 : 3.3; }
  else {
    if (A < 45) { style = 7; floors = 1; fh = 2.7; flags = 4; pitched = r < 0.4; }
    else if (A < 170) { style = r < 0.45 ? 5 : r < 0.75 ? 0 : 2; floors = 1; pitched = true; }
    else if (sh > 9 && sh < 17 && lg > 38 && A < 3500) { style = r < 0.5 ? 3 : 2; floors = 5; fh = 2.8; flags = 2; }
    else if (A < 700) { style = r < 0.4 ? 0 : r < 0.7 ? 1 : 2; floors = 2 + Math.floor(r2 * 2); fh = 3.4; pitched = r2 < 0.7; }
    else { style = r < 0.5 ? 6 : 2; floors = 3; fh = 3.2; }
  }
  if (t.historic || t.heritage) { if (style !== 5 && style < 7) style = r < 0.6 ? 1 : 0; pitched = true; fh = 3.8; }
  const lv = parseFloat(t['building:levels']);
  if (lv > 0) { floors = Math.round(lv); if (style === 7 && floors >= 2) style = 2; if (floors >= 5 && pitched) pitched = false; }
  let h = floors * fh + (style === 7 ? 0 : 0.6);
  const th = parseFloat(t.height); if (th > 0) h = th;
  const rs = t['roof:shape']; if (rs) pitched = rs !== 'flat';
  return { style, floors, h, roof: pitched ? 16 : 0, flags };
}

const bOut = [], places = [];
const styleCnt = {}; let matched = 0;
for (const it of outlines.concat(parts)) {
  if (skip.has(it)) { const c = centroid(it.p.outer); const n = nm(it.t); if (n >= 0) places.push([n, Math.round(c[0]), Math.round(c[1])]); continue; }
  const { e, p } = it; const t = it.isPart && it.parent ? Object.assign({}, it.parent.t, it.t) : it.t;
  const A = Math.abs(area(p.outer)); const [sh, lg] = obbAspect(p.outer); const seed = e.id * 31 + (it.isPart ? 7 : 0);
  // match to cadastre: OSM inner point inside a cadastral outline, or cadastral inner points inside OSM outline
  let best = null; const ip = innerPoint(p.outer), bb = bboxOf(p.outer);
  for (const id of cadNear(bb)) {
    const c = cad[id]; let hit = false;
    if (pip(c.ip, p.outer)) { hit = true; c.used = true; }
    else if (c.bb[0] <= ip[0] && ip[0] <= c.bb[2] && c.bb[1] <= ip[1] && ip[1] <= c.bb[3] && pip(ip, c.outer)) { hit = true; c.used = true; }
    if (hit && (!best || c.A > best.A)) best = c;
  }
  let info = null;
  const worshipTag = t.amenity === 'place_of_worship' || WORSHIP.has(t.building);
  if (best && !worshipTag && !it.isPart) info = classifyCad(best.c, A, seed);
  if (info) matched++; else info = osmGuess(it, A, sh, lg, seed);
  // explicit OSM heights win over estimates
  const lv = parseFloat(t['building:levels']), th = parseFloat(t.height);
  if (th > 0) info.h = th; else if (lv > 0 && !(best && best.c.floors > 0)) info.h = lv * (info.h / Math.max(1, info.floors)), info.floors = Math.round(lv);
  let mh = parseFloat(t.min_height) || 0; const ml = parseFloat(t['building:min_level']); if (!mh && ml > 0) mh = ml * 3.1;
  if (mh >= info.h) mh = 0;
  const n = it.isPart ? -1 : nm(t);
  const c = centroid(p.outer);
  if (n >= 0) places.push([n, Math.round(c[0]), Math.round(c[1])]);
  if ((info.style <= 2 || info.style === 4) && info.floors >= 2 && Math.hypot(c[0] - CENTER[0], c[1] - CENTER[1]) < 1100 && hash(seed + 11) < 0.55) info.flags |= 1;
  const rec = [info.style, Math.round(info.h * 10), Math.round(mh * 10), n, info.roof, info.floors, info.flags, encRing(p.outer)];
  for (const hl of p.holes) if (Math.abs(area(hl)) > 3) rec.push(encRing(hl));
  if (rec[7].length >= 6) { bOut.push(rec); styleCnt[info.style] = (styleCnt[info.style] || 0) + 1; }
}
// cadastre buildings that OpenStreetMap does not have
const osmIdx = new Map(); const OG = 40;
bOut.forEach((rec, id) => {
  let x = 0, y = 0; const r = rec[7]; const pts = []; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; pts.push([x / 10, y / 10]); }
  rec._pts = pts; const bb = bboxOf(pts);
  for (let i = Math.floor(bb[0] / OG); i <= Math.floor(bb[2] / OG); i++) for (let j = Math.floor(bb[1] / OG); j <= Math.floor(bb[3] / OG); j++) { const k = ck(i, j); let l = osmIdx.get(k); if (!l) osmIdx.set(k, l = []); l.push(id); }
});
let added = 0;
for (const c of cad) {
  if (c.used) continue;
  const [x, y] = c.ip; if (Math.abs(x) > HX || Math.abs(y) > HY) continue;
  const l = osmIdx.get(ck(Math.floor(x / OG), Math.floor(y / OG))) || [];
  let overl = false;
  for (const id of l) { const pts = bOut[id]._pts; if (pip(c.ip, pts) || pip(innerPoint(pts), c.outer)) { overl = true; break; } }
  if (overl) continue;
  const seed = strHash(c.c.code);
  const info = classifyCad(c.c, c.A, seed) || { style: 0, floors: 1, h: 6, roof: 16, flags: 0 };
  const rec = [info.style, Math.round(info.h * 10), 0, -1, info.roof, info.floors, info.flags | 8, encRing(simplifyRing(c.outer, 0.15))];
  for (const hl of c.holes) rec.push(encRing(hl));
  if (rec[7].length >= 6) { bOut.push(rec); added++; styleCnt[info.style] = (styleCnt[info.style] || 0) + 1; }
}
for (const r of bOut) delete r._pts;

// ---------- areas, lines ----------
// area classes: 0 water 1 forest 2 scrub 3 grass 4 park 5 cemetery 6 sand 7 farmland 8 residential 9 industrial 10 pitch 11 allotments 12 paved 13 playground
// line classes: 0 primary 1 secondary 2 tertiary 3 residential 4 service 5 pedestrian 6 footway 7 track 8 rail 9 tram 10 stream 11 river
//               12 wall 13 city wall 14 embankment 15 steps
const aOut = [], lOut = [], trees = [];
const M = 150, X0 = -HX - M, X1 = HX + M, Y0 = -HY - M, Y1 = HY + M;
function areaClass(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank') return 0;
  if (t.natural === 'wood' || t.landuse === 'forest') return 1;
  if (t.natural === 'scrub') return 2;
  if (t.natural === 'sand' || t.natural === 'beach') return 6;
  if (t.leisure === 'pitch') return 10;
  if (t.leisure === 'playground') return 13;
  if (t.leisure === 'park' || t.leisure === 'garden') return 4;
  if (t.leisure === 'stadium') return 3;
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'recreation_ground') return 3;
  if (t.landuse === 'cemetery') return 5;
  if (t.landuse === 'farmland') return 7;
  if (t.landuse === 'residential') return 8;
  if (t.landuse === 'industrial' || t.landuse === 'railway') return 9;
  if (t.landuse === 'allotments') return 11;
  if (t.highway && t.area === 'yes') return 12;
  return -1;
}
const TOL = { 0: 0.8, 1: 2, 2: 2, 3: 1, 4: 1, 5: 1.5, 6: 1.5, 7: 4, 8: 4, 9: 3, 10: 0.3, 11: 2, 12: 0.3, 13: 0.5 };
function lineClass(t) {
  const h = t.highway;
  if (h) {
    if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') return -1;
    if (h === 'trunk' || h === 'primary' || h === 'trunk_link' || h === 'primary_link') return 0;
    if (h === 'secondary' || h === 'secondary_link') return 1;
    if (h === 'tertiary' || h === 'tertiary_link') return 2;
    if (h === 'residential' || h === 'unclassified' || h === 'living_street') return 3;
    if (h === 'service') return 4;
    if (h === 'pedestrian') return 5;
    if (h === 'footway' || h === 'path' || h === 'cycleway' || h === 'platform') return 6;
    if (h === 'steps') return 15;
    if (h === 'track' || h === 'raceway') return 7;
    return -1;
  }
  if (t.railway === 'rail') return (t.tunnel === 'yes') ? -1 : 8;
  if (t.railway === 'tram') return 9;
  if (t.waterway) return (t.tunnel === 'yes' || t.tunnel === 'culvert') ? -1 : (t.waterway === 'river' || t.waterway === 'canal') ? 11 : 10;
  if (t.barrier === 'city_wall') return 13;
  if (t.barrier === 'wall') return 12;
  if (t.man_made === 'embankment') return 14;
  return -1;
}
let ptsA = 0, ptsL = 0;
for (const e of R) {
  const t = e.tags || {};
  if (e.type === 'node') { if (t.natural === 'tree') { const x = px(e.lon), y = py(e.lat); if (Math.abs(x) < HX && Math.abs(y) < HY) trees.push(Math.round(x * 10), Math.round(y * 10)); } continue; }
  const ac = areaClass(t);
  let usedAsArea = false;
  if (ac >= 0) {
    for (const p of polysOf(e)) {
      let o = clipRing(p.outer, X0, Y0, X1, Y1); if (o.length < 3) continue;
      o = simplifyRing(o, TOL[ac]); if (Math.abs(area(o)) < (ac === 8 || ac === 7 ? 400 : 6)) continue;
      const rec = [ac, encRing(o)];
      for (let h of p.holes) { h = clipRing(h, X0, Y0, X1, Y1); if (h.length < 3) continue; h = simplifyRing(h, TOL[ac]); if (Math.abs(area(h)) > 20) rec.push(encRing(h)); }
      if (rec[1].length >= 6) { aOut.push(rec); usedAsArea = true; for (let i = 1; i < rec.length; i++) ptsA += rec[i].length / 2; }
    }
  }
  if (e.type !== 'way' || !e.geometry) continue;
  if (usedAsArea && t.highway) continue;
  const lc = lineClass(t); if (lc < 0) continue;
  const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0;
  const g = proj(e.geometry);
  let run = [];
  const flush = () => { if (run.length >= 2) { const s = dp(run, lc >= 10 && lc <= 11 ? 0.6 : 0.25); const n = lc <= 7 ? nm(t) : -1; const c = enc(s); if (c.length >= 4) { lOut.push([lc, n, c, bridge]); ptsL += c.length / 2; } } run = []; };
  for (const p of g) { if (p[0] > X0 && p[0] < X1 && p[1] > Y0 && p[1] < Y1) run.push(p); else flush(); }
  flush();
}
for (const e of R) { const t = e.tags || {}; if (t.name && (t.historic || t.leisure === 'park' || t.leisure === 'stadium') && e.bounds) { const n = nm(t); places.push([n, Math.round(px((e.bounds.minlon + e.bounds.maxlon) / 2)), Math.round(py((e.bounds.minlat + e.bounds.maxlat) / 2))]); } }

const out = { lat0: LAT0, lon0: LON0, kx: KX, ky: KY, hx: Math.round(HX), hy: Math.round(HY), names, b: bOut, a: aOut, l: lOut, t: trees, p: places };
const js = 'window.CITY=' + JSON.stringify(out) + ';';
fs.writeFileSync(outFile, js);
console.log('buildings', bOut.length, '(cadastre-matched', matched + ', cadastre-only', added + ')', 'styles', JSON.stringify(styleCnt));
console.log('areas', aOut.length, 'pts', ptsA, 'lines', lOut.length, 'pts', ptsL, 'trees', trees.length / 2, 'names', names.length, 'places', places.length);
console.log('size MB', (js.length / 1e6).toFixed(2));
const fl = {}; for (const b of bOut) fl[b[5]] = (fl[b[5]] || 0) + 1; console.log('floors', JSON.stringify(fl));
const rf = {}; for (const b of bOut) rf[b[4]] = (rf[b[4]] || 0) + 1; console.log('roof codes', JSON.stringify(rf));
