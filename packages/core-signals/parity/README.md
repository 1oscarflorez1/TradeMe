# Suite de paridad de indicadores

Vectores dorados (`*.json`) con entradas OHLCV y salidas esperadas (`score`, `value`) por indicador.
La CI corre los **mismos vectores** contra la implementación Node (`apps/api`) y la Python
(`apps/quant`) y **falla el build si difieren** más allá de la tolerancia.

Se llena en **M2** (indicadores plugin). Formato previsto por vector:

```json
{
  "indicator": "rsi14",
  "params": { "period": 14 },
  "candles": [{ "t": 0, "o": 0, "h": 0, "l": 0, "c": 0, "v": 0 }],
  "expected": { "value": 0.0, "score": 0.0 },
  "tolerance": 1e-6
}
```
