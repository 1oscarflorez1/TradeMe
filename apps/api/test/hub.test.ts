import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { StreamHub } from '../src/stream/hub.js';
import type { Candle } from '../src/domain/candle.js';

function fakeSocket() {
  return {
    readyState: 1,
    OPEN: 1,
    sent: [] as string[],
    send(msg: string) {
      this.sent.push(msg);
    },
    on() {},
  };
}

const candle: Candle = {
  symbol: 'BTCUSDT',
  interval: '1m',
  openTime: 0,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 3,
  closeTime: 59_999,
  closed: true,
};

describe('StreamHub', () => {
  it('difunde solo a clientes del mismo símbolo e intervalo', () => {
    const hub = new StreamHub();
    const matching = fakeSocket();
    const otherInterval = fakeSocket();
    const otherSymbol = fakeSocket();

    hub.add(matching as unknown as WebSocket, 'BTCUSDT', '1m');
    hub.add(otherInterval as unknown as WebSocket, 'BTCUSDT', '1h');
    hub.add(otherSymbol as unknown as WebSocket, 'ETHUSDT', '1m');

    hub.broadcast(candle);

    expect(matching.sent).toHaveLength(1);
    expect(otherInterval.sent).toHaveLength(0);
    expect(otherSymbol.sent).toHaveLength(0);
    expect(JSON.parse(matching.sent[0] ?? '{}')).toMatchObject({ type: 'candle' });
  });
});
