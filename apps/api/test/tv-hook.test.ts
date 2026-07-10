import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps, synthCandles } from './helpers.js';

describe('POST /tv-hook', () => {
  it('acepta una señal mock y la mapea a un voto', async () => {
    const app = buildApp(makeDeps());
    const res = await app.inject({
      method: 'POST',
      url: '/tv-hook',
      payload: { strategy: 'reditum_sniper', symbol: 'btcusdt', signal: 'long' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accepted: boolean; vote: { score: number; source: string } };
    expect(body.accepted).toBe(true);
    expect(body.vote.score).toBe(1);
    expect(body.vote.source).toBe('tradingview');
    await app.close();
  });

  it('rechaza si el secret no coincide', async () => {
    const app = buildApp(makeDeps({ tvSecret: 's3cr3t' }));
    const res = await app.inject({
      method: 'POST',
      url: '/tv-hook',
      payload: { secret: 'malo', strategy: 'reditum_sniper', symbol: 'BTCUSDT', signal: 'long' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /votes combina internos + señal externa activa', async () => {
    const app = buildApp(makeDeps({ getHistory: async () => synthCandles(80) }));
    await app.inject({
      method: 'POST',
      url: '/tv-hook',
      payload: { secret: 'malo', strategy: 'reditum_sniper', symbol: 'BTCUSDT', signal: 'long' },
    });
    const res = await app.inject({ method: 'GET', url: '/votes?symbol=BTCUSDT&interval=1m' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { votes: Array<{ key: string; source: string }> };
    expect(body.votes.some((v) => v.source === 'internal')).toBe(true);
    expect(body.votes.some((v) => v.key === 'reditum_sniper')).toBe(true);
    await app.close();
  });
});
