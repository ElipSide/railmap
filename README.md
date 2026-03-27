# RailMap

Веб-приложение для подбора и визуализации логистических маршрутов на базе PostGIS, Node.js API, Tegola и React/Vite.

---

## Технологии проекта

- **Карты:** OpenStreetMap, MapLibre, Tegola
- **Геоданные:** PostgreSQL, PostGIS
- **Фронтенд:** React, Vite, JavaScript (JSX)
- **Бэкенд:** Node.js, JavaScript
- **Контейнеризация:** Docker, Docker Compose

---

## Что нового в текущей версии

### Декларации: автоматический выбор режима маршрута

Для маршрута от выбранной декларации действует правило по прямому расстоянию между точкой декларации и точкой назначения:

- **до 500 км включительно** — используется **автодоставка**;
- **свыше 500 км** — используется **мультимодальный маршрут**:
  1. от точки декларации по авто до ближайшей подходящей ж/д станции;
  2. по железной дороге до станции, ближайшей к точке назначения;
  3. от станции прибытия по авто до точки клика на карте.

Это значит:

- frontend **больше не принудительно отправляет `multimodal`** для каждой декларации;
- backend сам выбирает `road` или `multimodal` по порогу `DECLARATION_MULTIMODAL_MIN_KM`;
- при необходимости режим всё ещё можно переопределить явно через `route_preference`;
- для дальних маршрутов деклараций backend собирает цепочку `road_start → rail → road_end`.

### Диагностика маршрутов деклараций

Если маршрут не найден, backend может вернуть расширенную диагностику, чтобы сразу понять, на каком плече возникла проблема:

- найдена ли станция отправления;
- найдена ли станция прибытия;
- найден ли road snap для точки отправления и назначения;
- найдена ли привязка станции к дорожному графу;
- найден ли ж/д маршрут между станциями;
- собрано ли стартовое авто-плечо `road_start`;
- собрано ли конечное авто-плечо `road_end`.

Это полезно в случаях, когда ж/д путь между станциями существует, но полный маршрут от точки до точки не собирается.

### Единый API base для деклараций

Маршруты деклараций теперь должны ходить через тот же `routeApiBase`, что и остальные запросы frontend. Это особенно важно для режима работы через nginx и подпуть **`/railmap`**.

### Серверный режим `/railmap/home/`

Для запуска приложения за nginx под подпутём `/railmap` нужно, чтобы:

- в `vite.config.js` был `base: "/railmap/home/"` при `VITE_USE_RAILMAP_SUBPATH=1`;
- переменная `VITE_USE_RAILMAP_SUBPATH` была **явно передана в контейнер `web`** через `docker-compose.yml`;
- nginx проксировал frontend на `/railmap/home/`, а API, route, health и tiles — под тем же префиксом `/railmap/...`.

### Стартовая видимость слоёв карты

Ж/д пути, станции, порты и элеваторы по умолчанию должны быть скрыты, если соответствующие переключатели в UI выключены. Для этого слоям карты лучше сразу задавать `layout.visibility: "none"`, а не скрывать их только после `map.on("load")`.

---

## NotebookLM

Функция **«Рыночные рекомендации»** из коробки может не работать, так как она опирается на NotebookLM и подготовленный набор источников. Для работы этой части нужно собрать и подключить собственный блокнот, например с аграрными новостями за нужный период.

---

## Что внутри

Проект поднимает 4 сервиса:

- **PostGIS** — база данных с геоданными и транспортными графами;
- **route_api** — backend-сервис расчёта маршрутов, поставок, деклараций и рекомендаций;
- **Tegola** — сервер векторных тайлов для слоёв карты;
- **web** — frontend на React + Vite.

---

## Архитектура

### Локальная разработка

```text
Браузер
  ↓
Vite dev server (5175)
  ↓ proxy
route_api (3000)
  ↓
PostGIS
  ↓
Tegola (8080 внутри Docker / 8085 на хосте)
```

