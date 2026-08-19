import { describe, it, expect } from 'vitest';
import { Calibrators, type CalibratorSet } from '../src/calibration/load.js';

const PLATT = { method: 'platt' as const, w: 2.5, c: -1.5 };
const ISO = { method: 'isotonic' as const, x: [0.2, 0.8], y: [0.1, 0.7] };

function set(over: Partial<CalibratorSet>): Calibrators {
  return new Calibrators('(memoria)', {
    version: 'cal-15m-2026-08-19T00:00:00Z',
    ...over,
  } as CalibratorSet);
}

describe('calibradores por símbolo (multiactivo)', () => {
  it('cada activo usa el suyo', () => {
    const c = set({
      symbols: {
        BTCUSDT: { rango: PLATT, tendencia: ISO },
        ETHUSDT: { rango: ISO },
      },
    });
    expect(c.forRegime('rango', 'BTCUSDT')).toEqual(PLATT);
    expect(c.forRegime('tendencia', 'BTCUSDT')).toEqual(ISO);
    expect(c.forRegime('rango', 'ETHUSDT')).toEqual(ISO);
  });

  it('un activo SIN calibración no hereda la de otro', () => {
    // El punto del hito. La calibración responde a «¿cuánto vale una confianza del 70 % en este
    // mercado?», y esa respuesta no se transfiere. Enseñar la de BTC en el panel de SOL sería un
    // número plausible, con la etiqueta correcta, y falso.
    const c = set({ symbols: { BTCUSDT: { rango: PLATT, tendencia: ISO } } });
    expect(c.forRegime('rango', 'SOLUSDT')).toBeUndefined();
    expect(c.forRegime('tendencia', 'SOLUSDT')).toBeUndefined();
  });

  it('un régimen sin entrada tampoco se sustituye por el otro', () => {
    const c = set({ symbols: { ETHUSDT: { rango: ISO } } });
    expect(c.forRegime('tendencia', 'ETHUSDT')).toBeUndefined();
  });

  it('el símbolo se compara sin distinguir mayúsculas', () => {
    const c = set({ symbols: { BTCUSDT: { rango: PLATT } } });
    expect(c.forRegime('rango', 'btcusdt')).toEqual(PLATT);
  });
});

describe('artefacto en formato anterior al multiactivo', () => {
  it('se sigue leyendo, pero solo para el símbolo que declara su versión', () => {
    // Transición: tras desplegar, el artefacto en disco es el viejo hasta que el piloto republica.
    // Se respeta para BTCUSDT —que es con quien se entrenó, según `cal-BTCUSDT-30m`— y para nadie
    // más. Así el despliegue no deja a BTC sin calibración ni se la inventa a los demás.
    const c = new Calibrators('(memoria)', {
      version: 'cal-BTCUSDT-30m',
      regimes: { rango: PLATT, tendencia: ISO },
    } as CalibratorSet);
    expect(c.forRegime('rango', 'BTCUSDT')).toEqual(PLATT);
    expect(c.forRegime('rango', 'ETHUSDT')).toBeUndefined();
    expect(c.forRegime('rango', 'SOLUSDT')).toBeUndefined();
  });

  it('si la versión no dice de qué activo es, no se aplica a nadie', () => {
    const c = new Calibrators('(memoria)', {
      version: 'cal-2026-01-01T00:00:00Z',
      regimes: { rango: PLATT },
    } as CalibratorSet);
    expect(c.forRegime('rango', 'BTCUSDT')).toBeUndefined();
  });

  it('el formato nuevo manda: si trae `symbols`, no se cae al legado', () => {
    const c = new Calibrators('(memoria)', {
      version: 'cal-BTCUSDT-30m',
      symbols: { ETHUSDT: { rango: ISO } },
      regimes: { rango: PLATT },
    } as CalibratorSet);
    expect(c.forRegime('rango', 'ETHUSDT')).toEqual(ISO);
    expect(c.forRegime('rango', 'BTCUSDT')).toBeUndefined();
  });
});

describe('sin artefacto', () => {
  it('no revienta ni inventa', () => {
    const c = new Calibrators('(memoria)', null);
    expect(c.forRegime('rango', 'BTCUSDT')).toBeUndefined();
    expect(c.version).toBeNull();
  });
});
