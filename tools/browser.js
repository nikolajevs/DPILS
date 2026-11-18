'use strict';
/* Shared headless-browser launch for the tools: GPU first, SwiftShader only as a fallback.

   A headless Chromium CAN use the real GPU (on Windows via ANGLE/D3D11); the old default of these tools was
   SwiftShader, which renders ~1 fps. We now try the GPU first and probe the actual WebGL renderer: if it is a
   software one (SwiftShader/llvmpipe — a CI runner without a video card) or WebGL is unavailable, we relaunch
   with the explicit SwiftShader flags, so the tools keep working everywhere.

   launchBrowser({ args, software, ...launchOpts }) -> { browser, gpu, renderer }
     args      extra Chromium flags, passed through;
     software  true forces SwiftShader — for tests that deliberately check the low-fps behaviour;
     DPILS_GPU=0 in the environment does the same; CHROME_PATH sets the browser executable.
   If the Playwright registry expects a browser build that is not installed ("Executable doesn't exist"), the
   newest installed chromium-* under the Playwright browsers dir is picked instead (full chrome.exe preferred:
   its new headless mode uses the GPU even without flags).

   On hybrid Windows laptops (Intel iGPU + NVIDIA dGPU) the OS hands browsers the power-saving adapter by
   default, so headless would render on the iGPU. Before a GPU launch we pin the Playwright chromium exes to
   the high-performance GPU via the per-app DirectX preference (HKCU\...\UserGpuPreferences, GpuPreference=2 —
   the same switch as Settings > Display > Graphics, no admin rights needed). Only test chromium exes are
   touched, only when no preference exists yet; the user's own browser is left alone. DPILS_GPU_PREF=0 skips
   the pin. A warm browser (tools/warm.mjs) started before the pin keeps its old adapter until restarted. */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SW_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|software|Basic Render/i;

function findChrome() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
    : path.join(process.env.HOME || '', '.cache', 'ms-playwright'));
  let best = null, bestN = -1;
  try {
    for (const d of fs.readdirSync(root)) {
      const m = /^chromium-(\d+)$/.exec(d);
      if (!m) continue;
      const exe = process.platform === 'win32'
        ? path.join(root, d, 'chrome-win64', 'chrome.exe')
        : path.join(root, d, 'chrome-linux', 'chrome');
      if (+m[1] > bestN && fs.existsSync(exe)) { best = exe; bestN = +m[1]; }
    }
  } catch (e) { /* no browsers dir */ }
  return best;
}

function preferHighPerfGpu(exes) {
  if (process.platform !== 'win32' || process.env.DPILS_GPU_PREF === '0') return;
  const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
  for (const exe of new Set(exes.filter(Boolean))) {
    try {
      if (!fs.existsSync(exe)) continue;
      try { execFileSync('reg', ['query', key, '/v', exe], { stdio: 'ignore' }); continue; } catch (e) { /* no preference yet */ }
      execFileSync('reg', ['add', key, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { stdio: 'ignore' });
      console.log('browser: pinned to the high-performance GPU (UserGpuPreferences) — ' + exe);
    } catch (e) { /* registry unavailable — keep the OS default adapter */ }
  }
}

async function probeRenderer(browser) {
  const p = await browser.newPage();
  try {
    return await p.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return '';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
  } finally { await p.close().catch(() => {}); }
}

async function launchBrowser(opts = {}) {
  const { args = [], software = false, ...rest } = opts;
  const forceSw = software || process.env.DPILS_GPU === '0';
  const exe = rest.executablePath || process.env.CHROME_PATH || undefined;
  const gpuArgs = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
  if (!forceSw) {
    let expected = ''; try { expected = chromium.executablePath(); } catch (e) { /* older playwright */ }
    preferHighPerfGpu([exe, expected, findChrome()]);
  }
  const tryLaunch = (extra, executablePath) => chromium.launch({ headless: true, ...rest, executablePath, args: [...extra, ...args] });
  const launchAny = async extra => {
    try { return await tryLaunch(extra, exe); }
    catch (e) {
      if (!/Executable doesn't exist/i.test(String(e.message))) throw e;
      const found = findChrome();
      if (!found) throw e;
      return tryLaunch(extra, found);
    }
  };

  let b = null, renderer = '', gpu = false;
  if (!forceSw) {
    b = await launchAny(['--ignore-gpu-blocklist', ...gpuArgs]);
    renderer = await probeRenderer(b).catch(() => '');
    gpu = !!renderer && !SOFTWARE.test(renderer);
    if (!gpu) { await b.close().catch(() => {}); b = null; }   // no usable GPU here — fall back to SwiftShader
  }
  if (!b) {
    b = await launchAny(SW_ARGS);
    renderer = await probeRenderer(b).catch(() => '');
    gpu = false;
  }
  console.log('browser: ' + (gpu ? 'GPU' : 'SwiftShader (software)') + (renderer ? ' — ' + renderer : ''));
  return { browser: b, gpu, renderer };
}

module.exports = { launchBrowser };
