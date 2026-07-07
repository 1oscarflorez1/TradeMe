import { buildApp } from './app.js';
import { attachStream } from './ws.js';
import { buildSubscriptions, loadEnv, parseSymbols } from './config.js';
import { BinanceAdapter } from './adapters/binance-adapter.js';
import { StreamHub } from './stream/hub.js';
import { createPool } from './db/pool.js';
import { CandlesRepo } from './db/candles-repo.js';
import { INTERVALS, type Candle, type Interval } from './domain/candle.js';
import { IndicatorRegistry } from './indicators/registry.js';
import { CandleBuffer } from './indicators/buffer.js';
import type { Vote } from './indicators/types.js';
import { ExternalSignalStore } from './signals/external-store.js';
import { ExternalMapper } from './signals/external-mapper.js';

const MIN_CANDLES_FOR_VOTES = 40;

function loadMapper(path: string, warn: (msg: string) => void): ExternalMapper {
  try {
    return ExternalMapper.fromFile(path);
  } catch (err) {
    warn(`no se pudo cargar ${path} (${String(err)}); señales externas sin mapeo`);
    return new ExternalMapper({});
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const hub = new StreamHub();
  const adapter = new BinanceAdapter();
  const registry = new IndicatorRegistry();
  const buffer = new CandleBuffer(300);
  const externalStore = new ExternalSignalStore();

  const app = buildApp({
    getHistory: (symbol: string, interval: string, limit: number): Promise<Candle[]> =>
      adapter.getHistory(symbol, interval as Interval, limit),
    symbols: parseSymbols(env),
    registry,
    externalStore,
    mapper: loadMapper(env.EXTERNAL_SIGNALS_CONFIG, (m) => app.log.warn(m)),
    nt8Secret: env.NT8_WEBHOOK_SECRET,
    onExternalVote: (symbol: string) => broadcastVotes(symbol),
  });

  adapter.setLogger({
    info: (obj, msg) => app.log.info(obj as object, msg),
    warn: (obj, msg) => app.log.warn(obj as object, msg),
    error: (obj, msg) => app.log.error(obj as object, msg),
  });

  const repo = env.DATABASE_URL ? new CandlesRepo(createPool(env.DATABASE_URL)) : null;

  function broadcastVotes(symbol: string, interval?: Interval): void {
    const intervals = interval ? [interval] : [...INTERVALS];
    for (const iv of intervals) {
      const window = buffer.get(symbol, iv);
      if (window.length < MIN_CANDLES_FOR_VOTES) continue;
      const votes: Vote[] = [...registry.computeVotes(window), ...externalStore.active(symbol)];
      hub.broadcastVotes(symbol, iv, votes);
    }
  }

  const onCandle = (candle: Candle): void => {
    buffer.push(candle);
    hub.broadcast(candle);
    broadcastVotes(candle.symbol, candle.interval);
    if (repo && candle.closed) {
      repo
        .upsert(candle)
        .catch((err: unknown) => app.log.error({ err: String(err) }, 'fallo al persistir vela'));
    }
  };

  await app.ready();
  attachStream(app.server, hub);
  await app.listen({ host: env.API_HOST, port: env.API_PORT });

  const subscriptions = buildSubscriptions(env);
  // Semilla de histórico para poder calcular indicadores desde el primer momento.
  for (const sub of subscriptions) {
    try {
      const history = await adapter.getHistory(sub.symbol, sub.interval, 300);
      buffer.seed(sub.symbol, sub.interval, history);
    } catch (err) {
      app.log.warn({ err: String(err), sub }, 'no se pudo sembrar histórico inicial');
    }
  }

  await adapter.start(subscriptions, onCandle);
  app.log.info(
    {
      subscriptions: subscriptions.length,
      persistence: Boolean(repo),
      indicators: registry.catalog().length,
    },
    'ingesta + indicadores iniciados',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
