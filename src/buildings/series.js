import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { lr } from '../landmarks/tiles.js';
import { band, flatRoof, roofFace, vband } from './walls.js';
import { SAMPLE_GLSL, std } from '../render/materials.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { U } from '../render/renderer.js';
import { box, polyA } from '../core/geometry.js';
import { area2, hb, obb, offsetRing, pick, reversed, rnd, sh } from '../core/util.js';
import { ROAD } from '../world/data.js';
import { KIM_HOUSES } from './kimija.js';

/* ---------- typical Soviet apartment blocks of 5–9 storeys, as built (before thermal insulation) ----------
   About 570 houses in Daugavpils are standard projects; they are recognised by their outline and storeys and drawn from
   section façades instead of the generic bays. The section rhythm comes from the outlines (the 5-storey brick blocks
   10.5–12.5 m deep come in lengths of 3, 4, 5, 6 and 8 sections of 16.1 m) and the façades from photographs in the
   Commons category "Apartment buildings in Daugavpils" (Stadiona iela 4, Cietokšņa iela 55A, Andreja Pumpura iela 55,
   Krišjāņa Valdemāra iela 5, Nometņu iela 25):
   k5 — 5-storey silicate brick block: entrances with stair windows between the floors on one side, pairs of balcony
        columns or plain windows on the other, windows up one end, a low gable or a flat roof with a parapet;
   p5 — 5-storey panel block 13–17 m deep with continuous loggias along one side;
   t9 — 9-storey brick block or tower with balcony columns and lift machine rooms on the roof.
   The atlas holds one section by one storey per cell (ground, typical and top storey for each façade, and the end
   wall); the shader repeats the cells with fract(), lights windows at random at night, and the wall colour comes from
   the vertex tint. */
const SER_COLS = 2, SER_ROWS = 16;
const SER = {
  k5: { W: 16.1, yb: 1.0, wall: 'brick', cells: { A: 0, B: 3, C: 6, E: 9 }, end: [[0.2, 'K']],
    A: [[0.08, 'K'], [0.25, 'R'], [0.5, 'S'], [0.75, 'R'], [0.92, 'K']], B: [[0.083, 'R'], [0.25, 'B'], [0.417, 'K'], [0.583, 'K'], [0.75, 'B'], [0.917, 'R']],
    C: [[0.083, 'L'], [0.25, 'K'], [0.417, 'R'], [0.583, 'R'], [0.75, 'K'], [0.917, 'L']], bal: [0.25, 0.75],
    pal: ['#d8cfbf', '#cfc4b0', '#c9bba3', '#d6cbb5', '#c4b49b', '#cdb999', '#bfa47f', '#dcd6ca'] },
  p5: { W: 12.9, yb: 0.9, wall: 'panel', cells: { A: 10, B: 13, E: 16 }, end: [[0.25, 'K']],
    A: [[0.12, 'K'], [0.33, 'R'], [0.5, 'S'], [0.67, 'R'], [0.88, 'K']], B: [[0.125, 'R'], [0.375, 'B'], [0.625, 'R'], [0.875, 'B']],
    pal: ['#bdbab2', '#c4c1b8', '#b2b0a9', '#c9c4b8'] },
  t9: { W: 19, yb: 1.0, wall: 'brick', cells: { A: 17, B: 20, E: 23 }, end: [[0.22, 'K'], [0.78, 'K']],
    A: [[0.07, 'K'], [0.21, 'R'], [0.36, 'K'], [0.5, 'S'], [0.64, 'K'], [0.79, 'R'], [0.93, 'K']], B: [[0.1, 'B'], [0.3, 'R'], [0.5, 'K'], [0.7, 'R'], [0.9, 'B']], bal: [0.1, 0.9],
    pal: ['#d6cfc2', '#cbc2b2', '#d2c6b0', '#c8bfb0'] },
  n9: { W: 25.9, yb: 1.0, wall: 'panel', pj: 8, cells: { A: 24, B: 27, E: 30 }, end: [[0.22, 'K'], [0.78, 'K']],
    A: [[0.07, 'K'], [0.19, 'R'], [0.32, 'R'], [0.5, 'S'], [0.68, 'R'], [0.81, 'R'], [0.93, 'K']],
    B: [[0.0625, 'R'], [0.1875, 'B'], [0.3125, 'R'], [0.4375, 'K'], [0.5625, 'K'], [0.6875, 'R'], [0.8125, 'B'], [0.9375, 'R']], lg: [0.1875, 0.8125],
    pal: ['#c9c7c1', '#d1cdc4', '#bfc0bc', '#cfcac0', '#c3c6c6'] }
};

