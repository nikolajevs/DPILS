# Модели

Все модели — **CC0 1.0** (общественное достояние), автор — Tomás Laulhé ([Quaternius](https://quaternius.com)); перед использованием в проекте автор просит рассмотреть поддержку на Patreon.

| Файл | Что | Откуда |
|---|---|---|
| `Soldier.glb` | солдат (шлем, бронежилет) с анимациями Idle, Walk, Run, Jump, Death, Walk_Carry и др. | [Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html), файл `Soldier_Male` |
| `Rifle.glb` | автомат в руках | [Zombie Apocalypse Kit](https://quaternius.com/packs/zombieapocalypsekit.html), `Weapons/glTF/Rifle` |
| `Shotgun.glb` | дробовик в руках | оттуда же, `Weapons/glTF/Shotgun` |
| `Sniper.glb` | снайперская винтовка с оптическим прицелом | [Toon Shooter Game Kit](https://quaternius.com/packs/toonshootergamekit.html), `Guns/glTF/Sniper` |

Файлы переданы без изменений в модели, кроме упаковки из `.gltf` в бинарный `.glb` (буфер и текстура внутри). Используются в [src/game/avatar.js](../src/game/avatar.js): материалы `Main` и `Helmet` солдата перекрашиваются в цвет команды или игрока. Чтобы взять другого персонажа, достаточно заменить файл и поправить блок `MODEL` (имена клипов, костей и материалов) в `avatar.js`.
