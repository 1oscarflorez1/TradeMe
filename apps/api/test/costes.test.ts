import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadEnsemble, DEFAULT_ENSEMBLE } from '../src/ensemble/config.js';
import { costeEnR, desdeConfig, roundTripPct } from '../src/ensemble/costes.js';

/**
 * Espejo de `apps/quant/tests/test_costes.py`. Los números de este fichero están copiados de allí a
 * propósito: si las dos implementaciones se separan, uno de los dos lados falla.
 *
 * Importa porque desde 0.63.0 todo el gobierno del proyecto razona en R neta y la api no leía
 * siquiera la sección `costs` del yaml — el panel mostraba bruto.
 */

describe('roundTripPct', () => {
  it('cobra las dos patas, comisión y deslizamiento', () => {
    // 2 × (0,05 + 0,01) = 0,12 % en taker; 2 × (0,02 + 0,01) = 0,06 % en maker.
    expect(roundTripPct('taker')).toBeCloseTo(0.12, 10);
    expect(roundTripPct('maker')).toBeCloseTo(0.06, 10);
  });

  it('un modo desconocido se trata como taker, que es el caso caro', () => {
    // Equivocarse hacia el lado prudente: nunca subestimar el coste por un typo en el yaml.
    expect(roundTripPct('otro' as 'taker')).toBeCloseTo(roundTripPct('taker'), 10);
  });
});

describe('costeEnR', () => {
  it('|entry − stop| es 1 R en precio, así que el coste en R sale sin pasar por el ATR', () => {
    // entry 100, stop 98 -> 1 R = 2. Un 0,12 % de 100 son 0,12, que son 0,06 R.
    expect(costeEnR(100, 98, 0.12)).toBeCloseTo(0.06, 10);
  });

  it('cuanto más cerca el stop, más pesa la misma comisión', () => {
    // Es el hallazgo de 0.63.0: el daño escala inversamente con la temporalidad.
    const cerca = costeEnR(100, 99.6, 0.12); // 1 R = 0,4 % del precio, como 15m
    const lejos = costeEnR(100, 93.4, 0.12); // 1 R = 6,6 % del precio, como 1d
    expect(cerca).toBeGreaterThan(lejos * 10);
  });

  it('riesgo nulo o coste nulo dan cero, no infinito', () => {
    expect(costeEnR(100, 100, 0.12)).toBe(0);
    expect(costeEnR(100, 98, 0)).toBe(0);
  });

  it('funciona igual en corto, donde el stop está por encima', () => {
    expect(costeEnR(100, 102, 0.12)).toBeCloseTo(costeEnR(100, 98, 0.12), 10);
  });
});

describe('desdeConfig', () => {
  it('sin sección costs, cero: medir en neto es siempre una decisión explícita', () => {
    expect(desdeConfig(null)).toBe(0);
    expect(desdeConfig(DEFAULT_ENSEMBLE)).toBe(0);
  });

  it('con la sección desactivada, también cero', () => {
    const cfg = { costs: { ...DEFAULT_ENSEMBLE.costs, enabled: false } };
    expect(desdeConfig(cfg)).toBe(0);
  });

  it('lee el ensemble.yaml real y da el round-trip de Binance USDT-M', () => {
    // La comprobación que ata el fichero desplegado con la fórmula.
    const cfg = loadEnsemble(join(__dirname, '..', '..', '..', 'artifacts', 'ensemble.yaml'));
    expect(cfg.costs.enabled).toBe(true);
    expect(cfg.costs.mode).toBe('taker');
    expect(desdeConfig(cfg)).toBeCloseTo(0.12, 10);
  });
});
