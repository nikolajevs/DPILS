// Minimal ESRI Shapefile + DBF reader (polygons only) and LKS-92/LKS-2020 TM → WGS84 conversion.
const fs = require('fs');

function readDbf(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(4), hlen = b.readUInt16LE(8), rlen = b.readUInt16LE(10);
  const fields = [];
  for (let o = 32; b[o] !== 0x0d; o += 32) {
    let name = b.toString('latin1', o, o + 11); name = name.slice(0, name.indexOf('\0') < 0 ? 11 : name.indexOf('\0'));
    fields.push({ name, type: String.fromCharCode(b[o + 11]), len: b[o + 16] });
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    let o = hlen + i * rlen + 1; const r = {};
    for (const f of fields) { const s = b.toString('utf8', o, o + f.len).trim(); r[f.name] = f.type === 'N' || f.type === 'F' ? (s === '' ? null : +s) : s; o += f.len; }
    rows.push(r);
  }
  return { fields, rows };
}

function readShpPolygons(file) {
  const b = fs.readFileSync(file); const out = []; let o = 100;
  while (o < b.length) {
    const len = b.readInt32BE(o + 4) * 2; const c = o + 8; const type = b.readInt32LE(c);
    if (type === 5 || type === 15 || type === 25) {
      const np = b.readInt32LE(c + 36), nt = b.readInt32LE(c + 40), parts = [];
      for (let i = 0; i < np; i++) parts.push(b.readInt32LE(c + 44 + 4 * i));
      const p0 = c + 44 + 4 * np, rings = [];
      for (let i = 0; i < np; i++) {
        const s = parts[i], e = i + 1 < np ? parts[i + 1] : nt, r = [];
        for (let k = s; k < e; k++) r.push([b.readDoubleLE(p0 + 16 * k), b.readDoubleLE(p0 + 16 * k + 8)]);
        rings.push(r);
      }
      out.push(rings);
    } else out.push(null);
    o = c + len;
  }
  return out;
}

// Inverse transverse Mercator on GRS80: central meridian 24°, k0 0.9996, FE 500000, FN -6000000
function lksToWgs(E, N) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = 24 * Math.PI / 180;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), x = E - 500000, y = N + 6000000;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2);
  const R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}

module.exports = { readDbf, readShpPolygons, lksToWgs };
