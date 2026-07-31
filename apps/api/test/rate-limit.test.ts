import { describe, it, expect } from 'vitest';
import { LoginRateLimiter } from '../src/auth/rate-limit.js';

const cfg = { maxAttempts: 3, windowMs: 60_000, blockMs: 1_000, maxBlockMs: 8_000 };

describe('LoginRateLimiter', () => {
  it('permite intentos mientras no se supere el máximo', () => {
    const rl = new LoginRateLimiter(cfg);
    expect(rl.check('a').allowed).toBe(true);
    rl.fail('a');
    rl.fail('a');
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').remaining).toBe(1);
  });

  it('bloquea al superar el máximo de fallos', () => {
    const rl = new LoginRateLimiter(cfg);
    rl.fail('a');
    rl.fail('a');
    const v = rl.fail('a');
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSec).toBeGreaterThan(0);
  });

  it('el bloqueo crece con la reincidencia (backoff)', () => {
    const rl = new LoginRateLimiter(cfg);
    let now = 0;
    for (let i = 0; i < 3; i++) rl.fail('a', now);
    const first = rl.check('a', now).retryAfterSec;
    now += cfg.blockMs + 1; // pasa el primer bloqueo
    for (let i = 0; i < 3; i++) rl.fail('a', now);
    const second = rl.check('a', now).retryAfterSec;
    expect(second).toBeGreaterThan(first);
  });

  it('un login correcto limpia el historial', () => {
    const rl = new LoginRateLimiter(cfg);
    rl.fail('a');
    rl.fail('a');
    rl.succeed('a');
    expect(rl.check('a').remaining).toBe(cfg.maxAttempts);
  });

  it('las claves son independientes entre sí', () => {
    const rl = new LoginRateLimiter(cfg);
    for (let i = 0; i < 3; i++) rl.fail('atacante');
    expect(rl.check('atacante').allowed).toBe(false);
    expect(rl.check('legitimo').allowed).toBe(true);
  });

  it('la limpieza descarta entradas caducadas', () => {
    const rl = new LoginRateLimiter(cfg);
    rl.fail('a', 0);
    rl.sweep(cfg.windowMs + 10_000);
    expect(rl.check('a').remaining).toBe(cfg.maxAttempts);
  });
});
