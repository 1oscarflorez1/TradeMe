import { describe, expect, it } from 'vitest';
import { RateBudget } from '../src/providers/rate-budget.js';
import { ProviderError, proximoResetUtc } from '../src/providers/errors.js';

/**
 * El 17 de agosto de 2026 se consumieron 1822 créditos de un plan de 800 y el panel acabó
 * mostrando un 502 sin explicación. Estas pruebas cubren las dos causas: un presupuesto que no
 * cubría todas las llamadas, y un error que no distinguía «sin cupo» de «roto».
 */
describe('RateBudget', () => {
  const reloj = (t: { v: number }) => () => t.v;

  it('agota el cupo por minuto y se repone al pasar el minuto', () => {
    const t = { v: Date.UTC(2026, 7, 18, 12, 0, 0) };
    const b = new RateBudget(3, 100, reloj(t));
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    t.v += 61_000;
    expect(b.tryTake()).toBe(true);
  });

  it('el cupo diario se cuenta por día natural UTC, no en ventana deslizante', () => {
    // Es como lo cuentan los proveedores. Con ventana deslizante, el presupuesto y el proveedor
    // discrepaban y el aviso de «se repone a medianoche» habría sido mentira.
    const t = { v: Date.UTC(2026, 7, 18, 23, 30, 0) };
    const b = new RateBudget(100, 2, reloj(t));
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    expect(b.agotadoDia).toBe(true);

    t.v = Date.UTC(2026, 7, 19, 0, 0, 1); // pasada la medianoche UTC
    expect(b.tryTake()).toBe(true);
    expect(b.agotadoDia).toBe(false);
  });

  it('resetAt() apunta a la próxima medianoche UTC', () => {
    const t = { v: Date.UTC(2026, 7, 18, 14, 3, 9) };
    const b = new RateBudget(10, 10, reloj(t));
    expect(b.resetAt()).toBe('2026-08-19T00:00:00.000Z');
  });

  it('distingue quedarse sin minuto de quedarse sin día', () => {
    const t = { v: Date.UTC(2026, 7, 18, 10, 0, 0) };
    const b = new RateBudget(1, 100, reloj(t));
    b.tryTake();
    expect(b.tryTake()).toBe(false);
    expect(b.agotadoDia).toBe(false); // solo es el límite por minuto: se resuelve en segundos
  });

  it('status() informa de lo que queda', () => {
    const t = { v: Date.UTC(2026, 7, 18, 10, 0, 0) };
    const b = new RateBudget(5, 10, reloj(t));
    b.tryTake();
    b.tryTake();
    expect(b.status()).toMatchObject({ minuto: 2, dia: 2, restanteMinuto: 3, restanteDia: 8 });
  });
});

describe('ProviderError', () => {
  it('cada causa tiene su código HTTP, y ninguna es 502 salvo la caída', () => {
    expect(new ProviderError('sin_cupo', 'twelvedata', 'x').status).toBe(429);
    expect(new ProviderError('no_soportado', 'twelvedata', 'x').status).toBe(422);
    expect(new ProviderError('proveedor_caido', 'twelvedata', 'x').status).toBe(502);
  });

  it('lleva consigo cuándo se resuelve solo, si se sabe', () => {
    const e = new ProviderError('sin_cupo', 'twelvedata', 'sin créditos', '2026-08-19T00:00:00Z');
    expect(e.toJSON()).toMatchObject({
      kind: 'sin_cupo',
      provider: 'twelvedata',
      retryAt: '2026-08-19T00:00:00Z',
    });
  });

  it('sin retryAt no se inventa ninguno', () => {
    expect(new ProviderError('proveedor_caido', 'x', 'y').toJSON()).not.toHaveProperty('retryAt');
  });

  it('proximoResetUtc cruza bien el fin de mes', () => {
    expect(proximoResetUtc(Date.UTC(2026, 7, 31, 23, 59))).toBe('2026-09-01T00:00:00.000Z');
  });
});
