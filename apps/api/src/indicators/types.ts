import type { Candle } from '../domain/candle.js';

export type IndicatorKind =
  'trend' | 'momentum' | 'reversion' | 'volatility' | 'context' | 'custom';

export type VoteSource = 'internal' | 'ninjatrader' | 'tradingview';

/** Lectura normalizada de un indicador. `score` en [-1,+1] (+ = sesgo comprador). */
export interface IndicatorReading {
  value: number;
  score: number;
  confidence: number;
  meta?: Record<string, unknown>;
}

/** Plugin de indicador: consume velas y emite una lectura normalizada. */
export interface Indicator {
  key: string;
  label: string;
  kind: IndicatorKind;
  defaultParams: Record<string, number>;
  minCandles: number;
  compute(candles: Candle[]): IndicatorReading | null;
}

/** Voto que llega al ensemble (interno o externo), con la misma normalización. */
export interface Vote {
  key: string;
  label: string;
  kind: IndicatorKind;
  source: VoteSource;
  value: number;
  score: number;
  confidence: number;
  ts: string;
  ttlMs?: number;
  weight?: number;
  meta?: Record<string, unknown>;
}
