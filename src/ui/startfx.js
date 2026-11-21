/* The start screen's living backdrop (src/ui/startfx.js).
   Two jobs, both independent of the city data and three.js, so boot.js loads this module first:

   1. The 3D city stays hidden while the start card (or the login gate) is up: the canvas #view only
      fades in once a fight is running (body.mp — set on join, and leaving reloads the page). While
      the city is being built the visitor sees the designed backdrop below, not a half-built scene.
      «?» opens the card mid-fight: body.mp is still there, so the city stays visible behind it.

   2. An interactive tactical grid on a canvas behind the card. The lines bend away from the cursor,
      glow and light their intersections near it; a click sends a ripple ring that warps and lights
      the grid as it passes; a slow radar sweep keeps the backdrop alive when the mouse is still.
      Colours follow the page theme (--ink / --brick), the loop runs only while the card is visible,
      and prefers-reduced-motion gets a single static grid with no pointer effects. */

const start = document.getElementById('start');
const view = document.getElementById('view');
const canvas = document.createElement('canvas');
canvas.className = 'start-fx';
canvas.setAttribute('aria-hidden', 'true');
start.prepend(canvas);
const ctx = canvas.getContext('2d');

const CELL = 64, STEP = 16;      // grid pitch (matches the old CSS grid) and the warp sampling step
const R = 180;                   // cursor field radius, px
const LIFE = 1.15, SPEED = 430;  // ripple lifetime (s) and ring speed (px/s)
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

let w = 0, h = 0, dpr = 1;
let ink = [235, 231, 222], brick = [216, 114, 90];
const p = { x: -9999, y: -9999, tx: -9999, ty: -9999, on: false, int: 0 };
const ripples = [];
let raf = 0, last = 0, running = false;

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function hex(s) {
  s = s.trim();
  if (s[0] === '#' && s.length === 7) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  if (s[0] === '#' && s.length === 4) return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16)];
  return null;
}
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  ink = hex(cs.getPropertyValue('--ink')) || ink;
  brick = hex(cs.getPropertyValue('--brick')) || brick;
}

function resize() {
  dpr = Math.min(1.5, window.devicePixelRatio || 1);
  w = window.innerWidth; h = window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  readTheme();
  if (reduced.matches && !start.hidden) drawStatic();
}

/* displacement of a grid vertex: repelled by the cursor field and by any passing ripple ring */
const o = [0, 0];
function warp(x, y, t) {
  let dx = 0, dy = 0;
  if (p.int > 0.02) {
    const ax = x - p.x, ay = y - p.y, d = Math.sqrt(ax * ax + ay * ay);
    if (d < R && d > 0.5) { const f = 1 - d / R, k = f * f * 9 * p.int; dx += ax / d * k; dy += ay / d * k; }
  }
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i], age = t - r.t0;
    if (age < 0 || age > LIFE) continue;
    const ax = x - r.x, ay = y - r.y, d = Math.sqrt(ax * ax + ay * ay) || 1;
    const band = Math.exp(-Math.pow((d - age * SPEED) / 46, 2));
    if (band > 0.02) { const k = band * 8 * (1 - age / LIFE); dx += ax / d * k; dy += ay / d * k; }
  }
  o[0] = x + dx; o[1] = y + dy;
}

/* one pass over the grid; nearOnly skips the lines far from the cursor (the glow pass is clipped to it) */
function grid(color, width, t, nearOnly) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  for (let x = 0; x <= w + CELL; x += CELL) {
    if (nearOnly && Math.abs(x - p.x) > R + 24) continue;
    for (let y = -STEP; y <= h + STEP; y += STEP) { warp(x, y, t); if (y === -STEP) ctx.moveTo(o[0], o[1]); else ctx.lineTo(o[0], o[1]); }
  }
  for (let y = 0; y <= h + CELL; y += CELL) {
    if (nearOnly && Math.abs(y - p.y) > R + 24) continue;
    for (let x = -STEP; x <= w + STEP; x += STEP) { warp(x, y, t); if (x === -STEP) ctx.moveTo(o[0], o[1]); else ctx.lineTo(o[0], o[1]); }
  }
  ctx.stroke();
}

function drawStatic() {
  ctx.clearRect(0, 0, w, h);
  grid(rgba(ink, 0.08), 1, 0, false);
}

