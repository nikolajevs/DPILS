import * as THREE from 'three';
import { FORT } from './index.js';
import { LMM } from '../landmarks/index.js';
import { LMWS } from '../landmarks/tiles.js';
import { mkCanvas, toTex } from '../render/textures.js';
import { hb } from '../core/util.js';

/* ---- textures of the fortress: fieldstone escarps, granite dressings, sandstone, planks ---- */
function fortTex(kind) {
  const S = 512, cv = mkCanvas(S, S), g = cv.getContext('2d');
  let seed = 911 + kind * 77; const rr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (kind === 0) {                                   // fieldstone: rounded granite boulders in grey mortar, 4 m per tile
    g.fillStyle = '#a9a398'; g.fillRect(0, 0, S, S);
    const PAL = ['#8e8a85', '#9c8578', '#7f776f', '#a49f97', '#6f6b66', '#b3a99c', '#8a7a6a', '#958f88', '#a08c7e', '#77736d'];
    const rows = []; let tot = 0; while (tot < S) { const h = 28 + rr() * 34; rows.push(h); tot += h; } const kf = S / tot;
    let y = 0;
    for (const h0 of rows) {
      const h = h0 * kf; let x = -rr() * 60;
      while (x < S) {
        const w = 36 + rr() * 70, col = PAL[Math.floor(rr() * PAL.length)];
        for (const ox of [0, -S, S]) {
          const x0 = x + ox + 2 + rr() * 2, y0 = y + 2 + rr() * 3, ww = w - 5, hh = h - 5 - rr() * 3, r = Math.min(ww, hh) * 0.4;
          if (x0 > S || x0 + ww < 0) continue;
          const gr = g.createLinearGradient(x0, y0, x0 + ww * 0.4, y0 + hh); gr.addColorStop(0, shadeHexF(col, 1.18)); gr.addColorStop(0.55, col); gr.addColorStop(1, shadeHexF(col, 0.72));
          g.fillStyle = gr; g.beginPath(); g.moveTo(x0 + r, y0); g.arcTo(x0 + ww, y0, x0 + ww, y0 + hh, r); g.arcTo(x0 + ww, y0 + hh, x0, y0 + hh, r); g.arcTo(x0, y0 + hh, x0, y0, r); g.arcTo(x0, y0, x0 + ww, y0, r); g.fill();
        }
        x += w;
      }
      y += h;
    }
  } else if (kind === 1 || kind === 2) {              // dressed granite (1, grey, 2 m per tile) or sandstone (2, beige, 3 m)
    const base = kind === 1 ? [184, 182, 176] : [206, 184, 140], bh = kind === 1 ? 64 : 85;
    g.fillStyle = kind === 1 ? '#8f8d88' : '#9c8a68'; g.fillRect(0, 0, S, S);
    for (let y = 0, row = 0; y < S; y += bh, row++) { let x = row % 2 ? -bh * 0.8 : 0;
      while (x < S) { const w = bh * (1.3 + rr() * 1.1), f = 0.9 + rr() * 0.16;
        for (const ox of [0, S]) { g.fillStyle = `rgb(${base[0] * f | 0},${base[1] * f | 0},${base[2] * f | 0})`; g.fillRect(x + 1.5 - ox, y + 1.5, w - 3, bh - 3); }
        x += w; } }
  } else if (kind === 4) {                            // standing-seam steel roof, seams along the slope every 0.55 m, 2.2 m per tile
    g.fillStyle = '#9a9fa3'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 4; k++) { const x = k * S / 4, f = 0.94 + rr() * 0.1; g.fillStyle = `rgb(${154 * f | 0},${159 * f | 0},${163 * f | 0})`; g.fillRect(x + 6, 0, S / 4 - 6, S);
      g.fillStyle = '#c3c7ca'; g.fillRect(x, 0, 3, S); g.fillStyle = '#6f7478'; g.fillRect(x + 3, 0, 3, S); }
  } else if (kind === 5) {                            // render scored into rustication: a groove every 0.5 m, 4 m per tile
    g.fillStyle = '#e4e2dc'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 8; k++) { const y = k * S / 8; g.fillStyle = 'rgba(70,60,40,0.55)'; g.fillRect(0, y, S, 3); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, y + 3, S, 2); }
  } else {                                            // planks along u, 2 m per tile
    for (let y = 0; y < S; y += 36) { const f = 0.88 + rr() * 0.2; g.fillStyle = `rgb(${170 * f | 0},${132 * f | 0},${88 * f | 0})`; g.fillRect(0, y, S, 34); g.fillStyle = 'rgba(60,40,20,0.55)'; g.fillRect(0, y + 34, S, 2);
      for (let k = 0; k < 6; k++) { g.strokeStyle = `rgba(90,60,30,${0.15 + rr() * 0.2})`; g.lineWidth = 1; g.beginPath(); const yy = y + 4 + rr() * 26; g.moveTo(0, yy); g.bezierCurveTo(S * 0.3, yy + rr() * 6 - 3, S * 0.7, yy + rr() * 6 - 3, S, yy); g.stroke(); } }
  }
  const id = g.getImageData(0, 0, S, S), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = 1 + (Math.random() - 0.5) * (kind === 1 ? 0.22 : 0.12); d[i] = Math.min(255, d[i] * n); d[i + 1] = Math.min(255, d[i + 1] * n); d[i + 2] = Math.min(255, d[i + 2] * n); }
  g.putImageData(id, 0, 0); const t = toTex(cv, true, true); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
