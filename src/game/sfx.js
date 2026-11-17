/* ---------- the recorded sounds of the game ----------
   Two CC0 sets live in sounds/ (see sounds/README.md):
   – MP3: the gunshots and the hits of The Free Firearm Sound Library and Freesound, cut by tools/sounds.py;
   – OGG: the steps, the debris of a hit by the material of the surface and the explosion of a grenade, by Kenney
     (www.kenney.nl, "Impact Sounds" and "RPG Audio", CC0). Chrome and Firefox decode OGG themselves; where a browser
     cannot (Safari) the buffer simply stays absent and the caller plays its own synthesis, as before the recordings.
   Every function returns false when its buffers have not come yet: mp.js then synthesises the sound itself. */
const GUN = ['ak', 'sg', 'sn', 'pi', 'mg'];
const NAMES = [...GUN.flatMap(g => [g + '-1', g + '-2', g + '-far']), 'hit-body-1', 'hit-body-2', 'hit-body-3', 'hit-body-4', 'hit-head', 'hit-wall-1', 'hit-wall-2', 'hit-wall-3', 'hit-ground', 'ricochet', 'crack-1', 'crack-2'];
// the families of Kenney: five variants each (the explosion four, plus two low rumbles)
const FAM = { 'step-concrete': 'footstep_concrete', 'step-grass': 'footstep_grass', 'debris-wood': 'impactWood_medium', 'debris-stone': 'impactMining', 'debris-concrete': 'impactGeneric_light', 'debris-metal': 'impactMetal', 'debris-soft': 'impactSoft_medium' };
const OGG = [...Object.values(FAM).flatMap(f => [0, 1, 2, 3, 4].map(i => f + '_00' + i)), ...[0, 1, 2, 3].map(i => 'explosionCrunch_00' + i), ...[0, 1].map(i => 'lowFrequency_explosion_00' + i)];
const BUF = new Map();
function loadSounds(ctx) {
  if (BUF.size || !ctx) return;
  const grab = (name, ext) => fetch('sounds/' + name + '.' + ext).then(r => { if (!r.ok) throw new Error(name); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b)).then(buf => BUF.set(name, buf)).catch(() => {});
  for (const n of NAMES) grab(n, 'mp3');
  for (const n of OGG) grab(n, 'ogg');
}
// one buffer: its volume, side, dullness with distance, delay (the speed of sound) and pitch
function pl(ctx, out, buf, o = {}) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = o.rate ?? 1;
  const g = ctx.createGain(); g.gain.value = o.vol ?? 1;
  let head = s;
  if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; head.connect(f); head = f; }
  head.connect(g);
  let tail = g;
  if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); tail = p; }
  tail.connect(out); s.start(ctx.currentTime + (o.delay ?? 0));
}
const lpFor = d => Math.min(18000, 16000 / (1 + d * 0.06));   // the air eats the highs with distance
const snd = (ctx, out, name, o) => { const b = BUF.get(name); if (!b) return false; pl(ctx, out, b, o); return true; };
const pick = (fam, n = 5) => fam + '_00' + Math.floor(Math.random() * n);
// a shot of weapon w heard at distance d from the side pan: near — one of the two close recordings, far — the tail
function shotSound(ctx, out, w, vol = 1, d = 0, pan = 0) {
  const g = GUN[w] || 'ak', near = d < 90, name = near ? g + '-' + (1 + Math.floor(Math.random() * 2)) : g + '-far';
  return snd(ctx, out, name, { vol, pan, lp: near ? lpFor(d) : Math.min(2600, lpFor(d)), delay: d / 340, rate: 0.97 + Math.random() * 0.06 });
}
// a bullet past the head: the crack of the shock wave (no distance delay — it is born at the ear)
function crackSound(ctx, out, vol = 1, pan = 0) {
  return snd(ctx, out, 'crack-' + (1 + Math.floor(Math.random() * 2)), { vol, pan, rate: 0.9 + Math.random() * 0.25 });
}
// a hit: kind 'body' | 'head' | 'wall' | 'ground'; mat tells what the bullet met — 'wood', 'stone', 'concrete',
// 'metal' for a wall, 'grass' or 'road' for the ground: the recorded thud gets a layer of the debris of that material
function hitSound(ctx, out, kind, vol = 1, d = 0, pan = 0, mat = '') {
  let played = false;
  if (kind === 'body') played = snd(ctx, out, 'hit-body-' + (1 + Math.floor(Math.random() * 4)), { vol, pan, lp: lpFor(d), delay: d / 340, rate: 0.92 + Math.random() * 0.16 });
  else if (kind === 'head') played = snd(ctx, out, 'hit-head', { vol, pan, lp: lpFor(d), delay: d / 340, rate: 0.95 + Math.random() * 0.1 });
  else if (kind === 'ground') {
    played = snd(ctx, out, 'hit-ground', { vol, pan, lp: lpFor(d), delay: d / 340, rate: 0.9 + Math.random() * 0.2 });
    if (mat === 'grass') snd(ctx, out, pick(FAM['debris-soft']), { vol: vol * 0.5, pan, lp: 1200, delay: d / 340 + 0.01, rate: 0.9 + Math.random() * 0.2 });
    else if (mat === 'road') snd(ctx, out, pick(FAM['debris-concrete']), { vol: vol * 0.35, pan, lp: lpFor(d), delay: d / 340 + 0.01, rate: 0.95 + Math.random() * 0.15 });
  } else {
    played = snd(ctx, out, 'hit-wall-' + (1 + Math.floor(Math.random() * 3)), { vol, pan, lp: lpFor(d), delay: d / 340, rate: 0.9 + Math.random() * 0.2 });
    const fam = FAM['debris-' + (mat || 'concrete')] || FAM['debris-concrete'];
    snd(ctx, out, pick(fam), { vol: vol * 0.55, pan, lp: lpFor(d), delay: d / 340 + 0.015, rate: 0.9 + Math.random() * 0.2 });
    if (Math.random() < 0.18) snd(ctx, out, 'ricochet', { vol: vol * 0.5, pan, lp: lpFor(d), delay: d / 340 + 0.02, rate: 0.85 + Math.random() * 0.3 });
  }
  return played;
}
// a step on concrete or grass: one of the five recordings, a little different each time; low — the thud of a landing
function stepSound(ctx, out, surf = 'concrete', vol = 0.1, pan = 0, low = false) {
  const fam = FAM['step-' + (surf === 'grass' ? 'grass' : 'concrete')];
  return snd(ctx, out, pick(fam), { vol, pan, lp: low ? 420 : (surf === 'grass' ? 950 : 1700) * (0.85 + Math.random() * 0.3), rate: (low ? 0.7 : 0.9) + Math.random() * 0.2 });
}
// the explosion of a grenade: the crunch of the blast and the low rumble under it, duller and later with distance
function boomSound(ctx, out, vol = 1, d = 0, pan = 0) {
  const delay = d / 340;
  let played = snd(ctx, out, pick('explosionCrunch', 4), { vol, pan, lp: Math.min(9000, 7000 / (1 + d * 0.04)), delay, rate: 0.9 + Math.random() * 0.15 });
  if (played) snd(ctx, out, pick('lowFrequency_explosion', 2), { vol: vol * 0.9, pan, lp: 340, delay: delay + 0.02, rate: 0.9 + Math.random() * 0.1 });
  return played;
}
export { boomSound, crackSound, hitSound, loadSounds, shotSound, stepSound };