### Сервер через nginx и подпуть `/railmap`

```text
Браузер
  ↓
nginx (443)
  ├─ /railmap/home/  → web:5175
  ├─ /railmap/api/   → route_api:3000/api/
  ├─ /railmap/route  → route_api:3000/route
  ├─ /railmap/health → route_api:3000/health
  └─ /railmap/maps/  → tegola:8080/maps/
```

---

## Структура проекта

```text
.
├── data/                  # исходные данные и вспомогательные файлы
├── server/                # backend / API маршрутизации
├── tegola/                # конфиг Tegola
├── web/                   # frontend (React + Vite)
├── docker-compose.yml     # запуск сервисов
├── Dockerfile             # сборка PostGIS-образа / БД
├── .env                   # локальные переменные окружения
├── README.md
└── osm_working_full.dump  # дамп рабочей БД (опционально)
```

---

## Требования

Перед запуском должны быть установлены:

- Docker
- Docker Compose
- Git

Для запуска frontend вне Docker дополнительно понадобятся:

- Node.js 18+
- npm

---

## Быстрый старт

### 1. Клонировать репозиторий

```bash
git clone https://github.com/ElipSide/railmap.git
cd railmap
```

### 2. Подготовить `.env`

Создай файл `.env` в корне проекта или проверь уже существующий.

Пример `.env` для локальной разработки:

```env
POSTGIS_CONTAINER_NAME=postgis
ROUTE_API_CONTAINER_NAME=route_api
TEGOLA_CONTAINER_NAME=tegola
WEB_CONTAINER_NAME=web

PGHOST=postgis
PGPORT=5432
PGDATABASE=osm
PGUSER=osm
PGPASSWORD=osm

DECL_DB_HOST=
DECL_DB_PORT=
DECL_DB_NAME=
DECL_DB_USER=
DECL_DB_PASSWORD=
DECL_DB_SSL=false
DECLARATION_MULTIMODAL_MIN_KM=500

POSTGIS_HOST_PORT=5432
ROUTE_API_HOST_PORT=3000
TEGOLA_HOST_PORT=8085
PORT=3000

NOTEBOOKLM_MODE=python
NOTEBOOKLM_NOTEBOOK_ID=
NOTEBOOKLM_SCRIPT_PATH=/app/ask_notebooklm.py
NOTEBOOKLM_STORAGE_PATH=/app/.notebooklm/storage_state.json
PYTHON_BIN=/opt/venv/bin/python
NOTEBOOKLM_PYTHON_TIMEOUT_SEC=120

VITE_USE_RAILMAP_SUBPATH=0

# Карта / стиль
MAP_STYLE_URL=https://demotiles.maplibre.org/style.json
MAP_CENTER_LNG=37.6176
MAP_CENTER_LAT=55.7558
MAP_ZOOM=4
```

### Важно по Postgres

Для `route_api` внутри Docker нужно использовать:

```env
PGHOST=postgis
PGPORT=5432
```

Не используй `localhost:5432` или внешний порт хоста внутри backend-контейнера.
Контейнеры должны обращаться к базе по имени сервиса `postgis` и внутреннему порту `5432`.

### Важно по `VITE_USE_RAILMAP_SUBPATH`

- `0` — локальная разработка;
- `1` — запуск за nginx под подпутём `/railmap`.

Для режима `1` недостаточно только записи в `.env`.
Переменную нужно **явно передать в контейнер `web`** через `docker-compose.yml`, например:

```yaml
environment:
  CHOKIDAR_USEPOLLING: "true"
  VITE_USE_RAILMAP_SUBPATH: ${VITE_USE_RAILMAP_SUBPATH}
```

Иначе внутри контейнера значение останется `undefined` или `0`, и Vite будет считать, что приложение работает из корня `/`, а не из `/railmap/home/`.

---

## Запуск контейнеров

```bash
docker compose up -d --build
```

Проверить статус:

```bash
docker compose ps
```

Посмотреть логи:

