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

/** Una sección del registro de cambios: Added · Changed · Fixed… con su título y sus viñetas. */
export interface ReleaseSection {
  categoria: string;
  titulo: string;
  puntos: string[];
}

export interface Release {
  version: string;
  fecha: string | null;
  nota: string | null;
  secciones: ReleaseSection[];
}

export interface ReleasesResponse {
  /** Versión que la plataforma está ejecutando ahora mismo. */
  actual: string;
  total: number;
  releases: Release[];
}

/**
 * Historial de versiones, leído del CHANGELOG por la API (M10.6).
 *
 * Antes esta lista vivía escrita a mano dentro de `NewsView.tsx` y se quedó seis versiones atrás:
 * el portal mostraba la 0.28.0 mientras la plataforma ejecutaba la 0.34.0.
 */
export async function fetchReleases(): Promise<ReleasesResponse> {
  const res = await apiFetch(`/releases`);
  if (!res.ok) throw new Error(`GET /releases ${res.status}`);
  return (await res.json()) as ReleasesResponse;
}

export async function fetchSymbols(): Promise<SymbolsResponse> {
  const res = await apiFetch(`/symbols`);
  if (!res.ok) throw new Error(`GET /symbols ${res.status}`);
  return (await res.json()) as SymbolsResponse;
}

/** Fallo de un proveedor de datos, con la causa y —si aplica— cuándo se resuelve solo. */
export class ErrorDeProveedor extends Error {
  constructor(
    readonly kind: 'sin_cupo' | 'no_soportado' | 'proveedor_caido',
    mensaje: string,
    readonly provider?: string,
    readonly retryAt?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorDeProveedor';
  }
}

export async function fetchCandles(
  symbol: string,
  interval: Interval,
  limit = 300,
): Promise<Candle[]> {
  const res = await apiFetch(`/candles?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) {
    // El backend distingue sin cupo, activo no servido y proveedor caído. Perder ese matiz aquí
    // devolvería al «Error: GET /candles 502» que no decía nada.
    const detalle = (await res.json().catch(() => null)) as {
      error?: string;
      kind?: 'sin_cupo' | 'no_soportado' | 'proveedor_caido';
      provider?: string;
      retryAt?: string;
    } | null;
    throw new ErrorDeProveedor(
      detalle?.kind ?? 'proveedor_caido',
      detalle?.error ?? `GET /candles ${res.status}`,
      detalle?.provider,
      detalle?.retryAt,
    );
  }
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

export interface AutomationStatus {
  enabled: boolean;
  backtest_every_h: number;
  optimize_every_h: number;
  cooldown_h: number;
  calibrate_every_h?: number;
  metamodel_every_h?: number;
  hours_since_calibration?: number | null;
  hours_since_metamodel?: number | null;
  meta_policy?: {
    mode?: string;
    reason?: string;
    updated_at?: string | null;
    evidence?: { n?: number; lift?: number; auc?: number; kept?: number };
  };
  intervals: string[];
  last_cycle: string | null;
  per_tf: Array<{
    symbol: string;
    interval: string;
    hours_since_backtest: number | null;
    hours_since_optimize: number | null;
  }>;
}

export async function fetchAutomation(): Promise<AutomationStatus | null> {
  try {
    const res = await apiFetch('/automation');
    if (!res.ok) return null;
    return (await res.json()) as AutomationStatus;
  } catch {
    return null;
  }
}

export async function postAutomation(
  overrides: Partial<
    Pick<
      AutomationStatus,
      'enabled' | 'backtest_every_h' | 'optimize_every_h' | 'cooldown_h' | 'intervals'
    > & { trials: number }
  >,
): Promise<AutomationStatus | null> {
  try {
    const res = await apiFetch('/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrides),
    });
    if (!res.ok) return null;
    return (await res.json()) as AutomationStatus;
  } catch {
    return null;
  }
}

export async function runCalibrate(
  symbol: string,
  interval: Interval,
): Promise<{ ok: boolean }> {
  try {
    const res = await apiFetch(`/calibrate/run?symbol=${symbol}&interval=${interval}`, {
      method: 'POST',
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

export interface MetamodelResult {
  trained: boolean;
  reason?: string;
  n?: number;
  auc?: number;
  threshold?: number;
  baseline_expectancy?: number;
  filtered_expectancy?: number;
  published?: boolean;
}

export async function trainMetamodel(): Promise<MetamodelResult | null> {
  try {
    const res = await apiFetch('/ml/train', { method: 'POST' });
    if (!res.ok) return null;
    return (await res.json()) as MetamodelResult;
  } catch {
    return null;
  }
}

export interface SystemComponent {
  key: string;
  label: string;
  status: 'ok' | 'degradado' | 'caido' | 'na';
  detail: string;
  ms?: number;
}

export interface SystemStatus {
  overall: 'ok' | 'degradado' | 'caido';
  checked_at: string;
  took_ms: number;
  version: string;
  components: SystemComponent[];
}

export async function fetchSystemStatus(): Promise<SystemStatus | null> {
  try {
    const res = await apiFetch('/status');
    if (!res.ok) return null;
    return (await res.json()) as SystemStatus;
  } catch {
    return null;
  }
}

export interface AssistantInfo {
  enabled: boolean;
  model: string;
  host: string;
  busqueda?: { enabled: boolean; provider: string };
}

export async function fetchAssistantInfo(): Promise<AssistantInfo> {
  try {
    const res = await apiFetch('/assistant/info');
    if (!res.ok) return { enabled: false, model: '', host: '' };
    return (await res.json()) as AssistantInfo;
  } catch {
    return { enabled: false, model: '', host: '' };
  }
}

/** Pregunta al modelo a través de la API. La clave nunca llega al navegador. */
export async function askAssistant(
  pregunta: string,
  historial: Array<{ role: 'user' | 'assistant'; content: string }>,
  symbol: string,
  interval: string,
): Promise<{ texto: string; modelo: string; consultas?: string[] } | { error: string }> {
  try {
    const res = await apiFetch('/assistant/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregunta, historial, symbol, interval }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      texto?: string;
      modelo?: string;
      consultas?: string[];
      error?: string;
    };
    if (!res.ok || !body.texto) return { error: body.error ?? `HTTP ${res.status}` };
    return { texto: body.texto, modelo: body.modelo ?? '', consultas: body.consultas };
  } catch (e) {
    return { error: String(e) };
  }
}

export interface EvidenciaIndicador {
  clave: string;
  etiqueta: string;
  familia: string;
  nAcuerdo: number;
  aciertoAcuerdo: number | null;
  nDesacuerdo: number;
  aciertoDesacuerdo: number | null;
  lift: number | null;
}

export interface Sustento {
  symbol: string;
  interval: string;
  version: string;
  optimizado: boolean;
  pesos: Record<string, number>;
  pesosExternos: Record<string, number>;
  regimen: {
    adx_threshold: number;
    adx_lo: number;
    adx_hi: number;
    trend: Record<string, number>;
    range: Record<string, number>;
  };
  temperature: number;
  holdBand: number;
  riesgo: { atrStopMult: number; tpRMultiple: number; riskPct: number };
  evidencia: EvidenciaIndicador[];
}

export async function fetchSustento(symbol: string, interval: string): Promise<Sustento | null> {
  try {
    const res = await apiFetch(
      `/decision/sustento?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as Sustento;
  } catch {
    return null;
  }
}

