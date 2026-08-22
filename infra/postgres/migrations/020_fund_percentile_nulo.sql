-- Los activos sin funding guardaban `fund_percentile = 0` en vez de NULL.
--
-- `stale` significa «no se sabe dónde cae este funding», y eso NO es un percentil 0: el 0 es una
-- lectura legítima —funding en el mínimo de su ventana de 90 días— y se da de verdad. Guardar el
-- mismo valor para las dos cosas hace que cualquier análisis que agrupe por percentil mezcle
-- «sin datos» con «funding muy bajo».
--
-- Es el mismo error conceptual que el funding a cero de 0.38.0, esta vez en la capa de
-- persistencia: convertir un «no lo sé» en un número que parece una medición.
--
-- Afecta sobre todo a los activos que nunca tendrán funding (acciones vía Twelve Data), pero también
-- a los perpetuos durante sus primeros ciclos, antes de que el piloto publique su distribución.
--
-- La penalización se deja como está: un 0 ahí es un hecho sobre la decisión —no se penalizó a
-- nadie—, no una laguna.

UPDATE snapshots
   SET fund_percentile = NULL
 WHERE fund_percentile = 0
   AND raw_signal -> 'fundamental' ->> 'stale' = 'true';
