# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

### Added — M1 · Datos en vivo (Binance)

- `apps/api`: interfaz `DataAdapter` y `BinanceAdapter` (WebSocket de klines, normalización OHLCV,
  reconexión con backoff exponencial + jitter, `getHistory` por REST).
- `apps/api`: canal `ws://…/stream/{symbol}?interval=1m|1h`, endpoints `GET /candles` y `GET /symbols`,
  y persistencia de velas cerradas en TimescaleDB vía `pg`.
- `apps/quant`: `seed_history` (siembra idempotente), `detect_gaps`, cliente REST de Binance y sink
  `PgCandleSink` (psycopg).
- `apps/web`: gráfico de velas en vivo con lightweight-charts, selector de activo y temporalidad
  (1m/1h) y estado de conexión.
- `infra`: `candles` multi-temporalidad (PK `symbol, interval, ts`) + migración `002`.
- Tests nuevos (Node y Python), incluida la prueba de reconexión del adaptador.

### Added — M0 · Scaffolding

- Monorepo pnpm con workspaces (`apps/api`, `apps/quant`, `apps/web`, `packages/core-signals`).
- `apps/api`: servidor Fastify con `GET /health` y canal WebSocket base `/stream`.
- `apps/quant`: esqueleto de paquete Python con tracking MLflow local y pruebas.
- `packages/core-signals`: esquema de señal `signal.schema.json` v1.0.0 y carpeta de paridad.
- `apps/web`: shell del dashboard React + Vite con tema oscuro y selector de activos.
- `infra/docker-compose.yml`: api + quant + web + PostgreSQL/TimescaleDB + Redis.
- CI de GitHub Actions con dos jobs (Node y Python): lint + typecheck/mypy + tests.
- Documentación inicial en `docs/` y `.env.example`.