export interface BacktestHistoryRow {
  id: string;
  created_at: string;
  n_trades: number | null;
  win_rate: number | null;
  expectancy: number | null;
  profit_factor: number | null;
  max_drawdown: number | null;
  sharpe: number | null;
  oos_win_rate: number | null;
  oos_expectancy: number | null;
}

export async function fetchBacktestHistory(
  symbol: string,
  interval: string,
): Promise<BacktestHistoryRow[]> {
  try {
    const res = await apiFetch(
      `/backtest/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`,
    );
    if (!res.ok) return [];
    return ((await res.json()) as { runs: BacktestHistoryRow[] }).runs;
  } catch {
    return [];
  }
}

export interface TimeframeUsage {
  interval: string;
  captura: boolean;
  optimizado: boolean;
  backtest: boolean;
  registros: number;
  expectancy: number | null;
}

export async function fetchTimeframeUsage(symbol: string): Promise<TimeframeUsage[]> {
  try {
    const res = await apiFetch(`/timeframes?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return [];
    return ((await res.json()) as { usage: TimeframeUsage[] }).usage;
  } catch {
    return [];
  }
}

export interface AssetRow {
  symbol: string;
  label: string | null;
  enabled: boolean;
  provider: string;
  assetClass: string;
  tvSymbol: string | null;
}
export interface CatalogHit {
  symbol: string;
  base: string;
  quote: string;
  label: string;
  provider: string;
  assetClass: string;
  tvSymbol?: string;
}
export interface ProviderInfo {
  id: string;
  label: string;
  assetClasses: string[];
  mode: 'stream' | 'poll';
  available: boolean;
  unavailableReason?: string;
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  try {
    const res = await apiFetch('/assets/providers');
    if (!res.ok) return [];
    return ((await res.json()) as { providers: ProviderInfo[] }).providers;
  } catch {
    return [];
  }
}

export async function fetchAssets(): Promise<AssetRow[]> {
  try {
    const res = await apiFetch('/assets');
    if (!res.ok) return [];
    return ((await res.json()) as { assets: AssetRow[] }).assets;
  } catch {
    return [];
  }
}

export async function searchAssets(q: string, assetClass?: string): Promise<CatalogHit[]> {
  try {
    const clase = assetClass ? `&assetClass=${encodeURIComponent(assetClass)}` : '';
    const res = await apiFetch(`/assets/search?q=${encodeURIComponent(q)}${clase}`);
    if (!res.ok) return [];
    return ((await res.json()) as { results: CatalogHit[] }).results;
  } catch {
    return [];
  }
}

export async function addAsset(
  symbol: string,
  provider?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch('/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, provider }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function removeAsset(symbol: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/assets/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function toggleAsset(symbol: string, enabled: boolean): Promise<boolean> {
  try {
    const res = await apiFetch(`/assets/${encodeURIComponent(symbol)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    return res.ok;
  } catch {
    return false;
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
): Promise<{ ok: boolean; promoted?: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/optimize/run?symbol=${symbol}&interval=${interval}`, {
      method: 'POST',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { promoted?: boolean };
    return { ok: true, promoted: body.promoted };
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
