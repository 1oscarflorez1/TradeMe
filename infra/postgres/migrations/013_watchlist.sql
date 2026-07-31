-- Multi-activo: lista de activos que TradeMe sigue (antes venía fija por variable de entorno).
CREATE TABLE IF NOT EXISTS watchlist (
  symbol     TEXT PRIMARY KEY,
  label      TEXT,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Semilla: el activo con el que nació la plataforma.
INSERT INTO watchlist (symbol, label) VALUES ('BTCUSDT', 'Bitcoin / USDT')
ON CONFLICT (symbol) DO NOTHING;
