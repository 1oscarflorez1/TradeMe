import type pg from 'pg';

export interface AlertRow {
  id: string;
  created_at: string;
  symbol: string | null;
  interval: string | null;
  type: string;
  severity: string;
  title: string;
  message: string | null;
  meta: unknown;
  read: boolean;
}

export interface AlertInput {
  symbol?: string | null;
  interval?: string | null;
  type: string;
  severity?: string;
  title: string;
  message?: string | null;
  meta?: unknown;
}

export class AlertsRepo {
  constructor(private readonly pool: pg.Pool) {}

  async create(a: AlertInput): Promise<AlertRow> {
    const res = await this.pool.query<AlertRow>(
      `INSERT INTO alerts (symbol, interval, type, severity, title, message, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at, symbol, interval, type, severity, title, message, meta, read`,
      [
        a.symbol ?? null,
        a.interval ?? null,
        a.type,
        a.severity ?? 'info',
        a.title,
        a.message ?? null,
        a.meta ?? null,
      ],
    );
    return res.rows[0]!;
  }

  async list(limit: number): Promise<{ alerts: AlertRow[]; unread: number }> {
    const rows = await this.pool.query<AlertRow>(
      `SELECT id, created_at, symbol, interval, type, severity, title, message, meta, read
       FROM alerts ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    const unread = await this.pool.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM alerts WHERE read = false',
    );
    return { alerts: rows.rows, unread: Number(unread.rows[0]?.n ?? 0) };
  }

  async markAllRead(): Promise<number> {
    const res = await this.pool.query('UPDATE alerts SET read = true WHERE read = false');
    return res.rowCount ?? 0;
  }
}
