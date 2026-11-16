import * as THREE from 'three';
import { lmBar } from './helpers.js';
import { COL, M_LAND, M_PAVE, inWater } from '../world/data.js';
import { TERR, subTris, terrainH, waterLevel } from '../world/terrain.js';
import { camera, hook, scene } from '../render/renderer.js';
import { GB, box, polyA } from '../core/geometry.js';
import { area2, bbox, hash, hb, pip, reversed, sh, triangulate } from '../core/util.js';

/* ---- Gubiščes ezers and Aizpilsētas parks on its northern shore ----
   The lake (relation 6865444) is a chain of three basins half grown over with reeds: OSM maps 17 reed beds, fens and
   marshes round it, 8.6 ha, which the city data leaves as grass. Here:
   - the reeds: tufts of nine nearly upright blades over some 0.7 m, dark green below and olive at the tips, some with
     a slender brown plume, 1.5–2.6 m high in the reed beds a metre apart, lower in the fens, rising from the water
     where they stand in it; drawn per 120 m tile: all of them within 200 m of the viewer, a third farther off, a
     tenth farther still, and under them the beds tinted dark olive, which is what is seen from afar;
   - the boardwalk through the reeds on the eastern shore (way 299203013): dark brown planks 1.7 m wide half a metre
     over the ground or the water on piles, a railing of posts and two rails on both sides (Mapillary, 2022);
   - the shore promenade of Aizpilsētas parks (way 366853568, paved in 2022): grey pavers for walking and a red lane
     for bicycles on the side of the lake, 4.2 m in all;
   - Kuģītis, the little ship by Ingūna Levša at the north end (an installation of plastic on steel, 5 × 1.6 m, lit
     from inside at night).
   The park itself — its paths, benches, bins, picnic tables and barbecues, the bicycle stands, the dog park and the
   memorial stone of the old Jewish cemetery (1970s) — is drawn by lmParks from parks.js. */
