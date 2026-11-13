# Даугавпилс 3D

Город, по которому можно пройтись пешком или пролететь: [daugavpils.html](daugavpils.html), данные города [citydata.js](citydata.js) и транспорта [transit.js](transit.js).

## Источники данных

- **OpenStreetMap** © участники OpenStreetMap, ODbL: улицы, вода, зелень, контуры зданий, названия.
- **Кадастр Латвии** — Государственная земельная служба (VZD), открытые данные [data.gov.lv](https://data.gov.lv/dati/lv/dataset/kadastra-informacijas-sistemas-atvertie-dati), CC BY 4.0: контуры зданий, этажность, год постройки, материал стен и покрытие крыши. По ним выбираются высота дома, стиль фасада (кирпич, силикатный кирпич, панели, дерево) и форма крыши.

- **Расписание транспорта** — официальный GTFS «Daugavpils satiksme» ([satiksme.daugavpils.lv/saraksti/GTFS.zip](https://satiksme.daugavpils.lv/saraksti/GTFS.zip)): трамвайные и автобусные маршруты, остановки и время каждого рейса. Трамваи и автобусы в городе едут по этому расписанию по времени Риги; часы можно перематывать и ускорять.

Фасады и крыши нарисованы процедурно, это не фотографии.

## Дом Единства и гостиница «Латгола»

Два здания на площади Единства построены вручную, а не общим генератором фасадов (`buildLandmarks` в [daugavpils.html](daugavpils.html)). Размеры сняты с фотографий и сверены с контуром кадастра: ширина портика 29,4 м, карниз ≈18 м, шесть колонн ≈12 м.

- **Дом Единства** (Vienības nams, арх. Вернер Витандс, 1936–1937): портик с шестью коринфскими колоннами и лоджией, пилоны с рустом и надписью «VIENĪBAS NAMS», театральные витрины, сценическая коробка с флагом, крылья с магазинами на Rīgas iela и Ģimnāzijas iela, вход в концертный зал, терраса юго-западного крыла, двор.
- **Park Hotel Latgola** (бывшая гостиница «Latvija», 1975–1985, реконструкция 2000-х): волнообразная кровля над остеклённым верхним этажом, рамка двухсветного окна, стеклянный объём лестниц, часы на крыше (показывают время города), вывески HOTEL и PLAZA; рядом жёлтый торговый центр Latgola.
- **Клумбы**: ковровая клумба перед портиком (шалфей, цинерария, бархатцы, бегонии) с двумя пятишаровыми канделябрами и скамейками, клумба у входа в концертный зал.

Источники фото: Wikimedia Commons (категории *Latgola Hotel*, *Vienības laukums (Daugavpils)*, файл *Vienības nams.jpg* в латышской Википедии), [visitdaugavpils.lv](https://www.visitdaugavpils.lv/en/?p=3245) (в том числе снимки 1937 года), [celotajs.lv](https://www.celotajs.lv/en/e/vienibasnams), [militaryheritagetourism.info](https://militaryheritagetourism.info/lt/military/sites/view/891), [neighborhood.lv](https://neighborhood.lv/en/real-estate/daugavpils-architectural-guide/); проект реставрации фасада Дома Единства — Daugavpils pilsētas dome, 2010.

## Как пересобрать `citydata.js`

1. Скачать OpenStreetMap через Overpass API запросами из [tools/queries](tools/queries) в файлы `build.json`, `rest.json`, `rel.json` (одна папка).
2. Скачать с data.gov.lv кадастровые SHP для Даугавпилса (`0002000_kk_shp.zip`) и Аугшдаугавского края (`0022000_kk_shp.zip`), распаковать; из `building.zip` взять XML этих же территорий.
3. Собрать здания кадастра:
   ```bash
   node tools/cadastre.js cadastre.json kk_shp kk_shp2 -- Building/0002000_*/*.xml Building/0022000_*/*.xml
   ```
4. Собрать город:
   ```bash
   node tools/process.js osm cadastre.json citydata.js
   ```

## Как обновить расписание `transit.js`

Скачать и распаковать свежий GTFS «Daugavpils satiksme», затем:
```bash
node tools/transit.js gtfs citydata.js transit.js
```
