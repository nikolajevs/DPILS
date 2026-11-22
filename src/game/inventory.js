import * as THREE from 'three';
import { STATE } from '../core/state.js';
import { P, keys } from './player.js';
import { terrainH } from '../world/terrain.js';
import { scene } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';
import { addMover } from '../render/lamp-shadows.js';
import { $ } from '../core/env.js';
import { prop, onProps } from './props.js';

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
let cb = { useMed: () => {}, switchWeapon: () => {}, ready: () => {}, attach: () => {}, beep: () => {} };
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
   A tactical glass card in the look of the arena console: five weapon cards with silhouettes, the magazine drawn
   round by round and the combat stats of each gun; the grenades and the med kits with their pips; the condition of
   the player. The structure is built once per opening; renderInv repaints the values in place (it comes on every
   state change and once a second), invTick animates the reload bar of the gun that is reloading every frame. */
// silhouettes in the order of WEAPONS in mp.js: the AK, the shotgun, the SVD, the pistol, the machine gun
const SLOT_SVG = [
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="24" y="9" width="14" height="2"/><rect x="8" y="8" width="17" height="5"/><polygon points="1,9 8,8 8,13 3,14"/><polygon points="14,13 19,13 17,19 13,19"/><polygon points="20,13 23,13 22,17 19,17"/><rect x="26" y="7" width="2" height="2"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="14" y="9" width="24" height="2.5"/><rect x="18" y="11.5" width="7" height="3"/><polygon points="1,9 14,9 14,13 4,15"/><rect x="10" y="8.5" width="8" height="4"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="20" y="9.5" width="18" height="1.8"/><rect x="12" y="6" width="8" height="3"/><rect x="14" y="9" width="2" height="1.5"/><rect x="8" y="9" width="14" height="4"/><polygon points="1,9 8,9 8,14 3,15"/><rect x="14" y="13" width="4" height="4"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="10" y="7" width="18" height="5"/><polygon points="12,12 19,12 17,19 11,19"/><rect x="28" y="8" width="2" height="3"/></svg>',
  '<svg viewBox="0 0 40 20" aria-hidden="true"><rect x="6" y="8" width="20" height="6"/><rect x="26" y="9" width="12" height="2.5"/><polygon points="1,9 6,8 6,14 2,15"/><rect x="12" y="14" width="8" height="5"/><rect x="10" y="6" width="8" height="2"/><path d="M30 11l-2 7M33 11l2 7" stroke="rgba(255,255,255,.62)" stroke-width="1.4" fill="none"/></svg>',
];
const NADE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="14" r="7"/><path d="M10 7h4v3h-4zM14 5l3-2"/></svg>';
const MED_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M12 10v6M9 13h6M9 6V4h6v2"/></svg>';
const NADE_INFO = 'до 100 урона · радиус 8 м · задержка 2,5 с';   // keep server/combat.mjs NADE in step
const SMOKE_INFO = 'завеса 12 с · радиус 6 м · скрывает от врага';   // keep server/combat.mjs SMOKE in step
const NAPALM_INFO = 'огонь 8 с · радиус 4 м · 30 урона/с';   // keep server/combat.mjs NAPALM in step
const SMOKE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="9" width="8" height="11" rx="1.5"/><path d="M10 9V7h4v2M12 7V5"/><path d="M5 5c1-1 2-1 3 0M16 4c1-1 2-1 3 0"/></svg>';
const NAPALM_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="9" width="8" height="11" rx="1.5"/><path d="M10 9V7h4v2M12 7V5"/><path d="M12 12c1.6 1.4 2 2.6 0 4-2-1.4-1.6-2.6 0-4z"/></svg>';
const AMMO_GIVE = [30, 8, 5, 12, 50];   // keep server/combat.mjs INV ammo.give in step
const SIGHT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18h14v2H5zM6 8h2v10H6zM16 8h2v10h-2zM6 6h12v2H6z"/><circle cx="12" cy="12" r="1.6"/></svg>';
const OPTIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="18" height="5" rx="2.5"/><rect x="6" y="14" width="3" height="5"/><rect x="15" y="14" width="3" height="5"/><rect x="10" y="6" width="4" height="3"/></svg>';
const ITEM_SVG = { nade: NADE_SVG, smoke: SMOKE_SVG, napalm: NAPALM_SVG, med: MED_SVG, sight: SIGHT_SVG, optic: OPTIC_SVG };   // a stored item in a pack cell (stroke icons, unlike the gun silhouettes)
const gunTag = w => (w.pellets > 1 ? w.pellets + ' дробин за выстрел' : w.scope ? 'встроенная оптика' : w.auto ? 'автоматический огонь' : 'одиночный огонь');
const fmt1 = x => (Math.round(x * 10) / 10).toString().replace('.', ',');
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const kbd = key => mk('kbd', '', key);

