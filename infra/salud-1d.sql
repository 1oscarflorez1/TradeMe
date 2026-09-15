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
\echo '== 5. Evaluacion de las decisiones de 1d (contadas por vela, no por captura) =='
-- Cada vela de 1d genera VARIAS capturas a lo largo del dia. Contar filas inflaba las cifras unas
-- tres veces (el 12-sep-2026: 16 filas evaluadas de ETH eran 6 velas). Aqui se toma la PRIMERA
-- captura de cada vela, igual que el check 6 y que el panel.
--
-- Atascada = mas de 12 dias sin desenlace: 10 de horizonte, 1 para que cierre la ultima vela de la
-- ventana (abre justo en el limite) y 1 de holgura para el ciclo del piloto.
WITH una_por_vela AS (
  SELECT DISTINCT ON (symbol, interval, candle_open) *
    FROM snapshots WHERE interval = '1d' AND symbol IN ('ETHUSDT', 'SOLUSDT')
   ORDER BY symbol, interval, candle_open, captured_at ASC
)
SELECT symbol,
       COUNT(*) FILTER (WHERE outcome_result IS NOT NULL) AS velas_evaluadas,
       COUNT(*) FILTER (WHERE outcome_result IS NULL AND direction IN ('LONG','SHORT') AND plan_entry IS NOT NULL
                          AND captured_at > now() - interval '12 days')               AS abiertas_en_plazo,
       COUNT(*) FILTER (WHERE outcome_result IS NULL AND direction IN ('LONG','SHORT') AND plan_entry IS NOT NULL
                          AND captured_at <= now() - interval '12 days')              AS atascadas,
       CASE WHEN COUNT(*) FILTER (WHERE outcome_result IS NULL AND direction IN ('LONG','SHORT')
                                    AND plan_entry IS NOT NULL AND captured_at <= now() - interval '12 days') = 0
            THEN 'OK' ELSE 'ATENCION: desenlaces atascados' END AS estado
  FROM una_por_vela
 GROUP BY symbol ORDER BY symbol;

\echo
\echo '== 6. Expectancy bruta frente a neta (lo que desde 0.70.0 muestra el panel) =='
-- Misma formula que costes.ts / costes.py: coste_R = (0,12/100) * |entry| / |entry - stop|.
-- Muestras pequenas: comprueba que el descuento actua, no mide rendimiento. Y mezcla sistemas: las
-- evaluadas hasta el 8-sep-2026 se decidieron con las configuraciones optimizadas. El check 7 no.
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

