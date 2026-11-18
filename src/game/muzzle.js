import * as THREE from 'three';
import { camera } from '../render/renderer.js';
import { worldSpace } from '../render/world-space.js';

/* ---------- the muzzle flash ----------
   A shot's flash is three things, as a camera sees a real one: a ball of flame across the barrel (the burst of burning
   gas seen head-on: licks of different reach, billows of fire, a white-hot heart), two tongues of flame along it (what
   is seen from the side: a jet that wavers, frays and tears into licks at its end; crossed, so that some of it shows
   from any angle), and a soft glow around the muzzle turned to the camera. The flames are painted in colours brighter
   than white over what is behind them, so they keep their yellow and orange against a bright sky and the bloom of the
   page (render/post.js) makes them shine; the glow is added on top.
   Each shot picks one of four drawings of the ball and of the tongues, its own turn about the barrel, its size and
   length, and lives a few hundredths of a second: full on the first frame, then fading as it swells. The drawings are
   painted once, pixel by pixel from smooth noise, on a canvas.
   makeFlash({ size, wrap }) gives { group, fire(power, scale), tick(dt) → brightness 0…1 }. The group is put at the
   muzzle, its +z along the barrel; size scales the whole flash (1: an assault rifle), scale one shot (FLASH_SIZE of the
   weapon); wrap is applied to each material (the arms of viewmodel.js draw theirs over everything). */
