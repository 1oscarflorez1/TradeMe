import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildApp } from './app.js';
import { attachStream } from './ws.js';
import { buildSubscriptions, loadEnv, parseSymbols } from './config.js';
import { BinanceAdapter } from './adapters/binance-adapter.js';
import { StreamHub } from './stream/hub.js';
import { createPool } from './db/pool.js';
import { CandlesRepo } from './db/candles-repo.js';
import { ExternalSignalsRepo } from './db/external-signals-repo.js';
import { SnapshotsRepo } from './db/snapshots-repo.js';
import { BacktestsRepo } from './db/backtests-repo.js';
import { AlertsRepo } from './db/alerts-repo.js';
import { PushSubsRepo } from './db/push-subs-repo.js';
import { UsersRepo } from './db/users-repo.js';
import { verifyJwt } from './auth/jwt.js';
import { Pusher } from './push/push.js';
import { runMigrations } from './db/migrate.js';
import { INTERVALS, type Candle, type Interval } from './domain/candle.js';
import { IndicatorRegistry } from './indicators/registry.js';
import { CandleBuffer } from './indicators/buffer.js';
import type { Vote } from './indicators/types.js';
import { ExternalSignalStore } from './signals/external-store.js';
import { ExternalMapper } from './signals/external-mapper.js';
import { DEFAULT_ENSEMBLE, loadEnsemble, type EnsembleConfig } from './ensemble/config.js';
import { buildSignal } from './ensemble/signal.js';
import type { Signal } from './domain/signal.js';
import { Calibrators } from './calibration/load.js';
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
  const artifactsDir = dirname(env.ENSEMBLE_CONFIG);
  const ensembleCache = new Map<string, EnsembleConfig>();
  // Config ACTIVA por símbolo+TF: la optimizada de esa temporalidad si existe; si no, la base.
  function getEnsembleFor(symbol: string, interval: string): EnsembleConfig {
    const key = `${symbol.toUpperCase()}:${interval}`;
    const hit = ensembleCache.get(key);
    if (hit) return hit;
    const p = join(artifactsDir, 'optimized', `ensemble.${symbol.toUpperCase()}.${interval}.yaml`);
    const cfg = existsSync(p) ? loadEnsembleSafe(p, (m) => console.warn(m)) : ensemble;
    ensembleCache.set(key, cfg);
    return cfg;
  }
  const calibrators = Calibrators.load(env.CALIBRATORS_PATH);

  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : null;
  const repo = pool ? new CandlesRepo(pool) : null;
  const externalRepo = pool ? new ExternalSignalsRepo(pool) : null;
  const macroStore = new MacroStore();
  const macroEnabled = env.MACRO_ENABLED === 'true';
  const snapshotsRepo = pool ? new SnapshotsRepo(pool) : null;
  const backtestsRepo = pool ? new BacktestsRepo(pool) : null;
  const alertsRepo = pool ? new AlertsRepo(pool) : null;
  const pushSubsRepo = pool ? new PushSubsRepo(pool) : null;
  const usersRepo = pool ? new UsersRepo(pool) : null;
  if (env.JWT_SECRET && !usersRepo) {
    console.warn('JWT_SECRET configurado sin DATABASE_URL: /auth/login no podrá autenticar a nadie.');
  }
  const pusher = new Pusher(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
  const pushCooldown = new Map<string, number>();

  function reloadArtifacts(): {
    ensembleVersion: string;
    calibrationVersion: string | null;
  } {
    const fresh = loadEnsembleSafe(env.ENSEMBLE_CONFIG, (m) => console.warn(m));
    Object.assign(ensemble, fresh);
    ensembleCache.clear();
    calibrators.reload();
    return {
      ensembleVersion: ensemble.version,
      calibrationVersion: calibrators.version,
    };
  }

  function ensembleMeta(
    symbol = 'BTCUSDT',
    interval = '5m',
  ): { version: string; optimized: boolean; report: unknown } {
    const sym = symbol.toUpperCase();
    const optPath = join(artifactsDir, 'optimized', `ensemble.${sym}.${interval}.yaml`);
    const repPath = join(artifactsDir, 'optimized', `report.${sym}.${interval}.json`);
    let report: unknown = null;
    try {
      if (existsSync(repPath)) report = JSON.parse(readFileSync(repPath, 'utf8'));
    } catch {
      report = null;
    }
    const active = getEnsembleFor(sym, interval);
    return { version: active.version, optimized: existsSync(optPath), report };
  }

  const app = buildApp({
    getHistory: (symbol: string, interval: string, limit: number, endTime?: number): Promise<Candle[]> =>
      adapter.getHistory(symbol, interval as Interval, limit, endTime),
    symbols: parseSymbols(env),
    registry,
    externalStore,
    mapper: loadMapper(env.EXTERNAL_SIGNALS_CONFIG, (m) => app.log.warn(m)),
    ensemble,
    calibrators,
    reloadArtifacts,
    ensembleMeta,
    getEnsembleFor,
    equity: env.ACCOUNT_EQUITY,
    getMacro: macroEnabled ? (symbol: string) => macroStore.get(symbol) : undefined,
    recordSnapshot: snapshotsRepo
      ? (signal, interval, levels, note) => snapshotsRepo.record(signal, interval, levels, note)
      : undefined,
    listSnapshots: snapshotsRepo ? (symbol, limit) => snapshotsRepo.list(symbol, limit) : undefined,
    deleteSnapshot: snapshotsRepo ? (id) => snapshotsRepo.delete(id) : undefined,
    createAlert: alertsRepo ? (a) => alertsRepo.create(a) : undefined,
    listAlerts: alertsRepo ? (limit) => alertsRepo.list(limit) : undefined,
    markAlertsRead: alertsRepo ? () => alertsRepo.markAllRead() : undefined,
    quantUrl: env.QUANT_URL,
    pingDb: pool
      ? async () => {
          await pool.query('SELECT 1');
          return true;
        }
      : undefined,
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    savePushSub: pushSubsRepo ? (sub) => pushSubsRepo.save(sub) : undefined,
    getBacktest: backtestsRepo
      ? (symbol, interval) => backtestsRepo.latest(symbol, interval)
      : undefined,
    tvSecret: env.TV_WEBHOOK_SECRET,
    authSecret: env.JWT_SECRET,
    findUserByEmail: usersRepo ? (email) => usersRepo.findByEmail(email) : undefined,
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
        config: getEnsembleFor(symbol, iv),
        equity: env.ACCOUNT_EQUITY,
        interval: iv,
        macro: macroEnabled ? macroStore.get(symbol) : undefined,
        calibrators,
      });
      hub.broadcastSignal(symbol, iv, signal);
      void maybePush(symbol, iv, signal);
    }
  }

  // Regla en el servidor: push en segundo plano ante decisión accionable de alta confianza.
  async function maybePush(symbol: string, iv: Interval, signal: Signal): Promise<void> {
    if (!pushSubsRepo || !alertsRepo) return;
    if (signal.action !== 'BUY' && signal.action !== 'SELL') return;
    if (signal.confidence < env.PUSH_MIN_CONFIDENCE) return;
    const key = `${symbol}:${iv}:${signal.action}`;
    const now = Date.now();
    if (now - (pushCooldown.get(key) ?? 0) < env.PUSH_COOLDOWN_MS) return;
    pushCooldown.set(key, now);
    const accion = signal.action === 'BUY' ? 'COMPRAR' : 'VENDER';
    const title = `Decisión ${accion} · ${symbol} ${iv}`;
    const body = `Confianza ${(signal.confidence * 100).toFixed(0)}% (dirección ${signal.direction}).`;
    await alertsRepo
      .create({ type: 'decision', severity: 'warning', symbol, interval: iv, title, message: body })
      .catch(() => undefined);
    const subs = await pushSubsRepo.list().catch(() => []);
    for (const sub of subs) {
      const ok = await pusher.send(sub, { title, body, url: '/', tag: key });
      if (!ok) await pushSubsRepo.remove(sub.endpoint).catch(() => undefined);
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
    if (!macroEnabled || !ensemble.macro.enabled) return;
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
  attachStream(
    app.server,
    hub,
    env.JWT_SECRET ? (token) => Boolean(token && verifyJwt(token, env.JWT_SECRET!)) : undefined,
  );
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
