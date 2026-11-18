#!/usr/bin/env node
/* Renders views of the city to JPEG files in a headless Chromium, and reports what the page wrote to the console as
   errors or warnings: the check of a change "in the browser" when no screen is at hand (a cloud session).

   Usage: node tools/shots.js <out dir> <time> <view> [<view> …]
     time  0 day, 1 evening, 2 night (as the "Время" button)
     view  name:x,z,h:tx,tz,th[:fov]
           x, z    the camera in the frame of the city (metres, x east, z south, Vienības laukums ≈ −1487, 1263);
           tx, tz  the point it looks at;
           h, th   heights of the camera and of that point above the ground AT THAT POINT (tx, tz), so both follow
                   the terrain; fov in degrees (60 by default).
   Example: node tools/shots.js shots 0 square:-1440,1300,25:-1487,1263,0:60 bridge:-1760,1640,15:-1690,1712,0
   From the latitude and longitude the page shows in the corner: x = (lon − 26.54) · 62438.48, z = (55.8825 − lat) · 111292.73,
   and a heading c (degrees, 0 north, 90 east) looks along (sin c, −cos c) in x, z.

   It needs a static server at the root of the repository (python3 -m http.server 8765 --bind 127.0.0.1, or set URL)
   and Playwright with a Chromium (npm i -D playwright && npx playwright install chromium, unless one is installed).
   WebGL runs on the GPU when one is available (tools/browser.js probes the renderer and falls back to SwiftShader
   on machines without a GPU, e.g. CI). On SwiftShader the city takes 3–5 minutes to build and each frame up to a
   few minutes: run one at a time, in the background, and give it time; on the GPU it is tens of seconds. VW and VH
   set the size (1100 × 700). The resolution of the picture does not follow the frame rate here (PERF.dyn off): it is
   drawn whole. */
'use strict';
const { launchBrowser } = require('./browser.js');
const URL = process.env.URL || 'http://127.0.0.1:8765/index.html';
(async () => {
  const [out, t, ...views] = process.argv.slice(2);
  if (!out || t === undefined || !views.length) { console.error('usage: node tools/shots.js <out dir> <time 0|1|2> name:x,z,h:tx,tz,th[:fov] …'); process.exit(1); }
  require('fs').mkdirSync(out, { recursive: true });
  const { browser: b } = await launchBrowser();
  const p = await b.newPage({ viewport: { width: +(process.env.VW || 1100), height: +(process.env.VH || 700) } });
  const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); }); p.on('pageerror', e => errs.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
  await p.addInitScript(() => { try { localStorage.setItem('dpils-quality2', '1'); } catch (e) {} });   // the high quality setting
  await p.goto(URL, { waitUntil: 'load' });
  try { await p.waitForFunction(() => window.__city, null, { timeout: 600000, polling: 500 }); } catch (e) { console.log('LOAD FAIL\n' + errs.join('\n')); await b.close(); process.exit(2); }
  await p.evaluate(t => { document.getElementById('go').click(); const c = window.__city; c.PERF.dyn = false; c.setTime(t); c.P.fly = true; document.getElementById('hud').hidden = true; }, +t);
  for (const v of views) {
    const [name, pos, tgt, fov] = v.split(':'), [x, z, h] = pos.split(',').map(Number), [tx, tz, th] = tgt.split(',').map(Number);
    await p.evaluate(([x, z, h, tx, tz, th, fov]) => { const c = window.__city, P = c.P, g = c.terrainH(tx, tz); P.x = x; P.z = z; P.y = g + h; const dx = tx - x, dz = tz - z;
      P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(g + th - P.y, Math.hypot(dx, dz)); c.camera.fov = fov; c.camera.updateProjectionMatrix(); }, [x, z, h, tx, tz, th, +fov || 60]);
    await p.evaluate(() => new Promise(r => { let n = 0; const f = () => (++n >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 84, timeout: 600000 }); console.log('shot', name);
  }
  if (errs.length) console.log('CONSOLE:\n' + [...new Set(errs)].slice(0, 20).join('\n'));
  await b.close();
})();
