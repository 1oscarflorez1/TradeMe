import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * Canal WebSocket base en `/stream`. En M0 solo saluda y hace eco;
 * el motor de señales (objeto Signal completo) llega en M1+.
 */
export function attachStream(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/stream' });

  wss.on('connection', (socket: WebSocket) => {
    socket.send(
      JSON.stringify({
        type: 'hello',
        service: 'trademe-api',
        note: 'WS base — sin señales todavía (M0).',
      }),
    );

    socket.on('message', (data) => {
      socket.send(JSON.stringify({ type: 'echo', received: data.toString() }));
    });
  });

  return wss;
}
