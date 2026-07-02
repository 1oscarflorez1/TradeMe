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
