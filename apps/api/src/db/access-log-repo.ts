import type pg from 'pg';

export type AccessEvent = 'login_ok' | 'login_fail' | 'login_blocked';

/** Auditoría de accesos: quién entra y quién lo intenta sin conseguirlo (M10). */
export class AccessLogRepo {
  constructor(private readonly pool: pg.Pool) {}

  async record(event: AccessEvent, email: string | null, ip: string, detail?: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO access_log (event, email, ip, detail) VALUES ($1, $2, $3, $4)',
      [event, email, ip, detail ?? null],
    );
  }

  async recent(limit = 50): Promise<
    Array<{ at: string; event: string; email: string | null; ip: string; detail: string | null }>
  > {
    const res = await this.pool.query<{
      at: string;
      event: string;
      email: string | null;
      ip: string;
      detail: string | null;
    }>('SELECT at, event, email, ip, detail FROM access_log ORDER BY at DESC LIMIT $1', [limit]);
    return res.rows;
  }
}
