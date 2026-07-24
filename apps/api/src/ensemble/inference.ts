import type { Action, Probs } from '../domain/signal.js';

/** Convierte el score neto en probabilidades BUY/HOLD/SELL vía softmax con temperatura. */
export interface MacroModulation {
  bias: number;
  wMacro: number;
}

export function inferProbs(
  net: number,
  temperature: number,
  holdBand: number,
  macro?: MacroModulation,
): Probs {
  const t = temperature > 0 ? temperature : 0.5;
  const macroTerm = macro ? macro.wMacro * macro.bias : 0;
  const logits = { BUY: net / t + macroTerm, SELL: -net / t - macroTerm, HOLD: holdBand / t };
  const max = Math.max(logits.BUY, logits.SELL, logits.HOLD);
  const e = {
    BUY: Math.exp(logits.BUY - max),
    SELL: Math.exp(logits.SELL - max),
    HOLD: Math.exp(logits.HOLD - max),
  };
  const sum = e.BUY + e.SELL + e.HOLD;
  return { BUY: e.BUY / sum, HOLD: e.HOLD / sum, SELL: e.SELL / sum };
}

export function pickAction(probs: Probs): { action: Action; confidence: number } {
  const entries: Array<[Action, number]> = [
    ['BUY', probs.BUY],
    ['HOLD', probs.HOLD],
    ['SELL', probs.SELL],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0] ?? (['HOLD', 1] as [Action, number]);
  return { action: top[0], confidence: top[1] };
}

export function confluence(net: number, bias: number): 'aligned' | 'conflict' | 'neutral' {
  if (net === 0 || bias === 0) return 'neutral';
  return Math.sign(net) === Math.sign(bias) ? 'aligned' : 'conflict';
}

/**
 * Escalado de w_macro por temporalidad (M1, estructura preparada · DESACTIVADA por defecto).
 * Cuando `enableScaling` es false devuelve el w_macro sin cambios. Se activará al reintroducir
 * el análisis fundamental, ponderando el sesgo macro menos en temporalidades cortas.
 */
export function scaledWMacro(
  wMacro: number,
  interval: string,
  cfg: { enableScaling: boolean; tfScale: Record<string, number> },
): number {
  if (!cfg.enableScaling) return wMacro;
  const factor = cfg.tfScale[interval] ?? 1;
  return wMacro * factor;
}
