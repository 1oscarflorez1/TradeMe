import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { loadEnv } from './config.js';
import { INTERVALS, isInterval, type Candle } from './domain/candle.js';
import type { IndicatorRegistry } from './indicators/registry.js';
import type { Vote } from './indicators/types.js';
import type { ExternalSignalStore } from './signals/external-store.js';
import type { ExternalMapper } from './signals/external-mapper.js';
import type { EnsembleConfig } from './ensemble/config.js';
import { buildSignal } from './ensemble/signal.js';
import type { Calibrators } from './calibration/load.js';
import type { MetaModel } from './metamodel/apply.js';
import { computePlanLevels, type PlanLevels } from './ensemble/plan.js';
import { estadoFinal, trackSnapshot, type SnapshotRow } from './snapshots/tracking.js';
import type { AlertRow, AlertInput } from './db/alerts-repo.js';
import type { PushSub } from './push/push.js';
import type { BacktestRow } from './db/backtests-repo.js';
import type { Macro, Signal } from './domain/signal.js';
import type { UserRow } from './db/users-repo.js';
import { verifyPassword } from './auth/password.js';
import { signJwt, verifyJwt } from './auth/jwt.js';
import { LoginRateLimiter } from './auth/rate-limit.js';

export interface AppDeps {
  getHistory: (symbol: string, interval: string, limit: number, endTime?: number) => Promise<Candle[]>;
  symbols: string[];
  registry: IndicatorRegistry;
  externalStore: ExternalSignalStore;
  mapper: ExternalMapper;
  ensemble: EnsembleConfig;
  equity: number;
  calibrators?: Calibrators;
  metaModel?: MetaModel;
  metaMode?: 'off' | 'shadow' | 'modulate' | 'veto';
  metaPolicyReason?: () => string | null;
  // Multi-activo
  listAssets?: () => Promise<
    Array<{
      symbol: string;
      label: string | null;
      enabled: boolean;
      provider: string;
      assetClass: string;
      tvSymbol: string | null;
    }>
  >;
  searchAssets?: (
    q: string,
    assetClass?: string,
  ) => Promise<
    Array<{
      symbol: string;
      base: string;
      quote: string;
      label: string;
      provider: string;
      assetClass: string;
      tvSymbol?: string;
    }>
  >;
  addAsset?: (
    symbol: string,
    provider?: string,
  ) => Promise<{ ok: boolean; error?: string; label?: string; provider?: string }>;
  listProviders?: () => Array<{
    id: string;
    label: string;
    assetClasses: string[];
    mode: 'stream' | 'poll';
    available: boolean;
    unavailableReason?: string;
  }>;
  removeAsset?: (symbol: string) => Promise<boolean>;
  toggleAsset?: (symbol: string, enabled: boolean) => Promise<boolean>;
  captureInfo?: () => {
    enabled: boolean;
    intervals: string;
    minConfidence: number;
    cooldownMin: number;
  };
  metaVetoThreshold?: number;
  metaModulateWeight?: number;
  reloadArtifacts?: () => {
    ensembleVersion: string;
    calibrationVersion: string | null;
  };
  ensembleMeta?: (
    symbol?: string,
    interval?: string,
  ) => { version: string; optimized: boolean; report: unknown };
  getEnsembleFor?: (symbol: string, interval: string) => EnsembleConfig;
  getMacro?: (symbol: string) => Macro | undefined;
  recordSnapshot?: (
    signal: Signal,
    interval: string,
    levels: PlanLevels | null,
    note?: string,
  ) => Promise<string>;
  snapshotStats?: (symbol: string) => Promise<unknown>;
  listSnapshots?: (
    symbol: string,
    limit: number,
  ) => Promise<{ rows: SnapshotRow[]; total: number }>;
  deleteSnapshot?: (id: string) => Promise<boolean>;
  createAlert?: (a: AlertInput) => Promise<AlertRow>;
  listAlerts?: (limit: number) => Promise<{ alerts: AlertRow[]; unread: number }>;
  markAlertsRead?: () => Promise<number>;
  vapidPublicKey?: string;
  savePushSub?: (sub: PushSub) => Promise<void>;
  quantUrl?: string;
  publicApiUrl?: string;
  pingDb?: () => Promise<boolean>;
  logAccess?: (
    event: 'login_ok' | 'login_fail' | 'login_blocked',
    email: string | null,
    ip: string,
    detail?: string,
  ) => Promise<void>;
  getBacktest?: (symbol: string, interval: string) => Promise<BacktestRow | null>;
  getBacktestHistory?: (symbol: string, interval: string, limit: number) => Promise<unknown[]>;
  getEvidencia?: (symbol: string, interval: string) => Promise<unknown[]>;
  tvSecret?: string;
  /** Callback para difundir en vivo una señal externa recién recibida. */
  onExternalVote?: (symbol: string, vote: Vote) => void;
  /** Callback para registrar la alerta externa (persistencia para backtest). */
  recordExternal?: (record: ExternalRecord) => void;
  /** Secreto HMAC para firmar/verificar JWT (Módulo 3). Sin configurar, la API queda abierta
   * (dev/tests) — en producción SIEMPRE debe estar puesto. */
  authSecret?: string;
  findUserByEmail?: (email: string) => Promise<UserRow | null>;
}

