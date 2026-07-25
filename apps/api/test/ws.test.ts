import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachStream } from '../src/ws.js';
import { StreamHub } from '../src/stream/hub.js';

describe('WS /stream/{symbol}', () => {
  it('saluda con símbolo e intervalo al conectar', async () => {
    const server = createServer();
    const hub = new StreamHub();
    attachStream(server, hub);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const message = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/BTCUSDT?interval=1h`);
      ws.on('message', (data) => {
        resolve(data.toString());
        ws.close();
      });
      ws.on('error', reject);
    });

    const parsed = JSON.parse(message) as { type: string; symbol: string; interval: string };
    expect(parsed.type).toBe('hello');
    expect(parsed.symbol).toBe('BTCUSDT');
    expect(parsed.interval).toBe('1h');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('con verifyToken configurado, rechaza la conexión sin token válido', async () => {
    const server = createServer();
    const hub = new StreamHub();
    attachStream(server, hub, (token) => token === 'valido');
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const closed = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/BTCUSDT?interval=1h`);
      ws.on('open', () => resolve(false));
      ws.on('error', () => resolve(true));
      ws.on('close', () => resolve(true));
    });
    expect(closed).toBe(true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('con verifyToken configurado, acepta la conexión con token válido', async () => {
    const server = createServer();
    const hub = new StreamHub();
    attachStream(server, hub, (token) => token === 'valido');
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const message = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/stream/BTCUSDT?interval=1h&token=valido`);
      ws.on('message', (data) => {
        resolve(data.toString());
        ws.close();
      });
      ws.on('error', reject);
    });
    const parsed = JSON.parse(message) as { type: string };
    expect(parsed.type).toBe('hello');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
