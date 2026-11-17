import * as THREE from 'three';

/* ---------- big meshes cut into tiles ----------
   The ground layers, the street markings, the depth grid under the ground and the plain geometry of the landmarks
   are each one mesh over the whole city: they could not be culled, so every frame drew all of them, millions of
   triangles behind the camera included, and every redraw of the shadow map drew the casting ones whole. After the
   city is built each such mesh is cut into square tiles (CHUNK metres) that are culled one by one.

   A triangle that crosses the edge of a tile is clipped by it (its attributes interpolated along the edges), so
   every piece of a mesh lies inside its own tile. The ground layers are painted over each other in the order of
   their triangles without writing depth; whatever overlaps in one place therefore stays in one tile, in its old
   order, and the tiles themselves never overlap.

   The mesh itself stays where it was, holding its tiles as children, and is no longer drawn itself (its layers are
   emptied): code that keeps it to show or hide it still works. */
const CHUNK = 1500, MIN_TRIS = 40000;
// what the cut mesh keeps: a valid geometry with nothing in it (it is not drawn any more)
const EMPTY = new THREE.BufferGeometry(); EMPTY.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); EMPTY.setIndex([]);

function splitGeometry(g, size) {
  const names = Object.keys(g.attributes), R = names.map(n => g.attributes[n].array), S = names.map(n => g.attributes[n].itemSize), NA = names.length;
  const INT = R.map(r => !(r instanceof Float32Array || r instanceof Float64Array)), PQ = names.indexOf('position');
  const idx = g.index.array, pos = R[PQ], nt = idx.length / 3;
  /* each tile lists its triangles in their old order: a whole triangle by its number t, a clipped piece of one
     as -(1 + its number in pieces) */
  const tiles = new Map(), pieces = [];
  let lastK = -1, lastL = null;
  const list = (i, j) => { const k = (i + 1000) * 4096 + j + 1000; if (k === lastK) return lastL; let l = tiles.get(k); if (!l) tiles.set(k, l = []); lastK = k; return lastL = l; };
  // a vertex of a piece: its raw attribute values, one array per attribute (normalized integers stay in their own scale)
  const vert = v => { const o = new Array(NA); for (let q = 0; q < NA; q++) { const s = S[q], r = R[q], a = new Array(s); for (let c = 0; c < s; c++) a[c] = r[v * s + c]; o[q] = a; } return o; };
  const lerp = (p, q, f) => { const o = new Array(NA); for (let k = 0; k < NA; k++) { const a = p[k], b = q[k], m = new Array(a.length); for (let c = 0; c < a.length; c++) m[c] = a[c] + (b[c] - a[c]) * f; o[k] = m; } return o; };
  // Sutherland–Hodgman: keep the part of the polygon where coordinate ax (0 x, 2 z) is ≥ lo (s = 1) or ≤ lo (s = −1)
  const clip = (poly, ax, lo, s) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = (a[PQ][ax] - lo) * s, db = (b[PQ][ax] - lo) * s;
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) out.push(lerp(a, b, da / (da - db)));
    }
    return out;
  };
  for (let t = 0; t < nt; t++) {
    const v0 = idx[3 * t], v1 = idx[3 * t + 1], v2 = idx[3 * t + 2];
    const x0 = pos[3 * v0], x1 = pos[3 * v1], x2 = pos[3 * v2], z0 = pos[3 * v0 + 2], z1 = pos[3 * v1 + 2], z2 = pos[3 * v2 + 2];
    const i0 = Math.floor(Math.min(x0, x1, x2) / size), i1 = Math.floor(Math.max(x0, x1, x2) / size), j0 = Math.floor(Math.min(z0, z1, z2) / size), j1 = Math.floor(Math.max(z0, z1, z2) / size);
    if (i0 === i1 && j0 === j1) { list(i0, j0).push(t); continue; }
    const tri = [vert(v0), vert(v1), vert(v2)];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      let poly = clip(tri, 0, i * size, 1); if (poly.length < 3) continue;
      poly = clip(poly, 0, (i + 1) * size, -1); if (poly.length < 3) continue;
      poly = clip(poly, 2, j * size, 1); if (poly.length < 3) continue;
      poly = clip(poly, 2, (j + 1) * size, -1); if (poly.length < 3) continue;
      pieces.push(poly); list(i, j).push(-pieces.length);
    }
  }
  const remap = new Int32Array(g.attributes[names[PQ]].count).fill(-1), out = [];
  for (const l of tiles.values()) {
    const used = []; let np = 0, ni = 0;
    for (const e of l) {
      if (e >= 0) { for (let m = 0; m < 3; m++) { const v = idx[3 * e + m]; if (remap[v] < 0) { remap[v] = used.length; used.push(v); } } ni += 3; }
      else { const n = pieces[-e - 1].length; np += n; ni += (n - 2) * 3; }
    }
    const nv = used.length + np, A = R.map((r, q) => new r.constructor(nv * S[q])), ix = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    for (let q = 0; q < NA; q++) { const s = S[q], r = R[q], a = A[q]; for (let w = 0; w < used.length; w++) { const v = used[w]; for (let c = 0; c < s; c++) a[w * s + c] = r[v * s + c]; } }
    let nn = used.length, p = 0;
    for (const e of l) {
      if (e >= 0) { ix[p++] = remap[idx[3 * e]]; ix[p++] = remap[idx[3 * e + 1]]; ix[p++] = remap[idx[3 * e + 2]]; continue; }
      const poly = pieces[-e - 1], base = nn;
      for (const V of poly) { for (let q = 0; q < NA; q++) { const s = S[q], a = A[q], x = V[q]; for (let c = 0; c < s; c++) a[nn * s + c] = INT[q] ? Math.round(x[c]) : x[c]; } nn++; }
      for (let m = 1; m < poly.length - 1; m++) { ix[p++] = base; ix[p++] = base + m; ix[p++] = base + m + 1; }
    }
    for (const v of used) remap[v] = -1;
    const ng = new THREE.BufferGeometry();
    names.forEach((n, q) => { const a = g.attributes[n]; ng.setAttribute(n, new THREE.BufferAttribute(A[q], S[q], a.normalized)); });
    ng.setIndex(new THREE.BufferAttribute(ix, 1)); ng.userData = g.userData;
    out.push(ng);
  }
  return out;
}

