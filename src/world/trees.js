import * as THREE from 'three';
import { PP } from '../render/post.js';
import { fortTreeY } from '../fortress/build.js';
import { fortNoTree } from '../fortress/ground-height.js';
import { SQ_SPRUCES } from '../landmarks/unity-square.js';
import { SHOP_TREES } from '../landmarks/shops.js';
import { PARK_TREES, parkNoTree } from '../landmarks/parks.js';
import { fuelNoTree } from '../landmarks/fuel.js';
import { spwNoTree } from '../landmarks/speedway.js';
import { lmClear } from '../landmarks/core.js';
import { ovNoTree } from './overpass.js';
import { vbNoTree } from './bridge-vienibas.js';
import { AREAS, inBuilding, onRoad, wetTree } from './data.js';
import { std } from '../render/materials.js';
import { R, mkCanvas } from '../render/textures.js';
import { U, renderer, scene, terrUniforms } from '../render/renderer.js';
import { hash, hb, pip, rnd } from '../core/util.js';
import { C, HX, HY, TTILE } from '../core/env.js';

/* ---------- trees ---------- */
// A crown is a cloud of small leaf cards that always face the viewer (and the sun in the shadow pass), shaded as one soft
// ball. Far trees are two-quad impostors baked from the very same model, so the switch between the two is hard to spot.
const treeTiles = new Map();
// Leaf atlas, 2 × 2 cells: 0 broadleaf, 1 birch, 2 pine needles, 3 spruce twigs
function leafAtlas() {
  const S = 256, cv = mkCanvas(S * 2, S * 2), g = cv.getContext('2d'), rr = (a, b) => a + R() * (b - a);
  const hsl = (h, s, l) => `hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%)`;
  const cell = (c, fn) => { g.save(); g.translate((c % 2) * S, (c >> 1) * S); g.beginPath(); g.rect(0, 0, S, S); g.clip(); fn(); g.restore(); };
  const leaf = (x, y, len, wid, rot, col, rib) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = col; g.beginPath(); g.moveTo(0, -len / 2); g.quadraticCurveTo(wid, -len * 0.12, 0, len / 2); g.quadraticCurveTo(-wid, -len * 0.12, 0, -len / 2); g.fill();
    g.strokeStyle = rib; g.lineWidth = 0.7; g.beginPath(); g.moveTo(0, -len / 2); g.lineTo(0, len / 2); g.stroke(); g.restore();
  };
  const disc = (n, spread, fn) => { for (let k = 0; k < n; k++) { const a = R() * 6.283, r = Math.pow(R(), 0.62) * S * spread; fn(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, k / n); } };
  cell(0, () => disc(250, 0.43, (x, y, t) => { const l = 13 + t * 24 + rr(-4, 4); leaf(x, y, rr(15, 24), rr(7, 10), R() * 6.283, hsl(rr(86, 112), rr(38, 56), l), hsl(95, 35, l + 9)); }));
  cell(1, () => disc(260, 0.44, (x, y, t) => { const l = 17 + t * 26 + rr(-4, 4); leaf(x, y, rr(10, 15), rr(5.5, 8), R() * 6.283, hsl(rr(72, 98), rr(40, 58), l), hsl(80, 40, l + 8)); }));
  cell(2, () => disc(30, 0.36, (x, y, t) => {
    g.strokeStyle = '#4a3626'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-14, 14), y + rr(-14, 14)); g.stroke();
    for (let k = 0; k < 26; k++) { const a = R() * 6.283, len = rr(14, 26); g.strokeStyle = hsl(rr(98, 128), rr(24, 40), 12 + t * 16 + rr(-3, 6)); g.lineWidth = rr(1, 1.7); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); }
  }));
  cell(3, () => {
    for (let b = 0; b < 24; b++) {
      const a = R() * 6.283, x0 = S / 2 + rr(-0.13, 0.13) * S, y0 = S / 2 + rr(-0.13, 0.13) * S, len = S * rr(0.16, 0.34), ca = Math.cos(a), sa = Math.sin(a), l0 = 8 + (b % 4) * 4.5;
      g.strokeStyle = '#3d2e22'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + ca * len, y0 + sa * len); g.stroke();
      for (let k = 0; k < len; k += 1.5) for (const sd of [-1, 1]) { const x = x0 + ca * k, y = y0 + sa * k, na = a + sd * rr(0.6, 1.2), nl = rr(8, 14) * (1 - k / len * 0.4); g.strokeStyle = hsl(rr(110, 138), rr(26, 40), l0 + rr(0, 11)); g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl); g.stroke(); }
    }
  });
  // give see-through texels the mean leaf colour of their cell, so mip levels do not grow dark fringes
  const id = g.getImageData(0, 0, S * 2, S * 2), d = id.data;
  for (let c = 0; c < 4; c++) {
    const x0 = (c % 2) * S, y0 = (c >> 1) * S; let r = 0, gg = 0, b = 0, n = 0;
    for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) { const k = (y * S * 2 + x) * 4; if (d[k + 3] > 200) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; } }
    r /= n || 1; gg /= n || 1; b /= n || 1;
    for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) { const k = (y * S * 2 + x) * 4; if (d[k + 3] < 8) { d[k] = r; d[k + 1] = gg; d[k + 2] = b; } }
  }
  const t = new THREE.DataTexture(new Uint8Array(d.buffer), S * 2, S * 2, THREE.RGBAFormat);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
