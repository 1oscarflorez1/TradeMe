# SignalDeck — Brief maestro para Claude Cowork

> Documento de especificación + prompt de ejecución. Pégalo completo como primer mensaje en Cowork.
> El nombre del producto ("SignalDeck") es provisional; puedes renombrarlo.
> **Arquitectura: híbrida.** Node/TypeScript para tiempo real y serving (`apps/api`); Python para backtesting, optimización y entrenamiento (`apps/quant`). El contrato entre ambos está en la sección 3.1.

---

## 0. Cómo usar este documento (meta-instrucciones para Cowork)

Eres el agente que va a **construir e implementar** esta herramienta. Reglas de trabajo:

1. **Trabaja por hitos** (sección 11). No saltes al siguiente hito hasta que el actual cumpla su *Definition of Done* y la CI esté en verde.
2. **Cada hito es una rama + Pull Request** con varios *commits de valor* (sección 12). Nunca trabajes directo sobre `main`.
3. **Cada avance mejora backend Y frontend** de forma coordinada: entrega una *rebanada vertical* funcional, no capas sueltas.
4. **Antes de codificar un hito**, escribe un plan corto (objetivo, archivos a tocar, riesgos) y espera o registra mi confirmación.
5. **Pide permiso** antes de: crear/borrar repos, fuerza-pushear, tocar secretos, instalar dependencias pesadas, o cualquier acción destructiva o irreversible.
6. **Documenta a medida que avanzas**: actualiza `README.md`, `docs/` y el changelog en cada PR.
7. **Nunca** introduzcas auto-ejecución de órdenes con dinero real sin que esté detrás de un *feature flag* desactivado por defecto y con doble confirmación (sección 9).

Tono: ingeniero senior, decisiones explicables, código tipado y testeado, sin "magia".

---

## 1. Rol y mentalidad

Actúa como **ingeniero de software senior especializado en trading sistemático y plataformas de datos en tiempo real**, cómodo trabajando en **dos lenguajes** (TypeScript para tiempo real/serving, Python para cuant/ML), con experiencia en:

- Pipelines de mercado en streaming (WebSocket, normalización OHLCV, manejo de gaps/latencia).
- Análisis técnico cuantitativo y diseño de señales explicables.
- Backtesting riguroso, validación *walk-forward*, prevención de *look-ahead bias* y sobreajuste.
- Arquitecturas full-stack con CI/CD y comunicación entre servicios.

Principios rectores, en orden de prioridad:

1. **Seguridad del capital del usuario** por encima de la "agresividad" de las señales.
2. **Explicabilidad**: toda sugerencia debe poder justificarse (qué indicadores votaron, con qué peso, en qué régimen).
3. **Validación antes que optimización**: primero medir bien, luego optimizar; jamás optimizar sobre datos que también se usan para evaluar.
4. **Honestidad estadística**: las probabilidades deben estar *calibradas*; nada de prometer rentabilidad.
5. **Extensibilidad**: indicadores y modelos se enchufan, no se hardcodean.
6. **Paridad entre lenguajes**: la lógica que vive en Node (inferencia en vivo) y en Python (backtest) debe producir resultados idénticos, garantizado por tests (sección 3.1).

---

## 2. Qué es la aplicación y cómo funciona (incluir también como página in-app `docs/como-funciona.md` + pantalla "Cómo funciona")

**SignalDeck** es un copiloto de trading en tiempo real para activos mixtos (cripto, acciones, forex) que sugiere **COMPRAR / MANTENER / VENDER** sobre el activo referenciado, acompañado de un **plan de acción ordenado** y una **probabilidad calibrada de acierto**. No ejecuta operaciones por defecto: es **apoyo a la decisión**.

**Flujo de datos (end-to-end):**

