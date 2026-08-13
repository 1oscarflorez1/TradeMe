// Carga (con recarga en caliente) del artefacto de independencia producido por quant.
//
// El ensemble agrega seis votos internos como si fueran seis evidencias. Medido sobre los registros
// reales, en 4h equivalen a 1,41 votos independientes: EMA/MACD/Supertrend derivan de la misma serie
// suavizada y RSI/Bollinger/Estocástico son tres lecturas del mismo desplazamiento. La confianza del
// softmax, calculada como si las seis fueran independientes, salía inflada.
//
// Aquí solo se EVALÚA el factor publicado; medirlo es trabajo de `apps/quant` (independence.py), que
// tiene la muestra completa. Mismo patrón que `calibrators.json` y `metamodel.json`.
import { existsSync, readFileSync } from 'node:fs';

export interface IndependenceEntry {
  n: number;
  votes: number;
  effective: number;
  first_factor: number;
  factor: number;
}

export interface IndependenceSet {
  version: string;
  generated_at?: string;
  min_samples?: number;
  floor?: number;
  entries: Record<string, IndependenceEntry>;
}

export class Independence {
  private set: IndependenceSet | null;

  constructor(
    private readonly path: string,
    set: IndependenceSet | null,
  ) {
    this.set = set;
  }

  static load(path: string): Independence {
    return new Independence(path, readSet(path));
  }

  /** Relee el artefacto desde disco (POST /reload). Devuelve true si cargó algo. */
  reload(): boolean {
    this.set = readSet(this.path);
    return this.set !== null;
  }

  get version(): string | null {
    return this.set?.version ?? null;
  }

  /**
   * Factor de desinflado para un símbolo y temporalidad.
   *
   * Sin medición devuelve 1 (no se desinfla). Inventar un ajuste con cuatro datos sería peor que
   * no ajustar: `independence.py` solo publica claves con muestra suficiente, y las demás caen aquí.
   */
  factorFor(symbol: string, interval: string): number {
    const e = this.set?.entries?.[`${symbol.toUpperCase()}:${interval}`];
    if (!e || !Number.isFinite(e.factor) || e.factor <= 0) return 1;
    return Math.min(1, e.factor);
  }

  entryFor(symbol: string, interval: string): IndependenceEntry | undefined {
    return this.set?.entries?.[`${symbol.toUpperCase()}:${interval}`];
  }

  meta(): IndependenceSet | null {
    return this.set;
  }
}

function readSet(path: string): IndependenceSet | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as IndependenceSet;
    return parsed && typeof parsed === 'object' && parsed.entries ? parsed : null;
  } catch {
    return null;
  }
}
