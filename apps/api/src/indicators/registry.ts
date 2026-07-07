import type { Candle } from '../domain/candle.js';
import type { Indicator, Vote } from './types.js';
import { BUILTIN_INDICATORS } from './builtin.js';

/** Registro de indicadores disponibles (autodescubierto de forma estática y tipada). */
export class IndicatorRegistry {
  constructor(private readonly indicators: Indicator[] = BUILTIN_INDICATORS) {}

  /** Catálogo para `GET /indicators` (metadatos, sin calcular). */
  catalog(): Array<Pick<Indicator, 'key' | 'label' | 'kind' | 'defaultParams'>> {
    return this.indicators.map(({ key, label, kind, defaultParams }) => ({
      key,
      label,
      kind,
      defaultParams,
    }));
  }

  /** Calcula los votos internos sobre las velas dadas. */
  computeVotes(candles: Candle[]): Vote[] {
    const lastCandle = candles.length > 0 ? candles[candles.length - 1] : undefined;
    const ts = lastCandle ? new Date(lastCandle.closeTime).toISOString() : new Date().toISOString();

    const votes: Vote[] = [];
    for (const indicator of this.indicators) {
      if (candles.length < indicator.minCandles) continue;
      const reading = indicator.compute(candles);
      if (!reading) continue;
      votes.push({
        key: indicator.key,
        label: indicator.label,
        kind: indicator.kind,
        source: 'internal',
        value: reading.value,
        score: reading.score,
        confidence: reading.confidence,
        ts,
        meta: reading.meta,
      });
    }
    return votes;
  }
}
