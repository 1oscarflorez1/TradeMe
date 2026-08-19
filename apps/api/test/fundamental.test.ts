import { describe, it, expect } from 'vitest';
import {
  computeFundamental,
  fundamentalTerm,
  longPenalty,
  percentileOf,
  type FundamentalArtifact,
} from '../src/ensemble/fundamental.js';
import { inferProbs, pickAction } from '../src/ensemble/inference.js';
import { DEFAULT_ENSEMBLE, effectiveMacro, type FundamentalConfig } from '../src/ensemble/config.js';
import { buildSignal } from '../src/ensemble/signal.js';
import { IndicatorRegistry } from '../src/indicators/registry.js';
import type { Candle } from '../src/domain/candle.js';
import type { Macro } from '../src/domain/signal.js';

function knotsDe(valores: number[]): number[] {
  const orden = [...valores].sort((a, b) => a - b);
  const m = orden.length;
  const out: number[] = [];
  for (let i = 0; i < 101; i++) {
    const pos = (i / 100) * (m - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    out.push((orden[lo] as number) * (1 - (pos - lo)) + (orden[hi] as number) * (pos - lo));
  }
  return out;
}

const KNOTS = knotsDe(Array.from({ length: 100 }, (_, i) => i / 1_000_000));

function artefacto(over: Partial<FundamentalArtifact> = {}): FundamentalArtifact {
  return {
    version: 'fund-test',
    symbol: 'BTCUSDT',
    window_days: 90,
    n: 270,
    stale: false,
    start: 1 / 3,
    knots: KNOTS,
    ...over,
  };
}

const CFG: FundamentalConfig = { ...DEFAULT_ENSEMBLE.fundamental };

describe('percentileOf', () => {
  it('satura fuera de rango en vez de extrapolar', () => {
    expect(percentileOf(KNOTS, -1)).toBe(0);
    expect(percentileOf(KNOTS, 1)).toBe(1);
  });

  it('es monótono', () => {
    let anterior = -1;
    for (const v of [0, 0.00001, 0.00003, 0.00005, 0.00008, 0.0001]) {
      const p = percentileOf(KNOTS, v);
      expect(p).toBeGreaterThanOrEqual(anterior);
      anterior = p;
    }
  });

  it('sin distribución devuelve el centro, no un extremo', () => {
    expect(percentileOf([], 0.001)).toBe(0.5);
  });
});

describe('longPenalty', () => {
  it('no penaliza el tercil bajo: es donde los largos rendían +0,200 R', () => {
    expect(longPenalty(0, 1 / 3)).toBe(0);
    expect(longPenalty(0.3, 1 / 3)).toBe(0);
    expect(longPenalty(1 / 3, 1 / 3)).toBe(0);
  });

  it('crece hasta 1 en el percentil máximo', () => {
    expect(longPenalty(0.5, 1 / 3)).toBeCloseTo(0.25, 6);
    expect(longPenalty(1, 1 / 3)).toBe(1);
    expect(longPenalty(2, 1 / 3)).toBe(1);
  });
});

describe('computeFundamental', () => {
  it('en sombra calcula y registra, pero no se aplica', () => {
    const f = computeFundamental({ funding: 0.00009, artifact: artefacto(), config: CFG });
    expect(f?.mode).toBe('shadow');
    expect(f?.applied).toBe(false);
    expect(f?.penalty).toBeGreaterThan(0);
    // Lo que de verdad importa: en sombra el término inyectado es 0.
    expect(fundamentalTerm(f)).toBe(0);
  });

  it('promocionado sí se aplica', () => {
    const f = computeFundamental({
      funding: 0.00009,
      artifact: artefacto(),
      config: { ...CFG, mode: 'active' },
    });
    expect(f?.applied).toBe(true);
    expect(fundamentalTerm(f)).toBeGreaterThan(0);
  });

  it('sin artefacto se declara stale y no empuja en ninguna dirección', () => {
    const f = computeFundamental({
      funding: 0.00009,
      artifact: null,
      config: { ...CFG, mode: 'active' },
    });
    expect(f?.stale).toBe(true);
    expect(f?.applied).toBe(false);
    expect(f?.penalty).toBe(0);
    expect(fundamentalTerm(f)).toBe(0);
  });

  it('un artefacto marcado stale por quant tampoco penaliza', () => {
    const f = computeFundamental({
      funding: 0.00009,
      artifact: artefacto({ stale: true, knots: [] }),
      config: { ...CFG, mode: 'active' },
    });
    expect(fundamentalTerm(f)).toBe(0);
  });

  it('apagado no produce bloque', () => {
    expect(
      computeFundamental({ funding: 0.0001, artifact: artefacto(), config: { ...CFG, mode: 'off' } }),
    ).toBeUndefined();
  });
});

describe('asimetría de la inyección', () => {
  it('no toca el lado corto: la relación SELL/HOLD queda intacta', () => {
    // Ojo: P(SELL) SÍ cambia, y debe cambiar — el softmax normaliza, así que al hundir el logit
    // BUY la masa sobrante se reparte. Lo que no se toca es el logit de SELL, y su consecuencia
    // observable es que la proporción entre SELL y HOLD no se mueve.
    const base = inferProbs(0.5, 0.5, 0.06, { bias: 0, wMacro: 1 }, 1, 0);
    for (const term of [0.1, 0.25, 0.5, 1, 3]) {
      const p = inferProbs(0.5, 0.5, 0.06, { bias: 0, wMacro: 1 }, 1, term);
      expect(p.SELL / p.HOLD).toBeCloseTo(base.SELL / base.HOLD, 12);
      expect(p.BUY).toBeLessThan(base.BUY);
    }
  });

  it('más funding nunca favorece al largo', () => {
    let previo = 1;
    for (const term of [0, 0.25, 0.5, 0.75, 1, 2]) {
      const p = inferProbs(0.4, 0.5, 0.06, { bias: 0.2, wMacro: 1 }, 0.7, term);
      expect(p.BUY).toBeLessThanOrEqual(previo + 1e-12);
      previo = p.BUY;
    }
  });

  it('no fabrica cortos donde el resto de la evidencia no los veía', () => {
    // Con net>0 y macro neutro, el logit SELL queda por debajo del de HOLD, así que penalizar el
    // largo solo puede llevar la decisión a HOLD. El funding desaconseja comprar; no aconseja vender.
    for (const term of [0.5, 1, 2, 5]) {
      const probs = inferProbs(0.5, 0.5, 0.06, { bias: 0, wMacro: 1 }, 1, term);
      expect(pickAction(probs).action).not.toBe('SELL');
    }
  });
});

describe('migración del funding atada a la promoción', () => {
  it('en sombra el sesgo macro se calcula exactamente igual que antes de M12', () => {
    const m = effectiveMacro(DEFAULT_ENSEMBLE);
    expect(m.fundingWeight).toBe(DEFAULT_ENSEMBLE.macro.fundingWeight);
    expect(m.trendWeight).toBe(DEFAULT_ENSEMBLE.macro.trendWeight);
  });

  it('al promocionar, el funding sale del macro y su peso pasa a la tendencia', () => {
    const cfg = {
      ...DEFAULT_ENSEMBLE,
      fundamental: { ...DEFAULT_ENSEMBLE.fundamental, mode: 'active' as const },
    };
    const m = effectiveMacro(cfg);
    expect(m.fundingWeight).toBe(0);
    // Renormalizar no es cosmético: sin esto |bias| <= 0,5 y el escudo macro, que exige
    // |bias| > conflictThreshold (0,5), no se dispararía nunca más. Se habría desactivado una
    // salvaguarda sin que nadie lo decidiera.
    expect(m.trendWeight).toBe(1);
    expect(m.trendWeight).toBeGreaterThan(cfg.macro.conflictThreshold);
  });
});

describe('buildSignal con el score en sombra', () => {
  function velas(n: number): Candle[] {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const out: Candle[] = [];
    let price = 100;
    for (let i = 0; i < n; i++) {
      const open = price;
      const close = Math.max(1, price + Math.sin(i / 6) * 0.9 + (rnd() - 0.5) * 1.2);
      out.push({
        symbol: 'BTCUSDT',
        interval: '1m',
        openTime: i * 60_000,
        open,
        high: Math.max(open, close) + 0.5,
        low: Math.min(open, close) - 0.5,
        close,
        volume: 10,
        closeTime: i * 60_000 + 59_999,
        closed: true,
      });
      price = close;
    }
    return out;
  }

  const candles = velas(150);
  const votes = new IndicatorRegistry().computeVotes(candles);
  const price = candles[candles.length - 1]!.close;
  const macro: Macro = {
    bias: 0.1,
    funding: 0.00009,
    weekly_trend: 0.1,
    label: 'neutral',
    confluence: 'neutral',
    applied: true,
  };

  it('la decisión real es idéntica con y sin el score mientras esté en sombra', () => {
    const sin = buildSignal({
      symbol: 'BTCUSDT',
      price,
      votes,
      config: { ...DEFAULT_ENSEMBLE, fundamental: { ...CFG, mode: 'off' } },
      equity: 10_000,
      interval: '1m',
      macro,
    });
    const con = buildSignal({
      symbol: 'BTCUSDT',
      price,
      votes,
      config: DEFAULT_ENSEMBLE,
      equity: 10_000,
      interval: '1m',
      macro,
      fundamentalArtifact: artefacto(),
    });
    expect(con.action).toBe(sin.action);
    expect(con.probs.BUY).toBeCloseTo(sin.probs.BUY, 12);
    expect(con.probs.SELL).toBeCloseTo(sin.probs.SELL, 12);
    expect(con.fundamental?.mode).toBe('shadow');
    expect(con.fundamental?.applied).toBe(false);
  });

  it('registra qué habría decidido con la penalización aplicada', () => {
    const sig = buildSignal({
      symbol: 'BTCUSDT',
      price,
      votes,
      config: DEFAULT_ENSEMBLE,
      equity: 10_000,
      interval: '1m',
      macro,
      fundamentalArtifact: artefacto(),
    });
    expect(sig.fundamental?.penalty).toBeGreaterThan(0);
    expect(sig.fund_shadow_action).toBeDefined();
    expect(sig.fund_shadow_confidence).toBeGreaterThan(0);
  });

  it('sin artefacto no hay sombra que registrar', () => {
    const sig = buildSignal({
      symbol: 'BTCUSDT',
      price,
      votes,
      config: DEFAULT_ENSEMBLE,
      equity: 10_000,
      interval: '1m',
      macro,
    });
    expect(sig.fundamental?.stale).toBe(true);
    expect(sig.fund_shadow_action).toBeUndefined();
  });
});
