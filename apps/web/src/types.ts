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
