import * as THREE from 'three';
import { fbm, mkCanvas, toTex, valueNoise } from '../render/textures.js';
import { hb } from '../core/util.js';

/* ---- textures ---- */
let lmRand = 7; const lr = () => (lmRand = (lmRand * 16807) % 2147483647) / 2147483647;
// wall surfaces, repeating: 0 Vitands' terrazzite render cut into large ashlar blocks, 1 plain render
function lmWallTex(kind) {
  if (kind >= 2) return lmWallTex2(kind);
  const S = 512, cv = mkCanvas(S, S), g = cv.getContext('2d'), id = g.createImageData(S, S), d = id.data, n1 = fbm(S, [4, 16, 64], 31 + kind), n2 = valueNoise(S, 128, 77 + kind);
  const PXM = kind === 0 ? S / 6 : S / 8;                    // 6 m or 8 m per tile
  const bw = 3 * PXM, bh = 1.5 * PXM, tone = [];
  for (let k = 0; k < 64; k++) tone.push(0.97 + lr() * 0.06);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x; let v = 0.9 + (n1[i] - 0.5) * 0.09 + (Math.random() - 0.5) * 0.07;
    if (Math.random() < 0.06) v -= 0.12 + Math.random() * 0.1; else if (Math.random() < 0.03) v += 0.08;   // grains of crushed stone
    if (kind === 0) {
      const row = Math.floor(y / bh), off = row % 2 ? bw / 2 : 0, col = Math.floor((x + off) / bw), bx = (x + off) % bw, by = y % bh;
      v *= tone[(row * 7 + col * 3) % 64];
      if (bx < 2 || by < 2) v *= 0.8;
    } else v *= 0.96 + (n2[i] - 0.5) * 0.08 - Math.max(0, n2[(i * 7) % (S * S)] - 0.75) * 0.25 * (y / S);
    v = Math.max(0, Math.min(1, v)) * 255; d[4 * i] = v; d[4 * i + 1] = v * 0.995; d[4 * i + 2] = v * 0.98; d[4 * i + 3] = 255;
  }
  g.putImageData(id, 0, 0); const t = toTex(cv, true, true); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

/* more wall surfaces, metres per tile in LMWS: 2 the university's ochre render scored into 1.5 × 0.75 m ashlar,
   3 red facing brick (colour baked in, laid in stretcher bond), 4 small beige ceramic tiles of the 1980s slabs with a
   panel joint every 3 m, 5 white precast panels, 6 buff brick, 7 the pale grey sand-lime (silicate) brick of the
   Soviet schools and blocks */
