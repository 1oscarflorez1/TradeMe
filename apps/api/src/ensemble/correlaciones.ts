/**
 * Gestor de Correlaciones en el Panel: cuántas apuestas independientes hay de verdad.
 *
 * Cuando el sistema enseña COMPRAR en ETH, SOL y BNB a la vez, parecen tres oportunidades. Medido
 * sobre 500 velas de 1h, esos activos correlacionan entre 0,69 y 0,81, así que son **una y media**.
 * Y esa es información que hace falta para decidir cuánto arriesgar, no un tecnicismo interno.
 *
 * Aquí solo se **lee** lo que publicó quant. Los activos efectivos de cada combinación vienen
 * precalculados en el artefacto a propósito: obtenerlos exige autovalores de la submatriz, y
 * reimplementar álgebra lineal en TypeScript para un dato informativo arriesgaría que la pantalla y
 * el gobierno del Fundamental Score dieran números distintos.
 *
 * **No veta ni bloquea nada.** El sistema no ejecuta órdenes; quien decide cuánto arriesgar es el
 * usuario, y esto le da el dato que le faltaba.
 */
import { existsSync, readFileSync } from 'node:fs';

export interface CorrelacionesFile {
  symbols?: string[];
  matrix?: number[][] | null;
  efectivos?: number;
  nominales?: number;
  factor?: number;
  interval?: string;
  velas?: number;
  /** Activos efectivos por combinación: clave `"BTCUSDT,ETHUSDT"` con símbolos ordenados. */
  subconjuntos?: Record<string, number>;
  updated_at?: string | null;
}

export class Correlaciones {
  private data: CorrelacionesFile | null;

  constructor(
    private readonly path: string,
    data: CorrelacionesFile | null,
  ) {
    this.data = data;
  }

  static load(path: string): Correlaciones {
    return new Correlaciones(path, leer(path));
  }

  reload(): void {
    this.data = leer(this.path);
  }

  get disponible(): boolean {
    return Boolean(this.data?.matrix && (this.data?.symbols?.length ?? 0) >= 2);
  }

  meta(): CorrelacionesFile | null {
    return this.data;
  }

  /**
   * Apuestas independientes que representan estas señales simultáneas.
   *
   * Sin medición devuelve el número de símbolos: no se inventa un descuento. Con un solo símbolo
   * devuelve 1, que es lo correcto y evita un aviso absurdo.
   */
  apuestasEfectivas(simbolos: string[]): number {
    const unicos = [...new Set(simbolos.map((s) => s.toUpperCase()))].sort();
    if (unicos.length <= 1) return unicos.length;
    const clave = unicos.join(',');
    const ef = this.data?.subconjuntos?.[clave];
    return typeof ef === 'number' && Number.isFinite(ef) ? ef : unicos.length;
  }

  /**
   * Correlación entre dos activos, para poder señalar el par más redundante de un grupo.
   * `null` si no está medida.
   */
  correlacion(a: string, b: string): number | null {
    const s = this.data?.symbols ?? [];
    const m = this.data?.matrix;
    if (!m) return null;
    const i = s.indexOf(a.toUpperCase());
    const j = s.indexOf(b.toUpperCase());
    if (i < 0 || j < 0) return null;
    return m[i]?.[j] ?? null;
  }
}

function leer(path: string): CorrelacionesFile | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CorrelacionesFile;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export interface Exposicion {
  interval: string;
  /** Señales operables agrupadas por dirección. */
  alineadas: { LONG: string[]; SHORT: string[] };
  /** Apuestas independientes del grupo mayor. */
  apuestasEfectivas: number;
  /** Símbolos de ese grupo mayor. */
  simbolos: string[];
  direccion: 'LONG' | 'SHORT' | null;
  /** El par más correlacionado del grupo, para poder nombrarlo en el aviso. */
  parMasRedundante: { a: string; b: string; correlacion: number } | null;
  medido: boolean;
}

/**
 * Resume la exposición: de las señales operables ahora mismo, cuántas apuestas distintas son.
 *
 * Se queda con el grupo **mayor** (más señales en la misma dirección) porque es donde se concentra
 * el riesgo. Dos largos y un corto no se compensan aquí: el aviso habla del lado cargado.
 */
export function resumirExposicion(
  interval: string,
  senales: Array<{ symbol: string; direction: string }>,
  corr: Correlaciones,
): Exposicion {
  const largos = senales.filter((s) => s.direction === 'LONG').map((s) => s.symbol.toUpperCase());
  const cortos = senales.filter((s) => s.direction === 'SHORT').map((s) => s.symbol.toUpperCase());
  const mayor = largos.length >= cortos.length ? largos : cortos;
  const direccion = mayor.length === 0 ? null : mayor === largos ? 'LONG' : 'SHORT';

  let par: Exposicion['parMasRedundante'] = null;
  for (let i = 0; i < mayor.length; i += 1) {
    for (let j = i + 1; j < mayor.length; j += 1) {
      const c = corr.correlacion(mayor[i] as string, mayor[j] as string);
      if (c !== null && (par === null || c > par.correlacion)) {
        par = { a: mayor[i] as string, b: mayor[j] as string, correlacion: c };
      }
    }
  }

  return {
    interval,
    alineadas: { LONG: largos, SHORT: cortos },
    apuestasEfectivas: corr.apuestasEfectivas(mayor),
    simbolos: [...mayor].sort(),
    direccion,
    parMasRedundante: par,
    medido: corr.disponible,
  };
}
