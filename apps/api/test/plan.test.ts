import { describe, it, expect } from 'vitest';
import { buildPlan } from '../src/ensemble/plan.js';
import { DEFAULT_ENSEMBLE } from '../src/ensemble/config.js';

const risk = DEFAULT_ENSEMBLE.risk; // 1.5xATR, 2R, 1%

describe('buildPlan', () => {
  it('BUY: stop bajo la entrada, TP arriba, R:R y sizing por riesgo fijo', () => {
    const plan = buildPlan({
      action: 'BUY',
      price: 100,
      atr: 2,
      regimeLabel: 'tendencia',
      confidence: 0.7,
      risk,
      equity: 10_000,
    });
    expect(plan).toHaveLength(5);
    const stopDistance = 2 * risk.atrStopMult; // 3
    // stop = 100 - 3 = 97 ; TP = 100 + 2*3 = 106
    expect(plan[2]?.detail).toContain('97.00');
    expect(plan[3]?.detail).toContain('106.00');
    // tamaño = (10000*0.01)/3 = 33.33 u
    const size = (10_000 * risk.riskPct) / stopDistance;
    expect(plan[4]?.detail).toContain(size.toFixed(6));
  });

  it('SELL: stop por encima y TP por debajo de la entrada', () => {
    const plan = buildPlan({
      action: 'SELL',
      price: 100,
      atr: 2,
      regimeLabel: 'tendencia',
      confidence: 0.7,
      risk,
      equity: 10_000,
    });
    expect(plan[2]?.detail).toContain('103.00'); // stop 100 + 3
    expect(plan[3]?.detail).toContain('94.00'); // TP 100 - 6
  });

  it('HOLD: no abre posición', () => {
    const plan = buildPlan({
      action: 'HOLD',
      price: 100,
      atr: 2,
      regimeLabel: 'rango',
      confidence: 0.4,
      risk,
      equity: 10_000,
    });
    expect(plan[0]?.title).toMatch(/Mantener|esperar/i);
    expect(plan.some((p) => p.title === 'Entrada')).toBe(false);
  });

  it('sin ATR válido, no genera entrada', () => {
    const plan = buildPlan({
      action: 'BUY',
      price: 100,
      atr: 0,
      regimeLabel: 'rango',
      confidence: 0.5,
      risk,
      equity: 10_000,
    });
    expect(plan.some((p) => p.title === 'Entrada')).toBe(false);
  });
});
