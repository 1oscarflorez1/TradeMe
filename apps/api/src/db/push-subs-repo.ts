import type pg from 'pg';
import type { PushSub } from '../push/push.js';

export class PushSubsRepo {
  constructor(private readonly pool: pg.Pool) {}

  async save(sub: PushSub): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_subscriptions (endpoint, sub) VALUES ($1, $2)
       ON CONFLICT (endpoint) DO UPDATE SET sub = EXCLUDED.sub`,
      [sub.endpoint, JSON.stringify(sub)],
    );
  }

  async list(): Promise<PushSub[]> {
    const res = await this.pool.query<{ sub: PushSub }>('SELECT sub FROM push_subscriptions');
    return res.rows.map((r) => r.sub);
  }

  async remove(endpoint: string): Promise<void> {
    await this.pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  }
}