const FLASH_SIZE = [1, 1.35, 1.5, 0.6, 1.25];   // in the order of the weapons: the shotgun, the sniper rifle and the machine gun blow bigger flames than the AK, the pistol a small one
const N = 4, CELL = 256;
let TEX = null;
function hash(x, y, s) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s) { let v = 0, a = 0.5; for (let o = 0; o < 4; o++) { v += a * vnoise(x, y, s + o * 17); x *= 2.03; y *= 2.03; a *= 0.5; } return v / 0.9375; }
const RAMP = [[0, 255, 90, 20, 0], [0.12, 255, 100, 25, 0.28], [0.3, 255, 120, 30, 0.7], [0.55, 255, 185, 70, 0.95], [0.8, 255, 232, 150, 1], [1, 255, 255, 238, 1]];
function ramp(I, out, o) {
  I = I < 0 ? 0 : I > 1 ? 1 : I; let k = 1; while (k < RAMP.length - 1 && RAMP[k][0] < I) k++;
  const A = RAMP[k - 1], B = RAMP[k], t = (I - A[0]) / (B[0] - A[0]);
  for (let c = 0; c < 4; c++) out[o + c] = Math.round((A[c + 1] + (B[c + 1] - A[c + 1]) * t) * (c === 3 ? 255 : 1));
}
const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v;
// a ball of flame seen along the barrel: a few big licks of different reach, billowing clouds of fire inside, a white-hot heart
function burst(u, v, seed) {
  const dx = u * 2 - 1, dy = v * 2 - 1, r = Math.hypot(dx, dy) / 0.94, ca = dx / (r || 1), sa = dy / (r || 1);
  const lobe = fbm(ca * 1.3 + seed * 7.1, sa * 1.3 + seed * 3.3, seed), reach = 0.42 + 0.58 * lobe * lobe * (0.85 + 0.3 * fbm(ca * 2.6 + seed, sa * 2.6 - seed, seed + 9));
  const cloud = fbm(dx * 2.6 + seed * 11, dy * 2.6 - seed * 5, seed + 3), fray = fbm(dx * 7 + seed, dy * 7 - seed * 3, seed + 21);
  const k = r / (reach * (0.8 + 0.4 * fray));   // the edge frays
  let I = clamp(1 - k * k) * (0.35 + 0.65 * cloud);
  return I + Math.max(0, 1 - r / 0.18) * 0.65;
}
// a tongue of flame along the barrel: u from the muzzle (0) to the tip (1), v across (0…1); it wavers, frays and tears at the tip
function tongue(u, v, seed) {
  const L = 0.72 + 0.28 * hash(seed, 7, 1), uu = u / L; if (uu >= 1.05) return 0;
  const y = v - 0.5, wob = (fbm(uu * 2.4 + seed * 5, seed * 2.7, seed) - 0.5) * 0.32 * uu;
  const fray = fbm(uu * 6 - seed * 13, y * 9 + seed * 3, seed + 5), cloud = fbm(uu * 3.5 + seed, y * 4 - seed, seed + 11);
  const w = (0.04 + 0.32 * Math.pow(Math.min(uu, 1), 0.45) * Math.pow(Math.max(0, 1 - uu), 0.8)) * (0.6 + 0.8 * fray);
  const k = Math.abs(y - wob) / Math.max(w, 1e-3);
  let I = clamp(1 - k * k) * (0.3 + 0.7 * cloud) * Math.pow(Math.max(0, 1 - uu), 0.5);
  const t = clamp((uu - 0.45) / 0.35); I *= 1 + (clamp(fray * 2 - 0.2) - 1) * t * t * (3 - 2 * t);   // the end breaks into licks
  return I + Math.max(0, 1 - Math.hypot(uu / 0.12, y / 0.06)) * 0.75;
}
// four drawings of one kind (fn(u, v, seed) → heat) in the cells of one canvas; one texture per cell, sharing the picture
function atlas(fn) {
  const side = CELL * 2, c = document.createElement('canvas'); c.width = c.height = side;
  const g = c.getContext('2d'), img = g.createImageData(side, side), data = img.data;
  for (let i = 0; i < N; i++) {
    const ox = (i % 2) * CELL, oy = (i >> 1) * CELL, seed = i * 31 + 5;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const u = (x - 4) / (CELL - 8), v = (y - 4) / (CELL - 8), edge = Math.min(u, v, 1 - u, 1 - v);   // a clear margin: the mipmaps of one cell do not bleed into the next
      ramp(edge <= 0 ? 0 : fn(u, v, seed) * Math.min(1, edge * 30), data, ((oy + y) * side + ox + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  const base = new THREE.CanvasTexture(c); base.colorSpace = THREE.SRGBColorSpace;
  return Array.from({ length: N }, (_, i) => { const t = base.clone(); t.repeat.set(0.5, 0.5); t.offset.set((i % 2) * 0.5, 0.5 - (i >> 1) * 0.5); return t; });
}
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,232,185,1)'); r.addColorStop(0.2, 'rgba(255,185,100,0.4)'); r.addColorStop(0.55, 'rgba(255,130,50,0.06)'); r.addColorStop(1, 'rgba(255,110,40,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function textures() { return TEX || (TEX = { ball: atlas(burst), flame: atlas(tongue), glow: glowTex() }); }
const r01 = () => Math.random();

// geometry: the ball in the xy plane (facing +z); a tongue spanning one axis across and 0…1 along +z (u along z)
const PLANE = new THREE.PlaneGeometry(1, 1);
function tongueGeo(acrossX) {
  const g = new THREE.BufferGeometry(), p = acrossX ? [-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1] : [0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); return g;
}
const TONGUE_X = tongueGeo(true), TONGUE_Y = tongueGeo(false);
const BRIGHT = new THREE.Color(2.6, 2.1, 1.5);   // brighter than white: the bloom takes it
const Q = new THREE.Quaternion();
function makeFlash({ size = 1, wrap = m => m } = {}) {
  const T = textures(), group = new THREE.Group(), roll = new THREE.Group();
  const mat = (map, add) => wrap(worldSpace(new THREE.MeshBasicMaterial({ map, color: BRIGHT, transparent: true, opacity: 0, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));
  const ball = new THREE.Mesh(PLANE, mat(T.ball[0])), fa = new THREE.Mesh(TONGUE_X, mat(T.flame[0])), fb = new THREE.Mesh(TONGUE_Y, mat(T.flame[1])), glow = new THREE.Mesh(PLANE, mat(T.glow, true));
  for (const m of [ball, fa, fb, glow]) { m.frustumCulled = false; m.renderOrder = 5; }
  roll.add(fa, fb, ball); group.add(roll, glow); group.visible = false;
  let t = 9, life = 0.05, pow = 1;
  function fire(power = 1, scale = 1) {
    t = 0; pow = power; const sz = size * scale; life = 0.04 + r01() * 0.025;
    const v = r01() * N | 0; ball.material.map = T.ball[v]; fa.material.map = T.flame[(v + 1) % N]; fb.material.map = T.flame[(v + 2) % N];
    roll.rotation.z = r01() * 6.283;
    const b = sz * (0.24 + r01() * 0.12), len = sz * (0.3 + r01() * 0.2), w = sz * (0.16 + r01() * 0.06);
    ball.scale.set(r01() < 0.5 ? b : -b, b, 1); ball.position.z = sz * 0.03;   // mirrored half of the time: eight looks of four drawings
    fa.scale.set(w, 1, len); fb.scale.set(1, w * (0.8 + r01() * 0.4), len * (0.8 + r01() * 0.4));
    glow.scale.setScalar(sz * (0.32 + r01() * 0.12));
  }
  function tick(dt) {
    const k = t / life; t += dt;
    if (k >= 1) { group.visible = false; return 0; }
    const e = pow * (1 - k) * (1 - k * 0.5);
    group.visible = true; roll.scale.setScalar(1 + k * 0.45);
    ball.material.opacity = e; fa.material.opacity = fb.material.opacity = e * 0.95; glow.material.opacity = e * 0.3;
    group.getWorldQuaternion(Q).invert().multiply(camera.quaternion); glow.quaternion.copy(Q);   // the glow faces the camera
    return e;
  }
  return { group, fire, tick };
}

export { FLASH_SIZE, makeFlash };
