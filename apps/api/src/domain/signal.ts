import type { Vote } from '../indicators/types.js';

export type Action = 'BUY' | 'HOLD' | 'SELL';

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
  confidence: number;
  plan: PlanStep[];
  atr: number;
  model_version: string;
}