```bash
docker compose logs -f postgis
docker compose logs -f route_api
docker compose logs -f tegola
docker compose logs -f web
```

---

## Как открыть проект

### Локальная разработка

После запуска сервисов обычно доступны:

- **Frontend:** `http://localhost:5175`
- **Route API:** `http://localhost:3000`
- **Tegola:** `http://localhost:8085`
- **PostGIS:** `localhost:5432`

### Сервер через nginx

В режиме `VITE_USE_RAILMAP_SUBPATH=1` frontend открывается по адресу:

- **Frontend:** `https://csort-news.ru/railmap/home/`

Остальные маршруты доступны под тем же префиксом:

- **API:** `https://csort-news.ru/railmap/api/...`
- **Route:** `https://csort-news.ru/railmap/route?...`
- **Health:** `https://csort-news.ru/railmap/health`
- **Tiles:** `https://csort-news.ru/railmap/maps/...`

---

## Текущий Docker Compose

Проект поднимает 4 сервиса:

- `postgis`
- `route_api`
- `tegola`
- `web`

Особенности текущей конфигурации:

- `postgis` публикуется наружу на `${POSTGIS_HOST_PORT:-5432}:5432`;
- `route_api` публикуется наружу на `${ROUTE_API_HOST_PORT:-3000}:3000`;
- `tegola` публикуется наружу на `${TEGOLA_HOST_PORT:-8085}:8080`;
- `web` публикуется наружу на `5175:5175`;
- frontend в Docker запускается в dev-режиме через:
  ```bash
  npm run dev -- --host 0.0.0.0 --port 5175
  ```
- для frontend используется отдельный volume `web_node_modules`;
- для backend используется volume `route_api_node_modules`;
- если проект работает через `/railmap/home/`, в сервис `web` должна быть передана переменная `VITE_USE_RAILMAP_SUBPATH`.

Пример блока `web`:

```yaml
web:
  build:
    context: ./web
    dockerfile: Dockerfile
  working_dir: /app
  depends_on:
    - route_api
  volumes:
    - ./web:/app
    - web_node_modules:/app/node_modules
  command: ["bash", "-lc", "npm install && npm run dev -- --host 0.0.0.0 --port 5175"]
  environment:
    CHOKIDAR_USEPOLLING: "true"
    VITE_USE_RAILMAP_SUBPATH: ${VITE_USE_RAILMAP_SUBPATH}
  ports:
    - "5175:5175"
```

---

## Локальный frontend вне Docker

Если frontend запускается не в Docker:

```bash
cd web
npm install
npm run dev -- --host 0.0.0.0 --port 5175
```

После этого открой:

```text
http://localhost:5175
```

---

## Режимы frontend

### 1. Локальный dev

Используется, когда:

```env
VITE_USE_RAILMAP_SUBPATH=0
```

Что происходит:

- Vite работает в корне `/`;
- API идёт через proxy:
  - `/api`
  - `/route`
  - `/health`
- тайлы грузятся с `http://<host>:8085/maps/...`;
- nginx не нужен.

Это рекомендуемый режим для локальной разработки.

### 2. Серверный dev через nginx и `/railmap`

Используется, когда:

```env
VITE_USE_RAILMAP_SUBPATH=1
```

Что происходит:

- frontend живёт под путём `/railmap/home/`;
- API идёт через `/railmap/api`;
- route идёт через `/railmap/route`;
- health идёт через `/railmap/health`;
- тайлы идут через `/railmap/maps/...`;
- Vite HMR работает через websocket за nginx.

Этот режим нужен для сервера, где приложение открывается не из корня домена, а из подпути.

---

## Режим «Декларации»

### Поиск деклараций

В режиме **«Декларации»** можно:

- выбрать продукт;
- указать объём;
- задать период публикации;
- быстро применить пресет периода;
- получить декларации на карте и в правой панели;
- выбрать конкретную декларацию;
- затем кликнуть по карте и построить маршрут от выбранной декларации.

