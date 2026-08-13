-- Registro de las decisiones de NO TRADE, y del ajuste por dependencia de los votos (M10.5).
--
-- Auditoría del 11 de agosto de 2026 sobre 633 registros de BTCUSDT: 324 COMPRAR, 309 VENDER y
-- **cero MANTENER**. El dataset solo contenía decisiones operables, así que el meta-modelo nunca vio
-- un solo ejemplo de las que el sistema descartó: aprendía de la mitad del mundo y la trataba como
-- si fuera entera. Es sesgo de supervivencia de manual.
--
-- A partir de aquí se guardan también los «no operar» informativos —los provocados por un filtro y
-- los que se quedaron a las puertas del umbral— con el motivo por el que no se operó. No contaminan
-- las estadísticas: al no tener plan (`plan_entry IS NULL`) el evaluador los ignora y el resumen ya
-- los clasifica aparte, en «sin plan».

-- Motivo por el que la decisión no fue operable.
--   cuarentena       la temporalidad está retirada de la operativa
--   conflicto_macro  técnica y macro se contradicen con fuerza
--   veto_meta        el meta-modelo descartó la señal
--   banda_neutra     sin ventaja suficiente para salir de la banda
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS hold_reason TEXT;

-- Factor de desinflado aplicado a los logits por dependencia de los votos (1 = sin desinflar).
-- Se guarda con cada decisión para que un backtest futuro pueda reproducir exactamente la confianza
-- que se declaró en su momento, aunque el artefacto de independencia ya se haya recalculado.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS independence_factor DOUBLE PRECISION;

-- Los registros anteriores a esta migración son todos operables (no había ninguno de MANTENER),
-- y se decidieron sin desinflado.
UPDATE snapshots SET independence_factor = 1.0 WHERE independence_factor IS NULL;

-- Consultar los NO TRADE por motivo es la pregunta natural de la pestaña Registros.
CREATE INDEX IF NOT EXISTS snapshots_hold_reason_idx
    ON snapshots (symbol, interval, hold_reason)
 WHERE hold_reason IS NOT NULL;
