// Genera los vectores dorados de paridad desde los indicadores Node (referencia).
// Uso: pnpm --filter @trademe/api tsx scripts/gen-parity.ts
import { writeFileSync } from 'node:fs';
import { BUILTIN_INDICATORS } from '../src/indicators/builtin.js';
import { computeMacroBias } from '../src/macro/bias.js';
import { inferProbs, pickAction } from '../src/ensemble/inference.js';
import {
  DEFAULT_ENSEMBLE,
  horizonFor,
  validCandlesFor,
  type EnsembleConfig,
} from '../src/ensemble/config.js';
import { IndicatorRegistry } from '../src/indicators/registry.js';
import { buildSignal } from '../src/ensemble/signal.js';
import { computePlanLevels } from '../src/ensemble/plan.js';
import { applyCalibrator, type Calibrator } from '../src/calibration/apply.js';
import { predictForest, type MetaModelArtifact } from '../src/metamodel/apply.js';
import type { Macro } from '../src/domain/signal.js';
import type { Candle } from '../src/domain/candle.js';

function genCandles(n: number): Candle[] {
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 8) * 0.8 + (rnd() - 0.5) * 1.5;
    const open = price;
    const close = Math.max(1, price + drift);
    const high = Math.max(open, close) + rnd() * 0.8;
    const low = Math.min(open, close) - rnd() * 0.8;
    candles.push({
      symbol: 'BTCUSDT',
      interval: '1m',
      openTime: i * 60_000,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: round(10 + rnd() * 5),
      closeTime: i * 60_000 + 59_999,
      closed: true,
    });
    price = close;
  }
  return candles;
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

const candles = genCandles(150);
const expected: Record<string, { value: number; score: number; confidence: number }> = {};
for (const ind of BUILTIN_INDICATORS) {
  const r = ind.compute(candles);
  if (!r) continue;
  expected[ind.key] = {
    value: round(r.value),
    score: round(r.score),
    confidence: round(r.confidence),
  };
}

const vectors = {
  description: 'Vectores dorados de paridad Node<->Python. Referencia: indicadores Node.',
  dataset: {
    symbol: 'BTCUSDT',
    interval: '1m',
    candles: candles.map((c) => ({
      t: c.openTime,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    })),
  },
  tolerance: { value: 0.05, score: 0.05 },
  expected,
};

writeFileSync(
  new URL('../../../packages/core-signals/parity/vectors.json', import.meta.url),
  JSON.stringify(vectors, null, 2) + '\n',
);
// ---- Vectores de paridad macro (sesgo + inferencia modulada) ----
const mc = DEFAULT_ENSEMBLE.macro;
const macroCfg = {
  fundingWeight: mc.fundingWeight,
  trendWeight: mc.trendWeight,
  fundingScale: mc.fundingScale,
  trendScale: mc.trendScale,
};
const macroInputs = [
  { funding: 0.002, price: 90, weeklyEma: 100 },
  { funding: -0.001, price: 110, weeklyEma: 100 },
  { funding: 0.0001, price: 100, weeklyEma: 100 },
  { funding: 0.0005, price: 105, weeklyEma: 100 },
];
const macroBiasVectors = macroInputs.map((input) => {
  const m = computeMacroBias(input, mc);
  return {
    input,
    expected: { bias: round(m.bias), weekly_trend: round(m.weekly_trend), label: m.label },
  };
});
// `independence` = factor de desinflado por dependencia de los votos (M10.5). Los casos con 1
// reproducen el comportamiento anterior; los demás comprueban que Node y Python aplanan igual.
const inferInputs = [
  { net: 0, bias: 0.8, independence: 1 },
  { net: 0.5, bias: 0.5, independence: 1 },
  { net: 0.5, bias: -0.8, independence: 1 },
  { net: -0.6, bias: 0.2, independence: 1 },
  { net: 0, bias: 0, independence: 1 },
  { net: 0.5, bias: 0.5, independence: 0.485 }, // 4h medido: 1,41 de 6 votos efectivos
  { net: -0.6, bias: 0.2, independence: 0.66 }, // 15m medido: 2,61 de 6
  { net: 0.9, bias: -0.4, independence: 0.35 }, // desinflado extremo
];
const T = DEFAULT_ENSEMBLE.temperature;
const HB = DEFAULT_ENSEMBLE.holdBand;
const inferenceVectors = inferInputs.map((c) => {
  const probs = inferProbs(c.net, T, HB, { bias: c.bias, wMacro: mc.wMacro }, c.independence);
  const { action } = pickAction(probs);
  return {
    input: {
      net: c.net,
      bias: c.bias,
      wMacro: mc.wMacro,
      temperature: T,
      holdBand: HB,
      independence: c.independence,
    },
    expected: { BUY: round(probs.BUY), HOLD: round(probs.HOLD), SELL: round(probs.SELL), action },
  };
});
const registry = new IndicatorRegistry();
const decVotes = registry.computeVotes(candles);
const decPrice = candles[candles.length - 1]!.close;
function decisionVector(macro?: Macro, independence = 1, quarantined = false) {
  const cfg: EnsembleConfig = { ...DEFAULT_ENSEMBLE, independenceFactor: independence, quarantined };
  const sig = buildSignal({
    symbol: 'BTCUSDT',
    price: decPrice,
    votes: decVotes,
    config: cfg,
    equity: 10_000,
    interval: '1m',
    macro,
  });
  const lv = computePlanLevels(sig.action, sig.price, sig.atr, DEFAULT_ENSEMBLE.risk, 10_000);
  return {
    macroBias: macro ? macro.bias : null,
    independence,
    quarantined,
    expected: {
      net: round(sig.net),
      action: sig.action,
      direction: sig.direction,
      hold_reason: sig.hold_reason ?? null,
      levels: lv
        ? { entry: round(lv.entry), stop: round(lv.stop), take_profit: round(lv.takeProfit) }
        : null,
    },
  };
}
function mkMacro(bias: number): Macro {
  return {
    bias,
    funding: 0,
    weekly_trend: bias,
    label: bias > 0.2 ? 'alcista' : bias < -0.2 ? 'bajista' : 'neutral',
    confluence: 'neutral',
    applied: true,
  };
}
const decisionVectors = [
  decisionVector(undefined),
  decisionVector(mkMacro(-0.5)),
  decisionVector(mkMacro(0.6)),
  // M10.5: desinflado por dependencia y cuarentena de la temporalidad.
  decisionVector(undefined, 0.485),
  decisionVector(mkMacro(0.6), 0.485),
  decisionVector(undefined, 1, true),
  decisionVector(mkMacro(-0.5), 0.485, true),
];