### Логика маршрута от декларации

В актуальной версии маршрут строится по правилу расстояния:

```text
Если расстояние <= 500 км:
  Точка декларации
    ↓ авто
  Точка назначения

Если расстояние > 500 км:
  Точка декларации
    ↓ авто
  Ближайшая станция отправления
    ↓ ж/д
  Ближайшая станция прибытия к точке назначения
    ↓ авто
  Точка назначения
```

### Что важно понимать

- это **не** тот же самый режим, что ручной маршрут **«между двумя станциями»**;
- в декларациях станции подбираются автоматически по координатам;
- поэтому руками можно построить ж/д маршрут между станциями, но декларационный маршрут может не собраться, если не найдено одно из авто-плеч;
- если расстояние небольшое, система по умолчанию выберет `road`, а не мультимодал;
- если frontend или внешний клиент явно передаёт `route_preference`, он может переопределить автоматическое правило.

### Что приходит в ответе

При успешной сборке маршрут обычно включает:

- origin point;
- station отправления и station прибытия — если выбран мультимодальный сценарий;
- destination point;
- итоговый `route`;
- разбивку на `route_segments`;
- GeoJSON для визуализации на карте.

При неуспехе backend может вернуть `debug`-блок с причинами, почему маршрут не собрался.

---

## Настройка nginx

Ниже пример конфигурации для системного nginx на сервере.

### Что он делает

- перенаправляет `/railmap` и `/railmap/` на `/railmap/home/`;
- проксирует frontend на Vite dev server;
- проксирует backend-маршруты;
- проксирует векторные тайлы Tegola;
- пропускает websocket для HMR;
- даёт увеличенные timeout для долгих расчётов маршрутов деклараций.

### Пример конфига

```nginx
server {
    listen 443 ssl http2;
    server_name csort-news.ru;

    # ssl_certificate ...
    # ssl_certificate_key ...

    location = /railmap {
        return 301 /railmap/home/;
    }

    location = /railmap/ {
        return 301 /railmap/home/;
    }

    location /railmap/home/ {
        proxy_pass http://127.0.0.1:5175;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /railmap/api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        send_timeout 300s;
        proxy_buffering off;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /railmap/route {
        proxy_pass http://127.0.0.1:3000/route;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        send_timeout 300s;
        proxy_buffering off;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /railmap/health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /railmap/maps/ {
        proxy_pass http://127.0.0.1:8085/maps/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### После изменения nginx

Проверить конфиг:

```bash
sudo nginx -t
```

Применить:

```bash
sudo systemctl reload nginx
```

---

## Почему локально лучше без nginx

Для обычной разработки подпуть `/railmap` локально не нужен и только усложняет настройку:

- появляются редиректы;
- ломаются пути `@vite/client`;
- появляются ошибки `@react-refresh 404`;
- сложнее отлаживать websocket/HMR.

Поэтому локально лучше использовать:

- `VITE_USE_RAILMAP_SUBPATH=0`;
- `http://localhost:5175`.

---

## Загрузка дампа базы данных

Скачать файл `osm_working_full.dump` можно отдельно и восстановить его в контейнер PostGIS.

### 1. Убедиться, что PostGIS поднят

```bash
docker compose up -d postgis
```

### 2. Подключить расширения

```bash
docker exec -it postgis psql -U osm -d osm -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker exec -it postgis psql -U osm -d osm -c "CREATE EXTENSION IF NOT EXISTS pgrouting;"
```

### 3. Восстановить дамп

```bash
docker cp osm_working_full.dump postgis:/tmp/osm_working_full.dump
docker exec -it postgis pg_restore -U osm -d osm --clean --if-exists /tmp/osm_working_full.dump
```

Если версии PostgreSQL отличаются, можно использовать временный контейнер подходящей версии:

```bash
docker run --rm \
  --network <docker-network> \
  -e PGPASSWORD=osm \
  -v "$PWD:/work" \
  postgis/postgis:16-3.4 \
  pg_restore -v -h postgis -U osm -d osm --clean --if-exists /work/osm_working_full.dump
```

