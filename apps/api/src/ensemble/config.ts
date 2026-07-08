import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface RegimeMultipliers {
  trend: number;
  momentum: number;
  reversion: number;
}

export interface RiskConfig {
  atrStopMult: number;
  tpRMultiple: number;
  riskPct: number;
}

export interface EnsembleConfig {
  version: string;
  temperature: number;
  holdBand: number;
  weights: Record<string, number>;
  externalWeights: Record<string, number>;
  regime: { adxThreshold: number; trend: RegimeMultipliers; range: RegimeMultipliers };
  risk: RiskConfig;
}

export const DEFAULT_ENSEMBLE: EnsembleConfig = {
  version: 'ens-default',
  temperature: 0.5,
  holdBand: 0.15,
  weights: { ema_cross: 1, macd: 1, rsi14: 1, bbands: 1, stoch14: 1 },
  externalWeights: { ninjatrader: 2, tradingview: 1.5 },
  regime: {
    adxThreshold: 25,
    trend: { trend: 1.5, momentum: 1.5, reversion: 0.6 },
    range: { trend: 0.6, momentum: 0.8, reversion: 1.5 },
  },
  risk: { atrStopMult: 1.5, tpRMultiple: 2, riskPct: 0.01 },
};

interface RawRegimeMult {
  trend?: number;
  momentum?: number;
  reversion?: number;
}
interface RawConfig {
  version?: string;
  temperature?: number;
  hold_band?: number;
  weights?: Record<string, number>;
  external_weights?: Record<string, number>;
  regime?: { adx_threshold?: number; trend?: RawRegimeMult; range?: RawRegimeMult };
  risk?: { atr_stop_mult?: number; tp_r_multiple?: number; risk_pct?: number };
}

function mult(raw: RawRegimeMult | undefined, fallback: RegimeMultipliers): RegimeMultipliers {
  return {
    trend: raw?.trend ?? fallback.trend,
    momentum: raw?.momentum ?? fallback.momentum,
    reversion: raw?.reversion ?? fallback.reversion,
  };
}

export function fromRaw(raw: RawConfig): EnsembleConfig {
  const d = DEFAULT_ENSEMBLE;
  return {
    version: raw.version ?? d.version,
    temperature: raw.temperature ?? d.temperature,
    holdBand: raw.hold_band ?? d.holdBand,
    weights: raw.weights ?? d.weights,
    externalWeights: raw.external_weights ?? d.externalWeights,
    regime: {
      adxThreshold: raw.regime?.adx_threshold ?? d.regime.adxThreshold,
      trend: mult(raw.regime?.trend, d.regime.trend),
      range: mult(raw.regime?.range, d.regime.range),
    },
    risk: {
      atrStopMult: raw.risk?.atr_stop_mult ?? d.risk.atrStopMult,
      tpRMultiple: raw.risk?.tp_r_multiple ?? d.risk.tpRMultiple,
      riskPct: raw.risk?.risk_pct ?? d.risk.riskPct,
    },
  };
}

export function loadEnsemble(path: string): EnsembleConfig {
  return fromRaw(parse(readFileSync(path, 'utf8')) as RawConfig);
}
