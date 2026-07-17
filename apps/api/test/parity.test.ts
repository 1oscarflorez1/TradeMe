import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILTIN_INDICATORS } from '../src/indicators/builtin.js';
import { computeMacroBias } from '../src/macro/bias.js';
import { inferProbs, pickAction } from '../src/ensemble/inference.js';
import { IndicatorRegistry } from '../src/indicators/registry.js';
import { buildSignal } from '../src/ensemble/signal.js';
import type { Macro } from '../src/domain/signal.js';
import { DEFAULT_ENSEMBLE } from '../src/ensemble/config.js';
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

interface MacroVectors {
  macroConfig: {
    fundingWeight: number;
    trendWeight: number;
    fundingScale: number;
    trendScale: number;
  };
  tolerance: number;
  macro_bias: Array<{
    input: { funding: number; price: number; weeklyEma: number };
    expected: { bias: number; weekly_trend: number; label: string };
  }>;
  inference: Array<{
    input: { net: number; bias: number; wMacro: number; temperature: number; holdBand: number };
    expected: { BUY: number; HOLD: number; SELL: number; action: string };
  }>;
  decision: Array<{
    macroBias: number | null;
    expected: {
      net: number;
      action: string;
      direction: string;
      levels: { entry: number; stop: number; take_profit: number } | null;
    };
  }>;
}

const macroVectors = JSON.parse(
  readFileSync(join(here, '../../../packages/core-signals/parity/macro_vectors.json'), 'utf8'),
) as MacroVectors;

describe('paridad macro — Node ≡ vectores dorados', () => {
  const cfg = { ...DEFAULT_ENSEMBLE.macro, ...macroVectors.macroConfig };

  it('macro bias coincide', () => {
    for (const v of macroVectors.macro_bias) {
      const m = computeMacroBias(v.input, cfg);
      expect(Math.abs(m.bias - v.expected.bias)).toBeLessThan(1e-4);
      expect(m.label).toBe(v.expected.label);
    }
  });

  it('inferencia modulada coincide', () => {
    for (const v of macroVectors.inference) {
      const probs = inferProbs(v.input.net, v.input.temperature, v.input.holdBand, {
        bias: v.input.bias,
        wMacro: v.input.wMacro,
      });
      expect(Math.abs(probs.BUY - v.expected.BUY)).toBeLessThan(1e-4);
      expect(Math.abs(probs.SELL - v.expected.SELL)).toBeLessThan(1e-4);
      expect(pickAction(probs).action).toBe(v.expected.action);
    }
  });
});

describe('paridad decisión — Node ≡ vectores dorados', () => {
  const registry = new IndicatorRegistry();
  const votes = registry.computeVotes(candles);
  const price = candles[candles.length - 1]!.close;

  it('reproduce net, acción, dirección y niveles del plan', () => {
    for (const v of macroVectors.decision) {
      const macro: Macro | undefined =
        v.macroBias === null
          ? undefined
          : {
              bias: v.macroBias,
              funding: 0,
              weekly_trend: v.macroBias,
              label: 'neutral',
              confluence: 'neutral',
              applied: true,
            };
      const sig = buildSignal({
        symbol: 'BTCUSDT',
        price,
        votes,
        config: DEFAULT_ENSEMBLE,
        equity: 10_000,
        interval: '1m',
        macro,
      });
      expect(sig.action).toBe(v.expected.action);
      expect(sig.direction).toBe(v.expected.direction);
      expect(Math.abs(sig.net - v.expected.net)).toBeLessThan(1e-4);
    }
  });
});
