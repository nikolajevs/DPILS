import * as THREE from 'three';
import { MP } from './mp.js';
import { makeAvatar, parseChar } from './avatar.js';
import { P } from './player.js';
import { mirrorShow, onMirror } from '../render/mirror.js';
import { scene } from '../render/renderer.js';
import { STATE } from '../core/state.js';
import { $ } from '../core/env.js';

/* ---------- you, in the glass ----------
   The game is seen from the eyes: the screen shows only the arms and the gun, there is no body under the camera. The
   mirror of the glass (src/render/mirror.js) looks back at you from behind the wall, so for that pass alone your
   character stands where you stand: the model you chose (the select of the game panel, the soldier by default) with
   the same clips the other players see — the steps by your own velocity, the crouch, the jump, the aim of your pitch,
   the gun in hand, its flash at your shot, the throw of a grenade. Shown just before the mirror is drawn and hidden
   just after, so neither the screen nor the shadows ever see it. None while dead (the camera is someone else's then)
   and in the free flight of the view tools. The model is made on the first mirror after the models have come. */
let av = null, key = '', root = null, gunW = -1, last = 0;
onMirror(on => {
  if (!on) { if (root) root.visible = false; return; }
  if (!STATE.started || P.fly || (MP.on && MP.dead)) return;
  const sel = $('mpChar'), k = parseChar(sel && sel.value) || 'soldier';
  if (!av || k !== key) {
    const a = makeAvatar(k); if (!a) return;   // the files have not come yet
    if (root) { scene.remove(root); root.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); }); }
    av = a; key = k; gunW = -1; root = new THREE.Group(); root.add(av.root); root.userData.noProbe = true; scene.add(root); mirrorShow(root);
  }
  const now = performance.now(), dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60; last = now;
  if (gunW !== MP.weapon) { gunW = MP.weapon; av.setGun(gunW); }
  root.position.set(P.x, P.y - P.eye, P.z); root.rotation.y = P.yaw; root.visible = true;
  av.update(dt, { vx: P.vx, vz: P.vz, yaw: P.yaw, pitch: P.pitch, h: P.eye, air: P.up > 0.02, vy: P.vy, dead: false, shotAt: MP.lastShot || 0, throwAt: MP.lastNade || 0 });
  root.updateMatrixWorld(true);
});
