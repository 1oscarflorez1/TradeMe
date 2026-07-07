import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';
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

describe('rutas de mercado', () => {
  it('GET /candles devuelve el histórico', async () => {
    const app = buildApp(makeDeps({ getHistory: async () => [sample] }));
    const res = await app.inject({
      method: 'GET',
      url: '/candles?symbol=btcusdt&interval=1m&limit=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { symbol: string; candles: Candle[] };
    expect(body.symbol).toBe('BTCUSDT');
    expect(body.candles).toHaveLength(1);
    await app.close();
  });

  it('GET /candles rechaza intervalos no soportados', async () => {
    const app = buildApp(makeDeps({ getHistory: async () => [sample] }));
    const res = await app.inject({ method: 'GET', url: '/candles?symbol=BTCUSDT&interval=5m' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /symbols e /indicators listan catálogo', async () => {
    const app = buildApp(makeDeps());
    const symbols = (await app.inject({ method: 'GET', url: '/symbols' })).json() as {
      symbols: string[];
      intervals: string[];
    };
    expect(symbols.symbols).toContain('BTCUSDT');
    expect(symbols.intervals).toContain('1h');

    const indicators = (await app.inject({ method: 'GET', url: '/indicators' })).json() as {
      indicators: Array<{ key: string }>;
    };
    const keys = indicators.indicators.map((i) => i.key);
    expect(keys).toContain('rsi14');
    expect(keys).toContain('adx14');
    await app.close();
  });
});
