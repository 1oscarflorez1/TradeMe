import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';
import type { AlertRow } from '../src/db/alerts-repo.js';

const sample: AlertRow = {
  id: 'a1',
  created_at: '2026-07-07T00:00:00Z',
  symbol: 'BTCUSDT',
  interval: '5m',
  type: 'decision',
  severity: 'info',
  title: 'Decisión COMPRAR',
  message: 'Confianza 62% ≥ 50%',
  meta: null,
  read: false,
};

describe('alerts routes', () => {
  it('crea una alerta', async () => {
    const app = buildApp(makeDeps({ createAlert: async () => sample }));
    const res = await app.inject({
      method: 'POST',
      url: '/alerts',
      payload: { type: 'decision', title: 'Decisión COMPRAR', severity: 'info' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { created: boolean }).created).toBe(true);
    await app.close();
  });

  it('rechaza alerta sin título', async () => {
    const app = buildApp(makeDeps({ createAlert: async () => sample }));
    const res = await app.inject({ method: 'POST', url: '/alerts', payload: { type: 'decision' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('lista con contador de no leídas', async () => {
    const app = buildApp(makeDeps({ listAlerts: async () => ({ alerts: [sample], unread: 1 }) }));
    const res = await app.inject({ method: 'GET', url: '/alerts?limit=10' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { unread: number }).unread).toBe(1);
    await app.close();
  });

  it('marca todas como leídas', async () => {
    const app = buildApp(makeDeps({ markAlertsRead: async () => 3 }));
    const res = await app.inject({ method: 'POST', url: '/alerts/read' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { marked: number }).marked).toBe(3);
    await app.close();
  });
});
