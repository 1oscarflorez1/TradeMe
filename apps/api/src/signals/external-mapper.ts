import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { IndicatorKind, Vote, VoteSource } from '../indicators/types.js';

interface SignalMap {
  score: number;
  confidence: number;
}
interface IndicatorMapping {
  kind?: IndicatorKind;
  ttl_ms?: number;
  map?: Record<string, SignalMap>;
  range?: { min: number; max: number };
}
type Config = Record<string, Record<string, IndicatorMapping>>;

export interface ExternalPayload {
  indicator: string;
  symbol: string;
  signal?: string;
  value?: number;
  ts?: string;
}

/** Traduce señales externas (TradingView / Reditum) a votos normalizados. */
export class ExternalMapper {
  constructor(private readonly config: Config) {}

  static fromFile(path: string): ExternalMapper {
    return new ExternalMapper(parse(readFileSync(path, 'utf8')) as Config);
  }

  map(source: VoteSource, payload: ExternalPayload): Vote | null {
    const mapping = this.config[source]?.[payload.indicator];
    if (!mapping) return null;

    let score: number;
    let confidence: number;

    const discrete = payload.signal ? mapping.map?.[payload.signal] : undefined;
    if (discrete) {
      score = discrete.score;
      confidence = discrete.confidence;
    } else if (payload.value !== undefined && mapping.range) {
      const { min, max } = mapping.range;
      const norm = max === min ? 0 : ((payload.value - min) / (max - min)) * 2 - 1;
      score = Math.max(-1, Math.min(1, norm));
      confidence = Math.abs(score);
    } else {
      return null;
    }

    return {
      key: payload.indicator,
      label: payload.indicator,
      kind: mapping.kind ?? 'custom',
      source,
      value: payload.value ?? score,
      score,
      confidence,
      ts: payload.ts ?? new Date().toISOString(),
      ttlMs: mapping.ttl_ms,
    };
  }
}
