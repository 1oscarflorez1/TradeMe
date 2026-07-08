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

export interface AppDeps {
  getHistory: (symbol: string, interval: string, limit: number) => Promise<Candle[]>;
  symbols: string[];
  registry: IndicatorRegistry;
  externalStore: ExternalSignalStore;
  mapper: ExternalMapper;
  ensemble: EnsembleConfig;
  nt8Secret?: string;
  /** Callback para difundir en vivo una señal externa recién recibida. */
  onExternalVote?: (symbol: string, vote: Vote) => void;
}

const CandlesQuery = z.object({
  symbol: z.string().min(1),
  interval: z.string().default('1m'),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});

const NinjaBody = z.object({
  indicator: z.string().min(1),
  symbol: z.string().min(1),
  signal: z.string().optional(),
  value: z.number().optional(),
  ts: z.string().optional(),
});

export function buildApp(deps: AppDeps): FastifyInstance {
  const env = loadEnv();
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  // CORS: el dashboard (otro puerto) necesita cabeceras para hablar con la API.
  const corsOrigin = env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((o) => o.trim()) : true;
  void app.register(cors, { origin: corsOrigin });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'trademe-api',
    version: '0.2.0',
    liveTrading: env.ENABLE_LIVE_TRADING === 'true',
    ts: new Date().toISOString(),
  }));

  app.get('/symbols', async () => ({ symbols: deps.symbols, intervals: INTERVALS }));

  app.get('/indicators', async () => ({ indicators: deps.registry.catalog() }));

  app.get('/candles', async (request, reply) => {
    const parsed = CandlesQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'parámetros inválidos', detail: parsed.error.issues });
    }
    const { symbol, interval, limit } = parsed.data;
    if (!isInterval(interval)) {
      return reply.status(400).send({ error: `interval no soportado: ${interval}` });
    }
    try {
      const candles = await deps.getHistory(symbol.toUpperCase(), interval, limit);
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
      const signal = buildSignal({ symbol: sym, price, votes, config: deps.ensemble });
      return { interval, signal };
    } catch (err) {
      request.log.warn({ err: String(err) }, 'fallo al construir la señal');
      return reply.status(502).send({ error: 'proveedor de datos no disponible' });
    }
  });

  // Ingreso de señales externas de NinjaTrader (stub para M2; puente real en M5).
  app.post('/signals/ninjatrader', async (request, reply) => {
    if (deps.nt8Secret) {
      const provided = request.headers['x-nt8-secret'];
      if (provided !== deps.nt8Secret) {
        return reply.status(401).send({ error: 'secret inválido' });
      }
    }
    const parsed = NinjaBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'payload inválido', detail: parsed.error.issues });
    }
    const payload = parsed.data;
    const symbol = payload.symbol.toUpperCase();
    const vote = deps.mapper.map('ninjatrader', { ...payload, symbol });
    if (!vote) {
      return reply
        .status(422)
        .send({ error: `sin mapeo para ${payload.indicator}/${payload.signal ?? payload.value}` });
    }
    deps.externalStore.put(symbol, vote);
    deps.onExternalVote?.(symbol, vote);
    return { accepted: true, vote };
  });

  return app;
}
