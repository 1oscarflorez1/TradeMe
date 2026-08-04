// Catálogo de activos disponibles.
//
// Importante: TradeMe puede DIBUJAR cualquier símbolo con el widget de TradingView, pero solo puede
// DECIDIR y hacer backtest sobre activos de los que obtiene velas. Hoy la fuente es Binance, así que
// el catálogo real es el suyo (spot). Al añadir otro proveedor (acciones, forex) basta sumar su
// catálogo aquí.

export interface CatalogEntry {
  symbol: string;
  base: string;
  quote: string;
  label: string;
}

interface BinanceSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
}

const TTL_MS = 6 * 60 * 60_000;

export class AssetCatalog {
  private cache: CatalogEntry[] = [];
  private fetchedAt = 0;

  constructor(private readonly url = 'https://api.binance.com/api/v3/exchangeInfo') {}

  async all(): Promise<CatalogEntry[]> {
    if (this.cache.length > 0 && Date.now() - this.fetchedAt < TTL_MS) return this.cache;
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`exchangeInfo ${res.status}`);
    const body = (await res.json()) as { symbols: BinanceSymbol[] };
    this.cache = body.symbols
      .filter((s) => s.status === 'TRADING' && s.isSpotTradingAllowed !== false)
      .map((s) => ({
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset,
        label: `${s.baseAsset} / ${s.quoteAsset}`,
      }));
    this.fetchedAt = Date.now();
    return this.cache;
  }

  /** Búsqueda por texto: exactos primero, luego por prefijo, luego por contenido. */
  async search(query: string, limit = 25): Promise<CatalogEntry[]> {
    const all = await this.all();
    const q = query.trim().toUpperCase();
    const rank = (e: CatalogEntry): number => (e.quote === 'USDT' ? 0 : e.quote === 'USDC' ? 1 : 2);
    if (!q) {
      const populares = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'TRX'];
      return all
        .filter((e) => e.quote === 'USDT' && populares.includes(e.base))
        .sort((a, b) => populares.indexOf(a.base) - populares.indexOf(b.base))
        .slice(0, limit);
    }
    const exact: CatalogEntry[] = [];
    const prefix: CatalogEntry[] = [];
    const contains: CatalogEntry[] = [];
    for (const e of all) {
      if (e.symbol === q || e.base === q) exact.push(e);
      else if (e.symbol.startsWith(q) || e.base.startsWith(q)) prefix.push(e);
      else if (e.symbol.includes(q)) contains.push(e);
    }
    return [
      ...exact.sort((a, b) => rank(a) - rank(b)),
      ...prefix.sort((a, b) => rank(a) - rank(b)),
      ...contains.sort((a, b) => rank(a) - rank(b)),
    ].slice(0, limit);
  }

  async exists(symbol: string): Promise<CatalogEntry | null> {
    const all = await this.all();
    return all.find((e) => e.symbol === symbol.toUpperCase()) ?? null;
  }
}
