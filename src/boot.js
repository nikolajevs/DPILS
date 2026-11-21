/* Entry point of the page. The data of the city are plain scripts that set window.CITY, TRANSIT, FORTRESS, TERRAIN,
   SCHOOLS, PARKS, LIDAR, LIDAR_TREES, TRAINS, INTERCITY, PARKING and YARDS (written by the tools in tools/). They are
   downloaded first, with the megabytes shown on the loading bar, run in their old order, and only then are the modules
   that build the city loaded: they read the data while they are evaluated. */
import { PHASE, loading } from './ui/loading.js';
// the login gate is the first stage of the page: it opens here, before the city data are downloaded, so a new visitor
// sees the login screen first and the start card (loading bar, «Играть» buttons) only after a successful login.
// auth.js needs no city data (it does not import core/env.js), so it can run this early; main.js imports it too, but
// the module is evaluated once — the gate it opens here stays until the login succeeds.
import './ui/auth.js';

// the files and their sizes, used for the bar only until the server tells the real size (it does not when it
// compresses them on the fly, as GitHub Pages does)
const FILES = [['citydata.js', 4.33e6], ['transit.js', 2.7e5], ['fortress.js', 2.6e4], ['terrain.js', 1.07e6], ['schools.js', 3.4e4], ['parks.js', 8.4e4], ['lidar.js', 3.3e5], ['lidar-trees.js', 1.18e6], ['trains.js', 2.2e4], ['intercity.js', 2.8e5], ['parking.js', 7e4], ['yards.js', 1e4]];
const mb = n => (n / 1048576).toLocaleString('ru', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/* The signs of the landmarks are drawn on canvases in Golos Text, with the Latvian letters (Ā, Ē, Ī, Ģ…) of its
   latin-ext part, which nothing on the start card uses. The browser asked for that file only when the first sign was
   drawn, in the middle of the build: the letters of the signs came out in a fallback font, and the font arrived while
   the page was busy, the text of the card laid out anew. The parts the canvases use are asked for with the data, and
   the build waits for them (three seconds at most). */
const FONTS = document.fonts && document.fonts.load
  ? Promise.all(['400', '500', '600'].map(w => document.fonts.load(`${w} 16px "Golos Text"`, 'ĀāČčĒēĢģĪīĶķĻļŅņŠšŪūŽž'))).catch(() => {})
  : Promise.resolve();

async function download() {
  const got = FILES.map(() => 0), size = FILES.map(f => f[1]);
  let shownAt = 0;
  const update = force => {
    const now = performance.now(); if (!force && now - shownAt < 60) return; shownAt = now;
    const g = got.reduce((a, b) => a + b, 0), t = size.reduce((a, b) => a + b, 0);
    loading.part(g / t, `Загружаю данные города: ${mb(g)} из ${mb(t)} МБ`);
  };
  const texts = await Promise.all(FILES.map(async ([name], k) => {
    const r = await fetch(name);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    const len = +r.headers.get('content-length');
    if (len > 0 && !r.headers.get('content-encoding')) size[k] = len;
    if (!r.body || !r.body.getReader) { const t = await r.text(); got[k] = size[k] = t.length; update(true); return t; }
    const reader = r.body.getReader(), parts = [];
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      parts.push(value); got[k] += value.length; if (got[k] > size[k]) size[k] = got[k]; update(false);
    }
    size[k] = got[k]; update(true);
    const all = new Uint8Array(got[k]); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    return new TextDecoder().decode(all);
  }));
  return texts;
}

(async () => {
  try {
    await loading.step('Загружаю данные города…', PHASE.data[0], PHASE.data[1], 0, true);
    let texts;
    try { texts = await download(); }
    catch (e) { console.error(e); loading.fail('Не удалось загрузить данные города — проверьте подключение к интернету и обновите страницу.'); return; }
    await Promise.race([FONTS, new Promise(r => setTimeout(r, 3000))]);
    await loading.step('Читаю данные и загружаю код…', PHASE.code[0], PHASE.code[1], 400);
    FILES.forEach(([name], k) => { const s = document.createElement('script'); s.text = texts[k] + '\n//# sourceURL=' + name; document.head.appendChild(s); });
    texts = null;
    await import('./main.js');
  } catch (e) {
    console.error(e);
    // a module that cannot go on (no WebGL, no data) has already said why on the card
    if (e && e.message === 'the city cannot be built') loading.fail(document.getElementById('progress').textContent);
    else loading.fail('Ошибка при загрузке: ' + (e && e.message || e));
  }
})();
