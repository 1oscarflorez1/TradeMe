import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps, synthCandles } from './helpers.js';
import type { Signal } from '../src/domain/signal.js';

describe('GET /signal', () => {
  it('devuelve una señal completa con probabilidades coherentes', async () => {
    const app = buildApp(makeDeps({ getHistory: async () => synthCandles(80) }));
    const res = await app.inject({ method: 'GET', url: '/signal?symbol=BTCUSDT&interval=1m' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { signal: Signal };
    const s = body.signal;
    expect(s.symbol).toBe('BTCUSDT');
    expect(s.probs.BUY + s.probs.HOLD + s.probs.SELL).toBeCloseTo(1, 5);
    expect(['BUY', 'HOLD', 'SELL']).toContain(s.action);
    expect(s.regime.label).toMatch(/tendencia|rango/);
    await app.close();
  });

  it('la señal externa NT8 entra en la agregación con su peso', async () => {
    const app = buildApp(makeDeps({ getHistory: async () => synthCandles(80) }));
    await app.inject({
      method: 'POST',
      url: '/signals/ninjatrader',
      payload: { indicator: 'sniper_ultra', symbol: 'BTCUSDT', signal: 'long' },
    });
    const res = await app.inject({ method: 'GET', url: '/signal?symbol=BTCUSDT&interval=1m' });
    const s = (res.json() as { signal: Signal }).signal;
    const nt8 = s.votes.find((v) => v.key === 'sniper_ultra');
    expect(nt8).toBeDefined();
    expect(nt8?.source).toBe('ninjatrader');
    expect(nt8?.weight).toBe(2);
    await app.close();
  });
});
