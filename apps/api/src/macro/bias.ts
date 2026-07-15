import { clamp } from '../indicators/normalize.js';
import type { Macro } from '../domain/signal.js';
import type { MacroConfig } from '../ensemble/config.js';

export interface MacroInput {
  funding: number;
  price: number;
  weeklyEma: number;
}

/**
 * Sesgo macro en [-1,+1] a partir de funding (sentimiento apalancado) y tendencia semanal.
 * Funding muy positivo (largos saturados) => sesgo bajista; precio > EMA 1w => alcista.
 */
export function computeMacroBias(input: MacroInput, config: MacroConfig): Macro {
  const fundingComponent = -Math.tanh(input.funding / config.fundingScale);
  const trendComponent =
    input.weeklyEma > 0
      ? Math.tanh((input.price - input.weeklyEma) / (input.weeklyEma * config.trendScale))
      : 0;
  const bias = clamp(config.fundingWeight * fundingComponent + config.trendWeight * trendComponent);
  const label = bias > 0.2 ? 'alcista' : bias < -0.2 ? 'bajista' : 'neutral';
  return {
    bias,
    funding: input.funding,
    weekly_trend: trendComponent,
    label,
    confluence: 'neutral',
    applied: true,
  };
}
