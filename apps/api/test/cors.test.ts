import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';

describe('CORS', () => {
  it('responde con Access-Control-Allow-Origin al enviar Origin', async () => {
    const app = buildApp(makeDeps());
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    await app.close();
  });

  it('maneja el preflight OPTIONS', async () => {
    const app = buildApp(makeDeps());
    await app.ready();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/candles',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });
    expect([200, 204]).toContain(res.statusCode);
    await app.close();
  });
});
