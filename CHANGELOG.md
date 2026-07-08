# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

### Added — M3 · Ensemble + probabilidades

- `apps/api`: agregador ponderado por régimen (ADX), inferencia `net → BUY/HOLD/SELL` vía softmax
  con temperatura, objeto Signal completo, `GET /signal` y WS `{type:'signal'}`.
- `artifacts/ensemble.yaml`: pesos, reglas de régimen, temperatura y NinjaTrader con peso 2×.
- `apps/quant`: validación de esquema de `ensemble.yaml` (`load_ensemble`/`validate_ensemble`).
- `apps/web`: panel de decisión con anillo de confianza y desglose de probabilidades BUY/HOLD/SELL.
- Multi-temporalidad: soporte para `1m, 5m, 15m, 30m, 1h, 4h, 1d` (suscritas en vivo; configurable
  vía `TRADEME_INTERVALS`). El selector del dashboard se puebla desde `GET /symbols`.

### Added — M2 · Indicadores plugin + paridad

- `apps/api`: contrato `Indicator`/voto (con `source`, `ts`, `ttlMs`), 7 built-in con
  `technicalindicators` y normalización a `score` en [-1,+1], `IndicatorRegistry` y `GET /indicators`.
- `apps/api`: votos en vivo por WS (`{type:'votes'}`), `GET /votes`, y slot de señales externas
  `POST /signals/ninjatrader` con mapeo declarativo `config/external_signals.yaml` y TTL (stub NT8).
- `apps/quant`: mirror de indicadores en numpy (paridad con technicalindicators) y runner de paridad.
- `packages/core-signals`: vectores dorados `parity/vectors.json` (generador `gen-parity.ts`).
- CI: tercer job **parity** (Node y Python contra los mismos vectores).
- `apps/web`: heatmap de indicadores en vivo (color por score, intensidad por confianza, badge NT8).

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

### Fixed

- Build de imágenes Docker de `apps/api` y `apps/web`: se instala el workspace pnpm completo
  (devDeps incluidas, `tsc` disponible) y se añade `.dockerignore` para no arrastrar `node_modules`
  del host. Resuelve `MODULE_NOT_FOUND` de `tsc` en `docker compose build`.

### Added — M0 · Scaffolding

- Monorepo pnpm con workspaces (`apps/api`, `apps/quant`, `apps/web`, `packages/core-signals`).
- `apps/api`: servidor Fastify con `GET /health` y canal WebSocket base `/stream`.
- `apps/quant`: esqueleto de paquete Python con tracking MLflow local y pruebas.
- `packages/core-signals`: esquema de señal `signal.schema.json` v1.0.0 y carpeta de paridad.
- `apps/web`: shell del dashboard React + Vite con tema oscuro y selector de activos.
- `infra/docker-compose.yml`: api + quant + web + PostgreSQL/TimescaleDB + Redis.
- CI de GitHub Actions con dos jobs (Node y Python): lint + typecheck/mypy + tests.
- Documentación inicial en `docs/` y `.env.example`.
