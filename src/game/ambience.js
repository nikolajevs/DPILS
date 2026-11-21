import { SET, onChange } from './settings.js';
import { P } from './player.js';
import { ROAD, buildingAt } from '../world/data.js';
import { terrainH } from '../world/terrain.js';
import { timeI } from '../render/lighting.js';

/* ---------- the sound of the place ----------
   Made in the page, from noise and a few oscillators, by what is round the player: the wind (more in the open), birds
   in the day in the open, away from the streets (short phrases of four kinds, near and far), water within some tens of
   metres of the river or a pond — a soft fountain-like splash, two noise layers slowly swelling so it gurgles instead
   of hissing, the traffic by a street (with a car passing now and then), the hum of the city among houses.
   The night is quiet: no crickets (they were asked away). Every 0.6 s
   the place is looked at (houses, water and streets at a few distances round) and the levels glide to what it needs.
   The volume is the one of the sounds times the one of the ambience in the settings. */
let ctx = null, master = null, N = null, probeT = 0, birdT = 2, carT = 4, last = null;
function noiseBuffer(c, secs, brown) {
  const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); let y = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; y = brown ? (y + 0.02 * w) / 1.02 : w; d[i] = brown ? y * 3.5 : w; }
  return b;
}
function chain(c, buf, type, freq, q, out) {
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = buf; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
  s.connect(f); f.connect(g); g.connect(out); s.start(0, Math.random() * 2); return { f, g };
}
function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = SET.vol * SET.ambVol; master.connect(ctx.destination);
    const white = noiseBuffer(ctx, 3, false), brown = noiseBuffer(ctx, 4, true);
    N = { wind: chain(ctx, brown, 'lowpass', 420, 0.5, master), water: chain(ctx, white, 'bandpass', 750, 0.6, master), splash: chain(ctx, white, 'lowpass', 340, 0.5, master), traffic: chain(ctx, brown, 'lowpass', 150, 0.7, master), hum: null };
    const hum = ctx.createOscillator(), hg = ctx.createGain(); hum.type = 'sawtooth'; hum.frequency.value = 62; hg.gain.value = 0; const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 220; hum.connect(hf); hf.connect(hg); hg.connect(master); hum.start(); N.hum = { g: hg };
  } catch (e) { ctx = null; }
}
onChange(() => { if (master) master.gain.value = SET.vol * SET.ambVol; });
const set = (node, v) => { if (node) node.g.gain.setTargetAtTime(v, ctx.currentTime, 0.7); };

