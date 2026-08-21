import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPool } from '../src/db/pool.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pool de Postgres', () => {
  it('sobrevive a que el servidor corte una conexión inactiva', () => {
    // El fallo del 20 de agosto de 2026. Al pararse Postgres, la api registró
    // «terminating connection due to administrator command», Node lo trató como excepción no
    // capturada por no haber listener, y el proceso murió con código 1.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('postgres://nadie@localhost:1/nada');

    // Sin listener, esto tumbaría el proceso. Con él, se registra y la vida sigue.
    expect(() =>
      pool.emit('error', new Error('terminating connection due to administrator command')),
    ).not.toThrow();

    expect(err).toHaveBeenCalledOnce();
    expect(String(err.mock.calls[0]?.[0])).toContain('el pool sigue vivo');
    void pool.end().catch(() => {});
  });

  it('registra el motivo, no lo silencia', () => {
    // Tragarse el error dejaría invisible una base que se reinicia sola, que es justo lo que
    // conviene ver en los registros.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('postgres://nadie@localhost:1/nada');
    pool.emit('error', new Error('server closed the connection unexpectedly'));
    expect(String(err.mock.calls[0]?.[0])).toContain('server closed the connection unexpectedly');
    void pool.end().catch(() => {});
  });

  it('aguanta varios cortes seguidos', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('postgres://nadie@localhost:1/nada');
    for (let i = 0; i < 5; i += 1) {
      expect(() => pool.emit('error', new Error(`corte ${i}`))).not.toThrow();
    }
    expect(err).toHaveBeenCalledTimes(5);
    void pool.end().catch(() => {});
  });
});
