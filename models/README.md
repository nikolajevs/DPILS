# Модели

Все модели — **CC0 1.0** (общественное достояние), автор — Tomás Laulhé ([Quaternius](https://quaternius.com)); перед использованием в проекте автор просит рассмотреть поддержку на Patreon.

| Файл | Что | Откуда |
|---|---|---|
| `Soldier.glb` | солдат (шлем, бронежилет) с анимациями Idle, Walk, Run, Jump, Death, Walk_Carry и др. | [Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html), файл `Soldier_Male` |
| `AK.glb` | автомат в руках | [Toon Shooter Game Kit](https://quaternius.com/packs/toonshootergamekit.html), `Guns/glTF/AK` |
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

## Трава и цветы (`ez-tree/`)

**MIT**, автор — Daniel Greenheck ([ez-tree](https://github.com/dgreenheck/ez-tree)); текст лицензии — `ez-tree/LICENSE.txt`.

| Файл | Что |
|---|---|
| `grass.glb` | куст высокой травы (~2 м в файле, на газоне масштабируется до 0.3–0.6 м), alpha-test |
| `flower_blue.glb`, `flower_white.glb`, `flower_yellow.glb` | цветы в сантиметрах (масштаб ×0.01) |

Инстансятся по газонам парков в [src/landmarks/flora.js](../src/landmarks/flora.js), минуя дорожки, клумбы и площадки. Текстуры земли `textures/ground_grass.webp` и `textures/ground_dirt.webp` — оттуда же (MIT).
