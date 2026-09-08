import { describe, it, expect } from 'vitest';
import { DEFAULT_ENSEMBLE, fusionarOptimizada } from '../src/ensemble/config.js';
import type { EnsembleConfig } from '../src/ensemble/config.js';

/**
 * Espejo de `apps/quant/tests/test_fusion_optimizada.py`.
 *
 * Este es el lado que importa de verdad: `getEnsembleFor` decide lo que se emite en vivo, y hasta
 * el 7 de septiembre de 2026 cargaba la configuración optimizada **entera**, sustituyendo la base.
 * Las quince que había eran de agosto, así que quince claves operaban con la cuarentena, los costes
 * y el peso de Reditum de entonces.
 */

/** Una copia completa y vieja del yaml, que es exactamente lo que publica el optimizador. */
function optimizadaDeAgosto(): EnsembleConfig {
  return {
    ...DEFAULT_ENSEMBLE,
    version: 'ens-opt-SOLUSDT-1d-20260819',
    temperature: 0.57,
    holdBand: 0.15,
    weights: { ...DEFAULT_ENSEMBLE.weights, supertrend: 1.87 },
    // Estado de gobierno de agosto: nada de esto debe viajar.
    externalWeights: { tradingview: 2.0 },
    quarantineIntervals: ['4h'],
    regime: {
      ...DEFAULT_ENSEMBLE.regime,
      adxThreshold: 99,
      adxLo: 15.6,
      adxHi: 29.5,
    },
    risk: { ...DEFAULT_ENSEMBLE.risk, atrStopMult: 9.9 },
  };
}

describe('fusionarOptimizada', () => {
  it('viaja lo que Optuna optimiza', () => {
    const f = fusionarOptimizada(DEFAULT_ENSEMBLE, optimizadaDeAgosto());
    expect(f.temperature).toBe(0.57);
    expect(f.holdBand).toBe(0.15);
    expect(f.weights.supertrend).toBe(1.87);
    expect(f.regime.adxLo).toBe(15.6);
    expect(f.regime.adxHi).toBe(29.5);
  });

  it('la versión viaja porque es la identidad del artefacto que decidió', () => {
    const f = fusionarOptimizada(DEFAULT_ENSEMBLE, optimizadaDeAgosto());
    expect(f.version).toBe('ens-opt-SOLUSDT-1d-20260819');
  });

  it('Reditum se queda en el peso de la base, no en el de agosto', () => {
    // El más peligroso de los tres: con 0 filas en `external_signals` hoy no hace nada, pero
    // habría empujado la decisión con peso 2,0 en cuanto se configurase el webhook.
    const f = fusionarOptimizada(DEFAULT_ENSEMBLE, optimizadaDeAgosto());
    expect(f.externalWeights).toEqual(DEFAULT_ENSEMBLE.externalWeights);
    expect(f.externalWeights.tradingview).toBe(0);
  });

  it('la cuarentena la manda siempre la base', () => {
    const f = fusionarOptimizada(DEFAULT_ENSEMBLE, optimizadaDeAgosto());
    expect(f.quarantineIntervals).toEqual(DEFAULT_ENSEMBLE.quarantineIntervals);
    expect(f.quarantineIntervals).toContain('15m');
    expect(f.quarantineIntervals).toContain('1h');
  });

  it('el riesgo y el umbral de ADX no se tocan: Optuna no los busca', () => {
    const f = fusionarOptimizada(DEFAULT_ENSEMBLE, optimizadaDeAgosto());
    expect(f.risk).toEqual(DEFAULT_ENSEMBLE.risk);
    expect(f.regime.adxThreshold).toBe(DEFAULT_ENSEMBLE.regime.adxThreshold);
  });

  it('macro, fundamental, plan y evaluación vienen de la base', () => {
    const f = fusionarOptimizada(DEFAULT_ENSEMBLE, optimizadaDeAgosto());
    expect(f.macro).toEqual(DEFAULT_ENSEMBLE.macro);
    expect(f.fundamental).toEqual(DEFAULT_ENSEMBLE.fundamental);
    expect(f.plan).toEqual(DEFAULT_ENSEMBLE.plan);
    expect(f.evaluation).toEqual(DEFAULT_ENSEMBLE.evaluation);
  });

  it('fusionar con una configuración idéntica no cambia nada', () => {
    // Propiedad de seguridad: la fusión no puede introducir diferencias por sí sola.
    expect(fusionarOptimizada(DEFAULT_ENSEMBLE, DEFAULT_ENSEMBLE)).toEqual(DEFAULT_ENSEMBLE);
  });
});
