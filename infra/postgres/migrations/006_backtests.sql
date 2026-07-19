-- M6: tabla de resultados de backtest.

-- Resultados de backtest (M6). Los escribe apps/quant; los sirve apps/api.
CREATE TABLE IF NOT EXISTS backtests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  symbol         TEXT NOT NULL,
  interval       TEXT NOT NULL,
  n_trades       INTEGER,
  win_rate       DOUBLE PRECISION,
  expectancy     DOUBLE PRECISION,
  profit_factor  DOUBLE PRECISION,
  max_drawdown   DOUBLE PRECISION,
  sharpe         DOUBLE PRECISION,
  oos_win_rate   DOUBLE PRECISION,
  oos_expectancy DOUBLE PRECISION,
  metrics        JSONB,
  trades         JSONB,
  equity_curve   JSONB
);
CREATE INDEX IF NOT EXISTS backtests_symbol_created_idx ON backtests (symbol, interval, created_at DESC);
