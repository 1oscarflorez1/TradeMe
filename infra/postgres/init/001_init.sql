-- TradeMe — inicialización mínima (M0). Esquema real de migraciones llega en M1/M6.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Velas OHLCV normalizadas (leídas por api y quant).
CREATE TABLE IF NOT EXISTS candles (
  symbol      TEXT        NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  open        DOUBLE PRECISION NOT NULL,
  high        DOUBLE PRECISION NOT NULL,
  low         DOUBLE PRECISION NOT NULL,
  close       DOUBLE PRECISION NOT NULL,
  volume      DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (symbol, ts)
);

-- Señales emitidas (apoyo a la decisión). Detalle del payload en signal.schema.json.
CREATE TABLE IF NOT EXISTS signals (
  symbol      TEXT        NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  action      TEXT        NOT NULL CHECK (action IN ('BUY', 'HOLD', 'SELL')),
  confidence  DOUBLE PRECISION NOT NULL,
  payload     JSONB       NOT NULL,
  PRIMARY KEY (symbol, ts)
);

SELECT create_hypertable('candles', 'ts', if_not_exists => TRUE);
SELECT create_hypertable('signals', 'ts', if_not_exists => TRUE);
