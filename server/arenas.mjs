/* Arenas: a play area (centre and radius, metres in the frame of the city) with two groups of spawn points at its
   opposite ends. There are no sides: every base point is everybody's spawn point (the game picks the one farthest from
   the enemies), the groups only spread the points over the field. The points are taken from the walkable places of
   src/ui/places.js; the game moves a point off a house or the water when it starts. Without an arena the whole city is
   the field and every player appears where he chose. */
export const ARENAS = {
  center: { name: 'Центр города', cx: -1730, cz: 1340, r: 520, bases: [
    [[-1487, 1263], [-1492.9, 1235.4], [-1416, 1395]],    // Vienības laukums, hotel Latgola, Pumpura square
    [[-1833, 1416], [-1975.5, 1439.5]],    // Dubrovina park, the new university building
  ] },
  fortress: { name: 'Динабургская крепость', cx: -2680, cz: -280, r: 430, bases: [
    [[-2683.9, -95.2], [-2564.6, -133.2]],    // the Rothko centre, the Mikhailovsky gate
    [[-2529, -427.5], [-2844.8, -395.5], [-2824, -452]],        // the engineers' arsenal, the commandant's house, the garden
  ] },
  station: { name: 'Вокзал и Рижская улица', cx: -950, cz: 960, r: 330, bases: [
    [[-806.8, 870.2], [-760, 905]],                              // the railway station
    [[-1053, 1030], [-1170.9, 1111.5]],                          // Rīgas iela, the Vēsma bar
  ] },
  park: { name: 'Центральный парк', cx: -822, cz: 1462, r: 300, bases: [
    [[-900, 1500], [-760, 1520]],
    [[-760, 1390], [-880, 1380]],
  ] },
  church: { name: 'Церковная горка', cx: 56, cz: 1214, r: 260, bases: [
    [[-44, 1214], [-4, 1290]],
    [[156, 1214], [116, 1140]],
  ] },
  pond: { name: 'Пороховка', cx: 1100, cz: -1320, r: 300, bases: [
    [[1000, -1380], [1040, -1250]],
    [[1200, -1260], [1180, -1390]],
  ] },
  speedway: { name: 'Спидвей «Локомотив»', cx: 347, cz: 376, r: 260, bases: [
    [[250, 330], [270, 450]],
    [[450, 420], [430, 330]],
  ] },
  culture: { name: 'Дворец культуры', cx: 877, cz: -526, r: 300, bases: [
    [[780, -480], [800, -600]],
    [[960, -500], [950, -600]],
  ] },
  griva: { name: 'Грива, левый берег', cx: -1515, cz: 2570, r: 330, bases: [
    [[-1600, 2540], [-1560, 2640]],
    [[-1430, 2560], [-1450, 2480]],
  ] },
};
