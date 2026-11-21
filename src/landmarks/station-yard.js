import * as THREE from 'three';
import { lmBar } from './helpers.js';
import { band, flatPlain, vband } from '../buildings/walls.js';
import { COL, ROAD } from '../world/data.js';
import { hook, scene } from '../render/renderer.js';
import { GB, box, lathe } from '../core/geometry.js';
import { area2, hb, offsetRing, reversed, sh } from '../core/util.js';
import { addLight } from '../world/lamp-light.js';

/* ---- the railway station round its tracks (trains.js, from OpenStreetMap; the main platform is lmStation's) ----
   - the island platforms: low (0.35 m, as the main one), asphalt with a white edge, lamp posts every 30 m and benches;
   - the footbridge over the tracks south-west of the station: a steel deck 6.8 m over the ground on piers that keep off
     the tracks, parapets, and its steps as mapped, from their foot up to the deck;
   - the pedestrian crossings over the tracks: rubber panels between and beside the rails; the level crossings: wider
     panels, a striped half barrier standing up at each side and a pair of red lamps;
   - the signals, as mapped (which way they face, on which side): the exit signals on 5 m masts with three lamps, red lit;
     the shunting signals low by the track, blue lit. Their lamps are lit day and night;
   - the buffer stops at the ends of the sidings, facing along the track. */
