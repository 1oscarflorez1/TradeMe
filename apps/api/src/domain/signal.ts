import type { Vote } from '../indicators/types.js';

export type Action = 'BUY' | 'HOLD' | 'SELL';
export type Direction = 'LONG' | 'SHORT' | 'FLAT';

/**
 * Por qué la decisión NO es operable (M10.5).
 *
 * «No operar» tiene que ser un veredicto con motivo, no el residuo de que ninguna otra opción ganase.
 * Sin este campo, las decisiones descartadas no se podían registrar de forma útil y el dataset solo
 * contenía COMPRAR y VENDER: el meta-modelo aprendía de la mitad del mundo y la trataba como si
 * fuera entera.
 */
export type HoldReason =
  | 'cuarentena' // la temporalidad está retirada de la operativa
  | 'conflicto_macro' // técnica y macro se contradicen con fuerza
  | 'veto_meta' // el meta-modelo descarta la señal
  | 'banda_neutra'; // sin ventaja suficiente para salir de la banda

export interface Macro {
  bias: number;
  funding: number;
  weekly_trend: number;
  label: 'alcista' | 'bajista' | 'neutral';
  confluence: 'aligned' | 'conflict' | 'neutral';
  applied: boolean;
}

export interface Regime {
  adx: number;
  label: 'tendencia' | 'rango';
}

export interface Probs {
  BUY: number;
  HOLD: number;
  SELL: number;
}

export interface PlanStep {
  step: number;
  title: string;
  detail?: string;
}

/** Objeto de señal completo (contrato core-signals). */
export interface Signal {
  version: string;
  symbol: string;
  ts: string;
  price: number;
  regime: Regime;
  votes: Vote[];
  net: number;
  probs: Probs;
  action: Action;
  direction: Direction;
  confidence: number;
  /** Presente solo cuando `action` es HOLD: por qué no se opera. */
  hold_reason?: HoldReason;
  /**
   * Lo que se habría decidido si la temporalidad no estuviera en cuarentena.
   *
   * Sin esto, una temporalidad vetada no genera ninguna operación evaluable y por tanto no puede
   * demostrar nunca que merece volver: la cuarentena sería irreversible por construcción. La sombra
   * es lo que le permite acumular expediente sin operar — el mismo principio que el modo sombra del
   * meta-modelo.
   *
   * **Nunca cuenta como rendimiento**: no se operó. Alimenta el expediente de la temporalidad y
   * nada más.
   */
  shadow_action?: Action;
  shadow_direction?: Direction;
  /** Factor de desinflado aplicado a los logits por dependencia de los votos (1 = ninguno). */
  independence_factor?: number;
  /** La temporalidad está en cuarentena: se registra pero no emite señal operable. */
  quarantined?: boolean;
  calibrated_confidence?: number;
  calibration_version?: string;
  meta_confidence?: number;
  meta_version?: string;
  meta_mode?: 'off' | 'shadow' | 'modulate' | 'veto';
  meta_vetoed?: boolean;
  macro?: Macro;
  plan: PlanStep[];
  valid_until: string;
  atr: number;
  model_version: string;
}
