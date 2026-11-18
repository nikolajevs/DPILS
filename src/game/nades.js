import * as THREE from 'three';
import { buildingAt } from '../world/data.js';
import { terrainH } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { prop, onProps } from './props.js';

/* ---------- grenades ----------
   The server flies every grenade and says where and when it goes off (server/game.mjs, damage and all). Each page
   also flies its own copy of it, with the same rules (keep NADE and the step in step with server/combat.mjs and
   server/physics.mjs), so that it moves smoothly; at the blast the copy is put where the server's grenade was. */
const NADE = { g: 18 };
// the charged throw (keep server/combat.mjs NADE in step): the left mouse button held down gathers the speed from min
// to max over chargeMs; loft lifts the velocity a little above the aim, exactly as the server does
const NADE_THROW = { min: 6, max: 24, loft: 0.17, chargeMs: 1100 };
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
const blastMat = () => worldSpace(new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.95, fog: false }));
function boomNade(m) {
  const n = list.get(m.id); if (n) { scene.remove(n.mesh); list.delete(m.id); }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), blastMat());
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

/* ---------- the arc of the aimed throw ----------
   The same flight the server will fly (stepNade above is the server's physics.mjs), stepped ahead from the hand to the
   first touch of ground, roof or wall — or to the fuse, if it bursts in the air. A dashed line shows the arc, a ring
   marks the spot. Shown while the grenade is in hand (G), grown by the charge of the left mouse button. */
function predictNade(p, v, maxT = 2.5) {
  const n = { p: p.slice(), v: v.slice() }, pts = [n.p.slice()], dt = 1 / 30;
  let hit = null;
  for (let t = 0; t < maxT; t += dt) {
    const v0 = n.v.slice();
    stepNade(n, dt);
    pts.push(n.p.slice());
    // a bounce changes the velocity beyond gravity alone: the arc ends at the first touch
    if (Math.abs(n.v[0] - v0[0]) > 1e-9 || Math.abs(n.v[2] - v0[2]) > 1e-9 || n.v[1] > v0[1] - NADE.g * dt + 1e-9) { hit = n.p.slice(); break; }
  }
  return { pts, hit: hit || pts[pts.length - 1] };
}
const PRE_N = 96;
const preGeo = new THREE.BufferGeometry();
preGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRE_N * 3), 3));
const preLine = new THREE.Line(preGeo, worldSpace(new THREE.LineDashedMaterial({ color: 0xffc24d, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: 1 })));
preLine.visible = false; preLine.frustumCulled = false; scene.add(preLine);
const preRing = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 24), worldSpace(new THREE.MeshBasicMaterial({ color: 0xffc24d, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })));
preRing.rotation.x = -Math.PI / 2; preRing.visible = false; preRing.frustumCulled = false; scene.add(preRing);
function showNadePreview(p, v) {
  const { pts, hit } = predictNade(p, v), attr = preGeo.attributes.position, n = Math.min(PRE_N, pts.length);
  for (let i = 0; i < n; i++) attr.setXYZ(i, pts[i][0], pts[i][1], pts[i][2]);
  attr.needsUpdate = true; preGeo.setDrawRange(0, n); preLine.computeLineDistances(); preLine.visible = true;
  preRing.position.set(hit[0], hit[1] + 0.06, hit[2]); preRing.visible = true;
}
function hideNadePreview() { preLine.visible = false; preRing.visible = false; }

// a flying grenade (the ready model, or the ball while it has not come) and a blast, out of the scene, for the warm-up (mp.js loadModels)
const nadeSamples = () => [flyNade() || new THREE.Mesh(GEO, MAT), new THREE.Mesh(GEO, blastMat())];

export { nadeSamples, addNade, boomNade, clearNades, tickNades, NADE_THROW, showNadePreview, hideNadePreview };