1. **Ingesta** (Node): adaptadores por clase de activo reciben OHLCV en streaming (exchange para cripto, broker para acciones, feed FX). Se normaliza todo al mismo esquema de velas.
2. **Motor de indicadores** (Node, en vivo): cada indicador registrado consume las velas y emite un **voto normalizado en `[-1, +1]`** más metadatos (sección 4).
3. **Agregador (ensemble)** (Node): combina los votos con pesos configurables; el **régimen de mercado** (ADX) cambia la ponderación entre tendencia y reversión.
4. **Calibración + inferencia** (Node): aplica el modelo calibrado (pesos + calibrador, opcionalmente un meta-modelo ONNX) **entrenado offline por `apps/quant`** para convertir el puntaje neto en probabilidades fiables `BUY/HOLD/SELL`.
5. **Generador de plan** (Node): con ATR calcula entrada, stop-loss, take-profit (múltiplos de riesgo) y tamaño de posición según riesgo fijo (p. ej. 1%).
6. **Entrega** (Node): señales por **WebSocket** y **push** (FCM/APNs) con reglas de disparo (umbral, cambio de señal, *cooldown*).
7. **Mejora continua** (Python, offline): `apps/quant` corre backtesting, optimización y entrenamiento sobre el histórico y **publica artefactos** (pesos calibrados, modelo) que Node carga para inferir (sección 3.1 y 5).
8. **Clientes**: dashboard web (React) y app móvil (Expo).

**Glosario** (incluir en docs): voto, score, ensemble, régimen, calibración, walk-forward, expectancy, profit factor, drawdown, R-múltiplo.

---

## 3. Arquitectura técnica (híbrida)

Monorepo con workspaces:

```
signaldeck/
  apps/
    api/          # Node + TypeScript — tiempo real, WS, webhooks, inferencia en vivo
    quant/        # Python — backtesting, optimización (Optuna), entrenamiento/calibración, MLflow
    web/          # dashboard React + Vite + TS
    mobile/       # Expo (React Native) — reusa presentación
  packages/
    core-signals/ # contrato compartido: esquema de señal + indicadores (TS) y mirror Python
  artifacts/      # salidas de quant consumidas por api: ensemble.yaml, model.onnx, calibrators/
  infra/          # docker-compose, migraciones, github actions
  docs/           # como-funciona.md, arquitectura.md, indicadores.md, riesgo.md, contrato.md
```

**`apps/api` (Node/TypeScript)** — lo que Node hace mejor:
- Ingesta por WebSocket de exchanges/brokers/FX; normalización OHLCV; reconexión con backoff.
- Motor de indicadores en vivo + agregador + **inferencia** (carga de `artifacts/`).
- Canal WS `ws://…/stream/{symbol}` que emite el objeto de señal completo.
- Receptor de webhooks de TradingView; push notifications.
- Stack: Node 20+, TypeScript, Fastify (o NestJS), `ws`, `zod`, `technicalindicators` (o binding TA-Lib), `onnxruntime-node` (inferencia del meta-modelo), `bullmq`+Redis, `pg`.

**`apps/quant` (Python)** — lo pesado y *offline*:
- Backtesting sin look-ahead, walk-forward con purga/embargo, métricas.
- Optimización de pesos (Optuna), calibración de probabilidades, meta-modelo opcional.
- Tracking con MLflow. **Exporta** artefactos a `artifacts/`.
- Stack: Python 3.11+, pandas, numpy, pandas-ta (o TA-Lib), vectorbt, scikit-learn, LightGBM, Optuna, MLflow, scipy/statsmodels, FastAPI (solo para un endpoint de "lanzar entrenamiento" si lo quieres).

**`apps/web`**: React + TypeScript + Vite; estado con `zustand`; datos con `react-query`; gráficos con **lightweight-charts** (velas/overlays) y **recharts** (métricas).

**`apps/mobile`**: Expo; reutiliza el esquema de señal y componentes de presentación; push con `expo-notifications`.

**Datos compartidos**: PostgreSQL + **TimescaleDB** (velas históricas y señales) y Redis (cache/pub-sub). Tanto `api` como `quant` leen el mismo histórico.

Mantén **separación estricta**: la decisión en vivo se sirve desde Node; el entrenamiento vive en Python; ambos comparten contrato, no código de runtime.

### 3.1 Contrato entre `apps/api` (Node) y `apps/quant` (Python)

