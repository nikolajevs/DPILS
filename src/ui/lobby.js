import * as THREE from 'three';
import { CHARS, CHAR_KEYS, hasChar, loadAvatar, loadChar, makeAvatar, parseChar } from '../game/avatar.js';
import { akReady, loadAK } from '../game/viewmodel.js';
import { worldSpace } from '../render/world-space.js';
import { serverHttp } from '../game/server.js';
import { $, reduceMotion } from '../core/env.js';

/* ---------- the lobby (src/ui/start.js opens it once a game mode is chosen) ----------
   The settings of the fight stand beside a live preview of the chosen character: the same ready model the game
   draws (makeAvatar of src/game/avatar.js), idle on a lit pedestal in its own small WebGL scene — a second renderer
   over the city's, created only when the lobby first opens and paused whenever the card is away. The figure turns
   by itself, the pointer turns it by hand, the wheel brings it closer. The four characters are chosen on cards under
   the stage; each card carries a portrait rendered once from its own model (a 2× supersampled shot of the same
   scene), so the choice is a face, not a name in a list. The hidden selects (#mpChar, #trLevel, #trTime)
   stay the source of truth: the cards and the segment buttons write them and fire 'change', exactly as the old form
   did — src/game/mp.js reads them on join without knowing the lobby exists. There are no sides to choose: everybody
   fights for himself (the only allies are the own team of the players), so the pedestal ring and the chip over the
   stage are amber, the colour of the free-for-all.
   Every material here is worldSpace: the page lifts all shaders by the terrain height (world/terrain.js), and the
   lobby scene stands at its own origin, not in the city. If the models or WebGL cannot come, the cards and the
   settings still work; a silhouette stands in for the figure.
   The lobby opens while the city is still being built, so it waits for as little as it can: the chosen figure comes
   with its own file and the AK (not with every model of the game), its shaders compile beside the page, and the
   portraits are taken after it, one at a time (see showChar and portraits). */

const LORE = {
  soldier: { role: 'Штурмовик', desc: 'Оператор спецназа: тяжёлая броня, шлем и автомат наизготовку.' },
  spartan: { role: 'Тяжёлая броня', desc: 'Суперсолдат программы MKV: силовая броня и спокойствие танка.' },
  alien: { role: 'Разведчик', desc: 'Гость с другой планеты: лёгкий, быстрый и совершенно нездешний.' },
  '2b': { role: 'Андроид', desc: 'Боевой андроид YoRHa: точные движения и холодный расчёт.' },
};
const IDLE = { speed: 0, yaw: 0, pitch: 0, h: 1.7, air: false, dead: false };
const SIL = '<svg viewBox="0 0 64 96" aria-hidden="true"><circle cx="32" cy="15" r="11"/><path d="M21 29h22l7 31h-8l-3 33h-7l-2-25h-4l-2 25h-7l-3-33h-8z"/></svg>';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let open = false, step = 'train';
let renderer = null, scene = null, camera = null, spin = null, ring = null, glow = null;
let av = null, avKey = '', want = 0, yaw = Math.PI, dist = 4.6, raf = 0, lastT = 0;
let dragging = false, lastX = 0, idleAt = 0, cardsBuilt = false, shots = false;
const cards = {}, figs = {};   // figs: key → the promise of its figure (null if it cannot be made), each built once

const curKey = () => parseChar($('mpChar').value) || 'soldier';

