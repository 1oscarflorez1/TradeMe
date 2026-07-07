import type { Candle, Interval, Vote } from './types';

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

export function streamUrl(symbol: string, interval: Interval): string {
  const url = new URL(API_URL);
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${url.host}/stream/${symbol}?interval=${interval}`;
}
