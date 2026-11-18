# Модели

## АК-47 (`fp_ak47.glb`)

**CC BY 4.0.** This work is based on "[FPS Character Animation Pack Ak-47](https://sketchfab.com/3d-models/fps-character-animation-pack-ak-47-b95778a564094fc3a49d1d6a3b6a30ab)" by Cristian David Duque Camacho ([DuqueCD7](https://sketchfab.com/DuqueCD7)) licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

Руки солдата в перчатках и камуфляжной куртке держат автомат с деревянным цевьём и прикладом. Есть скелет и анимации: покой, ходьба, бег, выстрел, перезарядка, взятие в руки. Скачанный glTF весил 117 МБ при текстурах 4096 px, [tools/fp-ak.mjs](../tools/fp-ak.mjs) собирает из него файл на 6 МБ:

- оставлены шесть клипов (`idle`, `walk`, `run`, `fire`, `reload`, `equip`), лишние ключи убраны;
- цвет и нормали автомата сжаты до 2048 px, остальные текстуры до 1024 px, всё в WebP;
- геометрия упакована `EXT_meshopt_compression`;
- добавлен узел `AK47_static`: автомат без рук в позе покоя, упрощённый втрое (9,5 тыс. треугольников).

Руки с анимированным автоматом — вид от первого лица ([src/game/viewmodel.js](../src/game/viewmodel.js)). `AK47_static` держат обеими руками другие игроки ([src/game/avatar.js](../src/game/avatar.js)). Для скачивания с Sketchfab нужен аккаунт и его API-токен.

## Солдат и остальное оружие

Эти модели — **CC0 1.0** (общественное достояние), автор — Tomás Laulhé ([Quaternius](https://quaternius.com)); перед использованием в проекте автор просит рассмотреть поддержку на Patreon.

| Файл | Что | Откуда |
|---|---|---|
| `Soldier.glb` | солдат (шлем, бронежилет) с анимациями Idle, Walk, Run, Jump, Death, Walk_Carry и др. | [Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html), файл `Soldier_Male` |
| `Pistol.glb` | пистолет | оттуда же, `Guns/glTF/Pistol` |
| `Rifle.glb` | пулемёт (тяжёлая винтовка) | [Zombie Apocalypse Kit](https://quaternius.com/packs/zombieapocalypsekit.html), `Weapons/glTF/Rifle` |
| `Shotgun.glb` | дробовик в руках | оттуда же, `Weapons/glTF/Shotgun` |
| `Sniper.glb` | снайперская винтовка с оптическим прицелом | [Toon Shooter Game Kit](https://quaternius.com/packs/toonshootergamekit.html), `Guns/glTF/Sniper` |

Файлы переданы без изменений в модели, кроме упаковки из `.gltf` в бинарный `.glb` (буфер и текстура внутри). Используются в [src/game/avatar.js](../src/game/avatar.js): материалы `Main` и `Helmet` солдата перекрашиваются в цвет команды или игрока. Чтобы взять другого персонажа, достаточно заменить файл и поправить блок `MODEL` (имена клипов, костей и материалов) в `avatar.js`.

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
