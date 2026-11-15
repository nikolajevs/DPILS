/* ---------- tags from OpenStreetMap that the city data do not keep ----------
   A line of citydata.js holds the class, the name and the shape of a street, but not the number of lanes or whether it
   is a town street or a country road. For 18. novembra iela they were read from OSM through Overpass (November 2026):

   - four lanes (lanes=4) from the overpass bridge east to the junction at x ≈ 1135; the two short pieces at the junction
     by x ≈ −20 carry no lanes tag but lie between four-lane ways;
   - west of the overpass the two one-way carriageways have two lanes each (lanes=2 on oneway ways); the two short
     pieces with a third, turning lane before the junction at x ≈ −660 are drawn with two;
   - one-way ramps of one lane at the end of Vienības tilts (below);
   - a country road (maxspeed=70 and no lit tag, the rest of the street is 50 km/h and mostly lit=yes) between x ≈ 2517 and
     3590 and between x ≈ 4405 and 4784: no kerbs, sidewalks or street lamps, gravel shoulders instead.

   A line is matched by its two ends, either way round, within 1.5 m: those are the ends of the OSM way (the data keep
   OSM ways whole). Each entry: the OSM way, its ends (x, z of one and the other), the tags. */
const TAGS = [
  [127382593, -1207, 1906, -694, 1705, { lanes: 2 }],
  [700553401, -716, 1689, -1199, 1895, { lanes: 2 }],
  [551378213, -705, 1684, -716, 1689, { lanes: 2 }],
  [700553402, -665, 1667, -705, 1684, { lanes: 2 }],   // lanes=3: a turning lane before the junction
  [127382601, -645, 1659, -665, 1667, { lanes: 2 }],   // lanes=3
  [703967195, -694, 1705, -482, 1612, { lanes: 2 }],
  [551382832, -482, 1612, -442, 1590, { lanes: 2 }],
  [22376539, -36, 1340, -234, 1489, { lanes: 4 }],
  [1001752646, -21, 1324, -36, 1340, { lanes: 4 }],    // no lanes tag, between four-lane ways
  [702143134, -7, 1308, -21, 1324, { lanes: 4 }],      // no lanes tag
  [1020290657, 317, 960, -7, 1308, { lanes: 4 }],
  [693051426, 326, 950, 317, 960, { lanes: 4 }],
  [1020290655, 337, 939, 326, 950, { lanes: 4 }],
  [1020290656, 351, 923, 337, 939, { lanes: 4 }],
  [806866784, 483, 783, 351, 923, { lanes: 4 }],
  [806866785, 497, 768, 483, 783, { lanes: 4 }],
  [175696423, 751, 496, 497, 768, { lanes: 4 }],
  [917812147, 810, 432, 751, 496, { lanes: 4 }],
  [917812146, 1135, 139, 810, 432, { lanes: 4 }],
  [127382598, 3022, -891, 2517, -653, { rural: true }],
  [127382595, 3296, -1019, 3022, -891, { rural: true }],
  [128080447, 3590, -1156, 3296, -1019, { rural: true }],
  [127382450, 4784, -2611, 4405, -1857, { rural: true }],
  /* Daugavas iela at the north end of Vienības tilts (OSM API, November 2026): the way under the bridge is one-way, one
     lane between a hatched margin on its left (Street View) and maxheight=3.9; the ramps of the teardrop junction on the
     dam are one-way, one lane each (lanes=1 on one of them). */
  [22734923, -1817.6, 1656.6, -1536.6, 1773.1, { oneway: true, lanes: 1, hw: 3.2, hatch: -1 }],
  [13865228, -1682.1, 1711.6, -1673.3, 1700.6, { oneway: true, lanes: 1 }],
  [256273745, -1621.9, 1715.5, -1666.2, 1681.4, { oneway: true, lanes: 1 }],
  [256273746, -1695.8, 1680.6, -1744.8, 1680.6, { oneway: true, lanes: 1 }],
  [256273749, -1744.8, 1680.6, -1686.4, 1695.7, { oneway: true, lanes: 1 }],
  [338788509, -1683.7, 1677.1, -1695.8, 1680.6, { oneway: true, lanes: 1 }],
  [338788510, -1673.3, 1700.6, -1621.9, 1715.5, { oneway: true, lanes: 1 }],
  [338788512, -1666.2, 1681.4, -1683.7, 1677.1, { oneway: true, lanes: 1 }],
  [338788513, -1686.4, 1695.7, -1687.1, 1709.6, { oneway: true, lanes: 1 }],
  [522952506, -1673.3, 1700.6, -1666.2, 1681.4, { oneway: true, lanes: 1 }],
  [694354737, -1683.7, 1677.1, -1686.4, 1695.7, { oneway: true, lanes: 1 }],
];
/* Nodes of 18. novembra iela, from the same reading (x, z on the centre line of a carriageway):
   - SIGNALS: traffic lights. 'j' a node highway=traffic_signals (at a junction, or on each one-way carriageway before
     it), 'p' a crossing=traffic_signals (a signalled pedestrian crossing, which stops the traffic too). Nodes within 35 m
     of each other make one signalled junction.
   - CROSSINGS: the pedestrian crossings on the carriageway, true where marked (crossing=marked, zebra, uncontrolled or
     traffic_signals unless markings=no), false where OSM says unmarked. They replace the zebras guessed from footways on
     this street. */
