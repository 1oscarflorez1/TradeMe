-- TradeMe — inicialización (M1). Esquema de velas multi-temporalidad y señales.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Velas OHLCV normalizadas por (símbolo, intervalo). Leídas por api y quant.
CREATE TABLE IF NOT EXISTS candles (
  symbol      TEXT             NOT NULL,
  interval    TEXT             NOT NULL,
  ts          TIMESTAMPTZ      NOT NULL,
  open        DOUBLE PRECISION NOT NULL,
  high        DOUBLE PRECISION NOT NULL,
  low         DOUBLE PRECISION NOT NULL,
  close       DOUBLE PRECISION NOT NULL,
  volume      DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (symbol, interval, ts)
);

-- Señales emitidas (apoyo a la decisión). Payload completo en signal.schema.json.
CREATE TABLE IF NOT EXISTS signals (
  symbol      TEXT             NOT NULL,
  ts          TIMESTAMPTZ      NOT NULL,
  action      TEXT             NOT NULL CHECK (action IN ('BUY', 'HOLD', 'SELL')),
  confidence  DOUBLE PRECISION NOT NULL,
  payload     JSONB            NOT NULL,
  PRIMARY KEY (symbol, ts)
);

SELECT create_hypertable('candles', 'ts', if_not_exists => TRUE);
SELECT create_hypertable('signals', 'ts', if_not_exists => TRUE);

-- Alertas externas (TradingView / Reditum) registradas para el backtest (M6).
CREATE TABLE IF NOT EXISTS external_signals (
  received_at TIMESTAMPTZ      NOT NULL DEFAULT now(),
  ts          TIMESTAMPTZ      NOT NULL,
  source      TEXT             NOT NULL,
  strategy    TEXT             NOT NULL,
  symbol      TEXT             NOT NULL,
  signal      TEXT,
  tf          TEXT,
  score       DOUBLE PRECISION NOT NULL,
  payload     JSONB            NOT NULL
);
SELECT create_hypertable('external_signals', 'received_at', if_not_exists => TRUE);

-- Instantáneas del escenario (para análisis estadístico y entrenamiento de IA).
CREATE TABLE IF NOT EXISTS snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  symbol           TEXT NOT NULL,
  interval         TEXT NOT NULL,
  price            DOUBLE PRECISION NOT NULL,
  atr              DOUBLE PRECISION,
  adx              DOUBLE PRECISION,
  regime_label     TEXT,
  net              DOUBLE PRECISION,
  prob_buy         DOUBLE PRECISION,
  prob_hold        DOUBLE PRECISION,
  prob_sell        DOUBLE PRECISION,
  action           TEXT,
  direction        TEXT,
  confidence       DOUBLE PRECISION,
  macro_bias       DOUBLE PRECISION,
  funding_rate     DOUBLE PRECISION,
  weekly_trend     DOUBLE PRECISION,
  macro_label      TEXT,
  confluence       TEXT,
  ema_cross_score  DOUBLE PRECISION,
  macd_score       DOUBLE PRECISION,
  rsi14_score      DOUBLE PRECISION,
  rsi14_value      DOUBLE PRECISION,
  bbands_score     DOUBLE PRECISION,
  stoch14_score    DOUBLE PRECISION,
  adx14_value      DOUBLE PRECISION,
  atr14_value      DOUBLE PRECISION,
  reditum_sniper_score DOUBLE PRECISION,
  reditum_poc_score    DOUBLE PRECISION,
  plan_entry       DOUBLE PRECISION,
  plan_stop        DOUBLE PRECISION,
  plan_take_profit DOUBLE PRECISION,
  plan_size        DOUBLE PRECISION,
  plan_rr          DOUBLE PRECISION,
  valid_until      TIMESTAMPTZ,
  outcome_result   TEXT,
  outcome_return_r DOUBLE PRECISION,
  outcome_mfe      DOUBLE PRECISION,
  outcome_mae      DOUBLE PRECISION,
  evaluated_at     TIMESTAMPTZ,
  model_version    TEXT,
  source           TEXT DEFAULT 'manual',
  note             TEXT,
  raw_signal       JSONB NOT NULL
);

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

-- M8: historial de alertas/notificaciones.
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  symbol      TEXT,
  interval    TEXT,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  message     TEXT,
  meta        JSONB,
  read        BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS alerts_created_idx ON alerts (created_at DESC);

-- M9: suscripciones Web Push.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  sub         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
