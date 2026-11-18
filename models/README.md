# Модели

## АК-47 (`fp_ak47.glb`)

**CC BY 4.0.** This work is based on "[FPS Character Animation Pack Ak-47](https://sketchfab.com/3d-models/fps-character-animation-pack-ak-47-b95778a564094fc3a49d1d6a3b6a30ab)" by Cristian David Duque Camacho ([DuqueCD7](https://sketchfab.com/DuqueCD7)) licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

Руки солдата в перчатках и камуфляжной куртке держат автомат с деревянным цевьём и прикладом. Есть скелет и анимации: покой, ходьба, бег, выстрел, перезарядка, взятие в руки. Скачанный glTF весил 117 МБ при текстурах 4096 px, [tools/fp-ak.mjs](../tools/fp-ak.mjs) собирает из него файл на 6 МБ:

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

## Солдат

Эта модель — **CC0 1.0** (общественное достояние), автор — Tomás Laulhé ([Quaternius](https://quaternius.com)); перед использованием в проекте автор просит рассмотреть поддержку на Patreon.

| Файл | Что | Откуда |
|---|---|---|
| `Soldier.glb` | солдат (шлем, бронежилет) с анимациями Idle, Walk, Run, Jump, Death, Walk_Carry и др. | [Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html), файл `Soldier_Male` |

Используется в [src/game/avatar.js](../src/game/avatar.js): материалы `Main` и `Helmet` солдата перекрашиваются в цвет команды или игрока. Чтобы взять другого персонажа, достаточно заменить файл и поправить блок `MODEL` (имена клипов, костей и материалов) в `avatar.js`.

Старые стволы Quaternius (`Pistol.glb`, `Rifle.glb`, `Shotgun.glb`, `Sniper.glb` — CC0, наборы Zombie Apocalypse Kit и Toon Shooter Game Kit) заменены моделями `fp_*` выше и больше не загружаются; файлы оставлены в репозитории как запасные.

## Люди (`humans/`)

Тоже **CC0 1.0**, Quaternius — [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) и причёски из его наборов; текст лицензии — `humans/LICENSE.txt`.

| Файл | Что |
|---|---|
| `male.glb`, `female.glb` | мужчина (1.81 м) и женщина (1.77 м) в метрах, общий скелет (24 кости) |
| `anims.glb` | 20 анимаций: Idle_Loop, Walk_Loop, Jog_Fwd_Loop, Pistol_Idle_Loop, Death01 и др. (Jump нет — в прыжке стоит idle) |
| `hair_*.glb` | шесть причёсок и борода, привязываются к тому же скелету по именам костей |
| `male_light.webp`, `female_light.webp` | облегчённые превью (не загружаются страницей) |

Выбор персонажа в панели игры («Персонаж», «Причёска», «Цвет волос», «Борода») хранится в `localStorage['dpils.mp']` и передаётся серверу строкой `look` (`m.1.2.1` = мужчина, причёска 1, цвет 2, борода). Команда обозначается кепкой и нарукавной повязкой, не перекраской кожи. Пешеходы города ([src/world/pedestrians.js](../src/world/pedestrians.js)) — те же модели без оружия и знаков команды.

## Цветы (`ez-tree/`)

**MIT**, автор — Daniel Greenheck ([ez-tree](https://github.com/dgreenheck/ez-tree)); текст лицензии — `ez-tree/LICENSE.txt`.

| Файл | Что |
|---|---|
| `flower_blue.glb`, `flower_white.glb`, `flower_yellow.glb` | цветы в сантиметрах (масштаб ×0.01) |

Инстансятся по газонам парков в [src/landmarks/flora.js](../src/landmarks/flora.js), минуя дорожки, клумбы и площадки. Текстуры земли `textures/ground_grass.webp` и `textures/ground_dirt.webp` — оттуда же (MIT).

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
