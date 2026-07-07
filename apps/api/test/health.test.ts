import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';

describe('GET /health', () => {
  it('responde 200 con status ok y trading real desactivado', async () => {
    const app = buildApp(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; service: string; liveTrading: boolean };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('trademe-api');
    expect(body.liveTrading).toBe(false);
    await app.close();
  });
});
