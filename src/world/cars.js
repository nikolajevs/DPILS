/* ---------- the cars of the city: removed ----------
   The standing and parked cars (the BMW GLBs baked by tools/bmw.mjs) are taken out by the owner's request: the models
   looked wrong, and they were the largest part of the frame — every parking stall of the city kept a 4000-triangle
   model, drawn out to 1.5 km (some 7000 cars, 8–9 million triangles a frame, the city at 15 fps on a weak machine).
   The car parks themselves stay (src/landmarks/parking.js): the ground, the stalls, the lines, the kerbs, the signs.
   The models remain in models/ (credits in models/README.md) should a lighter car ever replace them; nothing loads
   them now. The collision API stays: with no car registered it finds nothing, so a walker passes through the empty
   stalls and a bullet flies on. */
const staticCars = [];   // no car is registered any more
const HL = [1.4, 1.15, 1.55];   // half-length of the axis by body kind (kept for the day a car returns)
function carAxis(c) { const hl = c.police ? 1.4 : HL[c.kind] ?? 1.4; return [c.x - Math.cos(c.a) * hl, c.z + Math.sin(c.a) * hl, c.x + Math.cos(c.a) * hl, c.z - Math.sin(c.a) * hl]; }
function axisPoint(c, x, z) {   // the nearest point of the car's axis to (x, z) and the distance to it
  const [ax, az, bx, bz] = carAxis(c), ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez, s = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), px = ax + ex * s, pz = az + ez * s;
  return [px, pz, Math.hypot(x - px, z - pz)];
}
const nearCars = (x, z, f) => { for (const c of staticCars) if (Math.abs(c.x - x) < 6 && Math.abs(c.z - z) < 6) f(c); };
function staticCarAt(x, y, z, g) {   // g: the terrain height at (x, z), given by the caller (this module must not import the terrain: the fortress imports this one)
  let r = null;
  nearCars(x, z, c => { if (r) return; const base = g + (c.y || 0); if (y < base || y > base + 1.5) return; const [px, pz, d] = axisPoint(c, x, z); if (d < 0.95) r = { px, pz, top: base + 1.5 }; });
  return r;
}
function staticCarPush(P) {   // 0.45 m of the walker, 0.95 m of the car
  nearCars(P.x, P.z, c => { const [px, pz, d] = axisPoint(c, P.x, P.z), R = 1.4; if (d >= R || d < 1e-5) return; const k = (R - d) / d; P.x += (P.x - px) * k; P.z += (P.z - pz) * k; }); }
function addStaticCar() {}   // the landmarks still call it (police, hospital); the cars are gone
const carGeo = () => null;
const policeGeometry = () => null;
const carsReady = () => null;
function initCars() {}
async function placeStaticCars() {}

export { addStaticCar, carGeo, carsReady, initCars, placeStaticCars, policeGeometry, staticCarAt, staticCarPush };