// cuts every big mesh of the scene that spans more than two tiles; returns how many meshes were cut
function splitBigMeshes(scene) {
  const todo = [];
  for (const o of scene.children) {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry || !o.geometry.index || Array.isArray(o.material) || o.geometry.groups.length || o.geometry.morphAttributes.position || o.children.length) continue;
    if (Object.values(o.geometry.attributes).some(a => a.isInterleavedBufferAttribute)) continue;
    const g = o.geometry; if (g.index.count / 3 < MIN_TRIS) continue;
    if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox;
    if (Math.max(b.max.x - b.min.x, b.max.z - b.min.z) < 2 * CHUNK) continue;
    todo.push(o);
  }
  for (const o of todo) {
    for (const g of splitGeometry(o.geometry, CHUNK)) {
      const c = new THREE.Mesh(g, o.material);
      c.renderOrder = o.renderOrder; c.castShadow = o.castShadow; c.receiveShadow = o.receiveShadow; c.customDepthMaterial = o.customDepthMaterial; c.customDistanceMaterial = o.customDistanceMaterial;
      c.onBeforeRender = o.onBeforeRender; c.onAfterRender = o.onAfterRender; c.userData = o.userData; c.frustumCulled = true;
      o.add(c);
    }
    o.geometry.dispose(); o.geometry = EMPTY; o.layers.disableAll();
  }
  return todo.length;
}

export { splitBigMeshes };
