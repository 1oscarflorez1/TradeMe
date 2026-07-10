import type { Vote } from '../indicators/types.js';
import type { Regime } from '../domain/signal.js';
import type { EnsembleConfig, RegimeMultipliers } from './config.js';

export interface Aggregation {
  net: number;
  regime: Regime;
  votes: Vote[];
  atr: number;
}

// ADX (contexto) y ATR (volatilidad) no votan dirección.
const VOTING_KINDS = new Set(['trend', 'momentum', 'reversion', 'custom']);

function regimeMultiplier(kind: string, mult: RegimeMultipliers): number {
  if (kind === 'trend') return mult.trend;
  if (kind === 'momentum') return mult.momentum;
  if (kind === 'reversion') return mult.reversion;
  return 1; // custom (p. ej. Reditum/TradingView): sin ajuste por régimen
}

/** Combina los votos en un score neto ponderado por régimen. */
export function aggregate(votes: Vote[], config: EnsembleConfig): Aggregation {
  const adx = votes.find((v) => v.key === 'adx14')?.value ?? 0;
  const atr = votes.find((v) => v.key === 'atr14')?.value ?? 0;
  const label = adx >= config.regime.adxThreshold ? 'tendencia' : 'rango';
  const mult = label === 'tendencia' ? config.regime.trend : config.regime.range;

  let weightedSum = 0;
  let weightTotal = 0;
  const out: Vote[] = [];

  for (const v of votes) {
    if (!VOTING_KINDS.has(v.kind)) {
      out.push({ ...v, weight: 0 });
      continue;
    }
    const base =
      v.source === 'internal'
        ? (config.weights[v.key] ?? 1)
        : (config.externalWeights[v.source] ?? 1);
    const weight = base * regimeMultiplier(v.kind, mult);
    weightedSum += v.score * weight;
    weightTotal += weight;
    out.push({ ...v, weight });
  }

  const net = weightTotal > 0 ? weightedSum / weightTotal : 0;
  return { net, regime: { adx, label }, votes: out, atr };
}
