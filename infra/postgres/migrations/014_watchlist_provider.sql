-- Multi-proveedor: cada activo recuerda de qué fuente salen sus velas.
-- Los activos que ya existían son de Binance, de ahí el valor por defecto.
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'binance';
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS asset_class TEXT NOT NULL DEFAULT 'cripto';
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS tv_symbol TEXT;
UPDATE watchlist SET tv_symbol = 'BINANCE:' || symbol WHERE tv_symbol IS NULL AND provider = 'binance';
CREATE INDEX IF NOT EXISTS watchlist_provider_idx ON watchlist (provider);
