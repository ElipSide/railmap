# RailMap

Веб-приложение для подбора и визуализации логистических маршрутов с опорой на PostGIS, API расчёта маршрутов и Tegola для векторных тайлов.

## Что внутри

Проект поднимает три основных сервиса:

- **PostGIS** — база данных с транспортными графами и геоданными.
- **route_api** — backend-сервис расчёта маршрутов и поиска вариантов поставки.
- **Tegola** — сервер векторных тайлов для слоёв карты.

В текущем `docker-compose.yml` эти сервисы опубликованы на портах `5432`, `3000` и `8080` соответственно, а `route_api` подключается к PostGIS по хосту `postgis` и базе `osm`. fileciteturn1file1L1-L46

Tegola настроена на чтение данных из PostGIS и использует слои:

- `public.rail_lines`
- `public.rail_stations`
- `public.elevators`
- `public.port_terminals`

Все они описаны в `tegola/tegola.toml`, а подключение к базе идёт по URI `postgres://osm:osm@postgis:5432/osm?sslmode=disable`. fileciteturn1file0L1-L73

---

## Структура проекта

```text
.
├── data/                # исходные данные и вспомогательные файлы
├── server/              # backend / API маршрутизации
├── tegola/              # конфиг Tegola
├── web/                 # frontend (Vite)
├── docker-compose.yml   # запуск сервисов
├── Dockerfile           # сборка PostGIS-образа / БД
├── .env                 # локальные переменные окружения
├── README.md
└── osm_working_full.dump  # дамп рабочей БД (опционально)
```

---

## Требования

Перед запуском должны быть установлены:

- Docker Desktop
- Docker Compose
- Git

Для локальной разработки frontend без Docker дополнительно понадобятся:

- Node.js 18+
- npm

---

## Быстрый старт

### 1. Клонировать репозиторий

```bash
git clone <your-repo-url>
cd <project-folder>
```

### 2. Подготовить `.env`

Если в проекте уже есть `.env`, проверь значения. Если нет — создай файл `.env` в корне проекта.

Пример:

```env
POSTGRES_DB=osm
POSTGRES_USER=osm
POSTGRES_PASSWORD=osm
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

PORT=3000
NOTEBOOKLM_MODE=python
NOTEBOOKLM_NOTEBOOK_ID=
NOTEBOOKLM_SCRIPT_PATH=/app/ask_notebooklm.py
NOTEBOOKLM_STORAGE_PATH=/app/storage_state.json
PYTHON_BIN=/opt/venv/bin/python
NOTEBOOKLM_PYTHON_TIMEOUT_SEC=120
```

Если пока не используется внешняя база деклараций, блок `DECL_DB_*` можно оставить пустым. В текущем compose эти переменные уже ожидаются сервисом `route_api`. fileciteturn1file1L23-L43

### 3. Запустить контейнеры

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
```

---

## Загрузка дампа базы данных

Если у тебя уже есть готовый дамп, например `osm_working_full.dump`, восстановить его можно в запущенный контейнер PostGIS.

### 1. Убедиться, что PostGIS поднят

```bash
docker compose up -d postgis
```

### 2. Подключить расширения

```bash
docker exec -it map-postgis-1 psql -U osm -d osm -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker exec -it map-postgis-1 psql -U osm -d osm -c "CREATE EXTENSION IF NOT EXISTS pgrouting;"
```

Если контейнер называется как в compose, обычно это будет что-то вроде `docker-postgis-1` или `<project>-postgis-1`.

### 3. Восстановить дамп

Если версия `pg_restore` внутри контейнера подходит к дампу:

```bash
docker cp osm_working_full.dump map-postgis-1:/tmp/osm_working_full.dump
docker exec -it map-postgis-1 pg_restore -U osm -d osm --clean --if-exists /tmp/osm_working_full.dump
```

Если версии PostgreSQL отличаются, удобнее восстановить дамп через временный контейнер той же или более новой версии:

```bash
docker run --rm \
  --network <docker-network> \
  -e PGPASSWORD=osm \
  -v "$PWD:/work" \
  postgis/postgis:16-3.4 \
  pg_restore -v -h map-postgis-1 -U osm -d osm --clean --if-exists /work/osm_working_full.dump
```

### 4. Проверить, что таблицы загрузились

```bash
docker exec -it map-postgis-1 psql -U osm -d osm -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('road','rail','public') ORDER BY schemaname, tablename;"
```

Проверка размера базы:

```bash
docker exec -it map-postgis-1 psql -U osm -d osm -c "SELECT pg_size_pretty(pg_database_size('osm'));"
```

---

## Как открыть проект

После запуска сервисов обычно доступны:

- **Frontend**: `http://localhost:5173` или другой порт Vite, если запускается локально
- **Route API**: `http://localhost:3000`
- **Tegola**: `http://localhost:8080`
- **PostGIS**: `localhost:5432`

Сами контейнеры `route_api` и `tegola` публикуют порты `3000:3000` и `8080:8080`. fileciteturn1file1L18-L19 fileciteturn1file1L44-L49

---

## Запуск frontend отдельно

Если frontend запускается вне Docker:

```bash
cd web
npm install
npm run dev
```

Типовая структура frontend по текущему проекту:

```text
web/
├── src/
│   ├── components/
│   ├── lib/
│   ├── App.*
│   ├── main.*
│   └── index.*
├── package.json
├── package-lock.json
└── vite.config.*
```

---

## Полезные команды

Пересобрать и перезапустить всё:

```bash
docker compose down
docker compose up -d --build
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
docker exec -it map-postgis-1 psql -U osm -d osm
```

---

## Типовые проблемы

### Tegola пишет `relation does not exist`

Обычно это значит, что в БД не загружены таблицы, которые использует `tegola.toml`. В текущей конфигурации обязательны `public.rail_lines`, `public.rail_stations`, `public.elevators` и `public.port_terminals`. fileciteturn1file0L10-L55

### `pg_restore: unsupported version in file header`

Дамп создан более новой версией PostgreSQL, чем та, которая стоит в контейнере восстановления. Используй временный контейнер с более новой версией `postgis/postgis` и запускай `pg_restore` через него.

### Route API не стартует

Проверь, что заполнены переменные `PG*` и при необходимости `DECL_DB_*`, а PostGIS-контейнер уже доступен. `route_api` зависит от `postgis` и использует эти переменные из окружения. fileciteturn1file1L20-L43

---

## Что стоит добавить в `.gitignore`

```gitignore
node_modules/
.env
*.dump
*.log
```

---

## Планы на улучшение

- вынести все чувствительные значения в `.env`
- разделить `docker-compose` на `dev` и `prod`
- добавить healthchecks для PostGIS, API и Tegola
- описать наполнение и обновление дампа БД отдельным документом

---

## Лицензия

их нет