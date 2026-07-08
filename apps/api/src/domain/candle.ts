import { z } from 'zod';

export const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
export type Interval = (typeof INTERVALS)[number];

export function isInterval(value: string): value is Interval {
  return (INTERVALS as readonly string[]).includes(value);
}

/** Vela OHLCV normalizada (esquema común a todos los proveedores). */
export const CandleSchema = z.object({
  symbol: z.string().min(1),
  interval: z.enum(INTERVALS),
  openTime: z.number().int().nonnegative(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
  closeTime: z.number().int().nonnegative(),
  closed: z.boolean(),
});
export type Candle = z.infer<typeof CandleSchema>;

/** Mensaje kline de Binance (payload `.data` del combined stream). */
export interface BinanceKlineEvent {
  e: string;
  E: number;
  s: string;
  k: {
    t: number;
    T: number;
    s: string;
    i: string;
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    x: boolean;
  };
}

export function normalizeBinanceKline(evt: BinanceKlineEvent): Candle {
  const k = evt.k;
  return CandleSchema.parse({
    symbol: k.s,
    interval: k.i,
    openTime: k.t,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    closeTime: k.T,
    closed: k.x,
  });
}

/** Kline REST de Binance: [openTime, open, high, low, close, volume, closeTime, ...]. */
export type BinanceRestKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  ...unknown[],
];

export function normalizeRestKline(
  symbol: string,
  interval: Interval,
  row: BinanceRestKline,
): Candle {
  return CandleSchema.parse({
    symbol,
    interval,
    openTime: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: row[6],
    closed: true,
  });
}
