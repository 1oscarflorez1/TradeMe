import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachStream } from '../src/ws.js';

describe('WS /stream', () => {
  it('envía un mensaje hello al conectar', async () => {
    const server = createServer();
    attachStream(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };

    const message = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/stream`);
      ws.on('message', (data) => {
        resolve(data.toString());
        ws.close();
      });
      ws.on('error', reject);
    });

    const parsed = JSON.parse(message) as { type: string; service: string };
    expect(parsed.type).toBe('hello');
    expect(parsed.service).toBe('trademe-api');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
