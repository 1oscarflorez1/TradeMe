import { useEffect, useState } from 'react';
import { CandleChart } from './CandleChart';
import { VotesHeatmap } from './VotesHeatmap';
import { ConfidenceRing } from './ConfidenceRing';
import { ProbabilityBars } from './ProbabilityBars';
import { ActionPlan } from './ActionPlan';
import { TradingViewChart } from './TradingViewChart';
import { WebhookStatus } from './WebhookStatus';
import { MacroPanel } from './MacroPanel';
import { SnapshotButton } from './SnapshotButton';
import { SnapshotsView } from './SnapshotsView';
import { BacktestView } from './BacktestView';
import { fetchCandles, fetchSignal, fetchSymbols, fetchVotes, streamUrl } from './api';
import type { Candle, ConnectionStatus, Interval, Signal, Vote } from './types';

const TF_ALERT_KEY = 'trademe.tfAlertThresholds';
type TfAlert = { action: string; conf: number };
function loadThresholds(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TF_ALERT_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  connected: 'En vivo',
  reconnecting: 'Reconectando…',
};

type View = 'panel' | 'registros' | 'backtest';

export function App() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<string>('');
  const [tf, setTf] = useState<Interval>('1m');
  const [intervals, setIntervals] = useState<Interval[]>(['1m']);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [last, setLast] = useState<Candle | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [chartTab, setChartTab] = useState<'local' | 'tv'>('local');
  const [now, setNow] = useState<number>(Date.now());
  const [view, setView] = useState<View>('panel');
  const [alerts, setAlerts] = useState<Record<string, TfAlert>>({});
  const [thresholds, setThresholds] = useState<Record<string, number>>(loadThresholds);
  const [showGear, setShowGear] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Alertas por temporalidad: consulta la decisión de cada TF y marca las accionables >= umbral.
  useEffect(() => {
    if (!symbol || intervals.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      const entries = await Promise.all(
        intervals.map(async (iv) => [iv, await fetchSignal(symbol, iv)] as const),
      );
      if (cancelled) return;
      const next: Record<string, TfAlert> = {};
      for (const [iv, sig] of entries) {
        if (sig) next[iv] = { action: sig.action, conf: sig.confidence };
      }
      setAlerts(next);
    };
    void poll();
    const pid = setInterval(() => void poll(), 15000);
    return () => {
      cancelled = true;
      clearInterval(pid);
    };
  }, [symbol, intervals]);

  useEffect(() => {
    fetchSymbols()
      .then((r) => {
        setSymbols(r.symbols);
        setIntervals(r.intervals);
        setSymbol((current) => current || r.symbols[0] || '');
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setError(null);
    setVotes([]);
    setSignal(null);

    fetchCandles(symbol, tf)
      .then((c) => {
        if (!cancelled) {
          setCandles(c);
          setLast(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });

    fetchVotes(symbol, tf)
      .then((v) => !cancelled && setVotes(v))
      .catch(() => {});
    fetchSignal(symbol, tf)
      .then((s) => !cancelled && setSignal(s))
      .catch(() => {});

    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      ws = new WebSocket(streamUrl(symbol, tf));
      ws.onopen = () => setStatus('connected');
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as {
          type: string;
          candle?: Candle;
          votes?: Vote[];
          signal?: Signal;
        };
        if (msg.type === 'candle' && msg.candle) setLast(msg.candle);
        if (msg.type === 'votes' && msg.votes) setVotes(msg.votes);
        if (msg.type === 'signal' && msg.signal) setSignal(msg.signal);
      };
      ws.onclose = () => {
        if (cancelled) return;
        setStatus('reconnecting');
        retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };
    setStatus('connecting');
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [symbol, tf]);

  const thr = (iv: string): number => thresholds[iv] ?? 50;
  const isAlert = (iv: string): boolean => {
    const a = alerts[iv];
    return !!a && (a.action === 'BUY' || a.action === 'SELL') && a.conf * 100 >= thr(iv);
  };
  const setThreshold = (iv: string, value: number): void => {
    const v = Math.max(0, Math.min(100, value));
    setThresholds((prev) => {
      const next = { ...prev, [iv]: v };
      try {
        localStorage.setItem(TF_ALERT_KEY, JSON.stringify(next));
      } catch {
        /* almacenamiento no disponible */
      }
      return next;
    });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◆
          </span>
          <h1>TradeMe</h1>
          <nav className="nav-tabs" aria-label="Vistas">
            <button
              type="button"
              className={view === 'panel' ? 'nav active' : 'nav'}
              onClick={() => setView('panel')}
            >
              Panel
            </button>
            <button
              type="button"
              className={view === 'registros' ? 'nav active' : 'nav'}
              onClick={() => setView('registros')}
            >
              Registros
            </button>
            <button
              type="button"
              className={view === 'backtest' ? 'nav active' : 'nav'}
              onClick={() => setView('backtest')}
            >
              Backtest
            </button>
          </nav>
        </div>

        <div className="controls">
          <label className="asset-selector">
            <span className="sr-only">Activo</span>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              aria-label="Seleccionar activo"
              disabled={symbols.length === 0}
            >
              {symbols.length === 0 && <option value="">Cargando…</option>}
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <div className="tf-alert-wrap">
            <div className="tf-group" role="group" aria-label="Temporalidad">
              {intervals.map((it) => (
                <button
                  key={it}
                  type="button"
                  className={it === tf ? 'tf active' : 'tf'}
                  onClick={() => setTf(it)}
                >
                  {it}
                  {isAlert(it) && (
                    <span
                      className="tf-dot"
                      title={`Decisión ${alerts[it]?.action} ${((alerts[it]?.conf ?? 0) * 100).toFixed(0)}% ≥ ${thr(it)}%`}
                      aria-label="alerta activa"
                    />
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="gear-btn"
              aria-label="Configurar alertas"
              title="Configurar alertas de temporalidad"
              onClick={() => setShowGear((v) => !v)}
            >
              ⚙
            </button>
            {showGear && (
              <div className="gear-pop" role="dialog" aria-label="Umbrales de alerta">
                <div className="gear-head">Umbral de alerta por temporalidad</div>
                {intervals.map((iv) => (
                  <label key={iv} className="gear-row">
                    <span className="gear-tf">{iv}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={thr(iv)}
                      onChange={(e) => setThreshold(iv, Number(e.target.value))}
                    />
                    <span className="muted">%</span>
                  </label>
                ))}
                <p className="gear-note">
                  Aparece ⚠ cuando hay una decisión COMPRAR o VENDER con confianza ≥ umbral.
                </p>
              </div>
            )}
          </div>

          <span className={`status status-${status}`}>
            <span className="dot" aria-hidden />
            {STATUS_LABEL[status]}
          </span>
        </div>
      </header>

      <main className="content">
        {view === 'registros' ? (
          <SnapshotsView symbol={symbol} />
        ) : view === 'backtest' ? (
          <BacktestView symbol={symbol} interval={tf} />
        ) : error ? (
          <div className="panel error">
            <p>No se pudo cargar el mercado: {error}</p>
            <p className="hint">¿Está la API en marcha? (`pnpm --filter @trademe/api dev`)</p>
          </div>
        ) : (
          <>
            <div className="grid-top">
              <section className="panel chart-panel">
                <div className="chart-head">
                  <strong>{symbol || '—'}</strong>
                  <span className="muted">· {tf}</span>
                  <div className="chart-tabs" role="group" aria-label="Fuente del gráfico">
                    <button
                      type="button"
                      className={chartTab === 'local' ? 'tf active' : 'tf'}
                      onClick={() => setChartTab('local')}
                    >
                      Local
                    </button>
                    <button
                      type="button"
                      className={chartTab === 'tv' ? 'tf active' : 'tf'}
                      onClick={() => setChartTab('tv')}
                    >
                      TradingView
                    </button>
                  </div>
                </div>
                {chartTab === 'local' ? (
                  <CandleChart candles={candles} last={last} />
                ) : (
                  <TradingViewChart symbol={symbol} interval={tf} />
                )}
              </section>

              <div className="side">
                <section className="panel signal-panel">
                  <div className="chart-head">
                    <strong>Decisión</strong>
                    {signal && (
                      <span className="muted">
                        · {signal.action} · régimen {signal.regime.label} · net{' '}
                        {signal.net.toFixed(2)}
                      </span>
                    )}
                    <SnapshotButton symbol={symbol} interval={tf} />
                  </div>
                  {signal ? (
                    <>
                      <div className="decision">
                        <ConfidenceRing
                          direction={signal.direction}
                          confidence={signal.confidence}
                        />
                        <ProbabilityBars probs={signal.probs} />
                      </div>
                      <MacroPanel macro={signal.macro} />
                    </>
                  ) : (
                    <p className="muted">Calculando la señal…</p>
                  )}
                </section>

                <section className="panel plan-panel">
                  <div className="chart-head">
                    <strong>Plan de acción</strong>
                    {signal && <span className="muted">· {signal.action}</span>}
                  </div>
                  {signal ? (
                    <ActionPlan plan={signal.plan} />
                  ) : (
                    <p className="muted">Calculando…</p>
                  )}
                </section>

                <section className="panel webhooks-panel">
                  <div className="chart-head">
                    <strong>Webhooks · Reditum</strong>
                    <span className="muted">· TradingView</span>
                  </div>
                  <WebhookStatus votes={votes} now={now} />
                </section>
              </div>
            </div>

            <section className="panel indicators-row">
              <div className="chart-head">
                <strong>Indicadores</strong>
                <span className="muted">· voto normalizado [-1, +1]</span>
              </div>
              <VotesHeatmap votes={votes} />
            </section>
          </>
        )}
      </main>

      <footer className="disclaimer">
        Apoyo a la decisión, no asesoría financiera. Ningún modelo garantiza rentabilidad; el
        rendimiento pasado no asegura resultados futuros.
      </footer>
    </div>
  );
}
