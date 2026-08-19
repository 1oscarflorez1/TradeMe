-- Fundamental Score en sombra: el funding, por percentil, penalizando solo los largos (M12).
--
-- Qué se midió antes de escribir una línea de esto. Cruzadas 728 decisiones evaluadas con el valor
-- *as-of* de cada serie de la Data Intelligence Layer, se probaron seis relaciones y sobrevivió
-- una sola (t=2,95, por encima del umbral de Bonferroni 2,64):
--
--   LARGOS  funding bajo   n=117   +0,200 R   47,9 % de acierto
--           funding medio  n=117   -0,005 R   41,9 %
--           funding alto   n=117   -0,230 R   29,1 %
--
--   CORTOS  sin patrón:    -0,111 / +0,131 / -0,004
--
-- De ahí la asimetría: la penalización se resta del logit BUY y no toca el de SELL. Aplicarla a los
-- dos lados por simetría formal sería añadir ruido en la mitad de las decisiones.
--
-- Y de ahí el percentil en vez del valor absoluto: el rango observado fue 0,000003-0,0001, así que
-- cualquier umbral fijo describiría este régimen y no una regla. La ventana móvil de 90 días
-- pregunta «¿está caro el apalancamiento comparado con lo normal últimamente?», que es lo único
-- que se puede sostener cuando el régimen cambie.
--
-- **El score NO decide todavía.** Entra en sombra, igual que la cuarentena y el meta-modelo, y solo
-- se promociona si demuestra lift >= 0,05 R y AUC >= 0,55 sobre decisiones reales cerradas. Los
-- umbrales quedan fijados aquí, antes de ver el primer resultado: elegirlos después sería elegirlos
-- mirando el desenlace.

-- --- Lo que el score opinó, se aplicara o no ----------------------------------------------------
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS fund_percentile DOUBLE PRECISION;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS fund_penalty DOUBLE PRECISION;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS fund_mode TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS fund_version TEXT;

-- --- Lo que se habría decidido con la penalización aplicada -------------------------------------
-- Columnas propias, no reutilizadas, por la misma razón que la sombra de la cuarentena (017): el
-- aislamiento tiene que ser estructural, no de disciplina. Si esto escribiera en `action` o en
-- `outcome_*`, el score estaría influyendo en la decisión —y contaminando la expectancy— antes de
-- haber demostrado nada. Con columnas propias esa confusión es imposible aunque alguien olvide
-- filtrar.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS fund_shadow_action TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS fund_shadow_confidence DOUBLE PRECISION;

-- El expediente del score se lee siempre igual: decisiones donde la penalización habría cambiado
-- algo, ya cerradas. Sin índice, cada revisión recorrería la tabla entera.
CREATE INDEX IF NOT EXISTS snapshots_fund_sombra_idx
    ON snapshots (symbol, interval, captured_at)
 WHERE fund_shadow_action IS NOT NULL;

-- Las decisiones anteriores a esta migración se quedan sin score. Se podría rellenar hacia atrás
-- —el funding histórico está en `derivatives_metrics` y es un hecho registrado, no una estimación—
-- pero la distribución de referencia de cada momento tendría que reconstruirse con la ventana de
-- entonces. Mientras eso no se haga con `published_at`, rellenar sería inventar contexto: se deja
-- en NULL, que es lo que de verdad se sabía.
