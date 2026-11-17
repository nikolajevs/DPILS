/* ---------- the recorded sounds of the shooter ----------
   Real recordings (CC0, sources in sounds/README.md, cut by tools/sounds.py): the shot of each gun (two takes recorded next to
   the shooter, stereo, for your own gun and the near ones; one from farther, mono, for the far ones), the bullet hitting a body or
   a head, a wall or the ground, a ricochet and the crack of a bullet flying past. They are loaded when the game starts; until they
   come (or if they do not), the game plays its old synthetic sounds: every function here answers false then. */
const GUN = ['ak', 'sg', 'sn', 'pi', 'mg'];   // in the order of WEAPONS in mp.js
const NAMES = [...GUN.flatMap(g => [g + '-1', g + '-2', g + '-far']), 'hit-body-1', 'hit-body-2', 'hit-body-3', 'hit-body-4', 'hit-head',
  'hit-wall-1', 'hit-wall-2', 'hit-wall-3', 'hit-ground', 'ricochet', 'crack-1', 'crack-2'];
const BUF = new Map();
let loading = null;

function loadSounds(ctx) {
  if (!loading) loading = Promise.all(NAMES.map(n => fetch('sounds/' + n + '.mp3').then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(n)))
    .then(a => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then(b => { BUF.set(n, b); }).catch(() => {})));
  return loading;
}

// one sound: o.vol, o.pan (-1 left … 1 right), o.lp (low-pass, Hz: far sounds lose their highs), o.delay (s), o.rate
function play(ctx, out, name, o = {}) {
  const b = BUF.get(name); if (!b) return false;
  const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = o.rate || 1;
  let n = s;
  if (o.lp && o.lp < 16000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; n.connect(f); n = f; }
  const g = ctx.createGain(); g.gain.value = o.vol ?? 1; n.connect(g); n = g;
  if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); n.connect(p); n = p; }
  n.connect(out); s.start(ctx.currentTime + (o.delay || 0));
  return true;
}
const take = (base, n) => base + '-' + (1 + Math.floor(Math.random() * n));
const vary = () => 0.96 + Math.random() * 0.08;   // no two shots quite the same
const far = d => Math.max(700, 18000 * Math.exp(-d / 110));   // how much of the highs is left after d metres of air

// a shot: your own (d = 0) or someone's at distance d m; the sound of a far shot comes later, at the speed of sound
function shotSound(ctx, out, w, vol, d = 0, pan = 0) {
  const g = GUN[w] || GUN[0];
  if (d < 25) return play(ctx, out, take(g, 2), { vol, pan: pan * Math.min(1, d / 8), rate: vary(), lp: d > 3 ? far(d) : 0, delay: d / 343 });
  return play(ctx, out, g + '-far', { vol, pan, rate: vary(), lp: far(d), delay: d / 343 });
}
// a bullet hits something: 'body', 'head', 'wall', 'ground'; a wall sometimes rings with a ricochet
function hitSound(ctx, out, kind, vol, d = 0, pan = 0) {
  const o = { vol, pan, rate: vary(), lp: far(d * 3), delay: d / 343 };
  if (kind === 'body') return play(ctx, out, take('hit-body', 4), o);
  if (kind === 'head') return play(ctx, out, 'hit-head', o);
  if (kind === 'ground') return play(ctx, out, Math.random() < 0.5 ? 'hit-ground' : take('hit-wall', 3), o);
  const ok = play(ctx, out, take('hit-wall', 3), o);
  if (ok && d < 20 && Math.random() < 0.3) play(ctx, out, 'ricochet', { ...o, vol: vol * 0.6, delay: o.delay + 0.03 });
  return ok;
}
// the crack of a bullet passing close to your head
const crackSound = (ctx, out, vol, pan) => play(ctx, out, take('crack', 2), { vol, pan, rate: vary() });

export { crackSound, hitSound, loadSounds, shotSound };
