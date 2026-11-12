# Даугавпилс 3D

Город, по которому можно пройтись пешком или пролететь: [daugavpils.html](daugavpils.html) и данные [citydata.js](citydata.js).

## Источники данных

- **OpenStreetMap** © участники OpenStreetMap, ODbL: улицы, вода, зелень, контуры зданий, названия.
- **Кадастр Латвии** — Государственная земельная служба (VZD), открытые данные [data.gov.lv](https://data.gov.lv/dati/lv/dataset/kadastra-informacijas-sistemas-atvertie-dati), CC BY 4.0: контуры зданий, этажность, год постройки, материал стен и покрытие крыши. По ним выбираются высота дома, стиль фасада (кирпич, силикатный кирпич, панели, дерево) и форма крыши.

Фасады и крыши нарисованы процедурно, это не фотографии.

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
