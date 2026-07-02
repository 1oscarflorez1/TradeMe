# Motor de indicadores (plugin)

Los indicadores son **plugins intercambiables** que cumplen un contrato. La implementación de
referencia vive en Node (inferencia en vivo) y tiene su mirror en Python (backtest); ambos validados
por la suite de paridad.

**Built-in mínimos (M2):** EMA(9/21) crossover, MACD(12·26·9), RSI(14), Bollinger(20·2),
Stochastic(14), ADX(14, define el régimen) y ATR(14, para el plan).

**Contrato (TypeScript):**

```ts
export interface IndicatorReading {
  value: number; // lectura cruda (RSI=28.4)
  score: number; // voto normalizado en [-1, +1] (+ = sesgo comprador)
  confidence: number; // 0..1
  regimeAffinity?: 'high_adx' | 'low_adx';
  meta?: Record<string, unknown>;
}
```

**Indicadores de cursos (SniperUltra, etc.):** se integran respetando licencia/ToS. Vía recomendada:
alerta de TradingView → `POST /tv-hook` (Node) → se traduce a un `IndicatorReading` y se inyecta como
un voto más. No se copia código propietario al repo. (Detalle en M5.)
