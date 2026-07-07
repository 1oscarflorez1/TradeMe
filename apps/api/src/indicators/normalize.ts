/** Recorta un número al rango [lo, hi]. */
export function clamp(x: number, lo = -1, hi = 1): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Confianza a partir de la magnitud del score. */
export function confidenceFromScore(score: number): number {
  return clamp(Math.abs(score), 0, 1);
}

function tail<T>(arr: readonly T[]): T | undefined {
  return arr.length > 0 ? arr[arr.length - 1] : undefined;
}

export { tail };
