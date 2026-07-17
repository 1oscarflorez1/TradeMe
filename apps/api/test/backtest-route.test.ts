import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';
import type { BacktestRow } from '../src/db/backtests-repo.js';

const sample: BacktestRow = {
  id: 'b1',
  created_at: '2026-07-07T00:00:00Z',
  symbol: 'BTCUSDT',
  interval: '5m',
  n_trades: 12,
  win_rate: 0.5,
  expectancy: 0.25,
  profit_factor: 1.8,
  max_drawdown: 3.2,
  sharpe: 0.9,
  oos_win_rate: 0.48,
  oos_expectancy: 0.2,
  metrics: {},
  trades: [],
  equity_curve: [0, 2, 1, 3],
};

describe('GET /backtest', () => {
  it('devuelve el último backtest', async () => {
    const app = buildApp(makeDeps({ getBacktest: async () => sample }));
    const res = await app.inject({ method: 'GET', url: '/backtest?symbol=BTCUSDT&interval=5m' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BacktestRow;
    expect(body.n_trades).toBe(12);
    expect(body.win_rate).toBe(0.5);
    await app.close();
  });

  it('404 si no hay backtest', async () => {
    const app = buildApp(makeDeps({ getBacktest: async () => null }));
    const res = await app.inject({ method: 'GET', url: '/backtest' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