// ---- Vectores del horizonte y la frescura por temporalidad (M10.5) ----
// No entran en el camino de la decisión, pero sí deciden cuándo se cierra una operación en el
// backtest de Python y cuánto vive el plan en Node: si divergieran, el backtest dejaría de medir lo
// que la plataforma hace.
const tfVectors = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M', '3m'].map((iv) => ({
  interval: iv,
  expected: {
    valid_candles: validCandlesFor(DEFAULT_ENSEMBLE, iv),
    horizon: horizonFor(DEFAULT_ENSEMBLE, iv),
    quarantined: DEFAULT_ENSEMBLE.quarantineIntervals.includes(iv),
  },
}));

// ---- Vectores de paridad del calibrador (applier idéntico Node<->Python) ----
const calibrators: Record<string, Calibrator> = {
  identity: { method: 'identity' },
  isotonic: { method: 'isotonic', x: [0.2, 0.5, 0.8], y: [0.1, 0.4, 0.75] },
  platt: { method: 'platt', w: 2.5, c: -1.5 },
};
const calInputs = [0.0, 0.15, 0.35, 0.5, 0.65, 0.9, 1.0];
const calibrationVectors = Object.entries(calibrators).flatMap(([name, cal]) =>
  calInputs.map((p) => ({
    calibrator: name,
    cal,
    input: p,
    expected: round(applyCalibrator(cal, p)),
  })),
);

// ---- Vectores de paridad del meta-modelo (bosque serializado: Node<->Python) ----
const forest: MetaModelArtifact = {
  kind: 'random_forest',
  features: ['f0', 'f1'],
  trees: [
    {
      feature: [0, -2, 1, -2, -2],
      threshold: [0.5, -2, 0.25, -2, -2],
      left: [1, -1, 3, -1, -1],
      right: [2, -1, 4, -1, -1],
      value: [0, 0.2, 0, 0.6, 0.9],
    },
    {
      feature: [1, -2, -2],
      threshold: [0.75, -2, -2],
      left: [1, -1, -1],
      right: [2, -1, -1],
      value: [0, 0.3, 0.8],
    },
  ],
};
const metaInputs = [
  [0.1, 0.1],
  [0.9, 0.1],
  [0.9, 0.9],
  [0.5, 0.75],
  [0.6, 0.3],
];
const metamodelVectors = metaInputs.map((x) => ({
  input: x,
  expected: round(predictForest(forest, x)),
}));

writeFileSync(
  new URL('../../../packages/core-signals/parity/macro_vectors.json', import.meta.url),
  JSON.stringify(
    {
      description:
        'Paridad macro: sesgo (funding+tendencia) e inferencia modulada. Referencia Node.',
      macroConfig: macroCfg,
      tolerance: 0.001,
      macro_bias: macroBiasVectors,
      inference: inferenceVectors,
      decision: decisionVectors,
      timeframes: tfVectors,
      calibration: calibrationVectors,
      metamodel: { forest, vectors: metamodelVectors },
    },
    null,
    2,
  ) + '\n',
);
console.log('vectores generados:', Object.keys(expected).join(', '), '+ macro');
