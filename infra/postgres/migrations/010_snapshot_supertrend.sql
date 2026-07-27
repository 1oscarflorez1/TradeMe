-- M7.x: guardar el voto de Supertrend en los snapshots (feature del meta-modelo).
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS supertrend_score DOUBLE PRECISION;