Cuatro artefactos definen la frontera. Documéntalos en `docs/contrato.md`.

1. **Esquema de señal** (fuente de verdad): JSON Schema versionado en `packages/core-signals/schema/signal.schema.json`. De ahí se generan tipos TS (`zod`/`json-schema-to-typescript`) y modelos Python (`pydantic` vía `datamodel-code-generator`). Un cambio de esquema obliga a regenerar ambos lados en el mismo PR.

   ```json
   {
     "version": "1.0.0",
     "symbol": "BTCUSDT",
     "ts": "2026-06-28T15:00:00Z",
     "price": 64210.5,
     "regime": { "adx": 31.2, "label": "tendencia" },
     "votes": [
       { "key": "rsi14", "label": "RSI 14", "kind": "reversion",
         "value": 28.4, "score": 0.71, "confidence": 0.6, "weight": 0.9 }
     ],
     "net": 0.38,
     "probs": { "BUY": 0.72, "HOLD": 0.18, "SELL": 0.10 },
     "action": "BUY",
     "confidence": 0.72,
     "plan": [ { "step": 1, "title": "Confirmar tendencia", "detail": "ADX 31 ✓" } ],
     "atr": 540.2,
     "model_version": "ens-2026-06-28-a"
   }
   ```

2. **Artefacto de modelo** (Python → Node): `apps/quant` exporta a `artifacts/`:
   - `ensemble.yaml`: pesos por indicador, umbrales y reglas de régimen.
   - `calibrators/`: parámetros del calibrador por régimen (isotónica/Platt).
   - `model.onnx` (opcional): meta-modelo serializado en **ONNX**, que Node infiere con `onnxruntime-node`.
   - `model_card.json`: versión, fecha, periodo de entrenamiento, métricas en hold-out.
   Node carga estos artefactos al arrancar (y en *hot-reload* controlado). Solo se promociona un artefacto si su `model_card` supera al vigente en el periodo hold-out.

3. **Suite de paridad de indicadores** (clave para la arquitectura híbrida): un conjunto de **vectores dorados** (`packages/core-signals/parity/*.json`) con entradas OHLCV y salidas esperadas (`score`, `value`) por indicador. La CI corre los **mismos vectores** contra la implementación Node y la Python; **falla el build si difieren** más allá de una tolerancia mínima. Así garantizas que lo que se backtestea en Python y lo que se infiere en vivo en Node son idénticos.

4. **Histórico de datos**: esquema único de tablas en TimescaleDB (`candles`, `signals`), leído por ambos. `quant` lee para backtestear; `api` escribe en vivo y lee para *features*.

---

## 4. Motor de señales y arquitectura de indicadores (plugin)

Diseña los indicadores como **plugins intercambiables** que cumplen un contrato. La **implementación de referencia vive en Node** (para inferencia en vivo) y tiene su **mirror en Python** (para backtest), ambos validados por la suite de paridad (3.1).

**Contrato (TypeScript, runtime en vivo):**

```ts
export interface IndicatorReading {
  value: number;        // lectura cruda para mostrar (RSI=28.4)
  score: number;        // voto normalizado en [-1, +1] (+ = sesgo comprador)
  confidence: number;   // 0..1
  regimeAffinity?: "high_adx" | "low_adx";
  meta?: Record<string, unknown>;
}
export interface Indicator {
  key: string;          // "rsi14", "sniper_ultra"
  label: string;
  kind: "trend" | "momentum" | "reversion" | "volatility" | "custom";
  defaultParams: Record<string, number>;
  compute(candles: Candle[], params: Record<string, number>): IndicatorReading;
}
```

**Mirror (Python, para backtest)** con la misma firma y el mismo `score` para los mismos datos (garantizado por paridad).

**Built-in mínimos**: EMA(9/21) crossover, MACD(12·26·9), RSI(14), Bollinger(20·2), Stochastic(14), ADX(14, define el régimen) y ATR(14, para el plan).

