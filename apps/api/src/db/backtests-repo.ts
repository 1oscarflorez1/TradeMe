import type pg from 'pg';

export interface BacktestRow {
  id: string;
  created_at: string;
  symbol: string;
  interval: string;
  n_trades: number | null;
  win_rate: number | null;
  expectancy: number | null;
  profit_factor: number | null;
  max_drawdown: number | null;
  sharpe: number | null;
  oos_win_rate: number | null;
  oos_expectancy: number | null;
  metrics: unknown;
  trades: unknown;
  equity_curve: unknown;
}

/** Lee el último backtest guardado por apps/quant. */
export class BacktestsRepo {
  constructor(private readonly pool: pg.Pool) {}

  async latest(symbol: string, interval: string): Promise<BacktestRow | null> {
    const res = await this.pool.query<BacktestRow>(
      `SELECT id, created_at, symbol, interval, n_trades, win_rate, expectancy, profit_factor,
              max_drawdown, sharpe, oos_win_rate, oos_expectancy, metrics, trades, equity_curve
       FROM backtests WHERE symbol = $1 AND interval = $2
       ORDER BY created_at DESC LIMIT 1`,
      [symbol.toUpperCase(), interval],
    );
    return res.rows[0] ?? null;
  }
}
