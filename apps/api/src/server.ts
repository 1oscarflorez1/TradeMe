import { buildApp } from './app.js';
import { attachStream } from './ws.js';
import { buildSubscriptions, loadEnv, parseSymbols } from './config.js';
import { BinanceAdapter } from './adapters/binance-adapter.js';
import { StreamHub } from './stream/hub.js';
import { createPool } from './db/pool.js';
import { CandlesRepo } from './db/candles-repo.js';
import { ExternalSignalsRepo } from './db/external-signals-repo.js';
import { SnapshotsRepo } from './db/snapshots-repo.js';
import { runMigrations } from './db/migrate.js';
import { INTERVALS, type Candle, type Interval } from './domain/candle.js';
import { IndicatorRegistry } from './indicators/registry.js';
import { CandleBuffer } from './indicators/buffer.js';
import type { Vote } from './indicators/types.js';
import { ExternalSignalStore } from './signals/external-store.js';
import { ExternalMapper } from './signals/external-mapper.js';
import { DEFAULT_ENSEMBLE, loadEnsemble, type EnsembleConfig } from './ensemble/config.js';
import { buildSignal } from './ensemble/signal.js';
import { MacroStore } from './macro/store.js';
import { computeMacroBias } from './macro/bias.js';
import { fetchFundingRate } from './macro/funding.js';
import { EMA } from 'technicalindicators';

const MIN_CANDLES_FOR_VOTES = 40;

function loadMapper(path: string, warn: (msg: string) => void): ExternalMapper {
  try {
    return ExternalMapper.fromFile(path);
  } catch (err) {
    warn(`no se pudo cargar ${path} (${String(err)}); señales externas sin mapeo`);
    return new ExternalMapper({});
  }
}

function loadEnsembleSafe(path: string, warn: (msg: string) => void): EnsembleConfig {
  try {
    return loadEnsemble(path);
  } catch (err) {
    warn(`no se pudo cargar ${path} (${String(err)}); usando ensemble por defecto`);
    return DEFAULT_ENSEMBLE;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const hub = new StreamHub();
  const adapter = new BinanceAdapter();
  const registry = new IndicatorRegistry();
  const buffer = new CandleBuffer(300);
  const externalStore = new ExternalSignalStore();
  const ensemble = loadEnsembleSafe(env.ENSEMBLE_CONFIG, (m) => console.warn(m));

  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : null;
  const repo = pool ? new CandlesRepo(pool) : null;
  const externalRepo = pool ? new ExternalSignalsRepo(pool) : null;
  const macroStore = new MacroStore();
  const snapshotsRepo = pool ? new SnapshotsRepo(pool) : null;

  const app = buildApp({
    getHistory: (symbol: string, interval: string, limit: number): Promise<Candle[]> =>
      adapter.getHistory(symbol, interval as Interval, limit),
    symbols: parseSymbols(env),
    registry,
    externalStore,
    mapper: loadMapper(env.EXTERNAL_SIGNALS_CONFIG, (m) => app.log.warn(m)),
    ensemble,
    equity: env.ACCOUNT_EQUITY,
    getMacro: (symbol: string) => macroStore.get(symbol),
    recordSnapshot: snapshotsRepo
      ? (signal, interval, levels, note) => snapshotsRepo.record(signal, interval, levels, note)
      : undefined,
    listSnapshots: snapshotsRepo ? (symbol, limit) => snapshotsRepo.list(symbol, limit) : undefined,
    tvSecret: env.TV_WEBHOOK_SECRET,
    onExternalVote: (symbol: string) => broadcast(symbol),
    recordExternal: externalRepo
      ? (rec) =>
          void externalRepo
            .record(rec)
            .catch((err: unknown) =>
              app.log.error({ err: String(err) }, 'fallo al registrar alerta externa'),
            )
      : undefined,
  });

  adapter.setLogger({
    info: (obj, msg) => app.log.info(obj as object, msg),
    warn: (obj, msg) => app.log.warn(obj as object, msg),
    error: (obj, msg) => app.log.error(obj as object, msg),
  });

  function broadcast(symbol: string, interval?: Interval): void {
    const intervals = interval ? [interval] : [...INTERVALS];
    for (const iv of intervals) {
      const window = buffer.get(symbol, iv);
      if (window.length < MIN_CANDLES_FOR_VOTES) continue;
      const votes: Vote[] = [...registry.computeVotes(window), ...externalStore.active(symbol)];
      hub.broadcastVotes(symbol, iv, votes);
      const price = window[window.length - 1]!.close;
      const signal = buildSignal({
        symbol,
        price,
        votes,
        config: ensemble,
        equity: env.ACCOUNT_EQUITY,
        interval: iv,
        macro: macroStore.get(symbol),
      });
      hub.broadcastSignal(symbol, iv, signal);
    }
  }

  const onCandle = (candle: Candle): void => {
    buffer.push(candle);
    hub.broadcast(candle);
    broadcast(candle.symbol, candle.interval);
    if (repo && candle.closed) {
      repo
        .upsert(candle)
        .catch((err: unknown) => app.log.error({ err: String(err) }, 'fallo al persistir vela'));
    }
  };

  const MACRO_REFRESH_MS = 60 * 60 * 1000;
  async function refreshMacro(symbol: string): Promise<void> {
    if (!ensemble.macro.enabled) return;
    try {
      const weekly = buffer.get(symbol, '1w');
      if (weekly.length < 20) return;
      const closes = weekly.map((c) => c.close);
      const emaSeries = EMA.calculate({ period: 20, values: closes });
      const weeklyEma = emaSeries[emaSeries.length - 1];
      const price = closes[closes.length - 1];
      if (weeklyEma === undefined || price === undefined) return;
      const funding = await fetchFundingRate(symbol);
      macroStore.put(symbol, computeMacroBias({ funding, price, weeklyEma }, ensemble.macro));
    } catch (err) {
      app.log.warn({ err: String(err), symbol }, 'no se pudo refrescar el sesgo macro');
    }
  }

  await app.ready();
  if (pool) {
    await runMigrations(pool, env.MIGRATIONS_DIR, (m) => app.log.info(m)).catch((err: unknown) =>
      app.log.error({ err: String(err) }, 'fallo al aplicar migraciones'),
    );
  }
  attachStream(app.server, hub);
  await app.listen({ host: env.API_HOST, port: env.API_PORT });

  const subscriptions = buildSubscriptions(env);
  for (const sub of subscriptions) {
    try {
      const history = await adapter.getHistory(sub.symbol, sub.interval, 300);
      buffer.seed(sub.symbol, sub.interval, history);
    } catch (err) {
      app.log.warn({ err: String(err), sub }, 'no se pudo sembrar histórico inicial');
    }
  }

  await adapter.start(subscriptions, onCandle);

  const symbols = parseSymbols(env);
  for (const symbol of symbols) await refreshMacro(symbol);
  setInterval(() => {
    for (const symbol of symbols) void refreshMacro(symbol);
  }, MACRO_REFRESH_MS);
  app.log.info(
    {
      subscriptions: subscriptions.length,
      persistence: Boolean(repo),
      indicators: registry.catalog().length,
      ensemble: ensemble.version,
    },
    'ingesta + indicadores + ensemble iniciados',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
