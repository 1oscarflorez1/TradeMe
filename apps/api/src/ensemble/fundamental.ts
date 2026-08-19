/**
 * Fundamental Score: el funding penaliza SOLO los largos (M12).
 *
 * Mirror de `apps/quant/trademe_quant/fundamental.py`. Allí está la medición que lo justifica; aquí
 * solo se aplica. Las dos funciones puras de este fichero —`percentileOf` y `longPenalty`— entran
 * en la suite de paridad: si Node y Python dejaran de coincidir, el backtest mediría otra cosa que
 * la que hace la plataforma.
 *
 * El reparto es el mismo que el del calibrador y el meta-modelo: Python publica la **distribución
 * de referencia** (los cortes de percentil de los últimos 90 días) y Node sitúa contra ella el
 * funding del momento. La api no consulta las tablas de la Data Intelligence Layer.
 *
 * Asimetría, en una línea: `logit_BUY -= w · penalización`, y `logit_SELL` **no se toca**. El efecto
 * medido solo existe en los largos; cablearlo simétrico añadiría ruido en la mitad de las
 * decisiones.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Fundamental } from '../domain/signal.js';
import type { FundamentalConfig } from './config.js';

export interface FundamentalArtifact {
  version: string;
  symbol: string;
  created_at?: string;
  window_days: number;
  n: number;
  stale: boolean;
  start: number;
  /** Cortes p0..p100 de la ventana móvil, ordenados. Vacío cuando `stale`. */
  knots: number[];
}

// ---------------------------------------------------------------------------------------------
// Funciones puras — mirror exacto de fundamental.py (suite de paridad).
// ---------------------------------------------------------------------------------------------

/**
 * Sitúa `value` en la distribución descrita por `knots` (p0..p100 ordenados) → [0,1].
 * Fuera de rango satura: un funding nunca visto es «el más alto conocido», no un percentil 140.
 */
export function percentileOf(knots: number[], value: number): number {
  const n = knots.length;
  if (n === 0) return 0.5; // sin distribución no hay percentil; el centro es la respuesta neutra
  if (n === 1) return value <= (knots[0] as number) ? 0 : 1;
  if (value <= (knots[0] as number)) return 0;
  if (value >= (knots[n - 1] as number)) return 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((knots[mid] as number) <= value) lo = mid;
    else hi = mid;
  }
  const tramo = (knots[hi] as number) - (knots[lo] as number);
  const frac = tramo <= 0 ? 0 : (value - (knots[lo] as number)) / tramo;
  return (lo + frac) / (n - 1);
}

/**
 * Penalización a los largos, en [0,1], a partir del percentil de funding.
 *
 * Cero hasta `start` (el tercil donde los largos ganaban +0,200 R) y creciente en línea recta
 * hasta 1 en el percentil máximo. Sin parámetros de forma: una recta no se puede sobreajustar a
 * posteriori, y la medición no distingue entre una recta y cualquier otra curva monótona.
 */
export function longPenalty(pct: number, start: number): number {
  if (start >= 1) return 0;
  if (pct <= start) return 0;
  return Math.min(1, Math.max(0, (pct - start) / (1 - start)));
}

// ---------------------------------------------------------------------------------------------
// Carga del artefacto (con recarga en caliente vía POST /reload).
// ---------------------------------------------------------------------------------------------
export class Fundamentals {
  private bySymbol = new Map<string, FundamentalArtifact>();
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  static load(dir: string): Fundamentals {
    const f = new Fundamentals(dir);
    f.reload();
    return f;
  }

  /** Relee los artefactos de disco. Devuelve true si hay al menos uno cargado. */
  reload(symbols?: string[]): boolean {
    const nuevos = new Map<string, FundamentalArtifact>();
    for (const sym of symbols ?? [...this.bySymbol.keys()]) {
      const art = readArtifact(this.dir, sym);
      if (art) nuevos.set(sym.toUpperCase(), art);
    }
    // Sin lista de símbolos y sin caché previa no hay nada que releer: se cargará bajo demanda.
    if (nuevos.size > 0 || symbols) this.bySymbol = nuevos;
    return this.bySymbol.size > 0;
  }

  get(symbol: string): FundamentalArtifact | undefined {
    const clave = symbol.toUpperCase();
    const cacheado = this.bySymbol.get(clave);
    if (cacheado) return cacheado;
    const art = readArtifact(this.dir, clave);
    if (art) this.bySymbol.set(clave, art);
    return art ?? undefined;
  }

  version(symbol: string): string | null {
    return this.get(symbol)?.version ?? null;
  }
}

function readArtifact(dir: string, symbol: string): FundamentalArtifact | null {
  try {
    const ruta = join(dir, `${symbol.toUpperCase()}.json`);
    if (!existsSync(ruta)) return null;
    return JSON.parse(readFileSync(ruta, 'utf8')) as FundamentalArtifact;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Cómputo del bloque `fundamental` de la señal.
// ---------------------------------------------------------------------------------------------
export interface FundamentalInput {
  /**
   * Funding del momento. `undefined` significa **no se sabe**, y eso NO es cero.
   *
   * Un cero por defecto se situaría en la distribución como cualquier otro valor y produciría un
   * percentil con pinta de medición. Es el error que tuvo esta función en 0.38.0: con el sesgo
   * macro apagado el funding nunca llegaba, se sustituía por 0, y el Panel enseñaba «percentil 1»
   * como si fuera el estado del mercado.
   */
  funding?: number;
  artifact?: FundamentalArtifact | null;
  config: FundamentalConfig;
}

/**
 * Devuelve el bloque `fundamental` de la señal, o `undefined` si está apagado.
 *
 * `applied` es la única bandera que decide si esto toca la decisión. En `shadow` se calcula todo
 * igual y se registra, pero `applied=false` y la penalización efectiva es 0. Un artefacto `stale`
 * —o ausente— también da 0: una fuente muda no debe empujar la decisión en ninguna dirección, y
 * menos disimuladamente.
 */
export function computeFundamental(input: FundamentalInput): Fundamental | undefined {
  const cfg = input.config;
  if (cfg.mode === 'off') return undefined;
  const art = input.artifact ?? null;
  const funding = input.funding;
  // Sin funding no hay nada que situar. Se declara `stale` igual que si faltara la distribución:
  // «no lo sé» y «vale cero» no pueden acabar en el mismo sitio.
  const stale = funding === undefined || !art || art.stale || art.knots.length === 0;
  const start = art?.start ?? cfg.start;
  const percentile = stale ? 0 : percentileOf(art.knots, funding);
  const penalty = stale ? 0 : longPenalty(percentile, start);
  return {
    funding: funding ?? null,
    percentile,
    penalty,
    w_fund: cfg.wFund,
    mode: cfg.mode,
    applied: cfg.mode === 'active' && !stale,
    stale,
    n: art?.n ?? 0,
    version: art?.version ?? null,
  };
}

/** Término que se resta al logit BUY. Cero salvo que el score esté promocionado y con datos. */
export function fundamentalTerm(f: Fundamental | undefined): number {
  if (!f || !f.applied) return 0;
  return f.w_fund * f.penalty;
}
