# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

### Added — M7 · Optimización (Slice B)

- `apps/quant`: **Optuna** (TPE) optimiza pesos de indicadores y multiplicadores de régimen
  maximizando **expectancy penalizada** en **walk-forward con purga/embargo** (`walkforward.py`,
  `optimize.py`); promoción **solo si gana en hold-out**. CLI `run_optimize` → `ensemble.optimized.yaml`
  + `optimization_report.json`.
- `apps/api`: `POST /reload` recarga también el ensemble (prefiere el optimizado si existe);
  `GET /ensemble` con la versión activa y el informe base vs optimizado.
- `apps/web`: comparador de **Optimización** en la pestaña Backtest (veredicto + hold-out base vs
  optimizado). Además, layout de Backtest a dos columnas y guía en acordeón.
- Sin cambios de contrato ni de la matemática de decisión (mismos campos del ensemble): la paridad
  Node≡Python sigue vigente.

### Added — M7 · Calibración (Slice A)

- `apps/quant`: módulo `calibration.py` con calibradores por régimen **isotónica (PAVA)** y **Platt**
  (elige el de menor **Brier**), a mano en numpy; CLI `python -m trademe_quant.run_calibration` que
  exporta `artifacts/calibrators.json`. El backtest guarda `regime` y `confidence` por trade.
- `apps/api`: applier del calibrador (**paridad** Node≡Python), campos `calibrated_confidence` y
  `calibration_version` en la señal, `GET /calibration` (fiabilidad + Brier) y `POST /reload`
  (recarga en caliente de artefactos).
- `apps/web`: panel **Calibración** en la pestaña Backtest (diagrama de fiabilidad por régimen + Brier).
- `infra`: volumen compartido `artifacts/` entre `quant` (escribe) y `api` (lee).
- Contrato: `calibrated_confidence`/`calibration_version` en el esquema; vectores de paridad del
  calibrador en `macro_vectors.json`.

### Added — M6 · Backtesting

- `apps/quant`: mirror de la decisión (`decision.py`, agregación + plan) con **paridad** ampliada;
  harness de backtest sin look-ahead (primer toque, peor caso SL), métricas out-of-sample
  (win rate, expectancy, profit factor, max drawdown, Sharpe) y **evaluador de outcomes** de snapshots;
  CLI `python -m trademe_quant.run_backtest`.
- `apps/api`: tabla `backtests` (TimescaleDB) y `GET /backtest` (último resultado).
- `apps/web`: pestaña **Backtest** (métricas + curva de equity).
- Reditum: se añade `reditum_geny` (Geny Trend) al mapeo; atribución corregida a **Ingresarios**.

### Added — M5.6 · UX, registros y validez del plan

- `apps/api`: runner de migraciones al arrancar (crea tablas faltantes sin recrear el volumen);
  **validez temporal del plan** (`plan.valid_candles`, campo `valid_until`); `GET /snapshots` con
  seguimiento en vivo (precio actual vs entrada/SL/TP, R aproximado, expirado). Contrato v1.2.0.
- `apps/web`: pestañas **Panel / Registros**; indicadores reubicados a lo ancho en la parte inferior;
  vista de Registros con tabla de snapshots y seguimiento en vivo.
- `docs/`: `metodologia.md` y `backlog.md` (integración de los documentos del equipo).

### Fixed

- El sesgo macro ahora se aplica de verdad en las señales en vivo (`/signal`, WS y `/snapshots`):
  en M5.5 el `macro` no se pasaba en esas llamadas.

### Added — M5.5 · Macro Bias, Direccionalidad y Snapshots

- `apps/api`: sesgo macro (funding + tendencia semanal EMA 1w) inyectado en los logits del softmax,
  con degradación a FLAT en conflicto fuerte; campo `direction` (LONG/SHORT/FLAT); intervalo `1w`.
- `apps/api`: `POST /snapshots` (recalcula la señal, autoritativo) y tabla `snapshots` en TimescaleDB
  con columnas nombradas + `raw_signal` JSONB (dataset para entrenamiento de IA; `outcome_*` los llena M6).
- `apps/quant`: mirrors `macro.py` e `inference.py` con paridad (nuevos vectores dorados `macro_vectors.json`).
- `apps/web`: anillo LONG/SHORT/FLAT, panel Macro (sesgo/funding/tendencia/confluencia) y botón 📸 Snapshot.
- Contrato `signal.schema.json` v1.1.0 (`direction`, `macro`).

### Added — M5 · Integración TradingView (Reditum)

- `apps/api`: webhook seguro `POST /tv-hook` (token en el body) para alertas Pine de la suite Reditum
  (`reditum_sniper`, `reditum_poc`); registro de alertas en TimescaleDB (`external_signals`) para el
  backtest de M6.
- `apps/web`: pestaña TradingView (widget Advanced Chart) junto a "Local" y panel de estado de
  webhooks (estrategia, latencia, TTL restante).
- `apps/quant`: lector/validador de `external_signals` (semilla del replay de M6).
- `docs/tradingview.md`: guía de configuración de la alerta (URL + JSON + túnel ngrok).

### Removed

- **Purga completa de NinjaTrader**: fuera `POST /signals/ninjatrader`, la fuente `ninjatrader`, el
  secret NT8 y toda referencia en código, tests y docs. La integración externa es exclusivamente
  TradingView (Reditum). El peso 2× pasa a `tradingview`.

### Added — M4 · Plan de acción

- `apps/api`: `buildPlan` (entrada, stop-loss por ATR, take-profit por múltiplo de riesgo y tamaño
  de posición por riesgo fijo) integrado en el Signal; parámetros en `ensemble.yaml` (sección `risk`)
  y capital por `ACCOUNT_EQUITY`.
- `apps/quant`: validación de la sección `risk` del `ensemble.yaml`.
- `apps/web`: panel "Plan de acción" con el checklist numerado.

### Added — M3 · Ensemble + probabilidades

- `apps/api`: agregador ponderado por régimen (ADX), inferencia `net → BUY/HOLD/SELL` vía softmax
  con temperatura, objeto Signal completo, `GET /signal` y WS `{type:'signal'}`.
- `artifacts/ensemble.yaml`: pesos, reglas de régimen, temperatura y la fuente externa con peso 2×.
- `apps/quant`: validación de esquema de `ensemble.yaml` (`load_ensemble`/`validate_ensemble`).
- `apps/web`: panel de decisión con anillo de confianza y desglose de probabilidades BUY/HOLD/SELL.
- Multi-temporalidad: soporte para `1m, 5m, 15m, 30m, 1h, 4h, 1d` (suscritas en vivo; configurable
  vía `TRADEME_INTERVALS`). El selector del dashboard se puebla desde `GET /symbols`.

### Added — M2 · Indicadores plugin + paridad

- `apps/api`: contrato `Indicator`/voto (con `source`, `ts`, `ttlMs`), 7 built-in con
  `technicalindicators` y normalización a `score` en [-1,+1], `IndicatorRegistry` y `GET /indicators`.
- `apps/api`: votos en vivo por WS (`{type:'votes'}`), `GET /votes`, y slot de señales externas
  endpoint de señales externas con mapeo declarativo `config/external_signals.yaml` y TTL.
- `apps/quant`: mirror de indicadores en numpy (paridad con technicalindicators) y runner de paridad.
- `packages/core-signals`: vectores dorados `parity/vectors.json` (generador `gen-parity.ts`).
- CI: tercer job **parity** (Node y Python contra los mismos vectores).
- `apps/web`: heatmap de indicadores en vivo (color por score, intensidad por confianza, badge de fuente externa).

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
