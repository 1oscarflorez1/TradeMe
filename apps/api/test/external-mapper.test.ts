import { describe, it, expect } from 'vitest';
import { testMapper } from './helpers.js';
import { ExternalSignalStore } from '../src/signals/external-store.js';

describe('ExternalMapper (TradingView / Reditum)', () => {
  const mapper = testMapper();

  it('mapea señales discretas long/short a +1/-1', () => {
    const long = mapper.map('tradingview', {
      indicator: 'reditum_sniper',
      symbol: 'BTCUSDT',
      signal: 'long',
    });
    const short = mapper.map('tradingview', {
      indicator: 'reditum_sniper',
      symbol: 'BTCUSDT',
      signal: 'short',
    });
    expect(long?.score).toBe(1);
    expect(long?.source).toBe('tradingview');
    expect(long?.ttlMs).toBe(300_000);
    expect(short?.score).toBe(-1);
  });

  it('devuelve null para indicadores/señales sin mapeo', () => {
    expect(
      mapper.map('tradingview', { indicator: 'desconocido', symbol: 'BTCUSDT', signal: 'long' }),
    ).toBeNull();
    expect(
      mapper.map('tradingview', { indicator: 'reditum_sniper', symbol: 'BTCUSDT', signal: 'raro' }),
    ).toBeNull();
  });
});

describe('ExternalSignalStore (TTL)', () => {
  it('expira las señales pasado su ttl', () => {
    const store = new ExternalSignalStore();
    const vote = testMapper().map('tradingview', {
      indicator: 'reditum_sniper',
      symbol: 'BTCUSDT',
      signal: 'long',
    })!;
    store.put('BTCUSDT', vote, 1_000);
    expect(store.active('BTCUSDT', 1_500)).toHaveLength(1);
    expect(store.active('BTCUSDT', 1_000 + 300_000 + 1)).toHaveLength(0);
  });
});
