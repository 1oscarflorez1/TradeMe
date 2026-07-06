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

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';
