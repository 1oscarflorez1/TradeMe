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

/**
 * Fundamental Score (M12): el funding, situado por percentil y aplicado **solo a los largos**.
 *
 * No es «el macro otra vez». `Macro.bias` mezcla funding con tendencia semanal, que deriva del
 * precio y por tanto ya está representada en los seis votos; este bloque aísla la parte que no
 * deriva del precio, que es exactamente lo que justifica que exista.
 *
 * `applied` es la única bandera que decide si toca la decisión. En `shadow` se calcula, se registra
 * y no influye: el score tiene que ganarse el sitio con datos que no controlaba, igual que el
 * meta-modelo y la cuarentena.
 */
export interface Fundamental {
  /** Funding rate del momento, tal cual lo dio el proveedor. */
  funding: number;
  /** Su lugar en la ventana móvil de 90 días, en [0,1]. */
  percentile: number;
  /** Penalización cruda a los largos, en [0,1]. Cero por debajo del tercil inferior. */
  penalty: number;
  w_fund: number;
  mode: 'off' | 'shadow' | 'active';
  /** true solo si `mode` es `active` y hay distribución suficiente. */
  applied: boolean;
  /** Sin muestra suficiente: la penalización efectiva es 0, no una estimación. */
  stale: boolean;
  /** Observaciones de la ventana con que se construyó la distribución. */
  n: number;
  version: string | null;
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
  fundamental?: Fundamental;
  /**
   * Lo que se habría decidido con la penalización fundamental aplicada (M12, modo sombra).
   *
   * Columnas propias, no reutilizadas: el aislamiento tiene que ser estructural. Si esto escribiera
   * en `action`, el score estaría influyendo en la decisión antes de haber demostrado nada, que es
   * justo lo que el gobierno en sombra impide. Solo difiere de `action` cuando la penalización
   * habría cambiado el resultado — y esa diferencia es la que se mide para promocionarlo.
   */
  fund_shadow_action?: Action;
  fund_shadow_confidence?: number;
  plan: PlanStep[];
  valid_until: string;
  atr: number;
  model_version: string;
}
