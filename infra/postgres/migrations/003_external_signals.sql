-- M5: tabla de alertas externas (TradingView / Reditum) para el backtest (M6).
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
