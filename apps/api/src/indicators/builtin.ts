import { ADX, ATR, BollingerBands, EMA, MACD, RSI, Stochastic } from 'technicalindicators';
import type { Candle } from '../domain/candle.js';
import type { Indicator, IndicatorReading } from './types.js';
import { clamp, confidenceFromScore, tail } from './normalize.js';

function series(candles: Candle[]) {
  return {
    close: candles.map((c) => c.close),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
  };
}

/** RSI(14) — oscilador acotado. Sobreventa (bajo) => sesgo comprador (+). */
export const rsi14: Indicator = {
  key: 'rsi14',
  label: 'RSI 14',
  kind: 'reversion',
  defaultParams: { period: 14 },
  minCandles: 20,
  compute(candles) {
    const { close } = series(candles);
    const value = tail(RSI.calculate({ period: 14, values: close }));
    if (value === undefined) return null;
    const score = clamp((50 - value) / 20);
    return { value, score, confidence: confidenceFromScore(score) };
  },
};

/** Stochastic(14,3) — oscilador acotado, umbrales 20/80. */
export const stoch14: Indicator = {
  key: 'stoch14',
  label: 'Stochastic 14',
  kind: 'reversion',
  defaultParams: { period: 14, signalPeriod: 3 },
  minCandles: 20,
  compute(candles) {
    const { close, high, low } = series(candles);
    const last = tail(Stochastic.calculate({ high, low, close, period: 14, signalPeriod: 3 }));
    if (!last || last.k === undefined) return null;
    const value = last.k;
    const score = clamp((50 - value) / 30);
    return { value, score, confidence: confidenceFromScore(score) };
  },
};

/** Bollinger(20,2) — %B: banda inferior (+1) / superior (-1). */
export const bbands: Indicator = {
  key: 'bbands',
  label: 'Bollinger 20·2',
  kind: 'reversion',
  defaultParams: { period: 20, stdDev: 2 },
  minCandles: 25,
  compute(candles) {
    const { close } = series(candles);
    const price = tail(close);
    const last = tail(BollingerBands.calculate({ period: 20, stdDev: 2, values: close }));
    if (!last || price === undefined) return null;
    const width = last.upper - last.lower;
    const pb = width === 0 ? 0.5 : (price - last.lower) / width;
    const score = clamp(1 - 2 * pb);
    return {
      value: pb,
      score,
      confidence: confidenceFromScore(score),
      meta: { upper: last.upper, lower: last.lower },
    };
  },
};

/** EMA(9/21) crossover — tendencia; separación normalizada por ATR y tanh. */
export const emaCross: Indicator = {
  key: 'ema_cross',
  label: 'EMA 9/21',
  kind: 'trend',
  defaultParams: { fast: 9, slow: 21 },
  minCandles: 30,
  compute(candles) {
    const { close, high, low } = series(candles);
    const e9 = tail(EMA.calculate({ period: 9, values: close }));
    const e21 = tail(EMA.calculate({ period: 21, values: close }));
    const atr = tail(ATR.calculate({ high, low, close, period: 14 }));
    if (e9 === undefined || e21 === undefined || atr === undefined || atr === 0) return null;
    const diff = e9 - e21;
    const score = clamp(Math.tanh(diff / atr));
    return {
      value: diff,
      score,
      confidence: confidenceFromScore(score),
      meta: { ema9: e9, ema21: e21 },
    };
  },
};

/** MACD(12,26,9) — momentum; histograma normalizado por ATR y tanh. */
export const macd: Indicator = {
  key: 'macd',
  label: 'MACD 12·26·9',
  kind: 'momentum',
  defaultParams: { fast: 12, slow: 26, signal: 9 },
  minCandles: 40,
  compute(candles) {
    const { close, high, low } = series(candles);
    const last = tail(
      MACD.calculate({
        values: close,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      }),
    );
    const atr = tail(ATR.calculate({ high, low, close, period: 14 }));
    if (!last || last.histogram === undefined || atr === undefined || atr === 0) return null;
    const score = clamp(Math.tanh(last.histogram / atr));
    return { value: last.histogram, score, confidence: confidenceFromScore(score) };
  },
};

/** ADX(14) — contexto: define régimen (>=25 tendencia). No vota dirección. */
export const adx14: Indicator = {
  key: 'adx14',
  label: 'ADX 14',
  kind: 'context',
  defaultParams: { period: 14 },
  minCandles: 40,
  compute(candles) {
    const { close, high, low } = series(candles);
    const last = tail(ADX.calculate({ close, high, low, period: 14 }));
    if (!last || last.adx === undefined) return null;
    const value = last.adx;
    const regime = value >= 25 ? 'tendencia' : 'rango';
    return {
      value,
      score: 0,
      confidence: clamp(value / 50, 0, 1),
      meta: { regime, pdi: last.pdi, mdi: last.mdi },
    };
  },
};

/** ATR(14) — volatilidad: alimenta el plan (M4). No vota. */
export const atr14: Indicator = {
  key: 'atr14',
  label: 'ATR 14',
  kind: 'volatility',
  defaultParams: { period: 14 },
  minCandles: 20,
  compute(candles) {
    const { close, high, low } = series(candles);
    const value = tail(ATR.calculate({ high, low, close, period: 14 }));
    if (value === undefined) return null;
    return { value, score: 0, confidence: 0 };
  },
};

export const BUILTIN_INDICATORS: Indicator[] = [
  emaCross,
  macd,
  rsi14,
  bbands,
  stoch14,
  adx14,
  atr14,
];

export type { IndicatorReading };
