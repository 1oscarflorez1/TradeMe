import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps, synthCandles } from './helpers.js';

describe('POST /snapshots', () => {
  it('recalcula la señal (autoritativo) y la registra', async () => {
    let captured: { interval: string; note?: string; action: string } | null = null;
    const app = buildApp(
      makeDeps({
        getHistory: async () => synthCandles(80),
        recordSnapshot: async (signal, interval, _levels, note) => {
          captured = { interval, note, action: signal.action };
          return 'snap-1';
        },
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/snapshots',
      payload: { symbol: 'btcusdt', interval: '1m', note: 'prueba' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { saved: boolean; id: string };
    expect(body.saved).toBe(true);
    expect(body.id).toBe('snap-1');
    expect(captured).not.toBeNull();
    expect(captured!.interval).toBe('1m');
    expect(captured!.note).toBe('prueba');
    await app.close();
  });

  it('503 si no hay persistencia configurada', async () => {
    const app = buildApp(makeDeps({ getHistory: async () => synthCandles(80) }));
    const res = await app.inject({
      method: 'POST',
      url: '/snapshots',
      payload: { symbol: 'BTCUSDT', interval: '1m' },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
