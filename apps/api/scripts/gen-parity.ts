// Genera los vectores dorados de paridad desde los indicadores Node (referencia).
// Uso: pnpm --filter @trademe/api tsx scripts/gen-parity.ts
import { writeFileSync } from 'node:fs';
import { BUILTIN_INDICATORS } from '../src/indicators/builtin.js';
import type { Candle } from '../src/domain/candle.js';

function genCandles(n: number): Candle[] {
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 8) * 0.8 + (rnd() - 0.5) * 1.5;
    const open = price;
    const close = Math.max(1, price + drift);
    const high = Math.max(open, close) + rnd() * 0.8;
    const low = Math.min(open, close) - rnd() * 0.8;
    candles.push({
      symbol: 'BTCUSDT',
      interval: '1m',
      openTime: i * 60_000,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: round(10 + rnd() * 5),
      closeTime: i * 60_000 + 59_999,
      closed: true,
    });
    price = close;
  }
  return candles;
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

const candles = genCandles(150);
const expected: Record<string, { value: number; score: number; confidence: number }> = {};
for (const ind of BUILTIN_INDICATORS) {
  const r = ind.compute(candles);
  if (!r) continue;
  expected[ind.key] = {
    value: round(r.value),
    score: round(r.score),
    confidence: round(r.confidence),
  };
}

const vectors = {
  description: 'Vectores dorados de paridad Node<->Python. Referencia: indicadores Node.',
  dataset: {
    symbol: 'BTCUSDT',
    interval: '1m',
    candles: candles.map((c) => ({
      t: c.openTime,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    })),
  },
  tolerance: { value: 0.05, score: 0.05 },
  expected,
};

writeFileSync(
  new URL('../../../packages/core-signals/parity/vectors.json', import.meta.url),
  JSON.stringify(vectors, null, 2) + '\n',
);
console.log('vectores generados:', Object.keys(expected).join(', '));
