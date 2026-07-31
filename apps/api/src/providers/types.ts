import type { Candle, Interval } from '../domain/candle.js';
import type { CandleListener, Subscription } from '../adapters/data-adapter.js';

/** Clases de activo que puede ofrecer un proveedor. */
export type AssetClass = 'cripto' | 'acciones' | 'forex' | 'indices' | 'materias';

export interface CatalogEntry {
  symbol: string;
  base: string;
  quote: string;
  label: string;
  provider: string;
  assetClass: AssetClass;
  /** Símbolo equivalente en TradingView, para el widget del gráfico. */
  tvSymbol?: string;
}

/**
 * Proveedor de datos de mercado.
 *
 * Dos modos posibles:
 * - `stream`: entrega velas en tiempo real por WebSocket (ideal; p. ej. Binance).
 * - `poll`: no ofrece streaming gratuito, así que TradeMe consulta cada cierto tiempo
 *   (p. ej. proveedores de acciones con plan gratuito REST).
 */
export interface MarketProvider {
  readonly id: string;
  readonly label: string;
  readonly assetClasses: AssetClass[];
  readonly mode: 'stream' | 'poll';
  /** false cuando falta configuración (p. ej. una clave de API). */
  readonly available: boolean;
  /** Motivo por el que no está disponible, para mostrarlo en la interfaz. */
  readonly unavailableReason?: string;

  searchCatalog(query: string, limit?: number): Promise<CatalogEntry[]>;
  exists(symbol: string): Promise<CatalogEntry | null>;
  getHistory(symbol: string, interval: Interval, limit: number, endTime?: number): Promise<Candle[]>;

  /** Arranca la entrega de velas (stream o sondeo). */
  start(subscriptions: Subscription[], onCandle: CandleListener): Promise<void>;
  /** Cambia las suscripciones en caliente. */
  resubscribe(subscriptions: Subscription[]): void;
  stop(): Promise<void>;
}