function lmStationYard(K) {
  const S = window.TRAINS && window.TRAINS.S; if (!S) return;
  const G = K.plain, LAMP = new GB(false);
  const ASPH = hb('#727375'), EDGE = hb('#8c8b87'), WHITE = hb('#e8e6df'), STEEL = hb('#5c6266'), DARK = hb('#2a2d30'), RUBBER = hb('#3a3b3d'), RED = hb('#c8312a'), YEL = hb('#e2c13c');
  const ringOf = a => { let r = Float32Array.from(a); if (area2(r) < 0) r = reversed(r); return r; };
  // the platforms
  for (const a of S.platforms) {
    const r = ringOf(a); flatPlain(G, [r], 0.35, ASPH, false); vband(G, r, 0, 0.35, EDGE);
    const q = offsetRing(r, -0.35); if (q) band(G, r, q, 0.36, WHITE, false);
    // along its long axis: the lamp posts and benches down the middle
    let bx = 0, bz = 0, n = r.length >> 1; for (let i = 0; i < n; i++) { bx += r[2 * i] / n; bz += r[2 * i + 1] / n; }
    let L = 0, ux = 1, uz = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = r[2 * j] - r[2 * i], dz = r[2 * j + 1] - r[2 * i + 1], l = Math.hypot(dx, dz); if (l > L) { L = l; ux = dx / l; uz = dz / l; } }
    for (let s = -L / 2 + 10; s <= L / 2 - 10; s += 30) { const x = bx + ux * s, z = bz + uz * s;
      lathe(G, x, z, 0.35, [[0.09, 0], [0.07, 0.3], [0.05, 4.2]], 6, 0, STEEL); box(G, x + ux * 0.4, z + uz * 0.4, ux, uz, 0.5, 0.12, 4.15, 4.3, DARK);
      box(K.globe, x + ux * 0.75, z + uz * 0.75, ux, uz, 0.16, 0.08, 4.05, 4.15, WHITE, false); addLight(x + ux * 0.75, 4.0, z + uz * 0.75, 1);
      box(G, x + ux * 8, z + uz * 8, ux, uz, 0.9, 0.22, 0.75, 0.8, hb('#7a5a40')); box(G, x + ux * 8 - uz * 0.2, z + uz * 8 + ux * 0.2, ux, uz, 0.9, 0.03, 0.8, 1.2, hb('#7a5a40'));
      COL.add(x, z, x + 0.01, z, 0.12, 0); }
  }
  // the footbridge: its deck and piers; then the steps from their foot up to it
  const H = 6.8, onTrack = (x, z) => { let on = false; ROAD.near(x, z, 6, (id, d) => { if (d < 2.6 && ROAD.s[id * 6 + 4] >= 1.8 && ROAD.s[id * 6 + 4] <= 2.0) on = true; }); return on; };
  for (const d of S.bridges) for (let i = 0; i + 3 < d.length; i += 2) {
    const ax = d[i], az = d[i + 1], bx2 = d[i + 2], bz2 = d[i + 3], L = Math.hypot(bx2 - ax, bz2 - az); if (L < 1) continue; const ux = (bx2 - ax) / L, uz = (bz2 - az) / L, cx = (ax + bx2) / 2, cz = (az + bz2) / 2;
    box(G, cx, cz, ux, uz, L / 2, 1.3, H - 0.55, H, STEEL); box(G, cx, cz, ux, uz, L / 2, 1.2, H, H + 0.05, hb('#6e6f70'));
    for (const s of [-1, 1]) { box(G, cx - uz * s * 1.25, cz + ux * s * 1.25, ux, uz, L / 2, 0.04, H, H + 1.15, STEEL); box(G, cx - uz * s * 1.25, cz + ux * s * 1.25, ux, uz, L / 2, 0.07, H + 1.1, H + 1.2, DARK); }
    for (let s = 0; s <= L; s += Math.max(6, L / Math.ceil(L / 14))) { const x = ax + ux * s, z = az + uz * s; if (onTrack(x, z)) continue; for (const k of [-1, 1]) lathe(G, x - uz * k * 0.9, z + ux * k * 0.9, 0, [[0.16, 0], [0.16, H - 0.55]], 8, 0, STEEL); }
  }
  for (const st of S.steps) {
    const fx = st[0], fz = st[1], tx = st[st.length - 2], tz = st[st.length - 1], L = Math.hypot(tx - fx, tz - fz); if (L < 1) continue; const ux = (tx - fx) / L, uz = (tz - fz) / L, n = Math.max(4, Math.round(H / 0.17));
    for (let k = 0; k < n; k++) { const s0 = L * k / n, s1 = L * (k + 1) / n, x = fx + ux * (s0 + s1) / 2, z = fz + uz * (s0 + s1) / 2; box(G, x, z, ux, uz, (s1 - s0) / 2, 1.1, H * k / n - 0.15, H * (k + 1) / n, sh(hb('#8f8a84'), 0.96 + (k % 2) * 0.05), true); }
    for (const s of [-1, 1]) lmBar(G, [fx - uz * s * 1.15, 1.0, fz + ux * s * 1.15], [tx - uz * s * 1.15, H + 1.0, tz + ux * s * 1.15], 0.05, DARK);
    COL.add(fx, fz, tx, tz, 1.1, 0);
  }
  // crossings over the tracks: between and beside the rails, at the height of their heads
  for (const [x, z, dx, dz] of S.crossings) box(G, x, z, -dz, dx, 1.35, 1.5, 0.12, 0.19, RUBBER);
  for (const [x, z, dx, dz] of S.level) {
    box(G, x, z, -dz, dx, 1.4, 3.6, 0.12, 0.19, RUBBER);
    for (const s of [-1, 1]) { const px = x - dz * s * 4.2 + dx * s * 4.2, pz = z + dx * s * 4.2 + dz * s * 4.2;   // a half barrier standing up on the right of the road
      lathe(G, px, pz, 0, [[0.11, 0], [0.09, 1.1]], 8, 0, WHITE); box(G, px, pz, dx, dz, 0.18, 0.18, 0.9, 1.25, DARK);
      for (let k = 0; k < 8; k++) box(G, px, pz, dx, dz, 0.05, 0.05, 1.25 + k * 0.5, 1.75 + k * 0.5, k % 2 ? WHITE : RED);
      const lx = px - dz * s * 0.8, lz = pz + dx * s * 0.8; lathe(G, lx, lz, 0, [[0.06, 0], [0.06, 2.6]], 6, 0, STEEL); box(G, lx, lz, dx, dz, 0.55, 0.05, 2.3, 2.75, DARK);
      for (const o of [-0.3, 0.3]) box(LAMP, lx + dx * o - dz * s * 0.06, lz + dz * o + dx * s * 0.06, dx, dz, 0.1, 0.02, 2.45, 2.6, hb('#ff3a22'), false); }
  }
  // the signals: facing the trains they stand for, on the side mapped, 2.4 m off the track
  for (const [x, z, dx, dz, side, kind] of S.signals) {
    const rx = -dz * side, rz = dx * side, px = x + rx * 2.4, pz = z + rz * 2.4, fx = -dx, fz = -dz;   // the face looks back along the track
    if (kind === 0) { lathe(G, px, pz, 0, [[0.12, 0], [0.09, 0.4], [0.07, 5.0]], 8, 0, STEEL); box(G, px, pz, dx, dz, 0.12, 0.3, 3.7, 5.2, DARK);
      for (const [y, c] of [[4.85, hb('#ff2a18')], [4.45, hb('#2c3a30')], [4.05, hb('#3a3424')]]) box(LAMP, px + fx * 0.13, pz + fz * 0.13, dx, dz, 0.01, 0.1, y - 0.1, y + 0.1, c, false);
      box(G, px + fx * 0.06, pz + fz * 0.06, dx, dz, 0.02, 0.4, 3.65, 5.25, hb('#e8e6df')); }
    else { box(G, px, pz, dx, dz, 0.15, 0.2, 0, 0.5, STEEL); box(G, px, pz, dx, dz, 0.12, 0.25, 0.5, 1.05, DARK);
      for (const [y, c] of [[0.88, hb('#3a6cff')], [0.66, hb('#3a3d44')]]) box(LAMP, px + fx * 0.13, pz + fz * 0.13, dx, dz, 0.01, 0.08, y - 0.08, y + 0.08, c, false); }
  }
  // the buffer stops: a steel frame with two buffers, facing along the track, its back at the end of the rails
  for (const [x, z, dx, dz] of S.buffers) { const cx = x - dx * 1.2, cz = z - dz * 1.2;
    box(G, cx, cz, dx, dz, 0.9, 1.3, 0, 1.15, STEEL); box(G, cx - dx * 0.95, cz - dz * 0.95, dx, dz, 0.08, 1.45, 0.75, 1.35, RED);
    for (const s of [-0.85, 0.85]) box(G, cx - dx * 1.15 - dz * s, cz - dz * 1.15 + dx * s, dx, dz, 0.18, 0.2, 0.85, 1.25, YEL);
    COL.add(cx - dz * 1.3, cz + dx * 1.3, cx + dz * 1.3, cz - dx * 1.3, 0.3, 0); }
  const m = LAMP.mesh(hook(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.4, 1.4, 1.4), toneMapped: true }), 'yard-lamp')); if (m) scene.add(m);
}

export { lmStationYard };
