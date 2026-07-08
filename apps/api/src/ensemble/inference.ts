import type { Action, Probs } from '../domain/signal.js';

/** Convierte el score neto en probabilidades BUY/HOLD/SELL vía softmax con temperatura. */
export function inferProbs(net: number, temperature: number, holdBand: number): Probs {
  const t = temperature > 0 ? temperature : 0.5;
  const logits = { BUY: net / t, SELL: -net / t, HOLD: holdBand / t };
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
