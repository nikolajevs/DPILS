import { lmL } from '../landmarks/core.js';

/* ---------- the Konstantin gate: what is left of it ----------
   The gate block over the passage was pulled down (the fortress map of visitdaugavpils.lv: "Konstantīna vārti
   (nojaukti)"). What stands is the cut through the rampart at its north-west corner: two retaining walls along the
   passage, rendered rubble below and red brick above, with brick end blocks where they meet the faces of the rampart,
   and on the town side two curved wing walls holding the inner slope (Mapillary, 2020). In OpenStreetMap the walls are
   the two building outlines named Konstantīna vārti (ways 733209162, 733209163) and the wings two city walls (1523618446,
   1523618447). Frame: u along the passage from the field (north-west) into the town, v across it; side +1 (v > 0) is the
   south-west wall, side −1 the north-east one. All the numbers below are those outlines measured in this frame. */
const KF = [-3083.07, -634.55, 0.7082, 0.706];
const KON = {
  f: KF, pw: 3.4, top: 4.2, earth: 4.05, crest: 5.2,
  // u0, u1: the outer and inner ends of a wall; uo, ui: the outer and inner faces of the rampart (the end blocks fill
  // u0…uo and ui…u1); back: the back of the wall; endO, endI: how far the end blocks reach back; wing: points (u, |v|)
  sides: [
    { sg: 1, u0: -11.2, u1: 11.0, uo: -8.6, ui: 8.7, back: 5.3, endO: 7.6, endI: 7.4, wing: [[11.0, 7.1], [11.5, 8.3], [12.2, 9.3], [12.9, 10.2], [13.9, 10.9], [14.9, 11.3], [16.0, 11.4]] },
    { sg: -1, u0: -10.8, u1: 11.3, uo: -8.7, ui: 9.1, back: 5.1, endO: 7.2, endI: 7.9, wing: [[11.4, 7.6], [12.1, 8.9], [13.0, 10.0], [14.3, 11.0], [15.6, 11.4], [16.9, 11.7]] }
  ],
  // the zone whose ground is shaped here (u from, u to, |v| up to); its own heights blend into the rest over its last 3 m
  Z: [-15, 21, 17]
};
const ksm = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const konUV = (x, z) => lmL(KF, x, z);
const konZoneUV = (u, v) => u >= KON.Z[0] && u <= KON.Z[1] && Math.abs(v) <= KON.Z[2];
const konZone = (x, z) => { const [u, v] = konUV(x, z); return konZoneUV(u, v); };
// 1 inside the zone, falling to 0 over its last 3 m
const konOm = (u, v) => ksm((u - KON.Z[0]) / 3) * ksm((KON.Z[1] - u) / 3) * ksm((KON.Z[2] - Math.abs(v)) / 3);
// the walls and wings themselves: buildings standing there are dropped, the fieldstone walls of the earthworks stop
const konCore = (x, z) => { const [u, v] = konUV(x, z); return u > -11.8 && u < 12 && Math.abs(v) < 8.4; };
// the nearest point of a wing to (u, |v| = s): d, the distance, positive behind the wing (away from the passage);
// t, how far along it (0 at the end block, 1 at its far end); wu, ws, that point; end, past its far end
function konWing(P, u, s) {
  const w = P.wing, n = w.length; let best = null, L = 0;
  const lens = []; for (let i = 0; i < n - 1; i++) { const l = Math.hypot(w[i + 1][0] - w[i][0], w[i + 1][1] - w[i][1]); lens.push(l); L += l; }
  for (let i = 0, at = 0; i < n - 1; at += lens[i], i++) {
    const du = w[i + 1][0] - w[i][0], ds = w[i + 1][1] - w[i][1], l = lens[i];
    const q = Math.max(0, Math.min(1, ((u - w[i][0]) * du + (s - w[i][1]) * ds) / (l * l))), pu = w[i][0] + du * q, ps = w[i][1] + ds * q, dd = Math.hypot(u - pu, s - ps);
    if (!best || dd < best.dd) best = { dd, side: du * (s - w[i][1]) - ds * (u - w[i][0]) >= 0 ? 1 : -1, t: (at + l * q) / L, wu: pu, ws: ps, end: i === n - 2 && q >= 1 };
  }
  return { d: best.dd * best.side, t: best.t, wu: best.wu, ws: best.ws, end: best.end };
}
// the earth behind a side wall: just under its top along it, rising to the crest of the rampart further back
const konE = (P, s) => KON.earth + (KON.crest - KON.earth) * ksm((s - P.back - 1) / 6);
// how far from the passage the earth at the inner face of the rampart is held: as far as the wing reaches
const konHeld = P => P.wing[P.wing.length - 1][1];
// the inner slope of the rampart past its inner face, held by the wings: down to the town level where a wing ends; past
// their ends it gives way to the earthworks as they are (h0; without it, to the town level)
const konSlope = P => { const e = P.wing[P.wing.length - 1]; return konE(P, e[1]) / (e[0] - P.u1); };
const konIn = (P, u, s, h0 = 0) => { const r = Math.max(0, konE(P, s) - konSlope(P) * Math.max(0, u - P.u1)); return r + (h0 - r) * ksm((s - konHeld(P)) / 3); };
// the top of a wing at its point (wu, ws): a little over the earth behind it
const konWingTop = (P, wu, ws) => Math.min(KON.top, konIn(P, wu, ws) + 0.2);

