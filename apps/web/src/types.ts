export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

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

export type VoteSource = 'internal' | 'tradingview';

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
export type Direction = 'LONG' | 'SHORT' | 'FLAT';

export interface Macro {
  bias: number;
  funding: number;
  weekly_trend: number;
  label: 'alcista' | 'bajista' | 'neutral';
  confluence: 'aligned' | 'conflict' | 'neutral';
  applied: boolean;
}

export interface Probs {
  BUY: number;
  HOLD: number;
  SELL: number;
}

export interface Regime {
  adx: number;
  label: 'tendencia' | 'rango';
}

export interface PlanStep {
  step: number;
  title: string;
  detail?: string;
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
  direction: Direction;
  confidence: number;
  macro?: Macro;
  plan: PlanStep[];
  valid_until: string;
  atr: number;
  model_version: string;
}

export interface SnapshotTracking {
  status: 'tp' | 'sl' | 'en_curso' | 'sin_plan';
  liveR: number | null;
  expired: boolean;
}

export interface SnapshotRow {
  id: string;
  captured_at: string;
  symbol: string;
  interval: Interval;
  action: string;
  direction: Direction;
  price: number;
  confidence: number | null;
  macro_bias: number | null;
  plan_entry: number | null;
  plan_stop: number | null;
  plan_take_profit: number | null;
  plan_rr: number | null;
  valid_until: string | null;
  outcome_result: string | null;
  outcome_return_r: number | null;
  tracking: SnapshotTracking | null;
}

export interface SnapshotsResponse {
  symbol: string;
  currentPrice: number;
  snapshots: SnapshotRow[];
}
