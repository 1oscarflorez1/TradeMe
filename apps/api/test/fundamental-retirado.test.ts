import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { DEFAULT_ENSEMBLE, effectiveMacro, loadEnsemble } from '../src/ensemble/config.js';
import { computeFundamental, fundamentalTerm } from '../src/ensemble/fundamental.js';

/**
 * El Fundamental Score, retirado en 0.75.0 (`fundamental.mode: 'off'`).
 *
 * Auditado en walk-forward sobre 5 semanas: AUC en largos 0,421 frente a un azar de 0,619, y lo
 * que habría dejado abrir rendía 0,101 R menos que todo. Descartaba sobre todo en las semanas en que
 * los largos ganaban. Ver `docs/fundamental.md`.
 */
describe('Fundamental Score retirado', () => {
  const cfg = loadEnsemble(join(__dirname, '..', '..', '..', 'artifacts', 'ensemble.yaml'));

  it('el ensemble.yaml desplegado lo tiene en off', () => {
    expect(cfg.fundamental.mode).toBe('off');
  });

  it('en off ni se calcula ni penaliza, aunque haya funding y distribución', () => {
    const artefacto = {
      symbol: 'ETHUSDT',
      version: 'fund-x',
      stale: false,
      knots: Array.from({ length: 101 }, (_, i) => i / 100),
    };
    const f = computeFundamental({
      funding: 0.99,
      artifact: artefacto as never,
      config: cfg.fundamental,
    });
    expect(f).toBeUndefined();
    expect(fundamentalTerm(f)).toBe(0);
  });

  it('el funding no sale del sesgo macro: eso solo ocurre con el score activo', () => {
    expect(effectiveMacro(cfg).fundingWeight).toBe(cfg.macro.fundingWeight);
    expect(DEFAULT_ENSEMBLE.fundamental.mode).not.toBe('active');
  });
});
