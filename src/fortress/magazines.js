import { fortArchRing, fortP, fortTBox, fortTile, fortWallPlane } from './gates.js';
import { FTS, FTT } from './textures.js';
import { lmBar } from '../landmarks/helpers.js';
import { LMWS } from '../landmarks/tiles.js';
import { lmW } from '../landmarks/core.js';
import { COL } from '../world/data.js';
import { polyA } from '../core/geometry.js';
import { hb, sh } from '../core/util.js';

/* ---- the powder magazine of the 7th bastion ----
   A long vaulted store of red brick at the foot of the 7th bastion (OSM way 116596097, "7. bastiona pulverpagrabs",
   Nikolaja iela 1, 64.5 × 15.3 m), since its restoration the Martinsons house, a hall of the Mark Rothko Art Centre
   for the ceramics of Pēteris Martinsons. From photographs on Wikimedia Commons (category "Powder warehouse
   (Daugavpils Fortress)", before and after the restoration): along both long sides an arcade of fifteen blind arches
   with a slit vent in each, a corbelled brick eave; the north gable towards the arsenal in ochre render with white
   rusticated quoins, a dark plinth, a pointed door in a fan of white voussoirs that rises almost to the top of the gable
   with a round window under its crown, lancet niches with small windows on either side; the south gable in red brick
   with three lancet niches and a round window, the gable above them in paler brick; a roof of standing-seam steel.
   Frame: u along the building from the north gable (0) to the south one (L), v across it, 0 at the west wall and
   −W at the east one. */
const FORT_MAG = [
  { key: 'b7', f: [-2646.2, -78.4, 0.0248, 0.9997], L: 64.5, W: 15.3, H: 4.4, pitch: 0.55, n: 15, wings: [[0, 64.5, -15.3, 0]] }
];
const MAG_BRK = [240, 200, 186], MAG_OCH = [236, 178, 86], MAG_WH = [246, 243, 236], MAG_PLINTH = [84, 90, 102], MAG_PALE = [255, 246, 214];