const box = $('mpInv'), body = $('mpInvBody'), meChip = $('mpInvMe');
let open = false, data = null, refs = null, builtLoadout = '';

function build() {
  if (!data) return;
  body.textContent = '';
  const R = { guns: [], pack: [], nade: {}, smoke: {}, napalm: {}, med: {}, hp: {}, kd: {} };
  // the weapons: a card each for the two equipped guns, the click takes the gun in hand
  const wsec = mk('section', 'inv-sec');
  const whead = mk('div', 'inv-head');
  whead.append(mk('h3', '', 'Оружие · 2 слота'), mk('small', '', 'щелчок по карточке или её клавиша — взять в руки · ' + data.reloadKey + ' — перезарядка'));
  wsec.append(whead);
  const guns = mk('div', 'inv-guns');
  const maxDmg = Math.max(...data.weapons.map(w => w.dmg * w.pellets));
  const maxRate = Math.max(...data.weapons.map(w => 60000 / w.gapMs));
  const maxRange = Math.max(...data.weapons.map(w => w.range));
  data.weapons.forEach((w, i) => {
    const c = mk('div', 'inv-gun'); c.setAttribute('role', 'button'); c.tabIndex = 0;   // a div, not a button: the sight buttons live inside
    c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cb.switchWeapon(w.i); } };
    const top = mk('span', 'inv-top'); top.append(kbd(w.key), mk('b', 'inv-hand', 'в руках'));
    const sil = mk('span', 'inv-sil'); sil.innerHTML = SLOT_SVG[w.i];
    const ammo = mk('span', 'inv-ammo');
    const magN = mk('b', '', '0'), resN = mk('span', '', '/ 0'); ammo.append(magN, resN);
    const mag = mk('span', 'inv-mag' + (w.magSize > 30 ? ' cont' : ''));
    const pips = []; let fill = null;
    if (w.magSize > 30) { fill = mk('i'); mag.append(fill); }   // the machine gun's hundred rounds: one continuous bar
    else for (let k = 0; k < w.magSize; k++) { const p = mk('i'); mag.append(p); pips.push(p); }
    const rl = mk('span', 'inv-rl'), rlFill = mk('i'); rl.append(rlFill);
    const rlText = mk('small', 'inv-rlt', 'перезарядка');
    const stats = mk('span', 'inv-stats');
    const stat = (label, val, frac, tip) => {
      const r = mk('span', 'inv-st'), bar = mk('span', 'inv-bar'), bf = mk('i');   // not 'bar': that class belongs to the bottom button bar
      bf.style.width = Math.round(frac * 100) + '%'; bar.append(bf);
      if (tip) r.title = tip;
      r.append(mk('small', '', label), bar, mk('b', '', val)); stats.append(r);
    };
    stat('урон', w.pellets > 1 ? w.dmg + '×' + w.pellets : String(w.dmg), w.dmg * w.pellets / maxDmg, 'в тело ' + w.dmg + ' · в голову ' + w.head + (w.pellets > 1 ? ' — за одну дробину' : ''));
    stat('темп', Math.round(60000 / w.gapMs) + '/мин', (60000 / w.gapMs) / maxRate);
    stat('дальность', w.range + ' м', w.range / maxRange);
    const foot = mk('small', 'inv-foot', 'магазин ' + w.magSize + ' · перезарядка ' + fmt1(w.reloadMs / 1000) + ' с');
    const att = mk('span', 'inv-att');   // the picked-up sight on this weapon: mount / take off (the pocket pays)
    const attB = kind => { const b = mk('button', 'inv-att-b'); b.type = 'button'; b.textContent = kind === 'sight' ? 'Коллиматор' : 'Оптика 8×'; b.onclick = e => { e.stopPropagation(); cb.attach(w.i, w.attach === kind ? null : kind); }; return b; };
    const attS = attB('sight'), attO = attB('optic');
    att.append(mk('small', 'inv-att-l', 'прицел:'), attS, attO);
    c.append(top, sil, mk('b', 'inv-name', w.name), mk('small', 'inv-tag', gunTag(w)), ammo, mag, rl, rlText, stats, att, foot);
    c.onclick = () => cb.switchWeapon(w.i);
    guns.append(c);
    R.guns.push({ c, ammo, magN, resN, pips, fill, rlFill, rlText, attS, attO });
  });
  wsec.append(guns);
  // the backpack: ten loot slots. A filled cell is a gun (the click swaps it into the active equipped slot) or a stored
  // item (a med kit / grenade goes to the ready belt, a sight mounts on the gun in hand); an empty cell waits for loot.
  // The three guns not equipped start here, seven cells are empty.
  const psec = mk('section', 'inv-sec');
  const phead = mk('div', 'inv-head');
  phead.append(mk('h3', '', 'Рюкзак · 10 слотов'), mk('small', '', 'оружие — поменять с активным слотом · предмет — в готовность или на оружие в руках'));
  psec.append(phead);
  const packGrid = mk('div', 'inv-pack');
  for (let s = 0; s < 10; s++) {
    const cell = mk('div', 'inv-pack-cell');
    const sil = mk('span', 'inv-pack-sil');
    const nm = mk('b', 'inv-pack-name');
    const am = mk('span', 'inv-pack-ammo');
    const kb = mk('kbd', 'inv-pack-key');
    const empty = mk('span', 'inv-pack-empty', 'пусто');
    cell.append(sil, nm, am, kb, empty);
    const act = () => {
      const it = data.pack && data.pack[s]; if (!it) return;
      if (typeof it.i === 'number') cb.switchWeapon(it.i);
      else if (it.kind === 'med' || it.kind === 'nade' || it.kind === 'smoke' || it.kind === 'napalm') cb.ready(it.kind);
      else { const held = (data.weapons || []).find(w => w.on); if (held) cb.attach(held.i, it.kind); }
    };
    cell.onclick = act;
    cell.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
    packGrid.append(cell);
    R.pack.push({ cell, sil, nm, am, kb });
  }
  psec.append(packGrid);
  // the items and the condition of the player
  const low = mk('div', 'inv-low');
  const isec = mk('section', 'inv-sec'); isec.append(mk('h3', '', 'Предметы'));
  const items = mk('div', 'inv-items');
  const itemCard = (svg, name) => {
    const card = mk('div', 'inv-item'), top = mk('div', 'inv-it-top');
    const ico = mk('span', 'inv-ico'); ico.innerHTML = svg;
    const cnt = mk('span', 'inv-cnt', '×0');
    top.append(ico, mk('b', '', name), cnt);
    const pips = mk('span', 'inv-pips');
    card.append(top, pips);
    return { card, cnt, pips };
  };
  const nade = itemCard(NADE_SVG, 'Гранаты · готовы');
  for (let k = 0; k < data.nadeMax; k++) nade.pips.append(mk('i'));
  const nPack = mk('small', 'inv-dim', '');
  nade.card.append(mk('small', '', data.nadeKey + ' — прицельный бросок: мышь целится, ЛКМ заряжает силу'), mk('small', 'inv-dim', NADE_INFO), nPack);
  R.nade = { ...nade, pack: nPack };
  const smoke = itemCard(SMOKE_SVG, 'Дым · готовы');
  for (let k = 0; k < data.nadeMax; k++) smoke.pips.append(mk('i'));
  const sPack = mk('small', 'inv-dim', '');
  smoke.card.append(mk('small', '', data.smokeKey + ' — дымовая завеса: мышь целится, ЛКМ заряжает силу'), mk('small', 'inv-dim', SMOKE_INFO), sPack);
  R.smoke = { ...smoke, pack: sPack };
  const napalm = itemCard(NAPALM_SVG, 'Напалм · готовы');
  for (let k = 0; k < data.nadeMax; k++) napalm.pips.append(mk('i'));
  const pPack = mk('small', 'inv-dim', '');
  napalm.card.append(mk('small', '', data.napalmKey + ' — зажигательная граната: огонь выжигает всё в радиусе'), mk('small', 'inv-dim', NAPALM_INFO), pPack);
  R.napalm = { ...napalm, pack: pPack };
  const med = itemCard(MED_SVG, 'Аптечки · готовы');
  for (let k = 0; k < data.medMax; k++) med.pips.append(mk('i'));
  const use = mk('button', 'btn inv-use'); use.type = 'button'; use.append(document.createTextNode('Использовать '), kbd(data.medKey));
  use.onclick = () => { cb.useMed(); cb.beep('med'); };
  const mnote = mk('small', 'inv-dim', 'лечит 50 HP');
  const mPack = mk('small', 'inv-dim', '');
  med.card.append(use, mnote, mPack);
  R.med = { ...med, use, note: mnote, pack: mPack };
  const sight = itemCard(SIGHT_SVG, 'Коллиматоры · рюкзак'); sight.pips.append(mk('i'));
  const sNote = mk('small', 'inv-dim', '');
  sight.card.append(mk('small', '', 'ПКМ — красная точка, разброс уже; Shift — короткий зум'), sNote);
  R.sight = { ...sight, note: sNote };
  const optic = itemCard(OPTIC_SVG, 'Оптика 8× · рюкзак'); optic.pips.append(mk('i'));
  const oNote = mk('small', 'inv-dim', '');
  optic.card.append(mk('small', '', 'ПКМ — зум с сеткой, колесо меняет кратность 4–8×, руки прячутся'), oNote);
  R.optic = { ...optic, note: oNote };
  items.append(nade.card, smoke.card, napalm.card, med.card, sight.card, optic.card);
  isec.append(items);
  const ssec = mk('section', 'inv-sec'); ssec.append(mk('h3', '', 'Состояние'));
  const state = mk('div', 'inv-item inv-state');
  state.append(mk('small', 'inv-dim', 'здоровье'));
  const hpRow = mk('div', 'inv-hp'), hpN = mk('b', '', '100'), hpBar = mk('span', 'inv-hpbar'), hpFill = mk('i');
  hpBar.append(hpFill); hpRow.append(hpN, hpBar); state.append(hpRow);
  const kd = mk('div', 'inv-kd');
  const kdCell = (label) => { const s = mk('span'), b = mk('b', '', '0'); s.append(b, mk('small', '', label)); kd.append(s); return b; };
  const killsN = kdCell('убийств'), deathsN = kdCell('смертей');
  state.append(kd);
  const total = mk('div', 'inv-total'), totalN = mk('b', '', '0');
  total.append(mk('small', '', 'боезапас'), totalN, mk('small', '', 'патронов'));
  state.append(total);
  R.hp = { row: state, n: hpN, fill: hpFill }; R.kd = { k: killsN, d: deathsN }; R.total = totalN;
  ssec.append(state);
  low.append(isec, ssec);
  const note = mk('small', 'inv-note');
  note.textContent = 'На игроке только два ствола — остальные лежат в рюкзаке (10 слотов, 7 пустых для лута). Щелчок по оружию в рюкзаке меняет его с активным слотом; клавиши 1–5 берут ствол в руки или достают из рюкзака, колесо мыши переключает два экипированных. Прицелы хранятся в рюкзаке: установка на оружие освобождает слот, снятие возвращает прицел в свободный слот. К использованию готовы до ' + data.medMax + ' аптечек и до ' + data.nadeMax + ' гранат каждого типа (обычная, дымовая, напалм); излишки лежат в рюкзаке и сами пополняют готовность после использования (щелчок по предмету в рюкзаке тоже берёт его в готовность, прицел — ставит на оружие в руках). Снаряжение переживает смерть. Предметы на карте подбираются автоматически — просто пройдите мимо. Ящик патронов даёт +' + AMMO_GIVE.join(' / +') + ' к запасу каждого ствола и возвращается через 25 с, граната — через 30 с, дымовая — через 35 с, напалм — через 40 с, аптечка — через 35 с, коллиматор — через 45 с, оптика — через 60 с. Бой продолжается, пока панель открыта.';
  body.append(wsec, psec, low, note);
  refs = R;
}