// the brick of the gates: the city's red facing brick, paler and more salmon, as on the restored Nicholas gate
function fortBrickTex() {
  const src = LMM.brick && LMM.brick.map && LMM.brick.map.image; if (!src) return null;
  const cv = mkCanvas(src.width, src.height), g = cv.getContext('2d'); g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'screen'; g.fillStyle = 'rgba(190,140,120,0.3)'; g.fillRect(0, 0, cv.width, cv.height);
  FORT.brickCv = cv; const t = toTex(cv, true, true); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
function shadeHexF(h, f) { const c = hb(h); return `rgb(${Math.min(255, c[0] * f) | 0},${Math.min(255, c[1] * f) | 0},${Math.min(255, c[2] * f) | 0})`; }
const FTS = [4, 2, 3, 2, 2.2, 4];   // metres per tile: fieldstone, granite, sandstone, planks, roof steel, rusticated render; brick uses LMWS[3]

/* gate details: an opaque atlas (doors, grilles, the frieze of the Nicholas gate) and a cut-out one (eagles,
   lettering) — drawn like the landmark atlas, in metres from the top-left of each tile */
const FTT = {};
function fortAtlas() {
  const PX = 64, W = 1024, cv = mkCanvas(W, W), g = cv.getContext('2d'), cc = mkCanvas(W, 512), c = cc.getContext('2d');
  g.fillStyle = '#777'; g.fillRect(0, 0, W, W);
  let X = 2, Y = 2, rowH = 0;
  const tile = (name, w, h, draw, ctx = g, AW = W, AH = W) => {
    const pw = Math.ceil(w * PX), ph = Math.ceil(h * PX);
    if (X + pw > AW - 2) { X = 2; Y += rowH + 4; rowH = 0; }
    ctx.save(); ctx.translate(X, Y); ctx.scale(PX, PX); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); draw(ctx); ctx.restore();
    FTT[name] = { u0: (X + 0.5) / AW, u1: (X + pw - 0.5) / AW, v0: 1 - (Y + ph - 0.5) / AH, v1: 1 - (Y + 0.5) / AH };
    X += pw + 4; rowH = Math.max(rowH, ph);
  };
  const lw = (ctx, w) => { ctx.lineWidth = w; };
  // door of the Nicholas gate: oak leaves with planks laid in lozenges
  tile('door', 2.6, 3.6, x => { x.fillStyle = '#8a6036'; x.fillRect(0, 0, 2.6, 3.6); x.strokeStyle = '#5a3c20'; lw(x, 0.07);
    for (let k = -8; k < 12; k++) { x.beginPath(); x.moveTo(k * 0.5, 0); x.lineTo(k * 0.5 + 3.6, 3.6); x.stroke(); x.beginPath(); x.moveTo(k * 0.5, 3.6); x.lineTo(k * 0.5 + 3.6, 0); x.stroke(); }
    x.strokeStyle = '#3a2814'; lw(x, 0.12); x.strokeRect(0.06, 0.06, 2.48, 3.48); x.fillStyle = '#2b2b2b'; x.fillRect(0.1, 2.0, 2.0, 0.08); });
  tile('grille', 1.0, 1.0, x => { x.fillStyle = '#22272b'; x.fillRect(0, 0, 1, 1); x.strokeStyle = '#4a4440'; lw(x, 0.035); for (let k = 1; k < 5; k++) { x.beginPath(); x.moveTo(k / 5, 0); x.lineTo(k / 5, 1); x.stroke(); x.beginPath(); x.moveTo(0, k / 5); x.lineTo(1, k / 5); x.stroke(); } });
  tile('arcade', 4.0, 0.7, x => { x.fillStyle = '#b8b6b0'; x.fillRect(0, 0, 4, 0.7); for (let k = 0; k < 8; k++) { const cx = k * 0.5 + 0.25; x.fillStyle = '#6e6c68'; x.beginPath(); x.moveTo(cx - 0.17, 0.62); x.lineTo(cx - 0.17, 0.32); x.arc(cx, 0.32, 0.17, Math.PI, 0); x.lineTo(cx + 0.17, 0.62); x.fill(); x.fillStyle = '#d2d0ca'; x.fillRect(cx + 0.19, 0.18, 0.08, 0.44); } x.fillStyle = '#9a9893'; x.fillRect(0, 0.62, 4, 0.08); });
  // a side bay of the inner façade: a blind pointed arch over a door and two windows, on salmon render
  const brickBg = (x, w, h) => { const im = FORT.brickCv; if (!im) { x.fillStyle = '#b4654e'; x.fillRect(0, 0, w, h); return; }
    for (let yy = 0; yy < h; yy += LMWS[3]) for (let xx = 0; xx < w; xx += LMWS[3]) x.drawImage(im, xx, yy, LMWS[3], LMWS[3]); };
  tile('bay', 5.6, 6.0, x => { brickBg(x, 5.6, 6); const arch = (cx, w, ys, ya, col, lwd) => { x.strokeStyle = col; lw(x, lwd); x.beginPath(); x.moveTo(cx - w, 6); x.lineTo(cx - w, ys); x.quadraticCurveTo(cx - w, ya + (ys - ya) * 0.2, cx, ya); x.quadraticCurveTo(cx + w, ya + (ys - ya) * 0.2, cx + w, ys); x.lineTo(cx + w, 6); x.stroke(); };
    arch(2.8, 2.55, 2.4, 0.15, '#ece4d8', 0.22); x.fillStyle = '#e6ddd0'; x.fillRect(0.1, 2.3, 5.4, 0.12);
    const win = (cx, y0, w, h) => { x.fillStyle = '#ece4d8'; x.fillRect(cx - w / 2 - 0.08, y0 - 0.08, w + 0.16, h + 0.16); x.fillStyle = '#4e5a63'; x.fillRect(cx - w / 2, y0, w, h); x.strokeStyle = '#d8d4cc'; lw(x, 0.04); x.beginPath(); x.moveTo(cx, y0); x.lineTo(cx, y0 + h); x.stroke(); };
    win(1.3, 3.55, 0.5, 1.6); win(4.3, 3.55, 0.5, 1.6); x.fillStyle = '#7d8c99'; x.fillRect(2.45, 3.35, 0.7, 2.55); x.strokeStyle = '#5c6a76'; lw(x, 0.05); x.strokeRect(2.5, 3.4, 0.6, 2.45);
    for (const [cx, ys] of [[1.3, 3.4], [2.8, 3.25], [4.3, 3.4]]) { x.fillStyle = '#4e5a63'; x.beginPath(); x.moveTo(cx - 0.25, ys); x.quadraticCurveTo(cx - 0.25, ys - 0.45, cx, ys - 0.75); x.quadraticCurveTo(cx + 0.25, ys - 0.45, cx + 0.25, ys); x.fill(); }
    x.fillStyle = '#6c6a66'; x.fillRect(0, 5.75, 5.6, 0.25); });
  tile('corbels', 4.0, 0.5, x => { brickBg(x, 4, 0.5); x.fillStyle = '#e9e2d6'; x.fillRect(0, 0, 4, 0.14); for (let k = 0; k < 8; k++) { x.fillRect(k * 0.5 + 0.17, 0.14, 0.16, 0.24); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(k * 0.5 + 0.17, 0.38, 0.16, 0.05); x.fillStyle = '#e9e2d6'; } });
  tile('meander', 4.0, 0.6, x => { x.fillStyle = '#c9c1b4'; x.fillRect(0, 0, 4, 0.6); x.strokeStyle = '#8a4e3a'; lw(x, 0.07); for (let k = 0; k < 8; k++) { const ox = k * 0.5; x.beginPath(); x.moveTo(ox, 0.48); x.lineTo(ox, 0.12); x.lineTo(ox + 0.38, 0.12); x.lineTo(ox + 0.38, 0.38); x.lineTo(ox + 0.16, 0.38); x.lineTo(ox + 0.16, 0.24); x.stroke(); } x.fillStyle = '#8a4e3a'; x.fillRect(0, 0.52, 4, 0.06); x.fillRect(0, 0.02, 4, 0.05); });
  tile('winged', 4.4, 1.2, x => { x.fillStyle = '#bab8b2'; x.fillRect(0, 0, 4.4, 1.2); x.strokeStyle = '#7e7c77'; lw(x, 0.05); x.beginPath(); x.arc(2.2, 0.6, 0.28, 0, 6.3); x.stroke();
    for (const s of [-1, 1]) { for (let k = 0; k < 7; k++) { x.beginPath(); x.moveTo(2.2 + s * 0.3, 0.45 + k * 0.05); x.quadraticCurveTo(2.2 + s * 1.2, 0.2 + k * 0.08, 2.2 + s * (1.95 - k * 0.12), 0.25 + k * 0.1); x.stroke(); }
      x.beginPath(); x.moveTo(2.2 + s * 0.25, 0.85); x.bezierCurveTo(2.2 + s * 0.5, 1.1, 2.2 + s * 0.7, 0.75, 2.2 + s * 0.9, 1.0); x.stroke(); } });
  // the arsenals: a tall window with small panes, a glazed double door, a frieze of dentils
  tile('awin', 1.0, 3.2, x => { x.fillStyle = '#3b2f27'; x.fillRect(0, 0, 1, 3.2); const gr = x.createLinearGradient(0, 0, 1, 3.2); gr.addColorStop(0, '#5d6d78'); gr.addColorStop(0.5, '#33404a'); gr.addColorStop(1, '#4b5862'); x.fillStyle = gr; x.fillRect(0.08, 0.08, 0.84, 3.04);
    x.fillStyle = '#3b2f27'; x.fillRect(0.46, 0.08, 0.08, 3.04); for (let k = 1; k < 5; k++) x.fillRect(0.08, 0.08 + k * 0.608 - 0.03, 0.84, 0.06); x.fillStyle = '#efe9dd'; x.fillRect(0, 3.12, 1, 0.08); });
  tile('adoor', 2.0, 3.0, x => { x.fillStyle = '#2f2c2a'; x.fillRect(0, 0, 2, 3); const gr = x.createLinearGradient(0, 0, 2, 3); gr.addColorStop(0, '#6f7f8a'); gr.addColorStop(1, '#2e3a44'); x.fillStyle = gr; x.fillRect(0.08, 0.08, 0.86, 2.84); x.fillRect(1.06, 0.08, 0.86, 2.84);
    x.fillStyle = '#2f2c2a'; x.fillRect(0.08, 0.7, 1.84, 0.06); x.fillStyle = '#c9c4ba'; x.fillRect(0.8, 1.5, 0.05, 0.5); x.fillRect(1.15, 1.5, 0.05, 0.5); });
  tile('dent', 4.0, 0.6, x => { x.fillStyle = '#efebe2'; x.fillRect(0, 0, 4, 0.6); x.fillStyle = '#c9c3b6'; x.fillRect(0, 0.42, 4, 0.04); for (let k = 0; k < 16; k++) { x.fillStyle = '#d8d2c6'; x.fillRect(k * 0.25 + 0.05, 0.12, 0.15, 0.22); x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(k * 0.25 + 0.05, 0.34, 0.15, 0.04); } });
  tile('cwin', 1.2, 2.2, x => { x.fillStyle = '#f1eee7'; x.fillRect(0, 0, 1.2, 2.2); const gr = x.createLinearGradient(0, 0, 1.2, 2.2); gr.addColorStop(0, '#6c7c88'); gr.addColorStop(0.55, '#34414b'); gr.addColorStop(1, '#4e5c67'); x.fillStyle = gr;
    for (const [px, py, w, hh] of [[0.09, 0.09, 0.47, 0.5], [0.64, 0.09, 0.47, 0.5], [0.09, 0.67, 0.47, 0.68], [0.64, 0.67, 0.47, 0.68], [0.09, 1.43, 0.47, 0.68], [0.64, 1.43, 0.47, 0.68]]) x.fillRect(px, py, w, hh); });
  tile('polplate', 0.6, 0.8, x => { x.fillStyle = '#1d3f7a'; x.fillRect(0, 0, 0.6, 0.8); x.strokeStyle = '#d9b44a'; lw(x, 0.015); x.strokeRect(0.03, 0.03, 0.54, 0.74);
    x.fillStyle = '#d9b44a'; x.beginPath(); x.moveTo(0.22, 0.1); x.lineTo(0.38, 0.1); x.lineTo(0.38, 0.26); x.quadraticCurveTo(0.3, 0.34, 0.22, 0.26); x.closePath(); x.fill();
    x.fillStyle = '#f4f4f0'; x.font = '700 0.07px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('VALSTS', 0.3, 0.44); x.fillText('POLICIJA', 0.3, 0.53); x.font = '400 0.042px Arial, sans-serif'; x.fillText('Latgales reģiona', 0.3, 0.63); x.fillText('pārvalde', 0.3, 0.69); });
  tile('engsign', 2.8, 0.44, x => { x.fillStyle = '#f2efe8'; x.fillRect(0, 0, 2.8, 0.44); x.strokeStyle = '#c8c2b6'; lw(x, 0.03); x.strokeRect(0.03, 0.03, 2.74, 0.38); x.fillStyle = '#26231f'; x.font = '700 0.2px "Times New Roman", Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('ИНЖЕНЕРНЫЙ АРСЕНАЛЪ', 1.4, 0.23); });
  tile('ramparch', 3.2, 2.2, x => { x.fillStyle = '#2b2a28'; x.fillRect(0, 0, 3.2, 2.2); const gr = x.createLinearGradient(0, 0, 0, 2.2); gr.addColorStop(0, '#1d1c1a'); gr.addColorStop(1, '#55524c'); x.fillStyle = gr; x.fillRect(0.2, 0.3, 2.8, 1.9); });
  // cut-outs: double-headed eagle, the name of the gate, an iron halberd
  X = 2; Y = 2; rowH = 0;
  tile('eagle', 5.0, 2.6, x => { x.fillStyle = '#2d2f30'; x.strokeStyle = '#2d2f30'; lw(x, 0.08);
    x.beginPath(); x.ellipse(2.5, 1.45, 0.42, 0.7, 0, 0, 6.3); x.fill();
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(2.5 + s * 0.3, 1.2); for (let k = 0; k <= 6; k++) { const t = k / 6; x.lineTo(2.5 + s * (0.4 + t * 2.0), 0.35 + t * 0.5 + Math.sin(t * Math.PI) * -0.2); } for (let k = 6; k >= 0; k--) { const t = k / 6; x.lineTo(2.5 + s * (0.45 + t * 1.85), 1.0 + t * 0.55 + (k % 2) * 0.12); } x.closePath(); x.fill();
      x.beginPath(); x.moveTo(2.5 + s * 0.15, 0.95); x.quadraticCurveTo(2.5 + s * 0.35, 0.45, 2.5 + s * 0.42, 0.42); x.lineTo(2.5 + s * 0.62, 0.48); x.lineTo(2.5 + s * 0.45, 0.6); x.quadraticCurveTo(2.5 + s * 0.3, 0.8, 2.5 + s * 0.25, 1.0); x.fill();
      x.beginPath(); x.ellipse(2.5 + s * 0.42, 0.33, 0.1, 0.1, 0, 0, 6.3); x.fill(); }
    x.beginPath(); x.moveTo(2.2, 0.32); x.lineTo(2.3, 0.08); x.lineTo(2.5, 0.2); x.lineTo(2.7, 0.08); x.lineTo(2.8, 0.32); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(2.2, 2.05); x.lineTo(2.5, 2.55); x.lineTo(2.8, 2.05); x.closePath(); x.fill();
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(2.5 + s * 0.2, 2.0); x.quadraticCurveTo(2.5 + s * 1.2, 2.5, 2.5 + s * 2.1, 2.2); x.stroke(); } }, c, W, 512);
  tile('nikname', 6.0, 0.5, x => { x.fillStyle = '#2e2c29'; x.font = '700 0.4px "Times New Roman", Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('НИКОЛАЕВСКІЯ', 3.0, 0.27); }, c, W, 512);
  // lunette window of the arsenals: a half disc of small panes in a dark frame
  tile('lunette', 4.4, 2.2, x => { x.save(); x.beginPath(); x.moveTo(0, 2.2); x.arc(2.2, 2.2, 2.2, Math.PI, 0); x.closePath(); x.clip();
    x.fillStyle = '#2e2924'; x.fillRect(0, 0, 4.4, 2.2); const gr = x.createLinearGradient(0, 0, 4.4, 2.2); gr.addColorStop(0, '#6a7b87'); gr.addColorStop(0.6, '#36434d'); gr.addColorStop(1, '#4d5b66'); x.fillStyle = gr;
    x.beginPath(); x.moveTo(0.12, 2.2); x.arc(2.2, 2.2, 2.08, Math.PI, 0); x.closePath(); x.fill(); x.fillStyle = '#2e2924';
    for (let k = 1; k < 11; k++) x.fillRect(k * 0.4 - 0.03, 0, 0.06, 2.2); for (let k = 1; k < 5; k++) x.fillRect(0, 2.2 - k * 0.45 - 0.03, 4.4, 0.06); x.fillRect(0, 2.08, 4.4, 0.12); x.restore(); }, c, W, 512);
  tile('policija', 10.9, 0.58, x => { x.fillStyle = '#2a2b2c'; x.font = '700 0.5px Arial, "Helvetica Neue", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('VALSTS POLICIJA', 5.45, 0.31); }, c, W, 512);
  tile('halberd', 1.0, 2.6, x => { x.fillStyle = '#2b2d2f'; x.fillRect(0.45, 0.25, 0.1, 2.3); x.beginPath(); x.moveTo(0.5, 0); x.lineTo(0.58, 0.35); x.lineTo(0.42, 0.35); x.fill();
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(0.5, 0.45); x.quadraticCurveTo(0.5 + s * 0.5, 0.35, 0.5 + s * 0.48, 0.75); x.quadraticCurveTo(0.5 + s * 0.3, 0.62, 0.5, 0.95); x.fill(); } }, c, W, 512);
  const t1 = toTex(cv, true, false), t2 = toTex(cc, true, false); t1.minFilter = t2.minFilter = THREE.LinearMipmapLinearFilter; return [t1, t2];
}

export { FTS, FTT, fortAtlas, fortBrickTex, fortTex };
