import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P, keys } from './player.js';
import { terrainH } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { SET, keyName } from './settings.js';
import { $ } from '../core/env.js';
import { prop, onProps } from './props.js';

/* ---------- the inventory ----------
   The server owns what a player carries (server/game.mjs: magazines, reserve, grenades, med kits); this module draws
   the items that lie on the map and the panel that shows the pockets (I). mp.js passes the data and the actions through
   bindInv, so there is no circle of imports. Items are picked up by walking over them; a taken item comes back after a
   while, and the server says so ('item' / 'took' messages). */
const KINDS = {
  ammo: { name: 'Патроны', color: 0x9aa85a, hint: 'запас патронов ко всему оружию' },
  nade: { name: 'Граната', color: 0x6d8a44, hint: 'ещё одна граната' },
  med: { name: 'Аптечка', color: 0xf2f2f2, hint: 'лечит 50 HP' },
};
const items = new Map();   // id → { kind, group, baseY, active }
let cb = { useMed: () => {}, switchWeapon: () => {}, beep: () => {} };
const bindInv = f => { cb = f; };

/* ---------- the items on the map ---------- */
const GEO = { box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(0.12, 10, 8), ring: new THREE.CylinderGeometry(0.45, 0.45, 0.02, 20) };
const mat = c => worldSpace(new THREE.MeshLambertMaterial({ color: c }));
function makeMesh(kind) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.userData.body = body; g.add(body);
  fillBody(body, kind);
  const ring = new THREE.Mesh(GEO.ring, worldSpace(new THREE.MeshBasicMaterial({ color: KINDS[kind].color, transparent: true, opacity: 0.35 })));
  ring.position.y = 0.02; g.add(ring);
  g.userData.item = kind;
  return g;
}
/* готовая модель со Sketchfab (models/item_*.glb), а пока она едет — самодельный ящик из боксов */
function fillBody(body, kind) {
  const m = prop(kind);
  if (m) { body.add(m); return; }
  const box = (c, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(GEO.box, mat(c)); o.scale.set(sx, sy, sz); o.position.set(x, y, z); body.add(o); };
  if (kind === 'ammo') { box(0x4a5d23, 0.36, 0.22, 0.26, 0, 0.13, 0); box(0x3a4a1a, 0.38, 0.05, 0.28, 0, 0.265, 0); box(0xd8c34a, 0.37, 0.06, 0.05, 0, 0.15, 0.135); }
  else if (kind === 'nade') { const s = new THREE.Mesh(GEO.sph, mat(0x3d5a2a)); s.position.y = 0.16; body.add(s); box(0x777c80, 0.06, 0.08, 0.06, 0, 0.31, 0); }
  else { box(0xf2f2f2, 0.32, 0.2, 0.26, 0, 0.12, 0); box(0xd8392f, 0.2, 0.055, 0.02, 0, 0.14, 0.135); box(0xd8392f, 0.055, 0.16, 0.02, 0, 0.14, 0.135); }
}
/* материалы фолбэка свои у каждого предмета, материалы и геометрия модели — общие на все клоны */
function dropBody(body) {
  body.traverse(o => { if (o.isMesh && !o.userData.shared) o.material.dispose(); });
  body.clear();
}
onProps(() => { for (const r of items.values()) { dropBody(r.group.userData.body); fillBody(r.group.userData.body, r.kind); } });
function addItem(it) {
  const group = makeMesh(it.kind), baseY = terrainH(it.x, it.z);
  group.position.set(it.x, baseY, it.z); scene.add(group);
  items.set(it.id, { kind: it.kind, group, baseY, active: true });
}
function setItems(list) { clearItems(); for (const it of list || []) addItem(it); }
function itemBack(it) { const r = items.get(it.id); if (r) { r.active = true; r.group.visible = true; } else addItem(it); }
function itemTook(id) { const r = items.get(id); if (r) { r.active = false; r.group.visible = false; } }
function clearItems() { for (const r of items.values()) { scene.remove(r.group); r.group.traverse(o => { if (o.isMesh && !o.userData.shared) o.material.dispose(); }); } items.clear(); }
const hint = $('mpItemHint');
function tickItems(dt, now) {
  if (!STATE.mp) { if (!hint.hidden) hint.hidden = true; return; }
  let near = null, nd = 8;
  for (const [id, r] of items) {
    if (!r.active) continue;
    const d = Math.hypot(r.group.position.x - P.x, r.group.position.z - P.z);
    r.group.visible = d < 160;
    if (!r.group.visible) continue;
    r.group.rotation.y += dt * 1.1;
    r.group.position.y = r.baseY + 0.06 + (Math.sin(now * 0.002 + id) * 0.5 + 0.5) * 0.08;
    if (!STATE.mpDead && d < nd) { nd = d; near = r; }
  }
  if (near) { const t = KINDS[near.kind].name + ' · ' + Math.max(1, Math.round(nd)) + ' м — подойдите, чтобы подобрать'; if (hint.textContent !== t) hint.textContent = t; hint.hidden = false; }
  else if (!hint.hidden) hint.hidden = true;
}