// a long side: the wall is the plane u' = 0 of the frame g, facing out, from v' = va to vb; arches counted from the north
function fortMagSide(K, B, g, va, vb, dir) {
  const H = B.H, S = LMWS[3], bay = B.L / B.n, P = (u, v, y) => fortP(g, u, v, y), D = -0.38, BK = sh(MAG_BRK, 0.82), holes = [];
  for (let k = 0; k < B.n; k++) holes.push({ vc: dir * (k + 0.5) * bay, w: 1.35, ys: 1.95, ya: 3.3, sh: 'round', yb: 0.45 });
  fortWallPlane(K.brk, g, 0, 1, Math.min(va, vb), Math.max(va, vb), -0.3, H - 0.35, holes, S, MAG_BRK);
  for (const o of holes) {
    const a = o.vc - o.w, b = o.vc + o.w;
    fortWallPlane(K.brk, g, D, 1, a, b, o.yb, o.ya, [], S, BK);                                              // back of the recess
    fortArchRing(K.brk, g, 0, D, 1, o, o, S, BK, 14);
    for (const s of [-1, 1]) fortTBox(K.brk, g, D, 0, o.vc + s * o.w, o.vc + s * o.w, o.yb, o.ys, S, BK, s < 0 ? 's' : 'n');
    fortTBox(K.brk, g, D, 0, a, b, o.yb, o.yb, S, sh(MAG_BRK, 0.9), 't');
    polyA(K.cap, [P(D + 0.01, o.vc - 0.13, 1.7), P(D + 0.01, o.vc + 0.13, 1.7), P(D + 0.01, o.vc + 0.13, 2.55), P(D + 0.01, o.vc - 0.13, 2.55)], hb('#2a2b2c'), g[2], 0, g[3]);   // slit vent
  }
  const v0 = Math.min(va, vb), v1 = Math.max(va, vb);
  fortTBox(K.brk, g, 0, 0.1, v0, v1, -0.3, 0.45, S, sh(MAG_BRK, 0.9), 'et');                                   // plinth
  fortTBox(K.brk, g, 0, 0.1, v0, v1, H - 0.35, H - 0.2, S, sh(MAG_BRK, 0.95), 'etb');                          // corbelled eave
  fortTBox(K.brk, g, 0, 0.22, v0, v1, H - 0.2, H, S, sh(MAG_BRK, 0.92), 'etb');
  for (let k = 3; k < B.n; k += 4) { const v = dir * k * bay; lmBar(K.cap, P(0.3, v, 0.15), P(0.3, v, H - 0.05), 0.1, hb('#8d9296')); }   // downpipes
  COL.add(...lmW(g, 0.15, v0), ...lmW(g, 0.15, v1), 0.2, 0);
}
// a pointed arch (fortArchY's shape) as two arcs: the point a share l of the way from the springing (0) to the crown (1)
// on the left (s = −1) or the right arc, and the outward normal there
function fortPointedArc(h, s, l) {
  const H = h.ya - h.ys, R = (h.w * h.w + H * H) / (2 * h.w), span = Math.PI - Math.acos((h.w - R) / R);
  const cv = h.vc - s * (R - h.w), th = s < 0 ? Math.PI - l * span : l * span;   // the left arc turns about a centre right of the middle
  return [cv + R * Math.cos(th), h.ys + R * Math.sin(th), Math.cos(th), Math.sin(th)];
}
// a stone block proud of a gable at u = up (facing out = ±1), given by its four corners (v, y) on the wall
function fortProud(B2, f, up, out, Q, d, col) {
  let a = 0; for (let i = 0; i < 4; i++) { const A = Q[i], C = Q[(i + 1) % 4]; a += A[0] * C[1] - C[0] * A[1]; } if (a < 0) Q = Q.slice().reverse();   // counter-clockwise in (v, y)
  const P = (q, dd) => fortP(f, up + out * dd, q[0], q[1]), N = [f[2] * out, 0, f[3] * out];
  B2.q(P(Q[0], d), P(Q[1], d), P(Q[2], d), P(Q[3], d), N, [0, 0, 1, 0, 1, 1, 0, 1].map(t => t * 0.5), col);
  for (let i = 0; i < 4; i++) {
    const A = Q[i], C = Q[(i + 1) % 4], ev = C[0] - A[0], ey = C[1] - A[1], l = Math.hypot(ev, ey) || 1, nv = ey / l, ny = -ev / l, w = lmW(f, 0, nv), w0 = lmW(f, 0, 0);
    B2.q(P(A, 0), P(C, 0), P(C, d), P(A, d), [w[0] - w0[0], ny, w[1] - w0[1]], [0, 0, 1, 0, 1, 1, 0, 1].map(t => t * 0.3), sh(col, 0.9));
  }
}
// a round window: dark glass and a ring
function fortOculus(K, f, up, out, vc, yc, r, ringCol, ringB) {
  const n = 14, P = (rr, a, d) => fortP(f, up + out * d, vc + rr * Math.cos(a), yc + rr * Math.sin(a)), glass = [];
  for (let i = 0; i < n; i++) glass.push(P(r, 2 * Math.PI * i / n, 0.02));
  polyA(K.cap, glass, hb('#2c3034'), f[2] * out, 0, f[3] * out);
  for (let i = 0; i < n; i++) { const a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n;
    ringB.q(P(r, a0, 0.06), P(r, a1, 0.06), P(r + 0.2, a1, 0.06), P(r + 0.2, a0, 0.06), [f[2] * out, 0, f[3] * out], [0, 0, 0.3, 0, 0.3, 0.3, 0, 0.3], ringCol); }
}
// the north gable: ochre render, white quoins and voussoirs, the pointed door
function fortMagNorth(K, B) {
  const f = B.f, W = B.W, H = B.H, C = -W / 2, RID = H + W / 2 * B.pitch, up = 0, out = -1, S = LMWS[1], P = (u, v, y) => fortP(f, u, v, y);
  const door = { vc: C, w: 1.2, ys: 2.55, ya: 4.3, sh: 'pointed', yb: 0 };
  const niches = [-1, 1].map(s => ({ vc: C + s * 4.75, w: 1.0, ys: 2.95, ya: 4.35, sh: 'pointed', yb: 1.65 }));
  fortWallPlane(K.ren, f, up, out, -W, 0, -0.3, 1.6, [door], S, MAG_PLINTH);
  fortWallPlane(K.ren, f, up, out, -W, 0, 1.6, H, [door, ...niches], S, MAG_OCH);
  K.ren.q(P(up, -W, H), P(up, 0, H), P(up, C, RID), P(up, C, RID), [f[2] * out, 0, f[3] * out], [0, H / S, W / S, H / S, W / 2 / S, RID / S, W / 2 / S, RID / S], MAG_OCH);
  // the door, set back in white reveals
  fortArchRing(K.ren, f, up, 0.4, out, door, door, S, MAG_WH, 14);
  for (const s of [-1, 1]) fortTBox(K.ren, f, 0, 0.4, door.vc + s * door.w, door.vc + s * door.w, 0, door.ys, S, MAG_WH, s < 0 ? 's' : 'n');
  fortTile(K.det, f, 0.39, out, door.vc - door.w, door.vc + door.w, 0, door.ya, FTT.door);
  // lancet niches, a small window in each
  for (const o of niches) {
    fortWallPlane(K.ren, f, 0.14, out, o.vc - o.w, o.vc + o.w, o.yb, o.ya, [], S, sh(MAG_OCH, 0.93));
    fortArchRing(K.ren, f, up, 0.14, out, o, o, S, sh(MAG_OCH, 0.85), 12);
    for (const s of [-1, 1]) fortTBox(K.ren, f, 0, 0.14, o.vc + s * o.w, o.vc + s * o.w, o.yb, o.ys, S, sh(MAG_OCH, 0.85), s < 0 ? 's' : 'n');
    fortTBox(K.ren, f, 0, 0.14, o.vc - o.w, o.vc + o.w, o.yb, o.yb, S, sh(MAG_OCH, 0.95), 't');
    for (const dv of [-0.45, 0.45]) polyA(K.cap, [P(0.13, o.vc + dv - 0.17, 1.8), P(0.13, o.vc + dv + 0.17, 1.8), P(0.13, o.vc + dv + 0.17, 2.75), P(0.13, o.vc + dv - 0.17, 2.75)], hb('#2a2c2e'), -f[2], 0, -f[3]);
  }
  // the fan of white voussoirs, long and short in turn, piers of blocks under it down to the ground and a keystone
  const fan = { vc: C, w: 2.75, ys: 1.95, ya: 6.55, sh: 'pointed' }, nb = 8, gap = 0.012;
  for (const s of [-1, 1]) for (let k = 0; k < nb; k++) {
    const A = fortPointedArc(fan, s, k / nb * 0.94 + gap), Bq = fortPointedArc(fan, s, (k + 1) / nb * 0.94 - gap), len = k % 2 ? 1.05 : 0.62;
    fortProud(K.ren, f, up, out, [[A[0], A[1]], [Bq[0], Bq[1]], [Bq[0] + Bq[2] * len, Bq[1] + Bq[3] * len], [A[0] + A[2] * len, A[1] + A[3] * len]], 0.1, MAG_WH);
  }
  const crown = fortPointedArc(fan, -1, 0.94), cr2 = fortPointedArc(fan, 1, 0.94);
  fortProud(K.ren, f, up, out, [[crown[0], crown[1]], [cr2[0], cr2[1]], [C + 0.45, fan.ya + 1.2], [C - 0.45, fan.ya + 1.2]], 0.12, MAG_WH);
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    const y0 = k * 0.49, y1 = y0 + 0.45, w = k % 2 ? 1.05 : 0.62, v0 = C + s * fan.w, v1 = C + s * (fan.w + w);
    fortProud(K.ren, f, up, out, s < 0 ? [[v1, y0], [v0, y0], [v0, y1], [v1, y1]] : [[v0, y0], [v1, y0], [v1, y1], [v0, y1]], 0.1, MAG_WH);
  }
  fortOculus(K, f, up, out, C, 5.15, 0.42, MAG_WH, K.ren);
  // rusticated quoins at both corners, white returns of the cornice and the raking cornice
  for (const [ea, eb] of [[-W, -W + 1], [0, -1]]) for (let k = 0; k * 0.58 < H - 0.3; k++) {
    const y0 = k * 0.58 + 0.03, y1 = Math.min(H, y0 + 0.52), w = k % 2 ? 0.62 : 1.0, va = ea, vb = ea + Math.sign(eb - ea) * w;
    fortTBox(K.ren, f, -0.07, 0, Math.min(va, vb), Math.max(va, vb), y0, y1, S, MAG_WH, 'wnstb');
  }
  const RC = 0.28, sl = B.pitch, rak = (s) => { const vE = s < 0 ? -W - 0.25 : 0.25, yE = H - 0.25 * sl;
    const Q = [[vE, yE - RC], [C, RID - RC + 0.05], [C, RID + 0.05], [vE, yE]];
    K.ren.q(P(-0.3, Q[0][0], Q[0][1]), P(-0.3, Q[1][0], Q[1][1]), P(-0.3, Q[2][0], Q[2][1]), P(-0.3, Q[3][0], Q[3][1]), [-f[2], 0, -f[3]], [0, 0, 1, 0, 1, 0.2, 0, 0.2], MAG_WH);
    K.ren.q(P(-0.3, Q[0][0], Q[0][1]), P(-0.3, Q[1][0], Q[1][1]), P(0, Q[1][0], Q[1][1]), P(0, Q[0][0], Q[0][1]), [0, -1, 0], [0, 0, 1, 0, 1, 0.2, 0, 0.2], sh(MAG_WH, 0.85)); };
  rak(-1); rak(1);
  COL.add(...lmW(f, -0.15, -W), ...lmW(f, -0.15, door.vc - door.w), 0.2, 0); COL.add(...lmW(f, -0.15, door.vc + door.w), ...lmW(f, -0.15, 0), 0.2, 0);
}
// the south gable: red brick with three lancet niches and a round window, paler brick above
function fortMagSouth(K, B) {
  const f = B.f, W = B.W, H = B.H, L = B.L, C = -W / 2, RID = H + W / 2 * B.pitch, out = 1, S = LMWS[3], P = (u, v, y) => fortP(f, u, v, y), BK = sh(MAG_BRK, 0.84);
  const niches = [{ vc: C, w: 1.2, ys: 2.75, ya: 4.25, sh: 'pointed', yb: 0.55 }, ...[-1, 1].map(s => ({ vc: C + s * 4.9, w: 1.05, ys: 2.55, ya: 3.95, sh: 'pointed', yb: 0.55 }))];
  fortWallPlane(K.brk, f, L, out, -W, 0, -0.3, H, niches, S, MAG_BRK);
  K.brk.q(P(L, -W, H), P(L, 0, H), P(L, C, RID), P(L, C, RID), [f[2], 0, f[3]], [0, H / S, W / S, H / S, W / 2 / S, RID / S, W / 2 / S, RID / S], MAG_PALE);
  for (const o of niches) {
    fortWallPlane(K.brk, f, L - 0.25, out, o.vc - o.w, o.vc + o.w, o.yb, o.ya, [], S, BK);
    fortArchRing(K.brk, f, L, L - 0.25, out, o, o, S, BK, 12);
    for (const s of [-1, 1]) fortTBox(K.brk, f, L - 0.25, L, o.vc + s * o.w, o.vc + s * o.w, o.yb, o.ys, S, BK, s < 0 ? 's' : 'n');
    fortTBox(K.brk, f, L - 0.25, L, o.vc - o.w, o.vc + o.w, o.yb, o.yb, S, sh(MAG_BRK, 0.92), 't');
    const dv = o.vc === C ? 0 : 0.55 * Math.sign(o.vc - C);
    polyA(K.cap, [P(L - 0.24, o.vc + dv - 0.15, 0.9), P(L - 0.24, o.vc + dv + 0.15, 0.9), P(L - 0.24, o.vc + dv + 0.15, 1.85), P(L - 0.24, o.vc + dv - 0.15, 1.85)], hb('#2a2c2e'), f[2], 0, f[3]);
  }
  fortOculus(K, f, L, out, C, 5.0, 0.35, BK, K.brk);
  polyA(K.cap, [P(L + 0.02, C - 0.35, 6.75), P(L + 0.02, C + 0.35, 6.75), P(L + 0.02, C + 0.35, 7.4), P(L + 0.02, C - 0.35, 7.4)], hb('#262728'), f[2], 0, f[3]);
  for (const [a, b] of [[-W, -W + 0.6], [-0.6, 0]]) fortTBox(K.brk, f, L, L + 0.15, a, b, -0.3, H, S, sh(MAG_BRK, 0.95), 'enst');   // corner pilasters
  COL.add(...lmW(f, L + 0.2, -W), ...lmW(f, L + 0.2, 0), 0.2, 0);
}
// the roof: two slopes of standing-seam steel over the long walls, overhanging the gables a little, a ridge cap
function fortMagRoof(K, B) {
  const f = B.f, W = B.W, H = B.H, L = B.L, C = -W / 2, sl = B.pitch, RID = H + W / 2 * sl, oe = 0.45, og = 0.35, S = FTS[4], RF = [206, 209, 212], P = (u, v, y) => fortP(f, u, v, y);
  const vx = -f[3], vz = f[2], nrm = (a, b) => { const l = Math.hypot(a, 1, b); return [a / l, 1 / l, b / l]; }, slope = Math.hypot(W / 2 + oe, (W / 2 + oe) * sl);
  for (const s of [1, -1]) {
    const vE = s > 0 ? oe : -W - oe, yE = H - oe * sl, A = P(-og, vE, yE), Bq = P(L + og, vE, yE), Cq = P(L + og, C, RID), D = P(-og, C, RID);
    K.roof.q(A, Bq, Cq, D, nrm(s * vx * sl, s * vz * sl), [0, 0, (L + 2 * og) / S, 0, (L + 2 * og) / S, slope / S, 0, slope / S], RF);
    polyA(K.cap, [P(-og, vE, yE - 0.02), P(L + og, vE, yE - 0.02), P(L + og, s > 0 ? 0 : -W, H - 0.02), P(-og, s > 0 ? 0 : -W, H - 0.02)], hb('#cfcbc2'), 0, -1, 0);   // soffit
    polyA(K.cap, [P(-og, vE, yE - 0.18), P(L + og, vE, yE - 0.18), P(L + og, vE, yE), P(-og, vE, yE)], hb('#9ea3a7'), s * vx, 0, s * vz);                          // fascia
    for (const u of [-og, L + og]) polyA(K.cap, [P(u, vE, yE - 0.18), P(u, C, RID - 0.18), P(u, C, RID), P(u, vE, yE)], hb('#9ea3a7'), u < 0 ? -f[2] : f[2], 0, u < 0 ? -f[3] : f[3]);   // barge boards
  }
  lmBar(K.cap, P(-og, C, RID + 0.04), P(L + og, C, RID + 0.04), 0.2, hb('#b4b8bb'));
}
function fortMagazines(K) {
  for (const B of FORT_MAG) {
    const f = B.f, ex = f[2], ez = f[3];
    // the west wall (v = 0, facing +v; along it v' = −u) and the east one (v = −W, facing −v; v' = u)
    fortMagSide(K, B, [...lmW(f, 0, 0), -ez, ex], -B.L, 0, -1);
    fortMagSide(K, B, [...lmW(f, 0, -B.W), ez, -ex], 0, B.L, 1);
    fortMagNorth(K, B); fortMagSouth(K, B); fortMagRoof(K, B);
  }
}

export { FORT_MAG, fortMagazines };
