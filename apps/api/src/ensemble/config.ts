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

export interface PlanConfig {
  /** Validez por defecto, en velas, cuando la temporalidad no tiene entrada propia. */
  validCandles: number;
  /**
   * Frescura de la ENTRADA por temporalidad (M10.5).
   *
   * Cuánto tiempo sigue teniendo sentido entrar al precio propuesto. Las 3 velas fijas anteriores
   * eran 3 minutos en 1m y 12 horas en 4h: el mismo número para horizontes que se diferencian en
   * tres órdenes de magnitud. En las cortas se descartaba una entrada todavía buena; en las largas
   * se mantenía viva mucho después de que el contexto hubiera cambiado.
   *
   * No confundir con `EvaluationConfig.horizonByTf`: esto decide hasta cuándo se puede entrar, no
   * cuánto tiempo se le da a la operación una vez abierta.
   */
  validCandlesByTf: Record<string, number>;
}

export interface EvaluationConfig {
  /** Horizonte por defecto, en velas, cuando la temporalidad no tiene entrada propia. */
  horizon: number;
  /**
   * Velas que se le dan a una operación antes de cerrarla por tiempo (M10.5).
   *
   * **Este es el parámetro que produce los «timeout»**, no la frescura de la entrada. Estaba fijo en
   * 20 velas para todas las temporalidades, escrito como valor por defecto de una función y sin
   * forma de configurarlo: el 31 % de las decisiones acababa expirando sin resolverse y 1d/1w/1M no
   * llegaban a evaluarse nunca, porque 20 velas de 1d son 20 días y el histórico no llegaba.
   *
   * Con stop a 1,5·ATR y objetivo a 2R el precio tiene que recorrer 3·ATR. Bajo un paseo aleatorio
   * de pasos del tamaño del ATR eso pide del orden de 9 velas: por debajo de ahí un «timeout» no
   * mide que la operación no fuera a ninguna parte, mide que no le dimos tiempo. Por arriba, en las
   * temporalidades largas, cada vela ya es tanto tiempo de reloj que esperar 20 significa no cerrar
   * nunca. De ahí que baje al alargarse la temporalidad.
   */
  horizonByTf: Record<string, number>;
}

export interface MacroConfig {
  enabled: boolean;
  wMacro: number;
  fundingWeight: number;
  trendWeight: number;
  fundingScale: number;
  trendScale: number;
  conflictDowngrade: boolean;
  conflictThreshold: number;
  enableScaling: boolean;
  tfScale: Record<string, number>;
}

export interface EnsembleConfig {
  version: string;
  temperature: number;
  holdBand: number;
  weights: Record<string, number>;
  externalWeights: Record<string, number>;
  regime: {
    adxThreshold: number;
    adxLo: number;
    adxHi: number;
    trend: RegimeMultipliers;
    range: RegimeMultipliers;
  };
  risk: RiskConfig;
  macro: MacroConfig;
  plan: PlanConfig;
  evaluation: EvaluationConfig;
  /**
   * Temporalidades en cuarentena: se calculan y se registran, pero no emiten señal operable.
   *
   * 4h acumulaba −0,485 R en 89 decisiones (69 cortos con el 85,6 % al stop, contra una tendencia
   * alcista de fondo). Una temporalidad que pierde de forma sistemática no debería seguir
   * proponiendo entradas mientras se le busca el contexto direccional que le falta. Sigue
   * midiéndose: lo que se retira es el permiso para operar, no la observación.
   */
  quarantineIntervals: string[];
  /** Resuelto por temporalidad en `forInterval`. */
  quarantined?: boolean;
  /** Resuelto por símbolo+temporalidad en `forInterval` (1 = sin desinflar). */
  independenceFactor?: number;
}

export const DEFAULT_ENSEMBLE: EnsembleConfig = {
  version: 'ens-default',
  temperature: 0.5,
  holdBand: 0.06,
  weights: { ema_cross: 1, macd: 1, supertrend: 1, rsi14: 1, bbands: 1, stoch14: 1 },
  externalWeights: { tradingview: 2 },
  regime: {
    adxThreshold: 25,
    adxLo: 15,
    adxHi: 35,
    trend: { trend: 1.5, momentum: 1.5, reversion: 0.6 },
    range: { trend: 0.6, momentum: 0.8, reversion: 1.5 },
  },
  risk: { atrStopMult: 1.5, tpRMultiple: 2, riskPct: 0.01 },
  macro: {
    enabled: true,
    wMacro: 1,
    fundingWeight: 0.5,
    trendWeight: 0.5,
    fundingScale: 0.0005,
    trendScale: 0.05,
    conflictDowngrade: true,
    conflictThreshold: 0.5,
    enableScaling: false,
    tfScale: { '1m': 0.2, '5m': 0.3, '15m': 0.4, '30m': 0.5, '1h': 0.6, '4h': 0.8, '1d': 1, '1w': 1, '1M': 1 },
  },
  plan: {
    validCandles: 3,
    validCandlesByTf: {
      '1m': 5,
      '5m': 5,
      '15m': 4,
      '30m': 4,
      '1h': 3,
      '4h': 3,
      '1d': 2,
      '1w': 2,
      '1M': 1,
    },
  },
  evaluation: {
    horizon: 20,
    horizonByTf: {
      '1m': 30,
      '5m': 25,
      '15m': 20,
      '30m': 20,
      '1h': 18,
      '4h': 15,
      '1d': 10,
      '1w': 6,
      '1M': 4,
    },
  },
  quarantineIntervals: ['4h'],
};

