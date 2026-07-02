import type { Candle, Interval } from '../domain/candle.js';

export type CandleListener = (candle: Candle) => void;

export interface Subscription {
  symbol: string;
  interval: Interval;
}

export interface AdapterLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/** Fuente de datos de mercado. Cada proveedor implementa esta interfaz. */
export interface DataAdapter {
  readonly name: string;
  start(subscriptions: Subscription[], onCandle: CandleListener): Promise<void>;
  getHistory(symbol: string, interval: Interval, limit: number): Promise<Candle[]>;
  stop(): Promise<void>;
}
