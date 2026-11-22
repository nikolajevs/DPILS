import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P, keys } from './player.js';
import { terrainH } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { addMover } from '../render/lamp-shadows.js';
import { $ } from '../core/env.js';
import { prop, onProps } from './props.js';
import { makePics, onPic, picUrl } from './inv-icons.js';

/* ---------- the inventory ----------
   The server owns what a player carries (server/game.mjs: magazines, reserve, grenades, med kits); this module draws
   the items that lie on the map and the panel that shows the pockets (I). mp.js passes the data and the actions through
   bindInv, so there is no circle of imports. Items are picked up by walking over them; a taken item comes back after a
   while, and the server says so ('item' / 'took' messages). */
const KINDS = {
  ammo: { name: 'Патроны', color: 0x9aa85a, hint: 'запас патронов ко всему оружию' },
  nade: { name: 'Граната', color: 0x6d8a44, hint: 'до 2 готовы к броску, излишки — в рюкзак' },
  smoke: { name: 'Дымовая граната', color: 0x9fb4c4, hint: 'дымовая завеса на 12 с · до 2 готовы, излишки — в рюкзак' },
  napalm: { name: 'Напалм', color: 0xff6a2a, hint: 'огонь на 8 с, 30 урона/с · до 2 готовы, излишки — в рюкзак' },
  med: { name: 'Аптечка', color: 0xf2f2f2, hint: 'лечит 50 HP · до 3 готовы, излишки — в рюкзак' },
  sight: { name: 'Коллиматор', color: 0xff5040, hint: 'быстрый прицел с красной точкой — хранится в рюкзаке, ставится на оружие' },
  optic: { name: 'Оптика 8x', color: 0x7fb2ff, hint: 'дальний зум с сеткой — хранится в рюкзаке, ставится на оружие' },
};
const items = new Map();   // id → { kind, group, baseY, active }
let cb = { useMed: () => {}, switchWeapon: () => {}, swap: () => {}, ready: () => {}, attach: () => {}, nade: () => {}, beep: () => {} };
const bindInv = f => { cb = f; };

