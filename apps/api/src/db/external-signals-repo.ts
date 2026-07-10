import type pg from 'pg';
import type { ExternalRecord } from '../app.js';

/** Persiste las alertas externas (TradingView) para el backtest (M6). */
export class ExternalSignalsRepo {
  constructor(private readonly pool: pg.Pool) {}

  async record(rec: ExternalRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO external_signals (ts, source, strategy, symbol, signal, tf, score, payload)
       VALUES ($1, 'tradingview', $2, $3, $4, $5, $6, $7)`,
      [
        rec.ts,
        rec.strategy,
        rec.symbol,
        rec.signal ?? null,
        rec.tf ?? null,
        rec.score,
        JSON.stringify(rec.payload),
      ],
    );
  }
}