/** Frescura de la entrada, en velas, para una temporalidad. */
export function validCandlesFor(cfg: EnsembleConfig, interval: string): number {
  const v = cfg.plan.validCandlesByTf?.[interval];
  return typeof v === 'number' && v > 0 ? v : cfg.plan.validCandles;
}

/** Velas que se le dan a la operación antes de cerrarla por tiempo. */
export function horizonFor(cfg: EnsembleConfig, interval: string): number {
  const v = cfg.evaluation?.horizonByTf?.[interval];
  return typeof v === 'number' && v > 0 ? v : (cfg.evaluation?.horizon ?? 20);
}

/**
 * Especializa la configuración para un símbolo y temporalidad concretos.
 *
 * Deja resueltos los tres ajustes que dependen de la temporalidad —validez del plan, cuarentena y
 * factor de independencia— para que `buildSignal` siga leyendo un único objeto de configuración y
 * ningún punto de llamada tenga que acordarse de aplicarlos.
 */
export function forInterval(
  cfg: EnsembleConfig,
  interval: string,
  independenceFactor = 1,
): EnsembleConfig {
  return {
    ...cfg,
    plan: { ...cfg.plan, validCandles: validCandlesFor(cfg, interval) },
    quarantined: (cfg.quarantineIntervals ?? []).includes(interval),
    independenceFactor,
  };
}

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
  regime?: {
    adx_threshold?: number;
    adx_lo?: number;
    adx_hi?: number;
    trend?: RawRegimeMult;
    range?: RawRegimeMult;
  };
  risk?: { atr_stop_mult?: number; tp_r_multiple?: number; risk_pct?: number };
  plan?: { valid_candles?: number; valid_candles_by_tf?: Record<string, number> };
  evaluation?: { horizon?: number; horizon_by_tf?: Record<string, number> };
  quarantine_intervals?: string[];
  macro?: {
    enabled?: boolean;
    w_macro?: number;
    enable_scaling?: boolean;
    tf_scale?: Record<string, number>;
    funding_weight?: number;
    trend_weight?: number;
    funding_scale?: number;
    trend_scale?: number;
    conflict_downgrade?: boolean;
    conflict_threshold?: number;
  };
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
      adxLo: raw.regime?.adx_lo ?? d.regime.adxLo,
      adxHi: raw.regime?.adx_hi ?? d.regime.adxHi,
      trend: mult(raw.regime?.trend, d.regime.trend),
      range: mult(raw.regime?.range, d.regime.range),
    },
    risk: {
      atrStopMult: raw.risk?.atr_stop_mult ?? d.risk.atrStopMult,
      tpRMultiple: raw.risk?.tp_r_multiple ?? d.risk.tpRMultiple,
      riskPct: raw.risk?.risk_pct ?? d.risk.riskPct,
    },
    macro: {
      enabled: raw.macro?.enabled ?? d.macro.enabled,
      wMacro: raw.macro?.w_macro ?? d.macro.wMacro,
      fundingWeight: raw.macro?.funding_weight ?? d.macro.fundingWeight,
      trendWeight: raw.macro?.trend_weight ?? d.macro.trendWeight,
      fundingScale: raw.macro?.funding_scale ?? d.macro.fundingScale,
      trendScale: raw.macro?.trend_scale ?? d.macro.trendScale,
      conflictDowngrade: raw.macro?.conflict_downgrade ?? d.macro.conflictDowngrade,
      conflictThreshold: raw.macro?.conflict_threshold ?? d.macro.conflictThreshold,
      enableScaling: raw.macro?.enable_scaling ?? d.macro.enableScaling,
      tfScale: raw.macro?.tf_scale ?? d.macro.tfScale,
    },
    plan: {
      validCandles: raw.plan?.valid_candles ?? d.plan.validCandles,
      validCandlesByTf: raw.plan?.valid_candles_by_tf ?? d.plan.validCandlesByTf,
    },
    evaluation: {
      horizon: raw.evaluation?.horizon ?? d.evaluation.horizon,
      horizonByTf: raw.evaluation?.horizon_by_tf ?? d.evaluation.horizonByTf,
    },
    quarantineIntervals: raw.quarantine_intervals ?? d.quarantineIntervals,
  };
}

export function loadEnsemble(path: string): EnsembleConfig {
  return fromRaw(parse(readFileSync(path, 'utf8')) as RawConfig);
}
