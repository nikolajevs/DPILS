import { LMF, LMWHITE, lmW } from './core.js';
import { lmBar, lmBlock, lmBoxL, lmLit, lmWF } from './helpers.js';
import { OCF } from './tiles.js';
import { hb, sh } from '../core/util.js';
import { polyA } from '../core/geometry.js';
import { addLight } from '../world/lamp-light.js';

/* ---- Daugavpils Olimpiskais centrs, Stadiona iela 1 ----
   A large sports complex (~103×110 m bounding box, 7000 m² footprint). Built 2009–2010, houses an ice arena,
   swimming pools, gyms and a conference hall. Architecture (reference photographs, day and night): a two-storey
   glass curtain wall wraps the rounded public end, a white metal wave band sweeps over the top studded with a
   matrix of small LED dots, a balcony railing ring runs between the storeys, and the white letters
   "DAUGAVPILS OLIMPISKAIS CENTRS" are fixed straight to the glass over the entrance. The long pond-side walls
   are white panel with ribbon windows. At night: the LED dots glow cool blue, warm interior light fills half the
   glass bays, downlights under the wave wash the glass, and ground-recessed uplights floodlight the walls.
   Frame oc: u inward from the main entrance (SE→NW), v along the façade (SW→NE). Origin near centre of the
   OSM outline. OSM way 233137668. */
