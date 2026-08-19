// Carga (con recarga en caliente) del artefacto de calibradores producido por quant.
import { existsSync, readFileSync } from 'node:fs';
import type { Calibrator } from './apply.js';

export interface CalibratorSet {
  version: string;
  created_at?: string;
  interval?: string;
  /**
   * Calibradores por símbolo y régimen: `symbols['ETHUSDT']['rango']`.
   *
   * La calibración responde a «¿cuánto vale una confianza del 70 % *en este mercado*?», y esa
   * respuesta no se transfiere entre activos. Por eso un símbolo ausente **no hereda** el de otro:
   * se queda sin confianza calibrada, que es la respuesta honesta.
   */
  symbols?: Record<string, Record<string, Calibrator>>;
  /**
   * Formato anterior al multiactivo: un único juego de regímenes, entrenado con un solo activo y
   * aplicado a todos. Se sigue leyendo para que el primer arranque tras el despliegue no se quede
   * sin calibración mientras el piloto no republica — pero solo se aplica **al símbolo que la
   * versión declara** (`cal-BTCUSDT-30m`), no a cualquiera que pregunte.
   */
  regimes?: Record<string, Calibrator>;
}

/** Símbolo que declara un artefacto en formato antiguo (`cal-BTCUSDT-30m`), si se puede leer. */
function legacySymbol(version: string | undefined): string | null {
  const m = /^cal-([A-Z0-9]+)-/.exec(version ?? '');
  return m ? (m[1] as string) : null;
}

export class Calibrators {
  private set: CalibratorSet | null;
  private readonly path: string;

  constructor(path: string, set: CalibratorSet | null) {
    this.path = path;
    this.set = set;
  }

  static load(path: string): Calibrators {
    return new Calibrators(path, readSet(path));
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
   * Calibrador de un símbolo y régimen. `undefined` si ese activo no tiene calibración propia.
   *
   * Devolver el de otro activo sería enseñar un número plausible, con la etiqueta correcta y falso
   * — el mismo tipo de error que el funding a cero de 0.38.0.
   */
  forRegime(label: string, symbol: string): Calibrator | undefined {
    const sym = symbol.toUpperCase();
    const porSimbolo = this.set?.symbols?.[sym]?.[label];
    if (porSimbolo) return porSimbolo;
    if (this.set?.symbols) return undefined; // formato nuevo: sin entrada, sin calibración
    return legacySymbol(this.set?.version) === sym ? this.set?.regimes?.[label] : undefined;
  }

  meta(): CalibratorSet | null {
    return this.set;
  }
}

function readSet(path: string): CalibratorSet | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as CalibratorSet;
  } catch {
    return null;
  }
}
