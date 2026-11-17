# Развёртывание игрового сервера на VPS (Debian/Ubuntu)

Страница на GitHub Pages открыта по https, поэтому браузер пустит её только на `wss://`. Нужны доменное имя, которое указывает на VPS, и обратный прокси с сертификатом (ниже Caddy). Порты 80 и 443 на VPS должны быть открыты; порт 8787 снаружи не нужен.

Если публичный сервер с доменом и https не нужен, есть путь проще: **конструктор сервера** — готовый архив на [releases/server-kit](https://github.com/nikolajevs/DPILS/releases/tag/server-kit). Распаковать и запустить `start.cmd` (Windows) или `./start.sh` (Linux): Node.js, сервер и страница уже внутри, запускаль спросит название сервера и настройки. Друзья в той же сети открывают `http://IP-компьютера:8787` — сервер уже в списке на странице. Подробности — в разделе «Свой сервер за минуту» корневого [README](../../README.md).

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

Нужен Node 20 или новее (`node -v`); в Debian 12 `nodejs` старее — поставьте с nodesource.com. Затем впишите свой домен в [Caddyfile](Caddyfile), положите его в `/etc/caddy/Caddyfile` и выполните `sudo systemctl reload caddy`. Адрес сервера для игры — `wss://ваш-домен`; его можно ввести в поле «Сервер» на карточке или зашить в `DEFAULT_SERVER` в `src/game/mp.js`.

Имя сервера в списке на странице и число убийств до победы задаются переменными в unit-файле: `Environment=SERVER_NAME=Даугавпилс` и `Environment=WIN_SCORE=30`; режим «каждый сам за себя» включает `Environment=MODE=ffa`; арену — `Environment=ARENA=center` (или `fortress`, `station`, `park`, `church`, `pond`, `speedway`, `culture`, `griva`), ботов, которые занимают свободные места, — `Environment=BOTS=6` и `Environment=BOT_LEVEL=normal` (на одном VPS можно держать два сервера на разных портах, по одному unit-файлу на режим). Таблица лидеров хранится в файле `server/data/leaderboard.json` (другое место — `Environment=LEADERBOARD=/var/lib/dpils/leaderboard.json`, без таблицы — `LEADERBOARD=off`); пользователь сервиса должен иметь право писать туда. Через Caddy она доступна по тому же домену: `https://ваш-домен/leaderboard`. Аккаунты (страницы входа и регистрации) хранятся рядом — `server/data/accounts.json` (другое место — `Environment=ACCOUNTS=/var/lib/dpils/accounts.json`, без аккаунтов — `ACCOUNTS=off`), пароль только как scrypt-хеш; эндпоинты `/auth/register`, `/auth/login`, `/auth/me` доступны через Caddy по тому же домену, CORS открыт для страницы на GitHub Pages. Чтобы сервер появился в списке, добавьте его в `servers.json` в корне репозитория (`{"servers": [{"name": "Даугавпилс", "url": "wss://ваш-домен"}]}`).

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

Аккаунты включены по умолчанию и хранятся в `server/data/accounts.json` рядом с таблицей лидеров. После обновления сервера страницы входа и регистрации (`#login`, `#register`) работают против `wss://dvinsk.lat` и с GitHub Pages; до обновления сервера страница предлагает играть без аккаунта.
