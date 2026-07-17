import { describe, it, expect } from 'vitest';
import {
  normalizeBinanceKline,
  normalizeRestKline,
  type BinanceKlineEvent,
  type BinanceRestKline,
} from '../src/domain/candle.js';

describe('normalización de velas', () => {
  it('normaliza un kline de WebSocket', () => {
    const evt: BinanceKlineEvent = {
      e: 'kline',
      E: 123,
      s: 'BTCUSDT',
      k: {
        t: 1000,
        T: 60_999,
        s: 'BTCUSDT',
        i: '1m',
        o: '100.5',
        c: '101.0',
        h: '102.0',
        l: '99.5',
        v: '12.5',
        x: true,
      },
    };
    const candle = normalizeBinanceKline(evt);
    expect(candle).toEqual({
      symbol: 'BTCUSDT',
      interval: '1m',
      openTime: 1000,
      open: 100.5,
      high: 102.0,
      low: 99.5,
      close: 101.0,
      volume: 12.5,
      closeTime: 60_999,
      closed: true,
    });
  });

  it('normaliza un kline REST (array) como vela cerrada', () => {
    const row: BinanceRestKline = [
      0,
      '10',
      '12',
      '9',
      '11',
      '100',
      3_599_999,
      '0',
      50,
      '0',
      '0',
      '0',
    ];
    const candle = normalizeRestKline('btcusdt', '1h', row);
    expect(candle.symbol).toBe('btcusdt');
    expect(candle.interval).toBe('1h');
    expect(candle.close).toBe(11);
    expect(candle.closed).toBe(true);
  });
});
