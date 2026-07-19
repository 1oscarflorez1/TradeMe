import type {
  BacktestResult,
  CalibrationMeta,
  Candle,
  Interval,
  Signal,
  SnapshotsResponse,
  Vote,
} from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export interface SymbolsResponse {
  symbols: string[];
  intervals: Interval[];
}

export async function fetchSymbols(): Promise<SymbolsResponse> {
  const res = await fetch(`${API_URL}/symbols`);
  if (!res.ok) throw new Error(`GET /symbols ${res.status}`);
  return (await res.json()) as SymbolsResponse;
}

export async function fetchCandles(
  symbol: string,
  interval: Interval,
  limit = 300,
): Promise<Candle[]> {
  const res = await fetch(
    `${API_URL}/candles?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`GET /candles ${res.status}`);
  const body = (await res.json()) as { candles: Candle[] };
  return body.candles;
}

export async function fetchVotes(symbol: string, interval: Interval): Promise<Vote[]> {
  try {
    const res = await fetch(`${API_URL}/votes?symbol=${symbol}&interval=${interval}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { votes: Vote[] };
    return body.votes;
  } catch {
    return [];
  }
}

export async function fetchSignal(symbol: string, interval: Interval): Promise<Signal | null> {
  try {
    const res = await fetch(`${API_URL}/signal?symbol=${symbol}&interval=${interval}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { signal: Signal };
    return body.signal;
  } catch {
    return null;
  }
}

export async function postSnapshot(
  symbol: string,
  interval: Interval,
  note?: string,
): Promise<{ saved: boolean; id?: string } | null> {
  try {
    const res = await fetch(`${API_URL}/snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol, interval, note }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { saved: boolean; id?: string };
  } catch {
    return null;
  }
}

export async function fetchSnapshots(symbol: string): Promise<SnapshotsResponse | null> {
  try {
    const res = await fetch(`${API_URL}/snapshots?symbol=${symbol}&limit=50`);
    if (!res.ok) return null;
    return (await res.json()) as SnapshotsResponse;
  } catch {
    return null;
  }
}

export async function fetchBacktest(
  symbol: string,
  interval: Interval,
): Promise<BacktestResult | null> {
  try {
    const res = await fetch(`${API_URL}/backtest?symbol=${symbol}&interval=${interval}`);
    if (!res.ok) return null;
    return (await res.json()) as BacktestResult;
  } catch {
    return null;
  }
}

export async function fetchCalibration(): Promise<CalibrationMeta | null> {
  try {
    const res = await fetch(`${API_URL}/calibration`);
    if (!res.ok) return null;
    const data = (await res.json()) as { calibration: CalibrationMeta | null };
    return data.calibration;
  } catch {
    return null;
  }
}

export function streamUrl(symbol: string, interval: Interval): string {
  const url = new URL(API_URL);
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${url.host}/stream/${symbol}?interval=${interval}`;
}
