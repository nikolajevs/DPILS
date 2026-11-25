import { LMF, LMWHITE, lmW } from './core.js';
import { lmBlock, lmBoxL, lmWF } from './helpers.js';
import { hb, sh } from '../core/util.js';
import { addLight } from '../world/lamp-light.js';

/* ---- Daugavpils Olimpiskais centrs, Stadiona iela 1 ----
   A large sports complex (~103×110 m bounding box, 7000 m² footprint). Built 2009–2010, houses an ice arena,
   swimming pools, gyms and a conference hall. Architecture (Mapillary photos, March 2020): light beige/cream
   walls with dark navy blue accent bands near the top, a dark grey metal canopy over the main entrance on the
   south-east (Stadiona iela) side, full-height glazing at the entrance, flat roofs with dark grey parapets.
   Frame oc: u inward from the main entrance (SE→NW), v along the façade (SW→NE). Origin near centre of the
   OSM outline. OSM way 233137668. */
function lmOlympic(K) {
  const f = LMF.oc, G = K.plain;
  const at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const U = [f[2], f[3]];   // u-axis direction (into building, NW)
  const V = [-f[3], f[2]];   // v-axis direction (along façade, NE)

  // Colours from the photographs
  const CREAM = hb('#e8dcc8');
  const BLUE = hb('#1a2f4a');
  const BLUE_MID = hb('#243d5e');
  const CANOPY_DARK = hb('#3a3f43');
  const ROOF_DARK = hb('#4a4e52');
  const GLASS_DARK = hb('#2a3038');
  const ENTRANCE_FRAME = hb('#4a4e52');
  const WHITE_TRIM = [248, 246, 240];

  // Building footprint in local (u, v) — the full 33-point OSM outline
  const body = [
    [3.9, -43.9], [2.8, -41.4], [-10.5, -47.5], [-19.8, -51.7], [-25.2, -50.6],
    [-28.0, -47.7], [-54.2, 9.7], [-54.1, 13.0], [-51.9, 16.5], [-24.6, 27.9],
    [-8.9, 41.3], [-1.4, 51.7], [3.4, 55.0], [5.4, 56.3], [13.5, 57.8],
    [19.8, 56.7], [24.1, 54.1], [26.9, 49.9], [28.9, 44.4], [29.3, 40.5],
    [29.8, 36.0], [30.2, 31.8], [31.0, 23.6], [36.1, 7.5], [39.3, 0.3],
    [47.7, -14.9], [48.8, -21.5], [46.9, -28.7], [41.4, -34.2], [32.3, -37.8],
    [8.9, -42.9], [4.9, -43.7], [3.9, -43.9]
  ];

  // Heights (metres above ground)
  const H_MAIN = 12.0;       // main arena block
  const H_WING_EAST = 8.5;   // east wing (changing rooms)
  const H_WING_WEST = 8.5;   // west wing
  const H_ENTRY = 5.5;       // entrance glazing top
  const H_CANOPY = 3.8;      // canopy underside
  const H_BAND = 9.5;        // blue accent band bottom
  const H_BAND_TOP = 10.3;   // blue band top

  // --- Main walls via lmBlock (uses the wall texture atlas, tex 5 = panels) ---
  lmBlock(K, f, {
    poly: body,
    top: H_MAIN,
    st: { tex: 5, col: CREAM, plinth: 0.4, pcol: sh(CREAM, 0.7) },
    wy0: []
  }, []);

  // --- Navy blue accent band around the entire building ---
  for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) continue;
    lmBoxL(G, f, a[0], b[0], a[1], b[1], H_BAND, H_BAND_TOP, BLUE);
  }

  // --- Dark grey roof parapet ---
  for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) continue;
    lmBoxL(G, f, a[0], b[0], a[1], b[1], H_MAIN - 0.25, H_MAIN + 0.15, ROOF_DARK);
  }

  // --- Main entrance (south-east, u≈30..48, v≈-10..+10) ---
  // The glazed front spans the protruding entrance block
  {
    const uEnt = 40, v0 = -10, v1 = 12;

    // Dark glazing panels above the doors
    for (let v = v0; v < v1 - 0.1; v += 3.0) {
      const vEnd = Math.min(v1, v + 3.0);
      const Q0 = at(uEnt - 0.05, v, 0.5);
      const Q1 = at(uEnt - 0.05, vEnd, 0.5);
      const Fq = lmWF(Q0, Q1);
      K.plain.q(
        Fq.at(0, H_ENTRY, 0), Fq.at(Fq.L, H_ENTRY, 0),
        Fq.at(Fq.L, 0.5, 0), Fq.at(0, 0.5, 0),
        [-U[0], 0, -U[1]],
        [0, 0, 1, 0, 1, 1, 0, 1],
        GLASS_DARK, 1
      );
    }

    // Entrance doors (centre, recessed)
    const vDoor0 = -2.5, vDoor1 = 3.5;
    lmBoxL(G, f, uEnt - 0.2, uEnt + 0.05, vDoor0, vDoor1, 0, 3.5, hb('#1a1d20'));

    // Canopy over the entrance
    const cU = uEnt + 0.5, cD = uEnt - 4.0;
    // Canopy slab
    for (const [p0, p1, p2, p3] of [[
      at(cU, v0 - 0.5, H_CANOPY), at(cU, v1 + 0.5, H_CANOPY),
      at(cD, v1 + 0.5, H_CANOPY), at(cD, v0 - 0.5, H_CANOPY)
    ]]) {
      lmBoxL(G, f, cD, cU, v0 - 0.5, v1 + 0.5, H_CANOPY - 0.1, H_CANOPY + 0.15, CANOPY_DARK);
    }

    // Thin steel columns
    for (const v of [v0 + 1, vDoor0 - 0.5, vDoor1 + 0.5, v1 - 1]) {
      lmBoxL(G, f, cU - 0.3, cU - 0.1, v - 0.15, v + 0.15, 0.3, H_CANOPY, ENTRANCE_FRAME);
    }

    // Blue sign board above the entrance
    lmBoxL(G, f, uEnt + 0.1, uEnt - 0.1, v0 + 1, v1 - 1, H_ENTRY + 0.1, H_ENTRY + 1.2, BLUE);
    lmBoxL(G, f, uEnt + 0.1, uEnt - 0.1, v0 + 1.5, v1 - 1.5, H_ENTRY + 0.4, H_ENTRY + 0.9, WHITE_TRIM);
  }

  // --- Entrance lamps (globe lights on posts) ---
  for (const [lu, lv] of [[42, -6], [42, 6], [42, -12], [42, 13]]) {
    const [lx, lz] = at(lu, lv, H_CANOPY + 0.3);
    // Post
    K.plain.q(
      [lx - 0.03, H_CANOPY + 0.3, lz - 0.03], [lx + 0.03, H_CANOPY + 0.3, lz - 0.03],
      [lx + 0.03, H_CANOPY + 2.2, lz + 0.03], [lx - 0.03, H_CANOPY + 2.2, lz + 0.03],
      [0, 0, 1], [0, 0, 0, 0, 0, 0, 0, 0], hb('#3a3e42'), 0
    );
    // Globe
    const gy = H_CANOPY + 2.2;
    const gs = 0.18;
    K.globe.q(
      [lx - gs, gy, lz - gs], [lx + gs, gy, lz - gs],
      [lx + gs, gy + gs * 2, lz + gs], [lx - gs, gy + gs * 2, lz + gs],
      [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], [250, 240, 220], 0
    );
    addLight(lx, gy + gs * 2, lz, 1.5, 0, 1.8);
  }

  // --- Side entrance (north-east, v≈55) ---
  {
    const uSide = 3, vSide = 55;
    // Small glazed panel
    const Q0 = at(uSide - 0.05, vSide - 3, 0.3);
    const Q1 = at(uSide - 0.05, vSide + 1, 0.3);
    const Fq = lmWF(Q0, Q1);
    K.plain.q(
      Fq.at(0, 3.8, 0), Fq.at(Fq.L, 3.8, 0),
      Fq.at(Fq.L, 0.3, 0), Fq.at(0, 0.3, 0),
      [-U[0], 0, -U[1]],
      [0, 0, 1, 0, 1, 1, 0, 1],
      GLASS_DARK, 0
    );
    // Small canopy
    lmBoxL(G, f, uSide, uSide - 2.5, vSide - 3, vSide + 1, 3.0, 3.2, CANOPY_DARK);
  }

  // --- Scattered windows on the side walls ---
  for (const [uWin, vWin, w, h] of [
    [45, -22, 3, 2.5], [45, -16, 3, 2.5], [28, 42, 3, 2.5],
    [28, 36, 3, 2.5], [-52, 12, 3, 2.5], [-52, 20, 3, 2.5]
  ]) {
    const Q0 = at(uWin - 0.05, vWin, 2.5);
    const Q1 = at(uWin - 0.05, vWin + w, 2.5);
    const Fw = lmWF(Q0, Q1);
    K.plain.q(
      Fw.at(0, 2.5 + h, 0), Fw.at(Fw.L, 2.5 + h, 0),
      Fw.at(Fw.L, 2.5, 0), Fw.at(0, 2.5, 0),
      [-U[0], 0, -U[1]],
      [0, 0, 1, 0, 1, 1, 0, 1],
      GLASS_DARK, 0
    );
  }

  // --- Roof-top technical elements (ventilation, elevator housings) ---
  for (const [ru, rv, rw, rd, rh] of [
    [-8, -10, 10, 8, 2.5],
    [-12, 25, 14, 10, 3.0],
    [10, 30, 8, 7, 2.0],
    [15, -15, 6, 6, 1.8],
    [-40, 5, 8, 5, 2.2]
  ]) {
    lmBoxL(G, f, ru - rw / 2, ru + rw / 2, rv - rd / 2, rv + rd / 2,
      H_MAIN + 0.15, H_MAIN + 0.15 + rh, ROOF_DARK);
  }
}

export { lmOlympic };