### 4. Проверить, что таблицы загрузились

```bash
docker exec -it postgis psql -U osm -d osm -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('road','rail','public') ORDER BY schemaname, tablename;"
```

Проверка размера базы:

```bash
docker exec -it postgis psql -U osm -d osm -c "SELECT pg_size_pretty(pg_database_size('osm'));"
```

---

## Полезные команды

Пересобрать и перезапустить всё:

```bash
docker compose down
docker compose up -d --build
```

Перезапустить только frontend:

```bash
docker compose restart web
```

Перезапустить только backend:

```bash
docker compose restart route_api
```

Остановить проект:

```bash
docker compose down
```

Остановить проект с удалением volume базы:

```bash
docker compose down -v
```

> Осторожно: `-v` удалит данные PostGIS.

Зайти в базу:

```bash
docker exec -it postgis psql -U osm -d osm
```

Посмотреть переменные backend:

```bash
docker compose exec route_api printenv | grep PG
```

Посмотреть использование места Docker:

```bash
docker system df
docker system df -v
```

Удалить неиспользуемые образы, контейнеры, сети и build cache:

```bash
docker system prune -a -f
docker builder prune -a -f
```

Удалить неиспользуемые volumes:

```bash
docker volume prune -f
```

На Windows `cmd` удалить все volumes можно так:

```bat
for /f %i in ('docker volume ls -q') do docker volume rm %i
```

---

## Типовые проблемы

### 1. `service "web" refers to undefined volume web_node_modules`

Нужно объявить volume внизу `docker-compose.yml`:

```yaml
volumes:
  postgis_data:
  route_api_node_modules:
  web_node_modules:
```

### 2. `Blocked request. This host is not allowed`

Vite блокирует внешний домен.
Для серверного режима нужно разрешить хост через `allowedHosts` в `vite.config.js`.

### 3. `GET /@vite/client 404` или `GET /@react-refresh 404`

Это почти всегда означает, что frontend запущен не в режиме `/railmap/home/`.

Проверь:

- `VITE_USE_RAILMAP_SUBPATH=1`;
- `base: "/railmap/home/"` в `vite.config.js`;
- корректный `location /railmap/home/` в nginx;
- websocket-заголовки для HMR;
- что переменная `VITE_USE_RAILMAP_SUBPATH` действительно попала в контейнер `web`.

Быстрая проверка:

```bash
docker compose exec web node -e "console.log(process.env.VITE_USE_RAILMAP_SUBPATH)"
```

Для серверного режима там должно быть `1`.

### 4. Бесконечный редирект на сервере

Обычно причина одна из этих:

- конфликт `base` в Vite и пути в nginx;
- лишний или отсутствующий `/` в `proxy_pass`;
- открывается `/railmap`, а не `/railmap/home/`.

Рекомендуемый адрес для frontend:

```text
https://csort-news.ru/railmap/home/
```

### 5. `Failed to parse URL from /railmap/maps/...`

Для MapLibre иногда недостаточно относительного пути для тайлов.
В серверном режиме лучше использовать абсолютный URL на основе `window.location.origin`.

### 6. `connect ECONNREFUSED ...:5433`

Backend подключается к Postgres по неправильному порту.
Внутри Docker нужно использовать:

```env
PGHOST=postgis
PGPORT=5432
```

А не внешний порт хоста.

### 7. Tegola пишет `relation does not exist`

Обычно это значит, что в БД не загружены таблицы, которые использует `tegola.toml`.

### 8. `pg_restore: unsupported version in file header`

Дамп создан более новой версией PostgreSQL, чем та, которая используется для восстановления.
Используй временный контейнер с более новой версией `postgis/postgis`.

### 9. Для декларации руками ж/д маршрут строится, а автоматически — нет

Обычно причина в одном из пунктов:

