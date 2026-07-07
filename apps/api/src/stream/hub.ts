import type { WebSocket } from 'ws';
import type { Candle, Interval } from '../domain/candle.js';
import type { Vote } from '../indicators/types.js';

interface Client {
  socket: WebSocket;
  symbol: string;
  interval: Interval;
}

/** Registra clientes WS y les difunde velas y votos de su (symbol, interval). */
export class StreamHub {
  private readonly clients = new Set<Client>();

  add(socket: WebSocket, symbol: string, interval: Interval): void {
    const client: Client = { socket, symbol, interval };
    this.clients.add(client);
    socket.on('close', () => this.clients.delete(client));
  }

  private send(symbol: string, interval: Interval, message: string): void {
    for (const client of this.clients) {
      if (
        client.symbol === symbol &&
        client.interval === interval &&
        client.socket.readyState === client.socket.OPEN
      ) {
        client.socket.send(message);
      }
    }
  }

  broadcast(candle: Candle): void {
    this.send(candle.symbol, candle.interval, JSON.stringify({ type: 'candle', candle }));
  }

  broadcastVotes(symbol: string, interval: Interval, votes: Vote[]): void {
    const ts = votes.length > 0 ? votes[votes.length - 1]?.ts : new Date().toISOString();
    this.send(symbol, interval, JSON.stringify({ type: 'votes', symbol, interval, ts, votes }));
  }

  get size(): number {
    return this.clients.size;
  }
}
