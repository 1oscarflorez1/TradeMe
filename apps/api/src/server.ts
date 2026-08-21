import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildApp } from './app.js';
import { attachStream } from './ws.js';
import { buildSubscriptions, loadEnv, parseIntervals, parseSymbols } from './config.js';
import { BinanceProvider } from './providers/binance-provider.js';
import { TwelveDataProvider } from './providers/twelvedata-provider.js';
import { ProviderRegistry } from './providers/registry.js';
import type { AssetClass } from './providers/types.js';
import { StreamHub } from './stream/hub.js';
import { createPool } from './db/pool.js';
import { CandlesRepo } from './db/candles-repo.js';
import { ExternalSignalsRepo } from './db/external-signals-repo.js';
import { SnapshotsRepo } from './db/snapshots-repo.js';
import { BacktestsRepo } from './db/backtests-repo.js';
import { EvidenceRepo } from './db/evidence-repo.js';
import { AssistantProvider, AssistantQuota } from './assistant/provider.js';
import { SYSTEM_PROMPT, construirContexto } from './assistant/context.js';
import { PKG_VERSION } from './app.js';
import { Releases } from './releases/parse.js';
import { Docs } from './releases/docs.js';
import { TOOLS, TOOL_BUSCAR, resumirPrecios } from './assistant/tools.js';
import { WebSearch } from './assistant/search.js';
import { AlertsRepo } from './db/alerts-repo.js';
import { AccessLogRepo } from './db/access-log-repo.js';
import { WatchlistRepo } from './db/watchlist-repo.js';
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
import {
  DEFAULT_ENSEMBLE,
  effectiveMacro,
  forInterval,
  loadEnsemble,
  type EnsembleConfig,
} from './ensemble/config.js';
import { Independence } from './ensemble/independence.js';
import { QuarantinePolicy } from './ensemble/quarantine.js';
import { buildSignal } from './ensemble/signal.js';
import { computePlanLevels } from './ensemble/plan.js';
import { intervalMs } from './domain/candle.js';
import type { Signal } from './domain/signal.js';
import { Calibrators } from './calibration/load.js';
import { MetaModel } from './metamodel/apply.js';
import { MetaPolicy } from './metamodel/policy.js';
import { MacroStore } from './macro/store.js';
import { Fundamentals } from './ensemble/fundamental.js';
import { FundamentalPolicy } from './ensemble/fundamental-policy.js';
import { computeMacroBias } from './macro/bias.js';
import { fetchFundingRate } from './macro/funding.js';
import { EMA } from 'technicalindicators';

