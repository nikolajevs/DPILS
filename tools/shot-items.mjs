#!/usr/bin/env node
/* Headless check of the map items and the grenade: enters the training (bots in the page, no server), waits for the
   GLB props, walks the camera up to one item of each kind, then shoots the throw phase by phase (pin, ready, wind-up
   with the aim, release) and throws a grenade for real.
   PNGs land in OUT (default ./shots-items), console errors are printed.
   Run: node tools/shot-items.mjs   (playwright + chromium из ms-playwright, как в tools/shots.js) */
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.OUT || path.join(ROOT, '.claude', 'shots-items');   // .claude/ в .gitignore
const PORT = +(process.env.PORT || 8767);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const p = path.join(ROOT, u);
  if (!existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  let body = readFileSync(p);
  if (u === '/index.html') body = Buffer.from(body.toString('utf8')
    .replace('https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js', '/node_modules/three/build/three.module.js')
    .replace('https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/', '/node_modules/three/examples/jsm/'));
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
mkdirSync(OUT, { recursive: true });

const { browser } = await launchBrowser({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const cdp = await page.context().newCDPSession(page);
const shot = async f => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT, f), Buffer.from(data, 'base64')); };
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('PAGE ' + String(e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
page.on('requestfailed', r => errs.push('FAIL ' + r.url() + ' ' + (r.failure() || {}).errorText));
await page.goto('http://127.0.0.1:' + PORT + '/');
await page.waitForFunction(() => window.__city && window.__city.STATE, null, { timeout: 240000, polling: 500 });
await page.waitForFunction(() => !document.getElementById('goTrain').disabled, null, { timeout: 120000, polling: 500 });
await page.evaluate(() => { document.getElementById('trBots').value = '0'; document.getElementById('goTrain').click(); });
await page.waitForFunction(() => window.__city.STATE.mp, null, { timeout: 60000, polling: 500 });
// the props arrived: at least one item carries a shared (GLB) mesh
await page.waitForFunction(() => { let ok = false; window.__city.scene.traverse(o => { if (o.userData && o.userData.shared) ok = true; }); return ok; }, null, { timeout: 90000, polling: 500 });
await page.waitForTimeout(2500);

for (const kind of ['ammo', 'med', 'nade']) {
  const at = await page.evaluate(k => {
    const C = window.__city; let g = null;
    C.scene.traverse(o => { if (!g && o.userData && o.userData.item === k) g = o; });
    if (!g) return null;
    const x = g.position.x - 1.4, z = g.position.z - 1.4, y = C.terrainH(x, z) + 1.7;
    // сервер откатывает быстрые телепорты ('correct'), поэтому переставляем игрока и в локальной игре сразу
    const me = [...C.MP.ws.game.players.values()].find(p => !p.bot);
    if (me) { me.x = x; me.z = z; me.y = y; me.hist = []; }
    C.P.x = x; C.P.z = z; C.P.y = y; C.P.eye = 1.7; C.P.vy = 0;
    C.P.yaw = Math.atan2(-1.4, -1.4); C.P.pitch = -0.5;   // камера смотрит в (-sin yaw, -cos yaw)
    return [g.position.x, g.position.z];
  }, kind);
  if (!at) { console.log(kind, 'NOT FOUND'); continue; }
  // ждём настоящий кадр после перестановки (на программном рендере кадров почти нет)
  await page.waitForFunction(() => {
    const C = window.__city;
    return Math.hypot(C.camera.position.x - C.P.x, C.camera.position.z - C.P.z) < 0.6;
  }, null, { timeout: 60000, polling: 250 });
  await page.waitForTimeout(1200);
  await shot(`game-${kind}.png`);
  console.log(kind, 'item at', at);
}
// the throw, phase by phase: G takes the grenade in hand; MP.nadePose holds the arms still in one moment of it
// (t: seconds in hand, pw: the charge, rel: seconds since the release) — the pin coming out, held ready, wound up full
// (with the arc and the disc of the blast), the whip of the release. Charging needs the pointer lock, which headless has
// not — set STATE.locked by hand
await page.evaluate(() => {
  window.__city.P.pitch = 0.12; window.__city.STATE.locked = true;
  window.__city.MP.nadePose = { t: 0.1, pw: 0, rel: -1, pwRel: 0 };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG' }));
});
for (const [f, pose] of [['pin', { t: 0.3, pw: 0, rel: -1, pwRel: 0 }], ['ready', { t: 2, pw: 0, rel: -1, pwRel: 0 }], ['windup', { t: 2, pw: 1, rel: -1, pwRel: 0 }], ['release', { t: 9, pw: 0, rel: 0.05, pwRel: 1 }]]) {
  await page.evaluate(p => { window.__city.MP.nadePose = p; }, pose);
  await page.waitForTimeout(2500);
  await shot(`game-nade-${f}.png`);
}
// then a real throw at full charge, caught in flight: held LMB charges (the arcs round the crosshair), release throws
await page.evaluate(() => {
  window.__city.MP.nadePose = null;
  document.querySelector('canvas').dispatchEvent(new MouseEvent('mousedown', { button: 0 }));   // слушатель заряда — на canvas
});
await page.waitForFunction(() => document.getElementById('nadeUi').dataset.full === '1', null, { timeout: 60000, polling: 250 });
await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })));
const fly = await page.evaluate(() => {
  let n = 0; window.__city.scene.traverse(o => {
    if (!(o.userData && o.userData.shared)) return;
    for (let a = o; a; a = a.parent) if (a.userData && a.userData.item) return;
    n++;
  });
  return n;
});
await shot('game-nade-fly.png');
console.log('flying grenade model meshes:', fly);
console.log('console errors:', errs.filter(e => !/favicon/.test(e)));
await browser.close();
srv.close();
