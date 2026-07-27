import type {
  BacktestResult,
  CalibrationMeta,
  Alert,
  AlertInputWeb,
  Candle,
  EnsembleMeta,
  Interval,
  Signal,
  SnapshotsResponse,
  Vote,
} from './types';
import { authHeaders, getToken, setToken } from './auth';

// '||' a propósito: un VITE_API_URL vacío (build sin el arg) debe caer al default, no quedarse ''.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/** fetch con la cabecera de sesión ya puesta; si el servidor dice 401, cierra la sesión local
 * (el token venció o es inválido) para que la app vuelva a mostrar el login. */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init.headers },
  });
  if (res.status === 401 && getToken()) setToken(null);
  return res;
}

export interface SymbolsResponse {
  symbols: string[];
  intervals: Interval[];
}

export interface AuthUser {
  id: string;
  email: string;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `login ${res.status}`);
  }
  const body = (await res.json()) as { token: string; user: AuthUser };
  setToken(body.token);
  return body.user;
}

export async function fetchMe(): Promise<AuthUser | null> {
  if (!getToken()) return null;
  try {
    const res = await apiFetch('/auth/me');
    if (!res.ok) return null;
    return (await res.json()) as AuthUser;
  } catch {
    return null;
  }
}

export function logout(): void {
  setToken(null);
}

/** El backend anuncia en /health si exige login (JWT_SECRET configurado). Sin auth
 * configurada (dev sin Módulo 3 activo) la app no debe pedir credenciales. */
export async function fetchAuthRequired(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    if (!res.ok) return false;
    const body = (await res.json()) as { authRequired?: boolean };
    return Boolean(body.authRequired);
  } catch {
    return false;
  }
}

export async function fetchSymbols(): Promise<SymbolsResponse> {
  const res = await apiFetch(`/symbols`);
  if (!res.ok) throw new Error(`GET /symbols ${res.status}`);
  return (await res.json()) as SymbolsResponse;
}

export async function fetchCandles(
  symbol: string,
  interval: Interval,
  limit = 300,
): Promise<Candle[]> {
  const res = await apiFetch(`/candles?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`GET /candles ${res.status}`);
  const body = (await res.json()) as { candles: Candle[] };
  return body.candles;
}

export async function fetchVotes(symbol: string, interval: Interval): Promise<Vote[]> {
  try {
    const res = await apiFetch(`/votes?symbol=${symbol}&interval=${interval}`);
    if (!res.ok) return [];
    const body = (await res.json()) as { votes: Vote[] };
    return body.votes;
  } catch {
    return [];
  }
}

export async function fetchSignal(symbol: string, interval: Interval): Promise<Signal | null> {
  try {
    const res = await apiFetch(`/signal?symbol=${symbol}&interval=${interval}`);
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
    const res = await apiFetch(`/snapshots`, {
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
    const res = await apiFetch(`/snapshots?symbol=${symbol}&limit=500`);
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
    const res = await apiFetch(`/backtest?symbol=${symbol}&interval=${interval}`);
    if (!res.ok) return null;
    return (await res.json()) as BacktestResult;
  } catch {
    return null;
  }
}

export async function fetchCalibration(): Promise<CalibrationMeta | null> {
  try {
    const res = await apiFetch(`/calibration`);
    if (!res.ok) return null;
    const data = (await res.json()) as { calibration: CalibrationMeta | null };
    return data.calibration;
  } catch {
    return null;
  }
}

export async function fetchEnsemble(
  symbol: string,
  interval: Interval,
): Promise<EnsembleMeta | null> {
  try {
    const res = await apiFetch(`/ensemble?symbol=${symbol}&interval=${interval}`);
    if (!res.ok) return null;
    return (await res.json()) as EnsembleMeta;
  } catch {
    return null;
  }
}

export async function deleteSnapshot(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/snapshots/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchCandlesUntil(
  symbol: string,
  interval: Interval,
  endMs: number,
  limit = 150,
): Promise<Candle[]> {
  try {
    const res = await apiFetch(
      `/candles?symbol=${symbol}&interval=${interval}&limit=${limit}&to=${endMs}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { candles: Candle[] };
    return body.candles;
  } catch {
    return [];
  }
}

export async function fetchAlerts(limit = 50): Promise<{ alerts: Alert[]; unread: number }> {
  try {
    const res = await apiFetch(`/alerts?limit=${limit}`);
    if (!res.ok) return { alerts: [], unread: 0 };
    return (await res.json()) as { alerts: Alert[]; unread: number };
  } catch {
    return { alerts: [], unread: 0 };
  }
}

export async function postAlert(a: AlertInputWeb): Promise<Alert | null> {
  try {
    const res = await apiFetch(`/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { alert: Alert }).alert;
  } catch {
    return null;
  }
}

export async function markAlertsRead(): Promise<boolean> {
  try {
    const res = await apiFetch(`/alerts/read`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchVapidKey(): Promise<string | null> {
  try {
    const res = await apiFetch(`/push/vapid`);
    if (!res.ok) return null;
    return ((await res.json()) as { publicKey: string | null }).publicKey;
  } catch {
    return null;
  }
}

export async function postPushSubscribe(sub: unknown): Promise<boolean> {
  try {
    const res = await apiFetch(`/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface DatasetReport {
  total: number;
  evaluated: number;
  pending: number;
  tp: number;
  sl: number;
  timeout: number;
  by_interval: Array<{ interval: string; total: number; evaluated: number }>;
  by_regime: Record<string, number>;
  feature_completeness: number;
  criteria: { min_evaluated: number; min_per_class: number; min_feature_completeness: number };
  ready: boolean;
  reasons: string[];
}

export async function fetchDatasetReport(): Promise<DatasetReport | null> {
  try {
    const res = await apiFetch('/ml/dataset');
    if (!res.ok) return null;
    return (await res.json()) as DatasetReport;
  } catch {
    return null;
  }
}

export async function runBacktest(
  symbol: string,
  interval: Interval,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/backtest/run?symbol=${symbol}&interval=${interval}`, {
      method: 'POST',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function runOptimize(
  symbol: string,
  interval: Interval,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/optimize/run?symbol=${symbol}&interval=${interval}`, {
      method: 'POST',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function postReload(): Promise<boolean> {
  try {
    const res = await apiFetch(`/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function streamUrl(symbol: string, interval: Interval): string {
  const url = new URL(API_URL);
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getToken();
  const qs = token ? `?interval=${interval}&token=${encodeURIComponent(token)}` : `?interval=${interval}`;
  return `${proto}//${url.host}/stream/${symbol}${qs}`;
}
