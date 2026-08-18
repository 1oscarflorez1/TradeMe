/**
 * Errores tipados de los proveedores de datos (M11.1).
 *
 * Hasta aquí cualquier fallo de un proveedor salía del backend como un `502` indistinguible. El
 * 17 de agosto de 2026 eso hizo que agotar el cupo diario de Twelve Data —1822 créditos gastados
 * sobre un límite de 800— apareciera en el portal como «Error: GET /candles 502», que no dice ni
 * qué pasó ni cuándo se arregla solo.
 *
 * Tres situaciones que no son la misma y no deben contarse igual:
 *
 *   sin_cupo        el proveedor funciona, pero hoy ya no quedan peticiones. Se repone solo.
 *   no_soportado    ese proveedor no sirve ese activo o esa temporalidad. No se arregla esperando.
 *   proveedor_caido la fuente no responde o devuelve un error inesperado. Puede ser temporal.
 */
export type ProviderErrorKind = 'sin_cupo' | 'no_soportado' | 'proveedor_caido';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly provider: string,
    message: string,
    /** Cuándo vuelve a haber cupo, si se sabe. */
    readonly retryAt?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** Código HTTP que le corresponde. Un 502 para todo era lo que ocultaba la causa. */
  get status(): number {
    if (this.kind === 'sin_cupo') return 429;
    if (this.kind === 'no_soportado') return 422;
    return 502;
  }

  toJSON(): { error: string; kind: ProviderErrorKind; provider: string; retryAt?: string } {
    return {
      error: this.message,
      kind: this.kind,
      provider: this.provider,
      ...(this.retryAt ? { retryAt: this.retryAt } : {}),
    };
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Próxima medianoche UTC: cuando los planes gratuitos por día reponen el cupo. */
export function proximoResetUtc(now: number = Date.now()): string {
  const d = new Date(now);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0),
  ).toISOString();
}
