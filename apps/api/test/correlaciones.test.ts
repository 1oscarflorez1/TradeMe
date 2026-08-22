import { describe, it, expect } from 'vitest';
import {
  Correlaciones,
  resumirExposicion,
  type CorrelacionesFile,
} from '../src/ensemble/correlaciones.js';

/** Medición real de producción (500 velas de 1h, 21 ago 2026). */
const MEDIDO: CorrelacionesFile = {
  symbols: ['BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  matrix: [
    [1.0, 0.71, 0.69, 0.7],
    [0.71, 1.0, 0.81, 0.75],
    [0.69, 0.81, 1.0, 0.76],
    [0.7, 0.75, 0.76, 1.0],
  ],
  efectivos: 1.519,
  nominales: 4,
  subconjuntos: {
    'BNBUSDT,BTCUSDT': 1.33,
    'BNBUSDT,ETHUSDT': 1.355,
    'BNBUSDT,SOLUSDT': 1.342,
    'BTCUSDT,ETHUSDT': 1.208,
    'BTCUSDT,SOLUSDT': 1.263,
    'ETHUSDT,SOLUSDT': 1.253,
    'BNBUSDT,BTCUSDT,ETHUSDT': 1.472,
    'BNBUSDT,ETHUSDT,SOLUSDT': 1.503,
    'BTCUSDT,ETHUSDT,SOLUSDT': 1.402,
    'BNBUSDT,BTCUSDT,SOLUSDT': 1.494,
    'BNBUSDT,BTCUSDT,ETHUSDT,SOLUSDT': 1.519,
  },
};

const corr = new Correlaciones('(memoria)', MEDIDO);
const sinMedicion = new Correlaciones('(memoria)', null);

describe('apuestas efectivas', () => {
  it('tres señales alineadas son menos de tres apuestas', () => {
    // El caso que motiva el hito: BTC + ETH + SOL en compra parecen tres oportunidades.
    expect(corr.apuestasEfectivas(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])).toBeCloseTo(1.402, 3);
  });

  it('los cuatro juntos son una y media', () => {
    expect(corr.apuestasEfectivas(['BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'])).toBeCloseTo(1.519, 3);
  });

  it('el orden en que lleguen los símbolos no cambia el resultado', () => {
    const a = corr.apuestasEfectivas(['SOLUSDT', 'BTCUSDT', 'ETHUSDT']);
    const b = corr.apuestasEfectivas(['ETHUSDT', 'SOLUSDT', 'BTCUSDT']);
    expect(a).toBe(b);
  });

  it('los duplicados no inflan la cuenta', () => {
    expect(corr.apuestasEfectivas(['BTCUSDT', 'BTCUSDT', 'ETHUSDT'])).toBeCloseTo(1.208, 3);
  });

  it('una sola señal es una apuesta, sin avisos absurdos', () => {
    expect(corr.apuestasEfectivas(['BTCUSDT'])).toBe(1);
    expect(corr.apuestasEfectivas([])).toBe(0);
  });

  it('sin medición NO se inventa un descuento', () => {
    // Devolver menos de lo que hay sería peor que no decir nada: el usuario decidiría cuánto
    // arriesgar con un número inventado.
    expect(sinMedicion.apuestasEfectivas(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])).toBe(3);
    expect(sinMedicion.disponible).toBe(false);
  });

  it('un símbolo no medido tampoco se descuenta a ciegas', () => {
    expect(corr.apuestasEfectivas(['BTCUSDT', 'DOGEUSDT'])).toBe(2);
  });
});

describe('resumen de exposición', () => {
  it('se queda con el lado cargado, no compensa largos con cortos', () => {
    const e = resumirExposicion(
      '15m',
      [
        { symbol: 'ETHUSDT', direction: 'LONG' },
        { symbol: 'SOLUSDT', direction: 'LONG' },
        { symbol: 'BTCUSDT', direction: 'SHORT' },
      ],
      corr,
    );
    expect(e.direccion).toBe('LONG');
    expect(e.simbolos).toEqual(['ETHUSDT', 'SOLUSDT']);
    expect(e.apuestasEfectivas).toBeCloseTo(1.253, 3);
    expect(e.alineadas.SHORT).toEqual(['BTCUSDT']);
  });

  it('señala el par más redundante del grupo', () => {
    const e = resumirExposicion(
      '1h',
      [
        { symbol: 'BTCUSDT', direction: 'LONG' },
        { symbol: 'ETHUSDT', direction: 'LONG' },
        { symbol: 'BNBUSDT', direction: 'LONG' },
      ],
      corr,
    );
    // BTC-ETH es el par más correlacionado (0,81) de los tres.
    expect(e.parMasRedundante?.correlacion).toBeCloseTo(0.81, 2);
    expect([e.parMasRedundante?.a, e.parMasRedundante?.b].sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('sin señales operables no hay dirección ni aviso', () => {
    const e = resumirExposicion('15m', [], corr);
    expect(e.direccion).toBeNull();
    expect(e.apuestasEfectivas).toBe(0);
    expect(e.parMasRedundante).toBeNull();
  });

  it('marca cuándo la medición no está disponible', () => {
    const e = resumirExposicion(
      '15m',
      [
        { symbol: 'ETHUSDT', direction: 'LONG' },
        { symbol: 'SOLUSDT', direction: 'LONG' },
      ],
      sinMedicion,
    );
    expect(e.medido).toBe(false);
    expect(e.apuestasEfectivas).toBe(2); // sin descuento inventado
  });
});
