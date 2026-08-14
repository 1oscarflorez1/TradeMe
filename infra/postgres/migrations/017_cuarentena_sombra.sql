-- Modo sombra de la cuarentena: que una temporalidad vetada pueda demostrar que merece volver.
--
-- Fallo de diseño detectado el 14 de agosto de 2026, dos días después de entregar la cuarentena en
-- M10.5. Cuando 4h quedaba vetada, su decisión se guardaba con `direction = 'FLAT'` y sin plan. El
-- evaluador solo puntúa filas con `plan_entry IS NOT NULL` y dirección operable, así que **ninguna
-- decisión en cuarentena llegaba a evaluarse jamás**.
--
-- Consecuencia: 4h no podía acumular una sola operación medida mientras estuviera en cuarentena, y
-- por tanto no podía demostrar nunca que merecía salir. La medida se dijo temporal y era, en la
-- práctica, irreversible. Se escribió que la cuarentena «retira el permiso para operar, no la
-- observación», y retiraba las dos.
--
-- A partir de aquí se registra también **qué habría hecho**: la acción, la dirección y el plan que
-- habría emitido, en columnas propias.
--
-- ¿Por qué columnas de desenlace separadas y no reutilizar `outcome_*`? Porque el aislamiento tiene
-- que ser **estructural, no de disciplina**. Si las sombra escribieran en `outcome_result`, cualquier
-- consulta existente —el resumen de Registros, la expectancy, el dataset del meta-modelo— contaría
-- como ganada una operación que nadie abrió. Con columnas propias, esa confusión es imposible
-- aunque alguien olvide filtrar.

-- --- Lo que se habría decidido -------------------------------------------------------------------
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS shadow_action TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS shadow_direction TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS shadow_entry DOUBLE PRECISION;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS shadow_stop DOUBLE PRECISION;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS shadow_take_profit DOUBLE PRECISION;

-- --- Cómo habría acabado -------------------------------------------------------------------------
-- Mismas reglas que el desenlace real (primer toque, horizonte por temporalidad), en su propio
-- juego de columnas. Estas cifras alimentan el expediente de la temporalidad; NUNCA el rendimiento.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS shadow_outcome_result TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS shadow_outcome_return_r DOUBLE PRECISION;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS shadow_evaluated_at TIMESTAMPTZ;

-- El evaluador busca sombras pendientes; sin índice recorrería la tabla entera en cada ciclo.
CREATE INDEX IF NOT EXISTS snapshots_shadow_pendientes_idx
    ON snapshots (symbol, interval, captured_at)
 WHERE shadow_direction IS NOT NULL AND shadow_outcome_result IS NULL;

-- Las decisiones en cuarentena anteriores a esta migración no llevan sombra y no se pueden
-- reconstruir sin recalcular la señal con la configuración de aquel momento. Se quedan como están:
-- inventarles un plan a posteriori sería exactamente el look-ahead que el proyecto evita.
