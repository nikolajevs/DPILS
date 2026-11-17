/* A material of an object placed in true world coordinates (a player, a shot, a grenade, the gun in hand): the page
   lifts the vertices of every material by the height of the terrain, which is right for the city built level and wrong
   for what is positioned by the camera's own height (that already has the terrain in it). The mark takes the lift off
   (see Material.prototype.onBeforeCompile in world/terrain.js). */
function worldSpace(m) { for (const x of Array.isArray(m) ? m : [m]) x.userData.noTerr = true; return m; }
export { worldSpace };
