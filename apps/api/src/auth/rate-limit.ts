// Freno a la fuerza bruta en el login (M10 · hardening).
// Sin dependencias: ventana deslizante en memoria por clave (IP + email), con bloqueo temporal
// creciente. La plataforma está expuesta a internet, así que sin esto cualquiera podría probar
// contraseñas indefinidamente.

export interface RateLimitConfig {
  maxAttempts: number; // intentos fallidos permitidos por ventana
  windowMs: number; // ventana de observación
  blockMs: number; // bloqueo base al superarla (se duplica en reincidencias)
  maxBlockMs: number; // techo del bloqueo
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60_000,
  blockMs: 60_000,
  maxBlockMs: 30 * 60_000,
};

interface Entry {
  failures: number[]; // timestamps de fallos dentro de la ventana
  blockedUntil: number;
  strikes: number; // veces que ha sido bloqueado (para el backoff)
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly cfg: RateLimitConfig = DEFAULT_RATE_LIMIT) {}

  /** ¿Puede intentar? No consume intento: solo consulta el estado. */
  check(key: string, now = Date.now()): RateLimitVerdict {
    const e = this.entries.get(key);
    if (!e) return { allowed: true, retryAfterSec: 0, remaining: this.cfg.maxAttempts };
    if (e.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterSec: Math.ceil((e.blockedUntil - now) / 1000),
        remaining: 0,
      };
    }
    const recent = e.failures.filter((t) => now - t < this.cfg.windowMs);
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, this.cfg.maxAttempts - recent.length),
    };
  }

  /** Registra un fallo; bloquea si se supera el máximo (con backoff exponencial). */
  fail(key: string, now = Date.now()): RateLimitVerdict {
    const e = this.entries.get(key) ?? { failures: [], blockedUntil: 0, strikes: 0 };
    e.failures = e.failures.filter((t) => now - t < this.cfg.windowMs);
    e.failures.push(now);
    if (e.failures.length >= this.cfg.maxAttempts) {
      e.strikes += 1;
      const block = Math.min(this.cfg.blockMs * 2 ** (e.strikes - 1), this.cfg.maxBlockMs);
      e.blockedUntil = now + block;
      e.failures = [];
    }
    this.entries.set(key, e);
    return this.check(key, now);
  }

  /** Login correcto: limpia el historial de esa clave. */
  succeed(key: string): void {
    this.entries.delete(key);
  }

  /** Limpieza de entradas viejas (evita crecer sin límite). */
  sweep(now = Date.now()): void {
    for (const [k, e] of this.entries) {
      const stale =
        e.blockedUntil < now && e.failures.every((t) => now - t > this.cfg.windowMs);
      if (stale) this.entries.delete(k);
    }
  }
}
