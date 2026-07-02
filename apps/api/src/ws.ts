import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { isInterval } from './domain/candle.js';
import type { StreamHub } from './stream/hub.js';

const STREAM_PATH = /^\/stream\/([A-Za-z0-9]+)$/;

/** Adjunta el canal WS `/stream/{symbol}?interval=1m|1h` al servidor HTTP. */
export function attachStream(server: Server, hub: StreamHub): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const match = STREAM_PATH.exec(url.pathname);
    const symbol = match?.[1];
    const interval = url.searchParams.get('interval') ?? '1m';

    if (!symbol || !isInterval(interval)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.add(ws, symbol.toUpperCase(), interval);
      ws.send(JSON.stringify({ type: 'hello', symbol: symbol.toUpperCase(), interval }));
    });
  });

  return wss;
}
