import { buildApp } from './app.js';
import { attachStream } from './ws.js';
import { buildSubscriptions, loadEnv, parseSymbols } from './config.js';
import { BinanceAdapter } from './adapters/binance-adapter.js';
import { StreamHub } from './stream/hub.js';
import { createPool } from './db/pool.js';
import { CandlesRepo } from './db/candles-repo.js';
import type { Candle, Interval } from './domain/candle.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const hub = new StreamHub();
  const adapter = new BinanceAdapter();

  const app = buildApp({
    getHistory: (symbol: string, interval: string, limit: number): Promise<Candle[]> =>
      adapter.getHistory(symbol, interval as Interval, limit),
    symbols: parseSymbols(env),
  });

  adapter.setLogger({
    info: (obj, msg) => app.log.info(obj as object, msg),
    warn: (obj, msg) => app.log.warn(obj as object, msg),
    error: (obj, msg) => app.log.error(obj as object, msg),
  });

  const repo = env.DATABASE_URL ? new CandlesRepo(createPool(env.DATABASE_URL)) : null;

  const onCandle = (candle: Candle): void => {
    hub.broadcast(candle);
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
  await adapter.start(subscriptions, onCandle);
  app.log.info(
    { subscriptions: subscriptions.length, persistence: Boolean(repo) },
    'ingesta de mercado iniciada',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
