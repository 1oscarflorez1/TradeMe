import type { Vote } from '../indicators/types.js';
import type { Signal } from '../domain/signal.js';
import type { EnsembleConfig } from './config.js';
import { aggregate } from './aggregate.js';
import { inferProbs, pickAction } from './inference.js';

export interface BuildSignalParams {
  symbol: string;
  price: number;
  votes: Vote[];
  config: EnsembleConfig;
  ts?: string;
}

/** Construye el objeto Signal completo a partir de los votos y la config del ensemble. */
export function buildSignal(params: BuildSignalParams): Signal {
  const { net, regime, votes, atr } = aggregate(params.votes, params.config);
  const probs = inferProbs(net, params.config.temperature, params.config.holdBand);
  const { action, confidence } = pickAction(probs);

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
    plan: [], // el plan de acción llega en M4
    atr,
    model_version: params.config.version,
  };
}
