-- ============================================================================================
-- Salud de la operativa en 1d — TradeMe
--
-- Solo lectura: nada de este fichero escribe. Uso, desde PowerShell en la carpeta del repositorio:
--
--   Get-Content infra\salud-1d.sql | docker exec -i trademe-prod-postgres-1 psql -U trademe -d trademe
--
-- Cada bloque devuelve una columna `estado`. Qué significa cada uno, cuándo mirarlo y qué hacer si
-- sale ATENCION está en docs/salud-1d.md.
-- ============================================================================================

\echo
\echo '== 1. Frescura de velas 1d: la ultima guardada debe ser la de ayer (UTC) =='
-- Una vela 1d con ts = D cierra a las 00:00 UTC de D+1. Desde 0.71.0 el piloto rellena tambien la
-- cola de la serie, asi que un ATENCION que dura mas de un ciclo (15 min) ya no es una caida del
-- stack: es que el relleno no esta corriendo. En los primeros minutos tras las 00:00 UTC es normal.
SELECT symbol,
       MAX(ts)::date                                        AS ultima_vela,
       (date_trunc('day', now()) - interval '1 day')::date  AS esperada,
       CASE WHEN MAX(ts) >= date_trunc('day', now()) - interval '1 day'
            THEN 'OK'
            ELSE 'ATENCION: faltan ' || ((date_trunc('day', now()) - interval '1 day')::date - MAX(ts)::date)
                 || ' cierre(s) al final de la serie'
       END AS estado
  FROM candles
 WHERE interval = '1d' AND symbol IN ('ETHUSDT', 'SOLUSDT')
 GROUP BY symbol ORDER BY symbol;

\echo
\echo '== 2. Huecos interiores de 1d en los ultimos 60 dias =='
WITH v AS (
  SELECT symbol, ts, LAG(ts) OVER (PARTITION BY symbol ORDER BY ts) AS prev
    FROM candles
   WHERE interval = '1d' AND symbol IN ('ETHUSDT', 'SOLUSDT') AND ts >= now() - interval '60 days'
)
SELECT symbol,
       COUNT(*) FILTER (WHERE prev IS NOT NULL AND ts - prev > interval '1 day') AS huecos,
       CASE WHEN COUNT(*) FILTER (WHERE prev IS NOT NULL AND ts - prev > interval '1 day') = 0
            THEN 'OK' ELSE 'ATENCION: el relleno aun no los ha reparado' END AS estado
  FROM v GROUP BY symbol ORDER BY symbol;

\echo
\echo '== 3. Estaba la api corriendo a las 00:00 UTC de cada dia? (ultimos 7 dias) =='
-- Los snapshots no se rellenan a posteriori: si no hay ninguno en la hora 00, el stack estaba parado
-- en el cierre. Desde 0.71.0 la vela se recupera igual, pero la decision de ese cierre no se toma.
WITH dias AS (
  SELECT generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()),
                         interval '1 day') AS d
)
SELECT to_char(d, 'YYYY-MM-DD') AS cierre_utc,
       (SELECT COUNT(*) FROM snapshots s
         WHERE s.captured_at >= d AND s.captured_at < d + interval '1 hour') AS snapshots_hora_00,
       CASE WHEN (SELECT COUNT(*) FROM snapshots s
                   WHERE s.captured_at >= d AND s.captured_at < d + interval '1 hour') > 0
            THEN 'OK' ELSE 'ATENCION: stack parado en el cierre' END AS estado
  FROM dias ORDER BY d;

