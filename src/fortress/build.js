import * as THREE from 'three';
import { fortMonuments } from './monuments.js';
import { fortBuildings } from './arsenals.js';
import { fortMagazines } from './magazines.js';
import { fortReduits } from './reduits.js';
import { fortGateModels } from './gates.js';
import { fortDitches, fortField, fortFine, fortWalls } from './ground.js';
import { fortAtlas, fortBrickTex, fortTex } from './textures.js';
import { FS, fortGridH, fortPrep } from './ground-height.js';
import { FORT, fortIn } from './index.js';
import { LMM, lmStd } from '../landmarks/index.js';
import { LMB } from '../landmarks/core.js';
import { LINES } from '../world/data.js';
import { LINE } from '../world/palette.js';
import { scene } from '../render/renderer.js';
import { GB, polyA } from '../core/geometry.js';
import { hb, pip } from '../core/util.js';

function buildFortress() {
  if (!FORT.ok) return;
  fortPrep();
  const bt = fortBrickTex(), [dt, ct] = fortAtlas(), TX4 = [0, 1, 2, 3, 4, 5, 6].map(fortTex);
  const M = {
    rub: lmStd({ vertexColors: true, map: TX4[0], roughness: 0.95, metalness: 0 }, 'ft-rub'), gra: lmStd({ vertexColors: true, map: TX4[1], roughness: 0.8, metalness: 0 }, 'ft-gra'),
    snd: lmStd({ vertexColors: true, map: TX4[2], roughness: 0.9, metalness: 0 }, 'ft-snd'), wood: lmStd({ vertexColors: true, map: TX4[3], roughness: 0.85, metalness: 0 }, 'ft-wood'),
    det: lmStd({ vertexColors: true, map: dt, roughness: 0.8, metalness: 0 }, 'ft-det'), rus: lmStd({ vertexColors: true, map: TX4[5], roughness: 0.9, metalness: 0 }, 'ft-rus'),
    roof: lmStd({ vertexColors: true, map: TX4[4], roughness: 0.62, metalness: 0.12 }, 'ft-roof'), pla: lmStd({ vertexColors: true, map: TX4[6], roughness: 0.93, metalness: 0 }, 'ft-pla'), brk: bt ? lmStd({ vertexColors: true, map: bt, roughness: 0.88, metalness: 0 }, 'ft-brk') : LMM.brick, cut: lmStd({ vertexColors: true, map: ct, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0 }, 'ft-cut')
  };
  const K = { rub: new LMB(), gra: new LMB(), snd: new LMB(), wood: new LMB(), brk: new LMB(), ren: new LMB(), det: new LMB(), cut: new LMB(), cnc: new LMB(), rus: new LMB(), roof: new LMB(), pla: new LMB(), cap2b: new LMB(), cap: new GB(false), cap2: new GB(false) };
  fortField(K); fortFine(); fortWalls(K); fortDitches(); fortGateModels(K); fortBuildings(K); fortMagazines(K); fortReduits(K); fortMonuments(K); fortPaths();
  K.rub.mesh(M.rub); K.gra.mesh(M.gra); K.snd.mesh(M.snd); K.wood.mesh(M.wood); K.det.mesh(M.det); K.cut.mesh(M.cut, false); K.cnc.mesh(M.gra); K.rus.mesh(M.rus); K.roof.mesh(M.roof); K.pla.mesh(M.pla); K.cap2b.mesh(LMM.plain);
  K.brk.mesh(M.brk); K.ren.mesh(LMM.ren);
  for (const b of [K.cap, K.cap2]) { const m = b.mesh(LMM.plain); if (m) { m.castShadow = m.receiveShadow = true; scene.add(m); } }
}
// footpaths over the ramparts and down into the moats, laid on the terrain mesh (the flat ones stay with the streets)
function fortPaths() {
  const G = FORT.grid, PB = new GB(false), cellFlat = (x, z) => {
    const i = Math.floor((x - G.X0) / G.c), j = Math.floor((z - G.Z0) / G.c); if (i < 0 || j < 0 || i >= G.N - 1 || j >= G.N - 1) return true;
    for (const k of [j * G.N + i, j * G.N + i + 1, (j + 1) * G.N + i, (j + 1) * G.N + i + 1]) if (Math.abs(G.H[k]) >= 0.03 || (G.B[k] & 3)) return false; return true; },
    cellSolid = (x, z) => { const i = Math.floor((x - G.X0) / G.c), j = Math.floor((z - G.Z0) / G.c); if (i < 0 || j < 0 || i >= G.N - 1 || j >= G.N - 1) return false;
      for (const k of [j * G.N + i, j * G.N + i + 1, (j + 1) * G.N + i, (j + 1) * G.N + i + 1]) if ((G.B[k] & 8) || G.WET[k]) return false; return true; };
  for (const l of LINES) {
    if (l.cls !== 5 && l.cls !== 6 && l.cls !== 7 && l.cls !== 15) continue;
    const p = l.pts, n = p.length >> 1, hw = l.w / 2, col = hb(LINE[l.cls][1]);
    for (let i = 0; i < n - 1; i++) {
      const x1 = p[2 * i], z1 = p[2 * i + 1], x2 = p[2 * i + 2], z2 = p[2 * i + 3], L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.1 || !fortIn((x1 + x2) / 2, (z1 + z2) / 2)) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L, nx = -tz * hw, nz = tx * hw, steps = Math.ceil(L / 1.5);
      for (let s = 0; s < steps; s++) {
        const a = s * L / steps, b = (s + 1) * L / steps, A = [x1 + tx * a, z1 + tz * a], B = [x1 + tx * b, z1 + tz * b];
        if (cellFlat(A[0], A[1]) && cellFlat(B[0], B[1])) continue;
        // no terrain under the gate blocks and the water: a path there would hang between the heights around
        if (!cellSolid(A[0], A[1]) || !cellSolid(B[0], B[1]) || Math.abs(fortGridH(A[0], A[1]) - fortGridH(B[0], B[1])) > (b - a) * 0.9) continue;
        if (FS.bridge && pip((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, FS.bridge)) continue;
        // each corner at least as high as the terrain under the middle of the piece: on a sharp crest the 2 m
        // triangles bulge above a strip laid only through its corners
        const hm = fortGridH((A[0] + B[0]) / 2, (A[1] + B[1]) / 2), P = (x, z) => [x, Math.max(fortGridH(x, z), hm - 0.1) + 0.18, z];
        polyA(PB, [P(A[0] + nx, A[1] + nz), P(B[0] + nx, B[1] + nz), P(B[0] - nx, B[1] - nz), P(A[0] - nx, A[1] - nz)], col, 0, 1, 0);
      }
    }
  }
  const m = PB.mesh(lmStd({ vertexColors: true, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }, 'ft-path'));
  if (m) { m.receiveShadow = true; scene.add(m); }
}
const fortTreeY = (x, z) => FORT.grid && fortIn(x, z, 30) ? fortGridH(x, z) : 0;

export { buildFortress, fortTreeY };
