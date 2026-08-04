import { useEffect, useState } from 'react';
import { fetchBacktest, fetchBacktestHistory, postReload, runBacktest, runOptimize } from './api';
import type { BacktestHistoryRow } from './api';
import { Sparkline } from './Viz';
import type { BacktestResult, Interval } from './types';

function pct(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(1)}%`;
}
function num(n: number | null, d = 2): string {
  return n === null ? '—' : n.toFixed(d);
}

function EquityReport({ bt }: { bt: BacktestResult }) {
  const eq = bt.equity_curve;
  if (eq.length < 2) return null;
  const finalR = eq[eq.length - 1]!;
  const n = bt.n_trades ?? eq.length;
  const wr = bt.win_rate != null ? `${(bt.win_rate * 100).toFixed(0)}%` : '—';
  const exp = bt.expectancy != null ? `${bt.expectancy.toFixed(3)} R` : '—';
  const dd = bt.max_drawdown != null ? `${bt.max_drawdown.toFixed(1)} R` : '—';
  const rumbo =
    finalR > 0.5 ? 'termina en positivo' : finalR < -0.5 ? 'termina en negativo' : 'termina plano';
  let oos = '';
  if (bt.oos_expectancy != null && bt.expectancy != null) {
    const diff = bt.oos_expectancy - bt.expectancy;
    oos =
      Math.abs(diff) < 0.03
        ? ' La expectancy out-of-sample es parecida a la del conjunto: señal de robustez (poco sobreajuste).'
        : diff < 0
          ? ' La expectancy cae en out-of-sample: posible sobreajuste, conviene cautela.'
          : ' La expectancy mejora en out-of-sample: buen comportamiento fuera de muestra.';
  }
  const veredicto =
    (bt.expectancy ?? 0) > 0 && (bt.profit_factor ?? 0) > 1
      ? 'muestra una ligera ventaja estadística'
      : 'no muestra ventaja clara todavía';

  return (
    <p className="eq-report">
      En <strong>{n}</strong> operaciones la equity <strong>{rumbo}</strong> (
      {finalR >= 0 ? '+' : ''}
      {finalR.toFixed(1)} R acumulados), con win rate {wr}, expectancy {exp} y una peor caída de {dd}.
      El sistema {veredicto}.{oos}
    </p>
  );
}

function EquityCurve({ equity }: { equity: number[] }) {
  if (equity.length < 2) return <p className="muted">Sin suficientes trades para la curva.</p>;
  const h = 190;
  const padT = 26;
  const padB = 22;
  const wpx = Math.max(640, (equity.length - 1) * 14);
  const min = Math.min(0, ...equity);
  const max = Math.max(0, ...equity);
  const range = max - min || 1;
  const X = (i: number) => 24 + (i / (equity.length - 1)) * (wpx - 48);
  const Y = (v: number) => padT + (1 - (v - min) / range) * (h - padT - padB);

  let peakIdx = 0;
  equity.forEach((v, i) => {
    if (v > equity[peakIdx]!) peakIdx = i;
  });
  let run = -Infinity;
  let curPeak = 0;
  let worst = 0;
  let troughIdx = 0;
  let ddPeakIdx = 0;
  equity.forEach((v, i) => {
    if (v > run) {
      run = v;
      curPeak = i;
    }
    const dd = run - v;
    if (dd > worst) {
      worst = dd;
      troughIdx = i;
      ddPeakIdx = curPeak;
    }
  });

  const pts = equity.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const zeroY = Y(0);
  const last = equity.length - 1;
  const finalV = equity[last]!;
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}R`;

  return (
    <div className="equity-scroll">
      <svg width={wpx} height={h} viewBox={`0 0 ${wpx} ${h}`} className="equity">
        <line x1={24} y1={zeroY} x2={wpx - 24} y2={zeroY} stroke="#2c3644" strokeDasharray="3 3" />
        <text x={26} y={zeroY - 3} className="eq-annot">
          0 R
        </text>
        {worst > 0 && (
          <rect
            x={X(ddPeakIdx)}
            y={padT}
            width={Math.max(0, X(troughIdx) - X(ddPeakIdx))}
            height={h - padT - padB}
            fill="rgba(224,100,95,0.10)"
          />
        )}
        <polyline points={pts} fill="none" stroke="#4da3ff" strokeWidth="2" />
        <circle cx={X(peakIdx)} cy={Y(equity[peakIdx]!)} r={3.2} fill="#2ecc71" />
        <text x={X(peakIdx)} y={Y(equity[peakIdx]!) - 7} className="eq-annot eq-up" textAnchor="middle">
          Pico {fmt(equity[peakIdx]!)}
        </text>
        {worst > 0 && (
          <>
            <circle cx={X(troughIdx)} cy={Y(equity[troughIdx]!)} r={3.2} fill="#e0645f" />
            <text
              x={X(troughIdx)}
              y={Y(equity[troughIdx]!) + 14}
              className="eq-annot eq-down"
              textAnchor="middle"
            >
              Máx. drawdown −{worst.toFixed(1)}R
            </text>
          </>
        )}
        <circle cx={X(last)} cy={Y(finalV)} r={3.2} fill="#4da3ff" />
        <text x={X(last)} y={Y(finalV) - 7} className="eq-annot" textAnchor="end">
          Final {fmt(finalV)}
        </text>
        <text x={24} y={h - 6} className="eq-annot">
          Operación 1
        </text>
        <text x={wpx - 24} y={h - 6} className="eq-annot" textAnchor="end">
          Operación {equity.length}
        </text>
      </svg>
    </div>
  );
}

