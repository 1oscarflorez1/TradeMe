// Applier del calibrador de probabilidades (M7 Slice A).
// Mirror EXACTO de apps/quant/trademe_quant/calibration.py::apply_calibrator.
// El artefacto lo entrena Python y lo consume Node; ambos aplican la misma fórmula.

export interface Calibrator {
  method: 'identity' | 'isotonic' | 'platt';
  x?: number[];
  y?: number[];
  w?: number;
  c?: number;
  n?: number;
  brier?: number;
  reliability?: Array<{ p_pred: number; p_true: number; n: number }>;
}

function applyIsotonic(xs: number[], ys: number[], p: number): number {
  if (xs.length === 0) return p;
  if (p <= xs[0]!) return ys[0]!;
  if (p >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    if (x0 <= p && p <= x1) {
      const y0 = ys[i]!;
      const y1 = ys[i + 1]!;
      if (x1 === x0) return y0;
      return y0 + ((y1 - y0) * (p - x0)) / (x1 - x0);
    }
  }
  return ys[ys.length - 1]!;
}

/** Aplica un calibrador de régimen a una confianza cruda p en [0,1]. */
export function applyCalibrator(cal: Calibrator | undefined, p: number): number {
  if (!cal) return p;
  if (cal.method === 'isotonic') return applyIsotonic(cal.x ?? [], cal.y ?? [], p);
  if (cal.method === 'platt') return 1 / (1 + Math.exp(-((cal.w ?? 0) * p + (cal.c ?? 0))));
  return p;
}
