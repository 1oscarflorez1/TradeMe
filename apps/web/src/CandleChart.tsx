import { useEffect, useRef } from 'react';
import {
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './types';

function toBar(candle: Candle): CandlestickData {
  return {
    time: Math.floor(candle.openTime / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

export interface PlanLevels {
  entry: number;
  stop: number;
  tp: number;
}

export function CandleChart({
  candles,
  last,
  levels,
}: {
  candles: Candle[];
  last: Candle | null;
  levels?: PlanLevels | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b97a7' },
      grid: { vertLines: { color: '#1b2230' }, horzLines: { color: '#1b2230' } },
      timeScale: { timeVisible: true, borderColor: '#232b38' },
      rightPriceScale: { borderColor: '#232b38' },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#2ecc71',
      downColor: '#ff5c5c',
      wickUpColor: '#2ecc71',
      wickDownColor: '#ff5c5c',
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    seriesRef.current?.setData(candles.map(toBar));
  }, [candles]);

  useEffect(() => {
    if (last) seriesRef.current?.update(toBar(last));
  }, [last]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !levels) return;
    const lines = [
      series.createPriceLine({ price: levels.entry, color: '#4da3ff', lineWidth: 1, title: 'Entrada' }),
      series.createPriceLine({ price: levels.stop, color: '#ff5c5c', lineWidth: 1, title: 'Stop' }),
      series.createPriceLine({ price: levels.tp, color: '#2ecc71', lineWidth: 1, title: 'Objetivo' }),
    ];
    return () => lines.forEach((l) => series.removePriceLine(l));
  }, [levels, candles]);

  return <div className="chart" ref={containerRef} />;
}