function paint() {
  if (!data || !refs) return;
  const R = refs;
  data.weapons.forEach((w, i) => {
    const g = R.guns[i];
    g.c.classList.toggle('on', w.on);
    g.c.setAttribute('aria-pressed', w.on ? 'true' : 'false');
    g.c.title = w.on ? w.name + ' — в руках' : 'Взять в руки (' + w.key + ')';
    g.magN.textContent = w.mag;
    g.resN.textContent = '/ ' + w.reserve;
    g.ammo.dataset.empty = w.mag === 0 ? 1 : 0;
    g.ammo.dataset.low = w.mag > 0 && w.mag <= w.magSize * 0.25 ? 1 : 0;
    if (g.fill) g.fill.style.width = (w.mag / w.magSize * 100).toFixed(1) + '%';
    else g.pips.forEach((p, k) => p.classList.toggle('full', k < w.mag));
    g.c.classList.toggle('reloading', data.reloadW === i);
    const loose = data.sights || { sight: 0, optic: 0 };
    for (const [b, k] of [[g.attS, 'sight'], [g.attO, 'optic']]) {
      const on = w.attach === k;
      b.classList.toggle('on', on);
      b.disabled = !on && loose[k] <= 0;
      b.title = on ? 'Снять прицел — вернётся в рюкзак' : loose[k] > 0 ? 'Установить на это оружие' : 'Нет в рюкзаке — подберите на карте';
    }
  });
  // the backpack cells: a gun shows its silhouette, name, rounds and key (the click swaps it in); a stored item shows
  // its icon and what the click does (to the ready belt, or onto the gun in hand); an empty cell waits
  const pk = data.pack || [];
  R.pack.forEach((r, s) => {
    const w = pk[s];
    r.cell.classList.toggle('filled', !!w);
    r.cell.classList.toggle('empty', !w);
    r.cell.classList.toggle('item', !!w && typeof w.i !== 'number');
    if (w && typeof w.i === 'number') {
      r.cell.setAttribute('role', 'button'); r.cell.tabIndex = 0;
      r.cell.title = 'Взять в руки — поменять с активным слотом (' + w.key + ')';
      r.sil.innerHTML = SLOT_SVG[w.i];
      r.nm.textContent = w.name;
      r.am.textContent = w.mag + ' / ' + w.reserve;
      r.am.dataset.empty = w.mag === 0 ? 1 : 0;
      r.kb.textContent = w.key;
    } else if (w) {
      r.cell.setAttribute('role', 'button'); r.cell.tabIndex = 0;
      const belt = w.kind === 'med' || w.kind === 'nade' || w.kind === 'smoke' || w.kind === 'napalm';
      r.cell.title = belt ? w.name + ' — щелчок: в готовность (если есть место)' : w.name + ' — щелчок: установить на оружие в руках';
      r.sil.innerHTML = ITEM_SVG[w.kind];
      r.nm.textContent = w.name;
      r.am.textContent = belt ? 'в готовность' : 'на оружие';
      delete r.am.dataset.empty;
      r.kb.textContent = '';
    } else {
      r.cell.removeAttribute('role'); r.cell.tabIndex = -1;
      r.cell.title = 'Пустой слот рюкзака';
      r.sil.innerHTML = ''; r.nm.textContent = ''; r.am.textContent = ''; r.kb.textContent = '';
    }
  });
  const loose = data.sights || { sight: 0, optic: 0 };
  for (const [r, k] of [[R.sight, 'sight'], [R.optic, 'optic']]) {
    r.cnt.textContent = '×' + (loose[k] || 0);
    r.card.dataset.empty = loose[k] > 0 ? 0 : 1;
    [...r.pips.children].forEach((p, j) => p.classList.toggle('full', j < loose[k]));
    const on = data.weapons.filter(w => w.attach === k).map(w => w.name);
    r.note.textContent = on.length ? 'стоит на: ' + on.join(', ') : loose[k] > 0 ? 'в рюкзаке — выберите оружие выше' : 'нет — ищите на карте';
  }
  const packN = k => (data.pack || []).filter(it => it && it.kind === k).length;
  R.nade.cnt.textContent = '×' + data.nades + ' / ' + data.nadeMax;
  R.nade.card.dataset.empty = data.nades > 0 ? 0 : 1;
  [...R.nade.pips.children].forEach((p, k) => p.classList.toggle('full', k < data.nades));
  const nPack = packN('nade');
  R.nade.pack.textContent = nPack ? 'в рюкзаке ещё ' + nPack + ' — сами пополняют готовность после броска' : 'готовы до ' + data.nadeMax + ' одного типа · излишки хранятся в рюкзаке';
  for (const [r, k, cnt] of [[R.smoke, 'smoke', data.smokes || 0], [R.napalm, 'napalm', data.napalms || 0]]) {
    r.cnt.textContent = '×' + cnt + ' / ' + data.nadeMax;
    r.card.dataset.empty = cnt > 0 ? 0 : 1;
    [...r.pips.children].forEach((p, j) => p.classList.toggle('full', j < cnt));
    const n = packN(k);
    r.pack.textContent = n ? 'в рюкзаке ещё ' + n + ' — сами пополняют готовность после броска' : 'готовы до ' + data.nadeMax + ' · излишки хранятся в рюкзаке';
  }
  R.med.cnt.textContent = '×' + data.meds + ' / ' + data.medMax;
  R.med.card.dataset.empty = data.meds > 0 ? 0 : 1;
  [...R.med.pips.children].forEach((p, k) => p.classList.toggle('full', k < data.meds));
  const mPack = packN('med');
  R.med.pack.textContent = mPack ? 'в рюкзаке ещё ' + mPack + ' — сами пополняют готовность после использования' : 'готовы до ' + data.medMax + ' · излишки хранятся в рюкзаке';
  const none = data.meds <= 0, full = data.hp >= 100;
  R.med.use.disabled = none || full;
  R.med.note.textContent = none ? 'нет аптечек — ищите белые ящики на карте' : full ? 'здоровье полное — беречь не нужно' : 'лечит 50 HP';
  const hp = Math.max(0, Math.ceil(data.hp));
  R.hp.n.textContent = hp;
  R.hp.fill.style.width = Math.max(0, data.hp) + '%';
  R.hp.row.dataset.hp = data.hp <= 25 ? 'low' : data.hp <= 60 ? 'mid' : 'ok';
  R.kd.k.textContent = data.kills; R.kd.d.textContent = data.deaths;
  R.total.textContent = data.weapons.concat(data.pack || []).filter(Boolean).reduce((s, w) => s + w.mag + w.reserve, 0);
  meChip.textContent = '';
  meChip.append(mk('i', 'dot ' + (data.ffa ? 'tf' : 't' + data.team)), mk('b', '', data.name || 'Вы'), mk('span', 'kd', data.kills + ' · ' + data.deaths));
}