// type: 0 pine, 1 broadleaf, 2 birch, 3 spruce
function treeGeo(type) {
  const P = [], N = [], Cc = [], K = []; let H = 0, Rm = 0, seq = 0;
  const solid = (geo, col, m) => {
    const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(m);
    const p = g.attributes.position.array, nn = g.attributes.normal.array, c = hb(col);
    for (let i = 0; i < p.length; i += 3) { P.push(p[i], p[i + 1], p[i + 2]); N.push(nn[i], nn[i + 1], nn[i + 2]); const f = 0.82 + 0.18 * hash(Math.round(p[i + 1] * 3) * 31 + type); Cc.push(c[0] / 255 * f, c[1] / 255 * f, c[2] / 255 * f); K.push(0, 0, 0, 0); H = Math.max(H, p[i + 1]); }
  };
  const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
  const limb = (ax, ay, az, bx, by, bz, r0, r1, col, seg = 6, arc) => {
    const d = new THREE.Vector3(bx - ax, by - ay, bz - az), L = d.length(), g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, true, arc ? arc[0] : 0, arc ? arc[1] : Math.PI * 2);
    solid(g, col, new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), ONE));
  };
  const card = (x, y, z, size, nx, ny, nz, shade, cellIdx) => {
    const rot = hash(seq * 7 + type * 131 + 5) * 6.283, l = Math.hypot(nx, ny, nz) || 1; seq++;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) { P.push(x, y, z); N.push(nx / l, ny / l, nz / l); Cc.push(shade, shade, shade); K.push(cx * size, cy * size, rot, cellIdx + 1); }
    H = Math.max(H, y + size * 1.15); Rm = Math.max(Rm, Math.hypot(x, z) + size * 1.15);
  };
  // blobs: [x, y, z, radius]; ys squashes them vertically; per = cards per square metre of radius
  const crown = (blobs, ys, per, size, cellIdx) => {
    let sx = 0, sy = 0, sz = 0, sw = 0; for (const [x, y, z, s] of blobs) { sx += x * s; sy += y * s; sz += z * s; sw += s; } sx /= sw; sy /= sw; sz /= sw;
    for (const [bx, by, bz, s] of blobs) {
      const n = Math.round(per * s * s);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, phi = Math.acos(1 - 2 * t), th = i * 2.39996 + s * 10, rr = 0.5 + 0.5 * Math.sqrt(hash(seq * 13 + type * 7 + 1));
        const ux = Math.sin(phi) * Math.cos(th), uy = Math.cos(phi), uz = Math.sin(phi) * Math.sin(th);
        const x = bx + ux * s * rr, y = by + uy * s * ys * rr, z = bz + uz * s * rr;
        const shade = (0.45 + 0.55 * (rr - 0.5) / 0.5) * (0.7 + 0.3 * (uy * 0.5 + 0.5));
        card(x, y, z, size * (0.8 + 0.4 * hash(seq * 5 + 3)), x - sx, (y - sy) / ys + s * 0.25, z - sz, shade, cellIdx);
      }
    }
    return sy;
  };
  let capY = 5;
  if (type === 0) {
    limb(0, 0, 0, 0.1, 5, 0.05, 0.27, 0.19, '#6b5546', 7); limb(0.1, 5, 0.05, 0.15, 11.4, 0.1, 0.19, 0.08, '#a8683f', 7);
    limb(0.14, 9.4, 0.1, 1.1, 10.1, 0.6, 0.07, 0.03, '#8d5a3a', 5); limb(0.14, 9.8, 0.1, -0.9, 10.4, -0.7, 0.07, 0.03, '#8d5a3a', 5);
    limb(0.1, 6.6, 0.05, 0.9, 7.0, -0.5, 0.04, 0.015, '#6b5546', 4);
    capY = crown([[0.1, 11.3, 0.1, 2.5], [1.2, 10.2, 0.6, 1.8], [-1.0, 10.5, -0.7, 1.9], [0.2, 12.4, 0.2, 1.5]], 0.6, 4.4, 0.9, 2);
  } else if (type === 1) {
    limb(0, 0, 0, 0, 3.5, 0, 0.25, 0.17, '#5b4a3c', 7);
    limb(0, 3.0, 0, 1.3, 4.9, 0.4, 0.12, 0.05, '#55463a', 5); limb(0, 3.2, 0, -1.1, 5.0, -0.6, 0.12, 0.05, '#55463a', 5);
    limb(0, 3.4, 0, 0.25, 6.5, -0.45, 0.15, 0.05, '#55463a', 5); limb(0, 2.8, 0, -0.4, 4.6, 1.15, 0.1, 0.04, '#55463a', 5);
    capY = crown([[0, 5.7, 0, 2.6], [1.35, 4.9, 0.4, 1.9], [-1.15, 5.0, -0.6, 2.0], [0.3, 6.9, -0.5, 1.8], [-0.4, 4.6, 1.25, 1.7]], 0.9, 4.2, 0.95, 0);
  } else if (type === 2) {
    limb(0, 0, 0, 0.12, 7.4, 0.08, 0.16, 0.05, '#e7e4dc', 6);
    for (let k = 0; k < 7; k++) { const y = 0.5 + k * 0.8 + hash(k * 17) * 0.4, r = 0.165 - y * 0.012; limb(y * 0.016, y, y * 0.011, y * 0.016, y + 0.12 + hash(k * 3) * 0.14, y * 0.011, r, r, '#2a2826', 6, [hash(k * 29) * 6.283, 1.2 + hash(k * 5) * 1.6]); }
    limb(0.08, 4.8, 0.05, 0.6, 6.0, 0.3, 0.05, 0.02, '#cfcbc2', 4); limb(0.08, 4.4, 0.05, -0.4, 5.6, -0.6, 0.05, 0.02, '#cfcbc2', 4);
    capY = crown([[0.05, 7.4, 0, 1.8], [0.6, 6.1, 0.3, 1.5], [-0.5, 8.6, -0.2, 1.3], [-0.35, 5.7, -0.6, 1.3]], 1.25, 5.2, 0.85, 1);
  } else {
    limb(0, 0, 0, 0, 9.8, 0, 0.2, 0.03, '#4f3d30', 6);
    for (let k = 0; k < 10; k++) {
      const y = 1.3 + k * 0.92, r = 2.45 * (1 - k / 10.5) + 0.12, m = Math.max(3, Math.round(r * 3.4));
      for (let j = 0; j < m; j++) { const a = j / m * 6.283 + k * 0.83, rr = r * (0.55 + 0.25 * hash(k * 31 + j)); card(Math.cos(a) * rr, y - 0.18 * r, Math.sin(a) * rr, 0.42 + r * 0.34, Math.cos(a) * 0.8, 0.55, Math.sin(a) * 0.8, 0.55 + 0.45 * k / 9, 3); }
    }
    card(0, 10.3, 0, 0.5, 0, 1, 0, 1, 3); capY = 5.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('aCard', new THREE.Float32BufferAttribute(K, 4));
  g.userData = { H: H + 0.2, R: Rm + 0.1, capY };
  return g;
}
const LEAF_GLSL = `vec4 leafTex(vec3 c) { float cell = max(c.z - 1.0, 0.0); return texture2D(uLeaf, (vec2(mod(cell, 2.0), floor(cell * 0.5)) + clamp(vec2(c.x, 1.0 - c.y), 0.02, 0.98)) * 0.5); }\n`;
// replaces <project_vertex>: wind sway, then the card corner is pushed out in view space
const TREE_VERT = `
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    float tScale = length(instanceMatrix[1].xyz);
  #else
    float tScale = 1.0;
  #endif
  vec4 tWorld = modelMatrix * mvPosition; mvPosition.y += terrainH(tWorld.xz);
  mvPosition.xz += vec2(0.8, 0.45) * ((sin(uTime * 1.1 + tWorld.x * 0.05 + tWorld.z * 0.07) + 0.5 * sin(uTime * 2.3 + tWorld.x * 0.13)) * max(transformed.y - 1.2, 0.0) * 0.006 * tScale);
  mvPosition = modelViewMatrix * mvPosition;
  vCard = vec3(0.5, 0.5, 0.0);
  if (aCard.w > 0.5) {
    float tA = aCard.z + sin(uTime * 2.7 + aCard.z * 40.0 + tWorld.x + tWorld.z) * 0.07;
    vec2 tC = aCard.xy * tScale, tO = vec2(tC.x * cos(tA) - tC.y * sin(tA), tC.x * sin(tA) + tC.y * cos(tA));
    mvPosition.xy += tO;
    vCard = vec3(sign(aCard.xy) * 0.5 + 0.5, aCard.w);
    /*NORMAL*/
  }
  gl_Position = projectionMatrix * mvPosition;`;
