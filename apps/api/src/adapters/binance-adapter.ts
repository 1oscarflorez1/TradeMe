import { WebSocket, type RawData } from 'ws';
import { computeBackoff } from './backoff.js';
import {
  normalizeBinanceKline,
  normalizeRestKline,
  type BinanceKlineEvent,
  type BinanceRestKline,
  type Candle,
  type Interval,
} from '../domain/candle.js';
import type { AdapterLogger, CandleListener, DataAdapter, Subscription } from './data-adapter.js';

const WS_BASE = 'wss://stream.binance.com:9443/stream';
const REST_BASE = 'https://api.binance.com/api/v3/klines';

const NOOP_LOGGER: AdapterLogger = { info: () => {}, warn: () => {}, error: () => {} };

export interface BinanceAdapterOptions {
  wsBase?: string;
  restBase?: string;
  logger?: AdapterLogger;
  maxReconnectDelayMs?: number;
}

/** Adaptador de datos públicos de Binance (solo lectura, sin clave). */
export class BinanceAdapter implements DataAdapter {
  readonly name = 'binance';

  private readonly wsBase: string;
  private readonly restBase: string;
  private log: AdapterLogger;
  private readonly maxReconnectDelayMs: number;

  private ws: WebSocket | null = null;
  private subscriptions: Subscription[] = [];
  private onCandle: CandleListener = () => {};
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: BinanceAdapterOptions = {}) {
    this.wsBase = opts.wsBase ?? WS_BASE;
    this.restBase = opts.restBase ?? REST_BASE;
    this.log = opts.logger ?? NOOP_LOGGER;
    this.maxReconnectDelayMs = opts.maxReconnectDelayMs ?? 30_000;
  }

  setLogger(logger: AdapterLogger): void {
    this.log = logger;
  }

  async start(subscriptions: Subscription[], onCandle: CandleListener): Promise<void> {
    this.subscriptions = subscriptions;
    this.onCandle = onCandle;
    this.stopped = false;
    this.connect();
  }

  private streamNames(): string[] {
    return this.subscriptions.map((s) => `${s.symbol.toLowerCase()}@kline_${s.interval}`);
  }

  private connect(): void {
    if (this.stopped || this.subscriptions.length === 0) return;
    const url = `${this.wsBase}?streams=${this.streamNames().join('/')}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.attempt = 0;
      this.log.info({ url }, 'binance ws conectado');
    });
    ws.on('message', (data: RawData) => this.handleMessage(data));
    ws.on('close', () => this.scheduleReconnect());
    ws.on('error', (err: Error) => {
      this.log.warn({ err: err.message }, 'binance ws error');
      ws.close();
    });
  }

  private handleMessage(data: RawData): void {
    try {
      const parsed = JSON.parse(data.toString()) as { stream?: string; data?: BinanceKlineEvent };
      const evt = parsed.data;
      if (!evt || evt.e !== 'kline') return;
      this.onCandle(normalizeBinanceKline(evt));
    } catch (err) {
      this.log.warn({ err: String(err) }, 'kline no parseable');
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = computeBackoff(this.attempt++, { maxMs: this.maxReconnectDelayMs });
    this.log.warn({ attempt: this.attempt, delayMs: delay }, 'reconectando a binance');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  async getHistory(
    symbol: string,
    interval: Interval,
    limit: number,
    endTime?: number,
  ): Promise<Candle[]> {
    const end = endTime ? `&endTime=${endTime}` : '';
    const url = `${this.restBase}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}${end}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance REST ${res.status} en ${url}`);
    const rows = (await res.json()) as BinanceRestKline[];
    return rows.map((row) => normalizeRestKline(symbol.toUpperCase(), interval, row));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
