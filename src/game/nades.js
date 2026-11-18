import * as THREE from 'three';
import { buildingAt } from '../world/data.js';
import { terrainH } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { prop, onProps } from './props.js';

/* ---------- grenades ----------
   The server flies every grenade and says where and when it goes off (server/index.mjs, damage and all). Each page
   also flies its own copy of it, with the same rules (keep NADE and the step in step with server/world.mjs), so that
   it moves smoothly; at the blast the copy is put where the server's grenade was. */
const NADE = { g: 18 };
const list = new Map(), blasts = [];
const GEO = new THREE.SphereGeometry(0.1, 10, 8), MAT = worldSpace(new THREE.MeshLambertMaterial({ color: 0x3d5a2a }));
function stepNade(n, dt) {
  const [px, py, pz] = n.p; n.v[1] -= NADE.g * dt;
  let x = px + n.v[0] * dt, y = py + n.v[1] * dt, z = pz + n.v[2] * dt;
  const b = buildingAt(x, z), gr = terrainH(x, z);
  if (b) {
    const top = gr + (b.top || 12);
    if (py >= top - 0.05) { if (y < top + 0.1) { y = top + 0.1; if (n.v[1] < 0) n.v[1] *= -0.35; n.v[0] *= 0.8; n.v[2] *= 0.8; } }
    else if (!buildingAt(px, z)) { x = px; n.v[0] *= -0.4; } else if (!buildingAt(x, pz)) { z = pz; n.v[2] *= -0.4; } else { x = px; z = pz; n.v[0] *= -0.4; n.v[2] *= -0.4; }
  } else if (y < gr + 0.12) { y = gr + 0.12; if (n.v[1] < 0) n.v[1] *= -0.4; n.v[0] *= 0.7; n.v[2] *= 0.7; if (Math.abs(n.v[1]) < 0.8) n.v[1] = 0; }
  n.p = [x, y, z];
}
/* модель гранаты посажена дном в ноль (так она стоит на карте); в полёте центруем её вокруг точки сервера */
function flyNade() {
  const m = prop('nade'); if (!m) return null;
  for (const c of m.children) c.position.y -= 0.1;
  return m;
}
function addNade(m) {
  const model = flyNade();
  const mesh = model || new THREE.Mesh(GEO, MAT); mesh.position.set(m.p[0], m.p[1], m.p[2]); scene.add(mesh);
  list.set(m.id, { mesh, model: !!model, p: m.p.slice(), v: m.v.slice(), age: 0 });
}
onProps(() => {
  for (const n of list.values()) if (!n.model) {
    const m = flyNade(); if (!m) continue;
    m.position.copy(n.mesh.position); m.rotation.copy(n.mesh.rotation);
    scene.remove(n.mesh); n.mesh = m; n.model = true;
  }
});
// the blast: a fireball that swells and fades, and a flash of smoke
function boomNade(m) {
  const n = list.get(m.id); if (n) { scene.remove(n.mesh); list.delete(m.id); }
  const mat = worldSpace(new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.95, fog: false })), mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
  mesh.position.set(m.x, m.y + 0.5, m.z); scene.add(mesh); blasts.push({ mesh, t: 0 });
}
function tickNades(dt) {
  for (const [id, n] of list) {
    for (let t = 0; t < dt; t += 1 / 30) stepNade(n, Math.min(1 / 30, dt - t));
    n.mesh.position.set(n.p[0], n.p[1], n.p[2]); n.mesh.rotation.x += dt * 6; n.age += dt;
    if (n.age > 4) { scene.remove(n.mesh); list.delete(id); }   // the server's blast message got lost
  }
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i]; b.t += dt; const k = b.t / 0.45; b.mesh.scale.setScalar(1 + 7 * Math.min(1, k)); b.mesh.material.opacity = Math.max(0, 0.95 * (1 - k));
    b.mesh.material.color.setHex(k < 0.35 ? 0xffd070 : 0xd8501c);
    if (b.t > 0.45) { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); blasts.splice(i, 1); }
  }
}
function clearNades() { for (const n of list.values()) scene.remove(n.mesh); list.clear(); }

export { addNade, boomNade, clearNades, tickNades };