/** Alerta externa registrada (para el backtest de M6). */
export interface ExternalRecord {
  symbol: string;
  strategy: string;
  signal?: string;
  tf?: string;
  score: number;
  ts: string;
  payload: unknown;
}

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const CandlesQuery = z.object({
  symbol: z.string().min(1),
  interval: z.string().default('1m'),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
  to: z.coerce.number().int().optional(),
});

const TvHookBody = z.object({
  secret: z.string().optional(),
  strategy: z.string().min(1),
  symbol: z.string().min(1),
  signal: z.string().optional(),
  value: z.number().optional(),
  tf: z.string().optional(),
  price: z.number().optional(),
  ts: z.string().optional(),
});

export function buildApp(deps: AppDeps): FastifyInstance {
  const env = loadEnv();
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  // CORS: el dashboard (otro puerto) necesita cabeceras para hablar con la API.
  const corsOrigin = env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((o) => o.trim()) : true;
  void app.register(cors, { origin: corsOrigin });

  // ---- M10 · Hardening ----
  // Cabeceras de seguridad en toda respuesta (la plataforma está expuesta a internet).
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY'); // no embebible: evita clickjacking
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    return payload;
  });

  // Freno general de peticiones por IP: evita que un cliente sature la API (o barra endpoints).
  const generalLimiter = new LoginRateLimiter({
    maxAttempts: 600, // ~10 req/s sostenidas por IP; muy por encima del uso normal del portal
    windowMs: 60_000,
    blockMs: 30_000,
    maxBlockMs: 5 * 60_000,
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/status') return;
    const v = generalLimiter.fail(`req|${request.ip}`);
    if (!v.allowed) {
      reply.header('Retry-After', String(v.retryAfterSec));
      return reply.status(429).send({ error: 'demasiadas peticiones; baja el ritmo' });
    }
  });

  // Freno a la fuerza bruta en el login.
  const loginLimiter = new LoginRateLimiter();
  const sweep = setInterval(() => {
    loginLimiter.sweep();
    generalLimiter.sweep();
  }, 10 * 60_000);
  sweep.unref?.();
  app.addHook('onClose', async () => clearInterval(sweep));

  // Auth (Módulo 3): si hay `authSecret` configurado, toda ruta exige `Authorization: Bearer
  // <jwt>` salvo la allowlist (salud, webhook de TradingView con su propio secreto, y login).
  // Sin `authSecret` (dev/tests) la API queda abierta, igual que antes de este módulo.
  const PUBLIC_PATHS = new Set(['/health', '/tv-hook', '/auth/login']);
  if (deps.authSecret) {
    const authSecret = deps.authSecret;
    app.addHook('onRequest', async (request, reply) => {
      if (request.method === 'OPTIONS') return;
      const path = request.url.split('?')[0] ?? request.url;
      if (PUBLIC_PATHS.has(path)) return;
      const header = request.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token || !verifyJwt(token, authSecret)) {
        return reply.status(401).send({ error: 'no autenticado' });
      }
    });
  }

  const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

  app.post('/auth/login', async (request, reply) => {
    if (!deps.authSecret || !deps.findUserByEmail) {
      return reply.status(503).send({ error: 'autenticación no configurada' });
    }
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'credenciales inválidas' });

    // Clave del limitador: IP + email. Frena tanto a quien prueba muchas contraseñas de una
    // cuenta como a quien barre cuentas desde la misma dirección.
    const ip = request.ip || 'desconocida';
    const key = `${ip}|${parsed.data.email.toLowerCase()}`;
    const verdict = loginLimiter.check(key);
    if (!verdict.allowed) {
      request.log.warn({ ip, email: parsed.data.email }, 'login bloqueado por demasiados intentos');
      void deps.logAccess?.('login_blocked', parsed.data.email, ip, `bloqueado ${verdict.retryAfterSec}s`);
      reply.header('Retry-After', String(verdict.retryAfterSec));
      return reply.status(429).send({
        error: `Demasiados intentos. Inténtalo de nuevo en ${Math.ceil(verdict.retryAfterSec / 60)} min.`,
      });
    }

    const user = await deps.findUserByEmail(parsed.data.email);
    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      const after = loginLimiter.fail(key);
      request.log.warn(
        { ip, email: parsed.data.email, remaining: after.remaining },
        'intento de acceso fallido',
      );
      void deps.logAccess?.('login_fail', parsed.data.email, ip, `quedan ${after.remaining}`);
      return reply.status(401).send({ error: 'email o contraseña incorrectos' });
    }

    loginLimiter.succeed(key);
    request.log.info({ ip, email: user.email }, 'acceso concedido');
    void deps.logAccess?.('login_ok', user.email, ip);
    const token = signJwt({ sub: user.id, email: user.email }, deps.authSecret);
    return { token, user: { id: user.id, email: user.email } };
  });

  app.get('/auth/me', async (request, reply) => {
    if (!deps.authSecret) return reply.status(503).send({ error: 'autenticación no configurada' });
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const payload = token ? verifyJwt(token, deps.authSecret) : null;
    if (!payload) return reply.status(401).send({ error: 'no autenticado' });
    return { id: payload.sub, email: payload.email };
  });

  // Estado del sistema: comprueba EN VIVO cada pieza y su comunicación (pestaña Estado).
  app.get('/status', async () => {
    const t0 = Date.now();
    const components: Array<{
      key: string;
      label: string;
      status: 'ok' | 'degradado' | 'caido' | 'na';
      detail: string;
      ms?: number;
    }> = [];

    components.push({
      key: 'api',
      label: 'API (motor en vivo)',
      status: 'ok',
      detail: `v${PKG.version} · operaciones reales ${env.ENABLE_LIVE_TRADING === 'true' ? 'HABILITADAS' : 'deshabilitadas'}`,
    });

    // Base de datos
    if (deps.pingDb) {
      const t = Date.now();
      const ok = await deps.pingDb().catch(() => false);
      components.push({
        key: 'db',
        label: 'Base de datos (TimescaleDB)',
        status: ok ? 'ok' : 'caido',
        detail: ok ? 'consultas respondiendo' : 'sin respuesta: registros y backtests no se guardan',
        ms: Date.now() - t,
      });
    } else {
      components.push({
        key: 'db',
        label: 'Base de datos (TimescaleDB)',
        status: 'na',
        detail: 'no configurada (modo sin persistencia)',
      });
    }

    // Datos de mercado (Binance)
    {
      const t = Date.now();
      try {
        const candles = await deps.getHistory(deps.symbols[0] ?? 'BTCUSDT', '1m', 1);
        const ok = candles.length > 0;
        components.push({
          key: 'market',
          label: 'Datos de mercado (Binance)',
          status: ok ? 'ok' : 'degradado',
          detail: ok
            ? `último precio ${candles[candles.length - 1]!.close}`
            : 'respuesta vacía del proveedor',
          ms: Date.now() - t,
        });
      } catch (err) {
        components.push({
          key: 'market',
          label: 'Datos de mercado (Binance)',
          status: 'caido',
          detail: `sin datos: ${String(err).slice(0, 80)}`,
          ms: Date.now() - t,
        });
      }
    }

    // Servicio quant (backtest/optimización/ML) + piloto
    if (deps.quantUrl) {
      const t = Date.now();
      try {
        const res = await fetch(`${deps.quantUrl}/health`);
        const ok = res.ok;
        let autoDetail = '';
        if (ok) {
          try {
            const a = (await (await fetch(`${deps.quantUrl}/automation`)).json()) as {
              enabled?: boolean;
              last_cycle?: string | null;
            };
            autoDetail = a.enabled
              ? ` · piloto activo${a.last_cycle ? ` (último ciclo ${a.last_cycle})` : ''}`
              : ' · piloto apagado';
          } catch {
            autoDetail = '';
          }
        }
        components.push({
          key: 'quant',
          label: 'Servicio quant (backtest · optimización · ML)',
          status: ok ? 'ok' : 'caido',
          detail: ok ? `respondiendo${autoDetail}` : 'no responde: botones ▶/⚙/🧠 no funcionarán',
          ms: Date.now() - t,
        });
      } catch (err) {
        components.push({
          key: 'quant',
          label: 'Servicio quant (backtest · optimización · ML)',
          status: 'caido',
          detail: `sin conexión: ${String(err).slice(0, 60)}`,
          ms: Date.now() - t,
        });
      }
    } else {
      components.push({
        key: 'quant',
        label: 'Servicio quant',
        status: 'na',
        detail: 'no configurado (QUANT_URL vacío)',
      });
    }

    // Captura automática de decisiones (alimenta el dataset del meta-modelo)
    components.push({
      key: 'capture',
      label: 'Captura automática de registros',
      status: deps.captureInfo?.().enabled ? 'ok' : 'na',
      detail: deps.captureInfo?.().enabled
        ? `activa · ${deps.captureInfo!().intervals} · confianza ≥ ${Math.round(deps.captureInfo!().minConfidence * 100)}% · 1 cada ${deps.captureInfo!().cooldownMin} min`
        : 'desactivada (solo se registran los snapshots manuales del portal)',
    });

    // Meta-modelo (Módulo 2)
    components.push({
      key: 'meta',
      label: 'Meta-modelo (filtro ML)',
      status: deps.metaModel?.ready ? 'ok' : 'na',
      detail: deps.metaModel?.ready
        ? `modo ${deps.metaMode ?? 'shadow'}${deps.metaPolicyReason?.() ? ` · ${deps.metaPolicyReason()}` : ''}`
        : 'aún sin modelo publicado (necesita más registros evaluados)',
    });

    // Notificaciones push
    components.push({
      key: 'push',
      label: 'Notificaciones push',
      status: env.VAPID_PUBLIC_KEY ? 'ok' : 'na',
      detail: env.VAPID_PUBLIC_KEY
        ? 'claves VAPID configuradas'
        : 'sin claves VAPID (solo avisos en la app)',
    });

    // Señales externas (Reditum/TradingView)
    components.push({
      key: 'webhook',
      label: 'Webhook Reditum (TradingView)',
      status: deps.tvSecret ? 'ok' : 'na',
      detail: deps.tvSecret
        ? `listo para recibir alertas en ${deps.publicApiUrl ?? 'http://localhost:3001'}/tv-hook`
        : 'sin secreto configurado: define TV_WEBHOOK_SECRET para aceptar alertas de TradingView',
    });

    const worst = components.some((c) => c.status === 'caido')
      ? 'caido'
      : components.some((c) => c.status === 'degradado')
        ? 'degradado'
        : 'ok';
    return {
      overall: worst,
      checked_at: new Date().toISOString(),
      took_ms: Date.now() - t0,
      version: PKG.version,
      components,
    };
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'trademe-api',
    version: PKG.version,
    liveTrading: env.ENABLE_LIVE_TRADING === 'true',
    authRequired: Boolean(deps.authSecret),
    ts: new Date().toISOString(),
  }));

  // ---- Multi-activo: catálogo, búsqueda y gestión de la lista seguida ----
  app.get('/assets', async (_request, reply) => {
    if (!deps.listAssets) return reply.status(503).send({ error: 'persistencia no disponible' });
    return { assets: await deps.listAssets() };
  });

  app.get('/assets/providers', async (_request, reply) => {
    if (!deps.listProviders) return reply.status(503).send({ error: 'registro no disponible' });
    return { providers: deps.listProviders() };
  });

  app.get('/assets/search', async (request, reply) => {
    if (!deps.searchAssets) return reply.status(503).send({ error: 'catálogo no disponible' });
    const q = z
      .object({ q: z.string().default(''), assetClass: z.string().optional() })
      .parse(request.query);
    try {
      return { results: await deps.searchAssets(q.q, q.assetClass) };
    } catch (err) {
      request.log.warn({ err: String(err) }, 'fallo al buscar activos');
      return reply.status(502).send({ error: 'no se pudo consultar el catálogo' });
    }
  });

  app.post('/assets', async (request, reply) => {
    if (!deps.addAsset) return reply.status(503).send({ error: 'persistencia no disponible' });
    const body = z
      .object({ symbol: z.string().min(2).max(40), provider: z.string().max(30).optional() })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'símbolo inválido' });
    const out = await deps.addAsset(body.data.symbol.toUpperCase(), body.data.provider);
    if (!out.ok) return reply.status(400).send({ error: out.error ?? 'no se pudo añadir' });
    return {
      added: true,
      symbol: body.data.symbol.toUpperCase(),
      label: out.label,
      provider: out.provider,
    };
  });

  app.delete('/assets/:symbol', async (request, reply) => {
    if (!deps.removeAsset) return reply.status(503).send({ error: 'persistencia no disponible' });
    const { symbol } = request.params as { symbol: string };
    const ok = await deps.removeAsset(symbol);
    if (!ok) return reply.status(404).send({ error: 'activo no encontrado' });
    return { removed: true, symbol: symbol.toUpperCase() };
  });

  app.post('/assets/:symbol/toggle', async (request, reply) => {
    if (!deps.toggleAsset) return reply.status(503).send({ error: 'persistencia no disponible' });
    const { symbol } = request.params as { symbol: string };
    const body = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'parámetro inválido' });
    const ok = await deps.toggleAsset(symbol, body.data.enabled);
    if (!ok) return reply.status(404).send({ error: 'activo no encontrado' });
    return { ok: true, symbol: symbol.toUpperCase(), enabled: body.data.enabled };
  });

  app.get('/symbols', async () => ({ symbols: deps.symbols, intervals: INTERVALS }));

  /**
   * En qué procesos participa cada temporalidad. Sirve para que la barra superior deje de ser una
   * lista muda: cada temporalidad muestra si el motor la captura sola, si tiene configuración
   * optimizada propia, si hay backtest guardado y cuántos registros ha acumulado.
   */
  /**
   * Sustento de la decisión: qué pesa cada indicador, cuánto aporta ahora mismo y qué evidencia
   * histórica respalda ese peso. Es lo que convierte «EMA pesa 1.0» en «EMA pesa 1.0 y cuando
   * acompaña se acierta un 12 % más, sobre 84 operaciones».
   */
  app.get('/decision/sustento', async (request, reply) => {
    const q = z
      .object({
        symbol: z.string().default(deps.symbols[0] ?? 'BTCUSDT'),
        interval: z.string().default('30m'),
      })
      .parse(request.query);
    const sym = q.symbol.toUpperCase();
    if (!isInterval(q.interval)) return reply.status(400).send({ error: 'temporalidad inválida' });

    const cfg = deps.getEnsembleFor ? deps.getEnsembleFor(sym, q.interval) : deps.ensemble;
    const meta = deps.ensembleMeta?.(sym, q.interval);
    const evidencia = deps.getEvidencia
      ? await deps.getEvidencia(sym, q.interval).catch(() => [])
      : [];
    return {
      symbol: sym,
      interval: q.interval,
      version: cfg.version,
      optimizado: meta?.optimized ?? false,
      pesos: cfg.weights,
      pesosExternos: cfg.externalWeights,
      regimen: cfg.regime,
      temperature: cfg.temperature,
      holdBand: cfg.holdBand,
      riesgo: cfg.risk,
      evidencia,
    };
  });

  /** Evolución de los backtests de una temporalidad: ¿el sistema mejora o se degrada? */
  app.get('/backtest/history', async (request, reply) => {
    if (!deps.getBacktestHistory) {
      return reply.status(503).send({ error: 'persistencia no disponible' });
    }
    const q = z
      .object({
        symbol: z.string().default(deps.symbols[0] ?? 'BTCUSDT'),
        interval: z.string().default('5m'),
        limit: z.coerce.number().int().min(2).max(100).default(30),
      })
      .parse(request.query);
    const runs = await deps.getBacktestHistory(q.symbol.toUpperCase(), q.interval, q.limit);
    return { symbol: q.symbol.toUpperCase(), interval: q.interval, runs };
  });

  app.get('/timeframes', async (request) => {
    const q = z
      .object({ symbol: z.string().default(deps.symbols[0] ?? 'BTCUSDT') })
      .parse(request.query);
    const sym = q.symbol.toUpperCase();
    const captura = deps.captureInfo?.();
    const capturados = new Set(
      (captura?.intervals ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    );
    const stats = (await deps.snapshotStats?.(sym).catch(() => null)) as
      | { porTf?: Array<{ interval: string; total: number; tp: number; sl: number; expectancy: number | null }> }
      | null;
    const porTf = new Map((stats?.porTf ?? []).map((t) => [t.interval, t]));

    const usage = await Promise.all(
      INTERVALS.map(async (interval) => {
        const meta = deps.ensembleMeta?.(sym, interval);
        const bt = deps.getBacktest ? await deps.getBacktest(sym, interval).catch(() => null) : null;
        const t = porTf.get(interval);
        return {
          interval,
          captura: (captura?.enabled ?? false) && capturados.has(interval),
          optimizado: meta?.optimized ?? false,
          backtest: bt !== null,
          registros: t?.total ?? 0,
          expectancy: t?.expectancy ?? null,
        };
      }),
    );
    return { symbol: sym, capturaActiva: captura?.enabled ?? false, usage };
  });

  app.get('/indicators', async () => ({ indicators: deps.registry.catalog() }));

  app.get('/candles', async (request, reply) => {
    const parsed = CandlesQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'parámetros inválidos', detail: parsed.error.issues });
    }
    const { symbol, interval, limit, to } = parsed.data;
    if (!isInterval(interval)) {
      return reply.status(400).send({ error: `interval no soportado: ${interval}` });
    }
    try {
      const candles = await deps.getHistory(symbol.toUpperCase(), interval, limit, to);
      return { symbol: symbol.toUpperCase(), interval, candles };
    } catch (err) {
      request.log.warn({ err: String(err) }, 'fallo al obtener histórico del proveedor');
      return reply.status(502).send({ error: 'proveedor de datos no disponible' });
    }
  });

  // Votos actuales (internos + señales externas activas). Útil para carga inicial y pruebas.
  app.get('/votes', async (request, reply) => {
    const parsed = CandlesQuery.safeParse(request.query);
    if (!parsed.success || !isInterval(parsed.data.interval)) {
      return reply.status(400).send({ error: 'parámetros inválidos' });
    }
    const { symbol, interval, limit } = parsed.data;
    const sym = symbol.toUpperCase();
    try {
      const candles = await deps.getHistory(sym, interval, limit);
      const votes: Vote[] = [
        ...deps.registry.computeVotes(candles),
        ...deps.externalStore.active(sym),
      ];
      return { symbol: sym, interval, votes };
    } catch (err) {
      request.log.warn({ err: String(err) }, 'fallo al calcular votos');
      return reply.status(502).send({ error: 'proveedor de datos no disponible' });
    }
  });

  // Señal completa del ensemble (agregación + probabilidades). Carga inicial y pruebas.
  app.get('/signal', async (request, reply) => {
    const parsed = CandlesQuery.safeParse(request.query);
    if (!parsed.success || !isInterval(parsed.data.interval)) {
      return reply.status(400).send({ error: 'parámetros inválidos' });
    }
    const { symbol, interval, limit } = parsed.data;
    const sym = symbol.toUpperCase();
    try {
      const candles = await deps.getHistory(sym, interval, limit);
      const price = candles.length > 0 ? candles[candles.length - 1]!.close : 0;
      const votes = [...deps.registry.computeVotes(candles), ...deps.externalStore.active(sym)];
      const signal = buildSignal({
        symbol: sym,
        price,
        votes,
        config: deps.getEnsembleFor?.(sym, interval) ?? deps.ensemble,
        equity: deps.equity,
        interval,
        macro: deps.getMacro?.(sym),
        calibrators: deps.calibrators,
        metaModel: deps.metaModel,
        metaMode: deps.metaMode,
        metaVetoThreshold: deps.metaVetoThreshold,
        metaModulateWeight: deps.metaModulateWeight,
      });
      return { interval, signal };
    } catch (err) {
      request.log.warn({ err: String(err) }, 'fallo al construir la señal');
      return reply.status(502).send({ error: 'proveedor de datos no disponible' });
    }
  });

  // Webhook de TradingView (alertas Pine de la suite Reditum). Token secreto en el body.
  app.post('/tv-hook', async (request, reply) => {
    const parsed = TvHookBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'payload inválido', detail: parsed.error.issues });
    }
    const payload = parsed.data;
    if (deps.tvSecret && payload.secret !== deps.tvSecret) {
      return reply.status(401).send({ error: 'secret inválido' });
    }
    const symbol = payload.symbol.toUpperCase();
    const vote = deps.mapper.map('tradingview', {
      indicator: payload.strategy,
      symbol,
      signal: payload.signal,
      value: payload.value,
      ts: payload.ts,
    });
    if (!vote) {
      return reply
        .status(422)
        .send({ error: `sin mapeo para ${payload.strategy}/${payload.signal ?? payload.value}` });
    }
    deps.externalStore.put(symbol, vote);
    deps.onExternalVote?.(symbol, vote);
    deps.recordExternal?.({
      symbol,
      strategy: payload.strategy,
      signal: payload.signal,
      tf: payload.tf,
      score: vote.score,
      ts: vote.ts,
      payload,
    });
    return { accepted: true, vote };
  });

  // Eliminar un snapshot por id.
  app.delete('/snapshots/:id', async (request, reply) => {
    if (!deps.deleteSnapshot) {
      return reply.status(503).send({ error: 'persistencia no disponible' });
    }
    const { id } = request.params as { id: string };
    const ok = await deps.deleteSnapshot(id);
    if (!ok) return reply.status(404).send({ error: 'snapshot no encontrado' });
    return { deleted: true, id };
  });

  // Último backtest guardado (lo produce apps/quant).
  app.get('/backtest', async (request, reply) => {
    if (!deps.getBacktest) {
      return reply.status(503).send({ error: 'persistencia no disponible' });
    }
    const q = z
      .object({
        symbol: z.string().default(deps.symbols[0] ?? 'BTCUSDT'),
        interval: z.string().default('5m'),
      })
      .parse(request.query);
    const bt = await deps.getBacktest(q.symbol.toUpperCase(), q.interval);
    if (!bt) {
      return reply.status(404).send({ error: 'sin backtest; ejecuta el CLI de quant' });
    }
    return bt;
  });

  // ---- Lanzar backtest / optimización desde la UI (proxy al servicio quant) ----
  const QuantQuery = z.object({
    symbol: z.string().default('BTCUSDT'),
    interval: z.string().default('5m'),
  });
  async function proxyQuant(path: string, query: { symbol: string; interval: string }) {
    const url = `${deps.quantUrl}/${path}?symbol=${encodeURIComponent(query.symbol.toUpperCase())}&interval=${encodeURIComponent(query.interval)}`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error(`quant ${res.status}`);
    return res.json();
  }
  app.post('/backtest/run', async (request, reply) => {
    if (!deps.quantUrl) return reply.status(503).send({ error: 'servicio quant no configurado' });
    const q = QuantQuery.parse(request.query);
    try {
      return await proxyQuant('run-backtest', q);
    } catch (err) {
      request.log.error({ err: String(err) }, 'fallo al lanzar backtest');
      return reply.status(502).send({ error: 'no se pudo lanzar el backtest' });
    }
  });
  // Estado del piloto automático de backtest/optimización (worker en quant).
  app.get('/automation', async (request, reply) => {
    if (!deps.quantUrl) return reply.status(503).send({ error: 'servicio quant no configurado' });
    try {
      const res = await fetch(`${deps.quantUrl}/automation`);
      if (!res.ok) throw new Error(`quant ${res.status}`);
      return await res.json();
    } catch (err) {
      request.log.error({ err: String(err) }, 'fallo al pedir el estado de automatización');
      return reply.status(502).send({ error: 'no se pudo obtener el estado de automatización' });
    }
  });

  // Configurar la política del piloto automático (persistente; el worker la relee).
  app.post('/automation', async (request, reply) => {
    if (!deps.quantUrl) return reply.status(503).send({ error: 'servicio quant no configurado' });
    const body = z
      .object({
        enabled: z.boolean().optional(),
        backtest_every_h: z.number().min(0.5).max(168).optional(),
        optimize_every_h: z.number().min(6).max(24 * 60).optional(),
        cooldown_h: z.number().min(1).max(24 * 30).optional(),
        trials: z.number().int().min(5).max(200).optional(),
        intervals: z.array(z.string()).min(1).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'configuración inválida' });
    try {
      const res = await fetch(`${deps.quantUrl}/automation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body.data),
      });
      if (!res.ok) throw new Error(`quant ${res.status}`);
      return await res.json();
    } catch (err) {
      request.log.error({ err: String(err) }, 'fallo al configurar la automatización');
      return reply.status(502).send({ error: 'no se pudo configurar la automatización' });
    }
  });

  // Calibrar probabilidades desde la UI (sin terminal).
  app.post('/calibrate/run', async (request, reply) => {
    if (!deps.quantUrl) return reply.status(503).send({ error: 'servicio quant no configurado' });
    const q = QuantQuery.parse(request.query);
    try {
      return await proxyQuant('run-calibration', q);
    } catch (err) {
      request.log.error({ err: String(err) }, 'fallo al lanzar calibración');
      return reply.status(502).send({ error: 'no se pudo lanzar la calibración' });
    }
  });

  // Reentrenar el meta-modelo (Módulo 2) desde la UI.
  app.post('/ml/train', async (request, reply) => {
    if (!deps.quantUrl) return reply.status(503).send({ error: 'servicio quant no configurado' });
    try {
      const res = await fetch(`${deps.quantUrl}/run-metamodel`, { method: 'POST' });
      if (!res.ok) throw new Error(`quant ${res.status}`);
      return await res.json();
    } catch (err) {
      request.log.error({ err: String(err) }, 'fallo al entrenar el meta-modelo');
      return reply.status(502).send({ error: 'no se pudo entrenar el meta-modelo' });
    }
  });

  // Informe de preparación del dataset ML (Módulo 2 · fase 0).
  app.get('/ml/dataset', async (request, reply) => {
    if (!deps.quantUrl) return reply.status(503).send({ error: 'servicio quant no configurado' });
    try {
      const res = await fetch(`${deps.quantUrl}/dataset-report`);
      if (!res.ok) throw new Error(`quant ${res.status}`);
      return await res.json();
    } catch (err) {
      request.log.error({ err: String(err) }, 'fallo al pedir el informe del dataset');
      return reply.status(502).send({ error: 'no se pudo obtener el informe del dataset' });
    }
  });

  app.post('/optimize/run', async (request, reply) => {
    if (!deps.quantUrl) return reply.status(503).send({ error: 'servicio quant no configurado' });
    const q = QuantQuery.parse(request.query);
    try {
      return await proxyQuant('run-optimize', q);
    } catch (err) {
      request.log.error({ err: String(err) }, 'fallo al lanzar optimización');
      return reply.status(502).send({ error: 'no se pudo lanzar la optimización' });
    }
  });

  // Metadatos de calibración (fiabilidad + Brier por régimen) para el dashboard.
  app.get('/calibration', async () => {
    const meta = deps.calibrators?.meta() ?? null;
    return { calibration: meta };
  });

  // Metadatos del ensemble activo (base vs optimizado) para el comparador.
  app.get('/ensemble', async (request) => {
    const q = z
      .object({ symbol: z.string().default('BTCUSDT'), interval: z.string().default('5m') })
      .parse(request.query);
    return (
      deps.ensembleMeta?.(q.symbol, q.interval) ?? {
        version: deps.ensemble.version,
        optimized: false,
        report: null,
      }
    );
  });

  // ---- M9: Web Push ----
  app.get('/push/vapid', async () => ({ publicKey: deps.vapidPublicKey ?? null }));

  app.post('/push/subscribe', async (request, reply) => {
    if (!deps.savePushSub) return reply.status(503).send({ error: 'push no disponible' });
    const body = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'suscripción inválida' });
    await deps.savePushSub(body.data);
    return { ok: true };
  });

  // ---- M8: alertas / notificaciones ----
  app.get('/alerts', async (request, reply) => {
    if (!deps.listAlerts) return reply.status(503).send({ error: 'persistencia no disponible' });
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(
      request.query,
    );
    return deps.listAlerts(q.limit);
  });

  app.post('/alerts', async (request, reply) => {
    if (!deps.createAlert) return reply.status(503).send({ error: 'persistencia no disponible' });
    const body = z
      .object({
        symbol: z.string().optional(),
        interval: z.string().optional(),
        type: z.string().min(1),
        severity: z.enum(['info', 'success', 'warning']).default('info'),
        title: z.string().min(1),
        message: z.string().optional(),
        meta: z.unknown().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'alerta inválida' });
    const row = await deps.createAlert(body.data);
    return { created: true, alert: row };
  });

  app.post('/alerts/read', async (_request, reply) => {
    if (!deps.markAlertsRead) return reply.status(503).send({ error: 'persistencia no disponible' });
    const n = await deps.markAlertsRead();
    return { ok: true, marked: n };
  });

  // Recarga en caliente de artefactos (ensemble optimizado + calibradores) desde quant.
  app.post('/reload', async () => {
    if (deps.reloadArtifacts) {
      const r = deps.reloadArtifacts();
      return {
        reloaded: true,
        ensemble_version: r.ensembleVersion,
        calibration_version: r.calibrationVersion,
      };
    }
    const ok = deps.calibrators?.reload() ?? false;
    return { reloaded: ok, calibration_version: deps.calibrators?.version ?? null };
  });

  // Listado de snapshots con seguimiento en vivo (precio actual vs niveles).
  app.get('/snapshots', async (request, reply) => {
    if (!deps.listSnapshots) {
      return reply.status(503).send({ error: 'persistencia no disponible' });
    }
    const q = z
      .object({
        symbol: z.string().default(deps.symbols[0] ?? 'BTCUSDT'),
        limit: z.coerce.number().int().min(1).max(1000).default(300),
      })
      .parse(request.query);
    const sym = q.symbol.toUpperCase();
    const { rows, total } = await deps.listSnapshots(sym, q.limit);
    let currentPrice = 0;
    try {
      const candles = await deps.getHistory(sym, '1m', 1);
      currentPrice = candles.length > 0 ? candles[candles.length - 1]!.close : 0;
    } catch {
      currentPrice = 0;
    }
    const now = Date.now();
    // `estado` es el estado autoritativo (manda el resultado evaluado); `tracking` solo describe
    // dónde está el precio ahora y únicamente importa mientras el registro sigue abierto.
    const snapshots = rows.map((row) => ({
      ...row,
      estado: estadoFinal(row),
      tracking: currentPrice > 0 ? trackSnapshot(row, currentPrice, now) : null,
    }));
    const stats = deps.snapshotStats ? await deps.snapshotStats(sym).catch(() => null) : null;
    return { symbol: sym, currentPrice, snapshots, total, stats };
  });

  const SnapshotBody = z.object({
    symbol: z.string().min(1),
    interval: z.string().default('1m'),
    note: z.string().optional(),
  });

  // Instantánea autoritativa del escenario (para análisis / entrenamiento de IA).
  app.post('/snapshots', async (request, reply) => {
    if (!deps.recordSnapshot) {
      return reply.status(503).send({ error: 'persistencia no disponible (sin DATABASE_URL)' });
    }
    const parsed = SnapshotBody.safeParse(request.body);
    if (!parsed.success || !isInterval(parsed.data.interval)) {
      return reply.status(400).send({ error: 'parámetros inválidos' });
    }
    const { symbol, interval, note } = parsed.data;
    const sym = symbol.toUpperCase();
    try {
      const candles = await deps.getHistory(sym, interval, 300);
      const price = candles.length > 0 ? candles[candles.length - 1]!.close : 0;
      const votes = [...deps.registry.computeVotes(candles), ...deps.externalStore.active(sym)];
      const signal = buildSignal({
        symbol: sym,
        price,
        votes,
        config: deps.getEnsembleFor?.(sym, interval) ?? deps.ensemble,
        equity: deps.equity,
        interval,
        macro: deps.getMacro?.(sym),
        calibrators: deps.calibrators,
        metaModel: deps.metaModel,
        metaMode: deps.metaMode,
        metaVetoThreshold: deps.metaVetoThreshold,
        metaModulateWeight: deps.metaModulateWeight,
      });
      const levels = computePlanLevels(
        signal.action,
        signal.price,
        signal.atr,
        deps.ensemble.risk,
        deps.equity,
      );
      const id = await deps.recordSnapshot(signal, interval, levels, note);
      return { saved: true, id, signal };
    } catch (err) {
      request.log.warn({ err: String(err) }, 'fallo al guardar el snapshot');
      return reply.status(502).send({ error: 'no se pudo capturar el snapshot' });
    }
  });

  return app;
}
