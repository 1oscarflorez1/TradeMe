// Carga (con recarga en caliente) de la política de cuarentena publicada por quant (M10.7).
//
// `ensemble.yaml` declara la cuarentena **inicial**; a partir de ahí manda el expediente. Una
// temporalidad vetada sigue registrando qué habría hecho (columnas `shadow_*`) y sale sola cuando
// esa sombra demuestre ventaja con muestra suficiente — el mismo gobierno que `meta_policy`.
//
// Sin esto, `quarantine_intervals` sería una lista fija que alguien tendría que acordarse de
// vaciar, y ya sabemos cómo acaba eso en este proyecto.
import { existsSync, readFileSync } from 'node:fs';

export interface QuarantineEntry {
  interval: string;
  quarantined: boolean;
  was_quarantined?: boolean;
  changed?: boolean;
  /**
   * Si `ensemble.yaml` listaba esta temporalidad cuando se tomó la decisión (desde 0.72.2). Es lo
   * que distingue «salió por expediente» de «el yaml la ha añadido después». Ver `estadoCuarentena`.
   */
  base_quarantined?: boolean;
  reason: string;
  evidence?: {
    n: number;
    expectancy: number;
    win_rate: number;
    source: 'sombra' | 'real';
    /**
     * Qué daba el mercado en ese periodo, y con qué población se midió. Una temporalidad cuyas 30
     * decisiones caben en 9,8 horas puede estar describiendo un mal martes, no a sí misma.
     *
     * La puerta de SALIDA exige `max(0,05 R, nula_mediana + 0,05 R)` — no-inferioridad: sé algo
     * mejor que un tramo típico del mercado que hubo. `nula_p95` se publica solo como referencia
     * de cuán extremo era el criterio de la v0.46.0, que resultó ser un cupo del 5 % y no un listón.
     *
     * `umbral_salida` es `null` en las claves que operan: la puerta de ENTRADA no usa la nula a
     * propósito, porque exigir significancia para entrar dejaría operando lo malo mientras no se
     * demuestre que lo es.
     */
    nula_mediana?: number;
    nula_p95?: number;
    n_poblacion?: number;
    bloques_poblacion?: number;
    umbral_salida?: number | null;
  };
}

export interface QuarantineSet {
  version?: string;
  updated_at?: string | null;
  /** Con qué se calculó la nula, para poder reproducir un veredicto sin leer el código. */
  nula?: { dias_poblacion: number; permutaciones: number; aplica_a: string };
  intervals: Record<string, QuarantineEntry>;
}

export class QuarantinePolicy {
  private set: QuarantineSet | null;

  constructor(
    private readonly path: string,
    set: QuarantineSet | null,
  ) {
    this.set = set;
  }

  static load(path: string): QuarantinePolicy {
    return new QuarantinePolicy(path, readSet(path));
  }

  reload(): boolean {
    this.set = readSet(this.path);
    return this.set !== null;
  }

  get version(): string | null {
    return this.set?.version ?? null;
  }

  /**
   * ¿Está vetada esta temporalidad?
   *
   * `base` es lo que dice `ensemble.yaml`. El artefacto solo se impone cuando tiene una entrada
   * para ese símbolo y temporalidad: sin medición, manda la configuración. Nunca se levanta una
   * cuarentena por ausencia de datos.
   */
  isQuarantined(symbol: string, interval: string, base: boolean): boolean {
    return estadoCuarentena(this.set?.intervals?.[`${symbol.toUpperCase()}:${interval}`], base);
  }

  entryFor(symbol: string, interval: string): QuarantineEntry | undefined {
    return this.set?.intervals?.[`${symbol.toUpperCase()}:${interval}`];
  }

  meta(): QuarantineSet | null {
    return this.set;
  }
}

/**
 * El estado de cuarentena de una clave a partir de su entrada en el artefacto y del yaml (`base`).
 *
 * Espejo exacto de `quarantine_policy.en_cuarentena` en quant, comprobado con los mismos casos en
 * `packages/core-signals/parity/cuarentena_vectors.json`:
 *
 * - Sin entrada legible, manda el yaml. Nunca se levanta una cuarentena por ausencia de datos.
 * - Con entrada, manda el artefacto: una clave heredada del yaml que salió con su sombra queda
 *   fuera, y quitar la temporalidad del yaml no levanta un veto vigente.
 * - Salvo que la decisión se tomara sin el yaml listándola (`base_quarantined: false`) y ahora sí:
 *   añadir una temporalidad al yaml vuelve a vetarla.
 *
 * Hasta 0.72.1 quant trataba el yaml como suelo absoluto y esta función no: la misma clave estaba
 * fuera de cuarentena aquí y dentro para el piloto, que la volvía a sacar —y a alertar— cada ciclo.
 */
export function estadoCuarentena(entrada: unknown, base: boolean): boolean {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return base;
  const e = entrada as Partial<QuarantineEntry>;
  if (typeof e.quarantined !== 'boolean') return base;
  if (base && e.base_quarantined === false) return true;
  return e.quarantined;
}

function readSet(path: string): QuarantineSet | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as QuarantineSet;
    return parsed && typeof parsed === 'object' && parsed.intervals ? parsed : null;
  } catch {
    return null;
  }
}
