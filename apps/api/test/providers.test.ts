import { describe, it, expect, vi } from 'vitest';
import { RateBudget } from '../src/providers/rate-budget.js';
import { PollingProvider } from '../src/providers/polling-provider.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import {
  TwelveDataProvider,
  parseDatetime,
  toCanonical,
  toProviderSymbol,
} from '../src/providers/twelvedata-provider.js';
import type { AssetClass, CatalogEntry, MarketProvider } from '../src/providers/types.js';
import type { Candle, Interval } from '../src/domain/candle.js';
import type { CandleListener, Subscription } from '../src/adapters/data-adapter.js';

const vela = (symbol: string, interval: Interval, openTime: number, closed = true): Candle => ({
  symbol,
  interval,
  openTime,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  closeTime: openTime + 59_999,
  closed,
});

describe('RateBudget', () => {
  it('respeta el límite por minuto y libera al pasar la ventana', () => {
    let ahora = 1_000_000;
    const b = new RateBudget(2, 100, () => ahora);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    ahora += 61_000;
    expect(b.tryTake()).toBe(true);
    expect(b.status().restanteDia).toBe(97);
  });

  it('respeta el límite diario', () => {
    let ahora = 0;
    const b = new RateBudget(100, 3, () => ahora);
    for (let i = 0; i < 3; i += 1) {
      ahora += 61_000;
      expect(b.tryTake()).toBe(true);
    }
    ahora += 61_000;
    expect(b.tryTake()).toBe(false);
  });
});

/** Proveedor de sondeo falso: devuelve lo que le digamos, sin red. */
class FakePoll extends PollingProvider {
  readonly id = 'fake';
  readonly label = 'Falso';
  readonly assetClasses: AssetClass[] = ['acciones'];
  get available(): boolean {
    return true;
  }
  historial: Candle[] = [];
  llamadas = 0;
  async searchCatalog(): Promise<CatalogEntry[]> {
    return [];
  }
  async exists(): Promise<CatalogEntry | null> {
    return null;
  }
  async getHistory(): Promise<Candle[]> {
    this.llamadas += 1;
    return this.historial;
  }
}

describe('PollingProvider', () => {
  const sub: Subscription = { symbol: 'AAPL', interval: '1m' };

  it('la primera pasada no reemite el histórico ya sembrado', async () => {
    const p = new FakePoll({ budget: new RateBudget(100, 100) });
    p.historial = [vela('AAPL', '1m', 1_000), vela('AAPL', '1m', 61_000)];
    const vistas: Candle[] = [];
    await p.start([sub], (c) => vistas.push(c));
    expect(vistas).toHaveLength(0);
    await p.stop();
  });

  it('emite solo velas cerradas nuevas', async () => {
    const p = new FakePoll({ budget: new RateBudget(100, 100), tickMs: 3_600_000 });
    p.historial = [vela('AAPL', '1m', 1_000)];
    const vistas: Candle[] = [];
    await p.start([sub], (c) => vistas.push(c));
    p.historial = [
      vela('AAPL', '1m', 1_000),
      vela('AAPL', '1m', 61_000),
      vela('AAPL', '1m', 121_000, false),
    ];
    await p.tick(Date.now() + 3_600_000);
    expect(vistas.map((v) => v.openTime)).toEqual([61_000]);
    await p.stop();
  });

  it('no consulta antes de que toque y frena si se agota el presupuesto', async () => {
    const p = new FakePoll({ budget: new RateBudget(1, 100), tickMs: 3_600_000 });
    p.historial = [vela('AAPL', '1m', 1_000)];
    await p.start([sub], () => {});
    expect(p.llamadas).toBe(1);
    await p.tick(Date.now()); // aún no vence la cadencia
    expect(p.llamadas).toBe(1);
    await p.tick(Date.now() + 3_600_000); // vence, pero no queda presupuesto
    expect(p.llamadas).toBe(1);
    await p.stop();
  });

  it('la cadencia es ~1/4 de vela, acotada', () => {
    const p = new FakePoll({ minPollMs: 60_000, maxPollMs: 900_000 });
    expect(p.pollIntervalMs('1m')).toBe(60_000); // suelo
    expect(p.pollIntervalMs('15m')).toBe(225_000);
    expect(p.pollIntervalMs('1d')).toBe(900_000); // techo
  });

  it('olvida el estado de las suscripciones retiradas', async () => {
    const p = new FakePoll({ budget: new RateBudget(100, 100), tickMs: 3_600_000 });
    p.historial = [vela('AAPL', '1m', 1_000)];
    await p.start([sub], () => {});
    p.resubscribe([{ symbol: 'MSFT', interval: '1m' }]);
    p.historial = [vela('MSFT', '1m', 1_000)];
    const vistas: Candle[] = [];
    await p.start([{ symbol: 'MSFT', interval: '1m' }], (c) => vistas.push(c));
    expect(vistas).toHaveLength(0); // vuelve a ser primera pasada para el nuevo símbolo
    await p.stop();
  });
});

