# Motor de indicadores (M2)

Los indicadores son **plugins** que cumplen el contrato `Indicator` y emiten una lectura
normalizada. Todo termina siendo un **voto** con el mismo esquema, venga de un cálculo interno o de
una señal externa (NinjaTrader, TradingView).

## Contrato de voto

```jsonc
{
  "key": "rsi14",
  "label": "RSI 14",
  "kind": "reversion",
  "source": "internal", // internal | ninjatrader | tradingview
  "value": 28.4, // lectura cruda
  "score": 0.71, // NORMALIZADO a [-1,+1] (+ = compra)
  "confidence": 0.6, // 0..1
  "ts": "2026-07-06T15:00:00Z",
  "ttlMs": 120000, // validez (señales externas)
}
```

## Familia A — indicadores calculados (internos)

Implementación de referencia en Node (`technicalindicators`) y mirror en Python (numpy replicando
las mismas convenciones: semilla SMA + suavizado de Wilder para RSI/ATR/ADX). Ambos validados por la
**suite de paridad** (ver abajo).

| Indicador       | Tipo        | Mapeo a `score`                                                              |
| --------------- | ----------- | ---------------------------------------------------------------------------- |
| RSI(14)         | reversión   | `clamp((50 − rsi)/20)` → RSI 30 = +1, 70 = −1                                |
| Stochastic(14)  | reversión   | `clamp((50 − %K)/30)`                                                        |
| Bollinger(20,2) | reversión   | `%B`: `clamp(1 − 2·%B)` (banda inferior = +1)                                |
| EMA(9/21)       | tendencia   | `clamp(tanh((ema9 − ema21)/ATR))`                                            |
| MACD(12,26,9)   | momentum    | `clamp(tanh(histograma/ATR))`                                                |
| ADX(14)         | contexto    | **No vota** (`score = 0`); define régimen (≥25 tendencia) y modula confianza |
| ATR(14)         | volatilidad | **No vota**; alimenta el plan (M4) y normaliza EMA/MACD                      |

`confidence = |score|` (salvo ADX = `clamp(adx/50)` y ATR = 0).

## Familia B — señales externas (NinjaTrader / TradingView)

No se recalculan ni se reimplementan (se respeta la licencia del curso: nada de NinjaScript
propietario en el repo). El backend expone `POST /signals/ninjatrader` (validado por _secret_
opcional `NT8_WEBHOOK_SECRET`) que traduce el payload con un **mapa declarativo** en
`apps/api/config/external_signals.yaml`:

```yaml
ninjatrader:
  sniper_ultra:
    kind: custom
    ttl_ms: 120000
    map: # señal directa NT8 -> score
      long: { score: 1.0, confidence: 0.8 }
      short: { score: -1.0, confidence: 0.8 }
      flat: { score: 0.0, confidence: 0.3 }
    # range: { min: -100, max: 100 }   # o valor continuo escalado a [-1,+1]
```

Las señales se guardan con **TTL** para no votar con datos rancios. El **puente real** (NinjaScript
C# + transporte TCP/WebSocket) llega en **M5**; en M2 se prueba el flujo con stubs (curl/Postman).

Ejemplo:

```bash
curl -X POST localhost:3001/signals/ninjatrader \
  -H 'content-type: application/json' \
  -d '{"indicator":"sniper_ultra","symbol":"BTCUSDT","signal":"long"}'
```

## Suite de paridad (Node ≡ Python)

Vectores dorados en `packages/core-signals/parity/vectors.json`: un dataset OHLCV fijo + `value` y
`score` esperados por indicador, generados desde la implementación Node
(`apps/api/scripts/gen-parity.ts`). Cada lenguaje debe igualarlos dentro de tolerancia; el **job
`parity`** de CI corre ambos lados y rompe el build si difieren. En la práctica el mirror numpy
coincide con `technicalindicators` con Δscore ≈ 0.

> Nota: se eligió replicar las fórmulas en numpy en vez de `pandas-ta` porque este último está sin
> mantenimiento y es incompatible con numpy ≥ 2 (`from numpy import NaN`), lo que rompería CI. El
> resultado es paridad exacta y control total del mapeo.

## Ensemble (M3)

En M2 los votos se calculan, viajan por WS (`{type:'votes'}`) y se visualizan (heatmap). Combinarlos
en una acción BUY/HOLD/SELL con pesos por régimen y probabilidades calibradas es **M3**.
