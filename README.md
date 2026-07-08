# TradeMe

> Copiloto de trading en tiempo real para activos mixtos (cripto, acciones, forex).
> Sugiere **COMPRAR / MANTENER / VENDER** con un plan de acción ordenado y una probabilidad calibrada.
> **Apoyo a la decisión, no asesoría financiera.** No ejecuta operaciones por defecto.

> ⚠️ **Disclaimer**: ningún modelo garantiza rentabilidad; el rendimiento pasado no asegura
> resultados futuros. TradeMe es educativo y de apoyo a la decisión, no asesoría financiera.

## Arquitectura híbrida

| App                     | Lenguaje             | Rol                                                                                           |
| ----------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| `apps/api`              | Node 20 + TypeScript | Tiempo real: ingesta WS, motor de indicadores en vivo, agregador, inferencia, entrega WS/push |
| `apps/quant`            | Python 3.11          | Offline: backtesting, optimización (Optuna), calibración, entrenamiento; exporta artefactos   |
| `apps/web`              | React + Vite + TS    | Dashboard                                                                                     |
| `apps/mobile`           | Expo (futuro)        | App móvil                                                                                     |
| `packages/core-signals` | Contrato compartido  | Esquema de señal + suite de paridad de indicadores                                            |

La frontera Node↔Python se define en [`docs/contrato.md`](docs/contrato.md): esquema de señal
versionado, artefactos de modelo (`ensemble.yaml`, `calibrators/`, `model.onnx`) y la
**suite de paridad** que debe pasar en CI.

## Requisitos

- Node ≥ 20 y **pnpm** ≥ 9 (`corepack enable pnpm`)
- Python ≥ 3.11
- Docker (para `docker compose`)

## Puesta en marcha (M0)

```bash
# 1. Variables de entorno
cp .env.example .env

# 2. Dependencias Node (monorepo)
pnpm install

# 3. Levantar infraestructura + servicios
docker compose -f infra/docker-compose.yml up

# o, en local sin Docker:
pnpm --filter @trademe/api dev     # API en http://localhost:3001/health
pnpm --filter @trademe/web dev     # Dashboard en http://localhost:5173
```

Entorno Python (`apps/quant`):

```bash
cd apps/quant
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

## Calidad

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # Node
cd apps/quant && ruff check . && mypy . && pytest         # Python
```

CI ejecuta ambos jobs (Node + Python) más la suite de paridad. No se avanza de hito sin CI verde.

## Endpoints y datos en vivo (M1)

La API (`apps/api`) sirve, además de `/health`:

- `GET /symbols` — símbolos e intervalos disponibles.
- `GET /candles?symbol=BTCUSDT&interval=1m&limit=300` — histórico OHLCV (Binance REST).
- `ws://…/stream/{symbol}?interval=1m|1h` — velas en vivo por WebSocket.
- `GET /indicators` — catálogo de indicadores disponibles.
- `GET /votes?symbol=BTCUSDT&interval=1m` — votos actuales (internos + señales externas activas).
- `POST /signals/ninjatrader` — ingreso de señales externas (NinjaTrader), mapeadas vía
  `apps/api/config/external_signals.yaml`. Ver [`docs/indicadores.md`](docs/indicadores.md).
- El WS `stream/{symbol}` emite además mensajes `{ type: 'votes', ... }` con el heatmap en vivo.
- `GET /signal?symbol=BTCUSDT&interval=1m` — señal completa del ensemble (acción, probabilidades,
  régimen, votos ponderados). El WS emite también `{ type: 'signal', ... }`. Ver [`docs/ensemble.md`](docs/ensemble.md).

Los datos vienen de **Binance** (públicos, sin clave). El adaptador (`DataAdapter` →
`BinanceAdapter`) normaliza OHLCV, se **reconecta con backoff** ante caídas y persiste las velas
cerradas en TimescaleDB (multi-temporalidad **1m + 1h**). `apps/quant` siembra el histórico
(`seed_history`) sin gaps ni duplicados. El dashboard dibuja las velas en vivo con selector de
activo y temporalidad y un indicador de estado de conexión.

## Hitos

El desarrollo va por hitos **M0 → M10** (ver [`trademe.md`](trademe.md), sección 11). Una rama y
un PR por hito; Conventional Commits; nunca commits directos a `main`.

| Hito                            | Estado        |
| ------------------------------- | ------------- |
| **M0** Scaffolding              | ✅ Completado |
| **M1** Datos en vivo (Binance)  | 🟡 En curso   |
| M2 Indicadores plugin + paridad | ⬜            |
| M3 Ensemble + probabilidades    | ⬜            |
| M4 Plan de acción               | ⬜            |
| M5 TradingView + SniperUltra    | ⬜            |
| M6 Backtesting                  | ⬜            |
| M7 Entrenamiento / calibración  | ⬜            |
| M8 Notificaciones               | ⬜            |
| M9 App móvil                    | ⬜            |
| M10 Hardening + v1.0.0          | ⬜            |

## Documentación

- [`docs/como-funciona.md`](docs/como-funciona.md) — qué es y cómo funciona
- [`docs/arquitectura.md`](docs/arquitectura.md) — arquitectura híbrida
- [`docs/contrato.md`](docs/contrato.md) — contrato Node↔Python
- [`docs/indicadores.md`](docs/indicadores.md) — motor de indicadores (plugin)
- [`docs/riesgo.md`](docs/riesgo.md) — seguridad, riesgo y cumplimiento
