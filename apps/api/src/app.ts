import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadEnv } from './config.js';
import { INTERVALS, isInterval, type Candle } from './domain/candle.js';

export interface AppDeps {
  /** Devuelve histórico de velas para la carga inicial del gráfico. */
  getHistory: (symbol: string, interval: string, limit: number) => Promise<Candle[]>;
  symbols: string[];
}

const CandlesQuery = z.object({
  symbol: z.string().min(1),
  interval: z.string().default('1m'),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
});

export function buildApp(deps: AppDeps): FastifyInstance {
  const env = loadEnv();
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'trademe-api',
    version: '0.1.0',
    liveTrading: env.ENABLE_LIVE_TRADING === 'true',
    ts: new Date().toISOString(),
  }));

  app.get('/symbols', async () => ({
    symbols: deps.symbols,
    intervals: INTERVALS,
  }));

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

  return app;
}
