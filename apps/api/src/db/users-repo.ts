import type pg from 'pg';

export interface UserRow {
  id: string;
  created_at: string;
  email: string;
  password_hash: string;
}

export class UsersRepo {
  constructor(private readonly pool: pg.Pool) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const res = await this.pool.query<UserRow>(
      'SELECT id, created_at, email, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()],
    );
    return res.rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const res = await this.pool.query<UserRow>(
      'SELECT id, created_at, email, password_hash FROM users WHERE id = $1',
      [id],
    );
    return res.rows[0] ?? null;
  }

  async create(email: string, passwordHash: string): Promise<UserRow> {
    const res = await this.pool.query<UserRow>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, created_at, email, password_hash`,
      [email.toLowerCase(), passwordHash],
    );
    return res.rows[0]!;
  }
}
