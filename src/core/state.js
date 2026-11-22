/* Mutable values that several modules assign. An imported binding is read-only in the importing module, so these live
   as fields of one shared object instead of module variables:
   - GBC: the vertex height compensation (x, y, z) => dy applied by the geometry builders to what is being built now
     (null when none); set around each bridge, overpass, landmark or fortress part.
   - facTex, facMask, facPbr, facNrm, roofTex, serTex, serMask, serPbr, serNrm, matSer, goldGB, envRT: textures, materials
     and builders made while the city is being built (facPbr/serPbr: roughness/metalness/height/occlusion atlases of the
     facades; facNrm/serNrm: their baked tangent-space normal maps).
   - started, locked, night, introT: the state of the session (walk started, pointer locked, time of day, intro flight).
   - lodTimer, hudTimer, mapTimer, shadowDirty: countdowns and flags of the frame loop; setting a timer to 0 makes the
     next frame refresh that part.
   - cityHidden: the city canvas is faded out behind the start card outside a fight, so the loop does not draw it
     (src/game/loop.js) and the frame rate logic leaves those frames out (src/game/perf.js). */
export const STATE = {};