/* The ground in the zone: h, w and bits as fortPoint has them (1 raised, 32 cut or road), from the heights there
   without the gate (h0, w0). k: 0 keep, 1 cut (flat), 2 earth, 3 under a wall (w on its top). */
function konPoint(x, z, o, h0, w0) {
  const [u, v] = konUV(x, z); if (!konZoneUV(u, v)) return [h0, w0];
  const s = Math.abs(v), P = KON.sides[v >= 0 ? 0 : 1], pw = KON.pw;
  let k = 0, h = h0, wt = 0;
  if (s < pw) { if (u >= P.u0 - 0.3) { k = 1; h = 0; } }
  else if (u >= P.uo && u <= P.ui && s <= P.back) { k = 3; h = s < pw + 0.9 ? 0 : KON.earth; wt = KON.top; }                 // a side wall
  else if (u >= P.u0 && u < P.uo && s <= P.endO) { k = 3; h = u < P.uo - 1.3 ? h0 : KON.earth; wt = KON.top + 0.5; }       // the outer end block
  else if (u > P.ui && u <= P.u1 && s <= P.endI) { k = 3; h = u > P.u1 - 1.0 ? 0 : KON.earth; wt = KON.top + 0.5; }        // the inner end block
  else if (u >= P.uo && u <= P.ui) {
    // the rampart behind a wall: right up to its faces where the end blocks (and on the town side the wings) hold it,
    // further back as the earthworks have it
    const dF = Math.min(u - P.uo, P.ui - u), endS = u - P.uo < P.ui - u ? P.endO : konHeld(P);
    const wF = 1 - (1 - ksm(dF / 6)) * ksm((s - endS) / 3), t = Math.max(h0, konE(P, s));
    h = h0 + (t - h0) * wF; k = wF > 0.5 ? 2 : 0;
  } else if (u > P.ui) {
    if (s <= P.endI && u > P.u1) { k = 1; h = 0; }                                                                       // in front of the inner end block
    else {
      const W = konWing(P, u, s);
      if (W.d < -0.5) { k = 1; h = 0; }                                                                                    // between the wings
      else if (!W.end && W.d <= 0.5) { k = 3; h = W.d < 0 ? 0 : konIn(P, u, s, h0); wt = konWingTop(P, W.wu, W.ws); }        // a wing
      else { h = konIn(P, u, s, h0); k = h > 0.5 ? 2 : 0; }                                                                // behind it
    }
  }
  if (k === 0 && h === h0) return [h0, w0];
  const om = konOm(u, v), hh = h0 + (h - h0) * om, ww = k === 3 ? Math.max(hh, wt) : k === 0 ? w0 + (h - h0) * om : hh;
  if (om > 0.5) {
    if (k === 1) { o.b |= 32; o.b &= ~(1 | 2 | 4 | 16); }
    else if (k === 2) { o.b |= 1; o.b &= ~(2 | 4 | 16 | 32); }
    else if (k === 3) { o.b |= 32; o.b &= ~(1 | 2 | 4 | 16); }
  }
  return [hh, ww];
}

export { KF, KON, konCore, konIn, konOm, konPoint, konUV, konWing, konWingTop, konZone, konZoneUV };