let matTree, matTreeDepth, matTreeFar;
function treeMaterials(leaf) {
  matTree = std({ vertexColors: true, roughness: 0.78, metalness: 0 }, 'tree', s => {
    s.uniforms.uLeaf = { value: leaf }; s.uniforms.uTime = U.time; s.uniforms.uSunW = U.sunDir; s.uniforms.uSunC = U.sunCol;
    s.vertexShader = 'attribute vec4 aCard; uniform float uTime; varying vec3 vCard;\n' + s.vertexShader.replace('#include <project_vertex>', TREE_VERT.replace('/*NORMAL*/', 'vNormal = normalize(vNormal + vec3(tO, 0.0) * (0.55 / max(length(tC), 1e-3)));'));
    s.fragmentShader = 'uniform sampler2D uLeaf; uniform vec3 uSunW; uniform vec3 uSunC; varying vec3 vCard;\n' + LEAF_GLSL + s.fragmentShader.replace('#include <map_fragment>', `
        vec4 lt = leafTex(vCard); float isLeaf = step(0.5, vCard.z);
        if (isLeaf > 0.5) {
          float cut = mix(0.45, 0.2, smoothstep(30.0, 220.0, length(vViewPosition)));
          diffuseColor.rgb *= pow(lt.rgb, vec3(2.2));
          diffuseColor.a = clamp((lt.a - cut) / max(fwidth(lt.a), 1e-3) + 0.5, 0.0, 1.0);
          if (diffuseColor.a < 0.05) discard;
        }`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (isLeaf > 0.5) {   // sunlight shining through the leaves when looking towards the sun
          float tr = pow(max(dot(-normalize(vViewPosition), (viewMatrix * vec4(uSunW, 0.0)).xyz), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunC * vec3(1.0, 1.15, 0.45) * (tr * 0.3);
        }`).replace('reflectedLight.directSpecular + reflectedLight.indirectSpecular', '(reflectedLight.directSpecular + reflectedLight.indirectSpecular) * (1.0 - 0.88 * isLeaf)');
  });
  matTree.extensions = { derivatives: true }; matTree.shadowSide = THREE.DoubleSide;
  matTreeDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  matTreeDepth.onBeforeCompile = s => { terrUniforms(s);
    s.uniforms.uLeaf = { value: leaf }; s.uniforms.uTime = U.time;
    s.vertexShader = 'attribute vec4 aCard; uniform float uTime; varying vec3 vCard;\n' + s.vertexShader.replace('#include <project_vertex>', TREE_VERT);
    s.fragmentShader = 'uniform sampler2D uLeaf; varying vec3 vCard;\n' + LEAF_GLSL + s.fragmentShader.replace('#include <map_fragment>', 'float la = leafTex(vCard).a; if (vCard.z > 0.5 && la < 0.4) discard;');
  };
}
// Renders each tree type from the side and from above into one atlas (4 columns × 2 rows) for the far impostors
function bakeImpostors(geos, leaf) {
  const CS = 256, rt = new THREE.WebGLRenderTarget(CS * 4, CS * 2, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
  const mat = new THREE.ShaderMaterial({
    vertexColors: true, uniforms: { uLeaf: { value: leaf } },
    vertexShader: `attribute vec4 aCard; varying vec3 vCard; varying vec3 vCol;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vCard = vec3(0.5, 0.5, 0.0);
        if (aCard.w > 0.5) { float a = aCard.z; mv.xy += vec2(aCard.x * cos(a) - aCard.y * sin(a), aCard.x * sin(a) + aCard.y * cos(a)); vCard = vec3(sign(aCard.xy) * 0.5 + 0.5, aCard.w); }
        vCol = color; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: 'uniform sampler2D uLeaf; varying vec3 vCard; varying vec3 vCol;\n' + LEAF_GLSL + 'void main() { vec4 lt = leafTex(vCard); vec3 c = vCol; if (vCard.z > 0.5) { if (lt.a < 0.4) discard; c *= lt.rgb; } gl_FragColor = vec4(c, 1.0); }'
  });
  const sc = new THREE.Scene(), old = new THREE.Color(), oldA = renderer.getClearAlpha(); renderer.getClearColor(old);
  renderer.setClearColor(new THREE.Color(0.17, 0.26, 0.13), 0); renderer.setRenderTarget(rt); renderer.clear(); renderer.autoClear = false; rt.scissorTest = true;
  geos.forEach((g, t) => {
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; sc.add(m);
    const { H, R: Rc } = g.userData;
    for (let row = 0; row < 2; row++) {
      const cam = row ? new THREE.OrthographicCamera(-Rc, Rc, Rc, -Rc, 0.1, 200) : new THREE.OrthographicCamera(-H / 2, H / 2, H, 0, 0.1, 200);
      if (row) { cam.position.set(0, 100, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); } else cam.position.set(0, 0, 100);
      rt.viewport.set(t * CS, row * CS, CS, CS); rt.scissor.set(t * CS, row * CS, CS, CS);
      renderer.setRenderTarget(rt); renderer.render(sc, cam);
    }
    sc.remove(m);
  });
  renderer.setRenderTarget(null); renderer.autoClear = true; renderer.setClearColor(old, oldA); mat.dispose();
  return rt.texture;
}
function buildTrees() {
  const leaf = leafAtlas(); treeMaterials(leaf);
  const hi = [0, 1, 2, 3].map(treeGeo), imp = bakeImpostors(hi, leaf), gl = renderer.getContext();
  // impostor: an upright quad that turns towards the camera plus a flat cap for the view from above
  matTreeFar = std({ roughness: 0.85, metalness: 0 }, 'treefar', s => {
    s.uniforms.uImp = { value: imp }; s.uniforms.uCap = { value: hi.map(g => new THREE.Vector2(g.userData.R / (g.userData.H / 2), g.userData.capY / g.userData.H)) };
    s.vertexShader = 'attribute float aQ; attribute float aType; uniform vec2 uCap[4]; varying vec3 vImp;\n' + s.vertexShader.replace('#include <project_vertex>', `
      vec3 iC = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz; iC.y += terrainH(iC.xz); float iW = instanceMatrix[0].x, iH = instanceMatrix[1].y;
      vec3 iTo = cameraPosition - iC; vec2 iR = normalize(vec2(iTo.z, -iTo.x) + vec2(1e-5, 0.0));
      vec3 iP, iN; vec2 iCap = uCap[int(aType + 0.5)];
      if (aQ < 0.5) { iP = iC + vec3(iR.x, 0.0, iR.y) * (position.x * iW) + vec3(0.0, position.y * iH, 0.0); iN = vec3(iR.x, 0.0, iR.y) * (position.x * 0.9) + vec3(-iR.y, 0.0, iR.x) * 0.55 + vec3(0.0, position.y * 1.3 - 0.35, 0.0); }
      else { iP = iC + vec3(position.x * iCap.x * iW, iCap.y * iH, position.z * iCap.x * iW); iN = vec3(position.x * 0.35, 1.0, position.z * 0.35); }
      vNormal = normalize((viewMatrix * vec4(iN, 0.0)).xyz);
      vImp = vec3(uv, aType + aQ * 4.0);
      vec4 mvPosition = viewMatrix * vec4(iP, 1.0);
      gl_Position = projectionMatrix * mvPosition;`);
    s.fragmentShader = 'uniform sampler2D uImp; varying vec3 vImp;\n' + s.fragmentShader.replace('#include <map_fragment>', `
      float iq = step(3.5, vImp.z), it = vImp.z - iq * 4.0;
      vec4 it4 = texture2D(uImp, (vec2(it, iq) + clamp(vImp.xy, 0.01, 0.99)) * vec2(0.25, 0.5));
      float icut = mix(0.4, 0.14, smoothstep(250.0, 1400.0, length(vViewPosition)));
      diffuseColor.rgb *= pow(it4.rgb, vec3(2.2));
      diffuseColor.a = clamp((it4.a - icut) / max(fwidth(it4.a), 1e-3) + 0.5, 0.0, 1.0);
      if (diffuseColor.a < 0.05) discard;`).replace('reflectedLight.directSpecular + reflectedLight.indirectSpecular', '(reflectedLight.directSpecular + reflectedLight.indirectSpecular) * 0.12');
  });
  matTreeFar.extensions = { derivatives: true };
  const farGeo = new THREE.BufferGeometry();
  farGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0, -1, 0, -1, -1, 0, 1, 1, 0, 1, 1, 0, -1], 3));
  farGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  farGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1], 2));
  farGeo.setAttribute('aQ', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
  farGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const add = (x, z, type, sc, v) => {
    if (Math.abs(x) > HX || Math.abs(z) > HY || lmClear(x, z) || wetTree(x, z) || fortNoTree(x, z) || vbNoTree(x, z) || spwNoTree(x, z) || fuelNoTree(x, z) || ovNoTree(x, z) || parkNoTree(x, z)) return;
    const i = Math.floor(x / TTILE), j = Math.floor(z / TTILE), k = (i + 100) * 1000 + j + 100;
    let t = treeTiles.get(k); if (!t) treeTiles.set(k, t = { x0: i * TTILE, z0: j * TTILE, list: [] }); t.list.push(x, z, type, sc, v);
  };
  for (let i = 0; i < C.t.length; i += 2) { const v = rnd(i, 2); add(C.t[i] / 10, C.t[i + 1] / 10, v < 0.7 ? 1 : v < 0.85 ? 2 : 3, 0.8 + rnd(i, 1) * 0.5, v); }
  SQ_SPRUCES.forEach(([x, z, sc], k) => add(x, z, 3, sc, rnd(k, 5)));   // the spruces by Vienības laukums
  SHOP_TREES.forEach(([x, z, type, sc], k) => add(x, z, type, sc, rnd(k, 11)));   // trees on the lawns of the stores
  PARK_TREES.forEach(([x, z, type, sc], k) => add(x, z, type, sc, rnd(k, 13)));   // the rows of trees in the parks
  // density per land class: spacing (m), keep probability, type picker
  const DENS = { 1: [17, 1, v => v < 0.58 ? 0 : v < 0.74 ? 3 : v < 0.9 ? 2 : 1], 2: [15, 0.8, v => 1], 4: [9.5, 0.82, v => v < 0.6 ? 1 : v < 0.8 ? 2 : v < 0.95 ? 3 : 0], 5: [16, 0.9, v => v < 0.55 ? 1 : v < 0.75 ? 2 : 3],
    8: [20, 0.38, v => v < 0.72 ? 1 : v < 0.86 ? 2 : 3], 11: [12, 0.5, v => v < 0.85 ? 1 : 2], 3: [30, 0.25, v => v < 0.6 ? 1 : 2] };
  const SCALE = { 1: [0.85, 0.5], 2: [0.35, 0.3], 4: [0.85, 0.65], 5: [0.8, 0.5], 8: [0.55, 0.45], 11: [0.45, 0.3], 3: [0.7, 0.5] };
  AREAS.forEach((a, n) => {
    const d = DENS[a.cls]; if (!d) return; const [s, keep, typ] = d, bb = a.bb;
    for (let gx = Math.ceil(bb[0] / s); gx * s < bb[2]; gx++) for (let gz = Math.ceil(bb[1] / s); gz * s < bb[3]; gz++) {
      const h1 = hash(gx * 73856093 ^ gz * 19349663 ^ n), h2 = hash(gx * 83492791 ^ gz * 2971215073 ^ n);
      if (h1 > keep) continue;
      const x = gx * s + (h2 - 0.5) * s * 0.9, z = gz * s + (hash(gx * 19 + gz * 7 + n) - 0.5) * s * 0.9;
      if (!pip(x, z, a.rings[0])) continue; let hole = false; for (let k = 1; k < a.rings.length; k++) if (pip(x, z, a.rings[k])) { hole = true; break; } if (hole) continue;
      if (onRoad(x, z, 2) || inBuilding(x, z) || inBuilding(x + 2, z) || inBuilding(x - 2, z) || inBuilding(x, z + 2) || inBuilding(x, z - 2)) continue;
      const sc = SCALE[a.cls]; add(x, z, typ(h2), sc[0] + h1 * sc[1], h2);
    }
  });
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), q0 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color(); let count = 0;
  // instanced meshes share geometry, so culling uses one generous sphere around the tile origin
  const tileSphere = new THREE.Sphere(new THREE.Vector3(0, 6, 0), TTILE * 0.75 + 20);
  hi.forEach(g => g.boundingSphere = tileSphere);
  // smooth leaf edges: with multisampling on, the alpha of a leaf card becomes sample coverage
  const a2cOn = () => { if (PP.msaa > 0) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE); }, a2cOff = () => gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  const tint = v => { const f = 0.84 + v * 0.3; return col.setRGB(f * (0.94 + (v * 13 % 1) * 0.14), f, f * (0.86 + (v * 29 % 1) * 0.12)); };
  for (const t of treeTiles.values()) {
    const l = t.list, n = l.length / 5; count += n; t.hi = []; t.lo = [];
    const cx = t.x0 + TTILE / 2, cz = t.z0 + TTILE / 2;
    const fg = farGeo.clone(), types = new Float32Array(n); fg.boundingSphere = tileSphere;
    const L = new THREE.InstancedMesh(fg, matTreeFar, n);
    for (let i = 0; i < n; i++) {
      const type = l[5 * i + 2], sc = l[5 * i + 3], v = l[5 * i + 4], sy = sc * (0.88 + (v * 7 % 1) * 0.3), H = hi[type].userData.H; types[i] = type;
      M.compose(new THREE.Vector3(l[5 * i] - cx, fortTreeY(l[5 * i], l[5 * i + 1]), l[5 * i + 1] - cz), q0, new THREE.Vector3(sc * H / 2, sy * H, 1)); L.setMatrixAt(i, M); L.setColorAt(i, tint(v));
    }
    fg.setAttribute('aType', new THREE.InstancedBufferAttribute(types, 1));
    L.position.set(cx, 0, cz); L.instanceMatrix.needsUpdate = true; L.instanceColor.needsUpdate = true; L.onBeforeRender = a2cOn; L.onAfterRender = a2cOff; scene.add(L); t.lo.push(L);
    for (let type = 0; type < 4; type++) {
      const idx = []; for (let i = 0; i < n; i++) if (l[5 * i + 2] === type) idx.push(i); if (!idx.length) continue;
      const Hm = new THREE.InstancedMesh(hi[type], matTree, idx.length);
      idx.forEach((i, k) => {
        const sc = l[5 * i + 3], v = l[5 * i + 4], sy = sc * (0.88 + (v * 7 % 1) * 0.3); q.setFromAxisAngle(up, v * 6.283);
        M.compose(new THREE.Vector3(l[5 * i] - cx, fortTreeY(l[5 * i], l[5 * i + 1]), l[5 * i + 1] - cz), q, new THREE.Vector3(sc, sy, sc)); Hm.setMatrixAt(k, M); Hm.setColorAt(k, tint(v));
      });
      Hm.position.set(cx, 0, cz); Hm.instanceMatrix.needsUpdate = true; Hm.instanceColor.needsUpdate = true; Hm.customDepthMaterial = matTreeDepth;
      Hm.castShadow = true; Hm.receiveShadow = true; Hm.visible = false; Hm.onBeforeRender = a2cOn; Hm.onAfterRender = a2cOff; scene.add(Hm); t.hi.push(Hm);
    }
  }
  return count;
}

export { buildTrees, treeTiles };
