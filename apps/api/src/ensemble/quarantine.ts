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
  reason: string;
  evidence?: { n: number; expectancy: number; win_rate: number; source: 'sombra' | 'real' };
}

export interface QuarantineSet {
  version?: string;
  updated_at?: string | null;
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
    const e = this.set?.intervals?.[`${symbol.toUpperCase()}:${interval}`];
    return e ? e.quarantined : base;
  }

  entryFor(symbol: string, interval: string): QuarantineEntry | undefined {
    return this.set?.intervals?.[`${symbol.toUpperCase()}:${interval}`];
  }

  meta(): QuarantineSet | null {
    return this.set;
  }
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
