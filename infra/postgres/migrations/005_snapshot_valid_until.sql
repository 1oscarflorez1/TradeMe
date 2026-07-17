-- M5.6: validez temporal de la entrada en los snapshots.
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;
