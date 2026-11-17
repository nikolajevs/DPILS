/* Arenas: a play area (centre and radius, metres in the frame of the city) with the bases of the two teams, red first.
   Each base is a few spawn points taken from the walkable places of src/ui/places.js; the game moves a point off a house
   or the water when it starts. In the free-for-all every base point is a spawn point. Without an arena the whole city is
   the field and every player appears where he chose. */
export const ARENAS = {
  center: { name: 'Центр города', cx: -1730, cz: 1340, r: 520, bases: [
    [[-1487, 1263], [-1492.9, 1235.4], [-1416, 1395]],    // red: Vienības laukums, hotel Latgola, Pumpura square
    [[-1833, 1416], [-1975.5, 1439.5]],    // blue: Dubrovina park, the new university building
  ] },
  fortress: { name: 'Динабургская крепость', cx: -2680, cz: -280, r: 430, bases: [
    [[-2683.9, -95.2], [-2564.6, -133.2]],    // red: the Rothko centre, the Mikhailovsky gate
    [[-2529, -427.5], [-2844.8, -395.5], [-2824, -452]],        // blue: the engineers' arsenal, the commandant's house, the garden
  ] },
  station: { name: 'Вокзал и Рижская улица', cx: -950, cz: 960, r: 330, bases: [
    [[-806.8, 870.2], [-760, 905]],                              // red: the railway station
    [[-1053, 1030], [-1170.9, 1111.5]],                          // blue: Rīgas iela, the Vēsma bar
  ] },
};