function seriesAtlas() {
  const CW = 1024, CH = 128, cv = mkCanvas(CW * SER_COLS, CH * SER_ROWS), mk = mkCanvas(CW * SER_COLS, CH * SER_ROWS), g = cv.getContext('2d'), m = mk.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, cv.width, cv.height); m.fillStyle = '#000'; m.fillRect(0, 0, mk.width, mk.height);
  const cell = (k, Wm, Hm, wall, draw, pj = 4) => {
    const ox = (k % SER_COLS) * CW, oy = Math.floor(k / SER_COLS) * CH, sx = CW / Wm, sy = CH / Hm;
    const X = x => ox + x * sx, Yp = y => oy + (Hm - y) * sy;
    const rect = (x0, y0, x1, y1, col, msk) => { const a = X(x0), b = Yp(y1), w = X(x1) - a, h = Yp(y0) - b; g.fillStyle = col; g.fillRect(a, b, w, h); if (msk) { m.fillStyle = msk; m.fillRect(a, b, w, h); } };
    g.save(); m.save(); for (const c of [g, m]) { c.beginPath(); c.rect(ox, oy, CW, CH); c.clip(); }
    // the wall: silicate brick in stretcher courses, or concrete panels with their joints; red in the mask takes the tint
    m.fillStyle = 'rgb(255,0,0)'; m.fillRect(ox, oy, CW, CH);
    if (wall === 'brick') { const ch = 0.077 * sy, bl = 0.26 * sx;
      for (let r = 0, y = 0; y < CH; r++, y += ch) { for (let x = -((r % 2) * bl / 2); x < CW; x += bl) { const t = 205 + Math.floor(lr() * 30); g.fillStyle = `rgb(${t},${t},${t})`; g.fillRect(ox + x + 1, oy + y + 1, bl - 1.2, ch - 1); }
        g.fillStyle = 'rgb(236,236,236)'; g.fillRect(ox, oy + y, CW, 0.9); }
    } else { g.fillStyle = 'rgb(214,214,214)'; g.fillRect(ox, oy, CW, CH);
      for (let i = 0; i < 2000; i++) { const t = 195 + Math.floor(lr() * 40); g.fillStyle = `rgba(${t},${t},${t},0.5)`; g.fillRect(ox + lr() * CW, oy + lr() * CH, 2 + lr() * 6, 1 + lr() * 3); }
      for (let x = 0; x <= Wm + 0.01; x += Wm / pj) rect(x - 0.02, 0, x + 0.02, Hm, 'rgb(150,150,150)'); rect(0, Hm - 0.03, Wm, Hm, 'rgb(150,150,150)'); }
    let wid = 0;
    const glass = (x0, y0, x1, y1, id) => { const a = X(x0), b = Yp(y1), w = X(x1) - a, h = Yp(y0) - b, gr = g.createLinearGradient(0, b, 0, b + h);
      gr.addColorStop(0, '#34424d'); gr.addColorStop(0.45, '#5c6e7c'); gr.addColorStop(0.5, '#3e4d59'); gr.addColorStop(1, '#2b353d'); g.fillStyle = gr; g.fillRect(a, b, w, h);
      m.fillStyle = `rgb(0,255,${id * 16})`; m.fillRect(a, b, w, h); };
    const FR = 'rgb(236,233,226)', FRT = 0.055;
    const win = (c, w, y0, h, panes, id) => { const x0 = c - w / 2, x1 = c + w / 2; rect(x0 - 0.04, y0 - 0.04, x1 + 0.04, y0 + h + 0.03, 'rgb(118,116,112)', 'rgb(0,0,0)');
      rect(x0, y0, x1, y0 + h, FR, 'rgb(0,0,0)'); const tr = h * 0.3, pw = (w - FRT * (panes + 1)) / panes;
      for (let p = 0; p < panes; p++) { const a = x0 + FRT + p * (pw + FRT); glass(a, y0 + FRT, a + pw, y0 + h - tr - FRT * 0.5, id); glass(a, y0 + h - tr + FRT * 0.5, a + pw, y0 + h - FRT, id); }
      rect(x0 - 0.06, y0 - 0.1, x1 + 0.06, y0 - 0.02, 'rgb(150,148,143)', 'rgb(0,0,0)'); };
    const door = (c, w, y0, h, id) => { const x0 = c - w / 2, x1 = c + w / 2; rect(x0, y0, x1, y0 + h, FR, 'rgb(0,0,0)'); glass(x0 + FRT, y0 + h * 0.42, x1 - FRT, y0 + h - FRT, id); rect(x0 + FRT, y0 + FRT, x1 - FRT, y0 + h * 0.4, 'rgb(205,202,195)', 'rgb(0,0,0)'); };
    draw({ Wm, Hm, rect, win, door, glass, id: () => ++wid % 16 });
    g.restore(); m.restore();
  };
  // draw one storey of a façade from its axes; v: 0 ground, 1 typical, 2 top
  const storey = (k, spec, axes, v) => cell(k, spec.W, 2.8, spec.wall, d => {
    for (const [f, kind] of axes) { const c = f * d.Wm, id = d.id();
      if (kind === 'S') { if (v === 0) { d.rect(c - 0.62, 0, c + 0.62, 1.35, 'rgb(74,62,52)', 'rgb(0,0,0)'); d.rect(c - 0.56, 0, c + 0.56, 1.29, 'rgb(96,82,70)', 'rgb(0,0,0)'); }
        else d.win(c, 1.0, -0.6, 1.2, 2, id);
        if (v < 2) d.win(c, 1.0, d.Hm - 0.6, 1.2, 2, id); continue; }
      if (kind === 'B' && v > 0) { const dl = f > 0.5 ? 1 : -1; d.door(c - dl * 0.68, 0.72, 0.02, 2.2, id); d.win(c + dl * 0.38, 1.2, 0.85, 1.45, 2, id); continue; }
      const w = kind === 'L' ? 1.8 : kind === 'R' || kind === 'B' ? 1.5 : 1.2; d.win(c, w, 0.85, 1.45, kind === 'L' ? 3 : 2, id); } }, spec.pj);
  for (const [key, spec] of Object.entries(SER)) {
    for (const side of ['A', 'B', 'C']) if (spec[side] && spec.cells[side] !== undefined) for (let v = 0; v < 3; v++) storey(spec.cells[side] + v, spec, spec[side], v);
    cell(spec.cells.E, 12, 2.8, spec.wall, d => { for (const [f] of spec.end) d.win(f * d.Wm, 1.2, 0.85, 1.45, 2, d.id()); }, 4);
  }
  const mkT = (c, srgb) => { const t = toTex(c, srgb, false); t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  return [mkT(cv, true), mkT(mk, false)];
}
function seriesMaterial() {
  const m = std({ roughness: 0.9, metalness: 0 }, 'series', s => {
    s.uniforms.uAtlas = { value: STATE.serTex }; s.uniforms.uMask = { value: STATE.serMask }; s.uniforms.uNight = U.night;
    s.vertexShader = 'attribute vec2 aUv; attribute vec3 aInfo; attribute vec3 aTint;\nvarying vec2 vCellUv; varying vec3 vInfo; varying vec3 vTint;\n' +
      s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCellUv = aUv; vInfo = aInfo; vTint = pow(aTint, vec3(2.2));');
    s.fragmentShader = 'uniform sampler2D uAtlas; uniform sampler2D uMask; uniform float uNight;\nvarying vec2 vCellUv; varying vec3 vInfo; varying vec3 vTint;\n' + SAMPLE_GLSL +
      s.fragmentShader.replace('#include <map_fragment>', `
        vec2 cell = floor(vCellUv), f = fract(vCellUv), dX = dFdx(vCellUv), dY = dFdy(vCellUv);
        vec3 inf = floor(vInfo + 0.5);   // interpolated constants drift by an ulp, and the hashes below would turn that into speckle
        // x the cell; y the seed (5 bits) and the flags: 1 red-brick bands, 2 the stairs glazed; z the storeys (5 bits) and
        // the wall: 0 as drawn in the atlas, 1 plaster (insulated), 2 concrete panels with the pebble finish
        float idx = inf.x, sd = mod(inf.y, 32.0) / 31.0, fb = floor(inf.y / 32.0 + 0.01), nf = mod(inf.z, 32.0), wm = floor(inf.z / 32.0 + 0.01);
        float sw = idx < 9.5 ? 16.1 : idx < 16.5 ? 12.9 : idx < 23.5 ? 19.0 : 25.9, pj = mod(idx + 5.0, 7.0) < 0.5 ? 4.0 : floor(sw / 3.2 + 0.5);   // the section's width and its panels (an end: 4)
        if (nf > 0.5) idx += cell.y < 0.5 ? 0.0 : (cell.y > nf - 1.5 ? 2.0 : 1.0);
        vec2 org = vec2(mod(idx, ${SER_COLS}.0), floor(idx / ${SER_COLS}.0 + 0.01)), sc = vec2(1.0 / ${SER_COLS}.0, 1.0 / ${SER_ROWS}.0);
        vec2 auv = (vec2(org.x, ${SER_ROWS - 1}.0 - org.y) + clamp(f, vec2(0.002, 0.004), vec2(0.998, 0.996))) * sc;
        vec3 tcol = pow(ATLAS(uAtlas, auv, dX * sc, dY * sc).rgb, vec3(2.2));
        vec4 fm = ATLAS(uMask, auv, dX * sc, dY * sc);
        float wall = step(0.5, fm.r), yv = f.y * 2.8;
        vec3 wtint = vTint;
        if (wm > 1.5) {   // pebble-finish panels: grains fading out with distance, the joints of the panels
          vec2 g = vCellUv * vec2(sw * 45.0, 126.0); float amp = clamp(1.4 - max(fwidth(g.x), fwidth(g.y)) * 0.8, 0.0, 1.0);
          float px = vCellUv.x * pj, jx = abs(fract(px + 0.5) - 0.5), jy = abs(fract(vCellUv.y + 0.5) - 0.5);
          float joint = smoothstep(0.004, 0.004 + fwidth(px), jx) * smoothstep(0.006, 0.006 + fwidth(vCellUv.y), jy);
          tcol = mix(tcol, vec3(0.6) * (0.86 + 0.28 * (h12(floor(g)) - 0.5) * amp + 0.14) * mix(0.62, 1.0, joint), wall);
        } else if (wm > 0.5) tcol = mix(tcol, vec3(0.7) * (0.97 + 0.06 * h12(floor(vCellUv * vec2(4.0, 1.0)))), wall);
        if (mod(fb, 2.0) > 0.5 && ((yv > 2.08 && yv < 2.36) || (yv > 0.58 && yv < 0.82))) wtint = vec3(0.33, 0.085, 0.045);   // red-brick bands
        if (fb > 1.5 && abs(f.x - 0.5) < 0.62 / sw && !(cell.y < 0.5 && yv < 2.65)) {   // the stairs glazed from the door to the roof
          float mu = step(fract(yv / 0.933), 0.07) + step(0.62 / sw - 0.006, abs(f.x - 0.5));
          tcol = mix(vec3(0.07, 0.1, 0.13) * (0.8 + 0.4 * f.y), vec3(0.75), clamp(mu, 0.0, 1.0)); fm.g = 1.0 - clamp(mu, 0.0, 1.0); wall = 0.0;
        }
        float wid = floor(fm.b * 255.0 / 16.0 + 0.5), hw = h12(cell * vec2(1.0, 1.7) + vec2(wid * 3.7, floor(sd * 41.0)));
        tcol = mix(tcol, tcol * (0.75 + 0.5 * hw), fm.g);
        diffuseColor.rgb = tcol * mix(vec3(1.0), wtint, wall);
      `).replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.06, fm.g);')
        .replace('#include <emissivemap_fragment>', `
        float lit = step(0.52, h12(cell + vec2(wid * 1.37 + 5.0, floor(sd * 13.1))));
        vec3 lc = mix(vec3(1.0, 0.68, 0.36), vec3(0.62, 0.78, 1.0), step(0.9, hw));
        totalEmissiveRadiance += fm.g * lit * uNight * lc * (1.1 + hw);
      `);
  });
  m.extensions = { derivatives: true }; return m;
}
// a vertical quad of the series façade; the winding follows the normal
function serQuad(b, x1, z1, x2, z2, y0, y1, nx, nz, tint, u0, u1, v0, v1, i0, i1, i2) {
  const A = b.vert(x1, y0, z1, nx, 0, nz, tint, u0, v0, i0, i1, i2), B = b.vert(x2, y0, z2, nx, 0, nz, tint, u1, v0, i0, i1, i2);
  const Cc = b.vert(x2, y1, z2, nx, 0, nz, tint, u1, v1, i0, i1, i2), D = b.vert(x1, y1, z1, nx, 0, nz, tint, u0, v1, i0, i1, i2);
  if ((z1 - z2) * nx + (x2 - x1) * nz > 0) { b.tri(A, B, Cc); b.tri(A, Cc, D); } else { b.tri(A, Cc, B); b.tri(A, D, Cc); }
}
// recognise a standard block and build it; false leaves the house to the generic builder
function serBuild(rec, rings, outer, T, id, seed) {
  const K = kimOf(outer); if (K) return kimBuild(rec, outer, T, id, seed, K);   // a block of Ķīmija as photographed (kimija.js)
  const fl = rec[5], style = rec[0]; if (rings.length !== 1 || fl < 5 || fl > 10 || style >= 5 || rec[2] > 0) return false;
  const o = obb(outer); if (!o || o.fill < 0.93) return false;
  const type = serType(fl, 2 * o.a, 2 * o.b); if (!type) return false;
  const ent = rnd(id, 51) < 0.5 ? -1 : 1, other = type === 'k5' && rnd(id, 52) > 0.65 ? 'C' : 'B';
  serWing(T, o, fl, type, id, seed, { ent, other, tint: hb(pick(SER[type].pal, id, 1)), pitched: type === 'k5' && rec[4] >= 16 });
  return true;
}
// the series of a block of fl storeys, L × D m; tall blocks whose length is a whole number of 25.9 m sections are the
// panel series, the rest are brick
function serType(fl, L, Dp) {
  const n26 = L / SER.n9.W, tall = fl >= 8 && Dp >= 11 && Dp <= 17.5 && L >= 18 && L <= 140;
  return fl === 5 && Dp >= 10.3 && Dp < 12.7 && L >= 30 ? 'k5' : fl === 5 && Dp >= 12.7 && Dp <= 17.5 && L >= 30 ? 'p5' : tall && n26 > 0.9 && Math.abs(n26 - Math.round(n26)) < 0.15 ? 'n9' : tall ? 't9' : null;
}
/* One block (or one wing of a block) on the rectangle o of the series type. opt: ent the side of the entrances (±1),
   other the façade of the other side ('B' balconies, 'C' plain), tint, endTint the colour of the ends, pitched,
   mode the wall (0 the atlas, 1 plaster, 2 pebble-finish panels), bands the red-brick bands, strip the stairs glazed,
   pil the brick pilasters, bal the colours of the balcony fronts, join {'-1': true, '1': true} the ends against another
   wing (no end wall, no parapet there), wing (short wings: one section is enough). */
