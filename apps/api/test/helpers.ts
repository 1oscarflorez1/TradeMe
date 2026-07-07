import type { AppDeps } from '../src/app.js';
import type { Candle, Interval } from '../src/domain/candle.js';
import { IndicatorRegistry } from '../src/indicators/registry.js';
import { ExternalSignalStore } from '../src/signals/external-store.js';
import { ExternalMapper } from '../src/signals/external-mapper.js';

export function testMapper(): ExternalMapper {
  return new ExternalMapper({
    ninjatrader: {
      sniper_ultra: {
        kind: 'custom',
        ttl_ms: 120_000,
        map: {
          long: { score: 1, confidence: 0.8 },
          short: { score: -1, confidence: 0.8 },
          flat: { score: 0, confidence: 0.3 },
        },
      },
    },
  });
}

export function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    getHistory: async () => [],
    symbols: ['BTCUSDT'],
    registry: new IndicatorRegistry(),
    externalStore: new ExternalSignalStore(),
    mapper: testMapper(),
    ...overrides,
  };
}

/** Serie sintética con tendencia alcista para ejercitar los indicadores. */
export function synthCandles(n: number, symbol = 'BTCUSDT', interval: Interval = '1m'): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price += Math.sin(i / 5) * 0.5 + 0.6;
    const open = price;
    const close = price + 0.3;
    const high = close + 0.5;
    const low = open - 0.5;
    candles.push({
      symbol,
      interval,
      openTime: i * 60_000,
      open,
      high,
      low,
      close,
      volume: 10,
      closeTime: i * 60_000 + 59_999,
      closed: true,
    });
  }
  return candles;
}
