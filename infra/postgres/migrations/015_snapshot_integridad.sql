-- Integridad de los registros: una decisión por vela, y nada cerrado antes de tiempo.
--
-- Dos fallos detectados en la auditoría del 5 de agosto de 2026:
--
-- 1) La captura automática usaba un enfriamiento fijo de 20 minutos para TODAS las temporalidades.
--    En 4h eso son hasta 12 capturas de la MISMA vela; en 1d, hasta 72. El resultado eran registros
--    redundantes que se contaban como observaciones independientes: si esa decisión acababa en stop,
--    se anotaban 12 stops en vez de uno. Sesgaba las estadísticas y, peor, el dataset del meta-modelo.
--
-- 2) El evaluador cerraba como «timeout» registros que aún no tenían las 20 velas futuras que exige
--    su horizonte. En 1d eso significa cerrar a los pocos días una operación que necesitaba 20.
--    Como el resultado dejaba de ser nulo, no se volvían a mirar nunca.

-- --- Vela a la que pertenece cada registro -------------------------------------------------------
-- Permite quedarse con una decisión por vela sin borrar nada de lo ya guardado.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS candle_open TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION snapshot_interval_secs(iv TEXT) RETURNS BIGINT AS $$
  SELECT CASE iv
    WHEN '1m' THEN 60 WHEN '5m' THEN 300 WHEN '15m' THEN 900 WHEN '30m' THEN 1800
    WHEN '1h' THEN 3600 WHEN '4h' THEN 14400 WHEN '1d' THEN 86400
    WHEN '1w' THEN 604800 WHEN '1M' THEN 2592000 ELSE 60 END;
$$ LANGUAGE SQL IMMUTABLE;

UPDATE snapshots
   SET candle_open = to_timestamp(
         floor(extract(epoch FROM captured_at) / snapshot_interval_secs(interval))
         * snapshot_interval_secs(interval))
 WHERE candle_open IS NULL;

CREATE INDEX IF NOT EXISTS snapshots_candle_idx ON snapshots (symbol, interval, candle_open);

-- --- Reapertura de los cierres prematuros --------------------------------------------------------
-- Solo los «timeout»: un toque de objetivo o de stop es definitivo aunque ocurriera en la primera
-- vela, así que esos NO se tocan. Se reabren únicamente los que se cerraron sin haber tenido las 20
-- velas que su horizonte exige; el piloto los volverá a evaluar cuando el tiempo haya pasado.
UPDATE snapshots
   SET outcome_result = NULL, outcome_return_r = NULL, evaluated_at = NULL
 WHERE outcome_result = 'timeout'
   AND captured_at > now() - (20 * snapshot_interval_secs(interval) * INTERVAL '1 second');
