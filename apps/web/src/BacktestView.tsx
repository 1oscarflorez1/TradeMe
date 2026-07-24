import { useEffect, useState } from 'react';
import {
  fetchBacktest,
  fetchCalibration,
  fetchEnsemble,
  postReload,
  runBacktest,
  runOptimize,
} from './api';
import type {
  BacktestResult,
  CalibrationMeta,
  EnsembleMeta,
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
      setRunMsg('✓ Optimización aplicada y backtest actualizado.');
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
        onClick={() => void runBt()}
      >
        {running === 'backtest' ? 'Corriendo…' : '▶ Correr backtest'}
      </button>
      <button
        type="button"
        className="bt-run bt-opt"
        disabled={running !== null}
        onClick={() => void runOpt()}
        title="Optimizar = búsqueda automática (Optuna) de los mejores parámetros de la estrategia (pesos, régimen, hold_band, temperature, ADX) maximizando la expectancy en validación. Aplica el resultado SOLO si supera al actual en el tramo hold-out. Tarda ~1 min."
      >
        {running === 'optimize' ? 'Optimizando…' : '⚙ Optimizar'}
      </button>
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
          <CalibrationSection />
          <OptimizationSection />
        </div>
        <BacktestGuide />
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
  const cards: Array<{ k: string; v: string; tip: string; delta: { text: string; cls: string } | null }> = [
    { k: 'Trades', v: String(bt.n_trades ?? 0), tip: 'Operaciones simuladas sobre el histórico. Cuantas más, más fiable la estadística.', delta: dlt(bt.n_trades, P?.n_trades, 'neutral', 'num') },
    { k: 'Win rate', v: pct(bt.win_rate), tip: 'Porcentaje de operaciones ganadoras. Por sí solo no dice si el sistema gana dinero.', delta: dlt(bt.win_rate, P?.win_rate, 'up', 'pct') },
    { k: 'Expectancy', v: `${num(bt.expectancy, 3)} R`, tip: 'Ganancia media por operación en R. Positiva = hay ventaja. Es la métrica clave.', delta: dlt(bt.expectancy, P?.expectancy, 'up', 'r') },
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
          {actions}
        </div>
        {runMsg && <p className="bt-runmsg">{runMsg}</p>}
        <div className="bt-cards">
          {cards.map((c) => (
            <div key={c.k} className="bt-card" title={c.tip}>
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
      <CalibrationSection />
      <OptimizationSection />
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

      <div className="bt-acc-group">
        <h4>Metodología · por qué fiarse · pulsa para desplegar</h4>
        <details className="bt-acc">
          <summary>Sin look-ahead (sin trampa)</summary>
          <div className="bt-acc-body">
            <p>
              En cada vela la decisión se toma usando <strong>solo</strong> la información disponible
              hasta ese momento, nunca datos futuros. Es lo que separa un backtest honesto de uno que
              se engaña a sí mismo mirando el resultado antes de decidir.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Peor caso en el stop (conservador)</summary>
          <div className="bt-acc-body">
            <p>
              Cuando una misma vela toca el stop y el objetivo, se asume la <strong>pérdida</strong>
              (no se sabe cuál ocurrió primero dentro de la vela). Así los resultados pecan de
              prudentes: en la realidad no serían peores por este motivo.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Reserva out-of-sample (70/30)</summary>
          <div className="bt-acc-body">
            <p>
              El 30% final del histórico se aparta y no influye en nada; sirve de examen. Si las
              métricas de ese tramo se parecen a las del resto, el sistema no está memorizando el
              pasado (no hay sobreajuste). Es la prueba de honestidad clave.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>De dónde sale el número de operaciones</summary>
          <div className="bt-acc-body">
            <p>
              No se fija: es cuántas veces la lógica dijo COMPRAR o VENDER (no MANTENER) sobre las
              ~1000 velas, sin solapar (tras abrir una operación se salta hasta que cierra). Ejemplo:
              si de 950 velas evaluadas el modelo opera y cada operación dura ~10 velas, salen del
              orden de decenas de operaciones. Cambia con la temporalidad (muchas más en 1m, pocas en
              4h) y con la ventana de mercado, por eso el número varía entre ejecuciones.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Qué NO incluye (modo solo-técnico)</summary>
          <div className="bt-acc-body">
            <p>
              El backtest reproduce la decisión <strong>solo con el análisis técnico</strong> (mismos
              indicadores y ensemble que en vivo). No incluye el sesgo macro/fundamental —que ahora
              está en pausa— ni las alertas Reditum en vivo (son eventos externos, no reconstruibles
              del histórico de velas). Por eso el backtest y la decisión en vivo son ahora
              <strong> consistentes</strong>.
            </p>
          </div>
        </details>
      </div>

      <div className="bt-acc-group">
        <h4>Los botones ▶ / ⚙ · pulsa para desplegar</h4>
        <details className="bt-acc">
          <summary>▶ Correr backtest</summary>
          <div className="bt-acc-body">
            <p>
              Genera el backtest de la <strong>temporalidad seleccionada</strong> (cada TF tiene el
              suyo; por eso en 15m dice "aún no hay backtest" hasta que lo corres ahí). Lo ejecuta el
              servicio quant en el servidor, tarda ~10–30s y al terminar refresca las cifras. Si no
              cambia nada o falla, verás un aviso: casi siempre es que el servicio quant no está
              arriba (<code>docker compose up -d --build</code>).
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>⚙ Optimizar (Optuna) — ¿qué es?</summary>
          <div className="bt-acc-body">
            <p>
              <strong>Definición:</strong> "Optimizar" pone a un buscador inteligente (Optuna) a
              probar cientos de combinaciones de los parámetros de la estrategia —los pesos de cada
              indicador, los multiplicadores de régimen, la zona neutra (hold_band), la decisión
              (temperature) y la sensibilidad del ADX— para encontrar la que <strong>más ventaja
              habría dado</strong> sobre el histórico.
            </p>
            <p>
              <strong>Cómo funciona:</strong> mide cada combinación en un tramo de validación y solo
              <strong> promociona</strong> la ganadora si además supera a la actual en un tramo
              hold-out reservado (nunca usado en la búsqueda). Así se evita el sobreajuste. Si gana,
              la aplica en vivo y re-corre el backtest para que veas el efecto (mira los Δ).
            </p>
            <p className="bt-note">
              Es la forma rigurosa de <strong>afinar la estrategia con datos</strong>, en vez de
              ajustar los parámetros a ojo. Tarda ~1 minuto.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Los indicadores Δ (verde/rojo)</summary>
          <div className="bt-acc-body">
            <p>
              El numerito arriba a la derecha de cada métrica es el <strong>cambio respecto a la
              corrida anterior</strong> del backtest: verde = mejor, rojo = peor (en el drawdown es al
              revés, porque menos es mejor). Solo aparece si ya hay dos corridas para comparar.
            </p>
          </div>
        </details>
      </div>

      <div className="bt-acc-group">
        <h4>Calibración de probabilidades · pulsa para desplegar</h4>
        <details className="bt-acc">
          <summary>¿Qué es calibrar?</summary>
          <div className="bt-acc-body">
            <p>
              Ajusta la confianza del modelo para que refleje la frecuencia real de acierto: que
              cuando diga «70%», acierte ~70% de las veces. Se hace por régimen (tendencia/rango).
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Diagrama de fiabilidad</summary>
          <div className="bt-acc-body">
            <p>
              Probabilidad prevista (eje X) frente a frecuencia real de acierto (eje Y). La diagonal
              es la calibración perfecta: cuanto más pegados los puntos a ella, más honestas las
              probabilidades.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Brier score</summary>
          <div className="bt-acc-body">
            <p>
              Error cuadrático medio entre la probabilidad y el resultado (0/1). Más bajo = mejor
              calibración. Se elige entre isotónica y Platt el de menor Brier.
            </p>
          </div>
        </details>
      </div>

      <div className="bt-acc-group">
        <h4>Optimización de pesos · pulsa para desplegar</h4>
        <details className="bt-acc">
          <summary>Optuna</summary>
          <div className="bt-acc-body">
            <p>
              Buscador bayesiano (TPE) que prueba combinaciones de pesos de los indicadores y
              multiplicadores de régimen para maximizar la ventaja, de forma más eficiente que
              probar al azar.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Walk-forward (purga/embargo)</summary>
          <div className="bt-acc-body">
            <p>
              Validación temporal por bloques hacia adelante. La «purga» descarta trades cuyo
              horizonte cruza el borde del bloque y el «embargo» separa bloques, evitando fuga
              temporal entre entrenamiento y prueba.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Hold-out y promoción</summary>
          <div className="bt-acc-body">
            <p>
              Se reserva un tramo final (nunca usado en la búsqueda). El candidato optimizado solo
              se promociona si supera al base en ese hold-out: así se evita el sobreajuste.
            </p>
          </div>
        </details>
      </div>
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

function fmtR(n: number | undefined): string {
  return n == null ? '—' : `${n.toFixed(3)} R`;
}

function OptimizationSection() {
  const [meta, setMeta] = useState<EnsembleMeta | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchEnsemble().then((r) => {
      if (!cancelled) {
        setMeta(r);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
  const report = meta?.report ?? null;

  return (
    <section className="panel opt-panel">
      <div className="chart-head">
        <strong>Optimización de pesos</strong>
        <span className="muted">
          · Optuna + walk-forward{meta?.version ? ` · activo: ${meta.version}` : ''}
        </span>
      </div>
      {!report ? (
        <p className="muted">
          Aún sin optimización. Ejecútala desde quant:{' '}
          <code>python -m trademe_quant.run_optimize BTCUSDT 5m</code>, y recarga con{' '}
          <code>POST /reload</code>.
        </p>
      ) : (
        <>
          <div className="opt-verdict">
            {report.promoted ? (
              <span className="opt-badge opt-ok">✓ Promovido (gana en hold-out)</span>
            ) : (
              <span className="opt-badge opt-no">Base mantenido (no supera el hold-out)</span>
            )}
            <span className="muted">
              {report.n_trials} trials · score val. {report.validation_score.toFixed(3)}
            </span>
          </div>
          <table className="opt-table">
            <thead>
              <tr>
                <th>Hold-out</th>
                <th>Expectancy</th>
                <th>Trades</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Base</td>
                <td>{fmtR(report.holdout.base_expectancy)}</td>
                <td>{report.holdout.base_trades}</td>
              </tr>
              <tr className={report.promoted ? 'opt-win' : ''}>
                <td>Optimizado</td>
                <td>{fmtR(report.holdout.optimized_expectancy)}</td>
                <td>{report.holdout.optimized_trades}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted calib-legend">
            El candidato solo se promociona si su expectancy en el tramo hold-out (nunca usado en la
            búsqueda) supera al base. Así se evita el sobreajuste.
          </p>
        </>
      )}
    </section>
  );
}
