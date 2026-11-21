/* ---------- the footprint holes of the houses: courtyards and through-passages (проезды) ----------
   One list for the page and for the game server. The page puts these holes into BLD (buildingAt, inBuilding) and
   opens the walking collision by them (passages.js); the server (server/world.mjs) reads citydata.js itself and asks
   the same function, so online a bullet, a grenade and a bot pass a courtyard or a passage exactly where they pass it
   in the training game and where the body walks. No imports from the page: Node runs this file on the server.

   RULE: every through-passage in a building must be passable — see README «Проезды сквозь здания» and CLAUDE.md.
   When a new block with a passage is modelled, register its holes in passageHolesOf: the model, the body, the shots,
   the grenades and the bots then all open it, in the page and on the server. */

/* Miera iela 143 (drawn by src/buildings/miera.js): the frame of the house — u along the long side
   (0.684 · east − 0.7295 · south), v across it towards the south-east, origin (905, −247) — and the two bridges over
   the passages: [u0, u1, v0, v1], the centre and the width of the opening, whether cars drive through. */
const UX = 0.684, UZ = -0.7295, VX = -UZ, VZ = UX, OX = 905, OZ = -247;
const W = (u, v) => [OX + UX * u + VX * v, OZ + UZ * u + VZ * v];
const MIERA_BRIDGES = [{ r: [-48, -42.25, 1.9, 11.5], c: -45.5, w: 3.8, cars: true }, { r: [22.85, 28.85, 2.1, 11.9], c: 25.95, w: 2.6, cars: false }];

// the cadastre outline of the house: 29–33 corners round its centre
function mieraOf(outer) {
  const n = outer.length >> 1; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += outer[2 * i] / n; z += outer[2 * i + 1] / n; }
  return n >= 29 && n <= 33 && Math.hypot(x - 910, z + 246) < 8;
}
// the passage openings as footprint holes: the rectangles the bridges leave open below, reaching MIERA_MOUTH past
// both faces of the bridge. The back wall of the cadastre's notch stands 1–6.5 cm mouth-side of the bridge face, and a
// hole that stopped at the face left that sliver solid: a bullet punched it, but a sight line (a bot's eye) and a
// blast ray stopped dead in the mouth of the passage. Past the face the hole lies in the open notch, so it opens
// nothing else; the walking collision (passages.js) takes the reach back, its walls stay where the model draws them.
const MIERA_MOUTH = 0.2;
function mieraHoles() {
  const holes = [], m = MIERA_MOUTH;
  for (const { r: [, , v0, v1], c, w } of MIERA_BRIDGES) { const hw = w / 2; const h = [W(c - hw, v0 - m), W(c + hw, v0 - m), W(c + hw, v1 + m), W(c - hw, v1 + m)]; holes.push(new Float32Array(h.flat())); }
  return holes;
}

// the footprint holes of the through-passages of a building (empty if it has none); id: its index in citydata's C.b
function passageHolesOf(id, outer) {
  if (mieraOf(outer)) return mieraHoles();
  return [];
}

// all the holes of a building: its inner rings in the data (closed courtyards) and its through-passages.
// rings: the decoded rings of the record, the outer first
function footprintHoles(id, rings) {
  const ph = passageHolesOf(id, rings[0]);
  return ph.length ? rings.slice(1).concat(ph) : rings.slice(1);
}

export { MIERA_BRIDGES, MIERA_MOUTH, UX, UZ, VX, VZ, W, footprintHoles, mieraOf, passageHolesOf };
