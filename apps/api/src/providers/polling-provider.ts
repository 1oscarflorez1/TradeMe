import { intervalMs, type Candle, type Interval } from '../domain/candle.js';
import type { AdapterLogger, CandleListener, Subscription } from '../adapters/data-adapter.js';
import { RateBudget } from './rate-budget.js';
import type { AssetClass, CatalogEntry, MarketProvider } from './types.js';

const NOOP_LOGGER: AdapterLogger = { info: () => {}, warn: () => {}, error: () => {} };

export interface PollingOptions {
  /** Cada cuánto revisa el planificador qué suscripción toca (no es la frecuencia de consulta). */
  tickMs?: number;
  minPollMs?: number;
  maxPollMs?: number;
  budget?: RateBudget;
  logger?: AdapterLogger;
}

const key = (s: Subscription): string => `${s.symbol}|${s.interval}`;

/**
 * Base para proveedores sin streaming gratuito: TradeMe consulta el histórico reciente cada cierto
 * tiempo y emite las velas *cerradas* que aún no había visto. El resto del motor no nota la
 * diferencia, porque recibe exactamente el mismo objeto `Candle` que con Binance.
 *
 * La cadencia se deriva de la temporalidad (≈ un cuarto de vela) y siempre pasa por el
 * presupuesto de peticiones, así que un plan gratuito no se agota.
 */
export abstract class PollingProvider implements MarketProvider {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly assetClasses: AssetClass[];
  abstract get available(): boolean;
  readonly mode = 'poll' as const;
  get unavailableReason(): string | undefined {
    return undefined;
  }

  abstract searchCatalog(query: string, limit?: number): Promise<CatalogEntry[]>;
  abstract exists(symbol: string): Promise<CatalogEntry | null>;
  abstract getHistory(
    symbol: string,
    interval: Interval,
    limit: number,
    endTime?: number,
  ): Promise<Candle[]>;

  protected log: AdapterLogger;
  protected readonly budget: RateBudget;
  private readonly tickMs: number;
  private readonly minPollMs: number;
  private readonly maxPollMs: number;

  private subs: Subscription[] = [];
  private onCandle: CandleListener = () => {};
  private lastOpen = new Map<string, number>();
  private nextDue = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(opts: PollingOptions = {}) {
    this.tickMs = opts.tickMs ?? 15_000;
    this.minPollMs = opts.minPollMs ?? 60_000;
    this.maxPollMs = opts.maxPollMs ?? 15 * 60_000;
    this.budget = opts.budget ?? new RateBudget(8, 800);
    this.log = opts.logger ?? NOOP_LOGGER;
  }

  setLogger(logger: AdapterLogger): void {
    this.log = logger;
  }

  budgetStatus(): ReturnType<RateBudget['status']> {
    return this.budget.status();
  }

  /** Cada cuánto consultar una temporalidad: ~1/4 de vela, acotado por los límites del plan. */
  pollIntervalMs(interval: Interval): number {
    return Math.min(this.maxPollMs, Math.max(this.minPollMs, Math.round(intervalMs(interval) / 4)));
  }

  async start(subscriptions: Subscription[], onCandle: CandleListener): Promise<void> {
    this.subs = [...subscriptions];
    this.onCandle = onCandle;
    this.stopped = false;
    if (!this.available) {
      this.log.warn({ provider: this.id }, 'proveedor sin configurar: no se sondea');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
    await this.tick();
  }

  resubscribe(subscriptions: Subscription[]): void {
    const vivos = new Set(subscriptions.map(key));
    for (const k of [...this.nextDue.keys()]) {
      if (!vivos.has(k)) {
        this.nextDue.delete(k);
        this.lastOpen.delete(k);
      }
    }
    this.subs = [...subscriptions];
  }

  /** Una pasada del planificador. Público para poder probarlo sin temporizadores. */
  async tick(now: number = Date.now()): Promise<void> {
    if (this.stopped || !this.available) return;
    for (const sub of this.subs) {
      const k = key(sub);
      if ((this.nextDue.get(k) ?? 0) > now) continue;
      if (!this.budget.tryTake()) {
        this.log.warn({ provider: this.id }, 'presupuesto de peticiones agotado; se reintenta luego');
        return;
      }
      this.nextDue.set(k, now + this.pollIntervalMs(sub.interval));
      try {
        const velas = await this.getHistory(sub.symbol, sub.interval, 3);
        const cerradas = velas.filter((c) => c.closed);
        if (cerradas.length === 0) continue;
        // Primera pasada: solo se toma nota de dónde vamos; el histórico ya lo siembra el servidor.
        if (!this.lastOpen.has(k)) {
          this.lastOpen.set(k, Math.max(...cerradas.map((c) => c.openTime)));
          continue;
        }
        const desde = this.lastOpen.get(k) ?? 0;
        for (const vela of cerradas.sort((a, b) => a.openTime - b.openTime)) {
          if (vela.openTime <= desde) continue;
          this.lastOpen.set(k, vela.openTime);
          this.onCandle(vela);
        }
      } catch (err) {
        this.log.warn({ provider: this.id, sub: k, err: String(err) }, 'fallo al sondear velas');
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
