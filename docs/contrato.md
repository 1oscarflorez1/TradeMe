# Contrato entre `apps/api` (Node) y `apps/quant` (Python)

Cuatro artefactos definen la frontera de la arquitectura híbrida.

## 1. Esquema de señal (fuente de verdad)

JSON Schema versionado en [`packages/core-signals/schema/signal.schema.json`](../packages/core-signals/schema/signal.schema.json).
De ahí se generan tipos TS (`zod` / `json-schema-to-typescript`) y modelos Python
(`pydantic` vía `datamodel-code-generator`). **Un cambio de esquema obliga a regenerar ambos lados
en el mismo PR.** (Generación automática: pendiente para M2.)

## 2. Artefacto de modelo (Python → Node)

`apps/quant` exporta a `artifacts/`:

- `ensemble.yaml`: pesos por indicador, umbrales y reglas de régimen.
- `calibrators/`: parámetros del calibrador por régimen (isotónica / Platt).
- `model.onnx` (opcional): meta-modelo en ONNX, inferido por Node con `onnxruntime-node`.
- `model_card.json`: versión, fecha, periodo de entrenamiento, métricas en hold-out.

Node carga estos artefactos al arrancar (hot-reload controlado). Solo se promociona un artefacto si
su `model_card` supera al vigente en el periodo hold-out.

## 3. Suite de paridad de indicadores

Vectores dorados en `packages/core-signals/parity/*.json` (entradas OHLCV + salidas esperadas
`score`/`value` por indicador). La CI corre **los mismos vectores** contra la implementación Node y la
Python y **falla el build si difieren** más allá de una tolerancia mínima. Garantiza que lo que se
backtestea en Python y lo que se infiere en vivo en Node son idénticos. (Se llena en M2.)

## 4. Histórico de datos

Esquema único en TimescaleDB (`candles`, `signals`) leído por ambos. `quant` lee para backtestear;
`api` escribe en vivo y lee para features.

## Voto extendido (M2)

Desde M2 cada voto incluye `source` (`internal|ninjatrader|tradingview`), `ts` y `ttlMs?` para
admitir señales externas (NinjaTrader) junto a los indicadores calculados. Ver `docs/indicadores.md`.