**Registro**: `IndicatorRegistry` en `apps/api` descubre plugins en `apps/api/indicators/` y los expone vía `GET /indicators` para que el frontend permita activarlos/configurarlos.

### 4.1 Cómo insertar indicadores de cursos (SniperUltra y otros)

Respeta la licencia/ToS del curso (no redistribuir código propietario). Dos vías:

- **Vía A — Pine Script → webhook (recomendada):** el usuario crea una alerta en TradingView con el indicador (p. ej. SniperUltra) y un mensaje JSON. El receptor `POST /tv-hook` (Node) lo traduce a un `IndicatorReading` y lo inyecta como un voto más. El mapeo (qué condición de la alerta → qué score) es declarativo en `config/webhook_indicators.yaml`. **Ventaja extra**: como no hay código propietario en el repo, no necesita mirror Python; en backtest se trata como una fuente de eventos externa registrada.
- **Vía B — Reimplementación como plugin** (solo si tienes derecho a su lógica): implementa el contrato en Node **y** su mirror en Python, añade sus vectores a la suite de paridad, y documenta en `docs/indicadores.md` cómo traducir sus reglas (cruces, niveles, confluencias) a `score` y `confidence`.

Crea un *stub* `apps/api/indicators/sniper_ultra.ts` con interfaz lista y un TODO claro; mientras no exista la lógica real, que consuma la **Vía A**.

### 4.2 Agregador (ensemble)

- Voto neto = media ponderada de `score_i`.
- **Conmutación por régimen**: ADX alto → más peso a tendencia (EMA, MACD); ADX bajo → más peso a reversión (RSI, Bollinger, Stochastic).
- Pesos y umbrales viven en `artifacts/ensemble.yaml`, **producidos por `apps/quant`** (sección 5), no hardcodeados.

---

## 5. Subsistema de mejora de precisión ("entrenar la IA") — en `apps/quant` (Python), con rigor anti-sobreajuste

Objetivo: que las acciones sugeridas sean **más precisas y sus probabilidades fiables**. Pipeline reproducible en Python; su salida son los artefactos que Node consume (3.1).

1. **Backtesting harness** (`apps/quant/backtest/`): reproduce señales vela a vela **sin look-ahead** (solo datos hasta `t`). Usa `vectorbt` o un motor propio auditable. Reutiliza los indicadores mirror (validados por paridad).
2. **Métricas** (siempre out-of-sample): hit-rate, **precision/recall** de BUY y SELL, **expectancy** (R medio), **profit factor**, **Sharpe/Sortino**, **max drawdown**, nº de operaciones (descarta muestras pequeñas).
3. **Validación walk-forward** con **purga + embargo** (estilo *purged k-fold* de López de Prado) para evitar fuga temporal.
4. **Optimización de pesos** con **Optuna** maximizando expectancy/profit factor **en validación**, con penalización de complejidad y mínimo de operaciones (anti-overfit). Exporta `ensemble.yaml`.
5. **Calibración de probabilidades** por régimen (**isotónica** o **Platt**); genera **diagramas de fiabilidad** y **Brier score**. Exporta a `calibrators/`.
6. **Meta-modelo opcional**: **LogisticRegression** o **LightGBM** sobre `score_i` + features de régimen, con **CV temporal con purga/embargo**, regularización y early stopping. Exporta a **ONNX** (`model.onnx`) para que Node lo infiera. Promociónalo solo si gana en hold-out.
7. **Registro de experimentos**: **MLflow** versiona datos, parámetros, métricas y artefactos.

> **Disclaimer obligatorio en código y UI**: ningún modelo garantiza rentabilidad; el rendimiento pasado no asegura resultados futuros; SignalDeck es educativo y de apoyo a la decisión, no asesoría financiera.

---

## 6. Visualizaciones clave (web; el móvil prioriza señal + plan + alertas)

