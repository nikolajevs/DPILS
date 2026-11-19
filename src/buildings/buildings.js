import { STATE } from '../core/state.js';
import { due, pause } from '../core/pause.js';
import { FORT_PAL, fortDrops, fortIn } from '../fortress/index.js';
import { fuelDrops } from '../landmarks/fuel.js';
import { spwDrops } from '../landmarks/speedway.js';
import { LM_OWNED } from '../landmarks/rigas.js';
import { lmDrops, lmOwns } from '../landmarks/core.js';
import { schClaim } from '../landmarks/schools.js';
import { shopClaim } from '../landmarks/shops.js';
import { band, church, flatPlain, flatRoof, roofFace, tileOf, tiles, vband, wallQuad } from './walls.js';
import { lidarOf } from './lidar.js';
import { serBuild } from './series.js';
import { ovDrops } from '../world/overpass.js';
import { rbDrops } from '../world/bridge-railway.js';
import { BGRID, BLD, COL, matFac, matGold, matPlain, matRoof } from '../world/data.js';
import { BAY, PLINTH, PLINTH_H, ROOFPAL, WALLPAL } from '../world/palette.js';
import { TERR, terrainH } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { box, lathe, polyA } from '../core/geometry.js';
import { area2, bbox, dec, edgeN, hb, insetOk, obb, offsetRing, pick, reversed, rnd, sh } from '../core/util.js';
import { C, NAMES } from '../core/env.js';

