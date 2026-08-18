import { CandleSchema, intervalMs, type Candle, type Interval } from '../domain/candle.js';
import { PollingProvider, type PollingOptions } from './polling-provider.js';
import { RateBudget } from './rate-budget.js';
import { ProviderError } from './errors.js';
import type { AssetClass, CatalogEntry } from './types.js';

const BASE = 'https://api.twelvedata.com';

/** Nuestras temporalidades → las que entiende Twelve Data. */
const INTERVAL_MAP: Partial<Record<Interval, string>> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
  '1w': '1week',
  '1M': '1month',
};

/**
 * Los símbolos de este proveedor pueden llevar barra (`EUR/USD`), que no es segura en URLs ni como
 * clave. Dentro de TradeMe se guardan con guion (`EUR-USD`) y se traducen al consultar.
 */
export const toCanonical = (s: string): string => s.replace(/\//g, '-').toUpperCase();
export const toProviderSymbol = (s: string): string => s.replace(/-/g, '/').toUpperCase();

interface SearchHit {
  symbol: string;
  instrument_name?: string;
  exchange?: string;
  country?: string;
  currency?: string;
  instrument_type?: string;
}

interface TimeSeriesRow {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

function claseDe(tipo: string | undefined): AssetClass {
  const t = (tipo ?? '').toLowerCase();
  if (t.includes('digital') || t.includes('crypto')) return 'cripto';
  if (t.includes('physical currency') || t.includes('forex')) return 'forex';
  if (t.includes('index')) return 'indices';
  if (t.includes('commodity')) return 'materias';
  return 'acciones';
}

/** "2024-05-01" o "2024-05-01 14:30:00" (en UTC, porque lo pedimos así) → epoch ms. */
export function parseDatetime(value: string): number {
  const iso = value.includes(' ') ? `${value.replace(' ', 'T')}Z` : `${value}T00:00:00Z`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`fecha no reconocida: ${value}`);
  return ms;
}

export interface TwelveDataOptions extends PollingOptions {
  apiKey?: string;
  base?: string;
  /** Reloj inyectable, para poder probar el cierre de la última vela. */
  now?: () => number;
}

/**
 * Acciones, forex, índices y ETF con plan gratuito (REST, sin streaming).
 * Si no hay clave configurada el proveedor queda visible pero inactivo: la interfaz lo explica y
 * TradeMe sigue funcionando solo con Binance.
 */
export class TwelveDataProvider extends PollingProvider {
  readonly id = 'twelvedata';
  readonly label = 'Twelve Data (acciones, forex, índices)';
  readonly assetClasses: AssetClass[] = ['acciones', 'forex', 'indices', 'materias'];

  private readonly apiKey: string;
  private readonly base: string;
  private readonly clock: () => number;
  private readonly cacheBusqueda = new Map<string, { at: number; hits: CatalogEntry[] }>();

  constructor(opts: TwelveDataOptions = {}) {
    super({
      // Plan gratuito: 8 peticiones/minuto y 800/día. Dejamos margen.
      budget: opts.budget ?? new RateBudget(6, 700),
      ...opts,
    });
    this.apiKey = (opts.apiKey ?? '').trim();
    this.base = opts.base ?? BASE;
    this.clock = opts.now ?? (() => Date.now());
  }

  get available(): boolean {
    return this.apiKey.length > 0;
  }

  override get unavailableReason(): string | undefined {
    return this.available
      ? undefined
      : 'Falta TWELVEDATA_API_KEY. Crea una clave gratuita en twelvedata.com y añádela al .env.';
  }

  supportsInterval(interval: Interval): boolean {
    return INTERVAL_MAP[interval] !== undefined;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.base}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('apikey', this.apiKey);
    const res = await fetch(url);
    if (!res.ok) throw this.traduce(res.status, `${path} respondió ${res.status}`);
    const body = (await res.json()) as T & { status?: string; message?: string; code?: number };
    // Twelve Data responde 200 con `{status:"error", code:429}` cuando se agota el cupo. Sin esta
    // rama, quedarse sin créditos era indistinguible de cualquier otro fallo.
    if (body.status === 'error') throw this.traduce(body.code ?? 0, body.message ?? 'error');
    return body;
  }

  async searchCatalog(query: string, limit = 25): Promise<CatalogEntry[]> {
    if (!this.available) return [];
    const q = query.trim();
    if (q.length < 1) return [];
    const cached = this.cacheBusqueda.get(q.toUpperCase());
    if (cached && this.clock() - cached.at < 10 * 60_000) return cached.hits.slice(0, limit);
    if (!this.budget.tryTake()) return [];
    const body = await this.get<{ data?: SearchHit[] }>('symbol_search', {
      symbol: q,
      outputsize: String(Math.min(50, limit * 2)),
    });
    // El mismo ticker cotiza en muchas bolsas: AAPL vuelve diez veces (NASDAQ en dólares, BMV en
    // pesos mexicanos, GPW en zlotys…). Se deduplica por símbolo, pero antes hay que decidir con
    // cuál quedarse, porque la primera que devuelva la API no siempre es la buena. Se prefiere el
    // mercado de referencia: cotización en USD y bolsa principal.
    const BOLSAS_PRINCIPALES = new Set(['NASDAQ', 'NYSE', 'NYSE ARCA', 'AMEX', 'CBOE', 'BATS']);
    const prioridad = (h: SearchHit): number => {
      let p = 0;
      if ((h.currency ?? '').toUpperCase() === 'USD') p -= 2;
      if (BOLSAS_PRINCIPALES.has((h.exchange ?? '').toUpperCase())) p -= 1;
      // Un ADR es un envoltorio del original: si está el original, mejor el original.
      if ((h.instrument_type ?? '').toLowerCase().includes('depositary')) p += 1;
      return p;
    };
    const ordenados = [...(body.data ?? [])].sort((a, b) => prioridad(a) - prioridad(b));

    const vistos = new Set<string>();
    const hits: CatalogEntry[] = [];
    for (const h of ordenados) {
      const symbol = toCanonical(h.symbol);
      if (vistos.has(symbol)) continue;
      vistos.add(symbol);
      const assetClass = claseDe(h.instrument_type);
      // La moneda va en la etiqueta: es lo que distingue de un vistazo el AAPL de Nueva York del
      // de Ciudad de México cuando ambos aparecen.
      const mercado = [h.exchange, h.currency].filter(Boolean).join(' · ');
      hits.push({
        symbol,
        base: symbol.split('-')[0] ?? symbol,
        quote: h.currency ?? '',
        label: h.instrument_name ? `${h.instrument_name}${mercado ? ` · ${mercado}` : ''}` : symbol,
        provider: this.id,
        assetClass,
        tvSymbol: h.exchange ? `${h.exchange}:${h.symbol.replace(/\//g, '')}` : undefined,
      });
    }
    this.cacheBusqueda.set(q.toUpperCase(), { at: this.clock(), hits });
    return hits.slice(0, limit);
  }

  async exists(symbol: string): Promise<CatalogEntry | null> {
    const objetivo = toCanonical(symbol);
    const hits = await this.searchCatalog(objetivo.replace(/-/g, ' '), 30).catch(() => []);
    return hits.find((h) => h.symbol === objetivo) ?? null;
  }

  /** Convierte un código del proveedor en un error que dice qué pasó y si se arregla solo. */
  private traduce(code: number, mensaje: string): ProviderError {
    if (code === 429) {
      return new ProviderError(
        'sin_cupo',
        this.id,
        `Cupo diario de ${this.id} agotado. ${mensaje}`,
        this.budget.resetAt(),
      );
    }
    if (code === 400 || code === 404) {
      return new ProviderError('no_soportado', this.id, `${this.id} no sirve ese dato: ${mensaje}`);
    }
    return new ProviderError('proveedor_caido', this.id, `${this.id}: ${mensaje}`);
  }

  async getHistory(
    symbol: string,
    interval: Interval,
    limit: number,
    endTime?: number,
  ): Promise<Candle[]> {
    if (!this.available) return [];
    const tdInterval = INTERVAL_MAP[interval];
    if (!tdInterval) {
      throw new ProviderError(
        'no_soportado',
        this.id,
        `${this.id} no ofrece la temporalidad ${interval}`,
      );
    }
    // El presupuesto tiene que cubrir ESTA vía, que es la del portal y la de mayor consumo.
    // Hasta M11.1 solo protegía el sondeo y la búsqueda: abrir el panel con una acción disparaba
    // ocho peticiones sin control —una por temporalidad— y agotaba 800 créditos en una tarde.
    if (!this.budget.tryTake()) {
      throw new ProviderError(
        'sin_cupo',
        this.id,
        this.budget.agotadoDia
          ? `Cupo diario de ${this.id} agotado.`
          : `Límite por minuto de ${this.id} alcanzado; inténtalo en unos segundos.`,
        this.budget.agotadoDia ? this.budget.resetAt() : undefined,
      );
    }
    const params: Record<string, string> = {
      symbol: toProviderSymbol(symbol),
      interval: tdInterval,
      outputsize: String(Math.max(1, Math.min(5000, limit))),
      order: 'ASC',
      timezone: 'UTC',
    };
    if (endTime) params.end_date = new Date(endTime).toISOString().slice(0, 19).replace('T', ' ');
    const body = await this.get<{ values?: TimeSeriesRow[] }>('time_series', params);
    const ahora = this.clock();
    const paso = intervalMs(interval);
    return (body.values ?? []).map((row) => {
      const openTime = parseDatetime(row.datetime);
      const closeTime = openTime + paso - 1;
      return CandleSchema.parse({
        symbol: toCanonical(symbol),
        interval,
        openTime,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume ?? 0),
        closeTime,
        closed: ahora > closeTime,
      });
    });
  }
}
