import type { Interval } from './types';

const TV_SYMBOLS: Record<string, string> = {
  BTCUSDT: 'BINANCE:BTCUSDT',
};

/** Mapea nuestro símbolo al formato del widget de TradingView. */
export function tvSymbol(symbol: string): string {
  return TV_SYMBOLS[symbol] ?? `BINANCE:${symbol}`;
}

const TV_INTERVAL: Record<Interval, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

export function tvInterval(interval: Interval): string {
  return TV_INTERVAL[interval] ?? '60';
}
