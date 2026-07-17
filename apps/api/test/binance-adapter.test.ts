import { describe, it, expect } from 'vitest';
import { WebSocketServer } from 'ws';
import { BinanceAdapter } from '../src/adapters/binance-adapter.js';
import type { Candle } from '../src/domain/candle.js';

function klineMessage(close: string): string {
  return JSON.stringify({
    stream: 'btcusdt@kline_1m',
    data: {
      e: 'kline',
      E: 1,
      s: 'BTCUSDT',
      k: {
        t: 0,
        T: 59_999,
        s: 'BTCUSDT',
        i: '1m',
        o: '1',
        c: close,
        h: '3',
        l: '0.5',
        v: '10',
        x: true,
      },
    },
  });
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condición');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('BinanceAdapter', () => {
  it('normaliza velas y se reconecta con backoff tras una caída', async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.on('listening', resolve));
    const { port } = wss.address() as { port: number };

    let connections = 0;
    wss.on('connection', (socket) => {
      connections += 1;
      const current = connections;
      socket.send(klineMessage(current === 1 ? '2' : '5'));
      // Provoca una caída tras la primera conexión para forzar reconexión.
      if (current === 1) setTimeout(() => socket.close(), 40);
    });

    const candles: Candle[] = [];
    const adapter = new BinanceAdapter({
      wsBase: `ws://127.0.0.1:${port}`,
      maxReconnectDelayMs: 100,
    });
    await adapter.start([{ symbol: 'BTCUSDT', interval: '1m' }], (c) => candles.push(c));

    // Debe conectar dos veces (reconexión) y recibir dos velas.
    await waitFor(() => connections >= 2 && candles.length >= 2, 4000);

    expect(candles[0]?.close).toBe(2);
    expect(candles[1]?.close).toBe(5);
    expect(candles[0]?.symbol).toBe('BTCUSDT');

    await adapter.stop();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
});
