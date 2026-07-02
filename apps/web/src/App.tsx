import { useEffect, useState } from 'react';
import { CandleChart } from './CandleChart';
import { fetchCandles, fetchSymbols, streamUrl } from './api';
import type { Candle, ConnectionStatus, Interval } from './types';

const INTERVALS: Interval[] = ['1m', '1h'];

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  connected: 'En vivo',
  reconnecting: 'Reconectando…',
};

export function App() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<string>('');
  const [tf, setTf] = useState<Interval>('1m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [last, setLast] = useState<Candle | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSymbols()
      .then((r) => {
        setSymbols(r.symbols);
        setSymbol((current) => current || r.symbols[0] || '');
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setError(null);

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

    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(streamUrl(symbol, tf));
      ws.onopen = () => setStatus('connected');
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as { type: string; candle?: Candle };
        if (msg.type === 'candle' && msg.candle) setLast(msg.candle);
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◆
          </span>
          <h1>TradeMe</h1>
          <span className="tag">copiloto de trading</span>
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

          <div className="tf-group" role="group" aria-label="Temporalidad">
            {INTERVALS.map((it) => (
              <button
                key={it}
                type="button"
                className={it === tf ? 'tf active' : 'tf'}
                onClick={() => setTf(it)}
              >
                {it}
              </button>
            ))}
          </div>

          <span className={`status status-${status}`}>
            <span className="dot" aria-hidden />
            {STATUS_LABEL[status]}
          </span>
        </div>
      </header>

      <main className="content">
        {error ? (
          <div className="panel error">
            <p>No se pudo cargar el mercado: {error}</p>
            <p className="hint">¿Está la API en marcha? (`pnpm --filter @trademe/api dev`)</p>
          </div>
        ) : (
          <section className="panel chart-panel">
            <div className="chart-head">
              <strong>{symbol || '—'}</strong>
              <span className="muted">· {tf} · Binance</span>
            </div>
            <CandleChart candles={candles} last={last} />
          </section>
        )}
      </main>

      <footer className="disclaimer">
        Apoyo a la decisión, no asesoría financiera. Ningún modelo garantiza rentabilidad; el
        rendimiento pasado no asegura resultados futuros.
      </footer>
    </div>
  );
}