/* ---------- the items on the map ---------- */
const GEO = { box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(0.12, 10, 8), ring: new THREE.CylinderGeometry(0.45, 0.45, 0.02, 20), tube: new THREE.CylinderGeometry(0.045, 0.045, 0.34, 14) };
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
  else if (kind === 'smoke' || kind === 'napalm') { const c = new THREE.Mesh(GEO.tube, mat(kind === 'napalm' ? 0x8a2a22 : 0x6a7a5a)); c.scale.set(1.6, 0.85, 1.6); c.position.y = 0.15; body.add(c); box(0x777c80, 0.07, 0.06, 0.07, 0, 0.32, 0); }
  else if (kind === 'med') { box(0xf2f2f2, 0.32, 0.2, 0.26, 0, 0.12, 0); box(0xd8392f, 0.2, 0.055, 0.02, 0, 0.14, 0.135); box(0xd8392f, 0.055, 0.16, 0.02, 0, 0.14, 0.135); }
  else if (kind === 'sight') {   // an open red dot: the base, two cheeks and a hood over a tinted window
    box(0x23262a, 0.09, 0.05, 0.12, 0, 0.03, 0); box(0x23262a, 0.02, 0.09, 0.1, -0.045, 0.1, 0); box(0x23262a, 0.02, 0.09, 0.1, 0.045, 0.1, 0); box(0x23262a, 0.11, 0.02, 0.1, 0, 0.15, 0);
    const lens = new THREE.Mesh(GEO.box, worldSpace(new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.35 })));
    lens.scale.set(0.08, 0.08, 0.005); lens.position.set(0, 0.1, 0.02); body.add(lens);
  } else {   // the long scope: a tube on two rings
    const tube = new THREE.Mesh(GEO.tube, mat(0x1d2023)); tube.rotation.x = Math.PI / 2; tube.position.y = 0.09; body.add(tube);
    box(0x1d2023, 0.05, 0.06, 0.06, 0, 0.03, -0.07); box(0x1d2023, 0.05, 0.06, 0.06, 0, 0.03, 0.07);
  }
}
/* материалы фолбэка свои у каждого предмета, материалы и геометрия модели — общие на все клоны */
function dropBody(body) {
  body.traverse(o => { if (o.isMesh && !o.userData.shared) o.material.dispose(); });
  body.clear();
}
onProps(() => { for (const r of items.values()) { dropBody(r.group.userData.body); fillBody(r.group.userData.body, r.kind); } });
function addItem(it) {
  const group = makeMesh(it.kind), baseY = terrainH(it.x, it.z);
  group.position.set(it.x, baseY, it.z); group.userData.noProbe = true; scene.add(group); addMover(group, 0.6);
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


/* ---------- the panel (I) ----------
   An inventory as in an ordinary shooter: everything the player owns lies in a slot as a picture of itself (the model,
   shot once — inv-icons.js; the SVG stands in until then). On the left the equipment: the two guns on the player, each
   with a slot for its sight, and the vest — four pockets of the ready belt (frag, smoke, napalm, med kits) with the
   count of each. On the right the backpack, a grid of cells (guns and stored items), and under it the card of the thing
   under the pointer (the gun in hand while nothing is pointed at). A click (or the right button) uses the thing: a gun
   goes to the hands (from the pack it changes places with the gun in hand), a stored med kit or grenade goes to its
   pocket, a stored sight onto the gun in hand, a mounted sight back to the pack, a med kit heals, a grenade comes to the
   hand to be thrown. A drag puts it where it is dropped: a pack gun into the chosen gun slot, a sight onto the chosen
   gun, a stored grenade into its pocket. The server owns the contents (server/game.mjs); mp.js passes them and the
   actions through bindInv. The slots are built once per opening; renderInv repaints them in place on every change,
   invTick moves the reload bar every frame. */
// silhouettes in the order of WEAPONS in mp.js: the AK, the shotgun, the SVD, the pistol, the machine gun, the M4A1, the SCAR-L, the AR-15
const SLOT_SVG = [
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="24" y="9" width="14" height="2"/><rect x="8" y="8" width="17" height="5"/><polygon points="1,9 8,8 8,13 3,14"/><polygon points="14,13 19,13 17,19 13,19"/><polygon points="20,13 23,13 22,17 19,17"/><rect x="26" y="7" width="2" height="2"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="14" y="9" width="24" height="2.5"/><rect x="18" y="11.5" width="7" height="3"/><polygon points="1,9 14,9 14,13 4,15"/><rect x="10" y="8.5" width="8" height="4"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="20" y="9.5" width="18" height="1.8"/><rect x="12" y="6" width="8" height="3"/><rect x="14" y="9" width="2" height="1.5"/><rect x="8" y="9" width="14" height="4"/><polygon points="1,9 8,9 8,14 3,15"/><rect x="14" y="13" width="4" height="4"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="10" y="7" width="18" height="5"/><polygon points="12,12 19,12 17,19 11,19"/><rect x="28" y="8" width="2" height="3"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="6" y="8" width="20" height="6"/><rect x="26" y="9" width="12" height="2.5"/><polygon points="1,9 6,8 6,14 2,15"/><rect x="12" y="14" width="8" height="5"/><rect x="10" y="6" width="8" height="2"/><path d="M30 11l-2 7M33 11l2 7" stroke="rgba(255,255,255,.62)" stroke-width="1.4" fill="none"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="25" y="9" width="13" height="2"/><rect x="9" y="8" width="17" height="5"/><rect x="4" y="9" width="6" height="2.5"/><polygon points="1,8 4,8 4,14 1,14"/><polygon points="14,13 18,13 17,19 13,19"/><polygon points="20,13 23,13 22,17 19,17"/><rect x="13" y="6" width="5" height="2"/><rect x="27" y="7" width="2" height="2"/></svg>',   // M4A1: telescoping stock, flat top with a red dot, straight magazine
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="25" y="9" width="13" height="2"/><rect x="9" y="7.5" width="17" height="5.5"/><polygon points="1,7 9,7.5 9,14 3,15"/><rect x="9" y="6" width="17" height="1.5"/><path d="M14 13h4l-1.5 6h-3z"/><polygon points="20,13 23,13 22,17 19,17"/><rect x="11" y="13" width="3" height="4"/></svg>',   // SCAR-L: the tall butt, the full-length top rail, the curved magazine
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="25" y="9" width="13" height="2"/><rect x="9" y="8" width="17" height="5"/><polygon points="1,8 9,8 9,14 2,15"/><rect x="12" y="5" width="7" height="3"/><polygon points="14,13 18,13 17,19 13,19"/><polygon points="20,13 23,13 22,17 19,17"/><rect x="27" y="7" width="2" height="2"/></svg>',   // AR-15: the fixed stock, the ACOG hump, the straight magazine
];
const ITEM_SVG = {   // stroke icons of the items (the gun silhouettes are filled)
  nade: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="14" r="7"/><path d="M10 7h4v3h-4zM14 5l3-2"/></svg>',
  smoke: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="9" width="8" height="11" rx="1.5"/><path d="M10 9V7h4v2M12 7V5"/><path d="M5 5c1-1 2-1 3 0M16 4c1-1 2-1 3 0"/></svg>',
  napalm: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="9" width="8" height="11" rx="1.5"/><path d="M10 9V7h4v2M12 7V5"/><path d="M12 12c1.6 1.4 2 2.6 0 4-2-1.4-1.6-2.6 0-4z"/></svg>',
  med: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M12 10v6M9 13h6M9 6V4h6v2"/></svg>',
  sight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18h14v2H5zM6 8h2v10H6zM16 8h2v10h-2zM6 6h12v2H6z"/><circle cx="12" cy="12" r="1.6"/></svg>',
  optic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="18" height="5" rx="2.5"/><rect x="6" y="14" width="3" height="5"/><rect x="15" y="14" width="3" height="5"/><rect x="10" y="6" width="4" height="3"/></svg>',
  '-sight': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.5"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/></svg>',   // the empty sight slot
};
// what each thing does (keep server/combat.mjs NADE, SMOKE, NAPALM, INV in step)
const ABOUT = {
  nade: 'Осколочная M67: до 100 урона в радиусе 8 м, взрыв через 2,5 с. По своим урона нет, по себе — вполовину.',
  smoke: 'Дымовая M18: завеса радиусом 6 м на 12 с — скрывает и от игроков, и от ботов. Урона нет.',
  napalm: 'Зажигательная AN-M14: огонь радиусом 4 м на 8 с, 30 урона в секунду всем, кто стоит в огне.',
  med: 'Лечит 50 HP. Между двумя аптечками — 0,8 с.',
  sight: 'Красная точка: ПКМ поднимает ствол к прицелу, разброс втрое меньше; Shift в прицеле — короткий зум.',
  optic: 'Зум 8× с сеткой: ПКМ — прицел, колесо мыши меняет кратность 4–8×; точно только стоя на месте.',
};
const SHORT = { nade: 'Граната', smoke: 'Дым', napalm: 'Напалм', med: 'Аптечка', sight: 'Коллиматор', optic: 'Оптика 8×' };
const BELT = ['nade', 'smoke', 'napalm', 'med'];
const BELT_NAME = { nade: 'Осколочная граната', smoke: 'Дымовая граната', napalm: 'Напалм', med: 'Аптечка' };
const gunTag = w => (w.pellets > 1 ? w.pellets + ' дробин за выстрел' : w.scope ? 'встроенная оптика' : w.auto ? 'автоматический огонь' : 'одиночный огонь');
const fmt1 = x => (Math.round(x * 10) / 10).toString().replace('.', ',');
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const isGun = it => !!it && typeof it.i === 'number';
const isSight = k => k === 'sight' || k === 'optic';

const box = $('mpInv'), body = $('mpInvBody'), meChip = $('mpInvMe');
let open = false, data = null, refs = null, hov = null, drag = null, eatClick = false, cardSig = '';

// the counts of the ready belt and what the player carries
const beltN = k => Math.max(0, (k === 'nade' ? data.nades : k === 'smoke' ? data.smokes : k === 'napalm' ? data.napalms : data.meds) || 0);
const beltMax = k => (k === 'med' ? data.medMax : data.nadeMax);
const beltKey = k => (k === 'nade' ? data.nadeKey : k === 'smoke' ? data.smokeKey : k === 'napalm' ? data.napalmKey : data.medKey);
const packN = k => (data.pack || []).filter(it => it && it.kind === k).length;
const allGuns = () => data.weapons.concat((data.pack || []).filter(isGun));

/* a picture in a slot: the shot model once it is ready, the SVG until then; '' empties the slot */
function setPic(el, key) {
  const url = key ? picUrl(key) : null, sig = key + (url ? '+' : '');
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig; el.dataset.pic = key;
  el.classList.toggle('gun', key[0] === 'g'); el.classList.toggle('real', !!url);
  if (!key) el.textContent = '';
  else if (url) { const im = new Image(); im.alt = ''; im.draggable = false; im.decoding = 'async'; im.src = url; el.replaceChildren(im); }
  else el.innerHTML = key[0] === 'g' ? SLOT_SVG[+key.slice(1)] : ITEM_SVG[key];
}
onPic(key => { if (!refs) return; for (const el of box.querySelectorAll('.inv-pic')) if (el.dataset.pic === key) setPic(el, key); cardSig = ''; showCard(); });

/* what lies in a slot: z is the zone ('w' a gun slot, 'att' its sight slot, 'belt' a pocket, 'pack' a backpack cell) */
function thing(z, i) {
  if (!data) return null;
  if (z === 'w' || z === 'att') { const w = data.weapons[i]; return w ? { t: z === 'w' ? 'gun' : 'att', w, s: i, kind: w.attach, where: 'w' } : null; }
  if (z === 'belt') return BELT.includes(i) ? { t: 'belt', kind: i } : null;
  if (z === 'pack') { const it = (data.pack || [])[i]; return !it ? { t: 'empty', c: i } : isGun(it) ? { t: 'gun', w: it, c: i, where: 'pack' } : { t: 'item', kind: it.kind, c: i }; }
  return null;
}
const idx = el => (el.dataset.z === 'belt' ? el.dataset.i : +el.dataset.i);

/* ---------- what a click does ---------- */
function act(z, i) {
  const x = thing(z, i); if (!x) return;
  if (x.t === 'gun') cb.switchWeapon(x.w.i);   // in hand; from the pack it changes places with the gun in hand
  else if (x.t === 'att') {
    if (x.kind) cb.attach(x.w.i, null);   // the mounted sight back to the pack
    else { const it = (data.pack || []).find(p => p && isSight(p.kind)); if (it) cb.attach(x.w.i, it.kind); }
  } else if (x.t === 'belt') {
    if (beltN(x.kind) <= 0) return;
    if (x.kind === 'med') { if (data.hp < 100) { cb.useMed(); cb.beep('med'); } }
    else cb.nade(x.kind);   // the grenade to the hand: the panel closes, the mouse aims the throw
  } else if (x.t === 'item') {
    if (isSight(x.kind)) { const held = data.weapons.find(w => w.on); if (held) cb.attach(held.i, x.kind); }
    else cb.ready(x.kind);
  }
}
/* ---------- what a drop does: the action, or null where the thing cannot go ---------- */
function dropAct(src, z, i) {
  const a = thing(src.z, src.i); if (!a || (z === src.z && i === src.i)) return null;
  if (z === 'att' && a.t === 'gun') z = 'w';   // a gun dropped on the sight slot means the gun slot
  const b = thing(z, i); if (!b) return null;
  const free = (data.pack || []).includes(null);
  if (a.t === 'gun' && a.where === 'pack' && z === 'w') return () => cb.swap(a.w.i, i);
  if (a.t === 'gun' && a.where === 'w' && b.t === 'gun' && b.where === 'pack') return () => cb.swap(b.w.i, src.i);
  if (a.t === 'item' && isSight(a.kind) && (z === 'w' || z === 'att')) { const w = data.weapons[i]; return w.attach === a.kind ? null : () => cb.attach(w.i, a.kind); }
  if (a.t === 'att' && a.kind && z === 'pack' && free) return () => cb.attach(a.w.i, null);
  if (a.t === 'att' && a.kind && (z === 'w' || z === 'att') && i !== src.i && free) { const w = data.weapons[i]; return () => { cb.attach(a.w.i, null); cb.attach(w.i, a.kind); }; }
  if (a.t === 'item' && z === 'belt' && a.kind === i && beltN(i) < beltMax(i)) return () => cb.ready(i);
  return null;
}
const canDrag = (z, i) => { const x = thing(z, i); return !!x && (x.t === 'gun' || x.t === 'item' || (x.t === 'att' && !!x.kind)); };

/* ---------- the structure: built once per opening ---------- */
function build() {
  body.textContent = '';
  const R = { w: [], belt: {}, pack: [] };
  const sec = (title, note) => {
    const s = mk('section', 'inv-sec'), h = mk('div', 'inv-head');
    h.append(mk('h3', '', title)); if (note) h.append(note); s.append(h); return s;
  };
  const slot = (tag, cls, z, i) => { const e = mk(tag, 'inv-slot ' + cls); e.dataset.z = z; e.dataset.i = i; return e; };
  // the left: the two guns on the player with their sight slots, and the ready belt
  const left = mk('div', 'inv-col inv-eq');
  const wsec = sec('Оружие', mk('small', '', 'на игроке')), ws = mk('div', 'inv-ws');
  for (let s = 0; s < 2; s++) {
    const c = slot('div', 'inv-w', 'w', s); c.setAttribute('role', 'button'); c.tabIndex = 0;
    const key = mk('kbd', 'inv-key'), hand = mk('b', 'inv-hand', 'в руках'), pic = mk('span', 'inv-pic');
    const nm = mk('b', 'inv-w-name'), ammo = mk('span', 'inv-w-ammo'), line = mk('span', 'inv-w-line'); line.append(nm, ammo);
    const mag = mk('span', 'inv-w-mag'), magF = mk('i'), rlF = mk('i', 'rl'); mag.append(magF, rlF);
    const att = slot('button', 'inv-att', 'att', s); att.type = 'button';
    const attPic = mk('span', 'inv-pic'); att.append(attPic);
    c.append(key, hand, pic, line, att, mag);
    ws.append(c);
    R.w.push({ c, key, pic, nm, ammo, magF, rlF, att, attPic });
  }
  wsec.append(ws);
  const bsec = sec('Разгрузка', mk('small', '', 'готово к бою'));
  const belt = mk('div', 'inv-belt');
  for (const k of BELT) {
    const c = slot('div', 'inv-b', 'belt', k); c.setAttribute('role', 'button'); c.tabIndex = 0; c.dataset.kind = k;
    const key = mk('kbd', 'inv-key'), pic = mk('span', 'inv-pic'), cnt = mk('b', 'inv-cnt');
    c.append(key, pic, cnt); belt.append(c);
    R.belt[k] = { c, key, pic, cnt };
  }
  bsec.append(belt);
  left.append(wsec, bsec);
  // the right: the backpack and the card of the thing under the pointer
  const right = mk('div', 'inv-col inv-bag');
  const fill = mk('small', 'inv-fill');
  const psec = sec('Рюкзак', fill);
  const grid = mk('div', 'inv-pack');
  grid.style.setProperty('--cols', Math.max(1, Math.ceil((data.pack || []).length / 3)));   // three rows: 30 cells are ten to a row
  for (let n = 0; n < (data.pack || []).length; n++) {
    const c = slot('div', 'inv-c', 'pack', n);
    const key = mk('kbd', 'inv-key'), pic = mk('span', 'inv-pic'), lbl = mk('small', 'inv-lbl');
    c.append(key, pic, lbl); grid.append(c);
    R.pack.push({ c, key, pic, lbl });
  }
  psec.append(grid);
  R.card = mk('div', 'inv-card'); R.card.setAttribute('aria-live', 'polite');
  R.fill = fill;
  right.append(psec, R.card);
  R.help = mk('div', 'inv-help');
  body.append(left, right, R.help);
  // the header: who, the score and the health
  meChip.textContent = '';
  R.dot = mk('i', 'dot'); R.name = mk('b', 'inv-nick'); R.kd = mk('span', 'kd');
  R.hp = mk('span', 'inv-hp'); R.hpN = mk('b'); const hpBar = mk('span', 'inv-hpbar'); R.hpF = mk('i'); hpBar.append(R.hpF);
  R.hp.append(mk('small', '', 'HP'), R.hpN, hpBar);
  meChip.append(R.dot, R.name, R.kd, R.hp);
  refs = R; cardSig = '';
}

/* ---------- the values, repainted in place ---------- */
function paint() {
  if (!data || !refs) return;
  const R = refs, pk = data.pack || [];
  if (R.pack.length !== pk.length) { build(); return paint(); }
  data.weapons.forEach((w, s) => {
    const r = R.w[s]; if (!r) return;
    const reloading = data.reloadW === s;
    r.c.classList.toggle('on', w.on); r.c.classList.toggle('reloading', reloading);
    r.c.setAttribute('aria-pressed', w.on ? 'true' : 'false');
    r.c.setAttribute('aria-label', w.name + (w.on ? ', в руках' : ', взять в руки — ' + w.key));
    r.key.textContent = w.key;
    setPic(r.pic, 'g' + w.i);
    r.nm.textContent = w.name;
    r.ammo.textContent = reloading ? 'перезарядка' : w.mag + ' / ' + w.reserve;
    r.ammo.dataset.st = reloading ? 'rl' : w.mag === 0 ? 'empty' : w.mag <= w.magSize * 0.25 ? 'low' : '';
    r.magF.style.width = (w.mag / w.magSize * 100).toFixed(1) + '%';
    if (!reloading) r.rlF.style.width = '0';
    r.att.classList.toggle('filled', !!w.attach);
    setPic(r.attPic, w.attach || '-sight');
    r.att.setAttribute('aria-label', w.attach ? SHORT[w.attach] + ' на оружии — снять в рюкзак' : 'Слот прицела — пуст');
  });
  for (const k of BELT) {
    const r = R.belt[k], n = beltN(k);
    r.key.textContent = beltKey(k);
    r.cnt.textContent = '×' + n;
    r.c.classList.toggle('empty', n <= 0);
    r.c.setAttribute('aria-label', BELT_NAME[k] + ': ' + n + ' из ' + beltMax(k));
    setPic(r.pic, k);
  }
  R.pack.forEach((r, n) => {
    const it = pk[n];
    r.c.classList.toggle('filled', !!it); r.c.classList.toggle('empty', !it);
    r.c.dataset.kind = !it ? '' : isGun(it) ? 'gun' : it.kind;
    if (it) { r.c.setAttribute('role', 'button'); r.c.tabIndex = 0; r.c.setAttribute('aria-label', it.name); }
    else { r.c.removeAttribute('role'); r.c.tabIndex = -1; r.c.removeAttribute('aria-label'); }
    setPic(r.pic, !it ? '' : isGun(it) ? 'g' + it.i : it.kind);
    r.key.textContent = isGun(it) ? it.key : '';
    r.lbl.textContent = !it ? '' : isGun(it) ? it.mag + '/' + it.reserve : SHORT[it.kind];
  });
  R.fill.textContent = pk.filter(Boolean).length + ' / ' + pk.length;
  R.dot.className = 'dot ' + (data.ffa ? 'tf' : 't' + data.team);
  R.name.textContent = data.name || 'Вы';
  R.kd.textContent = data.kills + ' · ' + data.deaths; R.kd.title = 'убийства · смерти';
  const hp = Math.max(0, Math.ceil(data.hp));
  R.hpN.textContent = hp; R.hpF.style.width = Math.max(0, Math.min(100, data.hp)) + '%';
  R.hp.dataset.hp = data.hp <= 25 ? 'low' : data.hp <= 60 ? 'mid' : 'ok';
  const help = 'Щелчок — взять или использовать · перетащите вещь в нужный слот · ' + data.reloadKey + ' — перезарядка · Esc — закрыть';
  if (R.help.textContent !== help) R.help.textContent = help;
  showCard();
}

/* ---------- the card: what the thing under the pointer is and what a click does with it ---------- */
function showCard() {
  if (!data || !refs) return;
  let x = hov && thing(hov.z, hov.i);
  if (!x) x = thing('w', Math.max(0, data.weapons.findIndex(w => w.on)));
  if (!x) return;
  const sig = JSON.stringify([x, x.t === 'belt' || x.t === 'item' || x.t === 'att' ? [beltN(x.kind || 'med'), packN(x.kind), data.hp >= 100, data.sights] : 0, data.reloadKey]);
  if (sig === cardSig) return;
  cardSig = sig;
  const card = refs.card; card.textContent = ''; card.dataset.t = x.t;
  const pic = mk('span', 'inv-pic inv-card-pic'), txt = mk('div', 'inv-card-txt'), head = mk('div', 'inv-card-head');
  const title = mk('b', 'inv-card-name'), tag = mk('small', 'inv-card-tag');
  head.append(title, tag); txt.append(head);
  const p = t => { const e = mk('p', 'inv-card-p', t); txt.append(e); return e; };
  const hint = mk('div', 'inv-card-hint');
  if (x.t === 'gun') {
    const w = x.w, guns = allGuns();
    setPic(pic, 'g' + w.i); pic.classList.add('wide');
    title.textContent = w.name;
    tag.textContent = x.where === 'pack' ? 'в рюкзаке' : w.on ? 'в руках' : 'на игроке';
    tag.dataset.on = w.on ? 1 : 0;
    const stats = mk('div', 'inv-stats');
    const maxDmg = Math.max(...guns.map(g => g.dmg * g.pellets)), maxRate = Math.max(...guns.map(g => 60000 / g.gapMs)), maxRange = Math.max(...guns.map(g => g.range));
    const stat = (label, val, frac, tip) => {
      const bar = mk('span', 'inv-bar'), bf = mk('i'); bf.style.width = Math.round(frac * 100) + '%'; bar.append(bf);
      const r = mk('span', 'inv-st'); if (tip) r.title = tip; r.append(mk('small', '', label), bar, mk('b', '', val)); stats.append(r);
    };
    stat('урон', w.pellets > 1 ? w.dmg + '×' + w.pellets : String(w.dmg), w.dmg * w.pellets / maxDmg, 'в тело ' + w.dmg + ' · в голову ' + w.head + (w.pellets > 1 ? ' — за одну дробину' : ''));
    stat('темп', Math.round(60000 / w.gapMs) + '/мин', (60000 / w.gapMs) / maxRate);
    stat('дальность', w.range + ' м', w.range / maxRange);
    txt.append(stats);
    p(gunTag(w) + ' · магазин ' + w.magSize + ' · перезарядка ' + fmt1(w.reloadMs / 1000) + ' с · прицел: ' + (w.attach ? SHORT[w.attach].toLowerCase() : 'нет'));
    hint.textContent = x.where === 'pack' ? 'Щелчок или ' + w.key + ' — поменять с оружием в руках · или перетащите на любой слот оружия'
      : w.on ? 'В руках · ' + data.reloadKey + ' — перезарядка · колесо мыши — второй ствол' : 'Щелчок или ' + w.key + ' — взять в руки';
  } else if (x.t === 'att') {
    const w = x.w;
    if (x.kind) {
      setPic(pic, x.kind); title.textContent = KINDS[x.kind].name; tag.textContent = 'на оружии';
      p(ABOUT[x.kind]); p('Стоит на: ' + w.name + '.');
      hint.textContent = 'Щелчок — снять в рюкзак · перетащите на другое оружие';
    } else {
      setPic(pic, '-sight'); title.textContent = 'Слот прицела'; tag.textContent = w.name;
      const loose = ['sight', 'optic'].filter(k => packN(k) > 0).map(k => SHORT[k].toLowerCase());
      p(loose.length ? 'В рюкзаке: ' + loose.join(', ') + '.' : 'Прицелов нет. Коллиматор и оптика 8× лежат на карте — подберите, они лягут в рюкзак.');
      hint.textContent = loose.length ? 'Щелчок — поставить прицел из рюкзака · или перетащите его сюда' : 'Пусто';
    }
  } else if (x.t === 'belt') {
    const k = x.kind, n = beltN(k), more = packN(k);
    setPic(pic, k); title.textContent = BELT_NAME[k]; tag.textContent = 'разгрузка';
    p(ABOUT[k]);
    p('Готово: ' + n + ' из ' + beltMax(k) + (more ? ' · в рюкзаке ещё ' + more + ' — сами пополнят разгрузку' : ' · излишки ложатся в рюкзак'));
    hint.textContent = n <= 0 ? 'Нет — ищите на карте' : k === 'med' ? (data.hp >= 100 ? 'Здоровье полное · ' + beltKey(k) + ' — использовать' : 'Щелчок или ' + beltKey(k) + ' — использовать')
      : 'Щелчок или ' + beltKey(k) + ' — взять в руку · зажатая ЛКМ — сила броска';
  } else if (x.t === 'item') {
    const k = x.kind;
    setPic(pic, k); title.textContent = KINDS[k].name; tag.textContent = 'в рюкзаке';
    p(ABOUT[k]);
    if (isSight(k)) {
      const held = data.weapons.find(w => w.on);
      hint.textContent = 'Щелчок — поставить на ' + (held ? held.name.toLowerCase() : 'оружие в руках') + ' · перетащите на нужное оружие';
    } else {
      const full = beltN(k) >= beltMax(k);
      p('В разгрузке ' + beltN(k) + ' из ' + beltMax(k) + '.');
      hint.textContent = full ? 'Разгрузка полна — предмет сам переложится, когда освободится место' : 'Щелчок — переложить в разгрузку · или перетащите в карман';
    }
  } else {
    pic.classList.add('none'); title.textContent = 'Свободный слот'; tag.textContent = 'рюкзак';
    p('Подбирайте вещи на карте — просто пройдите мимо. Ящик патронов пополняет запас каждого ствола (+' + AMMO_GIVE.join(' / +') + ').');
    hint.textContent = (data.pack || []).filter(it => !it).length + ' свободно из ' + (data.pack || []).length;
  }
  card.append(pic, txt, hint);
}
const AMMO_GIVE = [30, 8, 5, 12, 50, 30, 30, 30];   // keep server/combat.mjs ITEMS.ammo.give in step

/* ---------- the pointer: hover shows the card, a click acts, a drag moves ---------- */
const sameSlot = (a, b) => (a && b ? a.z === b.z && a.i === b.i : a === b);
function point(el) {
  if (drag && drag.on) return;
  const h = el ? { z: el.dataset.z, i: idx(el) } : null;
  if (!h || sameSlot(h, hov)) return;   // between the slots the card keeps the last thing
  hov = h; showCard();
}
body.addEventListener('mouseover', e => point(e.target.closest('[data-z]')));
body.addEventListener('focusin', e => point(e.target.closest('[data-z]')));
body.addEventListener('mouseleave', () => { if (hov && !(drag && drag.on)) { hov = null; showCard(); } });
body.addEventListener('click', e => {
  if (eatClick) { eatClick = false; return; }   // the click that ends a drag
  if (e.detail > 1) return;   // a double click acts once (a pack gun clicked twice would come back)
  const el = e.target.closest('[data-z]'); if (el) act(el.dataset.z, idx(el));
});
body.addEventListener('contextmenu', e => { e.preventDefault(); const el = e.target.closest('[data-z]'); if (el) act(el.dataset.z, idx(el)); });
body.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[data-z]'); if (!el || el.tagName === 'BUTTON') return;   // a button clicks by itself
  e.preventDefault(); e.stopPropagation(); act(el.dataset.z, idx(el));   // not the chat that Enter opens in the fight
});
let ghost = null;
body.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.pointerType === 'touch') return;   // a touch screen taps; a drag there scrolls the panel
  const el = e.target.closest('[data-z]'); if (!el || !canDrag(el.dataset.z, idx(el))) return;
  drag = { z: el.dataset.z, i: idx(el), el, x0: e.clientX, y0: e.clientY, on: false, over: null, act: null };
});
function startDrag() {
  drag.on = true;
  ghost = mk('div', 'inv-ghost');
  const pic = drag.el.querySelector('.inv-pic'); if (pic) ghost.append(pic.cloneNode(true));
  document.body.append(ghost);
  drag.el.classList.add('dragging'); box.classList.add('dragging');
  for (const el of body.querySelectorAll('[data-z]')) if (dropAct(drag, el.dataset.z, idx(el))) el.classList.add('drop-can');
}
function overSlot(e) {
  const t = document.elementFromPoint(e.clientX, e.clientY), el = t && t.closest ? t.closest('[data-z]') : null;
  return el && body.contains(el) ? el : null;
}
window.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.on) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; startDrag(); }
  ghost.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
  const el = overSlot(e);
  if (el === drag.over) return;
  if (drag.over) drag.over.classList.remove('drop-ok', 'drop-no');
  drag.over = el; drag.act = el ? dropAct(drag, el.dataset.z, idx(el)) : null;
  if (el && el !== drag.el) el.classList.add(drag.act ? 'drop-ok' : 'drop-no');
});
function endDrag() {
  if (!drag) return;
  if (ghost) { ghost.remove(); ghost = null; }
  for (const el of body.querySelectorAll('.drop-can, .drop-ok, .drop-no, .dragging')) el.classList.remove('drop-can', 'drop-ok', 'drop-no', 'dragging');
  box.classList.remove('dragging');
  drag = null;
}
window.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; endDrag();
  if (!d.on) return;
  eatClick = true; setTimeout(() => { eatClick = false; }, 0);
  if (d.act) d.act();
});
window.addEventListener('pointercancel', endDrag);

