import type { Action, PlanStep } from '../domain/signal.js';
import type { RiskConfig } from './config.js';

export interface PlanInput {
  action: Action;
  price: number;
  atr: number;
  regimeLabel: string;
  confidence: number;
  risk: RiskConfig;
  equity: number;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Traduce la decisión en un plan operativo con ATR: entrada, stop, take-profit y tamaño
 * por riesgo fijo. HOLD (o datos insuficientes) no abre posición.
 */
export function buildPlan(input: PlanInput): PlanStep[] {
  const { action, price, atr, regimeLabel, confidence, risk, equity } = input;

  if (action === 'HOLD' || atr <= 0 || price <= 0) {
    return [
      {
        step: 1,
        title: 'Mantener / esperar',
        detail: 'Sin sesgo claro (net ~0) o datos insuficientes: no abrir posición.',
      },
      {
        step: 2,
        title: 'Vigilar confirmación',
        detail: `Esperar a que el ensemble se incline (régimen ${regimeLabel}).`,
      },
    ];
  }

  const dir = action === 'BUY' ? 1 : -1;
  const stopDistance = atr * risk.atrStopMult;
  const entry = price;
  const stop = entry - dir * stopDistance;
  const takeProfit = entry + dir * risk.tpRMultiple * stopDistance;
  const riskAmount = equity * risk.riskPct;
  const size = stopDistance > 0 ? riskAmount / stopDistance : 0;
  const notional = size * entry;

  return [
    {
      step: 1,
      title: `Confirmar ${action}`,
      detail: `Régimen ${regimeLabel}, confianza ${(confidence * 100).toFixed(0)}%.`,
    },
    { step: 2, title: 'Entrada', detail: `~ ${fmt(entry)}` },
    {
      step: 3,
      title: 'Stop-loss',
      detail: `${fmt(stop)} (${risk.atrStopMult}×ATR = ${fmt(stopDistance)})`,
    },
    {
      step: 4,
      title: 'Take-profit',
      detail: `${fmt(takeProfit)} (R:R 1:${risk.tpRMultiple})`,
    },
    {
      step: 5,
      title: 'Tamaño de posición',
      detail: `${size.toFixed(6)} u (~${fmt(notional)}) · riesgo ${(risk.riskPct * 100).toFixed(1)}% = ${fmt(riskAmount)}`,
    },
  ];
}
