# Macro Bias, Direccionalidad y Snapshots (M5.5)

## 1. Sesgo Macro (1w+)

Capa de contexto fundamental que **filtra** las señales técnicas. **No es un voto** del ensemble: es
un modulador top-down calculado a partir de datos semanales.

**Métrica (MVP):** `funding rate` (Binance Futures, sentimiento apalancado) + tendencia semanal
(precio vs EMA 1w). Fórmula (idéntica en Node y Python, validada por paridad):

```
funding_component = -tanh(funding / funding_scale)      # funding alto = largos saturados = bajista
trend_component   =  tanh((precio - ema1w) / (ema1w · trend_scale))
macroBias = clamp(funding_weight · funding_component + trend_weight · trend_component,  -1, +1)
```

**Aplicación (inyección en logits del softmax):**

```
logit_BUY  += w_macro · macroBias
logit_SELL += -w_macro · macroBias
```

Un macro alcista **potencia** BUY y **penaliza** SELL (y viceversa). Parámetros en `ensemble.yaml`
(sección `macro`). Se refresca cada hora desde el backend.

**Escudo de capital:** si hay **conflicto** (técnica vs macro con signos opuestos) y el sesgo es
fuerte (`|macroBias| > conflict_threshold`), la acción se **degrada a FLAT** (no operar contra el
macro dominante).

## 2. Direccionalidad LONG / SHORT

El Signal incluye `direction`: `BUY → LONG`, `SELL → SHORT`, `HOLD → FLAT` (y FLAT forzado por el
escudo macro). El campo `macro.confluence` (`aligned | conflict | neutral`) indica si técnica y macro
apuntan al mismo lado. La web muestra la dirección en el anillo y la confluencia en el panel Macro.

## 3. Snapshots para IA

Botón **📸 Snapshot** en la web → `POST /snapshots`. El backend **recalcula la señal** (autoritativo)
y la aplana en la tabla `snapshots` (TimescaleDB) con **columnas nombradas** (precio, indicadores,
probabilidades, dirección, macro, plan TP/SL) más `raw_signal` JSONB. Los `outcome_*` quedan en NULL
y los rellena de forma asíncrona el evaluador del backtesting (M6). Este dataset es la base para el
análisis estadístico y el entrenamiento de la IA propietaria.

> Apoyo a la decisión, no asesoría financiera.