function lmOlympic(K, litPatch) {
  const f = LMF.oc, G = K.plain;
  const at = (u, v, y) => { const w = lmW(f, u, v); return [w[0], y, w[1]]; };
  const U = [f[2], f[3]];   // u-axis direction (into building, NW)

  // Colours from the photographs (Mapillary 2014/2020): white panel walls and a white curved drum on top,
  // reflective glazing at the entrance; the facade is floodlit from below at night.
  const CREAM = hb('#e9e7e2');
  const BLUE = hb('#dfe1e2');
  const CANOPY_DARK = hb('#3a3f43');
  const ROOF_DARK = hb('#4a4e52');
  const GLASS_DARK = hb('#2a3038');
  const ENTRANCE_FRAME = hb('#4a4e52');
  const WHITE_TRIM = [248, 246, 240];
  const WARM_GLOW = [255, 220, 160];  // warm interior light spill

  // Building footprint in local (u, v) — the OSM outline (way 233137668)
  const body = [
    [3.9, -43.9], [2.8, -41.4], [-10.5, -47.5], [-19.8, -51.7], [-25.2, -50.6],
    [-28.0, -47.7], [-54.2, 9.7], [-54.1, 13.0], [-51.9, 16.5], [-24.6, 27.9],
    [-8.9, 41.3], [-1.4, 51.7], [3.4, 55.0], [5.4, 56.3], [13.5, 57.8],
    [19.8, 56.7], [24.1, 54.1], [26.9, 49.9], [28.9, 44.4], [29.3, 40.5],
    [29.8, 36.0], [30.2, 31.8], [31.0, 23.6], [36.1, 7.5], [39.3, 0.3],
    [47.7, -14.9], [48.8, -21.5], [46.9, -28.7], [41.4, -34.2], [32.3, -37.8],
    [8.9, -42.9], [4.9, -43.7]
  ];   // the ring closes by modulo; the OSM duplicate of the first point is dropped (a zero-length edge notches the cornice mitre)

  // Heights (metres above ground)
  const H_MAIN = 12.0;
  const H_ENTRY = 5.5;
  const H_CANOPY = 3.8;
  const H_BAND = 10.0;
  const H_BAND_TOP = 12.15;
  const H_PARAPET = H_MAIN + 0.15;

  // --- Main walls via lmBlock (uses the wall texture atlas, tex 5 = panels) ---
  // roof: a flat dark membrane just under the parapet (without it the ground showed through from above).
  // The white drum band and the dark coping above it are cornices: mitred strips that follow the outline.
  // (lmBoxL between the corners of a slanted edge builds an axis-aligned box whose corners stuck out past
  // the wall as triangles all round the roof — the cornices replace those boxes.)
  lmBlock(K, f, {
    poly: body,
    top: H_MAIN,
    st: { tex: 5, col: CREAM, plinth: 0.4, pcol: sh(CREAM, 0.7) },
    roof: ROOF_DARK, roofY: H_MAIN,
    cornice: [
      [H_BAND, H_PARAPET, 0.2, BLUE],                  // the white drum, 20 cm proud of the wall
      [H_PARAPET + 0.02, H_PARAPET + 0.2, 0.26, ROOF_DARK]   // dark coping on top, a 2 cm shadow gap under it
    ]
  }, []);

  // The facade atlas (own canvas, the shared atlases are full): glass bays, LED dots, the name letters.
  // The body ring runs clockwise, so lmWF's natural normal points IN: outward = +d offset, normal = -F.n.
  const quv = t => [t.u0, t.v0, t.u1, t.v0, t.u1, t.v1, t.u0, t.v1];
  const STEEL = hb('#8a9096');
  // lmWF takes plan points [x, z] — passing the 3-D at() result would read y as z and draw everything at z=0
  const P2 = Q => [Q[0], Q[2]];
  const edgeF = i => { const a = body[i], b = body[(i + 1) % body.length]; return lmWF(P2(at(a[0], a[1], 0)), P2(at(b[0], b[1], 0))); };

  // --- TWO-STOREY GLASS CURTAIN WALL on the rounded public end (edges 10..24, the photographs) ---
  // Bays 1.5 m wide, floor slab fascia + a balcony railing ring between the storeys; some bays warm-lit at night.
  for (let i = 10; i <= 24; i++) {
    const F = edgeF(i);
    const bays = Math.max(1, Math.round(F.L / 1.5));
    for (let k = 0; k < bays; k++) {
      const s0 = k * F.L / bays + 0.02, s1 = (k + 1) * F.L / bays - 0.02;
      for (const [ya, yb] of [[0.4, 5.2], [5.6, 9.8]]) {
        const t = lmLit(0.5) ? OCF.lit : OCF.glass;
        K.ocF.q(
          F.at(s0, ya, 0.08), F.at(s1, ya, 0.08), F.at(s1, yb, 0.08), F.at(s0, yb, 0.08),
          [-F.nx, 0, -F.nz], quv(t), LMWHITE, t === OCF.lit ? 1 : 0
        );
      }
    }
    // floor slab fascia between the storeys
    lmBar(G, F.at(0, 5.4, 0.12), F.at(F.L, 5.4, 0.12), 0.42, hb('#3c4147'));
    // balcony / maintenance railing ring projecting half a metre (as in the photos)
    lmBar(G, F.at(0, 5.98, 0.5), F.at(F.L, 5.98, 0.5), 0.05, STEEL);
    lmBar(G, F.at(0, 5.72, 0.5), F.at(F.L, 5.72, 0.5), 0.04, STEEL);
    for (let s = 0.75; s < F.L; s += 1.5) lmBar(G, F.at(s, 5.55, 0.48), F.at(s, 5.98, 0.48), 0.03, STEEL);
    // warm downlights tucked under the wave overhang, washing the glass and the plaza
    const nD = Math.max(1, Math.round(F.L / 4));
    for (let k = 0; k < nD; k++) {
      const s = (k + 0.5) * F.L / nD;
      K.ocF.q(
        F.at(s - 0.09, 9.9, 0.1), F.at(s + 0.09, 9.9, 0.1), F.at(s + 0.09, 9.9, 0.3), F.at(s - 0.09, 9.9, 0.3),
        [0, -1, 0], quv(OCF.dot), LMWHITE, 1
      );
      if (k % 2 === 0) { const P = F.at(s, 9.75, 0.4); addLight(P[0], 9.75, P[2], 2, 0, 9.7); }
    }
  }

  // --- the name in white letters fixed to the glass over the entrance (edge 22, reads left→right from outside) ---
  {
    const a = body[22], b = body[23];
    const Fr = lmWF(P2(at(b[0], b[1], 0)), P2(at(a[0], a[1], 0)));   // reversed: its normal points OUT, s grows to the viewer's right
    K.ocF.q(
      Fr.at(0.6, 6.2, -0.14), Fr.at(Fr.L - 0.6, 6.2, -0.14), Fr.at(Fr.L - 0.6, 7.2, -0.14), Fr.at(0.6, 7.2, -0.14),
      [Fr.nx, 0, Fr.nz], [OCF.sign.u1, OCF.sign.v0, OCF.sign.u0, OCF.sign.v0, OCF.sign.u0, OCF.sign.v1, OCF.sign.u1, OCF.sign.v1], LMWHITE, 1
    );
  }

  // --- LED DOT MATRIX on the white wave (the signature night look: rows of small cool-blue dots) ---
  for (let i = 0; i < body.length; i++) {
    const F = edgeF(i);
    if (F.L < 1) continue;
    const n = Math.max(1, Math.round(F.L / 1.7));
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * F.L / n;
      for (const y of [10.55, 11.25, 11.95]) {
        K.ocF.q(
          F.at(s - 0.09, y - 0.09, 0.215), F.at(s + 0.09, y - 0.09, 0.215),
          F.at(s + 0.09, y + 0.09, 0.215), F.at(s - 0.09, y + 0.09, 0.215),
          [-F.nx, 0, -F.nz], quv(OCF.dot), LMWHITE, 1
        );
      }
    }
  }

  // --- ribbon windows on the long pond-side walls (the concrete drum in the day photograph) ---
  for (let i = 5; i <= 9; i++) {
    const F = edgeF(i);
    const bays = Math.max(1, Math.round(F.L / 1.6));
    for (let k = 0; k < bays; k++) {
      const s0 = k * F.L / bays + 0.03, s1 = (k + 1) * F.L / bays - 0.03;
      const t = lmLit(0.25) ? OCF.lit : OCF.glass;
      K.ocF.q(
        F.at(s0, 8.3, 0.06), F.at(s1, 8.3, 0.06), F.at(s1, 9.8, 0.06), F.at(s0, 9.8, 0.06),
        [-F.nx, 0, -F.nz], quv(t), LMWHITE, t === OCF.lit ? 1 : 0
      );
      if (i >= 6 && i <= 8) K.ocF.q(
        F.at(s0, 1.0, 0.06), F.at(s1, 1.0, 0.06), F.at(s1, 2.4, 0.06), F.at(s0, 2.4, 0.06),
        [-F.nx, 0, -F.nz], quv(OCF.glass), LMWHITE, 0
      );
    }
  }

  // --- FACADE FLOODLIGHTING: ground-recessed uplights washing the walls and the white drum at night ---
  // (the photographs show the building lit from below; kind-2 lamps reach 10 m up the facade)
  {
    const ctr = at(-4, 6, 0);
    for (let i = 0; i < body.length; i++) {
      const a = body[i], b = body[(i + 1) % body.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 3) continue;
      const A = at(a[0], a[1], 0), B = at(b[0], b[1], 0);
      const mx = (A[0] + B[0]) / 2, mz = (A[2] + B[2]) / 2;
      let ox = mx - ctr[0], oz = mz - ctr[2];
      const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      const nUp = Math.max(1, Math.round(len / 7));
      for (let k = 0; k < nUp; k++) {
        const t = (k + 0.5) / nUp;
        const px = A[0] + (B[0] - A[0]) * t + ox * 0.8;
        const pz = A[2] + (B[2] - A[2]) * t + oz * 0.8;
        addLight(px, 0.25, pz, 2, 0, 0.2);
      }
    }
  }

  // --- Main entrance (south-east, u≈30..48, v≈-10..+10) ---
  {
    const uEnt = 40, v0 = -10, v1 = 12;

    // Dark glazing panels above the doors
    for (let v = v0; v < v1 - 0.1; v += 3.0) {
      const vEnd = Math.min(v1, v + 3.0);
      const Q0 = at(uEnt - 0.05, v, 0.5);
      const Q1 = at(uEnt - 0.05, vEnd, 0.5);
      const Fq = lmWF(P2(Q0), P2(Q1));
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
      const Fd = lmWF(P2(D0), P2(D1));
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
      addLight(lx, H_CANOPY - 0.15, lz, 2, 0, 1.5);
    }

    // Thin steel columns
    for (const v of [v0 + 1, vDoor0 - 0.5, vDoor1 + 0.5, v1 - 1]) {
      lmBoxL(G, f, cU - 0.3, cU - 0.1, v - 0.15, v + 0.15, 0.3, H_CANOPY, ENTRANCE_FRAME);
    }

    // (the name letters are on the glass drum above — there is no blue board in the photographs)
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
    addLight(lx, gy + gs * 2, lz, 1, 0, 1.8);
  }

  // --- Side entrance (north-east, v≈55) ---
  {
    const uSide = 3, vSide = 55;
    const Q0 = at(uSide - 0.05, vSide - 3, 0.3);
    const Q1 = at(uSide - 0.05, vSide + 1, 0.3);
    const Fq = lmWF(P2(Q0), P2(Q1));
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
    const Fw = lmWF(P2(Q0), P2(Q1));
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

  // ═══════════════════════════════════════════════════════════════
  //  GROUNDS: parking, sidewalks, paths, lamps, planters, greenery
  // ═══════════════════════════════════════════════════════════════
  const ASPH = hb('#5a5b5d');
  const ASPH_WORN = hb('#4e5052');
  const CONCRETE = hb('#b8b4ac');
  const CONCRETE_SLAB = hb('#c4c0b8');
  const KERB = hb('#8a8680');
  const LINE_WHITE = [230, 228, 222];
  const LAMP_POST = hb('#3a3e42');
  const LAMP_HEAD = hb('#2a2d30');
  const GRASS = hb('#5a6e3f');
  const BUSH = hb('#3d5a2a');

  // --- Asphalt walkway apron around the building (2.5 m wide strip) ---
  // Offset from the building wall outward by ~3 m, at y=0.02
  for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) continue;
    // Outward strip from wall face (d=0 to d=2.8) — a wall-aligned quad; an lmBoxL here would build an
    // axis-aligned box per slanted edge and its corners stuck out past the apron
    // Extended apron
    const [Ax, Az] = at(a[0], a[1], 0.02);
    const [Bx, Bz] = at(b[0], b[1], 0.02);
    const F = lmWF([Ax, Az], [Bx, Bz]);
    polyA(G, [
      F.at(0, 0.03, 0), F.at(F.L, 0.03, 0),
      F.at(F.L, 0.03, 2.8), F.at(0, 0.03, 2.8)
    ], ASPH, 0, 1, 0);
    // Kerb at outer edge
    polyA(G, [
      F.at(0, 0.03, 2.8), F.at(F.L, 0.03, 2.8),
      F.at(F.L, 0.12, 2.9), F.at(0, 0.12, 2.9)
    ], KERB, 0, 0, 1);
  }

  // --- Main entrance plaza (concrete pavers in front of the entrance) ---
  {
    const pU0 = 42, pU1 = 47, pV0 = -13, pV1 = 14;
    // Concrete paver surface
    polyA(G, [
      at(pU0, pV0, 0.025), at(pU0, pV1, 0.025),
      at(pU1, pV1, 0.025), at(pU1, pV0, 0.025)
    ], CONCRETE_SLAB, 0, 1, 0);
    // Expansion joints (grid lines every 3 m)
    for (let v = pV0; v <= pV1; v += 3) {
      const A = at(pU0, v, 0.026), B = at(pU1, v, 0.026);
      lmBar(G, [A[0], 0.026, A[2]], [B[0], 0.026, B[2]], 0.015, KERB);
    }
  }

  // --- Concrete planters/flower beds near the entrance ---
  for (const [pu, pv, pw, pd] of [[44, -9, 1.5, 1.5], [44, 10, 1.5, 1.5]]) {
    const y0 = 0.03, y1 = 0.55;
    lmBoxL(G, f, pu - pw / 2, pu + pw / 2, pv - pd / 2, pv + pd / 2, y0, y1, CONCRETE);
    // Soil/plants on top
    polyA(G, [
      at(pu - pw / 2 + 0.1, pv - pd / 2 + 0.1, y1),
      at(pu - pw / 2 + 0.1, pv + pd / 2 - 0.1, y1),
      at(pu + pw / 2 - 0.1, pv + pd / 2 - 0.1, y1),
      at(pu + pw / 2 - 0.1, pv - pd / 2 + 0.1, y1)
    ], hb('#4a3520'), 0, 1, 0);
    // Low shrubs
    for (let bx = -1; bx <= 1; bx += 2) {
      for (let bz = -1; bz <= 1; bz += 2) {
        const [sx, sz] = at(pu + bx * 0.25, pv + bz * 0.25, y1);
        lmBar(G, [sx, y1, sz], [sx, y1 + 0.35, sz], 0.15, BUSH);
      }
    }
  }

  // --- PARKING LOT (north-east side, u≈-65..-30, v≈-10..+50) ---
  {
    const pkU0 = -65, pkU1 = -28, pkV0 = -15, pkV1 = 48;
    // Main asphalt surface
    polyA(G, [
      at(pkU0, pkV0, 0.02), at(pkU0, pkV1, 0.02),
      at(pkU1, pkV1, 0.02), at(pkU1, pkV0, 0.02)
    ], ASPH_WORN, 0, 1, 0);

    // Parking stall markings (white lines, 2.5 m wide stalls, 5 m deep)
    const STALL_W = 2.5, STALL_D = 5.0, AISLE = 6.5;
    // Rows of stalls facing the building (u negative = into parking from aisle)
    // Row 1: along aisle at u≈-38 (stalls from u=-38 to u=-43, v spaced)
    for (let v = pkV0 + 1; v + STALL_W <= pkV1 - 1; v += STALL_W + 0.1) {
      // Stall outline (white T-mark)
      const vEnd = Math.min(v + STALL_W, pkV1 - 1);
      // Back line
      const bk0 = at(-43, v, 0.021), bk1 = at(-43, vEnd, 0.021);
      lmBar(G, [bk0[0], 0.021, bk0[2]], [bk1[0], 0.021, bk1[2]], 0.04, LINE_WHITE);
      // Side lines
      const sl0 = at(-38.5, v, 0.021), sl1 = at(-43, v, 0.021);
      const sr0 = at(-38.5, vEnd, 0.021), sr1 = at(-43, vEnd, 0.021);
      lmBar(G, [sl0[0], 0.021, sl0[2]], [sl1[0], 0.021, sl1[2]], 0.04, LINE_WHITE);
      lmBar(G, [sr0[0], 0.021, sr0[2]], [sr1[0], 0.021, sr1[2]], 0.04, LINE_WHITE);
    }
    // Row 2: stalls on the outer side (u=-50 to -55)
    for (let v = pkV0 + 1; v + STALL_W <= pkV1 - 1; v += STALL_W + 0.1) {
      const vEnd = Math.min(v + STALL_W, pkV1 - 1);
      const bk0 = at(-55, v, 0.021), bk1 = at(-55, vEnd, 0.021);
      lmBar(G, [bk0[0], 0.021, bk0[2]], [bk1[0], 0.021, bk1[2]], 0.04, LINE_WHITE);
      const sl0 = at(-50.5, v, 0.021), sl1 = at(-55, v, 0.021);
      const sr0 = at(-50.5, vEnd, 0.021), sr1 = at(-55, vEnd, 0.021);
      lmBar(G, [sl0[0], 0.021, sl0[2]], [sl1[0], 0.021, sl1[2]], 0.04, LINE_WHITE);
      lmBar(G, [sr0[0], 0.021, sr0[2]], [sr1[0], 0.021, sr1[2]], 0.04, LINE_WHITE);
    }

    // Kerb around the parking lot
    for (const [e0, e1] of [
      [[pkU0, pkV0], [pkU0, pkV1]], [[pkU0, pkV0], [pkU1, pkV0]],
      [[pkU1, pkV0], [pkU1, pkV1]], [[pkU0, pkV1], [pkU1, pkV1]]
    ]) {
      const A = at(e0[0], e0[1], 0.02), B = at(e1[0], e1[1], 0.02);
      lmBar(G, [A[0], 0.02, A[2]], [B[0], 0.12, B[2]], 0.08, KERB);
    }

    // --- Parking lot lamp posts (tall poles, 8 m high) ---
    for (const [lv] of [[-10], [5], [20], [35]]) {
      // Two poles per row: one on each side of the aisle
      for (const lu of [-40.5, -52.5]) {
        const [lx, lz] = at(lu, lv, 0.03);
        // Pole
        K.plain.q(
          [lx - 0.06, 0.03, lz - 0.06], [lx + 0.06, 0.03, lz - 0.06],
          [lx + 0.06, 8.0, lz + 0.06], [lx - 0.06, 8.0, lz + 0.06],
          [0, 0, 1], [0, 0, 0, 0, 0, 0, 0, 0], LAMP_POST, 0
        );
        // Luminaire head (horizontal arm + lamp)
        const armDir = lu < -45 ? -1 : 1;  // arm extends toward aisle
        const [ax, az] = at(lu + armDir * 2.5, lv, 7.8);
        lmBar(G, [lx, 7.9, lz], [ax, 7.8, az], 0.04, LAMP_HEAD);
        // Lamp housing (emissive)
        K.det.q(
          [ax - 0.3, 7.7, az - 0.15], [ax + 0.3, 7.7, az - 0.15],
          [ax + 0.3, 7.85, az + 0.15], [ax - 0.3, 7.85, az + 0.15],
          [0, -1, 0], [0, 0, 1, 0, 1, 1, 0, 1],
          [240, 230, 200], 1
        );
        addLight(ax, 7.7, az, 0, 0, 7.7);
      }
    }

    // --- Footpath from parking to the main entrance ---
    // Diagonal path from parking aisle (u≈-38, v≈0) to entrance plaza (u≈42, v≈0)
    const pathV0 = -2.5, pathV1 = 2.5;
    polyA(G, [
      at(-36, pathV0, 0.025), at(-36, pathV1, 0.025),
      at(42, pathV1, 0.025), at(42, pathV0, 0.025)
    ], CONCRETE_SLAB, 0, 1, 0);
    // Path edge kerbs
    for (const v of [pathV0, pathV1]) {
      const A = at(-36, v, 0.025), B = at(42, v, 0.025);
      lmBar(G, [A[0], 0.025, A[2]], [B[0], 0.10, B[2]], 0.06, KERB);
    }
  }

  // --- Green island strips between the parking and the building ---
  // Grass strip between the apron (d≈2.8 from wall) and the parking lot
  for (const [gU0, gU1, gV0, gV1] of [
    [-30, -15, -13, 47],   // main green buffer
    [-62, -58, -13, 47],    // outer green strip
  ]) {
    polyA(G, [
      at(gU0, gV0, 0.015), at(gU0, gV1, 0.015),
      at(gU1, gV1, 0.015), at(gU1, gV0, 0.015)
    ], GRASS, 0, 1, 0);
  }

  // --- Low ornamental bushes along the building on the NE side ---
  for (let v = -38; v <= 42; v += 3.5) {
    const [bx, bz] = at(-20, v, 0.03);
    // Small bush cluster
    for (let k = 0; k < 3; k++) {
      const ox = (Math.random() - 0.5) * 0.6;
      const oz = (Math.random() - 0.5) * 0.6;
      K.plain.q(
        [bx + ox - 0.25, 0.03, bz + oz - 0.25], [bx + ox + 0.25, 0.03, bz + oz - 0.25],
        [bx + ox + 0.25, 0.7, bz + oz + 0.25], [bx + ox - 0.25, 0.7, bz + oz + 0.25],
        [0, 0, 1], [0, 0, 0, 0, 0, 0, 0, 0], BUSH, 0
      );
    }
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
      H_MAIN, H_MAIN + rh, ROOF_DARK);
  }
}

export { lmOlympic };