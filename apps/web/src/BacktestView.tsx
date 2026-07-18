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
    <div className="bt-layout">
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
      <BacktestGuide />
    </div>
  );
}

const DEFINITIONS: Array<[string, string]> = [
  [
    'Trades',
    'Número de operaciones que la lógica de decisión habría abierto sobre el histórico. Cuantas más, más fiable la estadística.',
  ],
  [
    'Win rate',
    'Porcentaje de operaciones ganadoras. Por sí solo no dice si el sistema gana dinero: una estrategia puede acertar poco pero ganar mucho cuando acierta.',
  ],
  [
    'Expectancy',
    'La métrica reina: ganancia media por operación medida en R. Una R es lo que arriesgas en cada trade (la distancia entrada→stop). Positiva = el sistema tiene ventaja; 0,058 R significa ganar de media un 5,8 % del riesgo por operación.',
  ],
  [
    'Profit factor',
    'Ganancias brutas ÷ pérdidas brutas. Mayor que 1 = rentable. 1,10 indica que apenas gana un 10 % más de lo que pierde: ventaja pequeña.',
  ],
  [
    'Max drawdown',
    'La peor caída acumulada (en R) desde un punto alto. Mide cuánto “duele” en la peor racha; ayuda a saber si podrías aguantarlo psicológica y financieramente.',
  ],
  [
    'Sharpe',
    'Rentabilidad ajustada a la volatilidad: cuánto ganas por unidad de riesgo asumido. Cuanto mayor, más estable y menos dependiente de la suerte.',
  ],
  [
    'Win rate / Expectancy OOS',
    'Las mismas métricas, pero solo sobre el 30 % final de los datos (out-of-sample), un tramo que no influyó en nada. Es la prueba de honestidad: si se parecen al resto, el sistema no está sobreajustado al pasado.',
  ],
];

function BacktestGuide() {
  return (
    <aside className="panel bt-guide">
      <h3>¿Qué es un backtest?</h3>
      <p>
        Reproduce la lógica de decisión de TradeMe sobre el histórico real, operación por
        operación, para responder una pregunta <strong>antes de arriesgar dinero</strong>: ¿esta
        forma de decidir tiene ventaja estadística o es solo suerte?
      </p>
      <p>
        Se hace <strong>sin look-ahead</strong> (nunca usa información futura que no existiría en
        vivo) y en <strong>peor caso SL</strong> (si en una misma vela se tocan el stop y el
        objetivo, se asume la pérdida). Así los resultados son conservadores y creíbles.
      </p>

      <h4>Qué significa cada término</h4>
      <dl className="bt-defs">
        {DEFINITIONS.map(([term, desc]) => (
          <div key={term} className="bt-def">
            <dt>{term}</dt>
            <dd>{desc}</dd>
          </div>
        ))}
      </dl>

      <h4>Cómo leer estos resultados</h4>
      <p>
        La regla base: <strong>Expectancy &gt; 0</strong> y <strong>Profit factor &gt; 1</strong>{' '}
        indican ventaja; el <strong>Max drawdown</strong> te dice el precio en riesgo por esa
        ventaja; y las métricas <strong>OOS</strong> parecidas a las del resto confirman que no hay
        sobreajuste. La curva de equity ascendente refuerza lo mismo de forma visual.
      </p>
      <p className="bt-note">
        Es una herramienta de validación y apoyo a la decisión, no una promesa de rentabilidad. El
        rendimiento pasado no asegura resultados futuros. La calibración rigurosa (walk-forward con
        purga/embargo) llega en M7.
      </p>
    </aside>
  );
}
