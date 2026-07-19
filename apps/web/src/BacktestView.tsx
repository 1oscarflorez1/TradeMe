import { useEffect, useState } from 'react';
import { fetchBacktest, fetchCalibration } from './api';
import type {
  BacktestResult,
  CalibrationMeta,
  Interval,
  RegimeCalibrator,
  ReliabilityBin,
} from './types';

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
      <div className="bt-layout">
        <div className="bt-main">
          <section className="panel">
            <p className="muted">
              Aún no hay backtest para {symbol} · {interval}. Ejecútalo desde quant:
            </p>
            <pre className="hint">
              python -m trademe_quant.run_backtest {symbol} {interval}
            </pre>
          </section>
          <CalibrationSection />
        </div>
        <BacktestGuide />
      </div>
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
      <div className="bt-main">
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
      <CalibrationSection />
      </div>
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
      <details className="bt-acc" open>
        <summary>¿Qué es un backtest?</summary>
        <div className="bt-acc-body">
          <p>
            Reproduce la lógica de decisión de TradeMe sobre el histórico real, operación por
            operación, para responder una pregunta <strong>antes de arriesgar dinero</strong>:
            ¿esta forma de decidir tiene ventaja estadística o es solo suerte?
          </p>
          <p>
            Se hace <strong>sin look-ahead</strong> (nunca usa información futura que no existiría
            en vivo) y en <strong>peor caso SL</strong> (si en una misma vela se tocan el stop y el
            objetivo, se asume la pérdida). Así los resultados son conservadores y creíbles.
          </p>
        </div>
      </details>

      <div className="bt-acc-group">
        <h4>Términos · pulsa para desplegar</h4>
        {DEFINITIONS.map(([term, desc]) => (
          <details key={term} className="bt-acc">
            <summary>{term}</summary>
            <div className="bt-acc-body">
              <p>{desc}</p>
            </div>
          </details>
        ))}
      </div>

      <details className="bt-acc">
        <summary>Cómo leer estos resultados</summary>
        <div className="bt-acc-body">
          <p>
            La regla base: <strong>Expectancy &gt; 0</strong> y{' '}
            <strong>Profit factor &gt; 1</strong> indican ventaja; el <strong>Max drawdown</strong>{' '}
            te dice el precio en riesgo por esa ventaja; y las métricas <strong>OOS</strong>{' '}
            parecidas a las del resto confirman que no hay sobreajuste.
          </p>
          <p className="bt-note">
            Herramienta de validación y apoyo a la decisión, no una promesa de rentabilidad. El
            rendimiento pasado no asegura resultados futuros.
          </p>
        </div>
      </details>
    </aside>
  );
}

function ReliabilityDiagram({ bins }: { bins: ReliabilityBin[] }) {
  const s = 150;
  const pad = 6;
  const X = (p: number) => pad + p * (s - 2 * pad);
  const Y = (p: number) => s - pad - p * (s - 2 * pad);
  return (
    <svg viewBox={`0 0 ${s} ${s}`} className="calib-plot">
      <rect x={pad} y={pad} width={s - 2 * pad} height={s - 2 * pad} fill="none" stroke="#232b38" />
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="#3a4658" strokeDasharray="3 3" />
      <polyline
        points={bins.map((b) => `${X(b.p_pred)},${Y(b.p_true)}`).join(' ')}
        fill="none"
        stroke="#4da3ff"
        strokeWidth="1.5"
      />
      {bins.map((b, i) => (
        <circle
          key={i}
          cx={X(b.p_pred)}
          cy={Y(b.p_true)}
          r={Math.max(1.5, Math.min(5, Math.sqrt(b.n)))}
          fill="#4da3ff"
        />
      ))}
    </svg>
  );
}

function CalibrationSection() {
  const [cal, setCal] = useState<CalibrationMeta | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCalibration().then((r) => {
      if (!cancelled) {
        setCal(r);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
  const regimes: Array<[string, RegimeCalibrator]> = cal ? Object.entries(cal.regimes) : [];
  const trained = regimes.some(([, c]) => c.method !== 'identity');

  return (
    <section className="panel calib-panel">
      <div className="chart-head">
        <strong>Calibración de probabilidades</strong>
        <span className="muted">
          · diagrama de fiabilidad{cal?.version ? ` · ${cal.version}` : ''}
        </span>
      </div>
      {!trained ? (
        <p className="muted">
          Aún sin calibrador entrenado. Genera uno desde quant:{' '}
          <code>python -m trademe_quant.run_calibration BTCUSDT 5m</code>, y recarga la API con{' '}
          <code>POST /reload</code>.
        </p>
      ) : (
        <div className="calib-grid">
          {regimes.map(([name, c]) => (
            <div key={name} className="calib-card">
              <div className="calib-title">
                <strong>{name}</strong>
                <span className="muted">
                  {c.method} · n={c.n ?? 0} · Brier {c.brier != null ? c.brier.toFixed(3) : '—'}
                </span>
              </div>
              {c.reliability && c.reliability.length > 0 ? (
                <ReliabilityDiagram bins={c.reliability} />
              ) : (
                <p className="muted">sin datos suficientes</p>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="muted calib-legend">
        La diagonal punteada es la calibración perfecta (probabilidad prevista = frecuencia real de
        acierto). Cuanto más pegados los puntos a ella, más honestas las probabilidades; un Brier más
        bajo es mejor.
      </p>
    </section>
  );
}
