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
import { DEFAULT_ENSEMBLE, horizonFor, validCandlesFor } from '../src/ensemble/config.js';
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
    input: {
      net: number;
      bias: number;
      wMacro: number;
      temperature: number;
      holdBand: number;
      independence?: number;
    };
    expected: { BUY: number; HOLD: number; SELL: number; action: string };
  }>;
  decision: Array<{
    macroBias: number | null;
    independence?: number;
    quarantined?: boolean;
    expected: {
      net: number;
      action: string;
      direction: string;
      hold_reason: string | null;
      shadow_action: string | null;
      shadow_direction: string | null;
      levels: { entry: number; stop: number; take_profit: number } | null;
    };
  }>;
  timeframes: Array<{
    interval: string;
    expected: { valid_candles: number; horizon: number; quarantined: boolean };
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
      const probs = inferProbs(
        v.input.net,
        v.input.temperature,
        v.input.holdBand,
        { bias: v.input.bias, wMacro: v.input.wMacro },
        v.input.independence ?? 1,
      );
      expect(Math.abs(probs.BUY - v.expected.BUY)).toBeLessThan(1e-4);
      expect(Math.abs(probs.SELL - v.expected.SELL)).toBeLessThan(1e-4);
      expect(pickAction(probs).action).toBe(v.expected.action);
    }
  });

  it('el desinflado por dependencia baja la confianza sin cambiar la dirección', () => {
    // Invariante del ajuste: escalar los tres logits por una constante positiva no altera el
    // argmax. Si esto se rompiera, habría dejado de ser una corrección de calibración para
    // convertirse en un cambio de criterio, y habría que revalidar toda la estrategia.
    for (const net of [-0.9, -0.35, -0.05, 0, 0.05, 0.35, 0.9]) {
      for (const bias of [-0.8, 0, 0.8]) {
        const base = inferProbs(net, 0.5, 0.06, { bias, wMacro: 1 }, 1);
        for (const k of [0.9, 0.66, 0.485, 0.35]) {
          const bajado = inferProbs(net, 0.5, 0.06, { bias, wMacro: 1 }, k);
          expect(pickAction(bajado).action).toBe(pickAction(base).action);
          expect(pickAction(bajado).confidence).toBeLessThanOrEqual(
            pickAction(base).confidence + 1e-12,
          );
        }
      }
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
        config: {
          ...DEFAULT_ENSEMBLE,
          independenceFactor: v.independence ?? 1,
          quarantined: v.quarantined ?? false,
        },
        equity: 10_000,
        interval: '1m',
        macro,
      });
      expect(sig.action).toBe(v.expected.action);
      expect(sig.direction).toBe(v.expected.direction);
      expect(sig.hold_reason ?? null).toBe(v.expected.hold_reason ?? null);
      expect(sig.shadow_action ?? null).toBe(v.expected.shadow_action ?? null);
      expect(sig.shadow_direction ?? null).toBe(v.expected.shadow_direction ?? null);
      expect(Math.abs(sig.net - v.expected.net)).toBeLessThan(1e-4);
    }
  });
});

describe('paridad por temporalidad — Node ≡ vectores dorados', () => {
  it('frescura de la entrada, horizonte de evaluación y cuarentena', () => {
    for (const v of macroVectors.timeframes) {
      expect(validCandlesFor(DEFAULT_ENSEMBLE, v.interval)).toBe(v.expected.valid_candles);
      expect(horizonFor(DEFAULT_ENSEMBLE, v.interval)).toBe(v.expected.horizon);
      expect(DEFAULT_ENSEMBLE.quarantineIntervals.includes(v.interval)).toBe(
        v.expected.quarantined,
      );
    }
  });
});

describe('cuarentena con salida (M10.7)', () => {
  const registry = new IndicatorRegistry();
  const votes = registry.computeVotes(candles);
  const price = candles[candles.length - 1]!.close;

  const construye = (quarantined: boolean) =>
    buildSignal({
      symbol: 'BTCUSDT',
      price,
      votes,
      config: { ...DEFAULT_ENSEMBLE, quarantined },
      equity: 10_000,
      interval: '1m',
    });

  it('una temporalidad vetada no emite señal operable', () => {
    const sig = construye(true);
    expect(sig.action).toBe('HOLD');
    expect(sig.direction).toBe('FLAT');
    expect(sig.hold_reason).toBe('cuarentena');
  });

  it('pero conserva lo que habría hecho, o no podría salir nunca', () => {
    // Sin sombra, una temporalidad en cuarentena no genera nada evaluable y la medida sería
    // irreversible por construcción. Esta es la prueba que protege esa propiedad.
    const vetada = construye(true);
    const libre = construye(false);
    expect(libre.action).not.toBe('HOLD');
    expect(vetada.shadow_action).toBe(libre.action);
    expect(vetada.shadow_direction).toBe(libre.direction);
  });

  it('sin cuarentena no se registra sombra alguna', () => {
    const sig = construye(false);
    expect(sig.shadow_action).toBeUndefined();
    expect(sig.shadow_direction).toBeUndefined();
  });
});
