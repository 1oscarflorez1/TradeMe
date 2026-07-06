import type pg from 'pg';
import type { Candle } from '../domain/candle.js';

/** Acceso a la tabla `candles` (TimescaleDB). */
export class CandlesRepo {
  constructor(private readonly pool: pg.Pool) {}

  async upsert(candle: Candle): Promise<void> {
    await this.pool.query(
      `INSERT INTO candles (symbol, interval, ts, open, high, low, close, volume)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7, $8)
       ON CONFLICT (symbol, interval, ts) DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         volume = EXCLUDED.volume`,
      [
        candle.symbol,
        candle.interval,
        candle.openTime,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
      ],
    );
  }

  async count(symbol: string, interval: string): Promise<number> {
    const res = await this.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM candles WHERE symbol = $1 AND interval = $2',
      [symbol, interval],
    );
    return Number(res.rows[0]?.n ?? 0);
  }
}