function renderInv(d) {
  data = d;
  if (!open) return;
  const sig = (d.weapons || []).map(w => w.i).join(',');
  if (sig !== builtLoadout) { build(); builtLoadout = sig; }   // a swap changed the equipped guns: rebuild the cards
  paint();
}
// the reload bar of the gun that is reloading, every frame while the panel is open
function invTick(now) {
  if (!open || !data || !refs || data.reloadW < 0) return;
  const g = refs.guns[data.reloadW], ms = data.weapons[data.reloadW].reloadMs;
  if (!g) return;
  const p = Math.min(1, Math.max(0, (now - data.reloadAt) / ms));
  g.rlFill.style.width = (p * 100).toFixed(1) + '%';
  const t = 'перезарядка · ' + fmt1(Math.max(0, (ms - (now - data.reloadAt)) / 1000)) + ' с';
  if (g.rlText.textContent !== t) g.rlText.textContent = t;
}
function openInv() {
  if (open || !data) return;
  open = true;
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear();
  build(); builtLoadout = (data.weapons || []).map(w => w.i).join(','); paint();
  box.hidden = false;
  body.focus({ preventScroll: true });   // the scroller takes the focus: wheel, touch and the arrow keys scroll the panel
}
function closeInv() { if (!open) return; open = false; box.hidden = true; }
const toggleInv = () => (open ? closeInv() : openInv());
const invOpen = () => open;
window.addEventListener('keydown', e => { if (e.code === 'Escape' && open) { closeInv(); e.preventDefault(); e.stopImmediatePropagation(); } }, true);
$('mpInvClose').onclick = closeInv;
box.addEventListener('click', e => { if (e.target === box) closeInv(); });

export { KINDS, SLOT_SVG, bindInv, setItems, itemBack, itemTook, clearItems, tickItems, renderInv, invTick, openInv, closeInv, toggleInv, invOpen };