\echo
\echo '== 4. Ultima decision de cada clave: solo ETHUSDT:1d y SOLUSDT:1d pueden operar =='
-- Mira la ULTIMA decision registrada por clave, no una ventana de tiempo. Asi no depende de cuando se
-- desplego: una ventana de 24 h tras un despliegue mezcla decisiones de antes y de despues y da falsos
-- ATENCION (paso el 12-sep-2026 con 0.70.0, y la lista blanca estaba funcionando).
-- Operable = direccion LONG/SHORT con plan. Una clave vetada queda en FLAT, sin plan y con sombra.
WITH ultima AS (
  SELECT DISTINCT ON (symbol, interval) symbol, interval, captured_at, direction, plan_entry,
         shadow_direction
    FROM snapshots
   WHERE captured_at > now() - interval '48 hours'
   ORDER BY symbol, interval, captured_at DESC
)
SELECT symbol || ':' || interval                                    AS clave,
       ROUND(EXTRACT(EPOCH FROM (now() - captured_at)) / 60.0)      AS hace_min,
       direction,
       (plan_entry IS NOT NULL)                                     AS con_plan,
       CASE
         WHEN symbol || ':' || interval IN ('ETHUSDT:1d', 'SOLUSDT:1d')
           THEN CASE WHEN direction IN ('LONG', 'SHORT') AND plan_entry IS NOT NULL
                     THEN 'OK: opera' ELSE 'OK: sin senal ahora' END
         WHEN direction IN ('LONG', 'SHORT') AND plan_entry IS NOT NULL
           THEN 'ATENCION: clave fuera de la lista blanca emitiendo'
         ELSE 'OK: vetada'
       END AS estado
  FROM ultima ORDER BY 1;

\echo
\echo '== 5. Evaluacion de las decisiones de 1d =='
-- Horizonte de 1d = 10 velas. Una decision con plan y mas de 11 dias sin desenlace esta atascada,
-- casi siempre porque le faltan velas dentro de su ventana.
SELECT symbol,
       COUNT(*) FILTER (WHERE outcome_result IS NOT NULL) AS evaluadas,
       COUNT(*) FILTER (WHERE outcome_result IS NULL AND direction IN ('LONG','SHORT') AND plan_entry IS NOT NULL
                          AND captured_at > now() - interval '11 days')               AS abiertas_en_plazo,
       COUNT(*) FILTER (WHERE outcome_result IS NULL AND direction IN ('LONG','SHORT') AND plan_entry IS NOT NULL
                          AND captured_at <= now() - interval '11 days')              AS atascadas,
       CASE WHEN COUNT(*) FILTER (WHERE outcome_result IS NULL AND direction IN ('LONG','SHORT')
                                    AND plan_entry IS NOT NULL AND captured_at <= now() - interval '11 days') = 0
            THEN 'OK' ELSE 'ATENCION: desenlaces atascados' END AS estado
  FROM snapshots WHERE interval = '1d' AND symbol IN ('ETHUSDT', 'SOLUSDT')
 GROUP BY symbol ORDER BY symbol;

\echo
\echo '== 6. Expectancy bruta frente a neta (lo que desde 0.70.0 muestra el panel) =='
-- Misma formula que costes.ts / costes.py: coste_R = (0,12/100) * |entry| / |entry - stop|.
-- Muestras pequenas: comprueba que el descuento actua, no mide rendimiento.
WITH una_por_vela AS (
  SELECT DISTINCT ON (symbol, interval, candle_open) *
    FROM snapshots WHERE interval = '1d' AND symbol IN ('ETHUSDT', 'SOLUSDT')
   ORDER BY symbol, interval, candle_open, captured_at ASC
)
SELECT symbol,
       COUNT(*) FILTER (WHERE outcome_result IS NOT NULL) AS n,
       ROUND(AVG(outcome_return_r) FILTER (WHERE outcome_result IS NOT NULL)::numeric, 4) AS bruta,
       ROUND(AVG(outcome_return_r - CASE WHEN plan_entry IS NOT NULL AND plan_stop IS NOT NULL
                                          AND plan_entry <> plan_stop
                                         THEN (0.12 / 100.0) * abs(plan_entry) / abs(plan_entry - plan_stop)
                                         ELSE 0 END)
             FILTER (WHERE outcome_result IS NOT NULL)::numeric, 4) AS neta
  FROM una_por_vela GROUP BY symbol ORDER BY symbol;
