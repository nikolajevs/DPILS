# Развёртывание игрового сервера на VPS (Debian/Ubuntu)

**С 19.11.2026 VPS — единственный продакшен проекта: страница и сервер живут на https://dvinsk.lat, GitHub Pages больше не используется.** Рабочий вариант — раздел «dvinsk.lat: страница и сервер в одном процессе» ниже; systemd/Caddy — общий случай для своего домена.

Страница открыта по https, поэтому браузер пустит её только на `wss://`. Нужны доменное имя, которое указывает на VPS, и обратный прокси с сертификатом (ниже Caddy). Порты 80 и 443 на VPS должны быть открыты; порт 8787 снаружи не нужен.

```bash
sudo apt-get install -y nodejs npm git caddy
```
```bash
sudo useradd --system --home /opt/dpils --shell /usr/sbin/nologin dpils
sudo git clone https://github.com/nikolajevs/DPILS.git /opt/dpils
cd /opt/dpils && sudo npm ci --omit=dev
sudo chown -R dpils: /opt/dpils
```
```bash
sudo cp /opt/dpils/server/deploy/dpils-game.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dpils-game
```
```bash
curl http://127.0.0.1:8787/health
```

Нужен Node 20 или новее (`node -v`); в Debian 12 `nodejs` старее — поставьте с nodesource.com. Затем впишите свой домен в [Caddyfile](Caddyfile), положите его в `/etc/caddy/Caddyfile` и выполните `sudo systemctl reload caddy`. Адрес сервера для игры — `wss://ваш-домен`: страница, открытая с него, сама подключается к нему.

Имя сервера в списке на странице и число убийств до победы задаются переменными в unit-файле: `Environment=SERVER_NAME=Даугавпилс` и `Environment=WIN_SCORE=30`; режим «каждый сам за себя» включает `Environment=MODE=ffa`; арену — `Environment=ARENA=center` (или `fortress`, `station`, `park`, `church`, `pond`, `speedway`, `culture`, `griva`), ботов, которые занимают свободные места, — `Environment=BOTS=6` и `Environment=BOT_LEVEL=normal` (на одном VPS можно держать два сервера на разных портах, по одному unit-файлу на режим). Сутки игры идут по умолчанию — 2 часа с рассветом и закатом, по настоящим часам, так что перезапуск их не сбивает; длину задаёт `Environment=DAY_MIN=120`, `DAY_MIN=0` выключает часы. Таблица лидеров хранится в файле `server/data/leaderboard.json` (другое место — `Environment=LEADERBOARD=/var/lib/dpils/leaderboard.json`, без таблицы — `LEADERBOARD=off`); пользователь сервиса должен иметь право писать туда. Через Caddy она доступна по тому же домену: `https://ваш-домен/leaderboard`. Аккаунты (страницы входа и регистрации) хранятся рядом — `server/data/accounts.json` (другое место — `Environment=ACCOUNTS=/var/lib/dpils/accounts.json`, без аккаунтов — `ACCOUNTS=off`), пароль только как scrypt-хеш; эндпоинты `/auth/register`, `/auth/login`, `/auth/me` доступны через Caddy по тому же домену, CORS открыт для страницы на другом адресе (legacy GitHub Pages). Страница всегда подключается к тому серверу, с которого она открыта (`STATIC=dist`, [src/game/server.js](../../src/game/server.js)); списка серверов и `servers.json` больше нет.

Команды игроков ([server/teams.mjs](../teams.mjs), живая часть — [server/social.mjs](../social.mjs)) хранятся рядом с аккаунтами в `server/data/teams.json` (другое место — `Environment=TEAMS=/var/lib/dpils/teams.json`, без команд — `TEAMS=off`); страница держит WebSocket на пути `/social` того же процесса, Caddy проксирует его вместе с остальным.

Бой идёт катками по 2 часа — одни сутки игры (длину задаёт тот же `DAY_MIN`): вход открыт первые 30 минут (и 5 минут после перезапуска сервера), последние 20 минут — «Шторм» до последнего выжившего ([server/storm.mjs](../storm.mjs)). Состояние катки отдаёт `/health` (поле `match`), его читает лобби. `Environment=MATCH=off` возвращает бесконечные раунды до `WIN_SCORE` без шторма. Отдельного ивента на `/storm` и `/storm-health`, а с ними `STORM` и `STORM_BOTS` больше нет.

Админ-панель (`/admin`, [server/admin.mjs](../admin.mjs)) включается переменной `Environment=ADMIN_PASS=пароль` в unit-файле (без неё панель выключена и `/admin` отвечает 404). Пароль открывает сессию на 12 часов, подбор ограничен 10 попытками за 10 минут; смена пароля — новый `ADMIN_PASS` и перезапуск сервиса. Панель управляет игроками (кик, чат, боты, груз), аккаунтами (список, новый пароль, удаление), таблицей лидеров (сброс, удаление) и командами (участники, роспуск).

Обновление: `cd /opt/dpils && sudo -u dpils git pull && sudo systemctl restart dpils-game`. Логи: `journalctl -u dpils-game -f`.

## dvinsk.lat: страница и сервер в одном процессе (pm2, без sudo)

На VPS `kicad-vps` (пользователь `administrator`, Node из nvm) игра стоит в `~/dpils` и работает под pm2 как `dpils` на порту 3000; снаружи её отдаёт Traefik соседнего хоста по https://dvinsk.lat. Переменная `STATIC=dist` включает раздачу собранной страницы тем же сервером, что принимает игроков, поэтому отдельный прокси для `wss://` не нужен.

```bash
git clone https://github.com/nikolajevs/DPILS.git ~/dpils && cd ~/dpils && npm ci && npm run build
```
```bash
PORT=3000 STATIC=dist SERVER_NAME=Даугавпилс BOTS=4 pm2 start server/index.mjs --name dpils && pm2 save
```

Обновление:

```bash
cd ~/dpils && git pull && npm ci && npm run build && pm2 restart dpils
```

Агент обновляет VPS после каждого мержа одной командой со своей машины (`npm ci` — только если менялись зависимости):

```bash
ssh kicad-vps "bash -lc 'source ~/.nvm/nvm.sh; cd ~/dpils && git pull && npm run build && pm2 restart dpils'"
```

Аккаунты включены по умолчанию и хранятся в `server/data/accounts.json` рядом с таблицей лидеров. После обновления сервера страницы входа и регистрации (`#login`, `#register`) работают против `wss://dvinsk.lat` (страницу отдаёт тот же процесс); до обновления сервера страница предлагает играть без аккаунта.

Админ-панель живёт на том же адресе: **https://dvinsk.lat/admin**. Включается переменной `ADMIN_PASS` в окружении pm2-процесса (без неё `/admin` — 404). Задать или сменить пароль на VPS:

```bash
ssh kicad-vps "bash -lc 'source ~/.nvm/nvm.sh; ADMIN_PASS=новый-пароль pm2 restart dpils --update-env && pm2 save'"
```

Пароль хранится только в окружении процесса (и в `~/.pm2/dump.pm2` после `pm2 save`); для удобства владельца он также лежит в `~/dpils-admin-pass.txt` (chmod 600). Сессия панели живёт 12 часов в памяти процесса, перезапуск сервера просит войти снова; подбор пароля ограничен 10 попытками за 10 минут с адреса. Возможности панели — в разделе «Админ-панель сервера» корневого [README.md](../../README.md).