const GUB_WET = [
  ['marsh', [1224.3,-342.6,1199,-318.8,1210.7,-313.1,1216.5,-317.7,1223,-332.5]],   // way 835323069
  ['reedbed', [1057.2,-682.1,1058.4,-695.1,1060.8,-702.3,1065.2,-706.9,1082.3,-717.4,1107.3,-729.7,1120.8,-740.6,1140.3,-752.5,1151.8,-763.9,1149.1,-775.8,1152.3,-784.3,1156.9,-788.5,1161.4,-788.4,1170.9,-779.9,1165,-790.8,1166,-794.9,1171.9,-797.9,1186.4,-800.2,1214.1,-796.4,1258,-783.4,1277.5,-775.8,1301.2,-771,1294.6,-769.1,1280.8,-771,1278.4,-767.6,1281.9,-763.1,1286.2,-763.7,1290.3,-756.4,1292.5,-752.3,1296.8,-747.3,1302.6,-753.3,1308.9,-756.1,1315.4,-753.3,1321.9,-757.4,1332.9,-758.7,1337.4,-764.8,1334.8,-773,1319.9,-772.3,1313.3,-767.4,1319.3,-778.2,1342.2,-780.8,1359.4,-763.4,1368.6,-766.6,1381.5,-784.8,1397.9,-779.2,1413.3,-766,1419.4,-752.5,1418.8,-735.9,1398.7,-711.2,1397.9,-696.1,1397.4,-685.3,1413.8,-663.3,1455.7,-632.2,1478.4,-628.3,1497.3,-627,1506.9,-629.8,1519.8,-627.3,1526,-629.3,1529.2,-627.6,1528.1,-624.2,1523.8,-623.1,1499.2,-623,1480.1,-621.7,1469.3,-616.4,1463.2,-605.9,1459.1,-589.1,1451.6,-558.1,1438.6,-544.6,1401.1,-518.4,1381.4,-516.4,1379.3,-503.7,1384.4,-489.4,1369.7,-483.4,1362.1,-476.9,1355.1,-481.6,1350.2,-499.1,1340.5,-508.2,1322.5,-510.1,1311,-520.9,1304.2,-525.5,1283.3,-534.7,1264.3,-530.8,1259.8,-519.8,1268.2,-508.1,1268.7,-501.6,1271.3,-470.8,1260.5,-459.6,1247.7,-453.6,1258.8,-477.9,1260.7,-500.9,1251.3,-512.7,1249.6,-521,1241.2,-536.2,1242.3,-541.3,1248.4,-546.4,1252.5,-543.7,1259.9,-534.7,1265.8,-536,1270,-542.6,1266.2,-557.4,1258.1,-565.4,1255.1,-579,1269,-608.5,1273.7,-610.8,1279.2,-609.7,1282.1,-616.8,1285.9,-626.9,1286.1,-635.9,1286.6,-637.7,1289.9,-637.1,1292.2,-633.4,1291.9,-631.1,1296.5,-622.6,1292.5,-601.1,1297.9,-596,1296.6,-587.1,1289.5,-572.3,1286.3,-569.7,1285.6,-566.6,1299.2,-567.5,1310.5,-574,1326.4,-573.5,1330.7,-564.8,1352.7,-560,1361,-562.9,1377.8,-562.5,1391.5,-566.6,1393.5,-574.8,1387.5,-593.6,1383.4,-605.4,1386.8,-611.8,1395.7,-612.2,1399.6,-615.6,1398.5,-625.4,1385.5,-654.2,1365.7,-663.6,1344.2,-661.5,1305.7,-662.3,1280.7,-668,1274.5,-674.1,1267.7,-672.2,1213.9,-681.7,1209.6,-686,1209.5,-694.3,1210.8,-701,1202.5,-711.4,1187.9,-714.5,1176.8,-730.9,1160.9,-735.8,1174.5,-741.7,1168,-751.2,1147.9,-746.9,1138.9,-734.3,1119.2,-719.9,1107.3,-720.5,1097.6,-707.3,1092.6,-702.4,1080.7,-699.1,1072.9,-694.5,1069.4,-687.7,1070.2,-685.1]],   // way 835323074
  ['reedbed', [1150.8,-721.3,1145.8,-722.4,1144,-726.9,1149,-733.2,1141.2,-731.6,1129.7,-720.2,1130.7,-714.1,1139.3,-704.7,1140.1,-698.4,1135.6,-695.6,1131.9,-694.6,1143.5,-692.3,1152.2,-689.7,1157.3,-694.5,1154.6,-704.8,1148.8,-715.2]],   // way 835323075
  ['reedbed', [1182.5,-580.4,1203.1,-615.8,1202.2,-628.5,1193.6,-640.2,1179.9,-646.3,1162.9,-650.3,1163.9,-654.3,1167.3,-656.8,1181,-661,1197.7,-658.9,1210.3,-657.4,1214.3,-659.2,1229.8,-659.1,1242.9,-652.9,1261.7,-643.5,1265.7,-643.5,1269.6,-641.2,1235.8,-570.3,1224,-536.2,1206,-539,1195.7,-548.8,1183.1,-533.5]],   // way 835323076
  ['reedbed', [1224.4,-435.7,1223.3,-443.2,1215.9,-443.9,1204.3,-444,1199.9,-439.3,1195.9,-439.1,1191.7,-432.7,1194,-426.2,1197.3,-425.1,1201,-415.9,1204.9,-414.5,1209,-433.5,1216.3,-432.2,1224,-426.2]],   // way 835323077
  ['reedbed', [1120.6,-500.2,1157.6,-489.5,1177.3,-483.2,1183.1,-473.4,1186.4,-472.4,1189,-473,1193.8,-475.2,1194.9,-477.6,1194,-481,1185.5,-487.7,1176.4,-496,1166.5,-497,1163,-499.9,1161.1,-507.8,1153.9,-501.1]],   // way 835323078
  ['reedbed', [1045.5,-660.1,1052.5,-666.4,1063,-666.3,1083.6,-672.6,1090.1,-670.6,1054.9,-637.1,1046,-625.4,1039.6,-603.6,1041.1,-588.8,1048,-575.8,1040.2,-563.9,1034.3,-575.7,1027.7,-591.9,1035,-629.6]],   // way 1224634691
  ['reedbed', [1193.3,-411.5,1191.5,-418.5,1177.8,-432.5,1173.9,-449.9,1175.4,-459.6,1172,-460,1167.7,-452.1,1162.7,-456.2,1164.2,-462.6,1149,-468.8,1113.7,-473.1,1077.4,-501.3,1075,-514.4,1068,-518.6,1067.6,-505.8,1092.8,-478.8,1126,-451.3,1146.7,-457.2,1170.9,-440.1,1173.9,-425.9]],   // way 1224634692
  ['reedbed', [1041.8,-560.7,1046.7,-561.8,1055,-547,1055.3,-541.9,1057.9,-540.4,1061.9,-537.3,1063.8,-524,1057.7,-532.1,1048.3,-547.6]],   // way 1224634693
  ['reedbed', [1051.1,-572.9,1049.2,-561.9,1053.4,-556.7,1064.6,-558.6,1059.6,-564.5]],   // way 1224634694
  ['reedbed', [1403.5,-102.9,1390.9,-119,1394.1,-120.1,1402.8,-127.4,1408.1,-134.9,1412.7,-141.2,1418.4,-143,1421.7,-139.1,1419.2,-133,1409.1,-122.7,1402.2,-111.1]],   // way 367560466
  ['reedbed', [1422.4,-144.4,1426,-141.5,1428.5,-142.4,1435,-150.1,1469.5,-181.7,1486.7,-195.7,1496.1,-200.4,1500.3,-201.1,1504.2,-199.6,1509.4,-175.5,1519.1,-144.1,1520.4,-142.1,1519.7,-139.7,1517.7,-138.7,1512.4,-133.6,1510.5,-129.2,1511.5,-120.6,1514.8,-127.5,1517.2,-132.4,1522.4,-129.1,1526.6,-134,1523.4,-145.1,1515.9,-165.3,1506.2,-208.2,1499.8,-251.4,1488.2,-263.7,1484.4,-262.6,1487.9,-256.4,1500.1,-218.4,1498.5,-214.3,1485.1,-204.1,1458.1,-183,1429.3,-155.2,1422.1,-147.7]],   // way 367560468
  ['reedbed', [1437.9,-138.9,1438,-134.3,1444.1,-131.1,1454.8,-124.8,1458.8,-124.4,1458.4,-127.9,1454.5,-131.9,1450.3,-133.7,1447.6,-138.6,1443.1,-140.8]],   // way 835354736
  ['reedbed', [1437.7,-236.1,1428.8,-240.1,1426.7,-240,1424.8,-237.8,1424.1,-234.9,1425,-232.3,1434.7,-227.7,1438.6,-227.3,1439.7,-229.1,1439.7,-232.7]],   // way 835354737
  ['fen', [1676.4,-547.9,1684.6,-563.8,1690.1,-578.3,1694.2,-583.9,1695.3,-592.8,1696.5,-597.1,1696,-601.5,1692.4,-605.8,1687.3,-628.2,1654.8,-653.2,1639.2,-655.7,1620.3,-650.2,1594.1,-638.4,1572.5,-630.4,1551,-628.5,1549.5,-631,1549.8,-633.9,1526,-629.3,1529.2,-627.6,1528.1,-624.2,1523.8,-623.1,1499.2,-623,1480.1,-621.7,1469.3,-616.4,1463.2,-605.9,1459.1,-589.1,1451.6,-558.1,1438.6,-544.6,1536.1,-513.4,1561.2,-513.1,1588.6,-535.3]],   // way 835522334
  ['marsh', [1268.7,-501.6,1277.3,-495.4,1291.1,-499.9,1292,-507,1311,-520.9,1304.2,-525.5,1283.3,-534.7,1264.3,-530.8,1259.8,-519.8,1268.2,-508.1]],   // way 1224634695
  ['reedbed', [1727.5,-491.6,1728,-497,1731.9,-502.2,1736.6,-507,1741.4,-506.1,1743.5,-510.5,1740.5,-515.3,1746.4,-524.2,1739.2,-550.8,1741.1,-553.7,1761,-508.7,1751.1,-495.7,1746.5,-489.5,1741.7,-487.4,1737.4,-487.7,1734.5,-491.9]],   // way 1224634697
];
const GUB_WALK = [1539.1,-508.8,1536,-577.9,1537,-598.8,1536,-631.8];   // way 299203013, bridge=boardwalk
const GUB_PROM = [958.1,-407.4,964.2,-414.4,981.1,-434,1011.1,-439.9,1074.3,-425.2,1090.7,-421.4,1119.1,-410.1,1133.1,-402.9,1142,-394.2,1148.2,-380.2,1153.8,-366.1,1165.9,-321.9,1168.9,-310.8,1178.8,-278.9,1185.8,-256.1,1196.5,-242.2,1198.9,-239.5,1201.3,-237.6,1215.3,-226,1246.8,-187.7,1248.5,-185.6,1260,-160.7,1270.2,-146.9,1272.5,-143.9,1273.3,-142.8,1292,-120.3,1314.2,-103.7,1323.6,-96.8,1344.4,-82.6,1350.7,-80.4,1370.8,-72.8,1396,-68.6,1406.8,-66.7,1416,-52,1430.6,-42.1];   // way 366853568, the shore promenade

