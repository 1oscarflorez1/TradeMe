export type Interval = '1m' | '1h';

export interface Candle {
  symbol: string;
  interval: Interval;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  closed: boolean;
}

export type VoteSource = 'internal' | 'ninjatrader' | 'tradingview';

export interface Vote {
  key: string;
  label: string;
  kind: string;
  source: VoteSource;
  value: number;
  score: number;
  confidence: number;
  ts: string;
  ttlMs?: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export type Action = 'BUY' | 'HOLD' | 'SELL';

export interface Probs {
  BUY: number;
  HOLD: number;
  SELL: number;
}

export interface Regime {
  adx: number;
  label: 'tendencia' | 'rango';
}

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
  confidence: number;
  atr: number;
  model_version: string;
}
