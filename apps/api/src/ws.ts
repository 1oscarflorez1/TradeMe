import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { isInterval } from './domain/candle.js';
import type { StreamHub } from './stream/hub.js';

const STREAM_PATH = /^\/stream\/([A-Za-z0-9]+)$/;

/**
 * Adjunta el canal WS `/stream/{symbol}?interval=1m|1h` al servidor HTTP.
 * `verifyToken` (Módulo 3): si se pasa, exige `?token=<jwt>` válido antes de aceptar la
 * conexión (el navegador no puede mandar cabeceras custom en el handshake de WS, por eso va
 * por query string). Sin `verifyToken` el canal queda abierto, igual que antes de este módulo.
 */
export function attachStream(
  server: Server,
  hub: StreamHub,
  verifyToken?: (token: string | null) => boolean,
): WebSocketServer {
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
    if (verifyToken && !verifyToken(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
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
