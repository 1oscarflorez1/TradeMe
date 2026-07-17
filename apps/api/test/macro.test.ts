import { describe, it, expect } from 'vitest';
import { computeMacroBias } from '../src/macro/bias.js';
import { confluence, inferProbs, pickAction } from '../src/ensemble/inference.js';
import { buildSignal } from '../src/ensemble/signal.js';
import { DEFAULT_ENSEMBLE } from '../src/ensemble/config.js';
import type { Macro } from '../src/domain/signal.js';
import type { Vote } from '../src/indicators/types.js';

const macroCfg = DEFAULT_ENSEMBLE.macro;

function vote(part: Partial<Vote> & Pick<Vote, 'key' | 'kind' | 'score'>): Vote {
  return {
    label: part.key,
    source: 'internal',
    value: part.score,
    confidence: Math.abs(part.score),
    ts: '2026-07-07T00:00:00Z',
    ...part,
  };
}

function macro(bias: number): Macro {
  return {
    bias,
    funding: 0,
    weekly_trend: bias,
    label: bias > 0.2 ? 'alcista' : bias < -0.2 ? 'bajista' : 'neutral',
    confluence: 'neutral',
    applied: true,
  };
}

describe('computeMacroBias', () => {
  it('funding alto + precio bajo la EMA => sesgo bajista', () => {
    const m = computeMacroBias({ funding: 0.002, price: 90, weeklyEma: 100 }, macroCfg);
    expect(m.bias).toBeLessThan(-0.2);
    expect(m.label).toBe('bajista');
  });
  it('funding negativo + precio sobre la EMA => sesgo alcista', () => {
    const m = computeMacroBias({ funding: -0.001, price: 110, weeklyEma: 100 }, macroCfg);
    expect(m.bias).toBeGreaterThan(0.2);
    expect(m.label).toBe('alcista');
  });
});

describe('inferProbs con modulación macro', () => {
  it('un sesgo alcista desplaza la probabilidad hacia BUY', () => {
    const base = inferProbs(0, 0.5, 0.15);
    const withMacro = inferProbs(0, 0.5, 0.15, { bias: 0.8, wMacro: 1 });
    expect(withMacro.BUY).toBeGreaterThan(base.BUY);
    expect(withMacro.BUY).toBeGreaterThan(withMacro.SELL);
    expect(pickAction(withMacro).action).toBe('BUY');
  });
});

describe('confluence', () => {
  it('mismo signo = aligned, distinto = conflict, cero = neutral', () => {
    expect(confluence(0.5, 0.8)).toBe('aligned');
    expect(confluence(0.5, -0.8)).toBe('conflict');
    expect(confluence(0, 0.8)).toBe('neutral');
  });
});

describe('buildSignal con macro', () => {
  const uptrend: Vote[] = [
    vote({ key: 'ema_cross', kind: 'trend', score: 0.9 }),
    vote({ key: 'macd', kind: 'momentum', score: 0.7 }),
    vote({ key: 'adx14', kind: 'context', score: 0, value: 30 }),
    vote({ key: 'atr14', kind: 'volatility', score: 0, value: 5 }),
  ];

  it('sin macro: BUY => LONG', () => {
    const s = buildSignal({
      symbol: 'BTCUSDT',
      price: 100,
      votes: uptrend,
      config: DEFAULT_ENSEMBLE,
      equity: 10_000,
      interval: '1m',
    });
    expect(s.action).toBe('BUY');
    expect(s.direction).toBe('LONG');
    expect(s.macro).toBeUndefined();
  });

  it('macro alcista alineado: LONG con confluencia', () => {
    const s = buildSignal({
      symbol: 'BTCUSDT',
      price: 100,
      votes: uptrend,
      config: DEFAULT_ENSEMBLE,
      equity: 10_000,
      interval: '1m',
      macro: macro(0.8),
    });
    expect(s.direction).toBe('LONG');
    expect(s.macro?.confluence).toBe('aligned');
  });

  it('escudo: técnico compra pero macro muy bajista => FLAT', () => {
    const s = buildSignal({
      symbol: 'BTCUSDT',
      price: 100,
      votes: uptrend,
      config: DEFAULT_ENSEMBLE,
      equity: 10_000,
      interval: '1m',
      macro: macro(-0.8),
    });
    expect(s.action).toBe('HOLD');
    expect(s.direction).toBe('FLAT');
    expect(s.macro?.confluence).toBe('conflict');
  });
});
