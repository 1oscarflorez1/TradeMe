-- M1: añade la columna `interval` a `candles` (multi-temporalidad).
-- Para bases creadas en M0. En dev con volumen nuevo, 001_init.sql ya la incluye.
ALTER TABLE candles ADD COLUMN IF NOT EXISTS interval TEXT NOT NULL DEFAULT '1m';
ALTER TABLE candles DROP CONSTRAINT IF EXISTS candles_pkey;
ALTER TABLE candles ADD PRIMARY KEY (symbol, interval, ts);