/* ---------- the stage: its own renderer, lights and pedestal ---------- */
function ensureRenderer() {
  if (renderer) return;
  try { renderer = new THREE.WebGLRenderer({ canvas: $('lobbyView'), antialias: true, alpha: true }); }
  catch (e) { renderer = null; fallback('3D-предпросмотр недоступен в этом браузере.'); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // the soft one is gone from three (r18x), it fell back to this with a warning
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  scene.add(new THREE.HemisphereLight(0x9db8d9, 0x14100c, 0.5));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.4);
  key.position.set(2.6, 4.5, 3.4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const sc = key.shadow.camera; sc.left = -2.2; sc.right = 2.2; sc.top = 2.6; sc.bottom = -1; sc.near = 1; sc.far = 12;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb2ff, 1.4); rim.position.set(-3.2, 2.6, -3.0); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-2, 1.2, 2.6); scene.add(fill);
  // the pedestal: a dark metal disc with a team-coloured ring and a soft glow on the floor
  const ped = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 1.0, 0.1, 48), worldSpace(new THREE.MeshStandardMaterial({ color: 0x1c232e, roughness: 0.5, metalness: 0.75 })));
  base.position.y = 0.05; base.receiveShadow = true; ped.add(base);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.92, 0.03, 48), worldSpace(new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.4, metalness: 0.6 })));
  top.position.y = 0.115; top.receiveShadow = true; ped.add(top);
  ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.016, 10, 72), worldSpace(new THREE.MeshBasicMaterial({ color: 0xf0b429 })));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.105; ped.add(ring);
  const gc = document.createElement('canvas'); gc.width = gc.height = 256;
  const g = gc.getContext('2d'), grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,.85)'); grad.addColorStop(0.4, 'rgba(255,255,255,.28)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  glow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), worldSpace(new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xf0b429 })));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.002; ped.add(glow);
  scene.add(ped);
  spin = new THREE.Group(); spin.position.y = 0.13; scene.add(spin);   // the figure stands on the pedestal's top
  resize();
  new ResizeObserver(resize).observe($('lobbyStageView'));
  bindStageInput();
}
function resize() {
  if (!renderer) return;
  const box = $('lobbyStageView').getBoundingClientRect();
  const w = Math.max(1, box.width), h = Math.max(1, box.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
function bindStageInput() {
  const cv = $('lobbyView');
  cv.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; cv.setPointerCapture(e.pointerId); cv.classList.add('grabbing'); $('lobbyDragHint').classList.add('dragged'); });
  cv.addEventListener('pointermove', e => { if (!dragging) return; yaw += (e.clientX - lastX) * 0.008; lastX = e.clientX; idleAt = performance.now(); });
  const end = e => { dragging = false; idleAt = performance.now(); cv.classList.remove('grabbing'); try { cv.releasePointerCapture(e.pointerId); } catch (err) {} };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  $('lobbyStageView').addEventListener('wheel', e => { e.preventDefault(); dist = clamp(dist + e.deltaY * 0.0025, 3.4, 6.4); idleAt = performance.now(); }, { passive: false });
}
function fallback(note) { $('lobbyFallback').hidden = false; $('lobbyFallbackNote').textContent = note; }

/* ---------- the figure ----------
   A figure is made as soon as its own file and the AK in its hands have come (loadChar of avatar.js asks for the
   chosen character first), not after every model of the game. Before its first frame its shaders are compiled beside
   the page where the browser can (compileAsync: KHR_parallel_shader_compile) and its textures are sent to the GPU a
   few milliseconds at a time: drawn at once, the first frame of a new figure stopped the page for over a second. Each
   figure is made once and kept, so a character chosen again is back on the next frame. While the next figure is being
   prepared the one before stays on the pedestal; while its file is still on its way, the silhouette. */
function disposeAvatar(a) {
  a.root.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); });
}
const later = () => new Promise(r => setTimeout(r, 0));
// the shaders of a model compiled for the target it will be drawn into (null: the stage; a portrait's target draws
// without the tone mapping, so its programs are other ones), then its textures sent to the GPU (~0.1 s for a figure
// and its AK), letting the build of the city go on every 50 ms: each pause hands it a slice of up to a few hundred ms
async function prepare(root, cam, target) {
  renderer.setRenderTarget(target);
  const compiled = renderer.compileAsync(root, cam, scene);
  renderer.setRenderTarget(null);
  await compiled;
  const tex = new Set();
  root.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const v of Object.values(m)) if (v && v.isTexture) tex.add(v); });
  let t0 = performance.now();
  for (const t of tex) {
    if (performance.now() - t0 > 50) { await later(); t0 = performance.now(); }
    renderer.initTexture(t);
  }
}
function figure(key) {
  // (its own file did not come: the operator stands in, once the other files are here — makeAvatar)
  return figs[key] || (figs[key] = Promise.all([loadChar(key).then(a => a || loadAvatar()), loadAK()]).then(async () => {
    const a = makeAvatar(key); if (!a) return null;
    a.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    a.update(0.016, IDLE);
    await prepare(a.root, camera, null);
    return a;
  }).catch(e => { console.error(e); return null; }));
}
function put(a) {
  if (av === a) return;
  if (av) spin.remove(av.root);
  av = a; if (a) spin.add(a.root);
}
function showChar(key) {
  if (!renderer || key === avKey) return;
  avKey = key; const my = ++want;
  if (!figs[key] && !(hasChar(key) && akReady())) { put(null); fallback('Загружаю модель персонажа…'); }
  figure(key).then(a => {
    if (my !== want) return;   // another character was chosen meanwhile
    if (!a) { put(null); avKey = ''; fallback('Модель не загрузилась — в бою будет запасная фигура.'); return; }
    if (av !== a) yaw = Math.PI;   // the new character faces the visitor
    put(a); $('lobbyFallback').hidden = true;
    portraits();
  });
}

