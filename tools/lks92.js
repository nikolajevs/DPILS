#!/usr/bin/env node
/* Coordinates: the frame of the city (citydata.js: metres, x east, z south from 55.8825° N, 26.54° E), latitude and
   longitude (WGS84 / ETRS89), and LKS-92 TM (EPSG:3059), the Latvian grid of the LGIA data (terrain model, lidar
   point clouds, orthophotos): Transverse Mercator on GRS80, central meridian 24° E, scale 0.9996, false easting
   500 000 m, false northing −6 000 000 m; E is the easting, N the northing.

   As a module: const { toLKS, fromLKS, cityToLKS, lksToCity } = require('./lks92.js')
   On the command line: node tools/lks92.js city -1487 1263      (→ lat, lon and E, N)
                        node tools/lks92.js ll 55.8825 26.54
                        node tools/lks92.js lks 658875 195919
   The round trip is exact to the millimetre over the city. */
'use strict';
const LAT0 = 55.8825, LON0 = 26.54, KX = 62438.48464324681, KY = 111292.731;   // the frame of citydata.js
const a = 6378137.0, f = 1 / 298.257222101, k0 = 0.9996, L0 = 24 * Math.PI / 180, FE = 500000, FN = -6000000;
const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
const M = phi => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
  + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
function toLKS(lat, lon) {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180, s = Math.sin(phi), c = Math.cos(phi), N = a / Math.sqrt(1 - e2 * s * s), T = (s / c) ** 2, Cc = ep2 * c * c, A = (lam - L0) * c;
  const E = FE + k0 * N * (A + (1 - T + Cc) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * Cc - 58 * ep2) * A ** 5 / 120);
  const Nn = FN + k0 * (M(phi) + N * (s / c) * (A * A / 2 + (5 - T + 9 * Cc + 4 * Cc * Cc) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * Cc - 330 * ep2) * A ** 6 / 720));
  return [E, Nn];
}
function fromLKS(E, Nn) {
  const m = (Nn - FN) / k0, mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), N1 = a / Math.sqrt(1 - e2 * s * s), T1 = (s / c) ** 2, C1 = ep2 * c * c, R1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5, D = (E - FE) / (N1 * k0);
  const phi = p1 - (N1 * (s / c) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lam = L0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [phi * 180 / Math.PI, lam * 180 / Math.PI];
}
const cityToLL = (x, z) => [LAT0 - z / KY, LON0 + x / KX];
const llToCity = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KY];
const cityToLKS = (x, z) => toLKS(...cityToLL(x, z));
const lksToCity = (E, Nn) => llToCity(...fromLKS(E, Nn));
module.exports = { toLKS, fromLKS, cityToLL, llToCity, cityToLKS, lksToCity };

if (require.main === module) {
  const [kind, p, q] = process.argv.slice(2), u = +p, v = +q, r = n => n.toFixed(3);
  if (kind === 'city') { const [la, lo] = cityToLL(u, v), [E, Nn] = toLKS(la, lo); console.log(`lat ${la.toFixed(7)} lon ${lo.toFixed(7)}  LKS-92 E ${r(E)} N ${r(Nn)}`); }
  else if (kind === 'll') { const [E, Nn] = toLKS(u, v), [x, z] = llToCity(u, v); console.log(`LKS-92 E ${r(E)} N ${r(Nn)}  city x ${r(x)} z ${r(z)}`); }
  else if (kind === 'lks') { const [la, lo] = fromLKS(u, v), [x, z] = llToCity(la, lo); console.log(`lat ${la.toFixed(7)} lon ${lo.toFixed(7)}  city x ${r(x)} z ${r(z)}`); }
  else { console.error('usage: node tools/lks92.js city X Z | ll LAT LON | lks E N'); process.exit(1); }
}
