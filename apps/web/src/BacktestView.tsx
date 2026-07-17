import { useEffect, useState } from 'react';
import { fetchBacktest } from './api';
import type { BacktestResult, Interval } from './types';

function pct(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(1)}%`;
}
function num(n: number | null, d = 2): string {
  return n === null ? '—' : n.toFixed(d);
}

function EquityCurve({ equity }: { equity: number[] }) {
  if (equity.length < 2) return <p className="muted">Sin suficientes trades para la curva.</p>;
  const w = 600;
  const h = 160;
  const min = Math.min(0, ...equity);
  const max = Math.max(0, ...equity);
  const range = max - min || 1;
  const pts = equity
    .map((v, i) => {
      const x = (i / (equity.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const zeroY = h - ((0 - min) / range) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="equity" preserveAspectRatio="none">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="#232b38" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke="#4da3ff" strokeWidth="2" />
    </svg>
  );
}

export function BacktestView({ symbol, interval }: { symbol: string; interval: Interval }) {
  const [bt, setBt] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    fetchBacktest(symbol, interval).then((r) => {
      if (!cancelled) {
        setBt(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  if (loading) return <p className="muted">Cargando backtest…</p>;
  if (!bt) {
    return (
      <section className="panel">
        <p className="muted">
          Aún no hay backtest para {symbol} · {interval}. Ejecútalo desde quant:
        </p>
        <pre className="hint">
          python -m trademe_quant.run_backtest {symbol} {interval}
        </pre>
      </section>
    );
  }

  const cards: Array<[string, string]> = [
    ['Trades', String(bt.n_trades ?? 0)],
    ['Win rate', pct(bt.win_rate)],
    ['Expectancy', `${num(bt.expectancy, 3)} R`],
    ['Profit factor', num(bt.profit_factor)],
    ['Max drawdown', `${num(bt.max_drawdown, 2)} R`],
    ['Sharpe', num(bt.sharpe)],
    ['Win rate OOS', pct(bt.oos_win_rate)],
    ['Expectancy OOS', `${num(bt.oos_expectancy, 3)} R`],
  ];

  return (
    <section className="panel">
      <div className="chart-head">
        <strong>Backtest</strong>
        <span className="muted">
          · {bt.symbol} · {bt.interval} · sin look-ahead · peor caso SL
        </span>
      </div>
      <div className="bt-cards">
        {cards.map(([k, v]) => (
          <div key={k} className="bt-card">
            <span className="bt-k">{k}</span>
            <span className="bt-v">{v}</span>
          </div>
        ))}
      </div>
      <div className="chart-head">
        <strong>Curva de equity</strong>
        <span className="muted">· R acumulado</span>
      </div>
      <EquityCurve equity={bt.equity_curve} />
    </section>
  );
}
