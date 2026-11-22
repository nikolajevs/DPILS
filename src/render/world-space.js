/* A material of an object placed in true world coordinates (a player, a shot, a grenade, the gun in hand): the page
   lifts the vertices of every material by the height of the terrain, which is right for the city built level and wrong
   for what is positioned by the camera's own height (that already has the terrain in it). The mark takes the lift off
   (see Material.prototype.onBeforeCompile in world/terrain.js).
   Every material of the model files (players, guns, items, the arms) comes through here, so it is also where glass of
   the transmission kind (KHR_materials_transmission) becomes plain see-through glass: with such a material in view
   three draws every opaque object of the scene once more into a texture for the glass to bend — the whole city again,
   ≈700 draw calls — before the frame itself. The lenses of the operator's goggles (Soldier.glb, the default character:
   the bots, the players and you in the glass of the walls) cost a fight a quarter of its frame (measured 2026-11-22). */
function worldSpace(m) {
  for (const x of Array.isArray(m) ? m : [m]) {
    x.userData.noTerr = true;
    if (x.transmission > 0) { x.transmission = 0; x.transparent = true; x.opacity = Math.min(x.opacity, 0.35); x.depthWrite = false; }
  }
  return m;
}
export { worldSpace };