const KUGITIS = [1488.5, -149.2];
// is the line of the city data the boardwalk (its own deck is drawn here)
function gubOnLine(pts) {
  const n = pts.length >> 1, m = GUB_WALK.length >> 1; if (n < 2) return false;
  const near = (x, z) => { for (let i = 0; i + 1 < m; i++) { const ax = GUB_WALK[2 * i], az = GUB_WALK[2 * i + 1], dx = GUB_WALK[2 * i + 2] - ax, dz = GUB_WALK[2 * i + 3] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); if (Math.hypot(x - ax - dx * t, z - az - dz * t) < 3) return true; } return false; };
  for (let i = 0; i < n; i++) if (!near(pts[2 * i], pts[2 * i + 1])) return false;
  return true;
}
// how far over the ground the water stands at (x, z) (0 on land)
const wet = (x, z) => TERR.on && inWater(x, z) ? Math.max(0, waterLevel(x, z) - terrainH(x, z)) : 0;
const ringOf = a => { let r = Float32Array.from(a); if (area2(r) < 0) r = reversed(r); return r; };

/* ---- the reeds ---- */
const RT = [];   // the tiles: { cx, cz, m (InstancedMesh), n (its tufts) }
let lastLod = 0;
// a tuft of unit height: nine blades over some 0.7 m, nearly upright, one with a slender plume; its colours made linear
// here, as colour management is off (renderer.js)
function tuftGeo() {
  const p = [], c = [], dim = v => new THREE.Color(v).convertSRGBToLinear(), base = dim('#2f4a1e'), mid = dim('#4f6a2a'), tip = dim('#7d8a45'), plume = dim('#5a4632');
  for (let b = 0; b < 9; b++) {
    const a = b * 2.4 + 0.3, r = 0.08 + ((b * 53) % 7) / 7 * 0.27, ox = Math.cos(a) * r, oz = Math.sin(a) * r, lean = 0.04 + (b % 3) * 0.03;
    const h = 0.72 + ((b * 37) % 7) / 7 * 0.28, w = 0.035 + (b % 3) * 0.008, px = -Math.sin(a * 1.7), pz = Math.cos(a * 1.7);
    const tx = ox + Math.cos(a) * lean, tz = oz + Math.sin(a) * lean;
    p.push(ox - px * w, 0, oz - pz * w, ox + px * w, 0, oz + pz * w, tx, h, tz); c.push(...base.toArray(), ...base.toArray(), ...(b % 3 === 0 ? tip : mid).toArray());
    if (b === 0) { const y0 = h * 0.9; p.push(tx - px * 0.022 - Math.cos(a) * 0.02, y0, tz - pz * 0.022 - Math.sin(a) * 0.02, tx + px * 0.022 - Math.cos(a) * 0.02, y0, tz + pz * 0.022 - Math.sin(a) * 0.02, tx, h + 0.04, tz);
      c.push(...plume.toArray(), ...plume.toArray(), ...plume.toArray()); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.computeVertexNormals();
  for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 1, 0);   // lit as a soft clump, the same from both sides
  return g;
}
function reeds() {
  // matte (Lambert): with the normals up, a standard material seen along the ground mirrors the sky (Fresnel) and the
  // blades turn white; both faces of a blade lit alike
  const geo = tuftGeo(), mat = hook(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 'gub-reed',
    s => { s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '')); });
  const tiles = new Map(), add = (x, z, s, h) => { const k = Math.floor(x / 120) * 1000 + Math.floor(z / 120); let t = tiles.get(k); if (!t) tiles.set(k, t = { cx: (Math.floor(x / 120) + 0.5) * 120, cz: (Math.floor(z / 120) + 0.5) * 120, l: [] }); t.l.push(x, z, s, h); };
  const fillB = new GB(false);
  for (const [kind, pts] of GUB_WET) {
    const r = ringOf(pts), bb = bbox(r), tall = kind === 'reedbed', step = tall ? 1.0 : 1.2, col = hb(tall ? '#4d5a2c' : '#566535');
    const t0 = triangulate([r]), { flat, tris } = TERR.on ? subTris(t0.flat, t0.tris, 0.25) : t0, v0 = fillB.v; fillB.ensure(flat.length / 2);
    for (let i = 0; i < flat.length; i += 2) fillB.vert(flat[i], 0, flat[i + 1], 0, 1, 0, sh(col, 0.93 + hash(flat[i] * 0.3 + flat[i + 1]) * 0.12));
    for (let i = 0; i < tris.length; i += 3) fillB.triUp(v0 + tris[i], v0 + tris[i + 1], v0 + tris[i + 2]);
    for (let x = bb[0] + step / 2; x < bb[2]; x += step) for (let z = bb[1] + step / 2; z < bb[3]; z += step) {
      const px = x + (hash(x * 7.3 + z * 1.9) - 0.5) * step * 0.9, pz = z + (hash(x * 2.1 + z * 5.7) - 0.5) * step * 0.9; if (!pip(px, pz, r)) continue;
      const h = tall ? 1.5 + hash(px * 3.3 + pz * 9.1) * 1.1 : 0.6 + hash(px * 3.3 + pz * 9.1) * 0.5; add(px, pz, 0.9 + hash(px + pz * 3) * 0.4, h);
    }
  }
  const fm = fillB.mesh(M_LAND); if (fm) { fm.renderOrder = -38.6; fm.frustumCulled = false; fm.receiveShadow = true; scene.add(fm); }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  let total = 0;
  for (const t of tiles.values()) {
    const n = t.l.length / 4, order = [...Array(n).keys()].sort((a, b) => hash(a * 2654435761 + t.cx) - hash(b * 2654435761 + t.cx));   // shuffled: the first k are a fair sample
    const m = new THREE.InstancedMesh(geo, mat, n); m.boundingSphere = new THREE.Sphere(new THREE.Vector3(t.cx, 1, t.cz), 95); m.receiveShadow = true;
    order.forEach((i, k) => { const x = t.l[4 * i], z = t.l[4 * i + 1], s = t.l[4 * i + 2], h = t.l[4 * i + 3];
      q.setFromAxisAngle(up, hash(x * 11 + z * 13) * 6.283); M.compose(new THREE.Vector3(x, wet(x, z) - 0.05, z), q, new THREE.Vector3(s, h, s)); m.setMatrixAt(k, M);
      const v = 0.72 + hash(x * 5 + z * 17) * 0.23; m.setColorAt(k, col.setRGB(v, v * (0.97 + hash(x + z) * 0.06), v * 0.9)); });
    m.count = 0; t.m = m; t.n = n; total += n; scene.add(m); RT.push(t);
  }
  return total;
}
// how many tufts of each tile are drawn: all near the viewer, fewer farther off
function gubTick() {
  const now = performance.now(); if (now - lastLod < 350 || !RT.length) return; lastLod = now;
  const x = camera.position.x, z = camera.position.z;
  for (const t of RT) { const d = Math.hypot(t.cx - x, t.cz - z); t.m.count = d < 200 ? t.n : d < 600 ? Math.round(t.n * 0.3) : d < 1200 ? Math.round(t.n * 0.1) : 0; }
}

