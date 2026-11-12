// Builds a compact list of cadastral buildings (outline + floors, year, wall and roof material)
// from the Latvian State Land Service open data (data.gov.lv, CC BY 4.0).
// usage: node cadastre.js <out.json> <shp root dir>... -- <building xml>...
const fs = require('fs'), path = require('path');
const { readDbf, readShpPolygons, lksToWgs } = require('./shp.js');

const args = process.argv.slice(2), out = args.shift(), sep = args.indexOf('--');
const shpRoots = args.slice(0, sep), xmlFiles = args.slice(sep + 1);
const BB = { s: 55.825, w: 26.44, n: 55.94, e: 26.64 };

// ---------- attributes from XML ----------
const attr = new Map();
const tag = (s, t) => { const i = s.indexOf('<' + t + '>'); if (i < 0) return null; const j = s.indexOf('</' + t + '>', i); return s.slice(i + t.length + 2, j); };
function element(s, name) { // material of the ConstructionDataList block whose element name starts with `name`
  let i = 0;
  while ((i = s.indexOf('<ConstructionDataList>', i)) >= 0) {
    const en = s.indexOf('</ConstructionDataList>', i); if (en < 0) break;
    const blk = s.slice(i, en); i = en;
    const nm = tag(blk, 'BuildingElementName');
    if (nm && nm.startsWith(name)) { const m = tag(blk, 'MaterialKindName'); if (m) return m; }
  }
  return null;
}
function amount(s, kind) { // BuildingAmountQuantity of the BuildingAmountData with the given kind
  let i = 0;
  while ((i = s.indexOf('<BuildingAmountData>', i)) >= 0) {
    const en = s.indexOf('</BuildingAmountData>', i); if (en < 0) break;
    const blk = s.slice(i, en); i = en;
    if (tag(blk, 'AmountKindName') === kind) return +(tag(blk, 'BuildingAmountQuantity') || 0);
  }
  return 0;
}
for (const f of xmlFiles) {
  const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(1 << 24); let rest = '', n;
  while ((n = fs.readSync(fd, buf, 0, buf.length)) > 0) {
    rest += buf.toString('utf8', 0, n);
    let k, pos = 0;
    while ((k = rest.indexOf('</BuildingItemData>', pos)) >= 0) {
      const s = rest.slice(pos, k); pos = k + 19;
      const code = tag(s, 'BuildingCadastreNr'); if (!code) continue;
      attr.set(code, {
        name: tag(s, 'BuildingName') || '',
        floors: +(tag(s, 'BuildingGroundFloors') || 0),
        height: amount(s, 'Augstums'),
        year: +(tag(s, 'BuildingExploitYear') || 0),
        kind: tag(s, 'BuildingKindName') || tag(s, 'BuildingUseKindName') || '',
        wall: element(s, 'Sienas') || tag(tag(s, 'BuildingMaterialKind') || '', 'MaterialKindName') || '',
        roof: element(s, 'Jumta segums') || '',
        facade: element(s, 'Fasāde') || ''
      });
    }
    rest = rest.slice(pos);
  }
  fs.closeSync(fd);
}
console.log('attributes', attr.size);

// ---------- outlines from shapefiles ----------
function* shpFiles(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* shpFiles(p); else if (e.name === 'KKBuilding.shp') yield p; } }
const blds = []; let total = 0, noAttr = 0;
for (const root of shpRoots) for (const shp of shpFiles(root)) {
  const rows = readDbf(shp.replace(/\.shp$/, '.dbf')).rows, polys = readShpPolygons(shp);
  polys.forEach((rings, i) => {
    if (!rings) return; total++;
    const r = rings.map(ring => ring.map(([E, N]) => { const [lat, lon] = lksToWgs(E, N); return [+lon.toFixed(7), +lat.toFixed(7)]; }));
    const c = r[0][0]; if (c[1] < BB.s || c[1] > BB.n || c[0] < BB.w || c[0] > BB.e) return;
    const a = attr.get(rows[i].CODE); if (!a) noAttr++;
    blds.push(Object.assign({ code: rows[i].CODE, rings: r }, a || {}));
  });
}
console.log('outlines', total, 'in bbox', blds.length, 'without attributes', noAttr);
const cnt = k => { const m = {}; for (const b of blds) m[b[k]] = (m[b[k]] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 14).map(e => e.join(': ')).join(' | '); };
console.log('floors', cnt('floors')); console.log('wall', cnt('wall')); console.log('roof', cnt('roof'));
fs.writeFileSync(out, JSON.stringify(blds));
