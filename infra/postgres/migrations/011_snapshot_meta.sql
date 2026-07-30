-- M2: guardar la predicción del meta-modelo para poder evaluar el modo sombra.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS meta_confidence DOUBLE PRECISION;
