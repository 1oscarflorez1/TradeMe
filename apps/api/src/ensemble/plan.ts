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
  validUntil?: string;
}

export interface PlanLevels {
  entry: number;
  stop: number;
  takeProfit: number;
  size: number;
  rr: number;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/** Niveles numéricos del plan (entrada, stop, TP, tamaño) o null si no aplica. */
export function computePlanLevels(
  action: Action,
  price: number,
  atr: number,
  risk: RiskConfig,
  equity: number,
): PlanLevels | null {
  if (action === 'HOLD' || atr <= 0 || price <= 0) return null;
  const dir = action === 'BUY' ? 1 : -1;
  const stopDistance = atr * risk.atrStopMult;
  const entry = price;
  const stop = entry - dir * stopDistance;
  const takeProfit = entry + dir * risk.tpRMultiple * stopDistance;
  const size = stopDistance > 0 ? (equity * risk.riskPct) / stopDistance : 0;
  return { entry, stop, takeProfit, size, rr: risk.tpRMultiple };
}

/** Plan operativo (checklist) a partir de la decisión y el ATR. */
export function buildPlan(input: PlanInput): PlanStep[] {
  const { action, price, atr, regimeLabel, confidence, risk, equity } = input;
  const levels = computePlanLevels(action, price, atr, risk, equity);

  if (!levels) {
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

  const stopDistance = atr * risk.atrStopMult;
  const notional = levels.size * levels.entry;
  const side = action === 'BUY' ? 'LONG' : 'SHORT';

  return [
    {
      step: 1,
      title: `Abrir ${side}`,
      detail: `Régimen ${regimeLabel}, confianza ${(confidence * 100).toFixed(0)}%.`,
    },
    { step: 2, title: 'Entrada', detail: `~ ${fmt(levels.entry)}` },
    {
      step: 3,
      title: 'Stop-loss',
      detail: `${fmt(levels.stop)} (${risk.atrStopMult}×ATR = ${fmt(stopDistance)})`,
    },
    {
      step: 4,
      title: 'Take-profit',
      detail: `${fmt(levels.takeProfit)} (R:R 1:${risk.tpRMultiple})`,
    },
    {
      step: 5,
      title: 'Tamaño de posición',
      detail: `${levels.size.toFixed(6)} u (~${fmt(notional)}) · riesgo ${(risk.riskPct * 100).toFixed(1)}% = ${fmt(equity * risk.riskPct)}`,
    },
    {
      step: 6,
      title: 'Validez de la entrada',
      detail: input.validUntil
        ? `Operar antes de ${new Date(input.validUntil).toLocaleString('es')} o se descarta.`
        : 'Ventana de entrada limitada.',
    },
  ];
}
