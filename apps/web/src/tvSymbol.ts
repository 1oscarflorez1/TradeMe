import type { Interval } from './types';

const TV_SYMBOLS: Record<string, string> = {
  BTCUSDT: 'BINANCE:BTCUSDT',
};

/**
 * Equivalencias que llegan de la API: cada activo guarda su símbolo de TradingView según el
 * proveedor del que salen sus velas (BINANCE:BTCUSDT, NASDAQ:AAPL, FX:EURUSD…).
 */
const overrides: Record<string, string> = {};

export function setTvSymbols(pares: Array<{ symbol: string; tvSymbol: string | null }>): void {
  for (const p of pares) if (p.tvSymbol) overrides[p.symbol.toUpperCase()] = p.tvSymbol;
}

/** Mapea nuestro símbolo al formato del widget de TradingView. */
export function tvSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  // Los símbolos con guion vienen de proveedores que usan barra (EUR-USD → EURUSD en el widget).
  return overrides[s] ?? TV_SYMBOLS[s] ?? `BINANCE:${s.replace(/-/g, '')}`;
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
