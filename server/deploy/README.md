# Развёртывание игрового сервера на VPS (Debian/Ubuntu)

Страница на GitHub Pages открыта по https, поэтому браузер пустит её только на `wss://`. Нужны доменное имя, которое указывает на VPS, и обратный прокси с сертификатом (ниже Caddy). Порты 80 и 443 на VPS должны быть открыты; порт 8787 снаружи не нужен.

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

Имя сервера в списке на странице и число убийств до победы задаются переменными в unit-файле: `Environment=SERVER_NAME=Даугавпилс` и `Environment=WIN_SCORE=30`; режим «каждый сам за себя» включает `Environment=MODE=ffa`; арену — `Environment=ARENA=center` (или `fortress`, `station`), ботов, которые занимают свободные места, — `Environment=BOTS=6` и `Environment=BOT_LEVEL=normal` (на одном VPS можно держать два сервера на разных портах, по одному unit-файлу на режим). Чтобы сервер появился в списке, добавьте его в `servers.json` в корне репозитория (`{"servers": [{"name": "Даугавпилс", "url": "wss://ваш-домен"}]}`).

Обновление: `cd /opt/dpils && sudo -u dpils git pull && sudo systemctl restart dpils-game`. Логи: `journalctl -u dpils-game -f`.
