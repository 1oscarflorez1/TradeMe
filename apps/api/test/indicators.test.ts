import { describe, it, expect } from 'vitest';
import { IndicatorRegistry } from '../src/indicators/registry.js';
import { rsi14, adx14 } from '../src/indicators/builtin.js';
import { synthCandles } from './helpers.js';

describe('indicadores internos', () => {
  it('calcula votos con score en [-1,1] y confianza en [0,1]', () => {
    const registry = new IndicatorRegistry();
    const votes = registry.computeVotes(synthCandles(80));
    expect(votes.length).toBeGreaterThanOrEqual(5);
    for (const v of votes) {
      expect(v.score).toBeGreaterThanOrEqual(-1);
      expect(v.score).toBeLessThanOrEqual(1);
      expect(v.confidence).toBeGreaterThanOrEqual(0);
      expect(v.confidence).toBeLessThanOrEqual(1);
      expect(v.source).toBe('internal');
    }
  });

  it('ADX es contexto: no vota dirección (score 0) y trae régimen', () => {
    const reading = adx14.compute(synthCandles(80));
    expect(reading).not.toBeNull();
    expect(reading?.score).toBe(0);
    expect(reading?.meta).toHaveProperty('regime');
  });

  it('RSI mapea sobreventa a score positivo', () => {
    // Serie bajista fuerte -> RSI bajo -> sesgo comprador (score > 0)
    const candles = synthCandles(60).map((c, i) => ({
      ...c,
      open: 200 - i,
      high: 200 - i + 0.5,
      low: 200 - i - 1,
      close: 200 - i - 0.8,
    }));
    const reading = rsi14.compute(candles);
    expect(reading).not.toBeNull();
    expect(reading?.value).toBeLessThan(40);
    expect(reading?.score ?? 0).toBeGreaterThan(0);
  });

  it('devuelve null si no hay suficientes velas', () => {
    expect(adx14.compute(synthCandles(5))).toBeNull();
  });
});