/* ---------- the panel (I) ---------- */
const box = $('mpInv'), body = $('mpInvBody');
let open = false, data = null;
function build() {
  if (!data) return;
  body.textContent = '';
  const h = t => { const e = document.createElement('h3'); e.textContent = t; body.append(e); };
  h('Оружие');
  const rows = document.createElement('div'); rows.className = 'inv-rows';
  data.weapons.forEach((w, i) => {
    const r = document.createElement('button'); r.type = 'button'; r.className = 'inv-row' + (w.on ? ' on' : ''); r.title = 'Взять в руки (' + w.key + ')';
    const k = document.createElement('kbd'); k.textContent = w.key;
    const n = document.createElement('span'); n.textContent = w.name;
    const a = document.createElement('b'); a.textContent = w.mag + ' / ' + w.magSize; a.title = 'в магазине / размер магазина';
    const s = document.createElement('small'); s.textContent = 'запас ' + w.reserve; s.title = 'запас патронов';
    r.append(k, n, a, s); r.onclick = () => { cb.switchWeapon(i); build(); }; rows.append(r);
  });
  body.append(rows);
  h('Предметы');
  const its = document.createElement('div'); its.className = 'inv-rows';
  const row = (name, count, max, note, btn) => {
    const r = document.createElement('div'); r.className = 'inv-row inv-item';
    const n = document.createElement('span'); n.textContent = name;
    const c = document.createElement('b'); c.textContent = count + ' / ' + max;
    const s = document.createElement('small'); s.textContent = note;
    r.append(n, c, s); if (btn) r.append(btn); its.append(r);
  };
  row('Гранаты', data.nades, data.nadeMax, 'бросок — ' + data.nadeKey, null);
  const use = document.createElement('button'); use.type = 'button'; use.className = 'btn'; use.textContent = 'Использовать (' + data.medKey + ')';
  use.disabled = data.meds <= 0 || data.hp >= 100; use.onclick = () => cb.useMed();
  row('Аптечки', data.meds, data.medMax, 'лечит 50 HP', use);
  body.append(its);
  const note = document.createElement('small'); note.className = 'inv-note';
  note.textContent = 'Предметы лежат на карте и подбираются автоматически, когда проходишь мимо. Ящики и аптечки появляются снова через полминуты; запас патронов пополняется ящиками.';
  body.append(note);
}
function renderInv(d) { data = d; if (open) build(); }
function openInv() { if (open || !data) return; open = true; if (document.pointerLockElement) document.exitPointerLock(); keys.clear(); build(); box.hidden = false; }
function closeInv() { if (!open) return; open = false; box.hidden = true; }
const toggleInv = () => (open ? closeInv() : openInv());
const invOpen = () => open;
window.addEventListener('keydown', e => { if (e.code === 'Escape' && open) { closeInv(); e.preventDefault(); e.stopImmediatePropagation(); } }, true);
$('mpInvClose').onclick = closeInv;
box.addEventListener('click', e => { if (e.target === box) closeInv(); });

export { KINDS, bindInv, setItems, itemBack, itemTook, clearItems, tickItems, renderInv, openInv, closeInv, toggleInv, invOpen };