/* ---------- the portraits: one supersampled shot of each model in the same scene ----------
   Taken after the first figure stands on the pedestal, one at a time as the files come: each model prepared for the
   portrait's target beforehand, the shot itself in one task (the figure of the stage steps off the pedestal for it and
   is back before the next frame), its pixels read back without waiting for the GPU. Taken all at once before the first
   figure, they stopped the page for about three seconds. */
function portraits() {
  if (shots || !renderer) return; shots = true;
  const W = 400, H = 480, OW = 200, OH = 240;
  const rt = new THREE.WebGLRenderTarget(W, H);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const cam = new THREE.PerspectiveCamera(30, OW / OH, 0.1, 40);
  cam.position.set(0.8, 1.4, 4.4); cam.lookAt(0, 1.0, 0);
  const buf = new Uint8Array(W * H * 4);
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  const bctx = big.getContext('2d');
  const out = document.createElement('canvas'); out.width = OW; out.height = OH;
  const octx = out.getContext('2d');
  const made = [];   // disposed together at the end: the models of different characters may share programs
  async function shot(key) {
    if (!hasChar(key)) return;   // its file did not come: the card keeps the silhouette
    const a = makeAvatar(key); if (!a) return;
    made.push(a);
    a.update(0.016, IDLE);
    a.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    await prepare(a.root, cam, rt);
    const keep = av, keepYaw = spin.rotation.y;
    if (keep) spin.remove(keep.root);
    spin.add(a.root); spin.rotation.y = Math.PI + 0.35;
    renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null);
    spin.remove(a.root); spin.rotation.y = keepYaw;
    if (keep) spin.add(keep.root);
    await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, buf);
    const img = bctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    bctx.putImageData(img, 0, 0);
    octx.clearRect(0, 0, OW, OH); octx.drawImage(big, 0, 0, OW, OH);
    const c = cards[key];
    if (c) { c.img.src = out.toDataURL('image/png'); c.img.hidden = false; c.ph.hidden = true; }
  }
  let queue = Promise.resolve(), left = CHAR_KEYS.length;
  for (const key of CHAR_KEYS) Promise.all([loadChar(key), loadAK()]).then(() => {
    queue = queue.then(() => shot(key)).catch(e => console.error(e)).then(() => {
      if (--left) return;
      rt.dispose(); for (const a of made) disposeAvatar(a);
    });
  });
}

/* ---------- the cards and the reading under the stage ---------- */
function buildCards() {
  if (cardsBuilt) return; cardsBuilt = true;
  const box = $('lobbyChars');
  for (const key of CHAR_KEYS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'char-card'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
    b.innerHTML = `<span class="char-img"><span class="char-ph">${SIL}</span><img alt="" hidden></span><b></b><small></small><span class="char-check">✓</span>`;
    b.querySelector('b').textContent = CHARS[key].name;
    b.querySelector('small').textContent = (LORE[key] || {}).role || '';
    b.addEventListener('click', () => select(key));
    box.append(b);
    cards[key] = { el: b, img: b.querySelector('img'), ph: b.querySelector('.char-ph') };
  }
}
function select(key) {
  const sel = $('mpChar');
  if (sel.value === key) return;
  sel.value = key;
  sel.dispatchEvent(new Event('change'));
}
function refresh() {
  const key = curKey(), i = CHAR_KEYS.indexOf(key);
  for (const k of CHAR_KEYS) {
    const c = cards[k]; if (!c) continue;
    const on = k === key;
    c.el.classList.toggle('on', on); c.el.setAttribute('aria-checked', String(on));
  }
  const lore = LORE[key] || {};
  $('lobbyCharName').textContent = CHARS[key].name;
  $('lobbyCharDesc').textContent = lore.desc || '';
  $('lobbyCharMeta').textContent = `${lore.role || 'Боец'} · рост ${CHARS[key].height.toFixed(2).replace('.', ',')} м`;
  $('lobbyCount').textContent = `0${i + 1} / 0${CHAR_KEYS.length}`;
  showChar(key);
}
function cycle(d) {
  const i = CHAR_KEYS.indexOf(curKey());
  select(CHAR_KEYS[(i + d + CHAR_KEYS.length) % CHAR_KEYS.length]);
}

/* ---------- the ring, the glow and the chip: the amber of the free-for-all ---------- */
function teamInfo() { return { c: 0xf0b429, css: '#f0b429', label: 'Каждый сам за себя' }; }
function updateTeam() {
  const i = teamInfo();
  if (ring) ring.material.color.setHex(i.c);
  if (glow) glow.material.color.setHex(i.c);
  const chip = $('lobbyTeamChip');
  chip.querySelector('i').style.background = i.css;
  chip.querySelector('i').style.boxShadow = `0 0 8px ${i.css}`;
  chip.querySelector('b').textContent = i.label;
}