export function BacktestView({ symbol, interval }: { symbol: string; interval: Interval }) {
  const [bt, setBt] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'backtest' | 'optimize' | null>(null);

  const load = (): Promise<void> =>
    fetchBacktest(symbol, interval).then((r) => {
      setBt(r);
      setLoading(false);
    });

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    void load();
  }, [symbol, interval]);

  const runBt = async (): Promise<void> => {
    setRunning('backtest');
    setRunMsg(null);
    const r = await runBacktest(symbol, interval);
    setRunning(null);
    if (r.ok) {
      setRunMsg('✓ Backtest actualizado.');
      await load();
    } else {
      setRunMsg('No se pudo correr el backtest. ¿Está arriba el servicio quant? (docker compose up -d --build)');
    }
  };
  const runOpt = async (): Promise<void> => {
    setRunning('optimize');
    setRunMsg('Optimizando con Optuna (puede tardar ~1 min)…');
    const r = await runOptimize(symbol, interval);
    if (r.ok) {
      await postReload();
      await runBacktest(symbol, interval);
      setRunMsg(
        r.promoted
          ? '✓ Promovido: el candidato ganó en hold-out. Nueva config activa para esta temporalidad; backtest actualizado.'
          : 'ℹ No promovido: ningún candidato superó a la config actual en hold-out (protección anti-sobreajuste). Se mantiene la base; backtest actualizado.',
      );
      await load();
    } else {
      setRunning(null);
      setRunMsg('No se pudo optimizar. ¿Está arriba el servicio quant?');
      return;
    }
    setRunning(null);
  };

  const actions = (
    <div className="bt-actions">
      <button
        type="button"
        className="bt-run"
        disabled={running !== null}
        onClick={() => setConfirm('backtest')}
      >
        {running === 'backtest' ? 'Corriendo…' : '▶ Correr backtest'}
      </button>
      <button
        type="button"
        className="bt-run bt-opt"
        disabled={running !== null}
        onClick={() => setConfirm('optimize')}
        title="Optimizar = búsqueda automática (Optuna) de los mejores parámetros de la estrategia (pesos, régimen, hold_band, temperature, ADX) maximizando la expectancy en validación. Aplica el resultado SOLO si supera al actual en el tramo hold-out. Tarda ~1 min."
      >
        {running === 'optimize' ? 'Optimizando…' : '⚙ Optimizar'}
      </button>
      <span className="bt-actions-hint">
        ▶ mide la estrategia actual (y evalúa tus registros) · ⚙ además busca parámetros mejores
      </span>
      {confirm && (
        <div className="modal-overlay" onClick={() => setConfirm(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {confirm === 'backtest' ? (
              <>
                <p className="modal-title">▶ Correr backtest ahora</p>
                <p className="muted">
                  El 🤖 piloto ya mide esta temporalidad automáticamente cada pocas horas. Correrlo a
                  mano no daña nada (solo mide y evalúa registros), pero los Δ pasarán a comparar
                  contra esta corrida manual.
                </p>
              </>
            ) : (
              <>
                <p className="modal-title">⚙ Optimizar ahora</p>
                <p className="muted">
                  El 🤖 piloto ya optimiza esta temporalidad cuando toca (mantenimiento o
                  degradación). Hacerlo a mano <strong>reinicia su reloj</strong> (cooldown y
                  mantenimiento se cuentan desde ahora), y optimizar con mucha frecuencia tiende a
                  perseguir el ruido del mercado (sobreajuste). Úsalo solo si buscas algo concreto.
                </p>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="bt-run"
                onClick={() => {
                  const which = confirm;
                  setConfirm(null);
                  if (which === 'backtest') void runBt();
                  else void runOpt();
                }}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (loading) return <p className="muted">Cargando backtest…</p>;
  if (!bt) {
    return (
      <div className="bt-layout">
        <div className="bt-main">
          <section className="panel">
            <div className="chart-head">
              <strong>Backtest</strong>
              <span className="muted">
                · {symbol} · {interval} · sin resultados aún
              </span>
              {actions}
            </div>
            {runMsg && <p className="bt-runmsg">{runMsg}</p>}
            <p className="muted">
              Aún no hay backtest para {symbol} · {interval}. Pulsa <strong>▶ Correr backtest</strong>
              para generarlo sobre esta temporalidad (sin necesidad de terminal).
            </p>
          </section>
        </div>
      </div>
    );
  }

  const P = bt.previous ?? null;
  const dlt = (
    cur: number | null,
    prev: number | null | undefined,
    dir: 'up' | 'down' | 'neutral',
    kind: 'r' | 'pct' | 'num' | 'dec',
  ): { text: string; cls: string } | null => {
    if (!P || cur === null || prev === null || prev === undefined) return null;
    const diff = cur - prev;
    const sign = diff > 0 ? '+' : '';
    const text =
      kind === 'pct'
        ? `${sign}${(diff * 100).toFixed(1)}pp`
        : kind === 'num'
          ? `${sign}${diff.toFixed(0)}`
          : kind === 'dec'
            ? `${sign}${diff.toFixed(2)}`
            : `${sign}${diff.toFixed(3)}R`;
    let cls = 'delta-flat';
    if (Math.abs(diff) > 1e-9 && dir !== 'neutral') {
      const better = dir === 'up' ? diff > 0 : diff < 0;
      cls = better ? 'delta-up' : 'delta-down';
    }
    return { text, cls };
  };
  const edge = (bt.expectancy ?? 0) > 0 && (bt.profit_factor ?? 0) > 1;
  const cards: Array<{
    k: string;
    v: string;
    tip: string;
    delta: { text: string; cls: string } | null;
    hero?: boolean;
    good?: boolean;
  }> = [
    { k: 'Trades', v: String(bt.n_trades ?? 0), tip: 'Operaciones simuladas sobre el histórico. Cuantas más, más fiable la estadística.', delta: dlt(bt.n_trades, P?.n_trades, 'neutral', 'num') },
    { k: 'Win rate', v: pct(bt.win_rate), tip: 'Porcentaje de operaciones ganadoras. Por sí solo no dice si el sistema gana dinero.', delta: dlt(bt.win_rate, P?.win_rate, 'up', 'pct') },
    { k: 'Expectancy', v: `${num(bt.expectancy, 3)} R`, tip: 'LA MÉTRICA CLAVE: ganancia media por operación en R. Positiva = el sistema tiene ventaja; negativa = pierde dinero de media.', delta: dlt(bt.expectancy, P?.expectancy, 'up', 'r'), hero: true, good: (bt.expectancy ?? 0) > 0 },
    { k: 'Profit factor', v: num(bt.profit_factor), tip: 'Ganancias brutas ÷ pérdidas brutas. >1 rentable; cerca de 1 = ventaja pequeña.', delta: dlt(bt.profit_factor, P?.profit_factor, 'up', 'dec') },
    { k: 'Max drawdown', v: `${num(bt.max_drawdown, 2)} R`, tip: 'Peor caída acumulada (en R) desde un pico. Menos es mejor.', delta: dlt(bt.max_drawdown, P?.max_drawdown, 'down', 'r') },
    { k: 'Sharpe', v: num(bt.sharpe), tip: 'Rentabilidad ajustada a la volatilidad. Mayor = más estable.', delta: dlt(bt.sharpe, P?.sharpe, 'up', 'dec') },
    { k: 'Win rate OOS', v: pct(bt.oos_win_rate), tip: 'Win rate en el 30% final (out-of-sample). Si se parece al resto, no hay sobreajuste.', delta: dlt(bt.oos_win_rate, P?.oos_win_rate, 'up', 'pct') },
    { k: 'Expectancy OOS', v: `${num(bt.oos_expectancy, 3)} R`, tip: 'Expectancy out-of-sample. Prueba de honestidad frente al sobreajuste.', delta: dlt(bt.oos_expectancy, P?.oos_expectancy, 'up', 'r') },
  ];

  return (
    <div className="bt-layout">
      <div className="bt-main">
      <section className="panel">
        <div className="chart-head">
          <strong title="Simulación de la lógica de decisión sobre el histórico, sin usar datos futuros (sin look-ahead) y asumiendo la pérdida si en una vela se tocan stop y objetivo (peor caso SL).">Backtest</strong>
          <span className="muted">
            · {bt.symbol} · {bt.interval} · sin look-ahead · peor caso SL
          </span>
          <span
            className={`opt-badge ${edge ? 'opt-ok' : 'opt-no'}`}
            title={
              edge
                ? 'Expectancy positiva y profit factor > 1: el sistema muestra ventaja estadística en este histórico.'
                : 'Sin ventaja clara en este histórico: expectancy ≤ 0 o profit factor ≤ 1.'
            }
          >
            {edge ? '✓ Con ventaja' : '⚠ Sin ventaja clara'}
          </span>
          {actions}
        </div>
        {runMsg && <p className="bt-runmsg">{runMsg}</p>}
        <div className="bt-cards">
          {cards.map((c) => (
            <div
              key={c.k}
              className={`bt-card${c.hero ? ' bt-card-hero' : ''}${c.hero ? (c.good ? ' hero-good' : ' hero-bad') : ''}`}
              title={c.tip}
            >
              {c.delta && <span className={`bt-delta ${c.delta.cls}`}>{c.delta.text}</span>}
              <span className="bt-k">{c.k}</span>
              <span className="bt-v">{c.v}</span>
            </div>
          ))}
        </div>
        <p className="bt-note bt-trades-note">
          Las <strong>{bt.n_trades ?? 0} operaciones</strong> no son un número fijo: es cuántas veces
          la lógica señaló <strong>COMPRAR o VENDER</strong> (no MANTENER) sobre las ~1000 velas del
          histórico de {bt.interval}, <strong>sin solapar</strong> operaciones (tras abrir una, se
          salta hasta que cierra). Por eso cambia con la temporalidad —más en 1m, menos en 4h— y con
          el tramo de mercado analizado.
        </p>
        <div className="chart-head">
          <strong title="Suma acumulada del resultado de cada operación en R. Si sube de forma sostenida, el sistema aporta ventaja.">Curva de equity</strong>
          <span className="muted">· R acumulado · desliza para recorrerla · pico, máx. drawdown y final marcados</span>
        </div>
        <EquityCurve equity={bt.equity_curve} />
        <EquityReport bt={bt} />
      </section>

      <BacktestHistory symbol={symbol} interval={interval} />
      </div>
    </div>
  );
}

/**
 * Evolución entre ejecuciones. Un backtest suelto no dice si el sistema mejora; la serie sí.
 */
function BacktestHistory({ symbol, interval }: { symbol: string; interval: string }) {
  const [runs, setRuns] = useState<BacktestHistoryRow[]>([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    void fetchBacktestHistory(symbol, interval).then(setRuns);
  }, [symbol, interval]);

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (runs.length < 2) {
    return (
      <section className="panel">
        <div className="chart-head">
          <strong>Evolución entre ejecuciones</strong>
          <span className="muted">
            · {symbol} · {interval}
          </span>
        </div>
        <p className="muted">
          Con una sola ejecución no hay evolución que mostrar. Corre el backtest otra vez dentro de
          unos días —o deja que lo haga el piloto automático— y aquí verás si la ventaja se mantiene,
          crece o se está perdiendo.
        </p>
      </section>
    );
  }

  const exps = runs.map((r) => r.expectancy ?? 0);
  const ultima = runs[runs.length - 1]!;
  const previa = runs[runs.length - 2]!;
  const delta = (ultima.expectancy ?? 0) - (previa.expectancy ?? 0);
  const conVentaja = runs.filter((r) => (r.expectancy ?? 0) > 0).length;

  return (
    <section className="panel">
      <div className="chart-head">
        <strong>Evolución entre ejecuciones</strong>
        <span className="muted">
          · {runs.length} corridas guardadas · {conVentaja} con ventaja positiva
        </span>
      </div>

      <div className="bt-evo">
        <div className="bt-evo-chart">
          <span className="det-label">Expectancy por corrida (R por operación)</span>
          <Sparkline values={exps} height={64} />
          <div className="bt-evo-axis muted">
            <span>{fecha(runs[0]!.created_at)}</span>
            <span>{fecha(ultima.created_at)}</span>
          </div>
        </div>
        <div className="bt-evo-now">
          <span className="det-label">Respecto a la corrida anterior</span>
          <strong className={delta >= 0 ? 'wh-long' : 'wh-short'}>
            {delta >= 0 ? '▲ +' : '▼ '}
            {delta.toFixed(3)} R
          </strong>
          <p className="muted">
            {delta >= 0
              ? 'La última ejecución mantiene o mejora la ventaja.'
              : 'La última ejecución empeora. Si se repite, el piloto lanzará una optimización.'}
          </p>
        </div>
      </div>

      <button type="button" className="bt-evo-toggle" onClick={() => setAbierto((v) => !v)}>
        {abierto ? '▴ Ocultar el detalle de cada corrida' : '▾ Ver el detalle de cada corrida'}
      </button>

      {abierto && (
        <div className="snap-scroll">
          <table className="snap-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th title="Operaciones simuladas en esa corrida">Trades</th>
                <th title="Porcentaje de operaciones ganadoras">Acierto</th>
                <th title="Ganancia media por operación, en múltiplos del riesgo">Expectancy</th>
                <th title="Ganancias brutas divididas entre pérdidas brutas. Por encima de 1 es rentable">
                  P. factor
                </th>
                <th title="Peor caída acumulada desde un máximo">Drawdown</th>
                <th title="Expectancy sobre el tramo que el ajuste no vio. Es el número honesto">
                  Fuera de muestra
                </th>
              </tr>
            </thead>
            <tbody>
              {[...runs].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{fecha(r.created_at)}</td>
                  <td>{r.n_trades ?? '—'}</td>
                  <td>{r.win_rate === null ? '—' : `${(r.win_rate * 100).toFixed(1)}%`}</td>
                  <td className={(r.expectancy ?? 0) >= 0 ? 'wh-long' : 'wh-short'}>
                    {r.expectancy === null ? '—' : r.expectancy.toFixed(3)}
                  </td>
                  <td>{r.profit_factor === null ? '—' : r.profit_factor.toFixed(2)}</td>
                  <td>{r.max_drawdown === null ? '—' : r.max_drawdown.toFixed(2)}</td>
                  <td className={(r.oos_expectancy ?? 0) >= 0 ? 'wh-long' : 'wh-short'}>
                    {r.oos_expectancy === null ? '—' : r.oos_expectancy.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted calib-legend">
        <strong>Cómo leerlo:</strong> lo que importa no es una cifra suelta sino la tendencia. Una
        expectancy que baja corrida tras corrida indica que el mercado cambió y el ajuste se quedó
        viejo — es justo lo que el piloto automático vigila para decidir cuándo reoptimizar. La
        columna <strong>fuera de muestra</strong> es la más honesta: mide sobre datos que el ajuste
        nunca vio.
      </p>
    </section>
  );
}
