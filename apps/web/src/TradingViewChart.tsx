import { useEffect, useRef } from 'react';
import type { Interval } from './types';
import { tvInterval, tvSymbol } from './tvSymbol';

declare global {
  interface Window {
    TradingView?: { widget: new (config: Record<string, unknown>) => unknown };
  }
}

const TV_SRC = 'https://s3.tradingview.com/tv.js';
let tvPromise: Promise<void> | null = null;

function loadTradingView(): Promise<void> {
  if (window.TradingView) return Promise.resolve();
  if (tvPromise) return tvPromise;
  tvPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TV_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('no se pudo cargar TradingView'));
    document.head.appendChild(script);
  });
  return tvPromise;
}

export function TradingViewChart({ symbol, interval }: { symbol: string; interval: Interval }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    loadTradingView()
      .then(() => {
        if (cancelled || !container || !window.TradingView) return;
        container.innerHTML = '';
        new window.TradingView.widget({
          container_id: container.id,
          symbol: tvSymbol(symbol),
          interval: tvInterval(interval),
          theme: 'dark',
          style: '1',
          locale: 'es',
          autosize: true,
          hide_side_toolbar: false,
        });
      })
      .catch(() => {
        if (container)
          container.innerHTML = '<p class="muted">No se pudo cargar el widget de TradingView.</p>';
      });
    return () => {
      cancelled = true;
      if (container) container.innerHTML = '';
    };
  }, [symbol, interval]);

  return <div id="tv_adv_chart" ref={containerRef} className="tv-chart" />;
}
