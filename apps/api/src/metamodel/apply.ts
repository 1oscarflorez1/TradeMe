// Applier del meta-modelo (Módulo 2). Mirror EXACTO de
// apps/quant/trademe_quant/metamodel.py::predict_forest.
// El entrenamiento vive 100% en Python; aquí solo se evalúa el artefacto publicado
// (mismo patrón que los calibradores: sin dependencias nativas, microsegundos por señal).
import { existsSync, readFileSync } from 'node:fs';
import type { Vote } from '../indicators/types.js';
import type { Probs } from '../domain/signal.js';

export interface ForestTree {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
}

export interface MetaModelArtifact {
  kind: string;
  version?: string;
  features: string[];
  trees: ForestTree[];
  threshold?: number;
  auc?: number;
  n?: number;
  trained_at?: string;
}

/** Evalúa el bosque: media de la probabilidad de éxito que da cada árbol. */
export function predictForest(art: MetaModelArtifact, x: number[]): number {
  const trees = art.trees;
  if (!trees || trees.length === 0) return 0.5;
  let total = 0;
  for (const t of trees) {
    let node = 0;
    while (t.left[node] !== -1) {
      const f = t.feature[node]!;
      node = (x[f] ?? 0) <= t.threshold[node]! ? t.left[node]! : t.right[node]!;
    }
    total += t.value[node]!;
  }
  return total / trees.length;
}

/** Vector de features en el orden canónico del artefacto (mirror de row_to_features). */
export function featureVector(params: {
  net: number;
  confidence: number;
  probs: Probs;
  adx: number;
  atr: number;
  price: number;
  votes: Vote[];
  regimeLabel: string;
  direction: string;
}): number[] {
  const s = (key: string): number => params.votes.find((v) => v.key === key)?.score ?? 0;
  return [
    params.net,
    params.confidence,
    params.probs.BUY,
    params.probs.HOLD,
    params.probs.SELL,
    params.adx,
    params.price > 0 ? params.atr / params.price : 0,
    s('ema_cross'),
    s('macd'),
    s('rsi14'),
    s('bbands'),
    s('stoch14'),
    s('supertrend'),
    params.regimeLabel === 'tendencia' ? 1 : 0,
    params.direction === 'LONG' ? 1 : 0,
  ];
}

/** Carga con recarga en caliente (POST /reload), como los calibradores. */
export class MetaModel {
  private art: MetaModelArtifact | null;
  constructor(
    private readonly path: string,
    art: MetaModelArtifact | null,
  ) {
    this.art = art;
  }
  static load(path: string): MetaModel {
    return new MetaModel(path, read(path));
  }
  reload(): boolean {
    this.art = read(this.path);
    return this.art !== null;
  }
  get version(): string | null {
    return this.art?.version ?? null;
  }
  get threshold(): number | null {
    return this.art?.threshold ?? null;
  }
  get ready(): boolean {
    return this.art !== null && this.art.trees.length > 0;
  }
  predict(x: number[]): number | null {
    return this.art ? predictForest(this.art, x) : null;
  }
}

function read(path: string): MetaModelArtifact | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as MetaModelArtifact;
  } catch {
    return null;
  }
}
