/* Headless check of the graphics quality setting (auto / fixed). Run: node tools/queries/quality-mode-test.mjs
   Needs the built page served at 127.0.0.1:4173 (vite preview --host 127.0.0.1). SwiftShader: ~1 fps, so every
   wait is a waitForFunction, clicks and selects go through page.evaluate. */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:4173/';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : '')); };

const browser = await chromium.launch({
  executablePath: 'C:/Users/igors/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 300000 });
ok('город загрузился', true);

const ev = (fn, ...a) => page.evaluate(fn, ...a);
const state = () => ev(() => ({
  mode: window.__city.qualityMode(),
  btn: document.getElementById('bQuality').textContent,
  pr: window.__city.renderer.getPixelRatio(),
  shadows: window.__city.renderer.shadowMap.enabled,
  scale: window.__city.PP.scale,
  lvl: localStorage.getItem('dpils-quality2'),
  modeLS: localStorage.getItem('dpils-quality-mode')
}));

// 1. defaults: auto
let s = await state();
ok('по умолчанию авто', s.mode === 'auto' && s.btn === 'Графика: авто', JSON.stringify(s));

// 2. start the walk, open settings, the graphics group is there
await ev(() => document.getElementById('go').click());
await ev(() => document.getElementById('bSet').click());
const panel = await ev(() => {
  const sel = document.querySelector('#mpSetBody .set-row.sel select');
  const hints = [...document.querySelectorAll('#mpSetBody .set-hint')].map(p => p.textContent);
  const h = [...document.querySelectorAll('#mpSetBody h3')].map(x => x.textContent);
  return { has: !!sel, opts: sel ? [...sel.options].map(o => o.value + ':' + o.textContent) : [], val: sel ? sel.value : null, hints, h };
});
ok('группа «Графика» в настройках', panel.has && panel.h.includes('Графика') && panel.val === 'auto', JSON.stringify(panel));
ok('5 вариантов: авто + 4 уровня', panel.opts.length === 5 && panel.opts[0] === 'auto:Авто', panel.opts.join(', '));

// 3. choose a fixed level (низкая = 2)
await ev(() => { const sel = document.querySelector('#mpSetBody .set-row.sel select'); sel.value = '2'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
s = await state();
ok('фиксированная низкая применена', s.mode === 2 && s.btn === 'Графика: низкая' && s.pr === 1 && s.shadows === false && s.modeLS === 'fixed' && s.lvl === '2', JSON.stringify(s));
const cur = await ev(() => [...document.querySelectorAll('#mpSetBody .set-hint')].map(p => p.textContent).join(' | '));
ok('строка «Сейчас: низкая · фиксированное»', cur.includes('Сейчас: низкая') && cur.includes('фиксированное'), cur);

// 4. fixed quality keeps the resolution whole even at ~1 fps
await page.waitForTimeout(8000);
s = await state();
ok('фиксированное: разрешение не падает (scale=1)', s.scale === 1, 'scale=' + s.scale);

// 5. the toolbar button cycles and the open panel follows
await ev(() => document.getElementById('bQuality').click());
s = await state();
const selVal = await ev(() => document.querySelector('#mpSetBody .set-row.sel select').value);
ok('клик кнопки: низкая → минимум', s.mode === 3 && s.btn === 'Графика: минимум' && s.pr === 0.7 && selVal === '3', JSON.stringify(s) + ' sel=' + selVal);
await ev(() => document.getElementById('bQuality').click());
s = await state();
const selVal2 = await ev(() => document.querySelector('#mpSetBody .set-row.sel select').value);
ok('клик кнопки: минимум → авто', s.mode === 'auto' && s.btn === 'Графика: авто' && s.modeLS === 'auto' && selVal2 === 'auto', JSON.stringify(s) + ' sel=' + selVal2);

// 6. auto: dynamic resolution works again at ~1 fps
await ev(() => document.getElementById('mpSetClose').click());
await page.waitForFunction(() => window.__city.PP.scale < 1, null, { timeout: 60000 });
ok('авто: разрешение подстраивается (scale<1)', true, 'scale=' + (await state()).scale);

// 7. reset returns to auto
await ev(() => document.getElementById('bSet').click());
await ev(() => document.getElementById('mpSetReset').click());
s = await state();
const selVal3 = await ev(() => document.querySelector('#mpSetBody .set-row.sel select').value);
ok('сброс настроек → авто', s.mode === 'auto' && selVal3 === 'auto', JSON.stringify(s));
await ev(() => document.getElementById('mpSetClose').click());

// 8. in the fight auto lowers the level by itself under the low fps
await ev(() => { window.__city.setQualityMode('auto'); window.__city.setQuality(0); });   // start the fight from the top level
await ev(() => document.getElementById('chTrain').click());
await ev(() => document.getElementById('goTrain').click());
await page.waitForFunction(() => window.__city.STATE.mp, null, { timeout: 180000 });
ok('тренировка началась', true);
await page.waitForFunction(() => localStorage.getItem('dpils-quality2') === '3' && window.__city.qualityMode() === 'auto', null, { timeout: 180000 });
s = await state();
const feed = await ev(() => document.getElementById('mpFeed').textContent);
ok('авто снизило графику до минимума', s.mode === 'auto' && s.btn === 'Графика: авто' && s.lvl === '3', JSON.stringify(s));
ok('сообщение о снижении в ленте', feed.includes('Графика снижена'), feed.slice(0, 200));

// 9. fixed mode in the fight: no auto lowering
await ev(() => { window.__city.setQualityMode(1); });
const lvlBefore = (await state()).lvl;
await page.waitForTimeout(25000);
s = await state();
ok('фиксированная в бою не меняется', s.mode === 1 && s.lvl === lvlBefore && s.scale === 1, JSON.stringify(s));

try { await page.screenshot({ path: 'tools/queries/quality-mode.png', timeout: 60000 }); ok('скриншот снят', true); } catch (e) { ok('скриншот снят', false, e.message.slice(0, 120)); }

const realErrors = errors.filter(t => !/favicon|404|net::ERR/i.test(t));
ok('ошибок консоли нет', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));

await browser.close();
const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);