async function buildBuildings(from, to) {
  for (let id = from; id < to; id++) {
    if (due()) await pause();
    const rec = C.b[id], style = rec[0], mh = rec[2] / 10, flags = rec[6]; let h = rec[1] / 10, floors = Math.max(1, rec[5]);
    const rings = []; for (let k = 7; k < rec.length; k++) { let r = dec(rec[k]); if (r.length < 6) continue; const A = area2(r); if ((k === 7) !== (A > 0)) r = reversed(r); rings.push(r); }
    if (!rings.length) continue;
    const outer = rings[0], bb = bbox(outer), cx = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2;
    if (lmDrops(outer, bb) || fortDrops(outer, bb) || spwDrops(outer, bb) || fuelDrops(outer, bb, style) || ovDrops(outer, bb) || rbDrops(outer, bb)) continue;   // drawn by buildLandmarks or buildFortress
    // on a slope a house stands level at the height of its upper side (no more than 2.5 m over its lowest point, the
    // rest goes into the ground), and the foot of its walls reaches down to the ground on the lower side: a plinth
    if (TERR.on) { let lo = 1e9, hi = -1e9; for (let i = 0; i < outer.length; i += 2) { const t = terrainH(outer[i], outer[i + 1]); lo = Math.min(lo, t); hi = Math.max(hi, t); }
      const base = Math.min(hi - 0.15, lo + 2.5); STATE.GBC = (x, y, z) => { const t = terrainH(x, z); return y <= 0.05 ? Math.min(base, t) - 0.25 - t - y : base - t; }; }
    const name = rec[3] >= 0 ? NAMES[rec[3]] : '';
    BLD.push({ ring: outer, bb, kind: style, top: h }); const bid = BLD.length - 1;
    for (let i = Math.floor(bb[0] / 60); i <= Math.floor(bb[2] / 60); i++) for (let j = Math.floor(bb[1] / 60); j <= Math.floor(bb[3] / 60); j++) { const k = (i + 2000) * 4096 + j + 2000; let l = BGRID.get(k); if (!l) BGRID.set(k, l = []); l.push(bid); }
    if (mh < 2.2 && style !== 12) for (const r of rings) { const n = r.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n; COL.add(r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1], 0, 0); } }
    if (lmOwns(outer, bb)) { LM_OWNED.push({ ring: outer, bb }); continue; }   // drawn by buildLandmarks
    if (schClaim(id, rec, rings, outer, bb)) continue;   // a school: its roof is drawn now, its walls by lmSchools
    if (shopClaim(id, rec, rings, outer, bb)) continue;   // a supermarket or a part of Ditton nams or Solo: drawn by lmShops
    const small = (flags & 4) !== 0, T = tileOf(cx, cz), G = small ? T.d : T.m, D = T.d, seed = Math.floor(rnd(id, 9) * 255);
    if (!small && serBuild(rec, rings, outer, T, id, seed)) continue;   // a standard Soviet block of 5–9 storeys
    // special structures
    if (style === 12) { // canopy on posts
      const col = hb('#8f9294'); flatPlain(G.plain, rings, h, col, false); flatPlain(G.plain, rings, h - 0.25, sh(col, 0.7), true); vband(G.plain, outer, h - 0.25, h, col);
      const n = outer.length >> 1, step = Math.max(1, Math.floor(n / 6)); for (let i = 0; i < n; i += step) { const o = offsetRing(outer, -0.3); box(G.plain, o[2 * i], o[2 * i + 1], 1, 0, 0.08, 0.08, 0, h - 0.25, hb('#6c6f72'), false); }
      continue;
    }
    if (style === 13) { const r = Math.max(1.5, Math.sqrt(Math.abs(area2(outer)) / Math.PI)); lathe(G.plain, cx, cz, 0, [[r, 0], [r, h], [r * 0.25, h + r * 0.25], [0, h + r * 0.27]], 16, 0, hb('#d3d6d8')); continue; }
    if (style === 14) {
      const col = hb('#d6e4df'); vband(G.plain, outer, 0, h, col); const o = obb(outer);
      if (o && o.fill > 0.8) { const rr = o.b * 0.5, P = (su, sv, y) => [o.cx + o.ux * su * o.a - o.uz * sv * o.b, y, o.cz + o.uz * su * o.a + o.ux * sv * o.b];
        roofFace(G.roof, [P(-1, -1, h), P(1, -1, h), P(1, 0, h + rr), P(-1, 0, h + rr)], o.ux, o.uz, hb('#dce9e8'), 6, seed); roofFace(G.roof, [P(-1, 1, h), P(1, 1, h), P(1, 0, h + rr), P(-1, 0, h + rr)], o.ux, o.uz, hb('#dce9e8'), 6, seed);
        polyA(G.plain, [P(-1, -1, h), P(-1, 1, h), P(-1, 0, h + rr)], col, -o.ux, 0, -o.uz); polyA(G.plain, [P(1, -1, h), P(1, 1, h), P(1, 0, h + rr)], col, o.ux, 0, o.uz); }
      else flatRoof(G.roof, rings, h, hb('#dce9e8'), 6, seed);
      continue;
    }
    const worship = style >= 8 && style <= 11, row = worship ? 0 : style;
    /* the heights and the roof the lidar measured (src/buildings/lidar.js): the walls up to the eaves, the floors scaled
       with them where they differ by more than 2.5 m, the shape and the pitch of the roof up to its top. Not for churches
       nor for parts standing on others; a small outbuilding the lidar takes as flat keeps its pitched roof. */
    const lid = mh === 0 && !worship ? lidarOf(id) : null, useLid = !!lid && lid.eave >= 2 && lid.eave <= 120 && (lid.type !== 1 || !small || Math.abs(area2(outer)) >= 30);
    if (useLid) { const h0 = h; h = lid.eave; if (Math.abs(h - h0) > 2.5) floors = Math.max(1, Math.round(floors * h / h0)); }
    const tint = worship ? (style === 8 ? (/Бориса/.test(name) ? hb('#a9c4e4') : hb('#f0ebe0')) : style === 9 ? hb('#f2eee6') : style === 10 ? hb('#a5503a') : hb('#e6dccb'))
      : row === 0 && floors <= 3 && fortIn(cx, cz, -60) ? pick(FORT_PAL, id, 1) : pick(WALLPAL[row], id, 1);   // the barracks and stores of the fortress
    let mat = rec[4] & 15; const pitched = useLid ? lid.type >= 2 : rec[4] >= 16 || worship;
    if (!mat) mat = pitched ? (row === 5 || row === 7 ? [1, 1, 2, 1, 4][Math.floor(rnd(id, 3) * 5)] : row <= 1 ? 2 : 1) : (row === 6 && rnd(id, 3) < 0.5 ? 0 : 5);
    if (worship) mat = 2;
    const roofTint = worship ? hb(style === 8 ? '#4f7a66' : '#843e30') : pick(ROOFPAL[mat], id, 2);
    const plinth = mh > 0 ? 0 : Math.min(PLINTH_H[row], h * 0.22), yb = mh > 0 ? mh : plinth;
    const fh = Math.max(1.5, (h - yb) / floors), bay = BAY[row], fl = (flags & 1) ? 1 : 0;
    // roof form
    let roof = pitched && rings.length === 1 && h - mh > 1.8 ? 'inset' : 'flat', o = null;
    if (roof === 'inset') { o = obb(outer); if (o && o.fill > 0.86 && o.b < 13) roof = (row <= 1 || row === 4) && o.b > 5 ? 'hip' : (rnd(id, 4) < (row === 5 ? 0.25 : 0.45) ? 'hip' : 'gable'); }
    if (worship) { o = o || obb(outer); roof = o && o.fill > 0.7 ? 'gable' : 'flat'; }
    if (useLid && lid.type >= 2 && rings.length === 1) {   // the shape the lidar saw: a gable across the long side turns the box
      o = obb(outer);
      if (o && lid.type <= 4 && o.fill > 0.7) { if (lid.type === 3) o = { ...o, ux: -o.uz, uz: o.ux, a: o.b, b: o.a }; roof = lid.type === 4 ? 'hip' : 'gable'; }
      else roof = 'inset';
    }
    const parapet = roof === 'flat' && !small && floors >= 2;
    const pitch = (row === 5 || (row <= 2 && floors <= 2)) ? 0.62 : row === 7 ? 0.38 : 0.48;
    const tanp = useLid && o && (roof === 'gable' || roof === 'hip') ? Math.max(0.12, Math.min(1.6, (lid.top - h) / o.b)) : Math.tan(pitch);   // the ridge at the measured top
    // plinth
    if (plinth > 0.05) { const pc = pick(PLINTH, id, 6); for (const r of rings) { const n = r.length >> 1; for (let i = 0; i < n; i++) { const j = (i + 1) % n, e = edgeN(r, i); if (e[2] < 0.05) continue; polyA(G.plain, [[r[2 * i], 0, r[2 * i + 1]], [r[2 * j], 0, r[2 * j + 1]], [r[2 * j], plinth, r[2 * j + 1]], [r[2 * i], plinth, r[2 * i + 1]]], pc, e[0], 0, e[1]); } } }
    if (mh > 0) flatPlain(G.plain, rings, mh, sh(tint, 0.6), true);
    // walls, balconies, entrances
    const apart = (flags & 2) && floors >= 3 && (row === 2 || row === 3 || row === 4);
    rings.forEach((r, ri) => {
      const n = r.length >> 1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, [nx, nz, L] = edgeN(r, i); if (L < 0.05) continue;
        const x1 = r[2 * i], z1 = r[2 * i + 1], x2 = r[2 * j], z2 = r[2 * j + 1];
        const cnt = Math.max(1, Math.round(L / bay)), blank = L < bay * 0.55 || (small && row !== 5 && L < 2.5) ? 2 : 0;
        const ext = parapet ? 0.6 : 0;
        wallQuad(G.fac, x1, z1, x2, z2, yb, h + ext, nx, nz, tint, 0, blank ? L / bay : cnt, 0, floors + ext / fh, row, seed, fl | blank);
        if (apart && ri === 0 && L >= 14 && cnt >= 4) {
          const tx = (x2 - x1) / L, tz = (z2 - z1) / L, bw = L / cnt;
          if (rnd(id, 20 + i) < 0.6) { // balconies
            const off = Math.floor(rnd(id, 40 + i) * 2), glazedAll = rnd(id, 60 + i);
            for (let k = 0; k < cnt; k++) if ((k + off) % 2 === 0) for (let f = 1; f < floors; f++) {
              const bx = x1 + tx * (k + 0.5) * bw + nx * 0.6, bz = z1 + tz * (k + 0.5) * bw + nz * 0.6, y = yb + f * fh;
              const glazed = rnd(id * 31 + k, f) < glazedAll * 0.8, pc = row === 4 ? sh(tint, 0.85) : hb(rnd(id, 7) < 0.5 ? '#d9d6ce' : '#c7c3b9');
              box(D.plain, bx, bz, tx, tz, bw * 0.42, 0.6, y - 0.15, y, hb('#a8a59e'));
              box(D.plain, bx, bz, tx, tz, bw * 0.42, 0.6, y, y + 1.05, glazed ? hb(['#e5e2da', '#c9b48e', '#9fb0b8', '#d8d0c0'][Math.floor(rnd(k, f) * 4)]) : pc, !glazed);
              if (glazed) box(D.plain, bx, bz, tx, tz, bw * 0.42, 0.6, y + 1.05, y + fh - 0.3, hb('#58697a'));
            }
          } else if (rnd(id, 80 + i) < 0.8) { // entrances with canopies
            for (let k = 1; k < cnt; k += 4) {
              const ex = x1 + tx * (k + 0.5) * bw, ez = z1 + tz * (k + 0.5) * bw;
              box(D.plain, ex + nx * 0.7, ez + nz * 0.7, tx, tz, 1.3, 0.7, yb + 2.3, yb + 2.45, hb('#9d9a93'));
              polyA(D.plain, [[ex - tx * 0.6 + nx * 0.03, yb, ez - tz * 0.6 + nz * 0.03], [ex + tx * 0.6 + nx * 0.03, yb, ez + tz * 0.6 + nz * 0.03], [ex + tx * 0.6 + nx * 0.03, yb + 2.1, ez + tz * 0.6 + nz * 0.03], [ex - tx * 0.6 + nx * 0.03, yb + 2.1, ez - tz * 0.6 + nz * 0.03]], hb('#4a3e35'), nx, 0, nz);
              box(D.plain, ex + nx * 0.6, ez + nz * 0.6, tx, tz, 1.0, 0.6, 0, yb, hb('#8f8c86'));
            }
          }
        }
      }
    });
    // cornice on historic façades
    if ((row === 0 || row === 1 || worship) && !small && h > 3) {
      const cc = row === 1 ? sh(tint, 0.85) : sh(tint, 1.04), q = offsetRing(outer, 0.3);
      vband(G.plain, q, h - 0.45, h, cc); band(G.plain, outer, q, h - 0.45, sh(cc, 0.7), true); if (roof === 'flat') band(G.plain, outer, q, h, cc, false);
    }
    // roofs
    if (roof === 'gable' || roof === 'hip') {
      const ov = row === 5 || row === 7 ? 0.45 : 0.3, A = o.a + ov, Bq = o.b + ov, yE = h - ov * tanp, yR = h + o.b * tanp;
      const P = (su, sv, y, a, b2) => [o.cx + o.ux * su * a - o.uz * sv * b2, y, o.cz + o.uz * su * a + o.ux * sv * b2];
      if (roof === 'gable') {
        for (const sv of [-1, 1]) roofFace(G.roof, [P(-1, sv, yE, A, Bq), P(1, sv, yE, A, Bq), P(1, 0, yR, A, 0), P(-1, 0, yR, A, 0)], o.ux, o.uz, roofTint, mat, seed);
        for (const su of [-1, 1]) {
          const t1 = P(su, -1, h, o.a, o.b), t2 = P(su, 1, h, o.a, o.b), t3 = P(su, 0, yR, o.a, 0);
          const v0 = floors, k = [t1, t2, t3].map((p, q) => G.fac.vert(p[0], p[1], p[2], o.ux * su, 0, o.uz * su, tint, q === 0 ? 0 : q === 1 ? 2 * o.b / bay : o.b / bay, q < 2 ? v0 : v0 + (yR - h) / fh, row, seed, 2));
          if (su > 0) G.fac.tri(k[0], k[1], k[2]); else G.fac.tri(k[0], k[2], k[1]);
          polyA(G.plain, [P(su, -1, yE, A, Bq), P(su, 1, yE, A, Bq), P(su, 0, yR, A, 0)], sh(roofTint, 0.6), o.ux * su, 0.01, o.uz * su);
        }
        polyA(G.plain, [P(-1, -1, yE, A, Bq), P(1, -1, yE, A, Bq), P(1, 1, yE, A, Bq), P(-1, 1, yE, A, Bq)], sh(tint, 0.55), 0, -1, 0);
        if ((row === 0 || row === 1 || row === 2 || row === 5) && floors <= 2 && !small) { // chimneys
          const cnum = rnd(id, 12) < 0.5 ? 1 : 2;
          for (let c = 0; c < cnum; c++) { const t = (rnd(id, 13 + c) - 0.5) * 1.2 * o.a, [chx, chz] = [o.cx + o.ux * t - o.uz * 0.3, o.cz + o.uz * t + o.ux * 0.3]; box(D.plain, chx, chz, o.ux, o.uz, 0.28, 0.28, yR - 1.2, yR + 0.9, hb(rnd(id, 14) < 0.6 ? '#8f4a3a' : '#9b978f')); }
        }
      } else {
        const rr = Math.max(0, A - Bq);
        for (const sv of [-1, 1]) roofFace(G.roof, [P(-1, sv, yE, A, Bq), P(1, sv, yE, A, Bq), P(1, 0, yR, rr, 0), P(-1, 0, yR, rr, 0)], o.ux, o.uz, roofTint, mat, seed);
        for (const su of [-1, 1]) roofFace(G.roof, [P(su, -1, yE, A, Bq), P(su, 1, yE, A, Bq), P(su, 0, yR, rr, 0)], -o.uz, o.ux, roofTint, mat, seed);
        polyA(G.plain, [P(-1, -1, yE, A, Bq), P(1, -1, yE, A, Bq), P(1, 1, yE, A, Bq), P(-1, 1, yE, A, Bq)], sh(tint, 0.55), 0, -1, 0);
      }
    } else if (roof === 'inset') {
      const ov = 0.3; let d = Math.min(6, o ? o.b * 0.95 : 4), inner = null;
      for (let k = 0; k < 5 && d > 0.7; k++) { const q = offsetRing(outer, -d); if (insetOk(outer, q)) { inner = q; break; } d *= 0.6; }
      if (inner) {
        const tp = useLid && lid.top > h + 0.3 ? Math.max(0.1, Math.min(1.6, (lid.top - h) / d)) : tanp;   // its top at the measured one
        const eave = offsetRing(outer, ov), yE = h - ov * tp, yT = h + d * tp, n = outer.length >> 1;
        for (let i = 0; i < n; i++) { const j = (i + 1) % n, e = edgeN(outer, i); if (e[2] < 0.05) continue; roofFace(G.roof, [[eave[2 * i], yE, eave[2 * i + 1]], [eave[2 * j], yE, eave[2 * j + 1]], [inner[2 * j], yT, inner[2 * j + 1]], [inner[2 * i], yT, inner[2 * i + 1]]], -e[1], e[0], roofTint, mat, seed); }
        flatRoof(G.roof, [inner], yT, roofTint, mat, seed);
        band(G.plain, outer, eave, yE, sh(tint, 0.55), true);
      } else roof = 'flat';
    }
    if (roof === 'flat') {
      const rm = mat === 5 || mat === 0 ? mat : 5;
      flatRoof(G.roof, rings, h + (parapet ? 0.05 : 0), roofTint, rm, seed);
      if (parapet) { const q = offsetRing(outer, -0.25), pc = sh(tint, 0.82); vband(G.plain, q, h, h + 0.6, pc, -1); band(G.plain, outer, q, h + 0.6, hb('#8e8b85'), false); }
      if (floors >= 5 && !small) { const oo = o || obb(outer); if (oo) for (let k = 0; k < (oo.a > 30 ? 2 : 1); k++) { const t = oo.a > 30 ? (k ? 0.35 : -0.35) * oo.a : 0; box(D.plain, oo.cx + oo.ux * t, oo.cz + oo.uz * t, oo.ux, oo.uz, 2.2, 1.6, h, h + 2.4, hb('#a29f97')); } }
    }
    if (worship && o) church(G.plain, STATE.goldGB, style, o, h, o.b * tanp, tint, name);
  }
}
function finishBuildings() {
  STATE.GBC = null;
  for (const t of tiles.values()) {
    for (const [set, list] of [[t.m, t.meshes], [t.d, t.det]]) {
      const ms = [set.fac.mesh(matFac), set.roof.mesh(matRoof), set.plain.mesh(matPlain), set.ser.mesh(STATE.matSer)];
      for (const m of ms) if (m) { m.castShadow = m.receiveShadow = true; scene.add(m); list.push(m); }
    }
  }
  const g = STATE.goldGB.mesh(matGold); if (g) { g.castShadow = true; scene.add(g); }
}

export { buildBuildings, finishBuildings };
