import type { Vote } from '../indicators/types.js';
import type { Action, Direction, Macro, Signal } from '../domain/signal.js';
import { intervalMs, type Interval } from '../domain/candle.js';
import type { EnsembleConfig } from './config.js';
import { aggregate } from './aggregate.js';
import { confluence, inferProbs, pickAction } from './inference.js';
import { buildPlan } from './plan.js';

export interface BuildSignalParams {
  symbol: string;
  price: number;
  votes: Vote[];
  config: EnsembleConfig;
  equity: number;
  interval: Interval;
  macro?: Macro;
  ts?: string;
}

function directionOf(action: Action): Direction {
  if (action === 'BUY') return 'LONG';
  if (action === 'SELL') return 'SHORT';
  return 'FLAT';
}

/** Construye el objeto Signal completo a partir de los votos y la config del ensemble. */
export function buildSignal(params: BuildSignalParams): Signal {
  const ts = params.ts ?? new Date().toISOString();
  const validUntil = new Date(
    Date.parse(ts) + params.config.plan.validCandles * intervalMs(params.interval),
  ).toISOString();
  const { net, regime, votes, atr } = aggregate(params.votes, params.config);
  const macroCfg = params.config.macro;
  const macroInput =
    params.macro && macroCfg.enabled
      ? { bias: params.macro.bias, wMacro: macroCfg.wMacro }
      : undefined;
  const probs = inferProbs(net, params.config.temperature, params.config.holdBand, macroInput);
  let { action, confidence } = pickAction(probs);

  let macroOut: Macro | undefined;
  if (params.macro && macroCfg.enabled) {
    const conf = confluence(net, params.macro.bias);
    // Escudo macro: no operar contra un sesgo macro fuerte y en conflicto.
    if (
      macroCfg.conflictDowngrade &&
      conf === 'conflict' &&
      Math.abs(params.macro.bias) > macroCfg.conflictThreshold
    ) {
      action = 'HOLD';
      confidence = probs.HOLD;
    }
    macroOut = { ...params.macro, confluence: conf };
  }
  const direction = directionOf(action);
  const plan = buildPlan({
    action,
    price: params.price,
    atr,
    regimeLabel: regime.label,
    confidence,
    risk: params.config.risk,
    equity: params.equity,
    validUntil,
  });

  return {
    version: '1.0.0',
    symbol: params.symbol,
    ts,
    price: params.price,
    regime,
    votes,
    net,
    probs,
    action,
    direction,
    confidence,
    macro: macroOut,
    plan,
    valid_until: validUntil,
    atr,
    model_version: params.config.version,
  };
}