/* ---- the boardwalk ---- */
function boardwalk(G) {
  const DECK = hb('#5d4636'), GAP = hb('#33251c'), RAIL = hb('#4b372a'), m = GUB_WALK.length >> 1, W = 0.85, H = 0.55;
  const ys = (x, z) => wet(x, z) + H;
  let acc = 0;
  for (let i = 0; i + 1 < m; i++) {
    const ax = GUB_WALK[2 * i], az = GUB_WALK[2 * i + 1], bx = GUB_WALK[2 * i + 2], bz = GUB_WALK[2 * i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, k = Math.max(1, Math.ceil(L / 2));
    for (let j = 0; j < k; j++) {
      const s0 = L * j / k, s1 = L * (j + 1) / k, x0 = ax + ux * s0, z0 = az + uz * s0, x1 = ax + ux * s1, z1 = az + uz * s1, y0 = ys(x0, z0), y1 = ys(x1, z1);
      polyA(G, [[x0 - nx * W, y0, z0 - nz * W], [x1 - nx * W, y1, z1 - nz * W], [x1 + nx * W, y1, z1 + nz * W], [x0 + nx * W, y0, z0 + nz * W]], DECK, 0, 1, 0);
      for (const sd of [-1, 1]) polyA(G, [[x0 + nx * W * sd, y0 - 0.12, z0 + nz * W * sd], [x1 + nx * W * sd, y1 - 0.12, z1 + nz * W * sd], [x1 + nx * W * sd, y1, z1 + nz * W * sd], [x0 + nx * W * sd, y0, z0 + nz * W * sd]], sh(DECK, 0.8), nx * sd, 0, nz * sd);
      for (let g = 0.3; g < s1 - s0; g += 0.3) { const t = g / (s1 - s0), x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t + 0.004;
        polyA(G, [[x - nx * W - ux * 0.015, y, z - nz * W - uz * 0.015], [x - nx * W + ux * 0.015, y, z - nz * W + uz * 0.015], [x + nx * W + ux * 0.015, y, z + nz * W + uz * 0.015], [x + nx * W - ux * 0.015, y, z + nz * W - uz * 0.015]], GAP, 0, 1, 0); }
      // posts at the start of each piece, both sides, on piles; two rails to the next ones
      for (const sd of [-1, 1]) { const px = x0 + nx * (W - 0.05) * sd, pz = z0 + nz * (W - 0.05) * sd, qx = x1 + nx * (W - 0.05) * sd, qz = z1 + nz * (W - 0.05) * sd;
        box(G, px, pz, ux, uz, 0.05, 0.05, y0 - H - 0.3, y0 + 1.0, RAIL);
        lmBar(G, [px, y0 + 1.0, pz], [qx, y1 + 1.0, qz], 0.07, RAIL); lmBar(G, [px, y0 + 0.5, pz], [qx, y1 + 0.5, qz], 0.05, RAIL);
        COL.add(px, pz, qx, qz, 0.05, 0); }
      acc += s1 - s0;
    }
  }
  return acc;
}

/* ---- the promenade: grey pavers for walking, a red lane for bicycles on the side of the lake ---- */
function promenade() {
  const b = new GB(false), GREY = hb('#a9a59d'), RED = hb('#a2564b'), n = GUB_PROM.length >> 1, LX = 1400, LZ = -500;   // the lake lies south of the promenade
  const nrm = i => { const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1), dx = GUB_PROM[2 * c] - GUB_PROM[2 * a], dz = GUB_PROM[2 * c + 1] - GUB_PROM[2 * a + 1], L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; };
  for (let i = 0; i + 1 < n; i++) {
    const [n0x, n0z] = nrm(i), [n1x, n1z] = nrm(i + 1), ax = GUB_PROM[2 * i], az = GUB_PROM[2 * i + 1], bx = GUB_PROM[2 * i + 2], bz = GUB_PROM[2 * i + 3];
    const lake = ((LX - ax) * n0x + (LZ - az) * n0z) > 0 ? 1 : -1;   // which side the lake is on
    for (const [o0, o1, c] of [[0, 2.1 * lake, RED], [-2.1 * lake, 0, GREY]]) {
      const k = [[ax + n0x * o0, az + n0z * o0], [bx + n1x * o0, bz + n1z * o0], [bx + n1x * o1, bz + n1z * o1], [ax + n0x * o1, az + n0z * o1]].map(([x, z]) => b.vert(x, 0, z, 0, 1, 0, c));
      b.triUp(k[0], k[1], k[2]); b.triUp(k[0], k[2], k[3]); }
  }
  const m = b.mesh(M_PAVE); if (m) { m.renderOrder = -35.5; m.frustumCulled = false; m.receiveShadow = true; scene.add(m); }
}