const SIGNALS = [
  [-730.5, 1667.8, 'j'], [-705.4, 1684.3, 'j'], [-704.8, 1709.6, 'j'], [-694.5, 1705.3, 'j'], [-20.9, 1323.7, 'j'], [210.2, 1074.7, 'j'],
  [336.8, 938.7, 'j'], [583.3, 675.2, 'j'], [707.5, 542.8, 'j'], [841.4, 398.9, 'j'], [974.3, 255.4, 'j'], [1135.3, 139.3, 'j'],
  [2504.1, -646.9, 'j'], [3160.4, -955.8, 'j'],
  [-1187.8, 1890.2, 'p'], [-1183.3, 1898.1, 'p'], [-727.5, 1693.8, 'p'], [-714.5, 1714.2, 'p'], [-695.3, 1680.0, 'p'], [-685.9, 1701.5, 'p'],
  [13.5, 1286.5, 'p'], [202.6, 1083.0, 'p'], [217.2, 1067.5, 'p'], [326.1, 950.2, 'p'], [351.3, 923.4, 'p'], [576.1, 682.8, 'p'],
  [591.4, 666.4, 'p'], [700.8, 549.9, 'p'], [715.2, 534.7, 'p'], [833.0, 408.0, 'p'], [849.6, 390.3, 'p'], [968.3, 261.8, 'p'],
  [982.0, 247.4, 'p'], [1113.1, 151.9, 'p'], [1152.7, 128.9, 'p'], [2517.1, -653.3, 'p'], [3171.9, -960.9, 'p'],
];
const CROSSINGS = SIGNALS.filter(s => s[2] === 'p').map(s => [s[0], s[1], true]).concat([
  [-440.0, 1544.4, true], [-428.7, 1567.5, true], [-423.8, 1577.4, true], [-423.1, 1537.6, true], [1413.5, -20.9, true],
  [2194.4, -469.9, true], [3601.7, -1161.9, true], [4011.8, -1353.9, true], [4342.3, -1732.7, true],
  [-507.1, 1572.7, false], [-347.1, 1502.8, false],
]);
const near = (x, z, a, b) => Math.abs(x - a) < 1.5 && Math.abs(z - b) < 1.5;
// the tags of the street line pts (flat x, z pairs), or null
function streetTags(pts) {
  const n = pts.length; if (n < 4) return null; const ax = pts[0], az = pts[1], bx = pts[n - 2], bz = pts[n - 1];
  for (const t of TAGS) if ((near(ax, az, t[1], t[2]) && near(bx, bz, t[3], t[4])) || (near(ax, az, t[3], t[4]) && near(bx, bz, t[1], t[2]))) return t[5];
  return null;
}

export { CROSSINGS, SIGNALS, streetTags };
