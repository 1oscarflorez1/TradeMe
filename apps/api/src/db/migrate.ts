import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';

/**
 * Aplica las migraciones SQL pendientes al arrancar (idempotente, registradas en
 * schema_migrations). Evita tener que recrear el volumen cuando el esquema cambia.
 */
export async function runMigrations(
  pool: pg.Pool,
  dir: string,
  log?: (msg: string) => void,
): Promise<void> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    log?.(`sin migraciones en ${dir}`);
    return;
  }
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if ((done.rowCount ?? 0) > 0) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    log?.(`migración aplicada: ${file}`);
  }
}