const LMWS = [6, 8, 6, 3, 6, 6, 3, 3];
function lmWallTex2(kind) {
  const S = 512, cv = mkCanvas(S, S), g = cv.getContext('2d'), id = g.createImageData(S, S), d = id.data, n1 = fbm(S, [4, 16, 64], 41 + kind);
  const tone = []; for (let k = 0; k < 4096; k++) tone.push(lr());
  const BR = kind === 6   // 6: the buff brick of the 1970s cinema, pale yellow to ochre with a few pinkish bricks
    ? [[206, 172, 116], [196, 160, 104], [214, 184, 132], [186, 148, 96], [200, 164, 110], [192, 140, 100], [218, 190, 140], [180, 142, 92]]
    : kind === 7 ? [[222, 218, 206], [214, 209, 196], [228, 224, 213], [206, 201, 189], [218, 213, 200], [200, 196, 186], [232, 228, 218], [210, 205, 194]]
    : [[178, 74, 46], [168, 66, 42], [188, 88, 54], [158, 60, 40], [182, 80, 50], [146, 56, 40], [194, 96, 60], [172, 72, 48]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, grain = (Math.random() - 0.5) * 0.06 + (n1[i] - 0.5) * 0.08;
    let r, gg, b;
    if (kind === 3 || kind === 6 || kind === 7) {
      const row = Math.floor(y * 40 / S), off = row % 2 ? S / 24 : 0, xx = (x + off) % S, col = Math.floor(xx * 12 / S) % 12, bx = xx - col * S / 12, by = y - row * S / 40;
      if (bx < 2.2 || by < 2.0) { const m = 0.72 + grain; r = 184 * m; gg = 176 * m; b = 166 * m; }
      else { const c = BR[Math.floor(tone[(row * 13 + col * 7) % 4096] * 8)], m = 0.9 + tone[(row * 31 + col * 17 + 5) % 4096] * 0.16 + grain * 1.3 - (by < 3.5 || bx < 4 ? 0.06 : 0); r = c[0] * m; gg = c[1] * m; b = c[2] * m; }
    } else {
      let v = 0.9 + grain;
      if (Math.random() < 0.04) v -= 0.08;
      if (kind === 2) {
        const row = Math.floor(y / 64), off = row % 2 ? 64 : 0, bx = (x + off) % 128, by = y % 64;
        v *= 0.97 + tone[(row * 7 + Math.floor((x + off) / 128) * 3) % 4096] * 0.06; if (bx < 2 || by < 2) v *= 0.8;
      } else if (kind === 4) {
        const tx = x % 12.8, ty = y % 12.8;
        v = 0.86 + tone[(Math.floor(y / 12.8) * 40 + Math.floor(x / 12.8)) % 4096] * 0.09 + grain * 0.5; if (tx < 1.3 || ty < 1.3) v *= 0.84; if (x % 256 < 3) v *= 0.7;
      } else { v = 0.94 + grain * 0.6; if (x % 256 < 2) v *= 0.82; if (y % 128 < 1) v *= 0.93; }
      v = Math.max(0, Math.min(1, v)) * 255; r = v; gg = v * 0.995; b = v * 0.985;
    }
    d[4 * i] = Math.max(0, Math.min(255, r)); d[4 * i + 1] = Math.max(0, Math.min(255, gg)); d[4 * i + 2] = Math.max(0, Math.min(255, b)); d[4 * i + 3] = 255;
  }
  g.putImageData(id, 0, 0); const t = toTex(cv, true, true); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

/* Detail atlas: windows, doors, glazing, posters. Three canvases share the layout: colour, ORM (G roughness,
   B metalness) and the light seen through the glass at night. Tiles are drawn in metres from their top-left corner. */
const LMT = {};
function lmTiles() {
  const PX = 60, AW = 2048, AH = 2048;   // 60 px per metre keeps every tile on one 2048² atlas
  const cv = mkCanvas(AW, AH), g = cv.getContext('2d'), om = mkCanvas(AW, AH), o = om.getContext('2d'), gm = mkCanvas(AW, AH), e = gm.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, AW, AH); o.fillStyle = 'rgb(0,225,0)'; o.fillRect(0, 0, AW, AH); e.fillStyle = '#000'; e.fillRect(0, 0, AW, AH);
  let X = 0, Y = 0;
  const ORM = ['rgb(0,225,0)', 'rgb(0,110,110)', 'rgb(0,26,0)', 'rgb(0,34,140)', 'rgb(0,150,0)'];   // matte, metal frame, glass, mirror glass, wood
  const pr = (x, y, w, h) => [X + x * PX, Y + y * PX, w * PX, h * PX];
  function R(x, y, w, h, col, k = 0, glow = '#000') { const [a, b, c, d] = pr(x, y, w, h); g.fillStyle = col; g.fillRect(a, b, c, d); o.fillStyle = ORM[k]; o.fillRect(a, b, c, d); e.fillStyle = glow; e.fillRect(a, b, c, d); }
  const GL = [['#38434c', '#5d6c77', '#29323a'], ['#3f6476', '#86a9ba', '#33566a'], ['#d6d2c7', '#ebe7de', '#c9c4b8'], ['#2d3a44', '#47596a', '#24303a']];
  function glass(x, y, w, h, tone = 0, glow = '#ffc98a') {
    const [a, b, c, d] = pr(x, y, w, h), gr = g.createLinearGradient(0, b, 0, b + d), cc = GL[tone];
    gr.addColorStop(0, cc[0]); gr.addColorStop(0.42, cc[1]); gr.addColorStop(0.5, cc[2]); gr.addColorStop(1, cc[0]); g.fillStyle = gr; g.fillRect(a, b, c, d);
    o.fillStyle = ORM[tone === 1 ? 3 : tone === 2 ? 0 : 2]; o.fillRect(a, b, c, d);
    const ge = e.createLinearGradient(0, b, 0, b + d); ge.addColorStop(0, glow); ge.addColorStop(1, shadeHex(glow, 0.55)); e.fillStyle = ge; e.fillRect(a, b, c, d);
  }
  function shadeHex(h, f) { const c = hb(h); return `rgb(${c[0] * f | 0},${c[1] * f | 0},${c[2] * f | 0})`; }
  function line(x1, y1, x2, y2, w, col, k = 1) { for (const [ctx, c] of [[g, col], [o, ORM[k]], [e, '#000']]) { ctx.strokeStyle = c; ctx.lineWidth = w * PX; ctx.beginPath(); ctx.moveTo(X + x1 * PX, Y + y1 * PX); ctx.lineTo(X + x2 * PX, Y + y2 * PX); ctx.stroke(); } }
  function txt(s, x, y, size, col, font = '700', align = 'center') { g.fillStyle = col; g.font = `${font} ${size * PX}px "Golos Text", "Trebuchet MS", sans-serif`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, X + x * PX, Y + y * PX); }
  // window with frame f (thickness t), panes cols × rows; tone of glass
  function sash(x, y, w, h, fcol, t, cols, rows, tone = 0, glow) {
    R(x, y, w, h, fcol, 1); const iw = (w - t * (cols + 1)) / cols, ih = (h - t * (rows + 1)) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) glass(x + t + i * (iw + t), y + t + j * (ih + t), iw, ih, tone, glow);
  }
  const defs = [];
  const T = (name, w, h, draw) => defs.push({ name, w, h, draw });
  // Daugavpils Regional Hospital: pale metal frames, blue-grey glazing, privacy blinds and the glazed entrance.
  T('hsWin', 1.45, 1.7, () => {
    R(0, 0, 1.45, 1.7, '#c9d0d0', 1); glass(0.08, 0.08, 0.61, 1.54, 1, '#ffe5bd'); glass(0.76, 0.08, 0.61, 1.54, 1, '#ffe5bd');
    R(0.7, 0.07, 0.05, 1.56, '#b7c0c1', 1); R(0.08, 0.8, 1.29, 0.045, '#aeb9bb', 1);
  });
  T('hsWinB', 1.45, 1.7, () => {
    R(0, 0, 1.45, 1.7, '#c9d0d0', 1); glass(0.08, 0.08, 0.61, 1.54, 1, '#ffe5bd'); glass(0.76, 0.08, 0.61, 1.54, 1, '#ffe5bd');
    R(0.7, 0.07, 0.05, 1.56, '#b7c0c1', 1); R(0.08, 0.08, 1.29, 0.48, 'rgba(236,238,233,0.92)', 0, '#f3dfbd');
  });
  T('hsLoggia', 12.4, 1.77, () => {
    R(0, 0, 12.4, 1.77, '#344247', 1); R(0.18, 0.16, 12.04, 1.38, '#26343a', 1);
    R(0.2, 1.34, 12.0, 0.32, '#b9c2c1', 1); R(0.2, 1.02, 12.0, 0.075, '#7c898a', 1);
    for (let x = 0.35; x < 12.2; x += 0.65) R(x, 1.02, 0.035, 0.33, '#6e7a7b', 1);
    R(0.3, 0.18, 0.28, 0.82, '#c7cecc', 1); R(11.82, 0.18, 0.28, 0.82, '#c7cecc', 1);
  });
  T('hsEntry', 5.8, 3.4, () => {
    R(0, 0, 5.8, 3.4, '#66757a', 1); glass(0.1, 0.1, 5.6, 3.2, 1, '#fff0d5');
    R(2.83, 0.1, 0.12, 3.2, '#d4dcdb', 1); R(0.15, 0.1, 0.08, 3.2, '#cad3d2', 1); R(5.57, 0.1, 0.08, 3.2, '#cad3d2', 1);
    R(2.62, 1.35, 0.08, 0.22, '#53636a', 1); R(3.06, 1.35, 0.08, 0.22, '#53636a', 1);
  });
  T('hsBay', 5.8, 4.43, () => {
    R(0, 0, 5.8, 4.43, '#738085', 1); R(0.22, 0.2, 5.36, 4.02, '#28383e', 1); R(0.35, 0.3, 5.1, 3.8, '#1d292e', 1);
    R(0.22, 0.18, 5.36, 0.16, '#b7c4c5', 1); R(0.22, 4.0, 5.36, 0.17, '#b7c4c5', 1);
    for (let y = 0.5; y < 3.9; y += 0.65) R(0.36, y, 5.08, 0.035, 'rgba(163,179,181,0.5)', 1);
  });
  T('hsSlot', 1.7, 0.75, () => { R(0, 0, 1.7, 0.75, '#c7cecc', 1); glass(0.08, 0.08, 0.7, 0.59, 1, '#fff0d5'); glass(0.85, 0.08, 0.77, 0.59, 1, '#fff0d5'); R(0.8, 0.08, 0.05, 0.59, '#aebabb', 1); });
  T('rtWin', 1.2, 0.75, () => { R(0, 0, 1.2, 0.75, '#46525a', 1); glass(0.07, 0.07, 1.06, 0.61, 1, '#fff0d5'); });
  const lattice = (x, y, w, h, col) => { const n = 4, cw = w / n; for (let i = 0; i < n; i++) { line(x + i * cw, y, x + (i + 1) * cw, y + h, 0.035, col); line(x + (i + 1) * cw, y, x + i * cw, y + h, 0.035, col); } line(x, y + h / 2, x + w, y + h / 2, 0.03, col); };
  const BRONZE = '#3a3027', WOOD = '#2e1d12';
  // ---- Vienības nams
  T('vnDoor', 1.62, 4.08, () => {
    R(0, 0, 1.62, 4.08, BRONZE, 1); glass(0.08, 0.08, 1.46, 1.22, 0); lattice(0.08, 0.08, 1.46, 1.22, '#4a3d30'); R(0, 1.3, 1.62, 0.1, BRONZE, 1);
    for (const lx of [0.08, 0.84]) { R(lx, 1.42, 0.7, 2.62, WOOD, 4); for (let k = 0; k < 3; k++) { const py = 1.62 + k * 0.78; R(lx + 0.14, py, 0.42, 0.42, '#2b1b10', 4); glass(lx + 0.19, py + 0.05, 0.32, 0.32, 3, '#c89458'); line(lx + 0.35, py + 0.05, lx + 0.51, py + 0.21, 0.025, '#4a3d30'); line(lx + 0.51, py + 0.21, lx + 0.35, py + 0.37, 0.025, '#4a3d30'); line(lx + 0.35, py + 0.37, lx + 0.19, py + 0.21, 0.025, '#4a3d30'); line(lx + 0.19, py + 0.21, lx + 0.35, py + 0.05, 0.025, '#4a3d30'); } }
    R(0.74, 2.7, 0.05, 0.1, '#c9a24a', 1); R(0.83, 2.7, 0.05, 0.1, '#c9a24a', 1);
  });
  T('vnShopWin', 1.62, 4.08, () => {
    R(0, 0, 1.62, 4.08, BRONZE, 1); glass(0.08, 0.08, 1.46, 1.22, 0); lattice(0.08, 0.08, 1.46, 1.22, '#4a3d30'); R(0, 1.3, 1.62, 0.1, BRONZE, 1);
    glass(0.1, 1.48, 1.42, 2.1, 0, '#ffe2b8'); const hue = Math.floor(lr() * 360); R(0.44, 1.75, 0.74, 1.05, `hsl(${hue},55%,45%)`, 0, '#fff0d8'); R(0.5, 1.82, 0.62, 0.3, `hsl(${(hue + 160) % 360},60%,75%)`, 0, '#fff0d8');
    R(0.05, 3.62, 1.52, 0.42, BRONZE, 1);
  });
  T('vnWinMid', 1.55, 2.4, () => {
    sash(0, 0, 1.55, 2.4, '#d6d4cc', 0.07, 3, 4, 2, '#ffd9a6');
    for (let i = 0; i < 9; i++) line(0.12 + i * 0.165, 0.1, 0.12 + i * 0.165, 2.3, 0.015, 'rgba(150,145,135,0.6)', 0);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) { const [a, b] = pr(0.1 + i * 0.235, 0.62 + j * 0.58, 0, 0); g.strokeStyle = 'rgba(140,135,125,0.55)'; g.lineWidth = 2; g.beginPath(); g.arc(a + 0.117 * PX, b, 0.11 * PX, 0, Math.PI); g.stroke(); }
  });
  T('vnWinTop', 1.85, 1.7, () => sash(0, 0, 1.85, 1.7, '#2f2b27', 0.06, 3, 2, 0));
  T('vnStrip', 0.95, 14.2, () => { R(0, 0, 0.95, 14.2, '#2c2a27', 1); for (let j = 0; j < 26; j++) for (let i = 0; i < 2; i++) glass(0.06 + i * 0.43, 0.06 + j * 0.544, 0.37, 0.49, 0, j % 9 === 4 ? '#fff2dc' : '#ffcf94'); });
  T('vnWin', 1.45, 2.15, () => { R(0, 0, 1.45, 2.15, '#3f342b', 1); glass(0.07, 0.07, 1.31, 0.5, 0); glass(0.07, 0.64, 0.62, 1.44, 0); glass(0.76, 0.64, 0.62, 1.44, 0); R(0.07, 0.64, 0.1, 1.44, 'rgba(220,215,205,0.55)', 0, '#e8c48c'); R(1.28, 0.64, 0.1, 1.44, 'rgba(220,215,205,0.55)', 0, '#e8c48c'); });
  T('vnTall', 1.7, 7.8, () => sash(0, 0, 1.7, 7.8, '#2d2b29', 0.05, 3, 13, 0, '#ffd7a0'));
  for (const [k, c] of [['vnShopA', '#7a1f25'], ['vnShopB', '#1f4f7a'], ['vnShopC', '#2f6b3c']]) T(k, 3.6, 3.6, () => {
    R(0, 0, 3.6, 0.55, c, 0, shadeHex(c, 0.9)); R(0.5, 0.18, 2.6, 0.18, '#f4f1e8', 0, '#ffffff'); R(0, 0.55, 3.6, 3.05, '#4f5254', 1);
    glass(0.08, 0.63, 0.95, 2.9, 0, '#fff1d6'); glass(1.11, 0.63, 2.41, 2.3, 0, '#fff1d6'); R(1.11, 2.98, 2.41, 0.55, '#3f4244', 1);
  });
  T('vnPort', 1.1, 1.1, () => {
    R(0, 0, 1.1, 1.1, '#a39f97'); const [a, b] = pr(0.55, 0.55, 0, 0);
    for (const [ctx, c] of [[g, '#2e2b28'], [o, ORM[1]], [e, '#000']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(a, b, 0.52 * PX, 0, 6.3); ctx.fill(); }
    const gr = g.createLinearGradient(0, b - 0.44 * PX, 0, b + 0.44 * PX); gr.addColorStop(0, '#3a4650'); gr.addColorStop(0.5, '#62717c'); gr.addColorStop(1, '#2c363e');
    for (const [ctx, c] of [[g, gr], [o, ORM[2]], [e, '#ffc98a']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(a, b, 0.44 * PX, 0, 6.3); ctx.fill(); }
    line(0.11, 0.55, 0.99, 0.55, 0.04, '#2e2b28'); line(0.55, 0.11, 0.55, 0.99, 0.04, '#2e2b28');
  });
  T('vnSideDoor', 1.5, 2.9, () => { R(0, 0, 1.5, 2.9, BRONZE, 1); glass(0.08, 0.08, 1.34, 0.42, 0); for (const lx of [0.08, 0.77]) { R(lx, 0.58, 0.65, 2.32, '#4a3020', 4); glass(lx + 0.1, 0.72, 0.45, 0.7, 0); } });
  T('vnKonc', 3.4, 3.4, () => { R(0, 0, 3.4, 3.4, '#5a4a32', 1); glass(0.08, 0.08, 3.24, 0.6, 0, '#ffe6bd'); for (let k = 0; k < 3; k++) { glass(0.08 + k * 1.1, 0.78, 1.0, 2.62, 0, '#ffe6bd'); R(0.12 + k * 1.1 + 0.44, 1.9, 0.12, 0.04, '#c9a24a', 1); } });
  T('vnVent', 0.6, 0.6, () => { R(0, 0, 0.6, 0.6, '#3a3a38', 1); for (let k = 0; k < 6; k++) R(0.06, 0.06 + k * 0.08, 0.48, 0.04, '#585856', 1); });
  T('vnBase', 0.9, 0.55, () => sash(0, 0, 0.9, 0.55, '#3a3631', 0.05, 2, 1, 3, '#7a6040'));
  T('vnSmall', 0.8, 0.8, () => sash(0, 0, 0.8, 0.8, '#34312d', 0.05, 2, 2, 0, '#c8a070'));
  T('vnPoster', 3.6, 2.5, () => {
    R(0, 0, 3.6, 2.5, '#2b2d2f', 1); R(0.08, 0.08, 3.44, 0.3, '#f1f0eb', 0, '#fff7e8'); txt('DAUGAVPILS  TEĀTRIS', 1.8, 0.24, 0.17, '#2b2d2f');
    for (let k = 0; k < 3; k++) { const x = 0.1 + k * 1.15, h = Math.floor(lr() * 360); const gr = g.createLinearGradient(0, Y + 0.46 * PX, 0, Y + 2.4 * PX); gr.addColorStop(0, `hsl(${h},45%,32%)`); gr.addColorStop(1, `hsl(${(h + 40) % 360},55%,62%)`);
      R(x, 0.46, 1.08, 1.94, '#000', 0, '#fff4e0'); g.fillStyle = gr; g.fillRect(...pr(x, 0.46, 1.08, 1.94)); R(x + 0.2, 0.9, 0.68, 0.8, `hsl(${(h + 180) % 360},35%,70%)`, 0, '#fff4e0');
      txt(['MELI', 'HAMLETS', 'SAPŅI'][k], x + 0.54, 0.66, 0.18, '#ffffff', '800'); txt('2026', x + 0.54, 2.12, 0.1, '#ffffff', '600'); }
  });
  T('vnInfo', 1.7, 0.42, () => { R(0, 0, 1.7, 0.42, '#f4f2ec', 0, '#fff8ec'); R(0, 0, 0.42, 0.42, '#c0262d', 0, '#ff6050'); txt('i', 0.21, 0.21, 0.3, '#ffffff', '800'); txt('Info centrs', 1.06, 0.21, 0.2, '#1c2a3a', '700'); });
  // ---- Park Hotel Latgola and the shopping centre
  for (const [v, sp] of [['A', '#e6dc9f'], ['B', '#dfe1db']]) for (const side of ['L', 'M', 'R']) T('lat' + v + side, 2.4557, 2.9, () => {
    R(0, 0, 2.4557, 2.9, sp); R(0, 0, 2.4557, 0.42, shadeHex(sp, 0.97)); line(0, 0.42, 2.4557, 0.42, 0.03, 'rgba(0,0,0,0.25)', 0);
    const l = side === 'L' ? 0.34 : 0.1, r = side === 'R' ? 0.34 : 0.1;
    if (side === 'L') R(0, 0, 0.26, 2.9, '#cdc7b3'); if (side === 'R') R(2.1957, 0, 0.26, 2.9, '#cdc7b3');
    const w = 2.4557 - l - r; R(l, 0.5, w, 1.48, '#f2f2ee', 1); glass(l + 0.06, 0.56, w * 0.38 - 0.06, 1.36, 1); glass(l + w * 0.38 + 0.03, 0.56, w * 0.62 - 0.09, 1.36, 1);
    line(l, 2.0, l + w, 2.0, 0.04, 'rgba(0,0,0,0.22)', 0);
  });
  T('latFrameGl', 14.74, 5.8, () => { R(0, 0, 14.74, 5.8, '#6c767c', 1); glass(0.06, 0.06, 14.62, 5.68, 1, '#ffdcae'); for (let k = 1; k < 12; k++) line(0, k * 0.483, 14.74, k * 0.483, 0.035, '#6c767c'); for (let k = 1; k < 6; k++) line(k * 2.457, 0, k * 2.457, 5.8, 0.06, '#6c767c'); });
  T('latCurt', 1.2, 2.9, () => { R(0, 0, 1.2, 2.9, '#4a5157', 1); glass(0.04, 0.04, 1.12, 2.5, 1, '#fff1d8'); R(0.04, 2.58, 1.12, 0.28, '#2f414d', 3); });
  T('latSq', 1.25, 1.25, () => sash(0, 0, 1.25, 1.25, '#ecece8', 0.07, 2, 1, 0));
  T('latStripO', 1.4, 2.9, () => { R(0, 0, 1.4, 2.9, '#e9e9e5', 1); glass(0.07, 0.07, 1.26, 1.86, 1); R(0, 2.0, 1.4, 0.9, '#e88f2a'); });
  T('latTop', 2.4557, 3.2, () => { R(0, 0, 2.4557, 3.2, '#cdd0d0', 1); glass(0.05, 0.05, 1.18, 3.1, 1, '#ffe1b4'); glass(1.27, 0.05, 1.14, 3.1, 1, '#ffe1b4'); R(0, 2.05, 2.4557, 0.06, '#cdd0d0', 1); });
  T('latStore', 3.6625, 4.1, () => { R(0, 0, 3.6625, 4.1, '#34383b', 1); glass(0.08, 0.08, 3.5, 0.72, 0, '#fff0d4'); glass(0.08, 0.88, 1.7, 3.14, 0, '#fff0d4'); glass(1.86, 0.88, 1.72, 3.14, 0, '#fff0d4'); });
  T('latSlat', 3.6625, 4.1, () => { R(0, 0, 3.6625, 4.1, '#34383b', 1); glass(0.08, 0.08, 3.5, 3.94, 0, '#ffe8c4'); for (let x = 1.6; x < 3.58; x += 0.13) R(x, 0.08, 0.075, 3.94, '#7b5234', 4); });
  T('latDoor', 3.6625, 4.1, () => { R(0, 0, 3.6625, 4.1, '#2a2f36', 1); R(0.08, 0.08, 3.5, 0.62, '#1d2d5a', 0, '#5a78c8'); txt('PARK HOTEL LATGOLA', 1.83, 0.4, 0.22, '#f3f3f3', '700'); glass(0.08, 0.78, 1.7, 3.24, 0, '#fff3dc'); glass(1.86, 0.78, 1.72, 3.24, 0, '#fff3dc'); R(1.78, 0.78, 0.08, 3.24, '#2a2f36', 1); });
  T('latBackW', 1.9, 1.5, () => sash(0, 0, 1.9, 1.5, '#efefeb', 0.07, 2, 1, 0));
  T('latRail', 2.4557, 1.1, () => { R(0, 0, 2.4557, 1.1, '#9aa0a3', 1); glass(0.05, 0.1, 2.3557, 0.95, 3, '#000'); });
  T('latLight', 0.35, 0.35, () => R(0, 0, 0.35, 0.35, '#fffaf0', 0, '#ffffff'));
  T('mallGlass', 1.4, 2.45, () => { R(0, 0, 1.4, 2.45, '#8a9094', 1); glass(0.05, 0.05, 1.3, 2.35, 1, '#fff1d8'); });
  T('mallStore', 3.6, 3.6, () => { R(0, 0, 3.6, 3.6, '#a5a9ac', 1); R(0, 0, 3.6, 0.5, '#5a5f63', 0); R(0.4, 0.15, 2.8, 0.2, ['#e23a3a', '#2d7fd1', '#2fa356', '#f0a020'][Math.floor(lr() * 4)], 0, '#ffffff'); glass(0.08, 0.58, 3.44, 2.94, 0, '#fff4e0'); R(1.76, 0.58, 0.08, 2.94, '#a5a9ac', 1); });
  T('mallDoor', 4.0, 3.6, () => { R(0, 0, 4.0, 3.6, '#a5a9ac', 1); glass(0.08, 0.08, 3.84, 0.7, 0, '#fff4e0'); glass(0.08, 0.86, 1.88, 2.74, 0, '#fff4e0'); glass(2.04, 0.86, 1.88, 2.74, 0, '#fff4e0'); });
  T('mallSigns', 2.0, 7.0, () => { R(0, 0, 2.0, 7.0, '#3b3f42', 1); const cs = ['#d8262f', '#f4f2ec', '#1d6fb8', '#f2b705', '#2e8b57', '#f4f2ec', '#7a2e8e']; for (let k = 0; k < 7; k++) { R(0.12, 0.15 + k * 0.97, 1.76, 0.82, cs[k], 0, '#ffffff'); R(0.35, 0.45 + k * 0.97, 1.3, 0.2, k % 2 ? '#2b2b2b' : '#ffffff', 0, '#ffffff'); } });
  T('mallService', 3.0, 3.2, () => { R(0, 0, 3.0, 3.2, '#8d9194', 1); for (let y = 0.1; y < 3.2; y += 0.12) line(0, y, 3.0, y, 0.02, '#6e7275'); });
  // ---- Daugavpils University, old building (Vienības iela 13): wooden double windows with a transom, oak doors
  const DUF = '#e6e2d8', DUW = '#4a3424';
  for (const [k, blind] of [['duWin', 0], ['duWinB', 1], ['duWinC', 2]]) T(k, 1.1, 2.2, () => {
    R(0, 0, 1.1, 2.2, DUF, 1);
    for (const lx of [0.08, 0.59]) { glass(lx, 0.08, 0.43, 0.5, 0, '#ffd9a6'); glass(lx, 0.66, 0.43, 1.46, 0, '#ffd9a6'); R(lx + 0.02, 0.62, 0.39, 0.02, '#d6d1c5', 1); }
    if (blind === 1) { R(0.08, 0.66, 0.94, 0.62, 'rgba(236,233,224,0.92)', 0, '#f2dcb4'); for (let j = 0; j < 12; j++) line(0.08, 0.69 + j * 0.05, 1.02, 0.69 + j * 0.05, 0.008, 'rgba(180,176,166,0.8)', 0); }
    if (blind === 2) { R(0.08, 0.66, 0.16, 1.46, 'rgba(226,214,186,0.9)', 0, '#f0d0a0'); R(0.86, 0.66, 0.16, 1.46, 'rgba(226,214,186,0.9)', 0, '#f0d0a0'); }
  });
  T('duDoor', 1.8, 3.6, () => {
    R(0, 0, 1.8, 3.6, DUW, 4); glass(0.1, 0.1, 1.6, 0.72, 0, '#ffe2b0'); line(0.9, 0.1, 0.9, 0.82, 0.04, DUW, 4); for (let k = 1; k < 4; k++) line(0.1 + k * 0.4, 0.1, 0.1 + k * 0.4, 0.82, 0.02, DUW, 4); R(0, 0.82, 1.8, 0.12, '#3b2a1d', 4);
    for (const lx of [0.08, 0.92]) { R(lx, 0.98, 0.8, 2.58, '#5c4029', 4); glass(lx + 0.12, 1.12, 0.56, 1.15, 0, '#ffe2b0'); R(lx + 0.12, 2.42, 0.56, 0.98, '#50371f', 4); R(lx + 0.18, 2.48, 0.44, 0.86, '#5c4029', 4); }
    R(0.8, 2.15, 0.05, 0.32, '#c9a24a', 1); R(0.95, 2.15, 0.05, 0.32, '#c9a24a', 1);
  });
  T('duPlaque', 0.6, 0.45, () => { R(0, 0, 0.6, 0.45, '#2c2f33', 1); R(0.04, 0.04, 0.52, 0.37, '#c9b98a', 1); txt('DU', 0.3, 0.22, 0.16, '#2c2f33', '700'); });
  // ---- the new building, Parādes iela 1 (1980s): white PVC windows in ribbons, stair windows, the brick lattice
  for (const [k, blind] of [['p1Win', 0], ['p1WinB', 1]]) T(k, 1.5, 1.45, () => {
    R(0, 0, 1.5, 1.45, '#f2f2ee', 1); glass(0.07, 0.07, 0.62, 1.31, 0); glass(0.78, 0.07, 0.65, 1.31, 0); R(0.71, 0.05, 0.05, 1.35, '#e0e0da', 1);
    if (blind) R(0.07, 0.07, 1.36, 0.5, 'rgba(238,238,232,0.92)', 0, '#f6e6c8');
  });
  T('p1Slab', 1.8, 1.45, () => { R(0, 0, 1.8, 1.45, '#f0f0ec', 1); glass(0.07, 0.07, 0.5, 1.31, 0); glass(0.64, 0.07, 0.52, 1.31, 0); glass(1.23, 0.07, 0.5, 1.31, 0); });
  T('p1SlabB', 1.8, 1.45, () => { R(0, 0, 1.8, 1.45, '#f0f0ec', 1); glass(0.07, 0.07, 0.5, 1.31, 0); glass(0.64, 0.07, 0.52, 1.31, 0); glass(1.23, 0.07, 0.5, 1.31, 0); R(0.07, 0.07, 1.66, 0.42, 'rgba(232,228,214,0.9)', 0, '#f2e2c2'); });
  T('p1Tall', 1.3, 2.7, () => sash(0, 0, 1.3, 2.7, '#efefea', 0.07, 2, 3, 0, '#ffe8c4'));
  T('p1Small', 0.9, 0.9, () => sash(0, 0, 0.9, 0.9, '#efefea', 0.06, 1, 1, 0));
  T('p1Door', 3.0, 3.0, () => { R(0, 0, 3.0, 3.0, '#4a4036', 1); glass(0.06, 0.06, 2.88, 0.62, 0, '#fff0d4'); for (let k = 0; k < 4; k++) glass(0.06 + k * 0.725, 0.74, 0.665, 2.2, 0, '#fff0d4'); R(1.48, 1.6, 0.04, 0.5, '#c0c0bc', 1); R(1.56, 1.6, 0.04, 0.5, '#c0c0bc', 1); });
  T('p1Lat', 3.6, 4.2, () => {
    R(0, 0, 3.6, 4.2, '#24170f', 0, '#000');
    for (let j = 0; j < 4.2 / 0.26; j++) for (let i = 0; i < 3.6 / 0.26; i++) { const x = i * 0.26 + (j % 2 ? 0.13 : 0); R(x, j * 0.26, 0.13, 0.13, '#b5532f'); R(x + 0.13, j * 0.26 + 0.13, 0.13, 0.13, '#a84a2a'); R(x, j * 0.26 + 0.13, 0.26, 0.04, '#9c4426'); }
  });
  // ---- the laboratory building, Parādes iela 1A (SIA "Nams", 2014): Schüco curtain wall, ribbon windows, glazed doors
  const LMF_ = '#3b4044';
  for (const [k, op] of [['labCW', 0], ['labCWo', 1]]) T(k, 1.4, 3.7, () => {
    R(0, 0, 1.4, 3.7, LMF_, 1); glass(0.05, 0.05, 1.3, 1.25, 1, '#fff1d8'); glass(0.05, 1.36, 1.3, 2.29, 1, '#fff1d8');
    if (op) { R(0.18, 1.5, 1.04, 1.4, LMF_, 1); glass(0.23, 1.55, 0.94, 1.3, 3, '#fff1d8'); }
  });
  T('labRib', 1.5, 1.05, () => { R(0, 0, 1.5, 1.05, LMF_, 1); glass(0.05, 0.05, 1.4, 0.95, 3, '#ffe9c4'); });
  T('labGl', 1.4, 3.3, () => { R(0, 0, 1.4, 3.3, '#5a6268', 1); glass(0.05, 0.05, 1.3, 3.2, 1, '#fff4e0'); R(0, 1.6, 1.4, 0.05, '#5a6268', 1); });
  T('labDoor', 2.4, 3.0, () => { R(0, 0, 2.4, 3.0, LMF_, 1); glass(0.06, 0.06, 2.28, 0.7, 1, '#fff4e0'); glass(0.06, 0.82, 1.1, 2.12, 0, '#fff4e0'); glass(1.24, 0.82, 1.1, 2.12, 0, '#fff4e0'); });
  T('labBox', 6.0, 1.4, () => { R(0, 0, 6.0, 1.4, '#2f3438', 1); for (let k = 0; k < 4; k++) glass(0.06 + k * 1.485, 0.06, 1.425, 1.28, 0, '#ffeccc'); });
  // ---- the former cinema "Oktobris" / "Renesanse", now Daugavpils Innovation Centre: black-framed glazing with a
  // frosted ornament band, the upper windows, a louvred grille, the LED sign by the doors
  const ornament = (x, y, w) => { for (let k = 0; k < w / 0.09; k++) { const cx = x + k * 0.09 + 0.045; R(cx - 0.03, y + 0.02 + (k % 3) * 0.025, 0.06, 0.04, 'rgba(240,242,244,0.9)', 0, '#fff8ec'); if (k % 4 === 0) R(cx - 0.012, y, 0.024, 0.13, 'rgba(240,242,244,0.85)', 0, '#fff8ec'); } };
  for (const [k, door] of [['dicGlass', 0], ['dicDoor', 1]]) T(k, 2.0, 2.5, () => {
    R(0, 0, 2.0, 2.5, '#1c1e20', 1); glass(0.06, 0.06, 0.91, 2.38, 0, '#fff0d4'); glass(1.03, 0.06, 0.91, 2.38, 0, '#fff0d4');
    ornament(0.06, 0.55, 1.88); ornament(0.06, 1.35, 1.88);
    if (door) { R(0.9, 1.1, 0.04, 0.5, '#b8bcbf', 1); R(1.06, 1.1, 0.04, 0.5, '#b8bcbf', 1); }
  });
  T('dicWin', 1.6, 1.4, () => { R(0, 0, 1.6, 1.4, '#232527', 1); glass(0.06, 0.06, 1.48, 1.28, 0, '#ffe2b4'); });
  T('dicGrille', 3.2, 0.8, () => { R(0, 0, 3.2, 0.8, '#b9ad8f', 1); for (let k = 0; k < 7; k++) R(0.06, 0.06 + k * 0.1, 3.08, 0.05, '#6f6756', 1); });
  T('dicStrip', 1.2, 8.0, () => sash(0, 0, 1.2, 8.0, '#2a2c2e', 0.05, 1, 8, 0, '#ffe2b4'));
  T('dicLED', 4.6, 3.0, () => {
    R(0, 0, 4.6, 3.0, '#13192e', 0, '#0a1030'); R(0.06, 0.06, 4.48, 2.88, '#1d2b5e', 0, '#1a2a70');
    for (let k = 0; k < 120; k++) { const a = -1.9 + k / 120 * 3.8, rr = 1.05 + Math.sin(k * 1.7) * 0.06, x = 1.15 + Math.cos(a) * rr * 0.62, y = 1.5 + Math.sin(a) * rr, c = ['#e83a7a', '#3ab4e8', '#f2c230', '#8a5ad8', '#ffffff'][k % 5];
      R(x - 0.025, y - 0.025, 0.05, 0.05, c, 0, c); }
    txt('DAUGAVPILS', 1.5, 1.05, 0.3, '#ffffff', '600', 'left'); txt('INOVĀCIJU', 1.5, 1.5, 0.3, '#ff4d7e', '600', 'left'); txt('CENTRS', 1.5, 1.95, 0.3, '#ffffff', '600', 'left');
    e.font = g.font; e.textAlign = 'left'; e.textBaseline = 'middle'; for (const [s, y, c] of [['DAUGAVPILS', 1.05, '#ffffff'], ['INOVĀCIJU', 1.5, '#ff6a90'], ['CENTRS', 1.95, '#ffffff']]) { e.font = `600 ${0.3 * PX}px "Golos Text", "Trebuchet MS", sans-serif`; e.fillStyle = c; e.fillText(s, X + 1.5 * PX, Y + y * PX); }
  });
  // ---- Rīgas iela: windows of the 1890s–1910s houses (two casements under a transom), shop fronts, doors, a gateway
  for (const [k, fr, cur] of [['stWin', '#f1efe8', 0], ['stWinC', '#f1efe8', 1], ['stWinD', '#5a3a26', 0], ['stWinE', '#f1efe8', 2]]) T(k, 1.25, 2.0, () => {
    R(0, 0, 1.25, 2.0, fr, k === 'stWinD' ? 4 : 1); glass(0.08, 0.08, 1.09, 0.48, 0, '#ffd9a6'); glass(0.08, 0.62, 0.505, 1.3, 0, '#ffd9a6'); glass(0.665, 0.62, 0.505, 1.3, 0, '#ffd9a6');
    if (cur === 1) { R(0.08, 0.62, 0.16, 1.3, 'rgba(236,226,206,0.9)', 0, '#f0d0a0'); R(1.01, 0.62, 0.16, 1.3, 'rgba(236,226,206,0.9)', 0, '#f0d0a0'); }
    if (cur === 2) R(0.08, 0.62, 1.09, 0.55, 'rgba(240,238,232,0.92)', 0, '#f2dcb4');
  });
  T('stGlass', 0.5, 0.5, () => glass(0, 0, 0.5, 0.5, 0, '#ffd9a6'));
  T('stGlassDk', 0.5, 0.5, () => R(0, 0, 0.5, 0.5, '#1a1714', 0, '#000'));
  const SHOPC = ['#7a2430', '#1f4a72', '#2f5d3a', '#4a3a6e', '#8a5a1e', '#2a2a2a'];
  SHOPC.forEach((c, i) => T('stShop' + i, 2.8, 3.0, () => {
    R(0, 0, 2.8, 3.0, '#2f3234', 1); glass(0.07, 0.07, 2.66, 0.55, 0, '#fff0d4'); glass(0.07, 0.7, 1.3, 2.23, 0, '#fff0d4'); glass(1.43, 0.7, 1.3, 2.23, 0, '#fff0d4');
    R(0.25, 0.95, 0.9, 1.2, c, 0, shadeHex(c, 1.3)); R(1.6, 1.1, 0.95, 0.9, shadeHex(c, 1.25), 0, '#fff0d4');
  }));
  T('stDoor', 1.5, 2.9, () => { R(0, 0, 1.5, 2.9, '#4b3020', 4); glass(0.08, 0.08, 1.34, 0.55, 0, '#ffd9a6'); for (const lx of [0.08, 0.77]) { R(lx, 0.72, 0.65, 2.1, '#5a3a26', 4); R(lx + 0.1, 0.85, 0.45, 0.9, '#4b3020', 4); R(lx + 0.1, 1.9, 0.45, 0.8, '#4b3020', 4); } R(0.7, 1.75, 0.04, 0.25, '#c9a24a', 1); });
  T('stShopDoor', 1.4, 3.0, () => { R(0, 0, 1.4, 3.0, '#2f3234', 1); glass(0.07, 0.07, 1.26, 0.55, 0, '#fff0d4'); glass(0.07, 0.7, 1.26, 2.23, 0, '#fff0d4'); R(1.1, 1.6, 0.05, 0.4, '#c0c0bc', 1); });
  T('stBalc', 1.25, 2.6, () => { R(0, 0, 1.25, 2.6, '#f1efe8', 1); glass(0.08, 0.08, 1.09, 0.5, 0, '#ffd9a6'); glass(0.08, 0.66, 0.505, 1.86, 0, '#ffd9a6'); glass(0.665, 0.66, 0.505, 1.86, 0, '#ffd9a6'); });
  T('stGate', 3.0, 3.4, () => { R(0, 0, 3.0, 3.4, '#1c1a18', 0, '#3a2a18'); for (let x = 0.1; x < 3.0; x += 0.18) R(x, 0.3, 0.04, 3.1, '#3b3d40', 1); R(0, 1.6, 3.0, 0.06, '#3b3d40', 1); });
  // ---- gastrobar Vēsma, Rīgas iela 49: green board fascia, shop-front glazing, the summer terrace's tinted glass fence
  T('vsBoard', 4.0, 1.9, () => { R(0, 0, 4.0, 1.9, '#234a3b', 4); for (let y = 0.15; y < 1.9; y += 0.16) { line(0, y, 4.0, y, 0.025, '#163327', 4); line(0, y + 0.02, 4.0, y + 0.02, 0.012, '#2f5c4a', 4); } });
  T('vsFront', 2.0, 3.3, () => { R(0, 0, 2.0, 3.3, '#3f4345', 1); glass(0.06, 0.06, 1.88, 0.62, 0, '#ffe2b8'); glass(0.06, 0.74, 1.88, 2.5, 0, '#ffe2b8'); });
  T('vsDoor', 2.4, 3.3, () => { R(0, 0, 2.4, 3.3, '#3f4345', 1); glass(0.06, 0.06, 2.28, 0.62, 0, '#ffe2b8'); glass(0.06, 0.74, 1.11, 2.5, 0, '#ffe2b8'); glass(1.23, 0.74, 1.11, 2.5, 0, '#ffe2b8'); R(1.05, 1.7, 0.04, 0.5, '#c0c3c5', 1); R(1.31, 1.7, 0.04, 0.5, '#c0c3c5', 1); });
  for (const [k, ald] of [['vsFence', 0], ['vsFenceA', 1]]) T(k, 3.2, 1.0, () => {
    R(0, 0, 3.2, 1.0, '#3a3a2c', 1); glass(0.04, 0.04, 3.12, 0.92, 3, '#6a4a28');
    if (ald) { R(1.0, 0.18, 1.2, 0.5, '#c8202a', 0, '#c8202a'); R(1.04, 0.22, 1.12, 0.42, '#d8262f'); R(1.45, 0.08, 0.3, 0.16, '#f2c230'); txt('Aldaris', 1.6, 0.47, 0.19, '#ffffff', 'italic 700'); }
  });
  T('tvRed', 0.3, 0.3, () => R(0, 0, 0.3, 0.3, '#d2141a', 0, '#ff1a10'));
  // ---- railway station (1951): dark painted frames, the tall gridded windows of the waiting halls, the big window
  const VKF = '#4b4641', VKW = '#5a3a26';
  T('vkTall', 2.0, 6.4, () => { sash(0, 0, 2.0, 6.4, VKF, 0.07, 3, 8, 0, '#ffe2b4'); R(0, 2.35, 2.0, 0.08, VKF, 1); });
  T('vkWin', 1.3, 2.2, () => { R(0, 0, 1.3, 2.2, VKF, 1); glass(0.07, 0.07, 1.16, 0.5, 0, '#ffd9a6'); glass(0.07, 0.64, 0.545, 1.49, 0, '#ffd9a6'); glass(0.685, 0.64, 0.545, 1.49, 0, '#ffd9a6'); });
  T('vkWinB', 1.3, 2.2, () => { R(0, 0, 1.3, 2.2, VKF, 1); glass(0.07, 0.07, 1.16, 0.5, 0, '#ffd9a6'); glass(0.07, 0.64, 0.545, 1.49, 0, '#ffd9a6'); glass(0.685, 0.64, 0.545, 1.49, 0, '#ffd9a6'); R(0.07, 0.64, 1.16, 0.6, 'rgba(236,233,224,0.92)', 0, '#f2dcb4'); });
  T('vkNarrow', 0.6, 1.4, () => sash(0, 0, 0.6, 1.4, VKF, 0.05, 1, 2, 0, '#ffd9a6'));
  T('vkSq', 0.6, 0.6, () => sash(0, 0, 0.6, 0.6, VKF, 0.05, 1, 1, 0, '#ffd9a6'));
  T('vkGrille', 1.0, 0.6, () => { R(0, 0, 1.0, 0.6, '#1d1b19', 0, '#000'); for (let x = 0.08; x < 1.0; x += 0.12) R(x, 0, 0.03, 0.6, '#3b3d40', 1); R(0, 0.28, 1.0, 0.03, '#3b3d40', 1); });
  T('vkBig', 5.0, 4.8, () => { sash(0, 0, 5.0, 4.8, VKF, 0.1, 3, 3, 0, '#ffe8c4'); for (let k = 1; k < 6; k++) line(k * 5.0 / 6, 0.1, k * 5.0 / 6, 4.7, 0.03, VKF); for (let k = 1; k < 6; k++) line(0.1, k * 0.8, 4.9, k * 0.8, 0.03, VKF); });
  T('vkDoors', 5.0, 2.9, () => { R(0, 0, 5.0, 2.9, '#3b2a1f', 4); for (let k = 0; k < 4; k++) { const x = 0.08 + k * 1.22; R(x, 0.08, 1.14, 2.82, '#4a3324', 4); glass(x + 0.1, 0.18, 0.94, 1.9, 0, '#fff0d4'); R(x + 0.1, 2.2, 0.94, 0.55, '#3b2a1f', 4); } });
  T('vkPortWin', 3.0, 4.4, () => sash(0, 0, 3.0, 4.4, VKF, 0.08, 3, 4, 0, '#ffe8c4'));
  T('vkPortDoor', 3.0, 2.4, () => { R(0, 0, 3.0, 2.4, '#3b2a1f', 4); for (const x of [0.08, 1.04, 2.0]) { R(x, 0.08, 0.92, 2.32, '#4a3324', 4); glass(x + 0.1, 0.2, 0.72, 1.3, 0, '#fff0d4'); } });
  // ---- Palace of Culture, Smilšu iela 92, as renovated in 2019: anthracite frames, blue-grey glass with dark blue
  // panels under the ground-floor glazing, the ticket-office door, the small windows of the back blocks, the sports hall
  const KPF = '#3a3f45', KPB = '#22314f', KPH = '#c3c6c8';
  T('kpLow', 1.5, 3.2, () => { R(0, 0, 1.5, 3.2, KPF, 1); glass(0.06, 0.06, 1.38, 2.22, 1, '#ffe6c2'); R(0.06, 2.36, 1.38, 0.78, KPB, 1); });
  T('kpMid', 1.5, 2.6, () => { R(0, 0, 1.5, 2.6, KPF, 1); glass(0.06, 0.06, 1.38, 0.62, 1, '#ffe6c2'); glass(0.06, 0.74, 1.38, 1.8, 1, '#ffe6c2'); });
  T('kpTop', 1.5, 2.65, () => { R(0, 0, 1.5, 2.65, KPF, 1); glass(0.06, 0.06, 1.38, 2.05, 1, '#ffe6c2'); glass(0.06, 2.17, 1.38, 0.42, 1, '#ffe6c2'); });
  T('kpDoor', 1.5, 3.35, () => { R(0, 0, 1.5, 3.35, KPF, 1); glass(0.06, 0.06, 1.38, 0.7, 0, '#fff0d6'); glass(0.1, 0.84, 1.3, 2.45, 0, '#fff0d6'); R(0.2, 1.85, 0.04, 0.6, KPH, 1); R(0.1, 3.05, 1.3, 0.24, KPF, 1); });
  T('kpKases', 1.5, 3.2, () => { R(0, 0, 1.5, 3.2, KPF, 1); R(0.06, 0.06, 1.38, 0.5, '#20262c', 0, '#18223c'); txt('KASES', 0.75, 0.31, 0.22, '#5f8fe0', '600'); glass(0.1, 0.64, 1.3, 2.5, 0, '#fff0d6'); R(0.2, 1.65, 0.04, 0.6, KPH, 1); });
  T('kpWin', 1.2, 1.5, () => { R(0, 0, 1.2, 1.5, KPF, 1); glass(0.06, 0.06, 0.52, 1.38, 0); glass(0.62, 0.06, 0.52, 1.38, 0); });
  T('kpWin2', 2.4, 1.5, () => { R(0, 0, 2.4, 1.5, KPF, 1); for (let k = 0; k < 3; k++) glass(0.06 + k * 0.78, 0.06, 0.72, 1.38, 0); });
  T('kpSlot', 0.7, 3.2, () => sash(0, 0, 0.7, 3.2, KPF, 0.05, 1, 3, 0, '#ffe6c2'));
  T('kpClere', 2.0, 1.8, () => sash(0, 0, 2.0, 1.8, KPF, 0.06, 3, 1, 0, '#fff4e0'));
  T('kpSDoor', 2.6, 2.7, () => { R(0, 0, 2.6, 2.7, KPF, 1); glass(0.06, 0.06, 1.2, 2.58, 0, '#fff0d6'); glass(1.34, 0.06, 1.2, 2.58, 0, '#fff0d6'); R(1.12, 1.1, 0.04, 0.5, KPH, 1); R(1.44, 1.1, 0.04, 0.5, KPH, 1); });
  T('kpPlate', 1.3, 1.0, () => { R(0, 0, 1.3, 1.0, '#f4f4f1'); R(0.6, 0.05, 0.1, 0.12, '#2a5aa8'); for (const y of [0.22, 0.27]) R(0.2, y, 0.9, 0.018, '#7d8084'); txt('KULTŪRAS PILS', 0.65, 0.47, 0.13, '#1c1e21', '700'); txt('SPORTA ZĀLE', 0.65, 0.65, 0.13, '#1c1e21', '700'); R(0.15, 0.86, 1.0, 0.018, '#9a9c9e'); });
  T('kpRoll', 3.6, 4.0, () => { R(0, 0, 3.6, 4.0, '#9a9d9f', 1); for (let y = 0.1; y < 4; y += 0.11) line(0, y, 3.6, y, 0.025, '#7d8083'); });
  T('kpSteel', 1.1, 2.2, () => { R(0, 0, 1.1, 2.2, '#6d7175', 1); R(0.06, 0.06, 0.98, 2.1, '#7b7f83', 1); R(0.85, 1.0, 0.12, 0.04, KPH, 1); });
  // ---- heat plant No. 1, 18. novembra iela 2 (the 1911 power station): steel multi-pane windows, grey doors, the arches
  // of the front annex bricked up in red, a run of solar panels
  const SCF = '#3d3f40';
  const steel = (w, h, cols, rows) => { R(0, 0, w, h, SCF, 1); const t = 0.04, iw = (w - t * (cols + 1)) / cols, ih = (h - t * (rows + 1)) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const x = t + i * (iw + t), y = t + j * (ih + t), r = lr();
      if (r < 0.08) R(x, y, iw, ih, '#8d8a80', 0, '#3a3020'); else if (r < 0.14) R(x, y, iw, ih, '#c9c4b4', 0, '#fff0d0'); else glass(x, y, iw, ih, r < 0.5 ? 0 : 3, '#ffd9a0'); } };
  T('scWin', 2.6, 4.4, () => steel(2.6, 4.4, 4, 7));
  T('scWinB', 2.6, 2.6, () => steel(2.6, 2.6, 4, 4));
  T('scTall', 3.0, 2.9, () => steel(3.0, 2.9, 5, 4));
  T('scSmall', 1.4, 1.8, () => steel(1.4, 1.8, 2, 3));
  T('scDoor', 2.4, 3.0, () => { R(0, 0, 2.4, 3.0, '#5f666c', 1); R(0.06, 0.06, 1.12, 2.94, '#8a949b', 1); R(1.22, 0.06, 1.12, 2.94, '#8a949b', 1); for (const y of [0.9, 2.0]) R(0.06, y, 2.28, 0.03, '#6f777d', 1); });
  T('scArch', 3.0, 3.8, () => { R(0, 0, 3.0, 3.8, '#c4c0b6'); const [a, b] = pr(1.5, 1.5, 0, 0);
    for (const [ctx, c] of [[g, '#ece9e2'], [o, ORM[0]], [e, '#000']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(a, b, 1.5 * PX, Math.PI, 0); ctx.lineTo(X + 3.0 * PX, Y + 3.8 * PX); ctx.lineTo(X, Y + 3.8 * PX); ctx.closePath(); ctx.fill(); }
    for (const [ctx, c] of [[g, '#8f4f3c'], [o, ORM[0]], [e, '#000']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(a, b, 1.32 * PX, Math.PI, 0); ctx.lineTo(X + 2.82 * PX, Y + 3.8 * PX); ctx.lineTo(X + 0.18 * PX, Y + 3.8 * PX); ctx.closePath(); ctx.fill(); }
    for (let y = 0.3; y < 3.8; y += 0.075) R(0.2, y, 2.6, 0.012, 'rgba(60,30,20,0.35)'); glass(1.1, 1.6, 0.8, 1.0, 0, '#ffd9a0'); });
  T('scArchWin', 1.6, 4.0, () => { R(0, 0, 1.6, 4.0, '#8a4634'); const arch = (i, col, k) => { const [a, b] = pr(0.8, 0.8, 0, 0);
      for (const [ctx, c] of [[g, col], [o, ORM[k]], [e, '#000']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(a, b, (0.8 - i) * PX, Math.PI, 0); ctx.lineTo(X + (1.6 - i) * PX, Y + (4.0 - i) * PX); ctx.lineTo(X + i * PX, Y + (4.0 - i) * PX); ctx.closePath(); ctx.fill(); } };
    arch(0, '#e6e1d6', 0); arch(0.13, SCF, 1); arch(0.17, '#41505a', 2);
    for (const x of [0.55, 1.05]) R(x, 0.2, 0.03, 3.65, SCF, 1); for (let y = 0.9; y < 3.8; y += 0.48) R(0.17, y, 1.26, 0.03, SCF, 1);
    const [a, b, c, d] = pr(0.17, 0.25, 1.26, 3.6); e.fillStyle = '#e8b878'; e.globalAlpha = 0.85; e.fillRect(a, b, c, d); e.globalAlpha = 1; });
  T('scPV', 6.0, 1.7, () => { R(0, 0, 6.0, 1.7, '#9aa0a4', 1); for (let k = 0; k < 6; k++) { R(0.04 + k * 0.995, 0.04, 0.96, 1.62, '#1d2a44', 3); for (let j = 1; j < 6; j++) R(0.04 + k * 0.995, 0.04 + j * 0.27, 0.96, 0.012, '#3a4a68', 3); } });
  // ---- Daugavgrīvas cietums («Белый лебедь», Baltais gulbis), 18. novembra iela 66A: the whitewashed 1863 prison.
  // Barred windows in weathered white frames, a steel vehicle gate and door, the glazed watchtower cabin, a name plaque.
  const PRF = '#e7e3d8', PRB = '#4a4f52';
  const bars = (w, h) => { for (const x of [0.2, 0.38, 0.62, 0.8]) R(x * w / 1.1, 0.06, 0.035, h - 0.12, PRB, 1); for (const y of [0.5, 1.0, 1.5]) R(0.06, y * h / 1.9, w - 0.12, 0.03, PRB, 1); };
  T('prWin', 1.0, 1.6, () => { R(0, 0, 1.0, 1.6, PRF, 1); glass(0.08, 0.08, 0.84, 1.44, 0, '#ffd9a0'); R(0.47, 0.08, 0.06, 1.44, PRF, 1); bars(1.0, 1.6); });
  T('prGate', 2.4, 2.6, () => { R(0, 0, 2.4, 2.6, '#5a6063', 1); R(0.08, 0.08, 2.24, 2.44, '#3c4144', 1);
    for (let x = 0.18; x < 2.3; x += 0.24) R(x, 0.16, 0.05, 2.28, '#6a7073', 1);
    R(0.08, 0.5, 2.24, 0.07, '#6a7073', 1); R(0.08, 2.0, 2.24, 0.07, '#6a7073', 1); R(1.16, 0.08, 0.08, 2.44, '#5a6063', 1); });
  T('prDoor', 1.1, 2.0, () => { R(0, 0, 1.1, 2.0, '#6a7073', 1); R(0.07, 0.07, 0.96, 1.86, '#565c5f', 1);
    R(0.22, 0.32, 0.66, 0.62, '#4a4f52', 1); glass(0.26, 0.36, 0.58, 0.54, 0, '#ffd9a0'); R(0.84, 1.0, 0.09, 0.26, '#8a9093', 1); });
  // shelf packing, tallest first
  defs.sort((a, b) => b.h - a.h);
  // shelves as tall as their first tile; a later tile goes into the first shelf with room, stacked under a narrower
  // or equal one when it fits below it, else in a new column of that shelf
  const rows = []; let bottom = 0;
  for (const d of defs) {
    const pw = Math.ceil(d.w * PX), ph = Math.ceil(d.h * PX); let sx = -1, sy = 0;
    for (const r of rows) {
      const c = r.cols.find(c => pw <= c.w && c.y + ph <= r.y + r.h); if (c) { sx = c.x; sy = c.y; c.y += ph + 6; break; }
      if (r.x + pw + 2 <= AW) { sx = r.x; sy = r.y; r.cols.push({ x: r.x, w: pw, y: r.y + ph + 6 }); r.x += pw + 6; break; }
    }
    if (sx < 0) { const y = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h + 6 : 2; rows.push({ y, h: ph, x: 2 + pw + 6, cols: [{ x: 2, w: pw, y: y + ph + 6 }] }); sx = 2; sy = y; }
    X = sx; Y = sy; g.save(); o.save(); e.save(); for (const ctx of [g, o, e]) { ctx.beginPath(); ctx.rect(X, Y, pw, ph); ctx.clip(); }
    d.draw(); g.restore(); o.restore(); e.restore();
    LMT[d.name] = { u0: (sx + 0.5) / AW, u1: (sx + pw - 0.5) / AW, v0: 1 - (sy + ph - 0.5) / AH, v1: 1 - (sy + 0.5) / AH };
    bottom = Math.max(bottom, sy + ph);
  }
  if (bottom > AH) console.warn('landmark atlas overflow', bottom);
  const mk = (c, srgb) => { const t = toTex(c, srgb, false); t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  return [mk(cv, true), mk(om, false), mk(gm, true)];
}

/* signs: letters cut out of a transparent canvas; the second canvas is what they show when lit */
const LMS = {};
function lmSigns() {
  const W = 2048, H = 2048, cv = mkCanvas(W, H), g = cv.getContext('2d'), gm = mkCanvas(W, H), e = gm.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  let x = 0, y = 0, rowH = 0;   // shelves: left to right, a new row when the next sign does not fit
  const add = (name, w, h, draw) => { if (x + w > W) { x = 0; y += rowH + 8; rowH = 0; } for (const c of [g, e]) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); } draw(x, y, w, h); g.restore(); e.restore(); LMS[name] = { u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H }; x += w + 8; rowH = Math.max(rowH, h); if (y + h > H) console.warn('sign atlas overflow'); };
  const font = (px, wt = '700', fam = '"Century Gothic", Futura, "Avenir Next", "Trebuchet MS", sans-serif') => `${wt} ${px}px ${fam}`;
  add('vnName', 2048, 124, (x0, y0, w, h) => {
    const s = 'VIENĪBAS NAMS'; g.font = font(100, '600'); g.textBaseline = 'middle'; g.textAlign = 'center';
    const step = w / s.length;
    for (let k = 0; k < s.length; k++) { const cx = x0 + step * (k + 0.5); g.fillStyle = '#3e3d3a'; g.fillText(s[k], cx + 7, y0 + h / 2 + 7); g.fillStyle = '#f7f6f2'; g.fillText(s[k], cx, y0 + h / 2); }
  });
  add('hotel', 760, 220, (x0, y0, w, h) => {
    g.font = font(200, '800', '"Golos Text", "Trebuchet MS", sans-serif'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 14; g.strokeStyle = '#f2f4f8'; g.strokeText('HOTEL', x0 + w / 2, y0 + h / 2 + 6); g.fillStyle = '#1e3a8f'; g.fillText('HOTEL', x0 + w / 2, y0 + h / 2 + 6);
    e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#c8d8ff'; e.fillText('HOTEL', x0 + w / 2, y0 + h / 2 + 6);
  });
  add('latgola', 1000, 420, (x0, y0, w, h) => {
    const stroke = (c, lw, pts) => { g.strokeStyle = c; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0 + pts[0], y0 + pts[1]); g.bezierCurveTo(x0 + pts[2], y0 + pts[3], x0 + pts[4], y0 + pts[5], x0 + pts[6], y0 + pts[7]); g.stroke(); };
    stroke('#3ea24a', 46, [380, 230, 400, 120, 440, 70, 520, 30]); stroke('#ffffff', 26, [430, 230, 450, 150, 490, 90, 560, 50]); stroke('#4b2a87', 30, [470, 235, 500, 160, 540, 110, 610, 70]);
    g.font = font(170, '800', '"Golos Text", "Trebuchet MS", sans-serif'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 16; g.strokeStyle = '#ffffff'; g.strokeText('Latgola', x0 + w / 2, y0 + 330); g.fillStyle = '#3b2a8a'; g.fillText('Latgola', x0 + w / 2, y0 + 330);
    e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#ffffff'; e.fillText('Latgola', x0 + w / 2, y0 + 330);
  });
  add('plaza', 640, 200, (x0, y0, w, h) => {
    g.font = font(150, '800', '"Golos Text", "Trebuchet MS", sans-serif'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 12; g.strokeStyle = '#ffffff'; g.strokeText('PLAZA', x0 + w / 2, y0 + h / 2); g.fillStyle = '#2a2f86'; g.fillText('PLAZA', x0 + w / 2, y0 + h / 2);
    e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#b8c4ff'; e.fillText('PLAZA', x0 + w / 2, y0 + h / 2);
  });
  add('konc', 1400, 110, (x0, y0, w, h) => {
    g.font = font(92, '700'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f3e7c8'; g.fillText('KONCERTZĀLE', x0 + w / 2, y0 + h / 2);
    e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#ffe9bc'; e.fillText('KONCERTZĀLE', x0 + w / 2, y0 + h / 2);
  });
  // the frieze of the old university building: widely spaced roman capitals, cast in light bronze
  add('duName', 2048, 120, (x0, y0, w, h) => {
    const s = 'DAUGAVPILS UNIVERSITĀTE', step = w / s.length; g.font = font(96, '600', '"Times New Roman", Georgia, "DejaVu Serif", serif'); g.textBaseline = 'middle'; g.textAlign = 'center';
    e.font = g.font; e.textBaseline = 'middle'; e.textAlign = 'center';
    for (let k = 0; k < s.length; k++) { const cx = x0 + step * (k + 0.5); g.fillStyle = '#6b5c46'; g.fillText(s[k], cx + 4, y0 + h / 2 + 5); g.fillStyle = '#f4ecd6'; g.fillText(s[k], cx, y0 + h / 2); e.fillStyle = '#d8b878'; e.fillText(s[k], cx, y0 + h / 2); }
  });
  // over the entrance of the Parādes iela building: brushed steel letters in two lines of equal width
  add('p1Name', 1200, 330, (x0, y0, w, h) => {
    g.font = font(132, '600'); g.textBaseline = 'middle'; g.textAlign = 'center'; e.font = g.font; e.textBaseline = 'middle'; e.textAlign = 'center';
    [['DAUGAVPILS', 0.27], ['UNIVERSITĀTE', 0.76]].forEach(([s, fy]) => { const step = w / s.length; for (let k = 0; k < s.length; k++) { const cx = x0 + step * (k + 0.5), cy = y0 + h * fy;
      g.fillStyle = '#5a2a1a'; g.fillText(s[k], cx + 5, cy + 6); g.fillStyle = '#dfe2e2'; g.fillText(s[k], cx, cy); e.fillStyle = '#e8eef2'; e.fillText(s[k], cx, cy); } });
  });
  add('hospital', 400, 60, (x0, y0, w, h) => {
    g.fillStyle = '#e8ece9'; g.fillRect(x0, y0, w, h); g.strokeStyle = '#6b7f86'; g.lineWidth = 2; g.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
    g.fillStyle = '#607d87'; g.fillRect(x0 + 8, y0 + 9, 34, 42); g.fillStyle = '#f5f7f4'; g.fillRect(x0 + 22, y0 + 13, 7, 34); g.fillRect(x0 + 12, y0 + 27, 26, 7);
    g.font = font(18, '700', '"Golos Text", "Trebuchet MS", sans-serif'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#34474d';
    g.fillText('DAUGAVPILS REĢIONĀLĀ SLIMNĪCA', x0 + 225, y0 + h / 2 + 1);
    e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#fff3d2'; e.fillText('DAUGAVPILS REĢIONĀLĀ SLIMNĪCA', x0 + 225, y0 + h / 2 + 1);
  });
  add('radiotherapy', 400, 60, (x0, y0, w, h) => {
    g.fillStyle = '#e8ece9'; g.fillRect(x0, y0, w, h); g.strokeStyle = '#71838a'; g.lineWidth = 2; g.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2); g.fillStyle = '#4d8a99'; g.fillRect(x0 + 10, y0 + 10, 6, h - 20);
    g.font = font(23, '700', '"Golos Text", "Trebuchet MS", sans-serif'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#34474d'; g.fillText('STARU TERAPIJA', x0 + w / 2 + 10, y0 + h / 2);
    e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#fff3d2'; e.fillText('STARU TERAPIJA', x0 + w / 2 + 10, y0 + h / 2);
  });
  // the White Swan prison: a blue enamel name plate by the street gate
  add('prison', 420, 64, (x0, y0, w, h) => {
    g.fillStyle = '#2c3e50'; g.fillRect(x0, y0, w, h); g.strokeStyle = '#1a252f'; g.lineWidth = 3; g.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
    g.font = font(26, '700', '"Golos Text", "Trebuchet MS", sans-serif'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f4f2ec'; g.fillText('DAUGAVGRĪVAS CIETUMS', x0 + w / 2, y0 + h / 2);
    e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#dfe8f2'; e.fillText('DAUGAVGRĪVAS CIETUMS', x0 + w / 2, y0 + h / 2);
  });
  // the railway station: DAUGAVPILS in widely spaced bronze capitals on the platform side, the year in the lunette
  add('vkName', 1600, 120, (x0, y0, w, h) => {
    const s = 'DAUGAVPILS', step = w / s.length; g.font = font(92, '600', '"Golos Text", "Trebuchet MS", sans-serif'); g.textBaseline = 'middle'; g.textAlign = 'center';
    for (let k = 0; k < s.length; k++) { const cx = x0 + step * (k + 0.5); g.fillStyle = '#2a2219'; g.fillText(s[k], cx + 4, y0 + h / 2 + 4); g.fillStyle = '#5e4c36'; g.fillText(s[k], cx, y0 + h / 2); }
  });
  add('vk1951', 520, 200, (x0, y0, w, h) => {
    g.font = font(170, '600', '"Golos Text", "Trebuchet MS", sans-serif'); g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = '#6f5a3c'; g.fillText('1951', x0 + w / 2 + 6, y0 + h / 2 + 6); g.fillStyle = '#d2b98c'; g.fillText('1951', x0 + w / 2, y0 + h / 2);
  });
  // Vēsma: the name in white italic letters outlined in turquoise and dark green, "BĀRS ⓥ BISTRO", the feather
  add('vesma', 1300, 300, (x0, y0, w, h) => {
    const f = 'italic 800 230px "Trebuchet MS", "Golos Text", sans-serif', cx = x0 + w / 2, cy = y0 + h / 2 + 8;
    for (const ctx of [g, e]) { ctx.font = f; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; }
    g.lineWidth = 34; g.strokeStyle = '#123d2e'; g.strokeText('VēsmA', cx, cy); g.lineWidth = 16; g.strokeStyle = '#3cc3c4'; g.strokeText('VēsmA', cx, cy); g.fillStyle = '#f4fbfb'; g.fillText('VēsmA', cx, cy);
    e.lineWidth = 16; e.strokeStyle = '#38c8d0'; e.strokeText('VēsmA', cx, cy); e.fillStyle = '#ffffff'; e.fillText('VēsmA', cx, cy);
  });
  add('vesmaLogo', 240, 300, (x0, y0, w, h) => {
    const sw = (c, lw, pts) => { for (const ctx of [g, e]) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0 + pts[0], y0 + pts[1]); ctx.bezierCurveTo(x0 + pts[2], y0 + pts[3], x0 + pts[4], y0 + pts[5], x0 + pts[6], y0 + pts[7]); ctx.stroke(); } };
    sw('#eef6f4', 30, [60, 280, 110, 190, 150, 100, 200, 20]); sw('#3cc3c4', 18, [100, 270, 140, 200, 170, 130, 215, 60]); sw('#eef6f4', 10, [130, 260, 160, 210, 185, 160, 225, 110]);
  });
  add('vesmaBB', 1000, 120, (x0, y0, w, h) => {
    const cy = y0 + h / 2; g.font = font(64, '700', '"Trebuchet MS", sans-serif'); g.textBaseline = 'middle'; g.fillStyle = '#eef6f4';
    g.textAlign = 'right'; g.fillText('BĀRS', x0 + w / 2 - 70, cy); g.textAlign = 'left'; g.fillText('BISTRO', x0 + w / 2 + 70, cy);
    g.beginPath(); g.arc(x0 + w / 2, cy, 50, 0, 6.3); g.fillStyle = '#eef6f4'; g.fill(); g.beginPath(); g.arc(x0 + w / 2, cy, 42, 0, 6.3); g.fillStyle = '#1f6a64'; g.fill();
    g.font = font(64, '800', '"Trebuchet MS", sans-serif'); g.textAlign = 'center'; g.fillStyle = '#eef6f4'; g.fillText('V', x0 + w / 2, cy + 3);
    e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#b8f0ec'; e.fillText('BĀRS     BISTRO', x0 + w / 2, cy);
  });
  // the bus station: the bay numbers, then AUTOOSTA in white on blue for the fascia of the platform canopy (lit at night).
  // Small, to fit the space left at the end of the last row
  for (let k = 1; k <= 3; k++) add('aoBay' + k, 96, 96, (x0, y0, w, h) => {
    g.fillStyle = '#1d5ca6'; g.fillRect(x0, y0, w, h); g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.strokeRect(x0 + 6, y0 + 6, w - 12, h - 12);
    g.font = font(62, '700', '"Golos Text", "Trebuchet MS", sans-serif'); g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.fillText(String(k), x0 + w / 2, y0 + h / 2 + 3);
    e.font = g.font; e.textBaseline = 'middle'; e.textAlign = 'center'; e.fillStyle = '#e8f0ff'; e.fillText(String(k), x0 + w / 2, y0 + h / 2 + 3);
  });
  add('aoName', 470, 100, (x0, y0, w, h) => {
    g.fillStyle = '#1d5ca6'; g.fillRect(x0, y0, w, h); g.font = font(72, '700', '"Golos Text", "Trebuchet MS", sans-serif'); g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = '#ffffff'; g.fillText('AUTOOSTA', x0 + w / 2, y0 + h / 2 + 3); e.font = g.font; e.textBaseline = 'middle'; e.textAlign = 'center'; e.fillStyle = '#e8f0ff'; e.fillText('AUTOOSTA', x0 + w / 2, y0 + h / 2 + 3);
  });
  const t = toTex(cv, true, false), te = toTex(gm, true, false); t.minFilter = te.minFilter = THREE.LinearMipmapLinearFilter; return [t, te];
}

/* flowers: per species a side view (row 0) and a view from above (row 1), 128 px each */
const LM_FLOWERS = [
  { name: 'salvia', col: '#c8141b', h: 0.4 }, { name: 'cineraria', col: '#c9cfc8', h: 0.26 }, { name: 'marigoldY', col: '#f4c20d', h: 0.3 }, { name: 'marigoldO', col: '#ee7a10', h: 0.3 },
  { name: 'begoniaW', col: '#f4f2ea', h: 0.22 }, { name: 'begoniaP', col: '#ec5b8e', h: 0.22 }, { name: 'petunia', col: '#7d3ea6', h: 0.24 }
];
function lmFlowerAtlas() {
  const S = 128, cv = mkCanvas(S * 8, S * 2), g = cv.getContext('2d');
  const leaf = (x, y, len, w, ang, col) => { g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = col; g.beginPath(); g.ellipse(0, -len / 2, w / 2, len / 2, 0, 0, 6.3); g.fill(); g.restore(); };
  const greens = ['#3b6a2a', '#4a7d33', '#5a8c3b', '#43722f'];
  LM_FLOWERS.forEach((f, k) => {
    const x0 = k * S, silver = f.name === 'cineraria';
    // side view
    for (let i = 0; i < (silver ? 22 : 14); i++) { const a = (lr() - 0.5) * 2.2; leaf(x0 + 64 + (lr() - 0.5) * 50, 128, 40 + lr() * 45, silver ? 22 : 16, a, silver ? ['#b9c1b8', '#cfd5cd', '#a9b1a8'][i % 3] : greens[i % 4]); }
    const c = hb(f.col), cs = (m) => `rgb(${Math.min(255, c[0] * m) | 0},${Math.min(255, c[1] * m) | 0},${Math.min(255, c[2] * m) | 0})`;
    if (f.name === 'salvia') for (let i = 0; i < 10; i++) { const x = x0 + 12 + i * 11 + (lr() - 0.5) * 6, top = 8 + lr() * 22; for (let y = top; y < top + 56; y += 5) { g.fillStyle = cs(0.8 + lr() * 0.3); g.beginPath(); g.ellipse(x + (lr() - 0.5) * 3, y, 4.5, 4, 0, 0, 6.3); g.fill(); } }
    else if (f.name.startsWith('marigold')) for (let i = 0; i < 7; i++) { const x = x0 + 16 + i * 16 + (lr() - 0.5) * 6, y = 22 + lr() * 34, r = 9 + lr() * 4; g.fillStyle = cs(0.85); g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); g.fillStyle = cs(1.05); g.beginPath(); g.arc(x - 2, y - 2, r * 0.7, 0, 6.3); g.fill(); g.fillStyle = cs(0.7); g.beginPath(); g.arc(x, y, r * 0.3, 0, 6.3); g.fill(); }
    else if (!silver) for (let i = 0; i < 16; i++) { const x = x0 + 12 + lr() * 104, y = 26 + lr() * 50, r = f.name === 'petunia' ? 8 : 5.5; g.fillStyle = cs(0.85 + lr() * 0.25); for (let p = 0; p < 5; p++) { const a = p * 1.2566; g.beginPath(); g.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.6, 0, 6.3); g.fill(); } g.fillStyle = '#e8d24a'; g.beginPath(); g.arc(x, y, 1.6, 0, 6.3); g.fill(); }
    // top view
    const cx = x0 + 64, cy = S + 64;
    for (let i = 0; i < (silver ? 26 : 18); i++) { const a = lr() * 6.283, rr = 20 + lr() * 34; leaf(cx + Math.cos(a) * rr * 0.4, cy + Math.sin(a) * rr * 0.4, rr, silver ? 24 : 18, a + Math.PI / 2, silver ? ['#bcc4bb', '#d2d8d0', '#aab2a9'][i % 3] : greens[i % 4]); }
    if (!silver) for (let i = 0; i < (f.name === 'salvia' ? 24 : 20); i++) { const a = lr() * 6.283, rr = Math.sqrt(lr()) * 46, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr, r = f.name.startsWith('marigold') ? 9 : f.name === 'salvia' ? 5 : 6;
      g.fillStyle = cs(0.8 + lr() * 0.35); g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); if (f.name.startsWith('marigold')) { g.fillStyle = cs(0.68); g.beginPath(); g.arc(x, y, r * 0.35, 0, 6.3); g.fill(); } }
  });
  const t = toTex(cv, true, false); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
// which plant grows where: p along the bed's long axis, q across, d = signed distance to the edge (negative inside)
function bedSpecies(b, du, dv, d) {
  if (d > -0.45) return 1;
  if (b.kind === 0) {
    for (const lv of b.lamps) { const m = Math.max(Math.abs(du), Math.abs(dv - (lv - b.cv))); if (m < 1.0) return -1; if (m < 1.45) return 1; }
    if (d > -0.7) return 0;
    const p = dv, q = du, wc = 1.3 * Math.sin(2 * Math.PI * p / 6.0), k = Math.round((p - 1.5) / 3), pk = 1.5 + 3 * k, side = Math.sin(2 * Math.PI * pk / 6.0) > 0 ? -1 : 1;
    // as photographed: silver cineraria ground, a red salvia ribbon with orange in its middle, yellow marigold rosettes
    const rr = Math.hypot(p - pk, q - side * 1.05);
    if (rr < 0.28) return 3; if (rr < 0.68) return 2;
    const dq = Math.abs(q - wc); if (dq < 0.16) return 3; if (dq < 0.62) return 0; return 1;
  }
  const x = du / b.hu, y = dv / b.hv, rho = Math.hypot(x, y), th = Math.atan2(y, x);
  if (d > -0.8) return 4;
  if (rho < 0.16) return 5; if (rho < 0.3) return 4; if (rho < 0.52 + 0.16 * Math.cos(6 * th)) return 3; if (rho < 0.62 + 0.16 * Math.cos(6 * th)) return 2; return rho < 0.8 ? 0 : 6;
}

/* ---- Olimpiskais centrs facade atlas (its OWN canvas: the shared detail and sign atlases are full) ----
   From the reference photographs: a two-storey glass curtain wall with thin dark mullions (some bays warm-lit
   from inside at night), the white metal wave band studded with a matrix of small LED dots, and the white
   letter sign "DAUGAVPILS OLIMPISKAIS CENTRS" fixed straight to the glass over the entrance. OCF holds the UVs. */
const OCF = {};
function lmOCFacade() {
  const W = 1024, H = 640, cv = mkCanvas(W, H), g = cv.getContext('2d'), gm = mkCanvas(W, H), e = gm.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const uv = (name, x, y, w, h) => { OCF[name] = { u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H }; };
  // a curtain-wall bay: dark frame, sky-reflecting glass, a transom at mid height
  const bay = (x0, lit) => {
    const w = 256, h = 512, fr = 10;
    g.fillStyle = '#262b30'; g.fillRect(x0, 0, w, h);
    if (!lit) {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#4d6274'); gr.addColorStop(0.55, '#33434f'); gr.addColorStop(1, '#242f38');
      g.fillStyle = gr; g.fillRect(x0 + fr, fr, w - 2 * fr, h - 2 * fr);
      g.fillStyle = 'rgba(190,215,230,0.16)';   // a slanted sky reflection
      g.beginPath(); g.moveTo(x0 + fr, 60); g.lineTo(x0 + w - fr, 20); g.lineTo(x0 + w - fr, 150); g.lineTo(x0 + fr, 230); g.closePath(); g.fill();
    } else {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#c9d2cd'); gr.addColorStop(0.3, '#aeb6a6'); gr.addColorStop(1, '#7f8570');
      g.fillStyle = gr; g.fillRect(x0 + fr, fr, w - 2 * fr, h - 2 * fr);
      g.fillStyle = 'rgba(52,50,38,0.55)';   // furniture / interior shadows behind the glass
      for (let k = 0; k < 5; k++) { const bw = 30 + lr() * 60, bh = 40 + lr() * 90, bx = x0 + fr + lr() * (w - 2 * fr - bw), by = h * 0.45 + lr() * (h * 0.5 - bh); g.fillRect(bx, by, bw, bh); }
      g.fillStyle = '#e8ecdf'; g.fillRect(x0 + fr, fr, w - 2 * fr, 40);   // the ceiling line
      const eg = e.createLinearGradient(0, 0, 0, h); eg.addColorStop(0, '#fff0c8'); eg.addColorStop(0.3, '#ffd9a0'); eg.addColorStop(1, '#b07838');
      e.fillStyle = eg; e.fillRect(x0 + fr, fr, w - 2 * fr, h - 2 * fr);
      e.fillStyle = '#3a2c14';
      for (let k = 0; k < 5; k++) { const bw = 30 + lr() * 60, bh = 40 + lr() * 90, bx = x0 + fr + lr() * (w - 2 * fr - bw), by = h * 0.45 + lr() * (h * 0.5 - bh); e.fillRect(bx, by, bw, bh); }
    }
    g.fillStyle = '#262b30'; g.fillRect(x0 + w / 2 - 3, fr, 6, h - 2 * fr); g.fillRect(x0 + fr, h * 0.45, w - 2 * fr, 7);   // mullion + transom
    e.fillStyle = '#000'; e.fillRect(x0 + w / 2 - 3, fr, 6, h - 2 * fr); e.fillRect(x0 + fr, h * 0.45, w - 2 * fr, 7);
  };
  bay(0, false); bay(256, true);
  uv('glass', 0, 0, 256, 512); uv('lit', 256, 0, 256, 512);
  // one LED dot on the white panel of the wave (the panel seams show between the dots)
  g.fillStyle = '#e3e5e7'; g.fillRect(512, 0, 128, 128);
  g.strokeStyle = '#c9cbce'; g.lineWidth = 3; g.strokeRect(513.5, 1.5, 125, 125);
  g.fillStyle = 'rgba(200,215,255,0.35)'; g.beginPath(); g.arc(576, 64, 17, 0, 7); g.fill();
  g.fillStyle = '#f4f7ff'; g.beginPath(); g.arc(576, 64, 10, 0, 7); g.fill();
  e.fillStyle = '#5a74c8'; e.beginPath(); e.arc(576, 64, 16, 0, 7); e.fill();
  e.fillStyle = '#cfe0ff'; e.beginPath(); e.arc(576, 64, 10, 0, 7); e.fill();
  uv('dot', 512, 0, 128, 128);
  // the name in white 3D letters on transparent ground (alphaTest cuts the background)
  const txt = 'DAUGAVPILS  OLIMPISKAIS CENTRS', font = '700 88px "Golos Text", "Trebuchet MS", sans-serif';
  g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
  e.font = font; e.textBaseline = 'middle'; e.textAlign = 'center';
  g.fillStyle = '#7d8288'; g.fillText(txt, 516, 581); g.fillStyle = '#f5f6f7'; g.fillText(txt, 512, 576);
  e.fillStyle = '#dce8ff'; e.fillText(txt, 512, 576);
  uv('sign', 0, 512, 1024, 128);
  const t = toTex(cv, true, false), te = toTex(gm, true, false);
  t.minFilter = te.minFilter = THREE.LinearMipmapLinearFilter;
  return [t, te];
}

export { LMS, LMT, LMWS, LM_FLOWERS, OCF, bedSpecies, lmFlowerAtlas, lmOCFacade, lmSigns, lmTiles, lmWallTex, lr };