function serWing(T, o, fl, type, id, seed, opt) {
  const S = SER[type], G = T.m, Dd = T.d, { ux, uz, a, b } = o, vx = -uz, vz = ux, fh = 2.8, yb = S.yb, H = yb + fl * fh, L = 2 * a;
  const nSec = Math.max(opt.wing || fl >= 8 ? 1 : 2, Math.round(L / S.W)), secW = L / nSec, tint = opt.tint, join = opt.join || {};
  const P = (su, sv, y, A = a, B = b) => [o.cx + ux * su * A + vx * sv * B, y, o.cz + uz * su * A + vz * sv * B];
  const { ent, other } = opt, mode = opt.mode || 0, sd = seed % 32, fA = sd + 32 * ((opt.bands ? 1 : 0) + (opt.strip ? 2 : 0)), fB = sd + 32 * (opt.bands ? 1 : 0);
  // long façades (u in sections, v in storeys) and the ends
  for (const sv of [-1, 1]) { const side = sv === ent ? 'A' : other, p0 = P(-1, sv, 0), p1 = P(1, sv, 0);
    serQuad(G.ser, p0[0], p0[2], p1[0], p1[2], yb, H, vx * sv, vz * sv, tint, 0, nSec, 0, fl, S.cells[side], sv === ent ? fA : fB, fl + 32 * mode); }
  for (const su of [-1, 1]) { if (join[su]) continue; const p0 = P(su, -1, 0), p1 = P(su, 1, 0); serQuad(G.ser, p0[0], p0[2], p1[0], p1[2], yb, H, ux * su, uz * su, opt.endTint || tint, 0, 1, 0, fl, S.cells.E, fB, 32 * mode); }
  // plinth, parapet and roof
  let ring = new Float32Array([P(-1, -1, 0), P(1, -1, 0), P(1, 1, 0), P(-1, 1, 0)].flatMap(p => [p[0], p[2]])); if (area2(ring) < 0) ring = reversed(ring);
  const plinth = hb(type === 'p5' || mode === 2 ? '#8f8c86' : '#9a968f');
  if (!join[-1] && !join[1]) { vband(G.plain, ring, 0, yb, plinth); band(G.plain, ring, offsetRing(ring, 0.06), yb, hb('#a29e97'), false); }
  else for (const [s0, t0, s1, t1, nx, nz] of serEdges(join)) wallStrip(G.plain, P(s0, t0, 0), P(s1, t1, 0), 0, yb, plinth, ux * nx + vx * nz, uz * nx + vz * nz);
  const pitched = opt.pitched;
  if (pitched) { const ov = 0.45, tp = 0.24, A = a + ov, B = b + ov, yE = H - ov * tp, yR = H + b * tp, RT = hb(pick(['#8c8f8e', '#7f8383', '#96958f', '#6f7476'], id, 3));
    for (const sv of [-1, 1]) roofFace(G.roof, [P(-1, sv, yE, A, B), P(1, sv, yE, A, B), P(1, 0, yR, A, 0), P(-1, 0, yR, A, 0)], ux, uz, RT, 1, seed);
    for (const su of [-1, 1]) polyA(G.plain, [P(su, -1, H), P(su, 1, H), P(su, 0, yR, a, 0)], sh(tint, 0.86), ux * su, 0, uz * su);
    polyA(G.plain, [P(-1, -1, yE, A, B), P(1, -1, yE, A, B), P(1, 1, yE, A, B), P(-1, 1, yE, A, B)], sh(tint, 0.5), 0, -1, 0); }
  else { const q = offsetRing(ring, -0.3), pc = sh(tint, 0.9); flatRoof(G.roof, [ring], H + 0.02, hb(pick(['#5d5f60', '#666867', '#545657'], id, 3)), 5, seed);
    if (!join[-1] && !join[1]) { vband(G.plain, ring, H, H + 0.45, pc); vband(G.plain, q, H, H + 0.45, sh(pc, 0.85), -1); band(G.plain, ring, q, H + 0.45, hb('#8e8b85'), false); }
    else for (const [s0, t0, s1, t1, nx, nz] of serEdges(join)) { const n0 = ux * nx + vx * nz, n1 = uz * nx + vz * nz, A0 = P(s0, t0, 0), A1 = P(s1, t1, 0);
      wallStrip(G.plain, A0, A1, H, H + 0.45, pc, n0, n1); wallStrip(G.plain, [A0[0] - n0 * 0.3, 0, A0[2] - n1 * 0.3], [A1[0] - n0 * 0.3, 0, A1[2] - n1 * 0.3], H, H + 0.45, sh(pc, 0.85), -n0, -n1);
      polyA(G.plain, [[A0[0], H + 0.45, A0[2]], [A1[0], H + 0.45, A1[2]], [A1[0] - n0 * 0.3, H + 0.45, A1[2] - n1 * 0.3], [A0[0] - n0 * 0.3, H + 0.45, A0[2] - n1 * 0.3]], hb('#8e8b85'), 0, 1, 0); } }
  // roof plant: lift machine rooms of the 9-storey blocks, vent stacks of the 5-storey ones
  for (let k = 0; k < nSec; k++) { const t = (-a + (k + 0.5) * secW) / a, c = P(t, 0, 0);
    if (fl >= 8) box(G.plain, c[0], c[2], ux, uz, 2.4, 1.7, H, H + 2.8, sh(tint, 0.94)); else if (!pitched) box(Dd.plain, c[0] + vx * 1.5, c[2] + vz * 1.5, ux, uz, 0.45, 0.35, H, H + 1.1, sh(tint, 0.85));
    else box(Dd.plain, c[0], c[2], ux, uz, 0.4, 0.3, H + b * 0.24 - 0.6, H + b * 0.24 + 0.9, sh(tint, 0.82)); }
  // entrances: a door through the plinth, a concrete canopy, two steps
  for (let k = 0; k < nSec; k++) { const t = (-a + (k + 0.5) * secW) / a, c = P(t, ent, 0), nx = vx * ent, nz = vz * ent;
    polyA(Dd.plain, [[c[0] - ux * 0.6 + nx * 0.03, 0, c[2] - uz * 0.6 + nz * 0.03], [c[0] + ux * 0.6 + nx * 0.03, 0, c[2] + uz * 0.6 + nz * 0.03], [c[0] + ux * 0.6 + nx * 0.03, yb + 0.02, c[2] + uz * 0.6 + nz * 0.03], [c[0] - ux * 0.6 + nx * 0.03, yb + 0.02, c[2] - uz * 0.6 + nz * 0.03]], hb('#4a3e34'), nx, 0, nz);
    box(Dd.plain, c[0] + nx * 0.65, c[2] + nz * 0.65, ux, uz, 1.25, 0.65, 2.45, 2.6, hb('#9d9a93')); box(Dd.plain, c[0] + nx * 0.55, c[2] + nz * 0.55, ux, uz, 1.0, 0.55, 0, 0.3, hb('#8f8c86')); }
  // balconies, loggias; their fronts in one colour, or each its own of the colours photographed
  const own = opt.bal, bcol0 = hb(pick(['#e1ddd3', '#c9b48e', '#a9b4a0', '#d8d0c0', '#8a6f52', '#b9b6ae'], id, 7)), GL = hb('#8394a0');
  const bcolAt = (k, f, fallback) => own ? hb(own[Math.floor(rnd(id * 7 + k * 3, f + 11) * own.length)]) : fallback;
  const balcony = (c, nx, nz, hw, dep, y0, glazed, front) => {
    box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw, dep / 2, y0 - 0.12, y0, hb('#a8a59e'));
    if (glazed) { box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw, dep / 2, y0, y0 + 1.0, front); box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw, dep / 2, y0 + 1.0, y0 + 2.45, GL); }
    else { box(Dd.plain, c[0] + nx * (dep - 0.03), c[2] + nz * (dep - 0.03), ux, uz, hw, 0.03, y0, y0 + 1.05, front); for (const s of [-1, 1]) box(Dd.plain, c[0] + ux * s * (hw - 0.03) + nx * dep / 2, c[2] + uz * s * (hw - 0.03) + nz * dep / 2, ux, uz, 0.03, dep / 2, y0, y0 + 1.05, sh(front, 0.9)); } };
  const bs = -ent;   // the balcony side faces away from the entrances
  if ((type === 'k5' || type === 't9') && other === 'B') { const nx = vx * bs, nz = vz * bs, glz = rnd(id, 61), fc = bcol0;
    for (let k = 0; k < nSec; k++) for (const fr of S.bal) { const t = (-a + (k + fr) * secW) / a, c = P(t, bs, 0), kk = k * 2 + (fr > 0.5 ? 1 : 0);
      for (let f = 2; f <= fl; f++) balcony(c, nx, nz, type === 't9' ? 1.15 : 1.2, type === 't9' ? 1.05 : 0.9, yb + (f - 1) * fh, rnd(id * 13 + k * 7 + (fr > 0.5 ? 3 : 0), f) < glz * 0.45, bcolAt(kk, f, type === 't9' && rnd(id, 62) < 0.5 ? hb('#8a3b2e') : fc)); } }
  if (type === 'p5') { const nx = vx * bs, nz = vz * bs, c0 = P(0, bs, 0), fc = hb(pick(['#b5b2aa', '#a9a7a0', '#bdb8ad', '#a3927f', '#9c8a78'], id, 8)), glz = rnd(id, 63);
    for (let f = 1; f <= fl; f++) { const y0 = yb + (f - 1) * fh;
      box(Dd.plain, c0[0] + nx * 0.6, c0[2] + nz * 0.6, ux, uz, a, 0.6, y0 - 0.14, y0, hb('#a8a59e'));
      if (own) for (let k = 0; k < nSec * 2; k++) { const cm = P(-1 + (k + 0.5) / nSec, bs, 0); box(Dd.plain, cm[0] + nx * 1.17, cm[2] + nz * 1.17, ux, uz, secW / 4 - 0.06, 0.03, y0, y0 + 1.05, bcolAt(k, f, fc)); }
      else box(Dd.plain, c0[0] + nx * 1.17, c0[2] + nz * 1.17, ux, uz, a, 0.03, y0, y0 + 1.05, fc);
      for (let k = 0; k <= nSec * 2; k++) { const t = -1 + k / nSec, c = P(t, bs, 0); box(Dd.plain, c[0] + nx * 0.6, c[2] + nz * 0.6, ux, uz, 0.06, 0.6, y0, y0 + fh - 0.14, sh(tint, 0.92));
        if (k < nSec * 2 && rnd(id * 17 + k, f) < glz * 0.3) { const cm = P(-1 + (k + 0.5) / nSec, bs, 0); box(Dd.plain, cm[0] + nx * 1.15, cm[2] + nz * 1.15, ux, uz, secW / 4 - 0.08, 0.04, y0 + 1.05, y0 + fh - 0.2, GL); } } }
    box(Dd.plain, c0[0] + nx * 0.6, c0[2] + nz * 0.6, ux, uz, a, 0.6, H - 0.14, H, hb('#a8a59e')); }
  if (type === 'n9') { const nx = vx * bs, nz = vz * bs, fc = hb(pick(['#8a4a3a', '#b9b6ae', '#9b5a44', '#c4c0b6'], id, 9)), glz = rnd(id, 64), hw = 1.45, dep = 1.2;
    for (let k = 0; k < nSec; k++) for (const fr of S.lg) { const c = P((-a + (k + fr) * secW) / a, bs, 0), kk = k * 2 + (fr > 0.5 ? 1 : 0);
      for (const s of [-1, 1]) box(Dd.plain, c[0] + ux * s * (hw + 0.06) + nx * dep / 2, c[2] + uz * s * (hw + 0.06) + nz * dep / 2, ux, uz, 0.08, dep / 2, yb + fh - 0.14, H, sh(tint, 0.9));
      for (let f = 2; f <= fl; f++) { const y0 = yb + (f - 1) * fh; box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw, dep / 2, y0 - 0.14, y0, hb('#a8a59e'));
        box(Dd.plain, c[0] + nx * (dep - 0.04), c[2] + nz * (dep - 0.04), ux, uz, hw, 0.04, y0, y0 + 1.05, bcolAt(kk, f, fc));
        if (rnd(id * 19 + k * 5 + (fr > 0.5 ? 2 : 0), f) < glz * 0.4) box(Dd.plain, c[0] + nx * (dep - 0.05), c[2] + nz * (dep - 0.05), ux, uz, hw, 0.04, y0 + 1.05, y0 + fh - 0.2, GL); }
      box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw + 0.14, dep / 2, H - 0.14, H, hb('#a8a59e')); } }
  // downpipes at the joints of the sections
  if (type === 'k5') for (const sv of [-1, 1]) for (let k = 1; k < nSec; k++) { const c = P(-1 + 2 * k / nSec, sv, 0); box(Dd.plain, c[0] + vx * sv * 0.1, c[2] + vz * sv * 0.1, ux, uz, 0.05, 0.05, 0.3, H, hb('#8d9093')); }
  // brick pilasters every half section on both long sides, rising 0.5 m over the parapet, with light caps
  if (opt.pil) for (const sv of [-1, 1]) for (let k = 0; k <= nSec * 2; k++) { if ((k === 0 && join[-1]) || (k === nSec * 2 && join[1])) continue;
    const t = Math.max(-1 + 0.32 / a, Math.min(1 - 0.32 / a, -1 + k / nSec)), c = P(t, sv, 0), nx = vx * sv, nz = vz * sv;
    box(Dd.plain, c[0] + nx * 0.14, c[2] + nz * 0.14, ux, uz, 0.32, 0.16, 0.2, H + 0.95, hb('#b0573a')); box(Dd.plain, c[0] + nx * 0.14, c[2] + nz * 0.14, ux, uz, 0.36, 0.2, H + 0.95, H + 1.05, hb('#e3cf98')); }
}
// the edges of a wing that do not lie against another wing: [su0, sv0, su1, sv1, normal along u, normal along v]
function serEdges(join) {
  const e = [[-1, -1, 1, -1, 0, -1], [-1, 1, 1, 1, 0, 1]]; if (!join[1]) e.push([1, -1, 1, 1, 1, 0]); if (!join[-1]) e.push([-1, -1, -1, 1, -1, 0]); return e;
}
function wallStrip(G, A, B, y0, y1, col, nx, nz) { polyA(G, [[A[0], y0, A[2]], [B[0], y0, B[2]], [B[0], y1, B[2]], [A[0], y1, A[2]]], col, nx, 0, nz); }

