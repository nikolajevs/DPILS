import * as THREE from 'three';
import { renderer } from './renderer.js';

/* ---------- a cube map mixed from two ----------
   The day of the game moves the light all the time, but the sky environment (a PMREM: a cube with prefiltered mip levels)
   and the city cubes of the reflections (src/render/cityprobe.js) are costly to make. They are made once for a few key
   moments of the day, and the light between two of them is a texel-by-texel mix of the two cubes: the filtering of a
   PMREM is linear, so the mix of two prefiltered cubes is the prefiltered mix of the two skies. Drawn as the PMREM
   generator of three.js draws its own levels: a box round a cube camera, one face and one mip level at a time, the same
   direction for the texel written and the texels read. */
const MAT = new THREE.ShaderMaterial({
  name: 'CubeMix',
  uniforms: { tA: { value: null }, tB: { value: null }, uMix: { value: 0 }, uLod: { value: 0 } },
  vertexShader: THREE.ShaderChunk.cube_vert,
  fragmentShader: `varying vec3 vWorldDirection; uniform samplerCube tA; uniform samplerCube tB; uniform float uMix; uniform float uLod;
void main() { vec3 d = normalize( vWorldDirection ); gl_FragColor = vec4( mix( textureLod( tA, d, uLod ).rgb, textureLod( tB, d, uLod ).rgb, uMix ), 1.0 ); }`,
  side: THREE.BackSide, blending: THREE.NoBlending, depthTest: false, depthWrite: false
});
const box = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), MAT), cam = new THREE.CubeCamera(1, 10, null);
// target = a·(1−k) + b·k over `lods` mip levels (1: the base level only, a target that makes its own mipmaps makes the rest)
function mixCube(target, a, b, k, lods = 1) {
  const u = MAT.uniforms; u.tA.value = a; u.tB.value = b; u.uMix.value = k;
  cam.renderTarget = target;
  for (let lod = 0; lod < lods; lod++) {
    u.uLod.value = lod; cam.activeMipmapLevel = lod;
    const s = target.width >> lod; target.viewport.set(0, 0, s, s);   // the renderer takes the viewport as it is, not scaled to the level
    cam.update(renderer, box);
    target.viewport.set(0, 0, target.width, target.height);
  }
  u.tA.value = u.tB.value = null;
}
// an empty PMREM-like target of the same size and levels as `like` (a PMREM of three.js): materials take it for the same shader
function pmremLike(like) {
  const rt = new THREE.WebGLCubeRenderTarget(like.width, { minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: false, type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false });
  for (const m of like.texture.mipmaps) rt.texture.mipmaps.push({ width: m.width, height: m.height });
  rt.texture.name = 'PMREM'; rt.texture.isPMREMTexture = true;
  return rt;
}

export { mixCube, pmremLike };
