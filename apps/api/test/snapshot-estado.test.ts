import { describe, it, expect } from 'vitest';
import { estadoFinal, trackSnapshot, type SnapshotRow } from '../src/snapshots/tracking.js';

const base: SnapshotRow = {
  id: 's1',
  captured_at: '2026-08-01T00:00:00Z',
  symbol: 'BTCUSDT',
  interval: '4h',
  action: 'SELL',
  direction: 'SHORT',
  price: 63804,
  confidence: 0.57,
  regime_label: 'tendencia',
  net: -0.3,
  prob_buy: 0.2,
  prob_hold: 0.23,
  prob_sell: 0.57,
  macro_bias: null,
  plan_entry: 63804,
  plan_stop: 64680.86,
  plan_take_profit: 62050.28,
  plan_rr: 2,
  valid_until: '2026-08-01T12:00:00Z',
  outcome_result: null,
  outcome_return_r: null,
};

describe('estado autoritativo de un registro', () => {
  it('el resultado evaluado manda sobre dónde esté el precio ahora', () => {
    // Tocó el stop hace días; hoy el precio volvió justo al medio del plan.
    const row = { ...base, outcome_result: 'sl', outcome_return_r: -1 };
    const vivo = trackSnapshot(row, 63804, Date.parse('2026-08-04T00:00:00Z'));

    // El seguimiento en vivo, por sí solo, diría «en curso»: solo mira el precio actual.
    expect(vivo.status).toBe('en_curso');
    // El estado autoritativo no se deja engañar.
    expect(estadoFinal(row)).toBe('sl');
  });

  it('una operación cerrada en objetivo no vuelve a abrirse aunque el precio regrese', () => {
    const row = { ...base, outcome_result: 'tp', outcome_return_r: 2 };
    expect(trackSnapshot(row, 63804, Date.now()).status).toBe('en_curso');
    expect(estadoFinal(row)).toBe('tp');
  });

  it('los tres estados cerrados son excluyentes entre sí', () => {
    const estados = (['tp', 'sl', 'timeout'] as const).map((r) =>
      estadoFinal({ ...base, outcome_result: r }),
    );
    expect(estados).toEqual(['tp', 'sl', 'timeout']);
    expect(new Set(estados).size).toBe(3);
  });

  it('sin evaluar queda abierta, y solo entonces importa el seguimiento en vivo', () => {
    expect(estadoFinal(base)).toBe('abierto');
    expect(trackSnapshot(base, 62000, Date.now()).status).toBe('tp');
  });

  it('una decisión de MANTENER no puntúa', () => {
    const flat = { ...base, direction: 'FLAT' as const, plan_entry: null, plan_stop: null };
    expect(estadoFinal(flat)).toBe('sin_plan');
  });

  it('la caducidad de la entrada es independiente del resultado', () => {
    const t = trackSnapshot(base, 63804, Date.parse('2026-08-04T00:00:00Z'));
    expect(t.expired).toBe(true);
    expect(estadoFinal(base)).toBe('abierto');
  });
});
