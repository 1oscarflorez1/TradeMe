import { useEffect, useRef, useState } from 'react';
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
import { LabView } from './LabView';
import { HelpView } from './HelpView';
import { NewsView } from './NewsView';
import { StatusView } from './StatusView';
import { AssetManager } from './AssetManager';
import { TimeframeBar } from './TimeframeBar';
import { SustentoView } from './SustentoView';
import { Asistente } from './Asistente';
import { setTvSymbols } from './tvSymbol';
import { DrawingLayer } from './DrawingLayer';
import {
  fetchCandles,
  fetchSignal,
  fetchSnapshots,
  fetchAssets,
  fetchProviders,
  ErrorDeProveedor,
  fetchSymbols,
  fetchVotes,
  logout,
  postSnapshot,
  streamUrl,
} from './api';
import { AlertCenter, useAlerts } from './AlertCenter';
import type { Candle, ConnectionStatus, Interval, Signal, Vote } from './types';

const TF_ALERT_KEY = 'trademe.tfAlertThresholds';
type TfAlert = { action: string; conf: number };

/**
 * Explica por qué no hay mercado, distinguiendo tres cosas que antes se veían igual.
 *
 * Hasta la 0.37.1 cualquier fallo del proveedor salía como «Error: GET /candles 502», que no decía
 * ni la causa ni si se arreglaba solo. El caso real que lo destapó fue agotar el cupo diario de un
 * plan gratuito: el sistema estaba sano y el dato volvía a medianoche, pero el portal parecía roto.
 */
function ErrorDeMercado({ error, symbol }: { error: Error; symbol: string }) {
  const prov = error instanceof ErrorDeProveedor ? error : null;
  const kind = prov?.kind ?? null;
  const retry = prov?.retryAt;

  if (kind === 'sin_cupo') {
    const cuando = retry
      ? new Date(retry).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })
      : 'medianoche UTC';
    return (
      <>
        <p>
          <strong>Cupo diario de datos agotado</strong>
          {prov?.provider ? <> en {prov.provider}</> : null}.
        </p>
        <p className="hint">
          Se restablece a las <strong>00:00 UTC</strong> ({cuando}). No es una avería: el plan
          gratuito limita las peticiones por día, y los activos por sondeo consumen unas 400 cada
          uno. Mientras tanto, los activos en tiempo real (cripto) siguen funcionando.
        </p>
      </>
    );
  }
  if (kind === 'no_soportado') {
    return (
      <>
        <p>
          <strong>{symbol}</strong> no está disponible en su proveedor de datos.
        </p>
        <p className="hint">
          El activo existe en el catálogo, pero la fuente no sirve esta temporalidad. Prueba con
          15m o superior, que es donde estos proveedores tienen datos.
        </p>
      </>
    );
  }
  return (
    <>
      <p>No se pudo cargar el mercado: {error.message}</p>
      <p className="hint">
        Puede ser un fallo temporal del proveedor. Si persiste, revisa la pestaña Estado.
      </p>
    </>
  );
}

const ACT_ES: Record<string, string> = { BUY: 'Compra', SELL: 'Venta', HOLD: 'Mantener' };

/**
 * Por qué no se opera. «Mantener» dejaba al usuario sin saber si el sistema no ve nada o si algo lo
 * ha frenado, que son dos situaciones muy distintas: una es indiferencia y la otra es una decisión.
 */
const MOTIVO_NO_OPERAR: Record<string, { etiqueta: string; detalle: string }> = {
  cuarentena: {
    etiqueta: 'temporalidad en cuarentena',
    detalle:
      'Esta temporalidad está retirada de la operativa por rendimiento negativo sostenido. Se sigue calculando y registrando para poder medir cuándo levantarla, pero no propone entradas.',
  },
  conflicto_macro: {
    etiqueta: 'conflicto con el macro',
    detalle:
      'La lectura técnica y el contexto macro apuntan a lados opuestos, y el macro es lo bastante fuerte como para no operar en su contra.',
  },
  veto_meta: {
    etiqueta: 'vetada por el filtro ML',
    detalle:
      'El meta-modelo, entrenado con tus registros evaluados, considera esta señal poco fiable y la descarta.',
  },
  banda_neutra: {
    etiqueta: 'sin ventaja suficiente',
    detalle:
      'Los indicadores no se inclinan lo bastante como para salir de la banda neutra. No es un fallo: concluir que no hay ventaja también es una decisión.',
  },
};
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