// a piece where wings meet: plain walls in the colour of the block, the flat roof with its parapet
function serFiller(T, o, fl, tint, id, seed) {
  const { ux, uz, a, b } = o, vx = -uz, vz = ux, H = 1.0 + fl * 2.8, P = (su, sv) => [o.cx + ux * su * a + vx * sv * b, o.cz + uz * su * a + vz * sv * b];
  let ring = new Float32Array([P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)].flat()); if (area2(ring) < 0) ring = reversed(ring);
  vband(T.m.plain, ring, 0, 1.0, hb('#9a968f')); vband(T.m.plain, ring, 1.0, H, sh(tint, 0.93)); flatRoof(T.m.roof, [ring], H + 0.02, hb(pick(['#5d5f60', '#666867', '#545657'], id, 3)), 5, seed);
}
/* ---- Ķīmija: the blocks of kimija.js, matched by the centre of their outline ---- */
let KIMG = null;
function kimOf(outer) {
  if (!KIMG) { KIMG = new Map(); for (const r of KIM_HOUSES) { const k = Math.floor(r[0] / 20) * 100000 + Math.floor(r[1] / 20); let l = KIMG.get(k); if (!l) KIMG.set(k, l = []); l.push(r); } }
  const n = outer.length >> 1; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += outer[2 * i] / n; z += outer[2 * i + 1] / n; }
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const r of KIMG.get((Math.floor(x / 20) + i) * 100000 + Math.floor(z / 20) + j) || []) if (Math.hypot(r[0] - x, r[1] - z) < 3) return r[3];
  return null;
}
const KIM_KIND = { R: { bands: 1, strip: 1 }, S: {}, B: {}, G: { mode: 2 }, P: { mode: 2, pil: 1, re: 1 }, W: { mode: 1 }, T: { strip: 1, tall: 1 }, T5: { strip: 1 }, N: { mode: 2, tall: 1 } };
const BEARING = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
const SER_STAT = { kim: 0, wings: 0, fillers: 0, generic: [] };   // the blocks of Ķīmija drawn from kimija.js (for checks: window.__city.series)
function kimBuild(rec, outer, T, id, seed, K) {
  const kind = KIM_KIND[K.p] || {}, fl = K.fl || rec[5], o = obb(outer); if (!o) { SER_STAT.generic.push(id); return false; }
  const parts = (o.fill < 0.9 && serWings(outer, o)) || (o.fill >= 0.8 ? [{ o, join: {} }] : null);
  if (!parts) { SER_STAT.generic.push(id); return false; }   // too far from a rectangle and not cut into wings: the generic builder
  SER_STAT.kim++; if (parts.length > 1) for (const pt of parts) { if (pt.filler) SER_STAT.fillers++; else SER_STAT.wings++; }
  for (const pt of parts) {
    const w = pt.o, L = 2 * w.a, Dp = 2 * w.b, vx = -w.uz, vz = w.ux;
    if (pt.filler) { serFiller(T, w, fl, hb(K.c), id, seed); continue; }
    let type = K.t || (kind.tall || fl >= 8 ? serType(9, L, Math.max(11, Math.min(17.5, Dp))) || 't9' : Dp >= 12.7 && kind.mode ? 'p5' : 'k5');   // brick blocks keep the brick façades however deep
    if (fl < 8 && (type === 't9' || type === 'n9')) type = 'k5';
    // the entrances: on the side photographed, else on the side with more paths and drives along it
    let ent = 0;
    if (K.e) { const want = BEARING[K.e], off = sv => { const b = (Math.atan2(vx * sv, -vz * sv) * 180 / Math.PI + 360) % 360; return Math.abs(((b - want) % 360 + 540) % 360 - 180); }; if (Math.min(off(-1), off(1)) < 60) ent = off(-1) < off(1) ? -1 : 1; }
    if (!ent) { const hits = sv => { let n = 0; for (let k = -2; k <= 2; k++) for (const d of [5, 9, 13]) { const x = w.cx + w.ux * k * w.a / 2.5 + vx * sv * (w.b + d), z = w.cz + w.uz * k * w.a / 2.5 + vz * sv * (w.b + d);
      let on = false; ROAD.near(x, z, 6, (rid, dd) => { if (dd < ROAD.s[rid * 6 + 4] + 0.8) on = true; }); if (on) n++; } return n; };
      const h0 = hits(-1), h1 = hits(1); ent = h0 === h1 ? (rnd(id, 51) < 0.5 ? -1 : 1) : h0 > h1 ? -1 : 1; }
    const tint = hb(K.c), red = hb('#a24e36');
    serWing(T, w, fl, type, id, seed, { ent, other: 'B', tint, endTint: K.re || kind.re ? red : null, mode: kind.mode || 0, bands: kind.bands, strip: kind.strip, pil: kind.pil, bal: K.bal, join: pt.join, wing: parts.length > 1, pitched: false });
  }
  return true;
}
/* An outline of right angles (an L, a U, a T, sections set off one from the next) cut into its wings: the outline in
   the frame of its bounding box snapped to its two axes, the grid of its corners' coordinates, then the largest
   rectangles of that grid 10.3–18.5 m deep taken one by one (the wings); what is left over is a piece where the wings
   meet (drawn as a plain block) or a strip under 2.6 m (a bay or a porch, left out). Each wing: its rectangle o, the
   ends that lie against another piece (join), and filler for the pieces. Null if a corner is not square or more than
   12 % of the outline would be left out. */
