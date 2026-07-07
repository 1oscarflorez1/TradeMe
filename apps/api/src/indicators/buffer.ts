import type { Candle, Interval } from '../domain/candle.js';

/** Mantiene las últimas N velas por (symbol, interval) para calcular indicadores. */
export class CandleBuffer {
  private readonly buffers = new Map<string, Candle[]>();

  constructor(private readonly maxSize = 300) {}

  private key(symbol: string, interval: Interval): string {
    return `${symbol}|${interval}`;
  }

  seed(symbol: string, interval: Interval, candles: Candle[]): void {
    this.buffers.set(this.key(symbol, interval), candles.slice(-this.maxSize));
  }

  push(candle: Candle): Candle[] {
    const key = this.key(candle.symbol, candle.interval);
    const buf = this.buffers.get(key) ?? [];
    const last = buf.length > 0 ? buf[buf.length - 1] : undefined;
    // Reemplaza si es la misma vela (aún abierta); si no, añade.
    if (last && last.openTime === candle.openTime) {
      buf[buf.length - 1] = candle;
    } else {
      buf.push(candle);
      if (buf.length > this.maxSize) buf.shift();
    }
    this.buffers.set(key, buf);
    return buf;
  }

  get(symbol: string, interval: Interval): Candle[] {
    return this.buffers.get(this.key(symbol, interval)) ?? [];
  }
}