type View = 'panel' | 'registros' | 'backtest' | 'lab' | 'ayuda' | 'novedades' | 'estado';

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
  const [error, setError] = useState<Error | null>(null);
  const [chartTab, setChartTab] = useState<'local' | 'tv'>('local');
  const [now, setNow] = useState<number>(Date.now());
  const [view, setView] = useState<View>('panel');
  const [alerts, setAlerts] = useState<Record<string, TfAlert>>({});
  /** Modo de entrega de cada activo. Decide cada cuánto se puede preguntar sin agotar el cupo. */
  const [assetsInfo, setAssetsInfo] = useState<Array<{ symbol: string; mode: 'stream' | 'poll' }>>(
    [],
  );
  const [thresholds, setThresholds] = useState<Record<string, number>>(loadThresholds);
  const [showGear, setShowGear] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const { alerts: alertHistory, unread, create: createAlert, markRead } = useAlerts();
  const [cooldownMin, setCooldownMin] = useState<number>(() =>
    Number(localStorage.getItem('trademe.alertCooldownMin') ?? 5),
  );
  const [autoSnap, setAutoSnapState] = useState<boolean>(
    () => localStorage.getItem('trademe.autoSnapshot') === 'true',
  );
  const [autoSnapMax, setAutoSnapMax] = useState<number>(() =>
    Number(localStorage.getItem('trademe.autoSnapshotMax') ?? 5),
  );
  const autoSnapCount = useRef<number>(0);
  const lastFired = useRef<Record<string, number>>({});
  const prevTfAlert = useRef<Set<string>>(new Set());
  const prevDir = useRef<string | null>(null);
  const prevMacroSign = useRef<number>(0);
  const prevReditum = useRef<number>(-1);
  const snapStatus = useRef<Record<string, string>>({});
  const snapMilestone = useRef<Record<string, number>>({});

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Alertas por temporalidad: consulta la decisión de cada TF y marca las accionables >= umbral.
  //
  // Se consultan **en serie y espaciado**, no las nueve a la vez cada 15 segundos como hasta la
  // 0.37.1. Aquello eran 36 peticiones por minuto: para un activo por sondeo, cuyas velas salen de
  // un plan gratuito de 800 al día, agotaba el cupo en veintidós minutos y el panel acababa
  // mostrando «Error: GET /candles 502» sin decir por qué. Los activos en streaming no pagan por
  // petición, así que conservan una cadencia viva.
  useEffect(() => {
    if (!symbol || intervals.length === 0) return;
    let cancelled = false;
    const porSondeo = assetsInfo.find((a) => a.symbol === symbol)?.mode === 'poll';
    const cadencia = porSondeo ? 300_000 : 20_000;

    const poll = async () => {
      const next: Record<string, TfAlert> = {};
      for (const iv of intervals) {
        if (cancelled) return;
        const sig = await fetchSignal(symbol, iv).catch(() => null);
        if (sig) next[iv] = { action: sig.action, conf: sig.confidence };
        // Un respiro entre peticiones: el límite de estos planes es por minuto además de por día.
        if (porSondeo) await new Promise((r) => setTimeout(r, 1200));
      }
      if (!cancelled) setAlerts(next);
    };
    void poll();
    const pid = setInterval(() => void poll(), cadencia);
    return () => {
      cancelled = true;
      clearInterval(pid);
    };
  }, [symbol, intervals, assetsInfo]);


  useEffect(() => {
    fetchSymbols()
      .then((r) => {
        setSymbols(r.symbols);
        setIntervals(r.intervals);
        setSymbol((current) => current || r.symbols[0] || '');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
    // Cada activo trae su equivalente en TradingView según el proveedor de sus velas
    // (BINANCE:BTCUSDT, NASDAQ:AAPL…), para que la pestaña del widget muestre el mercado correcto.
    // Cruzar activos con proveedores da el modo de entrega de cada uno: es lo que decide si se
    // puede preguntar cada veinte segundos o hay que espaciar para no agotar un plan gratuito.
    void Promise.all([fetchAssets(), fetchProviders()]).then(([assets, provs]) => {
      setTvSymbols(assets);
      const modo = new Map(provs.map((p) => [p.id, p.mode]));
      setAssetsInfo(assets.map((a) => ({ symbol: a.symbol, mode: modo.get(a.provider) ?? 'stream' })));
    });
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
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
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
  const setCooldown = (v: number): void => {
    const n = Math.max(0, Math.min(120, v));
    setCooldownMin(n);
    try {
      localStorage.setItem('trademe.alertCooldownMin', String(n));
    } catch {
      /* almacenamiento no disponible */
    }
  };
  const setAutoSnap = (v: boolean): void => {
    if (v) autoSnapCount.current = 0;
    setAutoSnapState(v);
    try {
      localStorage.setItem('trademe.autoSnapshot', String(v));
    } catch {
      /* almacenamiento no disponible */
    }
  };
  const setAutoSnapLimit = (v: number): void => {
    const n = Math.max(1, Math.min(100, v));
    setAutoSnapMax(n);
    try {
      localStorage.setItem('trademe.autoSnapshotMax', String(n));
    } catch {
      /* almacenamiento no disponible */
    }
  };
  const fireSnapshot = (sym: string, iv: string): void => {
    const key = `snap:${sym}:${iv}`;
    const now = Date.now();
    if (now - (lastFired.current[key] ?? 0) < cooldownMin * 60000) return;
    lastFired.current[key] = now;
    void postSnapshot(sym, iv as Interval, 'auto');
    autoSnapCount.current += 1;
    if (autoSnapCount.current >= autoSnapMax) setAutoSnap(false);
  };
  const fireAlert = (key: string, input: Parameters<typeof createAlert>[0]): void => {
    const now = Date.now();
    if (now - (lastFired.current[key] ?? 0) < cooldownMin * 60000) return;
    lastFired.current[key] = now;
    void createAlert(input);
  };

  // Regla: decisión accionable >= umbral por temporalidad.
  useEffect(() => {
    const next = new Set<string>();
    for (const iv of intervals) {
      if (isAlert(iv)) {
        next.add(iv);
        if (!prevTfAlert.current.has(iv)) {
          const a = alerts[iv]!;
          fireAlert(`decision:${symbol}:${iv}`, {
            type: 'decision',
            severity: 'info',
            symbol,
            interval: iv,
            title: `Decisión ${ACT_ES[a.action] ?? a.action}`,
            message: `${symbol} ${iv}: confianza ${(a.conf * 100).toFixed(0)}% ≥ ${thr(iv)}%`,
          });
          if (autoSnap) fireSnapshot(symbol, iv);
        }
      }
    }
    prevTfAlert.current = next;
  }, [alerts]);

  // Regla: cambio de dirección / sesgo macro.
  useEffect(() => {
    if (!signal) return;
    if (prevDir.current && signal.direction !== prevDir.current && signal.direction !== 'FLAT') {
      fireAlert(`dir:${symbol}:${tf}`, {
        type: 'macro',
        severity: 'info',
        symbol,
        interval: tf,
        title: `Cambio de dirección: ${signal.direction}`,
        message: `${symbol} ${tf}: ahora ${signal.direction}.`,
      });
    }
    prevDir.current = signal.direction;
    const sign = signal.macro ? Math.sign(signal.macro.bias) : 0;
    if (prevMacroSign.current !== 0 && sign !== 0 && sign !== prevMacroSign.current) {
      fireAlert(`macro:${symbol}`, {
        type: 'macro',
        severity: 'info',
        symbol,
        title: `Sesgo macro ${sign > 0 ? 'alcista' : 'bajista'}`,
        message: `El sesgo macro de ${symbol} cambió de signo.`,
      });
    }
    if (sign !== 0) prevMacroSign.current = sign;
  }, [signal]);

  // Regla: señal Reditum recibida (nuevos votos tradingview).
  useEffect(() => {
    const tv = votes.filter((v) => v.source === 'tradingview').length;
    if (prevReditum.current >= 0 && tv > prevReditum.current) {
      fireAlert(`reditum:${symbol}`, {
        type: 'reditum',
        severity: 'info',
        symbol,
        title: 'Señal Reditum recibida',
        message: `Nueva alerta de TradingView/Reditum en ${symbol}.`,
      });
    }
    prevReditum.current = tv;
  }, [votes]);

  // Regla: snapshots que tocan TP/SL y avance cada 10% al objetivo.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const poll = async () => {
      const r = await fetchSnapshots(symbol);
      if (cancelled || !r) return;
      for (const snap of r.snapshots) {
        const st = snap.tracking?.status ?? '';
        const prev = snapStatus.current[snap.id];
        if (st && prev !== undefined && st !== prev) {
          if (st === 'tp') {
            fireAlert(`out:${snap.id}`, {
              type: 'outcome',
              severity: 'success',
              symbol,
              interval: snap.interval,
              title: 'Objetivo alcanzado (✓ TP)',
              message: `Un registro ${snap.direction} de ${symbol} ${snap.interval} tocó su objetivo.`,
            });
          } else if (st === 'sl') {
            fireAlert(`out:${snap.id}`, {
              type: 'outcome',
              severity: 'warning',
              symbol,
              interval: snap.interval,
              title: 'Stop tocado (✗ SL)',
              message: `Un registro ${snap.direction} de ${symbol} ${snap.interval} tocó su stop.`,
            });
          }
        }
        snapStatus.current[snap.id] = st;
        if (
          snap.tracking?.status === 'en_curso' &&
          snap.plan_entry !== null &&
          snap.plan_take_profit !== null &&
          snap.direction !== 'FLAT'
        ) {
          const entry = snap.plan_entry;
          const tp = snap.plan_take_profit;
          const prog =
            snap.direction === 'LONG'
              ? (r.currentPrice - entry) / (tp - entry || 1)
              : (entry - r.currentPrice) / (entry - tp || 1);
          const m = Math.floor(Math.max(0, Math.min(1, prog)) * 10);
          const prevM = snapMilestone.current[snap.id] ?? 0;
          if (m > prevM && m > 0 && m < 10) {
            fireAlert(`prog:${snap.id}:${m}`, {
              type: 'progress',
              severity: 'info',
              symbol,
              interval: snap.interval,
              title: `Avance ${m * 10}% al objetivo`,
              message: `Un registro ${snap.direction} de ${symbol} ${snap.interval} lleva ${m * 10}% del camino al objetivo.`,
            });
          }
          snapMilestone.current[snap.id] = Math.max(prevM, m);
        }
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 12000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

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
            <button
              type="button"
              className={view === 'lab' ? 'nav active' : 'nav'}
              onClick={() => setView('lab')}
              title="Calibrar y afinar: optimización, calibración, meta-modelo y piloto automático"
            >
              Laboratorio
            </button>
            <span className="nav-sep" aria-hidden />
            <button
              type="button"
              className={view === 'ayuda' ? 'nav active' : 'nav'}
              onClick={() => setView('ayuda')}
              title="Manual, base de conocimientos, preguntas frecuentes y glosario"
            >
              Ayuda
            </button>
            <button
              type="button"
              className={view === 'novedades' ? 'nav active' : 'nav'}
              onClick={() => setView('novedades')}
              title="Últimas funciones, mejoras y correcciones"
            >
              Novedades
            </button>
            <button
              type="button"
              className={view === 'estado' ? 'nav active' : 'nav'}
              onClick={() => setView('estado')}
              title="¿Funciona todo? Comprobación en vivo de cada servicio"
            >
              Estado
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
          <button
            type="button"
            className="gear-btn asset-btn"
            title="Gestionar activos: buscar, añadir o pausar los que TradeMe analiza"
            aria-label="Gestionar activos"
            onClick={() => setShowAssets(true)}
          >
            ＋
          </button>

          <div className="tf-alert-wrap">
            <TimeframeBar
              intervals={intervals}
              tf={tf}
              setTf={setTf}
              symbol={symbol}
              alertaEn={isAlert}
              tituloDe={(it) =>
                alerts[it]
                  ? `${ACT_ES[alerts[it]!.action] ?? alerts[it]!.action} · ${(alerts[it]!.conf * 100).toFixed(0)}% (umbral ${thr(it)}%)`
                  : 'Sin datos de decisión aún'
              }
            />
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
                  Aparece un <span className="dot-inline" /> punto verde cuando hay una decisión
                  COMPRAR o VENDER con confianza ≥ umbral.
                </p>
                <label className="gear-row gear-cooldown">
                  <span className="gear-tf">Cooldown</span>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={cooldownMin}
                    onChange={(e) => setCooldown(Number(e.target.value))}
                  />
                  <span className="muted">min entre alertas iguales</span>
                </label>
                <label className="gear-row gear-autosnap">
                  <input
                    type="checkbox"
                    checked={autoSnap}
                    onChange={(e) => setAutoSnap(e.target.checked)}
                  />
                  <span>Guardar snapshot automático al superar el umbral</span>
                </label>
                <label className="gear-row gear-cooldown">
                  <span className="gear-tf">Límite</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={autoSnapMax}
                    onChange={(e) => setAutoSnapLimit(Number(e.target.value))}
                  />
                  <span className="muted">snapshots antes de desactivarse</span>
                </label>
                <div className="gear-actions">
                  <button type="button" className="gear-save" onClick={() => setShowGear(false)}>
                    Guardar
                  </button>
                </div>
              </div>
            )}
          </div>

          <AlertCenter alerts={alertHistory} unread={unread} onMarkRead={markRead} />

          <button type="button" className="gear-btn" title="Cerrar sesión" onClick={() => logout()}>
            ⎋
          </button>

          <span className={`status status-${status}`}>
            <span className="dot" aria-hidden />
            {STATUS_LABEL[status]}
          </span>
        </div>
        {showAssets && (
          <AssetManager
            onClose={() => setShowAssets(false)}
            onChanged={() => {
              void fetchAssets().then(setTvSymbols);
              void fetchSymbols().then((r) => {
                setSymbols(r.symbols);
                setIntervals(r.intervals);
                setSymbol((cur) => (r.symbols.includes(cur) ? cur : (r.symbols[0] ?? '')));
              });
            }}
          />
        )}
      </header>

      <main className="content">
        {view === 'registros' ? (
          <SnapshotsView symbol={symbol} activos={symbols} />
        ) : view === 'backtest' ? (
          <BacktestView symbol={symbol} interval={tf} />
        ) : view === 'lab' ? (
          <LabView symbol={symbol} interval={tf} />
        ) : view === 'ayuda' ? (
          <HelpView />
        ) : view === 'novedades' ? (
          <NewsView />
        ) : view === 'estado' ? (
          <StatusView />
        ) : error ? (
          <div className="panel error">
            <ErrorDeMercado error={error} symbol={symbol} />
          </div>
        ) : (
          <>
          <div className="panel-view">
            <div className="panel-left">
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
                <DrawingLayer>
                  {chartTab === 'local' ? (
                    <CandleChart candles={candles} last={last} />
                  ) : (
                    <TradingViewChart symbol={symbol} interval={tf} />
                  )}
                </DrawingLayer>
              </section>
            <section className="panel indicators-row">
              <div className="chart-head">
                <strong>Indicadores</strong>
                <span className="muted">· voto normalizado [-1, +1]</span>
              </div>
              <VotesHeatmap votes={votes} />
            </section>
            </div>

              <div className="side">
                <section className="panel signal-panel">
                  <div className="chart-head">
                    <strong>Decisión</strong>
                    {signal && (
                      <span className="muted">
                        · {signal.action} · régimen {signal.regime.label} · net{' '}
                        {signal.net.toFixed(2)}
                        {signal.meta_confidence !== undefined && (
                          <span
                            className={`meta-chip ${signal.meta_vetoed ? 'meta-veto' : ''}`}
                            title={
                              signal.meta_vetoed
                                ? 'El meta-modelo (ML) considera poco fiable esta señal y la ha descartado.'
                                : `Filtro ML: probabilidad de éxito estimada a partir de tus registros evaluados. Modo: ${signal.meta_mode}.`
                            }
                          >
                            🧠 {(signal.meta_confidence * 100).toFixed(0)}%
                            {signal.meta_vetoed ? ' · vetada' : ''}
                          </span>
                        )}
                        {signal.action === 'HOLD' && signal.hold_reason && (
                          <span
                            className={`meta-chip ${signal.hold_reason === 'cuarentena' ? 'meta-veto' : ''}`}
                            title={MOTIVO_NO_OPERAR[signal.hold_reason].detalle}
                          >
                            ⛔ {MOTIVO_NO_OPERAR[signal.hold_reason].etiqueta}
                          </span>
                        )}
                        {signal.independence_factor !== undefined &&
                          signal.independence_factor < 0.999 && (
                            <span
                              className="meta-chip"
                              title={
                                'Los seis indicadores no son seis evidencias independientes: derivan de la misma serie de precio. ' +
                                'La confianza se desinfla en esa proporción, medida sobre tus propios registros. ' +
                                'No cambia la dirección de la decisión, solo la seguridad con que se declara.'
                              }
                            >
                              ⚖ {(signal.independence_factor * 100).toFixed(0)}%
                            </span>
                          )}
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

            {/* El sustento vive aquí, debajo del Panel: es la continuación natural de la
                decisión, no una pestaña aparte. */}
            <SustentoView symbol={symbol} interval={tf} />
          </>
        )}
      </main>

      <footer className="disclaimer">
        Apoyo a la decisión, no asesoría financiera. Ningún modelo garantiza rentabilidad; el
        rendimiento pasado no asegura resultados futuros.
      </footer>
      <Asistente symbol={symbol} interval={tf} />
    </div>
  );
}
