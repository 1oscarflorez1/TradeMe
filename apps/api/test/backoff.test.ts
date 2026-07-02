import { describe, it, expect } from 'vitest';
import { computeBackoff } from '../src/adapters/backoff.js';

describe('computeBackoff', () => {
  it('crece exponencialmente y respeta el tope', () => {
    const opts = { baseMs: 500, maxMs: 30_000, factor: 2, jitter: 0 };
    expect(computeBackoff(0, opts, () => 0)).toBe(500);
    expect(computeBackoff(1, opts, () => 0)).toBe(1000);
    expect(computeBackoff(2, opts, () => 0)).toBe(2000);
    // tope
    expect(computeBackoff(20, opts, () => 0)).toBe(30_000);
  });

  it('aplica jitter dentro del rango esperado', () => {
    const opts = { baseMs: 1000, maxMs: 30_000, factor: 2, jitter: 0.2 };
    expect(computeBackoff(0, opts, () => 0)).toBe(800); // mínimo con jitter
    expect(computeBackoff(0, opts, () => 1)).toBe(1000); // máximo
  });
});
