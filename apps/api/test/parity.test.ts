import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILTIN_INDICATORS } from '../src/indicators/builtin.js';
import type { Candle } from '../src/domain/candle.js';

interface Vectors {
  dataset: { candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> };
  tolerance: { value: number; score: number };
  expected: Record<string, { value: number; score: number; confidence: number }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, '../../../packages/core-signals/parity/vectors.json'), 'utf8'),
) as Vectors;

const candles: Candle[] = vectors.dataset.candles.map((k) => ({
  symbol: 'BTCUSDT',
  interval: '1m',
  openTime: k.t,
  open: k.o,
  high: k.h,
  low: k.l,
  close: k.c,
  volume: k.v,
  closeTime: k.t + 59_999,
  closed: true,
}));

describe('paridad — Node ≡ vectores dorados', () => {
  for (const indicator of BUILTIN_INDICATORS) {
    it(`${indicator.key} coincide con el vector dorado`, () => {
      const expected = vectors.expected[indicator.key];
      expect(expected, `falta el vector de ${indicator.key}`).toBeDefined();
      const reading = indicator.compute(candles);
      expect(reading).not.toBeNull();
      // Node es la referencia: tolerancia estricta.
      expect(Math.abs((reading?.value ?? 0) - expected!.value)).toBeLessThan(1e-4);
      expect(Math.abs((reading?.score ?? 0) - expected!.score)).toBeLessThan(1e-4);
    });
  }
});