let warm = false;
function renderInv(d) {
  data = d;
  if (!warm) { warm = true; setTimeout(makePics, 5000); }   // the pictures ready before the first opening (what has not come yet is shot then)
  if (!open) return;
  paint();
}
// the reload bar of the gun that is reloading, every frame while the panel is open
function invTick(now) {
  if (!open || !data || !refs || data.reloadW < 0) return;
  const r = refs.w[data.reloadW], w = data.weapons[data.reloadW];
  if (!r || !w) return;
  r.rlF.style.width = (Math.min(1, Math.max(0, (now - data.reloadAt) / w.reloadMs)) * 100).toFixed(1) + '%';
}
function openInv() {
  if (open || !data) return;
  open = true; hov = null;
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear();
  build(); paint();
  box.hidden = false;
  body.focus({ preventScroll: true });   // the panel takes the keys: wheel, touch and the arrows scroll it where it is taller than the screen
  makePics();   // the models shot as pictures, once (inv-icons.js); the SVG stands in meanwhile
}
function closeInv() { if (!open) return; open = false; endDrag(); box.hidden = true; }
const toggleInv = () => (open ? closeInv() : openInv());
const invOpen = () => open;
window.addEventListener('keydown', e => { if (e.code === 'Escape' && open) { closeInv(); e.preventDefault(); e.stopImmediatePropagation(); } }, true);
$('mpInvClose').onclick = closeInv;
box.addEventListener('click', e => { if (e.target === box) closeInv(); });

export { KINDS, SLOT_SVG, bindInv, setItems, itemBack, itemTook, clearItems, tickItems, renderInv, invTick, openInv, closeInv, toggleInv, invOpen };
