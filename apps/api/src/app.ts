import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv } from './config.js';

/** Construye la instancia Fastify con las rutas base (sin arrancar el listener). */
export function buildApp(): FastifyInstance {
  const env = loadEnv();
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'trademe-api',
    version: '0.0.0',
    liveTrading: env.ENABLE_LIVE_TRADING === 'true',
    ts: new Date().toISOString(),
  }));

  return app;
}