\echo
\echo '== 7. Tamano muestral: cuanto falta para saber si la expectancy neta es mayor que cero =='
-- Informativo: no mide la salud del stack sino cuanto se puede afirmar ya. Es la regla de
-- trademe_quant/tamano_muestral.py (el piloto la registra en cada ciclo como `muestra:` y el
-- Laboratorio la muestra), con los MISMOS literales: un test falla si se separan. Fijada el
-- 15-sep-2026. Que significa cada columna, en docs/salud-1d.md.
--
-- - Solo decisiones de la configuracion BASE: las `ens-opt-*` eran otro sistema (hasta el 8-sep).
-- - Independientes: una decision de 1d se evalua durante 10 velas y la del dia siguiente comparte
--   casi todo el recorrido. Se cuentan de forma voraz: la siguiente que abre 240 h despues.
-- - sigma: la propia desde 30 evaluadas; antes, la agrupada de todas las reales de ETH y SOL.
-- - necesarias: independientes para confirmar la expectancy del backtest (alfa 5 %, potencia 80 %).
WITH RECURSIVE
hipotesis (clave, mu) AS (
  VALUES ('ETHUSDT:1d', 0.0588::float8), ('SOLUSDT:1d', 0.1026)
),
t95 (gl, t) AS (
  VALUES
         (1, 6.314::float8), (2, 2.920), (3, 2.354), (4, 2.132), (5, 2.016), (6, 1.944),
         (7, 1.895), (8, 1.860), (9, 1.834), (10, 1.813), (11, 1.796), (12, 1.783),
         (13, 1.771), (14, 1.762), (15, 1.754), (16, 1.746), (17, 1.740), (18, 1.735),
         (19, 1.730), (20, 1.725), (21, 1.721), (22, 1.718), (23, 1.714), (24, 1.711),
         (25, 1.709), (26, 1.706), (27, 1.704), (28, 1.702), (29, 1.700), (30, 1.698),
         (40, 1.684), (60, 1.671), (120, 1.658)
),
una_por_vela AS (
  SELECT DISTINCT ON (symbol, interval, candle_open)
         symbol || ':' || interval AS clave, candle_open, model_version, outcome_result,
         outcome_return_r - CASE WHEN plan_entry IS NOT NULL AND plan_stop IS NOT NULL
                                  AND plan_entry <> plan_stop
                                 THEN (0.12 / 100.0) * abs(plan_entry) / abs(plan_entry - plan_stop)
                                 ELSE 0 END AS r
    FROM snapshots WHERE interval = '1d' AND symbol IN ('ETHUSDT', 'SOLUSDT')
   ORDER BY symbol, interval, candle_open, captured_at ASC
),
evaluadas AS (
  SELECT * FROM una_por_vela WHERE outcome_result IS NOT NULL AND r IS NOT NULL
),
base AS (
  SELECT * FROM evaluadas WHERE model_version NOT LIKE 'ens-opt-%'
),
independientes AS (
  SELECT clave, MIN(candle_open) AS candle_open FROM base GROUP BY clave
  UNION ALL
  SELECT i.clave,
         (SELECT MIN(b.candle_open) FROM base b
           WHERE b.clave = i.clave AND b.candle_open >= i.candle_open + interval '240 hours')
    FROM independientes i
   WHERE i.candle_open IS NOT NULL
),
agrupada AS (
  SELECT sqrt(SUM((r - m) ^ 2) / NULLIF(COUNT(*) - COUNT(DISTINCT clave), 0)) AS sigma,
         COUNT(*) AS n
    FROM (SELECT clave, r, AVG(r) OVER (PARTITION BY clave) AS m FROM evaluadas) x
),
por_clave AS (
  SELECT h.clave, h.mu,
         COUNT(b.r) AS evaluadas,
         AVG(b.r) AS media,
         STDDEV_SAMP(b.r) AS sd_propia,
         (SELECT COUNT(*) FROM independientes i
           WHERE i.clave = h.clave AND i.candle_open IS NOT NULL) AS indep
    FROM hipotesis h LEFT JOIN base b ON b.clave = h.clave
   GROUP BY h.clave, h.mu
),
calculo AS (
  SELECT p.*,
         CASE WHEN p.evaluadas >= 30 THEN p.sd_propia ELSE a.sigma END AS sigma,
         CASE WHEN p.evaluadas >= 30 THEN 'propia'
              ELSE 'agrupada (' || a.n || ' operaciones)' END AS sigma_de,
         (SELECT t FROM t95 WHERE gl <= GREATEST(p.indep - 1, 1) ORDER BY gl DESC LIMIT 1) AS t
    FROM por_clave p CROSS JOIN agrupada a
),
final AS (
  SELECT *,
         NULLIF(CEIL(((1.6448536 + 0.8416212) * sigma / mu) ^ 2), 0) AS necesarias,
         sigma / sqrt(NULLIF(indep, 0)) AS ee
    FROM calculo
)
SELECT clave,
       evaluadas,
       indep                                                              AS independientes,
       ROUND(media::numeric, 3)                                           AS media_neta,
       ROUND(sigma::numeric, 3)                                           AS sigma,
       sigma_de,
       CASE WHEN indep >= 2 THEN ROUND((media - t * ee)::numeric, 3) END  AS ic95_inferior,
       CASE WHEN indep >= 2 THEN ROUND(((t + 0.8416212) * ee)::numeric, 3) END AS detectable_hoy,
       mu                                                                 AS hipotesis,
       necesarias::int                                                    AS necesarias,
       (necesarias * 10)::int                                             AS velas_minimas,
       ROUND((necesarias * 10 / 365.25)::numeric, 1)                      AS anios_minimos,
       ROUND((100.0 * indep / necesarias)::numeric, 1)                    AS progreso_pct,
       CASE WHEN indep < 2 OR sigma IS NULL THEN 'SIN MUESTRA'
            WHEN media - t * ee > 0 THEN 'CONFIRMADA: expectancy neta > 0'
            WHEN media + t * ee < 0 THEN 'ATENCION: perdida confirmada'
            ELSE 'EN CURSO: sin evidencia todavia'
       END AS estado
  FROM final ORDER BY clave;
