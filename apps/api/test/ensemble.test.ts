import { describe, it, expect } from 'vitest';
import { aggregate } from '../src/ensemble/aggregate.js';
import { inferProbs, pickAction } from '../src/ensemble/inference.js';
import { buildSignal } from '../src/ensemble/signal.js';
import { DEFAULT_ENSEMBLE } from '../src/ensemble/config.js';
import type { Vote } from '../src/indicators/types.js';

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

describe('inferProbs (softmax)', () => {
  it('net 0 favorece HOLD y las probabilidades suman ~1', () => {
    const p = inferProbs(0, 0.5, 0.15);
    expect(p.BUY + p.HOLD + p.SELL).toBeCloseTo(1, 6);
    expect(p.HOLD).toBeGreaterThan(p.BUY);
    expect(p.HOLD).toBeGreaterThan(p.SELL);
    expect(p.BUY).toBeCloseTo(p.SELL, 6);
  });

  it('net positivo favorece BUY; negativo favorece SELL', () => {
    expect(pickAction(inferProbs(0.7, 0.5, 0.15)).action).toBe('BUY');
    expect(pickAction(inferProbs(-0.7, 0.5, 0.15)).action).toBe('SELL');
  });
});

describe('aggregate (régimen + pesos)', () => {
  it('pondera por régimen y da a Reditum el doble de peso', () => {
    const votes: Vote[] = [
      vote({ key: 'ema_cross', kind: 'trend', score: 0.8 }),
      vote({ key: 'rsi14', kind: 'reversion', score: -0.5 }),
      vote({ key: 'adx14', kind: 'context', score: 0, value: 30 }),
      vote({ key: 'atr14', kind: 'volatility', score: 0, value: 12 }),
      vote({ key: 'reditum_sniper', kind: 'custom', score: 1, source: 'tradingview' }),
    ];
    const agg = aggregate(votes, DEFAULT_ENSEMBLE);
    expect(agg.regime.label).toBe('tendencia'); // ADX 30 >= 25
    // ADX/ATR no votan
    expect(agg.votes.find((v) => v.key === 'adx14')?.weight).toBe(0);
    // Reditum/TradingView: peso 2 (externalWeights) * 1 (custom sin ajuste de régimen)
    expect(agg.votes.find((v) => v.key === 'reditum_sniper')?.weight).toBe(2);
    // ADX continuo (adx_lo 15, adx_hi 35): con ADX 30 => f = 0.75
    // EMA (trend): 0.6*(1-0.75) + 1.5*0.75 = 1.275 ; RSI (reversion): 1.5*0.25 + 0.6*0.75 = 0.825
    expect(agg.votes.find((v) => v.key === 'ema_cross')?.weight).toBeCloseTo(1.275, 6);
    expect(agg.votes.find((v) => v.key === 'rsi14')?.weight).toBeCloseTo(0.825, 6);
    const expected = (0.8 * 1.275 + -0.5 * 0.825 + 1 * 2) / (1.275 + 0.825 + 2);
    expect(agg.net).toBeCloseTo(expected, 6);
  });

  it('ADX < 25 marca régimen de rango', () => {
    const agg = aggregate(
      [vote({ key: 'adx14', kind: 'context', score: 0, value: 10 })],
      DEFAULT_ENSEMBLE,
    );
    expect(agg.regime.label).toBe('rango');
  });
});

describe('buildSignal', () => {
  it('produce un Signal coherente (probs suman ~1, acción según net)', () => {
    const votes: Vote[] = [
      vote({ key: 'ema_cross', kind: 'trend', score: 0.9 }),
      vote({ key: 'macd', kind: 'momentum', score: 0.6 }),
      vote({ key: 'adx14', kind: 'context', score: 0, value: 30 }),
      vote({ key: 'atr14', kind: 'volatility', score: 0, value: 5 }),
    ];
    const signal = buildSignal({
      symbol: 'BTCUSDT',
      price: 64000,
      votes,
      config: DEFAULT_ENSEMBLE,
      equity: 10_000,
      interval: '1m',
    });
    expect(signal.probs.BUY + signal.probs.HOLD + signal.probs.SELL).toBeCloseTo(1, 6);
    expect(signal.net).toBeGreaterThan(0);
    expect(signal.action).toBe('BUY');
    expect(signal.atr).toBe(5);
    expect(signal.model_version).toBe(DEFAULT_ENSEMBLE.version);
    expect(signal.confidence).toBe(signal.probs.BUY);
  });
});