- у точки декларации не собирается авто-плечо до станции;
- у точки назначения не собирается авто-плечо от станции;
- автоматически подобралась не та ближайшая станция, которую ты проверял вручную;
- у станции нет корректной привязки к road graph;
- нет полного сценария `road_start → rail → road_end`;
- расстояние меньше порога, поэтому система выбрала `road`, а не мультимодал.

В таких случаях смотри `debug`-объект ответа `/api/declarations/route`.

### 10. `504 Gateway Time-out` на `/railmap/api/declarations/route`

Обычно это значит, что backend слишком долго считает маршрут, и nginx обрывает ожидание ответа.

Проверь:

- `proxy_connect_timeout`;
- `proxy_send_timeout`;
- `proxy_read_timeout`;
- `send_timeout`;
- `proxy_buffering off` для `/railmap/api/` и `/railmap/route`.

### 11. Docker пытается тянуть образы через `127.0.0.1:<порт>` и build падает

Обычно это остаток старой proxy-настройки Docker Desktop, системных переменных Windows или локального прокси-клиента.

Проверь:

```bat
echo %HTTP_PROXY%
echo %HTTPS_PROXY%
echo %ALL_PROXY%
netsh winhttp show proxy
type %USERPROFILE%\.docker\config.json
```

Если прокси больше не нужен, убери его из Docker Desktop и системных переменных, затем перезапусти Docker Desktop.

---

## Volumes

В проекте используются volumes:

```yaml
volumes:
  postgis_data:
  route_api_node_modules:
  web_node_modules:
```

Зачем они нужны:

- `postgis_data` — постоянное хранение данных базы;
- `route_api_node_modules` — чтобы не терять зависимости backend при bind mount;
- `web_node_modules` — чтобы не ломать зависимости frontend при bind mount.

---

## Dev vs Server

| Режим | Адрес frontend | nginx | `VITE_USE_RAILMAP_SUBPATH` |
|------|-----------------|------|-----------------------------|
| Локальный dev | `http://localhost:5175` | нет | `0` |
| Серверный режим | `https://csort-news.ru/railmap/home/` | да | `1` |

---

## Что не стоит делать

- Не запускай одновременно системный nginx и docker-nginx на одних и тех же портах `80/443`.
- Не используй подпуть `/railmap` локально без необходимости.
- Не указывай `PGHOST=localhost` для backend-контейнера.
- Не используй внешний порт Postgres изнутри Docker-сети.
- Не ожидай, что режим деклараций и ручной режим `станция → станция` всегда выберут одну и ту же пару станций.
- Не полагайся только на `.env` для `VITE_USE_RAILMAP_SUBPATH`: в `web` контейнер переменную нужно передать явно.

---

## Планы на улучшение

- вынести frontend из Vite dev в production build;
- перейти на `npm run build` + nginx static для production;
- сделать отдельные compose-файлы для dev и prod;
- добавить отдельный документ по обновлению БД и деклараций;
- добавить healthchecks для всех сервисов;
- при желании вывести `debug` по мультимодалу прямо в UI, а не только в ответе API.

---

## Краткий итог

### Для локальной разработки

- запускай:

```bash
docker compose up -d --build
```

- открывай:

```text
http://localhost:5175
```

- держи:

```env
VITE_USE_RAILMAP_SUBPATH=0
```

### Для сервера

- подними сервисы через Docker;
- проксируй всё через системный nginx;
- используй:

```env
VITE_USE_RAILMAP_SUBPATH=1
```

- не забудь передать `VITE_USE_RAILMAP_SUBPATH` в контейнер `web`;
- открывай:

```text
https://csort-news.ru/railmap/home/
```

### Для деклараций

- выбери декларацию;
- нажми кнопку построения маршрута от выбранной декларации;
- кликни точку назначения на карте;
- если расстояние до 500 км, система выберет автодоставку;
- если расстояние больше 500 км, маршрут будет собран по цепочке **авто → ж/д → авто**;
- при проблеме смотри `debug` из ответа `/api/declarations/route`.
