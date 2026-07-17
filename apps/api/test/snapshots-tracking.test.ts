import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps, synthCandles } from './helpers.js';
import { trackSnapshot, type SnapshotRow } from '../src/snapshots/tracking.js';

function row(part: Partial<SnapshotRow>): SnapshotRow {
  return {
    id: 'x',
    captured_at: '2026-07-07T00:00:00Z',
    symbol: 'BTCUSDT',
    interval: '1m',
    action: 'BUY',
    direction: 'LONG',
    price: 100,
    confidence: 0.7,
    macro_bias: 0,
    plan_entry: 100,
    plan_stop: 97,
    plan_take_profit: 106,
    plan_rr: 2,
    valid_until: null,
    outcome_result: null,
    outcome_return_r: null,
    ...part,
  };
}

describe('trackSnapshot', () => {
  it('LONG en curso calcula R en vivo', () => {
    const t = trackSnapshot(row({}), 103, Date.now());
    expect(t.status).toBe('en_curso');
    expect(t.liveR).toBeCloseTo(1, 6); // (103-100)/(100-97)
  });
  it('LONG toca TP y SL', () => {
    expect(trackSnapshot(row({}), 107, Date.now()).status).toBe('tp');
    expect(trackSnapshot(row({}), 96, Date.now()).status).toBe('sl');
  });
  it('SHORT invierte la lógica', () => {
    const short = row({ direction: 'SHORT', plan_stop: 103, plan_take_profit: 94 });
    expect(trackSnapshot(short, 93, Date.now()).status).toBe('tp');
    expect(trackSnapshot(short, 104, Date.now()).status).toBe('sl');
  });
  it('marca expirado y sin_plan', () => {
    expect(
      trackSnapshot(row({ valid_until: '2000-01-01T00:00:00Z' }), 101, Date.now()).expired,
    ).toBe(true);
    expect(
      trackSnapshot(row({ direction: 'FLAT', plan_entry: null }), 101, Date.now()).status,
    ).toBe('sin_plan');
  });
});

describe('GET /snapshots', () => {
  it('lista con seguimiento en vivo', async () => {
    const app = buildApp(
      makeDeps({
        getHistory: async () => synthCandles(1).map((c) => ({ ...c, close: 103 })),
        listSnapshots: async () => [row({})],
      }),
    );
    const res = await app.inject({ method: 'GET', url: '/snapshots?symbol=BTCUSDT' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { snapshots: Array<{ tracking: { status: string } | null }> };
    expect(body.snapshots[0]?.tracking?.status).toBe('en_curso');
    await app.close();
  });
});
