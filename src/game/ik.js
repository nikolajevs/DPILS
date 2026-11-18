import * as THREE from 'three';

/* ---------- reaching with the arms: two-bone IK and turns of bones ----------
   Everything is measured in the frame of a reference object set by setFrame (the inner group of a figure, the arms
   of the view from the eyes): positions and turns relative to it, so a scale or a squash above it does not matter.
   A bone is turned about its own joint by a turn given in that frame; reach bends a chain shoulder–elbow–wrist so that
   the wrist lands on a target, the elbow in the plane of the shoulder, the target and a pole (by default the elbow
   where the clip had it, so the arm keeps its bend). The bones passed may have twist bones between them (the arms of
   viewmodel.js do): only the first two are turned. */
const IM = new THREE.Matrix4(), MA = new THREE.Matrix4(), MB = new THREE.Matrix4(), QA = new THREE.Quaternion(), QB = new THREE.Quaternion(), QC = new THREE.Quaternion();
const VA = new THREE.Vector3(), VB = new THREE.Vector3(), VC = new THREE.Vector3(), VD = new THREE.Vector3(), VE = new THREE.Vector3(), VF = new THREE.Vector3(), VS = new THREE.Vector3(), VT = new THREE.Vector3(), VP = new THREE.Vector3();
const F = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], FX = new THREE.Vector3(), FY = new THREE.Vector3(), FZ = new THREE.Vector3();
function setFrame(ref) { ref.updateMatrixWorld(true); IM.copy(ref.matrixWorld).invert(); }
const at = (o, v) => v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(IM);
const relMatrix = (o, m) => m.multiplyMatrices(IM, o.matrixWorld);
function turnOf(o, q) { relMatrix(o, MA).decompose(VS, q, VT); return q; }
function turnBy(o, q) {   // turn the bone o by q (in the frame) about its own joint
  turnOf(o, QB); turnOf(o.parent, QC); QB.premultiply(q);
  o.quaternion.copy(QC.invert().multiply(QB)); o.updateMatrixWorld(true);
}
function reach(arm, T, pole) {
  const [a, b, c] = arm, A = at(a, VA), B = at(b, VB), C = at(c, VC), l1 = A.distanceTo(B), l2 = B.distanceTo(C);
  VD.subVectors(T, A); let d = VD.length(); if (d < 1e-5 || l1 < 1e-5 || l2 < 1e-5) return; VD.divideScalar(d);
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-4), (l1 + l2) * 0.999);
  const ca = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))), sa = Math.sqrt(1 - ca * ca);
  if (pole) VE.copy(pole); else VE.subVectors(B, A);   // no pole: the elbow stays on the side where the clip bent it
  VE.addScaledVector(VD, -VE.dot(VD)); if (VE.lengthSq() < 1e-8) VE.set(0, -1, 0); VE.normalize();
  VF.copy(A).addScaledVector(VD, l1 * ca).addScaledVector(VE, l1 * sa);   // the elbow
  turnBy(a, QA.setFromUnitVectors(VP.subVectors(B, A).normalize(), VE.subVectors(VF, A).normalize()));
  at(b, B); at(c, C); VE.copy(A).addScaledVector(VD, d);   // the wrist
  turnBy(b, QA.setFromUnitVectors(C.sub(B).normalize(), VE.sub(B).normalize()));
}
function basis(w, m, i, k, M) {   // a frame of a hand: y from the wrist to the middle knuckle, x across the knuckles
  FY.subVectors(m, w).normalize(); FX.subVectors(i, k); FZ.crossVectors(FX, FY).normalize(); FX.crossVectors(FY, FZ);
  return M.makeBasis(FX, FY, FZ);
}
// turn a hand so that its wrist, middle, index and little knuckles (bones) face as the four points given (in the frame)
function alignHand(hand, fingers, w, m, i, k) {
  at(hand, F[0]); at(fingers[0], F[1]); at(fingers[1], F[2]); at(fingers[2], F[3]); basis(F[0], F[1], F[2], F[3], MA);
  basis(w, m, i, k, MB);
  turnBy(hand, QA.setFromRotationMatrix(MB.multiply(MA.transpose())));   // a frame's transpose is its inverse
}

export { alignHand, at, reach, relMatrix, setFrame, turnBy, turnOf };
