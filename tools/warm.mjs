#!/usr/bin/env node
/* A warm headless browser for the view checks: the city is loaded ONCE and kept in memory, every following
   tools/shots.js run only moves the camera and takes pictures — seconds instead of a full load each time.

   Run: node tools/warm.mjs            (one port, WARM_PORT=8771 by default; VW/VH set the viewport)
   It serves the repository itself (three.js CDN addresses rewritten to node_modules, as in shot-items.mjs),
   loads the page, enters the free camera view (PERF.dyn off, P.fly on, HUD hidden) and answers on the same port:

     GET  /__warm/status          {ready, renderer, errs} — shots.js probes this and uses the warm page when ready
     GET  /__warm/shot?t=0|1|2|h<hour>&x=..&z=..&h=..&tx=..&tz=..&th=..&fov=60[&w=1100&vh=700]   → JPEG of the view
     GET  /__warm/errs            collected console errors/warnings since the last call (and clears them)
     POST /__warm/reload          reload the page (after changed data/src) and enter the free camera view again
     POST /__warm/eval            body: JS expression evaluated in the page, JSON result (for custom checks)

   Requests are served one at a time (a single page). State persists between shots: time, camera and whatever
   /__warm/eval changed — POST /__warm/reload returns a clean view. Stop with Ctrl+C or by killing the process. */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = +(process.env.WARM_PORT || 8771);
const VW = +(process.env.VW || 1100), VH = +(process.env.VH || 700);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

let page = null, ready = false, renderer = '';
const errs = [];
let busy = Promise.resolve();
const serial = fn => { const p = busy.then(fn); busy = p.catch(() => {}); return p; };   // one page — one job at a time

const enterView = () => page.evaluate(() => {   // the free camera of the tools: P.fly, no game (the walk mode was removed)
  document.getElementById('start').hidden = true;
  const c = window.__city; c.STATE.started = true; c.PERF.dyn = false; c.P.fly = true; document.getElementById('hud').hidden = true;
});
const waitCity = () => page.waitForFunction(() => window.__city, null, { timeout: 600000, polling: 500 });

async function shot(q) {
  const n = k => +(q.get(k) || 0);
  const t = q.get('t') || '0', x = n('x'), z = n('z'), h = n('h'), tx = n('tx'), tz = n('tz'), th = n('th'), fov = n('fov') || 60;
  const w = n('w') || VW, vh = n('vh') || VH;
  await page.setViewportSize({ width: w, height: vh });
  await page.evaluate(([t, x, z, h, tx, tz, th, fov]) => {
    const c = window.__city, P = c.P, g = c.terrainH(tx, tz);
    c.showTime(t); P.x = x; P.z = z; P.y = g + h; P.fly = true;
    const dx = tx - x, dz = tz - z;
    P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(g + th - P.y, Math.hypot(dx, dz));
    c.camera.fov = fov; c.camera.updateProjectionMatrix();
  }, [t, x, z, h, tx, tz, th, fov]);
  await page.evaluate(() => new Promise(r => { let k = 0; const f = () => (++k >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  return page.screenshot({ type: 'jpeg', quality: 84, timeout: 600000 });
}

const body = req => new Promise((res, rej) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => res(b)); req.on('error', rej); });
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/__warm/status') return json(res, { ready, renderer, errs: errs.length });
    if (u.pathname === '/__warm/errs') return json(res, errs.splice(0));   // available before ready too: to debug a stuck load
    if (u.pathname.startsWith('/__warm/')) {   // the control endpoints need the loaded city; static files below do not
      if (!ready) return json(res, { error: 'not ready' }, 503);
      if (u.pathname === '/__warm/shot') { const buf = await serial(() => shot(u.searchParams)); res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(buf); }
      if (u.pathname === '/__warm/reload' && req.method === 'POST') {
        await serial(async () => { ready = false; errs.length = 0; await page.reload({ waitUntil: 'load' }); await waitCity(); await enterView(); ready = true; });
        return json(res, { ok: true });
      }
      if (u.pathname === '/__warm/eval' && req.method === 'POST') { const code = await body(req); const result = await serial(() => page.evaluate(code)); return json(res, { result }); }
      return json(res, { error: 'unknown endpoint' }, 404);
    }
  } catch (e) { return json(res, { error: String(e.message || e).slice(0, 500) }, 500); }
  // static files of the repository (the page itself)
  let f = decodeURIComponent(u.pathname);
  if (f === '/') f = '/index.html';
  const p = path.join(ROOT, f);
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  let data = readFileSync(p);
  if (f === '/index.html') data = Buffer.from(data.toString('utf8')
    .replace('https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js', '/node_modules/three/build/three.module.js')
    .replace('https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/', '/node_modules/three/examples/jsm/'));
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(data);
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const launched = await launchBrowser();
renderer = launched.renderer;
page = await launched.browser.newPage({ viewport: { width: VW, height: VH } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', e => errs.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
await page.addInitScript(() => { try { localStorage.setItem('dpils-quality2', '1'); } catch (e) {} });   // the high quality setting
console.log(`warm: loading the city on http://127.0.0.1:${PORT}/ …`);
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
try { await waitCity(); } catch (e) { console.log('warm: LOAD FAIL\n' + errs.join('\n')); process.exit(2); }
await enterView();
ready = true;
console.log(`warm: ready on http://127.0.0.1:${PORT} (${launched.gpu ? 'GPU' : 'SwiftShader'}) — tools/shots.js will use it automatically`);