- **Gráfico principal**: velas + EMA(9/21) + Bollinger; marcadores BUY/SELL en su punto de disparo. Pestañas *Local* y *TradingView*.
- **Anillo de confianza**: gauge radial con acción dominante y %.
- **Desglose probabilístico**: barras BUY/HOLD/SELL.
- **Mapa de calor de indicadores**: voto coloreado y peso según régimen.
- **Panel "Plan de acción"**: checklist numerado (entrada, stop, TP, sizing).
- **Historial de señales**: tabla con timestamp, acción, confianza, precio y resultado posterior.
- **Backtest** (datos de `apps/quant`): curva de equity, drawdown, distribución de R, **matriz de confusión**, **diagrama de calibración**, comparador de versiones de modelo.
- **Rendimiento por activo y por régimen**.

---

## 7. Integración TradingView (tres roles)

- **Gráfico**: widget Advanced Chart embebido (`BTCUSDT→BINANCE:BTCUSDT`, `AAPL→NASDAQ:AAPL`, `EURUSD→FX:EURUSD`).
- **Señales**: `POST /tv-hook` (Node) valida un *secret*, parsea el JSON de la alerta Pine y lo convierte en voto (4.1).
- **Notificación**: las alertas de TradingView también pueden disparar push de SignalDeck.

---

## 8. Notificaciones

Push con FCM (Android/web) y APNs (iOS) vía Expo, gestionadas por `apps/api`. Reglas: disparar al cruzar un umbral (p. ej. 65%) **o** al cambiar la acción; **cooldown** por símbolo. Contenido accionable: acción, símbolo, %, precio y enlace al plan.

---

## 9. Seguridad, riesgo y cumplimiento

- **No asesoría financiera**: disclaimer visible y en `docs/riesgo.md`.
- **Paper trading primero**; ejecución real solo tras *feature flag* desactivado por defecto, con límites de riesgo, *kill switch* y doble confirmación.
- **Secretos** en variables de entorno/gestor de secretos; nunca en el repo. Añade `.env.example`.
- **Cumplimiento**: ToS de exchanges/brokers y licencias de indicadores de cursos (no redistribuir código propietario).
- **Rate limits y reconexión** robusta en los adaptadores de datos.

---

## 10. Calidad, Git y CI/CD

