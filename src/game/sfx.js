/* ---------- the recorded sounds of the game ----------
   Two CC0 sets live in sounds/ (see sounds/README.md):
   – MP3: the gunshots and the hits of The Free Firearm Sound Library and Freesound, cut by tools/sounds.py;
   – OGG: the steps, the debris of a hit by the material of the surface and the explosion of a grenade, by Kenney
     (www.kenney.nl, "Impact Sounds" and "RPG Audio", CC0). Chrome and Firefox decode OGG themselves; where a browser
     cannot (Safari) the buffer simply stays absent and the caller plays its own synthesis, as before the recordings.
   Every function returns false when its buffers have not come yet: mp.js then synthesises the sound itself. */
const GUN = ['ak', 'sg', 'sn', 'pi', 'mg', 'mg', 'ak', 'mg'];   // the new rifles share the recorded families: the 5.56 M4A1 and AR-15 the Minimi's crack, the heavier SCAR-L the AK's punch
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
// a hit: kind 'body' | 'head' | 'wall' | 'ground' | 'metal' (a car); mat tells what the bullet met — 'wood', 'stone', 'concrete',
// 'metal' for a wall, 'grass' or 'road' for the ground: the recorded thud gets a layer of the debris of that material
function hitSound(ctx, out, kind, vol = 1, d = 0, pan = 0, mat = '') {
  let played = false;
  if (kind === 'body') played = snd(ctx, out, 'hit-body-' + (1 + Math.floor(Math.random() * 4)), { vol, pan, lp: lpFor(d), delay: d / 340, rate: 0.92 + Math.random() * 0.16 });
  else if (kind === 'head') played = snd(ctx, out, 'hit-head', { vol, pan, lp: lpFor(d), delay: d / 340, rate: 0.95 + Math.random() * 0.1 });
  else if (kind === 'ground') {
    played = snd(ctx, out, 'hit-ground', { vol, pan, lp: lpFor(d), delay: d / 340, rate: 0.9 + Math.random() * 0.2 });
    if (mat === 'grass') snd(ctx, out, pick(FAM['debris-soft']), { vol: vol * 0.5, pan, lp: 1200, delay: d / 340 + 0.01, rate: 0.9 + Math.random() * 0.2 });
    else if (mat === 'road') snd(ctx, out, pick(FAM['debris-concrete']), { vol: vol * 0.35, pan, lp: lpFor(d), delay: d / 340 + 0.01, rate: 0.95 + Math.random() * 0.15 });
  } else if (kind === 'metal') {   // a bullet into a car: the ring of sheet metal, two pitches, now and then a whine off the body
    const dl = d / 340;
    played = snd(ctx, out, pick(FAM['debris-metal']), { vol: vol * 1.2, pan, lp: lpFor(d), delay: dl, rate: 0.85 + Math.random() * 0.4 });
    snd(ctx, out, pick(FAM['debris-metal']), { vol: vol * 0.7, pan, lp: lpFor(d), delay: dl + 0.035, rate: 1.2 + Math.random() * 0.5 });
    snd(ctx, out, 'hit-wall-' + (1 + Math.floor(Math.random() * 3)), { vol: vol * 0.35, pan, lp: Math.min(900, lpFor(d)), delay: dl, rate: 0.8 });
    if (Math.random() < 0.45) snd(ctx, out, 'ricochet', { vol: vol * 0.6, pan, lp: lpFor(d), delay: dl + 0.03, rate: 0.85 + Math.random() * 0.3 });
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
// the explosion of a grenade: the crunch of the blast and the low rumble under it, duller and later with distance; then the
// slap of its echo off the houses around and, near enough, the earth (surf 'ground') or the grit of the road or the roof
// ('road', 'roof') it threw up pattering back down; a burst in the air ('air') throws nothing up
function boomSound(ctx, out, vol = 1, d = 0, pan = 0, surf = 'ground') {
  const delay = d / 340, lp = Math.min(9000, 7000 / (1 + d * 0.04));
  if (!snd(ctx, out, pick('explosionCrunch', 4), { vol, pan, lp, delay, rate: 0.9 + Math.random() * 0.15 })) return false;
  snd(ctx, out, pick('lowFrequency_explosion', 2), { vol: vol * 0.9, pan, lp: 340, delay: delay + 0.02, rate: 0.9 + Math.random() * 0.1 });
  snd(ctx, out, pick('explosionCrunch', 4), { vol: vol * 0.25, pan: -pan * 0.5, lp: Math.min(lp, 1600), delay: delay + 0.12 + Math.random() * 0.2, rate: 0.8 + Math.random() * 0.08 });
  if (d < 70 && surf !== 'air') {
    const fam = FAM[surf === 'ground' ? 'debris-soft' : 'debris-stone'];
    for (let i = 0, n = 3 + Math.floor(Math.random() * 3); i < n; i++)
      snd(ctx, out, pick(fam), { vol: vol * 0.2 * (1 - d / 70) * (0.5 + Math.random() * 0.5), pan: pan + (Math.random() - 0.5) * 0.5, lp: lpFor(d), delay: delay + 0.5 + Math.random() * 1.1, rate: 0.8 + Math.random() * 0.4 });
  }
  return true;
}
// a grenade touching down: the clink of its body on what it met — a dull tick and a thud on the earth, a sharper ring on
// a roof or a wall. vol carries the impact speed and the distance; the sound arrives at the speed of sound (d / 340).
function nadeBounce(ctx, out, kind = 'ground', vol = 1, d = 0, pan = 0) {
  const delay = d / 340, lp = lpFor(d);
  if (kind === 'body') {   // a player: a dull thud of the body, no ring of metal
    const played = snd(ctx, out, pick(FAM['debris-soft']), { vol: vol * 0.9, pan, lp: Math.min(lp, 900), delay, rate: 0.6 + Math.random() * 0.15 });
    snd(ctx, out, pick(FAM['debris-concrete']), { vol: vol * 0.25, pan, lp: Math.min(lp, 1500), delay: delay + 0.01, rate: 0.9 + Math.random() * 0.2 });
    return played;
  }
  const metal = kind !== 'ground';
  let played = snd(ctx, out, pick(FAM[metal ? 'debris-metal' : 'debris-concrete']), { vol: vol * (metal ? 1 : 0.7), pan, lp, delay, rate: (metal ? 1.1 : 0.85) + Math.random() * 0.3 });
  snd(ctx, out, pick(FAM[metal ? 'debris-stone' : 'debris-soft']), { vol: vol * 0.5, pan, lp: Math.min(lp, metal ? 4000 : 1200), delay: delay + 0.012, rate: 0.8 + Math.random() * 0.2 });
  if (metal && Math.random() < 0.5) snd(ctx, out, pick(FAM['debris-metal']), { vol: vol * 0.4, pan, lp, delay: delay + 0.05, rate: 1.4 + Math.random() * 0.4 });
  return played;
}
// a spent case touching down: the thin ring of brass on stone — three decaying partials of a small metal body,
// brighter and longer on a roof or a sidewalk (hard), duller on the earth. No recording of a case exists in the sets,
// so this one is always synthesised; vol carries the impact speed and the distance, the sound arrives at d / 340.
function shellTink(ctx, out, vol = 0.2, d = 0, pan = 0, hard = true) {
  try {
    const t = ctx.currentTime + d / 340, f0 = (hard ? 2400 : 1400) * (0.9 + Math.random() * 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.max(0.001, vol), t); g.gain.exponentialRampToValueAtTime(0.0008, t + (hard ? 0.11 : 0.06));
    let tail = g;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); tail = p; }
    tail.connect(out);
    for (const [m, a, dur] of [[1, 1, hard ? 0.09 : 0.05], [2.71, 0.45, hard ? 0.06 : 0.035], [4.85, 0.22, hard ? 0.04 : 0.025]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * m * (0.98 + Math.random() * 0.04);
      const og = ctx.createGain(); og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.02);
    }
  } catch (e) {}
}
// the voices of the special grenades: no recording of them exists in the sets, so these are always synthesised —
// one shared noise buffer, filtered and enveloped. The smoke canister pops and hisses, the napalm roars and crackles.
let NOISE = null;
function noise(ctx) {
  if (!NOISE) { NOISE = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = NOISE.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return NOISE;
}
function noisePlay(ctx, out, o) {
  const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.value = o.freq; f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain(), t = ctx.currentTime + (o.delay ?? 0);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.001, o.vol), t + (o.attack ?? 0.03)); g.gain.exponentialRampToValueAtTime(0.0008, t + o.dur);
  let tail = g;
  if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); tail = p; }
  s.connect(f); f.connect(g); tail.connect(out); s.start(t); s.stop(t + o.dur + 0.05);
}
// the smoke canister burning: the pop of its igniter, then the hiss of the jet — hard for the first second and a half,
// then steady and sputtering a little until the filler is spent (burnS seconds after it lit), with a short tail. age:
// how long it has burnt already (a screen found burning on joining). The loudness by distance and the side are the
// caller's, every frame (mp.js zoneSounds): the knobs pos (gain) and pan; stop() cuts it short, until is when it is over
function smokeHiss(ctx, out, burnS, age = 0) {
  try {
    const t = ctx.currentTime, end = Math.max(0.2, burnS - age), src = [];
    const pos = ctx.createGain(), pan = ctx.createStereoPanner(); pos.gain.value = 0; pos.connect(pan); pan.connect(out);
    const band = (type, freq, q) => {
      const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0.0001; s.connect(f); f.connect(g); g.connect(pos); s.start(t, Math.random() * 1.5); src.push(s);
      return { f, g };
    };
    const env = (g, peak, sus) => {
      g.gain.setValueAtTime(0.0001, t);
      if (age < 1.5) { g.gain.exponentialRampToValueAtTime(peak, t + 0.15); g.gain.setTargetAtTime(sus, t + Math.max(0.2, 1.5 - age), 0.5); }
      else g.gain.exponentialRampToValueAtTime(sus, t + 0.4);
      g.gain.setTargetAtTime(0.0001, t + end, 0.6);
    };
    const jet = band('bandpass', 2500, 0.6), air = band('highpass', 5400, 0.7), rum = band('lowpass', 420, 0.8);
    env(jet.g, 0.55, 0.24); env(air.g, 0.2, 0.08); env(rum.g, 0.3, 0.12);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5 + Math.random() * 4; lg.gain.value = 320;   // the sputter: the jet's pitch wobbles
    lfo.connect(lg); lg.connect(jet.f.frequency); lfo.start(t); src.push(lfo);
    if (age < 0.3) {   // the igniter: a dull pop and a click
      const s = ctx.createBufferSource(); s.buffer = noise(ctx); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      s.connect(f); f.connect(g); g.connect(pos); s.start(t); s.stop(t + 0.2);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.03);
      og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.04); o.connect(og); og.connect(pos); o.start(t); o.stop(t + 0.06);
    }
    const stopAt = t + end + 3; for (const s of src) s.stop(stopAt);
    return {
      pos, pan, until: performance.now() + (end + 3) * 1000,
      stop() { try { const n = ctx.currentTime; pos.gain.cancelScheduledValues(n); pos.gain.setTargetAtTime(0, n, 0.08); for (const s of src) s.stop(n + 0.5); } catch (e) {} }
    };
  } catch (e) { return null; }
}
// the napalm bursting: a low roar with a whoosh, then the crackle of the patch catching
function fireSound(ctx, out, vol = 1, d = 0, pan = 0) {
  try {
    const dl = d / 340;
    noisePlay(ctx, out, { type: 'lowpass', freq: 700, vol: vol * 0.8, dur: 1.4, attack: 0.04, delay: dl, pan });
    noisePlay(ctx, out, { type: 'bandpass', freq: 1600, q: 0.5, vol: vol * 0.4, dur: 0.7, attack: 0.02, delay: dl, pan });
    for (let i = 0; i < 6; i++) noisePlay(ctx, out, { type: 'highpass', freq: 2600, vol: vol * 0.22 * (0.5 + Math.random() * 0.5), dur: 0.05, attack: 0.004, delay: dl + 0.15 + Math.random() * 1.1, pan: pan + (Math.random() - 0.5) * 0.4 });
  } catch (e) {}
}
// the crackle of the fire round you (the hurt of the napalm): a few dry pops at the ear
function burnSound(ctx, out, vol = 1) {
  try { for (let i = 0, n = 3 + (Math.random() * 3 | 0); i < n; i++) noisePlay(ctx, out, { type: 'bandpass', freq: 1800 + Math.random() * 2600, q: 1.2, vol: vol * 0.3 * (0.4 + Math.random() * 0.6), dur: 0.04 + Math.random() * 0.05, attack: 0.003, delay: Math.random() * 0.3 }); } catch (e) {}
}
// the voice of the storm (the «Шторм» event, src/game/storm.js): the thunder rolling over the city — a long low
// rumble with a crack at its head and a second roll behind, later and duller with distance; and the electric zap of
// the burn outside the safe circle. No recording of them exists in the sets, so these are always synthesised.
function thunderSound(ctx, out, vol = 1, d = 0, pan = 0) {
  try {
    const dl = d / 340;
    noisePlay(ctx, out, { type: 'bandpass', freq: 1500, q: 0.7, vol: vol * 0.35, dur: 0.22, attack: 0.005, delay: dl, pan });
    noisePlay(ctx, out, { type: 'lowpass', freq: 240, vol: vol * 0.9, dur: 2.6, attack: 0.06, delay: dl + 0.02, pan });
    noisePlay(ctx, out, { type: 'lowpass', freq: 520, vol: vol * 0.45, dur: 1.5, attack: 0.04, delay: dl + 0.09, pan });
    noisePlay(ctx, out, { type: 'lowpass', freq: 150, vol: vol * 0.55, dur: 2.4, attack: 0.3, delay: dl + 0.5, pan: pan * 0.6 });
  } catch (e) {}
}
function stormZap(ctx, out, vol = 1) {
  try {
    noisePlay(ctx, out, { type: 'bandpass', freq: 2600, q: 1.4, vol: vol * 0.35, dur: 0.09, attack: 0.004 });
    noisePlay(ctx, out, { type: 'highpass', freq: 4200, vol: vol * 0.2, dur: 0.05, attack: 0.002, delay: 0.02 });
  } catch (e) {}
}
// the church bell of the «Святая гонка» (src/game/holy.js): a bronze bell is not a harmonic tone — its partials are
// inharmonic (hum, prime, a minor tierce, quint, nominal and the higher ranks), each dying at its own rate, and the
// clapper strikes a short bright transient. Two slightly detuned oscillators per partial give the slow beat of real
// bronze. f0 is the strike note (one per temple); the bell is heard across the whole city — the volume falls with
// distance but never below a third, the air dulls the highs, and the sound arrives at the speed of sound (capped so a
// far temple still rings within a couple of seconds). No recording exists in the sets: this is always synthesised.
function bellSound(ctx, out, f0 = 220, vol = 1, d = 0, pan = 0, delay = 0) {
  try {
    const t = ctx.currentTime + delay + Math.min(2.5, d / 340);
    const v = vol * Math.max(0.3, 1.15 / (1 + d * 0.004));
    const head = ctx.createGain(); head.gain.value = 1;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = Math.min(16000, 9000 / (1 + d * 0.01));
    const pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan));
    head.connect(flt); flt.connect(pn); pn.connect(out);
    // [ratio to the strike note, amplitude, decay seconds]
    const PART = [[0.5, 0.5, 7], [1, 1, 5], [1.19, 0.55, 3.5], [1.5, 0.4, 3], [2, 0.5, 2.2], [2.51, 0.25, 1.6], [3.01, 0.18, 1.2], [4.16, 0.1, 0.9], [5.43, 0.06, 0.6]];
    for (const [r, a, dec] of PART) for (const det of [-0.35, 0.35]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * r + det;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * a * 0.5), t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(head); o.start(t); o.stop(t + dec + 0.1);
    }
    const n = ctx.createBufferSource(); n.buffer = noise(ctx);
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = f0 * 8; nf.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(v * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n.connect(nf); nf.connect(ng); ng.connect(head); n.start(t); n.stop(t + 0.08);
  } catch (e) {}
}
export { bellSound, boomSound, burnSound, crackSound, fireSound, hitSound, loadSounds, nadeBounce, shellTink, shotSound, smokeHiss, stepSound, stormZap, thunderSound };