// a street for cars (the half width of its carriageway 2.4 m and more) within `m` metres; the footways of the parks do not count
function carRoad(x, z, m) { let ok = false; ROAD.near(x, z, m + 6, (id, d) => { const hw = ROAD.s[id * 6 + 4]; if (hw >= 2.4 && d < hw + m) ok = true; }); return ok; }
// what the place is like, from the position alone (also used to test it): { open, bld, water, road, day }
function probe(x, z) {
  let bld = 0, wat = 0, n = 0;
  for (const r of [12, 26, 44]) for (let k = 0; k < 8; k++) {
    const a = k / 8 * 6.283 + r, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; n++;
    if (buildingAt(px, pz)) bld++;
    if (terrainH(px, pz) < -2) wat += 1 - r / 70;   // the nearer, the more
  }
  const road = carRoad(x, z, 6) ? 1 : carRoad(x, z, 30) ? 0.35 : 0;
  return { open: 1 - Math.min(1, bld / n * 3), bld: bld / n, water: Math.min(1, wat / 3), road, day: timeI < 2 };
}
// a bird, not a beep: a short phrase of one of four kinds — a tit's two-tone "tsi-ta", a sparrow's uneven
// chirps, a warbler's fast trill, a blackbird's low flute notes. Every syllable glides its pitch (up, down or
// up-and-down) under a soft attack-and-decay envelope, with a quiet second harmonic for warmth. dist 0..1 is
// how far the bird is: the farther, the quieter and duller it sounds; when > 0 delays the phrase (an answer).
function bird(pan, dist, when) {
  const t = ctx.currentTime + 0.02 + when, kind = Math.floor(Math.random() * 4);
  const g = ctx.createGain(), lp = ctx.createBiquadFilter(), p = ctx.createStereoPanner();
  lp.type = 'lowpass'; lp.frequency.value = 1500 + 6500 * dist; p.pan.value = pan;
  g.gain.value = 0; g.connect(lp); lp.connect(p); p.connect(master);
  const peak = 0.05 + 0.11 * dist * dist, jit = () => 0.92 + Math.random() * 0.16, syl = [];
  if (kind === 0) { const f = (3600 + Math.random() * 900) * jit();   // tit: high "tsi", lower "ta", 2–3 pairs
    for (let k = 0, n = 2 + Math.floor(Math.random() * 2); k < n; k++) { syl.push([f * 1.05, 0.07, 1, 0.05 + Math.random() * 0.03]); syl.push([f * 0.72, 0.11, -1, 0.09 + Math.random() * 0.05]); }
  } else if (kind === 1) { const f = (2700 + Math.random() * 800) * jit();   // sparrow: 2–4 uneven falling chirps
    for (let k = 0, n = 2 + Math.floor(Math.random() * 3); k < n; k++) syl.push([f * jit(), 0.05 + Math.random() * 0.03, -1, 0.05 + Math.random() * 0.12]);
  } else if (kind === 2) { const f = (4300 + Math.random() * 900) * jit();   // warbler: a fast trill of 7–12 tiny notes
    for (let k = 0, n = 7 + Math.floor(Math.random() * 6); k < n; k++) syl.push([f * (k % 2 ? 0.93 : 1.06) * jit(), 0.032 + Math.random() * 0.014, k % 2 ? -1 : 1, 0.018 + Math.random() * 0.014]);
  } else { const f = 1500 + Math.random() * 800;   // blackbird: 3–5 low flute notes with pauses
    for (let k = 0, n = 3 + Math.floor(Math.random() * 3); k < n; k++) syl.push([f * (0.85 + Math.random() * 0.5), 0.12 + Math.random() * 0.1, Math.random() < 0.5 ? 2 : 1, 0.04 + Math.random() * 0.14]);
  }
  let at = t, lastO = null;
  for (const [f, dur, shape, gap] of syl) {
    const o = ctx.createOscillator(), h = ctx.createOscillator(), hg = ctx.createGain();
    hg.gain.value = 0.12; o.connect(g); h.connect(hg); hg.connect(g);
    const c = shape === -1 ? [1.15, 0.82, 0.78] : shape === 2 ? [0.9, 1.28, 0.86] : [0.92, 1.22, 1.12];
    for (const [osc, m] of [[o, 1], [h, 2]]) {
      osc.frequency.setValueAtTime(f * c[0] * m, at);
      osc.frequency.exponentialRampToValueAtTime(f * c[1] * m, at + dur * 0.45);
      osc.frequency.exponentialRampToValueAtTime(f * c[2] * m, at + dur);
      osc.start(at); osc.stop(at + dur + 0.03);
    }
    const pk = peak * (0.8 + Math.random() * 0.2);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(pk, at + Math.min(0.012, dur * 0.25));
    g.gain.setValueAtTime(pk, at + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    g.gain.setValueAtTime(0, at + dur + 0.004);
    lastO = o; at += dur + gap;
  }
  lastO.onended = () => { g.disconnect(); lp.disconnect(); p.disconnect(); };
}
function car() {   // a car passes: the rumble swells and its tone sweeps up and down, from one side to the other
  const t = ctx.currentTime, d = 2.6, tg = N.traffic.g.gain, tf = N.traffic.f.frequency;
  tf.cancelScheduledValues(t); tf.setValueAtTime(130, t); tf.linearRampToValueAtTime(850, t + d * 0.5); tf.linearRampToValueAtTime(130, t + d);
  tg.cancelScheduledValues(t); tg.setTargetAtTime(Math.min(1, (last ? last.road : 0.5) * 1.6 + 0.2), t, 0.5); tg.setTargetAtTime(0.1, t + d * 0.6, 0.6);
}
function ambTick(dt) {
  if (!ctx) return; if (ctx.state === 'suspended') ctx.resume();
  if ((probeT -= dt) <= 0) {
    probeT = 0.6; last = probe(P.x, P.z); const E = last;
    // water: a soft splash, much quieter than the old hiss; the two layers swell a little each probe so it gurgles
    set(N.wind, 0.05 + 0.13 * E.open); set(N.water, E.water * (0.07 + Math.random() * 0.035)); set(N.splash, E.water * (0.04 + Math.random() * 0.03)); set(N.traffic, 0.015 + E.road * 0.16); set(N.hum, E.bld > 0.12 ? 0.012 + E.bld * 0.05 : 0.002);
  }
  const E = last; if (!E) return;
  if (E.day && E.open > 0.55 && E.road < 1 && (birdT -= dt) <= 0) {
    birdT = 1.4 + Math.random() * (E.open > 0.85 ? 3.6 : 7);
    bird(Math.random() * 1.6 - 0.8, 0.35 + Math.random() * 0.65, 0);
    if (Math.random() < 0.3) bird(Math.random() * 1.6 - 0.8, 0.25 + Math.random() * 0.4, 0.6 + Math.random() * 1.4);   // another bird answers from farther off
  }
  if (E.road > 0.3 && (carT -= dt) <= 0) { carT = 3 + Math.random() * 9; car(); }
}
const ambStatus = () => ({ on: !!ctx, ...(last || {}) });
export { ambStatus, ambTick, probe as ambProbe, start as ambStart };
