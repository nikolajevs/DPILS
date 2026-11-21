/* The city for the server: building outlines with heights and the ground, read from the same files the page uses
   (citydata.js, terrain.js), so the server can tell whether a wall stands in the line of fire. The ground is the raw
   20 m grid of the lidar terrain model (the page also levels the fortress, the speedway and the railway, a few metres
   at most): the check below leaves a metre of margin for that.
   The holes of a footprint are open as in the page: closed courtyards (the inner rings of the data) and the
   through-passages (проезды) whose openings a model cuts, both from src/buildings/passage-holes.mjs — the very list the
   page's buildingAt uses, so online a bullet, a grenade and a bot pass a courtyard or a passage as in the training game. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePhysics } from './physics.mjs';
import { footprintHoles } from '../src/buildings/passage-holes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const cell = (x, z) => (Math.floor(x / 60) + 2000) * 4096 + Math.floor(z / 60) + 2000;
function pip(x, z, r) { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
// a ring of the data: deltas in decimetres → absolute metres (src/core/util.js dec)
function dec(a) { const o = new Float32Array(a.length); let x = 0, z = 0; for (let i = 0; i + 1 < a.length; i += 2) { x += a[i]; z += a[i + 1]; o[i] = x / 10; o[i + 1] = z / 10; } return o; }

export function loadWorld() {
  const t0 = Date.now(), cs = read('citydata.js'), C = JSON.parse(cs.slice(cs.indexOf('=') + 1).replace(/;\s*$/, ''));
  const B = [], grid = new Map(); let nHoles = 0;
  for (let id = 0; id < C.b.length; id++) {
    const rec = C.b[id], rings = rec.slice(7).filter(r => r && r.length >= 6).map(dec); if (!rings.length) continue;
    const ring = rings[0], holes = footprintHoles(id, rings); nHoles += holes.length;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
    const top = rec[1] / 10, b = { ring, bb: [x0, z0, x1, z1], top, base: rec[0] === 12 ? Math.max(0, top - 0.25) : 0, holes: holes.length ? holes : null }; B.push(b);   // style 12: a canopy on posts, open at the ground
    for (let i = Math.floor(x0 / 60); i <= Math.floor(x1 / 60); i++) for (let j = Math.floor(z0 / 60); j <= Math.floor(z1 / 60); j++) { const k = (i + 2000) * 4096 + j + 2000; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(b); }
  }
  const ts = read('terrain.js'), head = JSON.parse(ts.match(/window\.TERRAIN\s*=\s*(\{.*?\});/)[1]), hs = ts.match(/window\.TERRAIN\.h\s*=\s*'([^']*)'/)[1];
  const bin = Buffer.from(hs, 'base64'), q = new Int16Array(bin.length >> 1); for (let k = 0; k < q.length; k++) q[k] = bin.readInt16LE(2 * k);
  const raw = (x, z) => {
    let gx = (x - head.x0) / head.step, gz = (z - head.z0) / head.step; gx = Math.max(0, Math.min(head.nx - 1.001, gx)); gz = Math.max(0, Math.min(head.nz - 1.001, gz));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * head.nx + i, a = q[k], b = q[k + 1], c = q[k + head.nx], d = q[k + head.nx + 1];
    return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) * 0.1;
  };
  const ref = raw(-1487, 1263), ground = (x, z) => raw(x, z) - ref;
  // a point inside the outline but in a hole (a courtyard, a passage) is open, as in the page's buildingAt (src/world/data.js)
  function buildingAt(x, z, y = 1) { const l = grid.get(cell(x, z)); if (!l) return null; for (const b of l) { const bb = b.bb; if (x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && y >= (b.base || 0) && pip(x, z, b.ring) && !(b.holes && b.holes.some(h => pip(x, z, h)))) return b; } return null; }
  const phys = makePhysics(buildingAt, ground);
  console.log(`world: ${B.length} buildings (${nHoles} courtyards and passages open), ${q.length} ground points, ${Date.now() - t0} ms`);
  return { ...phys, ground, buildingAt, count: B.length };
}
