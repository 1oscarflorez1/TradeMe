import type { WebSocket } from 'ws';
import type { Candle, Interval } from '../domain/candle.js';

interface Client {
  socket: WebSocket;
  symbol: string;
  interval: Interval;
}

/** Registra clientes WS y les difunde las velas de su (symbol, interval). */
export class StreamHub {
  private readonly clients = new Set<Client>();

  add(socket: WebSocket, symbol: string, interval: Interval): void {
    const client: Client = { socket, symbol, interval };
    this.clients.add(client);
    socket.on('close', () => this.clients.delete(client));
  }

  broadcast(candle: Candle): void {
    const message = JSON.stringify({ type: 'candle', candle });
    for (const client of this.clients) {
      if (
        client.symbol === candle.symbol &&
        client.interval === candle.interval &&
        client.socket.readyState === client.socket.OPEN
      ) {
        client.socket.send(message);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }
}
