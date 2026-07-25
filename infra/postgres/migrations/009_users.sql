-- Módulo 3: autenticación del equipo (JWT). Sin auto-registro público: los usuarios se crean
-- con `pnpm --filter @trademe/api exec tsx scripts/create-user.ts <email> <password>`.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
