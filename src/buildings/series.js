import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { lr } from '../landmarks/tiles.js';
import { band, flatRoof, roofFace, vband } from './walls.js';
import { SAMPLE_GLSL, std } from '../render/materials.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { U } from '../render/renderer.js';
import { box, polyA } from '../core/geometry.js';
import { area2, hb, obb, offsetRing, pick, reversed, rnd, sh } from '../core/util.js';

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
        float idx = inf.x, sd = inf.y / 255.0, nf = inf.z;
        if (nf > 0.5) idx += cell.y < 0.5 ? 0.0 : (cell.y > nf - 1.5 ? 2.0 : 1.0);
        vec2 org = vec2(mod(idx, ${SER_COLS}.0), floor(idx / ${SER_COLS}.0 + 0.01)), sc = vec2(1.0 / ${SER_COLS}.0, 1.0 / ${SER_ROWS}.0);
        vec2 auv = (vec2(org.x, ${SER_ROWS - 1}.0 - org.y) + clamp(f, vec2(0.002, 0.004), vec2(0.998, 0.996))) * sc;
        vec3 tcol = pow(ATLAS(uAtlas, auv, dX * sc, dY * sc).rgb, vec3(2.2));
        vec4 fm = ATLAS(uMask, auv, dX * sc, dY * sc);
        float wid = floor(fm.b * 255.0 / 16.0 + 0.5), hw = h12(cell * vec2(1.0, 1.7) + vec2(wid * 3.7, floor(sd * 41.0)));
        tcol = mix(tcol, tcol * (0.75 + 0.5 * hw), fm.g);
        diffuseColor.rgb = tcol * mix(vec3(1.0), vTint, fm.r);
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
  const fl = rec[5], style = rec[0]; if (rings.length !== 1 || fl < 5 || fl > 10 || style >= 5 || rec[2] > 0) return false;
  const o = obb(outer); if (!o || o.fill < 0.93) return false;
  const L = 2 * o.a, Dp = 2 * o.b;
  const n26 = L / SER.n9.W, tall = fl >= 8 && Dp >= 11 && Dp <= 17.5 && L >= 18 && L <= 140;
  // tall blocks whose length is a whole number of 25.9 m sections are the panel series; the rest are brick
  const type = fl === 5 && Dp >= 10.3 && Dp < 12.7 && L >= 30 ? 'k5' : fl === 5 && Dp >= 12.7 && Dp <= 17.5 && L >= 30 ? 'p5' : tall && n26 > 0.9 && Math.abs(n26 - Math.round(n26)) < 0.15 ? 'n9' : tall ? 't9' : null;
  if (!type) return false;
  const S = SER[type], G = T.m, Dd = T.d, { ux, uz, a, b } = o, vx = -uz, vz = ux, fh = 2.8, yb = S.yb, H = yb + fl * fh;
  const nSec = Math.max(fl >= 8 ? 1 : 2, Math.round(L / S.W)), secW = L / nSec, tint = hb(pick(S.pal, id, 1));
  const P = (su, sv, y, A = a, B = b) => [o.cx + ux * su * A + vx * sv * B, y, o.cz + uz * su * A + vz * sv * B];
  const ent = rnd(id, 51) < 0.5 ? -1 : 1, other = type === 'k5' && rnd(id, 52) > 0.65 ? 'C' : 'B';
  // long façades (u in sections, v in storeys) and the ends
  for (const sv of [-1, 1]) { const side = sv === ent ? 'A' : other, p0 = P(-1, sv, 0), p1 = P(1, sv, 0);
    serQuad(G.ser, p0[0], p0[2], p1[0], p1[2], yb, H, vx * sv, vz * sv, tint, 0, nSec, 0, fl, S.cells[side], seed, fl); }
  for (const su of [-1, 1]) { const p0 = P(su, -1, 0), p1 = P(su, 1, 0); serQuad(G.ser, p0[0], p0[2], p1[0], p1[2], yb, H, ux * su, uz * su, tint, 0, 1, 0, fl, S.cells.E, seed, 0); }
  // plinth, parapet and roof
  let ring = new Float32Array([P(-1, -1, 0), P(1, -1, 0), P(1, 1, 0), P(-1, 1, 0)].flatMap(p => [p[0], p[2]])); if (area2(ring) < 0) ring = reversed(ring);
  vband(G.plain, ring, 0, yb, hb(type === 'p5' ? '#8f8c86' : '#9a968f')); band(G.plain, ring, offsetRing(ring, 0.06), yb, hb('#a29e97'), false);
  const pitched = type === 'k5' && rec[4] >= 16;
  if (pitched) { const ov = 0.45, tp = 0.24, A = a + ov, B = b + ov, yE = H - ov * tp, yR = H + b * tp, RT = hb(pick(['#8c8f8e', '#7f8383', '#96958f', '#6f7476'], id, 3));
    for (const sv of [-1, 1]) roofFace(G.roof, [P(-1, sv, yE, A, B), P(1, sv, yE, A, B), P(1, 0, yR, A, 0), P(-1, 0, yR, A, 0)], ux, uz, RT, 1, seed);
    for (const su of [-1, 1]) polyA(G.plain, [P(su, -1, H), P(su, 1, H), P(su, 0, yR, a, 0)], sh(tint, 0.86), ux * su, 0, uz * su);
    polyA(G.plain, [P(-1, -1, yE, A, B), P(1, -1, yE, A, B), P(1, 1, yE, A, B), P(-1, 1, yE, A, B)], sh(tint, 0.5), 0, -1, 0); }
  else { const q = offsetRing(ring, -0.3), pc = sh(tint, 0.9); flatRoof(G.roof, [ring], H + 0.02, hb(pick(['#5d5f60', '#666867', '#545657'], id, 3)), 5, seed);
    vband(G.plain, ring, H, H + 0.45, pc); vband(G.plain, q, H, H + 0.45, sh(pc, 0.85), -1); band(G.plain, ring, q, H + 0.45, hb('#8e8b85'), false); }
  // roof plant: lift machine rooms of the 9-storey blocks, vent stacks of the 5-storey ones
  for (let k = 0; k < nSec; k++) { const t = (-a + (k + 0.5) * secW) / a, c = P(t, 0, 0);
    if (fl >= 8) box(G.plain, c[0], c[2], ux, uz, 2.4, 1.7, H, H + 2.8, sh(tint, 0.94)); else if (!pitched) box(Dd.plain, c[0] + vx * 1.5, c[2] + vz * 1.5, ux, uz, 0.45, 0.35, H, H + 1.1, sh(tint, 0.85));
    else box(Dd.plain, c[0], c[2], ux, uz, 0.4, 0.3, H + b * 0.24 - 0.6, H + b * 0.24 + 0.9, sh(tint, 0.82)); }
  // entrances: a door through the plinth, a concrete canopy, two steps
  for (let k = 0; k < nSec; k++) { const t = (-a + (k + 0.5) * secW) / a, c = P(t, ent, 0), nx = vx * ent, nz = vz * ent;
    polyA(Dd.plain, [[c[0] - ux * 0.6 + nx * 0.03, 0, c[2] - uz * 0.6 + nz * 0.03], [c[0] + ux * 0.6 + nx * 0.03, 0, c[2] + uz * 0.6 + nz * 0.03], [c[0] + ux * 0.6 + nx * 0.03, yb + 0.02, c[2] + uz * 0.6 + nz * 0.03], [c[0] - ux * 0.6 + nx * 0.03, yb + 0.02, c[2] - uz * 0.6 + nz * 0.03]], hb('#4a3e34'), nx, 0, nz);
    box(Dd.plain, c[0] + nx * 0.65, c[2] + nz * 0.65, ux, uz, 1.25, 0.65, 2.45, 2.6, hb('#9d9a93')); box(Dd.plain, c[0] + nx * 0.55, c[2] + nz * 0.55, ux, uz, 1.0, 0.55, 0, 0.3, hb('#8f8c86')); }
  // balconies, loggias
  const bcol = () => hb(pick(['#e1ddd3', '#c9b48e', '#a9b4a0', '#d8d0c0', '#8a6f52', '#b9b6ae'], id, 7)), GL = hb('#8394a0');
  const balcony = (c, nx, nz, hw, dep, y0, glazed, front) => {
    box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw, dep / 2, y0 - 0.12, y0, hb('#a8a59e'));
    if (glazed) { box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw, dep / 2, y0, y0 + 1.0, front); box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw, dep / 2, y0 + 1.0, y0 + 2.45, GL); }
    else { box(Dd.plain, c[0] + nx * (dep - 0.03), c[2] + nz * (dep - 0.03), ux, uz, hw, 0.03, y0, y0 + 1.05, front); for (const s of [-1, 1]) box(Dd.plain, c[0] + ux * s * (hw - 0.03) + nx * dep / 2, c[2] + uz * s * (hw - 0.03) + nz * dep / 2, ux, uz, 0.03, dep / 2, y0, y0 + 1.05, sh(front, 0.9)); } };
  const bs = -ent;   // the balcony side faces away from the entrances
  if ((type === 'k5' || type === 't9') && other === 'B') { const nx = vx * bs, nz = vz * bs, glz = rnd(id, 61), fc = bcol();
    for (let k = 0; k < nSec; k++) for (const fr of S.bal) { const t = (-a + (k + fr) * secW) / a, c = P(t, bs, 0);
      for (let f = 2; f <= fl; f++) balcony(c, nx, nz, type === 't9' ? 1.15 : 1.2, type === 't9' ? 1.05 : 0.9, yb + (f - 1) * fh, rnd(id * 13 + k * 7 + (fr > 0.5 ? 3 : 0), f) < glz * 0.45, type === 't9' && rnd(id, 62) < 0.5 ? hb('#8a3b2e') : fc); } }
  if (type === 'p5') { const nx = vx * bs, nz = vz * bs, c0 = P(0, bs, 0), fc = hb(pick(['#b5b2aa', '#a9a7a0', '#bdb8ad', '#a3927f', '#9c8a78'], id, 8)), glz = rnd(id, 63);
    for (let f = 1; f <= fl; f++) { const y0 = yb + (f - 1) * fh;
      box(Dd.plain, c0[0] + nx * 0.6, c0[2] + nz * 0.6, ux, uz, a, 0.6, y0 - 0.14, y0, hb('#a8a59e'));
      box(Dd.plain, c0[0] + nx * 1.17, c0[2] + nz * 1.17, ux, uz, a, 0.03, y0, y0 + 1.05, fc);
      for (let k = 0; k <= nSec * 2; k++) { const t = -1 + k / nSec, c = P(t, bs, 0); box(Dd.plain, c[0] + nx * 0.6, c[2] + nz * 0.6, ux, uz, 0.06, 0.6, y0, y0 + fh - 0.14, sh(tint, 0.92));
        if (k < nSec * 2 && rnd(id * 17 + k, f) < glz * 0.3) { const cm = P(-1 + (k + 0.5) / nSec, bs, 0); box(Dd.plain, cm[0] + nx * 1.15, cm[2] + nz * 1.15, ux, uz, secW / 4 - 0.08, 0.04, y0 + 1.05, y0 + fh - 0.2, GL); } } }
    box(Dd.plain, c0[0] + nx * 0.6, c0[2] + nz * 0.6, ux, uz, a, 0.6, H - 0.14, H, hb('#a8a59e')); }
  if (type === 'n9') { const nx = vx * bs, nz = vz * bs, fc = hb(pick(['#8a4a3a', '#b9b6ae', '#9b5a44', '#c4c0b6'], id, 9)), glz = rnd(id, 64), hw = 1.45, dep = 1.2;
    for (let k = 0; k < nSec; k++) for (const fr of S.lg) { const c = P((-a + (k + fr) * secW) / a, bs, 0);
      for (const s of [-1, 1]) box(Dd.plain, c[0] + ux * s * (hw + 0.06) + nx * dep / 2, c[2] + uz * s * (hw + 0.06) + nz * dep / 2, ux, uz, 0.08, dep / 2, yb + fh - 0.14, H, sh(tint, 0.9));
      for (let f = 2; f <= fl; f++) { const y0 = yb + (f - 1) * fh; box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw, dep / 2, y0 - 0.14, y0, hb('#a8a59e'));
        box(Dd.plain, c[0] + nx * (dep - 0.04), c[2] + nz * (dep - 0.04), ux, uz, hw, 0.04, y0, y0 + 1.05, fc);
        if (rnd(id * 19 + k * 5 + (fr > 0.5 ? 2 : 0), f) < glz * 0.4) box(Dd.plain, c[0] + nx * (dep - 0.05), c[2] + nz * (dep - 0.05), ux, uz, hw, 0.04, y0 + 1.05, y0 + fh - 0.2, GL); }
      box(Dd.plain, c[0] + nx * dep / 2, c[2] + nz * dep / 2, ux, uz, hw + 0.14, dep / 2, H - 0.14, H, hb('#a8a59e')); } }
  // downpipes at the joints of the sections
  if (type === 'k5') for (const sv of [-1, 1]) for (let k = 1; k < nSec; k++) { const c = P(-1 + 2 * k / nSec, sv, 0); box(Dd.plain, c[0] + vx * sv * 0.1, c[2] + vz * sv * 0.1, ux, uz, 0.05, 0.05, 0.3, H, hb('#8d9093')); }
  return true;
}

export { serBuild, seriesAtlas, seriesMaterial };
