import { LMF, LMWHITE, lmW } from './core.js';
import { lmBlock, lmBoxL, lmWF } from './helpers.js';
import { hb, sh } from '../core/util.js';
import { addLight } from '../world/lamp-light.js';

/* ---- Daugavpils Olimpiskais centrs, Stadiona iela 1 ----
   A large sports complex (~103×110 m bounding box, 7000 m² footprint). Built 2009–2010, houses an ice arena,
   swimming pools, gyms and a conference hall. Architecture (Mapillary photos, March 2020): light beige/cream
   walls with dark navy blue accent bands near the top, a dark grey metal canopy over the main entrance on the
   south-east (Stadiona iela) side, full-height glazing at the entrance, flat roofs with dark grey parapets.
   At night: the blue accent band glows with LED backlight, the entrance sign is lit, warm light spills from
   the glazed entrance, and LED spots wash the facade from under the canopy and along the roof parapet.
   Frame oc: u inward from the main entrance (SE→NW), v along the façade (SW→NE). Origin near centre of the
   OSM outline. OSM way 233137668. */
function lmOlympic(K, litPatch) {
  const f = LMF.oc, G = K.plain;
  const at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const U = [f[2], f[3]];   // u-axis direction (into building, NW)

  // Colours from the photographs
  const CREAM = hb('#e8dcc8');
  const BLUE = hb('#1a2f4a');
  const BLUE_GLOW = hb('#2a5aaa');   // emissive blue for night glow
  const CANOPY_DARK = hb('#3a3f43');
  const ROOF_DARK = hb('#4a4e52');
  const GLASS_DARK = hb('#2a3038');
  const ENTRANCE_FRAME = hb('#4a4e52');
  const WHITE_TRIM = [248, 246, 240];
  const WARM_GLOW = [255, 220, 160];  // warm interior light spill

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
  const H_MAIN = 12.0;
  const H_ENTRY = 5.5;
  const H_CANOPY = 3.8;
  const H_BAND = 9.5;
  const H_BAND_TOP = 10.3;
  const H_PARAPET = H_MAIN + 0.15;

  // --- Main walls via lmBlock (uses the wall texture atlas, tex 5 = panels) ---
  lmBlock(K, f, {
    poly: body,
    top: H_MAIN,
    st: { tex: 5, col: CREAM, plinth: 0.4, pcol: sh(CREAM, 0.7) },
    wy0: []
  }, []);

  // --- Navy blue accent band (daytime) ---
  for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) continue;
    lmBoxL(G, f, a[0], b[0], a[1], b[1], H_BAND, H_BAND_TOP, BLUE);
  }

  // --- Blue accent band EMISSIVE (night glow) ---
  // A second, slightly narrower strip using K.det with lit=1 so it emits at night
  const BAND_H = H_BAND_TOP - H_BAND;
  for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) continue;
    // Draw the band as a single quad on K.det (emissive material with litPatch)
    const A = at(a[0], a[1], H_BAND), B = at(b[0], b[1], H_BAND);
    const F = lmWF(A, B);
    // Outward-facing emissive strip
    K.det.q(
      F.at(0, H_BAND_TOP, 0.05), F.at(F.L, H_BAND_TOP, 0.05),
      F.at(F.L, H_BAND, 0.05), F.at(0, H_BAND, 0.05),
      [F.nx, 0, F.nz],
      [0, 0, 1, 0, 1, 1, 0, 1],
      BLUE_GLOW, 1   // lit=1 → glows at night
    );
  }

  // --- LED spot lights embedded in the blue band on the main façade ---
  // Small bright emissive rectangles spaced along the front (u≈40, v≈-30..+40)
  for (let v = -35; v <= 45; v += 6) {
    // Only on the SE-facing walls (u ≈ 30–48)
    const uWall = 39.5, v0 = v - 0.3, v1 = v + 0.3;
    const A = at(uWall, v0, H_BAND + BAND_H * 0.5);
    const B = at(uWall, v1, H_BAND + BAND_H * 0.5);
    const F = lmWF(A, B);
    K.det.q(
      F.at(0, H_BAND + BAND_H * 0.65, 0.06), F.at(F.L, H_BAND + BAND_H * 0.65, 0.06),
      F.at(F.L, H_BAND + BAND_H * 0.35, 0.06), F.at(0, H_BAND + BAND_H * 0.35, 0.06),
      [F.nx, 0, F.nz],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [180, 210, 255], 1
    );
    // Small point light on the facade
    const [lx, lz] = at(uWall + 0.1, v, H_BAND + BAND_H * 0.5);
    addLight(lx, H_BAND + BAND_H * 0.5, lz, 2.5, 0, 0.6);
  }

  // --- Dark grey roof parapet ---
  for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) continue;
    lmBoxL(G, f, a[0], b[0], a[1], b[1], H_MAIN - 0.25, H_PARAPET, ROOF_DARK);
  }

  // --- Main entrance (south-east, u≈30..48, v≈-10..+10) ---
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
      // Warm interior glow behind the glass (emissive, dim)
      K.det.q(
        Fq.at(0, H_ENTRY - 0.2, 0.02), Fq.at(Fq.L, H_ENTRY - 0.2, 0.02),
        Fq.at(Fq.L, 0.8, 0.02), Fq.at(0, 0.8, 0.02),
        [-U[0], 0, -U[1]],
        [0, 0, 1, 0, 1, 1, 0, 1],
        WARM_GLOW, 1
      );
    }

    // Entrance doors (centre, recessed)
    const vDoor0 = -2.5, vDoor1 = 3.5;
    lmBoxL(G, f, uEnt - 0.2, uEnt + 0.05, vDoor0, vDoor1, 0, 3.5, hb('#1a1d20'));

    // Warm glow in the door recess
    {
      const D0 = at(uEnt - 0.05, vDoor0, 0.3);
      const D1 = at(uEnt - 0.05, vDoor1, 0.3);
      const Fd = lmWF(D0, D1);
      K.det.q(
        Fd.at(0, 3.2, 0.01), Fd.at(Fd.L, 3.2, 0.01),
        Fd.at(Fd.L, 0.5, 0.01), Fd.at(0, 0.5, 0.01),
        [-U[0], 0, -U[1]],
        [0, 0, 1, 0, 1, 1, 0, 1],
        [255, 200, 120], 1
      );
    }

    // Canopy over the entrance
    const cU = uEnt + 0.5, cD = uEnt - 4.0;
    lmBoxL(G, f, cD, cU, v0 - 0.5, v1 + 0.5, H_CANOPY - 0.1, H_CANOPY + 0.15, CANOPY_DARK);

    // LED downlights under the canopy (emissive spots + point lights)
    for (let v = v0; v <= v1; v += 3) {
      const [lx, lz] = at(uEnt - 1.0, v, H_CANOPY - 0.12);
      // Emissive dot
      K.det.q(
        [lx - 0.08, H_CANOPY - 0.11, lz - 0.08], [lx + 0.08, H_CANOPY - 0.11, lz - 0.08],
        [lx + 0.08, H_CANOPY - 0.11, lz + 0.08], [lx - 0.08, H_CANOPY - 0.11, lz + 0.08],
        [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1],
        [240, 230, 200], 1
      );
      addLight(lx, H_CANOPY - 0.15, lz, 3, 0, 1.5);
    }

    // Thin steel columns
    for (const v of [v0 + 1, vDoor0 - 0.5, vDoor1 + 0.5, v1 - 1]) {
      lmBoxL(G, f, cU - 0.3, cU - 0.1, v - 0.15, v + 0.15, 0.3, H_CANOPY, ENTRANCE_FRAME);
    }

    // --- SIGN: blue board + white name, EMISSIVE at night ---
    const signU = uEnt + 0.12, signV0 = v0 + 1, signV1 = v1 - 1;
    // Blue board (emissive)
    {
      const S0 = at(signU, signV0, H_ENTRY + 0.1);
      const S1 = at(signU, signV1, H_ENTRY + 0.1);
      const Fs = lmWF(S0, S1);
      K.det.q(
        Fs.at(0, H_ENTRY + 1.2, 0.04), Fs.at(Fs.L, H_ENTRY + 1.2, 0.04),
        Fs.at(Fs.L, H_ENTRY + 0.1, 0.04), Fs.at(0, H_ENTRY + 0.1, 0.04),
        [-U[0], 0, -U[1]],
        [0, 0, 1, 0, 1, 1, 0, 1],
        BLUE_GLOW, 1
      );
      // White name strip (emissive)
      const margin = 0.5;
      K.det.q(
        Fs.at(0, H_ENTRY + 0.9, 0.05), Fs.at(Fs.L, H_ENTRY + 0.9, 0.05),
        Fs.at(Fs.L, H_ENTRY + 0.45, 0.05), Fs.at(0, H_ENTRY + 0.45, 0.05),
        [-U[0], 0, -U[1]],
        [0, 0, 1, 0, 1, 1, 0, 1],
        [250, 245, 235], 1
      );
    }
    // Daytime version (same but on plain material, no emissive)
    lmBoxL(G, f, signU - 0.1, signU + 0.1, signV0, signV1, H_ENTRY + 0.1, H_ENTRY + 1.2, BLUE);
    lmBoxL(G, f, signU - 0.1, signU + 0.1, signV0 + 0.5, signV1 - 0.5, H_ENTRY + 0.45, H_ENTRY + 0.9, WHITE_TRIM);
  }

  // --- Entrance lamps (globe lights on posts, already lit at night) ---
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
    // Warm glow
    K.det.q(
      Fq.at(0, 3.5, 0.02), Fq.at(Fq.L, 3.5, 0.02),
      Fq.at(Fq.L, 0.5, 0.02), Fq.at(0, 0.5, 0.02),
      [-U[0], 0, -U[1]],
      [0, 0, 1, 0, 1, 1, 0, 1],
      WARM_GLOW, 1
    );
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
    // Dim interior glow
    K.det.q(
      Fw.at(0, 2.5 + h - 0.3, 0.02), Fw.at(Fw.L, 2.5 + h - 0.3, 0.02),
      Fw.at(Fw.L, 2.5 + 0.3, 0.02), Fw.at(0, 2.5 + 0.3, 0.02),
      [-U[0], 0, -U[1]],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [255, 230, 180], 1
    );
  }

  // --- Roof-top technical elements ---
  for (const [ru, rv, rw, rd, rh] of [
    [-8, -10, 10, 8, 2.5],
    [-12, 25, 14, 10, 3.0],
    [10, 30, 8, 7, 2.0],
    [15, -15, 6, 6, 1.8],
    [-40, 5, 8, 5, 2.2]
  ]) {
    lmBoxL(G, f, ru - rw / 2, ru + rw / 2, rv - rd / 2, rv + rd / 2,
      H_PARAPET, H_PARAPET + rh, ROOF_DARK);
  }
}

export { lmOlympic };