import type { Vote } from '../indicators/types.js';

export type Action = 'BUY' | 'HOLD' | 'SELL';
export type Direction = 'LONG' | 'SHORT' | 'FLAT';

export interface Macro {
  bias: number;
  funding: number;
  weekly_trend: number;
  label: 'alcista' | 'bajista' | 'neutral';
  confluence: 'aligned' | 'conflict' | 'neutral';
  applied: boolean;
}

export interface Regime {
  adx: number;
  label: 'tendencia' | 'rango';
}

export interface Probs {
  BUY: number;
  HOLD: number;
  SELL: number;
}

export interface PlanStep {
  step: number;
  title: string;
  detail?: string;
}

/** Objeto de señal completo (contrato core-signals). */
export interface Signal {
  version: string;
  symbol: string;
  ts: string;
  price: number;
  regime: Regime;
  votes: Vote[];
  net: number;
  probs: Probs;
  action: Action;
  direction: Direction;
  confidence: number;
  calibrated_confidence?: number;
  calibration_version?: string;
  macro?: Macro;
  plan: PlanStep[];
  valid_until: string;
  atr: number;
  model_version: string;
}
