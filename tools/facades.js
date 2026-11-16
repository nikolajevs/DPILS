#!/usr/bin/env node
/* Street photographs of the apartment blocks of a district, for drawing their façades: for each long side of each block
   the Mapillary photograph that looks at it best, put together on contact sheets with the address and the side.

   Usage: node tools/facades.js <citydata.js> <out dir> --relation <OSM id> map1.osm map2.osm …
   - the district is the boundary relation of OpenStreetMap (e.g. 5464161, Ķīmiķu ciemats), read from the maps, which
     also give the addresses of the blocks (the OSM API squares of README.md, «Как обновить parking.js», will do);
   - the blocks are the houses of citydata.js flagged as apartment blocks with their centre inside the district;
   - the photographs come from the Mapillary API (graph.mapillary.com; the key goes in the Authorization header, which
     the cloud environment's proxy adds — see docs/tools-and-sources.md): within 12–70 m in front of the side, looking
     at its middle (±35°), the newest first; a panorama is cut to the quarter that looks at the side.
   Writes <out dir>/houses.json (the blocks: citydata id, address, centre, axes, sides, the photographs chosen), the
   photographs as <id>_<side>.jpg and the sheets sheet-NN.jpg (3 × 3, labelled). Needs curl and ImageMagick. */
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const args = process.argv.slice(2), ri = args.indexOf('--relation');
const [cityFile, outDir] = args, relId = ri >= 0 ? args[ri + 1] : null, osmFiles = args.filter((a, i) => i > 1 && a !== '--relation' && i !== ri + 1);
if (!cityFile || !outDir || !relId) { console.error('usage: node tools/facades.js <citydata.js> <out dir> --relation <id> map.osm …'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const city = fs.readFileSync(cityFile, 'utf8'), num = k => +city.slice(0, 400).match(new RegExp('"' + k + '":(-?[0-9.e+-]+)'))[1];
const LAT0 = num('lat0'), LON0 = num('lon0'), KX = num('kx'), KY = num('ky');
const toXZ = (lon, lat) => [(lon - LON0) * KX, (LAT0 - lat) * KY], toLL = (x, z) => [LON0 + x / KX, LAT0 - z / KY];
const pip = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };

// ---- the maps: nodes, ways with an address, the relation
const nodes = new Map(), addrWays = [], ways = new Map(); let members = null;
for (const f of osmFiles) {
  const xml = fs.readFileSync(f, 'utf8');
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g)) if (!nodes.has(m[1])) nodes.set(m[1], toXZ(+m[3], +m[2]));
  for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) { if (ways.has(m[1])) continue; const refs = [...m[2].matchAll(/<nd ref="(\d+)"/g)].map(r => r[1]); ways.set(m[1], refs);
    const st = m[2].match(/k="addr:street" v="([^"]*)"/), hn = m[2].match(/k="addr:housenumber" v="([^"]*)"/); if (st && /k="building"/.test(m[2])) addrWays.push({ refs, a: st[1] + ' ' + (hn ? hn[1] : '') }); }
  if (!members) { const r = xml.match(new RegExp('<relation id="' + relId + '"[^>]*>([\\s\\S]*?)</relation>')); if (r) members = [...r[1].matchAll(/<member type="way" ref="(\d+)" role="(outer|)"/g)].map(m => m[1]); }
}
if (!members) { console.error('relation', relId, 'is not in the maps'); process.exit(1); }
const segs = members.map(id => ways.get(id)).filter(Boolean).map(s => s.slice()); let cur = segs.shift();
while (segs.length) { const k = segs.findIndex(s => s[0] === cur[cur.length - 1] || s[s.length - 1] === cur[cur.length - 1]); if (k < 0) break; const s = segs.splice(k, 1)[0]; cur = cur.concat(s[0] === cur[cur.length - 1] ? s.slice(1) : s.slice().reverse().slice(1)); }
const district = cur.map(n => nodes.get(n)).filter(Boolean);
const addrs = addrWays.map(w => ({ a: w.a, p: w.refs.map(n => nodes.get(n)).filter(Boolean) })).filter(w => w.p.length > 2);

