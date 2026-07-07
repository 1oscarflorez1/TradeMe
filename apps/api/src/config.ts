import { z } from 'zod';
import { INTERVALS, isInterval, type Interval } from './domain/candle.js';
import type { Subscription } from './adapters/data-adapter.js';

const EnvSchema = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENABLE_LIVE_TRADING: z.enum(['true', 'false']).default('false'),
  DATABASE_URL: z.string().optional(),
  TRADEME_SYMBOLS: z.string().default('BTCUSDT'),
  TRADEME_INTERVALS: z.string().default('1m,1h'),
  // Señales externas (NinjaTrader). Si el secret está vacío, el endpoint acepta en dev.
  NT8_WEBHOOK_SECRET: z.string().optional(),
  EXTERNAL_SIGNALS_CONFIG: z.string().default('apps/api/config/external_signals.yaml'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}

export function parseSymbols(env: Env): string[] {
  return env.TRADEME_SYMBOLS.split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

export function parseIntervals(env: Env): Interval[] {
  const parsed = env.TRADEME_INTERVALS.split(',')
    .map((s) => s.trim())
    .filter(isInterval);
  return parsed.length > 0 ? parsed : [...INTERVALS];
}

export function buildSubscriptions(env: Env): Subscription[] {
  const subs: Subscription[] = [];
  for (const symbol of parseSymbols(env)) {
    for (const interval of parseIntervals(env)) {
      subs.push({ symbol, interval });
    }
  }
  return subs;
}
