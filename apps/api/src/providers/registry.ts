import type { Candle, Interval } from '../domain/candle.js';
import type { AdapterLogger, CandleListener, Subscription } from '../adapters/data-adapter.js';
import type { AssetClass, CatalogEntry, MarketProvider } from './types.js';

export interface ProviderInfo {
  id: string;
  label: string;
  assetClasses: AssetClass[];
  mode: 'stream' | 'poll';
  available: boolean;
  unavailableReason?: string;
}

/**
 * Punto único por el que el motor pide datos. Sabe qué proveedor sirve cada símbolo, reparte las
 * suscripciones y combina los catálogos en una sola búsqueda.
 *
 * El primer proveedor de la lista es el preferente cuando un símbolo existe en varios.
 */
export class ProviderRegistry {
  private readonly rutas = new Map<string, string>();

  constructor(private readonly providers: MarketProvider[]) {
    if (providers.length === 0) throw new Error('el registro necesita al menos un proveedor');
  }

  setLogger(log: AdapterLogger): void {
    for (const p of this.providers) {
      (p as { setLogger?: (l: AdapterLogger) => void }).setLogger?.(log);
    }
  }

  info(): ProviderInfo[] {
    return this.providers.map((p) => ({
      id: p.id,
      label: p.label,
      assetClasses: p.assetClasses,
      mode: p.mode,
      available: p.available,
      unavailableReason: p.unavailableReason,
    }));
  }

  get default(): MarketProvider {
    return this.providers.find((p) => p.available) ?? this.providers[0]!;
  }

  byId(id: string | null | undefined): MarketProvider | null {
    return this.providers.find((p) => p.id === id) ?? null;
  }

  /** Fija a qué proveedor pertenece un símbolo (lo alimenta la watchlist). */
  setRoute(symbol: string, providerId: string): void {
    if (this.byId(providerId)) this.rutas.set(symbol.toUpperCase(), providerId);
  }

  routeOf(symbol: string): string | null {
    return this.rutas.get(symbol.toUpperCase()) ?? null;
  }

  /** Proveedor responsable de un símbolo: ruta conocida, o el primero que lo reconozca. */
  async resolve(symbol: string): Promise<MarketProvider> {
    const conocido = this.byId(this.routeOf(symbol));
    if (conocido) return conocido;
    for (const p of this.providers) {
      if (!p.available) continue;
      const hit = await p.exists(symbol).catch(() => null);
      if (hit) {
        this.setRoute(symbol, p.id);
        return p;
      }
    }
    return this.default;
  }

  /** Busca en todos los proveedores disponibles y entrelaza resultados para que se vean todos. */
  async search(query: string, limit = 25, assetClass?: AssetClass): Promise<CatalogEntry[]> {
    const candidatos = this.providers.filter(
      (p) => p.available && (!assetClass || p.assetClasses.includes(assetClass)),
    );
    const listas = await Promise.all(
      candidatos.map((p) => p.searchCatalog(query, limit).catch(() => [] as CatalogEntry[])),
    );
    const filtradas = listas.map((l) => (assetClass ? l.filter((e) => e.assetClass === assetClass) : l));
    const salida: CatalogEntry[] = [];
    const vistos = new Set<string>();
    for (let i = 0; salida.length < limit; i += 1) {
      let quedan = false;
      for (const lista of filtradas) {
        const entrada = lista[i];
        if (!entrada) continue;
        quedan = true;
        const clave = `${entrada.provider}:${entrada.symbol}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        salida.push(entrada);
        if (salida.length >= limit) break;
      }
      if (!quedan) break;
    }
    return salida;
  }

  /** Comprueba un símbolo, opcionalmente forzando proveedor. */
  async exists(symbol: string, providerId?: string): Promise<CatalogEntry | null> {
    const forzado = this.byId(providerId);
    const lista = forzado ? [forzado] : this.providers.filter((p) => p.available);
    for (const p of lista) {
      const hit = await p.exists(symbol).catch(() => null);
      if (hit) {
        this.setRoute(hit.symbol, p.id);
        return hit;
      }
    }
    return null;
  }

  async getHistory(
    symbol: string,
    interval: Interval,
    limit: number,
    endTime?: number,
  ): Promise<Candle[]> {
    const p = await this.resolve(symbol);
    return p.getHistory(symbol, interval, limit, endTime);
  }

  private split(subscriptions: Subscription[]): Map<string, Subscription[]> {
    const porProveedor = new Map<string, Subscription[]>();
    for (const p of this.providers) porProveedor.set(p.id, []);
    for (const sub of subscriptions) {
      const id = this.routeOf(sub.symbol) ?? this.default.id;
      porProveedor.get(id)?.push(sub);
    }
    return porProveedor;
  }

  async start(subscriptions: Subscription[], onCandle: CandleListener): Promise<void> {
    const reparto = this.split(subscriptions);
    await Promise.all(
      this.providers.map((p) => p.start(reparto.get(p.id) ?? [], onCandle)),
    );
  }

  resubscribe(subscriptions: Subscription[]): void {
    const reparto = this.split(subscriptions);
    for (const p of this.providers) p.resubscribe(reparto.get(p.id) ?? []);
  }

  async stop(): Promise<void> {
    await Promise.all(this.providers.map((p) => p.stop()));
  }
}
