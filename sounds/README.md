# Звуки шутера

Все записи — **CC0 1.0** (общественное достояние): их можно использовать без отчислений и без указания автора. Ниже всё равно перечислены источники. Нарезает их [tools/sounds.py](../tools/sounds.py): клип начинается с удара, длина фиксированная, в конце затухание, пик на −1 дБ. Затем клип кодируется в MP3. Выстрелы рядом стереофонические, остальные звуки моно: страница сама разносит их по сторонам.

## Выстрелы — The Free Firearm Sound Library

Настоящие записи оружия на стрельбище: 96 кГц / 24 бит, проект студентов, собранный на Kickstarter (2013). Архив `Prepared SFX Library.7z` с [opengameart.org](https://opengameart.org/content/the-free-firearm-sound-library), сайт проекта — freefirearmsfx.com. «Рядом» — запись у стрелка (near distance), «далеко» — дальше от него (mid distance).

| Оружие в игре | Записанное оружие | Рядом (`-1`, `-2`: два выстрела) | Далеко (`-far`) |
|---|---|---|---|
| Автомат (`ak`) | АК-47, 7,62×39 | `C_28P.wav` | `C_31P.wav` |
| Дробовик (`sg`) | Benelli Nova, 12 калибр, помповый | `O_21P.wav` | `O_17P.wav` |
| Снайперская (`sn`) | Tikka T3, .30-06, продольно-скользящий затвор | `W_29P.wav` | `W_24P.wav` |
| Пистолет (`pi`) | Walther PPQ, 9 мм | `X_39P.wav` | `X_31P.wav` |
| Пулемёт (`mg`) | AR-15, 5,56×45 | `D_32P.wav` | `D_24P.wav` |

## Попадания и пролёт пули — Freesound (CC0)

| Файл | Что | Источник |
|---|---|---|
| `hit-body-1…4` | пуля в тело (удар без свиста перед ним) | [VisceralBulletImpacts.wav](https://freesound.org/people/u1769092/sounds/423301/), u1769092 |
| `hit-head` | пуля в голову | [Headshot sound](https://freesound.org/people/MadPanCake/sounds/660769/), MadPanCake |
| `hit-wall-1…3` | пуля в стену или бетон рядом (запись рядом с местом попаданий) | [Whipper Snappers/Bullet Hits.wav](https://freesound.org/people/deleted_user_1371021/sounds/161001/) |
| `crack-1`, `crack-2` | щелчок пули, пролетевшей рядом с головой | там же |
| `ricochet` | рикошет | [Ricochet 2.wav](https://freesound.org/people/morganpurkis/sounds/392975/), morganpurkis |
| `hit-ground` | пуля в землю | [Bullet impact ground (subsonic) SFX](https://freesound.org/people/modusmogulus/sounds/789388/), modusmogulus |

С Freesound взяты превью (`cdn.freesound.org/previews/…-hq.mp3`, 128 кбит/с), а не исходные файлы.

## Шаги, материалы попадания, взрыв (Kenney)

**CC0 1.0**, [Kenney](https://kenney.nl) — наборы [Impact Sounds](https://kenney.nl/assets/impact-sounds) и [RPG Audio](https://kenney.nl/assets/rpg-audio), формат OGG (Chrome и Firefox декодируют сами; Safari — синтез).

| Файлы | Что |
|---|---|
| `footstep_concrete_000…004.ogg` | шаги по асфальту/бетону (свои и чужие, [src/game/mp.js](../src/game/mp.js)) |
| `footstep_grass_000…004.ogg` | шаги по траве и земле (вне дорог) |
| `impactGeneric_light_000…004.ogg` | попадание по штукатурке/бетону |
| `impactMining_000…004.ogg` | попадание по камню и кирпичу |
| `impactMetal_000…004.ogg` | попадание по металлу |
| `impactWood_medium_000…004.ogg` | попадание по дереву |
| `impactSoft_medium_000…004.ogg` | мягкий грунт, трава |
| `explosionCrunch_000…003.ogg` | взрыв гранаты |
| `lowFrequency_explosion_000…001.ogg` | низкий гул под взрывом |

Материал стены выбирается по стилю фасада (`b.kind`, карта `WALL_MAT` в `mp.js`). Ночной эмбиенс без сверчков: птицы, ветер, вода и транспорт остались, сверчки убраны по просьбе владельца.

Если файлы не загрузились (например, страница открыта как `file://`), выстрелы, попадания, шаги и взрыв синтезируются — игра не немая.
