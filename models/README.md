# Модели

Текстуры готовых GLB дополнительно перекодированы в WebP q80 без потери разрешения ([tools/shrink-models.mjs](../tools/shrink-models.mjs), геометрия уже была упакована meshopt): `fp_ak47.glb` 5,8 → 3,7 МБ, `fp_mg.glb` 0,63 → 0,57 МБ; остальные файлы оказались достаточно плотными и не тронуты. Анимации, скины и материалы сохранены; вид оружия в бою проверен без экрана (`tools/shot-items.mjs`).

## АК-47 (`fp_ak47.glb`)

**CC BY 4.0.** This work is based on "[FPS Character Animation Pack Ak-47](https://sketchfab.com/3d-models/fps-character-animation-pack-ak-47-b95778a564094fc3a49d1d6a3b6a30ab)" by Cristian David Duque Camacho ([DuqueCD7](https://sketchfab.com/DuqueCD7)) licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

Руки солдата в перчатках и камуфляжной куртке держат автомат с деревянным цевьём и прикладом. Есть скелет и анимации: покой, ходьба, бег, выстрел, перезарядка, взятие в руки. Скачанный glTF весил 117 МБ при текстурах 4096 px, [tools/fp-ak.mjs](../tools/fp-ak.mjs) собирает из него файл на 6 МБ (3,7 МБ после перекодирования текстур):

- оставлены шесть клипов (`idle`, `walk`, `run`, `fire`, `reload`, `equip`), лишние ключи убраны;
- цвет и нормали автомата сжаты до 2048 px, остальные текстуры до 1024 px, всё в WebP;
- геометрия упакована `EXT_meshopt_compression`;
- добавлен узел `AK47_static`: автомат без рук в позе покоя, упрощённый втрое (9,5 тыс. треугольников).

Руки с анимированным автоматом — вид от первого лица ([src/game/viewmodel.js](../src/game/viewmodel.js)). `AK47_static` держат обеими руками другие игроки ([src/game/avatar.js](../src/game/avatar.js)). Для скачивания с Sketchfab нужен аккаунт и его API-токен.

## Оружие слотов 1–4 (`fp_shotgun.glb`, `fp_sniper.glb`, `fp_pistol.glb`, `fp_mg.glb`)

Все четыре модели — **CC BY 4.0**, атрибуции обязательны:

| Слот | Файл | Модель | Автор | Лицензия |
|---|---|---|---|---|
| 1 Дробовик | `fp_shotgun.glb` | [Remington 870 Shotgun](https://sketchfab.com/3d-models/none-6db0ad4764d14eee8f063eea3600071b) | Andrei Milin | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |
| 2 Снайперская | `fp_sniper.glb` | [SVD (Dragunov) *Updated*](https://sketchfab.com/3d-models/none-d4a9412275aa4974b146ad8ce9dc5fc2) | WillyG99 | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |
| 3 Пистолет | `fp_pistol.glb` | [Makarov PM](https://sketchfab.com/3d-models/none-dbf03ce95c834cb7b07edba799dcd46a) | Martin Trafas | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |
| 4 Пулемёт | `fp_mg.glb` | [LMG (FN Minimi)](https://sketchfab.com/3d-models/none-8c24d7374ea64bdab1c30f49c69d5ed8) | DJMaesen | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |

This work is based on the models above, each by its author, licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

[tools/fp-weapons.mjs](../tools/fp-weapons.mjs) собирает их из скачанных с Sketchfab glTF (`node tools/fp-weapons.mjs <shotgun|sniper|pistol|mg|all> <каталог>`; каталог содержит подпапки `shotgun/`, `sniper/`, `pistol/`, `mg/` с `scene.gltf`). Конвейер:

- вершины поворачиваются и переносятся **при целой иерархии** (дуло вдоль +z, верх +y, рукоять в начале координат, масштаб в метрах), и только потом удаляются лишние узлы, скининг и анимации — иначе bounding box считается по браку;
- у SVD вершины уже в bind-pose, поэтому скин просто снимается, а не запекается; у пистолета удалены подставка, пол, патрон и глушитель;
- текстуры переименовываются `<материал>_<слот>_<base|normal|mr|emissive>` и жмутся в WebP (1024 px, у снайперской 2048; карты metal/rough и emissive — вполовину меньше);
- геометрия упаковывается `EXT_meshopt_compression` (декодер подключается в `avatar.js` и `viewmodel.js`).

Итог: дробовик 0.19 МБ / 6.2 тыс. треугольников, снайперская 1.40 МБ / 40.4 тыс., пистолет 0.60 МБ / 12.1 тыс., пулемёт 0.63 МБ / 26.8 тыс. Модели в метрах (в отличие от старых моделей Quaternius в «единицах солдата»). Где на каждой рукоятка и цевьё, записано в таблице `HOLD` в [src/game/viewmodel.js](../src/game/viewmodel.js). По ней стволы держат обеими руками и руки в перчатках из `fp_ak47.glb` (вид от первого лица), и другие игроки ([src/game/avatar.js](../src/game/avatar.js)). Вспышка выстрела ставится у края дула. Для скачивания с Sketchfab нужен аккаунт и его API-токен.

## Персонажи

Четыре выбираемых персонажа игры (прежние мужчина и женщина Quaternius и пешеходы удалены). Тела и анимации — **CC BY 4.0** (Sketchfab), атрибуции ниже. Сборка — [tools/character.mjs](../tools/character.mjs) (обобщён из [tools/soldier.mjs](../tools/soldier.mjs)): штатное оружие и витринные подставки вырезаны, текстуры сжаты в WebP ≤1024 px, клипы ретаргетятся на скелет каждого тела (Mixamo напрямую, 2B — через таблицу костей 3ds Max biped; руки клипа Carry — по абсолютной мировой ориентации источника), файл пакуется meshopt. Клипы тела после этого пересобраны [tools/char-clips.mjs](../tools/char-clips.mjs) (от bind-позы, с клипами шагов во все стороны и приседа — ниже). **Модели не перекрашиваются** — текстуры сохраняются как есть ради качества; в будущем у двух команд будут свои модели.

| Файл | Персонаж | Автор | Лицензия | Итог |
|---|---|---|---|---|
| `Soldier.glb` | [S.W.A.T. Operator](https://sketchfab.com/models/9e82fabf26194896b5ad4a364d864eab) — каска с ПНВ, маска, форма | SpatialNeglect | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | 2,5 МБ, 35 тыс. трис, рост 1,8 м |
| `Spartan.glb` | [Spartan Armour MKV — Halo Reach](https://sketchfab.com/3d-models/spartan-armour-mkv-halo-reach-57070b2fd9ff472c8988e76d8c5cbe66) — броня спартанца (фан-арт) | McCarthy3D | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | 3,6 МБ, 40 тыс. трис, рост 2,0 м |
| `Alien.glb` | [Free Mixamo retextured Model](https://sketchfab.com/3d-models/free-mixamo-retextured-model-62990b050faf48dd8590d5d15872857c) — пришелец в скафандре | JonnyMANSON | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | 1,4 МБ, 40 тыс. трис, рост 1,9 м |
| `2B.glb` | [NieR:Automata 2B](https://sketchfab.com/3d-models/nierautomata-2b-cec89dce88cf4b3082c73c07ab5613e7) — платье, повязка, юбка на костях (риг LeoZack) | Negin | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | 1,1 МБ, 40 тыс. трис, рост 1,68 м |

Скачивание источников — [tools/sf-dl.mjs](../tools/sf-dl.mjs) (токен аккаунта в `sketchfab.token`, uid и команды в шапке `character.mjs`).

**Анимации** — Mixamo-клипы со Sketchfab, все **CC BY 4.0**, атрибуции обязательны:

| Клип во всех файлах персонажей | Источник | Автор |
|---|---|---|
| Idle, Carry | [Rifle Idle](https://sketchfab.com/3d-models/rifle-idle-d9ed346ee92c4606baca727b0ad6ed7b) | fauze |
| Walk | [ST Pistol Walk](https://sketchfab.com/3d-models/st-pistol-walk-94486ec326714092aec96746e3315c3c) | fauze |
| Jump | [Jumping](https://sketchfab.com/3d-models/jumping-9d8127cec9f04c3db3287cab301b4529) | fauze |
| Death | [Falling Back Death(1)](https://sketchfab.com/3d-models/falling-back-death1-61732876c5ad4d548c433252be7f2d25) | fauze |
| WalkL, WalkR — шаг вбок | [Walk Left](https://sketchfab.com/models/78cb1d884e43412e9f3ed7a73ae5424f), [Walk Right](https://sketchfab.com/models/9a272afe0d3f442e886d2c1a2b1ba1d5) | fauze |
| Crouch — на колене с оружием | [ST Idle Crouching Aiming](https://sketchfab.com/models/f2cf924280234133abb31688626a597f) | fauze |
| Run — бег вперёд | [Synth Running Forward 2.0](https://sketchfab.com/models/6826f3a868fc4071aac3de237bb3f577) | [vadimfedenko](https://sketchfab.com/vadimfedenko) |
| RunL, RunR — бег боком (R — зеркало L) | [Synth Strafe Left 2.0](https://sketchfab.com/models/10c339229d6d4f3f9344aa6d6c46711a) | [vadimfedenko](https://sketchfab.com/vadimfedenko) |
| RunB — бег спиной вперёд | [Synth Running Backward 2.0](https://sketchfab.com/models/794a943660ee4b0f92c4db8d8874c43a) | [vadimfedenko](https://sketchfab.com/vadimfedenko) |
| WalkB — шаг назад | [Walking Backwards](https://sketchfab.com/models/244e1a6443bd43019243e13713ebbf58) | [Appsbypaulhamilton](https://sketchfab.com/Appsbypaulhamilton) |
| CrouchF — ходьба вприсядку (назад — она же задом наперёд) | [Crouched Walking character](https://sketchfab.com/models/a06d785a52184d7e86f77debcbc18e51) | [merks11](https://sketchfab.com/merks11) |
| CrouchL, CrouchR — вприсядку вбок (R — зеркало L) | [Crouched Sneaking Left](https://sketchfab.com/models/f2f87e2623c547b489d761cff0948d81) | [roffa](https://sketchfab.com/roffa) |

This work is based on "Walk Left", "Walk Right", "ST Idle Crouching Aiming" by fauze, "Synth Running Forward 2.0", "Synth Strafe Left 2.0", "Synth Running Backward 2.0" by vadimfedenko, "Walking Backwards" by Appsbypaulhamilton, "Crouched Walking character" by merks11 and "Crouched Sneaking Left" by roffa (Sketchfab), licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

Клипы тел (всё, кроме Carry) ретаргетит [tools/char-clips.mjs](../tools/char-clips.mjs): `node tools/char-clips.mjs <каталог клипов>` перезаписывает их в четырёх файлах (исходники качаются `tools/sf-dl.mjs` под именами из таблицы `SRC` в шапке скрипта). Поворот каждого сустава переносится от **bind-позы** скина (обратные bind-матрицы — чистая T/A-поза с прямыми ногами), а не от поз узлов файла: те — кадр чужой анимации (спартанец стоял с согнутыми коленями, 2B — полусидя с поднятыми руками), и прежний ретаргет `character.mjs` переносил эту разницу во все клипы (у 2B ноги разлетались в стороны при ходьбе и висели в воздухе в приседе). Высота таза подбирается так, чтобы нижняя ступня цели была над землёй ровно на столько, на сколько у источника, — ноги стоят на земле при любой длине. У клипов шагов в extras записаны скорость по земле, фаза постановки и отрыва левой ступни и направление; у прыжка — моменты отрыва, вершины и касания (см. шапку скрипта и «Движения в бою» в README). Файлы выросли на 0,03–0,37 МБ: оператор 2,5 МБ, спартанец 3,6, пришелец 1,4, 2B 1,1.

Используется в [src/game/avatar.js](../src/game/avatar.js): реестр `CHARS` (файл, имя в панели, рост, поворот), выбор ездит в протоколе ключом `char`. Чтобы добавить персонажа, достаточно собрать его файл `tools/character.mjs` и добавить строку в `CHARS` (и в список сервера `server/game.mjs`).

Старые стволы Quaternius (`Pistol.glb`, `Rifle.glb`, `Shotgun.glb`, `Sniper.glb` — CC0, наборы Zombie Apocalypse Kit и Toon Shooter Game Kit) заменены моделями `fp_*` выше и больше не загружаются; файлы оставлены в репозитории как запасные.

## Цветы (`ez-tree/`)

**MIT**, автор — Daniel Greenheck ([ez-tree](https://github.com/dgreenheck/ez-tree)); текст лицензии — `ez-tree/LICENSE.txt`.

| Файл | Что |
|---|---|
| `flower_blue.glb`, `flower_white.glb`, `flower_yellow.glb` | цветы в сантиметрах (масштаб ×0.01) |

Инстансятся по газонам парков в [src/landmarks/flora.js](../src/landmarks/flora.js), минуя дорожки, клумбы и площадки. Текстуры земли `textures/ground_grass.webp` и `textures/ground_dirt.webp` — оттуда же (MIT).

Детальные карты земли `textures/detail_grass|asph|pave|gravel.webp` — серые 512 px, из фотографий [ambientCG](https://ambientcg.com) (**CC0**: Grass001, Asphalt012, PavingStones070, Gravel021). Яркость умножается на цвет вершин в `groundMaterial` (серый 128 = «без изменений»), подгружаются из `detailTex` ([src/render/textures.js](../src/render/textures.js)); пока файл не пришёл, стоит процедурный шум.

Те же карты дают рельеф земли: `groundMaterial` берёт серое как высоту (0,05 м × доля цвета) и наклоняет нормаль по разности текстуры вдоль осей мира, так что при низком солнце видны швы брусчатки и зерно асфальта. Рельеф гаснет с расстоянием (20–90 м), чтобы дальняя земля не мерцала.

Кирпич фасадов: строки 1 (красный) и 2 (силикатный) атласа фасадов в `facadeAtlas` ([src/render/textures.js](../src/render/textures.js)) рисуют не процедурную кладку, а серые 256 px плитки `textures/brick_red.webp` и `textures/brick_white.webp` (ambientCG, **CC0**: Bricks097 и Bricks016); цвет даёт тон здания. Плитки грузятся до сборки атласа (`brickPhotos`), если файла нет, остаётся прежняя нарисованная кладка.

Рельеф фасадов: `facadeMaterial` ([src/render/materials.js](../src/render/materials.js)) берёт серое цветового атласа за высоту (швы, наличники и рамы — ниже) и наклоняет нормаль по разности двух выборок атласа на касательном базисе из uv стены. На стёклах рельефа нет, с 15 до 80 м он гаснет. Сила — `FACADE_RELIEF`.

Кора берёзы: `textures/bark_birch.webp` (512 px, белая с чёрными горизонтальными чечевичками и тёмными пятнами) делается скриптом [tools/gen-birch-bark.py](../tools/gen-birch-bark.py) — готовой бесшовной берёзовой коры в CC0-каталогах нет. Ствол и ветки берёзы в `treeGeo` ([src/world/trees.js](../src/world/trees.js)) получают uv цилиндра (в `aCard.xyz` сплошных частей), целое число повторов по окружности, 0,7 м на повтор; пятна из геометрии убраны. Дальние деревья-импостеры по-прежнему с гладким стволом.

## Машины (`bmw_*.glb`)

Готовые модели **BMW** вместо прежних процедурных коробок. Все четыре — **CC BY 4.0**, атрибуции обязательны:

| Файл | Модель | Автор | Лицензия |
|---|---|---|---|
| `bmw_sedan.glb` | [Low Poly BMW G80 M3](https://sketchfab.com/3d-models/low-poly-bmw-g80-m3-ea3e807ff69e40fe82c5577ee9f0a2f4) | SharkyStudios | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |
| `bmw_hatch.glb` | [2018 BMW M140i](https://sketchfab.com/3d-models/2018-bmw-m140i-24f09cc46773424fb2a3922427f1c37d) | Ddiaz Design | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |
| `bmw_suv.glb` | [Low Poly BMW X6M Competition](https://sketchfab.com/3d-models/low-poly-bmw-x6m-competition-dbc45a151624413aac9a378b570ddd02) | SharkyStudios | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |
| `bmw_police.glb` | производная от G80 M3 (белый кузов, синяя полоса, мигалка) | SharkyStudios | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) |

This work is based on "Low Poly BMW G80 M3" (https://sketchfab.com/3d-models/low-poly-bmw-g80-m3-ea3e807ff69e40fe82c5577ee9f0a2f4) by SharkyStudios (https://sketchfab.com/sharkycat109) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

This work is based on "2018 BMW M140i" (https://sketchfab.com/3d-models/2018-bmw-m140i-24f09cc46773424fb2a3922427f1c37d) by Ddiaz Design (https://sketchfab.com/ddiaz-design) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

This work is based on "Low Poly BMW X6M Competition" (https://sketchfab.com/3d-models/low-poly-bmw-x6m-competition-dbc45a151624413aac9a378b570ddd02) by SharkyStudios (https://sketchfab.com/sharkycat109) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

[tools/bmw.mjs](../tools/bmw.mjs) собирает их из скачанных с Sketchfab glTF (`node tools/bmw.mjs <каталог> [треугольники]`; каталог содержит подпапки `sedan-g80/`, `hatch-m140/`, `suv-x6m/` с `scene.gltf`). Конвейер:

- вершины запекаются в мировые координаты города (метры, нос вдоль +x, колёса на y = 0, пятно по центру), иерархия узлов удаляется;
- материалы сводятся к одному вершинно-цветному: краска — строго белая (255), стекло тёмное, интерьер и невидимые «рёбра» SketchUp выброшены; полицейская версия получает синюю полосу по боковинам и мигалку на крыше;
- вершины свариваются по позиции и цвету с усреднением нормалей, сетка упрощается `MeshoptSimplifier` до ~4000 треугольников и упаковывается `EXT_meshopt_compression` (декодер подключается в [src/world/cars.js](../src/world/cars.js)).

Итог: седан 36 КБ / 4.0 тыс. треугольников (длина 4.78 м), хэтчбек 44 КБ / 4.0 тыс. (4.32 м), SUV 36 КБ / 4.0 тыс. (4.94 м), полицейский 38 КБ / 4.0 тыс. Белая краска тонируется цветом инстанса: материал `carMat` в [src/world/cars.js](../src/world/cars.js) пропускает `instanceColor` только на почти белые вершины (маска краски в шейдере), поэтому стёкла, шины, хром и полицейская полоса сохраняют свой цвет. Парковки города инстансят эти геометрии сами ([src/landmarks/parking.js](../src/landmarks/parking.js), машины появляются и исчезают по времени суток); полиция крепости, больница, площадь Единства и Дворец культуры регистрируют статичные машины через `addStaticCar`. Для скачивания с Sketchfab нужен аккаунт и его API-токен.

## Предметы (`item_*.glb`)

Все три — **CC-BY-4.0** со Sketchfab, атрибуция обязательна:

| Файл | Что | Откуда |
|---|---|---|
| `item_ammo.glb` | ящик патронов: советский деревянный ящик с трафаретной маркировкой, замками и ручками (крышка закрыта) | [Soviet Weapons Ammo Crate Box Animated Low Poly](https://sketchfab.com/3d-models/soviet-weapons-ammo-crate-box-animated-low-poly-e8566467ba3f4dffb686a669add07b3f), автор [lil_bentley](https://sketchfab.com/lil_bentley) |
| `item_nade.glb` | граната M67 в сборе: чека, кольцо и рычаг на месте, жёлтая маркировка корпуса | [M67](https://sketchfab.com/3d-models/m67-52dc34ff97984927b0322326e3171467), автор [Firewarden](https://sketchfab.com/Firewarden) |
| `item_med.glb` | аптечка: белый кейс с красным крестом и чёрной ручкой | [Medical Kit](https://sketchfab.com/3d-models/medical-kit-1c5c0905f9f34b939309cff3ecd00870), автор [tediuminteractive](https://sketchfab.com/tediuminteractive) |

This work is based on "Soviet Weapons Ammo Crate Box Animated Low Poly" by lil_bentley, "M67" by Firewarden and "Medical Kit" by tediuminteractive (Sketchfab), licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

Собираются [tools/items.mjs](../tools/items.mjs): у гранаты в сцене две копии (одна с вынутой чекой) — берётся собранная; у ящика удалена анимация открытия крышки; вершины запекаются в мировые координаты и сливаются по материалу, модель центрируется (дно в y=0) и нормируется в метры (ящик 0.55 м по длине, граната 0.2 м в высоту, аптечка 0.26 м); текстуры жмутся в WebP (1024 px), геометрия — `EXT_meshopt_compression`. Итог: ящик 0.40 МБ / 6.0 тыс. треугольников, граната 0.29 МБ / 5.0 тыс., аптечка 0.08 МБ / 1.6 тыс.

Загружаются один раз в [src/game/props.js](../src/game/props.js) и клонируются на каждый предмет на карте ([src/game/inventory.js](../src/game/inventory.js)) и на летящую гранату ([src/game/nades.js](../src/game/nades.js)); пока модель едет, рисуется прежний фолбэк из боксов. Проверка без экрана — [tools/shot-items.mjs](../tools/shot-items.mjs).

## Прицелы (`item_sight.glb`, `item_optic.glb`)

Оба — **CC-BY-4.0** со Sketchfab, атрибуция обязательна:

| Файл | Что | Откуда |
|---|---|---|
| `item_sight.glb` | коллиматорный прицел: открытый рефлектор с козырьком, прозрачная линза, маркировка AimDot | [FPS Red Dot Sight (Game Model)](https://sketchfab.com/3d-models/fps-red-dot-sight-game-model-0cf999d9363940c2b149dcd80c448554), автор [Michael Makivic](https://sketchfab.com/makivic) |
| `item_optic.glb` | оптический прицел 8x: барабанчики поправок, кольца крепления с рычагами, откидные крышки линз | [Scope 8x](https://sketchfab.com/3d-models/scope-8x-cf8371cc54384ad19adf1cdec2f3cecb), автор [ErhanMatur](https://sketchfab.com/erhanmatur) |

This work is based on "FPS Red Dot Sight (Game Model)" by Michael Makivic and "Scope 8x" by ErhanMatur (Sketchfab), licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

Собираются [tools/sights.mjs](../tools/sights.mjs) тем же конвейером, что и предметы: вершины запекаются в мировые координаты с поворотом на игровую конвенцию (смотрит вдоль +z, верх +y, низ крепления в y=0, центр по x/z), сливаются по материалу (alphaMode линзы сохраняется), нормируются в метры (коллиматор 0.16 м в длину, оптика 0.36 м); текстуры WebP 1024 px, геометрия `EXT_meshopt_compression`. Итог: коллиматор 0.22 МБ / 2.2 тыс. треугольников, оптика 0.35 МБ / 21.4 тыс. Один и тот же файл служит и предметом на карте, и установленным на оружие прицелом (реальный размер).