const MIN_CANDLES_FOR_VOTES = 40;
// `npm_package_version` solo existe si el proceso se lanzó con un script de npm; en el contenedor se
// arranca el binario directamente y valía «desconocida», así que el asistente decía no saber en qué
// versión corría. `PKG_VERSION` lee el package.json real y siempre acierta.
const pkgVersion = process.env.npm_package_version ?? PKG_VERSION;

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
  // Registro de proveedores: Binance (cripto, WebSocket) primero; Twelve Data (acciones,
  // forex, índices) se activa solo si hay clave. Añadir otra fuente = otra entrada aquí.
  const providers = new ProviderRegistry([
    new BinanceProvider(),
    new TwelveDataProvider({ apiKey: env.TWELVEDATA_API_KEY }),
  ]);
  const registry = new IndicatorRegistry();
  const buffer = new CandleBuffer(300);
  const externalStore = new ExternalSignalStore();
  const ensemble = loadEnsembleSafe(env.ENSEMBLE_CONFIG, (m) => console.warn(m));
  const artifactsDir = dirname(env.ENSEMBLE_CONFIG);
  // Gobierno del Fundamental Score: el piloto decide el modo midiendo el expediente sombra; el de
  // `ensemble.yaml` queda como TOPE. Sin artefacto manda la configuración, que es el estado
  // anterior a que existiera este gobierno.
  const fundamentalPolicy = FundamentalPolicy.load(join(artifactsDir, 'fundamental_policy.json'));
  const ensembleCache = new Map<string, EnsembleConfig>();
  const independence = Independence.load(env.INDEPENDENCE_PATH);
  const quarantine = QuarantinePolicy.load(env.QUARANTINE_PATH);
  // Historial y documentación: una sola fuente para el portal y para el asistente (M10.6).
  const releases = new Releases(env.CHANGELOG_PATH);
  const docs = new Docs(env.DOCS_DIR);
  // Config ACTIVA por símbolo+TF: la optimizada de esa temporalidad si existe; si no, la base.
  function getEnsembleFor(symbol: string, interval: string): EnsembleConfig {
    const key = `${symbol.toUpperCase()}:${interval}`;
    const hit = ensembleCache.get(key);
    if (hit) return hit;
    const p = join(artifactsDir, 'optimized', `ensemble.${symbol.toUpperCase()}.${interval}.yaml`);
    const base = existsSync(p) ? loadEnsembleSafe(p, (m) => console.warn(m)) : ensemble;
    // Se especializa aquí, una sola vez por símbolo+TF: validez del plan, cuarentena y factor de
    // independencia quedan resueltos y ningún punto de llamada tiene que acordarse de aplicarlos.
    const vetada = quarantine.isQuarantined(
      symbol,
      interval,
      (base.quarantineIntervals ?? []).includes(interval),
    );
    const cfg = forInterval(
      base,
      interval,
      independence.factorFor(symbol, interval),
      vetada,
    );
    // El gobierno automático solo puede REBAJAR el modo del score respecto al configurado. Si el
    // artefacto falta o viene corrupto, el peor caso es que influya menos de lo previsto.
    cfg.fundamental = {
      ...cfg.fundamental,
      mode: fundamentalPolicy.effectiveMode(cfg.fundamental.mode),
    };
    ensembleCache.set(key, cfg);
    return cfg;
  }
  const calibrators = Calibrators.load(env.CALIBRATORS_PATH);
  // Distribución de referencia del funding por símbolo (M12). Se carga bajo demanda: un símbolo
  // sin artefacto no es un error, es un score sin datos todavía, y se declara `stale`.
  const fundamentals = Fundamentals.load(join(artifactsDir, 'fundamental'));
  const metaModel = MetaModel.load(env.METAMODEL_PATH);
  const metaPolicy = MetaPolicy.load(env.META_POLICY_PATH, env.META_MODE);
  // Captura automática server-side: registra decisiones operables aunque nadie tenga el portal
  // abierto. Es lo que mantiene vivo el dataset del meta-modelo.
  const captureIntervals = new Set(env.AUTO_CAPTURE_INTERVALS.split(',').map((x) => x.trim()));
  const lastCapture = new Map<string, number>();

  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : null;
  const repo = pool ? new CandlesRepo(pool) : null;
  const externalRepo = pool ? new ExternalSignalsRepo(pool) : null;
  const macroStore = new MacroStore();
  const macroEnabled = env.MACRO_ENABLED === 'true';
  const snapshotsRepo = pool ? new SnapshotsRepo(pool) : null;
  const backtestsRepo = pool ? new BacktestsRepo(pool) : null;
  const evidenceRepo = pool ? new EvidenceRepo(pool) : null;
  const asistente = new AssistantProvider({
    baseUrl: env.ASSISTANT_BASE_URL,
    apiKey: env.ASSISTANT_API_KEY,
    model: env.ASSISTANT_MODEL,
    maxTokens: env.ASSISTANT_MAX_TOKENS,
    timeoutMs: env.ASSISTANT_TIMEOUT_MS,
  });
  const cupoAsistente = new AssistantQuota();
  const buscador = new WebSearch({
    provider: env.ASSISTANT_SEARCH,
    apiKey: env.ASSISTANT_SEARCH_KEY,
    maxResultados: 5,
    timeoutMs: 10_000,
  });
  const alertsRepo = pool ? new AlertsRepo(pool) : null;
  const accessLogRepo = pool ? new AccessLogRepo(pool) : null;
  const watchlistRepo = pool ? new WatchlistRepo(pool) : null;
  // Lista viva de activos: arranca con la de entorno y se sustituye por la de la base de datos.
  const activeSymbols: string[] = parseSymbols(env);
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
    metaModel.reload();
    metaPolicy.reload();
    independence.reload();
    quarantine.reload();
    fundamentals.reload();
    fundamentalPolicy.reload();
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
      providers.getHistory(symbol, interval as Interval, limit, endTime),
    symbols: activeSymbols,
    registry,
    externalStore,
    mapper: loadMapper(env.EXTERNAL_SIGNALS_CONFIG, (m) => app.log.warn(m)),
    ensemble,
    calibrators,
    metaModel,
    metaMode: metaPolicy.mode,
    metaPolicyReason: () => metaPolicy.reason,
    captureInfo: () => ({
      enabled: env.AUTO_CAPTURE === 'true',
      intervals: env.AUTO_CAPTURE_INTERVALS,
      minConfidence: env.AUTO_CAPTURE_MIN_CONFIDENCE,
      cooldownMin: env.AUTO_CAPTURE_COOLDOWN_MIN,
    }),
    releases,
    docs,
    metaVetoThreshold: env.META_VETO_THRESHOLD,
    metaModulateWeight: env.META_MODULATE_WEIGHT,
    reloadArtifacts,
    ensembleMeta,
    getEnsembleFor,
    equity: env.ACCOUNT_EQUITY,
    getMacro: macroEnabled ? (symbol: string) => macroStore.get(symbol) : undefined,
    getFundamental: (symbol: string) => fundamentals.get(symbol),
    getFunding: (symbol: string) => fundingStore.get(symbol),
    recordSnapshot: snapshotsRepo
      ? (signal, interval, levels, note) => snapshotsRepo.record(signal, interval, levels, note)
      : undefined,
    listSnapshots: snapshotsRepo ? (symbol, limit) => snapshotsRepo.list(symbol, limit) : undefined,
    snapshotStats: snapshotsRepo ? (symbol: string) => snapshotsRepo.stats(symbol) : undefined,
    deleteSnapshot: snapshotsRepo ? (id) => snapshotsRepo.delete(id) : undefined,
    createAlert: alertsRepo ? (a) => alertsRepo.create(a) : undefined,
    listAlerts: alertsRepo ? (limit) => alertsRepo.list(limit) : undefined,
    markAlertsRead: alertsRepo ? () => alertsRepo.markAllRead() : undefined,
    quantUrl: env.QUANT_URL,
    publicApiUrl: env.PUBLIC_API_URL,
    listAssets: watchlistRepo
      ? async () =>
          (await watchlistRepo.list()).map((a) => ({
            symbol: a.symbol,
            label: a.label,
            enabled: a.enabled,
            provider: a.provider,
            assetClass: a.asset_class,
            tvSymbol: a.tv_symbol,
          }))
      : undefined,
    listProviders: () => providers.info(),
    searchAssets: (q: string, assetClass?: string) =>
      providers.search(q, 25, assetClass as AssetClass | undefined),
    addAsset: watchlistRepo
      ? async (symbol: string, provider?: string) => {
          const found = await providers.exists(symbol, provider).catch(() => null);
          if (!found) {
            return {
              ok: false,
              error: 'ningún proveedor configurado ofrece velas de ese símbolo',
            };
          }
          await watchlistRepo.add(
            found.symbol,
            found.label,
            found.provider,
            found.assetClass,
            found.tvSymbol ?? null,
          );
          await applyWatchlist();
          return { ok: true, label: found.label, provider: found.provider };
        }
      : undefined,
    removeAsset: watchlistRepo
      ? async (symbol: string) => {
          const ok = await watchlistRepo.remove(symbol);
          if (ok) await applyWatchlist();
          return ok;
        }
      : undefined,
    toggleAsset: watchlistRepo
      ? async (symbol: string, enabled: boolean) => {
          const ok = await watchlistRepo.setEnabled(symbol, enabled);
          if (ok) await applyWatchlist();
          return ok;
        }
      : undefined,
    logAccess: accessLogRepo
      ? (event, email, ip, detail) =>
          accessLogRepo.record(event, email, ip, detail).catch(() => undefined)
      : undefined,
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
    assistantInfo: () => ({
      ...asistente.describe(),
      busqueda: buscador.describe(),
      modelo: asistente.modelHealth(),
    }),
    askAssistant: asistente.enabled
      ? async (pregunta, historial, symbol, interval, usuario) => {
          const cupo = cupoAsistente.intentar(usuario);
          if (!cupo.ok) throw new Error(cupo.motivo ?? 'cupo agotado');
          const iv = (parseIntervals(env).includes(interval as Interval)
            ? interval
            : '15m') as Interval;
          // El contexto se arma en el servidor: el modelo solo puede citar lo que le damos.
          const ventana = buffer.get(symbol, iv);
          const signal =
            ventana.length >= MIN_CANDLES_FOR_VOTES
              ? buildSignal({
                  symbol,
                  price: ventana[ventana.length - 1]!.close,
                  votes: [...registry.computeVotes(ventana), ...externalStore.active(symbol)],
                  config: getEnsembleFor(symbol, iv),
                  equity: env.ACCOUNT_EQUITY,
                  interval: iv,
                  macro: macroEnabled ? macroStore.get(symbol) : undefined,
                  fundamentalArtifact: fundamentals.get(symbol),
                  funding: fundingStore.get(symbol),
                  calibrators,
                  metaModel,
                  metaMode: metaPolicy.mode,
                  metaVetoThreshold: env.META_VETO_THRESHOLD,
                  metaModulateWeight: env.META_MODULATE_WEIGHT,
                })
              : null;
          const [stats, evidencia] = await Promise.all([
            snapshotsRepo?.stats(symbol).catch(() => null) ?? null,
            evidenceRepo?.porIndicador(symbol, iv).catch(() => []) ?? [],
          ]);
          const cfg = getEnsembleFor(symbol, iv);
          const contexto = construirContexto({
            symbol,
            interval: iv,
            signal,
            stats,
            sustento: {
              optimizado: ensembleMeta(symbol, iv).optimized,
              version: cfg.version,
              holdBand: cfg.holdBand,
              pesos: cfg.weights,
              evidencia,
            },
            version: pkgVersion,
            liveTrading: env.ENABLE_LIVE_TRADING === 'true',
            novedades: releases.resumen(3),
          });
          /** Ejecuta lo que el modelo pida. Todo es de solo lectura y con salidas acotadas. */
          const ejecutar = async (
            nombre: string,
            args: Record<string, unknown>,
          ): Promise<unknown> => {
            const pedido = String(args.interval ?? '');
            const ivArg = (parseIntervals(env).includes(pedido as Interval)
              ? pedido
              : iv) as Interval;

            switch (nombre) {
              case 'decision_de_temporalidad': {
                const w = buffer.get(symbol, ivArg);
                if (w.length < MIN_CANDLES_FOR_VOTES) {
                  return { error: `todavía no hay velas suficientes de ${ivArg}` };
                }
                const sg = buildSignal({
                  symbol,
                  price: w[w.length - 1]!.close,
                  votes: [...registry.computeVotes(w), ...externalStore.active(symbol)],
                  config: getEnsembleFor(symbol, ivArg),
                  equity: env.ACCOUNT_EQUITY,
                  interval: ivArg,
                  macro: macroEnabled ? macroStore.get(symbol) : undefined,
                  fundamentalArtifact: fundamentals.get(symbol),
                  funding: fundingStore.get(symbol),
                  calibrators,
                  metaModel,
                  metaMode: metaPolicy.mode,
                  metaVetoThreshold: env.META_VETO_THRESHOLD,
                  metaModulateWeight: env.META_MODULATE_WEIGHT,
                });
                return {
                  interval: ivArg,
                  accion: sg.action,
                  direccion: sg.direction,
                  confianza: sg.confidence,
                  net: sg.net,
                  regimen: sg.regime.label,
                  adx: sg.regime.adx,
                  precio: sg.price,
                  votos: sg.votes.map((v) => ({ indicador: v.label, voto: v.value })),
                };
              }
              case 'resumen_registros': {
                const st = await snapshotsRepo?.stats(symbol);
                if (!st) return { error: 'sin persistencia disponible' };
                if (args.interval) {
                  return st.porTf.find((t) => t.interval === ivArg) ?? { error: `sin registros de ${ivArg}` };
                }
                return st;
              }
              case 'historial_backtests': {
                const h = await backtestsRepo?.history(symbol, ivArg, 20);
                return h && h.length > 0 ? { interval: ivArg, corridas: h } : { error: `sin backtests de ${ivArg}` };
              }
              case 'evidencia_indicadores': {
                const e = await evidenceRepo?.porIndicador(symbol, ivArg);
                return e ?? { error: 'sin persistencia disponible' };
              }
              case 'resumen_de_precios': {
                const n = Math.max(10, Math.min(300, Number(args.velas ?? 100)));
                const w = buffer.get(symbol, ivArg).slice(-n);
                return {
                  interval: ivArg,
                  ...resumirPrecios(
                    w.map((c) => c.close),
                    w.map((c) => c.high),
                    w.map((c) => c.low),
                  ),
                };
              }
              case 'buscar_en_internet': {
                const q = String(args.consulta ?? '').trim();
                if (!q) return { error: 'consulta vacía' };
                try {
                  const hits = await buscador.buscar(q);
                  return hits.length > 0 ? { consulta: q, resultados: hits } : { consulta: q, resultados: [], nota: 'sin resultados' };
                } catch (err) {
                  return { error: String(err instanceof Error ? err.message : err) };
                }
              }
              case 'estado_del_sistema':
                return { proveedores: providers.info(), metaModo: metaPolicy.mode, motivo: metaPolicy.reason };
              case 'uso_por_temporalidad': {
                const st = await snapshotsRepo?.stats(symbol).catch(() => null);
                const porTf = new Map((st?.porTf ?? []).map((t) => [t.interval, t.total]));
                return parseIntervals(env).map((x: Interval) => ({
                  interval: x,
                  captura: env.AUTO_CAPTURE === 'true' && captureIntervals.has(x),
                  optimizado: ensembleMeta(symbol, x).optimized,
                  registros: porTf.get(x) ?? 0,
                }));
              }
              // ---- M10.6: el asistente puede consultar la historia y la documentación ----
              case 'cambios_de_version': {
                const v = typeof args.version === 'string' ? args.version : '';
                if (v) {
                  const r = releases.find(v);
                  return r ?? { error: `no hay ninguna versión ${v} en el registro de cambios` };
                }
                return { actual: PKG_VERSION, ultimas: releases.all().slice(0, 3) };
              }
              case 'consultar_documentacion': {
                const tema = typeof args.tema === 'string' ? args.tema.trim() : '';
                if (!tema) return { documentos: docs.list() };
                // Primero como identificador («calibracion»), y si no, como búsqueda.
                const directo = docs.read(tema);
                if (directo) return directo;
                const hallazgos = docs.search(tema);
                return hallazgos.length > 0
                  ? { termino: tema, hallazgos }
                  : { termino: tema, hallazgos: [], documentos: docs.list() };
              }
              default:
                return { error: `herramienta desconocida: ${nombre}` };
            }
          };

          return asistente.askWithTools(
            [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'system', content: contexto },
              ...historial,
              { role: 'user', content: pregunta },
            ],
            // La herramienta de búsqueda solo se ofrece si hay proveedor: prometerle al modelo
            // una capacidad que no funciona lo lleva a inventarse las fuentes.
            buscador.enabled ? [...TOOLS, TOOL_BUSCAR] : TOOLS,
            ejecutar,
          );
        }
      : undefined,
    getEvidencia: evidenceRepo
      ? (symbol: string, interval: string) => evidenceRepo.porIndicador(symbol, interval)
      : undefined,
    getBacktestHistory: backtestsRepo
      ? (symbol: string, interval: string, limit: number) =>
          backtestsRepo.history(symbol, interval, limit)
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

  /** Aplica la lista de activos: siembra histórico de los nuevos y resuscribe el stream. */
  async function applyWatchlist(): Promise<void> {
    if (!watchlistRepo) return;
    const entradas = await watchlistRepo.enabled();
    const symbols = entradas.map((e) => e.symbol);
    if (symbols.length === 0) return; // nunca dejamos el motor sin activos
    // El registro necesita saber de qué proveedor sale cada símbolo antes de repartir suscripciones.
    for (const e of entradas) providers.setRoute(e.symbol, e.provider);
    const nuevos = symbols.filter((s) => !activeSymbols.includes(s));
    activeSymbols.splice(0, activeSymbols.length, ...symbols);
    const intervals = parseIntervals(env);
    for (const symbol of nuevos) {
      for (const interval of intervals) {
        try {
          const history = await providers.getHistory(symbol, interval, 300);
          buffer.seed(symbol, interval, history);
        } catch (err) {
          app.log.warn({ err: String(err), symbol, interval }, 'sin histórico inicial del activo');
        }
      }
      void refreshMacro(symbol);
    }
    providers.resubscribe(
      symbols.flatMap((symbol) =>
        intervals.map((interval: Interval) => ({ symbol, interval })),
      ),
    );
    app.log.info({ activos: symbols.length, nuevos: nuevos.length }, 'lista de activos aplicada');
  }

  providers.setLogger({
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
        fundamentalArtifact: fundamentals.get(symbol),
        funding: fundingStore.get(symbol),
        calibrators,
        metaModel,
        metaMode: metaPolicy.mode,
        metaVetoThreshold: env.META_VETO_THRESHOLD,
        metaModulateWeight: env.META_MODULATE_WEIGHT,
      });
      hub.broadcastSignal(symbol, iv, signal);
      void maybePush(symbol, iv, signal);
      void maybeCapture(symbol, iv, signal);
    }
  }

  /**
   * ¿Merece registrarse esta decisión de MANTENER?
   *
   * Guardar los 1 440 «no operar» diarios de 1m ahogaría el dataset en indecisión sin información.
   * Lo que sí informa son dos casos: los MANTENER **provocados por un filtro** (cuarentena, conflicto
   * macro, veto del meta-modelo), que son decisiones que el sistema iba a tomar y algo detuvo, y los
   * que se quedaron **a las puertas** del umbral. Esos son los negativos que el meta-modelo necesita
   * para dejar de aprender solo de la mitad operable del mundo.
   */
  function holdValeLaPena(signal: Signal): boolean {
    if (signal.hold_reason && signal.hold_reason !== 'banda_neutra') return true;
    const direccional = Math.max(signal.probs.BUY, signal.probs.SELL);
    return direccional >= env.AUTO_CAPTURE_MIN_CONFIDENCE - env.AUTO_CAPTURE_HOLD_MARGIN;
  }

  /** Guarda un snapshot de la decisión: operable con confianza suficiente, o NO TRADE informativo. */
  async function maybeCapture(symbol: string, iv: Interval, signal: Signal): Promise<void> {
    if (env.AUTO_CAPTURE !== 'true' || !snapshotsRepo) return;
    if (!captureIntervals.has(iv)) return;
    if (signal.action === 'HOLD') {
      if (!holdValeLaPena(signal)) return;
    } else if (signal.confidence < env.AUTO_CAPTURE_MIN_CONFIDENCE) {
      return;
    }
    // Una captura POR VELA, no cada N minutos.
    //
    // El enfriamiento fijo de 20 minutos era el mismo para todas las temporalidades: en 4h producía
    // hasta 12 registros de la misma vela y en 1d hasta 72. Esos duplicados se contaban como
    // observaciones independientes y sesgaban tanto las estadísticas como el dataset del meta-modelo.
    // Anclar la captura a la vela alinea además el registro con el backtest, que decide una vez por
    // vela y no una vez por reloj.
    const key = `${symbol}:${iv}`;
    const now = Date.now();
    const velaActual = Math.floor(now / intervalMs(iv)) * intervalMs(iv);
    if ((lastCapture.get(key) ?? -1) === velaActual) return;
    lastCapture.set(key, velaActual);
    const risk = getEnsembleFor(symbol, iv).risk;
    const levels = computePlanLevels(
      signal.action,
      signal.price,
      signal.atr,
      risk,
      env.ACCOUNT_EQUITY,
    );
    // Plan sombra: el que se habría emitido si la temporalidad no estuviera en cuarentena. Se
    // calcula con exactamente el mismo riesgo y los mismos niveles que uno real, porque su razón
    // de ser es responder «¿qué habría pasado?» de forma comparable.
    const shadowLevels = signal.shadow_action
      ? computePlanLevels(
          signal.shadow_action,
          signal.price,
          signal.atr,
          risk,
          env.ACCOUNT_EQUITY,
        )
      : null;
    await snapshotsRepo
      .record(signal, iv, levels, 'auto-servidor', shadowLevels)
      .catch((err: unknown) => app.log.warn({ err: String(err) }, 'no se pudo capturar el snapshot'));
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

  /**
   * Funding por símbolo, **independiente del sesgo macro**.
   *
   * En 0.38.0 el funding solo se pedía dentro de `refreshMacro`, que sale antes de nada si
   * `MACRO_ENABLED` no está a true. Como en producción está apagado, el Fundamental Score llevaba
   * desde el despliegue evaluando un cero por defecto en vez del funding real: penalización siempre
   * 0, ninguna decisión sombra registrada y, por tanto, **ninguna posibilidad de promocionar
   * jamás** — el mismo fallo de diseño que tuvo la cuarentena en M10.5.
   *
   * El score existe precisamente porque el funding no deriva del precio. Que dependiera del
   * interruptor del macro era acoplar dos cosas que el hito separaba a propósito.
   */
  const fundingStore = new Map<string, number>();

  async function refreshFunding(symbol: string): Promise<void> {
    // Solo los perpetuos de Binance tienen funding. Pedírselo a una acción de Twelve Data sería
    // una petición condenada a fallar cada hora.
    if (providers.routeOf(symbol) !== 'binance') return;
    try {
      fundingStore.set(symbol, await fetchFundingRate(symbol));
    } catch (err) {
      // No se borra el valor anterior: un fallo puntual de Binance no convierte el funding en
      // desconocido. Si nunca llegó a haberlo, el score sigue `stale`, que es lo correcto.
      app.log.warn({ err: String(err), symbol }, 'no se pudo refrescar el funding');
    }
  }

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
      const funding = fundingStore.get(symbol);
      if (funding === undefined) return;
      // `effectiveMacro` retira el funding de aquí SOLO cuando el Fundamental Score está
      // promocionado: mientras siga en sombra el sesgo se calcula exactamente igual que antes.
      macroStore.put(symbol, computeMacroBias({ funding, price, weeklyEma }, effectiveMacro(ensemble)));
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
      const history = await providers.getHistory(sub.symbol, sub.interval, 300);
      buffer.seed(sub.symbol, sub.interval, history);
    } catch (err) {
      app.log.warn({ err: String(err), sub }, 'no se pudo sembrar histórico inicial');
    }
  }

  await providers.start(subscriptions, onCandle);

  // La lista definitiva de activos vive en la base de datos (con la de entorno como respaldo).
  await applyWatchlist().catch((err: unknown) =>
    app.log.warn({ err: String(err) }, 'no se pudo aplicar la lista de activos'),
  );
  // Comprobación del modelo al arrancar: si el proveedor lo ha retirado, que se sepa aquí y no
  // dentro de tres días, cuando alguien pregunte algo y reciba la respuesta de la base local.
  void asistente.checkModel().then((h) => {
    if (h.status === 'ok') return;
    app.log.warn({ estado: h.status, detalle: h.detail }, 'el modelo del asistente no está listo');
  });

  for (const symbol of activeSymbols) {
    await refreshFunding(symbol);
    await refreshMacro(symbol);
  }
  setInterval(() => {
    for (const symbol of activeSymbols) {
      void refreshFunding(symbol).then(() => refreshMacro(symbol));
    }
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
