import type { Vote } from '../indicators/types.js';
import type { Signal } from '../domain/signal.js';
import type { EnsembleConfig } from './config.js';
import { aggregate } from './aggregate.js';
import { inferProbs, pickAction } from './inference.js';
import { buildPlan } from './plan.js';

export interface BuildSignalParams {
  symbol: string;
  price: number;
  votes: Vote[];
  config: EnsembleConfig;
  equity: number;
  ts?: string;
}

/** Construye el objeto Signal completo a partir de los votos y la config del ensemble. */
export function buildSignal(params: BuildSignalParams): Signal {
  const { net, regime, votes, atr } = aggregate(params.votes, params.config);
  const probs = inferProbs(net, params.config.temperature, params.config.holdBand);
  const { action, confidence } = pickAction(probs);
  const plan = buildPlan({
    action,
    price: params.price,
    atr,
    regimeLabel: regime.label,
    confidence,
    risk: params.config.risk,
    equity: params.equity,
  });

  return {
    version: '1.0.0',
    symbol: params.symbol,
    ts: params.ts ?? new Date().toISOString(),
    price: params.price,
    regime,
    votes,
    net,
    probs,
    action,
    confidence,
    plan,
    atr,
    model_version: params.config.version,
  };
}
