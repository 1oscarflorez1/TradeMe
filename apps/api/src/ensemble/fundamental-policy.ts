/**
 * Política del Fundamental Score publicada por el piloto (`artifacts/fundamental_policy.json`).
 *
 * Mismo patrón que `MetaPolicy`: quant mide el expediente sombra y decide el modo; la api solo lo
 * evalúa. Y el modo de `ensemble.yaml` actúa como **tope**, no como valor: la automatización puede
 * mantener el score por debajo de lo configurado, nunca por encima.
 *
 * Esa asimetría es deliberada. Si el fichero se corrompe, desaparece o alguien publica basura, el
 * peor caso posible es que el score influya **menos** de lo previsto — nunca más.
 */
import { existsSync, readFileSync } from 'node:fs';

export type FundamentalMode = 'off' | 'shadow' | 'active';
const ORDEN: FundamentalMode[] = ['off', 'shadow', 'active'];

export interface FundamentalPolicyFile {
  mode?: FundamentalMode;
  reason?: string;
  updated_at?: string | null;
  evidence?: Record<string, number>;
}

export class FundamentalPolicy {
  private data: FundamentalPolicyFile | null;

  constructor(
    private readonly path: string,
    data: FundamentalPolicyFile | null,
  ) {
    this.data = data;
  }

  static load(path: string): FundamentalPolicy {
    return new FundamentalPolicy(path, leer(path));
  }

  /** Relee el artefacto (POST /reload). */
  reload(): void {
    this.data = leer(this.path);
  }

  /**
   * Modo efectivo = el más bajo entre el que decidió el piloto y el tope de configuración.
   *
   * Sin artefacto se devuelve el tope tal cual: es el estado de antes de que existiera el gobierno
   * automático, y no tiene por qué degradar nada.
   */
  effectiveMode(tope: FundamentalMode): FundamentalMode {
    const auto = this.data?.mode;
    if (!auto) return tope;
    const i = Math.min(indice(auto), indice(tope));
    return ORDEN[i] ?? 'shadow';
  }

  get reason(): string | null {
    return this.data?.reason ?? null;
  }

  meta(): FundamentalPolicyFile | null {
    return this.data;
  }
}

function indice(m: FundamentalMode): number {
  const i = ORDEN.indexOf(m);
  return i === -1 ? 1 : i; // desconocido => shadow, que no influye
}

function leer(path: string): FundamentalPolicyFile | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as FundamentalPolicyFile;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