/* ---- Kuģītis ---- */
function kugitis(K) {
  const [x, z] = KUGITIS, a = -0.55, ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux, y0 = wet(x, z);   // it stands in the water by the shore: on legs from the bottom
  const P = (u, v, y) => [x + ux * u + vx * v, y + y0, z + uz * u + vz * v];
  const G = K.globe, W = [242, 240, 232], STEEL = hb('#55595c'), BLUE = hb('#3b6db3');
  // the hull: a trapezoid seen from the side, its bow and stern sloping, 0.7 m across
  const hull = [[-1.8, 0.15], [1.8, 0.15], [2.5, 0.95], [-2.4, 0.95]];
  for (const sv of [-0.35, 0.35]) polyA(G, hull.map(([u, y]) => P(u, sv, y)), W, vx * Math.sign(sv), 0, vz * Math.sign(sv));
  polyA(G, [P(-2.4, -0.35, 0.95), P(2.5, -0.35, 0.95), P(2.5, 0.35, 0.95), P(-2.4, 0.35, 0.95)], sh(W, 0.95), 0, 1, 0);
  polyA(G, [P(1.8, -0.35, 0.15), P(2.5, -0.35, 0.95), P(2.5, 0.35, 0.95), P(1.8, 0.35, 0.15)], W, ux, 0.5, uz); polyA(G, [P(-1.8, -0.35, 0.15), P(-2.4, -0.35, 0.95), P(-2.4, 0.35, 0.95), P(-1.8, 0.35, 0.15)], W, -ux, 0.5, -uz);
  for (const sv of [-0.36, 0.36]) for (let k = 0; k < 4; k++) lmBar(K.plain, P(hull[k][0], sv, hull[k][1]), P(hull[(k + 1) % 4][0], sv, hull[(k + 1) % 4][1]), 0.05, STEEL);
  lmBar(K.plain, P(-2.4, 0, 0.95), P(2.5, 0, 0.95), 0.04, STEEL);
  // a mast and a little sail, a blue stripe along the hull
  lmBar(K.plain, P(0.2, 0, 0.95), P(0.2, 0, 1.6), 0.05, STEEL); polyA(G, [P(0.25, 0, 1.0), P(1.4, 0, 1.0), P(0.25, 0, 1.58)], W, vx, 0, vz);
  for (const sv of [-0.36, 0.36]) polyA(K.plain, [P(-2.0, sv, 0.6), P(2.0, sv, 0.6), P(2.15, sv, 0.72), P(-2.1, sv, 0.72)], BLUE, vx * Math.sign(sv), 0, vz * Math.sign(sv));
  for (const [u, v] of [[-1.6, -0.3], [1.6, -0.3], [1.6, 0.3], [-1.6, 0.3]]) { const [px, , pz] = P(u, v, 0); box(K.plain, px, pz, ux, uz, 0.04, 0.04, -y0 - 0.2, 0.18 + y0, STEEL); }
  COL.add(...[P(-2.4, 0, 0), P(2.5, 0, 0)].flatMap(p => [p[0], p[2]]), 0.45, 0);
}

const GUB_STAT = { tufts: 0, walk: 0 };   // for checks: window.__city.gubisce
function lmGubisce(K) {
  GUB_STAT.tufts = reeds(); GUB_STAT.walk = Math.round(boardwalk(K.plain)); promenade(); kugitis(K);
}

export { GUB_STAT, gubOnLine, gubTick, lmGubisce };
