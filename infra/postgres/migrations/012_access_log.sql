-- M10: registro persistente de accesos (auditoría de quién entra y de intentos fallidos).
CREATE TABLE IF NOT EXISTS access_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  email      TEXT,
  ip         TEXT,
  event      TEXT NOT NULL,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS access_log_at_idx ON access_log (at DESC);
