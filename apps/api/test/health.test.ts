import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  it('responde 200 con status ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { status: string; service: string; liveTrading: boolean };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('trademe-api');
    // El trading real debe venir desactivado por defecto.
    expect(body.liveTrading).toBe(false);

    await app.close();
  });
});