function serWings(outer, o) {
  const n = outer.length >> 1, { cx, cz, ux, uz } = o;
  let pts = []; for (let i = 0; i < n; i++) { const x = outer[2 * i] - cx, z = outer[2 * i + 1] - cz; pts.push([x * ux + z * uz, -x * uz + z * ux]); }
  pts = pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.6; });
  const m = pts.length; if (m < 4) return null;
  const along = []; for (let i = 0; i < m; i++) { const p = pts[i], q = pts[(i + 1) % m], du = Math.abs(q[0] - p[0]), dv = Math.abs(q[1] - p[1]); if (Math.min(du, dv) > 0.2 * Math.max(du, dv)) return null; along.push(du > dv ? 'u' : 'v'); }
  // snap: an edge along u fixes v of its two ends, an edge along v fixes u
  const sn = pts.map(p => p.slice());
  for (let i = 0; i < m; i++) { const j = (i + 1) % m; if (along[i] === 'u') { const v = (pts[i][1] + pts[j][1]) / 2; sn[i][1] = v; sn[j][1] = v; } else { const u = (pts[i][0] + pts[j][0]) / 2; sn[i][0] = u; sn[j][0] = u; } }
  const uniq = arr => { arr.sort((p, q) => p - q); const out = []; for (const x of arr) if (!out.length || x - out[out.length - 1] > 0.5) out.push(x); return out; };
  const Us = uniq(sn.map(p => p[0])), Vs = uniq(sn.map(p => p[1]));
  const inside = (u, v) => { let c = false; for (let i = 0, j = m - 1; i < m; j = i++) { const [ui, vi] = sn[i], [uj, vj] = sn[j]; if ((vi > v) !== (vj > v) && u < (uj - ui) * (v - vi) / (vj - vi) + ui) c = !c; } return c; };
  const NU = Us.length - 1, NV = Vs.length - 1; if (NU < 1 || NV < 1 || NU * NV > 100) return null;
  const cell = []; let total = 0;
  for (let i = 0; i < NU; i++) { cell.push([]); for (let j = 0; j < NV; j++) { const on = inside((Us[i] + Us[i + 1]) / 2, (Vs[j] + Vs[j + 1]) / 2); cell[i].push(on); if (on) total += (Us[i + 1] - Us[i]) * (Vs[j + 1] - Vs[j]); } }
  // the largest rectangle of free cells that ok(du, dv) accepts
  const take = ok => {
    let best = null;
    for (let i0 = 0; i0 < NU; i0++) for (let j0 = 0; j0 < NV; j0++) if (cell[i0][j0]) for (let i1 = i0; i1 < NU; i1++) { if (!cell[i1][j0]) break;
      for (let j1 = j0; j1 < NV; j1++) { let full = true; for (let i = i0; i <= i1 && full; i++) if (!cell[i][j1]) full = false; if (!full) break;
        const du = Us[i1 + 1] - Us[i0], dv = Vs[j1 + 1] - Vs[j0]; if (ok(du, dv) && (!best || du * dv > best.A)) best = { A: du * dv, i0, i1, j0, j1 }; } }
    if (!best) return null;
    for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) cell[i][j] = false;
    return [Us[best.i0], Us[best.i1 + 1], Vs[best.j0], Vs[best.j1 + 1]];
  };
  const wings = [], fills = []; let lost = 0;
  for (let r; (r = take((du, dv) => Math.min(du, dv) >= 10.3 && Math.min(du, dv) <= 18.5 && Math.max(du, dv) >= 8));) wings.push(r);
  for (let r; (r = take(() => true));) { const du = r[1] - r[0], dv = r[3] - r[2]; if (Math.min(du, dv) < 2.6) lost += du * dv; else fills.push(r); }
  if (!wings.length || lost > 0.12 * total) return null;
  const all = wings.concat(fills), toWorld = (u, v) => [cx + ux * u - uz * v, cz + uz * u + ux * v];
  const out = [];
  for (const [k, [u0, u1, v0, v1]] of all.entries()) {
    const du = u1 - u0, dv = v1 - v0, alongU = du >= dv, [wcx, wcz] = toWorld((u0 + u1) / 2, (v0 + v1) / 2);
    // an end (across the long axis) lies against another piece if they share more than 2 m of it
    const touch = at => all.some(([p0, p1, q0, q1], i) => i !== k && (alongU ? (Math.abs(p1 - at) < 0.01 || Math.abs(p0 - at) < 0.01) && Math.min(q1, v1) - Math.max(q0, v0) > 2 : (Math.abs(q1 - at) < 0.01 || Math.abs(q0 - at) < 0.01) && Math.min(p1, u1) - Math.max(p0, u0) > 2));
    const join = alongU ? { '-1': touch(u0), '1': touch(u1) } : { '-1': touch(v0), '1': touch(v1) };
    out.push({ o: alongU ? { cx: wcx, cz: wcz, ux, uz, a: du / 2, b: dv / 2 } : { cx: wcx, cz: wcz, ux: -uz, uz: ux, a: dv / 2, b: du / 2 }, join, filler: k >= wings.length });
  }
  return out;
}

export { SER_STAT, serBuild, seriesAtlas, seriesMaterial };