describe('TwelveDataProvider', () => {
  it('traduce símbolos con barra a una forma segura para URLs y base de datos', () => {
    expect(toCanonical('EUR/USD')).toBe('EUR-USD');
    expect(toProviderSymbol('EUR-USD')).toBe('EUR/USD');
    expect(toCanonical('AAPL')).toBe('AAPL');
  });

  it('interpreta las fechas del proveedor en UTC', () => {
    expect(parseDatetime('2026-05-01')).toBe(Date.UTC(2026, 4, 1));
    expect(parseDatetime('2026-05-01 14:30:00')).toBe(Date.UTC(2026, 4, 1, 14, 30));
  });

  it('queda inactivo y explicado si falta la clave', async () => {
    const p = new TwelveDataProvider({});
    expect(p.available).toBe(false);
    expect(p.unavailableReason).toContain('TWELVEDATA_API_KEY');
    expect(await p.getHistory('AAPL', '1h', 10)).toEqual([]);
  });

  it('normaliza time_series a velas y marca cerrada solo la que ya terminó', async () => {
    const now = Date.UTC(2026, 4, 1, 16, 30);
    const fetchMock = vi.fn(async (_url: unknown) =>
      new Response(
        JSON.stringify({
          values: [
            { datetime: '2026-05-01 14:00:00', open: '1', high: '3', low: '0.5', close: '2', volume: '100' },
            { datetime: '2026-05-01 15:00:00', open: '2', high: '4', low: '1', close: '3' },
            { datetime: '2026-05-01 16:00:00', open: '3', high: '5', low: '2', close: '4' },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const p = new TwelveDataProvider({ apiKey: 'x', now: () => now });
    const velas = await p.getHistory('AAPL', '1h', 3);
    vi.unstubAllGlobals();
    expect(velas).toHaveLength(3);
    expect(velas[0]!.symbol).toBe('AAPL');
    expect(velas[0]!.volume).toBe(100);
    expect(velas[1]!.volume).toBe(0); // sin volumen (acciones/índices) → 0, no NaN
    expect(velas.map((v) => v.closed)).toEqual([true, true, false]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('interval=1h');
  });

  it('rechaza temporalidades que el proveedor no ofrece', async () => {
    const p = new TwelveDataProvider({ apiKey: 'x' });
    expect(p.supportsInterval('1h')).toBe(true);
    await expect(p.getHistory('AAPL', '2h' as Interval, 5)).rejects.toThrow('temporalidad');
  });
});

/** Proveedor mínimo para probar el registro sin tocar la red. */
function fakeProvider(
  id: string,
  available: boolean,
  simbolos: string[],
  assetClass: AssetClass,
): MarketProvider & { subs: Subscription[] } {
  const entry = (symbol: string): CatalogEntry => ({
    symbol,
    base: symbol,
    quote: 'USD',
    label: `${symbol} en ${id}`,
    provider: id,
    assetClass,
  });
  return {
    id,
    label: id,
    assetClasses: [assetClass],
    mode: 'stream',
    available,
    subs: [],
    async searchCatalog(q: string, limit = 25) {
      return simbolos.filter((s) => s.includes(q.toUpperCase())).slice(0, limit).map(entry);
    },
    async exists(symbol: string) {
      return simbolos.includes(symbol.toUpperCase()) ? entry(symbol.toUpperCase()) : null;
    },
    async getHistory(symbol: string, interval: Interval) {
      return [vela(symbol, interval, 1_000)];
    },
    async start(subs: Subscription[], _onCandle: CandleListener) {
      this.subs = subs;
    },
    resubscribe(subs: Subscription[]) {
      this.subs = subs;
    },
    async stop() {},
  };
}

describe('ProviderRegistry', () => {
  const cripto = () => fakeProvider('binance', true, ['BTCUSDT', 'ETHUSDT'], 'cripto');
  const bolsa = () => fakeProvider('twelvedata', true, ['AAPL', 'AMZN'], 'acciones');

  it('resuelve el proveedor por símbolo y recuerda la ruta', async () => {
    const a = cripto();
    const b = bolsa();
    const reg = new ProviderRegistry([a, b]);
    expect((await reg.resolve('AAPL')).id).toBe('twelvedata');
    expect(reg.routeOf('AAPL')).toBe('twelvedata');
    expect((await reg.resolve('BTCUSDT')).id).toBe('binance');
  });

  it('entrelaza los resultados para que ningún proveedor tape al otro', async () => {
    const reg = new ProviderRegistry([
      fakeProvider('binance', true, ['AAAUSDT', 'AABUSDT', 'AACUSDT'], 'cripto'),
      fakeProvider('twelvedata', true, ['AAPL', 'AAL'], 'acciones'),
    ]);
    const hits = await reg.search('AA', 4);
    expect(hits.map((h) => h.provider)).toEqual(['binance', 'twelvedata', 'binance', 'twelvedata']);
  });

  it('filtra por clase de activo', async () => {
    const reg = new ProviderRegistry([cripto(), bolsa()]);
    const hits = await reg.search('A', 10, 'acciones');
    expect(hits.every((h) => h.assetClass === 'acciones')).toBe(true);
  });

  it('ignora proveedores sin configurar', async () => {
    const reg = new ProviderRegistry([cripto(), fakeProvider('twelvedata', false, ['AAPL'], 'acciones')]);
    expect(await reg.search('AAPL', 5)).toEqual([]);
    expect(reg.info().find((p) => p.id === 'twelvedata')?.available).toBe(false);
  });

  it('reparte las suscripciones a cada proveedor según la ruta', async () => {
    const a = cripto();
    const b = bolsa();
    const reg = new ProviderRegistry([a, b]);
    reg.setRoute('BTCUSDT', 'binance');
    reg.setRoute('AAPL', 'twelvedata');
    await reg.start(
      [
        { symbol: 'BTCUSDT', interval: '5m' },
        { symbol: 'AAPL', interval: '5m' },
      ],
      () => {},
    );
    expect(a.subs.map((s) => s.symbol)).toEqual(['BTCUSDT']);
    expect(b.subs.map((s) => s.symbol)).toEqual(['AAPL']);
  });

  it('el histórico va al proveedor correcto', async () => {
    const reg = new ProviderRegistry([cripto(), bolsa()]);
    const velas = await reg.getHistory('AAPL', '1h', 1);
    expect(velas[0]!.symbol).toBe('AAPL');
  });
});