/* ---------- the segment buttons over the hidden selects ---------- */
const painters = [];
function bindSeg(segId, selId) {
  const seg = $(segId), sel = $(selId);
  const paint = () => { for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === sel.value); };
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    sel.value = b.dataset.v; sel.dispatchEvent(new Event('change'));
  });
  sel.addEventListener('change', paint);
  painters.push(paint);
  paint();
}
bindSeg('trLevelSeg', 'trLevel');
bindSeg('trTimeSeg', 'trTime');
$('mpChar').addEventListener('change', refresh);
$('lobbyPrev').addEventListener('click', () => cycle(-1));
$('lobbyNext').addEventListener('click', () => cycle(1));

/* ---------- the loop: only while the lobby is on screen ---------- */
function tick(t) {
  raf = requestAnimationFrame(tick);
  if (!open || !renderer || document.hidden || $('start').hidden) { lastT = t; return; }
  const dt = clamp((t - lastT) / 1000 || 0.016, 0.001, 0.05); lastT = t;
  if (!dragging && !reduceMotion && t - idleAt > 2600) yaw += dt * 0.28;
  spin.rotation.y = yaw;
  if (av) av.update(dt, IDLE);
  camera.position.set(0, 1.32, dist); camera.lookAt(0, 1.0, 0);
  renderer.render(scene, camera);
}

/* ---------- the match of the server: its live status on the online card ----------
   The lobby polls /health (server/index.mjs) from the first frame: the match of two hours (server/storm.mjs) — the
   fight, the storm of its last twenty minutes, the victory table — the door of its first half hour and the time to
   the next match. The home door «Играть онлайн» carries a live badge, the online card the full status; the countdowns
   tick every second between the polls. Past the first half hour the door still lets in whoever already plays in this
   match (a reload), so the button stays and changes its words; the server answers a stranger 'closed'. */
let matchPoll = 0, matchLast = null, matchAt = 0;
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss; };
async function matchStatus() {
  try {
    const r = await fetch(serverHttp() + '/health', { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    matchLast = j && j.ok && j.match ? j : null; matchAt = performance.now();
  } catch (e) { matchLast = null; }
  paintMatch();
}
function paintMatch() {
  const badge = $('chOnlineBadge'), box = $('matchStatus'), txt = $('matchStatusText'), go = $('goPlay');
  const j = matchLast;
  if (!j) { badge.hidden = true; box.dataset.phase = ''; txt.textContent = 'Статус катки недоступен — сервер не ответил'; go.textContent = 'Играть'; return; }
  const m = j.match, gone = performance.now() - matchAt, left = ms => Math.max(0, ms - gone), next = clock(left(m.left));
  const open = m.open && left(m.joinLeft) > 0, people = j.players + (j.bots ? ' + ботов ' + j.bots : '');
  const label = m.phase === 'storm' ? 'Шторм! ' + (j.storm ? j.storm.alive + ' в живых · ' : '') + 'вход закрыт · следующая катка через ' + next
    : m.phase === 'over' ? 'Катка завершена · следующая через ' + next
    : open ? 'Идёт бой · вход открыт ещё ' + clock(left(m.joinLeft)) + ' · шторм через ' + clock(left(m.stormIn))
    : 'Идёт бой · вход закрыт · шторм через ' + clock(left(m.stormIn)) + ' · следующая катка через ' + next;
  txt.textContent = label + ' · игроков: ' + people + (open || m.phase === 'over' ? '' : '. Если вы уже в этой катке — можно вернуться.');
  box.dataset.phase = open ? 'open' : m.phase;
  badge.hidden = false;
  badge.textContent = m.phase === 'storm' ? 'шторм' : open ? 'вход ' + clock(left(m.joinLeft)) : 'новая через ' + next;
  badge.dataset.phase = m.phase === 'storm' ? 'play' : open ? 'open' : 'wait';
  go.textContent = open ? 'Играть' : 'Вернуться в катку';
}
window.addEventListener('dpils-ready', paintMatch);
matchStatus(); matchPoll = setInterval(matchStatus, 10000);   // the poll lives from the first frame: the home door's badge must not wait for the lobby to open
setInterval(() => { if (matchLast && !$('start').hidden) paintMatch(); }, 1000);   // the countdowns tick between the polls

/* ---------- open / close (src/ui/start.js) ---------- */
function openLobby(s) {
  step = s; open = true;
  for (const p of painters) p();   // prepareUi restored the selects from localStorage without a 'change'
  buildCards(); ensureRenderer(); refresh(); updateTeam();   // the renderer first: the ring takes its colour, refresh asks for the figure
  if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
  if (!matchPoll) { matchStatus(); matchPoll = setInterval(matchStatus, 10000); }
}
function closeLobby() {
  open = false;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}

export { openLobby, closeLobby };
