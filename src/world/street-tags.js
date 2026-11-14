/* ---------- tags from OpenStreetMap that the city data do not keep ----------
   A line of citydata.js holds the class, the name and the shape of a street, but not the number of lanes or whether it
   is a town street or a country road. For 18. novembra iela they were read from OSM through Overpass (November 2026):

   - four lanes (lanes=4) from the overpass bridge east to the junction at x ≈ 1135; the two short pieces at the junction
     by x ≈ −20 carry no lanes tag but lie between four-lane ways;
   - west of the overpass the two one-way carriageways have two lanes each (lanes=2 on oneway ways); the two short
     pieces with a third, turning lane before the junction at x ≈ −660 are drawn with two;
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
];
const near = (x, z, a, b) => Math.abs(x - a) < 1.5 && Math.abs(z - b) < 1.5;
// the tags of the street line pts (flat x, z pairs), or null
function streetTags(pts) {
  const n = pts.length; if (n < 4) return null; const ax = pts[0], az = pts[1], bx = pts[n - 2], bz = pts[n - 1];
  for (const t of TAGS) if ((near(ax, az, t[1], t[2]) && near(bx, bz, t[3], t[4])) || (near(ax, az, t[3], t[4]) && near(bx, bz, t[1], t[2]))) return t[5];
  return null;
}

export { streetTags };