- **Ramas**: trunk-based ligero. Una por hito: `feat/m3-ensemble-calibrado`.
- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`.
- **PR template**: objetivo, cambios en `api`/`quant`/`web`, capturas/GIF, checklist de tests.
- **Tests**: unitarios (indicadores Node y Python, agregador, calibración), **suite de paridad** (3.1), integración (API+WS+webhook), e2e ligero del dashboard. Coverage gate ≥80% en `core-signals` y motores.
- **GitHub Actions**: matriz con dos jobs (Node y Python) → lint + typecheck/mypy + tests + **paridad**; build de contenedores; changelog automático.
- **Pre-commit hooks**: ruff/black (Python), eslint/prettier (TS), mypy/tsc.
- **DoD por hito**: CI verde (ambos lenguajes + paridad), tests nuevos, docs actualizados, demo de la rebanada vertical.

---

## 11. Plan por hitos (cada uno: backend + frontend + tests + commits)

| Hito | Objetivo | `api` (Node) | `quant` (Python) | Frontend | DoD |
|------|----------|--------------|------------------|----------|-----|
| **M0** | Scaffolding | Fastify `/health`, WS base | Esqueleto + entorno + MLflow local | Shell del dashboard + tema | CI (Node+Python) verde, `docker compose up` |
| **M1** | Datos en vivo | Adaptador cripto WS, normalización, canal WS | Carga de histórico a TimescaleDB | Gráfico de velas en vivo + selector | Stream estable, reconexión |
| **M2** | Indicadores plugin | 7 built-in + registry + `GET /indicators` | Mirror de los 7 indicadores | Panel de votos (mapa de calor) | **Suite de paridad en verde** |
| **M3** | Ensemble + probabilidades | Agregador + régimen + softmax + inferencia | — (consume `ensemble.yaml` placeholder) | Anillo de confianza + desglose | Probabilidades coherentes |
| **M4** | Plan de acción | ATR, SL/TP, sizing por riesgo | — | Panel "Plan de acción" | Plan correcto por acción |
| **M5** | TradingView + SniperUltra | Widget mapping + `POST /tv-hook` + adaptador | Registrar señales externas en backtest | Pestaña TradingView + estado webhook | Webhook valida secret e inyecta voto |
| **M6** | Backtesting | Exponer histórico/resultados vía API | Harness sin look-ahead + métricas | Vista de backtest: equity, drawdown, matriz | Métricas reproducibles, sin fuga |
| **M7** | Entrenamiento/calibración | Cargar `artifacts/` + hot-reload + inferencia ONNX | Optuna + calibración + meta-modelo + export ONNX | Diagrama de calibración + comparador de modelos | Modelo se promociona solo si gana en hold-out |
| **M8** | Notificaciones | Push FCM/APNs + reglas + cooldown + historial | — | Centro de alertas + historial | Push llega; reglas/cooldown testeados |
| **M9** | App móvil | Endpoints listos para móvil | — | App Expo reusando presentación + push | Build móvil funcional |
| **M10** | Hardening | Observabilidad, rate limits | Reentrenos programados | Pulido UI, accesibilidad | Release `v1.0.0`, docs completas |

Antes de programar cada hito: mini-plan. Al cerrar: PR con commits convencionales, capturas y tests.

---

## 12. Qué es un "commit de valor"

Pequeño, autocontenido, con mensaje convencional y test cuando aplique. Ejemplos:

- `feat(api/indicators): add RSI plugin with normalized score in [-1,1]`
- `feat(quant/indicators): mirror RSI + parity vectors`
- `test(core-signals): golden parity suite Node vs Python`
- `feat(api/ensemble): regime switching by ADX with configurable weights`
- `feat(quant/calibration): isotonic calibration per regime, export to artifacts`
- `feat(api/infer): load model.onnx via onnxruntime-node with hot-reload`
- `feat(api/tv): webhook receiver mapping SniperUltra alerts to votes`
- `fix(api/ws): reconnect with backoff on exchange disconnect`

Cada PR debe poder revertirse sin romper el resto.

---

## 13. Stack y librerías recomendadas

**`apps/api` (Node)**: Node 20+, TypeScript, Fastify (o NestJS), `ws`, `zod`, `technicalindicators` (o binding TA-Lib), `onnxruntime-node`, `bullmq`, `ioredis`, `pg`.
**`apps/quant` (Python)**: Python 3.11+, pandas, numpy, pandas-ta (o TA-Lib), vectorbt, scikit-learn, LightGBM, Optuna, MLflow, scipy/statsmodels, skl2onnx/onnxmltools (export ONNX), FastAPI (opcional).
**`apps/web`**: React, TypeScript, Vite, zustand, react-query, lightweight-charts, recharts, lucide-react.
**`apps/mobile`**: Expo, expo-notifications.
**Datos/infra**: PostgreSQL + TimescaleDB, Redis, Docker, GitHub Actions.
**Calidad**: vitest/playwright (TS), pytest (Py), ruff/black, eslint/prettier, mypy/tsc, pre-commit.

> Verifica disponibilidad real de cada librería. Si TA-Lib no compila, usa pandas-ta (Python) y `technicalindicators` (Node) — y asegúrate de que **pasen la suite de paridad**. Justifica cualquier sustitución en el PR.

---

## 14. Primer mensaje de arranque (pégame esto tras leer el brief)

> "Confirmado el brief de SignalDeck con arquitectura híbrida. Empieza por **M0**: monorepo con la estructura de la sección 3 (`apps/api` Node + `apps/quant` Python + `apps/web` + `packages/core-signals`), Fastify con `/health`, esqueleto de `quant` con MLflow local, shell del dashboard React con tema oscuro y selector de activos vacío, docker-compose (api+quant+web+postgres+redis) y GitHub Actions con **dos jobs (Node y Python)** que corran lint+typecheck/mypy+tests. Antes de codificar, muéstrame el plan de M0 y la lista de dependencias por servicio. Abre rama `feat/m0-scaffolding` y prepara el PR con commits convencionales. No avances a M1 hasta que la CI esté verde en ambos lenguajes."
