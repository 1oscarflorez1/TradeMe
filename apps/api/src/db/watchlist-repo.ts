import type pg from 'pg';

export interface WatchlistRow {
  symbol: string;
  label: string | null;
  enabled: boolean;
  added_at: string;
  provider: string;
  asset_class: string;
  tv_symbol: string | null;
}

export interface WatchlistEntry {
  symbol: string;
  provider: string;
}

/** Activos que TradeMe sigue, con el proveedor del que salen sus velas. */
export class WatchlistRepo {
  constructor(private readonly pool: pg.Pool) {}

  async list(): Promise<WatchlistRow[]> {
    const res = await this.pool.query<WatchlistRow>(
      `SELECT symbol, label, enabled, added_at, provider, asset_class, tv_symbol
         FROM watchlist ORDER BY added_at ASC`,
    );
    return res.rows;
  }

  async enabled(): Promise<WatchlistEntry[]> {
    const res = await this.pool.query<WatchlistEntry>(
      'SELECT symbol, provider FROM watchlist WHERE enabled = true ORDER BY added_at ASC',
    );
    return res.rows;
  }

  async enabledSymbols(): Promise<string[]> {
    return (await this.enabled()).map((r) => r.symbol);
  }

  async add(
    symbol: string,
    label: string | null,
    provider = 'binance',
    assetClass = 'cripto',
    tvSymbol: string | null = null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO watchlist (symbol, label, provider, asset_class, tv_symbol)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (symbol) DO UPDATE SET
         enabled = true,
         label = COALESCE(EXCLUDED.label, watchlist.label),
         provider = EXCLUDED.provider,
         asset_class = EXCLUDED.asset_class,
         tv_symbol = COALESCE(EXCLUDED.tv_symbol, watchlist.tv_symbol)`,
      [symbol.toUpperCase(), label, provider, assetClass, tvSymbol],
    );
  }

  async remove(symbol: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM watchlist WHERE symbol = $1', [
      symbol.toUpperCase(),
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  async setEnabled(symbol: string, enabled: boolean): Promise<boolean> {
    const res = await this.pool.query('UPDATE watchlist SET enabled = $2 WHERE symbol = $1', [
      symbol.toUpperCase(),
      enabled,
    ]);
    return (res.rowCount ?? 0) > 0;
  }
}
