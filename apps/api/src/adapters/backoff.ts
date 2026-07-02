export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: number;
}

/**
 * Retardo exponencial con jitter para reconexión.
 * `attempt` empieza en 0. `rng` inyectable para tests deterministas.
 */
export function computeBackoff(
  attempt: number,
  opts: BackoffOptions = {},
  rng: () => number = Math.random,
): number {
  const base = opts.baseMs ?? 500;
  const max = opts.maxMs ?? 30_000;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? 0.2;

  const raw = Math.min(max, base * factor ** attempt);
  const min = raw * (1 - jitter);
  return Math.round(min + rng() * (raw - min));
}