function draw(t) {
  ctx.clearRect(0, 0, w, h);
  // the slow radar sweep: a soft brick band crossing the screen, with a faint leading edge
  const sx = ((t * 80) % (w + 480)) - 240;
  const band = ctx.createLinearGradient(sx - 120, 0, sx + 120, 0);
  band.addColorStop(0, rgba(brick, 0)); band.addColorStop(0.5, rgba(brick, 0.05)); band.addColorStop(1, rgba(brick, 0));
  ctx.fillStyle = band; ctx.fillRect(sx - 120, 0, 240, h);
  ctx.fillStyle = rgba(brick, 0.10); ctx.fillRect(sx + 118, 0, 1.5, h);
  // the cursor halo under the lines
  if (p.int > 0.02) {
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 1.5);
    halo.addColorStop(0, rgba(brick, 0.11 * p.int)); halo.addColorStop(1, rgba(brick, 0));
    ctx.fillStyle = halo; ctx.fillRect(p.x - R * 1.5, p.y - R * 1.5, R * 3, R * 3);
  }
  grid(rgba(ink, 0.08), 1, t, false);
  // the lit part of the grid around the cursor: brighter lines and glowing intersections
  if (p.int > 0.02) {
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.05, 0, Math.PI * 2); ctx.clip();
    grid(rgba(brick, 0.32 * p.int), 1, t, true);
    for (let gx = Math.max(0, Math.floor((p.x - R) / CELL) * CELL); gx <= Math.min(w, p.x + R); gx += CELL) {
      for (let gy = Math.max(0, Math.floor((p.y - R) / CELL) * CELL); gy <= Math.min(h, p.y + R); gy += CELL) {
        const d = Math.hypot(gx - p.x, gy - p.y);
        if (d > R) continue;
        const f = 1 - d / R;
        warp(gx, gy, t);
        ctx.fillStyle = rgba(brick, f * f * 0.85 * p.int);
        ctx.beginPath(); ctx.arc(o[0], o[1], 1.7, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    // a small crosshair marker at the cursor
    ctx.strokeStyle = rgba(brick, 0.55 * p.int); ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(p.x - 11, p.y); ctx.lineTo(p.x - 5, p.y); ctx.moveTo(p.x + 5, p.y); ctx.lineTo(p.x + 11, p.y);
    ctx.moveTo(p.x, p.y - 11); ctx.lineTo(p.x, p.y - 5); ctx.moveTo(p.x, p.y + 5); ctx.lineTo(p.x, p.y + 11);
    ctx.stroke();
  }
  // ripple rings from clicks
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i], age = t - r.t0;
    if (age > LIFE) { ripples.splice(i, 1); continue; }
    if (age < 0) continue;   // the rAF timestamp can lag the click's performance.now() by a few ms on the first frame
    const a = 1 - age / LIFE;
    ctx.strokeStyle = rgba(brick, 0.45 * a); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(r.x, r.y, age * SPEED, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = rgba(brick, 0.18 * a); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(r.x, r.y, age * SPEED * 0.82, 0, Math.PI * 2); ctx.stroke();
  }
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const t = now / 1000, dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
  if (document.hidden) return;
  const ease = Math.min(1, dt * 14);
  p.x += (p.tx - p.x) * ease; p.y += (p.ty - p.y) * ease;
  p.int += ((p.on ? 1 : 0) - p.int) * Math.min(1, dt * 6);
  draw(t);
}
function startLoop() { if (!running && !reduced.matches) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); } }
function stopLoop() { running = false; cancelAnimationFrame(raf); }

/* the city canvas is shown only in a fight; the grid loop runs only while the start card is visible */
function sync() {
  view.classList.toggle('shown', document.body.classList.contains('mp'));
  if (start.hidden) { stopLoop(); return; }
  if (reduced.matches) { stopLoop(); drawStatic(); } else startLoop();
}
new MutationObserver(sync).observe(start, { attributes: true, attributeFilter: ['hidden'] });
new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });

/* pointer: the field follows the cursor (eased in tick), a press anywhere on the start screen drops a ripple */
window.addEventListener('pointermove', e => { p.tx = e.clientX; p.ty = e.clientY; if (!p.on && p.int < 0.05) { p.x = p.tx; p.y = p.ty; } p.on = true; }, { passive: true });
start.addEventListener('pointerdown', e => {
  p.tx = p.x = e.clientX; p.ty = p.y = e.clientY; p.on = true;
  if (!reduced.matches) { ripples.push({ x: e.clientX, y: e.clientY, t0: performance.now() / 1000 }); if (ripples.length > 6) ripples.shift(); }
}, { passive: true });
document.addEventListener('pointerout', e => { if (!e.relatedTarget) p.on = false; });
window.addEventListener('blur', () => { p.on = false; });

/* theme and motion changes repaint the backdrop */
new MutationObserver(() => { readTheme(); if (reduced.matches && !start.hidden) drawStatic(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
darkQuery.addEventListener('change', () => { readTheme(); if (reduced.matches && !start.hidden) drawStatic(); });
reduced.addEventListener('change', sync);
window.addEventListener('resize', resize);

resize();
sync();
