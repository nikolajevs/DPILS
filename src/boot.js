/* Entry point of the page. The data of the city are plain scripts that set window.CITY, TRANSIT, FORTRESS, TERRAIN
   and SCHOOLS (written by the tools in tools/). They are downloaded first, with the megabytes shown on the loading
   bar, run in their old order, and only then are the modules that build the city loaded: they read the data while
   they are evaluated. */
import { PHASE, loading } from './ui/loading.js';

// the files and their sizes, used for the bar only until the server tells the real size (it does not when it
// compresses them on the fly, as GitHub Pages does)
const FILES = [['citydata.js', 4.33e6], ['transit.js', 2.7e5], ['fortress.js', 2.6e4], ['terrain.js', 1.07e6], ['schools.js', 3.4e4]];
const mb = n => (n / 1048576).toLocaleString('ru', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
