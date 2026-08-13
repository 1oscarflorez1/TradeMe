import type { Vote } from '../indicators/types.js';
import type { Action, Direction, HoldReason, Macro, Signal } from '../domain/signal.js';
import { intervalMs, type Interval } from '../domain/candle.js';
import type { EnsembleConfig } from './config.js';
import { aggregate } from './aggregate.js';
import { confluence, inferProbs, pickAction } from './inference.js';
import { buildPlan } from './plan.js';
import { applyCalibrator } from '../calibration/apply.js';
import type { Calibrators } from '../calibration/load.js';
import { featureVector, type MetaModel } from '../metamodel/apply.js';

export interface BuildSignalParams {
  symbol: string;
  price: number;
  votes: Vote[];
  config: EnsembleConfig;
  equity: number;
  interval: Interval;
  macro?: Macro;
  ts?: string;
  calibrators?: Calibrators;
  metaModel?: MetaModel;
  metaMode?: 'off' | 'shadow' | 'modulate' | 'veto';
  metaVetoThreshold?: number;
  metaModulateWeight?: number;
}

function directionOf(action: Action): Direction {
  if (action === 'BUY') return 'LONG';
  if (action === 'SELL') return 'SHORT';
  return 'FLAT';
}

/** Construye el objeto Signal completo a partir de los votos y la config del ensemble. */
export function buildSignal(params: BuildSignalParams): Signal {
  const ts = params.ts ?? new Date().toISOString();
  const validUntil = new Date(
    Date.parse(ts) + params.config.plan.validCandles * intervalMs(params.interval),
  ).toISOString();
  const { net, regime, votes, atr } = aggregate(params.votes, params.config);
  const macroCfg = params.config.macro;
  const macroInput =
    params.macro && macroCfg.enabled
      ? { bias: params.macro.bias, wMacro: macroCfg.wMacro }
      : undefined;
  // Desinflado por dependencia: los seis votos no son seis evidencias (ver ensemble/independence.ts).
  const independence = params.config.independenceFactor ?? 1;
  const probs = inferProbs(
    net,
    params.config.temperature,
    params.config.holdBand,
    macroInput,
    independence,
  );
  let { action, confidence } = pickAction(probs);
  let holdReason: HoldReason | undefined = action === 'HOLD' ? 'banda_neutra' : undefined;

  let macroOut: Macro | undefined;
  if (params.macro && macroCfg.enabled) {
    const conf = confluence(net, params.macro.bias);
    // Escudo macro: no operar contra un sesgo macro fuerte y en conflicto.
    if (
      macroCfg.conflictDowngrade &&
      conf === 'conflict' &&
      Math.abs(params.macro.bias) > macroCfg.conflictThreshold
    ) {
      action = 'HOLD';
      confidence = probs.HOLD;
      holdReason = 'conflicto_macro';
    }
    macroOut = { ...params.macro, confluence: conf };
  }
  let direction = directionOf(action);
  const calibratedConfidence = params.calibrators
    ? applyCalibrator(params.calibrators.forRegime(regime.label), confidence)
    : undefined;

  // ---- Meta-modelo (Módulo 2): filtro anti-falsos-positivos ----
  // El modelo se entrena en Python; aquí solo se evalúa el artefacto publicado.
  const metaMode = params.metaMode ?? 'off';
  let metaConfidence: number | undefined;
  let metaVetoed: boolean | undefined;
  // Se evalúa SIEMPRE (también en HOLD): así el Panel muestra qué opina el filtro ML en todo
  // momento. La política de modulación/veto solo se aplica cuando hay acción operable.
  if (metaMode !== 'off' && params.metaModel?.ready) {
    const p = params.metaModel.predict(
      featureVector({
        net,
        confidence,
        probs,
        adx: regime.adx,
        atr,
        price: params.price,
        votes,
        regimeLabel: regime.label,
        direction,
      }),
    );
    if (p !== null) {
      metaConfidence = p;
      if (action !== 'HOLD' && (metaMode === 'modulate' || metaMode === 'veto')) {
        // Media ponderada: la confianza final combina el ensemble y el juicio del meta-modelo.
        const w = params.metaModulateWeight ?? 0.5;
        confidence = (1 - w) * confidence + w * p;
      }
      if (action !== 'HOLD' && metaMode === 'veto' && p < (params.metaVetoThreshold ?? 0.5)) {
        action = 'HOLD';
        confidence = probs.HOLD;
        direction = 'FLAT';
        metaVetoed = true;
        holdReason = 'veto_meta';
      } else if (action !== 'HOLD' && metaMode === 'veto') {
        metaVetoed = false;
      }
    }
  }

  // ---- Cuarentena de temporalidad (M10.5) ----
  // Va la última y por encima de todo lo demás: es una retirada del permiso para operar, no una
  // opinión que se pueda compensar con confianza alta. La decisión se sigue calculando entera —los
  // votos, el net y las probabilidades quedan registrados— pero no sale de aquí como operable.
  if (params.config.quarantined && action !== 'HOLD') {
    action = 'HOLD';
    confidence = probs.HOLD;
    direction = 'FLAT';
    holdReason = 'cuarentena';
  }

  const plan = buildPlan({
    action,
    price: params.price,
    atr,
    regimeLabel: regime.label,
    confidence,
    risk: params.config.risk,
    equity: params.equity,
    validUntil,
  });

  return {
    version: '1.0.0',
    symbol: params.symbol,
    ts,
    price: params.price,
    regime,
    votes,
    net,
    probs,
    action,
    direction,
    confidence,
    hold_reason: action === 'HOLD' ? (holdReason ?? 'banda_neutra') : undefined,
    independence_factor: independence,
    quarantined: params.config.quarantined ? true : undefined,
    calibrated_confidence: calibratedConfidence,
    calibration_version: params.calibrators?.version ?? undefined,
    meta_confidence: metaConfidence,
    meta_version: params.metaModel?.version ?? undefined,
    meta_mode: metaMode === 'off' ? undefined : metaMode,
    meta_vetoed: metaVetoed,
    macro: macroOut,
    plan,
    valid_until: validUntil,
    atr,
    model_version: params.config.version,
  };
}
