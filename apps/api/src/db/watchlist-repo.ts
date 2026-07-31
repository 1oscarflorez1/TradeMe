import type pg from 'pg';

export interface WatchlistRow {
  symbol: string;
  label: string | null;
  enabled: boolean;
  added_at: string;
}

/** Activos que TradeMe sigue. Sustituye a la lista fija de la variable de entorno. */
export class WatchlistRepo {
  constructor(private readonly pool: pg.Pool) {}

  async list(): Promise<WatchlistRow[]> {
    const res = await this.pool.query<WatchlistRow>(
      'SELECT symbol, label, enabled, added_at FROM watchlist ORDER BY added_at ASC',
    );
    return res.rows;
  }

  async enabledSymbols(): Promise<string[]> {
    const res = await this.pool.query<{ symbol: string }>(
      'SELECT symbol FROM watchlist WHERE enabled = true ORDER BY added_at ASC',
    );
    return res.rows.map((r) => r.symbol);
  }

  async add(symbol: string, label: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO watchlist (symbol, label) VALUES ($1, $2)
       ON CONFLICT (symbol) DO UPDATE SET enabled = true, label = COALESCE(EXCLUDED.label, watchlist.label)`,
      [symbol.toUpperCase(), label],
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
