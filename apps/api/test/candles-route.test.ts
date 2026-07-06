import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Candle } from '../src/domain/candle.js';

const sample: Candle = {
  symbol: 'BTCUSDT',
  interval: '1m',
  openTime: 0,
  open: 1,
  high: 3,
  low: 0.5,
  close: 2,
  volume: 10,
  closeTime: 59_999,
  closed: true,
};

describe('GET /candles y /symbols', () => {
  it('devuelve el histórico normalizado', async () => {
    const app = buildApp({ getHistory: async () => [sample], symbols: ['BTCUSDT'] });
    const res = await app.inject({
      method: 'GET',
      url: '/candles?symbol=btcusdt&interval=1m&limit=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { symbol: string; candles: Candle[] };
    expect(body.symbol).toBe('BTCUSDT');
    expect(body.candles).toHaveLength(1);
    expect(body.candles[0]?.close).toBe(2);
    await app.close();
  });

  it('rechaza intervalos no soportados con 400', async () => {
    const app = buildApp({ getHistory: async () => [sample], symbols: ['BTCUSDT'] });
    const res = await app.inject({ method: 'GET', url: '/candles?symbol=BTCUSDT&interval=5m' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('/symbols lista símbolos e intervalos', async () => {
    const app = buildApp({ getHistory: async () => [], symbols: ['BTCUSDT'] });
    const res = await app.inject({ method: 'GET', url: '/symbols' });
    const body = res.json() as { symbols: string[]; intervals: string[] };
    expect(body.symbols).toContain('BTCUSDT');
    expect(body.intervals).toContain('1h');
    await app.close();
  });
});
