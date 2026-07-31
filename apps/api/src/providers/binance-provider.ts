import { BinanceAdapter } from '../adapters/binance-adapter.js';
import { AssetCatalog } from '../market/catalog.js';
import type { Candle, Interval } from '../domain/candle.js';
import type { CandleListener, Subscription, AdapterLogger } from '../adapters/data-adapter.js';
import type { AssetClass, CatalogEntry, MarketProvider } from './types.js';

/** Cripto en tiempo real (WebSocket). Es el proveedor con el que nació TradeMe. */
export class BinanceProvider implements MarketProvider {
  readonly id = 'binance';
  readonly label = 'Binance (cripto)';
  readonly assetClasses: AssetClass[] = ['cripto'];
  readonly mode = 'stream' as const;
  readonly available = true;

  private readonly adapter = new BinanceAdapter();
  private readonly catalog = new AssetCatalog();

  setLogger(log: AdapterLogger): void {
    this.adapter.setLogger(log);
  }

  async searchCatalog(query: string, limit = 25): Promise<CatalogEntry[]> {
    const hits = await this.catalog.search(query, limit);
    return hits.map((h) => ({
      ...h,
      provider: this.id,
      assetClass: 'cripto' as const,
      tvSymbol: `BINANCE:${h.symbol}`,
    }));
  }

  async exists(symbol: string): Promise<CatalogEntry | null> {
    const e = await this.catalog.exists(symbol);
    return e
      ? { ...e, provider: this.id, assetClass: 'cripto', tvSymbol: `BINANCE:${e.symbol}` }
      : null;
  }

  getHistory(symbol: string, interval: Interval, limit: number, endTime?: number): Promise<Candle[]> {
    return this.adapter.getHistory(symbol, interval, limit, endTime);
  }

  start(subscriptions: Subscription[], onCandle: CandleListener): Promise<void> {
    return this.adapter.start(subscriptions, onCandle);
  }

  resubscribe(subscriptions: Subscription[]): void {
    this.adapter.resubscribe(subscriptions);
  }

  stop(): Promise<void> {
    return this.adapter.stop();
  }
}