// ---- the blocks
const C = JSON.parse(city.slice(city.indexOf('{'), city.lastIndexOf('}') + 1));
const dec = a => { const o = []; let x = 0, z = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; z += a[i + 1]; o.push([x / 10, z / 10]); } return o; };
function obb(p) {
  let best = null;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; let dx = p[j][0] - p[i][0], dz = p[j][1] - p[i][1]; const l = Math.hypot(dx, dz); if (l < 0.4) continue; dx /= l; dz /= l;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const [x, z] of p) { const u = x * dx + z * dz, v = -x * dz + z * dx; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0); if (!best || A < best.A) best = { A, dx, dz, u0, u1, v0, v1 }; }
  const { dx, dz, u0, u1, v0, v1 } = best, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2; let a = (u1 - u0) / 2, b = (v1 - v0) / 2, ux = dx, uz = dz; if (b > a) { [a, b] = [b, a]; ux = -dz; uz = dx; }
  return { cx: cu * dx - cv * dz, cz: cu * dz + cv * dx, ux, uz, a, b };
}
const houses = [];
C.b.forEach((rec, id) => {
  if (!(rec[6] & 2)) return; const p = dec(rec[7]); let cx = 0, cz = 0; for (const [x, z] of p) { cx += x / p.length; cz += z / p.length; } if (!pip(cx, cz, district)) return;
  const o = obb(p), inA = addrs.filter(w => pip(cx, cz, w.p)).map(w => w.a);
  // the sides: the outward normal (vx, vz) of the side sv = ±1, as [sv, the middle of the side, its normal]; named by the compass
  const vx = -o.uz, vz = o.ux, sides = [-1, 1].map(sv => { const nx = vx * sv, nz = vz * sv, b = (Math.atan2(nx, -nz) * 180 / Math.PI + 360) % 360; return { sv, mx: o.cx + nx * o.b, mz: o.cz + nz * o.b, nx, nz, name: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8] }; });
  houses.push({ id, addr: inA.join(' / '), x: +cx.toFixed(1), z: +cz.toFixed(1), fl: rec[5], cx: o.cx, cz: o.cz, ux: o.ux, uz: o.uz, L: 2 * o.a, D: 2 * o.b, sides });
});
houses.sort((a, b) => (a.addr || '~').localeCompare(b.addr || '~', 'lv'));
console.log(houses.length, 'blocks in the district');

// ---- the photographs
const get = url => execFileSync('curl', ['-sS', '--max-time', '60', url], { maxBuffer: 64 << 20 });
for (const h of houses) {
  const r = h.L / 2 + 75, [w, s] = toLL(h.cx - r, h.cz + r), [e, n] = toLL(h.cx + r, h.cz - r);
  let imgs = [];
  for (let t = 0; t < 3 && !imgs.length; t++) { try { const d = JSON.parse(get(`https://graph.mapillary.com/images?bbox=${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)}&fields=id,captured_at,compass_angle,computed_compass_angle,computed_geometry,is_pano,thumb_1024_url&limit=2000`)); imgs = d.data || []; if (d.error) throw new Error(d.error.message); } catch (err) { if (t === 2) console.warn(h.addr, err.message); } }
  for (const sd of h.sides) {
    let best = null;
    for (const im of imgs) {
      const g = im.computed_geometry && im.computed_geometry.coordinates; if (!g || !im.thumb_1024_url) continue;
      const [x, z] = toXZ(g[0], g[1]), dx = x - sd.mx, dz = z - sd.mz, front = dx * sd.nx + dz * sd.nz, along = Math.abs(dx * h.ux + dz * h.uz), d = Math.hypot(dx, dz);
      if (front < 12 || d > 70 || along > h.L / 2 + 15) continue;
      const toward = (Math.atan2(-dx, dz) * 180 / Math.PI + 360) % 360, head = im.computed_compass_angle ?? im.compass_angle, off = Math.abs(((head - toward) % 360 + 540) % 360 - 180);
      if (!im.is_pano && off > 35) continue;
      const year = new Date(im.captured_at).getFullYear(), score = (year >= 2020 ? 0 : 40) - year * 2 + (im.is_pano ? 12 : off * 0.4) + Math.abs(d - 30) * 0.3 + along * 0.15;
      if (!best || score < best.score) best = { score, id: im.id, url: im.thumb_1024_url, year, pano: !!im.is_pano, off: ((toward - head) % 360 + 360) % 360, d: Math.round(d) };
    }
    if (!best) continue;
    const f = path.join(outDir, `${h.id}_${sd.name}.jpg`);
    try { fs.writeFileSync(f, get(best.url));
      if (best.pano) execFileSync('convert', [f, '-gravity', 'NorthWest', '-crop', `25%x100%+${Math.round(((best.off / 360 + 0.375) % 1) * 1024)}+0`, '+repage', f]);
      sd.photo = { id: best.id, year: best.year, d: best.d, pano: best.pano, file: path.basename(f) }; } catch (err) { console.warn(h.addr, sd.name, err.message); }
  }
  process.stdout.write('.');
}
console.log();
fs.writeFileSync(path.join(outDir, 'houses.json'), JSON.stringify(houses, null, 1));
// ---- the sheets: 3 × 3 photographs with the address and the side
const shots = []; for (const h of houses) for (const sd of h.sides) if (sd.photo) shots.push([path.join(outDir, sd.photo.file), `${h.id} ${h.addr || '?'} ${sd.name} ${sd.photo.year}${sd.photo.pano ? ' pano' : ''} ${sd.photo.d}m`]);
for (let k = 0; k * 9 < shots.length; k++) {
  const part = shots.slice(k * 9, k * 9 + 9), a = ['-pointsize', '15', '-background', '#222', '-fill', '#fff'];
  for (const [f, label] of part) a.push('-label', label, f);
  a.push('-tile', '3x3', '-geometry', '512x384+3+3', path.join(outDir, `sheet-${String(k + 1).padStart(2, '0')}.jpg`));
  execFileSync('montage', a);
}
console.log(`${shots.length} photographs of ${houses.length * 2} sides, ${Math.ceil(shots.length / 9)} sheets in ${outDir}`);
